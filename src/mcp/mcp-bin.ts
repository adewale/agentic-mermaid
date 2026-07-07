#!/usr/bin/env node
import { runMcpCli } from './mcp-cli.ts'
const code = await runMcpCli(process.argv.slice(2)); if (code !== 0) process.exit(code)
