// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { parse, run, words } from '../src/calculator.js';
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

test('what it cannot convert is left in RGB, and the report says which shading and which function', async () => {
  const doc = await documentWith((context) => {
    const table = { FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8 };
    const sampled = context.register(context.flateStream(new Uint8Array(6), table));
    const flat = context.register(context.flateStream('{pop pop 1 0 0}', { FunctionType: 4, Domain: [0, 1, 0, 1], Range: [0, 1, 0, 1, 0, 1] }));
    const nested = { FunctionType: 3, Domain: [0, 1], Bounds: [0.5], Encode: [0, 1, 0, 1], Functions: [blend([1, 0, 0], [0, 1, 0]), { FunctionType: 3, Domain: [0, 1], Bounds: [], Encode: [0, 1], Functions: [blend([0, 1, 0], [0, 0, 1])] }] };
    return {
      Sampled: axial(sampled),
      Backed: axial(blend([1, 0, 0], [0, 0, 1]), { Background: [1, 1, 1] }),
      Lopsided: axial(blend([1, 0, 0], [0, 0, 1, 0])),
      Nested: axial(nested),
      Flat: { ShadingType: 1, ColorSpace: 'DeviceRGB', Function: flat },
      Bare: { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0] },
    };
  });
  const { asked, mapColours } = fakeRules();
  const result = await convertShadings(doc.context, mapColours);

  assert.deepEqual(asked, []);
  assert.deepEqual(result.mapped, []);
  assert.deepEqual(result.left.map((item) => item.what).sort(), [
    'shading of type 1, function of type 4: only the PostScript gradients that Chromium writes are converted',
    'shading of type 2, function of type 0: sampled functions are not converted',
    'shading of type 2, function of type 2: it does not blend two RGB colours',
    'shading of type 2, function of type 3: only stitching of blends between two RGB colours is converted',
    'shading of type 2: a shading with a background is not converted',
    'shading of type 2: it has no colour function',
  ]);
  assert.ok(result.left.every((item) => item.rgb));
  const shadings = shadingsOf(doc);
  for (const key of ['Sampled', 'Backed', 'Lopsided', 'Nested', 'Flat', 'Bare']) {
    assert.equal(shadings.lookup(PDFName.of(key), PDFDict).get(PDFName.of('ColorSpace')), PDFName.of('DeviceRGB'));
  }
  close(numbers(shadings.lookup(PDFName.of('Backed'), PDFDict).lookup(PDFName.of('Function'), PDFDict), 'C0'), [1, 0, 0]);
});

// Programs that the Chromium of Playwright 1.65 writes for repeating CSS gradients.
const STRIPES = `{pop
dup truncate sub
dup 0 le {1 add} if
dup 0 le {pop .8667 .2 .2 0} if
dup dup 0 gt exch 1 le and {
dup .5 le {
0 sub pop .8667 .2 .2
}{
.5 sub pop 1 1 1
} ifelse
0} if
0 gt {1 1 1} if
}`;
const RAMP = `{pop
dup truncate sub
dup 0 le {1 add} if
dup 0 le {pop .8667 .2 .2 0} if
dup dup 0 gt exch 1 le and {
0 sub dup -.66666669 mul .8667 add exch dup .2 mul .2 add exch .60000002 mul .2 add
0} if
0 gt {.2 .4 .8} if
}`;
// The red level where RAMP ends: Chromium writes the slope, not the colour of the end.
const RAMP_END = 0.8667 - 0.66666669;
// An SVG radial gradient with a focal point, repeated. Where the cone gives no colour, at the focal point here, it paints black.
const FOCAL = `{2 copy .050000012 mul exch .050000012 mul add 0 add -2 mul dup dup mul
4 2 roll dup mul exch dup mul add 0 sub dup 4 1 roll
-.140000001 mul sub dup
0 ge {
sqrt exch dup 0 lt {exch -1 mul} if add -0.5 mul dup
-.035 div
3 1 roll div
2 copy gt {exch} if
dup .2 mul 0 add
 0 gt {exch pop true}
{pop dup
.2 mul 0 add
0 le {pop false} {true} ifelse
} ifelse
} {pop pop pop false} ifelse
{dup truncate sub
dup 0 le {1 add} if
dup 0 le {pop .8667 .2 .2 0} if
dup dup 0 gt exch 1 le and {
0 sub dup -.66666669 mul .8667 add exch dup .2 mul .2 add exch .60000002 mul .2 add
0} if
0 gt {.2 .4 .8} if
} {0 0 0} ifelse }`;

