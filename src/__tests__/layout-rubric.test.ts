// ============================================================================
// Deterministic layout-correctness rubric in CI (docs/design/system/layout-rubric.md)
// plus the property-based port/outline/hitch oracles.
//
// The rubric metrics implement the empirically validated graph-drawing
// aesthetics (Purchase 1997/2002: crossings, bends; Ware 2002: continuity;
// Kakoulis–Tollis: label unambiguity) — see the design doc for citations.
// The outline oracle is independent of the layout/clipping code, so a port
// regression cannot certify itself healthy.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { assessLayout, hardViolations, onShapeOutline } from '../layout-rubric.ts'
import { shapePorts, diamondFacetPorts } from '../route-contracts.ts'
import { EDGE_FORMS, renderEdgeLine } from './helpers/edge-vocabulary.ts'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import { scoreFixture } from '../../eval/visual-rubric/run.ts'

describe('visual rubric — simple battery (every pattern x direction x shape)', () => {
  for (const fixture of simpleFixtures()) {
    it(fixture.id, () => {
      const scored = scoreFixture(fixture)
      expect(scored.failures).toEqual([])
    })
  }
})

describe('visual rubric — complicated set', () => {
  for (const fixture of complicatedFixtures()) {
    it(fixture.id, () => {
      const scored = scoreFixture(fixture)
      expect(scored.failures).toEqual([])
    })
  }
})

describe('rubric ratchets — the MFA regression scores stay at least this good', () => {
  it('mfa-login: zero crossings, every edge port-anchored or explained', () => {
    const fixture = complicatedFixtures().find(f => f.id === 'mfa-login')!
    const graph = parseMermaid(fixture.source)
    const result = assessLayout(graph, layoutGraphSync(graph))
    expect(result.metrics.edgeCrossings).toBe(0)
    expect(result.metrics.maxBendsPerEdge).toBeLessThanOrEqual(3)
    expect(result.metrics.portAnchoredEdgeRate).toBeGreaterThanOrEqual(0.9)
    expect(result.metrics.portEndpointRate).toBeGreaterThanOrEqual(0.6)
  })
})

describe('rubric ratchets — endpoint outline regressions', () => {
  it('duplicate detours re-anchor source and target endpoints onto shape outlines', () => {
    const graph = parseMermaid(`flowchart LR
  N0[n0]
  N1[n1]
  N2[n2]
  N3[(n3)]
  N4[n4]
  N4 --> N0
  N0 -- go --> N4
  N2 --> N3
  N2 --> N3
  N4 --> N3`)
    const positioned = layoutGraphSync(graph)
    const result = assessLayout(graph, positioned)
    expect(result.violations.filter(v => v.metric === 'offOutlineEndpoints')).toEqual([])
  })
})

describe('visual rubric — peer barycenter ratchets', () => {
  it('tracks same-layer peer fan-out centering as a visual metric', () => {
    const graph = parseMermaid(`flowchart TD
      Dispatcher --> Email[Email Worker]
      Dispatcher --> SMS[SMS Worker]
      Dispatcher --> Push[Push Worker]
      Dispatcher --> Webhook[Webhook Worker]`)
    const result = assessLayout(graph, layoutGraphSync(graph))
    expect(result.metrics.peerBarycenterDelta).toBeLessThanOrEqual(0.75)
  })

  it('tracks non-terminal peer fan-in/fan-out centering as a visual metric', () => {
    const graph = parseMermaid(`flowchart TD
      A[A] --> C[C]
      B[B] --> C
      C --> D[D]
      C --> E[E]
      D --> F[F]
      E --> F`)
    const result = assessLayout(graph, layoutGraphSync(graph))
    expect(result.metrics.peerBarycenterDelta).toBeLessThanOrEqual(0.75)
  })
})

// ============================================================================
// Property-based oracles
// ============================================================================

const SHAPE_WRAPPERS = [
  (l: string) => `[${l}]`,
  (l: string) => `(${l})`,
  (l: string) => `([${l}])`,
  (l: string) => `((${l}))`,
  (l: string) => `{${l}}`,
  (l: string) => `{{${l}}}`,
  (l: string) => `[(${l})]`,
  (l: string) => `[[${l}]]`,
  (l: string) => `[/${l}\\]`,
  (l: string) => `[\\${l}/]`,
  (l: string) => `>${l}]`,
  (l: string) => `[/${l}/]`,
  (l: string) => `[\\${l}\\]`,
] as const

