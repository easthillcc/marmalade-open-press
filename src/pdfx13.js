// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { randomBytes } from 'node:crypto';
import { PDFArray, PDFDict, PDFHexString, PDFRef, PDFString } from 'pdf-lib';
import { name } from './pdf.js';
import { addOutputIntent } from './pdfx.js';
import { PRODUCER } from './version.js';

/**
 * What each standard asks the Info dictionary to say. PDF/X-1a states its conformance in a second key;
 * PDF/X-3 has no such key.
 */
const LABELS = {
  x1a: { version: 'PDF/X-1:2001', conformance: 'PDF/X-1a:2001' },
  x3: { version: 'PDF/X-3:2002', conformance: undefined },
};

/**
 * Turns the file Ghostscript wrote into PDF/X-1a or PDF/X-3.
 * @param {import('pdf-lib').PDFDocument} doc The file Ghostscript wrote, loaded.
 * @param {'x1a' | 'x3'} format
 * @param {import('./facts.js').Facts} facts What the PDF/X-4 said about itself.
 * @returns {void}
 */
export function dressAsPdfX13(doc, format, facts) {
  if (!Object.hasOwn(LABELS, format)) throw new Error('Only x1a and x3 are dressed as PDF 1.3.');
  const label = LABELS[format];
  setInfo(doc, label, facts);
  replaceOutputIntent(doc, facts.profile);
  removeMetadata(doc);
  addTrailerId(doc);
  setBoxes(doc, facts.boxes);
  removeAnnotations(doc);
}

/**
 * Writes the title, dates and the keys that name the standard. Ghostscript's own producer and label are replaced.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{version: string, conformance: string | undefined}} label
 * @param {import('./facts.js').Facts} facts
 * @returns {void}
 */
function setInfo(doc, label, facts) {
  doc.setTitle(facts.title);
  if (facts.creator !== undefined) doc.setCreator(facts.creator);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(facts.created);
  doc.setModificationDate(new Date());
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(name('Trapped'), name('False'));
  info.set(name('GTS_PDFXVersion'), PDFString.of(label.version));
  if (label.conformance === undefined) {
    info.delete(name('GTS_PDFXConformance'));
  } else {
    info.set(name('GTS_PDFXConformance'), PDFString.of(label.conformance));
  }
}

/**
 * Writes our output intent. Ghostscript 10.06 writes none with the arguments flatten() gives, but another version,
 * or a run with PDFX_def.ps, may, so any intent found is deleted first. pdf-lib writes every object of the context
 * into the file, even one that nothing names any more, so the old intent and its profile are deleted, or they stay
 * in the file.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{bytes: Uint8Array, description: string}} profile
 * @returns {void}
 */
function replaceOutputIntent(doc, profile) {
  const intents = doc.catalog.lookup(name('OutputIntents'));
  if (intents instanceof PDFArray) {
    for (const item of intents.asArray()) {
      const intent = doc.context.lookup(item);
      if (intent instanceof PDFDict) {
        const embedded = intent.get(name('DestOutputProfile'));
        if (embedded instanceof PDFRef) doc.context.delete(embedded);
      }
      if (item instanceof PDFRef) doc.context.delete(item);
    }
  }
  addOutputIntent(doc, profile);
}

/**
 * PDF/X-1a and PDF/X-3 ask for no XMP packet, and one that is there could only disagree with Info.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {void}
 */
function removeMetadata(doc) {
  const metadata = doc.catalog.get(name('Metadata'));
  if (metadata instanceof PDFRef) doc.context.delete(metadata);
  doc.catalog.delete(name('Metadata'));
}

/**
 * Ghostscript writes a trailer ID, and PDF/X requires one. An ID that is there is left exactly as it is.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {void}
 */
function addTrailerId(doc) {
  if (doc.context.trailerInfo.ID) return;
  const id = PDFHexString.of(randomBytes(16).toString('hex'));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
}

/**
 * A link is a printable annotation in the trim area, and PDF/X-1a and PDF/X-3 refuse one there. The annotations
 * are removed with the objects they point to, or pdf-lib would write those objects into the file anyway.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {void}
 */
function removeAnnotations(doc) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(name('Annots'));
    if (annots instanceof PDFArray) {
      for (const item of annots.asArray()) {
        if (item instanceof PDFRef) doc.context.delete(item);
      }
    }
    page.node.delete(name('Annots'));
  }
}

/**
 * Gives each page the boxes of the PDF/X-4. PDF/X allows a trim box or an art box, never both, and the crop box
 * would only repeat the media box, so the art box and the crop box are removed.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{media: Box, trim: Box, bleed: Box}[]} boxes One entry per page.
 * @returns {void}
 */
function setBoxes(doc, boxes) {
  const pages = doc.getPages();
  if (pages.length !== boxes.length) {
    throw new Error(`Ghostscript wrote ${pages.length} page(s) where ${boxes.length} were expected.`);
  }
  pages.forEach((page, index) => {
    const { media, trim, bleed } = boxes[index];
    page.setMediaBox(media.x, media.y, media.width, media.height);
    page.setBleedBox(bleed.x, bleed.y, bleed.width, bleed.height);
    page.setTrimBox(trim.x, trim.y, trim.width, trim.height);
    page.node.delete(name('ArtBox'));
    page.node.delete(name('CropBox'));
  });
}

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Box
 */
