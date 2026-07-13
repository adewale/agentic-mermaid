#!/usr/bin/env bun
import { dependencyStartupMessage } from './dependency-error.ts'

let entry: typeof import('../src/cli/run-entrypoint.ts')
try {
  entry = await import('../src/cli/run-entrypoint.ts')
} catch (error) {
  process.stderr.write(`agentic-mermaid: ${dependencyStartupMessage(error)}\n`)
  process.exit(1)
}

const code = await entry.runAmCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
