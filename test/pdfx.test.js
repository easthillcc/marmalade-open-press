// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { asPdf16, dressAsPdfX4, xmpPacket } from '../src/pdfx.js';
import { PRODUCER } from '../src/version.js';

/** Enough of a profile for the output intent: pdfx.js only reads its bytes and its description. */
const profile = { bytes: Buffer.from('not a real profile'), description: 'Example Coated (v2)' };

const packet = (overrides = {}) =>
  xmpPacket({
    title: 'Night walks',
    producer: 'A press',
    created: new Date('2026-03-14T18:30:00.500Z'),
    modified: new Date('2026-03-15T09:00:00Z'),
    documentId: 'uuid:1111',
    instanceId: 'uuid:2222',
    ...overrides,
  });

/** Dresses a new document, saves it as the tool does and loads the result. */
async function dressed({ title, bleed = 0, size = [200, 100] } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage(size);
  doc.addPage(size);
  if (title) doc.setTitle(title);
  dressAsPdfX4(doc, { profile, bleed });
  const bytes = asPdf16(await doc.save());
  return { bytes, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
}

const text = (dict, key) => dict.lookup(PDFName.of(key)).decodeText();

test('xmpPacket states PDF/X-4 and carries the facts it is given', () => {
  const xmp = packet();
  assert.ok(xmp.startsWith('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'));
  assert.ok(xmp.endsWith('<?xpacket end="w"?>'));
  assert.match(xmp, /<pdfxid:GTS_PDFXVersion>PDF\/X-4<\/pdfxid:GTS_PDFXVersion>/);
  assert.match(xmp, /<dc:title>\s*<rdf:Alt>\s*<rdf:li xml:lang="x-default">Night walks<\/rdf:li>\s*<\/rdf:Alt>\s*<\/dc:title>/);
  assert.match(xmp, /<xmp:CreateDate>2026-03-14T18:30:00Z<\/xmp:CreateDate>/);
  assert.match(xmp, /<xmp:ModifyDate>2026-03-15T09:00:00Z<\/xmp:ModifyDate>/);
  assert.match(xmp, /<xmp:MetadataDate>2026-03-15T09:00:00Z<\/xmp:MetadataDate>/);
  assert.match(xmp, /<xmpMM:DocumentID>uuid:1111<\/xmpMM:DocumentID>/);
  assert.match(xmp, /<xmpMM:InstanceID>uuid:2222<\/xmpMM:InstanceID>/);
  assert.match(xmp, /<xmpMM:VersionID>1<\/xmpMM:VersionID>/);
  assert.match(xmp, /<xmpMM:RenditionClass>default<\/xmpMM:RenditionClass>/);
  assert.match(xmp, /<pdf:Producer>A press<\/pdf:Producer>/);
  assert.match(xmp, /<pdf:Trapped>False<\/pdf:Trapped>/);
  assert.equal(xmp.includes('<xmp:CreatorTool>'), false);
  for (const prefix of ['x', 'rdf', 'dc', 'xmp', 'xmpMM', 'pdf', 'pdfxid']) assert.ok(xmp.includes(`xmlns:${prefix}="`), prefix);
});

test('xmpPacket carries the Info creator as CreatorTool so that Info and XMP agree', () => {
  assert.ok(packet({ creator: 'Chromium' }).includes('<xmp:CreatorTool>Chromium</xmp:CreatorTool>'));
});

test('xmpPacket escapes what XML would misread', () => {
  const xmp = packet({ title: 'Fish & <chips>', producer: 'R&D' });
  assert.ok(xmp.includes('>Fish &amp; &lt;chips&gt;</rdf:li>'));
  assert.ok(xmp.includes('<pdf:Producer>R&amp;D</pdf:Producer>'));
});

test('asPdf16 turns the header into PDF 1.6 and refuses what is not a PDF', () => {
  const bytes = new Uint8Array(Buffer.from('%PDF-1.7\n%rest', 'latin1'));
  const result = asPdf16(bytes);
  assert.equal(result, bytes);
  assert.equal(Buffer.from(result).toString('latin1'), '%PDF-1.6\n%rest');
  assert.throws(() => asPdf16(new Uint8Array(Buffer.from('<html></html>'))), /PDF/);
});

test('a dressed document says what it is: header, Info, trailer ID', async () => {
  const { bytes, doc } = await dressed({ title: 'Night walks' });
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString('latin1'), '%PDF-1.6');

  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  assert.equal(doc.getTitle(), 'Night walks');
  assert.equal(doc.getProducer(), PRODUCER);
  assert.equal(info.get(PDFName.of('Trapped')), PDFName.of('False'));
  assert.equal(text(info, 'GTS_PDFXVersion'), 'PDF/X-4');
  assert.ok(doc.getCreationDate() instanceof Date);
  assert.ok(doc.getModificationDate() instanceof Date);

  const id = doc.context.lookup(doc.context.trailerInfo.ID, PDFArray);
  assert.equal(id.size(), 2);
  assert.match(id.get(0).toString(), /^<[0-9a-f]{32}>$/i);
});

