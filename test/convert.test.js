// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { tokenize } from '../src/content.js';
import { convert } from '../src/convert.js';
import { contentStreams, readStream } from '../src/pdf.js';

const PAGE = [
  '0.5 0.5 0.5 rg 0 0 200 100 re f',
  '0 0 0 RG 0 0 200 100 re S',
  '1 1 1 rg 5 5 10 10 re f',
  '0.7608 0.3255 0.1765 rg 20 20 10 10 re f',
  '0 0.6824 0.9373 rg 40 20 10 10 re f',
  '/CS0 cs 1 0 0 scn 60 20 10 10 re f',
  'q 20 0 0 20 100 50 cm /Im0 Do Q',
  '/Fm0 Do',
  '/Sh0 sh',
].join('\n');

/** An RGB PDF with one of everything the converter handles; `extra` adds to the page stream. */
async function rgbPdf(extra = '') {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const page = doc.addPage([200, 100]);
  doc.setTitle('Fixture');
  const rgbProfile = context.register(context.flateStream(new Uint8Array(4), { N: 3 }));
  const image = context.register(
    context.flateStream(Buffer.from([255, 255, 255, 255, 0, 0, 0, 0, 0, 128, 128, 128]), {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }),
  );
  const form = context.register(
    context.flateStream('0 0 1 rg 0 0 5 5 re f', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5], Resources: {}, Group: { S: 'Transparency', CS: 'DeviceRGB' },
    }),
  );
  const blend = { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 };
  page.node.set(
    PDFName.of('Resources'),
    context.obj({
      ColorSpace: { CS0: [PDFName.of('ICCBased'), rgbProfile] },
      XObject: { Im0: image, Fm0: form },
      Shading: { Sh0: { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: blend } },
    }),
  );
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(PAGE + extra)));
  return doc.save();
}

const load = (pdf) => PDFDocument.load(pdf, { updateMetadata: false });
const sources = (doc) => contentStreams(doc).map(({ ref }) => readStream(doc.context.lookup(ref)).toString('latin1'));
const pageSource = (doc) => readStream(doc.getPages()[0].node.Contents()).toString('latin1');
const operators = (source) =>
  tokenize(source).filter((token) => token.type === 'operator').map((token) => source.slice(token.start, token.end));

/** The four inks, in percent, written before the nth k or K of a stream. */
function inkBefore(source, operator, nth = 0) {
  const pattern = new RegExp(`([\\d.]+) ([\\d.]+) ([\\d.]+) ([\\d.]+) ${operator}(?![A-Za-z])`, 'g');
  return [...source.matchAll(pattern)][nth].slice(1, 5).map((ink) => Number(ink) * 100);
}

