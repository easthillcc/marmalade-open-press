// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * @typedef {object} Profile
 * @property {string} source       What sharp is given: the file's path, or 'cmyk' for the built-in profile.
 * @property {Buffer} bytes        The ICC profile itself, embedded in the PDF's output intent.
 * @property {string} description  The profile's own name, or 'Custom'.
 * @property {boolean} standIn     True when no profile was given.
 */

const HEADER_SIZE = 132;
const TAG_TABLE_COUNT_AT = 128;
const TAG_ENTRY_SIZE = 12;
const BUILT_IN_CMYK = 'cmyk';

/**
 * Open an ICC profile for CMYK work. Without a path, libvips' built-in CMYK profile stands in.
 * @param {string} [path]
 * @returns {Promise<Profile>}
 */
export async function openProfile(path) {
  if (path === undefined) {
    const bytes = await builtInProfileBytes();
    return { source: BUILT_IN_CMYK, bytes, description: describe(bytes), standIn: true };
  }
  const bytes = await readProfileFile(path);
  if (bytes.length < HEADER_SIZE || bytes.toString('latin1', 36, 40) !== 'acsp'
    || bytes.toString('latin1', 16, 20) !== 'CMYK') {
    throw new Error(`${path} is not a CMYK ICC profile.`);
  }
  return { source: path, bytes, description: describe(bytes), standIn: false };
}

/**
 * The name a profile gives itself, from its 'desc' tag (version 2) or 'mluc' tag (version 4).
 * @param {Uint8Array} bytes  An ICC profile.
 * @returns {string | null}  The text of its 'desc' tag.
 */
export function profileDescription(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < HEADER_SIZE) return null;
  const at = findTagOffset(data, 'desc');
  if (at === null) return null;
  const text = readTagText(data, at);
  return text === null ? null : text.replace(/\0+$/, '') || null;
}

/**
 * Convert encoded pixels, or raw RGB pixels, to four inks each through the profile.
 * @param {Profile} profile
 * @param {Buffer} bytes  An encoded image (JPEG, PNG), or raw RGB pixels when `raw` is given.
 * @param {{width: number, height: number}} [raw]
 * @returns {Promise<{data: Buffer, width: number, height: number}>}  Four inks per pixel, 255 is full ink.
 */
export async function imageToCmyk(profile, bytes, raw) {
  const input = raw ? sharp(bytes, { raw: { ...raw, channels: 3 } }) : sharp(bytes);
  const { data, info } = await input
    .withIccProfile(profile.source)
    .toColourspace('cmyk')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('The image did not convert to four inks.');
  return { data, width: info.width, height: info.height };
}

/**
 * Convert RGB colours to CMYK percentages through the profile.
 * @param {Profile} profile
 * @param {import('./colour.js').Rgb[]} rgbs
 * @returns {Promise<import('./colour.js').Cmyk[]>}
 */
export async function rgbToCmyk(profile, rgbs) {
  if (rgbs.length === 0) return [];
  // One strip of pixels lets a single sharp call convert every colour.
  // Buffer wraps out-of-range values (256 becomes 0), so every level is clamped to 0..255 first.
  const levels = rgbs.flat().map((level) => Math.min(255, Math.max(0, Math.round(level))));
  const { data } = await imageToCmyk(profile, Buffer.from(levels), {
    width: rgbs.length,
    height: 1,
  });
  return rgbs.map((_, i) => [...data.subarray(i * 4, i * 4 + 4)].map((ink) => (ink / 255) * 100));
}

/**
 * What each step of black prints over an underlay, from no ink (index 0) to full black (index 255).
 * @param {Profile} profile
 * @param {[number, number, number]} underlay
 * @returns {Promise<number[]>}  256 L* values.
 */
export async function measureBlackRamp(profile, underlay) {
  const [c, m, y] = underlay.map((percent) => Math.round(percent * 2.55));
  const patches = Buffer.alloc(256 * 4);
  for (let k = 0; k < 256; k++) {
    patches.set([c, m, y, k], k * 4);
  }
  const lab = await sharp(cmykTiff(patches, 256, 1, profile.bytes))
    .toColourspace('lab')
    .raw({ depth: 'float' })
    .toBuffer();
  return Array.from({ length: 256 }, (_, k) => lab.readFloatLE(k * 12));
}

