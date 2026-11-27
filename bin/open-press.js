#!/usr/bin/env node
// Marmalade Open Press, made by Marmalade (https://marmalade.family).
// Copyright (c) 2026 East Hill. MIT licence.
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 East Hill

import { run } from '../src/cli.js';
import { serve } from '../src/mcp.js';

const argv = process.argv.slice(2);
// "open-press mcp" is the MCP server. Anything else is the command line.
const isServer = argv.length === 1 && argv[0] === 'mcp';

// exitCode, not exit(): the process ends by itself once everything is written.
process.exitCode = isServer ? await serve() : await run(argv);
