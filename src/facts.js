// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFHexString, PDFRawStream, PDFString } from 'pdf-lib';
import { name, readStream } from './pdf.js';

/** @typedef {{x: number, y: number, width: number, height: number}} Box */

/**
 * What another format must carry over from a PDF/X-4, because Ghostscript does not.
 * @typedef {object} Facts
 * @property {string} title
 * @property {string | undefined} creator
 * @property {Date} created
 * @property {{bytes: Buffer, description: string}} profile  The output profile, as the output intent holds it.
 * @property {{media: Box, trim: Box, bleed: Box}[]} boxes   The boxes of every page, in page order.
 */

// The one sentence for a PDF that convert did not write; tests match it word for word.
const NO_PROFILE_MESSAGE = 'This PDF names no output profile. Give it the PDF that convert returned.';

/**
 * The profile embedded in the first output intent, and the name the intent gives it.
 * Without a profile the other formats cannot be told what the colours mean, so the read stops here.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {{bytes: Buffer, description: string}}
 */
function outputProfile(doc) {
  const intents = doc.catalog.lookup(name('OutputIntents'));
  const intent = intents instanceof PDFArray && intents.size() > 0 ? intents.lookup(0) : undefined;
  const embedded = intent instanceof PDFDict ? intent.lookup(name('DestOutputProfile')) : undefined;
  if (!(embedded instanceof PDFRawStream)) throw new Error(NO_PROFILE_MESSAGE);

  const identifier = intent.lookup(name('OutputConditionIdentifier'));
  const description =
    identifier instanceof PDFHexString || identifier instanceof PDFString ? identifier.decodeText() : 'Custom';
  return { bytes: readStream(embedded), description };
}

/**
 * Reads the facts of a PDF/X-4 written by convert, so that a later step can write them back
 * after Ghostscript has rewritten the file.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Facts}
 */
export function readFacts(doc) {
  return {
    title: doc.getTitle() ?? 'Untitled',
    creator: doc.getCreator(),
    created: doc.getCreationDate() ?? new Date(),
    profile: outputProfile(doc),
    boxes: doc.getPages().map((page) => ({
      media: page.getMediaBox(),
      trim: page.getTrimBox(),
      bleed: page.getBleedBox(),
    })),
  };
}
