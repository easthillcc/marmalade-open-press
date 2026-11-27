# Changelog

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

## 1.1.0

For those who print with an assistant at their elbow.

- `--json` prints the whole report as one JSON object on standard output, with or without `--check`. The lines for a person move to the error stream. A run that fails prints a JSON object too, with its `error`. The exit codes are as before.
- The JSON adds to the report: `ok`, `exitCode`, `format`, `files` as absolute paths, `rgbLeft`, and `warnings` as a code and a message each. The codes are `stand-in-profile`, `low-resolution`, `type3-fonts` and `text-to-pixels`.
- `open-press mcp` is a Model Context Protocol server on standard input and output, with one tool, `html_to_print_pdf`. It takes the options of the command line and returns the JSON report. It is written on Node's own modules, so the package has no new dependency.
- `skills/open-press` is an Agent Skill for an assistant that uses the command line: when to use the tool, how to run it with `npx`, how to read the report and how to mend what it finds. It is in the npm package, and the README has the lines that copy it into place from there, with no clone and nothing installed.
- `server.json`, and `mcpName` in package.json, describe the server for the MCP Registry.
- When Chromium is not installed, one plain line says so and how to install it, in place of Playwright's box. The exit code is 2, as before.
- README: "Use it with an AI assistant", with the lines for Claude Code, Codex, Claude Desktop and Gemini CLI, and "The report as JSON". New page: `docs/assistants.md`. Two recipes.
- Repeating linear and radial gradients, conic gradients, and SVG gradients that repeat or reflect are converted to CMYK. They were left in RGB. Chromium writes them as small PostScript programs: each colour stop now goes through the same rules as any other colour, and the ink between two stops is interpolated, as for a linear gradient.
- A shading still left in RGB is reported with its shading type and function type, and why, such as `shading of type 2, function of type 0: sampled functions are not converted`.
- Apart from those gradients, the files it writes are as they were: no ink, box or PDF/X key has moved.

## 1.0.1

Other output formats, for printers who ask for something older than PDF/X-4.

- `--format x1a` writes PDF/X-1a:2001 and `--format x3` writes PDF/X-3:2002. Both are PDF 1.3, with transparency flattened.
- `--format tiff` writes one CMYK TIFF per page, with the output profile embedded.
- `--dpi` sets the resolution of TIFF pages and of flattened pages. The default is 300.
- These three formats need Ghostscript on the machine. PDF/X-4 is still the default, needs nothing more, and is written as before.
- With `--check`, the report says which pages use transparency, which pages were flattened to pixels, and where text became pixels.
- Library: `exportAs`, `findTransparency` and `FORMATS`.
- Known limit: for PDF/X-1a and PDF/X-3, a page that uses transparency becomes one image, text included. Pages without transparency keep their text and vectors.

Fixes from a first run by someone who reads page boxes for a living:

- The PDF has the exact page size the CSS asks for. Chromium rounds a page size to whole points, so a page of 154 mm came out 154.18 mm wide, and the trim box was off with it. The media box is now set to the size asked for. The content is moved, never scaled, so it keeps its place from the top-left corner, which is where Chromium draws it from.
- The page background reaches the edge of the exact page. Chromium paints it only as far as a whole number of CSS pixels, which left an unprinted strip of up to 0.13 mm on the right or bottom; the same colour is now laid under the page out to its edge.
- A page that names no size is ISO A5 exactly, 419.528 x 595.276 pt. It was 420 x 595.92.
- With `--bleed`, a page that names no size is printed on A5 plus the bleed on every side, and trims to A5. A page with its own size keeps it, as before: its bleed is already part of it.
- `--check` gives the trim size and the bleed in millimetres, and the lowest image resolution at placed size. It warns of an image below 300 ppi, of Type 3 fonts, which some printers refuse, and of the stand-in profile. Warnings never change the exit code.
- Without `--profile`, the output intent names its profile as a stand-in, not for press.
- A shadow is no longer RGB left. Chromium draws a `box-shadow` or a `text-shadow` through a luminosity soft mask. Its colours and images now become greys of the same luminosity, so the shadow is exactly as dark as it was, and `--check` exits with 0.
- An unknown option gets one plain line and exit code 2, not Node's message followed by the whole help. A negative `--bleed` or `--underlay` reaches the check that explains it.
- `package-lock.json` carries the package's own name and version.
- The Type 3 warning names the font, such as CAAAAA+AppleColorEmoji, from its descriptor when the font has no other name.
- Library: `render(input, { bleed })`. The report of `convert` has `trim`, `bleed`, `lowestPpi` and `type3Fonts`.

Attribution and packaging:

- A page drawn by `render` names Open Press as its Creator, next to Chromium: `Marmalade Open Press <version>, with Chromium`. `convert` copies the Creator into the XMP as `xmp:CreatorTool`. A PDF given to `convert` keeps its own Creator.
- A TIFF page names Open Press in its Software tag, next to Ghostscript: `Marmalade Open Press <version> (https://marmalade.family), with Ghostscript <version>`. The pixels and the profile are as they were.
- `--help` ends with who made the tool and where to send issues.
- Every source file carries SPDX licence lines under its header.
- NOTICE and CHANGELOG.md are in the npm package. package.json has `bugs`, and more keywords.
- README: the opening says what the tool is, a short account of why Marmalade made it, what the tool writes into the files it makes, and the Ghostscript version everything was tested with, 10.06.

## 0.1.0

The first version.

- An HTML page becomes a print-ready CMYK PDF/X-4, drawn by Chromium and converted through the printer's ICC profile.
- Greys and blacks go to the black plate alone, with an underlay of cyan, magenta and yellow if asked for.
- A colour table gives exact inks to chosen colours.
- `--bleed` sets the trim box. `--check` reports what was converted, and exits with 1 if RGB is left.
- Library: `render`, `convert` and `loadColourTable`.
