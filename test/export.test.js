// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { DEFAULT_DPI, FORMATS, exportAs } from '../src/export.js';
import { GHOSTSCRIPT_MISSING, ghostscriptVersion } from '../src/ghostscript.js';
import { readStream } from '../src/pdf.js';
import { asPdf16, dressAsPdfX4 } from '../src/pdfx.js';
import { openProfile } from '../src/profile.js';
import { PRODUCER } from '../src/version.js';
import { hasGhostscript, withoutGhostscript } from './helpers/ghostscript.js';

const n = (text) => PDFName.of(text);
const profile = await openProfile();

/**
 * A PDF/X-4 of two pages, 2 inches by 1 inch, dressed as convert does. Both pages have a half-black square
 * and a word. Page 2 also has a half-opaque magenta veil over the whole page, so it has to be flattened.
 */
async function x4() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Fixture');
  doc.setCreator('A test');
  for (const veiled of [false, true]) {
    const page = doc.addPage([144, 72]);
    const veil = veiled ? { ExtGState: { G0: { ca: 0.5 } } } : {};
    page.node.set(n('Resources'), doc.context.obj({ Font: { F1: font.ref }, ...veil }));
    const content = `0 0 0 0.5 k 0 0 72 72 re f BT /F1 10 Tf 80 30 Td (Hi) Tj ET${veiled ? ' /G0 gs 0 1 0 0 k 0 0 144 72 re f' : ''}`;
    page.node.set(n('Contents'), doc.context.register(doc.context.flateStream(content)));
  }
  dressAsPdfX4(doc, { profile, bleed: 3 });
  return asPdf16(await doc.save());
}

const load = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });
const infoOf = (doc) => doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
const text = (dict, key) => dict.lookup(n(key)).decodeText();

/** The four inks, 0 to 255, of the pixel at x, y of a CMYK TIFF. */
async function inksAt(tiff, x, y) {
  const { data, info } = await sharp(tiff).pipelineColourspace('cmyk').toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  const at = (y * info.width + x) * 4;
  return [...data.subarray(at, at + 4)];
}

test('the formats are x4, x1a, x3 and tiff, at 300 dpi unless told otherwise', () => {
  assert.deepEqual(FORMATS, ['x4', 'x1a', 'x3', 'tiff']);
  assert.equal(DEFAULT_DPI, 300);
});

test('x4 gives the same bytes back, with a report of the transparency, and needs no Ghostscript', async (t) => {
  withoutGhostscript(t);
  const pdf = await x4();
  for (const result of [await exportAs(pdf), await exportAs(pdf, 'x4')]) {
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0], pdf);
    assert.deepEqual(result.report, {
      format: 'x4',
      pages: 2,
      dpi: null,
      ghostscript: null,
      transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity'] }],
      pixels: [],
    });
  }
  await assert.rejects(exportAs(pdf, 'x1a'), (error) => error.message === GHOSTSCRIPT_MISSING);
  await assert.rejects(exportAs(pdf, 'tiff'), (error) => error.message === GHOSTSCRIPT_MISSING);
});

test('a format or a resolution that makes no sense is refused before any work', async () => {
  const notAPdf = new Uint8Array([1, 2, 3]);
  await assert.rejects(exportAs(notAPdf, 'x2'), /^Error: The format is one of x4, x1a, x3, tiff\.$/);
  for (const dpi of [0, 71, 2401, Number.NaN, '300']) {
    await assert.rejects(exportAs(notAPdf, 'tiff', { dpi }), /^Error: The resolution is a number of dots per inch from 72 to 2400, such as 300\.$/);
  }
});

test('a PDF that convert did not write is refused for the other formats', async () => {
  const plain = await PDFDocument.create();
  plain.addPage([144, 72]);
  await assert.rejects(exportAs(await plain.save(), 'x1a'), /names no output profile/);
});

