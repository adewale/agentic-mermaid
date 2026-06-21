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

// Pinned so CI is reproducible: an unseeded property run draws fresh inputs
// every time, so an intermittent layout regression surfaces as a flaky failure
// on one machine and not another. A fixed seed checks the same 120 generated
// diagrams on every run; bump it deliberately to re-roll the sample.
const PROPERTY_SEED = 0x10ad

describe('property: ports and outlines (mathematical oracles over random diagrams)', () => {
  it('every edge endpoint lies on the rendered shape outline — all shapes, all directions', () => {
    fc.assert(
      fc.property(randomFlowchart, source => {
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
      fc.property(randomFlowchart, source => {
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
      fc.property(randomFlowchart, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return assessLayout(graph, positioned).metrics.hitches === 0
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })

  it('every hard rubric metric is zero for arbitrary small diagrams', () => {
    fc.assert(
      fc.property(randomFlowchart, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return hardViolations(assessLayout(graph, positioned)).length === 0
      }),
      { numRuns: 120, seed: PROPERTY_SEED },
    )
  })
})
