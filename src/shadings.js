// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { isNumberWord, parse, run, words } from './calculator.js';
import { everyDict, isRgbSpace, name, readStream, writeStream } from './pdf.js';

/**
 * @typedef {import('pdf-lib').PDFContext} PDFContext
 * @typedef {import('./colour.js').MapColours} MapColours
 * @typedef {import('./colour.js').Mapped} Mapped
 * @typedef {import('./colour.js').Rgb} Rgb
 * @typedef {import('./images.js').Left} Left
 * @typedef {number[]} Colour  A colour as a function gives it: one number from 0 to 1 per component.
 * @typedef {{from: number, to: number, start: Colour, end: Colour}} Piece  Where t runs from `from` (not
 *   included) to `to`, the colour runs in a straight line from `start` to `end`.
 * @typedef {{breaks: number[], low: Colour, high: Colour, pieces: Piece[]}} Ramp  The colour stops of one
 *   gradient: `low` at t <= 0, the pieces, then `high` past the last break.
 * @typedef {{at: number, end: number, ramp?: Ramp, colour?: Colour}} Part  The words from `at` to `end` of a
 *   program that make its colour: a ramp, or one colour in braces.
 * @typedef {{ref: PDFRef, stream: PDFRawStream, list: string[], parts: Part[]}} Program  A calculator function
 *   whose colours are known.
 * @typedef {{why: string, functionType?: number}} Reason  Why a shading is left in RGB.
 */

/**
 * The items of an array, each with its reference followed.
 * @param {PDFArray} array
 * @returns {import('pdf-lib').PDFObject[]}
 */
function itemsOf(array) {
  return Array.from({ length: array.size() }, (_, at) => array.lookup(at));
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} value
 * @returns {number[] | null} The numbers of an array of numbers, or null for anything else.
 */
function numbersOf(value) {
  if (!(value instanceof PDFArray)) return null;
  const items = itemsOf(value);
  return items.every((item) => item instanceof PDFNumber) ? items.map((item) => item.asNumber()) : null;
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} value
 * @returns {boolean} True for an array of exactly three numbers.
 */
