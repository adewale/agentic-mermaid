// Generated doc blocks (scripts/docs/doc-blocks.ts) carry facts whose source is
// code. This is their one freshness check: a stale or unknown block fails here,
// and `bun run doc-blocks` fixes it.

import { describe, expect, test } from 'bun:test'
import { HOSTED_MCP_TOOL_NAMES, LOCAL_MCP_TOOL_NAMES } from '../mcp/tool-names.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import { renderDocBlocks, syncDocBlocks } from '../../scripts/docs/doc-blocks.ts'
import { maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

describe('generated doc blocks', () => {
  test('every block in every maintained doc is current', () => {
    expect(syncDocBlocks(REPO_ROOT, maintainedMarkdownFiles(), false)).toEqual([])
  })

  test('a stale block is reported and rewritten; an unknown block is reported and kept', () => {
    const stale = 'Formats: <!-- BEGIN GENERATED: render-formats -->`svg`<!-- END GENERATED: render-formats -->.'
    const unknown = '<!-- BEGIN GENERATED: no-such-block -->x<!-- END GENERATED: no-such-block -->'
    const result = renderDocBlocks('doc.md', `${stale}\n${unknown}`)
    expect(result.problems).toEqual([
      { file: 'doc.md', block: 'render-formats', problem: 'stale' },
      { file: 'doc.md', block: 'no-such-block', problem: 'unknown' },
    ])
    expect(result.text).toContain('`svg`, `ascii`')
    expect(result.text).toContain(unknown)
    expect(renderDocBlocks('doc.md', result.text).problems).toEqual([{ file: 'doc.md', block: 'no-such-block', problem: 'unknown' }])
  })

  test('the tool names the docs and llms.txt print are the tools each server lists', () => {
    expect(LOCAL_TOOLS.map(tool => tool.name)).toEqual([...LOCAL_MCP_TOOL_NAMES])
    expect(HOSTED_TOOLS.map(tool => tool.name)).toEqual([...HOSTED_MCP_TOOL_NAMES])
  })
})
