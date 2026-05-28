#!/usr/bin/env bun
import { runStdio } from '../src/mcp/server.ts'

runStdio().catch(err => {
  process.stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
