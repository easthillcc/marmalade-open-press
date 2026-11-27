# Recipes

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

Short answers to the questions people arrive with. Each assumes `open-press` from a clone (see the README's Install section); replace `printer.icc` with your printer's profile.

## HTML to a CMYK PDF/X-4 for a printer

```sh
open-press flyer.html flyer.pdf --profile printer.icc --check
```

Without `--profile` a stand-in profile is used and the tool says so on every run. The stand-in is fine for trying things; send nothing to press without the printer's own profile.

## A page with bleed

Make the CSS page size the trim size plus the bleed on both sides, and pass the bleed so the tool can set the trim box. An A5 page (148 x 210 mm) with 3 mm bleed:

```css
@page { size: 154mm 216mm; margin: 0; }
```

```sh
open-press flyer.html flyer.pdf --profile printer.icc --bleed 3
```

Backgrounds and pictures that should bleed must reach the edge of the CSS page. Keep text at least the printer's safe margin inside the trim.

A page with no `@page` size needs no CSS for this: `--bleed 3` prints it on A5 plus 3 mm on every side, and the trim is A5.

## Grey text on one plate (K-only text)

Nothing to do: greys and black go to the black plate by default. To see it for yourself, separate the plates with Ghostscript and look at the cyan one:

```sh
gs -q -dNOPAUSE -dBATCH -sDEVICE=tiffsep -r150 -sOutputFile=plate.tif flyer.pdf
```

This writes `plate(Cyan).tif`, `plate(Magenta).tif`, `plate(Yellow).tif` and `plate(Black).tif`. The text should be on the last one only.

## Rich black, or text on a tinted background

Add an underlay: a little cyan, magenta and yellow under every grey and black, so a plate that drifts does not show bare paper around letters on a tint.

```sh
open-press flyer.html flyer.pdf --profile printer.icc --underlay 3,2,2
```

Ask the printer for the values. For large black areas that should look deep rather than grey, give the colour its own inks in a colour table:

```json
[{ "name": "Rich black", "hex": "#0A0A0A", "cmyk": [60, 40, 40, 100] }]
```

```sh
open-press poster.html poster.pdf --profile printer.icc --colours rich.json
```

Then use `#0A0A0A` in the CSS where you want rich black and `#000000` where you want plain black. Keep the total ink within the printer's limit; `--check` prints the heaviest total it met.

## Brand colours with exact inks

The brand book says the orange is 0/60/100/0. Write it in a colour table against the hex the CSS uses, and that exact ink is printed, whatever the profile thinks:

```json
[{ "name": "Brand orange", "hex": "#F07D00", "cmyk": [0, 60, 100, 0] }]
```

The table applies to text, shapes and gradient ends, not to pixels inside images.

## The printer wants PDF/X-1a

Install Ghostscript, then:

```sh
open-press flyer.html flyer.pdf --profile printer.icc --format x1a --check
```

If `--check` says text turned to pixels, a page uses transparency. Remove `opacity`, `rgba()`, shadows and blend modes from that page, or add `--dpi 600`. [Output formats](output-formats.md) explains why.

## The printer wants CMYK TIFF

```sh
open-press flyer.html flyer.tif --profile printer.icc --format tiff --dpi 600
```

Pages are written as `flyer-1.tif`, `flyer-2.tif` and so on.

## Convert a PDF from Puppeteer, Playwright or Chrome

`convert` takes any RGB PDF, so you can keep the renderer you have:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { convert } from 'marmalade-open-press';

const rgb = await readFile('from-puppeteer.pdf');
const { pdf, report } = await convert(rgb, { profile: 'printer.icc', bleed: 3 });
await writeFile('print.pdf', pdf);
if (report.left.some((item) => item.rgb)) throw new Error('RGB left in print.pdf');
```

## Render from a URL or a string

```sh
open-press http://localhost:3000/print print.pdf --profile printer.icc
```

```js
import { render, convert } from 'marmalade-open-press';

const rgb = await render('<!doctype html><style>@page { size: 105mm 148mm }</style><h1>Hello</h1>');
const { pdf } = await convert(rgb, { profile: 'printer.icc' });
```

`render` waits until the network is idle, so web fonts and images arrive before the page is printed.

## Stop a build when RGB is left

`--check` exits with 1 when anything is still RGB, so it works as a gate in CI or a Makefile:

```sh
open-press page.html page.pdf --profile printer.icc --check || exit 1
```

## Where to get a profile

From the printer. Most publish the profile their press is calibrated to, often a standard one such as a FOGRA or GRACoL characterisation for coated or uncoated paper. If they cannot name one, ask which paper the job is printed on and which standard they print to.
