// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { formatReport, run } from '../src/cli.js';
import { GHOSTSCRIPT_MISSING } from '../src/ghostscript.js';
import { hasGhostscript, withoutGhostscript } from './helpers/ghostscript.js';
import { LEAVING_RGB } from './helpers/rgbleft.js';

const poster = fileURLToPath(new URL('../examples/poster.html', import.meta.url));

/** Two pages of 50 mm. Only the second uses transparency: a half-opaque box with a word in it. */
const TWO_PAGES = [
  '<style>@page { size: 50mm 50mm; margin: 0 } html, body { margin: 0 }',
  'section { width: 50mm; height: 50mm; padding: 4mm; box-sizing: border-box; background: #e9eef1 }',
  'section + section { break-before: page }',
  '.veil { opacity: .5; background: #c2532d; width: 30mm; height: 10mm }</style>',
  '<section><p>Opaque</p></section>',
  '<section><p>Veiled</p><div class="veil">Half</div></section>',
].join('\n');

/** Runs the command line with its messages collected instead of printed. `steps` may replace render. */
async function runCollected(argv, steps) {
  const out = [];
  const err = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) }, steps);
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const open = (...argv) => runCollected(argv);
/** As open, with a PDF that leaves one shading in RGB in place of the page. */
const openLeavingRgb = (...argv) => runCollected(argv, LEAVING_RGB);

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'cli.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

const report = {
  profile: 'Example Coated',
  standIn: false,
  vectors: 24,
  neutrals: 20,
  tableHits: 2,
  images: 3,
  maxInk: 223.53,
  left: [],
  trim: { width: 148, height: 210 },
  bleed: 3,
  lowestPpi: { ppi: 312.4, image: 12, page: 1 },
  type3Fonts: [],
};

test('--version says who made it', async () => {
  const { code, out, err } = await open('--version');
  assert.equal(code, 0);
  assert.match(out, /^Marmalade Open Press \d+\.\d+\.\d+, made by Marmalade\. https:\/\/marmalade\.family$/);
  assert.equal(err, '');
});

test('--help explains every option', async () => {
  const { code, out } = await open('--help');
  assert.equal(code, 0);
  assert.match(out, /^Marmalade Open Press \d+\.\d+\.\d+, made by Marmalade\. https:\/\/marmalade\.family\n\nUsage: open-press <input\.html\|url> <output\.pdf>/);
  for (const option of ['--profile', '--underlay', '--colours', '--bleed', '--format', '--dpi', '--check', '--version', '--help']) {
    assert.ok(out.includes(option), option);
  }
  assert.match(out, /A5 plus the bleed/);
  assert.ok(out.endsWith('Made by Marmalade, which turns a family\'s week into a printed magazine: https://marmalade.family\nSource and issues: https://github.com/easthillcc/marmalade-open-press'));
});

test('too few or too many arguments show the usage and exit with 2', async () => {
  for (const argv of [[], ['only-one.html'], ['a.html', 'b.pdf', 'c.pdf']]) {
    const { code, out, err } = await open(...argv);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /Usage: open-press/);
    assert.match(err, /^Marmalade Open Press /m);
  }
});

test('an option that is not understood gets one plain line, and exits with 2', async () => {
  const cases = [
    [['a.html', 'b.pdf', '--chek'], 'Unknown option --chek. See open-press --help.'],
    [['a.html', 'b.pdf', '-x'], 'Unknown option -x. See open-press --help.'],
    [['a.html', 'b.pdf', '--bleed'], '--bleed needs a value. See open-press --help.'],
    [['a.html', 'b.pdf', '--check=yes'], '--check takes no value. See open-press --help.'],
  ];
  for (const [argv, line] of cases) {
    const { code, out, err } = await open(...argv);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err, line);
  }
});

