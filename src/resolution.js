// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { tokenize } from './content.js';
import { name, readStream } from './pdf.js';

/**
 * An image at the size it is placed: its resolution in pixels per inch, its object number, and its page, from 1.
 * @typedef {{ppi: number, image: number, page: number}} Resolution
 */

/** A PDF matrix [a b c d e f]. @typedef {number[]} Matrix */

/** What a walk calls for every image it meets. @typedef {(ppi: number, image: number) => void} Visit */

/** @type {Matrix} */
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Forms inside forms are followed this deep, which no real page reaches; a loop of forms stops here too. */
const MAX_DEPTH = 8;

/**
 * The image with the lowest resolution at the size it is placed, on any page. An image drawn at two sizes counts at
 * the larger one, where it has fewer pixels per inch. Images on the pages and in the forms they draw are measured;
 * images in patterns are not.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Resolution | null}  null when no image is drawn.
 */
export function lowestResolution(doc) {
  let lowest = null;
  doc.getPages().forEach((page, index) => {
    const visit = (ppi, image) => {
      if (lowest === null || ppi < lowest.ppi) lowest = { ppi, image, page: index + 1 };
    };
    walk(doc.context, pageSource(doc.context, page), page.node.Resources(), IDENTITY, visit, 0);
  });
  return lowest;
}

/**
 * The page's content streams as one source, because the graphics state carries on from one stream to the next.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFPage} page
 * @returns {string}
 */
function pageSource(context, page) {
  const contents = page.node.get(name('Contents'));
  const looked = context.lookup(contents);
  const refs = looked instanceof PDFArray ? looked.asArray() : [contents];
  return refs
    .map((ref) => context.lookup(ref))
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => readStream(stream).toString('latin1'))
    .join('\n');
}

/**
 * Follows the current matrix through q, Q and cm, and measures every image that Do draws.
 * @param {import('pdf-lib').PDFContext} context
 * @param {string} source  A content stream, latin1.
 * @param {PDFDict | undefined} resources  What its names point at.
 * @param {Matrix} start  The matrix the stream is drawn under.
 * @param {Visit} visit
 * @param {number} depth  How many forms deep this stream is.
 * @returns {void}
 */
function walk(context, source, resources, start, visit, depth) {
  let ctm = start;
  const saved = [];
  let operands = [];
  for (const token of tokenize(source)) {
    const text = source.slice(token.start, token.end);
    if (token.type !== 'operator') {
      operands.push(text);
      continue;
    }
    // An inline image's data cannot be tokenized safely, so the rest of this stream is not read.
    if (text === 'BI') return;
    if (text === 'q') saved.push(ctm);
    if (text === 'Q') ctm = saved.pop() ?? ctm;
    if (text === 'cm') ctm = concat(operands, ctm);
    if (text === 'Do' && operands.length === 1 && operands[0].startsWith('/')) {
      drawObject(context, operands[0].slice(1), resources, ctm, visit, depth);
    }
    operands = [];
  }
}

/**
 * @param {string[]} operands  The operands of a cm.
 * @param {Matrix} ctm
 * @returns {Matrix}  The new current matrix, or the old one when the operands are not six numbers.
 */
function concat(operands, ctm) {
  const matrix = operands.map(Number);
  return matrix.length === 6 && matrix.every(Number.isFinite) ? multiply(matrix, ctm) : ctm;
}

/**
 * Measures an image, or walks a form with its Matrix and its own resources (or, without them, the ones it inherits).
 * @param {import('pdf-lib').PDFContext} context
 * @param {string} key  The XObject's name, without its slash.
 * @param {PDFDict | undefined} resources
 * @param {Matrix} ctm
 * @param {Visit} visit
 * @param {number} depth
 * @returns {void}
 */
function drawObject(context, key, resources, ctm, visit, depth) {
  const ref = resources?.lookupMaybe(name('XObject'), PDFDict)?.get(name(key));
  const object = context.lookup(ref);
  if (!(object instanceof PDFRawStream)) return;
  const subtype = object.dict.get(name('Subtype'));
  if (subtype === name('Image') && ref instanceof PDFRef) {
    const ppi = placedPpi(object.dict, ctm);
    if (ppi !== null) visit(ppi, ref.objectNumber);
  } else if (subtype === name('Form') && depth < MAX_DEPTH) {
    const matrix = matrixOf(object.dict.lookup(name('Matrix'))) ?? IDENTITY;
    const own = object.dict.lookupMaybe(name('Resources'), PDFDict) ?? resources;
    walk(context, readStream(object).toString('latin1'), own, multiply(matrix, ctm), visit, depth + 1);
  }
}

/**
 * An image fills the unit square, so the matrix's two columns are its sides on the page, in points, however it is
 * turned or flipped. The lower of the two directions is the one that prints.
 * @param {PDFDict} dict  The image's dictionary.
 * @param {Matrix} ctm
 * @returns {number | null}  Pixels per inch, or null when the image has no size or is drawn at no size.
 */
function placedPpi(dict, ctm) {
  const width = dict.lookup(name('Width'));
  const height = dict.lookup(name('Height'));
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return null;
  const [a, b, c, d] = ctm;
  const across = Math.hypot(a, b) / 72;
  const down = Math.hypot(c, d) / 72;
  if (across === 0 || down === 0) return null;
  return Math.min(width.asNumber() / across, height.asNumber() / down);
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @returns {Matrix | null}  Six numbers, or null when the object is not a matrix.
 */
function matrixOf(object) {
  if (!(object instanceof PDFArray) || object.size() !== 6) return null;
  const items = object.asArray();
  return items.every((item) => item instanceof PDFNumber) ? items.map((item) => item.asNumber()) : null;
}

/**
 * m then n, in PDF's order: a point is transformed by m first, as cm does to the current matrix.
 * @param {Matrix} m
 * @param {Matrix} n
 * @returns {Matrix}
 */
function multiply([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}
