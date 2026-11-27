// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

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
  assert.equal(typeof report.profile, 'string');
  assert.ok(report.profile.length > 0);
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
