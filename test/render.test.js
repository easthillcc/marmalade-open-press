// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { ghostscriptCommand } from '../src/ghostscript.js';
import { inputUrl, render } from '../src/render.js';
import { hasGhostscript } from './helpers/ghostscript.js';

const run = promisify(execFile);
const poster = fileURLToPath(new URL('../examples/poster.html', import.meta.url));
const MM = 72 / 25.4;

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1, `${actual} is not about ${expected}`);
const exact = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-3, `${actual} is not ${expected}`);

/** The first page of what render printed. */
async function firstPage(input, options) {
  return (await PDFDocument.load(await render(input, options))).getPages()[0];
}

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'render.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('inputUrl keeps web and file addresses as they are', () => {
  assert.equal(inputUrl('https://example.com/page'), 'https://example.com/page');
  assert.equal(inputUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(inputUrl('file:///tmp/page.html'), 'file:///tmp/page.html');
});

test('inputUrl turns a file path into a file address', () => {
  assert.equal(inputUrl('/tmp/a page.html'), 'file:///tmp/a%20page.html');
  assert.equal(inputUrl('examples/poster.html'), pathToFileURL(resolve('examples/poster.html')).href);
});

test('inputUrl gives null for markup, which has no address', () => {
  assert.equal(inputUrl('<h1>Hello</h1>'), null);
  assert.equal(inputUrl('\n  <!doctype html><title>x</title>'), null);
});

test('render prints markup to a PDF at the page size its CSS asks for', async () => {
  const html = '<style>@page { size: 100mm 50mm; margin: 0 }</style><p style="color: #c2532d">Hello</p>';
  const pdf = await render(html);
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
  const [page, ...others] = (await PDFDocument.load(pdf)).getPages();
  assert.equal(others.length, 0);
  near(page.getWidth(), (100 * 72) / 25.4);
  near(page.getHeight(), (50 * 72) / 25.4);
});

test('render gives the exact size the CSS asks for, where Chromium rounds it to whole points', async () => {
  const cases = [['154mm 154mm', 154, 154], ['100mm 148mm', 100, 148], ['a5 landscape', 210, 148], ['15.4cm 10cm', 154, 100]];
  for (const [size, width, height] of cases) {
    const page = await firstPage(`<style>@page { size: ${size}; margin: 0 }</style><p>Hello</p>`);
    const media = page.getMediaBox();
    assert.deepEqual([media.x, media.y], [0, 0], size);
    exact(media.width, width * MM);
    exact(media.height, height * MM);
  }
});

test('render names this tool as the Creator of the page, next to Chromium', async () => {
  for (const html of ['<p>Hello</p>', '<style>@page { size: 100mm 50mm; margin: 0 }</style><p>Hello</p>']) {
    const doc = await PDFDocument.load(await render(html), { updateMetadata: false });
    assert.match(doc.getCreator(), /^Marmalade Open Press \d+\.\d+\.\d+, with Chromium$/);
  }
});

test('render prints exactly ISO A5 when the page names no size', async () => {
  const page = await firstPage('<p>Hello</p>');
  exact(page.getWidth(), 148 * MM);
  exact(page.getHeight(), 210 * MM);
});

test('with a bleed, a page that names no size is A5 plus the bleed on every side', async () => {
  const page = await firstPage('<p>Hello</p>', { bleed: 3 });
  exact(page.getWidth(), 154 * MM);
  exact(page.getHeight(), 216 * MM);
  const turned = await firstPage('<style>@page { size: landscape; margin: 10mm }</style><p>Hello</p>', { bleed: 3 });
  exact(turned.getWidth(), 216 * MM);
  exact(turned.getHeight(), 154 * MM);
});

test('a page that names its own size keeps it, whatever the bleed', async () => {
  const page = await firstPage('<style>@page { size: 100mm 50mm }</style><p>Hello</p>', { bleed: 3 });
  exact(page.getWidth(), 100 * MM);
  exact(page.getHeight(), 50 * MM);
});

test('render refuses a bleed that is not a size', async () => {
  await assert.rejects(render('<p>Hello</p>', { bleed: -1 }), /The bleed is a size in millimetres, 0 or more\./);
});

test('the size in a linked stylesheet is read too, even inside @media print', async (t) => {
  const folder = await scratchFolder(t);
  await writeFile(join(folder, 'page.css'), '@media print { @page { size: 154mm 154mm; margin: 0 } }');
  await writeFile(join(folder, 'page.html'), '<link rel="stylesheet" href="page.css"><p>Hello</p>');
  const page = await firstPage(join(folder, 'page.html'), { bleed: 3 });
  exact(page.getWidth(), 154 * MM);
  exact(page.getHeight(), 154 * MM);
});

