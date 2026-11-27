// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** What is said when Ghostscript is not installed. One line, with the way out. @type {string} */
export const GHOSTSCRIPT_MISSING = 'Ghostscript (gs) is needed for the formats x1a, x3 and tiff, and it was not found. Install it with "brew install ghostscript" on macOS or "apt install ghostscript" on Debian and Ubuntu.';

// Ghostscript runs with -q and writes its results to files, so only a failure message comes back on the pipes. 16 MB is far more than that needs.
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * The Ghostscript program to run. OPEN_PRESS_GS names another program, such as gswin64c on Windows.
 * It is read at every call, so that a change to the variable takes effect straight away.
 * @returns {string} The program to run: the value of OPEN_PRESS_GS when set and not empty, otherwise 'gs'; a value that contains a path separator is resolved against the current folder.
 */
export function ghostscriptCommand() {
  const override = process.env.OPEN_PRESS_GS;
  if (!override) return 'gs';
  // A path is made absolute here, because the job runs inside the scratch folder, where a relative path would not resolve.
  return /[\\/]/.test(override) ? resolve(override) : override;
}

/**
 * The version Ghostscript gives, such as '10.06.0'.
 * @returns {Promise<string | null>} The version, or null when Ghostscript is not installed.
 */
export async function ghostscriptVersion() {
  const command = ghostscriptCommand();
  try {
    const { stdout } = await execute(command, ['--version']);
    return stdout.trim();
  } catch (error) {
    if (isMissing(error, command)) return null;
    // A program that is there but does not answer --version is a broken install or a wrong OPEN_PRESS_GS.
    // The raw error names an internal path and nothing the person can act on, so say what to check.
    throw new Error(`${command} did not answer --version, so it is not a working Ghostscript. Check OPEN_PRESS_GS or reinstall Ghostscript.`, { cause: error });
  }
}

/**
 * Runs Ghostscript in a new scratch folder that holds the given files, and removes the folder afterwards.
 * Ghostscript runs inside the folder, so the arguments name files without any path and nothing needs escaping.
 * @template T
 * @param {Record<string, Uint8Array | string>} files  File names and their contents, written before the run.
 * @param {string[]} args  The arguments. File names in them are relative to the scratch folder.
 * @param {(folder: string) => Promise<T>} collect  Reads what Ghostscript wrote, before the folder is removed.
 * @returns {Promise<T>} What collect returned.
 */
export async function ghostscriptIn(files, args, collect) {
  const folder = await mkdtemp(join(tmpdir(), 'open-press-'));
  try {
    for (const [fileName, contents] of Object.entries(files)) {
      await writeFile(join(folder, fileName), contents);
    }
    await run(args, folder);
    return await collect(folder);
  } finally {
    // The folder holds copies of the job's files and its output, so it goes whether the job worked or not.
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Runs Ghostscript with the given arguments inside the folder.
 * Only the run itself is wrapped here, so an error thrown by the caller's collect step is not rewritten.
 * @param {string[]} args  The arguments for Ghostscript.
 * @param {string} folder  The folder Ghostscript runs in.
 * @returns {Promise<void>}
 */
async function run(args, folder) {
  const command = ghostscriptCommand();
  try {
    await execute(command, args, { cwd: folder, maxBuffer: MAX_BUFFER });
  } catch (error) {
    if (isMissing(error, command)) throw new Error(GHOSTSCRIPT_MISSING, { cause: error });
    const output = `${error.stderr ?? ''}\n${error.stdout ?? ''}`;
    throw new Error(`Ghostscript could not finish: ${lastLine(output)}`, { cause: error });
  }
}

/**
 * Tells a missing program apart from a job that failed. Only a missing program means Ghostscript is absent;
 * a job that fails has another error code.
 * @param {unknown} error  The error that execFile threw.
 * @param {string} command  The program that was run.
 * @returns {boolean} True when the program does not exist.
 */
function isMissing(error, command) {
  return error?.code === 'ENOENT' && error.path === command;
}

/**
 * The last line of Ghostscript's output that says something, so that a failure fits on one line.
 * @param {string} text  Everything Ghostscript printed.
 * @returns {string} The last non-empty trimmed line, or 'no message' when there is none.
 */
function lastLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.at(-1) ?? 'no message';
}
