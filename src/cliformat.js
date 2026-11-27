// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { writeFile } from 'node:fs/promises';
import { FORMATS, MAX_DPI, MIN_DPI } from './export.js';
import { GHOSTSCRIPT_MISSING, ghostscriptVersion } from './ghostscript.js';
import { numberedNames } from './tiff.js';

/** A TIFF goes by .tif or .tiff, in either case. */
const TIFF_NAME = /[.]tiff?$/i;

/**
 * Reads --format and --dpi, and checks them against the output name and the machine.
 * It runs before anything is rendered, so a bad value or a missing Ghostscript costs no time.
 *
 * @param {{format?: string, dpi?: string}} values  The flags, as parseArgs returns them.
 * @param {string} output  The output path given on the command line.
 * @returns {Promise<{format: import('./export.js').Format, dpi: number | undefined}>}
 *   dpi is undefined when --dpi was not given, so that exportAs uses its own default.
 */
export async function readFormat(values, output) {
  const format = values.format === undefined ? 'x4' : parseFormat(values.format);
  const dpi = values.dpi === undefined ? undefined : parseDpi(values.dpi);

  // x4 is convert's own output, so a resolution has nothing to apply to.
  if (format === 'x4' && dpi !== undefined) {
    throw new Error('--dpi goes with --format x1a, x3 or tiff.');
  }
  // A TIFF is written under numbered names, so the output must read as a .tif name.
  if (format === 'tiff' && !TIFF_NAME.test(output)) {
    throw new Error('With --format tiff the output is a .tif name, such as poster.tif.');
  }
  // Only x4 is built without Ghostscript, so every other format checks for it before rendering.
  if (format !== 'x4' && (await ghostscriptVersion()) === null) {
    throw new Error(GHOSTSCRIPT_MISSING);
  }
  return { format, dpi };
}

/**
 * Writes the files of a format other than PDF/X-4, and says what was written.
 * A PDF goes to the output path. TIFF pages go to numbered names beside it.
 *
 * @param {string} output  The output path given on the command line.
 * @param {Uint8Array[]} files  One PDF, or one TIFF per page.
 * @param {import('./export.js').Format} format
 * @returns {Promise<string>}  The line for the console, such as 'Wrote poster.pdf.'.
 */
export async function writeExport(output, files, format) {
  if (format !== 'tiff') {
    await writeFile(output, files[0]);
    return `Wrote ${output}.`;
  }

  // Every page is numbered, even a single one, so that a later run with more pages
  // never mixes a bare name with numbered ones.
  const names = numberedNames(output, files.length);
  for (const [index, fileName] of names.entries()) {
    await writeFile(fileName, files[index]);
  }
  if (names.length === 1) return `Wrote ${names[0]}.`;
  return `Wrote ${names.length} pages, ${names[0]} to ${names[names.length - 1]}.`;
}

/**
 * Reads --format, which must be exactly one of FORMATS.
 * The match is exact, so a capital letter or an empty value is refused.
 *
 * @param {string} text  The value of --format.
 * @returns {import('./export.js').Format}  The format, unchanged.
 * @throws {Error} When the text is not one of the formats.
 */
function parseFormat(text) {
  if (!FORMATS.includes(text)) {
    throw new Error(`--format takes one of ${FORMATS.join(', ')}.`);
  }
  return text;
}

/**
 * Reads --dpi as a resolution in dots per inch, within MIN_DPI to MAX_DPI.
 * Below the range a page is a blur; above it, a file nobody can open.
 *
 * @param {string} text  The value of --dpi.
 * @returns {number}  The resolution.
 * @throws {Error} When the text is empty, not a number, or outside the range.
 */
function parseDpi(text) {
  const dpi = Number(text);
  // Number('') is 0, which is below the range anyway, but an empty value is named apart
  // so that the check reads as what it is.
  if (text.trim() === '' || !Number.isFinite(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    throw new Error(`--dpi takes a resolution in dots per inch from ${MIN_DPI} to ${MAX_DPI}, such as 300.`);
  }
  return dpi;
}
