// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { SERVER_INFO } from '../src/mcp.js';
import { VERSION } from '../src/version.js';

/** Reads a file of the repository as text, by its path from the root. */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = async (path) => JSON.parse(await read(path));

const MCP_NAME = 'io.github.easthillcc/marmalade-open-press';
const INSTALL = 'npx -y marmalade-open-press@latest mcp';

test('every file that names the version names the same one', async () => {
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const server = await readJson('server.json');
  assert.equal(manifest.version, VERSION);
  assert.equal(lock.version, VERSION);
  assert.equal(lock.packages[''].version, VERSION);
  assert.equal(server.version, VERSION);
  assert.equal(server.packages[0].version, VERSION);
  assert.equal(SERVER_INFO.version, VERSION);
  assert.match(await read('CITATION.cff'), new RegExp(`^version: ${VERSION.replaceAll('.', '[.]')}$`, 'm'));
  // The newest entry of the changelog is this version.
  assert.equal(/^## (\S+)$/m.exec(await read('CHANGELOG.md'))[1], VERSION);
});

test('server.json describes the npm package to the MCP Registry, and package.json claims the same name', async () => {
  const manifest = await readJson('package.json');
  const server = await readJson('server.json');
  assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(server.name, MCP_NAME);
  assert.equal(manifest.mcpName, MCP_NAME);
  assert.equal(server.title, 'Marmalade Open Press');
  // The registry refuses a description of more than 100 characters.
  assert.ok(server.description.length <= 100);
  assert.match(server.description, /Marmalade/);
  assert.equal(server.websiteUrl, 'https://marmalade.family');
  assert.deepEqual(server.repository, { url: 'https://github.com/easthillcc/marmalade-open-press', source: 'github' });
  assert.equal(server.packages.length, 1);
  const [entry] = server.packages;
  assert.equal(entry.registryType, 'npm');
  assert.equal(entry.identifier, manifest.name);
  assert.deepEqual(entry.transport, { type: 'stdio' });
  assert.deepEqual(entry.packageArguments, [{ type: 'positional', value: 'mcp' }]);
});

test('the npm package carries the command and the skill, and no new dependency', async () => {
  const manifest = await readJson('package.json');
  assert.deepEqual(manifest.bin, { 'open-press': 'bin/open-press.js' });
  assert.ok(manifest.files.includes('skills'));
  assert.deepEqual(manifest.dependencies, { 'pdf-lib': '1.17.1', playwright: '1.65.0', sharp: '0.35.5' });
  assert.equal(manifest.devDependencies, undefined);
});

test('the skill is an Agent Skill: a name that matches its folder, a description, and the command to run', async () => {
  const skill = await read('skills/open-press/SKILL.md');
  const [, frontMatter, body] = /^---\n([\s\S]+?)\n---\n([\s\S]+)$/.exec(skill);
  assert.match(frontMatter, /^name: open-press$/m);
  const description = /^description: (.+)$/m.exec(frontMatter)[1];
  assert.ok(description.length > 100 && description.length <= 1024);
  assert.match(description, /Marmalade Open Press/);
  assert.match(description, /Use when/);
  assert.ok(body.includes('npx -y marmalade-open-press@latest <page.html|url> <out.pdf> --json --check'));
  assert.ok(body.includes('npx -y -p marmalade-open-press@latest playwright install chromium'));
  for (const code of ['stand-in-profile', 'low-resolution', 'type3-fonts', 'text-to-pixels', 'rgbLeft']) {
    assert.ok(body.includes(code), code);
  }
  assert.ok(body.includes('https://marmalade.family'));
  assert.equal(skill.includes('!'), false);
});

test('the README gives the lines that add the server, before the command line', async () => {
  const readme = await read('README.md');
  const at = (text) => readme.indexOf(text);
  assert.ok(at('\n## Install\n') < at('\n## Use it with an AI assistant\n'));
  assert.ok(at('\n## Use it with an AI assistant\n') < at('\n## Command line\n'));
  assert.ok(readme.includes(`\nclaude mcp add open-press -- ${INSTALL}\n`));
  assert.ok(readme.includes(`\ncodex mcp add open-press -- ${INSTALL}\n`));
  assert.ok(readme.includes('"command": "npx",\n      "args": ["-y", "marmalade-open-press@latest", "mcp"]'));
  assert.ok(readme.includes('~/.gemini/settings.json'));
  assert.ok(readme.includes('tar -xzf "$(npm pack --silent marmalade-open-press@latest)"'));
  assert.ok(readme.includes('cp -R package/skills/open-press ~/.claude/skills/'));
  assert.ok(readme.includes('cp -R package/skills/open-press ~/.codex/skills/'));
  assert.ok(readme.includes('node_modules/marmalade-open-press/skills/open-press'));
  assert.ok(readme.includes('~/.codex/config.toml'));
  assert.ok(readme.includes('### The report as JSON'));
  assert.ok(readme.includes('| `--json` |'));
});

test('llms.txt and the docs tell an assistant about --json and the server', async () => {
  const llms = await read('llms.txt');
  assert.ok(llms.includes('--json'));
  assert.ok(llms.includes(INSTALL));
  assert.ok(llms.includes('docs/assistants.md'));
  const assistants = await read('docs/assistants.md');
  assert.ok(assistants.includes('html_to_print_pdf'));
  assert.ok(assistants.includes(INSTALL));
  assert.ok((await read('docs/recipes.md')).includes('## Let an AI assistant make the file'));
  assert.ok((await read('SECURITY.md')).includes('## The MCP server'));
});
