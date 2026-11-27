// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { ghostscriptVersion } from '../../src/ghostscript.js';

/**
 * True when Ghostscript runs on this machine. A failed probe counts as "no", so a
 * broken install skips the Ghostscript tests instead of failing every file at load.
 */
export const hasGhostscript = await ghostscriptVersion().then(
  (version) => version !== null,
  () => false,
);

/** Points the tool at a Ghostscript that does not exist, until the test ends. */
export function withoutGhostscript(t) {
  const before = process.env.OPEN_PRESS_GS;
  process.env.OPEN_PRESS_GS = 'no-such-ghostscript';
  t.after(() => {
    if (before === undefined) delete process.env.OPEN_PRESS_GS;
    else process.env.OPEN_PRESS_GS = before;
  });
}
