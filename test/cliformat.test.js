// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { readFormat, writeExport } from '../src/cliformat.js';
import { GHOSTSCRIPT_MISSING } from '../src/ghostscript.js';
import { hasGhostscript, withoutGhostscript } from './helpers/ghostscript.js';

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'cliformat.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('without --format the format is x4, and Ghostscript is not looked for', async (t) => {
  withoutGhostscript(t);
  assert.deepEqual(await readFormat({}, 'poster.pdf'), { format: 'x4', dpi: undefined });
  assert.deepEqual(await readFormat({ format: 'x4' }, 'poster.pdf'), { format: 'x4', dpi: undefined });
});

test('a format or a resolution that is not one is explained in one plain line', async () => {
  const cases = [
    [{ format: 'x2' }, 'poster.pdf', /^--format takes one of x4, x1a, x3, tiff\.$/],
    [{ format: '' }, 'poster.pdf', /^--format takes one of x4, x1a, x3, tiff\.$/],
    [{ format: 'X1A' }, 'poster.pdf', /^--format takes one of/],
    [{ format: 'tiff', dpi: 'fine' }, 'poster.tif', /^--dpi takes a resolution in dots per inch from 72 to 2400, such as 300\.$/],
    [{ format: 'tiff', dpi: '' }, 'poster.tif', /^--dpi takes a resolution/],
    [{ format: 'tiff', dpi: '71' }, 'poster.tif', /^--dpi takes a resolution/],
    [{ format: 'tiff', dpi: '2401' }, 'poster.tif', /^--dpi takes a resolution/],
    [{ dpi: '300' }, 'poster.pdf', /^--dpi goes with --format x1a, x3 or tiff\.$/],
    [{ format: 'x4', dpi: '300' }, 'poster.pdf', /^--dpi goes with --format x1a, x3 or tiff\.$/],
    [{ format: 'tiff' }, 'poster.pdf', /^With --format tiff the output is a \.tif name, such as poster\.tif\.$/],
    [{ format: 'tiff' }, 'poster', /^With --format tiff the output is a \.tif name/],
  ];
  for (const [values, output, message] of cases) {
    await assert.rejects(readFormat(values, output), (error) => message.test(error.message) && !error.message.includes('\n'));
  }
});

test('another format without Ghostscript says how to install it', async (t) => {
  withoutGhostscript(t);
  for (const [format, output] of [['x1a', 'poster.pdf'], ['x3', 'poster.pdf'], ['tiff', 'poster.tif']]) {
    await assert.rejects(readFormat({ format }, output), (error) => error.message === GHOSTSCRIPT_MISSING);
  }
});

test('with Ghostscript the other formats are read, with the resolution as a number', { skip: !hasGhostscript }, async () => {
  assert.deepEqual(await readFormat({ format: 'x1a' }, 'poster.pdf'), { format: 'x1a', dpi: undefined });
  assert.deepEqual(await readFormat({ format: 'x3', dpi: '600' }, 'poster.pdf'), { format: 'x3', dpi: 600 });
  assert.deepEqual(await readFormat({ format: 'tiff', dpi: '72' }, 'poster.tif'), { format: 'tiff', dpi: 72 });
  assert.deepEqual(await readFormat({ format: 'tiff' }, 'POSTER.TIFF'), { format: 'tiff', dpi: undefined });
});

test('a PDF is written at the output path', async (t) => {
  const folder = await scratchFolder(t);
  const output = join(folder, 'poster.pdf');
  assert.equal(await writeExport(output, [Buffer.from('a pdf')], 'x1a'), `Wrote ${output}.`);
  assert.equal(await readFile(output, 'utf8'), 'a pdf');
  assert.deepEqual(await readdir(folder), ['poster.pdf']);
});

test('TIFF pages are written under numbered names, and the line says which', async (t) => {
  const folder = await scratchFolder(t);
  const output = join(folder, 'poster.tif');
  const pages = [Buffer.from('one'), Buffer.from('two'), Buffer.from('three')];
  assert.equal(
    await writeExport(output, pages, 'tiff'),
    `Wrote 3 pages, ${join(folder, 'poster-1.tif')} to ${join(folder, 'poster-3.tif')}.`,
  );
  assert.deepEqual((await readdir(folder)).sort(), ['poster-1.tif', 'poster-2.tif', 'poster-3.tif']);
  assert.equal(await readFile(join(folder, 'poster-2.tif'), 'utf8'), 'two');
});

test('a single TIFF page is still numbered', async (t) => {
  const folder = await scratchFolder(t);
  const output = join(folder, 'cover.tif');
  assert.equal(await writeExport(output, [Buffer.from('one')], 'tiff'), `Wrote ${join(folder, 'cover-1.tif')}.`);
  assert.deepEqual(await readdir(folder), ['cover-1.tif']);
});