// The seeded counting ratchets at the bottom of this file pin
// `fc.sample(randomFlowchart, { seed: 4242 })` against calibrated
// crossing/separation baselines, so this generator's fast-check shape must stay
// stable — plain solid `-->` only. Widening it (e.g. adding an edge `form`)
// reshuffles the seeded draw and silently moves those baselines; the geometric
// oracles use `randomFlowchartWideEdges` below instead.
const randomFlowchart = fc
  .record({
    direction: fc.constantFrom('LR', 'TD', 'RL', 'BT'),
    nodeCount: fc.integer({ min: 3, max: 6 }),
    shapePicks: fc.array(fc.nat(SHAPE_WRAPPERS.length - 1), { minLength: 6, maxLength: 6 }),
    edgePicks: fc.array(
      fc.record({ a: fc.nat(5), b: fc.nat(5), labeled: fc.boolean() }),
      { minLength: 2, maxLength: 8 },
    ),
  })
  .map(({ direction, nodeCount, shapePicks, edgePicks }) => {
    const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
    const decl = names
      .map((n, i) => `  ${n}${SHAPE_WRAPPERS[shapePicks[i % shapePicks.length]!]!(`n${i}`)}`)
      .join('\n')
    const edges = edgePicks
      .map(({ a, b, labeled }) => [names[a % nodeCount]!, names[b % nodeCount]!, labeled] as const)
      .filter(([a, b]) => a !== b)
      .map(([a, b, labeled]) => `  ${a} ${labeled ? '-- go ' : ''}--> ${b}`)
    if (edges.length === 0) edges.push(`  ${names[0]} --> ${names[1]}`)
    return `flowchart ${direction}\n${decl}\n${edges.join('\n')}`
  })

// Same scaffolding as `randomFlowchart`, but every edge samples the full
// edge-syntax vocabulary (issue #37): all three line styles (solid/dotted/thick),
// uni- and bi-directional, and every marker (arrow/circle/cross), plus open and
// invisible links. The geometric oracles (endpoint-on-outline, ports, hitches,
// rubric) consume this so they run across the whole vocabulary — markers trim
// where an edge meets the shape outline, so this is real geometric coverage, not
// just cosmetic styling. Kept separate from `randomFlowchart` so the seeded
// counting ratchets stay pinned to their calibrated sample.
const randomFlowchartWideEdges = fc
  .record({
    direction: fc.constantFrom('LR', 'TD', 'RL', 'BT'),
    nodeCount: fc.integer({ min: 3, max: 6 }),
    shapePicks: fc.array(fc.nat(SHAPE_WRAPPERS.length - 1), { minLength: 6, maxLength: 6 }),
    edgePicks: fc.array(
      fc.record({ a: fc.nat(5), b: fc.nat(5), labeled: fc.boolean(), form: fc.nat(EDGE_FORMS.length - 1) }),
      { minLength: 2, maxLength: 8 },
    ),
  })
  .map(({ direction, nodeCount, shapePicks, edgePicks }) => {
    const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
    const decl = names
      .map((n, i) => `  ${n}${SHAPE_WRAPPERS[shapePicks[i % shapePicks.length]!]!(`n${i}`)}`)
      .join('\n')
    const edges = edgePicks
      .map(({ a, b, labeled, form }) => [names[a % nodeCount]!, names[b % nodeCount]!, labeled, form] as const)
      .filter(([a, b]) => a !== b)
      .map(([a, b, labeled, form]) => `  ${renderEdgeLine(a, b, EDGE_FORMS[form]!, labeled ? 'go' : '')}`)
    if (edges.length === 0) edges.push(`  ${names[0]} --> ${names[1]}`)
    return `flowchart ${direction}\n${decl}\n${edges.join('\n')}`
  })

// Pinned so CI is reproducible: an unseeded property run draws fresh inputs
// every time, so an intermittent layout regression surfaces as a flaky failure
// on one machine and not another. A fixed seed checks the same 120 generated
// diagrams on every run; bump it deliberately to re-roll the sample.
const PROPERTY_SEED = 0x10ad

