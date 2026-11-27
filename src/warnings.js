// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/** Below this, a photograph may print soft. @type {number} */
export const MIN_PPI = 300;

/**
 * Something worth a look that need not stop the press. The code never changes; the message may be reworded.
 * @typedef {{code: 'stand-in-profile' | 'low-resolution' | 'type3-fonts' | 'text-to-pixels', message: string}} Warning
 */

/**
 * The warnings of a conversion. They never change the exit code.
 * A message starts in lower case, so that it reads well after "Warning: ".
 * @param {import('./convert.js').Report} report
 * @returns {Warning[]}
 */
export function reportWarnings(report) {
  const found = [];
  if (report.standIn) {
    found.push({
      code: 'stand-in-profile',
      message: 'the profile is a stand-in, not for press. Ask your printer for theirs and give it as the profile.',
    });
  }
  // Compared rounded, so that the warning never says 300 ppi is below 300.
  const ppi = report.lowestPpi === null ? null : Math.round(report.lowestPpi.ppi);
  if (ppi !== null && ppi < MIN_PPI) {
    found.push({ code: 'low-resolution', message: `image ${report.lowestPpi.image} prints at ${ppi} ppi, below ${MIN_PPI}.` });
  }
  if (report.type3Fonts.length > 0) {
    found.push({ code: 'type3-fonts', message: `Type 3 fonts, which some printers refuse: ${report.type3Fonts.join(', ')}.` });
  }
  return found;
}

/**
 * The warning of an export to PDF/X-1a or PDF/X-3: the pages whose text became pixels. Empty when none did.
 * @param {import('./export.js').ExportReport} exportReport
 * @returns {Warning[]}
 */
export function exportWarnings(exportReport) {
  const pages = exportReport.pixels.filter((entry) => entry.textLost).map((entry) => `page ${entry.page}`);
  if (pages.length === 0) return [];
  return [{
    code: 'text-to-pixels',
    message: `transparency was flattened, and the text became pixels on ${pages.join(', ')}.`,
  }];
}
