// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { PDFArray, PDFDict, PDFDocument, PDFRef, PDFStream } from 'pdf-lib';
import { colourRules } from './colour.js';
import { recolour } from './content.js';
import { convertImages } from './images.js';
import { contentStreams, everyDict, isRgbSpace, name, readStream, rgbSpaceNames, writeStream } from './pdf.js';
import { asPdf16, dressAsPdfX4 } from './pdfx.js';
import { measureBlackRamp, openProfile, rgbToCmyk } from './profile.js';
import { convertShadings } from './shadings.js';
import { checkColourTable } from './table.js';

/**
 * @typedef {object} ConvertOptions
 * @property {string} [profile]                             Path of the printer's CMYK ICC profile.
 * @property {[number, number, number]} [underlay]          CMY percentages under every grey and black. Default 0, 0, 0.
 * @property {import('./colour.js').ColourEntry[]} [colours] A colour table. Default: none.
 * @property {number} [bleed]                               Millimetres, already part of the page size. Default 0.
 */

/**
 * @typedef {object} Report
 * @property {string} profile   The output profile's name.
 * @property {boolean} standIn  True when the built-in stand-in profile was used.
 * @property {number} vectors   Vector colours converted, by any rule.
 * @property {number} neutrals  Of which greys, black and white.
 * @property {number} tableHits Of which taken from the colour table.
 * @property {number} images    Images converted.
 * @property {number} maxInk    The heaviest total ink met, vectors and pixels, in percent.
 * @property {import('./images.js').Left[]} left  What was left as it was.
 */

/**
 * Converts an RGB PDF to CMYK PDF/X-4. The steps run in order: colours of the content streams, shadings,
 * images, transparency groups, then the PDF/X-4 dressing.
 * @param {Uint8Array} pdfBytes
 * @param {ConvertOptions} [options]
 * @returns {Promise<{pdf: Uint8Array, report: Report}>}
 */
export async function convert(pdfBytes, options = {}) {
  const { underlay = [0, 0, 0], bleed = 0 } = options;
  const isPercent = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  if (!Array.isArray(underlay) || underlay.length !== 3 || !underlay.every(isPercent)) {
    throw new Error('The underlay is three percentages from 0 to 100, such as [3, 2, 2].');
  }
  if (typeof bleed !== 'number' || !Number.isFinite(bleed) || bleed < 0) {
    throw new Error('The bleed is a size in millimetres, 0 or more.');
  }
  const table = checkColourTable(options.colours ?? []);

  const profile = await openProfile(options.profile);
  const ramp = await measureBlackRamp(profile, underlay);
  const mapColours = colourRules({ table, underlay, ramp, toProfile: (rgbs) => rgbToCmyk(profile, rgbs) });

  // Keeping the file's own title and dates is why updateMetadata is off.
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const { context } = doc;
  const report = {
    profile: profile.description,
    standIn: profile.standIn,
    vectors: 0,
    neutrals: 0,
    tableHits: 0,
    images: 0,
    maxInk: 0,
    left: [],
  };

  // The RGB profiles are found before anything is replaced, because replacing them is what unlinks them.
  const rgbProfiles = rgbProfileRefs(context);
  const maskForms = luminosityMaskForms(context);
  await recolourContents(context, doc, mapColours, report, maskForms);
  const shadings = await convertShadings(context, mapColours);
  tally(report, shadings.mapped);
  const images = await convertImages(context, profile);
  report.images = images.converted;
  report.maxInk = Math.max(report.maxInk, images.maxInk);
  report.left.push(...shadings.left, ...images.left);
  recolourGroups(context, maskForms);
  report.left.push(...remainingRgbSpaces(context));
  dropUnusedRgbProfiles(context, rgbProfiles);

  dressAsPdfX4(doc, { profile, bleed });
  return { pdf: asPdf16(await doc.save()), report };
}

/**
 * Rewrites the colours of every content stream. The colour spaces of all streams are read before the first
 * rewrite, because streams share resources and a rewrite must not change what another stream reads as RGB.
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {import('./colour.js').MapColours} mapColours
 * @param {Report} report
 * @param {Set<PDFRef>} maskForms Forms that are the luminosity of a soft mask. Their colour is opacity.
 * @returns {Promise<void>}
 */
async function recolourContents(context, doc, mapColours, report, maskForms) {
  for (const ref of maskForms) {
    report.left.push({ what: `soft mask ${ref.objectNumber}: a luminosity mask, left in its own colour space`, rgb: true });
  }
  const streams = contentStreams(doc).filter(({ ref }) => !maskForms.has(ref)).map((stream) => ({
    ...stream,
    rgbNames: rgbSpaceNames(context, stream.resources),
  }));
  // Each await is a colour transform. Nothing is written until every stream is read, so the decision on
  // shared resources below sees all of them.
  const results = [];
  for (const stream of streams) {
    const source = readStream(context.lookup(stream.ref)).toString('latin1');
    const rgbSpaces = new Set(stream.rgbNames.map((key) => key.asString()));
    results.push({ stream, result: await recolour(source, rgbSpaces, mapColours) });
  }
  // A stream with an inline image stays whole. Its resources name RGB colour spaces that must stay RGB, so
  // a stream that shares them is left whole too: renaming them to CMYK would break both streams.
  const keptResources = new Set(
    results.filter(({ result }) => result.inlineImage).map(({ stream }) => stream.resources).filter(Boolean),
  );
  const rewritten = [];
  for (const { stream: { ref, resources, rgbNames }, result } of results) {
    if (result.inlineImage) {
      report.left.push({ what: `content stream ${ref.objectNumber}: holds an inline image`, rgb: true });
      continue;
    }
    if (keptResources.has(resources)) {
      report.left.push({
        what: `content stream ${ref.objectNumber}: shares resources with an inline image stream`,
        rgb: true,
      });
      continue;
    }
    if (result.leftRgb > 0) {
      report.left.push({
        what: `content stream ${ref.objectNumber}: ${result.leftRgb} colour(s) in a colour space not known to be RGB`,
        rgb: true,
      });
    }
    writeStream(context, ref, Buffer.from(result.source, 'latin1'));
    tally(report, result.mapped);
    rewritten.push({ resources, rgbNames });
  }
  for (const { resources, rgbNames } of rewritten) {
    for (const key of rgbNames) {
      resources.lookup(name('ColorSpace'), PDFDict).set(key, name('DeviceCMYK'));
    }
  }
}

