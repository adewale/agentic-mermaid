#!/usr/bin/env bun
import { dependencyStartupMessage } from './dependency-error.ts'

try {
  const entry = await import('../src/mcp/mcp-cli.ts')
  const code = await entry.runMcpCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
} catch (error) {
  process.stderr.write(`agentic-mermaid-mcp: ${dependencyStartupMessage(error)}\n`)
  process.exit(1)
}
