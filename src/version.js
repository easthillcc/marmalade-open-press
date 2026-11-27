// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import manifest from '../package.json' with { type: 'json' };

/** The package version, from package.json. Used in BANNER and PRODUCER. @type {string} */
export const VERSION = manifest.version;

/** Marmalade's home page, named in every PDF and in --version. @type {string} */
export const HOME = 'https://marmalade.family';

/** The Producer written into every PDF. @type {string} */
export const PRODUCER = `Marmalade Open Press ${VERSION} (${HOME})`;

/** What --version prints. @type {string} */
export const BANNER = `Marmalade Open Press ${VERSION}, made by Marmalade. ${HOME}`;
