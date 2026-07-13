#!/usr/bin/env bun
import { dependencyStartupMessage } from './dependency-error.ts'

let entry: typeof import('../src/mcp/mcp-cli.ts')
try {
  entry = await import('../src/mcp/mcp-cli.ts')
} catch (error) {
  process.stderr.write(`agentic-mermaid-mcp: ${dependencyStartupMessage(error)}\n`)
  process.exit(1)
}

const code = await entry.runMcpCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
