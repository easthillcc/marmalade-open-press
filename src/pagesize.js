// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/** Points in one millimetre. */
export const POINTS_PER_MM = 72 / 25.4;

/** A page size in points. @typedef {{width: number, height: number}} Size */

/**
 * @param {number} width  Millimetres.
 * @param {number} height  Millimetres.
 * @returns {Size}
 */
function millimetres(width, height) {
  return { width: width * POINTS_PER_MM, height: height * POINTS_PER_MM };
}

/** The named sizes of CSS Paged Media, upright, in points. */
const NAMED_SIZES = {
  a5: millimetres(148, 210),
  a4: millimetres(210, 297),
  a3: millimetres(297, 420),
  b5: millimetres(176, 250),
  b4: millimetres(250, 353),
  'jis-b5': millimetres(182, 257),
  'jis-b4': millimetres(257, 364),
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  ledger: { width: 792, height: 1224 },
};

/** Points in one of each unit a page size may be written in. */
const POINTS_PER_UNIT = { mm: POINTS_PER_MM, cm: 10 * POINTS_PER_MM, q: POINTS_PER_MM / 4, in: 72, pc: 12, pt: 1, px: 0.75 };

/** A length as Chromium gives it back: '154mm', or 'calc(41.5748px)' for a calculated one. No sign: a page is never negative. */
const LENGTH = /^(?:calc\()?(\d*\.?\d+)(mm|cm|q|in|pc|pt|px)\)?$/;

/** What a page says when it names no size: it gets the default, turned when it asks for landscape. */
const NO_SIZE = new Set(['', 'auto', 'portrait', 'landscape']);

const ORIENTATIONS = new Set(['portrait', 'landscape']);

/**
 * Says whether a page size names a size of its own. An orientation alone does not: the page gets the default size.
 * @param {string} text  CSSPageRule.style.size, '' when there is none.
 * @returns {boolean}
 */
export function namesPageSize(text) {
  return !NO_SIZE.has(text.trim().toLowerCase());
}

/**
 * Reads a CSS page size into points.
 * @param {string} text  CSSPageRule.style.size, such as '154mm 216mm', 'a4 landscape' or '6in'.
 * @returns {Size | null}  null when the text names no size, or names one this does not read; the caller then
 *   leaves the size to Chromium.
 */
export function parsePageSize(text) {
  if (!namesPageSize(text)) return null;
  const words = text.trim().toLowerCase().split(/\s+/);
  const turns = words.filter((word) => ORIENTATIONS.has(word));
  const rest = words.filter((word) => !ORIENTATIONS.has(word));
  if (turns.length > 1) return null;
  if (rest.length === 1 && Object.hasOwn(NAMED_SIZES, rest[0])) return turned(NAMED_SIZES[rest[0]], turns[0]);
  // CSS gives an orientation only to a named size, and one or two lengths otherwise.
  if (turns.length > 0 || rest.length > 2) return null;
  const lengths = rest.map(toPoints);
  if (!lengths.every((length) => length > 0)) return null;
  return { width: lengths[0], height: lengths[1] ?? lengths[0] };
}

/**
 * The CSS size of the default page: A5, plus the bleed on every side, turned when the page asks for landscape.
 * It is a CSS value, so it can be given to Chromium as it is and read back with parsePageSize.
 * @param {string} text  CSSPageRule.style.size of a page that names no size: '', 'auto', 'portrait' or 'landscape'.
 * @param {number} bleed  Millimetres.
 * @returns {string}  Such as '154mm 216mm'.
 */
export function defaultPageCss(text, bleed) {
  // toFixed keeps 0.1 mm of bleed from becoming 148.20000000000002mm.
  const width = Number((148 + 2 * bleed).toFixed(4));
  const height = Number((210 + 2 * bleed).toFixed(4));
  return text.trim().toLowerCase() === 'landscape' ? `${height}mm ${width}mm` : `${width}mm ${height}mm`;
}

/**
 * @param {string} word
 * @returns {number}  The length in points, or NaN when the word is not a length.
 */
function toPoints(word) {
  const match = LENGTH.exec(word);
  return match ? Number(match[1]) * POINTS_PER_UNIT[match[2]] : Number.NaN;
}

/**
 * @param {Size} size  Upright.
 * @param {string | undefined} orientation  'portrait', 'landscape' or none.
 * @returns {Size}  A copy, turned as asked.
 */
function turned(size, orientation) {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  if (orientation === 'landscape') return { width: long, height: short };
  if (orientation === 'portrait') return { width: short, height: long };
  return { ...size };
}
