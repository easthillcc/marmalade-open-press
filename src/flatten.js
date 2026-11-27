// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ghostscriptIn } from './ghostscript.js';

/** The number Ghostscript knows each standard by. */
const PDFX_LEVEL = { x1a: 1, x3: 3 };

/**
 * The arguments that make Ghostscript rewrite a PDF/X-4 as PDF 1.3 without transparency.
 * The file names are those flatten() writes in the scratch folder.
 * @param {'x1a' | 'x3'} format  The standard to write: PDF/X-1a:2001 or PDF/X-3:2002.
 * @param {number} dpi  The resolution of a page that has to become an image.
 * @returns {string[]} The arguments, in the order Ghostscript reads them.
 */
export function pdfwriteArgs(format, dpi) {
  return [
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    `-dPDFX=${PDFX_LEVEL[format]}`,
    '-dCompatibilityLevel=1.3',
    '-sColorConversionStrategy=CMYK',
    '-dPDFSETTINGS=/prepress',
    // /prepress would copy Ghostscript's own black generation and undercolour removal into the file. They mean nothing to CMYK and preflight asks about them.
    '-dUCRandBGInfo=/Remove',
    `-r${dpi}`,
    '-dAutoRotatePages=/None',
    // /prepress would recompress photographs as JPEG and resample the large ones. The pixels stay as they are.
    '-dAutoFilterColorImages=false',
    '-dColorImageFilter=/FlateEncode',
    '-dAutoFilterGrayImages=false',
    '-dGrayImageFilter=/FlateEncode',
    '-dDownsampleColorImages=false',
    '-dDownsampleGrayImages=false',
    '-dDownsampleMonoImages=false',
    // The same profile on both sides: CMYK goes through untouched, so a black stays on the black plate.
    // With the output profile alone, Ghostscript would separate every colour again.
    '--permit-file-read=profile.icc',
    '-sDefaultCMYKProfile=profile.icc',
    '-sOutputICCProfile=profile.icc',
    '-sOutputFile=output.pdf',
    'input.pdf',
  ];
}

/**
 * Rewrites a PDF/X-4 as PDF 1.3 with Ghostscript. A page that uses transparency comes back as one image;
 * the other pages keep their text and vectors. The result still needs dressAsPdfX13.
 * @param {Uint8Array} pdfX4  The PDF/X-4 that convert() returned.
 * @param {'x1a' | 'x3'} format  The standard to write.
 * @param {{profile: Uint8Array, dpi: number}} options  The output profile's bytes, and the resolution.
 * @returns {Promise<Buffer>} The PDF as Ghostscript wrote it.
 */
export async function flatten(pdfX4, format, { profile, dpi }) {
  // Object.hasOwn, not the in operator, so that a name such as toString is refused too.
  if (!Object.hasOwn(PDFX_LEVEL, format)) throw new Error('Only x1a and x3 are flattened.');
  return ghostscriptIn(
    { 'input.pdf': pdfX4, 'profile.icc': profile },
    pdfwriteArgs(format, dpi),
    (folder) => readFile(join(folder, 'output.pdf')),
  );
}
