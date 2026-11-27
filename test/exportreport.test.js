// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportWarning, formatExportReport } from '../src/exportreport.js';

const still = (page, imagesAdded = 0) => ({ page, flattened: false, share: 0, textLost: false, imagesAdded });
const flat = (page, { share = 1, textLost = true } = {}) => ({ page, flattened: true, share, textLost, imagesAdded: 1 });

const report = (overrides = {}) => ({
  format: 'x1a',
  pages: 1,
  dpi: 300,
  ghostscript: '10.06.0',
  transparency: [{ page: 1, kinds: [] }],
  pixels: [still(1)],
  ...overrides,
});

test('a PDF/X-4 has nothing to add', () => {
  const x4 = report({ format: 'x4', dpi: null, ghostscript: null, pixels: [] });
  assert.equal(formatExportReport(x4), '');
  assert.equal(exportWarning(x4), null);
});

test('a page without transparency is said to be left alone', () => {
  assert.equal(
    formatExportReport(report()),
    ['Format: PDF/X-1a:2001, written by Ghostscript 10.06.0', 'Transparency: none', 'Flattened to pixels: none'].join('\n'),
  );
  assert.equal(exportWarning(report()), null);
});

test('transparency is listed page by page, with what was flattened and where text became pixels', () => {
  const flattened = report({
    format: 'x3',
    pages: 3,
    dpi: 150,
    transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity', 'transparency group'] }, { page: 3, kinds: ['soft mask'] }],
    pixels: [still(1), flat(2, { share: 0.9984 }), flat(3, { textLost: false })],
  });
  assert.equal(
    formatExportReport(flattened),
    [
      'Format: PDF/X-3:2002, written by Ghostscript 10.06.0',
      'Transparency: page 2 (opacity, transparency group), page 3 (soft mask)',
      'Flattened to pixels at 150 dpi: page 2 (100% of the page), page 3 (100% of the page)',
      'Text turned to pixels: page 2',
    ].join('\n'),
  );
  assert.equal(
    exportWarning(flattened),
    'Transparency was flattened, and the text of 1 page became pixels. Run again with --check to see where.',
  );
});

test('images that Ghostscript added to a page it did not flatten are counted', () => {
  const added = report({ pages: 2, transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity'] }], pixels: [still(1, 2), flat(2)] });
  assert.equal(
    formatExportReport(added),
    [
      'Format: PDF/X-1a:2001, written by Ghostscript 10.06.0',
      'Transparency: page 2 (opacity)',
      'Flattened to pixels at 300 dpi: page 2 (100% of the page)',
      'Images added by Ghostscript: page 1 (2)',
      'Text turned to pixels: page 2',
    ].join('\n'),
  );
});

test('the warning counts the pages, and has no line break', () => {
  const two = report({ pages: 2, pixels: [flat(1), flat(2)] });
  assert.equal(
    exportWarning(two),
    'Transparency was flattened, and the text of 2 pages became pixels. Run again with --check to see where.',
  );
  assert.equal(exportWarning(two).includes('\n'), false);
});

test('a TIFF is one line: every page is pixels by nature', () => {
  const tiff = (pages) => report({ format: 'tiff', pages, pixels: [], transparency: [{ page: 1, kinds: ['opacity'] }] });
  assert.equal(formatExportReport(tiff(1)), 'Format: CMYK TIFF, 1 page at 300 dpi, drawn by Ghostscript 10.06.0');
  assert.equal(formatExportReport(tiff(12)), 'Format: CMYK TIFF, 12 pages at 300 dpi, drawn by Ghostscript 10.06.0');
  assert.equal(exportWarning(tiff(1)), null);
});
