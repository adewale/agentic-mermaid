import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { buildRoutePortHints, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { applyRouteContracts, auditRouteContracts, classifyRoutes, diamondFacetPorts, directLaneBlockers, findLabelSlot, findRouteHitches, shapePorts, simplifyPolyline, tryRepairContainerEdge } from '../route-contracts.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { layoutMermaid, parseMermaid as agentParse, verifyMermaid } from '../agent/index.ts'
import type { AnyPort, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { EDGE_FORMS, renderEdgeLine } from './helpers/edge-vocabulary.ts'

// Pin fast-check for THIS file only (restored afterwards) so the command-runner
// mutation lane is reproducible — a mutant must be killed/survive deterministically
// rather than depend on the run's RNG seed. Scoped via before/afterAll so the
// suite's other ~29 fast-check files keep their default (random) seeds.
const priorFastCheck = fc.readConfigureGlobal()
beforeAll(() => fc.configureGlobal({ ...priorFastCheck, seed: 20260620 }))
afterAll(() => fc.configureGlobal(priorFastCheck))

/** The MFA/login regression from issue #25 — every dogleg here had a clear direct lane. */
const MFA_SOURCE = `flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -- No --> B
  C -- Yes --> D{MFA Enabled?}
  D -- No --> G[Create Session]
  D -- Yes --> E[Enter MFA Code]
  E --> F{Code Valid?}
  F -- No --> E
  F -- Yes --> G`

function layoutEdges(source: string): PositionedEdge[] {
  return layoutGraphSync(parseMermaid(source)).edges
}

function findEdge(edges: PositionedEdge[], from: string, to: string, label?: string): PositionedEdge {
  const e = edges.find(e => e.source === from && e.target === to && (label === undefined || e.label === label))
  if (!e) throw new Error(`edge ${from}->${to} not found`)
  return e
}

function legalPorts(node: PositionedNode): Partial<Record<AnyPort, Point>> {
  return node.shape === 'diamond'
    ? { ...shapePorts(node), ...diamondFacetPorts(node) }
    : shapePorts(node)
}

function expectSourceEndpointAtNamedPort(edge: PositionedEdge, source: PositionedNode): void {
  const port = edge.routeCertificate?.sourcePort
  if (!port) throw new Error(`${edge.source}->${edge.target} emitted from a non-port source endpoint`)
  const expected = legalPorts(source)[port]
  if (!expected) throw new Error(`${edge.source}->${edge.target} reported invalid source port ${port}`)
  const actual = edge.points[0]!
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(0.5)
}

function expectTargetEndpointAtNamedPort(edge: PositionedEdge, target: PositionedNode): void {
  const port = edge.routeCertificate?.targetPort
  if (!port) throw new Error(`${edge.source}->${edge.target} entered a non-port target endpoint`)
  const expected = legalPorts(target)[port]
  if (!expected) throw new Error(`${edge.source}->${edge.target} reported invalid target port ${port}`)
  const actual = edge.points[edge.points.length - 1]!
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(0.5)
}

function isStraightHorizontal(e: PositionedEdge): boolean {
  return e.points.length === 2 && Math.abs(e.points[0]!.y - e.points[1]!.y) < 0.01
}

describe('route contracts — MFA/login regression (issue #25 acceptance criterion 1)', () => {
  const edges = layoutEdges(MFA_SOURCE)

  it.each([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
    ['D', 'E'],
    ['E', 'F'],
  ])('primary-forward %s -> %s is a straight horizontal lane', (from, to) => {
    const e = findEdge(edges, from, to)
    expect(isStraightHorizontal(e)).toBe(true)
  })

  it('F -- Yes --> G emits from the diamond vertex and merges into G at its exact W port', () => {
    // F's east side carries one line, so the port ranking emits from the
    // sharp bit; G sits off F's centerline, so a single deliberate Z links
    // vertex to port, converging with D --No--> G at the shared arrowhead.
    const e = findEdge(edges, 'F', 'G')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('W')
    expect(e.points.length).toBeLessThanOrEqual(4)
  })

  it('labeled feedback routes around through the outer channel with its label ON the loop', () => {
    // ELK's feedbackEdges routing (issue #25 §10) sends the retry edges
    // around the nodes; the inline label rides the loop as a layout citizen
    // with reserved space (dot's virtual-node doctrine) — never a pill
    // floating beside a lane it does not belong to.
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const back = findEdge(positioned.edges, from, to)
      expect(back.points.length).toBeGreaterThan(2)
      expect(back.routeCertificate?.invariant).toBe('outer-feedback')
      // The loop reaches an outer channel: beyond both endpoint nodes' band.
      const band = Math.max(
        nodeMap.get(from)!.y + nodeMap.get(from)!.height,
        nodeMap.get(to)!.y + nodeMap.get(to)!.height,
      )
      expect(Math.max(...back.points.map(pt => pt.y))).toBeGreaterThan(band)
      // The label sits ON one of its own segments (unambiguous association).
      const lp = back.labelPosition!
      const onOwnRoute = (() => {
        for (let i = 1; i < back.points.length; i++) {
          const a = back.points[i - 1]!, b = back.points[i]!
          const xLo = Math.min(a.x, b.x) - 1, xHi = Math.max(a.x, b.x) + 1
          const yLo = Math.min(a.y, b.y) - 16, yHi = Math.max(a.y, b.y) + 16
          if (lp.x >= xLo && lp.x <= xHi && lp.y >= yLo && lp.y <= yHi) return true
        }
        return false
      })()
      expect(onOwnRoute).toBe(true)
    }
  })

  it('forward lanes are straight directly: feedback no longer competes for the facing sides', () => {
    // With feedback routed around, B -> C should not even need repair.
    const e = findEdge(edges, 'B', 'C')
    expect(isStraightHorizontal(e)).toBe(true)
  })

  it('unlabeled reciprocal pairs straighten into two parallel lanes', () => {
    const pair = layoutEdges('flowchart LR\n  A --> B\n  B --> A')
    const fwd = findEdge(pair, 'A', 'B')
    const back = findEdge(pair, 'B', 'A')
    expect(isStraightHorizontal(fwd)).toBe(true)
    expect(isStraightHorizontal(back)).toBe(true)
    expect(back.points[0]!.x).toBeGreaterThan(back.points[1]!.x) // runs against the flow
    expect(Math.abs(back.points[0]!.y - fwd.points[0]!.y)).toBeGreaterThanOrEqual(4)
  })

  it('D --No--> G stays an explained detour: node F blocks every candidate lane', () => {
    const e = findEdge(edges, 'D', 'G', 'No')
    expect(e.points.length).toBeGreaterThan(2)
  })

  it('no edge contains consecutive duplicate points', () => {
    for (const e of edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]!, b = e.points[i]!
        expect(Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01).toBe(true)
      }
    }
  })

  it('straightened diamond endpoints land on the diamond polygon, not the bbox corner', () => {
    // B -> C terminates on C (a diamond). On the straight lane the endpoint must
    // satisfy the diamond edge equation |dx|/halfW + |dy|/halfH ≈ 1.
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const c = positioned.nodes.find(n => n.id === 'C')!
    const e = findEdge(positioned.edges, 'B', 'C')
    const end = e.points[e.points.length - 1]!
    const cx = c.x + c.width / 2
    const cy = c.y + c.height / 2
    const lhs = Math.abs(end.x - cx) / (c.width / 2) + Math.abs(end.y - cy) / (c.height / 2)
    expect(Math.abs(lhs - 1)).toBeLessThan(0.02)
  })

  it('straightened labeled edges carry their label onto the new lane', () => {
    const e = findEdge(edges, 'D', 'E', 'Yes')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.labelPosition).toBeDefined()
    // Label sits on the straight segment (same y, x within the segment range).
    expect(Math.abs(e.labelPosition!.y - e.points[0]!.y)).toBeLessThan(0.01)
    expect(e.labelPosition!.x).toBeGreaterThan(e.points[0]!.x)
    expect(e.labelPosition!.x).toBeLessThan(e.points[1]!.x)
  })
})

describe('route contracts — blocked lane (issue #25 acceptance criterion 4)', () => {
  it('a blocker node covering the direct lane prevents straightening and is named in the certificate', () => {
    // X is tall enough to cover every candidate lane between A and B, and the
    // labels keep the fan-out away from the trunk bundler. A -> B must keep
    // its detour and certify exactly why.
    const edges = layoutEdges(`flowchart LR
      A[Start] -- first --> X[Blocker<br>tall<br>taller<br>tallest]
      A -- skip --> B[End]
      X -- onward --> B`)
    const e = findEdge(edges, 'A', 'B')
    expect(e.points.length).toBeGreaterThan(2)
    expect(e.routeCertificate?.invariant).toBe('explained-detour')
    expect(e.routeCertificate?.directLaneClear).toBe(false)
    const blockerIds = (e.routeCertificate?.directLaneBlockedBy ?? []).map(b => b.id)
    expect(blockerIds).toContain('X')
  })
})

describe('route contracts — determinism', () => {
  it('repeated layouts produce byte-identical routes', () => {
    const a = JSON.stringify(layoutEdges(MFA_SOURCE).map(e => e.points))
    const b = JSON.stringify(layoutEdges(MFA_SOURCE).map(e => e.points))
    expect(a).toBe(b)
  })
})

describe('classifyRoutes', () => {
  it('classifies primary, feedback, and self-loop edges by author order', () => {
    const graph = parseMermaid(`flowchart LR
      A --> B
      B --> A
      B --> B
      B --> C`)
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'feedback', 'self-loop', 'primary-forward'])
  })

  it('a reciprocal pair gives the lane to the author-first edge', () => {
    const graph = parseMermaid('flowchart LR\n  B --> C\n  C --> B')
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'feedback'])
  })

  it('edges to a subgraph id are container edges', () => {
    const graph = parseMermaid(`flowchart TD
      Start --> Pipeline
      subgraph Pipeline
        Fetch --> Parse
      end`)
    const classes = classifyRoutes(graph)
    expect(classes[0]).toBe('container')
    expect(classes[1]).toBe('primary-forward')
  })

  it('edges spanning subgraph scopes are cross-hierarchy', () => {
    const graph = parseMermaid(`flowchart TD
      subgraph G1
        A
      end
      subgraph G2
        B
      end
      A --> B`)
    expect(classifyRoutes(graph)[0]).toBe('cross-hierarchy')
  })

  it('longer cycles mark only the closing edge as feedback', () => {
    const graph = parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A')
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'primary-forward', 'feedback'])
  })
})

describe('simplifyPolyline', () => {
  it('removes consecutive duplicates', () => {
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 9, y: 0 }])
  })

  it('removes collinear midpoints but keeps real bends', () => {
    const bent = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }]
    expect(simplifyPolyline(bent)).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }])
  })

  it('leaves two-point lines untouched', () => {
    const line = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    expect(simplifyPolyline(line)).toBe(line)
  })

  it('keeps genuine small bends (only sub-epsilon noise is removed)', () => {
    const smallBend = [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }]
    expect(simplifyPolyline(smallBend)).toEqual(smallBend)
    // Points 0.005 apart count as duplicates.
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 0.005, y: 0.005 }, { x: 10, y: 0 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }])
  })

  // Properties over random polylines (small integer coords so collinear runs and
  // duplicates occur often). simplifyPolyline is a pure normalizer, so it has
  // strong invariants: it never grows the line, preserves the endpoints, leaves
  // no removable point behind (idempotent), and emits no consecutive duplicates.
  it('is an idempotent, endpoint-preserving, non-growing normalizer', () => {
    const EPS = 1e-6
    const ptArb = fc.record({ x: fc.integer({ min: -8, max: 8 }), y: fc.integer({ min: -8, max: 8 }) })
    fc.assert(
      fc.property(fc.array(ptArb, { maxLength: 12 }), points => {
        const out = simplifyPolyline(points)
        // never grows
        if (out.length > points.length) return false
        // endpoints preserved (value-equal) when there is anything to preserve
        if (points.length > 0) {
          if (out[0]!.x !== points[0]!.x || out[0]!.y !== points[0]!.y) return false
          const pe = points[points.length - 1]!, oe = out[out.length - 1]!
          if (oe.x !== pe.x || oe.y !== pe.y) return false
        }
        // no consecutive duplicates remain in a real polyline. The one exception
        // is a fully-degenerate collapse: a spike [p, q, p] (start == end) reduces
        // to the 2-point [p, p]. So the invariant is scoped to outputs of length
        // >= 3 (verified: 0 such dups over 20k random inputs).
        if (out.length >= 3) {
          for (let i = 1; i < out.length; i++) {
            if (Math.abs(out[i]!.x - out[i - 1]!.x) < EPS && Math.abs(out[i]!.y - out[i - 1]!.y) < EPS) return false
          }
        }
        // idempotent: a second pass changes nothing
        return JSON.stringify(simplifyPolyline(out)) === JSON.stringify(out)
      }),
      { numRuns: 500 },
    )
  })
})

