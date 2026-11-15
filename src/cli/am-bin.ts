#!/usr/bin/env node
// Published CLI entrypoint (node-runnable). The Bun-based bin/am.ts is kept for
// local development; tsup compiles this file to dist/am.js for npm consumers.
// Each CLI run is a fresh process, so cache compiled code across runs (Node
// 22.1+). Enabling it before the CLI loads covers the package's modules and
// the lazily required elkjs; NODE_DISABLE_COMPILE_CACHE=1 turns it off.
import module from 'node:module'

module.enableCompileCache?.()
const { runAmCli } = await import('./run-entrypoint.ts')
const code = await runAmCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
