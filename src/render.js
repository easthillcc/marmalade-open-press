// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

/**
 * Works out what Chromium should open for an input.
 *
 * @param {string} input An HTML file path, a URL, or HTML markup.
 * @returns {string | null} The address Chromium opens, or null when the input is markup.
 */
export function inputUrl(input) {
  if (input.trimStart().startsWith('<')) return null;
  if (/^(https?|file):\/\//i.test(input)) return input;
  return pathToFileURL(resolve(input)).href;
}

/**
 * Prints an HTML page to an RGB PDF with Chromium, at the page's @page size or A5.
 *
 * @param {string} input An HTML file path, a URL, or HTML markup.
 * @returns {Promise<Uint8Array>} An RGB PDF.
 */
export async function render(input) {
  const url = inputUrl(input);
  if (url !== null && url.startsWith('file:')) {
    // Chromium's own error for a missing file is not worth showing a person, so check first.
    await access(new URL(url)).catch(() => {
      throw new Error(`Cannot read ${input}.`);
    });
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 'networkidle' so images and web fonts have arrived before the page is printed.
    if (url !== null) {
      await page.goto(url, { waitUntil: 'networkidle' });
    } else {
      await page.setContent(input, { waitUntil: 'networkidle' });
    }
    // The page's own @page size decides the paper; a page that names none gets A5. Backgrounds are kept.
    return await page.pdf({ preferCSSPageSize: true, format: 'A5', printBackground: true });
  } finally {
    await browser.close();
  }
}
