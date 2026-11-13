#!/usr/bin/env node
// Published CLI entrypoint (node-runnable). The Bun-based bin/am.ts is kept for
// local development; tsup compiles this file to dist/am.js for npm consumers.
import { runAmCli } from './run-entrypoint.ts'

const code = await runAmCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
