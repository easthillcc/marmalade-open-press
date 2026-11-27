// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

/** @typedef {[number, number, number]} Rgb  Red, green, blue, each 0..255. */
/** @typedef {[number, number, number, number]} Cmyk  Cyan, magenta, yellow, black, each in percent. */
/** @typedef {{name: string, hex: string, cmyk: Cmyk}} ColourEntry  One line of a colour table. */
/**
 * @typedef {{cmyk: Cmyk, rule: 'table' | 'neutral' | 'profile'}} Mapped
 * The inks for one colour, and the rule that chose them.
 */
/** @typedef {(rgbs: Rgb[]) => Promise<Mapped[]>} MapColours */

// Colours reach us rounded (a content stream writes .9137 for level 233), so equality needs a little room.
const TOLERANCE = 1.5;

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;
const WHITE = [255, 255, 255];
const NO_INK = [0, 0, 0, 0];

/**
 * @param {string} text  "#00AEEF" in either case.
 * @returns {Rgb | null}  The colour, or null for anything else.
 */
export function parseHex(text) {
  const match = HEX_PATTERN.exec(text);
  if (!match) return null;
  const packed = parseInt(match[1], 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

/**
 * @param {Rgb} a
 * @param {Rgb} b
 * @returns {boolean}  Every channel within 1.5 levels.
 */
export function sameColour(a, b) {
  return a.every((channel, i) => Math.abs(channel - b[i]) <= TOLERANCE);
}

/**
 * @param {Rgb} rgb
 * @returns {boolean}  The three channels within 1.5 levels of each other.
 */
export function isNeutral(rgb) {
  return Math.max(...rgb) - Math.min(...rgb) <= TOLERANCE;
}

/**
 * @param {number} level  An sRGB grey level, 0..255.
 * @returns {number}  Its L*, 0..100.
 */
export function lightness(level) {
  // sRGB is gamma-encoded; lightness is defined on linear light.
  const c = level / 255;
  const y = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * @param {number[]} ramp Lightest first, 256 L* values.
 * @param {number} wanted An L*.
 * @returns {number}  The black, in percent, that prints it.
 */
export function blackFor(ramp, wanted) {
  // The ramp runs lightest first; the answer lies between this black and the one just before it.
  const first = ramp.findIndex((l) => l <= wanted);
  if (first === -1) return 100;
  if (first === 0) return 0;
  const lighter = first - 1;
  const k = lighter + (ramp[lighter] - wanted) / (ramp[lighter] - ramp[first]);
  return (k / 255) * 100;
}

/**
 * @param {{table: ColourEntry[], underlay: [number, number, number], ramp: number[],
 *          toProfile: (rgbs: Rgb[]) => Promise<Cmyk[]>}} rules
 * @returns {MapColours}
 */
export function colourRules({ table, underlay, ramp, toProfile }) {
  const entries = table.map(parseTableEntry);
  return async (rgbs) => {
    const local = rgbs.map((rgb) => mapLocally(rgb, entries, underlay, ramp));
    const unmapped = rgbs.filter((_, i) => local[i] === null);
    // One call for the whole list: the profile transform is far cheaper per batch than per colour.
    const profiled = unmapped.length > 0 ? await toProfile(unmapped) : [];
    let next = 0;
    return local.map((hit) => hit ?? { cmyk: profiled[next++], rule: 'profile' });
  };
}

/**
 * The table must already pass checkColourTable, which validates the hex.
 *
 * @param {ColourEntry} entry
 * @returns {{rgb: Rgb, cmyk: Cmyk}}
 */
function parseTableEntry(entry) {
  return { rgb: parseHex(entry.hex), cmyk: entry.cmyk };
}

/**
 * Applies the rules that need no profile, in order. Returns null when the profile must decide.
 *
 * @param {Rgb} rgb
 * @param {{rgb: Rgb, cmyk: Cmyk}[]} entries
 * @param {[number, number, number]} underlay
 * @param {number[]} ramp
 * @returns {Mapped | null}
 */
function mapLocally(rgb, entries, underlay, ramp) {
  const entry = entries.find((candidate) => sameColour(candidate.rgb, rgb));
  if (entry) return { cmyk: entry.cmyk, rule: 'table' };
  if (!isNeutral(rgb)) return null;
  // White is no ink at all: the underlay would otherwise tint the paper.
  if (sameColour(rgb, WHITE)) return { cmyk: NO_INK, rule: 'neutral' };
  const level = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return { cmyk: [...underlay, blackFor(ramp, lightness(level))], rule: 'neutral' };
}