function isRgbTriple(value) {
  return numbersOf(value)?.length === 3;
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object  A function: a dictionary, or a stream for types 0 and 4.
 * @returns {number | undefined} Its /FunctionType.
 */
function functionType(object) {
  const dict = object instanceof PDFStream ? object.dict : object;
  if (!(dict instanceof PDFDict)) return undefined;
  const type = dict.lookup(name('FunctionType'));
  return type instanceof PDFNumber ? type.asNumber() : undefined;
}

/**
 * @param {import('pdf-lib').PDFObject | undefined} object
 * @returns {boolean} True for a type 2 function that blends from one RGB colour to another.
 */
function isBlend(object) {
  return object instanceof PDFDict
    && functionType(object) === 2
    && isRgbTriple(object.lookup(name('C0')))
    && isRgbTriple(object.lookup(name('C1')));
}

/** How far two runs of a program may part, per component, and still be the same gradient. */
const SAME = 1e-4;
/** How far a piece may bend, per component, and still be a straight line. */
const STRAIGHT = 1e-6;
/** The grid of points, per side of the domain, on which a rewritten program is checked against the original. */
const GRID = 24;

/**
 * @param {number} value
 * @returns {string} The number as a calculator program writes it: decimals, never an exponent.
 */
function decimal(value) {
  const text = String(value);
  return text.includes('e') ? value.toFixed(12).replace(/\.?0+$/, '') : text;
}

/**
 * @param {number} value
 * @returns {string} The number to six decimals, which is finer than any ink.
 */
const rounded = (value) => decimal(Math.round(value * 1e6) / 1e6);

/**
 * @param {string[]} list
 * @param {number} at  Where a '{' stands.
 * @returns {number} Where the word after its matching '}' stands, or -1.
 */
function afterBraces(list, at) {
  if (list[at] !== '{') return -1;
  let depth = 0;
  for (let next = at; next < list.length; next += 1) {
    if (list[next] === '{') depth += 1;
    if (list[next] === '}') depth -= 1;
    if (depth === 0) return next + 1;
  }
  return -1;
}

/**
 * @param {string[]} list
 * @param {number} at
 * @param {string[]} expected
 * @returns {boolean} True when the words from `at` are `expected`, a '#' standing for any number.
 */
function wordsAt(list, at, expected) {
  return expected.every((word, k) => (word === '#' ? isNumberWord(list[at + k] ?? '') : list[at + k] === word));
}

/**
 * Finds the end of the ramp that starts at `at`, written as Chromium writes the colour of a gradient from t:
 * "dup 0 le {...} if", then "dup dup 0 gt exch <last> le and {...} if", then "0 gt {...} if".
 * @param {string[]} list
 * @param {number} at
 * @returns {number} Where the word after the ramp stands, or -1 when no ramp starts at `at`.
 */
function rampEnd(list, at) {
  let next = at;
  for (const opening of [['dup', '0', 'le'], ['dup', 'dup', '0', 'gt', 'exch', '#', 'le', 'and'], ['0', 'gt']]) {
    if (!wordsAt(list, next, opening)) return -1;
    next = afterBraces(list, next + opening.length);
    if (next < 0 || list[next] !== 'if') return -1;
    next += 1;
  }
  return next;
}

/**
 * Reads the colour stops of a ramp by running it. The breaks are the numbers the ramp compares t with; between
 * two breaks, each component must run in a straight line, which three runs inside the piece confirm.
 * @param {string[]} ramp  The words of the ramp.
 * @returns {Ramp | null}
 */
function readRamp(ramp) {
  const breaks = [...new Set(ramp.flatMap((word, at) => (isNumberWord(word) && ramp[at + 1] === 'le' ? [Number(word)] : [])))]
    .sort((a, b) => a - b);
  if (breaks.length < 2 || breaks[0] !== 0) return null;
  const program = parse(['{', ...ramp, '}']);
  const colourAt = (t) => {
    const colour = run(program, [t]);
    if (colour.length !== 3) throw new Error('A ramp leaves three numbers.');
    return colour;
  };
  const pieces = [];
  for (let k = 1; k < breaks.length; k += 1) {
    const [from, to] = [breaks[k - 1], breaks[k]];
    const [p, q, r] = [1, 2, 3].map((quarter) => colourAt(from + ((to - from) * quarter) / 4));
    const end = colourAt(to);
    const straight = p.every((value, i) => Math.abs(q[i] - (value + r[i]) / 2) <= STRAIGHT
      && Math.abs(end[i] - (value + 1.5 * (r[i] - value))) <= STRAIGHT);
    if (!straight) return null;
    pieces.push({ from, to, start: p.map((value, i) => value - (r[i] - value) / 2), end });
  }
  return { breaks, low: colourAt(0), high: colourAt(breaks.at(-1) + 1), pieces };
}

/**
 * @param {Part} part
 * @returns {Colour[]} The colours of a part, in the order `partCode` takes them.
 */
function partColours(part) {
  if (part.colour) return [part.colour];
  const { low, high, pieces } = /** @type {Ramp} */ (part.ramp);
  return [low, high, ...pieces.flatMap(({ start, end }) => [start, end])];
}

/**
 * @param {Piece[]} pieces  Each with its colours in the components to write.
 * @returns {string} The words that turn t into the colour of its piece.
 */
function piecesCode(pieces) {
  const [{ from, to, start, end }, ...rest] = pieces;
  const width = to - from;
  const last = start.length - 1;
  const flat = start.every((value, i) => value === end[i]);
  const line = flat
    ? `pop ${start.map(rounded).join(' ')}`
    : start.map((value, i) => {
      const term = `${rounded((end[i] - value) / width)} mul ${rounded(value)} add`;
      return i < last ? `dup ${term} exch` : term;
    }).join(' ');
  const own = `${decimal(from)} sub ${line}`;
  return rest.length === 0 ? own : `dup ${decimal(to)} le {${own}} {${piecesCode(rest)}} ifelse`;
}

/**
 * @param {Part} part
 * @param {Colour[]} colours  The colours of the part, as `partColours` orders them, in the components to write.
 * @returns {string} The words of the part, written as Chromium writes them.
 */
function partCode(part, colours) {
  if (part.colour) return `{${colours[0].map(rounded).join(' ')}}`;
  const { breaks, pieces } = /** @type {Ramp} */ (part.ramp);
  const [low, high, ...ends] = colours;
  const coloured = pieces.map((piece, k) => ({ ...piece, start: ends[2 * k], end: ends[2 * k + 1] }));
  return [
    `dup 0 le {pop ${low.map(rounded).join(' ')} 0} if`,
    `dup dup 0 gt exch ${decimal(breaks.at(-1))} le and {`,
    piecesCode(coloured),
    '0} if',
    `0 gt {${high.map(rounded).join(' ')}} if`,
  ].join('\n');
}

/**
 * @param {string[]} list  The words of the program.
 * @param {Part[]} parts
 * @param {Colour[][]} colours  The colours of each part.
 * @returns {string} The program with each part written again with its colours.
 */
function programText(list, parts, colours) {
  const text = [];
  let at = 0;
  parts.forEach((part, k) => {
    text.push(...list.slice(at, part.at), partCode(part, colours[k]));
    at = part.end;
  });
  text.push(...list.slice(at));
  return text.join(' ');
}

/**
 * Runs two programs on a grid over the domain.
 * @param {number[]} domain  x0 x1 y0 y1.
 * @param {(xy: number[]) => boolean} agree  Whether the runs at one point are as they should be.
 * @returns {boolean} True when they are at every point.
 */
function overGrid(domain, agree) {
  const [x0, x1, y0, y1] = domain;
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      if (!agree([x0 + ((x1 - x0) * i) / GRID, y0 + ((y1 - y0) * j) / GRID])) return false;
    }
  }
  return true;
}