describe('certificates', () => {
  it('every positioned edge carries a certificate', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    for (const e of positioned.edges) {
      expect(e.routeCertificate).toBeDefined()
      expect(e.routeCertificate!.edgeIndex).toBeGreaterThanOrEqual(0)
    }
  })

  it('feedback retry edges certify as outer-channel feedback routes (acceptance criterion 2)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect(e.routeCertificate?.routeClass).toBe('feedback')
      // Labeled: no parallel lane can host the pill on-lane, so the route
      // keeps ELK's around-the-nodes loop, certified with the blockers that
      // ruled the parallel lanes out.
      expect(e.routeCertificate?.invariant).toBe('outer-feedback')
      expect(e.routeCertificate?.directLaneClear).toBe(false)
      expect(e.routeCertificate?.directLaneBlockedBy?.length).toBeGreaterThan(0)
    }
  })

  it('a feedback edge whose reverse lane is blocked stays a feedback-detour with blockers', () => {
    // C -> A in a TD chain must route around B; B blocks the span-center lanes
    // but ELK's outer channel is clear, so this one straightens. Block that
    // channel too by flanking B with siblings on both sides.
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
      A --> L[Left sibling]
      A --> B
      A --> R[Right sibling]
      B --> C
      C --> A`))
    const e = findEdge(positioned.edges, 'C', 'A')
    expect(e.routeCertificate?.routeClass).toBe('feedback')
    if (e.points.length > 2) {
      // The flanking siblings block every parallel lane; the route keeps its
      // certified loop (outer channel when it escapes the node band).
      expect(['outer-feedback', 'feedback-detour']).toContain(e.routeCertificate?.invariant ?? 'missing')
      expect(e.routeCertificate?.directLaneClear).toBe(false)
      expect(e.routeCertificate?.directLaneBlockedBy?.length).toBeGreaterThan(0)
    } else {
      // If layout left a clear outer lane after all, the certificate must prove it.
      expect(e.routeCertificate?.directLaneClear).toBe(true)
    }
  })

  it('straight forward lanes certify as straight (natively or by proof)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const e = findEdge(positioned.edges, 'B', 'C')
    expect(e.routeCertificate?.invariant).toBe('straight')
    // With feedback routed around, ELK often produces this lane straight
    // natively — then there is nothing to straighten and no proof is needed.
    if (e.routeCertificate?.straightened) {
      expect(e.routeCertificate?.directLaneClear).toBe(true)
    } else {
      expect(e.routeCertificate?.bendCount).toBe(0)
    }
  })

  it('debug certificates expose dynamic port side, ordered slot, and semantic role', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  A --> C'))
    const ab = findEdge(positioned.edges, 'A', 'B')
    const ac = findEdge(positioned.edges, 'A', 'C')
    expect(ab.routeCertificate?.sourcePortAssignment).toEqual({
      side: 'E', slotIndex: 0, slotCount: 2, role: 'flow-source',
    })
    expect(ac.routeCertificate?.sourcePortAssignment).toEqual({
      side: 'E', slotIndex: 1, slotCount: 2, role: 'flow-source',
    })
    expect(ab.routeCertificate?.targetPortAssignment).toMatchObject({
      side: 'W', slotIndex: 0, slotCount: 1, role: 'flow-target', port: 'W',
    })
  })

  it('pre-layout port hints apply per independent primary edge, not whole-graph all-or-nothing', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  C --> D\n  D --> C')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.get('0:source')).toMatchObject({ nodeId: 'A', side: 'E' })
    expect(hints.byEndpoint.get('0:target')).toMatchObject({ nodeId: 'B', side: 'W' })
    expect(hints.byEndpoint.has('1:source')).toBe(false)
    expect(hints.byEndpoint.has('2:source')).toBe(false)
  })

  it('pre-layout port hints skip nodes inside direction-override subgraphs', () => {
    const graph = parseMermaid('flowchart TD\n  subgraph Inner\n    direction LR\n    A --> B\n  end\n  C --> D')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.has('0:source')).toBe(false)
    expect(hints.byEndpoint.has('0:target')).toBe(false)
    expect(hints.byEndpoint.get('1:source')).toMatchObject({ nodeId: 'C', side: 'S' })
  })

  it('feedback endpoints get flipped-side semantic roles without changing sourcePort/targetPort', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  B --> A'))
    const fwd = findEdge(positioned.edges, 'A', 'B')
    const back = findEdge(positioned.edges, 'B', 'A')
    expect(fwd.routeCertificate?.sourcePortAssignment).toMatchObject({ side: 'E', role: 'flow-source' })
    expect(fwd.routeCertificate?.targetPortAssignment).toMatchObject({ side: 'W', role: 'flow-target' })
    expect(back.routeCertificate?.sourcePortAssignment).toMatchObject({ side: 'W', role: 'feedback-source' })
    expect(back.routeCertificate?.targetPortAssignment).toMatchObject({ side: 'E', role: 'feedback-target' })
    expect(back.routeCertificate?.sourcePort).toBeUndefined()
    expect(back.routeCertificate?.targetPort).toBeUndefined()
  })
})

describe('ROUTE_HITCH tripwire (issue #25 acceptance criterion 3)', () => {
  it('the default pipeline emits no ROUTE_HITCH for the MFA regression', () => {
    const result = verifyMermaid(MFA_SOURCE)
    expect(result.warnings.filter(w => w.code === 'ROUTE_HITCH')).toEqual([])
  })

  it('fires when geometry is mutated after certification (stale-pass detector)', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'B', 'C')
    // Simulate a later pass re-introducing a dogleg without recertifying.
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: a.y + 10 }, { x: b.x, y: a.y + 10 }]
    const hitches = findRouteHitches(positioned, graph)
    expect(hitches.some(h => h.edge === 'B->C')).toBe(true)
    expect(hitches.find(h => h.edge === 'B->C')!.deviationPx).toBe(10)
  })

  it('validation never mutates the layout it inspects', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    findEdge(positioned.edges, 'B', 'C').points = [
      { x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 110 }, { x: 200, y: 110 },
    ]
    const before = JSON.stringify(positioned.edges.map(e => e.points))
    findRouteHitches(positioned, graph)
    expect(JSON.stringify(positioned.edges.map(e => e.points))).toBe(before)
  })
})

describe('route contracts — RL and BT directions (mutation-survivor harvest)', () => {
  it('RL: the forward lane straightens against the reversed axis; labeled feedback loops outside', () => {
    const edges = layoutEdges(`flowchart RL
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.points[0]!.x).toBeGreaterThan(e.points[1]!.x) // forward flow runs right-to-left
    const back = findEdge(edges, 'C', 'B')
    expect(['outer-feedback', 'straight']).toContain(back.routeCertificate?.invariant ?? 'missing')
  })

  it('BT: the forward lane straightens as a vertical lane; labeled feedback loops outside', () => {
    const edges = layoutEdges(`flowchart BT
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(e.points.length).toBe(2)
    expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
    expect(e.points[0]!.y).toBeGreaterThan(e.points[1]!.y) // forward flow runs bottom-to-top
    const back = findEdge(edges, 'C', 'B')
    expect(['outer-feedback', 'straight']).toContain(back.routeCertificate?.invariant ?? 'missing')
  })
})

describe('route contracts — feedback channel lanes', () => {
  it('TD cycle: C -> A loops through the outer channel and enters A from outside the column', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A'))
    const e = findEdge(positioned.edges, 'C', 'A')
    const a = positioned.nodes.find(n => n.id === 'A')!
    const b = positioned.nodes.find(n => n.id === 'B')!
    if (e.points.length === 2) {
      // Collapsed onto a provably clear parallel back-lane.
      expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
      const laneX = e.points[0]!.x
      expect(laneX > b.x + b.width + 4 - 0.01 || laneX < b.x - 4 + 0.01).toBe(true)
    } else {
      // Outer-channel loop: certified, clear of B, terminating on A's border.
      expect(e.routeCertificate?.invariant).toBe('outer-feedback')
      const maxX = Math.max(...e.points.map(pt => pt.x))
      expect(maxX).toBeGreaterThan(b.x + b.width)
      const end = e.points[e.points.length - 1]!
      const onBorder = Math.abs(end.y - a.y) < 1 || Math.abs(end.x - a.x) < 1 ||
        Math.abs(end.x - (a.x + a.width)) < 1 || Math.abs(end.y - (a.y + a.height)) < 1
      expect(onBorder).toBe(true)
    }
  })
})

describe('bundle contract — trunks never pass through nodes', () => {
  function crossesRect(edges: PositionedEdge[], nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>): string[] {
    const hits: string[] = []
    for (const e of edges) {
      for (const n of nodes) {
        if (n.id === e.source || n.id === e.target) continue
        for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1]!, b = e.points[i]!
          const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
          const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
          if (xHi > n.x + 0.5 && xLo < n.x + n.width - 0.5 && yHi > n.y + 0.5 && yLo < n.y + n.height - 0.5) {
            hits.push(`${e.source}->${e.target} through ${n.id}`)
            break
          }
        }
      }
    }
    return hits
  }

  it('an unlabeled fan-out skip-edge no longer routes through the intermediate node', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
      A[Start] --> X[Blocker<br>tall<br>taller<br>tallest]
      A --> B[End]
      X --> B`))
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
    // The skip edge must certify why it cannot be straight.
    const skip = findEdge(positioned.edges, 'A', 'B')
    expect(skip.routeCertificate?.invariant).toBe('explained-detour')
    expect((skip.routeCertificate?.directLaneBlockedBy ?? []).map(b => b.id)).toContain('X')
  })

  it('a clean small unlabeled fan-out uses symmetric emissions, not an accidental shared point', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  A --> C'))
    const b = findEdge(positioned.edges, 'A', 'B')
    const c = findEdge(positioned.edges, 'A', 'C')
    expect(b.routeCertificate?.invariant).toBe('bundle')
    expect(c.routeCertificate?.invariant).toBe('bundle')
    expect(JSON.stringify(b.points[0])).not.toEqual(JSON.stringify(c.points[0]))
    const a = positioned.nodes.find(n => n.id === 'A')!
    const center = a.y + a.height / 2
    expect(Math.abs(Math.abs(b.points[0]!.y - center) - Math.abs(c.points[0]!.y - center))).toBeLessThanOrEqual(0.75)
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
  })

  it('a high-degree rectangle fan-out keeps one clean trunk instead of forming a box', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\n  A --> B\n  A --> C\n  A --> D\n  A --> E'))
    const starts = positioned.edges.map(e => JSON.stringify(e.points[0]))
    const trunks = positioned.edges.map(e => JSON.stringify(e.points[1]))
    expect(new Set(starts).size).toBe(1)
    expect(new Set(trunks).size).toBe(1)
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
  })

  it('clear bundled fan-out branches do not keep tiny visual hitches', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
  A[main] --> B[develop]
  B --> C[feature/auth]
  B --> D[feature/ui]
  C --> E{PR Review}
  D --> E
  E -->|approved| B
  B --> F[release/1.0]
  F --> G{Tests?}
  G -->|pass| A
  G -->|fail| F`))
    const branch = findEdge(positioned.edges, 'B', 'D')
    expect(branch.routeCertificate?.invariant).toBe('bundle')
    expect(branch.points.length).toBe(2)
    expect(Math.abs(branch.points[0]!.y - branch.points[1]!.y)).toBeLessThanOrEqual(0.75)
  })
})

describe('directLaneBlockers (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const node = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, label: id, shape: 'rectangle' as const, x, y, width: w, height: h })
  const edge = (source: string, target: string, points: Array<{ x: number; y: number }>, extra: object = {}): PositionedEdge =>
    ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points, ...extra }) as PositionedEdge
  const probe = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
  const ctx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
    ({ nodes: [], edges: [], axis, style, ...over }) as Parameters<typeof directLaneBlockers>[4]

  it('a node straddling the lane blocks; the same node beyond the 4px clearance does not', () => {
    const blockedBy = (ny: number) =>
      directLaneBlockers(probe, 50, 0, 100, ctx({ nodes: [node('X', 40, ny, 20, 20)] }))
    expect(blockedBy(40)).toEqual([{ kind: 'node', id: 'X' }]) // node spans y 40..60, lane y=50
    expect(blockedBy(53)).toEqual([{ kind: 'node', id: 'X' }]) // top edge at 53: 53 - 4 < 50 still blocks
    expect(blockedBy(55)).toEqual([])                          // top edge at 55: 55 - 4 >= 50 clears
    expect(blockedBy(27)).toEqual([{ kind: 'node', id: 'X' }]) // bottom edge at 47: 47 + 4 > 50 still blocks
    expect(blockedBy(25)).toEqual([])                          // bottom edge at 45: 45 + 4 < 50 clears
  })

  it('a node outside the main-axis range never blocks', () => {
    const blockers = directLaneBlockers(probe, 50, 0, 100, ctx({ nodes: [node('X', 200, 40, 20, 20)] }))
    expect(blockers).toEqual([])
  })

  it("another edge's label blocks the lane within its rendered pill (text + 8px padding) plus clearance", () => {
    const m = measureMultilineText('No', 12, 400)
    const pillHalfH = m.height / 2 + 8
    const pillHalfW = m.width / 2 + 8
    const other = (lx: number, ly: number) =>
      edge('P', 'Q', [{ x: 300, y: 200 }, { x: 320, y: 200 }], { label: 'No', labelPosition: { x: lx, y: ly } })
    const at = (lx: number, ly: number) =>
      directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [other(lx, ly)] }))
    expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
    // Cross-axis boundary: pill edge just inside / outside the 4px clearance.
    expect(at(50, 50 + pillHalfH + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    expect(at(50, 50 + pillHalfH + 4 + 0.5)).toEqual([])
    // Main-axis boundary: pill fully past the lane end plus clearance.
    expect(at(100 + pillHalfW + 4 + 0.5, 50)).toEqual([])
  })

  it('a collinear parallel segment within 4px is a channel conflict; a perpendicular crossing is not', () => {
    const parallel = edge('P', 'Q', [{ x: 20, y: 53 }, { x: 80, y: 53 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [parallel] })))
      .toEqual([{ kind: 'channel', id: 'P->Q' }])
    const farParallel = edge('P', 'Q', [{ x: 20, y: 55 }, { x: 80, y: 55 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [farParallel] }))).toEqual([])
    const crossing = edge('P', 'Q', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [crossing] }))).toEqual([])
    const parallelOutsideRange = edge('P', 'Q', [{ x: 150, y: 50 }, { x: 250, y: 50 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [parallelOutsideRange] }))).toEqual([])
  })

  it('an edge never blocks its own lane, even via a positional copy (same edgeIndex)', () => {
    const original = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }], { edgeIndex: 7 })
    const copy = { ...original, points: original.points.map(p => ({ ...p })) }
    expect(directLaneBlockers(copy, 50, 0, 100, ctx({ edges: [original] }))).toEqual([])
  })

  it("the edge's own label needs lane capacity: pill width + 8px clearance", () => {
    const m = measureMultilineText('quite a long edge label', 12, 400)
    const pillW = m.width + 16
    const labeled = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }], { label: 'quite a long edge label' })
    expect(directLaneBlockers(labeled, 50, 0, pillW + 8 - 1, ctx()))
      .toEqual([{ kind: 'label', id: 'A->B' }])
    expect(directLaneBlockers(labeled, 50, 0, pillW + 8 + 1, ctx())).toEqual([])
  })

  it('a non-square label pill blocks via its true main extent: width (not height), with the full 2x clearance', () => {
    // The label-rect main extent uses rect.w on a horizontal lane plus
    // 2*CLEARANCE (lines ~804-805). A near-square 'No' pill cannot discriminate
    // width from height, so the w/h swap, the zeroed extent, and the clearance
    // term all survive there. A wide, short pill placed just past the lane's
    // LEFT end reaches back into [0,100] ONLY through rect.w + the full
    // clearance: swapping in the (small) height, zeroing the extent, negating
    // 2*CLEARANCE, or turning it into a division all retract the pill clear.
    const m2 = measureMultilineText('wide wide wide wide', 12, 400)
    const w2 = m2.width + 16
    const wideLabel = (lx: number) =>
      edge('P', 'Q', [{ x: 500, y: 500 }, { x: 520, y: 500 }], { label: 'wide wide wide wide', labelPosition: { x: lx, y: 50 } })
    // rMainHi(correct) = rect.x + rect.w + CLEARANCE; this lx puts it a hair past 0.
    const lx = -w2 / 2 - 2
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [wideLabel(lx)] })))
      .toEqual([{ kind: 'label', id: 'P->Q' }])
    // One pill-width further left and even the true extent falls short of the lane.
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [wideLabel(lx - w2)] }))).toEqual([])
  })

  describe('vertical axis (TD): same proofs with main/cross swapped', () => {
    const vAxis = { main: 'y', cross: 'x', sign: 1 } as const
    const vProbe = edge('A', 'B', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    const vCtx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
      ({ nodes: [], edges: [], axis: vAxis, style, ...over }) as Parameters<typeof directLaneBlockers>[4]

    it('node clearance boundaries use width on the cross axis and height on the main axis', () => {
      // Non-square node: w=20 (cross), h=40 (main). Lane x=50 over y 0..100.
      const blockedBy = (nx: number) =>
        directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', nx, 30, 20, 40)] }))
      expect(blockedBy(40)).toEqual([{ kind: 'node', id: 'X' }]) // spans x 40..60
      expect(blockedBy(53)).toEqual([{ kind: 'node', id: 'X' }]) // left edge 53 - 4 < 50
      expect(blockedBy(55)).toEqual([])                          // left edge 55 - 4 >= 50
      expect(blockedBy(27)).toEqual([{ kind: 'node', id: 'X' }]) // right edge 47 + 4 > 50
      expect(blockedBy(25)).toEqual([])
      // Main-axis range honors height: node at y 110..150 is past the lane end (100 + 4).
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', 45, 110, 20, 40)] }))).toEqual([])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', 45, 102, 20, 40)] })))
        .toEqual([{ kind: 'node', id: 'X' }])
    })

    it('label pills swap width/height between axes', () => {
      const m = measureMultilineText('No', 12, 400)
      const pillHalfW = m.width / 2 + 8
      const pillHalfH = m.height / 2 + 8
      const other = (lx: number, ly: number) =>
        edge('P', 'Q', [{ x: 300, y: 200 }, { x: 300, y: 220 }], { label: 'No', labelPosition: { x: lx, y: ly } })
      const at = (lx: number, ly: number) =>
        directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [other(lx, ly)] }))
      expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      // Cross axis is x: boundary at pill w/2 + 4.
      expect(at(50 + pillHalfW + 4 - 0.5, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      expect(at(50 + pillHalfW + 4 + 0.5, 50)).toEqual([])
      // Main axis is y: boundary at pill h/2 + 4 past the lane end.
      expect(at(50, 100 + pillHalfH + 4 + 0.5)).toEqual([])
      expect(at(50, 100 + pillHalfH + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    })

    it('channel conflicts are vertical segments here; horizontal crossings are fine', () => {
      const parallel = edge('P', 'Q', [{ x: 53, y: 20 }, { x: 53, y: 80 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [parallel] })))
        .toEqual([{ kind: 'channel', id: 'P->Q' }])
      const crossing = edge('P', 'Q', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [crossing] }))).toEqual([])
    })

    it('own-label capacity uses pill height on a vertical lane', () => {
      const m = measureMultilineText('No', 12, 400)
      const pillH = m.height + 16
      const labeled = edge('A', 'B', [{ x: 50, y: 0 }, { x: 50, y: 100 }], { label: 'No' })
      expect(directLaneBlockers(labeled, 50, 0, pillH + 8 - 1, vCtx()))
        .toEqual([{ kind: 'label', id: 'A->B' }])
      expect(directLaneBlockers(labeled, 50, 0, pillH + 8 + 1, vCtx())).toEqual([])
    })
  })
})

describe('straightenable shape whitelist', () => {
  it('subroutine nodes straighten like rectangles', () => {
    const edges = layoutEdges(`flowchart LR
      A[[User]] --> B[[Login Page]]
      B --> A`)
    expect(isStraightHorizontal(findEdge(edges, 'A', 'B'))).toBe(true)
    expect(isStraightHorizontal(findEdge(edges, 'B', 'A'))).toBe(true)
  })

  it('service nodes (architecture-projected graphs) straighten like rectangles', () => {
    // The flowchart parser never emits 'service'; architecture graphs do, and
    // they route through the same layoutGraphSync. Build the graph directly.
    const graph = parseMermaid('flowchart LR\n  A[Gateway] --> B[Auth]\n  B --> A')
    for (const node of graph.nodes.values()) node.shape = 'service'
    const positioned = layoutGraphSync(graph)
    expect(isStraightHorizontal(findEdge(positioned.edges, 'A', 'B'))).toBe(true)
    expect(isStraightHorizontal(findEdge(positioned.edges, 'B', 'A'))).toBe(true)
  })

  it('non-straightenable shapes (circle) keep their routes and certify unverified-shape', () => {
    const edges = layoutEdges(`flowchart LR
      A((User)) --> B((Login))
      B --> A`)
    const fwd = findEdge(edges, 'A', 'B')
    if (fwd.points.length > 2) {
      expect(fwd.routeCertificate?.invariant).toBe('unverified-shape')
    }
    expect(fwd.routeCertificate?.straightened).toBeUndefined()
  })
})

describe('validation ignores non-staircase routes', () => {
  it('a diagonal post-certification mutation is not reported as a hitch', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'B', 'C')
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    // Diagonal middle segment: not orthogonal routing, so not a "hitch" —
    // it is a different kind of corruption that EDGE rendering would surface.
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y + 15 }, b]
    expect(findRouteHitches(positioned, graph).filter(h => h.edge === 'B->C')).toEqual([])
  })
})

describe('duplicate parallel edges (fast-check counterexample, pinned)', () => {
  const DUP_SOURCE = 'flowchart TD\n  N2 --> N0\n  N1 --> N2\n  N0 --> N1\n  N2 --> N0\n  N0 --> N1'

  it('duplicate edges between one pair never collapse onto a single overlapping path', () => {
    const positioned = layoutGraphSync(parseMermaid(DUP_SOURCE))
    const dups = positioned.edges.filter(e => e.source === 'N2' && e.target === 'N0')
    expect(dups.length).toBe(2)
    expect(JSON.stringify(dups[0]!.points)).not.toBe(JSON.stringify(dups[1]!.points))
  })

  it('no unexplained hitch survives when duplicates unblock each other mid-pass', () => {
    const graph = parseMermaid(DUP_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(findRouteHitches(positioned, graph)).toEqual([])
  })

  // Issue #62: a hub-centering slide rigidly translated the straight, 2-point
  // duplicate edges that fed the hub, dragging their SOURCE endpoints off the
  // source node's side. Surfaced by the outline oracle in layout-rubric.test.ts.
  //
  // Asserts every edge endpoint lands on its node's rendered outline. The
  // ISSUE_62_REPRO case is the regression guard — it fails on the pre-fix code
  // (the N2->N3 source floats ~32px below N2). The remaining cases are the
  // simplest expressions of the same feature (a multigraph: >1 edge on one
  // directed pair); they passed before the fix too, so they document the
  // contract and guard against future regressions rather than this one.
  const ISSUE_62_REPRO = `flowchart LR
  N0[n0]
  N1[n1]
  N2[n2]
  N3[(n3)]
  N4[n4]
  N4 --> N0
  N0 -- go --> N4
  N2 --> N3
  N2 --> N3
  N4 --> N3`
  const outlineCases: Record<string, string> = {
    // The simplest possible multigraph: two edges, one directed pair.
    'simplest pair — two A-->B edges (LR)': 'flowchart LR\n  A --> B\n  A --> B',
    'simplest pair — two A-->B edges (TD)': 'flowchart TD\n  A --> B\n  A --> B',
    'three parallel A-->B edges (LR)': 'flowchart LR\n  A --> B\n  A --> B\n  A --> B',
    'labeled parallel pair (distinct labels)': 'flowchart LR\n  A -- yes --> B\n  A -- no --> B',
    'duplicate feeder into a shared hub': 'flowchart LR\n  A --> C\n  A --> C\n  B --> C',
    'issue #62 repro (regression guard)': ISSUE_62_REPRO,
  }
  for (const [name, source] of Object.entries(outlineCases)) {
    it(`keeps both endpoints on the node outline — ${name}`, () => {
      const positioned = layoutGraphSync(parseMermaid(source))
      const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
      for (const e of positioned.edges) {
        for (const [id, pt] of [
          [e.source, e.points[0]!],
          [e.target, e.points[e.points.length - 1]!],
        ] as const) {
          const node = nodeMap.get(id)
          if (!node) continue
          expect({ edge: `${e.source}->${e.target}#${e.edgeIndex}`, anchor: id, on: onShapeOutline(node, pt) })
            .toEqual({ edge: `${e.source}->${e.target}#${e.edgeIndex}`, anchor: id, on: true })
        }
      }
    })
  }

  // The parallel-lane contract (yFiles ParallelEdgeRouter / OGDF Kandinsky):
  // duplicate same-direction edges render as evenly-separated parallel lanes,
  // not a cramped near-overlapping bundle. Pre-enhancement the endpoints sat
  // ~7px apart; the lanes now spread to a readable separation that fits the
  // node side. The minimum here (>= 11px) fails on the pre-enhancement routing.
  const MIN_LANE_SEP = 11
  // Feedback (back-edge) duplicates enter the hub's flow-EXIT face and were
  // owned by neither lane pass, so ELK left them ~6px apart. The face-aware
  // distribution now spreads them too. `src`/`tgt` name the duplicated pair.
  const laneCases: Array<{ name: string; source: string; cross: 'x' | 'y'; count: number; src?: string; tgt?: string }> = [
    { name: 'two A-->B (LR)', source: 'flowchart LR\n  A --> B\n  A --> B', cross: 'y', count: 2 },
    { name: 'three A-->B (LR)', source: 'flowchart LR\n  A --> B\n  A --> B\n  A --> B', cross: 'y', count: 3 },
    { name: 'two A-->B (TD)', source: 'flowchart TD\n  A --> B\n  A --> B', cross: 'x', count: 2 },
    { name: 'feedback pair B-->A (LR)', source: 'flowchart LR\n  A --> B\n  B --> A\n  B --> A', cross: 'y', count: 2, src: 'B', tgt: 'A' },
    { name: 'feedback pair B-->A (TD)', source: 'flowchart TD\n  A --> B\n  B --> A\n  B --> A', cross: 'x', count: 2, src: 'B', tgt: 'A' },
  ]
  for (const { name, source, cross, count, src = 'A', tgt = 'B' } of laneCases) {
    it(`routes duplicate edges as separated parallel lanes — ${name}`, () => {
      const positioned = layoutGraphSync(parseMermaid(source))
      const dups = positioned.edges
        .filter(e => e.source === src && e.target === tgt)
        .sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
      expect(dups.length).toBe(count)
      const srcCross = dups.map(e => e.points[0]![cross])
      const tgtCross = dups.map(e => e.points[e.points.length - 1]![cross])
      for (let i = 1; i < dups.length; i++) {
        expect(Math.abs(srcCross[i]! - srcCross[i - 1]!)).toBeGreaterThanOrEqual(MIN_LANE_SEP)
        expect(Math.abs(tgtCross[i]! - tgtCross[i - 1]!)).toBeGreaterThanOrEqual(MIN_LANE_SEP)
      }
      // Distinct polylines — no two duplicates collapse onto one path.
      const paths = new Set(dups.map(e => JSON.stringify(e.points)))
      expect(paths.size).toBe(count)
    })
  }

  // Mixed fan-in contract: a hub that receives a duplicate pair AND other
  // feeders must distribute the WHOLE entry face, not just the pair. Before the
  // target-centric distribution, the pair-only pass left two defects here:
  //   - silent data loss: when the hub had other feeders the pass bailed and
  //     ELK's overlap stood, so the duplicates rendered as one indistinguishable
  //     line ('duplicate feeder into a shared hub' measured 0px apart);
  //   - crowding/crossing: a third distinct feeder landed inside the separated
  //     duplicate band and crossed through it (issue #62 repro: ~7px + 1 cross).
  // Both assert every incoming endpoint is separated and that entry order
  // matches source order (no crossing). Pure distinct fan-in is excluded — it
  // stays a clean merge via the barycenter pass (issue #26 WS3), asserted last.
  const mixedFanInCases: Array<{ name: string; source: string; hub: string }> = [
    { name: 'duplicate feeder into a shared hub', source: 'flowchart LR\n  A --> C\n  A --> C\n  B --> C', hub: 'C' },
    {
      name: 'issue #62 repro (duplicate pair + distinct feeder)',
      source: ISSUE_62_REPRO,
      hub: 'N3',
    },
  ]
  for (const { name, source, hub } of mixedFanInCases) {
    it(`distributes a mixed fan-in without collapse or crossing — ${name}`, () => {
      const positioned = layoutGraphSync(parseMermaid(source))
      const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
      const incoming = positioned.edges.filter(e => e.target === hub)
      expect(incoming.length).toBeGreaterThanOrEqual(3)

      // No silent collapse: every pair of entry endpoints is readably apart.
      const ends = incoming.map(e => e.points[e.points.length - 1]!)
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          expect(Math.hypot(ends[i]!.x - ends[j]!.x, ends[i]!.y - ends[j]!.y))
            .toBeGreaterThanOrEqual(MIN_LANE_SEP)
        }
      }
      // No crossing: order of entry endpoints (top→bottom) matches the order of
      // their sources (top→bottom), with duplicate siblings tie-broken by index.
      const srcCenter = (id: string) => {
        const n = nodeMap.get(id)!
        return n.y + n.height / 2
      }
      const bySource = [...incoming].sort((a, b) =>
        srcCenter(a.source) - srcCenter(b.source) || (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
      const byEntry = [...incoming].sort((a, b) =>
        a.points[a.points.length - 1]!.y - b.points[b.points.length - 1]!.y)
      expect(byEntry.map(e => `${e.source}#${e.edgeIndex}`))
        .toEqual(bySource.map(e => `${e.source}#${e.edgeIndex}`))
    })
  }

  it('leaves pure distinct fan-in as a clean merge (issue #26 WS3 untouched)', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> C\n  B --> C\n  D --> C'))
    const ends = positioned.edges.filter(e => e.target === 'C').map(e => e.points[e.points.length - 1]!)
    expect(ends.length).toBe(3)
    // With no duplicate present the distribution stays out; the feeders merge to
    // a single coincident entry port rather than fanning across the hub side.
    const maxSep = Math.max(...ends.flatMap((p, i) => ends.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.y - q.y))))
    expect(maxSep).toBeLessThan(1)
  })

  // When a duplicate pair feeds a hub that is cross-axis OFFSET from the source
  // (the lanes bend across the flow), the riser columns must nest so the lanes
  // do not cross mid-path. The earlier staggered-by-index columns put the upper
  // lane's riser nearer, so the lower lane's exit run cut across it. This guards
  // the *path*, not just endpoint order, which the mixed-fan-in test covers.
  const properSegmentsCross = (p: Point[], q: Point[]): boolean => {
    const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = 0; j < q.length - 1; j++) {
        const [a, b, c, d] = [p[i]!, p[i + 1]!, q[j]!, q[j + 1]!]
        if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue
        if (o(c, d, a) !== o(c, d, b) && o(a, b, c) !== o(a, b, d)) return true
      }
    }
    return false
  }
  const offsetHubCases: Record<string, { source: string; hub: string }> = {
    'issue #62 repro (N2 above N3)': { source: ISSUE_62_REPRO, hub: 'N3' },
    'shared hub, duplicate above hub': { source: 'flowchart LR\n  A[a] --> C[c]\n  A --> C\n  B[b] --> C', hub: 'C' },
  }
  for (const [name, { source, hub }] of Object.entries(offsetHubCases)) {
    it(`nests offset duplicate lanes without crossing mid-path — ${name}`, () => {
      const positioned = layoutGraphSync(parseMermaid(source))
      const incoming = positioned.edges.filter(e => e.target === hub)
      for (let i = 0; i < incoming.length; i++) {
        for (let j = i + 1; j < incoming.length; j++) {
          expect({ pair: `${incoming[i]!.source}#${incoming[i]!.edgeIndex}×${incoming[j]!.source}#${incoming[j]!.edgeIndex}`, cross: properSegmentsCross(incoming[i]!.points, incoming[j]!.points) })
            .toEqual({ pair: `${incoming[i]!.source}#${incoming[i]!.edgeIndex}×${incoming[j]!.source}#${incoming[j]!.edgeIndex}`, cross: false })
        }
      }
    })
  }
})

