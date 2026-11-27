# How it compares

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

There are many good ways to turn HTML into a PDF. Very few of them produce a file a commercial printer will take without converting it again. This page sets out where Open Press fits, what it does that the others do not, and what they do better. A critic who only reviews his own restaurant is not a critic.

Facts about other tools were checked against their own documentation on 2026-11-27, with links. Tools change; if something here is out of date, please open an issue or a pull request.

## The short version

Open Press is a small, MIT-licensed Node tool that takes the HTML you already have, rendered by Chromium, and makes a CMYK PDF/X-4 through the printer's ICC profile, with greys and blacks on the black plate alone. It is not a typesetting engine. If you need footnotes, running heads, cross-references or advanced CSS Paged Media, use a paged media engine (Prince, WeasyPrint, Vivliostyle, Paged.js) to lay out the page, and if that engine writes RGB, give its PDF to `convert`.

## At a glance

| | Renders with | CMYK from ordinary CSS colours | Greys on black only | PDF/X | Licence |
|---|---|---|---|---|---|
| **Marmalade Open Press** | Chromium (Playwright) | Yes, every RGB colour and image through the ICC profile | Yes, matched to lightness, with an optional CMY underlay | X-4; X-1a, X-3 and CMYK TIFF with Ghostscript | MIT |
| [Prince](https://www.princexml.com/doc/graphics/) | Its own engine | Yes, with `--convert-colors` and an output intent | Yes, by default (`use-true-black`) | X-1a, X-3, X-4, X-4p | Commercial; free for non-commercial use, with a logo on the first page |
| [DocRaptor](https://docraptor.com/documentation/article/2038025-cmyk-colors) | Prince, as a hosted API | Converted when the PDF/X-1a profile is set | As Prince | X-1a documented | Commercial service |
| [WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html) | Its own engine (Python) | Colours you write as `device-cmyk()` | Not documented | X-1a, X-3, X-4, X-5g variants (since 67.0) | BSD |
| [Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli) | Chromium | `device-cmyk()` colours, a map of RGB to CMYK, and a fallback conversion (built-in or ICC) | Possible through the map or a grey conversion | X-4 labelling; X-1a through press-ready (deprecated) | AGPL-3.0 |
| [Paged.js](https://pagedjs.org) | The browser it runs in | No: the browser prints RGB | No | No | MIT |
| Puppeteer, Playwright `page.pdf()` | Chromium | No: `page.pdf()` has no colour option | No | No | Apache-2.0 |
| [PDFShift](https://docs.pdfshift.io/api-reference/convert-to-pdf.md) | Chromium, as a hosted API | Not in its documented options | No | Not in its documented options | Commercial service |
| [wkhtmltopdf](https://github.com/wkhtmltopdf/wkhtmltopdf) | QtWebKit | No | No | No | LGPL-3.0; repository archived in January 2023 |
| [Ghostscript](https://ghostscript.readthedocs.io/en/latest/VectorDevices.html) | Does not read HTML | Converts a PDF's colours to CMYK | No per-object rule: "all objects are converted using the same scheme" | X-1 and X-3 (`-dPDFX`); its docs disagree about X-4 | AGPL, or commercial from Artifex |

## What Open Press does that the others do not

- **Open source, CMYK, and no change to your HTML.** Prince and DocRaptor do this well and are commercial. WeasyPrint and Vivliostyle are open, and ask you to write the colours as `device-cmyk()` or to map each one. Open Press converts the `#333` and `rgb()` you already have, and the images too, through the printer's profile.
- **Greys matched to lightness on the black plate.** A grey is given the strength of black that prints the same L\* through the profile, so it looks as light as on screen and uses one plate. Prince also sends true greys to K; most other routes put them on four plates.
- **A controlled underlay.** `--underlay 3,2,2` puts a fixed amount of cyan, magenta and yellow under every grey and black, which keeps black text on a tint from showing a white hairline when the plates drift. White never gets any.
- **A colour table.** Exact inks for chosen hex values, so a brand colour prints as the brand book says, while your CSS stays in RGB.
- **A report that admits things.** `--check` counts what was converted, lists what was left in RGB and why, gives the heaviest total ink, says page by page what was flattened for X-1a and X-3, and exits with 1 when RGB is left, so a build can stop before a printer does.
- **Two layers that work alone.** `convert` takes any RGB PDF, whoever drew it. You can keep Puppeteer, Paged.js or a browser print and only borrow the colour step.

## What the others do better

- **Page layout.** Prince, WeasyPrint and Vivliostyle implement CSS Paged Media far beyond what Chromium prints: running headers and footers, page counters, footnotes, cross-references, named pages. Paged.js brings much of that to the browser. Open Press inherits Chromium's support and adds nothing to it.
- **Colour features.** Prince supports spot colours and overprint, and `device-cmyk()` in CSS; WeasyPrint and Vivliostyle support `device-cmyk()` too. Open Press has no spot colours, no overprint control and no CSS colour syntax of its own. Its colour table maps RGB to process inks only.
- **Maturity.** Prince, WeasyPrint, Ghostscript and Puppeteer have years of production use and large communities. Open Press is new.
- **Hosting.** PDFShift and DocRaptor are APIs: nothing to install, no Chromium to keep up to date. Open Press runs where you run it.
- **Speed and size.** Puppeteer or Playwright alone is faster and gives smaller files. Open Press stores converted images as lossless CMYK, which is larger than the JPEGs they came from.
- **Breadth of PDF work.** Ghostscript does far more than colour: rasterising, repairing, merging, separations, PostScript. Open Press uses it as a back end for the older formats and does not try to replace it.
- **No browser needed.** WeasyPrint and Prince do not need a browser on the machine. Open Press needs Chromium, through Playwright.

## When to choose what

| You need | A good choice |
|---|---|
| A CMYK PDF/X from web pages you already have, open source | Open Press |
| Books, reports or long documents with footnotes and running heads, in CMYK | Prince, or WeasyPrint or Vivliostyle with `device-cmyk()` colours |
| Spot colours or overprint | Prince |
| A hosted API and no installation | DocRaptor for print, PDFShift for screen |
| A screen PDF, fast | Puppeteer or Playwright `page.pdf()` |
| To repair, rasterise or convert an existing PDF | Ghostscript |
| Paged layout in the browser, then CMYK | Paged.js to lay out, then `convert` |
