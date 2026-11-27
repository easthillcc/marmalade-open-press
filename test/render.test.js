// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { inputUrl, render } from '../src/render.js';

const poster = fileURLToPath(new URL('../examples/poster.html', import.meta.url));

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1, `${actual} is not about ${expected}`);

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

test('render prints A5 when the page names no size', async () => {
  const [page] = (await PDFDocument.load(await render('<p>Hello</p>'))).getPages();
  near(page.getWidth(), (148 * 72) / 25.4);
  near(page.getHeight(), (210 * 72) / 25.4);
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
