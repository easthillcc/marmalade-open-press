// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR, RpcError, answerLine, serveLines,
} from '../src/jsonrpc.js';

/** A handler that echoes, refuses, breaks or takes its time, by the name of the method. */
async function handle(method, params) {
  if (method === 'echo') return { params: params ?? null };
  if (method === 'refuse') throw new RpcError(INVALID_PARAMS, 'Unknown tool: nothing');
  if (method === 'break') throw new Error('a secret path');
  if (method === 'slow') return new Promise((done) => { setTimeout(() => done('slow'), 50); });
  throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const ask = (message, log = () => {}) => answerLine(JSON.stringify(message), handle, log);

test('the codes are those of JSON-RPC 2.0', () => {
  assert.deepEqual(
    [PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR],
    [-32700, -32600, -32601, -32602, -32603],
  );
  const error = new RpcError(INVALID_PARAMS, 'No.');
  assert.ok(error instanceof Error);
  assert.equal(error.code, -32602);
  assert.equal(error.message, 'No.');
});

test('a request gets its result under the same id, a number or a string', async () => {
  assert.deepEqual(await ask({ jsonrpc: '2.0', id: 7, method: 'echo', params: { a: 1 } }), { jsonrpc: '2.0', id: 7, result: { params: { a: 1 } } });
  assert.deepEqual(await ask({ jsonrpc: '2.0', id: 'x', method: 'echo' }), { jsonrpc: '2.0', id: 'x', result: { params: null } });
});

test('a notification, an empty line and a stray response get no answer', async () => {
  assert.equal(await ask({ jsonrpc: '2.0', method: 'echo' }), null);
  assert.equal(await ask({ jsonrpc: '2.0', method: 'no-such-notification' }), null);
  assert.equal(await ask({ jsonrpc: '2.0', method: 'break' }), null);
  assert.equal(await answerLine('', handle), null);
  assert.equal(await answerLine('   ', handle), null);
  assert.equal(await ask({ jsonrpc: '2.0', id: 3, result: {} }), null);
  assert.equal(await ask({ jsonrpc: '2.0', id: 3, error: { code: 1, message: 'x' } }), null);
});

test('a line that is not JSON, or not a JSON-RPC 2.0 object, is refused with a null id', async () => {
  const parse = await answerLine('{"jsonrpc": "2.0", "id": 1,', handle);
  assert.deepEqual(parse, { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'The line is not valid JSON.' } });
  for (const line of ['[]', '42', 'null', '"text"', '{"id": 1, "method": "echo"}', '{"jsonrpc": "1.0", "id": 1, "method": "echo"}']) {
    const refused = await answerLine(line, handle);
    assert.equal(refused.id, null, line);
    assert.equal(refused.error.code, INVALID_REQUEST, line);
  }
  const noMethod = await ask({ jsonrpc: '2.0', id: 9 });
  assert.deepEqual(noMethod, { jsonrpc: '2.0', id: 9, error: { code: INVALID_REQUEST, message: 'A request names its method.' } });
});

test('an RpcError goes back with its code, and any other error as an internal one that says nothing of itself', async () => {
  assert.deepEqual(await ask({ jsonrpc: '2.0', id: 1, method: 'refuse' }), { jsonrpc: '2.0', id: 1, error: { code: INVALID_PARAMS, message: 'Unknown tool: nothing' } });
  assert.deepEqual(await ask({ jsonrpc: '2.0', id: 2, method: 'nope' }), { jsonrpc: '2.0', id: 2, error: { code: METHOD_NOT_FOUND, message: 'Method not found: nope' } });
  const logged = [];
  const broken = await ask({ jsonrpc: '2.0', id: 3, method: 'break' }, (line) => logged.push(line));
  assert.deepEqual(broken, { jsonrpc: '2.0', id: 3, error: { code: INTERNAL_ERROR, message: 'The server met an error it did not expect.' } });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^open-press mcp: Error: a secret path/);
});

test('serveLines answers each line with one line, does not wait for a slow request, and ends with the input', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk) => { written += chunk; });
  const served = serveLines(input, output, handle);
  input.write('{"jsonrpc":"2.0","id":1,"method":"slow"}\n{"jsonrpc":"2.0","id":2,');
  input.write('"method":"echo"}\r\n\n{"jsonrpc":"2.0","method":"echo"}\n');
  // The last line has no newline: the end of the input ends it.
  input.end('{"jsonrpc":"2.0","id":3,"method":"echo","params":["é"]}');
  await served;
  assert.ok(written.endsWith('\n'));
  const answers = written.trimEnd().split('\n').map((line) => JSON.parse(line));
  // The slow request was asked first and is answered last.
  assert.deepEqual(answers.map((answer) => answer.id), [2, 3, 1]);
  assert.deepEqual(answers[1].result, { params: ['é'] });
  assert.equal(answers[2].result, 'slow');
});
