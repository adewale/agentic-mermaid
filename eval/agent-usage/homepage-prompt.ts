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
export function buildHomepageFullPrompt(md = readStartMd()): string {
  return `${INTRO}

${SLOTS}

The steps below are the contents of https://agentic-mermaid.dev/start.md, inlined for agents that cannot fetch a URL:

${startBody(md)}`
}

// The prompt the agent-usage eval runs against: the inline (fully self-contained)
// composition, so a case exercises the whole protocol without a live fetch.
export function extractHomepageAgentPrompt(): string {
  return buildHomepageFullPrompt()
}

export function buildHomepageAgentPromptTask(task: string, context: string, source?: string): string {
  return buildHomepageFullPrompt()
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
