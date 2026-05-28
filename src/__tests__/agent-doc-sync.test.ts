// Doc-sync: AGENTS.md byte-syncs with am --agent-instructions; warning
// vocabulary appears in spec; AGENTS.md under bloat budget.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..')

describe('doc-sync — AGENTS.md', () => {
  test('exists', () => {
    expect(existsSync(join(REPO_ROOT, 'AGENTS.md'))).toBe(true)
  })

  test('under 100-line bloat budget', () => {
    const lines = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8').split('\n').length
    expect(lines).toBeLessThanOrEqual(100)
  })

  test('shared canonical sections byte-match the embedded version', () => {
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

describe('doc-sync — warning vocabulary', () => {
  test('every WARNING_SEVERITY code is in AGENTS.md', () => {
    const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(agents).toContain(code)
    }
  })

  test('every code in spec', () => {
    const spec = readFileSync(join(REPO_ROOT, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(spec).toContain(code)
    }
  })

  test('every code has a tier', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|metric)$/)
    }
  })

  test('every MutationOp kind in spec', () => {
    const spec = readFileSync(join(REPO_ROOT, 'AGENT_NATIVE.md'), 'utf8')
    for (const op of ['add_node', 'remove_node', 'rename_node', 'set_label', 'add_edge', 'remove_edge']) {
      expect(spec).toContain(op)
    }
  })
})

function nextHeadingAfter(text: string, from: number): number {
  const slice = text.slice(from + 1)
  const m = slice.match(/\n##\s/)
  if (!m || m.index === undefined) return text.length
  return from + 1 + m.index
}