test('a bad value is explained in one plain line, and nothing is rendered', async () => {
  const cases = [
    [['--underlay', '3,2'], /--underlay takes three percentages/],
    [['--underlay', '3,2,x'], /--underlay takes three percentages/],
    [['--underlay', '3,2,101'], /--underlay takes three percentages/],
    [['--underlay', '3,,2'], /--underlay takes three percentages/],
    [['--underlay', '3,2,'], /--underlay takes three percentages/],
    [['--bleed', 'wide'], /^The bleed is a size in millimetres, 0 or more\.$/],
    [['--bleed=-1'], /^The bleed is a size in millimetres, 0 or more\.$/],
    [['--bleed', '-3'], /^The bleed is a size in millimetres, 0 or more\.$/],
    [['--underlay', '-1,2,2'], /--underlay takes three percentages/],
    [['--colours', 'baroque'], /no colour preset called "baroque"/],
    [['--format', 'x2'], /--format takes one of x4, x1a, x3, tiff/],
    [['--format', 'tiff', '--dpi', 'fine'], /--dpi takes a resolution in dots per inch/],
    [['--format', 'tiff'], /With --format tiff the output is a \.tif name/],
    [['--dpi', '300'], /--dpi goes with --format x1a, x3 or tiff/],
  ];
  for (const [options, message] of cases) {
    const { code, out, err } = await open('no-such-page.html', 'never-written.local.pdf', ...options);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, message);
    assert.equal(err.includes('\n'), false);
  }
});

test('a page or a profile that is not there is said so', async () => {
  const page = await open('no-such-page.html', 'never-written.local.pdf');
  assert.equal(page.code, 2);
  assert.match(page.err, /^Cannot read no-such-page\.html\.$/);

  const profile = await open('<p>Hello</p>', 'never-written.local.pdf', '--profile', 'no-such.icc');
  assert.equal(profile.code, 2);
  assert.equal(profile.out, '');
  assert.match(profile.err, /^Cannot read the profile no-such\.icc\.$/);
});

test('formatReport lists the size, the counts and the lowest resolution, and says when nothing is left in RGB', () => {
  assert.equal(
    formatReport(report),
    [
      'Profile: Example Coated',
      'Trim: 148 x 210 mm, bleed 3 mm',
      'Vector colours converted: 24 (20 neutral, 2 from the colour table)',
      'Images converted: 3',
      'Lowest image resolution: 312 ppi at placed size (image 12, page 1)',
      'Maximum total ink: 224%',
      'RGB left: none',
    ].join('\n'),
  );
});

test('formatReport warns of a stand-in profile, a soft image and Type 3 fonts, and lists what was left', () => {
  const left = [
    { what: 'image 12: not 8 bits per component', rgb: true },
    { what: 'image 14: not an RGB image', rgb: false },
  ];
  const standIn = {
    ...report,
    profile: 'Stand-in CMYK profile, not for press (Marmalade Open Press)',
    standIn: true,
    trim: { width: 148.04, height: 99.96 },
    bleed: 0,
    lowestPpi: { ppi: 245.8, image: 8, page: 2 },
    type3Fonts: ['Emoji', 'font 31'],
    left,
  };
  assert.equal(
    formatReport(standIn),
    [
      'Profile: Stand-in CMYK profile, not for press (Marmalade Open Press)',
      'Trim: 148 x 100 mm, bleed 0 mm',
      'Vector colours converted: 24 (20 neutral, 2 from the colour table)',
      'Images converted: 3',
      'Lowest image resolution: 246 ppi at placed size (image 8, page 2)',
      'Maximum total ink: 224%',
      'Warning: the profile is a stand-in, not for press. Ask your printer for theirs and give it as the profile.',
      'Warning: image 8 prints at 246 ppi, below 300.',
      'Warning: Type 3 fonts, which some printers refuse: Emoji, font 31.',
      'Left as it was:',
      '  image 12: not 8 bits per component (RGB)',
      '  image 14: not an RGB image',
      'RGB left: 1',
    ].join('\n'),
  );
});

test('formatReport leaves out the resolution when no image is drawn', () => {
  assert.equal(formatReport({ ...report, images: 0, lowestPpi: null }).includes('resolution'), false);
});

