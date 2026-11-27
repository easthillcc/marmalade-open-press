// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { flatten, pdfwriteArgs } from '../src/flatten.js';
import { readStream } from '../src/pdf.js';
import { openProfile } from '../src/profile.js';
import { hasGhostscript } from './helpers/ghostscript.js';

const n = (text) => PDFName.of(text);

/** A CMYK PDF of two pages with a black square and a word. Page 2 also has a half-opaque veil over the whole page. */
async function cmykPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const veiled of [false, true]) {
    const page = doc.addPage([144, 72]);
    const veil = veiled ? { ExtGState: { G0: { ca: 0.5 } } } : {};
    page.node.set(n('Resources'), doc.context.obj({ Font: { F1: font.ref }, ...veil }));
    const content = `0 0 0 1 k 0 0 72 72 re f BT /F1 10 Tf 80 30 Td (Hi) Tj ET${veiled ? ' /G0 gs 0 1 0 0 k 0 0 144 72 re f' : ''}`;
    page.node.set(n('Contents'), doc.context.register(doc.context.flateStream(content)));
  }
  return doc.save();
}

test('the arguments ask pdfwrite for PDF 1.3 in CMYK, and name only files of the scratch folder', () => {
  assert.deepEqual(pdfwriteArgs('x1a', 300), [
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dPDFX=1',
    '-dCompatibilityLevel=1.3',
    '-sColorConversionStrategy=CMYK',
    '-dPDFSETTINGS=/prepress',
    '-dUCRandBGInfo=/Remove',
    '-r300',
    '-dAutoRotatePages=/None',
    '-dAutoFilterColorImages=false',
    '-dColorImageFilter=/FlateEncode',
    '-dAutoFilterGrayImages=false',
    '-dGrayImageFilter=/FlateEncode',
    '-dDownsampleColorImages=false',
    '-dDownsampleGrayImages=false',
    '-dDownsampleMonoImages=false',
    '--permit-file-read=profile.icc',
    '-sDefaultCMYKProfile=profile.icc',
    '-sOutputICCProfile=profile.icc',
    '-sOutputFile=output.pdf',
    'input.pdf',
  ]);
});

test('x3 and another resolution change only their own two arguments', () => {
  const x1a = pdfwriteArgs('x1a', 300);
  const x3 = pdfwriteArgs('x3', 600);
  assert.equal(x3.length, x1a.length);
  const changed = x3.filter((argument, index) => argument !== x1a[index]);
  assert.deepEqual(changed, ['-dPDFX=3', '-r600']);
});

test('the input file is the last argument, after every option', () => {
  const args = pdfwriteArgs('x1a', 300);
  assert.equal(args.at(-1), 'input.pdf');
  assert.ok(args.slice(0, -1).every((argument) => argument.startsWith('-')));
});

test('a format that is not PDF 1.3 is refused', async () => {
  for (const format of ['x4', 'tiff', 'toString']) {
    await assert.rejects(flatten(new Uint8Array(), format, { profile: new Uint8Array(), dpi: 300 }), /^Error: Only x1a and x3 are flattened\.$/);
  }
});

test('Ghostscript keeps an opaque page as text and vectors, and draws a page with transparency as one image', { skip: !hasGhostscript }, async () => {
  const profile = await openProfile();
  const flat = await flatten(await cmykPdf(), 'x1a', { profile: profile.bytes, dpi: 150 });
  assert.equal(flat.toString('latin1', 0, 8), '%PDF-1.3');
  const doc = await PDFDocument.load(flat, { updateMetadata: false });
  const [first, second] = doc.getPages();

  const source = readStream(first.node.Contents()).toString('latin1');
  assert.match(source, /(^|\s)0 0 0 1 k\s/);
  assert.match(source, /Tj|TJ/);
  assert.ok(first.node.Resources().has(n('Font')));

  const resources = second.node.Resources();
  assert.equal(resources.has(n('Font')), false);
  assert.equal(resources.has(n('ExtGState')), false);
  const images = resources.lookup(n('XObject')).values().map((ref) => doc.context.lookup(ref));
  assert.equal(images.length, 1);
  assert.equal(images[0].dict.get(n('ColorSpace')), n('DeviceCMYK'));
  assert.equal(images[0].dict.lookup(n('Width')).asNumber(), 300);
  assert.equal(images[0].dict.lookup(n('Height')).asNumber(), 150);
});
