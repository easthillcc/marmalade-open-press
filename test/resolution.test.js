// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { lowestResolution } from '../src/resolution.js';

/**
 * One page for each source given, each able to draw one image of 2 x 2 pixels (Im0) and a form (Fm0) that
 * draws that image at 36 pt under a Matrix that doubles it.
 */
async function drawn(...pageSources) {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const image = context.register(
    context.flateStream(new Uint8Array(2 * 2 * 3), {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }),
  );
  const form = context.register(
    context.flateStream('q 36 0 0 36 0 0 cm /Im0 Do Q', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Matrix: [2, 0, 0, 2, 0, 0], Resources: { XObject: { Im0: image } },
    }),
  );
  for (const source of pageSources) {
    const page = doc.addPage([200, 100]);
    page.node.set(PDFName.of('Resources'), context.obj({ XObject: { Im0: image, Fm0: form } }));
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(source)));
  }
  return { doc: await PDFDocument.load(await doc.save()), image: image.objectNumber };
}

test('the resolution is the pixels over the inches the image is placed at', async () => {
  const { doc, image } = await drawn('q 36 0 0 36 0 0 cm /Im0 Do Q');
  assert.deepEqual(lowestResolution(doc), { ppi: 4, image, page: 1 });
});

test('the lower of the two directions counts', async () => {
  const { doc } = await drawn('q 72 0 0 18 0 0 cm /Im0 Do Q');
  assert.equal(lowestResolution(doc).ppi, 2);
});

test('the lowest placement on any page wins, and its page is named', async () => {
  const { doc, image } = await drawn('q 36 0 0 36 0 0 cm /Im0 Do Q', 'q 144 0 0 72 0 0 cm /Im0 Do Q');
  assert.deepEqual(lowestResolution(doc), { ppi: 1, image, page: 2 });
});

test('a form is followed, with its Matrix and the matrix it is drawn under', async () => {
  // 36 pt in the form, doubled by its Matrix and halved by the page: 36 pt, half an inch, so 4 ppi.
  const { doc } = await drawn('q 0.5 0 0 0.5 0 0 cm /Fm0 Do Q');
  assert.equal(lowestResolution(doc).ppi, 4);
  const { doc: scaled } = await drawn('q 2 0 0 2 0 0 cm /Fm0 Do Q');
  assert.equal(lowestResolution(scaled).ppi, 1);
});

test('a rotated or flipped image is measured along its own sides', async () => {
  const { doc } = await drawn('q 0 72 -72 0 72 0 cm /Im0 Do Q');
  assert.equal(lowestResolution(doc).ppi, 2);
  const { doc: flipped } = await drawn('q 36 0 0 -36 0 36 cm /Im0 Do Q');
  assert.equal(lowestResolution(flipped).ppi, 4);
});

test('q and Q restore the matrix', async () => {
  const { doc } = await drawn('q 4 0 0 4 0 0 cm Q 36 0 0 36 0 0 cm /Im0 Do');
  assert.equal(lowestResolution(doc).ppi, 4);
});

test('no image drawn gives null, and an inline image ends the reading of its stream', async () => {
  const { doc } = await drawn('0 0 1 rg 0 0 10 10 re f');
  assert.equal(lowestResolution(doc), null);
  const { doc: inline } = await drawn('q 72 0 0 72 0 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \x00\x00\x00 EI Q q 36 0 0 36 0 0 cm /Im0 Do Q');
  assert.equal(lowestResolution(inline), null);
});
