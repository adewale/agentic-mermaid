// Doc-sync + no-tautology guards.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_INSTRUCTIONS } from '../cli/agent-instructions.ts'
import { MUTATION_OPS_BY_FAMILY, buildCapabilities } from '../cli/index.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'

const REPO = join(import.meta.dir, '..', '..')

describe('Instructions_for_agents.md', () => {
  test('exists, under 100 lines', () => {
    const path = join(REPO, 'Instructions_for_agents.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8').split('\n').length).toBeLessThanOrEqual(100)
  })
  test('byte-matches am --agent-instructions exactly', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    expect(AGENT_INSTRUCTIONS).toEqual(guide)
  })
  test('quick-start examples verify before every serialize', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const snippets = Array.from(guide.matchAll(/```ts\n([\s\S]*?)\n```/g)).map(m => m[1]!)
    expect(snippets.length).toBeGreaterThan(0)
    for (const snippet of snippets) {
      const lines = snippet.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]!.includes('serializeMermaid(')) continue
        const prior = lines.slice(Math.max(0, i - 5), i).join('\n')
        expect({ line: lines[i], prior }).toMatchObject({ prior: expect.stringContaining('verifyMermaid(') })
      }
    }
  })
})

describe('vocabulary doc-sync', () => {
  test('every warning code in Instructions_for_agents.md and spec', () => {
    const guide = readFileSync(join(REPO, 'Instructions_for_agents.md'), 'utf8')
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(guide).toContain(code)
      expect(spec).toContain(code)
    }
  })
  test('every code tiered + severity', () => {
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(WARNING_SEVERITY[code as keyof typeof WARNING_SEVERITY]).toMatch(/^(error|warning)$/)
      expect(WARNING_TIER[code as keyof typeof WARNING_TIER]).toMatch(/^(structural|geometric)$/)
    }
  })
  test('every MutationOp kind is in spec, capabilities, and MCP SDK declaration', () => {
    const spec = readFileSync(join(REPO, 'AGENT_NATIVE.md'), 'utf8')
    const cap = buildCapabilities()
    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY)) {
      const familyCap = cap.families.find(f => f.id === family)
      expect(familyCap?.mutationOps).toEqual([...ops])
      for (const op of ops) {
        expect(spec).toContain(op)
        expect(SDK_DECLARATION).toContain(op)
      }
    }
  })

  test('MCP SDK declaration exposes all mutable-family narrowers', () => {
    for (const narrower of ['asFlowchart', 'asSequence', 'asTimeline', 'asClass', 'asEr']) {
      expect(SDK_DECLARATION).toContain(narrower)
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
