// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { randomBytes, randomUUID } from 'node:crypto';
import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { PRODUCER } from './version.js';

const POINTS_PER_MM = 72 / 25.4;

const NAMESPACES = [
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
  'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
  'xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
  'xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"',
].join(' ');

/**
 * @param {{title: string, producer: string, created: Date, modified: Date,
 *   documentId: string, instanceId: string, creator?: string}} facts
 *   `creator` is the Info /Creator; it goes in as xmp:CreatorTool so that Info and XMP agree.
 * @returns {string}
 */
export function xmpPacket({ title, producer, created, modified, documentId, instanceId, creator }) {
  const properties = [
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>`,
    element('xmp:CreateDate', isoSeconds(created)),
    element('xmp:ModifyDate', isoSeconds(modified)),
    element('xmp:MetadataDate', isoSeconds(modified)),
    ...(creator ? [element('xmp:CreatorTool', xmlEscape(creator))] : []),
    element('xmpMM:DocumentID', documentId),
    element('xmpMM:InstanceID', instanceId),
    element('xmpMM:VersionID', '1'),
    element('xmpMM:RenditionClass', 'default'),
    element('pdf:Producer', xmlEscape(producer)),
    element('pdf:Trapped', 'False'),
    element('pdfxid:GTS_PDFXVersion', 'PDF/X-4'),
  ];
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" ${NAMESPACES}>`,
    ...properties.map((property) => `  ${property}`),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

/**
 * Turns a document into PDF/X-4: Info keys, trailer ID, output intent, XMP and the three page boxes.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{profile: {bytes: Uint8Array, description: string}, bleed: number}} options
 * @returns {void}
 */
export function dressAsPdfX4(doc, { profile, bleed }) {
  const facts = setDocumentFacts(doc);
  setInfoKeys(doc);
  addTrailerId(doc);
  addOutputIntent(doc, profile);
  addMetadata(doc, facts);
  setBoxes(doc, bleed);
}

/**
 * Makes PDF/X-4 bytes PDF 1.6. pdf-lib always writes %PDF-1.7, and nothing this tool writes needs 1.7.
 * @param {Uint8Array} bytes A saved PDF.
 * @returns {Uint8Array} The same bytes, header set to %PDF-1.6.
 */
export function asPdf16(bytes) {
  if (Buffer.from(bytes.subarray(0, 7)).toString('latin1') !== '%PDF-1.') {
    throw new Error('This does not look like a PDF.');
  }
  bytes[7] = '6'.charCodeAt(0);
  return bytes;
}

/**
 * Sets the title, producer and dates, and returns them for the XMP packet.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {{title: string, created: Date, modified: Date, creator: string | undefined}}
 */
function setDocumentFacts(doc) {
  const title = doc.getTitle() ?? 'Untitled';
  const creator = doc.getCreator();
  const created = doc.getCreationDate() ?? new Date();
  const modified = new Date();
  doc.setTitle(title);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(created);
  doc.setModificationDate(modified);
  return { title, created, modified, creator };
}

/**
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {void}
 */
function setInfoKeys(doc) {
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
}

/**
 * Chromium writes no trailer /ID and PDF/X requires one. Any unique value will do for a new file.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {void}
 */
function addTrailerId(doc) {
  const id = PDFHexString.of(randomBytes(16).toString('hex'));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
}

/**
 * The profile is embedded so that a reader can check the colours without the profile on the machine.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{bytes: Uint8Array, description: string}} profile
 * @returns {void}
 */
function addOutputIntent(doc, profile) {
  const { context } = doc;
  const condition = PDFHexString.fromText(profile.description);
  const destination = context.register(context.flateStream(profile.bytes, { N: 4 }));
  doc.catalog.set(
    PDFName.of('OutputIntents'),
    context.obj([
      {
        Type: 'OutputIntent',
        S: 'GTS_PDFX',
        OutputConditionIdentifier: condition,
        Info: condition,
        DestOutputProfile: destination,
      },
    ]),
  );
}

/**
 * The XMP is encoded here and left uncompressed. A string given to context.stream is not written as UTF-8,
 * and any tool must be able to read the packet.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{title: string, created: Date, modified: Date, creator: string | undefined}} facts
 * @returns {void}
 */
function addMetadata(doc, { title, created, modified, creator }) {
  const { context } = doc;
  const xmp = xmpPacket({
    title,
    producer: PRODUCER,
    created,
    modified,
    creator,
    documentId: `uuid:${randomUUID()}`,
    instanceId: `uuid:${randomUUID()}`,
  });
  const stream = context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), context.register(stream));
}

/**
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {number} bleed Millimetres.
 * @returns {void}
 */
function setBoxes(doc, bleed) {
  const inset = bleed * POINTS_PER_MM;
  for (const page of doc.getPages()) setPageBoxes(page, inset);
}

/**
 * The media box is the bleed box, and the trim box is the media box inset on every side.
 * @param {import('pdf-lib').PDFPage} page
 * @param {number} inset Points.
 * @returns {void}
 */
function setPageBoxes(page, inset) {
  const { x, y, width, height } = page.getMediaBox();
  if (inset * 2 >= Math.min(width, height)) throw new Error('The bleed is larger than the page.');
  page.setBleedBox(x, y, width, height);
  page.setTrimBox(x + inset, y + inset, width - 2 * inset, height - 2 * inset);
}

/**
 * @param {Date} date
 * @returns {string} The date to the second, as XMP expects it.
 */
function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {string} name A qualified XML name such as 'xmp:CreateDate'.
 * @param {string} value Already escaped where needed.
 * @returns {string}
 */
function element(name, value) {
  return `<${name}>${value}</${name}>`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function xmlEscape(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
