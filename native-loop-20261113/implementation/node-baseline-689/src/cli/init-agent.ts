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
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { PACKAGE_VERSION } from '../version.ts'

const HOSTED_BASE = 'https://agentic-mermaid.dev'
const HOSTED_LLMS_TXT = `${HOSTED_BASE}/llms.txt`
const HOSTED_AGENT_GUIDE = `${HOSTED_BASE}/agent-instructions.md`

export const AGENTS_MARKER = '<!-- agentic-mermaid:start -->'
const AGENTS_MARKER_END = '<!-- agentic-mermaid:end -->'

const LOCAL_AGENT_GUIDE = 'skills/agentic-mermaid-diagram-workflow/references/operating-guide.md'

export const AGENTS_SNIPPET = `${AGENTS_MARKER}
## Mermaid diagram work

Read the local operating guide at \`${LOCAL_AGENT_GUIDE}\` before creating,
editing, verifying or rendering diagrams. It is the same guide emitted by
\`npx agentic-mermaid --agent-instructions\`; use the installed package's
\`npx agentic-mermaid capabilities --json\` for version-matched schemas.

If the package is unavailable, the hosted guide is ${HOSTED_AGENT_GUIDE} and
discovery starts at ${HOSTED_LLMS_TXT}. Keep private source in a local channel.
${AGENTS_MARKER_END}
`

export const INIT_SKILL_MD = `---
name: agentic-mermaid-diagram-workflow
description: Create, edit, verify or render Mermaid diagrams with Agentic Mermaid; read the included operating guide and use one available channel with version-matched discovery.
---

# Agentic Mermaid — diagram workflow

Read [the operating guide](references/operating-guide.md), included offline with
this skill. It owns channel selection, typed edits, verification, semantic
read-back and response rules. For current installed instructions, run
\`npx agentic-mermaid --agent-instructions\`; discover that version's families
and operations with \`npx agentic-mermaid capabilities --json\`.

The online guide at ${HOSTED_AGENT_GUIDE} describes production and can differ
from an older installed package. Use it when a local guide is unavailable and
keep private source in a local channel.
`

export const MCP_CONFIG_SAMPLE = JSON.stringify(
  {
    mcpServers: {
      'agentic-mermaid': {
        command: 'npx',
        args: ['-y', '--package', `agentic-mermaid@${PACKAGE_VERSION}`, 'agentic-mermaid-mcp'],
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
  writeIfMissing(join(dir, LOCAL_AGENT_GUIDE), AGENT_INSTRUCTIONS, result, force)
  writeIfMissing(join(dir, '.mcp.json'), MCP_CONFIG_SAMPLE, result, force)

  return result
}
