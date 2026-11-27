// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recolour, tokenize } from '../src/content.js';

/** Each token as "type:text", which reads well in an assertion. */
const tokens = (source) => tokenize(source).map(({ type, start, end }) => `${type}:${source.slice(start, end)}`);

/** Stands in for the colour rules: every colour becomes 10 20 30 40, and the colours asked for are kept. */
function fakeRules() {
  const asked = [];
  const mapColours = async (rgbs) => {
    asked.push(...rgbs);
    return rgbs.map(() => ({ cmyk: [10, 20, 30, 40], rule: 'profile' }));
  };
  return { asked, mapColours };
}

const NO_SPACES = new Set();
const INK = '0.1 0.2 0.3 0.4';

/** Recolours with the fake rules and returns the new source only. */
async function recoloured(source, rgbSpaces = NO_SPACES) {
  return (await recolour(source, rgbSpaces, fakeRules().mapColours)).source;
}

test('tokenize tells numbers, names and operators apart', () => {
  assert.deepEqual(tokens('.5 -1.25 +3 4. 0 rg'), ['number:.5', 'number:-1.25', 'number:+3', 'number:4.', 'number:0', 'operator:rg']);
  assert.deepEqual(tokens("(x) ' T* f* b*"), ['string:(x)', "operator:'", 'operator:T*', 'operator:f*', 'operator:b*']);
});

test('tokenize splits tokens that touch, as Chromium writes them', () => {
  assert.deepEqual(tokens('/Pattern CS/Pattern cs/P14 SCN/P14 scn'), [
    'name:/Pattern', 'operator:CS', 'name:/Pattern', 'operator:cs', 'name:/P14', 'operator:SCN', 'name:/P14', 'operator:scn',
  ]);
});

test('tokenize keeps strings whole: nested and escaped parentheses, hex strings, arrays', () => {
  assert.deepEqual(tokens('(a \\) b (nested) rg) Tj <0029> Tj [(A) -120 (B)] TJ'), [
    'string:(a \\) b (nested) rg)', 'operator:Tj', 'string:<0029>', 'operator:Tj',
    'punctuation:[', 'string:(A)', 'number:-120', 'string:(B)', 'punctuation:]', 'operator:TJ',
  ]);
});

test('tokenize reads dictionaries and skips comments', () => {
  assert.deepEqual(tokens('/Span <</ActualText (1 0 0 rg)>> BDC % 1 0 0 rg\nEMC'), [
    'name:/Span', 'punctuation:<<', 'name:/ActualText', 'string:(1 0 0 rg)', 'punctuation:>>', 'operator:BDC', 'operator:EMC',
  ]);
});

test('tokenize never fails on a string or hex string left open', () => {
  assert.deepEqual(tokens('1 (open'), ['number:1', 'string:(open']);
  assert.deepEqual(tokens('<00'), ['string:<00']);
  assert.deepEqual(tokens(''), []);
});

test('rg and RG become k and K, and the rest of the stream is untouched', async () => {
  const { asked, mapColours } = fakeRules();
  const source = '.9137 .9333 .9451 RG .9137 .9333 .9451 rg\n/G3 gs\n0 0 582 816 re\nf';
  const result = await recolour(source, NO_SPACES, mapColours);
  assert.equal(result.source, `${INK} K ${INK} k\n/G3 gs\n0 0 582 816 re\nf`);
  assert.equal(result.inlineImage, false);
  assert.equal(result.mapped.length, 2);
  assert.deepEqual(result.mapped[0], { cmyk: [10, 20, 30, 40], rule: 'profile' });
  assert.equal(asked.length, 2);
  [232.99, 237.99, 241].forEach((level, channel) => assert.ok(Math.abs(asked[0][channel] - level) < 0.01));
});

test('g and G are read as greys', async () => {
  const { asked, mapColours } = fakeRules();
  const result = await recolour('0.5 g 1 G', NO_SPACES, mapColours);
  assert.equal(result.source, `${INK} k ${INK} K`);
  assert.deepEqual(asked, [[127.5, 127.5, 127.5], [255, 255, 255]]);
});

