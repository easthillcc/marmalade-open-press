// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFDocument } from 'pdf-lib';
import { readFacts } from './facts.js';
import { flatten } from './flatten.js';
import { GHOSTSCRIPT_MISSING, ghostscriptVersion } from './ghostscript.js';
import { asPdf13 } from './pdfx.js';
import { dressAsPdfX13 } from './pdfx13.js';
import { comparePages } from './pixels.js';
import { toTiffPages, withSoftware } from './tiff.js';
import { transparencyIn } from './transparency.js';
import { PRODUCER } from './version.js';

/** @typedef {'x4' | 'x1a' | 'x3' | 'tiff'} Format */

/** The formats exportAs writes. x4 is what convert returns, and the only one that needs no Ghostscript. @type {Format[]} */
export const FORMATS = ['x4', 'x1a', 'x3', 'tiff'];

/** The resolution of TIFF pages and of flattened pages, unless another is asked for. @type {number} */
export const DEFAULT_DPI = 300;

/** The lowest and highest resolutions accepted. Below, a page is a blur; above, a file nobody can open. */
export const MIN_DPI = 72;
export const MAX_DPI = 2400;

/**
 * @typedef {object} ExportReport
 * @property {Format} format
 * @property {number} pages                 How many pages the PDF/X-4 has.
 * @property {number | null} dpi            The resolution used. null for x4, where nothing becomes pixels.
 * @property {string | null} ghostscript    The version of Ghostscript that did the work. null for x4.
 * @property {import('./transparency.js').PageTransparency[]} transparency  Where the PDF/X-4 uses transparency.
 * @property {import('./pixels.js').PagePixels[]} pixels  What flattening did, for x1a and x3. Empty otherwise.
 */

/**
 * Writes the PDF/X-4 that convert returned in another format.
 * x1a and x3 give one PDF 1.3 file with its transparency flattened. tiff gives one CMYK TIFF per page.
 * x4 gives the same bytes back. Every format but x4 needs Ghostscript on the machine.
 * @param {Uint8Array} pdfX4
 * @param {Format} [format]
 * @param {{dpi?: number}} [options]
 * @returns {Promise<{files: Uint8Array[], report: ExportReport}>}
 */
export async function exportAs(pdfX4, format = 'x4', options = {}) {
  // The checks come first, so a bad format or resolution is refused before any PDF is read.
  const { dpi = DEFAULT_DPI } = options;
  if (!FORMATS.includes(format)) {
    throw new Error(`The format is one of ${FORMATS.join(', ')}.`);
  }
  if (typeof dpi !== 'number' || !Number.isFinite(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    throw new Error(`The resolution is a number of dots per inch from ${MIN_DPI} to ${MAX_DPI}, such as ${DEFAULT_DPI}.`);
  }

  const source = await PDFDocument.load(pdfX4, { updateMetadata: false });
  const report = {
    format,
    pages: source.getPageCount(),
    dpi: null,
    ghostscript: null,
    transparency: transparencyIn(source),
    pixels: [],
  };

  // x4 is what convert already wrote: nothing to do, and no Ghostscript needed.
  if (format === 'x4') return { files: [pdfX4], report };

  // Read the facts before looking for Ghostscript, so a PDF that convert did not write is refused as such on every machine.
  const facts = readFacts(source);
  const ghostscript = await ghostscriptVersion();
  if (ghostscript === null) throw new Error(GHOSTSCRIPT_MISSING);
  Object.assign(report, { dpi, ghostscript });

  if (format === 'tiff') {
    // pixels stays empty: a TIFF is pixels by nature.
    const pages = await toTiffPages(pdfX4, { profile: facts.profile.bytes, dpi });
    const software = `${PRODUCER}, with Ghostscript ${ghostscript}`;
    return { files: pages.map((page) => withSoftware(page, software)), report };
  }

  const flat = await PDFDocument.load(await flatten(pdfX4, format, { profile: facts.profile.bytes, dpi }), { updateMetadata: false });
  // Compare before dressing: the comparison reads the file as Ghostscript wrote it.
  report.pixels = comparePages(source, flat, { dpi, transparency: report.transparency });
  dressAsPdfX13(flat, format, facts);
  // PDF 1.3 has no object streams, so pdf-lib must not write any.
  return { files: [asPdf13(await flat.save({ useObjectStreams: false }))], report };
}
