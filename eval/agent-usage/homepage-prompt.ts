import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')

// Single source of truth for the agent-facing protocol: the hosted bootstrap
// the homepage pointer tells agents to fetch. The homepage renders it two ways —
// a short fetch-pointer (primary CTA) and an inline fallback for agents that
// cannot fetch a URL — and BOTH are derived from this file, so they cannot drift.
export function readStartMd(): string {
  return readFileSync(join(REPO, 'website/source/start.md'), 'utf8').trim()
}

// start.md body without its H1 title; the composed prompts supply their own intro.
function startBody(md = readStartMd()): string {
  return md.replace(/^#[^\n]*\n+/, '').trim()
}

const INTRO = 'Create or edit a Mermaid diagram with Agentic Mermaid.'

export const HOMEPAGE_PROMPT_VARIANTS = ['baseline', 'no-semantic-readback'] as const
export type HomepagePromptVariant = typeof HOMEPAGE_PROMPT_VARIANTS[number]

const SEMANTIC_READBACK_GUIDANCE = `Before returning, confirm the specific change the task asked for is actually present. Treat every label, value, endpoint, and prefix the task names as a required op argument, not descriptive prose — put it in the op verbatim (a dropped \`: done\` transition label or a dropped \`+\` visibility marker still verifies clean). \`verify.ok\` is structural; it does not check that you made the right edit. A diagram can verify yet be the wrong family or shape: read it back with \`describe\` and compare to the request, and if it does not match — or a family's syntax keeps failing — consult that family's \`example\` in \`capabilities.json\` and redo rather than settling for a verifying-but-wrong diagram. For a new diagram, also confirm it parsed **structured**, not opaque: the matching \`as*\` helper (\`asXyChart\`, \`asClass\`, …) returns the typed body, and returns \`null\` when your syntax fell to the source-level/opaque path (a \`UNSUPPORTED_SYNTAX\` warning names it) — an opaque body still renders but cannot be edited with typed ops, so fix the syntax against the family \`example\` rather than shipping something that only renders.`

/**
 * Eval-only prompt variants. The hosted start.md remains the source of truth;
 * variants transform the populated eval prompt so A/B measurements can remove
 * one hypothesis without editing the website docs under test.
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

// The Task/Context/source fill-in slots. These live in the copied prompt (not in
// start.md), because they are per-request; the token strings are the ones
// buildHomepageAgentPromptTask substitutes for the agent-usage eval.
const SLOTS = `Task:
<replace with the requested diagram goal or edit>

Context:
<include the facts, labels, relationships, and constraints the diagram should express>

Mermaid source (for edits; leave blank for a new diagram):
\`\`\`mermaid
<paste existing Mermaid source here, or leave blank for a new diagram>
\`\`\`

If any \`<…>\` placeholder above is still unreplaced, do not author a generic diagram — reply asking for the missing details.`

// Primary CTA: fetch the hosted bootstrap, fill the slots. Short and version-current.
export const HOMEPAGE_AGENT_POINTER = `${INTRO}
Fetch https://agentic-mermaid.dev/start.md and follow it.

${SLOTS}`

// Inline fallback for agents that cannot fetch a URL: the same slots with the
// start.md protocol inlined verbatim. Derived from start.md, never authored
// separately — so the pointer, the inline prompt, and the hosted file agree.
export function buildHomepageFullPrompt(md = readStartMd(), variant: HomepagePromptVariant = 'baseline'): string {
  return applyHomepagePromptVariant(`${INTRO}

${SLOTS}

The steps below are the contents of https://agentic-mermaid.dev/start.md, inlined for agents that cannot fetch a URL:

${startBody(md)}`, variant)
}

// The prompt the agent-usage eval runs against: the inline (fully self-contained)
// composition, so a case exercises the whole protocol without a live fetch.
export function extractHomepageAgentPrompt(): string {
  return buildHomepageFullPrompt()
}

export function buildHomepageAgentPromptTask(task: string, context: string, source?: string, variant: HomepagePromptVariant = 'baseline'): string {
  return buildHomepageFullPrompt(readStartMd(), variant)
    .replace('<replace with the requested diagram goal or edit>', task)
    .replace('<include the facts, labels, relationships, and constraints the diagram should express>', context)
    .replace('<paste existing Mermaid source here, or leave blank for a new diagram>', source?.trim() ?? '')
}

// Required anchors that must survive in the composed prompt: the slots, plus the
// load-bearing facts from start.md (channels, verify contract, return contract).
// If start.md drops one, this list flags it before the homepage lies to an agent.
export function homepagePromptChecklist(prompt = buildHomepageFullPrompt()): string[] {
  const required = [
    'Create or edit a Mermaid diagram',
    'Task:',
    'Context:',
    'Mermaid source (for edits; leave blank for a new diagram):',
    'placeholder above is still unreplaced',
    'contents of https://agentic-mermaid.dev/start.md',
    'Do not assume this repository is checked out',
    'one channel available to you',
    'Library imports, when available',
    'parseMermaid',
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
