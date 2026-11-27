// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exactPageBoxes } from '../src/exactboxes.js';
import { POINTS_PER_MM, defaultPageCss, namesPageSize, parsePageSize } from '../src/pagesize.js';
import { readStream } from '../src/pdf.js';

const EXACT_154 = 154 * POINTS_PER_MM;

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} is not ${expected}`);
const numbers = (array) => array.asArray().map((item) => item.asNumber());

/** Asserts a parsed size, in points. */
function sizeIs(size, width, height) {
  assert.notEqual(size, null);
  near(size.width, width);
  near(size.height, height);
}

/**
 * One page as Chromium prints it: a media box at Chromium's rounded size, a content stream that starts by
 * flipping to CSS's top-left origin, and a link near the top-left corner.
 */
async function chromiumPage({ width, height, cropBox = true, origin = 0 }) {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const page = doc.addPage([width, height]);
  page.setMediaBox(0, origin, width, height);
  if (cropBox) page.setCropBox(0, origin, width, height);
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(`.24 0 0 -.24 0 ${height} cm 0 0 0 rg 0 0 100 100 re f`)));
  page.node.set(PDFName.of('Annots'), context.obj([context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [6, height - 20, 30, height - 6] })]));
  return doc.save();
}

test('parsePageSize reads two lengths, one length, and every unit CSS allows', () => {
  sizeIs(parsePageSize('154mm 154mm'), EXACT_154, EXACT_154);
  sizeIs(parsePageSize('154mm'), EXACT_154, EXACT_154);
  sizeIs(parsePageSize('15.4cm 10cm'), EXACT_154, 100 * POINTS_PER_MM);
  sizeIs(parsePageSize('6in 4in'), 432, 288);
  sizeIs(parsePageSize('300pt 400pt'), 300, 400);
  sizeIs(parsePageSize('400px 300px'), 300, 225);
  sizeIs(parsePageSize('10pc 20pc'), 120, 240);
  sizeIs(parsePageSize('40q 40q'), 10 * POINTS_PER_MM, 10 * POINTS_PER_MM);
  sizeIs(parsePageSize('  148MM   210MM '), 148 * POINTS_PER_MM, 210 * POINTS_PER_MM);
});

test('parsePageSize reads the calc() that Chromium leaves of a calculated length', () => {
  sizeIs(parsePageSize('calc(41.5748px) 20mm'), 41.5748 * 0.75, 20 * POINTS_PER_MM);
});

test('parsePageSize reads the named sizes, upright unless turned', () => {
  sizeIs(parsePageSize('a5'), 148 * POINTS_PER_MM, 210 * POINTS_PER_MM);
  sizeIs(parsePageSize('a5 portrait'), 148 * POINTS_PER_MM, 210 * POINTS_PER_MM);
  sizeIs(parsePageSize('a4 landscape'), 297 * POINTS_PER_MM, 210 * POINTS_PER_MM);
  sizeIs(parsePageSize('landscape a3'), 420 * POINTS_PER_MM, 297 * POINTS_PER_MM);
  sizeIs(parsePageSize('jis-b5'), 182 * POINTS_PER_MM, 257 * POINTS_PER_MM);
  sizeIs(parsePageSize('letter'), 612, 792);
  sizeIs(parsePageSize('ledger landscape'), 1224, 792);
});

test('parsePageSize gives null for no size, and for a size it cannot read', () => {
  const unread = ['', 'auto', 'landscape', 'portrait', 'a5 a4', 'a5 landscape portrait', '10mm landscape', '-3mm 4mm', '0mm', '10em 10em', '1mm 2mm 3mm', 'tabloid'];
  for (const text of unread) assert.equal(parsePageSize(text), null, text);
});

test('namesPageSize is false only for no size and for an orientation alone', () => {
  for (const text of ['', ' auto ', 'landscape', 'Portrait']) assert.equal(namesPageSize(text), false, text);
  for (const text of ['a5', '10mm', '10em 10em', 'a4 landscape']) assert.equal(namesPageSize(text), true, text);
});

test('defaultPageCss is A5 plus the bleed on every side, turned for landscape', () => {
  assert.equal(defaultPageCss('', 0), '148mm 210mm');
  assert.equal(defaultPageCss('auto', 3), '154mm 216mm');
  assert.equal(defaultPageCss('landscape', 3), '216mm 154mm');
  assert.equal(defaultPageCss('portrait', 2.5), '153mm 215mm');
  assert.equal(defaultPageCss('', 0.1), '148.2mm 210.2mm');
});

test('exactPageBoxes sets the media and crop boxes to the exact size, and moves the content down by the rounding', async () => {
  const pdf = await exactPageBoxes(await chromiumPage({ width: 437.04, height: 437.04 }), { width: EXACT_154, height: EXACT_154 });
  const [page] = (await PDFDocument.load(pdf)).getPages();
  const media = page.getMediaBox();
  assert.deepEqual([media.x, media.y], [0, 0]);
  close(media.width, EXACT_154);
  close(media.height, EXACT_154);
  const crop = numbers(page.node.lookup(PDFName.of('CropBox'), PDFArray));
  assert.deepEqual(crop.slice(0, 2), [0, 0]);
  close(crop[2], EXACT_154);
  close(crop[3], EXACT_154);

  const contents = page.node.lookup(PDFName.of('Contents'), PDFArray);
  assert.equal(contents.size(), 2);
  assert.equal(readStream(contents.lookup(0, PDFRawStream)).toString('latin1'), '1 0 0 1 0 -0.50457 cm\n');
  assert.match(readStream(contents.lookup(1, PDFRawStream)).toString('latin1'), /^\.24 0 0 -\.24 0 437\.04 cm/);

  const link = page.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  const rect = numbers(link.lookup(PDFName.of('Rect'), PDFArray));
  assert.equal(rect[0], 6);
  close(rect[1], EXACT_154 - 20);
  assert.equal(rect[2], 30);
  close(rect[3], EXACT_154 - 6);
});

test('exactPageBoxes moves the content up when Chromium rounded the page down, and adds no crop box', async () => {
  const size = { width: 148 * POINTS_PER_MM, height: 210 * POINTS_PER_MM };
  const pdf = await exactPageBoxes(await chromiumPage({ width: 420, height: 594.96, cropBox: false }), size);
  const [page] = (await PDFDocument.load(pdf)).getPages();
  close(page.getWidth(), size.width);
  close(page.getHeight(), size.height);
  assert.equal(page.node.get(PDFName.of('CropBox')), undefined);
  const move = page.node.lookup(PDFName.of('Contents'), PDFArray).lookup(0, PDFRawStream);
  assert.equal(readStream(move).toString('latin1'), '1 0 0 1 0 0.31559 cm\n');
});

test('exactPageBoxes paints the canvas colour first, from one point outside the exact page, when it is given', async () => {
  const size = { width: EXACT_154, height: EXACT_154 };
  const pdf = await exactPageBoxes(await chromiumPage({ width: 437.04, height: 437.04 }), size, [0.2, 0.4, 0.6]);
  const [page] = (await PDFDocument.load(pdf)).getPages();
  const first = page.node.lookup(PDFName.of('Contents'), PDFArray).lookup(0, PDFRawStream);
  assert.equal(readStream(first).toString('latin1'), 'q 0.2 0.4 0.6 rg -1 -1 438.53543 438.53543 re f Q\n1 0 0 1 0 -0.50457 cm\n');
});

test('exactPageBoxes gives the same bytes back when no page is at a rounded size of the one asked for', async () => {
  const already = await chromiumPage({ width: 300, height: 400 });
  assert.equal(await exactPageBoxes(already, { width: 300, height: 400 }), already);
  const otherSize = await chromiumPage({ width: 437.04, height: 437.04 });
  assert.equal(await exactPageBoxes(otherSize, { width: 420, height: 437.04 }), otherSize);
  const moved = await chromiumPage({ width: 437.04, height: 437.04, origin: 10 });
  assert.equal(await exactPageBoxes(moved, { width: EXACT_154, height: EXACT_154 }), moved);
});
