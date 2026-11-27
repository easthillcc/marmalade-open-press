// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { VERSION } from '../src/version.js';
import { hasGhostscript } from './helpers/ghostscript.js';
import { LEAVING_RGB } from './helpers/rgbleft.js';

const poster = fileURLToPath(new URL('../examples/poster.html', import.meta.url));
const SMALL = '<style>@page { size: 50mm 50mm; margin: 0 }</style><p style="color: #333">Hello</p>';
const VEILED = '<style>@page { size: 50mm 50mm; margin: 0 }</style><p style="opacity: .5">Veiled</p>';

/** Runs the command line with its messages collected instead of printed. `steps` may replace render. */
async function runCollected(argv, steps) {
  const out = [];
  const err = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, steps);
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const open = (...argv) => runCollected(argv);
/** As open, with a PDF that leaves one shading in RGB in place of the page. */
const openLeavingRgb = (...argv) => runCollected(argv, LEAVING_RGB);

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'clijson.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('--help names --json and the mcp command', async () => {
  const { out } = await open('--help');
  assert.match(out, /^ {2}--json /m);
  assert.match(out, /^ {7}open-press mcp /m);
});

test('--json prints one JSON object with the whole report, and the lines for a person go to the error stream', async (t) => {
  const output = join(await scratchFolder(t), 'poster.pdf');
  const { code, out, err } = await open(poster, output, '--json', '--check', '--bleed', '3', '--colours', 'classic');
  assert.equal(code, 0);
  const json = JSON.parse(out);
  assert.equal(json.tool, 'Marmalade Open Press');
  assert.equal(json.version, VERSION);
  assert.equal(json.ok, true);
  assert.equal(json.exitCode, 0);
  assert.equal(json.format, 'x4');
  assert.deepEqual(json.files, [output]);
  assert.equal(json.standIn, true);
  assert.deepEqual(json.trim, { width: 148, height: 210 });
  assert.equal(json.bleed, 3);
  assert.equal(json.images, 3);
  assert.ok(json.vectors > 0 && json.neutrals > 0 && json.tableHits > 0);
  assert.ok(json.maxInk > 100 && json.maxInk <= 400);
  assert.equal(Math.round(json.lowestPpi.ppi), 246);
  assert.equal(json.lowestPpi.page, 1);
  assert.deepEqual(json.rgbLeft, []);
  assert.deepEqual(json.warnings.map((warning) => warning.code), ['stand-in-profile', 'low-resolution']);
  assert.equal(json.export, null);
  assert.match(err, /^No profile given/);
  assert.ok(err.includes(`Wrote ${output}.`));
  assert.ok(err.includes('RGB left: none'));
  assert.equal((await readFile(output)).toString('latin1', 0, 8), '%PDF-1.6');
});

test('--json without --check keeps exit code 0 when RGB is left, and says so in the JSON', async (t) => {
  const output = join(await scratchFolder(t), 'page.pdf');
  const unchecked = await openLeavingRgb('page.html', output, '--json');
  assert.equal(unchecked.code, 0);
  const json = JSON.parse(unchecked.out);
  assert.equal(json.ok, false);
  assert.equal(json.exitCode, 0);
  assert.equal(json.rgbLeft.length, 1);
  assert.equal(json.rgbLeft[0], 'shading of type 2, function of type 0: sampled functions are not converted');
  assert.match(unchecked.err, /Some colour was left in RGB/);
  assert.equal(unchecked.err.includes('RGB left:'), false);

  const checked = await openLeavingRgb('page.html', output, '--json', '--check');
  assert.equal(checked.code, 1);
  assert.equal(JSON.parse(checked.out).exitCode, 1);
});

test('with --json a failure is a JSON object too, with exit code 2', async () => {
  const cases = [
    [['no-such-page.html', 'never-written.local.pdf', '--json'], 'Cannot read no-such-page.html.'],
    [['a.html', 'b.pdf', '--json', '--chek'], 'Unknown option --chek. See open-press --help.'],
    [['a.html', 'b.pdf', '--json', '--bleed', '-3'], 'The bleed is a size in millimetres, 0 or more.'],
    [['only-one.html', '--json'], 'open-press takes an input and an output. See open-press --help.'],
  ];
  for (const [argv, message] of cases) {
    const { code, out } = await open(...argv);
    assert.equal(code, 2);
    assert.deepEqual(JSON.parse(out), { tool: 'Marmalade Open Press', version: VERSION, ok: false, exitCode: 2, error: message });
  }
  const usage = await open('only-one.html', '--json');
  assert.match(usage.err, /Usage: open-press/);
});

test('--json reports a flattened page of PDF/X-1a', { skip: !hasGhostscript }, async (t) => {
  const output = join(await scratchFolder(t), 'veiled.pdf');
  const { code, out } = await open(VEILED, output, '--json', '--format', 'x1a', '--dpi', '150');
  assert.equal(code, 0);
  const json = JSON.parse(out);
  assert.equal(json.format, 'x1a');
  assert.equal(json.export.dpi, 150);
  assert.match(json.export.ghostscript, /^\d+\.\d+/);
  assert.ok(json.export.transparency[0].kinds.includes('opacity'));
  assert.equal(json.export.pixels[0].textLost, true);
  assert.deepEqual(json.warnings.map((warning) => warning.code), ['stand-in-profile', 'text-to-pixels']);
});

test('--json lists every TIFF page by its full path', { skip: !hasGhostscript }, async (t) => {
  const folder = await scratchFolder(t);
  const { code, out } = await open(SMALL, join(folder, 'page.tif'), '--json', '--format', 'tiff', '--dpi', '100');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out).files, [join(folder, 'page-1.tif')]);
});
