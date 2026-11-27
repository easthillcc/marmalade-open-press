// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readFormat, writeExport } from './cliformat.js';
import { convert } from './convert.js';
import { exportAs } from './export.js';
import { exportWarning, formatExportReport } from './exportreport.js';
import { jsonError, jsonReport } from './jsonreport.js';
import { render } from './render.js';
import { loadColourTable } from './table.js';
import { numberedNames } from './tiff.js';
import { BANNER } from './version.js';
import { reportWarnings } from './warnings.js';

const USAGE = [
  BANNER,
  '',
  'Usage: open-press <input.html|url> <output.pdf> [options]',
  '       open-press mcp                 an MCP server on standard input and output, for AI assistants',
  '',
  '  --profile <file.icc>             the printer\'s CMYK output profile',
  '  --underlay <c,m,y>               percentages of CMY kept under every grey and black, such as 3,2,2',
  '  --colours <file.json|classic>    a colour table: exact colours, printed with the inks you choose',
  '  --bleed <mm>                     bleed on every side, in millimetres (default 0)',
  '  --format <x4|x1a|x3|tiff>        the output format (default x4); the others need Ghostscript',
  '  --dpi <n>                        resolution of TIFF pages and of flattened pages (default 300)',
  '  --check                          report what was converted and what to look at, and exit with 1 if RGB is left',
  '  --json                           print the whole report as one JSON object; the other lines go to the error stream',
  '  --version                        print the version',
  '  --help                           print this help',
  '',
  'The page size comes from the page\'s @page rule, and the PDF has exactly that size; its bleed is part of it.',
  'A page without one prints on A5, or with --bleed on A5 plus the bleed on every side, which trims to A5.',
  'With --format tiff the output is a .tif name; the pages are written as name-1.tif, name-2.tif and so on.',
  '',
  'Made by Marmalade, which turns a family\'s week into a printed magazine: https://marmalade.family',
  'Source and issues: https://github.com/easthillcc/marmalade-open-press',
].join('\n');

// The const type lets parseArgs type each value (a string or a boolean) without casts.
const OPTIONS = /** @type {const} */ ({
  profile: { type: 'string' },
  underlay: { type: 'string' },
  colours: { type: 'string' },
  bleed: { type: 'string' },
  format: { type: 'string' },
  dpi: { type: 'string' },
  check: { type: 'boolean' },
  json: { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
});

/** The options whose value may start with a minus sign, which parseArgs would otherwise take for an option. */
const SIGNED = new Set(['--bleed', '--underlay']);

/**
 * Joins "--bleed -3" into "--bleed=-3", so that a negative value reaches the check that explains it.
 * @param {string[]} argv
 * @returns {string[]}
 */
function joinSignedValues(argv) {
  const joined = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (SIGNED.has(argv[i]) && /^-[\d.]/.test(argv[i + 1] ?? '')) {
      joined.push(`${argv[i]}=${argv[i + 1]}`);
      i += 1;
    } else {
      joined.push(argv[i]);
    }
  }
  return joined;
}

/**
 * One plain line for an option that parseArgs refused. Node's own message is long and speaks of its internals.
 * @param {Error & {code?: string}} error
 * @returns {string}
 */
function argumentError(error) {
  // Node quotes the option first in its message, as '--chek' or '--bleed <value>'.
  const option = /'([^' ]+)/.exec(error.message)?.[1] ?? 'An option';
  if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return `Unknown option ${option}. See open-press --help.`;
  if (/does not take an argument/.test(error.message)) return `${option} takes no value. See open-press --help.`;
  if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return `${option} needs a value. See open-press --help.`;
  return `${error.message.split('\n')[0]} See open-press --help.`;
}

/**
 * Reads "c,m,y" into three percentages. Greys and black carry this much CMY under their black.
 * @param {string} text
 * @returns {[number, number, number]}
 */
