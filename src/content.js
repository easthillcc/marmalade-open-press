// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/** @typedef {{type: 'number' | 'name' | 'string' | 'operator' | 'punctuation', start: number, end: number}} Token */

/**
 * A stretch of the stream to replace. A colour edit carries the colour to map, and for rg and g the operator
 * its inks are followed by. A colour space edit carries the replacement text.
 * @typedef {{start: number, end: number, rgb?: import('./colour.js').Rgb, operator?: string, text?: string}} Edit
 */

/**
 * What a walk writes: the colour space that replaces /DeviceRGB, and the operators that set a fill and a stroke.
 * @typedef {{space: string, fill: string, stroke: string}} Target
 */

/**
 * The state of one walk over the operators.
 * @typedef {{source: string, rgbSpaces: Set<string>, target: Target, edits: Edit[],
 *            spaces: {fill: string, stroke: string}, stack: {fill: string, stroke: string}[], unknownRgb: number}} Walk
 */

/** The PDF white-space characters, NUL included, as the PDF specification lists them. */
const WHITE_SPACE = new Set(['\0', '\t', '\n', '\f', '\r', ' ']);

/** The characters that end a regular run. Some also open a token of their own, so a run never swallows them. */
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

/** Chromium writes numbers such as ".5", "-1.25", "+3" and "4."; the operators never look like this. */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Colours for the press: four inks, written with k and K. @type {Target} */
const CMYK = { space: '/DeviceCMYK', fill: 'k', stroke: 'K' };

/** Colours that are opacity, in a luminosity mask: one grey, written with g and G. @type {Target} */
const GREY = { space: '/DeviceGray', fill: 'g', stroke: 'G' };

/**
 * Splits a content stream into tokens, reporting positions only so the text is never changed.
 * It never throws: an unclosed string or hex string runs to the end of the source.
 * @param {string} source A content stream, one character per byte.
 * @returns {Token[]}
 */
export function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (WHITE_SPACE.has(source[index])) {
      index += 1;
    } else if (source[index] === '%') {
      index = endOfComment(source, index);
    } else {
      const token = readToken(source, index);
      tokens.push(token);
      index = token.end;
    }
  }
  return tokens;
}

/**
 * Reads the token that starts at a position holding neither white space nor a comment.
 * The token always ends after its first character, so the caller always moves forward.
 * @param {string} source
 * @param {number} start
 * @returns {Token}
 */
function readToken(source, start) {
  const ch = source[start];
  if (ch === '(') {
    return { type: 'string', start, end: endOfLiteralString(source, start) };
  }
  if (ch === '<' && source[start + 1] === '<') {
    return { type: 'punctuation', start, end: start + 2 };
  }
  if (ch === '>' && source[start + 1] === '>') {
    return { type: 'punctuation', start, end: start + 2 };
  }
  if (ch === '<') {
    return { type: 'string', start, end: endOfHexString(source, start) };
  }
  if (ch === '/') {
    return { type: 'name', start, end: endOfRegularRun(source, start + 1) };
  }
  if (DELIMITERS.has(ch)) {
    return { type: 'punctuation', start, end: start + 1 };
  }
  const end = endOfRegularRun(source, start);
  const type = NUMBER.test(source.slice(start, end)) ? 'number' : 'operator';
  return { type, start, end };
}

/** A comment runs to the end of its line; the line break itself is white space, not part of it. */
function endOfComment(source, start) {
  let index = start;
  while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
    index += 1;
  }
  return index;
}

/**
 * Parentheses nest, and a backslash makes the next character inert, so an escaped ')' does not close
 * the string. Binary bytes inside the string are read the same way.
 */
function endOfLiteralString(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '\\') {
      index += 1;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return source.length;
}

/** A hex string has no nesting, so it ends at the first '>' after its '<'. */
function endOfHexString(source, start) {
  const close = source.indexOf('>', start + 1);
  return close === -1 ? source.length : close + 1;
}

/** The run of regular characters from a position; it stops at white space or at any delimiter. */
function endOfRegularRun(source, start) {
  let index = start;
  while (index < source.length && !WHITE_SPACE.has(source[index]) && !DELIMITERS.has(source[index])) {
    index += 1;
  }
  return index;
}

/**
 * Rewrites the colours of a content stream to CMYK. Only the colour operators and their operands change; the
 * rest of the stream is copied byte for byte.
 * @param {string} source            A content stream, latin1.
 * @param {Set<string>} rgbSpaces    Names of the resource colour spaces that are RGB, with their slash: '/CS0'.
 * @param {import('./colour.js').MapColours} mapColours
 * @returns {Promise<{source: string, mapped: import('./colour.js').Mapped[], inlineImage: boolean, leftRgb: number}>}
 *   leftRgb counts the colours left as they were because their colour space is not known to be RGB.
 */
