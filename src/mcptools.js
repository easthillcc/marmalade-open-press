// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { FORMATS, MAX_DPI, MIN_DPI } from './export.js';

/**
 * The one tool: a page goes in, a file for the printer comes out, with a report.
 * The descriptions are written for an assistant that has never sent a file to a printer.
 */
export const HTML_TO_PRINT_PDF = {
  name: 'html_to_print_pdf',
  title: 'HTML to print-ready CMYK PDF',
  description: [
    'Turns an HTML page into a print-ready CMYK file for a commercial printer: PDF/X-4 by default, or PDF/X-1a, PDF/X-3 or CMYK TIFF.',
    'Chromium draws the page, every colour and image goes through the printer\'s ICC profile, and grey and black text stays on the black plate alone.',
    'The page size comes from the page\'s own CSS @page rule; a page without one prints on A5.',
    'The result is a JSON report: the files written, the trim size and the bleed in millimetres, the heaviest total ink, the lowest image resolution, warnings, and rgbLeft, the list of what is still RGB.',
    'It is an error result when the run fails or when anything is left in RGB.',
    'Read the warnings to the person: a stand-in profile is not for press, and an image below 300 ppi may print soft.',
    'Made by Marmalade (https://marmalade.family).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'The page to print: the path of an HTML file, an http or https URL, or HTML markup (a string that starts with "<"). Markup has no folder of its own, so its images and stylesheets need absolute URLs or data: URIs; for local assets, write the HTML to a file and give its path.',
      },
      output: {
        type: 'string',
        description: 'Where to write the file: an absolute path. A relative one is read from the folder the client starts the server in, which may be / where nothing can be written, so give absolute paths for output, input, profile and colours. A .pdf name, or a .tif name with the format tiff, whose pages are then written as name-1.tif, name-2.tif and so on. A file already there is replaced.',
      },
      profile: {
        type: 'string',
        description: 'The path of the printer\'s CMYK ICC profile, a .icc file. An absolute path. Ask the printer which one. Without it a stand-in profile is used, the report says standIn: true, and the file is a trial, not for press.',
      },
      underlay: {
        type: 'array',
        items: { type: 'number', minimum: 0, maximum: 100 },
        minItems: 3,
        maxItems: 3,
        description: 'Percentages of cyan, magenta and yellow kept under every grey and black, such as [3, 2, 2], so that a plate that drifts shows no bare paper around letters on a tint. The values come from the printer. Default [0, 0, 0].',
      },
      colours: {
        type: 'string',
        description: 'A colour table that gives chosen colours exact inks: the preset name "classic", or the path of a JSON file of entries such as {"name": "Brand orange", "hex": "#F07D00", "cmyk": [0, 60, 100, 0]}. An absolute path.',
      },
      bleed: {
        type: 'number',
        minimum: 0,
        description: 'The bleed in millimetres on every side: the extra edge that is printed and then trimmed off, usually 3. It sets the trim box. A page that names its own @page size must already include the bleed (A5 with 3 mm is 154mm by 216mm); a page that names none is printed on A5 plus the bleed. Default 0.',
      },
      format: {
        type: 'string',
        enum: FORMATS,
        description: 'The output format. x4 (PDF/X-4) is the default and needs nothing else. x1a (PDF/X-1a:2001), x3 (PDF/X-3:2002) and tiff (one CMYK TIFF per page) need Ghostscript on the machine. x1a and x3 cannot hold transparency: a page that uses opacity, rgba(), a shadow or a blend mode becomes one picture, text included.',
      },
      dpi: {
        type: 'number',
        minimum: MIN_DPI,
        maximum: MAX_DPI,
        description: 'The resolution of TIFF pages, and of the pages that x1a and x3 had to flatten. Default 300; 600 keeps small text readable. Not used with x4.',
      },
    },
    required: ['input', 'output'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

/** The tools this server lists. @type {object[]} */
export const TOOLS = [HTML_TO_PRINT_PDF];
