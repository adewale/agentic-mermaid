#!/usr/bin/env bun
// Stdio entry point for the agentic-mermaid Code Mode MCP server.
import { runStdio } from '../src/mcp/server.ts'

runStdio().catch(err => {
  process.stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
