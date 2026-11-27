// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { asPdf13 } from '../src/pdfx.js';
import { dressAsPdfX13 } from '../src/pdfx13.js';
import { PRODUCER } from '../src/version.js';

const n = (text) => PDFName.of(text);

const facts = {
  title: 'Night walks',
  creator: 'Chromium',
  created: new Date('2026-03-14T18:30:00Z'),
  profile: { bytes: Buffer.from('not a real profile'), description: 'Example Coated (v2)' },
  boxes: [
    { media: { x: 0, y: 0, width: 200, height: 100 }, bleed: { x: 0, y: 0, width: 200, height: 100 }, trim: { x: 8.5, y: 8.5, width: 183, height: 83 } },
    { media: { x: 0, y: 0, width: 300, height: 150 }, bleed: { x: 0, y: 0, width: 300, height: 150 }, trim: { x: 8.5, y: 8.5, width: 283, height: 133 } },
  ],
};

/** A document as Ghostscript 10 leaves it: its own producer and label, an art box, no trim box, an output intent. */
async function fromGhostscript() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const { context } = doc;
  for (const size of [[200, 100], [300, 150]]) {
    const page = doc.addPage(size);
    page.node.set(n('ArtBox'), context.obj([0, 0, ...size]));
    page.node.set(n('CropBox'), context.obj([0, 0, ...size]));
  }
  doc.setProducer('GPL Ghostscript 10.06.0');
  const info = context.lookup(context.trailerInfo.Info, PDFDict);
  info.set(n('GTS_PDFXVersion'), PDFString.of('PDF/X-1a:2001'));
  info.set(n('GTS_PDFXConformance'), PDFString.of('left over'));
  const oldProfile = context.register(context.flateStream(Buffer.from('the profile Ghostscript embedded'), { N: 4 }));
  const oldIntent = context.register(context.obj({ Type: 'OutputIntent', S: 'GTS_PDFX', DestOutputProfile: oldProfile }));
  doc.catalog.set(n('OutputIntents'), context.obj([oldIntent]));
  doc.catalog.set(n('Metadata'), context.register(context.stream('<x/>', { Type: 'Metadata', Subtype: 'XML' })));
  return doc;
}

