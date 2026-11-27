// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { inflateSync } from 'node:zlib';
import { PDFArray, PDFBool, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { isRgbSpace, name, writeStream } from './pdf.js';
import { imageToCmyk } from './profile.js';

/** @typedef {{what: string, rgb: boolean}} Left  Something left as it was; `rgb` when it still holds RGB. */

/**
 * Converts every RGB image of the file to CMYK through the profile. Images that print as they are,
 * stencil masks and soft masks are not colour and are skipped; the others are converted or reported.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('./profile.js').Profile} profile
 * @returns {Promise<{converted: number, maxInk: number, left: Left[]}>}
 */
export async function convertImages(context, profile) {
  const result = { converted: 0, maxInk: 0, left: [] };
  const masks = softMaskRefs(context);
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!isImage(object) || masks.has(ref) || printsAsItIs(object.dict)) continue;
    const outcome = await convertImage(context, profile, ref, object);
    if ('reason' in outcome) {
      result.left.push({ what: `image ${ref.objectNumber}: ${outcome.reason}`, rgb: outcome.rgb });
    } else {
      result.converted += 1;
      result.maxInk = Math.max(result.maxInk, outcome.maxInk);
    }
  }
  return result;
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @returns {boolean}
 */
function isImage(object) {
  return object instanceof PDFRawStream && object.dict.get(name('Subtype')) === name('Image');
}

/**
 * A soft mask is an image in greys, so it is not converted as colour; it is found through the image it belongs to.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<PDFRef>}
 */
function softMaskRefs(context) {
  const refs = new Set();
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const mask = object.dict.get(name('SMask'));
    if (mask instanceof PDFRef) refs.add(mask);
  }
  return refs;
}

/**
 * @param {import('pdf-lib').PDFDict} dict
 * @returns {boolean} True for a stencil mask, or for an image already in grey or CMYK.
 */
function printsAsItIs(dict) {
  const space = dict.lookup(name('ColorSpace'));
  return dict.lookup(name('ImageMask')) === PDFBool.True
    || space === name('DeviceGray')
    || space === name('DeviceCMYK');
}

/**
 * An indexed palette of RGB colours is still RGB.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} space
 * @returns {boolean}
 */
function isRgbPalette(context, space) {
  return space instanceof PDFArray && space.lookup(0) === name('Indexed') && isRgbSpace(context, space.get(1));
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} space
 * @returns {boolean} True when the image still holds RGB and so is reported with `rgb` set.
 */
function holdsRgb(context, space) {
  return isRgbSpace(context, space) || isRgbPalette(context, space);
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFDict} dict
 * @param {import('pdf-lib').PDFObject | undefined} space
 * @returns {string | null} Why this image is left as it is, or null when it can be converted.
 */
function reasonToLeave(context, dict, space) {
  if (!isRgbSpace(context, space)) return 'not a plain RGB image';
  const bits = dict.lookup(name('BitsPerComponent'));
  if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) return 'not 8 bits per component';
  // Decode and Mask change which values the image holds, which the raw conversion does not follow.
  if (dict.has(name('Decode')) || dict.has(name('DecodeParms')) || dict.has(name('Mask'))) {
    return 'uses Decode, DecodeParms or Mask';
  }
  // Without a size the pixels cannot be laid out; left as it is, the run carries on.
  const width = dict.lookup(name('Width'));
  const height = dict.lookup(name('Height'));
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return 'has no Width or Height';
  const filter = dict.lookup(name('Filter'));
  if (filter !== name('FlateDecode') && filter !== name('DCTDecode')) return 'neither FlateDecode nor DCTDecode';
  return null;
}

/**
 * The four inks of every pixel, or the reason they could not be made.
 * @param {import('./profile.js').Profile} profile
 * @param {PDFRawStream} stream  An RGB image that passed `reasonToLeave`.
 * @returns {Promise<{data: Buffer} | {reason: string}>}
 */
async function cmykPixels(profile, stream) {
  const width = stream.dict.lookup(name('Width')).asNumber();
  const height = stream.dict.lookup(name('Height')).asNumber();
  let pixels;
  try {
    pixels = stream.dict.lookup(name('Filter')) === name('DCTDecode')
      // sharp decodes the JPEG itself, and knows its size.
      ? await imageToCmyk(profile, Buffer.from(stream.contents))
      : await imageToCmyk(profile, inflateSync(stream.contents), { width, height });
  } catch {
    return { reason: 'could not be decoded' };
  }
  if (pixels.width !== width || pixels.height !== height) return { reason: 'size does not match its data' };
  return { data: pixels.data };
}

/**
 * Converts one RGB image in place, or says why it is left as it is.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('./profile.js').Profile} profile
 * @param {PDFRef} ref
 * @param {PDFRawStream} stream
 * @returns {Promise<{maxInk: number} | {reason: string, rgb: boolean}>}
 */
async function convertImage(context, profile, ref, stream) {
  const { dict } = stream;
  const space = dict.lookup(name('ColorSpace'));
  const reason = reasonToLeave(context, dict, space);
  if (reason) return { reason, rgb: holdsRgb(context, space) };

  const made = await cmykPixels(profile, stream);
  if ('reason' in made) return { reason: made.reason, rgb: true };

  dict.set(name('ColorSpace'), name('DeviceCMYK'));
  // Some writers put the JPEG's ColorTransform on the image itself; once the data is Flate it means nothing.
  dict.delete(name('ColorTransform'));
  // Raw CMYK, compressed with Flate, and never a CMYK JPEG: PDF readers disagree on whether a CMYK JPEG
  // is inverted, and Flate has no such doubt.
  writeStream(context, ref, made.data);
  return { maxInk: heaviestInk(made.data) };
}

/**
 * The ink of the heaviest pixel, in percent of full ink on all four plates.
 * Read with a plain loop over four bytes at a time: a photo has millions of pixels, so no array of sums is built.
 * @param {Uint8Array} inks  Four ink bytes per pixel, 255 is full ink.
 * @returns {number}
 */
function heaviestInk(inks) {
  let heaviest = 0;
  for (let at = 0; at < inks.length; at += 4) {
    const total = inks[at] + inks[at + 1] + inks[at + 2] + inks[at + 3];
    if (total > heaviest) heaviest = total;
  }
  return (heaviest / 255) * 100;
}