test('no RGB is left: operators, colour spaces, image, shading and group are all CMYK', async () => {
  const { pdf, report } = await convert(await rgbPdf());
  const doc = await load(pdf);
  const resources = doc.getPages()[0].node.Resources();

  for (const source of sources(doc)) {
    for (const operator of operators(source)) assert.ok(!['rg', 'RG', 'g', 'G'].includes(operator), `${operator} is left`);
  }
  assert.equal(resources.lookup(PDFName.of('ColorSpace'), PDFDict).get(PDFName.of('CS0')), PDFName.of('DeviceCMYK'));
  const shading = resources.lookup(PDFName.of('Shading'), PDFDict).lookup(PDFName.of('Sh0'), PDFDict);
  assert.equal(shading.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.equal(shading.lookup(PDFName.of('Function'), PDFDict).lookup(PDFName.of('C0'), PDFArray).size(), 4);
  const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const image = xobjects.lookup(PDFName.of('Im0'), PDFRawStream);
  assert.equal(image.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceCMYK'));
  assert.equal(inflateSync(image.contents).length, 2 * 2 * 4);
  const group = xobjects.lookup(PDFName.of('Fm0'), PDFRawStream).dict.lookup(PDFName.of('Group'), PDFDict);
  assert.equal(group.get(PDFName.of('CS')), PDFName.of('DeviceCMYK'));
  assert.deepEqual(report.left, []);
});

test('greys print in black only, white in nothing, colours through the profile', async () => {
  const { pdf } = await convert(await rgbPdf());
  const source = pageSource(await load(pdf));

  const grey = inkBefore(source, 'k', 0);
  assert.deepEqual(grey.slice(0, 3), [0, 0, 0]);
  assert.ok(grey[3] > 45 && grey[3] < 60, `mid grey printed at ${grey[3]}% black`);
  assert.deepEqual(inkBefore(source, 'K', 0), [0, 0, 0, 100]);
  assert.deepEqual(inkBefore(source, 'k', 1), [0, 0, 0, 0]);
  const orange = inkBefore(source, 'k', 2);
  assert.ok(orange[1] > 50 && orange[2] > 50, `orange printed as ${orange}`);
  assert.match(source, /\/CS0 cs [\d.]+ [\d.]+ [\d.]+ [\d.]+ scn/);
  assert.ok(source.includes('q 20 0 0 20 100 50 cm /Im0 Do Q\n/Fm0 Do\n/Sh0 sh'));
});

test('the report counts what was converted and the heaviest ink met', async () => {
  const { report } = await convert(await rgbPdf());
  assert.equal(report.standIn, true);
  assert.equal(report.profile, 'Stand-in CMYK profile, not for press (Marmalade Open Press)');
  assert.equal(report.bleed, 0);
  assert.ok(Math.abs(report.trim.width - (200 * 25.4) / 72) < 1e-3);
  assert.ok(Math.abs(report.trim.height - (100 * 25.4) / 72) < 1e-3);
  assert.ok(Math.abs(report.lowestPpi.ppi - 7.2) < 1e-9);
  assert.equal(report.lowestPpi.page, 1);
  assert.deepEqual(report.type3Fonts, []);
  assert.equal(report.vectors, 9);
  assert.equal(report.neutrals, 3);
  assert.equal(report.tableHits, 0);
  assert.equal(report.images, 1);
  assert.ok(report.maxInk > 100 && report.maxInk <= 400, `maximum ink ${report.maxInk}`);
  assert.deepEqual(report.left, []);
});

test('an underlay sits under every grey and black, and never under white', async () => {
  const { pdf } = await convert(await rgbPdf(), { underlay: [8, 0, 2] });
  const source = pageSource(await load(pdf));
  assert.deepEqual(inkBefore(source, 'k', 0).slice(0, 3), [8, 0, 2]);
  assert.deepEqual(inkBefore(source, 'K', 0), [8, 0, 2, 100]);
  assert.deepEqual(inkBefore(source, 'k', 1), [0, 0, 0, 0]);
});

test('a colour table wins over every other rule', async () => {
  const colours = [
    { name: 'Text black', hex: '#000000', cmyk: [0, 0, 0, 100] },
    { name: 'Process cyan', hex: '#00AEEF', cmyk: [100, 0, 0, 0] },
    { name: 'House grey', hex: '#808080', cmyk: [0, 0, 0, 42] },
  ];
  const { pdf, report } = await convert(await rgbPdf(), { colours, underlay: [8, 0, 2] });
  const source = pageSource(await load(pdf));
  assert.deepEqual(inkBefore(source, 'k', 0), [0, 0, 0, 42]);
  assert.deepEqual(inkBefore(source, 'K', 0), [0, 0, 0, 100]);
  assert.deepEqual(inkBefore(source, 'k', 3), [100, 0, 0, 0]);
  assert.equal(report.tableHits, 3);
  assert.equal(report.neutrals, 1);
  assert.equal(report.vectors, 9);
});

test('a faulty colour table is refused before any work', async () => {
  await assert.rejects(convert(await rgbPdf(), { colours: [{ name: 'Odd', hex: 'red', cmyk: [0, 0, 0, 0] }] }), /entry 1 .*hex/);
});

test('options that would write nonsense are refused before any work', async () => {
  const pdf = await rgbPdf();
  await assert.rejects(convert(pdf, { underlay: [300, 0, 0] }), /underlay is three percentages/);
  await assert.rejects(convert(pdf, { bleed: -1 }), /bleed is a size in millimetres/);
});

test('the result is dressed as PDF/X-4, with the bleed taken off the trim box', async () => {
  const { pdf } = await convert(await rgbPdf(), { bleed: 3 });
  assert.equal(Buffer.from(pdf.subarray(0, 8)).toString('latin1'), '%PDF-1.6');
  const doc = await load(pdf);
  const intent = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
  assert.equal(intent.get(PDFName.of('S')), PDFName.of('GTS_PDFX'));
  assert.equal(intent.lookup(PDFName.of('DestOutputProfile'), PDFRawStream).dict.lookup(PDFName.of('N')).asNumber(), 4);
  assert.equal(doc.getTitle(), 'Fixture');
  const [page] = doc.getPages();
  assert.deepEqual(page.getBleedBox(), page.getMediaBox());
  assert.ok(Math.abs(page.getTrimBox().x - (3 * 72) / 25.4) < 1e-4);
});

test('a stream with an inline image is left alone and reported as RGB left', async () => {
  const { pdf, report } = await convert(await rgbPdf('\nBI /W 1 /H 1 /CS /RGB /BPC 8 ID \x00\x00\x00 EI'));
  assert.equal(pageSource(await load(pdf)).startsWith('0.5 0.5 0.5 rg'), true);
  assert.equal(report.left.length, 1);
  assert.equal(report.left[0].rgb, true);
  assert.match(report.left[0].what, /^content stream \d+: .*inline image/);
  assert.equal(report.vectors, 3);
});

test('without a profile, the output intent says it is a stand-in, not for press', async () => {
  const doc = await load((await convert(await rgbPdf())).pdf);
  const intent = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict);
  for (const key of ['OutputConditionIdentifier', 'Info']) {
    assert.equal(intent.lookup(PDFName.of(key)).decodeText(), 'Stand-in CMYK profile, not for press (Marmalade Open Press)');
  }
});

test('the report gives the finished size and the bleed in millimetres', async () => {
  const { report } = await convert(await rgbPdf(), { bleed: 3 });
  assert.equal(report.bleed, 3);
  assert.ok(Math.abs(report.trim.width - ((200 * 25.4) / 72 - 6)) < 1e-3);
  assert.ok(Math.abs(report.trim.height - ((100 * 25.4) / 72 - 6)) < 1e-3);
});

test('Type 3 fonts are named in the report', async () => {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const page = doc.addPage([100, 100]);
  const glyph = context.register(context.flateStream('0 0 0 rg 0 0 1 1 re f'));
  const font = {
    Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0], CharProcs: { a: glyph },
    Encoding: { Type: 'Encoding', Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1],
  };
  const named = context.register(context.obj({ ...font, BaseFont: 'Emoji' }));
  const unnamed = context.register(context.obj(font));
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F0: named, F1: unnamed } }));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('BT /F0 1 Tf (a) Tj /F1 1 Tf (a) Tj ET')));
  const { report } = await convert(await doc.save());
  assert.deepEqual(report.type3Fonts, ['Emoji', `font ${unnamed.objectNumber}`]);
});

