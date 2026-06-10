#!/usr/bin/env node
// Published CLI entrypoint (node-runnable). The Bun-based bin/am.ts is kept for
// local development; tsup compiles this file to dist/am.js for npm consumers.
import { runCli } from './index.ts'

process.exit(runCli(process.argv.slice(2)))
