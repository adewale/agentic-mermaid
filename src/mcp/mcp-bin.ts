#!/usr/bin/env node
// Each MCP server start is a fresh process: cache compiled code across starts
// (Node 22.1+), enabled before the server modules load. NODE_DISABLE_COMPILE_CACHE=1
// turns it off.
import module from 'node:module'

module.enableCompileCache?.()
const { runMcpCli } = await import('./mcp-cli.ts')
const code = await runMcpCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