const program = (context, text, domain = [0, 4, 0, 4]) => context.register(
  context.flateStream(text, { FunctionType: 4, Domain: domain, Range: [0, 1, 0, 1, 0, 1] }),
);
const functionShading = (fn) => ({ ShadingType: 1, ColorSpace: 'DeviceRGB', Domain: [0, 4, 0, 4], Function: fn });
/** Runs the program a shading holds now, at one point. */
const runAt = (shading, xy) => {
  const stream = shading.lookup(PDFName.of('Function'));
  return run(parse(words(Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))), xy);
};

test('stripes Chromium writes as a PostScript function run in ink, each colour converted by the rules', async () => {
  const doc = await documentWith((context) => ({ Sh0: functionShading(program(context, STRIPES)) }));
  const { asked, mapColours } = fakeRules();
  const result = await convertShadings(doc.context, mapColours);

  const shading = shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict);
  assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.deepEqual(numbers(shading.lookup(PDFName.of('Function')).dict, 'Range'), [0, 1, 0, 1, 0, 1, 0, 1]);
  close(runAt(shading, [1.25, 0]), [0.8667, 0.2, 0.3, 0.4]);
  close(runAt(shading, [1.75, 3]), [1, 0.2, 0.3, 0.4]);
  // The colour below the first stop, past the last, and at both ends of each stripe.
  assert.equal(asked.length, 6);
  assert.equal(result.mapped.length, 6);
  assert.deepEqual(result.left, []);
});

test('between two stops of a repeating ramp, the ink is interpolated', async () => {
  const doc = await documentWith((context) => ({ Sh0: functionShading(program(context, RAMP)) }));
  const result = await convertShadings(doc.context, fakeRules().mapColours);

  const shading = shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict);
  close(runAt(shading, [2.25, 0]), [0.8667 + (RAMP_END - 0.8667) / 4, 0.2, 0.3, 0.4]);
  close(runAt(shading, [0.5, 0]), [(0.8667 + RAMP_END) / 2, 0.2, 0.3, 0.4]);
  assert.deepEqual(result.left, []);
});

test('a focal gradient converts its ramp and the black it paints where the cone gives no colour', async () => {
  const doc = await documentWith((context) => ({ Sh0: functionShading(program(context, FOCAL, [-0.45, 0.55, -0.45, 0.55])) }));
  const { asked, mapColours } = fakeRules();
  const result = await convertShadings(doc.context, mapColours);

  const shading = shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict);
  assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.deepEqual(asked.at(-1), [0, 0, 0]);
  close(runAt(shading, [0, 0]), [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(result.left, []);
});

test('a PostScript function shared by two shadings is converted once, and one shared with a shading left in RGB is left', async () => {
  const doc = await documentWith((context) => {
    const shared = program(context, STRIPES);
    const withLeft = program(context, RAMP);
    return {
      Sh0: functionShading(shared),
      Sh1: functionShading(shared),
      Kept: functionShading(withLeft),
      Backed: { ...functionShading(withLeft), Background: [1, 1, 1] },
    };
  });
  const result = await convertShadings(doc.context, fakeRules().mapColours);

  const shadings = shadingsOf(doc);
  for (const key of ['Sh0', 'Sh1']) {
    const shading = shadings.lookup(PDFName.of(key), PDFDict);
    assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
    close(runAt(shading, [0.25, 0]), [0.8667, 0.2, 0.3, 0.4]);
  }
  assert.equal(result.mapped.length, 6);
  for (const key of ['Kept', 'Backed']) {
    const shading = shadings.lookup(PDFName.of(key), PDFDict);
    assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceRGB'));
    close(runAt(shading, [0.5, 0]), [(0.8667 + RAMP_END) / 2, 0.3, 0.5]);
  }
  assert.deepEqual(result.left.map((item) => item.what).sort(), [
    'shading of type 1: a shading with a background is not converted',
    'shading of type 1: it shares a function with a shading left in RGB',
  ]);
});

test('shadings that are not RGB are no concern', async () => {
  const doc = await documentWith(() => ({ Sh0: axial(blend([0, 0, 0, 1], [0, 0, 0, 0]), { ColorSpace: 'DeviceCMYK' }) }));
  const result = await convertShadings(doc.context, fakeRules().mapColours);
  assert.deepEqual(result, { mapped: [], left: [] });
  assert.equal(shadingsOf(doc).lookup(PDFName.of('Sh0'), PDFDict).get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
});
