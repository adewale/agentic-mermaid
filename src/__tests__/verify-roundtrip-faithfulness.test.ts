// Move 3 (promotion): CONTENT_DROPPED_ON_ROUNDTRIP verify lint.
//
// independentFaithfulness was a judge-only helper; it is now a Tier-3 verify
// lint that runs on every verifyMermaid, for every family, reusing the shared
// structural counter. These tests pin: (a) faithful diagrams across families do
// NOT emit it, (b) it is a lint that never flips verify.ok, and (c) it is wired
  // into the warning vocabulary as lint/warning.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../agent/index.ts'
import { WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'

const FAITHFUL: Record<string, string> = {
  flowchart: 'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A',
  sequence: 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n  B-->>A: ok',
  class: 'classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains',
  state: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
  pie: 'pie title Pets\n  "Dogs" : 40\n  "Cats" : 30',
  // A wide spacer's cells are named after its one generated occurrence.
  block: 'block\n  ida space:3 idb idc',
}

describe('CONTENT_DROPPED_ON_ROUNDTRIP verify lint', () => {
  for (const [family, source] of Object.entries(FAITHFUL)) {
    test(`${family}: faithful diagram emits no faithfulness-drop lint`, () => {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const drops = v.warnings.filter(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')
      expect(drops).toEqual([])
    })
  }

  test('it is registered as a lint that cannot flip verify.ok', () => {
    expect(WARNING_TIER.CONTENT_DROPPED_ON_ROUNDTRIP).toBe('lint')
    expect(WARNING_SEVERITY.CONTENT_DROPPED_ON_ROUNDTRIP).toBe('warning')
  })

  test('a clean flowchart verifies ok with the lint active', () => {
    const p = parseMermaid(FAITHFUL.flowchart!)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(verifyMermaid(p.value).ok).toBe(true)
  })

  // The lint compares facts, not the {nodes, edges, groups} tally: a node id
  // no spelling carries re-reads as other content with the same counts
  // (`A;B --> B` re-reads as node A and the edge B --> B). A typed diagram
  // reaches verify that way from Code Mode or a payload; the lint must name
  // the lost node, and stay silent for an id that reads back as itself.
  test('a node id that re-reads as other content is reported with its lost facts', () => {
    const parsed = parseMermaid('flowchart LR\n  X --> B\n  B --> C\n')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const forged = (id: string) => {
      const d = structuredClone(parsed.value) as typeof parsed.value
      if (d.body.kind !== 'flowchart') throw new Error('expected a flowchart body')
      const graph = d.body.graph
      const node = { ...graph.nodes.get('X')!, id, label: id }
      graph.nodes = new Map([[id, node], ...[...graph.nodes].filter(([key]) => key !== 'X')])
      graph.edges = graph.edges.map(edge => edge.source === 'X' ? { ...edge, source: id } : edge)
      return d
    }
    const plain = fc.stringMatching(/^n[a-z0-9]{0,5}$/)
    const unspellable = fc.tuple(plain, fc.constantFrom(';', ';D', '[x]', '(x)', '{x}', ' y', '-->D', ' & D')).map(([id, tail]) => id + tail)
    fc.assert(fc.property(fc.oneof(plain.map((id): [string, boolean] => [id, false]), unspellable.map((id): [string, boolean] => [id, true])), ([id, reported]) => {
      const drops = verifyMermaid(forged(id)).warnings.filter(warning => warning.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')
      if (!reported) return expect(drops).toEqual([])
      expect(drops).toHaveLength(1)
      expect(drops[0]).toMatchObject({ lost: expect.arrayContaining([`node ${id} : ${id}`]) })
    }), fcParameters({ numRuns: 200, examples: [[['A;B', true]]] as Array<[[string, boolean]]> }))
  })

  // Move 6: an OPAQUE body (the wrapper's `before === null` branch) must never
  // produce a faithfulness drop — its faithfulness contract is byte-verbatim,
  // owned by the round-trip-stability gate. Exercises that wrapper branch
  // end-to-end through verify (an unmodeled curve directive → opaque).
  test('an opaque body produces no faithfulness drop', () => {
    const p = parseMermaid('xychart-beta\n  curve basis\n  bar [1, 2, 3]')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('opaque')
    const drops = verifyMermaid(p.value).warnings.filter(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')
    expect(drops).toEqual([])
  })
})


test('verification reports its scope rather than certifying the requested task', () => {
  expect(verifyMermaid('flowchart TD\n A --> B').checks).toEqual({ renderability: 'passed', sourceLoss: 'not-detected', taskCorrectness: 'not-checked' })
  expect(verifyMermaid('flowchart TD\n A --> B', { suppress: ['INTERNAL_ERROR'] }).checks?.renderability).toBe('not-checked')
})


test('retained Pie comments are not reported as lost, including when rendering fails', () => {
  const source = 'pie\n "Dogs": 3 %% rationale'
  const parsed = parseMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  for (const input of [source, parsed.value]) {
    for (const background of ['white', 'notacolor()']) {
      const result = verifyMermaid(input, {
        renderOptions: { mermaidConfig: { themeVariables: { background } } },
      })
      expect(result.warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(false)
      expect(result.checks).toEqual({ renderability: background === 'white' ? 'passed' : 'failed', sourceLoss: 'not-detected', taskCorrectness: 'not-checked' })
    }
  }
})
