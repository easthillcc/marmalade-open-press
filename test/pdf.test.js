// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { contentStreams, everyDict, isRgbSpace, name, readStream, rgbSpaceNames, writeStream } from '../src/pdf.js';

/**
 * A one-page PDF built by hand, saved and loaded again, so that it is read as any PDF from disk would be:
 * a page stream, a form XObject, a tiling pattern, a Type 3 glyph, an image, and four kinds of colour space.
 */
async function fixture() {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const page = doc.addPage([200, 100]);
  const rgbProfile = context.register(context.flateStream(new Uint8Array(4), { N: 3 }));
  const cmykProfile = context.register(context.flateStream(new Uint8Array(4), { N: 4 }));
  const image = context.register(
    context.flateStream(new Uint8Array(3), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
  );
  const form = context.register(
    context.flateStream('0 0 1 rg', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 5, 5],
      Resources: { ColorSpace: { F0: 'DeviceRGB' } },
      Group: { S: 'Transparency', CS: 'DeviceRGB' },
    }),
  );
  const pattern = context.register(
    context.flateStream('0 1 0 rg', { PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 5, 5], XStep: 5, YStep: 5, Resources: {} }),
  );
  const glyph = context.register(context.flateStream('5 0 d0 1 0 0 rg'));
  const font = context.register(
    context.obj({ Type: 'Font', Subtype: 'Type3', CharProcs: { a: glyph }, Resources: { ColorSpace: { T0: 'DeviceRGB' } } }),
  );
  page.node.set(
    PDFName.of('Resources'),
    context.obj({
      ColorSpace: {
        CS0: [PDFName.of('ICCBased'), rgbProfile],
        CS1: [PDFName.of('ICCBased'), cmykProfile],
        CS2: 'DeviceRGB',
        CS3: 'DeviceGray',
      },
      XObject: { Im0: image, Fm0: form },
      Pattern: { P0: pattern },
      Font: { F0: font },
    }),
  );
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('1 0 0 rg')));
  return PDFDocument.load(await doc.save(), { updateMetadata: false });
}

const sourceOf = (doc, { ref }) => readStream(doc.context.lookup(ref)).toString('latin1');

test('name interns a PDF name', () => {
  assert.equal(name('DeviceRGB'), PDFName.of('DeviceRGB'));
});

test('isRgbSpace knows DeviceRGB and ICC profiles of three components, direct or by reference', async () => {
  const doc = await fixture();
  const { context } = doc;
  const spaces = doc.getPages()[0].node.Resources().lookup(name('ColorSpace'), PDFDict);
  assert.equal(isRgbSpace(context, spaces.get(name('CS0'))), true);
  assert.equal(isRgbSpace(context, spaces.get(name('CS1'))), false);
  assert.equal(isRgbSpace(context, spaces.get(name('CS2'))), true);
  assert.equal(isRgbSpace(context, spaces.get(name('CS3'))), false);
  assert.equal(isRgbSpace(context, context.register(name('DeviceRGB'))), true);
  assert.equal(isRgbSpace(context, name('DeviceCMYK')), false);
  assert.equal(isRgbSpace(context, context.obj(['Pattern'])), false);
  assert.equal(isRgbSpace(context, undefined), false);
});

test('rgbSpaceNames lists the RGB colour spaces of a resource dictionary', async () => {
  const doc = await fixture();
  const resources = doc.getPages()[0].node.Resources();
  assert.deepEqual(rgbSpaceNames(doc.context, resources), [name('CS0'), name('CS2')]);
  assert.deepEqual(rgbSpaceNames(doc.context, doc.context.obj({})), []);
  assert.deepEqual(rgbSpaceNames(doc.context, undefined), []);
});

