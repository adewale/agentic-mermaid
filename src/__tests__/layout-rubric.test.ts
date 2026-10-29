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
import { fcParameters } from './helpers/fc-parameters.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { assessLayout, countParallelRouteOverlaps, hardViolations, onShapeOutline } from '../layout-rubric.ts'
import { graphReachability } from '../layout/geometry.ts'
import { shapePorts, diamondFacetPorts } from '../route-contracts.ts'

it('peer topology preserves direction and cycles across reused traversal storage', () => {
  const reaches = graphReachability([
    { source: 'A', target: 'B' }, { source: 'B', target: 'C' },
    { source: 'B', target: 'C' }, { source: 'C', target: 'A' },
    { source: 'D', target: 'E' },
  ])
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [from, to, expected] of [
      ['A', 'C', true], ['C', 'B', true], ['A', 'D', false],
      ['D', 'E', true], ['E', 'D', false], ['E', 'A', false],
      ['isolated', 'isolated', true], ['isolated', 'A', false],
    ] as const) expect(reaches(from, to)).toBe(expected)
  }
})
import { EDGE_FORMS, renderEdgeLine } from './helpers/edge-vocabulary.ts'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import { scoreFixture } from '../../eval/visual-rubric/run.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'

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
  it('checks retained styled label geometry rather than default font metrics', () => {
    const graph = parseMermaid('flowchart LR\nA -- first --> B\nB -- second --> A')
    const styleFace = resolveStyleStackWithFace({ roles: { edge: { fontSize: 24 } } }).face
    const positioned = layoutGraphSync(graph, { styleFace })
    expect(positioned.edges.find(edge => edge.source === 'B')?.labelBlock?.height).toBeCloseTo(31.2)
    expect(assessLayout(graph, positioned).metrics.labelOffRoute).toBe(0)
  })

  it('mfa-login: zero crossings, every edge port-anchored or explained', () => {
    const fixture = complicatedFixtures().find(f => f.id === 'mfa-login')!
    const graph = parseMermaid(fixture.source)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const result = assessLayout(graph, positioned)
    expect(result.metrics.edgeCrossings).toBe(0)
    expect(result.metrics.maxBendsPerEdge).toBeLessThanOrEqual(3)
    expect(result.metrics.portAnchoredEdgeRate).toBeGreaterThanOrEqual(0.9)
    expect(result.metrics.portEndpointRate).toBeGreaterThanOrEqual(0.6)
  })
})

describe('rubric ratchets — endpoint outline regressions', () => {
  it('keeps crossings ahead of preferred duplicate endpoint spacing in mixed parallel feedback routes', () => {
    const graph = parseMermaid('flowchart LR\nN0((n0))\nN1[\\n1/]\nN2[[n2]]\nN2 -- go --> N1\nN2 -- go --> N1\nN2 --> N1\nN1 --> N2\nN0 --> N1\nN2 --> N1\nN1 --> N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    // The previous lane rewrite bought >11px spacing with six crossings.
    // Keeping this feasible candidate removes all six; spacing stays positive.
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
    expect(countParallelRouteOverlaps(positioned.edges)).toBe(0)
    const pair = positioned.edges.filter(edge => edge.source === 'N2' && edge.target === 'N1' && !edge.label)
    expect(pair).toHaveLength(2)
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    expect(distance(pair[0]!.points[0]!, pair[1]!.points[0]!)).toBeGreaterThan(0)
    expect(distance(pair[0]!.points.at(-1)!, pair[1]!.points.at(-1)!)).toBeGreaterThan(0)
  })
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
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const result = assessLayout(graph, positioned)
    expect(result.violations.filter(v => v.metric === 'offOutlineEndpoints')).toEqual([])
  })

  it('independently recognizes the painted small-circle outline and rejects its layout box', () => {
    const node = {
      id: 'small', label: '', shape: 'circle', semanticShape: 'sm-circ',
      x: 0, y: 0, width: 40, height: 40,
    } as const
    expect(onShapeOutline(node, { x: 28.8, y: 20 })).toBe(true)
    expect(onShapeOutline(node, { x: 40, y: 20 })).toBe(false)

    const graph = parseMermaid('flowchart LR\n  A[Source] --> B@{ shape: sm-circ, label: "" }')
    expect(assessLayout(graph, layoutGraphSync(graph)).metrics.offOutlineEndpoints).toBe(0)
  })

  it('distinguishes circular paint, crossed ellipses, and State choice/history outlines', () => {
    const circle = { id: 'c', label: '', shape: 'circle', x: 0, y: 0, width: 80, height: 40 } as const
    expect(onShapeOutline(circle, { x: 40, y: 0 })).toBe(true)
    expect(onShapeOutline(circle, { x: 80, y: 20 })).toBe(false)
    expect(onShapeOutline({ ...circle, semanticShape: 'cross-circ' }, { x: 80, y: 20 })).toBe(true)

    const choice = { id: 'q', label: '', shape: 'state-choice', x: 0, y: 0, width: 40, height: 20 } as const
    expect(onShapeOutline(choice, { x: 30, y: 5 })).toBe(true)
    expect(onShapeOutline(choice, { x: 40, y: 5 })).toBe(false)
    const history = { id: 'h', label: '', shape: 'state-history', x: 0, y: 0, width: 40, height: 20 } as const
    expect(onShapeOutline(history, { x: 20, y: 0 })).toBe(true)
    expect(onShapeOutline(history, { x: 40, y: 10 })).toBe(false)
  })

  it('independently recognizes painted State pseudostate rings and rejects their layout boxes', () => {
    const node = {
      id: 'start', label: '', shape: 'state-start',
      x: 0, y: 0, width: 20, height: 20,
    } as const
    expect(onShapeOutline(node, { x: 18, y: 10 })).toBe(true)
    expect(onShapeOutline(node, { x: 20, y: 10 })).toBe(false)

    const graph = parseMermaid('stateDiagram-v2\n  direction LR\n  [*] --> Ready\n  Ready --> [*]')
    expect(assessLayout(graph, layoutGraphSync(graph)).metrics.offOutlineEndpoints).toBe(0)
  })
})

