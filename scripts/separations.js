#!/usr/bin/env node
// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const images = join(root, 'docs', 'images');
const defaultPdf = join(root, 'examples', 'poster.pdf');
const DPI = 300;

// The grey kicker line and the heading of the example poster, in millimetres from the top left corner of page 1.
const CROP_MM = { left: 10, top: 10, width: 115, height: 27 };

/**
 * @param {number} mm
 * @returns {number} the length in pixels at the plate resolution
 */
function millimetresToPixels(mm) {
  return Math.round((mm / 25.4) * DPI);
}

const CROP = Object.fromEntries(
  Object.entries(CROP_MM).map(([name, mm]) => [name, millimetresToPixels(mm)]),
);

/**
 * Asks Ghostscript for one grey TIFF per ink of page 1. Ghostscript writes page(Cyan).tif and so on.
 * @param {string} pdf
 * @param {string} scratch folder for the TIFF files
 */
async function separate(pdf, scratch) {
  try {
    await execute('gs', [
      '-q',
      '-dNOPAUSE',
      '-dBATCH',
      '-dFirstPage=1',
      '-dLastPage=1',
      '-sDEVICE=tiffsep',
      `-r${DPI}`,
      `-sOutputFile=${join(scratch, 'page.tif')}`,
      pdf,
    ]);
  } catch (error) {
    // Only a missing gs binary means Ghostscript is absent; a wrong input path or scratch file is a different error.
    if (error.code === 'ENOENT' && error.path === 'gs') {
      throw new Error('Ghostscript (gs) is needed to draw the plates.', { cause: error });
    }
    throw error;
  }
}

/**
 * The cropped plate of one ink, as a grey image. In a plate 255 is no ink and darker is more ink.
 * @param {string} ink one of Cyan, Magenta, Yellow, Black
 * @param {string} scratch folder holding the separations
 * @returns {import('sharp').Sharp}
 */
function plate(ink, scratch) {
  return sharp(join(scratch, `page(${ink}).tif`))
    .extract(CROP)
    .toColourspace('b-w');
}

/**
 * Reads the cropped plate of one ink as one byte per pixel.
 * @param {string} ink
 * @param {string} scratch
 */
async function rawPlate(ink, scratch) {
  const { data, info } = await plate(ink, scratch).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Writes the cyan, magenta and yellow plates together as one picture. A plate is light where it lays no ink,
 * so each plate read as red, green or blue gives the picture of the three inks alone.
 * @param {string} scratch
 */
async function writeCmyPicture(scratch) {
  const [cyan, magenta, yellow] = await Promise.all(
    ['Cyan', 'Magenta', 'Yellow'].map((ink) => rawPlate(ink, scratch)),
  );
  const { width, height } = cyan;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = cyan.data[i];
    rgb[i * 3 + 1] = magenta.data[i];
    rgb[i * 3 + 2] = yellow.data[i];
  }
  await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(join(images, 'plate-cmy.png'));
}

/**
 * Draws both pictures. The scratch folder sits in docs/images with a name that .gitignore already ignores,
 * and it is removed whatever happens.
 * @param {string} pdf
 */
async function drawPlates(pdf) {
  await mkdir(images, { recursive: true });
  const scratch = await mkdtemp(join(images, 'plates.local.'));
  try {
    await separate(pdf, scratch);
    await plate('Black', scratch).png().toFile(join(images, 'plate-black.png'));
    await writeCmyPicture(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

try {
  await drawPlates(process.argv[2] ?? defaultPdf);
  console.log('Wrote docs/images/plate-black.png and docs/images/plate-cmy.png.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
