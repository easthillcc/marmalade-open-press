# AI assistants

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

An assistant can run the press for you. There are three ways in, and they give the same file: an MCP server with one tool, a skill that teaches an assistant the command line, and `--json`, which any script can read. This page has the details; the README has the lines to copy.

## The MCP server

`open-press mcp` starts a Model Context Protocol server on standard input and output. A client starts it by itself, with this command:

```sh
npx -y marmalade-open-press@latest mcp
```

It speaks protocol version 2025-06-18, and the two before it. Standard output carries the protocol and nothing else. It has no dependency beyond those the tool already had.

Chromium has to be on the machine, as for the command line. Install it once:

```sh
npx -y -p marmalade-open-press@latest playwright install chromium
```

### The tool: `html_to_print_pdf`

| Argument | Type | What it is |
|---|---|---|
| `input` | string, required | The path of an HTML file, an http or https URL, or HTML markup, which is a string that starts with `<`. Markup has no folder of its own, so its images and stylesheets need absolute URLs or `data:` URIs. |
| `output` | string, required | Where to write the file. An absolute path, or one relative to the folder the server runs in. With `tiff`, a `.tif` name. A file already there is replaced. |
| `profile` | string | The path of the printer's CMYK ICC profile. Without it a stand-in is used, and the report says so. |
| `underlay` | three numbers | Percentages of cyan, magenta and yellow under every grey and black, such as `[3, 2, 2]`. |
| `colours` | string | A colour table: the preset `classic`, or the path of a JSON file. |
| `bleed` | number | The bleed in millimetres on every side. |
| `format` | `x4`, `x1a`, `x3` or `tiff` | The output format. Default `x4`. The others need Ghostscript. |
| `dpi` | number, 72 to 2400 | The resolution of TIFF pages and of flattened pages. Default 300. |

These are the options of the command line under the same names, and they are checked by the same code.

The result is the JSON report below, twice: as text, and as `structuredContent` for clients that read it. The tool always checks for RGB, so the result is marked `isError` when the run fails or when anything is left in RGB. An error is a result the assistant can read and act on. The server does not stop.

## The JSON report

`--json` prints one JSON object on standard output. Every other line goes to the error stream. The MCP tool returns the same object.

```sh
open-press poster.html poster.pdf --profile printer.icc --bleed 3 --json --check
```

| Field | Meaning |
|---|---|
| `tool`, `version` | `Marmalade Open Press` and the version that wrote the file. |
| `ok` | `true` when the run finished and nothing is left in RGB. |
| `exitCode` | The exit code of the run: `0`, `1` with `--check` when RGB is left, or `2` when the run failed. |
| `format` | `x4`, `x1a`, `x3` or `tiff`. |
| `files` | The files written, as absolute paths. One PDF, or one TIFF per page. |
| `profile`, `standIn` | The name of the output profile, and `true` when it is the stand-in. |
| `trim`, `bleed` | The finished size of the first page as `{ width, height }`, and the bleed, in millimetres. |
| `vectors`, `neutrals`, `tableHits` | Vector colours converted; of those, greys, black and white; of those, colours from the colour table. |
| `images` | Images converted. |
| `maxInk` | The heaviest total ink met, in percent. |
| `lowestPpi` | The image with the lowest resolution at its placed size, as `{ ppi, image, page }`, or `null` when no image is drawn. |
| `type3Fonts` | The names of the Type 3 fonts. |
| `left` | Everything left as it was. Each item has `what` and `rgb`. |
| `rgbLeft` | The `what` of every item that is still RGB. Empty when all is well. |
| `warnings` | A list of `{ code, message }`. A warning never changes `ok` or the exit code. |
| `export` | For `x1a`, `x3` and `tiff`: `format`, `pages`, `dpi`, `ghostscript`, `transparency` and `pixels`, as the library's `exportAs` reports them. `null` for `x4`. |

Sizes are rounded to a thousandth of a millimetre, ink to a hundredth of a percent and resolution to a tenth of a ppi. The other values are those of the library's reports.

The warning codes do not change from one version to the next. The messages may be reworded.

| Code | Meaning |
|---|---|
| `stand-in-profile` | No profile was given. The file is a trial, not for press. |
| `low-resolution` | An image prints below 300 ppi at the size it is placed. |
| `type3-fonts` | The file has Type 3 fonts, which some printers refuse. |
| `text-to-pixels` | With `x1a` or `x3`, a page that uses transparency became one picture, text included. |

A run that fails prints a shorter object, with exit code 2:

```json
{
  "tool": "Marmalade Open Press",
  "version": "1.1.0",
  "ok": false,
  "exitCode": 2,
  "error": "Cannot read no-such-page.html."
}
```

`--version` and `--help` print what they always did.

## The skill

`skills/open-press/SKILL.md` is an Agent Skill: a short manual an assistant reads when the subject comes up. It says when to use the tool, how to run it through `npx`, how to read the report, and how to mend what the report finds. It is in the repository and in the npm package. The README, under "The skill", has the lines that copy it into place without a clone.

Claude Code reads skills from `~/.claude/skills`, and from `.claude/skills` in a project. Codex reads them from `~/.codex/skills`, and from `~/.agents/skills` as well. Both were checked on Claude Code 2.1 and Codex 0.163.

## What the server may touch

The server does what the command line does, for whoever is asking. It opens the page it is given in Chromium and runs its scripts, it reads the profile and the colour table it is given, and it writes the output where it is told, over a file that is already there. It has no folder it is confined to. Give it to an assistant you would let run the command line, and see [SECURITY.md](../SECURITY.md).