/** Dresses, saves as the tool does and loads the result. */
async function dressed(format, theFacts = facts) {
  const doc = await fromGhostscript();
  dressAsPdfX13(doc, format, theFacts);
  const bytes = asPdf13(await doc.save({ useObjectStreams: false }));
  return { bytes, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
}

const infoOf = (doc) => doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
const text = (dict, key) => dict.lookup(n(key)).decodeText();

test('PDF/X-1a says so in two keys, and the file is a plain PDF 1.3', async () => {
  const { bytes, doc } = await dressed('x1a');
  const source = Buffer.from(bytes).toString('latin1');
  assert.equal(source.slice(0, 8), '%PDF-1.3');
  assert.equal(source.includes('/ObjStm'), false);
  assert.equal(source.includes('/XRef'), false);
  const info = infoOf(doc);
  assert.equal(text(info, 'GTS_PDFXVersion'), 'PDF/X-1:2001');
  assert.equal(text(info, 'GTS_PDFXConformance'), 'PDF/X-1a:2001');
  assert.equal(info.get(n('Trapped')), n('False'));
});

test('PDF/X-3 says so in one key, and a conformance left by another tool goes', async () => {
  const info = infoOf((await dressed('x3')).doc);
  assert.equal(text(info, 'GTS_PDFXVersion'), 'PDF/X-3:2002');
  assert.equal(info.has(n('GTS_PDFXConformance')), false);
  assert.equal(info.get(n('Trapped')), n('False'));
});

test('the title, creator, producer and creation date are those of the PDF/X-4', async () => {
  const { doc } = await dressed('x1a');
  assert.equal(doc.getTitle(), 'Night walks');
  assert.equal(doc.getCreator(), 'Chromium');
  assert.equal(doc.getProducer(), PRODUCER);
  assert.deepEqual(doc.getCreationDate(), new Date('2026-03-14T18:30:00Z'));
  assert.ok(doc.getModificationDate() instanceof Date);
});

test('a PDF/X-4 without a creator leaves the creator alone', async () => {
  const { doc } = await dressed('x1a', { ...facts, creator: undefined });
  assert.equal(doc.getCreator(), undefined);
});

test('there is one output intent, with our profile, and the one Ghostscript wrote is gone from the file', async () => {
  const { bytes, doc } = await dressed('x1a');
  const intents = doc.catalog.lookup(n('OutputIntents'), PDFArray);
  assert.equal(intents.size(), 1);
  const intent = intents.lookup(0, PDFDict);
  assert.equal(intent.get(n('S')), n('GTS_PDFX'));
  assert.equal(text(intent, 'OutputConditionIdentifier'), 'Example Coated (v2)');
  assert.equal(text(intent, 'Info'), 'Example Coated (v2)');
  const embedded = intent.lookup(n('DestOutputProfile'), PDFRawStream);
  assert.equal(embedded.dict.lookup(n('N')).asNumber(), 4);
  assert.equal(inflateSync(embedded.contents).toString(), 'not a real profile');
  const profiles = [...doc.context.enumerateIndirectObjects()].filter(([, object]) => object instanceof PDFRawStream && object.dict.has(n('N')));
  assert.equal(profiles.length, 1);
  assert.equal(Buffer.from(bytes).toString('latin1').match(/\/OutputIntent\b/g).length, 1);
});

test('the XMP packet goes, from the catalog and from the file', async () => {
  const { bytes, doc } = await dressed('x3');
  assert.equal(doc.catalog.has(n('Metadata')), false);
  assert.equal(Buffer.from(bytes).toString('latin1').includes('/Subtype /XML'), false);
});

test('links are removed, with the annotation objects they point to', async () => {
  const doc = await fromGhostscript();
  const { context } = doc;
  const link = context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], F: 4, Border: [0, 0, 0] }));
  doc.getPages()[0].node.set(n('Annots'), context.obj([link]));
  dressAsPdfX13(doc, 'x1a', facts);
  const bytes = asPdf13(await doc.save({ useObjectStreams: false }));
  const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(loaded.getPages()[0].node.has(n('Annots')), false);
  assert.equal(Buffer.from(bytes).toString('latin1').includes('/Subtype /Link'), false);
});

test('a trailer ID is kept when there is one and written when there is none', async () => {
  const kept = await fromGhostscript();
  const id = kept.context.obj(['one', 'two']);
  kept.context.trailerInfo.ID = id;
  dressAsPdfX13(kept, 'x1a', facts);
  assert.equal(kept.context.trailerInfo.ID, id);

  const { doc } = await dressed('x1a');
  const written = doc.context.lookup(doc.context.trailerInfo.ID, PDFArray);
  assert.equal(written.size(), 2);
  assert.match(written.get(0).toString(), /^<[0-9a-f]{32}>$/i);
});

test('every page gets the boxes of the PDF/X-4, and loses its art box and crop box', async () => {
  const { doc } = await dressed('x1a');
  doc.getPages().forEach((page, index) => {
    assert.deepEqual(page.getMediaBox(), facts.boxes[index].media);
    assert.deepEqual(page.getBleedBox(), facts.boxes[index].bleed);
    assert.deepEqual(page.getTrimBox(), facts.boxes[index].trim);
    assert.equal(page.node.has(n('ArtBox')), false);
    assert.equal(page.node.has(n('CropBox')), false);
  });
});

test('a page count that changed, or a format that is not PDF 1.3, is refused', async () => {
  const doc = await fromGhostscript();
  assert.throws(() => dressAsPdfX13(doc, 'x1a', { ...facts, boxes: facts.boxes.slice(0, 1) }), /Ghostscript wrote 2 page\(s\) where 1 were expected\./);
  for (const format of ['x4', 'tiff', 'toString']) {
    assert.throws(() => dressAsPdfX13(doc, format, facts), /Only x1a and x3 are dressed as PDF 1\.3\./);
  }
});
