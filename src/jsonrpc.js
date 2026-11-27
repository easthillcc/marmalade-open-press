// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { createInterface } from 'node:readline';

/** The error codes of JSON-RPC 2.0 that this server gives. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** An error that goes back to the caller as a JSON-RPC error, with its code. Any other error is an internal one. */
export class RpcError extends Error {
  /**
   * @param {number} code  One of the codes above.
   * @param {string} message  One plain sentence.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * What a server does with one request or notification.
 * @callback Handle
 * @param {string} method
 * @param {unknown} params
 * @returns {Promise<unknown>}  The result. Throws an RpcError to refuse.
 */

/**
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 * @returns {object}  A JSON-RPC error response.
 */
function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Answers one line of newline-delimited JSON-RPC 2.0.
 * @param {string} line
 * @param {Handle} handle
 * @param {(line: string) => void} [log]  Where an unexpected error is noted. Never the output: it carries the protocol.
 * @returns {Promise<object | null>}  The response, or null when the line needs none: an empty line, a notification,
 *   or a response to something this server never asked.
 */
export async function answerLine(line, handle, log = console.error) {
  if (line.trim() === '') return null;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return failure(null, PARSE_ERROR, 'The line is not valid JSON.');
  }
  const isObject = typeof message === 'object' && message !== null && !Array.isArray(message);
  if (!isObject || message.jsonrpc !== '2.0') {
    return failure(null, INVALID_REQUEST, 'A message is one JSON-RPC 2.0 object. Batches are not supported.');
  }
  const hasId = typeof message.id === 'string' || typeof message.id === 'number';
  if (typeof message.method !== 'string') {
    // A result or an error is the answer to a request, and this server sends none.
    if ('result' in message || 'error' in message) return null;
    return failure(hasId ? message.id : null, INVALID_REQUEST, 'A request names its method.');
  }
  try {
    const result = await handle(message.method, message.params);
    return hasId ? { jsonrpc: '2.0', id: message.id, result } : null;
  } catch (error) {
    // A notification gets no answer, whatever happened.
    if (!hasId) return null;
    if (error instanceof RpcError) return failure(message.id, error.code, error.message);
    log(`open-press mcp: ${error?.stack ?? error}`);
    return failure(message.id, INTERNAL_ERROR, 'The server met an error it did not expect.');
  }
}

/**
 * Reads messages from the input, one per line, until it ends, and writes each answer to the output as one line.
 * Messages are answered as they finish, so a ping is answered while a long request is still running.
 * @param {import('node:stream').Readable} input
 * @param {import('node:stream').Writable} output
 * @param {Handle} handle
 * @returns {Promise<void>}  Resolves when the input has ended and every answer is written.
 */
export function serveLines(input, output, handle) {
  const pending = new Set();
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const answered = answerLine(line, handle).then((response) => {
      if (response !== null) output.write(`${JSON.stringify(response)}\n`);
      pending.delete(answered);
    });
    pending.add(answered);
  });
  return new Promise((done) => {
    lines.on('close', () => Promise.all(pending).then(() => done()));
  });
}