/**
 * Adds the colours of one step to the report.
 * @param {Report} report
 * @param {import('./colour.js').Mapped[]} mapped
 * @returns {void}
 */
function tally(report, mapped) {
  for (const { cmyk, rule } of mapped) {
    report.vectors += 1;
    if (rule === 'neutral') report.neutrals += 1;
    if (rule === 'table') report.tableHits += 1;
    report.maxInk = Math.max(report.maxInk, cmyk.reduce((sum, ink) => sum + ink, 0));
  }
}

/**
 * The forms that are the luminosity of a soft mask. In such a mask the colour is opacity, not ink.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<PDFRef>}
 */
function luminosityMaskForms(context) {
  const forms = new Set();
  for (const dict of everyDict(context)) {
    const form = dict.get(name('G'));
    if (dict.get(name('S')) === name('Luminosity') && form instanceof PDFRef) forms.add(form);
  }
  return forms;
}

/**
 * A transparency group names its blending colour space; in RGB it would blend in a space the press does not use.
 * The group of a luminosity mask is left alone, because its colour is opacity.
 * @param {import('pdf-lib').PDFContext} context
 * @param {Set<PDFRef>} maskForms
 * @returns {void}
 */
function recolourGroups(context, maskForms) {
  const maskGroups = new Set([...maskForms].map((ref) => context.lookup(ref)?.dict?.get(name('Group'))));
  for (const dict of everyDict(context)) {
    if (maskGroups.has(dict)) continue;
    const isRgbGroup = dict.get(name('S')) === name('Transparency')
      && dict.has(name('CS'))
      && isRgbSpace(context, dict.get(name('CS')));
    if (isRgbGroup) dict.set(name('CS'), name('DeviceCMYK'));
  }
}

/**
 * The RGB ICC profiles that the colour spaces of the file refer to, found before they are replaced.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<PDFRef>}
 */
function rgbProfileRefs(context) {
  const profiles = new Set();
  for (const dict of everyDict(context)) {
    for (const value of dict.values()) {
      const profile = value instanceof PDFArray ? value.get(1) : undefined;
      if (value instanceof PDFArray && profile instanceof PDFRef && isRgbSpace(context, value)) profiles.add(profile);
    }
  }
  return profiles;
}

/**
 * The colour spaces that stay RGB although the content streams and images were converted: indexed, pattern,
 * separation and device N spaces built on an RGB base or alternate. Nothing converts them, so they are reported.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {import('./images.js').Left[]}
 */
function remainingRgbSpaces(context) {
  const left = [];
  for (const dict of everyDict(context)) {
    const spaces = dict.lookup(name('ColorSpace'));
    if (!(spaces instanceof PDFDict)) continue;
    for (const [key, entry] of spaces.entries()) {
      const space = context.lookup(entry);
      if (!(space instanceof PDFArray)) continue;
      const kind = space.lookup(0);
      const rgbBase = (kind === name('Indexed') || kind === name('Pattern')) && isRgbSpace(context, space.get(1));
      const rgbAlternate = (kind === name('Separation') || kind === name('DeviceN')) && isRgbSpace(context, space.get(2));
      if (rgbBase || rgbAlternate) left.push({ what: `colour space ${key.asString()}: built on RGB`, rgb: true });
    }
  }
  return left;
}

/**
 * Every reference that an object of the file holds, followed or not. Each indirect object is walked on its own.
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<PDFRef>}
 */
function referencedRefs(context) {
  const refs = new Set();
  const visit = (object) => {
    if (object instanceof PDFRef) {
      refs.add(object);
    } else if (object instanceof PDFStream) {
      visit(object.dict);
    } else if (object instanceof PDFDict) {
      for (const value of object.values()) visit(value);
    } else if (object instanceof PDFArray) {
      for (const item of object.asArray()) visit(item);
    }
  };
  for (const [, object] of context.enumerateIndirectObjects()) visit(object);
  return refs;
}

/**
 * Removes the RGB profiles that nothing refers to any more. pdf-lib writes every object of the context, so an
 * unused sRGB profile would stay in the file, and a check of the output would find RGB in it.
 * @param {import('pdf-lib').PDFContext} context
 * @param {Set<PDFRef>} rgbProfiles
 * @returns {void}
 */
function dropUnusedRgbProfiles(context, rgbProfiles) {
  const referenced = referencedRefs(context);
  for (const ref of rgbProfiles) {
    if (!referenced.has(ref)) context.delete(ref);
  }
}
