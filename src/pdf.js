// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { deflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';

/**
 * A content stream, the reference it lives at, and the resources it is painted with.
 * @typedef {{ref: PDFRef, resources: PDFDict | undefined}} ContentStream
 */

/**
 * Names are interned by pdf-lib, so the result compares with `===`.
 * @param {string} text
 * @returns {PDFName}
 */
export const name = (text) => PDFName.of(text);

/**
 * Yields the dictionaries inside one object. References are not followed: each indirect object is
 * visited on its own by `everyDict`, so every dictionary of the file comes out once.
 * @param {import('pdf-lib').PDFObject} object
 * @returns {Generator<PDFDict>}
 */
function* dictsWithin(object) {
  if (object instanceof PDFStream) {
    yield* dictsWithin(object.dict);
  } else if (object instanceof PDFDict) {
    yield object;
    for (const value of object.values()) yield* dictsWithin(value);
  } else if (object instanceof PDFArray) {
    for (const item of object.asArray()) yield* dictsWithin(item);
  }
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Generator<PDFDict>} Every dictionary of the file, once.
 */
export function* everyDict(context) {
  for (const [, object] of context.enumerateIndirectObjects()) {
    yield* dictsWithin(object);
  }
}

/**
 * A stream of three components is an ICC profile for RGB; the colour space itself is then RGB too.
 * @param {PDFStream} profile
 * @returns {boolean}
 */
function hasThreeComponents(profile) {
  const components = profile.dict.lookup(name('N'));
  return components instanceof PDFNumber && components.asNumber() === 3;
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} space
 * @returns {boolean}
 */
export function isRgbSpace(context, space) {
  const value = context.lookup(space);
  if (value === name('DeviceRGB')) return true;
  if (!(value instanceof PDFArray) || value.lookup(0) !== name('ICCBased')) return false;
  const profile = value.lookup(1);
  return profile instanceof PDFStream && hasThreeComponents(profile);
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFDict | undefined} resources
 * @returns {PDFName[]} The names under which the resources declare an RGB colour space, in order.
 */
export function rgbSpaceNames(context, resources) {
  if (!(resources instanceof PDFDict)) return [];
  const spaces = resources.lookup(name('ColorSpace'));
  if (!(spaces instanceof PDFDict)) return [];
  return [...spaces.entries()].filter(([, value]) => isRgbSpace(context, value)).map(([key]) => key);
}

/**
 * @param {PDFDict} dict
 * @returns {boolean} True for a form XObject or a tiling pattern, both of which carry resources.
 */
function isFormOrPattern(dict) {
  return dict.get(name('Subtype')) === name('Form') || dict.has(name('PatternType'));
}

/**
 * Pairs a reference with its resources when it points at a raw stream, and yields nothing otherwise.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} ref
 * @param {PDFDict | undefined} resources
 * @returns {Array<[PDFRef, PDFDict | undefined]>}
 */
function streamPair(context, ref, resources) {
  return ref instanceof PDFRef && context.lookup(ref) instanceof PDFRawStream ? [[ref, resources]] : [];
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} ref
 * @returns {boolean} True for a form XObject with no /Resources of its own.
 */
function isResourcelessForm(context, ref) {
  const form = context.lookup(ref);
  return form instanceof PDFRawStream && form.dict.get(name('Subtype')) === name('Form') && !form.dict.has(name('Resources'));
}

/**
 * The page content streams and the forms the page draws without resources of their own, each
 * paired with its page's resources. Such a form is painted with the page's named spaces, so it
 * must be paired with them here; it is listed first so that this pair wins over the undefined one.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Array<[PDFRef, PDFDict | undefined]>}
 */
function pageStreams(doc) {
  const { context } = doc;
  return doc.getPages().flatMap((page) => {
    const contents = page.node.get(name('Contents'));
    const looked = context.lookup(contents);
    const refs = looked instanceof PDFArray ? looked.asArray() : [contents];
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(name('XObject'), PDFDict);
    const inherited = xobjects ? [...xobjects.values()].filter((ref) => isResourcelessForm(context, ref)) : [];
    return [...refs, ...inherited].flatMap((ref) => streamPair(context, ref, resources));
  });
}

/**
 * Form XObjects and tiling patterns, each paired with its own resources. Without /Resources they
 * inherit the page's, which is why the pair then carries undefined.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Array<[PDFRef, PDFDict | undefined]>}
 */
function formAndPatternStreams(context) {
  return [...context.enumerateIndirectObjects()].flatMap(([ref, object]) => {
    if (!(object instanceof PDFRawStream) || !isFormOrPattern(object.dict)) return [];
    return streamPair(context, ref, object.dict.lookupMaybe(name('Resources'), PDFDict));
  });
}

/**
 * The glyph procedures of every Type 3 font, each paired with the font's resources. A font dict
 * may be written directly inside a resources dict, so every dictionary is looked at, not only the
 * indirect objects.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Array<[PDFRef, PDFDict | undefined]>}
 */
function glyphStreams(context) {
  return [...everyDict(context)].flatMap((object) => {
    if (object.get(name('Subtype')) !== name('Type3')) return [];
    const charProcs = object.lookup(name('CharProcs'));
    if (!(charProcs instanceof PDFDict)) return [];
    const resources = object.lookupMaybe(name('Resources'), PDFDict);
    return [...charProcs.values()].flatMap((ref) => streamPair(context, ref, resources));
  });
}

/**
 * The page content streams, form XObjects, tiling patterns and Type 3 glyph procedures of a document.
 * A stream reached twice is listed once, at its first sighting.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {ContentStream[]}
 */
export function contentStreams(doc) {
  const found = new Map();
  const sightings = [...pageStreams(doc), ...formAndPatternStreams(doc.context), ...glyphStreams(doc.context)];
  for (const [ref, resources] of sightings) {
    if (!found.has(ref)) found.set(ref, { ref, resources });
  }
  return [...found.values()];
}

/**
 * @param {PDFRawStream} stream
 * @returns {Buffer} Its data, decoded.
 */
export function readStream(stream) {
  return Buffer.from(decodePDFRawStream(stream).decode());
}

/**
 * Replaces the data of the stream at `ref`, compressed, and keeps the rest of its dictionary.
 * The old decode parameters described the old data, so they go. /Length is left to pdf-lib on save.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRef} ref
 * @param {Uint8Array} bytes
 * @returns {void}
 */
export function writeStream(context, ref, bytes) {
  const { dict } = context.lookup(ref);
  dict.delete(name('DecodeParms'));
  dict.set(name('Filter'), name('FlateDecode'));
  context.assign(ref, PDFRawStream.of(dict, deflateSync(bytes)));
}
