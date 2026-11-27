// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { findTransparency, transparencyIn } from '../src/transparency.js';

const n = (text) => PDFName.of(text);

/** A document with one page per resources dictionary given. Each is built by a function of the context. */
async function pagesWith(...builders) {
  const doc = await PDFDocument.create();
  for (const build of builders) {
    const page = doc.addPage([100, 100]);
    page.node.set(n('Resources'), doc.context.obj(build(doc.context)));
  }
  return doc;
}

const form = (context, dict = {}) =>
  context.register(context.flateStream('0 0 0 1 k 0 0 5 5 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5], ...dict }));

const image = (context, dict = {}) =>
  context.register(
    context.flateStream(Buffer.alloc(16, 200), {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, ...dict,
    }),
  );

const kindsOf = async (build) => transparencyIn(await pagesWith(build))[0].kinds;

test('a page that names nothing transparent has no kinds', async () => {
  assert.deepEqual(transparencyIn(await pagesWith(() => ({}))), [{ page: 1, kinds: [] }]);
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { ca: 1, CA: 1, BM: 'Normal', SMask: 'None' } } })), []);
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { BM: 'Compatible' } } })), []);
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { BM: [n('Normal'), n('Multiply')] } } })), []);
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Fm0: form(context), Im0: image(context) } })), []);
});

test('an opacity below 1, for fills or for strokes, is opacity', async () => {
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { ca: 0.5 } } })), ['opacity']);
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { CA: 0.4 } } })), ['opacity']);
});

test('a blend mode other than Normal and Compatible is a blend mode', async () => {
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { BM: 'Multiply' } } })), ['blend mode']);
  assert.deepEqual(await kindsOf(() => ({ ExtGState: { G0: { BM: [n('Screen'), n('Normal')] } } })), ['blend mode']);
});

test('a soft mask is found in a graphics state and on an image', async () => {
  assert.deepEqual(
    await kindsOf((context) => ({ ExtGState: { G0: { SMask: { Type: 'Mask', S: 'Luminosity', G: form(context) } } } })),
    ['soft mask'],
  );
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Im0: image(context, { SMask: image(context) }) } })), ['soft mask']);
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Im0: image(context, { SMaskInData: 1 }) } })), ['soft mask']);
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Im0: image(context, { SMaskInData: 0 }) } })), []);
});

test('a form with a group is a transparency group', async () => {
  const group = { Group: { S: 'Transparency', CS: 'DeviceCMYK' } };
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Fm0: form(context, group) } })), ['transparency group']);
});

test('a graphics state kept as an object of its own is read too', async () => {
  assert.deepEqual(await kindsOf((context) => ({ ExtGState: { G0: context.register(context.obj({ ca: 0.5 })) } })), ['opacity']);
});

test('transparency inside a form, a pattern or a Type 3 font counts for the page', async () => {
  const veiled = { Resources: { ExtGState: { G0: { ca: 0.3 } } } };
  assert.deepEqual(await kindsOf((context) => ({ XObject: { Fm0: form(context, veiled) } })), ['opacity']);
  assert.deepEqual(
    await kindsOf((context) => ({ XObject: { Fm0: form(context, { Resources: { XObject: { Fm1: form(context, veiled) } } }) } })),
    ['opacity'],
  );
  const pattern = (context) =>
    context.register(context.flateStream('/G0 gs 0 0 5 5 re f', { PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 5, 5], XStep: 5, YStep: 5, ...veiled }));
  assert.deepEqual(await kindsOf((context) => ({ Pattern: { P0: pattern(context) } })), ['opacity']);
  assert.deepEqual(await kindsOf(() => ({ Font: { F0: { Type: 'Font', Subtype: 'Type3', ...veiled } } })), ['opacity']);
});

test('the kinds come in a fixed order, each once, and every page has its entry', async () => {
  const doc = await pagesWith(
    (context) => ({
      ExtGState: { G0: { BM: 'Multiply', ca: 0.5 }, G1: { ca: 0.2 }, G2: { SMask: { S: 'Luminosity', G: form(context) } } },
      XObject: { Fm0: form(context, { Group: { S: 'Transparency' } }) },
    }),
    () => ({}),
    () => ({ ExtGState: { G0: { CA: 0 } } }),
  );
  assert.deepEqual(transparencyIn(doc), [
    { page: 1, kinds: ['opacity', 'blend mode', 'soft mask', 'transparency group'] },
    { page: 2, kinds: [] },
    { page: 3, kinds: ['opacity'] },
  ]);
});

test('a page with no resources at all, and a form that names itself, are read without trouble', async () => {
  const doc = await PDFDocument.create();
  const bare = doc.addPage([100, 100]);
  bare.node.delete(n('Resources'));
  const looping = doc.addPage([100, 100]);
  const shared = doc.context.obj({ ExtGState: { G0: { ca: 0.5 } } });
  shared.set(n('XObject'), doc.context.obj({ Fm0: form(doc.context, { Resources: shared }) }));
  looping.node.set(n('Resources'), shared);
  assert.deepEqual(transparencyIn(doc), [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity'] }]);
});

test('findTransparency reads the bytes of a PDF and says the same', async () => {
  const doc = await pagesWith(() => ({}), () => ({ ExtGState: { G0: { ca: 0.5, BM: 'Multiply' } } }));
  assert.deepEqual(await findTransparency(await doc.save()), [
    { page: 1, kinds: [] },
    { page: 2, kinds: ['opacity', 'blend mode'] },
  ]);
});
