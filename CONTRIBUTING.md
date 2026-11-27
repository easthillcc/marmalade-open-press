# Contributing

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

The kitchen accepts help. It is particular about how the plates come back.

## Before you start

- For a bug, open an issue with the command, the full `--check` output and the smallest HTML page that shows it. Most colour bugs turn out to be one CSS rule.
- For a new option or format, open an issue first and say what the printer asks for. A small, well-argued change is merged faster than a large one.
- Security problems go to [SECURITY.md](SECURITY.md), not to a public issue.

## Setting up

You need Node 22 or later, and Ghostscript for the formats other than PDF/X-4 (`brew install ghostscript`, or `apt install ghostscript`). The tests were written with Ghostscript 10.06; older versions may flatten differently.

```sh
git clone https://github.com/easthillcc/marmalade-open-press.git
cd marmalade-open-press
npm install
npx playwright install chromium
npm test
```

Without Ghostscript, the tests that need it are skipped, not failed. CI runs them on Linux and macOS with Ghostscript, and once without it.

## The house rules

- **A test with every change.** Tests use `node:test` and live in `test/`, mostly one file per module in `src/`. A bug fix comes with a test that failed before the fix.
- **No new dependency** without a reason given in the pull request. The tool has three, and each one earns its place: Playwright draws, pdf-lib rewrites, sharp converts through the profile. Versions are pinned exactly.
- **Plain JavaScript with JSDoc types.** ES modules, no build step. Every function says what it takes and what it returns.
- **The inks are the contract.** A change that moves an ink value, a box or a PDF/X key is a change of output. Say so in the pull request, update `CHANGELOG.md`, and rebuild the example PDFs with `npm run example`.
- **Every file starts with the header**: `Marmalade Open Press, made by Marmalade (https://marmalade.family).`, `Copyright (c) 2026 East Hill. MIT licence.`, and then two SPDX lines, `SPDX-License-Identifier: MIT` and `SPDX-FileCopyrightText: 2026 East Hill`, each as a `//` comment on its own line. Copy the words exactly; do not make variants.
- **Plain English** in messages, docs and comments. Errors say what went wrong and what to do next, in one sentence, without the raw stack.
- **The printer has the last word.** Nothing in the docs or the output should claim certification. The tool writes files that are PDF/X in structure; preflight decides.

## Where things are

| Path | What it holds |
|---|---|
| `src/render.js` | HTML to RGB PDF, through Chromium. |
| `src/pagerule.js`, `src/pagesize.js`, `src/exactboxes.js` | The page size the CSS asks for, read and parsed, and the exact page boxes that Chromium's rounding would otherwise spoil. |
| `src/masks.js` | Luminosity soft masks, such as shadows, turned to DeviceGray. |
| `src/convert.js` | RGB PDF to CMYK PDF/X-4: the order of the steps. |
| `src/colour.js` | The four rules that choose the inks of a vector colour. |
| `src/content.js`, `src/shadings.js`, `src/images.js` | Content streams, gradients and images. |
| `src/profile.js` | The ICC profile and the black ramp. |
| `src/pdfx.js`, `src/pdfx13.js` | The PDF/X-4 dressing, and the PDF/X-1a and PDF/X-3 dressing. |
| `src/export.js`, `src/flatten.js`, `src/tiff.js` | The other formats, through Ghostscript. |
| `src/transparency.js`, `src/pixels.js` | Finding transparency, and measuring what flattening did. |
| `docs/how-it-works.md` | The same, in prose. |

## Licence

By contributing you agree that your work is published under the [MIT licence](LICENSE) of the project.