function parseUnderlay(text) {
  const parts = text.split(',');
  const numbers = parts.map(Number);
  const valid = numbers.length === 3
    && parts.every((part) => part.trim() !== '')
    && numbers.every((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  if (!valid) throw new Error('--underlay takes three percentages, such as 3,2,2.');
  return /** @type {[number, number, number]} */ (numbers);
}

/**
 * Reads a bleed in millimetres. Zero is allowed; an empty, non-numeric or negative value is not.
 * @param {string} text
 * @returns {number}
 */
function parseBleed(text) {
  const millimetres = Number(text);
  if (text.trim() === '' || !Number.isFinite(millimetres) || millimetres < 0) {
    throw new Error('The bleed is a size in millimetres, 0 or more.');
  }
  return millimetres;
}

/**
 * The string flags that readOptions reads, as parseArgs returns them.
 * @typedef {{ profile?: string, underlay?: string, colours?: string, bleed?: string }} ValueFlags
 */

/**
 * Turns the parsed flags into convert() options. Runs before rendering, so a bad value costs no time.
 * @param {ValueFlags} values
 * @returns {Promise<import('./convert.js').ConvertOptions>}
 */
async function readOptions({ profile, underlay, colours, bleed }) {
  return {
    profile,
    underlay: underlay === undefined ? undefined : parseUnderlay(underlay),
    colours: colours === undefined ? undefined : await loadColourTable(colours),
    bleed: bleed === undefined ? undefined : parseBleed(bleed),
  };
}

/**
 * How many items are still RGB. One rule, shared by the exit code and the report.
 * @param {import('./convert.js').Report} report
 * @returns {number}
 */
function countRgbLeft(report) {
  return report.left.filter((item) => item.rgb).length;
}

/**
 * One line for a left-alone item: its description, marked when it is still RGB.
 * @param {import('./convert.js').Report['left'][number]} item
 * @returns {string}
 */
function formatLeftItem(item) {
  return `  ${item.what}${item.rgb ? ' (RGB)' : ''}`;
}

/**
 * The conversion report as plain lines, for --check. Warnings come before what was left, and RGB left is last.
 * @param {import('./convert.js').Report} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [
    `Profile: ${report.profile}`,
    `Trim: ${millimetres(report.trim.width)} x ${millimetres(report.trim.height)} mm, bleed ${millimetres(report.bleed)} mm`,
    `Vector colours converted: ${report.vectors} `
      + `(${report.neutrals} neutral, ${report.tableHits} from the colour table)`,
    `Images converted: ${report.images}`,
  ];
  if (report.lowestPpi !== null) {
    const { ppi, image, page } = report.lowestPpi;
    lines.push(`Lowest image resolution: ${Math.round(ppi)} ppi at placed size (image ${image}, page ${page})`);
  }
  lines.push(`Maximum total ink: ${Math.round(report.maxInk)}%`, ...warnings(report));
  if (report.left.length > 0) lines.push('Left as it was:', ...report.left.map(formatLeftItem));
  const rgbCount = countRgbLeft(report);
  lines.push(`RGB left: ${rgbCount === 0 ? 'none' : rgbCount}`);
  return lines.join('\n');
}

/**
 * Things worth a look that need not stop the press. They never change the exit code.
 * @param {import('./convert.js').Report} report
 * @returns {string[]}
 */
function warnings(report) {
  return reportWarnings(report).map((warning) => `Warning: ${warning.message}`);
}

/**
 * @param {number} value  Millimetres.
 * @returns {string}  To a tenth of a millimetre, without a trailing .0: '148', '148.5'.
 */
function millimetres(value) {
  return String(Number(value.toFixed(1)));
}

const ANSI_COLOUR = /\u001b\[[0-9;]*m/g;

/**
 * One plain line for a failed run: no colour codes, no browser call log, and the folder named when it is missing.
 * @param {Error & {code?: string}} error
 * @param {string} output  The output path as the person gave it.
 * @returns {string}
 */
function plainFailure(error, output) {
  if (error.code === 'ENOENT' && !existsSync(dirname(resolve(output)))) {
    return `Cannot write ${output}: the folder does not exist.`;
  }
  return String(error.message).replace(ANSI_COLOUR, '').split('\n')[0];
}

/**
 * Runs the command line. Results go to io.out, warnings and errors to io.err.
 * With --json, io.out gets one JSON object and nothing else, also when the run fails; every other line goes to io.err.
 * @param {string[]} argv
 * @param {{out: (line: string) => void, err: (line: string) => void}} [io]
 * @param {{render: typeof render}} [steps]  What prints the input to an RGB PDF. Tests give their own, for a PDF
 *   that Chromium does not write.
 * @returns {Promise<number>} The exit code.
 */
export async function run(argv, io = { out: console.log, err: console.error }, steps = { render }) {
  // Read from argv itself, so that a failure to parse the options is reported as JSON too.
  const json = argv.includes('--json');
  const fail = (message, shown = message) => {
    io.err(shown);
    if (json) io.out(JSON.stringify(jsonError(message), null, 2));
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({ args: joinSignedValues(argv), allowPositionals: true, options: OPTIONS });
  } catch (error) {
    return fail(argumentError(error));
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.out(BANNER);
    return 0;
  }
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  if (positionals.length !== 2) {
    return fail('open-press takes an input and an output. See open-press --help.', USAGE);
  }
  const [input, output] = positionals;
  // With --json the lines for a person move to the error stream, so that the JSON has the output to itself.
  const say = json ? io.err : io.out;

  try {
    const options = await readOptions(values);
    const { format, dpi } = await readFormat(values, output);
    const { pdf, report } = await convert(await steps.render(input, { bleed: options.bleed }), options);
    // A PDF/X-4 is written as convert made it. Any other format goes through exportAs first.
    const exported = format === 'x4' ? null : await exportAs(pdf, format, { dpi });
    if (exported === null) await writeFile(output, pdf);
    const wrote = exported === null ? `Wrote ${output}.` : await writeExport(output, exported.files, format);
    if (report.standIn) {
      io.err(
        'No profile given, so a stand-in CMYK profile was used. '
          + 'Ask your printer for theirs and pass it with --profile.',
      );
    }
    say(wrote);

    const rgbLeft = countRgbLeft(report) > 0;
    if (values.check) {
      say(formatReport(report));
      if (exported !== null) say(formatExportReport(exported.report));
    } else {
      if (rgbLeft) io.err('Some colour was left in RGB. Run again with --check to see what.');
      const warning = exported === null ? null : exportWarning(exported.report);
      if (warning !== null) io.err(warning);
    }
    // Only --check turns RGB left into exit code 1. The JSON says which code it was.
    const exitCode = values.check && rgbLeft ? 1 : 0;
    if (json) {
      const names = format === 'tiff' ? numberedNames(output, exported.files.length) : [output];
      const files = names.map((name) => resolve(name));
      io.out(JSON.stringify(jsonReport({ report, exported: exported?.report ?? null, format, files, exitCode }), null, 2));
    }
    return exitCode;
  } catch (error) {
    return fail(plainFailure(error, output));
  }
}