export async function recolour(source, rgbSpaces, mapColours) {
  const tokens = tokenize(source);
  if (hasInlineImage(source, tokens)) return { source, mapped: [], inlineImage: true, leftRgb: 0 };
  const { edits, unknownRgb } = collectEdits(source, tokens, rgbSpaces, CMYK);
  const colourEdits = edits.filter((edit) => edit.rgb !== undefined);
  const mapped = await mapColours(colourEdits.map((edit) => edit.rgb));
  const inksByEdit = new Map(colourEdits.map((edit, i) => [edit, mapped[i].cmyk]));
  const replacements = edits.map((edit) => {
    if (edit.rgb === undefined) return edit.text;
    const inks = formatInks(inksByEdit.get(edit));
    return edit.operator === undefined ? inks : `${inks} ${edit.operator}`;
  });
  return { source: splice(source, edits, replacements), mapped, inlineImage: false, leftRgb: unknownRgb };
}

/**
 * Rewrites the colours of a luminosity soft mask's content stream to DeviceGray. In such a mask a colour is an
 * opacity, so it does not go through a profile: each RGB colour becomes the grey of its luminosity, the value PDF
 * itself takes from it, and the mask gives exactly the opacity it gave before.
 * @param {string} source            A content stream, latin1.
 * @param {Set<string>} rgbSpaces    Names of the resource colour spaces that are RGB, with their slash: '/CS0'.
 * @returns {{source: string, inlineImage: boolean, leftRgb: number}}
 *   leftRgb counts the colours left as they were because their colour space is not known to be RGB.
 */
export function recolourToGrey(source, rgbSpaces) {
  const tokens = tokenize(source);
  if (hasInlineImage(source, tokens)) return { source, inlineImage: true, leftRgb: 0 };
  const { edits, unknownRgb } = collectEdits(source, tokens, rgbSpaces, GREY);
  const replacements = edits.map((edit) => {
    if (edit.rgb === undefined) return edit.text;
    const level = formatLevel(luminosity(edit.rgb));
    return edit.operator === undefined ? level : `${level} ${edit.operator}`;
  });
  return { source: splice(source, edits, replacements), inlineImage: false, leftRgb: unknownRgb };
}

/**
 * The luminosity PDF gives an RGB colour, 0.3 R + 0.59 G + 0.11 B: the weights of a luminosity mask, and of
 * DeviceRGB read as grey.
 * @param {import('./colour.js').Rgb} rgb  Levels from 0 to 255.
 * @returns {number}  From 0 to 1.
 */
export function luminosity([red, green, blue]) {
  return (0.3 * red + 0.59 * green + 0.11 * blue) / 255;
}

/**
 * An inline image's binary data cannot be tokenized safely, so a stream that holds one is left whole for the
 * caller to report.
 * @param {string} source
 * @param {Token[]} tokens
 * @returns {boolean}
 */
function hasInlineImage(source, tokens) {
  return tokens.some((token) => token.type === 'operator' && textOf(source, token) === 'BI');
}

/**
 * @param {string} source
 * @param {Token} token
 * @returns {string}
 */
function textOf(source, token) {
  return source.slice(token.start, token.end);
}

/**
 * Walks the operators in order, following the colour space of each side, and collects the edits in source order.
 * @param {string} source
 * @param {Token[]} tokens
 * @param {Set<string>} rgbSpaces
 * @param {Target} target  What the colours are written as.
 * @returns {Walk}  Its edits, and how many colours were left unknown.
 */
function collectEdits(source, tokens, rgbSpaces, target) {
  /** @type {Walk} */
  const walk = { source, rgbSpaces, target, edits: [], spaces: { fill: 'other', stroke: 'other' }, stack: [], unknownRgb: 0 };
  let operands = [];
  for (const token of tokens) {
    if (token.type === 'operator') {
      applyOperator(walk, token, operands);
      operands = [];
    } else {
      operands.push(token);
    }
  }
  return walk;
}

/**
 * @param {Walk} walk
 * @param {Token} token      An operator.
 * @param {Token[]} operands The tokens since the previous operator.
 */
function applyOperator(walk, token, operands) {
  const op = textOf(walk.source, token);
  // Lower-case operators paint the fill, upper-case ones the stroke.
  const side = op === op.toLowerCase() ? 'fill' : 'stroke';
  const numbers = numericValues(walk.source, operands);
  switch (op) {
    case 'q':
      walk.stack.push({ ...walk.spaces });
      break;
    case 'Q':
      if (walk.stack.length > 0) walk.spaces = walk.stack.pop();
      break;
    case 'rg':
    case 'RG':
    case 'g':
    case 'G':
      setPaintColour(walk, side, token, operands, numbers);
      break;
    case 'sc':
    case 'scn':
    case 'SC':
    case 'SCN':
      setComponentsColour(walk, side, operands, numbers);
      break;
    case 'k':
    case 'K':
      walk.spaces[side] = 'other';
      break;
    case 'cs':
    case 'CS':
      walk.spaces[side] = colourSpaceKind(walk, operands);
      break;
    default:
      break;
  }
}