/**
 * Finds the colours of a calculator function, as Chromium writes it for a repeating, conic or focal gradient:
 * ramps from t to a colour, and colours in braces. The program is accepted only when, written again from what
 * was read, it gives the same colours on a grid over the domain, and when, written in four components, it
 * leaves four numbers there.
 * @param {string[]} list  The words of the program.
 * @param {number[]} domain
 * @returns {Part[] | null}
 */
function readParts(list, domain) {
  const parts = [];
  for (let at = 0; at < list.length;) {
    const end = rampEnd(list, at);
    if (end > 0) {
      const ramp = readRamp(list.slice(at, end));
      if (ramp === null) return null;
      parts.push({ at, end, ramp });
      at = end;
    } else if (list[at] === '{' && list[at + 4] === '}' && wordsAt(list, at + 1, ['#', '#', '#'])) {
      parts.push({ at, end: at + 5, colour: list.slice(at + 1, at + 4).map(Number) });
      at += 5;
    } else {
      at += 1;
    }
  }
  if (parts.length === 0) return null;

  const original = parse(list);
  const colours = parts.map(partColours);
  const again = parse(words(programText(list, parts, colours)));
  const four = parse(words(programText(list, parts, colours.map((set) => set.map((colour) => [...colour, 0])))));
  const same = overGrid(domain, (xy) => {
    const [a, b] = [run(original, xy), run(again, xy)];
    return a.length === 3 && b.length === 3 && a.every((value, i) => Math.abs(value - b[i]) <= SAME);
  });
  return same && overGrid(domain, (xy) => run(four, xy).length === 4) ? parts : null;
}

/**
 * @param {PDFContext} context
 * @param {import('pdf-lib').PDFObject | undefined} ref  The shading's /Function, as written.
 * @returns {Program | null} The calculator function at `ref` with its colours read, or null when they cannot be.
 */
function readProgram(context, ref) {
  const stream = context.lookup(ref);
  if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) return null;
  const domain = numbersOf(stream.dict.lookup(name('Domain')));
  if (domain?.length !== 4 || numbersOf(stream.dict.lookup(name('Range')))?.length !== 6) return null;
  try {
    const list = words(readStream(stream).toString('latin1'));
    const parts = readParts(list, domain);
    return parts && { ref, stream, list, parts };
  } catch {
    // A program this reader cannot run is left as it is.
    return null;
  }
}