describe('straightened certificate finality (fast-check counterexample, pinned)', () => {
  it('clears the straightened bit when a fixed-point retry downgrades to a detour', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart BT
  N1 -- No --> N4
  N4 -- yes --> N1
  N4 --> N3
  N0 -- on error --> N2
  N0 --> N2
  N4 --> N2
  N2 -- yes --> N0
  N1 -- No --> N2
  N3 -- on error --> N0`))
    const e = positioned.edges.find(e => e.source === 'N0' && e.target === 'N2' && e.label === undefined)!
    expect(e.points.length).toBeGreaterThan(2)
    expect(e.routeCertificate?.invariant).toBe('explained-detour')
    expect(e.routeCertificate?.straightened).toBeUndefined()
  })
})

describe('findLabelSlot (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const m = measureMultilineText('No', 12, 400)
  const pillW = m.width + 16
  const mkEdge = (over: object = {}): PositionedEdge =>
    ({ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [], edgeIndex: 0, ...over }) as PositionedEdge
  const ctx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
    ({ nodes: [], edges: [], axis, style, ...over }) as Parameters<typeof findLabelSlot>[3]
  const start = { x: 0, y: 50 }
  const end = { x: 400, y: 50 }

  it('unlabeled edges get the midpoint without obstacle checks', () => {
    expect(findLabelSlot(mkEdge(), start, end, ctx())).toEqual({ x: 200, y: 50 })
  })

  it('a clear lane hosts the label at the midpoint', () => {
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx())).toEqual({ x: 200, y: 50 })
  })

  it("a pill at the midpoint staggers the label to the 1/3 slot", () => {
    const blocker = mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1, label: 'No', labelPosition: { x: 200, y: 50 },
      points: [{ x: 500, y: 500 }, { x: 520, y: 500 }],
    })
    const slot = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [blocker] }))
    expect(slot!.x).toBeCloseTo(400 / 3, 6)
    expect(slot!.y).toBe(50)
  })

  it("another edge's segment through the midpoint forces a stagger; pill-vs-pill respects the exact boundary", () => {
    const crossing = mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1,
      points: [{ x: 200, y: 0 }, { x: 200, y: 100 }],
    })
    const staggered = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [crossing] }))
    expect(staggered!.x).toBeCloseTo(400 / 3, 6)
    // Pills just inside / outside the 2px padding boundary around the midpoint slot.
    const pillAt = (cx: number) => mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1, label: 'No', labelPosition: { x: cx, y: 50 },
      points: [{ x: 500, y: 500 }, { x: 520, y: 500 }],
    })
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [pillAt(200 + pillW + 2 + 0.5)] })))
      .toEqual({ x: 200, y: 50 })
    const bumped = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [pillAt(200 + pillW + 2 - 0.5)] }))
    expect(bumped!.x).toBeCloseTo(400 / 3, 6)
  })

  it('a node covering the whole lane leaves no slot', () => {
    const wall = { id: 'W', label: 'W', shape: 'rectangle' as const, x: 50, y: 20, width: 300, height: 60 }
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ nodes: [wall] }))).toBeNull()
  })

  it("the edge's own endpoints never block its label", () => {
    const a = { id: 'A', label: 'A', shape: 'rectangle' as const, x: 150, y: 20, width: 100, height: 60 }
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ nodes: [a] }))).toEqual({ x: 200, y: 50 })
  })

  it('the slot-overlap test is pinned on all four sides, not just +x: a pill grazing the 2px pad band on the left or on either vertical side staggers the label', () => {
    // rectsOverlap (line ~867) is a four-clause conjunction; the existing
    // boundary test only exercises the +x clause. A blocker pill nudged one
    // pill-extent toward the midpoint slot on each remaining side overlaps it by
    // exactly the +PAD term, forcing a stagger — mutating that +PAD to -PAD on
    // the left / above / below clause would leave the midpoint clear. A long
    // lane keeps the 1/3 fallback slot far from every blocker so the stagger
    // target is unambiguous.
    const pillH = m.height + 16
    const long0 = { x: 0, y: 50 }, long1 = { x: 900, y: 50 } // midpoint 450, 1/3 at 300
    const blockerAt = (cx: number, cy: number) => mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1, label: 'No', labelPosition: { x: cx, y: cy },
      points: [{ x: 5000, y: 5000 }, { x: 5020, y: 5000 }],
    })
    const staggers = (cx: number, cy: number) => {
      const s = findLabelSlot(mkEdge({ label: 'No' }), long0, long1, ctx({ edges: [blockerAt(cx, cy)] }))
      expect(s!.x).toBeCloseTo(900 / 3, 6)
      expect(s!.y).toBe(50)
    }
    staggers(450 - pillW, 50) // left clause (-x)
    staggers(450, 50 + pillH) // below clause (+y)
    staggers(450, 50 - pillH) // above clause (-y)
  })
})

describe('primary-over-feedback priority (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const mkEdge = (source: string, target: string, edgeIndex: number, over: object = {}): PositionedEdge =>
    ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 500, y: 500 }, { x: 520, y: 500 }], edgeIndex, ...over }) as PositionedEdge
  const labelOnLane = { label: 'No', labelPosition: { x: 50, y: 50 } }

  it("a primary lane proof ignores its reciprocal feedback partner's label, and only that label", () => {
    const primary = mkEdge('A', 'B', 0, { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] })
    const partner = mkEdge('B', 'A', 1, labelOnLane)
    const stranger = mkEdge('C', 'D', 2, labelOnLane)
    const prove = (others: PositionedEdge[], classes: Array<'primary-forward' | 'feedback'>) =>
      directLaneBlockers(primary, 50, 0, 100,
        { nodes: [], edges: others, axis, style, classes } as Parameters<typeof directLaneBlockers>[4])
    expect(prove([partner], ['primary-forward', 'feedback'])).toEqual([])
    // A non-reciprocal feedback edge's label still blocks.
    expect(prove([stranger], ['primary-forward', 'feedback', 'feedback'])).toEqual([{ kind: 'label', id: 'C->D' }])
    // Without class information there is no exemption.
    expect(prove([partner], undefined as never)).toEqual([{ kind: 'label', id: 'B->A' }])
  })

  it("a feedback lane proof never ignores the primary partner's label", () => {
    const feedback = mkEdge('B', 'A', 1, { points: [{ x: 100, y: 50 }, { x: 0, y: 50 }] })
    const primary = mkEdge('A', 'B', 0, labelOnLane)
    const blockers = directLaneBlockers(feedback, 50, 0, 100,
      { nodes: [], edges: [primary], axis, style, classes: ['primary-forward', 'feedback'] } as Parameters<typeof directLaneBlockers>[4])
    expect(blockers).toEqual([{ kind: 'label', id: 'A->B' }])
  })
})

describe('ROUTE_HITCH tripwire covers feedback lanes', () => {
  it('a dogleg injected into a straightened back-edge is reported', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A')
    const positioned = layoutGraphSync(graph)
    const back = findEdge(positioned.edges, 'B', 'A')
    expect(back.points.length).toBe(2)
    const [a, b] = back.points as [{ x: number; y: number }, { x: number; y: number }]
    back.points = [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: a.y + 10 }, { x: b.x, y: a.y + 10 }]
    const hitches = findRouteHitches(positioned, graph)
    expect(hitches.some(h => h.edge === 'B->A')).toBe(true)
    expect(hitches.find(h => h.edge === 'B->A')!.deviationPx).toBe(10)
  })
})

describe('container edges anchor on container borders (issue #25 §11.5)', () => {
  const NESTED_DIRECTION_SOURCE = `flowchart LR
  subgraph TOP
    direction TB
    subgraph B1
        direction RL
        i1 -->f1
    end
    subgraph B2
        direction BT
        i2 -->f2
    end
  end
  A --> TOP --> B
  B1 --> B2`

  function flatGroups(groups: PositionedGraph['groups'], out: PositionedGraph['groups'] = []): PositionedGraph['groups'] {
    for (const g of groups) { out.push(g); flatGroups(g.children, out) }
    return out
  }

  it('a container-to-container edge under direction overrides runs border to border, not in the margin', () => {
    // Before this repair the edge floated at the diagram margin, attached to
    // neither container (caught by the ROUTE_CONTAINER_MISANCHOR tripwire).
    const positioned = layoutGraphSync(parseMermaid(NESTED_DIRECTION_SOURCE))
    const e = findEdge(positioned.edges, 'B1', 'B2')
    const groups = flatGroups(positioned.groups)
    const b1 = groups.find(g => g.id === 'B1')!
    const b2 = groups.find(g => g.id === 'B2')!
    const start = e.points[0]!
    const end = e.points[e.points.length - 1]!
    // Start on B1's bottom border, end on B2's top border, one straight lane.
    expect(Math.abs(start.y - (b1.y + b1.height))).toBeLessThan(1)
    expect(start.x).toBeGreaterThan(b1.x)
    expect(start.x).toBeLessThan(b1.x + b1.width)
    expect(Math.abs(end.y - b2.y)).toBeLessThan(1)
    expect(end.x).toBeGreaterThan(b2.x)
    expect(end.x).toBeLessThan(b2.x + b2.width)
    expect(e.points.length).toBe(2)
  })

  it('the route audit is silent across the MFA and container fixtures', () => {
    for (const src of [MFA_SOURCE, NESTED_DIRECTION_SOURCE]) {
      const graph = parseMermaid(src)
      const positioned = layoutGraphSync(graph)
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })
})

describe('layoutMermaid debug exposure (issue #25 acceptance criterion 8, open question 1)', () => {
  it('layoutMermaid(d, { debug: true }) attaches a route certificate to every edge', () => {
    const r = agentParse(MFA_SOURCE)
    if (!r.ok) throw new Error('parse failed')
    const layout = layoutMermaid(r.value, { debug: true })
    expect(layout.edges.length).toBeGreaterThan(0)
    for (const e of layout.edges) {
      expect(e.route).toBeDefined()
      expect(['primary-forward', 'feedback', 'self-loop', 'container', 'cross-hierarchy']).toContain(e.route!.routeClass)
    }
    // Default output stays certificate-free (schema-stable).
    const plain = layoutMermaid(r.value)
    expect(plain.edges.every(e => e.route === undefined)).toBe(true)
  })
})

describe('route audit tripwires fire on post-certification corruption', () => {
  it('skips certified edges with fewer than 2 points instead of throwing', () => {
    for (const points of [[], [{ x: 10, y: 20 }]] as const) {
      const graph = parseMermaid('flowchart LR\n  A --> B')
      const positioned = layoutGraphSync(graph)
      const e = findEdge(positioned.edges, 'A', 'B')
      e.points = [...points]
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })

  it('ROUTE_UNEXPLAINED_BEND: a diagonal segment on a certified edge', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'B', 'C')
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y + 30 }, b]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_UNEXPLAINED_BEND')
  })

  it('ROUTE_STALE_AFTER_NODE_MOVE: a node moved without rerouting its edges', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const a = positioned.nodes.find(n => n.id === 'A')!
    a.y += 200 // node moves; its edge endpoints do not
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_STALE_AFTER_NODE_MOVE' && 'node' in f && f.node === 'A')).toBe(true)
  })

  it('ROUTE_STALE_AFTER_NODE_MOVE: a non-incident node moved onto a certified route', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  C')
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'A', 'B')
    const c = positioned.nodes.find(n => n.id === 'C')!
    c.x = (e.points[0]!.x + e.points[1]!.x) / 2 - c.width / 2
    c.y = e.points[0]!.y - c.height / 2
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_STALE_AFTER_NODE_MOVE' && 'node' in f && f.node === 'C')).toBe(true)
  })

  it('ROUTE_SHAPE_MISANCHOR: an endpoint pulled inside a diamond', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'B', 'C')
    const end = e.points[e.points.length - 1]!
    const c = positioned.nodes.find(n => n.id === 'C')!
    e.points = [e.points[0]!, { x: c.x + c.width / 2, y: end.y }] // deep inside the diamond
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_SHAPE_MISANCHOR')
  })

  it('ROUTE_CONTAINER_MISANCHOR: a container edge detached from its border', () => {
    const graph = parseMermaid(`flowchart TD
      Start --> Pipeline
      subgraph Pipeline
        Fetch --> Parse
      end`)
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'Start', 'Pipeline')
    const end = e.points[e.points.length - 1]!
    e.points = [...e.points.slice(0, -1), { x: end.x + 50, y: end.y + 50 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_CONTAINER_MISANCHOR')
  })

  it("ROUTE_LABEL_ON_SHARED_TRUNK: a label pill parked on another edge's collinear segment", () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    const yes = findEdge(positioned.edges, 'D', 'E', 'Yes')
    const ef = findEdge(positioned.edges, 'E', 'F')
    // Move D->E's pill onto E->F's lane and make D->E share that lane segment.
    const seg = ef.points[0]!
    yes.labelPosition = { x: (ef.points[0]!.x + ef.points[1]!.x) / 2, y: seg.y }
    yes.points = [{ x: ef.points[0]!.x, y: seg.y }, { x: ef.points[1]!.x, y: seg.y }]
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toBe(true)
  })
})

describe('route audit — boundary harvest', () => {
  it('shared-trunk detection works for vertical trunks and respects the collinearity clearance', () => {
    const graph = parseMermaid('flowchart TD\n  A -- down --> B\n  C --> D')
    const positioned = layoutGraphSync(graph)
    const labeled = findEdge(positioned.edges, 'A', 'B')
    const other = findEdge(positioned.edges, 'C', 'D')
    // Both edges share a vertical line under the pill: flagged.
    labeled.points = [{ x: 100, y: 0 }, { x: 100, y: 200 }]
    labeled.labelPosition = { x: 100, y: 100 }
    other.points = [{ x: 102, y: 50 }, { x: 102, y: 150 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
    // Beyond the 4px collinearity clearance: parallel but distinct lanes — not shared.
    other.points = [{ x: 105, y: 50 }, { x: 105, y: 150 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
    // Outside the pill on the main axis: collinear but elsewhere — not shared.
    const m = measureMultilineText('down', 12, 400)
    const pillBottom = 100 + (m.height + 16) / 2
    other.points = [{ x: 100, y: pillBottom + 1 }, { x: 100, y: pillBottom + 60 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
  })

  it('stale vs shape-misanchor boundary: ±2px detachment separates the two codes', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B')
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'A', 'B')
    const b = positioned.nodes.find(n => n.id === 'B')!
    const startOnA = e.points[0]!
    // 1.5px short of B's border: still "attached" (within 2px) but off the
    // perimeter beyond 1px tolerance -> shape misanchor, not stale.
    e.points = [startOnA, { x: b.x - 1.5, y: b.y + b.height / 2 }]
    let codes = auditRouteContracts(positioned, graph).map(f => f.code)
    expect(codes).toContain('ROUTE_SHAPE_MISANCHOR')
    expect(codes).not.toContain('ROUTE_STALE_AFTER_NODE_MOVE')
    // 3px short: detached entirely -> stale.
    e.points = [startOnA, { x: b.x - 3, y: b.y + b.height / 2 }]
    codes = auditRouteContracts(positioned, graph).map(f => f.code)
    expect(codes).toContain('ROUTE_STALE_AFTER_NODE_MOVE')
    expect(codes).not.toContain('ROUTE_SHAPE_MISANCHOR')
    // Exactly on the border: silent.
    e.points = [startOnA, { x: b.x, y: b.y + b.height / 2 }]
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  it('container perimeter tolerance: 0.5px off is fine, 1.5px off fires', () => {
    const graph = parseMermaid('flowchart TD\n  Start --> Pipeline\n  subgraph Pipeline\n    F --> P\n  end')
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'Start', 'Pipeline')
    const end = e.points[e.points.length - 1]!
    e.points = [...e.points.slice(0, -1), { x: end.x, y: end.y - 0.5 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_CONTAINER_MISANCHOR')).toEqual([])
    e.points = [...e.points.slice(0, -1), { x: end.x, y: end.y - 1.5 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_CONTAINER_MISANCHOR')
  })
})

describe('route audit — exact-boundary harvest (mutation survivors)', () => {
  // The audit tripwires are gated on exact tolerances (onRectPerimeter's ±1px,
  // the ±2px "still attached" inflation, the non-incident ±0.5 inset). These
  // pin each boundary on every border/axis, approaching endpoints orthogonally
  // so no spurious ROUTE_UNEXPLAINED_BEND fires.
  function auditAfter(dir: 'LR' | 'TD', mutate: (e: PositionedEdge, b: PositionedNode, a: PositionedNode) => void): string[] {
    const graph = parseMermaid(`flowchart ${dir}\n  A --> B`)
    const p = layoutGraphSync(graph)
    const a = p.nodes.find(n => n.id === 'A')!, b = p.nodes.find(n => n.id === 'B')!
    mutate(findEdge(p.edges, 'A', 'B'), b, a)
    return auditRouteContracts(p, graph).map(f => f.code)
  }

  it('ROUTE_SHAPE_MISANCHOR: a point exactly 1px off any border is still on the perimeter (silent)', () => {
    const cy = (b: PositionedNode) => b.y + b.height / 2
    const cx = (b: PositionedNode) => b.x + b.width / 2
    // left / right via LR (horizontal approach)
    expect(auditAfter('LR', (e, b) => { e.points = [e.points[0]!, { x: b.x - 1, y: cy(b) }] })).toEqual([])
    expect(auditAfter('LR', (e, b) => { e.points = [e.points[0]!, { x: b.x + b.width + 1, y: cy(b) }] })).toEqual([])
    // top / bottom via TD (vertical approach)
    expect(auditAfter('TD', (e, b, a) => { e.points = [{ x: cx(b), y: a.y + a.height }, { x: cx(b), y: b.y - 1 }] })).toEqual([])
    expect(auditAfter('TD', (e, b, a) => { e.points = [{ x: cx(b), y: a.y + a.height }, { x: cx(b), y: b.y + b.height + 1 }] })).toEqual([])
  })

  it('ROUTE_SHAPE_MISANCHOR vs STALE: exactly 2px off a border is still attached (misanchor, not stale)', () => {
    const check = (codes: string[]) => {
      expect(codes).toContain('ROUTE_SHAPE_MISANCHOR')
      expect(codes).not.toContain('ROUTE_STALE_AFTER_NODE_MOVE')
    }
    const cy = (b: PositionedNode) => b.y + b.height / 2
    const cx = (b: PositionedNode) => b.x + b.width / 2
    check(auditAfter('LR', (e, b) => { e.points = [e.points[0]!, { x: b.x - 2, y: cy(b) }] }))
    check(auditAfter('LR', (e, b) => { e.points = [e.points[0]!, { x: b.x + b.width + 2, y: cy(b) }] }))
    check(auditAfter('TD', (e, b, a) => { e.points = [{ x: cx(b), y: a.y + a.height }, { x: cx(b), y: b.y - 2 }] }))
    check(auditAfter('TD', (e, b, a) => { e.points = [{ x: cx(b), y: a.y + a.height }, { x: cx(b), y: b.y + b.height + 2 }] }))
  })

  it('ROUTE_UNEXPLAINED_BEND: fires on a FEEDBACK edge, not only primary-forward', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A')
    const p = layoutGraphSync(graph)
    const fb = findEdge(p.edges, 'B', 'A')
    expect(fb.routeCertificate?.routeClass).toBe('feedback')
    const s = fb.points[0]!, t = fb.points[fb.points.length - 1]!
    fb.points = [s, { x: (s.x + t.x) / 2, y: s.y + 25 }, t] // inject a diagonal
    expect(auditRouteContracts(p, graph).map(f => f.code)).toContain('ROUTE_UNEXPLAINED_BEND')
  })

  it('ROUTE_STALE_AFTER_NODE_MOVE: non-incident overlap respects segment direction and the ±0.5 inset', () => {
    // A cert-less edge isolates the non-incident scan: every other tripwire is
    // cert-gated. C's inner bbox is x(100.5, 159.5), y(100.5, 139.5).
    const stale = (points: Point[]): string[] => {
      const graph = parseMermaid('flowchart LR\n  X --> Y')
      const positioned = {
        nodes: [
          { id: 'X', label: 'X', shape: 'rectangle', x: 0, y: 0, width: 20, height: 20 },
          { id: 'Y', label: 'Y', shape: 'rectangle', x: 400, y: 400, width: 20, height: 20 },
          { id: 'C', label: 'C', shape: 'rectangle', x: 100, y: 100, width: 60, height: 40 },
        ] as PositionedNode[],
        edges: [{ source: 'X', target: 'Y', edgeIndex: 0, points }] as PositionedEdge[],
        groups: [] as PositionedGroup[],
      }
      return auditRouteContracts(positioned, graph).map(f => f.code)
    }
    const STALE = 'ROUTE_STALE_AFTER_NODE_MOVE'
    // entering from the left (only max-x inside) and from the right (only min-x
    // inside) — pins both ends of the segment-direction min/max.
    expect(stale([{ x: 50, y: 120 }, { x: 130, y: 120 }])).toContain(STALE)
    expect(stale([{ x: 130, y: 120 }, { x: 250, y: 120 }])).toContain(STALE)
    expect(stale([{ x: 120, y: 50 }, { x: 120, y: 120 }])).toContain(STALE) // vertical, min/max on y
    // grazing exactly the ±0.5 inset on each axis is NOT an overlap (silent).
    expect(stale([{ x: 50, y: 120 }, { x: 100.5, y: 120 }])).toEqual([])
    expect(stale([{ x: 159.5, y: 120 }, { x: 250, y: 120 }])).toEqual([])
    expect(stale([{ x: 120, y: 50 }, { x: 120, y: 100.5 }])).toEqual([])
  })
})

describe('route audit — property-based & metamorphic coverage (fast-check)', () => {
  // Kill the boundary-tolerance survivors as a CLASS instead of one pixel
  // fixture at a time: fc.double probes offsets arbitrarily close to the ±tol
  // and ±2 thresholds. Plus a metamorphic relation — audit findings must be
  // invariant under whole-diagram translation (catches absolute-coordinate
  // / sign mutants that example-based fixtures miss).
  it('SHAPE_MISANCHOR/STALE trichotomy holds for any offset off a vertical border', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B')
    const base = layoutGraphSync(graph)
    const b = base.nodes.find(n => n.id === 'B')!
    const cy = b.y + b.height / 2
    fc.assert(fc.property(
      fc.constantFrom('left' as const, 'right' as const),
      fc.double({ min: 0, max: 5, noNaN: true }),
      (border, off) => {
        const p = structuredClone(base)
        const e = findEdge(p.edges, 'A', 'B')
        const x = border === 'left' ? b.x - off : b.x + b.width + off
        e.points = [e.points[0]!, { x, y: cy }]
        const codes = auditRouteContracts(p, graph).map(f => f.code)
        const misanchor = codes.includes('ROUTE_SHAPE_MISANCHOR')
        const stale = codes.includes('ROUTE_STALE_AFTER_NODE_MOVE')
        if (off <= 1) return !misanchor && !stale // within tol → on perimeter
        if (off <= 2) return misanchor && !stale  // off perimeter, still attached
        return stale && !misanchor                // detached
      },
    ), { numRuns: 300 })
  })

  it('audit findings are invariant under whole-diagram translation (metamorphic)', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const base = layoutGraphSync(graph)
    const baseCodes = JSON.stringify(auditRouteContracts(base, graph).map(f => f.code).sort())
    fc.assert(fc.property(
      fc.integer({ min: -1000, max: 1000 }),
      fc.integer({ min: -1000, max: 1000 }),
      (dx, dy) => {
        const p = structuredClone(base)
        for (const n of p.nodes) { n.x += dx; n.y += dy }
        for (const e of p.edges) {
          e.points = e.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }))
          if (e.labelPosition) e.labelPosition = { x: e.labelPosition.x + dx, y: e.labelPosition.y + dy }
        }
        return JSON.stringify(auditRouteContracts(p, graph).map(f => f.code).sort()) === baseCodes
      },
    ), { numRuns: 100 })
  })
})

describe('container repair — axis selection harvest', () => {
  function flat(groups: PositionedGraph['groups'], out: PositionedGraph['groups'] = []): PositionedGraph['groups'] {
    for (const g of groups) { out.push(g); flat(g.children, out) }
    return out
  }

  it('side-by-side containers route onto a horizontal lane', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  subgraph TOP
    direction LR
    subgraph B1
        direction TB
        i1 --> f1
    end
    subgraph B2
        direction TB
        i2 --> f2
    end
  end
  A --> TOP --> B
  B1 --> B2`))
    const e = findEdge(positioned.edges, 'B1', 'B2')
    const groups = flat(positioned.groups)
    const b1 = groups.find(g => g.id === 'B1')!
    const b2 = groups.find(g => g.id === 'B2')!
    expect(e.points.length).toBe(2)
    const [s, end] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    // Horizontal border-to-border lane: B1's right border to B2's left border.
    expect(Math.abs(s.y - end.y)).toBeLessThan(0.01)
    expect(Math.abs(s.x - (b1.x + b1.width))).toBeLessThan(1)
    expect(Math.abs(end.x - b2.x)).toBeLessThan(1)
    expect(s.y).toBeGreaterThan(b1.y)
    expect(s.y).toBeLessThan(b1.y + b1.height)
    expect(e.routeCertificate?.invariant).toBe('container-attach')
    expect(auditRouteContracts(positioned, parseMermaid(`flowchart TD
  subgraph TOP
    direction LR
    subgraph B1
        direction TB
        i1 --> f1
    end
    subgraph B2
        direction TB
        i2 --> f2
    end
  end
  A --> TOP --> B
  B1 --> B2`))).toEqual([])
  })

  it('a non-straightenable node end (circle) declines repair gracefully', () => {
    const graph = parseMermaid(`flowchart TD
      S((Start)) --> Pipeline
      subgraph Pipeline
        F --> P
      end`)
    // Must not throw, and the edge still certifies as container-attach.
    const positioned = layoutGraphSync(graph)
    const e = findEdge(positioned.edges, 'S', 'Pipeline')
    expect(e.routeCertificate?.invariant).toBe('container-attach')
  })
})

