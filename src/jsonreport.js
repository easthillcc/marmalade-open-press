// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { VERSION } from './version.js';
import { exportWarnings, reportWarnings } from './warnings.js';

/** The name every JSON report carries, so that whoever reads one knows what wrote it. @type {string} */
const TOOL = 'Marmalade Open Press';

/**
 * What one run gives to --json.
 * @typedef {object} Run
 * @property {import('./convert.js').Report} report            The report of convert.
 * @property {import('./export.js').ExportReport | null} exported  The report of exportAs, or null for PDF/X-4.
 * @property {import('./export.js').Format} format
 * @property {string[]} files   The files written, as absolute paths.
 * @property {0 | 1} exitCode   What the run exits with: 1 when RGB is left and --check was given, otherwise 0.
 */

/**
 * @param {import('./warnings.js').Warning} warning
 * @returns {import('./warnings.js').Warning}  The same warning, with its message starting with a capital.
 */
function asSentence({ code, message }) {
  return { code, message: message[0].toUpperCase() + message.slice(1) };
}

/**
 * @param {number} value
 * @param {number} places  How many decimals to keep.
 * @returns {number}  The value without the noise of floating point: 49.99999999999999 mm is 50.
 */
function rounded(value, places) {
  return Number(value.toFixed(places));
}

/**
 * The whole result of a run as one plain object, for --json and for the MCP tool.
 * The fields of convert's report keep their names, with sizes rounded to a thousandth of a millimetre, ink to a
 * hundredth of a percent and resolution to a tenth of a ppi; the rest says what was written and what to look at.
 * @param {Run} run
 * @returns {object}
 */
export function jsonReport({ report, exported, format, files, exitCode }) {
  const rgbLeft = report.left.filter((item) => item.rgb).map((item) => item.what);
  const warnings = [...reportWarnings(report), ...(exported === null ? [] : exportWarnings(exported))];
  return {
    tool: TOOL,
    version: VERSION,
    ok: rgbLeft.length === 0,
    exitCode,
    format,
    files,
    profile: report.profile,
    standIn: report.standIn,
    trim: { width: rounded(report.trim.width, 3), height: rounded(report.trim.height, 3) },
    bleed: rounded(report.bleed, 3),
    vectors: report.vectors,
    neutrals: report.neutrals,
    tableHits: report.tableHits,
    images: report.images,
    maxInk: rounded(report.maxInk, 2),
    lowestPpi: report.lowestPpi === null ? null : { ...report.lowestPpi, ppi: rounded(report.lowestPpi.ppi, 1) },
    type3Fonts: report.type3Fonts,
    left: report.left,
    rgbLeft,
    warnings: warnings.map(asSentence),
    export: exported,
  };
}

/**
 * What --json prints when a run fails: wrong usage, a file that cannot be read, a format without Ghostscript.
 * @param {string} message  One plain sentence.
 * @returns {{tool: string, version: string, ok: false, exitCode: 2, error: string}}
 */
export function jsonError(message) {
  return { tool: TOOL, version: VERSION, ok: false, exitCode: 2, error: message };
}
