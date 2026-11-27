# Marmalade Open Press

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

Marmalade turns a family's week into a printed magazine.

Marmalade Open Press takes an HTML page and returns a print-ready CMYK PDF/X-4, with greys and blacks on the black plate alone.

Marmalade prints from the web. This is the part of the kitchen we were happy to open to the public.

## A review

A browser prints in red, green and blue, which suits a screen and ruins a press. A screen mixes light. A press mixes ink, and ink is the more expensive opinion. Send a browser's RGB PDF to a printer and the printer's machine has to guess what you meant, and it usually guesses in favour of more ink.

The worst offence is grey text printed in four colours when black would do. A grey built from cyan, magenta, yellow and black has four plates to go wrong instead of one. When the plates drift, and they always drift a little, the letters grow a fuzzy halo, like a photocopy that has been on holiday. Then there is black text on a tinted page. Knock the tint out from under the letters and, when the plates move by a fraction of a millimetre, a hairline of bare paper shows around every letter. Nobody ordered that white outline. It is still there.

This tool is the kitchen that gets it right. It prints the page with Chromium, converts every colour through the printer's ICC profile, and sends greys and blacks to the black plate, with a little cyan, magenta and yellow underneath if you ask for it. It does not improvise. With --check it prints a report at the end that says what it could not manage, which is more than most kitchens will admit to.

Verdict, grudgingly: approve. Put the napkin down. The rest is the manual.

## The plates

All the text is on the black plate.

![The black plate](docs/images/plate-black.png)

On the cyan, magenta and yellow plates only the page tint and the orange word are left.

![The cyan, magenta and yellow plates](docs/images/plate-cmy.png)

Both pictures are the same crop of the example poster. They are made by `node scripts/separations.js`, which needs Ghostscript (`gs`) on the path.

## Install

You need Node 22. Then, from a terminal:

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
| `--bleed <mm>` | Bleed on every side, already part of the page size. Sets the TrimBox. Default `0`. |
| `--check` | Prints a report of what was converted. |
| `--version` | Prints the version. |
| `--help` | Prints the usage. |

Exit codes:

- `0`: done.
- `1`: with `--check`, RGB is left in the file.
- `2`: wrong usage, or the conversion failed.

The example poster builds with `npm run example`. These are the lines the tool printed, without npm's own header:

```
No profile given, so a stand-in CMYK profile was used. Ask your printer for theirs and pass it with --profile.
Wrote examples/poster.pdf.
Profile: Chemical proof (stand-in)
Vector colours converted: 24 (20 neutral, 0 from the colour table)
Images converted: 3
Maximum total ink: 224%
RGB left: none
```

The page size comes from the page's own CSS (`@page { size: ... }`). A page that names no size is printed on A5.

`examples/back-cover.html` is a Marmalade back cover: the wordmark in the middle, "Printed in Devon" underneath, and no `@page` rule, so it comes out on A5. The wordmark is an SVG and stays a vector, so it is as sharp at any size as the press can make it.

```sh
open-press examples/back-cover.html examples/back-cover.pdf --check
```

Both example PDFs are in `examples/`, built with the stand-in profile.

Without `--profile` the tool uses the built-in `cmyk` profile as a stand-in, and it says so on every run. The printer's own profile is the one that counts. Ask for it, then pass it with `--profile`.

## Library

The package has two layers, and each works alone.

- `render` takes an HTML file path, a URL or HTML markup, and returns an RGB PDF drawn by Chromium.
- `convert` takes any RGB PDF, from any source, and returns a CMYK PDF/X-4 and a report.

```js
import { render, convert, loadColourTable } from 'marmalade-open-press';

const rgb = await render('poster.html');
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
| `bleed` | millimetres | `0` |

The returned `report` has these fields:

| Field | Meaning |
|---|---|
| `profile` | The output profile's name. |
| `standIn` | `true` when the stand-in profile was used. |
| `vectors` | Vector colours converted, by any rule. |
| `neutrals` | Of those, greys, black and white. |
| `tableHits` | Of those, colours taken from the colour table. |
| `images` | Images converted. |
| `maxInk` | The heaviest total ink met, in percent, across vectors and image pixels. |
| `left` | Items left as they were. Each has `what` and `rgb`, and `rgb` is `true` when the item still holds RGB. |

`loadColourTable(nameOrPath)` returns a checked table from a preset name such as `classic`, or from a JSON file.

## How a colour is chosen

Every vector colour goes through four rules, in this order. The first rule that applies wins.

1. **Colour table.** The colour matches an entry of the table. The entry's inks are used exactly as written.
2. **White.** Pure white gets no ink at all.
3. **Grey.** Any other grey gets the underlay, and a black that prints the same lightness as the grey.
4. **Profile.** Everything else goes through the ICC profile.

The black ramp works like this. The tool measures what each strength of black prints through the profile, and then gives a grey the black that prints the same lightness. So a grey prints at the lightness it had, and it is made of black alone.

Images are not sorted by these rules. Every pixel of an image goes through the profile.

## Underlay

Nobody notices a hairline of bare paper until the printer shows it to them, and then everybody does.

Black text on a tinted page sits on a colour that is not black. If the tint is knocked out under the letters, a misregistered plate leaves a hairline of bare paper around each letter. Keeping a little cyan, magenta and yellow under the black hides that hairline.

```sh
open-press poster.html poster.pdf --profile printer.icc --underlay 3,2,2
```

The underlay goes under every grey and black. White never gets any, so the paper stays clean. Values such as `3,2,2` or `8,0,2` are examples only. Ask your printer what they want. Black entries in a colour table get no underlay, and the classic preset lists #000000, so remove that entry if you want the underlay under your text black.

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
- The file is PDF/X-4 in structure, but it is not a certificate. The printer's preflight has the last word.

## Licence

MIT. Copyright 2026 East Hill. See [LICENSE](LICENSE).

Made by [Marmalade](https://marmalade.family).