describe('tryRepairContainerEdge (unit)', () => {
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const rect = (id: string, x: number, y: number, shape = 'rectangle') =>
    ({ id, label: id, shape, x, y, width: 40, height: 40 })
  const mkEdge = (points: Array<{ x: number; y: number }>): PositionedEdge =>
    ({ source: 'S', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points, edgeIndex: 0 }) as PositionedEdge
  const repair = (edge: PositionedEdge, nodes: ReturnType<typeof rect>[]) =>
    tryRepairContainerEdge(
      edge,
      new Map() as Parameters<typeof tryRepairContainerEdge>[1],
      new Map(nodes.map(n => [n.id, n])) as unknown as Parameters<typeof tryRepairContainerEdge>[2],
      { nodes, edges: [edge], axis: { main: 'x', cross: 'y', sign: 1 }, style } as unknown as Parameters<typeof tryRepairContainerEdge>[3],
    )

  // S sits below T (gap 60px in y), so the only positive gap is the reversed
  // lane (target-above-source, sign:-1) — the direction the integration suite
  // never exercised. A clear vertical channel at the shared x straightens it.
  it('repairs a dog-legged container edge in the reversed direction (target above source)', () => {
    const edge = mkEdge([{ x: 20, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 40 }, { x: 20, y: 40 }])
    const ok = repair(edge, [rect('S', 0, 100), rect('T', 0, 0)])
    expect(ok).toBe(true)
    expect(edge.points.length).toBe(2)
    expect(Math.abs(edge.points[0]!.x - edge.points[1]!.x)).toBeLessThan(0.01)
  })

  it('declines (returns false) when an endpoint is not a rect-like shape', () => {
    const edge = mkEdge([{ x: 20, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 40 }, { x: 20, y: 40 }])
    expect(repair(edge, [rect('S', 0, 100, 'circle'), rect('T', 0, 0)])).toBe(false)
  })

  it('leaves an already-straight border-to-border lane untouched', () => {
    const edge = mkEdge([{ x: 20, y: 100 }, { x: 20, y: 40 }])
    expect(repair(edge, [rect('S', 0, 100), rect('T', 0, 0)])).toBe(false)
  })
})