/**
 * A minimal little-endian TIFF holding CMYK pixels and an ICC profile, in one uncompressed strip.
 * It exists because sharp measures CMYK patches only from a file, and this is the smallest file it accepts.
 * @param {Uint8Array} pixels  Chunky CMYK pixels, four bytes each.
 * @param {number} width  Width in pixels.
 * @param {number} height  Height in pixels.
 * @param {Uint8Array} icc  The ICC profile to embed.
 * @returns {Buffer}
 */
export function cmykTiff(pixels, width, height, icc) {
  const ENTRY_COUNT = 11;
  const IFD_AT = 8;
  const BITS_AT = IFD_AT + 2 + ENTRY_COUNT * 12 + 4;
  const PIXELS_AT = BITS_AT + 8;
  const ICC_AT = PIXELS_AT + pixels.length;
  const SHORT = 3;
  const LONG = 4;
  const UNDEFINED = 7;

  const out = Buffer.alloc(PIXELS_AT + pixels.length + icc.length);
  out.write('II', 0, 'latin1');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(IFD_AT, 4);
  out.writeUInt16LE(ENTRY_COUNT, IFD_AT);

  // Tags in ascending order, as TIFF requires: ImageWidth, ImageLength, BitsPerSample, Compression (none),
  // Photometric (separated), StripOffsets, SamplesPerPixel, RowsPerStrip, StripByteCounts,
  // PlanarConfiguration (chunky), InterColorProfile.
  const entries = [
    [256, LONG, 1, width],
    [257, LONG, 1, height],
    [258, SHORT, 4, BITS_AT],
    [259, SHORT, 1, 1],
    [262, SHORT, 1, 5],
    [273, LONG, 1, PIXELS_AT],
    [277, SHORT, 1, 4],
    [278, LONG, 1, height],
    [279, LONG, 1, pixels.length],
    [284, SHORT, 1, 1],
    [34675, UNDEFINED, icc.length, ICC_AT],
  ];
  entries.forEach(([tag, type, count, value], i) => {
    const at = IFD_AT + 2 + i * 12;
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(type, at + 2);
    out.writeUInt32LE(count, at + 4);
    out.writeUInt32LE(value, at + 8);
  });
  // The next-directory offset after the entries stays 0: this is the only directory.

  for (let i = 0; i < 4; i++) out.writeUInt16LE(8, BITS_AT + i * 2);
  Buffer.from(pixels).copy(out, PIXELS_AT);
  Buffer.from(icc).copy(out, ICC_AT);
  return out;
}

/**
 * @param {Buffer} data
 * @param {string} signature  A four-character tag signature from the tag table.
 * @returns {number | null}  Where that tag's data starts in the file.
 */
function findTagOffset(data, signature) {
  const count = data.readUInt32BE(TAG_TABLE_COUNT_AT);
  for (let i = 0; i < count; i++) {
    const entry = HEADER_SIZE + i * TAG_ENTRY_SIZE;
    if (entry + TAG_ENTRY_SIZE > data.length) break;
    if (data.toString('latin1', entry, entry + 4) === signature) return data.readUInt32BE(entry + 4);
  }
  return null;
}

/**
 * @param {Buffer} data
 * @param {number} at  Where the tag's data starts.
 * @returns {string | null}
 */
function readTagText(data, at) {
  const kind = data.toString('latin1', at, at + 4);
  if (kind === 'desc') {
    const length = data.readUInt32BE(at + 8);
    return data.toString('latin1', at + 12, at + 12 + length);
  }
  if (kind === 'mluc') {
    // Only the first record is read: profiles name themselves in one language.
    const length = data.readUInt32BE(at + 20);
    const start = at + data.readUInt32BE(at + 24);
    // The text is UTF-16 big-endian; swapping its bytes lets Node decode it as little-endian.
    const text = Buffer.from(data.subarray(start, start + length));
    return text.swap16().toString('utf16le');
  }
  return null;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function describe(bytes) {
  return profileDescription(bytes) ?? 'Custom';
}

/**
 * The CMYK profile libvips ships with, read back from a one-pixel JPEG that carries it.
 * @returns {Promise<Buffer>}
 */
async function builtInProfileBytes() {
  const white = Buffer.from([255, 255, 255]);
  const jpeg = await sharp(white, { raw: { width: 1, height: 1, channels: 3 } })
    .withIccProfile(BUILT_IN_CMYK)
    .toColourspace('cmyk')
    .jpeg()
    .toBuffer();
  return (await sharp(jpeg).metadata()).icc;
}

/**
 * @param {string} path
 * @returns {Promise<Buffer>}
 */
async function readProfileFile(path) {
  try {
    return await readFile(path);
  } catch {
    throw new Error(`Cannot read the profile ${path}.`);
  }
}
