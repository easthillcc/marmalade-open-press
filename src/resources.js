// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFDict, PDFStream } from 'pdf-lib';
import { name } from './pdf.js';

/** The resources that name something with resources of their own: forms, tiling patterns and Type 3 fonts. */
const NESTING = ['XObject', 'Pattern', 'Font'];

/**
 * Lists every resources dictionary a page is painted with. A form, pattern or Type 3 font can name
 * its own resources, and those can name more, so the walk goes as deep as the file goes. The
 * `found` set is what ends a loop: a form whose resources point back at an ancestor is visited once.
 * @param {import('pdf-lib').PDFPage} page
 * @returns {PDFDict[]} Every resources dictionary, the page's own first, then in order of first visit.
 */
export function pageResources(page) {
  const context = page.doc.context;
  const found = new Set();

  /**
   * @param {import('pdf-lib').PDFObject | undefined} resources
   */
  const visit = (resources) => {
    if (!(resources instanceof PDFDict) || found.has(resources)) return;
    found.add(resources);
    for (const kind of NESTING) {
      for (const entry of entriesOf(resources, kind)) {
        const dict = dictOf(context.lookup(entry));
        if (dict) visit(dict.lookup(name('Resources')));
      }
    }
  };

  visit(page.node.Resources());
  return [...found];
}

/**
 * The values of one resource category. The references are not followed, so the caller decides
 * whether to resolve them: a category may hold a reference to an object shared with other pages.
 * @param {PDFDict} resources
 * @param {string} kind  A resource category, such as 'XObject' or 'ExtGState'.
 * @returns {import('pdf-lib').PDFObject[]} The values of that category; none when it is absent or not a dictionary.
 */
export function entriesOf(resources, kind) {
  const entries = resources.lookup(name(kind));
  return entries instanceof PDFDict ? entries.values() : [];
}

/**
 * Streams keep their dictionary one level down, so both a stream and a plain dictionary are
 * accepted here. Anything else, including a missing object, has no dictionary to read.
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @returns {PDFDict | undefined} The dictionary of a stream, the dictionary itself, or undefined.
 */
export function dictOf(object) {
  if (object instanceof PDFStream) return object.dict;
  if (object instanceof PDFDict) return object;
  return undefined;
}

/**
 * A page without a font has no text, so this answers whether the page can paint any. An empty
 * /Font dictionary counts as no font.
 * @param {import('pdf-lib').PDFPage} page
 * @returns {boolean} True when the page, or anything it paints, names a font.
 */
export function hasFonts(page) {
  return pageResources(page).some((resources) => entriesOf(resources, 'Font').length > 0);
}

/**
 * Lists the image XObjects a page names, directly or through a form. One image can be named under
 * several names or on several forms; the set keeps it once, since it is one object in the file.
 * @param {import('pdf-lib').PDFPage} page
 * @returns {PDFStream[]} Each image the page names, once.
 */
export function pageImages(page) {
  const context = page.doc.context;
  const images = new Set();
  for (const resources of pageResources(page)) {
    for (const entry of entriesOf(resources, 'XObject')) {
      const object = context.lookup(entry);
      if (object instanceof PDFStream && object.dict.get(name('Subtype')) === name('Image')) {
        images.add(object);
      }
    }
  }
  return [...images];
}
