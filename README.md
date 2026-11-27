# Marmalade Open Press

Marmalade Open Press, made by [Marmalade](https://marmalade.family), is a Node.js tool that turns an HTML page into a print-ready CMYK PDF/X-4, with K-only greys and clean blacks on the black plate alone.

It prints the page with Chromium, converts every colour and image through your printer's ICC profile, and keeps grey and black text on the black plate, with a little cyan, magenta and yellow underneath if you ask for it. With Ghostscript installed it also writes PDF/X-1a, PDF/X-3 and CMYK TIFF pages, for printers who ask for something older.

[![test](https://github.com/easthillcc/marmalade-open-press/actions/workflows/test.yml/badge.svg)](https://github.com/easthillcc/marmalade-open-press/actions/workflows/test.yml)

[Output formats](docs/output-formats.md) · [How it works](docs/how-it-works.md) · [Recipes](docs/recipes.md) · [Comparison with other tools](docs/comparison.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

Marmalade turns a family's week into a printed magazine. This is a small part of what we learned about paper, opened to everyone.

## Why Marmalade made it

Marmalade is an app for families. During the week, everyone adds a few moments: a photo, a line about the day. At the end, Marmalade turns them into a small magazine and sends it to the family's door, printed on paper.

A screen and a press want different things. A browser draws in red, green and blue. A press wants ink: CMYK, a PDF/X file, an output profile, and black text that sits on the black plate alone. A browser gives you none of that, and a plain colour conversion treats a grey as four inks.

So we wrote the step in between, and made it general enough to be useful to anyone who prints from the web: a menu, a poster, a zine, a book of recipes. It is small, it is MIT licensed, and it is yours to use.

## A review

A browser prints in red, green and blue, which suits a screen and ruins a press. A screen mixes light. A press mixes ink, and ink is the more expensive opinion. Send a browser's RGB PDF to a printer and the printer's machine has to guess what you meant, and it usually guesses in favour of more ink.

The worst offence is grey text printed in four colours when black would do. A grey built from cyan, magenta, yellow and black has four plates to go wrong instead of one. When the plates drift, and they always drift a little, the letters grow a fuzzy halo, like a photocopy that has been on holiday. Then there is black text on a tinted page. Knock the tint out from under the letters and, when the plates move by a fraction of a millimetre, a hairline of bare paper shows around every letter. Nobody ordered that white outline. It is still there.

This tool is the kitchen that gets it right. Greys and blacks go to the black plate, everything else goes through the printer's profile, and nothing is left to the printer's guesswork. It does not improvise. With `--check` it prints a report at the end that says what it could not manage, which is more than most kitchens will admit to.

Those who already print with Puppeteer or Playwright are halfway to the table. `page.pdf()` serves a perfectly good RGB PDF and has no colour option, which is a very fine dish with no one to season it. `convert` takes that PDF, from whatever drew it, and does the rest.

Verdict, grudgingly: approve. Put the napkin down. The rest is the manual.

## The plates

All the text is on the black plate.

![The black plate](docs/images/plate-black.png)

On the cyan, magenta and yellow plates only the page tint and the orange word are left.

![The cyan, magenta and yellow plates](docs/images/plate-cmy.png)

Both pictures are the same crop of the example poster. They are made by `node scripts/separations.js`, which needs Ghostscript (`gs`) on the path.

## Install

You need Node 22 or later. From npm:

```sh
npm install marmalade-open-press
npx playwright install chromium
```

Then `npx open-press` runs the command line, and `import { render, convert } from 'marmalade-open-press'` the library. Chromium is needed only to draw a page: `convert` works on a PDF you already have without it.

Or from a clone:

```sh
git clone https://github.com/easthillcc/marmalade-open-press.git
cd marmalade-open-press
npm install
npx playwright install chromium
```

From the clone, run it as `npx open-press` or `node bin/open-press.js`. The examples below write `open-press` for short.

## Command line

```sh
open-press <input.html|url> <output.pdf> [options]
```

| Option | What it does |
|---|---|
| `--profile <file.icc>` | The printer's CMYK output profile. Without it, a stand-in profile is used and the tool says so. |
| `--underlay <c,m,y>` | Percentages of cyan, magenta and yellow kept under every grey and black, such as `3,2,2`. Default `0,0,0`. |
| `--colours <file.json\|classic>` | A colour table, from a JSON file or a preset name. See below. |
| `--bleed <mm>` | Bleed on every side. Sets the TrimBox. A page that names its own size already includes it; a page that names none is printed on A5 plus the bleed. Default `0`. See [Page size and bleed](#page-size-and-bleed). |
| `--format <x4\|x1a\|x3\|tiff>` | The output format. Default `x4`. The others need Ghostscript. See [Output formats](#output-formats). |
| `--dpi <n>` | With `--format tiff`, the resolution of the pages. With `x1a` and `x3`, the resolution of a page that had to be flattened. Default `300`. |
| `--check` | Prints a report: what was converted, the trim size and the bleed, the lowest image resolution, and warnings. |
| `--version` | Prints the version. |
| `--help` | Prints the usage. |

Exit codes:

- `0`: done.
- `1`: with `--check`, RGB is left in the file.
- `2`: wrong usage, the conversion failed, or the format needs Ghostscript and it is not installed.

Warnings never change the exit code.

The example poster builds with `npm run example`. These are the lines the tool printed, without npm's own header:

```
No profile given, so a stand-in CMYK profile was used. Ask your printer for theirs and pass it with --profile.
Wrote examples/poster.pdf.
Profile: Stand-in CMYK profile, not for press (Marmalade Open Press)
Trim: 148 x 210 mm, bleed 3 mm
Vector colours converted: 27 (20 neutral, 0 from the colour table)
Images converted: 3
Lowest image resolution: 246 ppi at placed size (image 8, page 1)
Maximum total ink: 224%
Warning: the profile is a stand-in, not for press. Ask your printer for theirs and pass it with --profile.
Warning: image 8 prints at 246 ppi, below 300.
RGB left: none
```

`--check` reports, in this order: the profile; the trim size and the bleed of the first page, in millimetres; how many colours and images were converted; the lowest resolution of any image at the size it is placed, in pixels per inch; the heaviest total ink; the warnings; what was left as it was; and how much RGB is left. There are three warnings. The stand-in profile is one. An image below 300 ppi is another, and the poster's photograph is one of those, because it is an example and not a commission. Type 3 fonts are the third: Chromium uses them for some fonts, colour emoji among them, and some printers refuse them. A warning is something to look at. Only RGB left sets the exit code.

The page size comes from the page's own CSS, `@page { size: ... }`, exactly. A page that names no size is printed on A5. See [Page size and bleed](#page-size-and-bleed).

`examples/back-cover.html` is a Marmalade back cover: the wordmark in the middle, a line of type underneath, and no `@page` rule, so it comes out on A5. The wordmark is an SVG and stays a vector, so it is as sharp at any size as the press can make it.

```sh
open-press examples/back-cover.html examples/back-cover.pdf --check
```

The example PDFs are in `examples/`, `poster-x1a.pdf` among them, all built with the stand-in profile.

Without `--profile` the tool uses the built-in `cmyk` profile as a stand-in, and it says so on every run. The printer's own profile is the one that counts. Ask for it, then pass it with `--profile`. The PDF says so too: its output intent is named `Stand-in CMYK profile, not for press (Marmalade Open Press)`, so a preflight that reads it will not take it for the printer's.

### Page size and bleed

The page size comes from the page's `@page` rule, and the PDF has exactly that size: `154mm 216mm` gives 436.535 x 612.283 pt, not the whole points that Chromium would round it to. Any size CSS allows will do: two lengths, one length for a square, or a name such as `A5` or `A4 landscape`, in mm, cm, Q, in, pc, pt or px. The rule can be in the page or in a stylesheet it links to.

A page that names no size is printed on ISO A5, 148 x 210 mm. With `--bleed 3` it is printed on A5 plus 3 mm on every side, 154 x 216 mm, and the trim box is A5 again. The page is laid out at that bigger size, so keep text inside the trim and let backgrounds run to the edge.

A page that names its own size keeps it, with or without `--bleed`. Its bleed is already part of that size, and `--bleed` only says how much of the edge is bleed, which is where the trim box goes. The poster names `154mm 216mm`, which is A5 with 3 mm all round.

Chromium draws the page from its top-left corner and does not scale it. It lays a page out in whole CSS pixels, a quarter of a millimetre each, and paints the page background (the background of `html` or `body`) only that far. The tool lays the same colour under the page out to its exact edge, so the background reaches every edge. A box drawn to the right or bottom edge, such as a `div` of `width: 100%`, can still stop up to about 0.1 mm short of it. With a bleed, that sliver is outside the trim and leaves with the offcut. A page without bleed is better given some. A background image on the page itself is not repeated under the edge, only its colour.

## Output formats

PDF/X-4 is the house dish, and most printers now eat it without complaint. Some still order from an older menu. For them there is `--format`.

| Format | What comes out |
|---|---|
| `x4` | PDF/X-4, in PDF 1.6. The default, and the only one that needs nothing else installed. |
| `x1a` | PDF/X-1a:2001, in PDF 1.3. CMYK only, no transparency. |
| `x3` | PDF/X-3:2002, in PDF 1.3. No transparency. |
| `tiff` | One CMYK TIFF per page, 8 bits per ink, LZW compressed, with the output profile inside. |

```sh
open-press poster.html poster.pdf --profile printer.icc --format x1a
open-press poster.html poster.tif --profile printer.icc --format tiff --dpi 600
```

Every format but `x4` is cooked by Ghostscript. It is a separate program with its own licence, the AGPL, and it is not part of this package. Install it with `brew install ghostscript` on macOS or `apt install ghostscript` on Debian and Ubuntu. Without it `x4` works as before, and the other formats stop with exit code 2 and a line that says the same thing. If your Ghostscript goes by another name, such as `gswin64c` on Windows, give that name in the environment variable `OPEN_PRESS_GS`. Tested with Ghostscript 10.06; older versions may flatten differently.

The tool makes the PDF/X-4 first, exactly as it always did, and then hands it to Ghostscript. The inks do not change on the way: a grey that was on the black plate alone is still there afterwards. Ghostscript writes its numbers with its own rounding, so an ink can move by up to a tenth of a percent, which no press has ever noticed. The trim box, the bleed box, the title and the output profile are put back by this tool afterwards, because Ghostscript drops the first two and has its own ideas about the rest. Links are removed from `x1a` and `x3`, because a link is a printable annotation in the trim area, and those standards refuse one there.

In this kitchen `x1a` and `x3` are the same dish under two names. PDF/X-3 would allow colours that carry their own profiles. Everything here is already plain CMYK, so the only difference is the label the file wears.

With `tiff` the output name ends in `.tif`, and the pages are written as `poster-1.tif`, `poster-2.tif` and so on, even when there is only one. A TIFF is pixels by nature, text included, so choose the resolution with `--dpi`. The edges of letters are smoothed. Shapes are not, because smoothing leaves a pale line where two shapes meet, and a press prints that line faithfully. A TIFF page is the whole page including the bleed, and it has no trim box, so tell the printer where the trim is.

### Transparency, and what flattening costs

PDF 1.3 has no transparency. A CSS `opacity`, a `box-shadow`, an `rgba()` colour and a `mix-blend-mode` all become transparency in the PDF that Chromium draws, and `x1a` and `x3` cannot carry it. It has to be flattened. The flattening is done by Ghostscript, which is not subtle about it.

Here is the limit, said plainly. **A page that uses transparency anywhere becomes one picture of itself.** Not the shadow alone, and not the corner with the veil: the whole page, text included, at 300 dots per inch unless `--dpi` says otherwise. The letters on that page are no longer letters. They are pixels with hard edges, they cannot be selected, and at 300 dots per inch small type looks as if it had been faxed. A page that uses no transparency is left as it was, with its text and its vectors. The decision is made page by page, and one drop shadow is enough to condemn a page.

So, in order of preference:

1. Send PDF/X-4 if the printer takes it. Nothing is flattened.
2. Keep transparency off the pages that carry small text. A solid tint does the work of an `opacity`, and a border the work of a shadow.
3. If a page must be flattened, raise `--dpi` to 600. The file grows and the letters recover most of their dignity.

`--check` says what happened, page by page:

```
Format: PDF/X-1a:2001, written by Ghostscript 10.06.0
Transparency: page 2 (opacity, transparency group)
Flattened to pixels at 300 dpi: page 2 (100% of the page)
Text turned to pixels: page 2
```

The example poster uses no transparency, so its PDF/X-1a keeps every letter. `npm run example:x1a` builds it, and ends with these lines:

```
Format: PDF/X-1a:2001, written by Ghostscript 10.06.0
Transparency: none
Flattened to pixels: none
```

Text turned to pixels is a warning and not a failure. The exit code stays 0, and without `--check` one line on the error stream mentions it. RGB left in the file is still the only thing that makes `--check` exit with 1. If the PDF/X-4 had RGB left in it, Ghostscript converts that too for `x1a`, `x3` and `tiff`. It goes through the profile, without the rules for greys and blacks, and it may come out as a small image. The exit code is still 1, because the rules were not applied to it.

Transparency is looked for the way Ghostscript looks for it: in what a page's resources name, whether or not the page ends up painting with it. The share of the page is measured from the size of the image Ghostscript wrote. All of this was measured with Ghostscript 10.06.0. Another version may flatten differently, and the report describes what is in the file, not what was hoped for.

## Library

The package has two layers, and each works alone.

- `render` takes an HTML file path, a URL or HTML markup, and returns an RGB PDF drawn by Chromium at the exact page size. Its one option, `bleed` in millimetres, is used only by a page that names no size, as `--bleed` is.
- `convert` takes any RGB PDF, from any source, and returns a CMYK PDF/X-4 and a report.

A third step is there for the other formats, and it also works alone.

- `exportAs` takes the PDF/X-4 that `convert` returned and writes it as PDF/X-1a, PDF/X-3 or TIFF pages.

```js
import { render, convert, loadColourTable } from 'marmalade-open-press';

const rgb = await render('poster.html', { bleed: 3 });
const colours = await loadColourTable('classic');
const { pdf, report } = await convert(rgb, {
  profile: 'printer.icc',
  underlay: [3, 2, 2],
  colours,
  bleed: 3,
});
```

`convert(pdfBytes, options)` accepts these options. All are optional.

| Option | Type | Default |
|---|---|---|
| `profile` | path of an ICC profile | the stand-in profile |
| `underlay` | `[c, m, y]` in percent | `[0, 0, 0]` |
| `colours` | array of colour table entries | none |
| `bleed` | millimetres, `0`; it sets the trim box, so pass the same value to `render` | `0` |

The returned `report` has these fields:

| Field | Meaning |
|---|---|
| `profile` | The output profile's name. For the stand-in it is `Stand-in CMYK profile, not for press (Marmalade Open Press)`. |
| `standIn` | `true` when the stand-in profile was used. |
| `vectors` | Vector colours converted, by any rule. |
| `neutrals` | Of those, greys, black and white. |
| `tableHits` | Of those, colours taken from the colour table. |
| `images` | Images converted. |
| `maxInk` | The heaviest total ink met, in percent, across vectors and image pixels. |
| `left` | Items left as they were. Each has `what` and `rgb`, and `rgb` is `true` when the item still holds RGB. |
| `trim` | The finished size of the first page, `{ width, height }` in millimetres, from its trim box. |
| `bleed` | The bleed on every side, in millimetres. |
| `lowestPpi` | The image with the lowest resolution at its placed size, as `{ ppi, image, page }`, or `null` when no image is drawn. `image` is its object number. |
| `type3Fonts` | The names of the Type 3 fonts, which some printers refuse. |

`loadColourTable(nameOrPath)` returns a checked table from a preset name such as `classic`, or from a JSON file.

`exportAs(pdfX4, format, options)` takes the bytes that `convert` returned, a format from `FORMATS` (`'x4'`, `'x1a'`, `'x3'`, `'tiff'`) and one option, `dpi`, which is `300` by default. It returns `files` and a `report`. `files` holds one PDF, or one TIFF per page. With `'x4'` it gives the same bytes back and needs no Ghostscript.

```js
import { exportAs, findTransparency } from 'marmalade-open-press';

const { files, report } = await exportAs(pdf, 'x1a', { dpi: 600 });
const pages = await findTransparency(pdf);
```

The `report` of `exportAs` has these fields:

| Field | Meaning |
|---|---|
| `format` | The format written. |
| `pages` | The number of pages. |
| `dpi` | The resolution used, or `null` for `x4`. |
| `ghostscript` | The version of Ghostscript that did the work, or `null` for `x4`. |
| `transparency` | One entry per page, with `page` and `kinds`. The kinds are `opacity`, `blend mode`, `soft mask` and `transparency group`. An empty list means the page has none. |
| `pixels` | For `x1a` and `x3`, one entry per page: `flattened`, `share` (the part of the page the image covers, from 0 to 1), `textLost` and `imagesAdded`. Empty for the other formats. |

`findTransparency(pdfBytes)` returns the same `transparency` list for any PDF, without Ghostscript. It is the question to ask before choosing a format.

## How a colour is chosen

Every vector colour goes through four rules, in this order. The first rule that applies wins.

1. **Colour table.** The colour matches an entry of the table. The entry's inks are used exactly as written.
2. **White.** Pure white gets no ink at all.
3. **Grey.** Any other grey gets the underlay, and a black that prints the same lightness as the grey.
4. **Profile.** Everything else goes through the ICC profile.

The black ramp works like this. The tool measures what each strength of black prints through the profile, and then gives a grey the black that prints the same lightness. So a grey prints at the lightness it had, and it is made of black alone.

Images are not sorted by these rules. Every pixel of an image goes through the profile.

Shadows are a special case, and not an RGB one. Chromium draws a `box-shadow` or a `text-shadow` through a luminosity soft mask, which is a grey picture of how opaque the shadow is at each point. The colours in that picture are opacity, not ink, so they do not go through the profile. Each becomes the grey of the same luminosity, 0.3 R + 0.59 G + 0.11 B, which is how PDF reads an RGB colour in such a mask, and its images go the same way. The shadow is exactly as dark as it was, and nothing in it is left in RGB.

## Underlay

Nobody notices a hairline of bare paper until the printer shows it to them, and then everybody does.

Black text on a tinted page sits on a colour that is not black. If the tint is knocked out under the letters, a misregistered plate leaves a hairline of bare paper around each letter. Keeping a little cyan, magenta and yellow under the black hides that hairline.

```sh
open-press poster.html poster.pdf --profile printer.icc --underlay 3,2,2
```

The underlay goes under every grey and black. White never gets any, so the paper stays clean. Values such as `3,2,2` or `8,0,2` are examples only. Ask your printer what they want. A black listed in a colour table gets none; see [The colour table](#the-colour-table).

## The colour table

A colour table lets you say exactly what a colour should print as. The table is yours to write. The package ships one preset, `classic`, to show the form.

A table is a JSON array. Each entry has a `name`, a `hex` colour and `cmyk` in percent:

```json
[
  { "name": "Text black", "hex": "#000000", "cmyk": [0, 0, 0, 100] }
]
```

The preset `classic` is this file, copied in full:

```json
[
  { "name": "Text black", "hex": "#000000", "cmyk": [0, 0, 0, 100] },
  { "name": "Paper white", "hex": "#FFFFFF", "cmyk": [0, 0, 0, 0] },
  { "name": "Rich black for large type", "hex": "#0A0A0A", "cmyk": [60, 40, 40, 100] },
  { "name": "Process cyan", "hex": "#00AEEF", "cmyk": [100, 0, 0, 0] }
]
```

Use it with `--colours classic`, or your own table with `--colours my-table.json`.

A table entry wins over every other rule, and its inks are printed exactly as written. That has one consequence to know about. Black text listed in a table, as `#000000` is in `classic`, gets no underlay. If you want the underlay under your black text, leave `#000000` out of your table.

A colour matches an entry when each channel is within 1.5 levels of the entry's hex value, channel by channel. The table applies to text, shapes and the ends of gradients. It does not apply to the pixels inside images.

## Limits

Every tool has a list of things it will not do. This is ours, and it is shorter than most.

- Flate images and vector colours are read as sRGB, whatever ICC profile their colour space names. A JPEG with its own embedded profile is converted using that profile. Flat graphics inside an image are not matched against the colour table.
- A form or pattern with no `/Resources` of its own, which borrows the page's, is not followed for named colour spaces.
- Converted images are stored as lossless raw CMYK. The files are larger than the JPEGs they came from.
- Gradients are converted at their ends, and the ink between the ends is interpolated.
- Shadings that are not blends between two colours, such as conic gradients, mesh shadings and shadings with a background, are left in RGB and reported. Inline images are left and reported too.
- Colour space state is tracked within one content stream, not across the several streams a page may have.
- For PDF/X-1a and PDF/X-3, a page that uses transparency becomes one image, text included. See [Output formats](#output-formats).
- Only an `@page` rule without a selector sets the exact size. A page sized by `@page :first` or by a named page keeps Chromium's rounding, which is up to about 0.6 pt. A size written with `var()`, or with a relative unit such as `em`, inside `calc()` or not, is not read either, and keeps Chromium's rounding. A `calc()` of absolute units, such as `calc(148mm + 6mm)`, is read.
- When the page links a stylesheet that cannot be read a second time, such as one on a site that has gone away, or one that imports another, the page keeps Chromium's rounding as well, and `--bleed` is not added to a page that names no size.
- The resolution is measured for images drawn on the page and in forms, not for images in patterns, such as a tiled CSS background.
- A gradient inside a soft mask is converted to CMYK like any other, so its opacity follows the profile rather than the luminosity.
- The file is PDF/X-4, PDF/X-1a or PDF/X-3 in structure, but it is not a certificate. The printer's preflight has the last word.

## What it writes into your files

Every PDF names the program that made it, as all PDF software does. Open Press writes itself as the Producer, in the document information and in the XMP metadata: `Marmalade Open Press <version> (https://marmalade.family)`. A page drawn by `render` also names it as the Creator, next to Chromium: `Marmalade Open Press <version>, with Chromium`. A PDF that you give to `convert` keeps its own Creator. A TIFF page names it in its Software tag, next to Ghostscript.

That is all. There is no mark on the page, no tracking and no network request of its own: the only thing fetched is the page you ask it to open, with whatever that page loads. The lines are yours to change, and we would be glad if you left them.

## Licence

MIT. Copyright 2026 East Hill. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

If you copy, fork or vendor the code, a line in your README is welcome, though the licence does not ask for it:

> Includes Marmalade Open Press, made by Marmalade (https://marmalade.family).

If you cite it in a paper or a post, [CITATION.cff](CITATION.cff) has the details.

---

Made by [Marmalade](https://marmalade.family), which turns a family's week into a printed magazine.
