#!/usr/bin/env bun
import { runCli } from '../src/cli/index.ts'
process.exit(runCli(process.argv.slice(2)))
