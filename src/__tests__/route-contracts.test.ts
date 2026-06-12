import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { classifyRoutes, directLaneBlockers, findRouteHitches, simplifyPolyline } from '../route-contracts.ts'
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

  it('feedback edges keep their detours (never claim the primary lane)', () => {
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const e = findEdge(edges, from, to)
      expect(e.points.length).toBeGreaterThan(2)
    }
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

  it('feedback retry edges certify as feedback detours (acceptance criterion 2)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect(e.routeCertificate?.routeClass).toBe('feedback')
      expect(e.routeCertificate?.invariant).toBe('feedback-detour')
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
  it('RL: the reciprocal pair straightens the forward edge against the reversed axis', () => {
    const edges = layoutEdges(`flowchart RL
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.points[0]!.x).toBeGreaterThan(e.points[1]!.x) // forward flow runs right-to-left
    expect(findEdge(edges, 'C', 'B').points.length).toBeGreaterThan(2)
  })

  it('BT: the reciprocal pair straightens the forward edge as a vertical lane running upward', () => {
    const edges = layoutEdges(`flowchart BT
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(e.points.length).toBe(2)
    expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
    expect(e.points[0]!.y).toBeGreaterThan(e.points[1]!.y) // forward flow runs bottom-to-top
    expect(findEdge(edges, 'C', 'B').points.length).toBeGreaterThan(2)
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

  it("another edge's label blocks the lane within its measured rect plus clearance", () => {
    const m = measureMultilineText('No', 12, 400)
    const other = (lx: number, ly: number) =>
      edge('P', 'Q', [{ x: 300, y: 200 }, { x: 320, y: 200 }], { label: 'No', labelPosition: { x: lx, y: ly } })
    const at = (lx: number, ly: number) =>
      directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [other(lx, ly)] }))
    expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
    // Cross-axis boundary: label center just inside / outside h/2 + 4px clearance.
    expect(at(50, 50 + m.height / 2 + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    expect(at(50, 50 + m.height / 2 + 4 + 0.5)).toEqual([])
    // Main-axis boundary: label fully past the lane end plus clearance.
    expect(at(100 + m.width / 2 + 4 + 0.5, 50)).toEqual([])
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

  it("the edge's own label needs lane capacity: width + 8px clearance", () => {
    const m = measureMultilineText('quite a long edge label', 12, 400)
    const labeled = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }], { label: 'quite a long edge label' })
    expect(directLaneBlockers(labeled, 50, 0, m.width + 8 - 1, ctx()))
      .toEqual([{ kind: 'label', id: 'A->B' }])
    expect(directLaneBlockers(labeled, 50, 0, m.width + 8 + 1, ctx())).toEqual([])
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

    it('label rects swap width/height between axes', () => {
      const m = measureMultilineText('No', 12, 400)
      const other = (lx: number, ly: number) =>
        edge('P', 'Q', [{ x: 300, y: 200 }, { x: 300, y: 220 }], { label: 'No', labelPosition: { x: lx, y: ly } })
      const at = (lx: number, ly: number) =>
        directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [other(lx, ly)] }))
      expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      // Cross axis is x: boundary at w/2 + 4.
      expect(at(50 + m.width / 2 + 4 - 0.5, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      expect(at(50 + m.width / 2 + 4 + 0.5, 50)).toEqual([])
      // Main axis is y: boundary at h/2 + 4 past the lane end.
      expect(at(50, 100 + m.height / 2 + 4 + 0.5)).toEqual([])
      expect(at(50, 100 + m.height / 2 + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    })

    it('channel conflicts are vertical segments here; horizontal crossings are fine', () => {
      const parallel = edge('P', 'Q', [{ x: 53, y: 20 }, { x: 53, y: 80 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [parallel] })))
        .toEqual([{ kind: 'channel', id: 'P->Q' }])
      const crossing = edge('P', 'Q', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [crossing] }))).toEqual([])
    })

    it('own-label capacity uses label height on a vertical lane', () => {
      const m = measureMultilineText('No', 12, 400)
      const labeled = edge('A', 'B', [{ x: 50, y: 0 }, { x: 50, y: 100 }], { label: 'No' })
      expect(directLaneBlockers(labeled, 50, 0, m.height + 8 - 1, vCtx()))
        .toEqual([{ kind: 'label', id: 'A->B' }])
      expect(directLaneBlockers(labeled, 50, 0, m.height + 8 + 1, vCtx())).toEqual([])
    })
  })
})

describe('route contracts — properties', () => {
  const flowchartArb = fc
    .record({
      nodeCount: fc.integer({ min: 3, max: 7 }),
      edgePicks: fc.array(fc.tuple(fc.nat(6), fc.nat(6)), { minLength: 2, maxLength: 10 }),
      direction: fc.constantFrom('LR', 'TD'),
    })
    .map(({ nodeCount, edgePicks, direction }) => {
      const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
      const lines = edgePicks
        .map(([a, b]) => [names[a % nodeCount]!, names[b % nodeCount]!])
        .filter(([a, b]) => a !== b)
        .map(([a, b]) => `  ${a} --> ${b}`)
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
