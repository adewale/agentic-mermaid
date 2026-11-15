import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')

// The public homepage fetches the short router, which points to the maintained
// operating guide. Eval inspection and A/B treatment use that guide's content;
// the task prompt itself stays fetch-only.
export function readStartMd(): string {
  return readFileSync(join(REPO, 'website/source/start.md'), 'utf8').trim()
}

function guideBody(md: string): string {
  return md.replace(/^#[^\n]*\n+/, '').trim()
}

export const HOMEPAGE_PROMPT_VARIANTS = ['baseline', 'no-semantic-readback'] as const
export type HomepagePromptVariant = typeof HOMEPAGE_PROMPT_VARIANTS[number]

const SEMANTIC_READBACK_BLOCK = /^<!-- BEGIN SEMANTIC READBACK -->\n[\s\S]*?\n<!-- END SEMANTIC READBACK -->$/gm

/**
 * Eval-only operating-guide variants. Stable block boundaries remove one
 * hypothesis without changing the public fetch-only pointer or coupling the
 * treatment to authored prose. Shared verification guidance stays outside it.
 */
export function applyHomepagePromptVariant(prompt: string, variant: HomepagePromptVariant = 'baseline'): string {
  if (variant === 'baseline') return prompt
  if (variant === 'no-semantic-readback') {
    const blocks = [...prompt.matchAll(SEMANTIC_READBACK_BLOCK)]
    if (blocks.length !== 1) throw new Error('Homepage prompt variant no-semantic-readback requires exactly one semantic read-back guidance block')
    return prompt.replace(SEMANTIC_READBACK_BLOCK, '')
  }
  const _never: never = variant
  return _never
}

// The Task/Context/source fill-in slots. These are per-request eval scaffolding,
// not homepage CTA copy; the token strings are the ones buildHomepageAgentPromptTask
// substitutes for agent-usage cases.
const SLOTS = `Task:
<replace with the requested diagram goal or edit>

Context:
<include the facts, labels, relationships, and constraints the diagram should express>

Mermaid source (for edits; leave blank for a new diagram):
\`\`\`mermaid
<paste existing Mermaid source here, or leave blank for a new diagram>
\`\`\`

If any \`<…>\` placeholder above is still unreplaced, do not author a generic diagram — reply asking for the missing details.`

// Primary CTA: the only text copied from the homepage.
export const HOMEPAGE_AGENT_POINTER = 'Fetch https://agentic-mermaid.dev/start.md and follow it.'

// Inspect the guide reached through start.md without inlining it into a task.
export function buildHomepageFullPrompt(md = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8'), variant: HomepagePromptVariant = 'baseline'): string {
  return applyHomepagePromptVariant(guideBody(md), variant)
}

export function extractHomepageAgentPrompt(): string {
  return HOMEPAGE_AGENT_POINTER
}

export function buildHomepageAgentPromptTask(task: string, context: string, source?: string, variant: HomepagePromptVariant = 'baseline'): string {
  if (variant !== 'baseline') throw new Error('Homepage prompt variants operate on the operating guide; the public homepage prompt is fetch-only')
  return `${HOMEPAGE_AGENT_POINTER}

${SLOTS}`
    .replace('<replace with the requested diagram goal or edit>', task)
    .replace('<include the facts, labels, relationships, and constraints the diagram should express>', context)
    .replace('<paste existing Mermaid source here, or leave blank for a new diagram>', source?.trim() ?? '')
}
