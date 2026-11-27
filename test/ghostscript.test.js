// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GHOSTSCRIPT_MISSING, ghostscriptCommand, ghostscriptIn, ghostscriptVersion } from '../src/ghostscript.js';
import { hasGhostscript, withoutGhostscript } from './helpers/ghostscript.js';

test('the message for a missing Ghostscript is one line that says how to install it', () => {
  assert.equal(GHOSTSCRIPT_MISSING.includes('\n'), false);
  assert.match(GHOSTSCRIPT_MISSING, /Ghostscript \(gs\)/);
  assert.match(GHOSTSCRIPT_MISSING, /brew install ghostscript/);
  assert.match(GHOSTSCRIPT_MISSING, /apt install ghostscript/);
  assert.equal(GHOSTSCRIPT_MISSING.includes('!'), false);
});

test('the program is gs unless OPEN_PRESS_GS names another', (t) => {
  withoutGhostscript(t);
  assert.equal(ghostscriptCommand(), 'no-such-ghostscript');
  delete process.env.OPEN_PRESS_GS;
  assert.equal(ghostscriptCommand(), 'gs');
});

test('a missing Ghostscript has no version, and a job says how to install it', async (t) => {
  withoutGhostscript(t);
  assert.equal(await ghostscriptVersion(), null);
  let folderUsed;
  await assert.rejects(
    ghostscriptIn({ 'note.txt': 'hello' }, ['-q'], async (folder) => { folderUsed = folder; }),
    (error) => error.message === GHOSTSCRIPT_MISSING,
  );
  assert.equal(folderUsed, undefined);
});

test('a program that is there but does not answer --version gives a plain message, not the raw error', { skip: process.platform === 'win32' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'open-press-test-'));
  const broken = join(folder, 'broken-gs');
  await writeFile(broken, '#!/bin/sh\nexit 3\n');
  await chmod(broken, 0o755);
  const before = process.env.OPEN_PRESS_GS;
  process.env.OPEN_PRESS_GS = broken;
  t.after(async () => {
    if (before === undefined) delete process.env.OPEN_PRESS_GS;
    else process.env.OPEN_PRESS_GS = before;
    await rm(folder, { recursive: true, force: true });
  });
  await assert.rejects(
    ghostscriptVersion(),
    (error) => error.message === `${broken} did not answer --version, so it is not a working Ghostscript. Check OPEN_PRESS_GS or reinstall Ghostscript.`,
  );
});

test('Ghostscript gives its version', { skip: !hasGhostscript }, async () => {
  assert.match(await ghostscriptVersion(), /^\d+\.\d+/);
});

test('a job runs in a scratch folder that holds the files and is removed afterwards', { skip: !hasGhostscript }, async () => {
  let folderUsed;
  const result = await ghostscriptIn(
    { 'note.txt': 'hello', 'bytes.bin': new Uint8Array([1, 2, 3]) },
    ['-q', '-dNODISPLAY', '-dBATCH', '-c', 'quit'],
    async (folder) => {
      folderUsed = folder;
      assert.equal(await readFile(join(folder, 'note.txt'), 'utf8'), 'hello');
      assert.deepEqual([...(await readFile(join(folder, 'bytes.bin')))], [1, 2, 3]);
      return 'collected';
    },
  );
  assert.equal(result, 'collected');
  await assert.rejects(access(folderUsed));
});

test('a job that fails says so in one line, and the scratch folder is still removed', { skip: !hasGhostscript || process.platform === 'win32' }, async () => {
  let collected = false;
  const parent = await mkdtemp(join(tmpdir(), 'open-press-parent-'));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = parent;
  await assert.rejects(
    ghostscriptIn({}, ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=no-such-device', '-c', 'quit'], async () => { collected = true; }),
    (error) => /^Ghostscript could not finish: .+/.test(error.message) && !error.message.includes('\n'),
  );
  process.env.TMPDIR = before ?? '';
  if (before === undefined) delete process.env.TMPDIR;
  assert.equal(collected, false);
  assert.deepEqual(await readdir(parent), []);
  await rm(parent, { recursive: true, force: true });
});
