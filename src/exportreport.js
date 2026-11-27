// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/** The name each format goes by in a report. */
const FORMAT_NAMES = { x4: 'PDF/X-4', x1a: 'PDF/X-1a:2001', x3: 'PDF/X-3:2002', tiff: 'CMYK TIFF' };

/**
 * Gives "page" or "pages" for a count, so the lines read naturally for one page too.
 * @param {number} count
 * @returns {string}
 */
function pageWord(count) {
  return count === 1 ? 'page' : 'pages';
}

/**
 * Lists the pages whose text became pixels, in report order.
 * @param {import('./export.js').ExportReport} report
 * @returns {number[]}
 */
function textLostPages(report) {
  return report.pixels.filter((entry) => entry.textLost).map((entry) => entry.page);
}

/**
 * Describes the transparency found on each page that has some, joined into one line.
 * @param {import('./export.js').ExportReport} report
 * @returns {string}
 */
function transparencyList(report) {
  const items = report.transparency
    .filter((entry) => entry.kinds.length > 0)
    .map((entry) => `page ${entry.page} (${entry.kinds.join(', ')})`);
  return items.length > 0 ? items.join(', ') : 'none';
}

/**
 * Describes the pages that Ghostscript flattened, with the share of each page that became pixels.
 * @param {import('./export.js').ExportReport} report
 * @returns {string}
 */
function flattenedLine(report) {
  const flattened = report.pixels.filter((entry) => entry.flattened);
  if (flattened.length === 0) return 'Flattened to pixels: none';
  const items = flattened.map((entry) => `page ${entry.page} (${Math.round(entry.share * 100)}% of the page)`);
  return `Flattened to pixels at ${report.dpi} dpi: ${items.join(', ')}`;
}

/**
 * Describes the images Ghostscript added to pages it did not flatten, or null when there are none.
 * @param {import('./export.js').ExportReport} report
 * @returns {string | null}
 */
function imagesAddedLine(report) {
  const items = report.pixels
    .filter((entry) => !entry.flattened && entry.imagesAdded > 0)
    .map((entry) => `page ${entry.page} (${entry.imagesAdded})`);
  return items.length > 0 ? `Images added by Ghostscript: ${items.join(', ')}` : null;
}

/**
 * Describes the pages whose text became pixels, or null when no text was lost.
 * @param {import('./export.js').ExportReport} report
 * @returns {string | null}
 */
function textLostLine(report) {
  const pages = textLostPages(report);
  return pages.length > 0 ? `Text turned to pixels: ${pages.map((page) => `page ${page}`).join(', ')}` : null;
}

/**
 * Turns the report of an export into plain lines for --check. A PDF/X-4 has nothing to add, so it gives no line.
 * @param {import('./export.js').ExportReport} report
 * @returns {string}
 */
export function formatExportReport(report) {
  if (report.format === 'x4') return '';

  if (report.format === 'tiff') {
    return `Format: CMYK TIFF, ${report.pages} ${pageWord(report.pages)} at ${report.dpi} dpi, drawn by Ghostscript ${report.ghostscript}`;
  }

  // Only the lines that have something to say are kept; the first three are always there.
  const lines = [
    `Format: ${FORMAT_NAMES[report.format]}, written by Ghostscript ${report.ghostscript}`,
    `Transparency: ${transparencyList(report)}`,
    flattenedLine(report),
    imagesAddedLine(report),
    textLostLine(report),
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/**
 * Gives one warning line for a run without --check, or null when no text became pixels.
 * @param {import('./export.js').ExportReport} report
 * @returns {string | null}
 */
export function exportWarning(report) {
  const count = textLostPages(report).length;
  if (count === 0) return null;
  return `Transparency was flattened, and the text of ${count} ${pageWord(count)} became pixels. Run again with --check to see where.`;
}
