// Doc-sync + no-tautology guards.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'

const REPO = join(import.meta.dir, '..', '..')

describe('AGENTS.md', () => {
  test('exists, under 100 lines', () => {
    const path = join(REPO, 'AGENTS.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8').split('\n').length).toBeLessThanOrEqual(100)
  })
  test('canonical sections byte-match am --agent-instructions', () => {
    const agents = readFileSync(join(REPO, 'AGENTS.md'), 'utf8').trim()
    const embedded = AGENT_INSTRUCTIONS.trim()
    for (const h of ['## Quick start', '## The verify-after-mutate rule', '## Tier 1 vs Tier 2 warnings', '## Anti-patterns']) {
      const a = section(agents, h), b = section(embedded, h)
      expect(a.length).toBeGreaterThan(0)
      expect(b).toEqual(a)
    }
  })
})

describe('vocabulary doc-sync', () => {
  test('every warning code in AGENTS.md and spec', () => {
    const agents = readFileSync(join(REPO, 'AGENTS.md'), 'utf8')
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(agents).toContain(code)
      expect(spec).toContain(code)
    }
  })
  test('every code tiered + severity', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_SEVERITY[code as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric)$/)
    }
  })
  test('every MutationOp kind (both families) in spec', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    for (const op of ['add_node', 'remove_node', 'rename_node', 'set_label', 'add_edge', 'remove_edge',
      'add_participant', 'remove_participant', 'add_message', 'remove_message', 'set_message_text']) {
      expect(spec).toContain(op)
    }
  })
})

describe('spec honesty', () => {
  test('spec no longer claims a seed drives layout', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    // The withSeededRandom apparatus is gone; spec should say determinism is structural.
    expect(spec).not.toContain('withSeededRandom(ctx.rng, fn)')
    expect(spec.toLowerCase()).toContain('there is no seed')
  })
})

describe('no-tautology guard for our own test suite', () => {
  // The prior loop shipped `expect(typeof observedDifference).toBe('boolean')`.
  // Guard against that class of assertion sneaking back into agent tests.
  test('no typeof-tautology assertions in agent tests', () => {
    const dir = join(REPO, 'src', '__tests__')
    const names = require('node:fs').readdirSync(dir)
      .filter((f: string) => f.startsWith('agent') && f.endsWith('.test.ts'))
      .filter((f: string) => f !== 'agent-doc-sync.test.ts') // this guard mentions the pattern in prose
    const TAUT = /expect\(\s*typeof[^)]*\)\s*\.\s*toBe\(\s*['"]boolean['"]\s*\)/
    for (const name of names) {
      // Strip line comments so prose can't trip the guard.
      const code = readFileSync(join(dir, name), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      expect({ file: name, tautology: TAUT.test(code) }).toEqual({ file: name, tautology: false })
    }
  })
})

describe('detector drift guard (agent vs legacy)', () => {
  // The agent's parse.ts has its own header detector (it returns 'state' and
  // 'architecture' which the legacy detectors omit). Three detectors exist —
  // consolidating them would change renderer routing. Instead, lock them
  // against drift on the families they share.
  test('agent.parseMermaid and legacy detectDiagramType agree on common families', async () => {
    const { parseMermaid: agentParse } = await import('../agent/parse.ts')
    const { detectDiagramType } = await import('../mermaid-source.ts')
    const cases: Array<[string, string]> = [
      ['flowchart TD\n  A --> B', 'flowchart'],
      ['sequenceDiagram\n  A->>B: x', 'sequence'],
      ['classDiagram\n  A <|-- B', 'class'],
      ['erDiagram\n  A ||--o{ B : x', 'er'],
      ['timeline\n  2020 : A', 'timeline'],
      ['journey\n  title T\n  section S\n    Wake: 3: Me', 'journey'],
      ['xychart-beta\n  bar [1,2,3]', 'xychart'],
    ]
    for (const [src, expected] of cases) {
      const agentR = agentParse(src)
      expect(agentR.ok).toBe(true)
      if (!agentR.ok) continue
      expect(agentR.value.kind).toBe(expected as never)
      expect(detectDiagramType(src)).toBe(expected as never)
    }
  })
})

describe('shipped distribution artifacts present', () => {
  test('skill bundle + workflow + examples', () => {
    expect(existsSync(join(REPO, '.claude/skills/agentic-mermaid/SKILL.md'))).toBe(true)
    expect(existsSync(join(REPO, '.github/workflows/sync-mermaid-docs.yml'))).toBe(true)
    expect(existsSync(join(REPO, 'examples/agent-loop.ts'))).toBe(true)
  })
})

function section(text: string, heading: string): string {
  const start = text.indexOf(heading)
  if (start < 0) return ''
  const after = text.slice(start + 1)
  const m = after.match(/\n##\s/)
  const end = m && m.index !== undefined ? start + 1 + m.index : text.length
  return text.slice(start, end).trim()
}
