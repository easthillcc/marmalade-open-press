// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { ghostscriptIn } from './ghostscript.js';

// The page files that Ghostscript writes for tiff32nc, as named by the -sOutputFile pattern in tiffArgs.
const PAGE_FILE = /^page-([0-9]+)[.]tif$/;

/**
 * The arguments that make Ghostscript draw every page of a PDF as a CMYK TIFF.
 * The file names are those toTiffPages() writes in the scratch folder.
 * @param {number} dpi  The resolution of the pages.
 * @returns {string[]} The arguments, in the order Ghostscript reads them.
 */
export function tiffArgs(dpi) {
  return [
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sDEVICE=tiff32nc',
    `-r${dpi}`,
    '-sCompression=lzw',
    // Without this the edges of letters are stairs. Shapes are not smoothed: smoothing leaves a pale seam where two shapes of one colour meet.
    '-dTextAlphaBits=4',
    // The same profile on both sides: the inks of the PDF are the inks of the pixels, and the TIFF embeds the profile.
    '--permit-file-read=profile.icc',
    '-sDefaultCMYKProfile=profile.icc',
    '-sOutputICCProfile=profile.icc',
    '-sOutputFile=page-%d.tif',
    'input.pdf',
  ];
}

/**
 * Draws every page of a CMYK PDF as a TIFF: four inks, 8 bits each, LZW compressed, the profile embedded.
 * @param {Uint8Array} pdf  The CMYK PDF.
 * @param {{profile: Uint8Array, dpi: number}} options  The output profile's bytes, and the resolution.
 * @returns {Promise<Buffer[]>} One TIFF per page, in page order.
 */
export async function toTiffPages(pdf, { profile, dpi }) {
  const collect = async (folder) => {
    const pages = [];
    for (const name of await readdir(folder)) {
      const match = PAGE_FILE.exec(name);
      if (match) pages.push({ name, number: Number(match[1]) });
    }
    // Sorted as numbers: as text, page-10.tif would come before page-2.tif.
    pages.sort((a, b) => a.number - b.number);
    return Promise.all(pages.map((page) => readFile(join(folder, page.name))));
  };
  return ghostscriptIn({ 'input.pdf': pdf, 'profile.icc': profile }, tiffArgs(dpi), collect);
}

/** TIFF tag 305, Software: the program that wrote the image. */
const SOFTWARE_TAG = 305;

/** TIFF field type 2, ASCII text. */
const ASCII = 2;

/**
 * Names a program in a page's Software tag, in place of the one Ghostscript wrote.
 * The text is appended to the file and the tag points to it; the pixels are not touched.
 * A page whose first image has no Software tag is returned unchanged.
 * @param {Buffer} tiff  One TIFF page, as Ghostscript wrote it.
 * @param {string} software  The text, such as 'Marmalade Open Press 1.0.1 (https://marmalade.family), with Ghostscript 10.06.0'.
 * @returns {Buffer} The page with the new Software tag.
 */
export function withSoftware(tiff, software) {
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const ifd = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (u16(entry) !== SOFTWARE_TAG) continue;
    const text = Buffer.from(`${software}\0`, 'latin1');
    // A value longer than four bytes starts on a word boundary.
    const start = tiff.length + (tiff.length % 2);
    const out = Buffer.concat([tiff, Buffer.alloc(start - tiff.length), text]);
    if (little) {
      out.writeUInt16LE(ASCII, entry + 2);
      out.writeUInt32LE(text.length, entry + 4);
      out.writeUInt32LE(start, entry + 8);
    } else {
      out.writeUInt16BE(ASCII, entry + 2);
      out.writeUInt32BE(text.length, entry + 4);
      out.writeUInt32BE(start, entry + 8);
    }
    return out;
  }
  return tiff;
}

/**
 * The file names of the pages: the page number goes before the extension, from 1.
 * @param {string} output  The output path, such as 'out/poster.tif'.
 * @param {number} count  How many pages.
 * @returns {string[]} The names, such as ['out/poster-1.tif', 'out/poster-2.tif'].
 */
export function numberedNames(output, count) {
  const extension = extname(output);
  const stem = output.slice(0, output.length - extension.length);
  return Array.from({ length: count }, (_, index) => `${stem}-${index + 1}${extension}`);
}
