// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { openProfile } from '../src/profile.js';
import { numberedNames, tiffArgs, toTiffPages, withSoftware } from '../src/tiff.js';
import { hasGhostscript } from './helpers/ghostscript.js';

/** A CMYK PDF with one page per ink given: the whole page, 1 inch by half an inch, is filled with it. */
async function cmykPdf(...inks) {
  const doc = await PDFDocument.create();
  for (const ink of inks) {
    const page = doc.addPage([72, 36]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`${ink} k 0 0 72 36 re f`)));
  }
  return doc.save();
}

/** The four inks, 0 to 255, of the middle pixel of a CMYK TIFF. */
async function middleInks(tiff) {
  const { data, info } = await sharp(tiff).pipelineColourspace('cmyk').toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  return [...data.subarray(at, at + 4)];
}

test('the arguments ask for one LZW CMYK TIFF per page, with smooth letters and the profile on both sides', () => {
  assert.deepEqual(tiffArgs(300), [
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sDEVICE=tiff32nc',
    '-r300',
    '-sCompression=lzw',
    '-dTextAlphaBits=4',
    '--permit-file-read=profile.icc',
    '-sDefaultCMYKProfile=profile.icc',
    '-sOutputICCProfile=profile.icc',
    '-sOutputFile=page-%d.tif',
    'input.pdf',
  ]);
  assert.equal(tiffArgs(600)[5], '-r600');
});

test('numberedNames puts the page number before the extension, from 1', () => {
  assert.deepEqual(numberedNames('poster.tif', 3), ['poster-1.tif', 'poster-2.tif', 'poster-3.tif']);
  assert.deepEqual(numberedNames('out/night.walks.tiff', 1), ['out/night.walks-1.tiff']);
  assert.deepEqual(numberedNames('/tmp/a b/page.TIF', 2), ['/tmp/a b/page-1.TIF', '/tmp/a b/page-2.TIF']);
  assert.deepEqual(numberedNames('poster', 1), ['poster-1']);
  assert.deepEqual(numberedNames('poster.tif', 0), []);
});

test('every page becomes a CMYK TIFF at the resolution asked for, in page order, with the profile inside', { skip: !hasGhostscript }, async () => {
  const profile = await openProfile();
  const inks = ['0 0 0 1', '1 0 0 0', '0 1 0 0', '0 0 1 0', '0 0 0 0', '0 0 0 0.5', '1 1 0 0', '0 1 1 0', '1 0 1 0', '0.2 0 0 0', '0 0.2 0 0'];
  const pages = await toTiffPages(await cmykPdf(...inks), { profile: profile.bytes, dpi: 100 });
  assert.equal(pages.length, 11);
  const meta = await sharp(pages[0]).metadata();
  assert.equal(meta.format, 'tiff');
  assert.equal(meta.space, 'cmyk');
  assert.equal(meta.channels, 4);
  assert.deepEqual([meta.width, meta.height, meta.density], [100, 50, 100]);
  assert.ok(Buffer.from(meta.icc).equals(profile.bytes));
  // The inks of the PDF are the inks of the pixels, to within one level of rounding.
  // Page 10 comes after page 9, and not after page 1 as it would in alphabetical order.
  const expected = { 0: [0, 0, 0, 255], 1: [255, 0, 0, 0], 4: [0, 0, 0, 0], 5: [0, 0, 0, 128], 9: [51, 0, 0, 0], 10: [0, 51, 0, 0] };
  for (const [index, inks] of Object.entries(expected)) {
    const actual = await middleInks(pages[index]);
    assert.ok(actual.every((ink, i) => Math.abs(ink - inks[i]) <= 1), `page ${Number(index) + 1} is ${actual}, not ${inks}`);
  }
});

test('two abutting fills render as solid ink along their shared edge, with no light seam', { skip: !hasGhostscript }, async () => {
  // Two rectangles of the same magenta meet at 35.7 pt. Anti-aliased graphics leave a paler line there.
  const doc = await PDFDocument.create();
  const page = doc.addPage([72, 36]);
  const contents = '0 1 0 0 k 0 0 35.7 36 re f 35.7 0 36.3 36 re f';
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(contents)));
  const profile = await openProfile();
  const [tiff] = await toTiffPages(await doc.save(), { profile: profile.bytes, dpi: 300 });
  const { data, info } = await sharp(tiff).pipelineColourspace('cmyk').toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true });
  const y = 75;
  for (let x = 140; x <= 156; x += 1) {
    const magenta = data[(y * info.width + x) * 4 + 1];
    assert.equal(magenta, 255, `pixel ${x},${y} has magenta ${magenta}, not 255`);
  }
});

/** A TIFF with one directory that holds a Software tag, whose old text is stored after the directory. */
function tinyTiff(little) {
  const write16 = (buffer, value, at) => (little ? buffer.writeUInt16LE(value, at) : buffer.writeUInt16BE(value, at));
  const write32 = (buffer, value, at) => (little ? buffer.writeUInt32LE(value, at) : buffer.writeUInt32BE(value, at));
  const old = Buffer.from('GPL Ghostscript 10.6\0', 'latin1');
  const textAt = 8 + 2 + 12 + 4;
  const tiff = Buffer.alloc(textAt + old.length);
  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  write16(tiff, 42, 2);
  write32(tiff, 8, 4);
  write16(tiff, 1, 8);
  write16(tiff, 305, 10);
  write16(tiff, 2, 12);
  write32(tiff, old.length, 14);
  write32(tiff, textAt, 18);
  old.copy(tiff, textAt);
  return tiff;
}

/** The text of the Software tag of a TIFF made by tinyTiff, and where it starts. */
function softwareOf(tiff) {
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const length = little ? tiff.readUInt32LE(14) : tiff.readUInt32BE(14);
  const at = little ? tiff.readUInt32LE(18) : tiff.readUInt32BE(18);
  return { at, text: tiff.toString('latin1', at, at + length - 1) };
}

test('withSoftware names the program in the Software tag, in both byte orders, and moves nothing else', () => {
  for (const little of [true, false]) {
    const before = tinyTiff(little);
    const after = withSoftware(before, 'Marmalade Open Press 1.0.1 (https://marmalade.family), with Ghostscript 10.6');
    assert.equal(softwareOf(after).text, 'Marmalade Open Press 1.0.1 (https://marmalade.family), with Ghostscript 10.6');
    assert.equal(softwareOf(after).at % 2, 0);
    // Only the length and the offset of the entry (bytes 14 to 21) differ in the part that was there before.
    assert.ok(after.subarray(0, 14).equals(before.subarray(0, 14)));
    assert.ok(after.subarray(22, before.length).equals(before.subarray(22)));
  }
});

test('withSoftware gives the same page back when it has no Software tag', () => {
  const tiff = tinyTiff(true);
  tiff.writeUInt16LE(306, 10);
  assert.equal(withSoftware(tiff, 'Anything'), tiff);
});

test('naming the program leaves the pixels and the profile as they were', { skip: !hasGhostscript }, async () => {
  const profile = await openProfile();
  const [page] = await toTiffPages(await cmykPdf('0.2 0.4 0.6 0.1'), { profile: profile.bytes, dpi: 72 });
  const named = withSoftware(page, 'Marmalade Open Press, with Ghostscript');
  assert.ok(named.includes('Marmalade Open Press, with Ghostscript'));
  assert.deepEqual(await middleInks(named), await middleInks(page));
  assert.ok(Buffer.from((await sharp(named).metadata()).icc).equals(profile.bytes));
});