test('x1a is a PDF/X-1a in PDF 1.3 that keeps the page without transparency as it was', { skip: !hasGhostscript }, async () => {
  const { files, report } = await exportAs(await x4(), 'x1a');
  assert.equal(files.length, 1);
  assert.equal(Buffer.from(files[0].subarray(0, 8)).toString('latin1'), '%PDF-1.3');
  const doc = await load(files[0]);
  const info = infoOf(doc);
  assert.equal(text(info, 'GTS_PDFXVersion'), 'PDF/X-1:2001');
  assert.equal(text(info, 'GTS_PDFXConformance'), 'PDF/X-1a:2001');
  assert.equal(doc.getTitle(), 'Fixture');
  assert.equal(doc.getCreator(), 'A test');
  assert.equal(doc.getProducer(), PRODUCER);

  const intent = doc.catalog.lookup(n('OutputIntents')).lookup(0, PDFDict);
  assert.equal(text(intent, 'OutputConditionIdentifier'), profile.description);
  assert.ok(readStream(intent.lookup(n('DestOutputProfile'))).equals(profile.bytes));

  const [first, second] = doc.getPages();
  for (const page of [first, second]) {
    assert.deepEqual(page.getMediaBox(), { x: 0, y: 0, width: 144, height: 72 });
    assert.ok(Math.abs(page.getTrimBox().x - (3 * 72) / 25.4) < 1e-4);
    assert.equal(page.node.has(n('ArtBox')), false);
  }
  // The first page is still text and vectors, and its black is still on the black plate alone.
  const firstSource = readStream(first.node.Contents()).toString('latin1');
  assert.match(firstSource, /(^|\s)0 0 0 0?\.5 k\s/);
  assert.match(firstSource, /Tj|TJ/);
  assert.ok(first.node.Resources().has(n('Font')));
  // The second page is one image now.
  assert.equal(second.node.Resources().has(n('Font')), false);
  assert.equal(Buffer.from(files[0]).toString('latin1').includes('/ca '), false);

  assert.deepEqual(report, {
    format: 'x1a',
    pages: 2,
    dpi: 300,
    ghostscript: await ghostscriptVersion(),
    transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity'] }],
    pixels: [
      { page: 1, flattened: false, share: 0, textLost: false, imagesAdded: 0 },
      { page: 2, flattened: true, share: 1, textLost: true, imagesAdded: 1 },
    ],
  });
});

test('x3 is a PDF/X-3 in PDF 1.3, flattened at the resolution asked for', { skip: !hasGhostscript }, async () => {
  const { files, report } = await exportAs(await x4(), 'x3', { dpi: 150 });
  assert.equal(Buffer.from(files[0].subarray(0, 8)).toString('latin1'), '%PDF-1.3');
  const doc = await load(files[0]);
  const info = infoOf(doc);
  assert.equal(text(info, 'GTS_PDFXVersion'), 'PDF/X-3:2002');
  assert.equal(info.has(n('GTS_PDFXConformance')), false);
  assert.equal(report.format, 'x3');
  assert.equal(report.dpi, 150);
  assert.deepEqual(report.pixels.map((page) => page.flattened), [false, true]);
  const image = doc.getPages()[1].node.Resources().lookup(n('XObject'), PDFDict).values().map((ref) => doc.context.lookup(ref))[0];
  assert.equal(image.dict.lookup(n('Width')).asNumber(), 300);
  assert.equal(image.dict.lookup(n('Height')).asNumber(), 150);
});

test('tiff is one CMYK TIFF per page, with the profile inside and the black on its own plate', { skip: !hasGhostscript }, async () => {
  const { files, report } = await exportAs(await x4(), 'tiff', { dpi: 100 });
  assert.equal(files.length, 2);
  for (const file of files) {
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, 'tiff');
    assert.equal(meta.space, 'cmyk');
    assert.equal(meta.channels, 4);
    assert.deepEqual([meta.width, meta.height, meta.density], [200, 100, 100]);
    assert.ok(Buffer.from(meta.icc).equals(profile.bytes));
    assert.ok(file.includes(`${PRODUCER}, with Ghostscript ${report.ghostscript}`), 'the Software tag names this tool and Ghostscript');
  }
  // The middle of the half-black square on page 1: black only, at one half.
  const [c, m, y, k] = await inksAt(files[0], 20, 50);
  assert.deepEqual([c, m, y], [0, 0, 0]);
  assert.ok(Math.abs(k - 128) <= 1, `black is ${k}`);
  // Bare paper on the right of page 1.
  assert.deepEqual(await inksAt(files[0], 190, 10), [0, 0, 0, 0]);
  // Page 2, same place: the half-opaque magenta veil halves the black and adds half the magenta.
  const veiled = await inksAt(files[1], 20, 50);
  assert.deepEqual([veiled[0], veiled[2]], [0, 0]);
  assert.ok(Math.abs(veiled[1] - 128) <= 2, `magenta is ${veiled[1]}`);
  assert.ok(Math.abs(veiled[3] - 64) <= 2, `black is ${veiled[3]}`);

  assert.deepEqual(report, {
    format: 'tiff',
    pages: 2,
    dpi: 100,
    ghostscript: await ghostscriptVersion(),
    transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity'] }],
    pixels: [],
  });
});
