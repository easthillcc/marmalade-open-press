// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

/**
 * PostScript calculator functions, the functions of type 4 in a PDF (ISO 32000-1, 7.10.5): a program in braces
 * that takes numbers and leaves numbers, with no loops and no names of its own. Chromium writes repeating and
 * conic gradients as such programs. This module splits a program into words and runs it.
 */

/**
 * @typedef {number | boolean} Value
 * @typedef {(string | number | boolean | Procedure)[]} Procedure  A program in braces, its numbers read and its
 *   inner braces nested.
 */

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** The spec allows 100 operands; a program that needs more is not one this reader trusts. */
const STACK_LIMIT = 100;

/**
 * @param {string} word
 * @returns {boolean} True for a word that is a number.
 */
export const isNumberWord = (word) => NUMBER.test(word);

/**
 * @param {string} text  The program, as the stream holds it.
 * @returns {string[]} Its words, with each brace a word of its own.
 */
export function words(text) {
  return text.match(/[{}]|[^\s{}]+/g) ?? [];
}

/**
 * Reads the words of a program into a procedure. The whole program is one procedure in braces.
 * @param {string[]} list
 * @returns {Procedure}
 */
export function parse(list) {
  if (list[0] !== '{' || list.at(-1) !== '}') throw new Error('A calculator program is one procedure in braces.');
  const stack = [[]];
  for (const word of list) {
    if (word === '{') {
      stack.push([]);
    } else if (word === '}') {
      const done = stack.pop();
      if (stack.length === 0) throw new Error('A brace closes nothing.');
      stack.at(-1).push(done);
    } else if (NUMBER.test(word)) {
      stack.at(-1).push(Number(word));
    } else if (word === 'true' || word === 'false') {
      stack.at(-1).push(word === 'true');
    } else {
      stack.at(-1).push(word);
    }
  }
  if (stack.length !== 1 || stack[0].length !== 1) throw new Error('The braces of the program do not match.');
  return /** @type {Procedure} */ (stack[0][0]);
}

/**
 * @param {Value} value
 * @returns {number}
 */
function num(value) {
  if (typeof value !== 'number') throw new Error('A number was expected.');
  return value;
}

const RADIANS = Math.PI / 180;

/** @type {Record<string, (a: number) => number>} */
const UNARY = {
  abs: Math.abs,
  ceiling: Math.ceil,
  cos: (a) => Math.cos(a * RADIANS),
  cvi: Math.trunc,
  cvr: (a) => a,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  neg: (a) => -a,
  round: (a) => Math.floor(a + 0.5),
  sin: (a) => Math.sin(a * RADIANS),
  sqrt: Math.sqrt,
  truncate: Math.trunc,
};

/** @type {Record<string, (a: number, b: number) => Value>} */
const BINARY = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  idiv: (a, b) => Math.trunc(a / b),
  mod: (a, b) => a % b,
  exp: (a, b) => a ** b,
  atan: (a, b) => ((Math.atan2(a, b) / RADIANS) + 360) % 360,
  bitshift: (a, b) => (b >= 0 ? a << b : a >> -b),
  gt: (a, b) => a > b,
  ge: (a, b) => a >= b,
  lt: (a, b) => a < b,
  le: (a, b) => a <= b,
};

/**
 * Runs one procedure on the stack, in place.
 * @param {Procedure} procedure
 * @param {Value[]} stack
 * @returns {void}
 */
function execute(procedure, stack) {
  const pop = () => {
    if (stack.length === 0) throw new Error('The program takes more than it is given.');
    return stack.pop();
  };
  const push = (value) => {
    if (stack.length >= STACK_LIMIT) throw new Error('The program holds too many operands.');
    stack.push(value);
  };
  for (let at = 0; at < procedure.length; at += 1) {
    const item = procedure[at];
    if (Array.isArray(item)) {
      // A procedure is only ever the branch of an if or of an ifelse, written just before it.
      const next = procedure[at + 1];
      if (next === 'if') {
        if (typeof stack.at(-1) !== 'boolean') throw new Error('if needs a boolean.');
        if (pop()) execute(item, stack);
        at += 1;
      } else if (Array.isArray(next) && procedure[at + 2] === 'ifelse') {
        if (typeof stack.at(-1) !== 'boolean') throw new Error('ifelse needs a boolean.');
        execute(pop() ? item : next, stack);
        at += 2;
      } else {
        throw new Error('A procedure stands outside an if or an ifelse.');
      }
    } else if (typeof item !== 'string') {
      push(item);
    } else if (item in UNARY) {
      push(UNARY[item](num(pop())));
    } else if (item in BINARY) {
      const b = num(pop());
      push(BINARY[item](num(pop()), b));
    } else if (item === 'eq' || item === 'ne') {
      const b = pop();
      const a = pop();
      push((a === b) === (item === 'eq'));
    } else if (item === 'and' || item === 'or' || item === 'xor') {
      const b = pop();
      const a = pop();
      if (typeof a !== typeof b) throw new Error(`${item} needs two of a kind.`);
      if (typeof a === 'boolean') {
        push(item === 'and' ? a && b : item === 'or' ? a || b : a !== b);
      } else {
        push(item === 'and' ? num(a) & num(b) : item === 'or' ? num(a) | num(b) : num(a) ^ num(b));
      }
    } else if (item === 'not') {
      const a = pop();
      push(typeof a === 'boolean' ? !a : ~num(a));
    } else if (item === 'dup') {
      const a = pop();
      push(a);
      push(a);
    } else if (item === 'exch') {
      const b = pop();
      const a = pop();
      push(b);
      push(a);
    } else if (item === 'pop') {
      pop();
    } else if (item === 'copy') {
      const count = num(pop());
      if (!Number.isInteger(count) || count < 0 || count > stack.length) throw new Error('copy goes past the stack.');
      for (const value of stack.slice(stack.length - count)) push(value);
    } else if (item === 'index') {
      const depth = num(pop());
      if (!Number.isInteger(depth) || depth < 0 || depth >= stack.length) throw new Error('index goes past the stack.');
      push(stack[stack.length - 1 - depth]);
    } else if (item === 'roll') {
      const shift = num(pop());
      const count = num(pop());
      if (!Number.isInteger(count) || !Number.isInteger(shift) || count < 0 || count > stack.length) {
        throw new Error('roll goes past the stack.');
      }
      if (count > 0) {
        const rolled = stack.splice(stack.length - count, count);
        const by = ((shift % count) + count) % count;
        stack.push(...rolled.slice(count - by), ...rolled.slice(0, count - by));
      }
    } else {
      throw new Error(`${item} is not an operator of a calculator function.`);
    }
  }
}

/**
 * Runs a program on its inputs.
 * @param {Procedure} program
 * @param {number[]} inputs
 * @returns {number[]} What the program leaves, bottom first.
 */
export function run(program, inputs) {
  const stack = [...inputs];
  execute(program, stack);
  if (!stack.every((value) => typeof value === 'number')) throw new Error('The program leaves a boolean.');
  return /** @type {number[]} */ (stack);
}
