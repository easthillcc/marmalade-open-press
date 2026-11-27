// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { convertImages } from '../src/images.js';
import { openProfile } from '../src/profile.js';

const WHITE_RED_BLACK_GREY = Buffer.from([255, 255, 255, 255, 0, 0, 0, 0, 0, 128, 128, 128]);

/**
 * Builds a PDF holding the images that `add` registers, saves it and loads it again.
 * `add` receives the context and returns nothing; images are found again by their /Name.
 */
async function documentWith(add) {
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  add(doc.context);
  return PDFDocument.load(await doc.save(), { updateMetadata: false });
}

const image = (extra) => ({ Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, ...extra });

/** The image dictionaries of a document, by the /Name each fixture gave them. */
function imagesByName(doc) {
  const found = {};
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const label = object.dict?.get(PDFName.of('Name'));
    if (label) found[label.asString().slice(1)] = object;
  }
  return found;
}

/** The object number of the fixture image called Lab, as the report names it. */
function labRef(doc) {
  const [ref] = doc.context.enumerateIndirectObjects().find(([, object]) => object === imagesByName(doc).Lab);
  return ref.objectNumber;
}

test('a raw RGB image becomes raw CMYK, compressed, and its heaviest pixel is reported', async () => {
  const doc = await documentWith((context) => {
    context.register(context.flateStream(WHITE_RED_BLACK_GREY, image({ Name: 'Plain' })));
  });
  const result = await convertImages(doc.context, await openProfile());
  assert.equal(result.converted, 1);
  assert.deepEqual(result.left, []);

  const { Plain } = imagesByName(doc);
  assert.equal(Plain.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.equal(Plain.dict.get(PDFName.of('Filter')), PDFName.of('FlateDecode'));
  assert.equal(Plain.dict.get(PDFName.of('BitsPerComponent')).asNumber(), 8);
  const inks = inflateSync(Plain.contents);
  assert.equal(inks.length, 2 * 2 * 4);
  assert.deepEqual([...inks.subarray(0, 4)], [0, 0, 0, 0]);
  const totals = [0, 4, 8, 12].map((at) => ((inks[at] + inks[at + 1] + inks[at + 2] + inks[at + 3]) / 255) * 100);
  assert.ok(Math.abs(result.maxInk - Math.max(...totals)) < 1e-9);
  assert.ok(result.maxInk > 100 && result.maxInk <= 400);
});

test('a JPEG with an ICC profile of three components is converted too, and keeps its soft mask', async () => {
  const jpeg = await sharp(WHITE_RED_BLACK_GREY, { raw: { width: 2, height: 2, channels: 3 } }).jpeg().toBuffer();
  const doc = await documentWith((context) => {
    const rgbProfile = context.register(context.flateStream(new Uint8Array(4), { N: 3 }));
    const mask = context.register(
      context.flateStream(Buffer.from([255, 128, 64, 0]), image({ Name: 'Mask', ColorSpace: 'DeviceGray' })),
    );
    context.register(
      context.stream(jpeg, image({ Name: 'Photo', ColorSpace: [PDFName.of('ICCBased'), rgbProfile], Filter: 'DCTDecode', SMask: mask })),
    );
  });
  const result = await convertImages(doc.context, await openProfile());
  assert.equal(result.converted, 1);
  assert.deepEqual(result.left, []);

  const { Photo, Mask } = imagesByName(doc);
  assert.equal(Photo.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.equal(Photo.dict.get(PDFName.of('Filter')), PDFName.of('FlateDecode'));
  assert.equal(inflateSync(Photo.contents).length, 2 * 2 * 4);
  assert.equal(doc.context.lookup(Photo.dict.get(PDFName.of('SMask'))), Mask);
  assert.equal(Mask.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceGray'));
  assert.deepEqual([...inflateSync(Mask.contents)], [255, 128, 64, 0]);
});

test('images it cannot convert are left as they were and reported', async () => {
  const doc = await documentWith((context) => {
    context.register(context.flateStream(Buffer.alloc(24), image({ Name: 'Deep', BitsPerComponent: 16 })));
    context.register(context.flateStream(WHITE_RED_BLACK_GREY, image({ Name: 'Keyed', Mask: [0, 0, 0, 0, 0, 0] })));
    context.register(context.flateStream(WHITE_RED_BLACK_GREY, image({ Name: 'Inverted', Decode: [1, 0, 1, 0, 1, 0] })));
    context.register(context.stream(Buffer.alloc(12), image({ Name: 'Bare' })));
    context.register(context.flateStream(Buffer.alloc(5), image({ Name: 'Short' })));
    const palette = [PDFName.of('Indexed'), PDFName.of('DeviceRGB'), 1, PDFHexString.of('000000FFFFFF')];
    context.register(context.flateStream(Buffer.alloc(4), image({ Name: 'Palette', ColorSpace: palette })));
    const lab = [PDFName.of('Lab'), { WhitePoint: [0.9642, 1, 0.8249] }];
    context.register(context.flateStream(WHITE_RED_BLACK_GREY, image({ Name: 'Lab', ColorSpace: lab })));
  });
  const before = Object.fromEntries(
    Object.entries(imagesByName(doc)).map(([label, object]) => [label, Buffer.from(object.contents)]),
  );
  const result = await convertImages(doc.context, await openProfile());

  assert.equal(result.converted, 0);
  assert.equal(result.maxInk, 0);
  assert.equal(result.left.length, 7);
  assert.equal(result.left.filter((item) => item.rgb).length, 6);
  assert.equal(result.left.find((item) => !item.rgb).what, `image ${labRef(doc)}: not a plain RGB image`);
  for (const item of result.left) assert.match(item.what, /^image \d+: \S/);
  for (const [label, object] of Object.entries(imagesByName(doc))) {
    assert.ok(Buffer.from(object.contents).equals(before[label]), `${label} was touched`);
  }
  assert.equal(imagesByName(doc).Deep.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceRGB'));
});

test('grey and CMYK images already print as they are, and go unreported', async () => {
  const doc = await documentWith((context) => {
    context.register(context.flateStream(Buffer.alloc(4), image({ Name: 'Grey', ColorSpace: 'DeviceGray' })));
    context.register(context.flateStream(Buffer.alloc(16), image({ Name: 'Inked', ColorSpace: 'DeviceCMYK' })));
  });
  assert.deepEqual(await convertImages(doc.context, await openProfile()), { converted: 0, maxInk: 0, left: [] });
  assert.equal(imagesByName(doc).Grey.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceGray'));
});

test('stencil masks are no business of colour, and go unreported', async () => {
  const doc = await documentWith((context) => {
    const stencil = { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ImageMask: true, BitsPerComponent: 1 };
    context.register(context.flateStream(Buffer.from([0b10000000, 0b01000000]), stencil));
  });
  assert.deepEqual(await convertImages(doc.context, await openProfile()), { converted: 0, maxInk: 0, left: [] });
});
