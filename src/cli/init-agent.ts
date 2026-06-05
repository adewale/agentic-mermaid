// `am init-agent` — write a repo-local agent drop-in so coding agents discover
// the agentic-mermaid contract without being told the workflow every time.
//
// It writes three things (none destructive by default):
//   - an AGENTS.md section pointing agents at the parse → mutate → verify loop
//   - a Claude Code skill bundle at .claude/skills/agentic-mermaid/SKILL.md
//   - a sample MCP server config at .mcp.json
//
// The skill is deliberately self-describing: it routes to `am --agent-instructions`
// and `am capabilities --json` rather than duplicating the full guide, so it
// never drifts from the installed CLI.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HOSTED_LLMS_TXT = 'https://adewale.github.io/beautiful-mermaid/llms.txt'

// Marker so re-running init-agent against an existing AGENTS.md is idempotent.
export const AGENTS_MARKER = '<!-- agentic-mermaid:start -->'
const AGENTS_MARKER_END = '<!-- agentic-mermaid:end -->'

export const AGENTS_SNIPPET = `${AGENTS_MARKER}
## Editing Mermaid diagrams

Use **agentic-mermaid** whenever you create or edit a Mermaid diagram. Do not
regenerate an existing diagram from scratch — parse it, narrow it, mutate it,
verify, then serialize. Author Mermaid source directly only for brand-new
diagrams, then verify and render.

Workflow for existing structured diagrams:
parse → narrow (\`asFlowchart\`/\`asSequence\`/\`asTimeline\`/\`asClass\`/\`asEr\`) →
mutate → verify → serialize. Run verify at every commit point; never serialize a
diagram whose verify result you have not inspected.

- Full agent guide: \`npx agentic-mermaid --agent-instructions\`
- Capability envelope: \`npx agentic-mermaid capabilities --json\`
- Discovery digest: \`npx agentic-mermaid llms-txt\` (or read ${HOSTED_LLMS_TXT})
${AGENTS_MARKER_END}
`

export const INIT_SKILL_MD = `---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Use for any task that creates or modifies a Mermaid diagram.
---

# agentic-mermaid

A typed editing surface for Mermaid. Parse to a \`ValidDiagram\`, mutate with
typed ops, verify structurally (no pixels), serialize back to canonical source.
Layout is deterministic.

## Pick a channel

- \`agentic-mermaid-mcp\` MCP connected → **Code Mode**: write JS against the
  \`mermaid.*\` SDK and run it in one \`execute\` round-trip.
- Can run JS/TS with imports → **library**: \`import { ... } from 'agentic-mermaid/agent'\`.
- Shell only → **CLI** (\`am <verb>\`).

## Workflow

New diagrams: author Mermaid source → parse → verify → render.
Existing structured diagrams:

1. \`parseMermaid(source)\` → \`ValidDiagram\`.
2. \`asFlowchart\` / \`asSequence\` / \`asTimeline\` / \`asClass\` / \`asEr\` to narrow.
3. \`mutate(d, op)\` (typed per family).
4. \`verifyMermaid(d)\` — inspect \`ok\` / \`warnings\` / \`layout\`.
5. On \`!ok\`, revert and try another op.
6. \`serializeMermaid(d)\` only after an inspected verify passes.

Do not regenerate or concatenate source to edit an existing structured diagram
when a typed op exists. journey / xychart / architecture / opaque bodies
round-trip losslessly as source but expose no structured mutation.

## Discover the rest

The CLI is self-describing — prefer it over guessing:

- \`am --agent-instructions\` — the canonical agent-use guide.
- \`am capabilities --json\` — families, \`editPolicy\`, \`mutationOps\`, warning codes.
- \`am llms-txt\` — discovery digest.
`

export const MCP_CONFIG_SAMPLE = JSON.stringify(
  {
    mcpServers: {
      'agentic-mermaid': {
        command: 'npx',
        args: ['-y', '--package', 'agentic-mermaid', 'agentic-mermaid-mcp'],
      },
    },
  },
  null,
  2,
) + '\n'

export interface InitAgentResult {
  written: string[]
  appended: string[]
  skipped: string[]
}

function ensureDir(file: string): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Write the agent drop-in into `dir`. Never clobbers without `force`:
 * - AGENTS.md: appended (with a marker) if present and not already injected.
 * - SKILL.md / .mcp.json: written if absent, or with `force`.
 */
export function initAgentFiles(opts: { dir: string; force?: boolean }): InitAgentResult {
  const { dir, force = false } = opts
  const result: InitAgentResult = { written: [], appended: [], skipped: [] }

  // AGENTS.md — append a marked section rather than overwrite the user's file.
  const agentsPath = join(dir, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    ensureDir(agentsPath)
    writeFileSync(agentsPath, AGENTS_SNIPPET)
    result.written.push(agentsPath)
  } else {
    const existing = readFileSync(agentsPath, 'utf8')
    if (existing.includes(AGENTS_MARKER)) {
      // Already injected — re-running would duplicate the section.
      result.skipped.push(agentsPath)
    } else {
      const sep = existing.endsWith('\n') ? '\n' : '\n\n'
      writeFileSync(agentsPath, existing + sep + AGENTS_SNIPPET)
      result.appended.push(agentsPath)
    }
  }

  // Claude Code skill bundle.
  const skillPath = join(dir, '.claude', 'skills', 'agentic-mermaid', 'SKILL.md')
  if (existsSync(skillPath) && !force) {
    result.skipped.push(skillPath)
  } else {
    ensureDir(skillPath)
    writeFileSync(skillPath, INIT_SKILL_MD)
    result.written.push(skillPath)
  }

  // Sample MCP config. Never merge into an existing config automatically.
  const mcpPath = join(dir, '.mcp.json')
  if (existsSync(mcpPath) && !force) {
    result.skipped.push(mcpPath)
  } else {
    ensureDir(mcpPath)
    writeFileSync(mcpPath, MCP_CONFIG_SAMPLE)
    result.written.push(mcpPath)
  }

  return result
}
