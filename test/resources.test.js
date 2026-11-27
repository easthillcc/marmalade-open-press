// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { dictOf, entriesOf, hasFonts, pageImages, pageResources } from '../src/resources.js';

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

test('a page with no resources at all, and a form that names itself, are read without trouble', async () => {
  const doc = await PDFDocument.create();
  const bare = doc.addPage([100, 100]);
  bare.node.delete(n('Resources'));
  const looping = doc.addPage([100, 100]);
  const shared = doc.context.obj({});
  shared.set(n('XObject'), doc.context.obj({ Fm0: form(doc.context, { Resources: shared }) }));
  looping.node.set(n('Resources'), shared);
  assert.deepEqual(pageResources(bare), []);
  assert.deepEqual(pageResources(looping), [shared]);
  assert.equal(hasFonts(bare), false);
  assert.deepEqual(pageImages(bare), []);
});

test('pageResources lists the page resources first, then the nested ones', async () => {
  const doc = await pagesWith((context) => ({ XObject: { Fm0: form(context, { Resources: { ExtGState: { G0: { ca: 1 } } } }) } }));
  const [page] = doc.getPages();
  const resources = pageResources(page);
  assert.equal(resources.length, 2);
  assert.equal(resources[0], page.node.Resources());
  assert.ok(resources[1].lookup(n('ExtGState')) instanceof PDFDict);
});

test('hasFonts sees a font on the page or inside a form, and nothing else', async () => {
  const font = { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' };
  const doc = await pagesWith(
    () => ({ Font: { F0: font } }),
    (context) => ({ XObject: { Fm0: form(context, { Resources: { Font: { F0: font } } }) } }),
    (context) => ({ Font: {}, XObject: { Im0: image(context) } }),
    () => ({}),
  );
  assert.deepEqual(doc.getPages().map(hasFonts), [true, true, false, false]);
});

test('pageImages lists each image once, wherever it is named', async () => {
  const doc = await pagesWith(
    (context) => {
      const photo = image(context);
      return { XObject: { Im0: photo, Im1: photo, Im2: image(context), Fm0: form(context, { Resources: { XObject: { Im0: photo, Im3: image(context) } } }) } };
    },
    () => ({}),
  );
  const [first, second] = doc.getPages();
  assert.equal(pageImages(first).length, 3);
  assert.equal(pageImages(first)[0].dict.get(n('Subtype')), n('Image'));
  assert.deepEqual(pageImages(second), []);
});

test('entriesOf gives the values of a category, and nothing when it is absent or not a dictionary', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ExtGState: { G0: { ca: 1 }, G1: { ca: 0.5 } }, Font: [1, 2] });
  assert.equal(entriesOf(resources, 'ExtGState').length, 2);
  assert.deepEqual(entriesOf(resources, 'XObject'), []);
  assert.deepEqual(entriesOf(resources, 'Font'), []);
});

test('dictOf gives the dictionary of a stream or the dictionary itself, and undefined for the rest', async () => {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ ca: 1 });
  const stream = doc.context.flateStream('q Q', { Subtype: 'Form' });
  assert.equal(dictOf(dict), dict);
  assert.equal(dictOf(stream), stream.dict);
  assert.equal(dictOf(n('None')), undefined);
  assert.equal(dictOf(undefined), undefined);
});
