# Security

Marmalade Open Press, made by [Marmalade](https://marmalade.family).

## Reporting a problem

Report it privately through [GitHub's private vulnerability reporting](https://github.com/easthillcc/marmalade-open-press/security/advisories/new), not in a public issue. Say what an attacker can do, and how, with the smallest input that shows it. You will get an answer within a week.

## What counts

The tool reads files and pages you give it and writes PDFs and TIFFs. Problems worth reporting include:

- an HTML page, PDF, ICC profile or colour table that makes the tool read or write files outside what it was asked to;
- a way to run a command through the Ghostscript step, which runs with `-dSAFER` in a scratch folder of its own;
- an input that makes the tool hang or use memory without end.

## What to know before you point it at the web

`render` opens the page in Chromium, through Playwright, and runs its scripts, as a browser would. Give it pages you trust, or run it in a sandbox or a container. A page can load other resources from the network or from `file://` addresses, as any page in a browser can.

Ghostscript is a separate program with its own security record. Keep it up to date.

## Supported versions

The latest release gets fixes. Older ones do not.
