#!/usr/bin/env node
// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.

import { run } from '../src/cli.js';

// exitCode, not exit(): the process ends by itself once everything is written.
process.exitCode = await run(process.argv.slice(2));
