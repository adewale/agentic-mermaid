// ============================================================================
// Deterministic layout-correctness rubric in CI (docs/design/layout-rubric.md)
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
import { shapePorts } from '../route-contracts.ts'
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
      { numRuns: 120 },
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
            const actual = (['N', 'E', 'S', 'W'] as const).find(s =>
              Math.abs(ports[s].x - pt.x) <= 0.5 && Math.abs(ports[s].y - pt.y) <= 0.5)
            return actual === declared
          }
          if (!check(e.source, e.points[0]!, cert.sourcePort)) return false
          if (!check(e.target, e.points[e.points.length - 1]!, cert.targetPort)) return false
        }
        return true
      }),
      { numRuns: 120 },
    )
  })

  it('no hitch survives: no edge bends while a clear lane exists for it', () => {
    fc.assert(
      fc.property(randomFlowchart, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return assessLayout(graph, positioned).metrics.hitches === 0
      }),
      { numRuns: 120 },
    )
  })

  it('every hard rubric metric is zero for arbitrary small diagrams', () => {
    fc.assert(
      fc.property(randomFlowchart, source => {
        const graph = parseMermaid(source)
        const positioned = layoutGraphSync(graph)
        return hardViolations(assessLayout(graph, positioned)).length === 0
      }),
      { numRuns: 120 },
    )
  })
})
