import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { classifyRoutes, directLaneBlockers, findLabelSlot, findRouteHitches, simplifyPolyline } from '../route-contracts.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { verifyMermaid } from '../agent/index.ts'
import type { PositionedEdge, PositionedGraph } from '../types.ts'

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
    ['F', 'G'],
  ])('primary-forward %s -> %s is a straight horizontal lane', (from, to) => {
    const e = findEdge(edges, from, to)
    expect(isStraightHorizontal(e)).toBe(true)
  })

  it('labeled feedback keeps its detour: no clear lane can host the label pill between these lanes', () => {
    // Default-height LR nodes leave ~29px of shared attachment span; a label
    // pill is ~30px tall, so a straight labeled back-lane would overlap the
    // forward lane. The contract keeps the detour and says exactly why.
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const back = findEdge(edges, from, to)
      expect(back.points.length).toBeGreaterThan(2)
      expect(back.routeCertificate?.invariant).toBe('feedback-detour')
      expect(back.routeCertificate?.directLaneBlockedBy?.some(b => b.kind === 'label')).toBe(true)
    }
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

  it('feedback retry edges certify as feedback routes with a lane proof (acceptance criterion 2)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect(e.routeCertificate?.routeClass).toBe('feedback')
      // These are labeled: the pill cannot fit on any clear parallel lane,
      // and the certificate carries that proof rather than a bare verdict.
      expect(e.routeCertificate?.invariant).toBe('feedback-detour')
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
      expect(e.routeCertificate?.invariant).toBe('feedback-detour')
      expect(e.routeCertificate?.directLaneClear).toBe(false)
      expect(e.routeCertificate?.directLaneBlockedBy?.length).toBeGreaterThan(0)
    } else {
      // If layout left a clear outer lane after all, the certificate must prove it.
      expect(e.routeCertificate?.directLaneClear).toBe(true)
    }
  })

  it('straightened edges record the proof', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const e = findEdge(positioned.edges, 'B', 'C')
    expect(e.routeCertificate?.straightened).toBe(true)
    expect(e.routeCertificate?.directLaneClear).toBe(true)
    expect(e.routeCertificate?.invariant).toBe('straight')
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
  it('RL: the forward lane straightens against the reversed axis; the labeled feedback explains its detour', () => {
    const edges = layoutEdges(`flowchart RL
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.points[0]!.x).toBeGreaterThan(e.points[1]!.x) // forward flow runs right-to-left
    const back = findEdge(edges, 'C', 'B')
    expect(back.routeCertificate?.invariant).toBe('feedback-detour')
    expect(back.routeCertificate?.directLaneBlockedBy?.some(b => b.kind === 'label')).toBe(true)
  })

  it('BT: the reciprocal pair straightens both vertical lanes', () => {
    const edges = layoutEdges(`flowchart BT
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(e.points.length).toBe(2)
    expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
    expect(e.points[0]!.y).toBeGreaterThan(e.points[1]!.y) // forward flow runs bottom-to-top
    const back = findEdge(edges, 'C', 'B')
    expect(back.points.length).toBe(2)
    expect(back.points[0]!.y).toBeLessThan(back.points[1]!.y)
    expect(Math.abs(back.points[0]!.x - e.points[0]!.x)).toBeGreaterThanOrEqual(4)
  })
})

describe('route contracts — feedback channel lanes', () => {
  it("TD cycle: C -> A collapses onto ELK's outer channel as one straight vertical back-edge", () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A'))
    const e = findEdge(positioned.edges, 'C', 'A')
    expect(e.points.length).toBe(2)
    expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
    expect(e.points[0]!.y).toBeGreaterThan(e.points[1]!.y) // runs upward, against TD flow
    // The lane must clear B (the node it detours around) by the 4px clearance.
    const b = positioned.nodes.find(n => n.id === 'B')!
    const laneX = e.points[0]!.x
    expect(laneX > b.x + b.width + 4 - 0.01 || laneX < b.x - 4 + 0.01).toBe(true)
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
