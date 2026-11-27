// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { comparePages } from '../src/pixels.js';

const n = (text) => PDFName.of(text);
const font = { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' };

/** A document of pages 144 by 72 points, one per resources dictionary given. Each is built from the context. */
async function pagesWith(...builders) {
  const doc = await PDFDocument.create();
  for (const build of builders) {
    doc.addPage([144, 72]).node.set(n('Resources'), doc.context.obj(build(doc.context)));
  }
  return doc;
}

/** An image XObject of the given size in pixels. Only its dictionary matters here. */
const image = (context, width, height) =>
  context.register(
    context.flateStream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }),
  );

/** What findTransparency would say of a document whose pages use these kinds. One list of kinds per page. */
const transparencyOf = (...pages) => pages.map((kinds, index) => ({ page: index + 1, kinds }));

const NONE = [];
const VEILED = ['opacity'];

const still = (page) => ({ page, flattened: false, share: 0, textLost: false, imagesAdded: 0 });

test('pages that come back as they were are reported as untouched', async () => {
  const before = await pagesWith(() => ({ Font: { F0: font } }), (context) => ({ XObject: { Im0: image(context, 10, 10) } }));
  const after = await pagesWith(() => ({ Font: { R7: font } }), (context) => ({ XObject: { R9: image(context, 10, 10) } }));
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(NONE, NONE) }), [still(1), still(2)]);
});

test('a page with transparency that comes back as one image of its size is flattened, and its text is lost', async () => {
  const before = await pagesWith(() => ({ Font: { F0: font } }));
  const after = await pagesWith((context) => ({ XObject: { R9: image(context, 600, 300) } }));
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(VEILED) }), [
    { page: 1, flattened: true, share: 1, textLost: true, imagesAdded: 1 },
  ]);
});

test('the share is what the image covers at the resolution given, and never more than the page', async () => {
  const before = await pagesWith(() => ({}), () => ({}), () => ({}));
  const transparency = transparencyOf(VEILED, ['soft mask'], ['blend mode', 'transparency group']);
  const after = await pagesWith(
    (context) => ({ XObject: { R9: image(context, 450, 300) } }),
    (context) => ({ XObject: { R9: image(context, 300, 150), R10: image(context, 300, 150) } }),
    (context) => ({ XObject: { R9: image(context, 601, 301) } }),
  );
  const pages = comparePages(before, after, { dpi: 300, transparency });
  assert.deepEqual(pages.map((page) => page.flattened), [true, true, true]);
  assert.ok(Math.abs(pages[0].share - 0.75) < 1e-9);
  assert.ok(Math.abs(pages[1].share - 0.5) < 1e-9);
  assert.equal(pages[2].share, 1);
  assert.equal(pages[0].textLost, false);
  assert.ok(Math.abs(comparePages(before, after, { dpi: 150, transparency })[1].share - 1) < 1e-9);
});

test('a page without transparency is never called flattened, even when it is one image', async () => {
  const before = await pagesWith((context) => ({ XObject: { Im0: image(context, 600, 300) } }));
  const after = await pagesWith((context) => ({ XObject: { R9: image(context, 600, 300) } }));
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(NONE) }), [still(1)]);
});

test('a page with transparency that kept its text is not flattened', async () => {
  const before = await pagesWith(() => ({ Font: { F0: font } }));
  const after = await pagesWith((context) => ({ Font: { R7: font }, XObject: { R9: image(context, 600, 300) } }));
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(VEILED) }), [{ ...still(1), imagesAdded: 1 }]);
});

test('images that appear on a page that stays as it was are counted, and images that go are not', async () => {
  const before = await pagesWith(
    () => ({ Font: { F0: font } }),
    (context) => ({ Font: { F0: font }, XObject: { Im0: image(context, 10, 10), Im1: image(context, 10, 10) } }),
  );
  const after = await pagesWith(
    (context) => ({ Font: { R7: font }, XObject: { R9: image(context, 179, 179), R10: image(context, 20, 20) } }),
    (context) => ({ Font: { R7: font }, XObject: { R9: image(context, 10, 10) } }),
  );
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(NONE, NONE) }), [{ ...still(1), imagesAdded: 2 }, still(2)]);
});

test('text that is lost without any transparency is still said', async () => {
  const before = await pagesWith(() => ({ Font: { F0: font } }));
  const after = await pagesWith(() => ({}));
  assert.deepEqual(comparePages(before, after, { dpi: 300, transparency: transparencyOf(NONE) }), [{ ...still(1), textLost: true }]);
});

test('a page count that changed is refused', async () => {
  const before = await pagesWith(() => ({}), () => ({}));
  const after = await pagesWith(() => ({}));
  assert.throws(
    () => comparePages(before, after, { dpi: 300, transparency: transparencyOf(NONE, NONE) }),
    /^Error: Ghostscript wrote 1 page\(s\) where 2 were expected\.$/,
  );
});
