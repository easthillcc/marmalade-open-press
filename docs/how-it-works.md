# How it works

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

A tour of the kitchen, in the order the plates go out. Each step is one module in `src/`.

```
HTML or URL ──render──▶ RGB PDF ──convert──▶ CMYK PDF/X-4 ──exportAs──▶ PDF/X-1a, PDF/X-3 or CMYK TIFF
             Chromium              pdf-lib + sharp             Ghostscript
```

## 1. Render (`render.js`)

Playwright opens the page in headless Chromium, waits until the network is idle so fonts and images have arrived, and prints it with `page.pdf()`, backgrounds included. The page size comes from the page's own `@page { size }` rule (`pagerule.js` reads it, `pagesize.js` parses it). A page that names no size is printed on ISO A5, 148 x 210 mm, plus the `--bleed` on every side. The PDF names this tool as its Creator, next to Chromium.

Chromium rounds a page size to whole points, so a page of 154 mm would come out 154.18 mm wide. `exactboxes.js` sets the media box to the exact size that was asked for, and moves the content and the links by the rounding, never scaling them, so everything keeps its place from the top-left corner. It also lays the page's background colour under the whole page, out to the exact edge, because Chromium paints it only as far as a whole number of CSS pixels. A page sized by `@page :first` or a named page, by `var()` or a relative unit such as `em` (a `calc()` of absolute units is read), or by a stylesheet that cannot be read a second time, keeps Chromium's own size and rounding, and gets no bleed added.

Chromium can only print RGB. That is not a fault of Chromium; screens are RGB and browsers have no notion of ink. Everything after this step exists to fix that, without asking you to change your HTML.

`convert` does not care where the RGB PDF came from. A PDF from Puppeteer, from a Chrome print dialog or from another tool goes through the same steps.

## 2. Convert (`convert.js`)

pdf-lib opens the PDF and the steps run in this order, with one exception: the soft masks of step 4 are turned grey just after the content streams, so that the images step finds their images already done. Only the other transparency groups wait until after the images.

1. **Content streams** (`content.js`). Every operator that sets an RGB or grey fill or stroke (`rg`, `RG`, `g`, `G`, and `sc`/`scn`/`SC`/`SCN` in an RGB colour space) is rewritten as CMYK (`k`, `K`), and the RGB colour spaces named in the page resources become `DeviceCMYK`. Each colour is chosen by the four rules below.
2. **Gradients** (`shadings.js`, `calculator.js`). Shadings built from blends between two colours, which is what Chromium draws for linear and radial CSS gradients, have the colours at the ends of each blend converted by the same rules; the ink between them is interpolated. Chromium draws a repeating or conic CSS gradient, and an SVG gradient that repeats or reflects, as a small PostScript program (a function of type 4) that turns a point into a colour. That program is run to read its colour stops, each stop is converted by the same rules, and the program is written again in CMYK with the same stops, so the ink between two stops is interpolated too. Before anything changes, the program written again from what was read is run against the original on a grid of points, and the two must agree. Other shadings, other functions, and shadings with a background are left and reported, with their shading type and function type.
3. **Images** (`images.js`). Every RGB image is converted pixel by pixel through the ICC profile by sharp (libvips and lcms), and stored as lossless CMYK. A JPEG with its own embedded profile is read through that profile.
4. **Soft masks and transparency groups** (`masks.js`). Chromium draws a `box-shadow` or a `text-shadow` through a luminosity soft mask, which is a grey picture of how opaque the shadow is at each point. Its colours are opacity, not ink, so they do not go through the profile. Each colour, each RGB image, an RGB group and an RGB backdrop in such a mask becomes the grey of the same luminosity (0.3 R + 0.59 G + 0.11 B, which is how PDF reads an RGB colour in a mask) in DeviceGray, so the mask is exactly as opaque as before and nothing in it is left in RGB. Other groups that name RGB as their blending space are told to blend in CMYK, the space the press works in.
5. **Clean-up**. RGB ICC profiles that nothing uses any more are removed, so a preflight finds no RGB in the file. Colour spaces that are still built on RGB are reported.
6. **PDF/X-4 dressing** (`pdfx.js`). Output intent with the embedded profile, XMP, trailer ID, Info keys, bleed and trim boxes, PDF 1.6.

## The four rules for a vector colour (`colour.js`)

The first rule that applies wins.

1. **Colour table.** The colour is within 1.5 levels per channel of an entry's hex. The entry's inks are used exactly.
2. **White.** No ink at all, so the underlay never tints the paper.
3. **Grey.** Red, green and blue within 1.5 levels of each other. The grey gets the underlay plus the black that prints its lightness (below).
4. **Profile.** Anything else goes through the ICC profile.

## The black ramp (`profile.js`)

A plain ICC conversion puts a grey on all four plates. Through the stand-in profile, `#333333` comes out as about 16/4/20/88: four plates and four chances to misregister, for a colour that black could print alone. The tool instead measures what each of the 256 strengths of black (with the underlay under it) prints through the profile, as CIE L\*. A grey is then given the strength of black whose L\* matches the L\* of the grey. The result prints at the lightness the designer saw, and it is made of black alone.

## Why images are not given the rules

A photograph has no greys in the useful sense: every near-neutral pixel sits next to one that is not, and forcing some of them to the black plate would make blotches. Images go through the profile whole. Text drawn as an image (a screenshot of a heading, say) is therefore four-colour; draw text as text.

## 3. Export (`export.js`)

For the other formats the finished PDF/X-4 is handed to Ghostscript in a scratch folder of its own, with `-dSAFER`.

- `flatten.js` runs `pdfwrite` with `-dPDFX`, PDF 1.3 compatibility, and the printer's profile given as both the default CMYK and the output profile, so CMYK passes through untouched. `pdfx13.js` then restores the boxes, output intent and Info keys that Ghostscript drops or rewrites.
- `tiff.js` runs `tiff32nc` with the same profile on both sides, and then names this tool in each page's Software tag, next to Ghostscript. The pixels and the profile are not touched.
- `transparency.js` reads, before anything is flattened, which pages name transparency in their resources, the way Ghostscript decides. `pixels.js` compares the pages before and after to say how much of each page became an image and whether text was lost.

Ghostscript is called as a separate program and is not linked or bundled. It is licensed under the AGPL by Artifex; install it yourself, or skip it and use PDF/X-4 only.

## 4. Check (`--check`)

The report counts what was converted and lists anything left in RGB, with the reason. It also prints the trim size and the bleed in millimetres, the lowest image resolution in ppi at its placed size, and warnings for a stand-in profile, an image below 300 ppi and Type 3 fonts, which some printers refuse. Warnings never change the exit code. `--check` exits with 1 when RGB is left, so it can stop a build in CI before a file reaches a printer.
