// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blackFor, colourRules, isNeutral, lightness, parseHex, sameColour } from '../src/colour.js';

/** A made-up ramp where black ink darkens the paper in a straight line. */
const straightRamp = Array.from({ length: 256 }, (_, k) => 100 - (k / 255) * 100);

/** Stands in for the ICC profile: every colour it is asked for comes back as the same ink. */
const fakeProfile = async (rgbs) => rgbs.map(() => [10, 20, 30, 40]);

const rules = (overrides = {}) =>
  colourRules({ table: [], underlay: [0, 0, 0], ramp: straightRamp, toProfile: fakeProfile, ...overrides });

test('parseHex reads a six-digit hex colour, in either case', () => {
  assert.deepEqual(parseHex('#00AEEF'), [0, 174, 239]);
  assert.deepEqual(parseHex('#00aeef'), [0, 174, 239]);
});

test('parseHex returns null for anything else', () => {
  for (const text of ['00AEEF', '#0AE', '#00AEEG', '', 'cyan']) assert.equal(parseHex(text), null);
});

test('sameColour allows 1.5 levels per channel and no more', () => {
  assert.equal(sameColour([10, 10, 10], [11.5, 8.5, 10]), true);
  assert.equal(sameColour([10, 10, 10], [12, 10, 10]), false);
});

test('isNeutral accepts a grey whose channels sit within 1.5 levels', () => {
  assert.equal(isNeutral([128, 128, 128]), true);
  assert.equal(isNeutral([128, 129, 129.5]), true);
  assert.equal(isNeutral([128, 130, 128]), false);
  assert.equal(isNeutral([233, 238, 241]), false);
});

test('lightness gives the L* of an sRGB grey', () => {
  assert.equal(lightness(0), 0);
  assert.ok(Math.abs(lightness(255) - 100) < 1e-9);
  assert.ok(Math.abs(lightness(128) - 53.585) < 0.001);
  assert.ok(Math.abs(lightness(26) - 9.263) < 0.001);
  assert.ok(Math.abs(lightness(1) - 0.274) < 0.001);
});

test('blackFor finds the black that prints a wanted lightness', () => {
  assert.ok(Math.abs(blackFor(straightRamp, 50) - 50) < 1e-9);
  assert.ok(Math.abs(blackFor(straightRamp, 25) - 75) < 1e-9);
  assert.equal(blackFor(straightRamp, 100), 0);
});

test('blackFor stays within the ramp', () => {
  assert.equal(blackFor(straightRamp, 120), 0);
  assert.equal(blackFor(straightRamp, -5), 100);
  assert.equal(blackFor([96, 60, 20], 99), 0);
  assert.equal(blackFor([96, 60, 20], 5), 100);
});

test('a grey becomes black ink only, at the black that matches its lightness', async () => {
  const [mapped] = await rules()([[128, 128, 128]]);
  assert.equal(mapped.rule, 'neutral');
  assert.deepEqual(mapped.cmyk.slice(0, 3), [0, 0, 0]);
  assert.ok(Math.abs(mapped.cmyk[3] - (100 - lightness(128))) < 1e-9);
});

test('a grey carries the underlay beneath its black', async () => {
  const [mapped] = await rules({ underlay: [3, 2, 2] })([[0, 0, 0]]);
  assert.deepEqual(mapped, { cmyk: [3, 2, 2, 100], rule: 'neutral' });
});

test('white stays free of ink, underlay or not', async () => {
  const [white, nearly] = await rules({ underlay: [3, 2, 2] })([[255, 255, 255], [254, 254, 254]]);
  assert.deepEqual(white, { cmyk: [0, 0, 0, 0], rule: 'neutral' });
  assert.deepEqual(nearly, { cmyk: [0, 0, 0, 0], rule: 'neutral' });
});

test('a colour goes through the profile', async () => {
  const [mapped] = await rules()([[194, 83, 45]]);
  assert.deepEqual(mapped, { cmyk: [10, 20, 30, 40], rule: 'profile' });
});

test('a colour table entry wins over every other rule', async () => {
  const table = [
    { name: 'Text black', hex: '#000000', cmyk: [0, 0, 0, 100] },
    { name: 'Process cyan', hex: '#00AEEF', cmyk: [100, 0, 0, 0] },
  ];
  const [black, cyan, almostCyan, grey] = await rules({ table, underlay: [3, 2, 2] })([
    [0, 0, 0],
    [0, 174, 239],
    [1, 175.4, 238],
    [3, 3, 3],
  ]);
  assert.deepEqual(black, { cmyk: [0, 0, 0, 100], rule: 'table' });
  assert.deepEqual(cyan, { cmyk: [100, 0, 0, 0], rule: 'table' });
  assert.equal(almostCyan.rule, 'table');
  assert.equal(grey.rule, 'neutral');
});

test('colours come back in the order they were asked, and only colours reach the profile', async () => {
  const asked = [];
  const toProfile = async (rgbs) => {
    asked.push(...rgbs);
    return rgbs.map(([r]) => [r, 0, 0, 0]);
  };
  const mapped = await rules({ toProfile })([[200, 0, 0], [50, 50, 50], [100, 0, 0], [255, 255, 255]]);
  assert.deepEqual(mapped.map((one) => one.rule), ['profile', 'neutral', 'profile', 'neutral']);
  assert.deepEqual(mapped[0].cmyk, [200, 0, 0, 0]);
  assert.deepEqual(mapped[2].cmyk, [100, 0, 0, 0]);
  assert.deepEqual(asked, [[200, 0, 0], [100, 0, 0]]);
});

test('an empty list asks nothing of the profile', async () => {
  assert.deepEqual(await rules()([]), []);
});
