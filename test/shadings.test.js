// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { convertShadings } from '../src/shadings.js';

/** Stands in for the colour rules: the red level becomes cyan, the rest is fixed, and the colours asked for are kept. */
function fakeRules() {
  const asked = [];
  const mapColours = async (rgbs) => {
    asked.push(...rgbs);
    return rgbs.map(([red]) => ({ cmyk: [(red / 255) * 100, 20, 30, 40], rule: 'profile' }));
  };
  return { asked, mapColours };
}

const blend = (from, to, extra = {}) => ({ FunctionType: 2, Domain: [0, 1], C0: from, C1: to, N: 1, ...extra });
const axial = (fn, extra = {}) => ({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: fn, ...extra });

/** Builds a PDF whose page resources hold the shadings `shadingsOf(context)` returns, saves it and loads it again. */
async function documentWith(shadingsOf) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Shading: shadingsOf(doc.context) }));
  return PDFDocument.load(await doc.save(), { updateMetadata: false });
}

const shadingsOf = (doc) => doc.getPages()[0].node.Resources().lookup(PDFName.of('Shading'), PDFDict);
const numbers = (dict, key) => dict.lookup(PDFName.of(key), PDFArray).asArray().map((one) => one.asNumber());
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, at) => assert.ok(Math.abs(value - expected[at]) < 1e-6, `${actual} is not ${expected}`));
};

test('a blend between two RGB colours becomes a blend between two CMYK colours', async () => {
  const doc = await documentWith(() => ({ Sh0: axial(blend([1, 0, 0], [0, 0, 1], { Range: [0, 1, 0, 1, 0, 1] })) }));
  const { asked, mapColours } = fakeRules();
  const result = await convertShadings(doc.context, mapColours);

  const shading = shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict);
  const fn = shading.lookup(PDFName.of('Function'), PDFDict);
  assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  close(numbers(fn, 'C0'), [1, 0.2, 0.3, 0.4]);
  close(numbers(fn, 'C1'), [0, 0.2, 0.3, 0.4]);
  assert.equal(fn.has(PDFName.of('Range')), false);
  assert.deepEqual(asked, [[255, 0, 0], [0, 0, 255]]);
  assert.equal(result.mapped.length, 2);
  assert.deepEqual(result.left, []);
});

test('a stitched blend converts every piece, through an ICC colour space as well', async () => {
  const doc = await documentWith((context) => {
    const rgbProfile = context.register(context.flateStream(new Uint8Array(4), { N: 3 }));
    const pieces = [blend([1, 0, 0], [0, 1, 0]), blend([0, 1, 0], [0, 0, 1])];
    const stitched = { FunctionType: 3, Domain: [0, 1], Bounds: [0.5], Encode: [0, 1, 0, 1], Functions: pieces };
    return { Sh0: { ...axial(stitched), ShadingType: 3, ColorSpace: [PDFName.of('ICCBased'), rgbProfile] } };
  });
  const result = await convertShadings(doc.context, fakeRules().mapColours);

  const shading = shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict);
  const pieces = shading.lookup(PDFName.of('Function'), PDFDict).lookup(PDFName.of('Functions'), PDFArray);
  assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  close(numbers(pieces.lookup(0, PDFDict), 'C0'), [1, 0.2, 0.3, 0.4]);
  close(numbers(pieces.lookup(1, PDFDict), 'C1'), [0, 0.2, 0.3, 0.4]);
  assert.equal(result.mapped.length, 4);
  assert.deepEqual(result.left, []);
});

test('a function shared by two shadings is converted once', async () => {
  const doc = await documentWith((context) => {
    const shared = context.register(context.obj(blend([1, 0, 0], [0, 0, 1])));
    return { Sh0: axial(shared), Sh1: axial(shared) };
  });
  const result = await convertShadings(doc.context, fakeRules().mapColours);

  const shadings = shadingsOf(doc);
  for (const key of ['Sh0', 'Sh1']) {
    const shading = shadings.lookup(PDFName.of(key), PDFDict);
    assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
    close(numbers(shading.lookup(PDFName.of('Function'), PDFDict), 'C0'), [1, 0.2, 0.3, 0.4]);
  }
  assert.equal(result.mapped.length, 2);
  assert.deepEqual(result.left, []);
});

test('what it cannot convert is left in RGB and reported', async () => {
  const doc = await documentWith((context) => {
    const table = { FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8 };
    const sampled = context.register(context.flateStream(new Uint8Array(6), table));
    return {
      Sampled: axial(sampled),
      Backed: axial(blend([1, 0, 0], [0, 0, 1]), { Background: [1, 1, 1] }),
      Lopsided: axial(blend([1, 0, 0], [0, 0, 1, 0])),
      Bare: { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0] },
    };
  });
  const { asked, mapColours } = fakeRules();
  const result = await convertShadings(doc.context, mapColours);

  assert.deepEqual(asked, []);
  assert.deepEqual(result.mapped, []);
  assert.equal(result.left.length, 4);
  for (const item of result.left) {
    assert.equal(item.rgb, true);
    assert.match(item.what, /^shading of type 2: \S/);
  }
  const shadings = shadingsOf(doc);
  for (const key of ['Sampled', 'Backed', 'Lopsided', 'Bare']) {
    assert.equal(shadings.lookup(PDFName.of(key), PDFDict).get(PDFName.of('ColorSpace')), PDFName.of('DeviceRGB'));
  }
  close(numbers(shadings.lookup(PDFName.of('Backed'), PDFDict).lookup(PDFName.of('Function'), PDFDict), 'C0'), [1, 0, 0]);
});

test('shadings that are not RGB are no concern', async () => {
  const doc = await documentWith(() => ({ Sh0: axial(blend([0, 0, 0, 1], [0, 0, 0, 0]), { ColorSpace: 'DeviceCMYK' }) }));
  const result = await convertShadings(doc.context, fakeRules().mapColours);
  assert.deepEqual(result, { mapped: [], left: [] });
  assert.equal(shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict).get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
});