test('the poster becomes a PDF/X-4, with a warning about the stand-in profile', async (t) => {
  const output = join(await scratchFolder(t), 'poster.pdf');
  const { code, out, err } = await open(poster, output, '--check', '--underlay', '3,2,2', '--colours', 'classic', '--bleed', '3');
  assert.equal(code, 0);
  assert.match(err, /^No profile given/);
  assert.match(err, /--profile/);
  const lines = out.split('\n');
  assert.equal(lines[0], `Wrote ${output}.`);
  assert.equal(lines[1], 'Profile: Stand-in CMYK profile, not for press (Marmalade Open Press)');
  assert.equal(lines[2], 'Trim: 148 x 210 mm, bleed 3 mm');
  assert.match(out, /^Lowest image resolution: 246 ppi at placed size \(image \d+, page 1\)$/m);
  assert.match(out, /^Warning: the profile is a stand-in, not for press\. Ask your printer for theirs and give it as the profile\.$/m);
  assert.match(out, /^Warning: image \d+ prints at 246 ppi, below 300\.$/m);
  assert.match(out, /Vector colours converted: \d+ \(\d+ neutral, [1-9]\d* from the colour table\)/);
  assert.match(out, /Images converted: 3/);
  assert.match(out, /Maximum total ink: \d+%/);
  assert.equal(lines.at(-1), 'RGB left: none');

  const pdf = await readFile(output);
  assert.equal(pdf.toString('latin1', 0, 8), '%PDF-1.6');
  const [page] = (await PDFDocument.load(pdf)).getPages();
  assert.ok(Math.abs(page.getTrimBox().x - (3 * 72) / 25.4) < 1e-4);
  assert.ok(Math.abs(page.getTrimBox().width - (148 * 72) / 25.4) < 1e-3);
  assert.ok(Math.abs(page.getTrimBox().height - (210 * 72) / 25.4) < 1e-3);
});

test('without --check it only says what it wrote', async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'page.html');
  const output = join(folder, 'page.pdf');
  await writeFile(page, '<style>@page { size: 50mm 50mm; margin: 0 }</style><p style="color: #333">Hello</p>');
  const { code, out } = await open(page, output);
  assert.equal(code, 0);
  assert.equal(out, `Wrote ${output}.`);
  assert.equal((await readFile(output)).toString('latin1', 0, 8), '%PDF-1.6');
});

test('with a bleed, a page that names no size is printed on A5 plus the bleed, and trims to A5', async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'page.html');
  const output = join(folder, 'page.pdf');
  await writeFile(page, '<p style="color: #333">Hello</p>');
  const { code, out } = await open(page, output, '--bleed', '3', '--check');
  assert.equal(code, 0);
  assert.match(out, /^Trim: 148 x 210 mm, bleed 3 mm$/m);
  const [printed] = (await PDFDocument.load(await readFile(output))).getPages();
  assert.ok(Math.abs(printed.getWidth() - (154 * 72) / 25.4) < 1e-3);
  assert.ok(Math.abs(printed.getHeight() - (216 * 72) / 25.4) < 1e-3);
});

test('a box-shadow is a soft mask of greys, and leaves no RGB', async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'card.html');
  const output = join(folder, 'card.pdf');
  const style = '@page { size: 100mm 100mm; margin: 0 } body { margin: 10mm } '
    + 'div { width: 50mm; height: 30mm; background: #fff; border-radius: 3mm; box-shadow: 0 2mm 6mm rgba(0, 0, 0, .35) }';
  await writeFile(page, `<style>${style}</style><div>Card</div>`);
  const { code, out } = await open(page, output, '--check');
  assert.equal(code, 0);
  assert.equal(out.split('\n').at(-1), 'RGB left: none');
  assert.equal(out.includes('soft mask'), false);
});

test('repeating and conic gradients run in ink, and leave no RGB', async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'gradients.html');
  const output = join(folder, 'gradients.pdf');
  const style = [
    '@page { size: 50mm 50mm; margin: 0 } div { width: 40mm; height: 12mm }',
    '.stripes { background: repeating-linear-gradient(45deg, #c2532d 0 2mm, #fff 2mm 4mm) }',
    '.rings { background: repeating-radial-gradient(circle, #e3a33b 0 1mm, #2d5f8a 1mm 2mm) }',
    '.wheel { background: conic-gradient(#c2532d, #e3a33b, #c2532d) }',
  ].join(' ');
  await writeFile(page, `<style>${style}</style><div class="stripes"></div><div class="rings"></div><div class="wheel"></div>`);
  const { code, out } = await open(page, output, '--check');
  assert.equal(code, 0);
  assert.equal(out.split('\n').at(-1), 'RGB left: none');
});

