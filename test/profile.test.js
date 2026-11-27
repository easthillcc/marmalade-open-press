// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { cmykTiff, imageToCmyk, measureBlackRamp, openProfile, profileDescription, rgbToCmyk } from '../src/profile.js';

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'profile.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('without a path, openProfile gives the built-in stand-in', async () => {
  const profile = await openProfile();
  assert.equal(profile.source, 'cmyk');
  assert.equal(profile.standIn, true);
  assert.equal(profile.bytes.toString('latin1', 16, 20), 'CMYK');
  assert.equal(profile.description, profileDescription(profile.bytes));
  assert.ok(profile.description.length > 0);
});

test('openProfile reads a CMYK profile from a file', async (t) => {
  const { bytes, description } = await openProfile();
  const file = join(await scratchFolder(t), 'press.icc');
  await writeFile(file, bytes);
  const profile = await openProfile(file);
  assert.equal(profile.source, file);
  assert.equal(profile.standIn, false);
  assert.equal(profile.description, description);
  assert.ok(profile.bytes.equals(bytes));
});

test('openProfile refuses a missing file and a file that is not a CMYK profile', async (t) => {
  const folder = await scratchFolder(t);
  const notAProfile = join(folder, 'notes.icc');
  const rgbProfile = join(folder, 'screen.icc');
  const { bytes } = await openProfile();
  const asRgb = Buffer.from(bytes);
  asRgb.write('RGB ', 16, 'latin1');
  await writeFile(notAProfile, 'not a profile');
  await writeFile(rgbProfile, asRgb);
  await assert.rejects(openProfile(join(folder, 'absent.icc')), /Cannot read the profile/);
  await assert.rejects(openProfile(notAProfile), /not a CMYK ICC profile/);
  await assert.rejects(openProfile(rgbProfile), /not a CMYK ICC profile/);
});

test('profileDescription reads both kinds of description tag, or gives null', () => {
  const header = Buffer.alloc(132);
  header.writeUInt32BE(1, 128);
  const entry = Buffer.alloc(12);
  entry.write('desc', 0, 'latin1');
  entry.writeUInt32BE(144, 4);

  const old = Buffer.alloc(12 + 9);
  old.write('desc', 0, 'latin1');
  old.writeUInt32BE(9, 8);
  old.write('Old name\0', 12, 'latin1');
  entry.writeUInt32BE(old.length, 8);
  assert.equal(profileDescription(Buffer.concat([header, entry, old])), 'Old name');

  const text = Buffer.from('New name', 'utf16le').swap16();
  const modern = Buffer.alloc(28);
  modern.write('mluc', 0, 'latin1');
  modern.writeUInt32BE(1, 8);
  modern.writeUInt32BE(12, 12);
  modern.write('enUS', 16, 'latin1');
  modern.writeUInt32BE(text.length, 20);
  modern.writeUInt32BE(28, 24);
  assert.equal(profileDescription(Buffer.concat([header, entry, modern, text])), 'New name');

  const none = Buffer.alloc(132);
  assert.equal(profileDescription(none), null);
});

test('cmykTiff writes a file sharp reads back as the same CMYK pixels', async () => {
  const { bytes } = await openProfile();
  const pixels = Buffer.from([0, 0, 0, 0, 255, 0, 0, 0, 0, 128, 0, 64, 10, 20, 30, 40, 0, 0, 0, 255, 1, 2, 3, 4]);
  const tiff = cmykTiff(pixels, 3, 2, bytes);
  assert.equal(tiff.toString('latin1', 0, 2), 'II');
  assert.equal(tiff.readUInt16LE(2), 42);
  const meta = await sharp(tiff).metadata();
  assert.equal(meta.width, 3);
  assert.equal(meta.height, 2);
  assert.equal(meta.channels, 4);
  assert.equal(meta.space, 'cmyk');
  assert.ok(meta.icc.equals(bytes));
  assert.ok((await sharp(tiff).pipelineColourspace('cmyk').toColourspace('cmyk').raw().toBuffer()).equals(pixels));
});

test('rgbToCmyk converts colours through the profile, as percentages', async () => {
  const profile = await openProfile();
  assert.deepEqual(await rgbToCmyk(profile, []), []);
  const [white, orange, lessOrange] = await rgbToCmyk(profile, [[255, 255, 255], [194, 83, 45], [193.6, 83.4, 45.2]]);
  assert.deepEqual(white, [0, 0, 0, 0]);
  assert.equal(orange.length, 4);
  near(orange[0], 0, 1);
  near(orange[1], 70.2, 1);
  near(orange[2], 90.6, 1);
  near(orange[3], 23.1, 1);
  assert.deepEqual(lessOrange, orange);
});

test('imageToCmyk converts raw RGB pixels and encoded images alike', async () => {
  const profile = await openProfile();
  const rgb = Buffer.from([255, 255, 255, 194, 83, 45, 0, 0, 0, 255, 255, 255, 194, 83, 45, 0, 0, 0]);
  const raw = await imageToCmyk(profile, rgb, { width: 3, height: 2 });
  assert.equal(raw.width, 3);
  assert.equal(raw.height, 2);
  assert.equal(raw.data.length, 3 * 2 * 4);
  assert.deepEqual([...raw.data.subarray(0, 4)], [0, 0, 0, 0]);

  const png = await sharp(rgb, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
  const encoded = await imageToCmyk(profile, png);
  assert.equal(encoded.width, 3);
  assert.equal(encoded.height, 2);
  assert.ok(encoded.data.equals(raw.data));
});

test('measureBlackRamp measures what each step of black prints, lightest first', async () => {
  const profile = await openProfile();
  const ramp = await measureBlackRamp(profile, [0, 0, 0]);
  assert.equal(ramp.length, 256);
  near(ramp[0], 100, 0.5);
  near(ramp[64], 75.2, 0.5);
  near(ramp[128], 55.6, 0.5);
  near(ramp[192], 33.4, 0.5);
  near(ramp[255], 2.3, 0.5);
  for (let k = 1; k < 256; k++) assert.ok(ramp[k] <= ramp[k - 1], `black ${k} prints lighter than black ${k - 1}`);
});

test('an underlay darkens the light end of the ramp', async () => {
  const profile = await openProfile();
  const plain = await measureBlackRamp(profile, [0, 0, 0]);
  const under = await measureBlackRamp(profile, [8, 0, 2]);
  assert.ok(under[0] < plain[0] - 1);
  near(under[255], plain[255], 2);
});
