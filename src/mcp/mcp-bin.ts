#!/usr/bin/env node
// Published MCP server entrypoint (node-runnable). The bun-based
// bin/agentic-mermaid-mcp.ts is kept for local development; tsup compiles this
// file to dist/agentic-mermaid-mcp.js for npm consumers.
import { runStdio } from './server.ts'

runStdio().catch(err => {
  process.stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