describe('repairs never increase edge crossings', () => {
  it('a back-lane that would cut through a fan-out trunk stays a certified loop instead', () => {
    // stateDiagram corpus regression: collapsing Moving -> Still onto a
    // vertical back-lane would cross the Still fan-out trunk — a crossing
    // ELK's loop avoided. The crossing guard must refuse the collapse.
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
      S0((start)) --> Still
      Still --> S1((end))
      Still --> Moving
      Moving --> Still
      Moving --> Crash`))
    const edges = positioned.edges
    function segInt(a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}, d: {x:number;y:number}): boolean {
      const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
      if (Math.abs(det) < 1e-9) return false
      const t2 = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det
      return t2 > 0.001 && t2 < 0.999 && u > 0.001 && u < 0.999
    }
    let crossings = 0
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      for (let s = 1; s < edges[i]!.points.length; s++) for (let q = 1; q < edges[j]!.points.length; q++) {
        if (segInt(edges[i]!.points[s-1]!, edges[i]!.points[s]!, edges[j]!.points[q-1]!, edges[j]!.points[q]!)) crossings++
      }
    }
    expect(crossings).toBe(0)
  })
})

describe('semantic ports — N/E/S/W at bbox side midpoints (issue #26 WS3)', () => {
  it('shapePorts puts the four ports at the bbox side midpoints for every shape', () => {
    const node = { id: 'X', label: 'X', shape: 'diamond' as const, x: 100, y: 50, width: 80, height: 40 }
    for (const shape of ['diamond', 'rectangle', 'circle', 'stadium', 'hexagon', 'cylinder'] as const) {
      const ports = shapePorts({ ...node, shape })
      expect(ports.N).toEqual({ x: 140, y: 50 })
      expect(ports.E).toEqual({ x: 180, y: 70 })
      expect(ports.S).toEqual({ x: 140, y: 90 })
      expect(ports.W).toEqual({ x: 100, y: 70 })
    }
  })

  const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  const center = (id: string) => {
    const n = nodeMap.get(id)!
    return { cx: n.x + n.width / 2, cy: n.y + n.height / 2, bottom: n.y + n.height, left: n.x }
  }

  it('the retry loop exits the decision diamond at its exact South vertex', () => {
    for (const [from] of [['C'], ['F']] as const) {
      const back = findEdge(positioned.edges, from, from === 'C' ? 'B' : 'E')
      const { cx, bottom } = center(from)
      expect(Math.abs(back.points[0]!.x - cx)).toBeLessThan(0.5)
      expect(Math.abs(back.points[0]!.y - bottom)).toBeLessThan(0.5)
      expect(back.routeCertificate?.sourcePort).toBe('S')
    }
  })

  it('the retry loop enters its target at the exact South side midpoint', () => {
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const back = findEdge(positioned.edges, from, to)
      const { cx, bottom } = center(to)
      const end = back.points[back.points.length - 1]!
      expect(Math.abs(end.x - cx)).toBeLessThan(0.5)
      expect(Math.abs(end.y - bottom)).toBeLessThan(0.5)
      expect(back.routeCertificate?.targetPort).toBe('S')
    }
  })

  it('F -> G enters Create Session at its exact West midpoint (and emits from F\'s vertex)', () => {
    const e = findEdge(positioned.edges, 'F', 'G')
    const { left, cy } = center('G')
    const end = e.points[e.points.length - 1]!
    expect(Math.abs(end.x - left)).toBeLessThan(0.5)
    expect(Math.abs(end.y - cy)).toBeLessThan(0.5)
    expect(e.routeCertificate?.targetPort).toBe('W')
    expect(e.routeCertificate?.sourcePort).toBe('E')
  })

  it('aligned chains run port to port: B -> C from East midpoint to the West vertex', () => {
    const e = findEdge(positioned.edges, 'B', 'C')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('W')
  })

  it('circles join the straightenable set via their exact boundary ports', () => {
    // Previously unverified-shape: circle endpoints sat wherever ELK left
    // them on the bbox. The port model gives circles four exact boundary
    // points (the inscribed circle touches the bbox side midpoints).
    const pair = layoutGraphSync(parseMermaid('flowchart LR\n  A((One)) --> B((Two))\n  B --> A'))
    const fwd = findEdge(pair.edges, 'A', 'B')
    const a = pair.nodes.find(n => n.id === 'A')!
    if (isStraightHorizontal(fwd)) {
      expect(Math.abs(fwd.points[0]!.x - (a.x + a.width))).toBeLessThan(0.5)
      expect(Math.abs(fwd.points[0]!.y - (a.y + a.height / 2))).toBeLessThan(0.5)
      expect(fwd.routeCertificate?.sourcePort).toBe('E')
    } else {
      throw new Error('aligned circle pair should produce a straight port-to-port lane')
    }
  })
})

describe('port ranking — sharp bits win when a side carries one line (issue #26 WS3 costs)', () => {
  // Misalign the diamond from its target by fan-in: T receives a second
  // edge from X, pulling T's center off Q's centerline, so the lane through
  // Q's vertex and the lane through T's midpoint genuinely differ.
  const single = (dir: string) => `flowchart ${dir}
  Q{Decide} -- go --> T[Target]
  X[Side input] --> T`

  it.each([
    ['LR', 'E'],
    ['RL', 'W'],
    ['TD', 'S'],
    ['BT', 'N'],
  ] as const)('%s: one line out of the diamond emits from its exact %s vertex', (dir, side) => {
    const positioned = layoutGraphSync(parseMermaid(single(dir)))
    const e = findEdge(positioned.edges, 'Q', 'T')
    // Straight when the vertex lane is clear; otherwise a single deliberate
    // Z from the vertex into the target's port — never a floating facet exit.
    expect(e.routeCertificate?.sourcePort).toBe(side)
    expect(e.points.length).toBeLessThanOrEqual(4)
    expect(e.routeCertificate?.targetPort).toBeDefined()
  })

  it("a blocked vertex emit hooks into the target's facing cross-side port (1 bend, not a 2-bend Z)", () => {
    // Direct geometry, bypassing the placement repair: the target sits fully
    // below the vertex lane (its span cannot host a straight emit), no
    // sibling holds the entry port, and nothing blocks the facing N port.
    // This is the hook's residual domain once port-lane alignment exists:
    // geometries where the slide was vetoed (occlusion, labels, a sibling
    // straight edge) but the facing entry is clear.
    const graph = parseMermaid('flowchart LR\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 300, y: 120, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 140, y: 90 }, { x: 220, y: 90 }, { x: 220, y: 138 }, { x: 300, y: 138 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), { edgeLabelFontSize: 11, edgeLabelFontWeight: 400 })
    const e = positioned.edges[0]!
    expect(e.points.length).toBe(3)
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('N')
    expect(e.points[e.points.length - 1]).toEqual({ x: 340, y: 120 })
  })

  it.each(['LR', 'RL'] as const)(
    '%s: port-lane alignment makes the labeled main branch vertex-to-port straight; the side input converges at the same port',
    dir => {
      const positioned = layoutGraphSync(parseMermaid(single(dir)))
      const t = positioned.nodes.find(n => n.id === 'T')!
      const entry = dir === 'LR' ? ('W' as const) : ('E' as const)
      // The placement repair (Rüegg et al.: straightness through ports)
      // slides Target onto the diamond's vertex lane: the labeled primary
      // branch runs straight, vertex to exact port — rule 1 with 0 bends.
      const q = findEdge(positioned.edges, 'Q', 'T')
      expect(q.points.length).toBe(2)
      expect(q.routeCertificate?.sourcePort).toBe(dir === 'LR' ? 'E' : 'W')
      expect(q.routeCertificate?.targetPort).toBe(entry)
      // The side input converges into the SAME exact entry port (fan-in
      // merge; the port-seeking Z upgrade fires because its raw entry was
      // off-port after the slide).
      const x = findEdge(positioned.edges, 'X', 'T')
      const port = { x: dir === 'LR' ? t.x : t.x + t.width, y: t.y + t.height / 2 }
      const last = x.points[x.points.length - 1]!
      expect(Math.abs(last.x - port.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(last.y - port.y)).toBeLessThanOrEqual(0.5)
      expect(x.routeCertificate?.targetPort).toBe(entry)
    },
  )

  it.each([
    ['circles', '((One))', '((Hub))', '((Two))'],
    ['stadiums', '([One])', '([Hub])', '([Two])'],
    ['hexagons', '{{One}}', '{{Hub}}', '{{Two}}'],
    ['cylinders', '[(One)]', '[(Hub)]', '[(Two)]'],
  ] as const)(
    'PORT_EXACT shapes: an unlabeled equal-rank peer fan-in merges SYMMETRICALLY at the exact port',
    (_name, a, t, b) => {
      // Active fan-in centering snaps the hub T to the exact cross-axis
      // barycenter of its two unlabeled peer sources, so both edges leave
      // their source E port and converge — mirror-symmetric — at T's single
      // exact W port (port-exact preserved; the two equal bent lines replace
      // the old one-straight/one-Z asymmetry).
      const positioned = layoutGraphSync(parseMermaid(
        `flowchart LR\n  A${a} --> T${t}\n  B${b} --> T`))
      const at = findEdge(positioned.edges, 'A', 'T')
      const bt = findEdge(positioned.edges, 'B', 'T')
      for (const e of [at, bt]) {
        expect(e.routeCertificate?.sourcePort).toBe('E')
        expect(e.routeCertificate?.targetPort).toBe('W')
      }
      // Both edges enter through the same exact W port (fan-in merge).
      const lastA = at.points[at.points.length - 1]!
      const lastB = bt.points[bt.points.length - 1]!
      expect(Math.abs(lastA.x - lastB.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(lastA.y - lastB.y)).toBeLessThanOrEqual(0.5)
      // The hub is centered: the shared W port sits at the barycenter of the
      // two source centers → the two edges are vertical mirror images.
      const A = positioned.nodes.find(n => n.id === 'A')!
      const B = positioned.nodes.find(n => n.id === 'B')!
      const bary = ((A.y + A.height / 2) + (B.y + B.height / 2)) / 2
      expect(Math.abs(lastA.y - bary)).toBeLessThanOrEqual(1.5)
    },
  )

  // Single-column peer fan-in stays mirror-symmetric for N > 2, up to the
  // grid ceiling. ELK lays N stacked equal-rank unlabeled sources in ONE
  // column only while N is small; at N >= 9 it MAY wrap them into a multi-
  // column grid (verified: rectangle wraps to 4 cols at N=9, 6 at N=11 — the
  // wrap is intermittent, but N<=8 is always a single column for every shape
  // here). Once gridded the sources are no longer one equal-rank column, so
  // active fan-in centering correctly does NOT fire (out of scope, falls back
  // to baseline — not a regression). We therefore pin N=3..8, strictly below
  // the grid ceiling, where the claim is "exact symmetry".
  it.each([
    ['rectangles', '[One]', '[Hub]', '[Src]'],
    ['stadiums', '([One])', '([Hub])', '([Src])'],
    ['hexagons', '{{One}}', '{{Hub}}', '{{Src}}'],
    ['cylinders', '[(One)]', '[(Hub)]', '[(Src)]'],
    // Curved/pointed shapes clip endpoints to the outline, not the bbox, so
    // they carry a small mirror floor that grows with N; tolerances below
    // absorb it (circle <=2.1px, diamond <=3.2px at N=8).
    ['circles', '((One))', '((Hub))', '((Src))'],
    ['diamonds', '{One}', '{Hub}', '{Src}'],
  ] as const)(
    'single-column peer fan-in (N=3..8) is mirror-symmetric for %s',
    (name, _a, t, srcTpl) => {
      const curved = name === 'circles' || name === 'diamonds'
      // Floor for curved/pointed shapes when perfectly centered (outline
      // clipping): hub stays on barycenter, edge endpoints carry a residual.
      const hubTol = curved ? 1.0 : 0.5
      const mirrorTol = curved ? 3.2 : 0.5
      for (let n = 3; n <= 8; n++) {
        const open = srcTpl.slice(0, srcTpl.indexOf('Src'))
        const close = srcTpl.slice(srcTpl.indexOf('Src') + 3)
        const tOpen = t.slice(0, t.indexOf('Hub'))
        const tClose = t.slice(t.indexOf('Hub') + 3)
        const lines = ['flowchart LR']
        for (let i = 0; i < n; i++) lines.push(`  A${i}${open}S${i}${close} --> T${tOpen}Hub${tClose}`)
        const positioned = layoutGraphSync(parseMermaid(lines.join('\n')))
        const nodeMap = new Map(positioned.nodes.map(nd => [nd.id, nd]))
        const hub = nodeMap.get('T')!
        const sources = Array.from({ length: n }, (_, i) => nodeMap.get(`A${i}`)!)
        // Sanity: still a single equal-rank column (gate is in scope here).
        const cols = new Set(sources.map(s => Math.round(s.x)))
        expect(cols.size).toBe(1)

        const incoming = positioned.edges.filter(e => e.target === 'T')
        expect(incoming.length).toBe(n)

        // (1) Hub centered on the cross-axis barycenter of its sources.
        const bary = sources.reduce((a, s) => a + s.y + s.height / 2, 0) / n
        expect(Math.abs((hub.y + hub.height / 2) - bary)).toBeLessThanOrEqual(hubTol)

        // (2) Both endpoints of every incoming edge land on the SAME exact
        //     W port — all incoming arrowheads coincide (fan-in merge).
        const entries = incoming.map(e => e.points[e.points.length - 1]!)
        for (const p of entries) {
          expect(Math.abs(p.x - entries[0]!.x)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(p.y - entries[0]!.y)).toBeLessThanOrEqual(0.5)
        }
        // The shared port sits on the hub centerline (the barycenter).
        expect(Math.abs(entries[0]!.y - bary)).toBeLessThanOrEqual(hubTol + 1.5)

        // (3) Incoming edges are mirror-paired about the hub centerline:
        //     the k-th source from the top and the k-th from the bottom leave
        //     equidistant from the barycenter.
        const startYs = incoming.map(e => e.points[0]!.y).sort((p, q) => p - q)
        for (let k = 0; k < Math.floor(n / 2); k++) {
          const dTop = Math.abs(startYs[k]! - bary)
          const dBot = Math.abs(startYs[n - 1 - k]! - bary)
          expect(Math.abs(dTop - dBot)).toBeLessThanOrEqual(mirrorTol)
        }
      }
    },
  )

  it('port-lane alignment includes diamonds: K becomes vertex-to-vertex straight', () => {
    const positioned = layoutGraphSync(parseMermaid(
      'flowchart LR\n  Q1{First} -- go --> Q2{Second}\n  X[Side input] --> Q2'))
    // Pre-extension Q1's emit landed on Q2's facet, off the vertex. Sliding
    // Q2 onto Q1's vertex lane makes the labeled main branch EXACT
    // vertex-to-vertex. X cannot also align (the 'go' label pill blocks its
    // slide — proof-gated), so it keeps its legal floating facet straight.
    const q = findEdge(positioned.edges, 'Q1', 'Q2')
    expect(q.points.length).toBe(2)
    expect(q.routeCertificate?.sourcePort).toBe('E')
    expect(q.routeCertificate?.targetPort).toBe('W')
    expect(findEdge(positioned.edges, 'X', 'Q2').points.length).toBe(2)
  })

  it('a feedback out-edge does not veto vertex alignment (R: yes-branch runs straight)', () => {
    // B has TWO out-edges, but "no, retry" is FEEDBACK — it leaves via the
    // outer channel and never occupies the E facet. Only forward out-edges
    // count against the vertex's capacity, so Process aligns onto the main
    // lane and the yes-branch runs straight, vertex to exact port.
    const positioned = layoutGraphSync(parseMermaid(
      'flowchart LR\n  A[Request] --> B{Valid?}\n  B -- no, retry --> A\n  B -- yes --> C[Process]'))
    const yes = findEdge(positioned.edges, 'B', 'C')
    expect(yes.points.length).toBe(2)
    expect(yes.routeCertificate?.sourcePort).toBe('E')
    expect(yes.routeCertificate?.targetPort).toBe('W')
    const b = positioned.nodes.find(n => n.id === 'B')!
    const c = positioned.nodes.find(n => n.id === 'C')!
    expect(Math.abs((b.y + b.height / 2) - (c.y + c.height / 2))).toBeLessThanOrEqual(0.5)
  })

  it('two lines out of one diamond side spread symmetrically (no line hogs the vertex)', () => {
    for (const dir of ['LR', 'TD'] as const) {
      const positioned = layoutGraphSync(parseMermaid(`flowchart ${dir}
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]`))
      const a = findEdge(positioned.edges, 'Q', 'P')
      const b = findEdge(positioned.edges, 'Q', 'R')
      // Distinct exits; the shared side is spread, not stacked on the vertex.
      expect(JSON.stringify(a.points[0])).not.toBe(JSON.stringify(b.points[0]))
      expect(a.points.length).toBeLessThanOrEqual(4)
      expect(b.points.length).toBeLessThanOrEqual(4)
      const cross = dir === 'LR' ? 'y' as const : 'x' as const
      const q = positioned.nodes.find(n => n.id === 'Q')!
      const center = q[cross] + (cross === 'y' ? q.height : q.width) / 2
      expect(Math.abs(Math.abs(a.points[0]![cross] - center) - Math.abs(b.points[0]![cross] - center))).toBeLessThanOrEqual(0.75)
    }
  })

  it('a TD decision fork/rejoin exits the diamond through lower facet ports before honoring target lanes', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`))
    const yes = findEdge(positioned.edges, 'B', 'C', 'Yes')
    const no = findEdge(positioned.edges, 'B', 'D', 'No')
    const decision = positioned.nodes.find(n => n.id === 'B')!
    const center = decision.x + decision.width / 2

    expect(yes.routeCertificate?.sourcePort).toBe('SW')
    expect(no.routeCertificate?.sourcePort).toBe('SE')
    expect(yes.points[0]!.x).toBeLessThan(center)
    expect(no.points[0]!.x).toBeGreaterThan(center)
    expect(yes.points[0]!.y).toBeCloseTo(no.points[0]!.y, 3)
  })

  it('a TD decision fork/rejoin emits every line from a named source port', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`))
    const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
    for (const edge of positioned.edges) {
      expectSourceEndpointAtNamedPort(edge, nodes.get(edge.source)!)
    }
  })

  it('a TD decision fork/rejoin enters every target through a named target port', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`))
    const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
    for (const edge of positioned.edges) {
      expectTargetEndpointAtNamedPort(edge, nodes.get(edge.target)!)
    }
  })

  it('issue #42: grouped TD decision branches expose named lower diamond facet ports', () => {
    const graph = parseMermaid(`flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`)
    const positioned = layoutGraphSync(graph)
    const yes = findEdge(positioned.edges, 'B', 'C', 'yes')
    const retry = findEdge(positioned.edges, 'B', 'D', 'needs work')
    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.sourcePort).toBe('S')
    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.targetPort).toBe('N')
    expect(yes.routeCertificate?.sourcePort).toBe('SW')
    expect(retry.routeCertificate?.sourcePort).toBe('SE')
    expect(yes.routeCertificate?.targetPort).toBe('N')
    expect(retry.routeCertificate?.targetPort).toBe('N')
    expect(yes.routeCertificate?.invariant).toBe('bundle')
    expect(retry.routeCertificate?.invariant).toBe('bundle')
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  it('bi-directional pairs render as TWO EQUAL parallel lines, symmetric about the centerline', () => {
    for (const dir of ['LR', 'TD'] as const) {
      for (const shapes of [['{One}', '{Two}'], ['[One]', '[Two]']]) {
        const isDiamond = shapes[0] === '{One}'
        const positioned = layoutGraphSync(parseMermaid(
          `flowchart ${dir}\n  Q${shapes[0]} --> R${shapes[1]}\n  R --> Q`))
        const fwd = findEdge(positioned.edges, 'Q', 'R')
        const back = findEdge(positioned.edges, 'R', 'Q')
        expect(fwd.points.length).toBe(2)
        expect(back.points.length).toBe(2)
        const cross = dir === 'LR' ? 'y' as const : 'x' as const
        const main = dir === 'LR' ? 'x' as const : 'y' as const
        const q = positioned.nodes.find(n => n.id === 'Q')!
        const center = q[cross] + (cross === 'y' ? q.height : q.width) / 2
        // Symmetric about the centerline: equal distance, opposite sides.
        // Diamond-diamond pairs (G) part at the NEAREST facet-mids: each line
        // emits from its OWN source diamond's facet-mid (offset = size/4), so
        // the two-sided symmetry holds up to the diamonds' size difference
        // (heights vary slightly with the inscribed label). Rect-like pairs
        // keep the exact center ± SEP/2 symmetry.
        const symTol = isDiamond ? 1.5 : 0.5
        expect(Math.abs(Math.abs(fwd.points[0]![cross] - center) - Math.abs(back.points[0]![cross] - center))).toBeLessThan(symTol)
        // ...on opposite sides, separated enough for the arrowheads...
        expect(Math.abs(fwd.points[0]![cross] - back.points[0]![cross])).toBeGreaterThanOrEqual(8)
        // ...and equal in length (diamond facets shorten the line by their
        // size/4 distance from the vertex, equal for the symmetric pair).
        const len = (e: typeof fwd) => Math.abs(e.points[1]![main] - e.points[0]![main])
        expect(Math.abs(len(fwd) - len(back))).toBeLessThan(isDiamond ? 1.5 : 0.5)
        if (isDiamond) {
          // Diamond-diamond: source ends land on facet-mids (NE/SW for LR,
          // rotated per direction); never on a vertex (the lines run BETWEEN
          // the diamonds, not through a point).
          expect(['NE', 'SE', 'SW', 'NW']).toContain(fwd.routeCertificate?.sourcePort ?? '')
          expect(['NE', 'SE', 'SW', 'NW']).toContain(back.routeCertificate?.sourcePort ?? '')
        }
      }
    }
  })

  it.each(['LR', 'RL', 'TD', 'BT'] as const)('%s: a chain of diamonds runs vertex to vertex', dir => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart ${dir}\n  Q1{One} --> Q2{Two} --> Q3{Three}`))
    for (const [from, to] of [['Q1', 'Q2'], ['Q2', 'Q3']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect(e.points.length).toBe(2)
      expect(e.routeCertificate?.sourcePort).toBeDefined()
      expect(e.routeCertificate?.targetPort).toBeDefined()
    }
  })

  it('diamond-to-diamond with misaligned centers: the source vertex wins (lines emit from points)', () => {
    // Fan-in pulls Q2 off Q1's centerline; both vertices cannot be on one
    // straight lane, and the emit rule prefers the source's sharp bit.
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
  Q1{First} -- go --> Q2{Second}
  X[Side input] --> Q2`))
    const e = findEdge(positioned.edges, 'Q1', 'Q2')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.points.length).toBeLessThanOrEqual(4)
  })
})