test('a link keeps its place from the top-left corner of the exact page', async () => {
  const style = '@page { size: 154mm 154mm; margin: 0 } body { margin: 0 } a { display: block; width: 20mm; height: 10mm }';
  const page = await firstPage(`<style>${style}</style><a href="https://example.com/">Link</a>`);
  const link = page.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  const [left, , , top] = link.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => n.asNumber());
  exact(left, 0);
  exact(top, 154 * MM);
});

test('the drawing keeps its place from the top-left corner of the exact page', { skip: !hasGhostscript }, async (t) => {
  const file = join(await scratchFolder(t), 'square.pdf');
  const style = '@page { size: 154mm 154mm; margin: 0 } body { margin: 0 } div { width: 10mm; height: 10mm; background: #000 }';
  await writeFile(file, await render(`<style>${style}</style><div></div>`));
  // Ghostscript's bbox device gives the box around everything drawn, in the page's own points.
  const { stderr } = await run(ghostscriptCommand(), ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=bbox', file]);
  const [left, , , top] = /%%HiResBoundingBox: (\S+) (\S+) (\S+) (\S+)/.exec(stderr).slice(1).map(Number);
  assert.ok(Math.abs(left) < 0.02, `the square starts at ${left}`);
  assert.ok(Math.abs(top - 154 * MM) < 0.02, `the square's top is at ${top}`);
});

test('the page background reaches every edge of the exact page, where Chromium paints it in whole pixels', { skip: !hasGhostscript }, async (t) => {
  // A5 is 148 x 210 mm, which is not a whole number of CSS px, so Chromium clips the paint at 1/300 inch (0.24 pt).
  // Up to half of that, 0.12 pt, can stay unpainted at the right and bottom, so the test allows 0.15 pt.
  const file = join(await scratchFolder(t), 'a5.pdf');
  await writeFile(file, await render('<style>html, body { margin: 0 } body { background: #2e86c1 }</style><p style="margin: 0">x</p>'));
  // Ghostscript's bbox device gives the box around everything drawn, in the page's own points.
  const { stderr } = await run(ghostscriptCommand(), ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=bbox', file]);
  const [left, bottom, right, top] = /%%HiResBoundingBox: (\S+) (\S+) (\S+) (\S+)/.exec(stderr).slice(1).map(Number);
  assert.ok(left < 0.15, `the background starts at ${left}, not at the left edge`);
  assert.ok(bottom < 0.15, `the background starts at ${bottom}, not at the bottom edge`);
  assert.ok(right > 148 * MM - 0.15, `the background stops at ${right}, short of ${148 * MM}`);
  assert.ok(top > 210 * MM - 0.15, `the background stops at ${top}, short of ${210 * MM}`);
});

test('the page background reaches the bottom of A5 plus a bleed, past the 1/300 inch Chromium clips to', { skip: !hasGhostscript }, async (t) => {
  // 216 mm is 2551.18 units of 1/300 inch. Chromium clips its paint at 2551, which left 0.04 pt unpainted at the bottom.
  const file = join(await scratchFolder(t), 'a5-bleed.pdf');
  const html = '<style>html, body { margin: 0 } body { background: #2e86c1 }</style><p style="margin: 0">x</p>';
  await writeFile(file, await render(html, { bleed: 3 }));
  // Ghostscript's bbox device gives the box around everything drawn, in the page's own points.
  const { stderr } = await run(ghostscriptCommand(), ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=bbox', file]);
  const [left, bottom, right, top] = /%%HiResBoundingBox: (\S+) (\S+) (\S+) (\S+)/.exec(stderr).slice(1).map(Number);
  assert.ok(left < 0.02, `the background starts at ${left}, not at the left edge`);
  assert.ok(bottom < 0.02, `the background starts at ${bottom}, not at the bottom edge`);
  assert.ok(right > 154 * MM - 0.02, `the background stops at ${right}, short of ${154 * MM}`);
  assert.ok(top > 216 * MM - 0.02, `the background stops at ${top}, short of ${216 * MM}`);
});

test('render prints a file, with its images and backgrounds', async () => {
  const pdf = await render(poster);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPages().length, 1);
  near(doc.getPages()[0].getWidth(), (154 * 72) / 25.4);
  near(doc.getPages()[0].getHeight(), (216 * 72) / 25.4);
  assert.equal(doc.getTitle(), 'Night Walks: an evening of slow photography');
  assert.ok(pdf.length > 40_000, 'the photograph is missing');
});

test('render refuses a file that is not there', async () => {
  await assert.rejects(render('examples/no-such-page.html'), /Cannot read examples\/no-such-page\.html/);
});