describe('visual rubric — peer barycenter ratchets', () => {
  it('tracks same-layer peer fan-out centering as a visual metric', () => {
    const graph = parseMermaid(`flowchart TD
      Dispatcher --> Email[Email Worker]
      Dispatcher --> SMS[SMS Worker]
      Dispatcher --> Push[Push Worker]
      Dispatcher --> Webhook[Webhook Worker]`)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const result = assessLayout(graph, positioned)
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
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const result = assessLayout(graph, positioned)
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
const HUB_FAN_IN_PORT_REGRESSION = `flowchart LR
  N0((n0))
  N1[n1]
  N2[n2]
  N3[n3]
  N4[n4]
  N2 --> N1
  N0 --> N1
  N4 -.-> N1
  N3 --> N0
  N3 --> N2`

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

describe('issue #37 — authored edge syntax retains its styles and markers', () => {
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


})

describe('property: ports and outlines (mathematical oracles over random diagrams)', () => {
  it('certificate port fields always agree with the geometric port oracle', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
        expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
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
      fcParameters({ numRuns: 120, seed: PROPERTY_SEED, examples: [[HUB_FAN_IN_PORT_REGRESSION]] }),
    )
  })

  // Covers every HARD_METRICS entry, including offOutlineEndpoints (each edge
  // endpoint lies on its node's rendered outline, all shapes and directions)
  // and hitches (no edge bends while a clear lane exists for it). The failure
  // names the violated metric and edge.
  it('every hard rubric metric is zero for arbitrary small diagrams', () => {
    fc.assert(
      fc.property(randomFlowchartWideEdges, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
        expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
        expect({ source, hard: hardViolations(assessLayout(graph, positioned)) }).toEqual({ source, hard: [] })
      }),
      fcParameters({ numRuns: 120, seed: PROPERTY_SEED, examples: [[HUB_FAN_IN_PORT_REGRESSION], ['flowchart BT\n  N0[n0]\n  N1{{n1}}\n  N2[/n2\\]\n  N3((n3))\n  N4[n4]\n  N5[n5]\n  N5 --> N2\n  N4 --> N0\n  N4 --> N2\n  N3 --> N0\n  N1 -.- N0\n  N4 --> N3']] }),
    )
  })

  // The three ratchets below measure one deterministic sample of the same
  // generator the other oracles use; lay it out once and share it. Its budgets
  // count findings on this exact corpus, not on arbitrary new samples, so
  // finder controls must not change its seed or cardinality. The universal
  // hard-metric properties above do honor finder controls.
  let ratchetSample: ReturnType<typeof layoutGraphSync>['edges'][] | undefined
  const ratchetEdges = () => (ratchetSample ??= fc.sample(randomFlowchart, { numRuns: 300, seed: 4242 })
    .map(source => {
      const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      return positioned.edges
    }))

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
    const DUPLICATE_CROSSING_BASELINE = 3
    let crossings = 0
    for (const edges of ratchetEdges()) {
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
    let crossings = 0
    for (const edges of ratchetEdges()) {
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
    // One additional sub-11px pair removes six crossings, remains distinct,
    // and shares no route span; the exact priority witness is tested above.
    const UNSEPARATED_DUPLICATE_BASELINE = 8
    const dist = (p: RubricPt, q: RubricPt) => Math.hypot(p.x - q.x, p.y - q.y)
    let unseparated = 0
    for (const edges of ratchetEdges()) {
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