test('contentStreams finds the page, the form, the pattern and the glyph, each once, with its resources', async () => {
  const doc = await fixture();
  const streams = contentStreams(doc);
  const bySource = new Map(streams.map((stream) => [sourceOf(doc, stream), stream]));
  assert.equal(streams.length, 4);
  assert.deepEqual([...bySource.keys()].sort(), ['0 0 1 rg', '0 1 0 rg', '1 0 0 rg', '5 0 d0 1 0 0 rg']);
  assert.deepEqual(rgbSpaceNames(doc.context, bySource.get('1 0 0 rg').resources), [name('CS0'), name('CS2')]);
  assert.deepEqual(rgbSpaceNames(doc.context, bySource.get('0 0 1 rg').resources), [name('F0')]);
  assert.deepEqual(rgbSpaceNames(doc.context, bySource.get('0 1 0 rg').resources), []);
  assert.deepEqual(rgbSpaceNames(doc.context, bySource.get('5 0 d0 1 0 0 rg').resources), [name('T0')]);
});

test('contentStreams reads a page whose contents are several streams, and counts a shared stream once', async () => {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const shared = context.register(context.flateStream('q'));
  const own = context.register(context.flateStream('Q'));
  doc.addPage([10, 10]).node.set(name('Contents'), context.obj([shared, own]));
  doc.addPage([10, 10]).node.set(name('Contents'), shared);
  const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  assert.deepEqual(contentStreams(loaded).map((stream) => sourceOf(loaded, stream)).sort(), ['Q', 'q']);
});

test('contentStreams pairs a page form without /Resources with the page resources, and a bare glyph with none', async () => {
  const doc = await PDFDocument.create();
  const { context } = doc;
  const form = context.register(context.flateStream('0 0 1 rg', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 5, 5] }));
  const glyph = context.register(context.flateStream('5 0 d0 1 0 0 rg'));
  const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type3', CharProcs: { a: glyph } }));
  doc.addPage([10, 10]).node.set(name('Resources'), context.obj({ XObject: { Fm0: form }, Font: { F0: font } }));
  const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const streams = contentStreams(loaded);
  assert.deepEqual(streams.map((stream) => sourceOf(loaded, stream)).sort(), ['0 0 1 rg', '5 0 d0 1 0 0 rg']);
  const pageResources = loaded.getPages()[0].node.Resources();
  const bySource = new Map(streams.map((stream) => [sourceOf(loaded, stream), stream.resources]));
  assert.equal(bySource.get('0 0 1 rg'), pageResources);
  assert.equal(bySource.get('5 0 d0 1 0 0 rg'), undefined);
});

test('everyDict reaches every dictionary, nested ones and stream dictionaries included', async () => {
  const doc = await fixture();
  const dicts = [...everyDict(doc.context)];
  const groups = dicts.filter((dict) => dict.get(name('S')) === name('Transparency'));
  const images = dicts.filter((dict) => dict.get(name('Subtype')) === name('Image'));
  const spaceTables = dicts.filter((dict) => dict.has(name('CS0')));
  assert.equal(groups.length, 1);
  assert.equal(images.length, 1);
  assert.equal(spaceTables.length, 1);
  assert.equal(new Set(dicts).size, dicts.length);
});

test('writeStream replaces the data, compressed, and keeps the rest of the dictionary', async () => {
  const doc = await fixture();
  const { context } = doc;
  const isForm = (object) => object instanceof PDFRawStream && object.dict.get(name('Subtype')) === name('Form');
  const [ref] = context.enumerateIndirectObjects().find(([, object]) => isForm(object));
  context.lookup(ref).dict.set(name('DecodeParms'), context.obj({ Predictor: 1 }));
  writeStream(context, ref, Buffer.from('0 0 0 1 k', 'latin1'));
  const written = context.lookup(ref);
  assert.equal(written.dict.get(name('Filter')), name('FlateDecode'));
  assert.equal(written.dict.has(name('DecodeParms')), false);
  assert.equal(written.dict.get(name('Subtype')), name('Form'));
  assert.equal(inflateSync(written.contents).toString('latin1'), '0 0 0 1 k');
  assert.equal(readStream(written).toString('latin1'), '0 0 0 1 k');

  const reloaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  assert.ok(contentStreams(reloaded).some((stream) => sourceOf(reloaded, stream) === '0 0 0 1 k'));
});

test('readStream gives the bytes of a stream that was never compressed', async () => {
  const { context } = await PDFDocument.create();
  assert.equal(readStream(context.stream('1 0 0 rg')).toString('latin1'), '1 0 0 rg');
});
