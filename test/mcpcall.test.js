// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { INVALID_PARAMS, RpcError } from '../src/jsonrpc.js';
import { callTool, toArgv } from '../src/mcpcall.js';
import { VERSION } from '../src/version.js';

const SMALL = '<style>@page { size: 50mm 50mm; margin: 0 }</style><p style="color: #333">Hello</p>';
const call = (args) => callTool({ name: 'html_to_print_pdf', arguments: args });

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'mcpcall.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('toArgv asks for the JSON report and the check, and puts the page and the file last', () => {
  assert.deepEqual(toArgv({ input: 'page.html', output: 'page.pdf' }), ['--json', '--check', '--', 'page.html', 'page.pdf']);
  assert.deepEqual(
    toArgv({ output: 'out.tif', input: '<p>-x</p>', dpi: 600, format: 'tiff', bleed: 3, colours: 'classic', underlay: [3, 2, 2.5], profile: '/p/printer.icc' }),
    ['--json', '--check', '--profile=/p/printer.icc', '--underlay=3,2,2.5', '--colours=classic', '--bleed=3', '--format=tiff', '--dpi=600', '--', '<p>-x</p>', 'out.tif'],
  );
  // A value out of range is passed on: the command line is the one that explains it.
  assert.ok(toArgv({ input: 'a.html', output: 'a.pdf', bleed: -3 }).includes('--bleed=-3'));
});

test('toArgv refuses a missing, unknown or mistyped argument in one plain sentence', () => {
  const cases = [
    [null, 'The arguments are one object, with at least input and output.'],
    [['a.html', 'a.pdf'], 'The arguments are one object, with at least input and output.'],
    [{ output: 'a.pdf' }, 'input is the page to print: the path of an HTML file, a URL, or HTML markup.'],
    [{ input: '', output: 'a.pdf' }, 'input is the page to print: the path of an HTML file, a URL, or HTML markup.'],
    [{ input: 'a.html' }, 'output is the path of the file to write, such as poster.pdf.'],
    [{ input: 'a.html', output: 'a.pdf', html: '<p>' }, 'There is no argument called "html". The arguments are input, output, profile, underlay, colours, bleed, format, dpi.'],
    [{ input: 'a.html', output: 'a.pdf', profile: 3 }, 'profile is a string that is not empty.'],
    [{ input: 'a.html', output: 'a.pdf', colours: '' }, 'colours is a string that is not empty.'],
    [{ input: 'a.html', output: 'a.pdf', format: ['x4'] }, 'format is a string that is not empty.'],
    [{ input: 'a.html', output: 'a.pdf', bleed: '3' }, 'bleed is a number.'],
    [{ input: 'a.html', output: 'a.pdf', dpi: Number.NaN }, 'dpi is a number.'],
    [{ input: 'a.html', output: 'a.pdf', underlay: [3, 2] }, 'underlay is three percentages, such as [3, 2, 2].'],
    [{ input: 'a.html', output: 'a.pdf', underlay: '3,2,2' }, 'underlay is three percentages, such as [3, 2, 2].'],
    [{ input: 'a.html', output: 'a.pdf', underlay: [3, 2, '2'] }, 'underlay is three percentages, such as [3, 2, 2].'],
  ];
  for (const [args, message] of cases) {
    assert.throws(() => toArgv(args), { message });
  }
});

test('a call for a tool that is not there is a protocol error', async () => {
  await assert.rejects(callTool({ name: 'make_coffee', arguments: {} }), (error) => error instanceof RpcError && error.code === INVALID_PARAMS && error.message === 'Unknown tool: make_coffee');
  for (const params of [{}, null, 'html_to_print_pdf']) {
    await assert.rejects(callTool(params), (error) => error instanceof RpcError && error.code === INVALID_PARAMS && error.message === 'tools/call needs a tool name.');
  }
});

test('arguments the tool cannot use are an error result, not a crash', async () => {
  for (const args of [undefined, { input: 'a.html' }, { input: 'a.html', output: 'a.pdf', bleed: -3 }, { input: 'no-such-page.html', output: 'never-written.local.pdf' }]) {
    const result = await callTool({ name: 'html_to_print_pdf', arguments: args });
    assert.equal(result.isError, true);
    assert.deepEqual(Object.keys(result.structuredContent), ['tool', 'version', 'ok', 'exitCode', 'error']);
    assert.equal(result.structuredContent.exitCode, 2);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
  assert.equal((await call({ input: 'no-such-page.html', output: 'never-written.local.pdf' })).structuredContent.error, 'Cannot read no-such-page.html.');
  assert.equal((await call({ input: 'a.html', output: 'a.pdf', bleed: -3 })).structuredContent.error, 'The bleed is a size in millimetres, 0 or more.');
});

test('a page becomes a PDF/X-4, and the report comes back as text and as structured content', async (t) => {
  const output = join(await scratchFolder(t), 'small.pdf');
  const result = await call({ input: SMALL, output, bleed: 0, underlay: [3, 2, 2] });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(result.structuredContent, null, 2) }]);
  const report = result.structuredContent;
  assert.equal(report.version, VERSION);
  assert.equal(report.ok, true);
  assert.deepEqual(report.files, [output]);
  assert.deepEqual(report.trim, { width: 50, height: 50 });
  assert.deepEqual(report.warnings.map((warning) => warning.code), ['stand-in-profile']);
  assert.equal((await readFile(output)).toString('latin1', 0, 8), '%PDF-1.6');
});

test('a conic gradient runs in ink, so the result is not an error', async (t) => {
  const output = join(await scratchFolder(t), 'conic.pdf');
  const input = '<style>@page { size: 50mm 50mm; margin: 0 } div { width: 40mm; height: 40mm; background: conic-gradient(#c2532d, #e3a33b, #c2532d) }</style><div></div>';
  const result = await call({ input, output });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.exitCode, 0);
  assert.deepEqual(result.structuredContent.rgbLeft, []);
  assert.deepEqual(result.structuredContent.files, [output]);
});