test('inks are written as fractions with at most four decimals', async () => {
  const mapColours = async (rgbs) => rgbs.map(() => ({ cmyk: [0, 100, 33.3333, 0.004], rule: 'profile' }));
  assert.equal((await recolour('1 0 0 rg', NO_SPACES, mapColours)).source, '0 1 0.3333 0 k');
});

test('cs /DeviceRGB becomes /DeviceCMYK and the colours set after it get four inks', async () => {
  assert.equal(
    await recoloured('/DeviceRGB cs 1 0 0 sc /DeviceRGB CS 0 1 0 SCN'),
    `/DeviceCMYK cs ${INK} sc /DeviceCMYK CS ${INK} SCN`,
  );
});

test('a named colour space is followed only when the resources say it is RGB', async () => {
  const rgbSpaces = new Set(['/CS0']);
  assert.equal(await recoloured('/CS0 cs 1 0 0 scn', rgbSpaces), `/CS0 cs ${INK} scn`);
  assert.equal(await recoloured('/CS1 cs 1 0 0 scn', rgbSpaces), '/CS1 cs 1 0 0 scn');
});

test('patterns and CMYK are left alone', async () => {
  const source = '/Pattern cs /P14 scn 0 0 0 1 k 1 0 0 sc 0.2 0.4 0.6 0.8 K';
  assert.equal(await recoloured(source), source);
});

test('q and Q save and restore the colour space', async () => {
  assert.equal(
    await recoloured('/DeviceRGB cs q /Pattern cs /P1 scn Q 1 0 0 sc'),
    `/DeviceCMYK cs q /Pattern cs /P1 scn Q ${INK} sc`,
  );
  assert.equal(await recoloured('q /DeviceRGB cs Q 1 0 0 sc'), 'q /DeviceCMYK cs Q 1 0 0 sc');
});

test('sc after rg or g follows the space that operator set', async () => {
  assert.equal(await recoloured('1 0 0 rg 0 1 0 sc'), `${INK} k ${INK} sc`);
  assert.equal(await recoloured('.5 g .25 sc'), `${INK} k ${INK} sc`);
  assert.equal(await recoloured('.5 G .25 SC 1 0 0 sc'), `${INK} K ${INK} SC 1 0 0 sc`);
});

test('colour operators with the wrong operands are left as they are', async () => {
  const source = '1 0 rg /Name g 1 0 0 0 RG';
  const result = await recolour(source, NO_SPACES, fakeRules().mapColours);
  assert.equal(result.source, source);
  assert.deepEqual(result.mapped, []);
});

test('what looks like a colour inside a string, a dictionary or a comment is not one', async () => {
  const source = '(1 0 0 rg) Tj /Span <</ActualText (0 g)>> BDC % 0 0 1 rg\n<3120302030207267> Tj EMC';
  assert.equal(await recoloured(source), source);
});

test('bytes above ASCII in strings survive', async () => {
  const source = '1 0 0 rg (\xe9\xff\x00\x80) Tj';
  assert.equal(await recoloured(source), `${INK} k (\xe9\xff\x00\x80) Tj`);
});

test('a stream with an inline image is left whole and flagged', async () => {
  const { asked, mapColours } = fakeRules();
  const source = '1 0 0 rg BI /W 1 /H 1 /CS /RGB /BPC 8 ID \x00\xff( EI 0 1 0 rg';
  const result = await recolour(source, NO_SPACES, mapColours);
  assert.deepEqual(result, { source, mapped: [], inlineImage: true, leftRgb: 0 });
  assert.deepEqual(asked, []);
});

test('a stream with no colour comes back unchanged', async () => {
  const result = await recolour('q 1 0 0 1 0 0 cm /X8 Do Q', NO_SPACES, fakeRules().mapColours);
  assert.deepEqual(result, { source: 'q 1 0 0 1 0 0 cm /X8 Do Q', mapped: [], inlineImage: false, leftRgb: 0 });
});
