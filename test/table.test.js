// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkColourTable, loadColourTable } from '../src/table.js';

const entry = { name: 'Process cyan', hex: '#00AEEF', cmyk: [100, 0, 0, 0] };

/** A folder inside test/ that git ignores (*.local.*), removed when the test ends. */
async function scratchFolder(t) {
  const folder = await mkdtemp(join(import.meta.dirname, 'table.local.'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('checkColourTable returns a sound table as it is', () => {
  assert.deepEqual(checkColourTable([entry]), [entry]);
  assert.deepEqual(checkColourTable([]), []);
});

test('checkColourTable refuses what is not an array', () => {
  assert.throws(() => checkColourTable({ entries: [] }), /array/);
});

test('checkColourTable names the entry at fault and what it needs', () => {
  assert.throws(() => checkColourTable([entry, { ...entry, name: '' }]), /entry 2 .*name/);
  assert.throws(() => checkColourTable([{ ...entry, hex: 'cyan' }]), /entry 1 .*hex/);
  assert.throws(() => checkColourTable([{ ...entry, hex: '#0AE' }]), /entry 1 .*hex/);
  assert.throws(() => checkColourTable([{ ...entry, cmyk: [100, 0, 0] }]), /entry 1 .*cmyk/);
  assert.throws(() => checkColourTable([{ ...entry, cmyk: [101, 0, 0, 0] }]), /entry 1 .*cmyk/);
  assert.throws(() => checkColourTable([{ ...entry, cmyk: ['100', 0, 0, 0] }]), /entry 1 .*cmyk/);
  assert.throws(() => checkColourTable([null]), /entry 1 /);
});

test('the classic preset loads by name', async () => {
  const table = await loadColourTable('classic');
  const inkOf = (hex) => table.find((one) => one.hex.toUpperCase() === hex)?.cmyk;
  assert.deepEqual(inkOf('#000000'), [0, 0, 0, 100]);
  assert.deepEqual(inkOf('#FFFFFF'), [0, 0, 0, 0]);
  assert.deepEqual(inkOf('#0A0A0A'), [60, 40, 40, 100]);
  assert.deepEqual(inkOf('#00AEEF'), [100, 0, 0, 0]);
});

test('an unknown preset is refused by name', async () => {
  await assert.rejects(loadColourTable('baroque'), /no colour preset called "baroque"/);
});

test('a table loads from a JSON file', async (t) => {
  const file = join(await scratchFolder(t), 'house.json');
  await writeFile(file, JSON.stringify([entry]));
  assert.deepEqual(await loadColourTable(file), [entry]);
});

test('a missing file, broken JSON and a faulty entry each get a plain message', async (t) => {
  const folder = await scratchFolder(t);
  const broken = join(folder, 'broken.json');
  const faulty = join(folder, 'faulty.json');
  await writeFile(broken, '[{ "name": ');
  await writeFile(faulty, JSON.stringify([{ ...entry, cmyk: [1, 2, 3] }]));
  await assert.rejects(loadColourTable(join(folder, 'absent.json')), /Cannot read the colour table/);
  await assert.rejects(loadColourTable(broken), /not valid JSON/);
  await assert.rejects(loadColourTable(faulty), /entry 1 .*cmyk/);
});