test('a document with no title is called Untitled', async () => {
  const { doc } = await dressed();
  assert.equal(doc.getTitle(), 'Untitled');
});

test('the output intent names the profile and embeds it with four components', async () => {
  const { doc } = await dressed();
  const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
  assert.equal(intents.size(), 1);
  const intent = intents.lookup(0, PDFDict);
  assert.equal(intent.get(PDFName.of('Type')), PDFName.of('OutputIntent'));
  assert.equal(intent.get(PDFName.of('S')), PDFName.of('GTS_PDFX'));
  assert.equal(text(intent, 'OutputConditionIdentifier'), 'Example Coated (v2)');
  assert.equal(text(intent, 'Info'), 'Example Coated (v2)');
  const embedded = intent.lookup(PDFName.of('DestOutputProfile'), PDFRawStream);
  assert.equal(embedded.dict.lookup(PDFName.of('N')).asNumber(), 4);
  assert.equal(inflateSync(embedded.contents).toString(), 'not a real profile');
});

test('the XMP metadata is an uncompressed XML stream that agrees with Info', async () => {
  const { doc } = await dressed({ title: 'Café & co' });
  const metadata = doc.catalog.lookup(PDFName.of('Metadata'), PDFRawStream);
  assert.equal(metadata.dict.get(PDFName.of('Type')), PDFName.of('Metadata'));
  assert.equal(metadata.dict.get(PDFName.of('Subtype')), PDFName.of('XML'));
  assert.equal(metadata.dict.has(PDFName.of('Filter')), false);
  const xmp = Buffer.from(metadata.contents).toString('utf8');
  assert.ok(xmp.includes('>Café &amp; co</rdf:li>'));
  assert.ok(xmp.includes(`<pdf:Producer>${PRODUCER}</pdf:Producer>`));
  assert.ok(xmp.includes(`<xmp:CreateDate>${doc.getCreationDate().toISOString().replace('.000Z', 'Z')}</xmp:CreateDate>`));
  assert.ok(xmp.includes(`<xmp:ModifyDate>${doc.getModificationDate().toISOString().replace('.000Z', 'Z')}</xmp:ModifyDate>`));
  assert.match(xmp, /<xmpMM:DocumentID>uuid:[0-9a-f-]{36}<\/xmpMM:DocumentID>/);
});

test('with no bleed the three boxes are the page', async () => {
  const { doc } = await dressed();
  for (const page of doc.getPages()) {
    const box = { x: 0, y: 0, width: 200, height: 100 };
    assert.deepEqual(page.getMediaBox(), box);
    assert.deepEqual(page.getBleedBox(), box);
    assert.deepEqual(page.getTrimBox(), box);
    assert.equal(page.node.has(PDFName.of('TrimBox')), true);
    assert.equal(page.node.has(PDFName.of('BleedBox')), true);
  }
});

test('a bleed in millimetres insets the trim box on every side of every page', async () => {
  const { doc } = await dressed({ bleed: 3 });
  const inset = (3 * 72) / 25.4;
  assert.equal(doc.getPages().length, 2);
  for (const page of doc.getPages()) {
    assert.deepEqual(page.getBleedBox(), { x: 0, y: 0, width: 200, height: 100 });
    const trim = page.getTrimBox();
    for (const [actual, expected] of [[trim.x, inset], [trim.y, inset], [trim.width, 200 - 2 * inset], [trim.height, 100 - 2 * inset]]) {
      assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} is not ${expected}`);
    }
  }
});

test('a bleed that leaves no page is refused', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([20, 20]);
  assert.throws(() => dressAsPdfX4(doc, { profile, bleed: 4 }), /bleed/);
});
