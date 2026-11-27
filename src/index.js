// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/**
 * Marmalade Open Press turns a web page into a print-ready CMYK PDF/X-4.
 *
 * The library has two layers that work on their own:
 * - render: an HTML file, a URL or markup becomes an RGB PDF, drawn by Chromium.
 * - convert: any RGB PDF becomes a CMYK PDF/X-4, with a report of what was converted.
 *
 * loadColourTable reads a colour table, from a preset name (such as classic)
 * or from a JSON file, to pass to convert as its colours.
 *
 * exportAs is a third step, for printers who ask for something older: it writes the PDF/X-4 that convert
 * returned as PDF/X-1a, PDF/X-3 or CMYK TIFF pages. It needs Ghostscript. findTransparency says where a PDF
 * uses transparency, which is what exportAs has to flatten.
 *
 * @example
 * import { convert, exportAs, loadColourTable, render } from 'marmalade-open-press';
 * const rgb = await render('page.html');
 * const colours = await loadColourTable('classic');
 * const { pdf, report } = await convert(rgb, { profile: 'printer.icc', underlay: [3, 2, 2], colours });
 * const { files } = await exportAs(pdf, 'x1a');
 */

export { convert } from './convert.js';
export { FORMATS, exportAs } from './export.js';
export { render } from './render.js';
export { loadColourTable } from './table.js';
export { findTransparency } from './transparency.js';
export { VERSION } from './version.js';
