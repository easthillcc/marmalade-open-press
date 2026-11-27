// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { recolourToGrey } from '../src/content.js';
import { greyImage } from '../src/images.js';
import { luminosityMaskForms } from '../src/masks.js';

/** A context with one image of the given pixels, drawn nowhere. */
async function oneImage(pixels, keys) {
  const { context } = await PDFDocument.create();
  const dict = { Type: 'XObject', Subtype: 'Image', ColorSpace: 'DeviceRGB', BitsPerComponent: 8, ...keys };
  const ref = context.register(keys.Filter === 'DCTDecode' ? context.stream(pixels, dict) : context.flateStream(pixels, dict));
  return { context, ref };
}

test('recolourToGrey turns RGB colours into the grey of their luminosity', () => {
  const { source, inlineImage, leftRgb } = recolourToGrey('0.2 0.4 0.6 rg 1 0 0 RG 0 0 0 rg 0.5 g 0 0 5 5 re f', new Set());
  assert.equal(source, '0.362 g 0.3 G 0 g 0.5 g 0 0 5 5 re f');
  assert.equal(inlineImage, false);
  assert.equal(leftRgb, 0);
});

test('recolourToGrey follows RGB colour spaces, by device name and by resource name', () => {
  const { source } = recolourToGrey('/DeviceRGB cs 0 1 0 sc /CS0 CS 0 0 1 SCN', new Set(['/CS0']));
  assert.equal(source, '/DeviceGray cs 0.59 sc /CS0 CS 0.11 SCN');
});

test('recolourToGrey counts what it cannot read, and leaves a stream with an inline image whole', () => {
  const unknown = recolourToGrey('/P0 cs 1 0 0 scn', new Set());
  assert.equal(unknown.source, '/P0 cs 1 0 0 scn');
  assert.equal(unknown.leftRgb, 1);
  const inline = 'BI /W 1 /H 1 /CS /RGB /BPC 8 ID \x00\x00\x00 EI';
  assert.deepEqual(recolourToGrey(inline, new Set()), { source: inline, inlineImage: true, leftRgb: 0 });
});

test('luminosityMaskForms finds the form of a luminosity mask and the forms it draws, and nothing else', async () => {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const box = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5] };
  const inner = context.register(context.flateStream('1 0 0 rg 0 0 5 5 re f', box));
  const mask = context.register(context.flateStream('/Fm1 Do', { ...box, Resources: { XObject: { Fm1: inner } } }));
  const plain = context.register(context.flateStream('0 0 1 rg 0 0 5 5 re f', box));
  const page = doc.addPage([10, 10]);
  page.node.set(PDFName.of('Resources'), context.obj({
    ExtGState: {
      GS0: { SMask: { Type: 'Mask', S: 'Luminosity', G: mask } },
      GS1: { SMask: { Type: 'Mask', S: 'Alpha', G: plain } },
    },
    XObject: { Fm2: plain },
  }));
  const found = luminosityMaskForms(context);
  assert.equal(found.size, 2);
  assert.ok(found.has(mask));
  assert.ok(found.has(inner));
});

test('greyImage turns an RGB image into the grey of each pixel\'s luminosity', async () => {
  const { context, ref } = await oneImage(Buffer.from([100, 200, 0, 255, 255, 255]), { Width: 2, Height: 1 });
  assert.equal(await greyImage(context, ref), null);
  const image = context.lookup(ref, PDFRawStream);
  assert.equal(image.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceGray'));
  assert.deepEqual([...inflateSync(image.contents)], [148, 255]);
});

test('greyImage reads a JPEG too', async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 100, g: 200, b: 0 } } }).jpeg({ quality: 100 }).toBuffer();
  const { context, ref } = await oneImage(jpeg, { Width: 2, Height: 2, Filter: 'DCTDecode' });
  assert.equal(await greyImage(context, ref), null);
  const levels = [...inflateSync(context.lookup(ref, PDFRawStream).contents)];
  assert.equal(levels.length, 4);
  for (const level of levels) assert.ok(Math.abs(level - 148) <= 6, `grey ${level}`);
});

test('greyImage says why it leaves an image as it is', async () => {
  const deep = await oneImage(new Uint8Array(6), { Width: 1, Height: 1, BitsPerComponent: 16 });
  assert.equal(await greyImage(deep.context, deep.ref), 'not 8 bits per component');
  const short = await oneImage(new Uint8Array(3), { Width: 2, Height: 1 });
  assert.equal(await greyImage(short.context, short.ref), 'size does not match its data');
});
