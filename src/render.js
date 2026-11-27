// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { exactPageBoxes } from './exactboxes.js';
import { readPageSize } from './pagerule.js';
import { defaultPageCss, namesPageSize, parsePageSize } from './pagesize.js';
import { VERSION } from './version.js';

/**
 * @typedef {object} RenderOptions
 * @property {number} [bleed]  Millimetres added on every side of the A5 page that a page without a size of its own is
 *   printed on. Default 0. A page that names its own size keeps it, because its bleed is already part of it.
 */

/**
 * Works out what Chromium should open for an input.
 *
 * @param {string} input An HTML file path, a URL, or HTML markup.
 * @returns {string | null} The address Chromium opens, or null when the input is markup.
 */
export function inputUrl(input) {
  if (input.trimStart().startsWith('<')) return null;
  if (/^(https?|file):\/\//i.test(input)) return input;
  return pathToFileURL(resolve(input)).href;
}

/**
 * Prints an HTML page to an RGB PDF with Chromium, at exactly the size its @page rule asks for. A page that names no
 * size is printed on A5, plus the bleed on every side.
 *
 * @param {string} input An HTML file path, a URL, or HTML markup.
 * @param {RenderOptions} [options]
 * @returns {Promise<Uint8Array>} An RGB PDF.
 */
export async function render(input, options = {}) {
  const { bleed = 0 } = options;
  if (typeof bleed !== 'number' || !Number.isFinite(bleed) || bleed < 0) {
    throw new Error('The bleed is a size in millimetres, 0 or more.');
  }
  const url = inputUrl(input);
  if (url !== null && url.startsWith('file:')) {
    // Chromium's own error for a missing file is not worth showing a person, so check first.
    await access(new URL(url)).catch(() => {
      throw new Error(`Cannot read ${input}.`);
    });
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 'networkidle' so images and web fonts have arrived before the page is printed.
    if (url !== null) {
      await page.goto(url, { waitUntil: 'networkidle' });
    } else {
      await page.setContent(input, { waitUntil: 'networkidle' });
    }
    return await withCreator(await printAtSize(page, bleed));
  } finally {
    await browser.close();
  }
}

/**
 * Names this tool as the Creator of a page it drew, next to Chromium, which did the drawing.
 * convert copies the Creator into the XMP as xmp:CreatorTool, so both places agree.
 * @param {Uint8Array} pdf  The PDF Chromium wrote.
 * @returns {Promise<Uint8Array>} The same PDF with the new Creator.
 */
async function withCreator(pdf) {
  // Chromium's title and dates are kept, which is why updateMetadata is off.
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  doc.setCreator(`Marmalade Open Press ${VERSION}, with Chromium`);
  return doc.save();
}

/**
 * Paints the canvas colour under the whole page. Chromium paints the root background only over its layout viewport,
 * which it rounds to whole CSS pixels, so a page whose size is not a whole number of pixels can leave a strip of up
 * to half a pixel unpainted on the right or bottom edge. The content is not moved or scaled; only the strip is filled.
 *
 * A fixed element repeats on every printed page, paints just above the canvas and under everything else, and Chromium
 * clips it to the exact page, so it fills the rounded-off strip with the same colour. A custom element name keeps
 * author rules such as `div { ... }` off it. It is prepended, not appended: an appended element would make a blank
 * last page when the last element has break-after: page.
 *
 * @param {import('playwright').Page} page  A page that has loaded.
 * @returns {Promise<[number, number, number] | null>}  The canvas colour as RGB from 0 to 1, for exactPageBoxes to
 *   paint out to the exact edge, or null when there is none or it is not an opaque rgb() colour.
 */
async function underlayCanvas(page) {
  return page.evaluate(() => {
    const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent'];
    const root = getComputedStyle(document.documentElement);
    const rootPaints = !TRANSPARENT.includes(root.backgroundColor) || root.backgroundImage !== 'none';
    // The root's background is the canvas. Without one, CSS takes the body's background as the canvas colour.
    let colour = root.backgroundColor;
    if (!rootPaints && document.body) colour = getComputedStyle(document.body).backgroundColor;
    if (TRANSPARENT.includes(colour)) return null;
    const el = document.createElement('open-press-underlay');
    el.style.setProperty('all', 'initial', 'important');
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('inset', '-2px', 'important');
    el.style.setProperty('background-color', colour, 'important');
    el.style.setProperty('z-index', '-2147483647', 'important');
    document.documentElement.prepend(el);
    // A computed sRGB colour reads as rgb() or rgba(). Any other notation, or a colour that is not opaque, is left
    // to the underlay alone.
    const match = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(colour);
    if (match === null || (match[4] !== undefined && Number(match[4]) < 1)) return null;
    return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
  });
}

/**
 * Prints the page at the size its @page rule asks for, or on A5 plus the bleed, and makes the page boxes exact:
 * Chromium rounds a page size to whole points, and exactPageBoxes puts back the size that was asked for. The canvas
 * colour is laid under the page first (see underlayCanvas), so the exact edge is painted too.
 * @param {import('playwright').Page} page  A page that has loaded.
 * @param {number} bleed  Millimetres.
 * @returns {Promise<Uint8Array>}
 */
async function printAtSize(page, bleed) {
  const canvas = await underlayCanvas(page);
  // Backgrounds are kept. A5 is only Chromium's fallback, for a page whose stylesheets could not all be read.
  const print = () => page.pdf({ preferCSSPageSize: true, format: 'A5', printBackground: true });
  const named = await readPageSize(page);
  // A stylesheet that could not be read may set the size, so nothing is assumed and Chromium's own size stands.
  if (named === null) return print();
  const css = namesPageSize(named) ? named : defaultPageCss(named, bleed);
  if (css !== named) await page.addStyleTag({ content: `@page { size: ${css} }` });
  const size = parsePageSize(css);
  const pdf = await print();
  return size === null ? pdf : exactPageBoxes(pdf, size, canvas);
}
