// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { PDFArray, PDFDict, PDFNumber } from 'pdf-lib';
import { everyDict, isRgbSpace, name } from './pdf.js';

/**
 * @typedef {import('pdf-lib').PDFContext} PDFContext
 * @typedef {import('./colour.js').MapColours} MapColours
 * @typedef {import('./colour.js').Mapped} Mapped
 * @typedef {import('./colour.js').Rgb} Rgb
 * @typedef {import('./images.js').Left} Left
 */

/**
 * The items of an array, each with its reference followed.
 * @param {PDFArray} array
 * @returns {import('pdf-lib').PDFObject[]}
 */
function itemsOf(array) {
  return Array.from({ length: array.size() }, (_, at) => array.lookup(at));
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} value
 * @returns {boolean} True for an array of exactly three numbers.
 */
function isRgbTriple(value) {
  return value instanceof PDFArray && value.size() === 3 && itemsOf(value).every((item) => item instanceof PDFNumber);
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @returns {boolean} True for a type 2 function that blends from one RGB colour to another.
 */
function isBlend(object) {
  if (!(object instanceof PDFDict)) return false;
  const type = object.lookup(name('FunctionType'));
  return type instanceof PDFNumber
    && type.asNumber() === 2
    && isRgbTriple(object.lookup(name('C0')))
    && isRgbTriple(object.lookup(name('C1')));
}

/**
 * The blends a shading runs in ink. A shading with a /Background is left alone: the background
 * would be a colour the blend does not carry.
 * @param {PDFDict} shading
 * @returns {PDFDict[] | null} The blends, or null when the shading is not made of blends alone.
 */
function blendsOf(shading) {
  if (shading.has(name('Background'))) return null;
  const fn = shading.lookup(name('Function'));
  if (!(fn instanceof PDFDict)) return null;
  if (isBlend(fn)) return [fn];

  const type = fn.lookup(name('FunctionType'));
  const functions = fn.lookup(name('Functions'));
  if (!(type instanceof PDFNumber) || type.asNumber() !== 3 || !(functions instanceof PDFArray)) return null;
  const pieces = itemsOf(functions);
  return pieces.every(isBlend) ? /** @type {PDFDict[]} */ (pieces) : null;
}

/**
 * @param {PDFContext} context
 * @returns {Generator<PDFDict>} The RGB shadings of the file, each once.
 */
function* rgbShadings(context) {
  for (const dict of everyDict(context)) {
    if (dict.has(name('ShadingType')) && isRgbSpace(context, dict.get(name('ColorSpace')))) yield dict;
  }
}

/**
 * The functions a shading runs on: its /Function and, for a stitching function, each of its pieces.
 * @param {PDFDict} shading
 * @returns {PDFDict[]}
 */
function functionsOf(shading) {
  const fn = shading.lookup(name('Function'));
  if (!(fn instanceof PDFDict)) return [];
  const functions = fn.lookup(name('Functions'));
  const pieces = functions instanceof PDFArray ? itemsOf(functions) : [];
  return [fn, ...pieces.filter((piece) => piece instanceof PDFDict)];
}

/**
 * @param {PDFDict} shading
 * @returns {Left} The report of a shading left in RGB.
 */
function leftReport(shading) {
  const type = shading.lookup(name('ShadingType'));
  const what = `shading of type ${type.asNumber()}: only blends between two colours are converted`;
  return { what, rgb: true };
}

/**
 * Sorts the RGB shadings into those made of convertible blends and those left in RGB.
 * This runs before any change, because two shadings may share one function, and a function already
 * converted no longer holds three numbers per colour.
 * A blended shading that shares a function with a shading left in RGB is left too: converting that
 * function would paint the left shading with CMYK values. Moving a shading can expose more shared
 * functions, so this repeats until nothing moves.
 * @param {PDFContext} context
 * @returns {{blended: {shading: PDFDict, blends: PDFDict[]}[], left: Left[]}}
 */
function sortShadings(context) {
  let blended = [];
  const leftShadings = [];
  for (const shading of rgbShadings(context)) {
    const blends = blendsOf(shading);
    if (blends) {
      blended.push({ shading, blends });
    } else {
      leftShadings.push(shading);
    }
  }

  for (;;) {
    const leftFunctions = new Set(leftShadings.flatMap(functionsOf));
    const moving = blended.filter(({ blends }) => blends.some((blend) => leftFunctions.has(blend)));
    if (moving.length === 0) break;
    blended = blended.filter((entry) => !moving.includes(entry));
    leftShadings.push(...moving.map(({ shading }) => shading));
  }
  return { blended, left: leftShadings.map(leftReport) };
}

/**
 * @param {PDFDict} blend
 * @param {string} key  'C0' or 'C1'.
 * @returns {Rgb} The colour at `key`, 0..255 per channel.
 */
function rgbEnd(blend, key) {
  const components = blend.lookup(name(key), PDFArray);
  return /** @type {Rgb} */ (itemsOf(components).map((component) => component.asNumber() * 255));
}

/**
 * @param {PDFContext} context
 * @param {PDFDict} blend
 * @param {string} key  'C0' or 'C1'.
 * @param {Mapped} mapped
 * @returns {void}
 */
function setCmyk(context, blend, key, mapped) {
  blend.set(name(key), context.obj(mapped.cmyk.map((percent) => percent / 100)));
}

/**
 * Converts the colour ends of every blend in RGB shadings to CMYK, and leaves the blends to run in ink.
 * A /Range holds one pair per colour component; once the ends are CMYK it would be one pair short,
 * so it is removed and the blend runs over the full output range.
 * @param {PDFContext} context
 * @param {MapColours} mapColours
 * @returns {Promise<{mapped: Mapped[], left: Left[]}>}
 */
export async function convertShadings(context, mapColours) {
  const { blended, left } = sortShadings(context);
  // A function shared by two shadings is listed once, so its colours are not converted twice.
  const blends = [...new Set(blended.flatMap(({ blends: found }) => found))];
  const ends = blends.flatMap((blend) => [rgbEnd(blend, 'C0'), rgbEnd(blend, 'C1')]);
  const mapped = ends.length > 0 ? await mapColours(ends) : [];

  blends.forEach((blend, at) => {
    setCmyk(context, blend, 'C0', mapped[2 * at]);
    setCmyk(context, blend, 'C1', mapped[2 * at + 1]);
    blend.delete(name('Range'));
  });
  for (const { shading } of blended) {
    shading.lookup(name('Function'), PDFDict).delete(name('Range'));
    shading.set(name('ColorSpace'), name('DeviceCMYK'));
  }
  return { mapped, left };
}