test('RGB left makes --check exit with 1, and is mentioned even without --check', async (t) => {
  const output = join(await scratchFolder(t), 'page.pdf');
  const checked = await openLeavingRgb('page.html', output, '--check');
  assert.equal(checked.code, 1);
  assert.match(checked.out, /Left as it was:\n  shading of type 2, function of type 0: sampled functions are not converted \(RGB\)\nRGB left: 1$/);

  const unchecked = await openLeavingRgb('page.html', output);
  assert.equal(unchecked.code, 0);
  assert.equal(unchecked.out, `Wrote ${output}.`);
  assert.match(unchecked.err, /Some colour was left in RGB\. Run again with --check to see what\.$/);
});

test('another format without Ghostscript exits with 2 and says how to install it, and nothing is rendered', async (t) => {
  withoutGhostscript(t);
  for (const [output, format] of [['never-written.local.pdf', 'x1a'], ['never-written.local.pdf', 'x3'], ['never-written.local.tif', 'tiff']]) {
    const { code, out, err } = await open('no-such-page.html', output, '--format', format);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err, GHOSTSCRIPT_MISSING);
  }
});

test('the poster has no transparency, so its PDF/X-1a keeps every letter as a letter', { skip: !hasGhostscript }, async (t) => {
  const output = join(await scratchFolder(t), 'poster-x1a.pdf');
  const { code, out } = await open(poster, output, '--check', '--bleed', '3', '--format', 'x1a');
  assert.equal(code, 0);
  const lines = out.split('\n');
  assert.equal(lines[0], `Wrote ${output}.`);
  assert.ok(lines.includes('RGB left: none'));
  assert.match(lines.at(-3), /^Format: PDF\/X-1a:2001, written by Ghostscript \d+\.\d+/);
  assert.equal(lines.at(-2), 'Transparency: none');
  assert.equal(lines.at(-1), 'Flattened to pixels: none');

  const pdf = await readFile(output);
  assert.equal(pdf.toString('latin1', 0, 8), '%PDF-1.3');
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const [page] = doc.getPages();
  assert.ok(Math.abs(page.getTrimBox().x - (3 * 72) / 25.4) < 1e-4);
  assert.equal(doc.getTitle(), 'Night Walks: an evening of slow photography');
});

test('a page with transparency is flattened for PDF/X-3, and the report says what became pixels', { skip: !hasGhostscript }, async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'two.html');
  const output = join(folder, 'two.pdf');
  await writeFile(page, TWO_PAGES);

  const checked = await open(page, output, '--check', '--format', 'x3', '--dpi', '150');
  assert.equal(checked.code, 0);
  assert.match(checked.out, /^Format: PDF\/X-3:2002, written by Ghostscript /m);
  assert.match(checked.out, /^Transparency: page 2 \(opacity/m);
  assert.match(checked.out, /^Flattened to pixels at 150 dpi: page 2 \(100% of the page\)$/m);
  assert.match(checked.out, /^Text turned to pixels: page 2$/m);
  assert.equal((await readFile(output)).toString('latin1', 0, 8), '%PDF-1.3');

  const unchecked = await open(page, output, '--format', 'x3');
  assert.equal(unchecked.code, 0);
  assert.equal(unchecked.out, `Wrote ${output}.`);
  assert.match(unchecked.err, /Transparency was flattened, and the text of 1 page became pixels\. Run again with --check to see where\.$/);
});

test('--format tiff writes one numbered TIFF per page', { skip: !hasGhostscript }, async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'two.html');
  await writeFile(page, TWO_PAGES);
  const { code, out, err } = await open(page, join(folder, 'two.tif'), '--check', '--format', 'tiff', '--dpi', '100');
  assert.equal(code, 0);
  const first = join(folder, 'two-1.tif');
  const second = join(folder, 'two-2.tif');
  const lines = out.split('\n');
  assert.equal(lines[0], `Wrote 2 pages, ${first} to ${second}.`);
  assert.match(lines.at(-1), /^Format: CMYK TIFF, 2 pages at 100 dpi, drawn by Ghostscript \d+\.\d+/);
  assert.equal(err.includes('pixels'), false);
  for (const file of [first, second]) {
    assert.match((await readFile(file)).toString('latin1', 0, 4), /^(II\*\0|MM\0\*)$/);
  }
});
