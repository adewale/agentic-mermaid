#!/usr/bin/env bun
import { runMcpCli } from '../src/mcp/mcp-cli.ts'
const code = await runMcpCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
