// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The size the page's @page rule asks for, as Chromium gives it in CSSPageRule.style.size: '154mm 216mm',
 * 'a4 landscape', 'landscape'. As in the cascade, the last @page rule without a selector that sets a size wins.
 * Rules inside @media and @import count when their media is print or all.
 *
 * A stylesheet that the page may not read, such as a file beside a local page or a sheet from another site, is read
 * again here, and Chromium parses a copy of it.
 * @param {import('playwright').Page} page  A page that has loaded.
 * @returns {Promise<string | null>}  The size; '' when no rule sets one; null when a stylesheet could not be read
 *   again, because that sheet may be the one that sets the size.
 */
export async function readPageSize(page) {
  const locked = await page.evaluate(lockedSheets);
  /** @type {Record<string, string>} */
  const texts = {};
  for (const href of locked) {
    const text = await sheetText(page, href);
    // A copy cannot follow its own @import rules, so a locked sheet that imports another is not known in full.
    if (text === null || /@import/i.test(text)) return null;
    texts[href] = text;
  }
  return page.evaluate(lastPageSize, texts);
}

/**
 * Reads a stylesheet again, from the disk or from the network.
 * @param {import('playwright').Page} page
 * @param {string} href
 * @returns {Promise<string | null>}  Its text, or null when it cannot be had.
 */
async function sheetText(page, href) {
  try {
    if (href.startsWith('file:')) return await readFile(fileURLToPath(href), 'utf8');
    if (/^https?:/i.test(href)) {
      const response = await page.request.get(href);
      return response.ok() ? await response.text() : null;
    }
  } catch {
    // A sheet that cannot be read again is answered below, the same as an address of another kind.
  }
  return null;
}

/**
 * Runs in the page: the addresses of the stylesheets, imported ones included, whose rules the page may not read.
 * It is sent to Chromium as text, so it uses nothing from outside itself.
 * @returns {string[]}
 */
function lockedSheets() {
  const hrefs = [];
  const visit = (sheet) => {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href) hrefs.push(sheet.href);
      return;
    }
    for (const rule of rules) {
      if (rule instanceof CSSImportRule && rule.styleSheet) visit(rule.styleSheet);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet);
  return hrefs;
}

/**
 * Runs in the page: the size of the last @page rule without a selector, or ''. A locked sheet is read from the text
 * given for its address. It is sent to Chromium as text, so it uses nothing from outside itself.
 * @param {Record<string, string>} texts  The text of each locked stylesheet, by address.
 * @returns {string}
 */
function lastPageSize(texts) {
  let size = '';
  const forPrint = (media) => media === '' || /\b(print|all)\b/i.test(media);
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule instanceof CSSPageRule) {
        if (rule.selectorText === '' && rule.style.size !== '') size = rule.style.size;
      } else if (rule instanceof CSSImportRule) {
        if (rule.styleSheet && forPrint(rule.media.mediaText)) walkSheet(rule.styleSheet);
      } else if (rule instanceof CSSMediaRule) {
        if (forPrint(rule.media.mediaText)) walkRules(rule.cssRules);
      } else if (rule.cssRules) {
        walkRules(rule.cssRules);
      }
    }
  };
  const walkSheet = (sheet) => {
    if (sheet.disabled || !forPrint(sheet.media.mediaText)) return;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      const copy = new CSSStyleSheet();
      copy.replaceSync(texts[sheet.href] ?? '');
      rules = copy.cssRules;
    }
    walkRules(rules);
  };
  for (const sheet of document.styleSheets) walkSheet(sheet);
  return size;
}
