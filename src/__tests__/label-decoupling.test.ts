// Label-decoupling (opt-in via APL_DECOUPLE_LABELS) — an alternative mechanism.
//
// An edge label handed to ELK is sized as a layout element, so ELK reserves a
// cell for it and can DISPLACE the target node off the edge's port lane: a label
// moves a node in ~99% of fuzzed flowcharts. Decoupling omits labels from ELK
// (nodes lay out label-free) and lets the post-ELK passes place the label, so the
// port survives. It is OFF by default — measured net-regressive on the corpus
// (6↑/23↓, incl. +2 crossings; see docs/design/system/layout-guarantees-and-
// robustness.md), because removing the reserved label space repacks nodes in ways
// the rubric penalises.
//
// The CANONICAL port-displacement defect (the minimal repro below — the
// "warnings → warnings line not using the mid-point port" report) is now fixed in
// the DEFAULT path without decoupling. NOTE: this repro is a mixed-label fan-in
// (A->B labelled, B2->B not), so on the default path the co-rank centring squares
// the hub and A->B converges as a symmetric dogleg whose EXIT is still A's
// mid-port (alignLabeledSourcePort yields to the convergence here — it only
// straightens a labelled source into a SINGLE-input target; see
// labeled-source-port-property.test.ts). Either way A leaves at its mid-port, so
// this file keeps the decoupling flag pinned as a regression guard that the
// mid-port exit is preserved (it must not re-break the port it already preserved).

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { alignLabeledSourcePort } from '../layout/passes/port-lanes.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedNode, PositionedEdge } from '../types.ts'

// Minimal reproduction: a label on A→B + a second feeder into B + an outflow
// from B. Remove any one and A→B is already mid-port.
const MIN = 'flowchart LR\n  A -->|x| B\n  B2 --> B\n  B --> C'

function abPortGap(): { portGap: number; straight: boolean } {
  const p = layoutGraphSync(parseMermaid(MIN))
  const A = p.nodes.find(n => n.id === 'A')!
  const ab = p.edges.find(e => e.source === 'A' && e.target === 'B')!
  expect(p.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'B2', 'C'])
  expect(p.edges.map(edge => [edge.source, edge.target, edge.label])).toEqual([['A', 'B', 'x'], ['B2', 'B', undefined], ['B', 'C', undefined]])
  expect(ab.labelBlock?.text).toBe('x')
  const center = ab.labelPosition!, text = ab.labelBlock!
  // Actual default label paint: 8px pill padding plus its 4px opaque halo.
  const label = { x0: center.x - text.width / 2 - 12, x1: center.x + text.width / 2 + 12,
    y0: center.y - text.height / 2 - 12, y1: center.y + text.height / 2 + 12 }
  const meets = (box: typeof label): boolean => Math.max(label.x0, box.x0) < Math.min(label.x1, box.x1)
    && Math.max(label.y0, box.y0) < Math.min(label.y1, box.y1)
  for (const node of p.nodes) expect(meets({ x0: node.x - 0.375, x1: node.x + node.width + 0.375,
    y0: node.y - 0.375, y1: node.y + node.height + 0.375 })).toBe(false)
  for (const edge of p.edges) {
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1]!, b = edge.points[index]!
      const x = Number(formatSvgNumber(a.x)) === Number(formatSvgNumber(b.x))
      const y = Number(formatSvgNumber(a.y)) === Number(formatSvgNumber(b.y))
      expect(x || y).toBe(true)
      if (edge !== ab) expect(meets({ x0: Math.min(a.x, b.x) - 0.5, x1: Math.max(a.x, b.x) + 0.5,
        y0: Math.min(a.y, b.y) - 0.5, y1: Math.max(a.y, b.y) + 0.5 })).toBe(false)
    }
    const served = edge.points.map(point => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) }))
    const end = served.at(-1)!, before = served.findLast(point => point.x !== end.x || point.y !== end.y)!
    const ux = Math.sign(end.x - before.x), uy = Math.sign(end.y - before.y)
    expect((ux === 0) !== (uy === 0)).toBe(true)
    // Canonical 8×5 arrow geometry in its actual served cardinal orientation,
    // expanded by the resource's round 0.75px outline. No automatic face pin.
    const corners = [end, { x: end.x - 8 * ux - 2.5 * uy, y: end.y - 8 * uy + 2.5 * ux },
      { x: end.x - 8 * ux + 2.5 * uy, y: end.y - 8 * uy - 2.5 * ux }]
    expect(meets({ x0: Math.min(...corners.map(point => point.x)) - 0.375, x1: Math.max(...corners.map(point => point.x)) + 0.375,
      y0: Math.min(...corners.map(point => point.y)) - 0.375, y1: Math.max(...corners.map(point => point.y)) + 0.375 })).toBe(false)
  }
  return { portGap: Math.abs(Math.round(ab.points[0]!.y) - Math.round(A.y + A.height / 2)), straight: ab.points.length === 2 }
}

