// Sankey layout invariants as PROPERTIES (task: correctness by construction,
// asserted). d3-sankey owns layering, ordering, and initial coordinates; the
// projection pass preserves those decisions while growing only the affected
// nodes/layers when 1px rendered-width floors need more capacity. These
// guarantees were previously spot-checked on fixtures, so a regression on an
// unusual input had no gate. The assessor in src/family-rubric.ts owns the
// invariant definitions; this file drives it with arbitrary layered DAGs ×
// arbitrary visual configs.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
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
  .map(rows => ({
    source: ['sankey-beta', ...rows.map(r => `  N${r.i},N${r.j},${r.value}`)].join('\n'),
    links: rows.map(r => ({ source: `N${r.i}`, target: `N${r.j}`, value: r.value })),
  }))

const visualArb = fc.record({
  nodeAlignment: fc.constantFrom('justify', 'center', 'left', 'right'),
  nodePadding: fc.integer({ min: 4, max: 30 }),
  nodeWidth: fc.integer({ min: 1, max: 200 }),
  width: fc.integer({ min: 1, max: 1200 }),
  height: fc.integer({ min: 200, max: 800 }),
})

const layout = (source: string, visual: object) => layoutSankeyDiagram(parseSankeyDiagram(source.split('\n')), {}, { ...resolveSankeyVisualConfig(), ...visual })

describe('sankey layout invariants hold on arbitrary inputs', () => {
  test('no assessor violation on any layered DAG × visual config', () => {
    fc.assert(
      fc.property(linksArb, visualArb, ({ source, links }, visual) => {
        const positioned = layout(source, visual)
        expect(positioned.links.map(({ source, target, value }) => ({ source, target, value }))).toEqual(links)
        expect(positioned.nodes.map(node => node.label)).toEqual([...new Set(links.flatMap(link => [link.source, link.target]))])
        for (const node of positioned.nodes) {
          expect(node.x0).toBeGreaterThanOrEqual(0)
          expect(node.y0).toBeGreaterThanOrEqual(0)
          expect(node.x1).toBeLessThanOrEqual(positioned.width + 0.6)
          expect(node.y1).toBeLessThanOrEqual(positioned.height + 0.6)
          expect(node.x1).toBeGreaterThan(node.x0)
          expect(node.y1).toBeGreaterThan(node.y0)
        }
        for (const link of positioned.links) {
          const from = positioned.nodes.find(node => node.label === link.source)!
          const to = positioned.nodes.find(node => node.label === link.target)!
          expect(link.sx).toBeCloseTo(from.x1, 1)
          expect(link.tx).toBeCloseTo(to.x0, 1)
          expect(link.sy - link.width / 2).toBeGreaterThanOrEqual(from.y0 - 0.6)
          expect(link.sy + link.width / 2).toBeLessThanOrEqual(from.y1 + 0.6)
          expect(link.ty - link.width / 2).toBeGreaterThanOrEqual(to.y0 - 0.6)
          expect(link.ty + link.width / 2).toBeLessThanOrEqual(to.y1 + 0.6)
        }
        const result = assessSankeyLayout(positioned)
        expect(result.violations).toEqual([])
      }),
      fcParameters({ numRuns: 60 }),
    )
  })

  test('crossing count is deterministic across repeated layouts', () => {
    fc.assert(
      fc.property(linksArb, visualArb, ({ source }, visual) => {
        const first = assessSankeyLayout(layout(source, visual))
        const second = assessSankeyLayout(layout(source, visual))
        expect(second.metrics).toEqual(first.metrics)
        expect(JSON.stringify(layout(source, visual))).toBe(JSON.stringify(layout(source, visual)))
      }),
      fcParameters({ numRuns: 30 }),
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