/** What is said of a function that is not converted, by its type. */
const UNREAD = {
  0: 'sampled functions are not converted',
  2: 'it does not blend two RGB colours',
  3: 'only stitching of blends between two RGB colours is converted',
  4: 'only the PostScript gradients that Chromium writes are converted',
};

/**
 * What a shading runs in ink. A shading with a /Background is left alone: the background would be a colour
 * the function does not carry.
 * @param {PDFContext} context
 * @param {PDFDict} shading
 * @returns {{parts: PDFDict[]} | {parts: PDFRawStream[], program: Program} | {reason: Reason}} The blends or the
 *   calculator function, each with the function objects it changes, or why the shading is left in RGB.
 */
function readShading(context, shading) {
  if (shading.has(name('Background'))) return { reason: { why: 'a shading with a background is not converted' } };
  const fn = shading.lookup(name('Function'));
  if (fn === undefined) {
    const mesh = shading.lookup(name('ShadingType'), PDFNumber).asNumber() >= 4;
    return { reason: { why: mesh ? 'mesh shadings are not converted' : 'it has no colour function' } };
  }
  if (fn instanceof PDFArray) return { reason: { why: 'one function per colour component is not converted' } };
  if (isBlend(fn)) return { parts: [fn] };
  const type = functionType(fn);
  const pieces = type === 3 && fn instanceof PDFDict ? fn.lookup(name('Functions')) : undefined;
  if (pieces instanceof PDFArray && itemsOf(pieces).every(isBlend)) return { parts: /** @type {PDFDict[]} */ (itemsOf(pieces)) };
  const program = type === 4 ? readProgram(context, shading.get(name('Function'))) : null;
  if (program) return { parts: [program.stream], program };
  return { reason: { why: UNREAD[type] ?? 'functions of this type are not converted', functionType: type } };
}

/**
 * @param {PDFContext} context
 * @returns {Generator<PDFDict>} The RGB shadings of the file, each once.
 */
function* rgbShadings(context) {
  for (const dict of everyDict(context)) {
    if (dict.has(name('ShadingType')) && isRgbSpace(context, dict.get(name('ColorSpace')))) yield dict;
  }
}

/**
 * The functions a shading runs on: its /Function and, for a stitching function, each of its pieces.
 * @param {PDFDict} shading
 * @returns {(PDFDict | PDFStream)[]}
 */
function functionsOf(shading) {
  const isFunction = (object) => object instanceof PDFDict || object instanceof PDFStream;
  const fn = shading.lookup(name('Function'));
  if (!isFunction(fn)) return [];
  const functions = fn instanceof PDFDict ? fn.lookup(name('Functions')) : undefined;
  const pieces = functions instanceof PDFArray ? itemsOf(functions) : [];
  return [fn, ...pieces.filter(isFunction)];
}

/**
 * @param {{shading: PDFDict, reason: Reason}} left
 * @returns {Left} The report of a shading left in RGB.
 */
function leftReport({ shading, reason }) {
  const type = shading.lookup(name('ShadingType'), PDFNumber).asNumber();
  const fn = reason.functionType === undefined ? '' : `, function of type ${reason.functionType}`;
  return { what: `shading of type ${type}${fn}: ${reason.why}`, rgb: true };
}

/**
 * Sorts the RGB shadings into those that can run in ink and those left in RGB.
 * This runs before any change, because two shadings may share one function, and a function already
 * converted no longer gives three numbers per colour.
 * A shading that shares a function with a shading left in RGB is left too: converting that
 * function would paint the left shading with CMYK values. Moving a shading can expose more shared
 * functions, so this repeats until nothing moves.
 * @param {PDFContext} context
 * @returns {{converted: {shading: PDFDict, parts: (PDFDict | PDFRawStream)[], program?: Program}[], left: Left[]}}
 */
