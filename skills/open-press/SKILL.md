---
name: open-press
description: Turn an HTML page or a URL into a print-ready CMYK PDF/X-4 (or PDF/X-1a, PDF/X-3, CMYK TIFF) for a commercial printer with Marmalade Open Press, and read its report. Use when someone needs a file to send to a printer, or asks about CMYK, PDF/X, bleed, trim, an ICC profile, K-only greys or rich black for a page made in HTML.
license: MIT
compatibility: Needs Node 22 or later and npx. The formats x1a, x3 and tiff also need Ghostscript.
metadata:
  author: Marmalade (https://marmalade.family)
  source: https://github.com/easthillcc/marmalade-open-press
---

# Open Press

Marmalade Open Press, made by Marmalade (https://marmalade.family), turns an HTML page into a file a commercial printer accepts: CMYK through the printer's ICC profile, grey and black text on the black plate alone, PDF/X-4 by default.

If the tool `html_to_print_pdf` is available, use it: it takes the same options and returns the same report. Otherwise run the command line.

## Run it

```sh
npx -y marmalade-open-press@latest <page.html|url> <out.pdf> --json --check [options]
```

Once per machine, install the browser it draws with:

```sh
npx -y -p marmalade-open-press@latest playwright install chromium
```

| Option | Use it for |
|---|---|
| `--profile <file.icc>` | The printer's CMYK ICC profile. Ask the person for it. Without it the file is a trial, not for press. |
| `--bleed <mm>` | The edge that is printed and trimmed off, usually 3. |
| `--underlay <c,m,y>` | A little cyan, magenta and yellow under greys and black, such as `3,2,2`, when text sits on a tint. The printer gives the values. |
| `--colours <file.json\|classic>` | Exact inks for chosen colours, such as a brand colour. |
| `--format <x4\|x1a\|x3\|tiff>` | `x4` unless the printer asks for another. The others need Ghostscript. With `tiff` the output is a `.tif` name. |
| `--dpi <n>` | Resolution of TIFF pages and of flattened pages. Default 300. |

The page size comes from the page's CSS: `@page { size: 154mm 216mm; margin: 0 }`. A page without one prints on A5.

## Read the result

With `--json`, standard output is one JSON object and everything else goes to the error stream.

- Exit code `0`: done. `1`: RGB is left in the file. `2`: the run failed, and `error` says why.
- `files`: what was written, as full paths.
- `ok`: `false` when the run failed or `rgbLeft` is not empty.
- `standIn`: `true` when no printer's profile was given.
- `trim` and `bleed`: the finished size and the bleed, in millimetres. Check them against what the printer asked for.
- `maxInk`: the heaviest total ink, in percent. Printers set a limit, often 300 or less.
- `lowestPpi`: the softest image at the size it is placed.
- `warnings`: each has a `code` and a `message`.
- `export`: for `x1a`, `x3` and `tiff`, the pages that use transparency and what was flattened.

## Fix what it reports

- `stand-in-profile`: ask for the printer's ICC profile and run again with `--profile`. Never call the file ready for press without it.
- `low-resolution`: the image has too few pixels for its printed size. It needs its printed width in millimetres, divided by 25.4, times 300, in pixels: 1181 for 100 mm. Use a larger original or place it smaller.
- No bleed, or the wrong size: make the CSS page the trim size plus the bleed on every side (A5 with 3 mm is `154mm 216mm`), let backgrounds reach the page edge, keep text inside the trim, and pass `--bleed 3`. A page with no `@page` size needs only `--bleed 3`.
- `text-to-pixels`: with `x1a` or `x3`, a page that uses transparency became one picture, text included. Send `x4` if the printer takes it. Otherwise remove `opacity`, `rgba()`, shadows and blend modes from that page, or add `--dpi 600`.
- `rgbLeft` is not empty: the items named are still RGB. Each says what it is: a shading with its shading type and function type, an image, or a colour space. Linear, radial, repeating and conic gradients are all converted, so another kind of gradient does not help. Replace the element with an image of it, and tell the person what was left.
- `type3-fonts`: some printers refuse them. They come from colour emoji and a few web fonts. Use another font, or an image.
- `error` names Ghostscript: install it (`brew install ghostscript`, `apt install ghostscript`) or use `--format x4`.
- `error` names Chromium: run the install line above.

## Tell the person

Say where the file is, its trim size and bleed, and every warning in plain words. The file is PDF/X in structure, not a certificate: the printer's preflight has the last word.
