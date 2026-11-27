// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFacts } from '../src/facts.js';
import { asPdf16, dressAsPdfX4 } from '../src/pdfx.js';

/** Enough of a profile for the output intent: only its bytes and its description are read. */
const profile = { bytes: Buffer.from('not a real profile'), description: 'Example Coated (v2)' };

/** A two-page PDF/X-4, dressed and saved as convert does, then loaded again. */
async function x4({ title, bleed = 0 } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 100]);
  doc.addPage([300, 150]);
  if (title) doc.setTitle(title);
  doc.setCreator('Chromium');
  doc.setCreationDate(new Date('2026-03-14T18:30:00Z'));
  dressAsPdfX4(doc, { profile, bleed });
  return PDFDocument.load(asPdf16(await doc.save()), { updateMetadata: false });
}

test('readFacts carries the title, the creator and the creation date', async () => {
  const facts = readFacts(await x4({ title: 'Night walks' }));
  assert.equal(facts.title, 'Night walks');
  assert.equal(facts.creator, 'Chromium');
  assert.deepEqual(facts.created, new Date('2026-03-14T18:30:00Z'));
});

test('readFacts reads the output profile back, byte for byte, with its name', async () => {
  const facts = readFacts(await x4());
  assert.equal(facts.profile.bytes.toString(), 'not a real profile');
  assert.equal(facts.profile.description, 'Example Coated (v2)');
});

test('readFacts lists the three boxes of every page', async () => {
  const facts = readFacts(await x4({ bleed: 3 }));
  const inset = (3 * 72) / 25.4;
  assert.equal(facts.boxes.length, 2);
  assert.deepEqual(facts.boxes[0].media, { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(facts.boxes[0].bleed, { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(facts.boxes[1].media, { x: 0, y: 0, width: 300, height: 150 });
  const { trim } = facts.boxes[1];
  for (const [actual, expected] of [[trim.x, inset], [trim.y, inset], [trim.width, 300 - 2 * inset], [trim.height, 150 - 2 * inset]]) {
    assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} is not ${expected}`);
  }
});

test('a PDF with no title is Untitled, as in the PDF/X-4', async () => {
  assert.equal(readFacts(await x4()).title, 'Untitled');
});

test('a PDF that names no output profile is refused in plain words', async () => {
  const plain = await PDFDocument.create();
  plain.addPage([200, 100]);
  assert.throws(() => readFacts(plain), /^Error: This PDF names no output profile\. Give it the PDF that convert returned\.$/);

  const emptied = await x4();
  emptied.catalog.set(PDFName.of('OutputIntents'), emptied.context.obj([]));
  assert.throws(() => readFacts(emptied), /names no output profile/);
});
