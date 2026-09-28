// Generated Markdown blocks: facts that have one source in code, embedded in
// docs between markers instead of copied by hand.
//
//   Hosted tools: <!-- BEGIN GENERATED: hosted-mcp-tools -->…<!-- END GENERATED: hosted-mcp-tools -->.
//
// `bun run doc-blocks` rewrites every block from its renderer; the
// doc-blocks test fails when a block is stale or names an unknown renderer.
// A block may be inline (inside a sentence) or span lines.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA, getFamily } from '../../src/agent/families.ts'
import { WARNING_TIER, type WarningCode, type WarningTier } from '../../src/agent/types.ts'
import { COMMAND_FLAGS } from '../../src/cli/index.ts'
import { HOSTED_MCP_TOOL_NAMES, inlineToolList, LOCAL_MCP_TOOL_NAMES } from '../../src/mcp/tool-names.ts'
import { CLI_RENDER_FORMATS } from '../../src/render-contract.ts'
import { EXISTING_DIAGRAM_WORKFLOW, NEW_DIAGRAM_POLICY } from '../../src/shared/agent-workflow.ts'

const ticked = (values: readonly string[]): string => values.map(value => `\`${value}\``).join(', ')

const codesInTier = (tier: WarningTier): WarningCode[] =>
  (Object.keys(WARNING_TIER) as WarningCode[]).filter(code => WARNING_TIER[code] === tier)

const noopKeys = (family: string): string => {
  const keys = getFamily(family)?.config?.noopKeys
  if (!keys) throw new Error(`family ${family} declares no config.noopKeys`)
  return ticked(keys)
}

/** Renderer for each block id; `noop-keys:<family>` takes the family id. */
export const DOC_BLOCKS: Readonly<Record<string, (argument?: string) => string>> = {
  'agent-workflow': () => `${NEW_DIAGRAM_POLICY} ${EXISTING_DIAGRAM_WORKFLOW}`,
  'new-diagram-policy': () => NEW_DIAGRAM_POLICY,
  'hosted-mcp-tools': () => inlineToolList(HOSTED_MCP_TOOL_NAMES),
  'local-mcp-tools': () => inlineToolList(LOCAL_MCP_TOOL_NAMES),
  'cli-verbs': () => ticked(Object.keys(COMMAND_FLAGS)),
  'render-formats': () => ticked(CLI_RENDER_FORMATS),
  'warning-codes:structural': () => ticked(codesInTier('structural')),
  'warning-codes:geometric': () => ticked(codesInTier('geometric')),
  'warning-codes:lint': () => ticked(codesInTier('lint')),
  'family-ids': () => ticked(BUILTIN_FAMILY_METADATA.map(family => family.id)),
  'noop-keys': family => noopKeys(family ?? ''),
}

const BLOCK = /<!-- BEGIN GENERATED: ([a-z-]+)(?::([a-z0-9-]+))? -->([\s\S]*?)<!-- END GENERATED: \1(?::\2)? -->/g

export interface DocBlockProblem { file: string; block: string; problem: 'stale' | 'unknown' }

/** The text with every generated block re-rendered, plus problems found. */
export function renderDocBlocks(file: string, text: string): { text: string; problems: DocBlockProblem[] } {
  const problems: DocBlockProblem[] = []
  const next = text.replace(BLOCK, (whole, id: string, argument: string | undefined, body: string) => {
    const block = argument ? `${id}:${argument}` : id
    const render = DOC_BLOCKS[block] ?? (argument ? DOC_BLOCKS[id] : undefined)
    if (!render) {
      problems.push({ file, block, problem: 'unknown' })
      return whole
    }
    // Keep a multi-line block multi-line so it reads as its own paragraph.
    const content = render(argument)
    const rendered = body.startsWith('\n') ? `\n${content}\n` : content
    if (rendered !== body) problems.push({ file, block, problem: 'stale' })
    return `<!-- BEGIN GENERATED: ${block} -->${rendered}<!-- END GENERATED: ${block} -->`
  })
  return { text: next, problems }
}

/** Check (or, with write, regenerate) the blocks in the given repository files. */
export function syncDocBlocks(root: string, files: readonly string[], write: boolean): DocBlockProblem[] {
  const problems: DocBlockProblem[] = []
  for (const file of files) {
    const path = join(root, file)
    const text = readFileSync(path, 'utf8')
    if (!text.includes('<!-- BEGIN GENERATED: ')) continue
    const result = renderDocBlocks(file, text)
    problems.push(...result.problems)
    if (write && result.text !== text) writeFileSync(path, result.text)
  }
  return problems
}