/**
 * rg and RG take three components, g and G one. Anything else leaves the colour alone and loses the space.
 * @param {Walk} walk
 * @param {'fill' | 'stroke'} side
 * @param {Token} token      The operator.
 * @param {Token[]} operands
 * @param {number[]} numbers
 */
function setPaintColour(walk, side, token, operands, numbers) {
  const isRgb = textOf(walk.source, token).toLowerCase() === 'rg';
  if (numbers.length !== (isRgb ? 3 : 1)) {
    walk.spaces[side] = 'other';
    return;
  }
  walk.edits.push({
    start: operands[0].start,
    end: token.end,
    rgb: rgbOf(numbers),
    operator: side === 'fill' ? walk.target.fill : walk.target.stroke,
  });
  walk.spaces[side] = isRgb ? 'rgb' : 'gray';
}

/**
 * sc and its relatives set a colour in the space the side is in. A grey space is tracked too: once g has been
 * rewritten as k, a following one-number sc would be read as CMYK, so it is rewritten as well.
 * A three-number colour in a space this walk cannot see is counted, not converted: the space may be inherited
 * from the page, and the press must be told that RGB is left.
 * @param {Walk} walk
 * @param {'fill' | 'stroke'} side
 * @param {Token[]} operands
 * @param {number[]} numbers
 */
function setComponentsColour(walk, side, operands, numbers) {
  const space = walk.spaces[side];
  const fits = (space === 'rgb' && numbers.length === 3) || (space === 'gray' && numbers.length === 1);
  if (fits) {
    walk.edits.push({
      start: operands[0].start,
      end: operands[operands.length - 1].end,
      rgb: rgbOf(numbers),
    });
  } else if (space === 'other' && numbers.length === 3) {
    walk.unknownRgb += 1;
  }
}

/**
 * Only a single operand names a colour space. /DeviceRGB is rewritten to the target's space here; a named RGB space is
 * left alone because the resources entry is rewritten elsewhere.
 * @param {Walk} walk
 * @param {Token[]} operands
 * @returns {string}  The space the side is in now.
 */
function colourSpaceKind(walk, operands) {
  if (operands.length !== 1 || operands[0].type !== 'name') return 'other';
  const name = textOf(walk.source, operands[0]);
  if (name === '/DeviceRGB') {
    walk.edits.push({ start: operands[0].start, end: operands[0].end, text: walk.target.space });
    return 'rgb';
  }
  return walk.rgbSpaces.has(name) ? 'rgb' : 'other';
}

/**
 * @param {string} source
 * @param {Token[]} operands
 * @returns {number[]}  The operands as numbers, or none when any operand is not a number.
 */
function numericValues(source, operands) {
  if (!operands.every((operand) => operand.type === 'number')) return [];
  return operands.map((operand) => Number(textOf(source, operand)));
}

/**
 * A grey repeats its one level. Levels arrive as 0..1 and leave as 0..255, the scale the colour table uses.
 * @param {number[]} numbers
 * @returns {import('./colour.js').Rgb}
 */
function rgbOf(numbers) {
  const levels = numbers.length === 1 ? [numbers[0], numbers[0], numbers[0]] : numbers;
  return /** @type {import('./colour.js').Rgb} */ (levels.map((level) => level * 255));
}

/**
 * Writes inks as fractions of 1, the form a content stream takes, with no trailing zeros.
 * @param {import('./colour.js').Cmyk} cmyk  Percent.
 * @returns {string}
 */
function formatInks(cmyk) {
  return cmyk.map((percent) => formatLevel(percent / 100)).join(' ');
}

/**
 * Writes a level from 0 to 1 with at most four decimals and no trailing zeros, the form a content stream takes.
 * @param {number} level
 * @returns {string}
 */
function formatLevel(level) {
  return String(Number(level.toFixed(4)));
}

/**
 * Copies the stretches of source between edits, putting each replacement in place of its edit.
 * @param {string} source
 * @param {Edit[]} edits         In source order, never overlapping.
 * @param {string[]} replacements One per edit.
 * @returns {string}
 */
function splice(source, edits, replacements) {
  let out = '';
  let cursor = 0;
  edits.forEach((edit, i) => {
    out += source.slice(cursor, edit.start) + replacements[i];
    cursor = edit.end;
  });
  return out + source.slice(cursor);
}
