// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { convert } from './convert.js';
import { render } from './render.js';
import { loadColourTable } from './table.js';
import { BANNER } from './version.js';

const USAGE = [
  BANNER,
  '',
  'Usage: open-press <input.html|url> <output.pdf> [options]',
  '',
  '  --profile <file.icc>             the printer\'s CMYK output profile',
  '  --underlay <c,m,y>               percentages of CMY kept under every grey and black, such as 3,2,2',
  '  --colours <file.json|classic>    a colour table: exact colours, printed with the inks you choose',
  '  --bleed <mm>                     bleed on every side, already part of the page size (default 0)',
  '  --check                          report what was converted, and exit with 1 if RGB is left',
  '  --version                        print the version',
  '  --help                           print this help',
  '',
  'The page size comes from the page\'s @page rule; a page without one prints on A5.',
].join('\n');

// The const type lets parseArgs type each value (a string or a boolean) without casts.
const OPTIONS = /** @type {const} */ ({
  profile: { type: 'string' },
  underlay: { type: 'string' },
  colours: { type: 'string' },
  bleed: { type: 'string' },
  check: { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
});

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
    throw new Error('--bleed takes a size in millimetres, such as 3.');
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
 * The conversion report as plain lines, for --check.
 * @param {import('./convert.js').Report} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [
    `Profile: ${report.profile}${report.standIn ? ' (stand-in)' : ''}`,
    `Vector colours converted: ${report.vectors} `
      + `(${report.neutrals} neutral, ${report.tableHits} from the colour table)`,
    `Images converted: ${report.images}`,
    `Maximum total ink: ${Math.round(report.maxInk)}%`,
  ];
  if (report.left.length > 0) lines.push('Left as it was:', ...report.left.map(formatLeftItem));
  const rgbCount = countRgbLeft(report);
  lines.push(`RGB left: ${rgbCount === 0 ? 'none' : rgbCount}`);
  return lines.join('\n');
}

/**
 * Runs the command line. Results go to io.out, warnings and errors to io.err.
 * @param {string[]} argv
 * @param {{out: (line: string) => void, err: (line: string) => void}} [io]
 * @returns {Promise<number>} The exit code.
 */
export async function run(argv, io = { out: console.log, err: console.error }) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (error) {
    io.err(error.message);
    io.err(USAGE);
    return 2;
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
    io.err(USAGE);
    return 2;
  }
  const [input, output] = positionals;

  try {
    const options = await readOptions(values);
    const { pdf, report } = await convert(await render(input), options);
    await writeFile(output, pdf);
    if (report.standIn) {
      io.err(
        'No profile given, so a stand-in CMYK profile was used. '
          + 'Ask your printer for theirs and pass it with --profile.',
      );
    }
    io.out(`Wrote ${output}.`);

    const rgbLeft = countRgbLeft(report) > 0;
    if (values.check) {
      io.out(formatReport(report));
      return rgbLeft ? 1 : 0;
    }
    if (rgbLeft) io.err('Some colour was left in RGB. Run again with --check to see what.');
    return 0;
  } catch (error) {
    io.err(error.message);
    return 2;
  }
}