// Proper segment-intersection test between two orthogonal polylines, excluding
// shared endpoints (edges that legitimately meet at a node touch, not cross).
type RubricPt = { x: number; y: number }
function polylinesCross(p: RubricPt[], q: RubricPt[]): boolean {
  const orient = (a: RubricPt, b: RubricPt, c: RubricPt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  const same = (a: RubricPt, b: RubricPt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      const [a, b, c, d] = [p[i]!, p[i + 1]!, q[j]!, q[j + 1]!]
      if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue
      if (orient(c, d, a) !== orient(c, d, b) && orient(a, b, c) !== orient(a, b, d)) return true
    }
  }
  return false
}

describe('issue #37 — property generators sample the full edge-syntax vocabulary', () => {
  it('every sampled edge form parses to its declared style and markers (not silently collapsed)', () => {
    for (const form of EDGE_FORMS) {
      const source = `flowchart LR\n  A[a]\n  B[b]\n  ${renderEdgeLine('A', 'B', form)}`
      const positioned = layoutGraphSync(parseMermaid(source))
      expect({ form: form.name, edges: positioned.edges.length }).toEqual({ form: form.name, edges: 1 })
      const e = positioned.edges[0]!
      expect({ form: form.name, style: e.style }).toEqual({ form: form.name, style: form.style })
      expect({ form: form.name, startMarker: e.startMarker }).toEqual({ form: form.name, startMarker: form.startMarker })
      expect({ form: form.name, endMarker: e.endMarker }).toEqual({ form: form.name, endMarker: form.endMarker })
    }
  })

  it('the vocabulary spans all three line styles, both directions, and every marker', () => {
    expect(new Set(EDGE_FORMS.map(f => f.style))).toEqual(new Set(['solid', 'dotted', 'thick', 'invisible']))
    expect(EDGE_FORMS.some(f => f.startMarker === 'arrow' && f.endMarker === 'arrow')).toBe(true)
    expect(new Set(EDGE_FORMS.flatMap(f => [f.startMarker, f.endMarker].filter(Boolean)))).toEqual(new Set(['arrow', 'circle', 'cross']))
    expect(EDGE_FORMS.some(f => f.startMarker === undefined && f.endMarker === undefined)).toBe(true)
  })
})

