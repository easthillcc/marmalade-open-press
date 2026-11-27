// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { readFile } from 'node:fs/promises';
import { parseHex } from './colour.js';

/** @typedef {import('./colour.js').ColourEntry} ColourEntry */

// A preset is named by lowercase letters, digits and hyphens only, so a path such as "house.json" never matches.
const PRESET_NAME = /^[a-z0-9-]+$/;

/**
 * @param {unknown} value
 * @returns {boolean}  A non-null object, so a JSON null is refused like any other non-object.
 */
function isObject(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * @param {unknown} value
 * @returns {boolean}  A finite number from 0 to 100, in percent of ink.
 */
function isInk(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * @param {unknown} entry
 * @returns {string | null}  What the entry still needs, or null when it is sound.
 */
function entryFault(entry) {
  if (!isObject(entry) || typeof entry.name !== 'string' || entry.name === '') return 'needs a name';
  if (typeof entry.hex !== 'string' || parseHex(entry.hex) === null) {
    return 'needs a hex colour such as "#1A2B3C"';
  }
  if (!Array.isArray(entry.cmyk) || entry.cmyk.length !== 4 || !entry.cmyk.every(isInk)) {
    return 'needs cmyk as four numbers from 0 to 100';
  }
  return null;
}

/**
 * @param {unknown} value  The parsed JSON of a colour table.
 * @returns {ColourEntry[]} The same value. Throws an Error that names the entry at fault.
 */
export function checkColourTable(value) {
  if (!Array.isArray(value)) throw new Error('A colour table is a JSON array of entries.');
  for (const [index, entry] of value.entries()) {
    const need = entryFault(entry);
    if (need !== null) throw new Error(`Colour table entry ${index + 1} ${need}.`);
  }
  return value;
}

/**
 * @param {string} nameOrPath  A preset name ("classic") or the path of a JSON file.
 * @returns {Promise<ColourEntry[]>}  The checked table.
 */
export async function loadColourTable(nameOrPath) {
  const isPreset = PRESET_NAME.test(nameOrPath);
  const source = isPreset ? new URL(`../presets/${nameOrPath}.json`, import.meta.url) : nameOrPath;

  let text;
  try {
    text = await readFile(source, 'utf8');
  } catch {
    throw new Error(
      isPreset
        ? `There is no colour preset called "${nameOrPath}".`
        : `Cannot read the colour table ${nameOrPath}.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The colour table ${nameOrPath} is not valid JSON.`);
  }
  return checkColourTable(parsed);
}
