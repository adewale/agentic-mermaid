// `am init-agent` — write a repo-local, agent-agnostic onboarding drop-in.
//
// The generated files are meant for consumer repositories, not this repository:
//   - AGENTS.md: a marked section with the Agentic Mermaid contract.
//   - skills/agentic-mermaid-diagram-workflow/SKILL.md: generic SKILL.md bundle.
//   - .mcp.json: sample MCP config for Code Mode.
//
// The command is idempotent and non-clobbering by default. It deliberately uses
// root `skills/` instead of `.claude/` or `.agents/` so the output mirrors this
// repo's agent-agnostic skill layout.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const HOSTED_BASE = 'https://adewale.github.io/beautiful-mermaid'
const HOSTED_LLMS_TXT = `${HOSTED_BASE}/llms.txt`
const HOSTED_AGENT_GUIDE = `${HOSTED_BASE}/agent-instructions.md`

export const AGENTS_MARKER = '<!-- agentic-mermaid:start -->'
const AGENTS_MARKER_END = '<!-- agentic-mermaid:end -->'
const STRUCTURED_NARROWERS = BUILTIN_FAMILY_METADATA.map(f => `\`${f.narrower}\``).join(' / ')

export const AGENTS_SNIPPET = `${AGENTS_MARKER}
## Editing Mermaid diagrams

Use **Agentic Mermaid** whenever you create or edit Mermaid diagrams. Do not
regenerate an existing diagram from scratch when a typed edit path exists.

New diagrams: author Mermaid source directly, then parse, verify, and render.
Existing structured diagrams: parse → narrow (${STRUCTURED_NARROWERS}) → mutate
→ verify → serialize. Run verify at every commit point and never serialize a
diagram whose verify result you have not inspected.

Useful entrypoints:

- Hosted discovery digest: ${HOSTED_LLMS_TXT}
- Hosted agent guide: ${HOSTED_AGENT_GUIDE}
- Local/package guide: \`npx agentic-mermaid --agent-instructions\`
- Capabilities: \`npx agentic-mermaid capabilities --json\`
- Repo skill: \`skills/agentic-mermaid-diagram-workflow/SKILL.md\`
${AGENTS_MARKER_END}
`

export const INIT_SKILL_MD = `---
name: agentic-mermaid-diagram-workflow
description: Agent-agnostic workflow for authoring and editing Mermaid diagrams with Agentic Mermaid's parse, narrow, mutate, verify, serialize, and render APIs. Use when creating or modifying Mermaid diagrams.
---

# Agentic Mermaid — diagram workflow

Use Agentic Mermaid for Mermaid diagram work. Prefer the narrowest safe channel:

- MCP connected: use \`agentic-mermaid-mcp\` Code Mode and the global \`mermaid.*\` SDK.
- JS/TS available: import from \`agentic-mermaid/agent\`.
- Shell only: use \`npx agentic-mermaid --agent-instructions\` and \`npx agentic-mermaid capabilities --json\`.

## Safe edit loop

New diagrams: author Mermaid source directly, then parse, verify, and render.
Existing structured diagrams:

1. \`parseMermaid(source)\`.
2. Narrow with ${STRUCTURED_NARROWERS}.
3. Edit with \`mutate(d, op)\`; mutation ops use \`kind\`, not \`type\`.
4. Run \`verifyMermaid(d)\` and inspect \`ok\`, \`warnings\`, and layout evidence.
5. Serialize only after inspected verification passes.

Do not concatenate strings or regenerate a whole existing structured diagram when a typed op exists. Every built-in renderable family ships a typed path when the body narrows; only opaque fallback bodies are source-level-only. If you deliberately edit source for an opaque fallback, re-parse and verify before returning it.

## Output artifacts

Agentic Mermaid outputs SVG, PNG, and ASCII:

\`\`\`bash
npx agentic-mermaid render diagram.mmd --format svg > diagram.svg
npx agentic-mermaid render diagram.mmd --format png --output diagram.png
npx agentic-mermaid render diagram.mmd --format ascii > diagram.txt
\`\`\`

Docs:

- ${HOSTED_LLMS_TXT}
- ${HOSTED_AGENT_GUIDE}
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

function writeIfMissing(path: string, content: string, result: InitAgentResult, force: boolean): void {
  if (existsSync(path) && !force) {
    result.skipped.push(path)
    return
  }
  ensureDir(path)
  writeFileSync(path, content)
  result.written.push(path)
}

export function initAgentFiles(opts: { dir: string; force?: boolean }): InitAgentResult {
  const { dir, force = false } = opts
  const result: InitAgentResult = { written: [], appended: [], skipped: [] }

  const agentsPath = join(dir, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    ensureDir(agentsPath)
    writeFileSync(agentsPath, AGENTS_SNIPPET)
    result.written.push(agentsPath)
  } else {
    const existing = readFileSync(agentsPath, 'utf8')
    if (existing.includes(AGENTS_MARKER)) {
      result.skipped.push(agentsPath)
    } else {
      const sep = existing.endsWith('\n') ? '\n' : '\n\n'
      writeFileSync(agentsPath, existing + sep + AGENTS_SNIPPET)
      result.appended.push(agentsPath)
    }
  }

  writeIfMissing(join(dir, 'skills', 'agentic-mermaid-diagram-workflow', 'SKILL.md'), INIT_SKILL_MD, result, force)
  writeIfMissing(join(dir, '.mcp.json'), MCP_CONFIG_SAMPLE, result, force)

  return result
}