describe('property: ports and outlines (mathematical oracles over random diagrams)', () => {
  it('every edge endpoint lies on the rendered shape outline — all shapes, all directions', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
        for (const e of positioned.edges) {
          for (const [id, pt] of [
            [e.source, e.points[0]!],
            [e.target, e.points[e.points.length - 1]!],
          ] as const) {
            const node = nodeMap.get(id)
            if (node && !onShapeOutline(node, pt)) return false
          }
        }
        return true
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })

  it('certificate port fields always agree with the geometric port oracle', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
        for (const e of positioned.edges) {
          const cert = e.routeCertificate
          if (!cert) return false
          const check = (id: string, pt: { x: number; y: number }, declared?: string) => {
            const node = nodeMap.get(id)
            if (!node) return declared === undefined
            const ports = shapePorts(node)
            // Mirror production portAt(): cardinal side-midpoints for every
            // shape, plus diamond facet-midpoints (NE/SE/SW/NW). Cardinals are
            // checked first, so the declared port matches the geometric oracle
            // including the 8-port diamond model.
            let actual: string | undefined = (['N', 'E', 'S', 'W'] as const).find(s =>
              Math.abs(ports[s].x - pt.x) <= 0.5 && Math.abs(ports[s].y - pt.y) <= 0.5)
            if (actual === undefined && node.shape === 'diamond') {
              const facets = diamondFacetPorts(node)
              actual = (['NE', 'SE', 'SW', 'NW'] as const).find(f =>
                Math.abs(facets[f].x - pt.x) <= 0.5 && Math.abs(facets[f].y - pt.y) <= 0.5)
            }
            return actual === declared
          }
          if (!check(e.source, e.points[0]!, cert.sourcePort)) return false
          if (!check(e.target, e.points[e.points.length - 1]!, cert.targetPort)) return false
        }
        return true
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })

  it('no hitch survives: no edge bends while a clear lane exists for it', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return assessLayout(graph, positioned).metrics.hitches === 0
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })

  it('every hard rubric metric is zero for arbitrary small diagrams', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return hardViolations(assessLayout(graph, positioned)).length === 0
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })

  // "No two edges cross unless logically required", specialized to the case
  // where a crossing is PROVABLY never required: duplicate edges (the same
  // directed pair written more than once) share BOTH endpoints, so two of them
  // crossing is always a pure routing defect (issue #62). The fan-in pass nests
  // these lanes, but it bails on shapes/dense layouts it does not own, so a few
  // residual crossings survive. A general all-pairs crossing oracle is NOT a
  // valid invariant (non-planar graphs must cross), and even the shared-endpoint
  // sibling case is far from clean today — so this is a downward RATCHET over a
  // fixed seeded sample: the count must not grow. Lower the baseline as the
  // count drops; the target is zero.
  it('duplicate-edge crossings stay at or below the pinned baseline (ratchet, target 0)', () => {
    // Deterministic sample of the same generator the other oracles use.
    const DUPLICATE_CROSSING_BASELINE = 3
    const samples = fc.sample(randomFlowchart, { numRuns: 300, seed: 4242 })
    let crossings = 0
    for (const source of samples) {
      const edges = layoutGraphSync(parseMermaid(source)).edges
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          const a = edges[i]!, b = edges[j]!
          if (a.source === b.source && a.target === b.target && !a.label && !b.label
            && polylinesCross(a.points, b.points)) crossings++
        }
      }
    }
    expect(crossings).toBeLessThanOrEqual(DUPLICATE_CROSSING_BASELINE)
  })

  // Sibling crossings: two edges that share exactly one endpoint (a fan-in,
  // fan-out, or chain-adjacent pair, but not a duplicate). Edges incident to a
  // common node can always be ordered not to cross each other, so these are
  // also never logically required — but unlike duplicates they are far from
  // clean today (the port allocator/router leaves many). This is a separate
  // downward RATCHET to stop the count growing while it is driven toward zero;
  // it is NOT a claim that the current number is acceptable.
  it('sibling-edge crossings stay at or below the pinned baseline (ratchet, target 0)', () => {
    const SIBLING_CROSSING_BASELINE = 95
    const samples = fc.sample(randomFlowchart, { numRuns: 300, seed: 4242 })
    let crossings = 0
    for (const source of samples) {
      const edges = layoutGraphSync(parseMermaid(source)).edges
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          const a = edges[i]!, b = edges[j]!
          const sharesNode = a.source === b.source || a.target === b.target || a.source === b.target || a.target === b.source
          const duplicate = a.source === b.source && a.target === b.target
          if (sharesNode && !duplicate && polylinesCross(a.points, b.points)) crossings++
        }
      }
    }
    expect(crossings).toBeLessThanOrEqual(SIBLING_CROSSING_BASELINE)
  })

  // Duplicates must be VISIBLY separated, not collapsed onto one line. The lane
  // pass spreads them, but bails on shapes/dense layouts it does not own, so a
  // few pairs still land < 11px apart at one end. Downward ratchet; target 0.
  it('unseparated duplicate pairs stay at or below the pinned baseline (ratchet, target 0)', () => {
    const MIN_SEP = 11
    const UNSEPARATED_DUPLICATE_BASELINE = 7
    const dist = (p: RubricPt, q: RubricPt) => Math.hypot(p.x - q.x, p.y - q.y)
    const samples = fc.sample(randomFlowchart, { numRuns: 300, seed: 4242 })
    let unseparated = 0
    for (const source of samples) {
      const edges = layoutGraphSync(parseMermaid(source)).edges
      for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
          const a = edges[i]!, b = edges[j]!
          if (a.source === b.source && a.target === b.target && !a.label && !b.label) {
            const srcGap = dist(a.points[0]!, b.points[0]!)
            const tgtGap = dist(a.points[a.points.length - 1]!, b.points[b.points.length - 1]!)
            if (Math.min(srcGap, tgtGap) < MIN_SEP) unseparated++
          }
        }
      }
    }
    expect(unseparated).toBeLessThanOrEqual(UNSEPARATED_DUPLICATE_BASELINE)
  })
})