describe('label decoupling (APL_DECOUPLE_LABELS)', () => {
  test('default path: the labelled edge keeps its mid-port (symmetric fan-in dogleg)', () => {
    const previous = process.env.APL_DECOUPLE_LABELS
    delete process.env.APL_DECOUPLE_LABELS
    try {
      expect(abPortGap().portGap).toBeLessThanOrEqual(1) // mid-port exit — co-rank centres the hub, no decoupling
    } finally {
      if (previous === undefined) delete process.env.APL_DECOUPLE_LABELS
      else process.env.APL_DECOUPLE_LABELS = previous
    }
  })

  test('with decoupling enabled: the labelled edge stays straight with its label clear', () => {
    const previous = process.env.APL_DECOUPLE_LABELS
    process.env.APL_DECOUPLE_LABELS = '1'
    try {
      // Without ELK's reserved label cell the A->B gap is one 48px layer: the
      // pill, the halo clearance beside A and beside B's arrowhead, and B2's
      // terminal hook do not all fit on A's mid-port lane (#566), so the slide
      // onto it is refused and A->B straightens on B's side instead.
      expect(abPortGap().straight).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.APL_DECOUPLE_LABELS
      else process.env.APL_DECOUPLE_LABELS = previous
    }
  })
})


test('materialized initial label seat must clear foreign shaft ink before publication', () => {
  const node = (id: string, x: number, y: number, width = 60, height = 40): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width, height })
  const nodes = [node('A', 104, 100), node('B2', 40, 40), node('B', 224, 70), node('C', 332, 70),
    node('P', 200, 0, 16.5, 20), node('Q', 200, 130, 16.5, 20)]
  const edge = (source: string, target: string, points: Array<{ x: number; y: number }>): PositionedEdge => ({ source, target, points, style: 'solid', hasArrowStart: false, hasArrowEnd: true })
  const labelled = { ...edge('A', 'B', [{ x: 164, y: 120 }, { x: 212, y: 120 }, { x: 212, y: 96 }, { x: 224, y: 96 }]), label: 'x', labelPosition: { x: 208, y: 120 } }
  const edges = [labelled, edge('B2', 'B', [{ x: 100, y: 60 }, { x: 212, y: 60 }, { x: 212, y: 84 }, { x: 224, y: 84 }]),
    edge('B', 'C', [{ x: 284, y: 90 }, { x: 332, y: 90 }]), edge('P', 'Q', [{ x: 208.25, y: 20 }, { x: 208.25, y: 130 }])]
  const foreign = structuredClone(edges[3]!)
  alignLabeledSourcePort(nodes, edges, [], parseMermaid(MIN + '\n  P --> Q'), 'LR', resolveRenderStyle({}))
  expect(labelled.points).toEqual([{ x: 164, y: 90 }, { x: 224, y: 90 }])
  expect(nodes[0]!.y + nodes[0]!.height / 2).toBe(90)
  expect(edges[3]).toEqual(foreign)
  // Prepared default 11px 'x' width 7.59, plus8px pill padding+4pxhalo.
  // The straightener's initial center194 hasclearcards but its halo covers
  // the foreign actual1px vertical shaft. The existing11slots must reseat it.
  expect(194 + 7.59 / 2 + 12).toBeGreaterThan(208.25 - 0.5)
  expect(labelled.labelPosition.x + 7.59 / 2 + 12).toBeLessThan(208.25 - 0.5)
  expect(labelled.labelPosition.y).toBe(90)
})
