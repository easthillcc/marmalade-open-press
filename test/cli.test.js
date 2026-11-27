// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { formatReport, run } from '../src/cli.js';

const poster = fileURLToPath(new URL('../examples/poster.html', import.meta.url));

/** Runs the command line with its messages collected instead of printed. */
async function open(...argv) {
  const out = [];
  const err = [];
  const code = await run(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

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
  for (const option of ['--profile', '--underlay', '--colours', '--bleed', '--check', '--version', '--help']) {
    assert.ok(out.includes(option), option);
  }
});

test('too few arguments or an unknown option show the usage and exit with 2', async () => {
  for (const argv of [[], ['only-one.html'], ['a.html', 'b.pdf', 'c.pdf'], ['a.html', 'b.pdf', '--loud']]) {
    const { code, out, err } = await open(...argv);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /Usage: open-press/);
    assert.match(err, /^Marmalade Open Press /m);
  }
});

test('an unknown option says why before the usage', async () => {
  const { code, err } = await open('a.html', 'b.pdf', '--bogus');
  assert.equal(code, 2);
  assert.match(err, /^Unknown option '--bogus'/);
  assert.ok(err.indexOf('Unknown option') < err.indexOf('Usage: open-press'));
});

test('a bad value is explained in one plain line, and nothing is rendered', async () => {
  const cases = [
    [['--underlay', '3,2'], /--underlay takes three percentages/],
    [['--underlay', '3,2,x'], /--underlay takes three percentages/],
    [['--underlay', '3,2,101'], /--underlay takes three percentages/],
    [['--underlay', '3,,2'], /--underlay takes three percentages/],
    [['--underlay', '3,2,'], /--underlay takes three percentages/],
    [['--bleed', 'wide'], /--bleed takes a size in millimetres/],
    [['--bleed=-1'], /--bleed takes a size in millimetres/],
    [['--colours', 'baroque'], /no colour preset called "baroque"/],
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

test('formatReport lists the counts, and says when nothing is left in RGB', () => {
  assert.equal(
    formatReport(report),
    [
      'Profile: Example Coated',
      'Vector colours converted: 24 (20 neutral, 2 from the colour table)',
      'Images converted: 3',
      'Maximum total ink: 224%',
      'RGB left: none',
    ].join('\n'),
  );
});

test('formatReport marks a stand-in profile and lists what was left', () => {
  const left = [
    { what: 'image 12: not 8 bits per component', rgb: true },
    { what: 'image 14: not an RGB image', rgb: false },
  ];
  assert.equal(
    formatReport({ ...report, standIn: true, left }),
    [
      'Profile: Example Coated (stand-in)',
      'Vector colours converted: 24 (20 neutral, 2 from the colour table)',
      'Images converted: 3',
      'Maximum total ink: 224%',
      'Left as it was:',
      '  image 12: not 8 bits per component (RGB)',
      '  image 14: not an RGB image',
      'RGB left: 1',
    ].join('\n'),
  );
});

test('the poster becomes a PDF/X-4, with a warning about the stand-in profile', async (t) => {
  const output = join(await scratchFolder(t), 'poster.pdf');
  const { code, out, err } = await open(poster, output, '--check', '--underlay', '3,2,2', '--colours', 'classic', '--bleed', '3');
  assert.equal(code, 0);
  assert.match(err, /^No profile given/);
  assert.match(err, /--profile/);
  const lines = out.split('\n');
  assert.equal(lines[0], `Wrote ${output}.`);
  assert.match(lines[1], /^Profile: .+ \(stand-in\)$/);
  assert.match(out, /Vector colours converted: \d+ \(\d+ neutral, [1-9]\d* from the colour table\)/);
  assert.match(out, /Images converted: 3/);
  assert.match(out, /Maximum total ink: \d+%/);
  assert.equal(lines.at(-1), 'RGB left: none');

  const pdf = await readFile(output);
  assert.equal(pdf.toString('latin1', 0, 8), '%PDF-1.6');
  const [page] = (await PDFDocument.load(pdf)).getPages();
  assert.ok(Math.abs(page.getTrimBox().x - (3 * 72) / 25.4) < 1e-4);
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

test('RGB left makes --check exit with 1, and is mentioned even without --check', async (t) => {
  const folder = await scratchFolder(t);
  const page = join(folder, 'page.html');
  const output = join(folder, 'page.pdf');
  // Chromium writes a conic gradient as a function shading, which is left in RGB.
  const style = '@page { size: 50mm 50mm; margin: 0 } div { width: 40mm; height: 40mm; background: conic-gradient(#c2532d, #e3a33b, #c2532d) }';
  await writeFile(page, `<style>${style}</style><div></div>`);

  const checked = await open(page, output, '--check');
  assert.equal(checked.code, 1);
  assert.match(checked.out, /Left as it was:\n  shading of type 1: .+ \(RGB\)\nRGB left: 1$/);

  const unchecked = await open(page, output);
  assert.equal(unchecked.code, 0);
  assert.equal(unchecked.out, `Wrote ${output}.`);
  assert.match(unchecked.err, /Some colour was left in RGB\. Run again with --check to see what\.$/);
});
