// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonError, jsonReport } from '../src/jsonreport.js';
import { VERSION } from '../src/version.js';

const report = {
  profile: 'Example Coated',
  standIn: false,
  vectors: 24,
  neutrals: 20,
  tableHits: 2,
  images: 3,
  maxInk: 223.52941176470588,
  left: [],
  trim: { width: 49.99999999999999, height: 210 },
  bleed: 3,
  lowestPpi: { ppi: 312.44444, image: 12, page: 1 },
  type3Fonts: [],
};

const KEYS = [
  'tool', 'version', 'ok', 'exitCode', 'format', 'files', 'profile', 'standIn', 'trim', 'bleed', 'vectors', 'neutrals',
  'tableHits', 'images', 'maxInk', 'lowestPpi', 'type3Fonts', 'left', 'rgbLeft', 'warnings', 'export',
];

test('a clean run is ok, with every field in a fixed order and the numbers rounded', () => {
  const json = jsonReport({ report, exported: null, format: 'x4', files: ['/tmp/poster.pdf'], exitCode: 0 });
  assert.deepEqual(Object.keys(json), KEYS);
  assert.deepEqual(json, {
    tool: 'Marmalade Open Press',
    version: VERSION,
    ok: true,
    exitCode: 0,
    format: 'x4',
    files: ['/tmp/poster.pdf'],
    profile: 'Example Coated',
    standIn: false,
    trim: { width: 50, height: 210 },
    bleed: 3,
    vectors: 24,
    neutrals: 20,
    tableHits: 2,
    images: 3,
    maxInk: 223.53,
    lowestPpi: { ppi: 312.4, image: 12, page: 1 },
    type3Fonts: [],
    left: [],
    rgbLeft: [],
    warnings: [],
    export: null,
  });
  // It is printed as JSON, so it must survive the trip.
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json);
});

test('RGB left is listed and is not ok, whatever the exit code, which is 1 only with --check', () => {
  const left = [
    { what: 'shading of type 2, function of type 0: sampled functions are not converted', rgb: true },
    { what: 'image 14: not an RGB image', rgb: false },
  ];
  const run = { report: { ...report, left }, exported: null, format: 'x4', files: ['/tmp/a.pdf'] };
  const checked = jsonReport({ ...run, exitCode: 1 });
  assert.equal(checked.ok, false);
  assert.equal(checked.exitCode, 1);
  assert.deepEqual(checked.rgbLeft, ['shading of type 2, function of type 0: sampled functions are not converted']);
  assert.deepEqual(checked.left, left);
  const unchecked = jsonReport({ ...run, exitCode: 0 });
  assert.equal(unchecked.ok, false);
  assert.equal(unchecked.exitCode, 0);
});

test('warnings carry a code and a sentence, and never change ok or the exit code', () => {
  const soft = { ...report, standIn: true, lowestPpi: { ppi: 245.8, image: 8, page: 2 }, type3Fonts: ['Emoji'] };
  const json = jsonReport({ report: soft, exported: null, format: 'x4', files: [], exitCode: 0 });
  assert.equal(json.ok, true);
  assert.equal(json.exitCode, 0);
  assert.deepEqual(json.warnings, [
    {
      code: 'stand-in-profile',
      message: 'The profile is a stand-in, not for press. Ask your printer for theirs and give it as the profile.',
    },
    { code: 'low-resolution', message: 'Image 8 prints at 246 ppi, below 300.' },
    { code: 'type3-fonts', message: 'Type 3 fonts, which some printers refuse: Emoji.' },
  ]);
  assert.equal(jsonReport({ report: { ...report, lowestPpi: null }, exported: null, format: 'x4', files: [], exitCode: 0 }).lowestPpi, null);
  // Compared rounded: 299.6 ppi reads as 300, which is not below 300.
  const codes = (ppi) => jsonReport({ report: { ...report, lowestPpi: { ppi, image: 3, page: 1 } }, exported: null, format: 'x4', files: [], exitCode: 0 }).warnings.map((warning) => warning.code);
  assert.deepEqual(codes(299.6), []);
  assert.deepEqual(codes(299.4), ['low-resolution']);
});

test('another format adds its own report, and a warning when text became pixels', () => {
  const exported = {
    format: 'x1a',
    pages: 2,
    dpi: 300,
    ghostscript: '10.06.0',
    transparency: [{ page: 1, kinds: [] }, { page: 2, kinds: ['opacity', 'transparency group'] }],
    pixels: [
      { page: 1, flattened: false, share: 0, textLost: false, imagesAdded: 0 },
      { page: 2, flattened: true, share: 1, textLost: true, imagesAdded: 1 },
    ],
  };
  const json = jsonReport({ report, exported, format: 'x1a', files: ['/tmp/two.pdf'], exitCode: 0 });
  assert.equal(json.format, 'x1a');
  assert.deepEqual(json.export, exported);
  assert.deepEqual(json.warnings, [
    { code: 'text-to-pixels', message: 'Transparency was flattened, and the text became pixels on page 2.' },
  ]);
  assert.equal(json.ok, true);
});

test('a failed run is an error with exit code 2', () => {
  assert.deepEqual(jsonError('Cannot read no-such-page.html.'), {
    tool: 'Marmalade Open Press',
    version: VERSION,
    ok: false,
    exitCode: 2,
    error: 'Cannot read no-such-page.html.',
  });
});
