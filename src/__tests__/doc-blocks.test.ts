// Generated doc blocks (scripts/docs/doc-blocks.ts) carry facts whose source is
// code — among them the warning codes and formats `am --agent-instructions`
// prints. This is their one freshness check: a stale or unknown block fails
// here, and `bun run doc-blocks` fixes it.

import { describe, expect, test } from 'bun:test'
import { HOSTED_MCP_TOOL_NAMES, LOCAL_MCP_TOOL_NAMES } from '../mcp/tool-names.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import { syncDocBlocks } from '../../scripts/docs/doc-blocks.ts'
import { maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

describe('generated doc blocks', () => {
  test('every block in every maintained doc is current', () => {
    expect(syncDocBlocks(REPO_ROOT, maintainedMarkdownFiles(), false)).toEqual([])
  })

  test('the tool names the docs and llms.txt print are the tools each server lists', () => {
    expect(LOCAL_TOOLS.map(tool => tool.name)).toEqual([...LOCAL_MCP_TOOL_NAMES])
    expect(HOSTED_TOOLS.map(tool => tool.name)).toEqual([...HOSTED_MCP_TOOL_NAMES])
  })
})
