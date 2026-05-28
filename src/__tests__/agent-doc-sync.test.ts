// Doc-sync tests for AGENTS.md, am --agent-instructions, and warning
// vocabulary appearance in the spec.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..')

describe('AGENTS.md', () => {
  test('exists', () => {
    expect(existsSync(join(REPO_ROOT, 'AGENTS.md'))).toBe(true)
  })

  test('under 100-line bloat budget', () => {
    const lines = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8').split('\n').length
    expect(lines).toBeLessThanOrEqual(100)
  })

  test('shared canonical sections match the embedded version', () => {
    const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8').trim()
    const embedded = AGENT_INSTRUCTIONS.trim()
    const sections = [
      '## Quick start',
      '## The verify-after-mutate rule',
      '## Tier 1 vs Tier 2 warnings',
      '## Anti-patterns',
    ]
    for (const heading of sections) {
      const startA = agents.indexOf(heading)
      const startB = embedded.indexOf(heading)
      expect(startA).toBeGreaterThan(-1)
      expect(startB).toBeGreaterThan(-1)
      const a = agents.slice(startA, nextHeadingAfter(agents, startA)).trim()
      const b = embedded.slice(startB, nextHeadingAfter(embedded, startB)).trim()
      expect(b).toEqual(a)
    }
  })
})

describe('warning vocabulary doc-sync', () => {
  test('every code is in AGENTS.md', () => {
    const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(agents).toContain(code)
    }
  })

  test('every code is in spec', () => {
    const spec = readFileSync(join(REPO_ROOT, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(spec).toContain(code)
    }
  })

  test('every code has a tier and severity', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_SEVERITY[code as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric)$/)
    }
  })

  test('every flowchart MutationOp kind in spec', () => {
    const spec = readFileSync(join(REPO_ROOT, 'AGENT_NATIVE.md'), 'utf8')
    for (const op of ['add_node', 'remove_node', 'rename_node', 'set_label', 'add_edge', 'remove_edge']) {
      expect(spec).toContain(op)
    }
  })

  test('every sequence MutationOp kind in spec', () => {
    const spec = readFileSync(join(REPO_ROOT, 'AGENT_NATIVE.md'), 'utf8')
    for (const op of ['add_participant', 'remove_participant', 'add_message', 'remove_message', 'set_message_text']) {
      expect(spec).toContain(op)
    }
  })
})

describe('ESLint config sanity', () => {
  test('shipped at .eslintrc.json', () => {
    const path = join(REPO_ROOT, '.eslintrc.json')
    expect(existsSync(path)).toBe(true)
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    expect(cfg.overrides).toBeDefined()
    const targetingAgent = (cfg.overrides as { files: string[] }[]).some(o =>
      o.files.some((f: string) => f.includes('src/agent'))
    )
    expect(targetingAgent).toBe(true)
  })
})

describe('GitHub Action shipped', () => {
  test('sync-mermaid-docs workflow present', () => {
    expect(existsSync(join(REPO_ROOT, '.github/workflows/sync-mermaid-docs.yml'))).toBe(true)
  })
})

function nextHeadingAfter(text: string, from: number): number {
  const slice = text.slice(from + 1)
  const m = slice.match(/\n##\s/)
  if (!m || m.index === undefined) return text.length
  return from + 1 + m.index
}
