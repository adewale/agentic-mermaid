#!/usr/bin/env bun
import { runAmCli } from '../src/cli/run-entrypoint.ts'

const code = await runAmCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
