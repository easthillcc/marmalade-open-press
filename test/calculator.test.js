// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, run, words } from '../src/calculator.js';

const calc = (text, inputs = []) => run(parse(words(text)), inputs);

test('words keeps each brace a word of its own', () => {
  assert.deepEqual(words('{dup 0 le{pop .5}if}'), ['{', 'dup', '0', 'le', '{', 'pop', '.5', '}', 'if', '}']);
});

test('the operators work as in PostScript', () => {
  assert.deepEqual(calc('{sub}', [2, 3]), [-1]);
  assert.deepEqual(calc('{dup mul exch dup mul add sqrt}', [3, 4]), [5]);
  assert.deepEqual(calc('{truncate}', [-2.5]), [-2]);
  assert.deepEqual(calc('{abs cvi 2 mod}', [-7.9]), [1]);
  assert.deepEqual(calc('{1 2 3 3 1 roll}'), [3, 1, 2]);
  assert.deepEqual(calc('{1 2 3 3 -1 roll}'), [2, 3, 1]);
  assert.deepEqual(calc('{1 2 2 copy}'), [1, 2, 1, 2]);
  assert.deepEqual(calc('{1 2 3 2 index}'), [1, 2, 3, 1]);
  // atan takes the numerator first and answers in degrees, from 0 to 360.
  assert.deepEqual(calc('{atan}', [1, 0]), [90]);
  assert.deepEqual(calc('{atan}', [-100, 0]), [270]);
  assert.deepEqual(calc('{atan}', [4, 4]), [45]);
});

test('if and ifelse run the branch the boolean picks', () => {
  const program = '{dup 0.5 le {pop 1} {dup dup 0 gt exch 2 le and {pop 2} {pop 3} ifelse} ifelse}';
  assert.deepEqual(calc(program, [0.25]), [1]);
  assert.deepEqual(calc(program, [1.5]), [2]);
  assert.deepEqual(calc(program, [9]), [3]);
  assert.deepEqual(calc('{0 gt {7} if}', [0]), []);
  assert.deepEqual(calc('{true false xor not {5} {6} ifelse}'), [6]);
});

test('a program that is not a calculator function is refused', () => {
  assert.throws(() => parse(words('dup mul')), /one procedure in braces/);
  assert.throws(() => parse(words('{dup {mul}')), /braces/);
  assert.throws(() => calc('{pop pop}', [1]), /more than it is given/);
  assert.throws(() => calc('{exec}', [1]), /not an operator/);
  assert.throws(() => calc('{{1} 2}'), /outside an if/);
  assert.throws(() => calc('{1 {2} if}'), /boolean/);
  assert.throws(() => calc('{1 2 gt}'), /leaves a boolean/);
  assert.throws(() => calc(`{${'1 '.repeat(101)}}`), /too many operands/);
});
