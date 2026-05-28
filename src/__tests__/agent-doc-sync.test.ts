// Doc-sync: am --agent-instructions output must equal AGENTS.md byte-for-byte.
// Also asserts every LayoutWarning code mentioned in code appears in AGENTS.md
// expected-warnings table.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { WARNING_SEVERITY } from '../agent/types.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..')

describe('doc-sync — AGENTS.md ↔ am --agent-instructions', () => {
  test('AGENTS.md exists', () => {
    const path = join(REPO_ROOT, 'AGENTS.md')
    expect(existsSync(path)).toBe(true)
  })

  test('AGENTS.md is under the 100-line bloat budget', () => {
    const path = join(REPO_ROOT, 'AGENTS.md')
    const lines = readFileSync(path, 'utf8').split('\n').length
    expect(lines).toBeLessThanOrEqual(100)
  })

  test('AGENTS.md and AGENT_INSTRUCTIONS share their canonical sections', () => {
    const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8').trim()
    const embedded = AGENT_INSTRUCTIONS.trim()
    // The doc-sync claim: the canonical sections (quick start through
    // anti-patterns) appear in both, character-identical. We compare the
    // body that lives in both (skipping the AGENTS.md-only preface).
    const sections = [
      '## Quick start',
      '## The verify-after-mutate rule',
      '## Expected warnings',
      '## Anti-patterns',
    ]
    for (const heading of sections) {
      const startA = agents.indexOf(heading)
      const startB = embedded.indexOf(heading)
      expect(startA).toBeGreaterThan(-1)
      expect(startB).toBeGreaterThan(-1)
      // Extract through the next heading (or EOF)
      const nextA = nextHeadingAfter(agents, startA)
      const nextB = nextHeadingAfter(embedded, startB)
      const a = agents.slice(startA, nextA).trim()
      const b = embedded.slice(startB, nextB).trim()
      expect(b).toEqual(a)
    }
  })
})

describe('doc-sync — LayoutWarning vocabulary appears in AGENTS.md', () => {
  test('every code in WARNING_SEVERITY is mentioned in AGENTS.md', () => {
    const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(agents).toContain(code)
    }
  })
})

describe('doc-sync — LayoutWarning vocabulary appears in AGENT_NATIVE.md spec', () => {
  test('every code in WARNING_SEVERITY appears in the spec table', () => {
    const path = join(REPO_ROOT, 'AGENT_NATIVE.md')
    const spec = readFileSync(path, 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(spec).toContain(code)
    }
  })

  test('every MutationOp kind appears in the spec table', () => {
    const path = join(REPO_ROOT, 'AGENT_NATIVE.md')
    const spec = readFileSync(path, 'utf8')
    const ops = [
      'add_node',
      'remove_node',
      'rename_node',
      'set_label',
      'add_edge',
      'remove_edge',
    ]
    for (const op of ops) {
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
