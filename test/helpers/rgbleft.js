// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * Stands in for render, for the command line's third argument: a 50 mm page with one gradient whose colours are
 * a sampled function, which the converter leaves in RGB. Every gradient Chromium writes is converted, so no page
 * leaves RGB, and this PDF is made by hand.
 * @returns {Promise<Uint8Array>}
 */
async function renderLeavingRgb() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([141.73, 141.73]);
  const { context } = doc;
  const table = { FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8 };
  const sampled = context.register(context.flateStream(new Uint8Array([194, 83, 45, 227, 163, 59]), table));
  const shading = { ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 141.73, 0], Function: sampled };
  page.node.set(PDFName.of('Resources'), context.obj({ Shading: { Sh0: shading } }));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('/Sh0 sh')));
  return doc.save();
}

/** The steps of a run whose PDF leaves one shading in RGB. */
export const LEAVING_RGB = { render: renderLeavingRgb };
