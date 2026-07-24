// Sankey layout invariants as PROPERTIES (task: correctness by construction,
// asserted). The layout constructs these guarantees (1px height floors, ky
// side-capacity scaling, nodePadding collision resolution, label canvas
// growth); until now they were only spot-checked on fixtures, so a regression
// that broke the construction on unusual inputs had no gate. The assessor in
// src/family-rubric.ts owns the invariant definitions; this file drives it
// with arbitrary layered DAGs × arbitrary visual configs.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
// Enter through the agent barrel first: sankey/config.ts participates in the
// family-config-diagnostics module cycle and TDZ-throws as a direct entry.
import '../agent/index.ts'
import { assessSankeyLayout } from '../family-rubric.ts'
import { resolveSankeyVisualConfig } from '../sankey/config.ts'
import { layoutSankeyDiagram } from '../sankey/layout.ts'
import { parseSankeyDiagram } from '../sankey/parser.ts'

// Forward-only links (i < j) keep every generated flow graph acyclic; values
// include 0 (legal) and 2dp floats (the CSV grammar's realistic range).
const linksArb = fc
  .array(
    fc
      .record({
        i: fc.integer({ min: 0, max: 8 }),
        j: fc.integer({ min: 1, max: 9 }),
        value: fc.oneof(
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 0, max: 50_000 }).map(v => v / 100),
        ),
      })
      .filter(({ i, j }) => i < j),
    { minLength: 1, maxLength: 16 },
  )
  .map(rows => ['sankey-beta', ...rows.map(r => `  N${r.i},N${r.j},${r.value}`)].join('\n'))

const visualArb = fc.record({
  nodeAlignment: fc.constantFrom('justify', 'center', 'left', 'right'),
  nodePadding: fc.integer({ min: 4, max: 30 }),
  width: fc.integer({ min: 300, max: 1200 }),
  height: fc.integer({ min: 200, max: 800 }),
})

const layout = (source: string, visual: object) => layoutSankeyDiagram(parseSankeyDiagram(source.split('\n')), {}, { ...resolveSankeyVisualConfig(), ...visual })

describe('sankey layout invariants hold on arbitrary inputs', () => {
  test('no assessor violation on any layered DAG × visual config', () => {
    fc.assert(
      fc.property(linksArb, visualArb, (source, visual) => {
        const result = assessSankeyLayout(layout(source, visual))
        expect(result.violations).toEqual([])
      }),
      { numRuns: 60 },
    )
  })

  test('crossing count is deterministic across repeated layouts', () => {
    fc.assert(
      fc.property(linksArb, visualArb, (source, visual) => {
        const first = assessSankeyLayout(layout(source, visual))
        const second = assessSankeyLayout(layout(source, visual))
        expect(second.metrics).toEqual(first.metrics)
        expect(JSON.stringify(layout(source, visual))).toBe(JSON.stringify(layout(source, visual)))
      }),
      { numRuns: 30 },
    )
  })
})

describe('sankey crossing metric ground truth', () => {
  test('a K2,2 bipartite flow has exactly one straight-line crossing', () => {
    // Complete bipartite {A,B}→{C,D}: whatever vertical order the relaxation
    // picks, exactly one of the four straight centerlines pairs must cross.
    const result = assessSankeyLayout(layout('sankey-beta\n  A,C,5\n  A,D,5\n  B,C,5\n  B,D,5', {}))
    expect(result.metrics.linkCrossings).toBe(1)
    expect(result.violations).toEqual([])
  })

  test('a parallel two-lane flow has zero crossings', () => {
    const result = assessSankeyLayout(layout('sankey-beta\n  A,C,5\n  B,D,5', {}))
    expect(result.metrics.linkCrossings).toBe(0)
  })
})
