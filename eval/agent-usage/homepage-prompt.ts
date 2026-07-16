import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')

// Single source of truth for the agent-facing protocol: the hosted bootstrap
// the homepage CTA tells agents to fetch. The homepage itself only copies that
// fetch instruction; eval task prompts append per-request slots but do not inline
// a second copy of the protocol.
export function readStartMd(): string {
  return readFileSync(join(REPO, 'website/source/start.md'), 'utf8').trim()
}

// start.md body without its H1 title; variant checks compare the protocol body.
function startBody(md = readStartMd()): string {
  return md.replace(/^#[^\n]*\n+/, '').trim()
}

export const HOMEPAGE_PROMPT_VARIANTS = ['baseline', 'no-semantic-readback'] as const
export type HomepagePromptVariant = typeof HOMEPAGE_PROMPT_VARIANTS[number]

const SEMANTIC_READBACK_GUIDANCE = `Before returning, confirm the specific change the task asked for is actually present. Treat every label, value, endpoint, and prefix the task names as a required op argument, not descriptive prose — put it in the op verbatim (a dropped \`: done\` transition label or a dropped \`+\` visibility marker still verifies clean). \`verify.ok\` is structural; it does not check that you made the right edit. A diagram can verify yet be the wrong family or shape: read it back with \`describe\` and compare to the request, and if it does not match — or a family's syntax keeps failing — consult that family's \`example\` in \`capabilities.json\` and redo rather than settling for a verifying-but-wrong diagram. For a new diagram, also confirm it parsed **structured**, not opaque: the matching \`as*\` helper (\`asXyChart\`, \`asClass\`, …) returns the typed body, and returns \`null\` when your syntax fell to the source-level/opaque path (a \`UNSUPPORTED_SYNTAX\` warning names it) — an opaque body still renders but cannot be edited with typed ops, so fix the syntax against the family \`example\` rather than shipping something that only renders.`

/**
 * Eval-only start.md variants. The hosted start.md remains the source of truth;
 * variants transform the protocol body so A/B measurements can remove one
 * hypothesis without changing the homepage CTA copy.
 */
export function applyHomepagePromptVariant(prompt: string, variant: HomepagePromptVariant = 'baseline'): string {
  if (variant === 'baseline') return prompt
  if (variant === 'no-semantic-readback') {
    const next = prompt.replace(`\n\n${SEMANTIC_READBACK_GUIDANCE}\n\n`, '\n\n')
    if (next === prompt) throw new Error('Homepage prompt variant no-semantic-readback could not find semantic read-back guidance')
    return next
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

// Eval helper for inspecting the canonical protocol. Kept under the historical
// name because prompt-variant tests import it; it now returns only start.md's
// protocol body, not a homepage fallback panel.
export function buildHomepageFullPrompt(md = readStartMd(), variant: HomepagePromptVariant = 'baseline'): string {
  return applyHomepagePromptVariant(startBody(md), variant)
}

export function extractHomepageAgentPrompt(): string {
  return HOMEPAGE_AGENT_POINTER
}

export function buildHomepageAgentPromptTask(task: string, context: string, source?: string, variant: HomepagePromptVariant = 'baseline'): string {
  if (variant !== 'baseline') throw new Error('Homepage prompt variants operate on start.md; the public homepage prompt is fetch-only')
  return `${HOMEPAGE_AGENT_POINTER}

${SLOTS}`
    .replace('<replace with the requested diagram goal or edit>', task)
    .replace('<include the facts, labels, relationships, and constraints the diagram should express>', context)
    .replace('<paste existing Mermaid source here, or leave blank for a new diagram>', source?.trim() ?? '')
}

// Required anchors that must survive in start.md (channels, verify contract,
// return contract). If start.md drops one, this list flags it before the homepage
// points agents at an incomplete protocol.
export function homepagePromptChecklist(prompt = buildHomepageFullPrompt()): string[] {
  const required = [
    'Do not assume this repository is checked out',
    'one channel available to you',
    'Library imports, when available',
    'parseRegisteredMermaid',
    'verifyMermaid',
    'serializeMermaid',
    'mutate',
    'the hosted MCP at `https://agentic-mermaid.dev/mcp`',
    'no initialize handshake',
    '"method":"tools/call"',
    '"name":"verify"',
    'no REST render API',
    'am capabilities --json',
    'capabilities.json',
    'canonicalizes to `<br>`',
    'For a new diagram, author Mermaid source directly',
    'For an existing diagram, parse it',
    'narrow with the matching `as*` helper',
    'State diagrams narrow via `asState`',
    'Mutation ops use a `kind` discriminator',
    'source-level fallback',
    'Run `verifyMermaid`',
    'labelCharCap',
    'not verified — Agentic Mermaid unavailable',
    'Grounding and scope',
    'do not invent nodes or relationships',
    'add a Sources section',
    'Updated Mermaid',
    'Verification',
    'In Trace, name the channel and the calls/ops you actually ran',
    'return an object with `{ source }`',
    'Do not modify project files',
  ]
  return required.filter(piece => !prompt.includes(piece))
}
