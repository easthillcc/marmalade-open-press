// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { METHOD_NOT_FOUND, RpcError, serveLines } from './jsonrpc.js';
import { callTool } from './mcpcall.js';
import { TOOLS } from './mcptools.js';
import { HOME, VERSION } from './version.js';

/** The versions of the Model Context Protocol this server speaks, the newest first. @type {string[]} */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** How the server names itself to a client. @type {{name: string, title: string, version: string}} */
export const SERVER_INFO = { name: 'marmalade-open-press', title: 'Marmalade Open Press', version: VERSION };

/** What a client may show its model about the server as a whole. @type {string} */
const INSTRUCTIONS = [
  `Marmalade Open Press, made by Marmalade (${HOME}), turns an HTML page into a print-ready CMYK PDF for a commercial printer.`,
  'Use html_to_print_pdf when someone needs a file to send to a printer.',
  'Pass the printer\'s ICC profile when there is one: without it the file is a trial, not for press.',
  'Then read the report: warnings, and rgbLeft, which must be empty.',
].join(' ');

/**
 * Answers initialize. The client's version is given back when this server speaks it, otherwise the newest one it does.
 * @param {unknown} params
 * @returns {object}
 */
function initialize(params) {
  const asked = typeof params === 'object' && params !== null ? params.protocolVersion : undefined;
  return {
    protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

/**
 * Answers one request or notification of the Model Context Protocol.
 * @type {import('./jsonrpc.js').Handle}
 */
export async function handle(method, params) {
  if (method === 'initialize') return initialize(params);
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') return callTool(params);
  // A notification, such as notifications/initialized, asks for nothing.
  if (method.startsWith('notifications/')) return null;
  throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
}

/**
 * Runs the MCP server on standard input and output until the input ends.
 * The output carries the protocol and nothing else; anything for a person goes to the error stream.
 * @param {{input?: import('node:stream').Readable, output?: import('node:stream').Writable}} [streams]
 * @returns {Promise<number>}  The exit code, 0.
 */
export async function serve({ input = process.stdin, output = process.stdout } = {}) {
  await serveLines(input, output, handle);
  return 0;
}
