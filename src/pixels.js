// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFNumber } from 'pdf-lib';
import { name } from './pdf.js';
import { hasFonts, pageImages } from './resources.js';

/**
 * What flattening did to one page.
 * @typedef {object} PagePixels
 * @property {number} page         The page number, from 1.
 * @property {boolean} flattened   The page used transparency and is now an image, with no text.
 * @property {number} share        The part of the page that image covers, from 0 to 1. 0 when the page is not flattened.
 * @property {boolean} textLost    The page had text, and has none now: its letters are pixels.
 * @property {number} imagesAdded  How many images Ghostscript drew: on a flattened page every image it now names, otherwise how many more images the page names than before. Never below 0.
 */

/**
 * Compares a PDF before and after Ghostscript, page by page, to say what became pixels.
 * Ghostscript draws a page that uses transparency as one image, so a page is called flattened
 * only when it had transparency, now has no text and now has an image. The other pages come
 * back as they were, and the comparison says so rather than guessing.
 * @param {import('pdf-lib').PDFDocument} before  The PDF/X-4.
 * @param {import('pdf-lib').PDFDocument} after   What Ghostscript wrote from it.
 * @param {{dpi: number, transparency: import('./transparency.js').PageTransparency[]}} facts  The resolution Ghostscript was given for flattened pages, and what findTransparency said of the PDF/X-4: one entry per page, { page, kinds }, kinds empty when the page has no transparency.
 * @returns {PagePixels[]} One entry for every page, in page order.
 */
export function comparePages(before, after, { dpi, transparency }) {
  const pagesBefore = before.getPages();
  const pagesAfter = after.getPages();
  if (pagesAfter.length !== pagesBefore.length) {
    throw new Error(`Ghostscript wrote ${pagesAfter.length} page(s) where ${pagesBefore.length} were expected.`);
  }

  return pagesAfter.map((pageAfter, index) => {
    const hasTextAfter = hasFonts(pageAfter);
    const imagesAfter = pageImages(pageAfter);
    const flattened = transparency[index].kinds.length > 0 && !hasTextAfter && imagesAfter.length > 0;
    return {
      page: index + 1,
      flattened,
      share: flattened ? pageShare(pageAfter, imagesAfter, dpi) : 0,
      textLost: hasFonts(pagesBefore[index]) && !hasTextAfter,
      imagesAdded: flattened ? imagesAfter.length : Math.max(0, imagesAfter.length - pageImages(pagesBefore[index]).length),
    };
  });
}

/**
 * How much of the page its images cover when each pixel is one dot at the given resolution.
 * This is how Ghostscript places the image of a flattened page, so the share is measured the
 * same way rather than from the page's own drawing.
 * @param {import('pdf-lib').PDFPage} page
 * @param {import('pdf-lib').PDFStream[]} images
 * @param {number} dpi
 * @returns {number} From 0 to 1.
 */
function pageShare(page, images, dpi) {
  // One pixel is 72 / dpi points wide, so a pixel count turns into a size on the page this way.
  const point = 72 / dpi;
  const { width, height } = page.getMediaBox();
  const placed = images.reduce((sum, image) => sum + pixels(image, 'Width') * point * (pixels(image, 'Height') * point), 0);
  return Math.min(1, placed / (width * height));
}

/**
 * The size of an image in pixels. An image that does not say its size counts as 0, so it
 * adds nothing to the share rather than stopping the comparison.
 * @param {import('pdf-lib').PDFStream} image
 * @param {'Width' | 'Height'} key
 * @returns {number} That size in pixels, or 0 when the image does not say.
 */
function pixels(image, key) {
  const value = image.dict.lookup(name(key));
  return value instanceof PDFNumber ? value.asNumber() : 0;
}
