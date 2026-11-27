// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { METHOD_NOT_FOUND, RpcError } from '../src/jsonrpc.js';
import { PROTOCOL_VERSIONS, SERVER_INFO, handle } from '../src/mcp.js';
import { CHROMIUM_MISSING } from '../src/render.js';
import { VERSION } from '../src/version.js';

const bin = fileURLToPath(new URL('../bin/open-press.js', import.meta.url));
const SMALL = '<style>@page { size: 50mm 50mm; margin: 0 }</style><p style="color: #333">Hello</p>';

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'mcp.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/**
 * Starts "open-press mcp", sends it the lines, closes its input and waits for it to end.
 * @returns {Promise<{code: number, stdout: string}>}
 */
function converse(lines, cwd, env = process.env) {
  const child = spawn(process.execPath, [bin, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stdin.end(lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'));
  return new Promise((done) => { child.on('close', (code) => done({ code, stdout })); });
}

test('initialize names the server and settles the protocol version', async () => {
  assert.deepEqual(PROTOCOL_VERSIONS, ['2025-06-18', '2025-03-26', '2024-11-05']);
  assert.deepEqual(SERVER_INFO, { name: 'marmalade-open-press', title: 'Marmalade Open Press', version: VERSION });
  const result = await handle('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.deepEqual(Object.keys(result), ['protocolVersion', 'capabilities', 'serverInfo', 'instructions']);
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.deepEqual(result.serverInfo, SERVER_INFO);
  assert.match(result.instructions, /^Marmalade Open Press, made by Marmalade \(https:\/\/marmalade\.family\)/);
  // An older version this server speaks is given back; one it does not know gets the newest it does.
  assert.equal((await handle('initialize', { protocolVersion: '2024-11-05' })).protocolVersion, '2024-11-05');
  assert.equal((await handle('initialize', { protocolVersion: '2099-01-01' })).protocolVersion, '2025-06-18');
  assert.equal((await handle('initialize', undefined)).protocolVersion, '2025-06-18');
});

test('ping, the notifications and an unknown method', async () => {
  assert.deepEqual(await handle('ping', undefined), {});
  assert.equal(await handle('notifications/initialized', undefined), null);
  assert.equal(await handle('notifications/cancelled', { requestId: 1 }), null);
  await assert.rejects(handle('resources/list', {}), (error) => error instanceof RpcError && error.code === METHOD_NOT_FOUND && error.message === 'Method not found: resources/list');
});

test('tools/list describes the one tool for an assistant', async () => {
  const { tools } = await handle('tools/list', {});
  assert.equal(tools.length, 1);
  const [tool] = tools;
  assert.equal(tool.name, 'html_to_print_pdf');
  assert.equal(tool.title, 'HTML to print-ready CMYK PDF');
  assert.ok(tool.description.endsWith('Made by Marmalade (https://marmalade.family).'));
  assert.equal(tool.description.split('marmalade.family').length, 2);
  const schema = tool.inputSchema;
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['input', 'output']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ['input', 'output', 'profile', 'underlay', 'colours', 'bleed', 'format', 'dpi']);
  for (const [name, property] of Object.entries(schema.properties)) {
    assert.ok(property.description.length > 40, name);
    assert.equal(/[!]|marmalade/i.test(property.description), false, name);
  }
  assert.deepEqual(schema.properties.format.enum, ['x4', 'x1a', 'x3', 'tiff']);
  assert.match(schema.properties.profile.description, /stand-in/);
  assert.match(schema.properties.bleed.description, /trimmed off/);
  assert.deepEqual([schema.properties.dpi.minimum, schema.properties.dpi.maximum], [72, 2400]);
  // What goes over the wire is plain JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(tools)), tools);
});

test('the server speaks newline-delimited JSON-RPC on its standard streams, and ends when the input ends', async (t) => {
  const folder = await scratchFolder(t);
  const { code, stdout } = await converse([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    'this line is not JSON',
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'html_to_print_pdf', arguments: { input: SMALL, output: 'small.pdf' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'html_to_print_pdf', arguments: { input: 'no-such-page.html', output: 'never.pdf' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'make_coffee', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'prompts/list' },
  ], folder);
  assert.equal(code, 0);
  // Every line of the output is one JSON-RPC message, and nothing else is ever written there.
  const answers = stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.ok(answers.every((answer) => answer.jsonrpc === '2.0'));
  assert.equal(answers.length, 8);
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  assert.equal(byId.get(1).result.serverInfo.title, 'Marmalade Open Press');
  assert.deepEqual(byId.get(2).result, {});
  assert.equal(byId.get(3).result.tools[0].name, 'html_to_print_pdf');
  assert.equal(byId.get(null).error.code, -32700);
  const made = byId.get(4).result;
  assert.equal(made.isError, false);
  assert.deepEqual(made.structuredContent.files, [join(folder, 'small.pdf')]);
  assert.deepEqual(JSON.parse(made.content[0].text), made.structuredContent);
  assert.equal((await readFile(join(folder, 'small.pdf'))).toString('latin1', 0, 8), '%PDF-1.6');
  const failed = byId.get(5).result;
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.error, 'Cannot read no-such-page.html.');
  assert.deepEqual(byId.get(6).error, { code: -32602, message: 'Unknown tool: make_coffee' });
  assert.deepEqual(byId.get(7).error, { code: -32601, message: 'Method not found: prompts/list' });
});

test('without Chromium, the tool answers with one plain line that says how to install it', async (t) => {
  const folder = await scratchFolder(t);
  // Playwright looks for its browsers in this folder, which has none.
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: folder };
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'html_to_print_pdf', arguments: { input: SMALL, output: 'small.pdf' } } };
  const { code, stdout } = await converse([call], folder, env);
  assert.equal(code, 0);
  const { result } = JSON.parse(stdout);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, CHROMIUM_MISSING);
  assert.match(CHROMIUM_MISSING, /npx -y -p marmalade-open-press playwright install chromium/);
});
