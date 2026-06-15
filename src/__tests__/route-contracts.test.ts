import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { applyRouteContracts, auditRouteContracts, classifyRoutes, directLaneBlockers, findLabelSlot, findRouteHitches, shapePorts, simplifyPolyline } from '../route-contracts.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { layoutMermaid, parseMermaid as agentParse, verifyMermaid } from '../agent/index.ts'
import type { PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'

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

  it('a clean unlabeled fan-out still shares a single trunk', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  A --> C'))
    const b = findEdge(positioned.edges, 'A', 'B')
    const c = findEdge(positioned.edges, 'A', 'C')
    expect(b.routeCertificate?.invariant).toBe('bundle')
    expect(c.routeCertificate?.invariant).toBe('bundle')
    expect(b.points[0]).toEqual(c.points[0]) // shared exit point
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
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

  it('two lines out of one diamond side spread on the facet (no line hogs the vertex)', () => {
    for (const dir of ['LR', 'TD'] as const) {
      const positioned = layoutGraphSync(parseMermaid(`flowchart ${dir}
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]`))
      const a = findEdge(positioned.edges, 'Q', 'P')
      const b = findEdge(positioned.edges, 'Q', 'R')
      // Distinct exits, both straight; the shared side is spread, not stacked
      // on the vertex.
      expect(JSON.stringify(a.points[0])).not.toBe(JSON.stringify(b.points[0]))
      expect(a.points.length).toBe(2)
      expect(b.points.length).toBe(2)
    }
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

describe('route contracts — properties', () => {
  const flowchartArb = fc
    .record({
      nodeCount: fc.integer({ min: 3, max: 7 }),
      edgePicks: fc.array(
        fc.tuple(fc.nat(6), fc.nat(6), fc.constantFrom('', '', '', 'yes', 'No', 'on error')),
        { minLength: 2, maxLength: 10 },
      ),
      direction: fc.constantFrom('LR', 'TD', 'RL', 'BT'),
    })
    .map(({ nodeCount, edgePicks, direction }) => {
      const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
      const lines = edgePicks
        .map(([a, b, label]) => [names[a % nodeCount]!, names[b % nodeCount]!, label] as const)
        .filter(([a, b]) => a !== b)
        .map(([a, b, label]) => label ? `  ${a} -- ${label} --> ${b}` : `  ${a} --> ${b}`)
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