describe('vertex hook — entry side across axes and suppression guards (route-certificate harvest)', () => {
  // Hand-built geometry (like the issue #26 hook test above) makes
  // tryVertexHook deterministic. The existing test pins LR with the target
  // BELOW the lane (entry side N); these pin the mirror (S) and the rotated
  // cross axis (W/E under TD), plus the two early-return guards — the survivor
  // harvest for src/route-contracts.ts lines 1422-1451.
  const FONT = { edgeLabelFontSize: 11, edgeLabelFontWeight: 400 }

  it('LR with the target ABOVE the lane hooks into the exact South port (mirror of the North case)', () => {
    const graph = parseMermaid('flowchart LR\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 150, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 300, y: 40, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 140, y: 200 }, { x: 220, y: 200 }, { x: 220, y: 58 }, { x: 300, y: 58 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const e = positioned.edges[0]!
    expect(e.points.length).toBe(3)
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('S')
    expect(e.points[e.points.length - 1]).toEqual({ x: 340, y: 76 })
  })

  it('TD with the target to the lower-RIGHT hooks into the exact West port', () => {
    const graph = parseMermaid('flowchart TD\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 200, y: 300, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 90, y: 140 }, { x: 90, y: 200 }, { x: 240, y: 200 }, { x: 240, y: 300 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const e = positioned.edges[0]!
    expect(e.points.length).toBe(3)
    expect(e.routeCertificate?.sourcePort).toBe('S')
    expect(e.routeCertificate?.targetPort).toBe('W')
    expect(e.points[e.points.length - 1]).toEqual({ x: 200, y: 318 })
  })

  it('TD with the target to the lower-LEFT hooks into the exact East port', () => {
    const graph = parseMermaid('flowchart TD\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 300, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 120, y: 300, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 350, y: 140 }, { x: 350, y: 200 }, { x: 160, y: 200 }, { x: 160, y: 300 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const e = positioned.edges[0]!
    expect(e.points.length).toBe(3)
    expect(e.routeCertificate?.sourcePort).toBe('S')
    expect(e.routeCertificate?.targetPort).toBe('E')
    expect(e.points[e.points.length - 1]).toEqual({ x: 200, y: 318 })
  })

  it('a stub shorter than HOOK_STUB_MIN suppresses the hook (no 1-bend into the facing port)', () => {
    // entryCross - lane = 3 px (< HOOK_STUB_MIN = 8): the hook would be a
    // degenerate near-zero stub, so tryVertexHook bails and the Z is used.
    const graph = parseMermaid('flowchart LR\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 300, y: 93, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 140, y: 90 }, { x: 220, y: 90 }, { x: 220, y: 111 }, { x: 300, y: 111 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const e = positioned.edges[0]!
    const hookedIntoNorth = e.points.length === 3 && Math.abs(e.points[2]!.y - 93) < 0.5
    expect(hookedIntoNorth).toBe(false)
  })

  it('a sibling already holding the facing entry port suppresses the hook (fan-in merge wins)', () => {
    // S -> T already lands on T's West (flow-side) port, so the merge outranks
    // the hook: Q -> T must NOT take the 1-bend North hook.
    const graph = parseMermaid('flowchart LR\n  Q{Decide} --> T[Target]\n  S[Side] --> T')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 300, y: 120, width: 80, height: 36 },
        { id: 'S', label: 'Side', shape: 'rectangle', x: 40, y: 120, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [
        { source: 'Q', target: 'T', points: [{ x: 140, y: 90 }, { x: 220, y: 90 }, { x: 220, y: 138 }, { x: 300, y: 138 }] },
        { source: 'S', target: 'T', points: [{ x: 120, y: 138 }, { x: 300, y: 138 }] },
      ] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const qt = positioned.edges[0]!
    const hookedIntoNorth = qt.points.length === 3 && Math.abs(qt.points[2]!.y - 120) < 0.5
    expect(hookedIntoNorth).toBe(false)
    expect(qt.routeCertificate?.targetPort).not.toBe('N')
  })
})

describe('reciprocal & off-port enrollment — straight edges still re-lane (route-certificate harvest)', () => {
  // The "already straight" branch (route-contracts.ts lines 1681-1705) must
  // still enroll two kinds of straight edge: one floating off its ports, and a
  // reciprocal-pair member sitting on the shared centerline. Hand-built,
  // straight-on-entry geometry isolates each enrollment trigger so the survivor
  // harvest for lines 1693-1704 has something to bite.
  const FONT = { edgeLabelFontSize: 11, edgeLabelFontWeight: 400 }

  it('a straight, on-port reciprocal pair still enrolls and splits to the symmetric lane (center ± 6)', () => {
    // Both edges enter already straight AND on the shared port lane (y=120);
    // the ONLY reason to re-lane is the reciprocal flag. Drop it and they stay
    // overlapping on y=120.
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A')
    const positioned = {
      nodes: [
        { id: 'A', label: 'A', shape: 'rectangle', x: 40, y: 100, width: 80, height: 40 },
        { id: 'B', label: 'B', shape: 'rectangle', x: 300, y: 100, width: 80, height: 40 },
      ] as PositionedNode[],
      edges: [
        { source: 'A', target: 'B', edgeIndex: 0, points: [{ x: 120, y: 120 }, { x: 300, y: 120 }] },
        { source: 'B', target: 'A', edgeIndex: 1, points: [{ x: 300, y: 120 }, { x: 120, y: 120 }] },
      ] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const ab = positioned.edges[0]!, ba = positioned.edges[1]!
    expect(isStraightHorizontal(ab)).toBe(true)
    expect(isStraightHorizontal(ba)).toBe(true)
    expect(ab.points[0]!.y).toBeCloseTo(114, 5) // primary takes the low side
    expect(ba.points[0]!.y).toBeCloseTo(126, 5) // feedback the high side
    expect(Math.abs(ab.points[0]!.y - ba.points[0]!.y)).toBeCloseTo(12, 5)
  })

  it('a straight edge floating off the ports enrolls and snaps onto the exact port lane', () => {
    // Straight but 10px below both port midpoints (ELK FREE placement). The
    // off-port check must enroll it so it re-lanes onto the E->W port lane.
    const graph = parseMermaid('flowchart LR\n  A --> B')
    const positioned = {
      nodes: [
        { id: 'A', label: 'A', shape: 'rectangle', x: 40, y: 100, width: 80, height: 40 },
        { id: 'B', label: 'B', shape: 'rectangle', x: 300, y: 100, width: 80, height: 40 },
      ] as PositionedNode[],
      edges: [
        { source: 'A', target: 'B', edgeIndex: 0, points: [{ x: 120, y: 130 }, { x: 300, y: 130 }] },
      ] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), FONT)
    const e = positioned.edges[0]!
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.points[0]!.y).toBeCloseTo(120, 5)
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('W')
  })
})

describe('route contracts — properties', () => {
  // Pinned seed: unpinned runs made the certificate-completeness property a
  // random CI flake (~1 run in 7; issue #83). This is the exact seed whose
  // generated counterexample exposed #83 — with the fix it passes, so the old
  // counterexample class is now a permanent deterministic regression check.
  // Save/restore (not reset): the preload's repo-wide seed policy must survive
  // this suite for every file that runs later in the process.
  let savedFcConfig: ReturnType<typeof fc.readConfigureGlobal>
  beforeAll(() => {
    savedFcConfig = fc.readConfigureGlobal()
    fc.configureGlobal({ ...savedFcConfig, seed: -1377631277 })
  })
  afterAll(() => {
    if (savedFcConfig) fc.configureGlobal(savedFcConfig)
    else fc.resetConfigureGlobal()
  })

  const flowchartArb = fc
    .record({
      nodeCount: fc.integer({ min: 3, max: 7 }),
      edgePicks: fc.array(
        // The 4th element samples the wider edge-syntax vocabulary (issue #37):
        // every line style, direction, and marker reaches the route contracts.
        fc.tuple(fc.nat(6), fc.nat(6), fc.constantFrom('', '', '', 'yes', 'No', 'on error'), fc.nat(EDGE_FORMS.length - 1)),
        { minLength: 2, maxLength: 10 },
      ),
      direction: fc.constantFrom('LR', 'TD', 'RL', 'BT'),
    })
    .map(({ nodeCount, edgePicks, direction }) => {
      const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
      const lines = edgePicks
        .map(([a, b, label, form]) => [names[a % nodeCount]!, names[b % nodeCount]!, label, form] as const)
        .filter(([a, b]) => a !== b)
        .map(([a, b, label, form]) => `  ${renderEdgeLine(a, b, EDGE_FORMS[form]!, label)}`)
      if (lines.length === 0) lines.push(`  ${names[0]} --> ${names[1]}`)
      return `flowchart ${direction}\n${lines.join('\n')}`
    })

  function layout(source: string): { graph: ReturnType<typeof parseMermaid>; positioned: PositionedGraph } {
    const graph = parseMermaid(source)
    return { graph, positioned: layoutGraphSync(graph) }
  }

  it('every edge gets a certificate and no unexplained hitch survives the pipeline', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const { graph, positioned } = layout(source)
        for (const e of positioned.edges) {
          if (e.routeCertificate === undefined) return false
        }
        return findRouteHitches(positioned, graph).length === 0
      }),
      { numRuns: 60 },
    )
  })

  it('straightened routes are two-point, axis-aligned, and end on the node bbox boundary', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const { positioned } = layout(source)
        const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
        for (const e of positioned.edges) {
          if (!e.routeCertificate?.straightened) continue
          if (e.points.length !== 2) return false
          const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
          if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) return false
          for (const [p, id] of [[a, e.source], [b, e.target]] as const) {
            const n = nodeMap.get(id)!
            const onX = Math.abs(p.x - n.x) < 0.01 || Math.abs(p.x - (n.x + n.width)) < 0.01
            const onY = Math.abs(p.y - n.y) < 0.01 || Math.abs(p.y - (n.y + n.height)) < 0.01
            const inside = p.x >= n.x - 0.01 && p.x <= n.x + n.width + 0.01 &&
              p.y >= n.y - 0.01 && p.y <= n.y + n.height + 0.01
            if (!(inside && (onX || onY))) return false
          }
        }
        return true
      }),
      { numRuns: 60 },
    )
  })

  it('layout output is deterministic across repeated runs', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const a = JSON.stringify(layoutGraphSync(parseMermaid(source)).edges.map(e => [e.points, e.routeCertificate]))
        const b = JSON.stringify(layoutGraphSync(parseMermaid(source)).edges.map(e => [e.points, e.routeCertificate]))
        return a === b
      }),
      { numRuns: 30 },
    )
  })
})

describe('DECISION_BRANCH_UNLABELED lint (ISO 5807 10.3.1.2 / ANSI X3.5 4.10.2)', () => {
  it('fires once per unlabeled branch of a multi-exit decision', () => {
    const { warnings } = verifyMermaid('flowchart LR\n  Q{Decide} -- yes --> A[Go]\n  Q --> B[Stop]')
    const hits = warnings.filter(w => w.code === 'DECISION_BRANCH_UNLABELED')
    expect(hits).toEqual([{ code: 'DECISION_BRANCH_UNLABELED', node: 'Q', edge: 'Q->B#1' }])
  })

  it('stays silent for fully labeled decisions, single exits, and non-diamonds', () => {
    for (const src of [
      'flowchart LR\n  Q{Decide} -- yes --> A[Go]\n  Q -- no --> B[Stop]',
      'flowchart LR\n  Q{Decide} --> A[Only]',
      'flowchart LR\n  Q[Box] --> A[One]\n  Q --> B[Two]',
    ]) {
      expect(verifyMermaid(src).warnings.filter(w => w.code === 'DECISION_BRANCH_UNLABELED')).toEqual([])
    }
  })
})
