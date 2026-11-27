// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { run } from './cli.js';
import { INVALID_PARAMS, RpcError } from './jsonrpc.js';
import { jsonError } from './jsonreport.js';
import { HTML_TO_PRINT_PDF } from './mcptools.js';

/** The names of the arguments, in the order of the schema. @type {string[]} */
const NAMES = Object.keys(HTML_TO_PRINT_PDF.inputSchema.properties);
const isText = (value) => typeof value === 'string' && value !== '';
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Turns the arguments of html_to_print_pdf into a command line for run. Only the types are checked here:
 * the command line checks every value itself, and explains what is wrong with one.
 * @param {unknown} args  The arguments as the assistant sent them.
 * @returns {string[]}  The command line: --json and --check, the options, then the input and the output.
 * @throws {Error} One plain sentence, when an argument is missing, unknown or of the wrong type.
 */
export function toArgv(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('The arguments are one object, with at least input and output.');
  const unknown = Object.keys(args).find((key) => !NAMES.includes(key));
  if (unknown !== undefined) throw new Error(`There is no argument called "${unknown}". The arguments are ${NAMES.join(', ')}.`);
  const { input, output, profile, underlay, colours, bleed, format, dpi } = args;
  if (!isText(input)) throw new Error('input is the page to print: the path of an HTML file, a URL, or HTML markup.');
  if (!isText(output)) throw new Error('output is the path of the file to write, such as poster.pdf.');
  for (const [name, value] of Object.entries({ profile, colours, format })) {
    if (value !== undefined && !isText(value)) throw new Error(`${name} is a string that is not empty.`);
  }
  for (const [name, value] of Object.entries({ bleed, dpi })) {
    if (value !== undefined && !isNumber(value)) throw new Error(`${name} is a number.`);
  }
  if (underlay !== undefined && !(Array.isArray(underlay) && underlay.length === 3 && underlay.every(isNumber))) {
    throw new Error('underlay is three percentages, such as [3, 2, 2].');
  }
  // Each value is joined to its option with "=", so that one that starts with a minus sign is not taken for an option.
  const options = { profile, underlay: underlay?.join(','), colours, bleed, format, dpi };
  const given = Object.entries(options).filter(([, value]) => value !== undefined);
  return ['--json', '--check', ...given.map(([name, value]) => `--${name}=${value}`), '--', input, output];
}

/**
 * @param {object} report  What --json printed, or a jsonError.
 * @returns {object}  A tool result: the report as text and as structured content, marked as an error when it is one.
 */
function toolResult(report) {
  return {
    content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    structuredContent: report,
    isError: report.exitCode !== 0,
  };
}

/**
 * Answers tools/call. A run that fails is a result marked isError, which the assistant can read and act on;
 * only a call that names no tool this server has is refused as a protocol error.
 * @param {unknown} params  The params of tools/call: a name and its arguments.
 * @returns {Promise<object>}  The tool result.
 */
export async function callTool(params) {
  const name = typeof params === 'object' && params !== null ? params.name : undefined;
  if (typeof name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call needs a tool name.');
  if (name !== HTML_TO_PRINT_PDF.name) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${String(name)}`);
  let argv;
  try {
    argv = toArgv(params.arguments ?? {});
  } catch (error) {
    return toolResult(jsonError(error.message));
  }
  // The JSON is the only thing run gives to out. The lines for a person are already in it, so they are dropped.
  const out = [];
  await run(argv, { out: (line) => out.push(line), err: () => {} });
  return toolResult(JSON.parse(out.join('\n')));
}
