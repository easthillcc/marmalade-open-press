# Output formats

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

The tool writes four formats. One is the house dish; the other three are for printers who still order from the old menu. This page says which to choose and what each file contains. The README has the options; this is the wine list.

## Which one to send

| The printer asks for | Use | Needs Ghostscript |
|---|---|---|
| "PDF/X-4", "a modern PDF/X", or nothing in particular | `--format x4` (the default) | No |
| "PDF/X-1a", "X-1a:2001", "flattened PDF", "no transparency" | `--format x1a` | Yes |
| "PDF/X-3", "X-3:2002" | `--format x3` | Yes |
| "TIFF", "CMYK images", "one file per page", a raster workflow | `--format tiff` | Yes |

If the printer accepts PDF/X-4, send PDF/X-4. Every other format is made from it and can only lose something on the way.

Every format but `x4` is written by Ghostscript. Tested with Ghostscript 10.06; older versions may flatten differently.

## PDF/X-4 (`x4`)

The format of record. `convert` writes it directly, with pdf-lib, and nothing else needs to be installed.

- PDF 1.6. Transparency is allowed and is left alone, so a CSS `opacity` or `box-shadow` survives as it was drawn.
- Every colour is CMYK. Greys and black are on the black plate alone, plus the underlay if you asked for one.
- One output intent, `GTS_PDFX`, with the printer's ICC profile embedded and its name as the output condition.
- An XMP packet that says `PDF/X-4`, matching the Info dictionary, plus a trailer ID and `Trapped` set to `False`.
- On every page a `BleedBox` equal to the page, and a `TrimBox` inset by `--bleed` on every side.
- The title, creator and creation date of the page are kept.

## PDF/X-1a:2001 (`x1a`)

The oldest dish still served, and the one most print shops will accept without asking questions.

- PDF 1.3, CMYK only, no transparency. Ghostscript (`pdfwrite`, `-dPDFX=1`) rewrites the PDF/X-4 and flattens it.
- The CMYK values go through unchanged, because the same profile is given to Ghostscript on both sides. A black that was on the black plate stays there. Values may move by up to a tenth of a percent through rounding.
- Images are kept lossless (Flate) and are not resampled.
- The tool then puts back what Ghostscript drops or changes: the trim and bleed boxes, the output intent with the profile, the title and dates, a trailer ID, and the Info keys `GTS_PDFXVersion` (`PDF/X-1:2001`) and `GTS_PDFXConformance` (`PDF/X-1a:2001`). There is no XMP packet, which the standard does not ask for.
- Links are removed, because the standard refuses printable annotations in the trim area.

## PDF/X-3:2002 (`x3`)

The same file as `x1a` with a different label: `GTS_PDFXVersion` is `PDF/X-3:2002` and there is no conformance key. PDF/X-3 would permit colours tagged with their own ICC profiles, but everything this tool writes is already plain CMYK, so there is nothing to tag. Choose it when the printer's preflight profile says X-3.

## CMYK TIFF (`tiff`)

For raster workflows and printers who want pictures, not PDFs.

- One file per page, named `name-1.tif`, `name-2.tif` and so on, even for one page.
- Four inks, 8 bits each, LZW compressed, the output profile embedded. Drawn by Ghostscript's `tiff32nc` device at `--dpi` (300 by default).
- The edges of letters are smoothed. The edges of shapes are not, because smoothing leaves a pale seam where two shapes meet, and a press prints that seam faithfully.
- The page is the whole page including bleed. A TIFF has no trim box, so tell the printer the trim size.
- Each page names this tool in its Software tag, next to Ghostscript. The pixels and the profile are as Ghostscript wrote them.

## Transparency, the one real cost

PDF 1.3 cannot carry transparency, so `x1a` and `x3` must flatten it. CSS makes transparency more often than people expect: an `opacity` below 1, an `rgba()` colour, a `box-shadow`, a `mix-blend-mode`. In the PDF these become opacity, blend modes, soft masks and transparency groups, and the report names them by those four kinds.

Ghostscript flattens a page that uses any of these by drawing the whole page as one image at `--dpi`, text included. Pages without transparency keep their text and vectors. `--check` lists, page by page, what was found and what became pixels, and `findTransparency(pdf)` gives the same answer from the library before you choose. The README's section on transparency has the order of preference; the short version is: send X-4, or keep transparency off pages with small type, or flatten at 600 dpi.

Which CSS produces which PDF construct is Chromium's decision and can change between versions. The report describes the file, not the stylesheet.

## What none of the formats are

A certificate. The files are PDF/X in structure, and the tests check the structure, but conformance is decided by the printer's preflight (Acrobat Preflight, callas pdfToolbox, PitStop and their peers). If a preflight complains, please open an issue with its report.
