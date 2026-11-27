// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { luminosity, recolourToGrey } from './content.js';
import { greyImage } from './images.js';
import { contentStreams, everyDict, isRgbSpace, name, readStream, rgbSpaceNames, writeStream } from './pdf.js';

/** @typedef {import('./images.js').Left} Left */

/**
 * The forms that are the luminosity of a soft mask, and the forms they draw, at any depth. In such a form the colour
 * is opacity, not ink.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<PDFRef>}
 */
export function luminosityMaskForms(context) {
  const forms = new Set();
  for (const dict of everyDict(context)) {
    const form = dict.get(name('G'));
    if (dict.get(name('S')) === name('Luminosity') && form instanceof PDFRef) forms.add(form);
  }
  // A form drawn inside a mask is part of the mask, so its colour is opacity too.
  const waiting = [...forms];
  while (waiting.length > 0) {
    for (const ref of drawnBy(context, waiting.pop())) {
      if (forms.has(ref) || !isXObject(context.lookup(ref), 'Form')) continue;
      forms.add(ref);
      waiting.push(ref);
    }
  }
  return forms;
}

/**
 * Turns luminosity masks to DeviceGray: their colours, their RGB images, an RGB group and an RGB backdrop each become
 * the grey of the same luminosity, which is the value PDF reads from them, so every mask is exactly as opaque as before.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {Set<PDFRef>} maskForms  From luminosityMaskForms.
 * @returns {Promise<Left[]>}  What could not be turned grey; each is still RGB.
 */
export async function greyMasks(doc, maskForms) {
  const { context } = doc;
  const streams = contentStreams(doc);
  const printed = streams.filter(({ ref }) => !maskForms.has(ref));
  const printedResources = new Set(printed.map(({ resources }) => resources));
  const left = [];
  for (const stream of streams) {
    if (maskForms.has(stream.ref)) left.push(...greyMaskStream(context, stream, printedResources));
  }
  greyBackdrops(context, maskForms);
  // An image that a printed stream draws too stays colour, and is converted to CMYK with the others.
  const printedImages = new Set(printed.flatMap(({ resources }) => xobjectsOf(resources)));
  left.push(...(await greyMaskImages(context, maskForms, printedImages)));
  return left;
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('./pdf.js').ContentStream} stream  A mask form.
 * @param {Set<PDFDict | undefined>} printedResources  The resources of the streams that print.
 * @returns {Left[]}
 */
function greyMaskStream(context, { ref, resources }, printedResources) {
  // Resources shared with a stream that prints are renamed to CMYK for that stream, so their names are not followed here.
  const own = resources instanceof PDFDict && !printedResources.has(resources);
  const rgbNames = own ? rgbSpaceNames(context, resources) : [];
  const source = readStream(context.lookup(ref)).toString('latin1');
  const result = recolourToGrey(source, new Set(rgbNames.map((key) => key.asString())));
  if (result.inlineImage) return [{ what: `soft mask ${ref.objectNumber}: holds an inline image`, rgb: true }];
  writeStream(context, ref, Buffer.from(result.source, 'latin1'));
  for (const key of rgbNames) resources.lookup(name('ColorSpace'), PDFDict).set(key, name('DeviceGray'));
  greyGroup(context, context.lookup(ref));
  if (result.leftRgb === 0) return [];
  return [{ what: `soft mask ${ref.objectNumber}: ${result.leftRgb} colour(s) in a colour space not known to be RGB`, rgb: true }];
}

/**
 * A mask's group blends in its own colour space; an RGB one becomes DeviceGray, where the mask's greys now are.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRawStream} form
 * @returns {void}
 */
function greyGroup(context, form) {
  const group = form.dict.lookupMaybe(name('Group'), PDFDict);
  if (group && isRgbSpace(context, group.get(name('CS')))) group.set(name('CS'), name('DeviceGray'));
}

/**
 * A backdrop colour is given in the group's colour space, so an RGB one becomes the grey of its luminosity too.
 * @param {import('pdf-lib').PDFContext} context
 * @param {Set<PDFRef>} maskForms
 * @returns {void}
 */
function greyBackdrops(context, maskForms) {
  for (const dict of everyDict(context)) {
    if (dict.get(name('S')) !== name('Luminosity') || !maskForms.has(dict.get(name('G')))) continue;
    const levels = dict.lookupMaybe(name('BC'), PDFArray)?.asArray().map((item) => context.lookup(item));
    if (!levels || levels.length !== 3 || !levels.every((level) => level instanceof PDFNumber)) continue;
    const grey = luminosity(levels.map((level) => level.asNumber() * 255));
    dict.set(name('BC'), context.obj([Number(grey.toFixed(4))]));
  }
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {Set<PDFRef>} maskForms
 * @param {Set<PDFRef>} printedImages  Images that a printed stream draws too; they are left to convertImages.
 * @returns {Promise<Left[]>}
 */
async function greyMaskImages(context, maskForms, printedImages) {
  const left = [];
  for (const form of maskForms) {
    for (const ref of drawnBy(context, form)) {
      const image = context.lookup(ref);
      if (printedImages.has(ref) || !isXObject(image, 'Image')) continue;
      if (!isRgbSpace(context, image.dict.get(name('ColorSpace')))) continue;
      const reason = await greyImage(context, ref);
      if (reason !== null) left.push({ what: `image ${ref.objectNumber} in a soft mask: ${reason}`, rgb: true });
    }
  }
  return left;
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRef} ref  A form XObject.
 * @returns {PDFRef[]}  What its own resources name as XObjects: the forms and images it can draw.
 */
function drawnBy(context, ref) {
  const form = context.lookup(ref);
  return form instanceof PDFRawStream ? xobjectsOf(form.dict.lookupMaybe(name('Resources'), PDFDict)) : [];
}

/**
 * @param {PDFDict | undefined} resources
 * @returns {PDFRef[]}  The references its /XObject dictionary holds.
 */
function xobjectsOf(resources) {
  const xobjects = resources?.lookupMaybe(name('XObject'), PDFDict);
  return xobjects ? [...xobjects.values()].filter((value) => value instanceof PDFRef) : [];
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @param {string} subtype  'Form' or 'Image'.
 * @returns {boolean}
 */
function isXObject(object, subtype) {
  return object instanceof PDFRawStream && object.dict.get(name('Subtype')) === name(subtype);
}
