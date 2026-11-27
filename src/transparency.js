// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFDocument, PDFNumber, PDFStream } from 'pdf-lib';
import { name } from './pdf.js';
import { dictOf, entriesOf, pageResources } from './resources.js';

/** @typedef {'opacity' | 'blend mode' | 'soft mask' | 'transparency group'} TransparencyKind */

/**
 * @typedef {object} PageTransparency
 * @property {number} page               The page number, from 1.
 * @property {TransparencyKind[]} kinds  What the page uses, in the order of KINDS. Empty when it uses none.
 */

/** The order in which the kinds are listed. @type {TransparencyKind[]} */
const KINDS = ['opacity', 'blend mode', 'soft mask', 'transparency group'];

/**
 * Says where a PDF uses transparency, page by page. Useful before choosing a format: PDF/X-1a and
 * PDF/X-3 cannot carry transparency, so the answer says what a flattening step would have to handle.
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<PageTransparency[]>} One entry for every page, in page order.
 */
export async function findTransparency(pdfBytes) {
  return transparencyIn(await PDFDocument.load(pdfBytes, { updateMetadata: false }));
}

/**
 * The same as findTransparency, for a document that is already loaded. The page's own resources
 * and everything nested in them are read, because Ghostscript flattens by what a page names, not
 * only by what it paints.
 * @param {PDFDocument} doc
 * @returns {PageTransparency[]} One entry for every page, in page order.
 */
export function transparencyIn(doc) {
  return doc.getPages().map((page, index) => {
    const used = new Set();
    for (const resources of pageResources(page)) {
      for (const kind of kindsInResources(doc, resources)) used.add(kind);
    }
    return { page: index + 1, kinds: KINDS.filter((kind) => used.has(kind)) };
  });
}

/**
 * The kinds one resources dictionary names, in no particular order. The categories are read on
 * their own, so a resources dictionary with both graphics states and XObjects reports both.
 * @param {PDFDocument} doc
 * @param {PDFDict} resources
 * @returns {TransparencyKind[]} The kinds named, possibly repeated.
 */
function kindsInResources(doc, resources) {
  const kinds = [];
  for (const entry of entriesOf(resources, 'ExtGState')) {
    kinds.push(...kindsOfGraphicsState(doc, entry));
  }
  for (const entry of entriesOf(resources, 'XObject')) {
    kinds.push(...kindsOfXObject(doc, entry));
  }
  return kinds;
}

/**
 * The kinds one graphics state names. A state that is not a dictionary has nothing to say.
 * @param {PDFDocument} doc
 * @param {import('pdf-lib').PDFObject} entry  The value of the ExtGState entry, possibly a reference.
 * @returns {TransparencyKind[]}
 */
function kindsOfGraphicsState(doc, entry) {
  const state = dictOf(doc.context.lookup(entry));
  if (state === undefined) return [];
  const kinds = [];
  if (hasOpacity(state)) kinds.push('opacity');
  if (hasBlendMode(state)) kinds.push('blend mode');
  // /SMask /None switches a mask off and is a name, not a dictionary, so only a real mask counts.
  if (state.lookup(name('SMask')) instanceof PDFDict) kinds.push('soft mask');
  return kinds;
}

/**
 * An opacity is either the fill (ca) or the stroke (CA). Only a value other than 1 is
 * transparency: an opacity of exactly 1 paints as opaque.
 * @param {PDFDict} state
 * @returns {boolean}
 */
function hasOpacity(state) {
  return ['ca', 'CA'].some((key) => {
    const value = state.lookup(name(key));
    return value instanceof PDFNumber && value.asNumber() !== 1;
  });
}

/**
 * A blend mode can be a single name or an array of names, tried in order. The first name is the
 * one in use. Normal and Compatible both paint as plain source-over, so neither is transparency.
 * @param {PDFDict} state
 * @returns {boolean}
 */
function hasBlendMode(state) {
  const value = state.lookup(name('BM'));
  const mode = value instanceof PDFArray ? value.lookup(0) : value;
  return mode !== undefined && mode !== name('Normal') && mode !== name('Compatible');
}

/**
 * The kinds one XObject names. An image is transparent only through a mask. A form is transparent
 * when it is a group, since a group is composited as a unit. Anything else is not read.
 * @param {PDFDocument} doc
 * @param {import('pdf-lib').PDFObject} entry  The value of the XObject entry, possibly a reference.
 * @returns {TransparencyKind[]}
 */
function kindsOfXObject(doc, entry) {
  const xobject = dictOf(doc.context.lookup(entry));
  if (xobject === undefined) return [];
  if (xobject.get(name('Subtype')) === name('Image')) {
    return hasImageMask(xobject) ? ['soft mask'] : [];
  }
  return xobject.lookup(name('Group')) instanceof PDFDict ? ['transparency group'] : [];
}

/**
 * An image masks itself with a separate image (SMask), or with the alpha band in its own data
 * (SMaskInData, where any value other than 0 turns it on).
 * @param {PDFDict} xobject
 * @returns {boolean}
 */
function hasImageMask(xobject) {
  if (xobject.lookup(name('SMask')) instanceof PDFStream) return true;
  const inData = xobject.lookup(name('SMaskInData'));
  return inData instanceof PDFNumber && inData.asNumber() !== 0;
}