function sortShadings(context) {
  let converted = [];
  const leftShadings = [];
  for (const shading of rgbShadings(context)) {
    const read = readShading(context, shading);
    if ('reason' in read) {
      leftShadings.push({ shading, reason: read.reason });
    } else {
      converted.push({ shading, ...read });
    }
  }

  for (;;) {
    const leftFunctions = new Set(leftShadings.flatMap(({ shading }) => functionsOf(shading)));
    const moving = converted.filter(({ parts }) => parts.some((part) => leftFunctions.has(part)));
    if (moving.length === 0) break;
    converted = converted.filter((entry) => !moving.includes(entry));
    const reason = { why: 'it shares a function with a shading left in RGB' };
    leftShadings.push(...moving.map(({ shading }) => ({ shading, reason })));
  }
  return { converted, left: leftShadings.map(leftReport) };
}

/**
 * @param {PDFDict} blend
 * @param {string} key  'C0' or 'C1'.
 * @returns {Rgb} The colour at `key`, 0..255 per channel.
 */
function rgbEnd(blend, key) {
  const components = blend.lookup(name(key), PDFArray);
  return /** @type {Rgb} */ (itemsOf(components).map((component) => component.asNumber() * 255));
}

/**
 * @param {PDFContext} context
 * @param {PDFDict} blend
 * @param {string} key  'C0' or 'C1'.
 * @param {Mapped} mapped
 * @returns {void}
 */
function setCmyk(context, blend, key, mapped) {
  blend.set(name(key), context.obj(mapped.cmyk.map((percent) => percent / 100)));
}

/**
 * Writes a calculator function again with its colours in CMYK, over the full CMYK range.
 * @param {PDFContext} context
 * @param {Program} program
 * @param {Mapped[]} mapped  The inks of the program's colours, part by part, as `partColours` orders them.
 * @returns {void}
 */
function writeProgram(context, { ref, stream, list, parts }, mapped) {
  const inks = mapped.map(({ cmyk }) => cmyk.map((percent) => percent / 100));
  let next = 0;
  const colours = parts.map((part) => {
    const count = partColours(part).length;
    next += count;
    return inks.slice(next - count, next);
  });
  stream.dict.set(name('Range'), context.obj([0, 1, 0, 1, 0, 1, 0, 1]));
  writeStream(context, ref, Buffer.from(programText(list, parts, colours), 'latin1'));
}

/**
 * Converts the RGB shadings that can run in ink to CMYK. A blend has the colours at its ends converted, and
 * the ink between them is interpolated. A calculator function has the colours at each stop converted, and
 * the ink between two stops is interpolated as well.
 * A /Range holds one pair per colour component; once a blend's ends are CMYK it would be one pair short,
 * so it is removed and the blend runs over the full output range.
 * @param {PDFContext} context
 * @param {MapColours} mapColours
 * @returns {Promise<{mapped: Mapped[], left: Left[]}>}
 */
export async function convertShadings(context, mapColours) {
  const { converted, left } = sortShadings(context);
  // A function shared by two shadings is listed once, so its colours are not converted twice.
  const blends = [...new Set(converted.filter(({ program }) => !program).flatMap(({ parts }) => parts))];
  const programs = [...new Map(converted.filter(({ program }) => program).map(({ program }) => [program.stream, program])).values()];
  const ends = blends.flatMap((blend) => [rgbEnd(blend, 'C0'), rgbEnd(blend, 'C1')]);
  // The /Range of the program holds each component between 0 and 1.
  const toRgb = (colour) => colour.map((value) => Math.min(1, Math.max(0, value)) * 255);
  const stops = programs.map((program) => program.parts.flatMap(partColours).map(toRgb));
  const rgbs = [...ends, ...stops.flat()];
  const mapped = rgbs.length > 0 ? await mapColours(/** @type {Rgb[]} */ (rgbs)) : [];

  blends.forEach((blend, at) => {
    setCmyk(context, blend, 'C0', mapped[2 * at]);
    setCmyk(context, blend, 'C1', mapped[2 * at + 1]);
    blend.delete(name('Range'));
  });
  let next = ends.length;
  programs.forEach((program, k) => {
    writeProgram(context, program, mapped.slice(next, next + stops[k].length));
    next += stops[k].length;
  });
  for (const { shading, program } of converted) {
    if (!program) shading.lookup(name('Function'), PDFDict).delete(name('Range'));
    shading.set(name('ColorSpace'), name('DeviceCMYK'));
  }
  return { mapped, left };
}
