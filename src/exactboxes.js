// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFDocument, PDFNumber } from 'pdf-lib';
import { name } from './pdf.js';

/** Chromium's rounding is never more than about 0.6 pt; a page further off than 1 pt was printed at another size. */
const TOLERANCE = 1;

/**
 * Gives the pages that Chromium printed at a rounded size the exact size the document asked for. Chromium rounds a
 * page size to whole points and then to 1/300 inch, and draws the page from its top-left corner without scaling it.
 * So the media box (and the crop box, when there is one) is set to the exact size, and the content and the links are
 * moved up or down by the rounding, so that they keep their place from the top-left corner. Nothing is scaled.
 * A page more than 1 pt from the size asked for, or whose media box does not start at 0 0, is left as it is.
 *
 * Chromium also clips what it paints to its own page, rounded to 1/300 inch, which can stop up to 0.12 pt short of
 * the exact right or bottom edge. So when the canvas colour is given, it is painted first, under everything, from
 * one point outside the exact page on every side.
 * @param {Uint8Array} pdfBytes  A PDF as Chromium printed it.
 * @param {import('./pagesize.js').Size} size  The page size the document asks for, in points.
 * @param {[number, number, number] | null} [canvas]  The page's canvas colour, as RGB from 0 to 1, or null for none.
 * @returns {Promise<Uint8Array>}  The PDF with exact boxes, or the same bytes when no page needed it.
 */
export async function exactPageBoxes(pdfBytes, size, canvas = null) {
  // Chromium's title and dates are kept, which is why updateMetadata is off.
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  let changed = false;
  for (const page of doc.getPages()) changed = fitPage(doc.context, page, size, canvas) || changed;
  return changed ? doc.save() : pdfBytes;
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFPage} page
 * @param {import('./pagesize.js').Size} size
 * @param {[number, number, number] | null} canvas
 * @returns {boolean}  True when the page was changed.
 */
function fitPage(context, page, size, canvas) {
  const { x, y, width, height } = page.getMediaBox();
  if (x !== 0 || y !== 0) return false;
  if (Math.abs(width - size.width) > TOLERANCE || Math.abs(height - size.height) > TOLERANCE) return false;
  if (width === size.width && height === size.height) return false;
  const shift = size.height - height;
  if (shift !== 0 || canvas !== null) {
    prependShift(context, page, shift, canvas === null ? '' : canvasFill(canvas, size));
  }
  if (shift !== 0) shiftLinks(context, page, shift);
  page.setMediaBox(0, 0, size.width, size.height);
  // Chromium writes no bleed, trim or art box; convert sets the first two from the media box.
  if (page.node.has(name('CropBox'))) page.setCropBox(0, 0, size.width, size.height);
  return true;
}

/** A number as a PDF operand: five decimals at most, and no trailing zeros. */
const decimal = (value) => String(Number(value.toFixed(5)));

/**
 * A fill of the canvas colour in the page's own space, from one point outside the page on every side, so that a
 * rasteriser that rounds the page out to whole pixels finds its last row and column painted too.
 * @param {[number, number, number]} canvas  RGB from 0 to 1.
 * @param {import('./pagesize.js').Size} size
 * @returns {string}
 */
function canvasFill(canvas, size) {
  const [r, g, b] = canvas.map(decimal);
  return `q ${r} ${g} ${b} rg -1 -1 ${decimal(size.width + 2)} ${decimal(size.height + 2)} re f Q\n`;
}

/**
 * Puts a translation in front of the page's content, after the canvas fill when there is one. The translation is the
 * outermost matrix, so no q is needed around it.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFPage} page
 * @param {number} shift  Points, upwards.
 * @param {string} fill  Content to draw first, in the page's own space, or ''.
 * @returns {void}
 */
function prependShift(context, page, shift, fill) {
  const contents = page.node.get(name('Contents'));
  // A page that draws nothing has nothing to move.
  if (contents === undefined) return;
  const looked = context.lookup(contents);
  const streams = looked instanceof PDFArray ? looked.asArray() : [contents];
  const move = context.register(context.flateStream(`${fill}1 0 0 1 0 ${decimal(shift)} cm\n`));
  page.node.set(name('Contents'), context.obj([move, ...streams]));
}

/**
 * Moves the rectangle of every annotation of the page, which is in the same space as the content.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFPage} page
 * @param {number} shift  Points, upwards.
 * @returns {void}
 */
function shiftLinks(context, page, shift) {
  const annots = page.node.lookup(name('Annots'));
  if (!(annots instanceof PDFArray)) return;
  for (const item of annots.asArray()) {
    const annot = context.lookup(item);
    const rect = annot instanceof PDFDict ? annot.lookup(name('Rect')) : undefined;
    if (!(rect instanceof PDFArray) || rect.size() !== 4) continue;
    const values = rect.asArray().map((value) => context.lookup(value));
    if (!values.every((value) => value instanceof PDFNumber)) continue;
    const [x1, y1, x2, y2] = values.map((value) => value.asNumber());
    annot.set(name('Rect'), context.obj([x1, y1 + shift, x2, y2 + shift]));
  }
}