test('a luminosity mask turns grey at the same luminosity, with its image, group and backdrop, and nothing is left in RGB', async () => {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const page = doc.addPage([100, 100]);
  const image = context.register(context.flateStream(Buffer.from([100, 200, 0, 255, 255, 255]), {
    Type: 'XObject', Subtype: 'Image', Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
  }));
  const mask = context.register(context.flateStream('1 0 0 rg 0 0 50 50 re f 0 0 0 RG /Im0 Do', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100],
    Resources: { XObject: { Im0: image } }, Group: { S: 'Transparency', CS: 'DeviceRGB' },
  }));
  page.node.set(PDFName.of('Resources'), context.obj({
    ExtGState: { GS0: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: mask, BC: [1, 1, 1] } } },
  }));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('/GS0 gs 0.7608 0.3255 0.1765 rg 0 0 100 100 re f')));

  const { pdf, report } = await convert(await doc.save());
  assert.deepEqual(report.left, []);
  const out = await load(pdf);
  const form = out.context.lookup(mask, PDFRawStream);
  assert.equal(readStream(form).toString('latin1'), '0.3 g 0 0 50 50 re f 0 G /Im0 Do');
  assert.equal(form.dict.lookup(PDFName.of('Group'), PDFDict).get(PDFName.of('CS')), PDFName.of('DeviceGray'));
  const grey = out.context.lookup(image, PDFRawStream);
  assert.equal(grey.dict.get(PDFName.of('ColorSpace')), PDFName.of('DeviceGray'));
  assert.deepEqual([...inflateSync(grey.contents)], [148, 255]);
  const state = out.getPages()[0].node.Resources().lookup(PDFName.of('ExtGState'), PDFDict).lookup(PDFName.of('GS0'), PDFDict);
  const backdrop = state.lookup(PDFName.of('SMask'), PDFDict).lookup(PDFName.of('BC'), PDFArray);
  assert.deepEqual(backdrop.asArray().map((n) => n.asNumber()), [1]);
  assert.match(pageSource(out), /^\/GS0 gs [\d.]+ [\d.]+ [\d.]+ [\d.]+ k/);
});
