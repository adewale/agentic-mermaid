// Self-transition loops as real arcs (plan §State 6) — state AND flowchart.
//
// Self-loops used to come out of ELK as degenerate ~10px stubs hidden behind
// their own label pill. This suite pins the typed self-loop route class:
// leave the node on one side, loop out with real clearance, re-enter the SAME
// side at a DISTINCT boundary point, orthogonal throughout, label ON the loop.
// The certificate vocabulary is extended (loopSide) rather than the gates
// weakened — auditRouteContracts must stay clean over the rebuilt geometry.
// Upstream: #6336 fixed state-side in 2025 (the bar); #6049 flowchart-side is
// still open (the beat).

import { describe, test, expect } from 'bun:test'
import { parseMermaid as parseLegacy } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { auditRouteContracts, findRouteHitches } from '../route-contracts.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { createSelfLoopRouter } from '../layout/route-self-loops.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedGroup, PositionedNode, Point } from '../types.ts'

const STATE_SRC = `stateDiagram-v2
  [*] --> Idle
  Idle --> Idle : poll
  Idle --> Busy : job
  Busy --> Idle : done
`

const FLOW_TD = `flowchart TD
  A[Start] --> B[Work]
  B -->|retry| B
  B --> C[Done]
`

const FLOW_LR = `flowchart LR
  A --> B
  B -->|again| B
  B --> C
`

interface Case { name: string; src: string; loopId: string }
const CASES: Case[] = [
  { name: 'state TB', src: STATE_SRC, loopId: 'Idle' },
  { name: 'flowchart TD', src: FLOW_TD, loopId: 'B' },
  { name: 'flowchart LR', src: FLOW_LR, loopId: 'B' },
]

function loopOf(src: string, id: string): { edge: PositionedEdge; node: PositionedNode; positioned: ReturnType<typeof layoutGraphSync>; graph: ReturnType<typeof parseLegacy> } {
  const graph = parseLegacy(src)
  const positioned = layoutGraphSync(graph)
  const edge = positioned.edges.find(e => e.source === id && e.target === id)!
  const node = positioned.nodes.find(n => n.id === id)!
  expect(edge).toBeDefined()
  expect(node).toBeDefined()
  return { edge, node, positioned, graph }
}

function onBoundary(p: Point, n: PositionedNode, tol = 1.5): boolean {
  const inX = p.x >= n.x - tol && p.x <= n.x + n.width + tol
  const inY = p.y >= n.y - tol && p.y <= n.y + n.height + tol
  const onV = (Math.abs(p.x - n.x) <= tol || Math.abs(p.x - (n.x + n.width)) <= tol) && inY
  const onH = (Math.abs(p.y - n.y) <= tol || Math.abs(p.y - (n.y + n.height)) <= tol) && inX
  return onV || onH
}

function clearance(p: Point, n: PositionedNode): number {
  const dx = Math.max(n.x - p.x, 0, p.x - (n.x + n.width))
  const dy = Math.max(n.y - p.y, 0, p.y - (n.y + n.height))
  return Math.hypot(dx, dy)
}

function expectSeparatedMarkers(edges: PositionedEdge[]): void {
  const style = resolveRenderStyle({})
  const markers = edges.flatMap(edge => graphEdgeMarkerPaintRegions(edge, style))
  for (let i = 0; i < markers.length; i++) {
    const a = markers[i]!.bounds
    expect(a).toBeDefined()
    for (let j = i + 1; j < markers.length; j++) {
      const b = markers[j]!.bounds
      expect(b).toBeDefined()
      expect(a!.x1 <= b!.x0 || b!.x1 <= a!.x0 || a!.y1 <= b!.y0 || b!.y1 <= a!.y0).toBe(true)
    }
  }
}

describe('self-loops are real arcs (typed route class, not a stub)', () => {
  for (const c of CASES) {
    test(`${c.name}: leaves and re-enters the boundary at distinct points, with real clearance`, () => {
      const { edge, node } = loopOf(c.src, c.loopId)
      expect(edge.points.length).toBeGreaterThanOrEqual(4)
      const first = edge.points[0]!
      const last = edge.points[edge.points.length - 1]!
      // Distinct departure/return points on the node outline.
      expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThanOrEqual(8)
      expect(onBoundary(first, node)).toBe(true)
      expect(onBoundary(last, node)).toBe(true)
      // The loop body swings visibly outside the node.
      const interior = edge.points.slice(1, -1)
      expect(interior.length).toBeGreaterThanOrEqual(2)
      const minClear = Math.min(...interior.map(p => clearance(p, node)))
      expect(minClear).toBeGreaterThanOrEqual(12)
      // Orthogonal segments only (standard notation, renderer contract).
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThanOrEqual(0.01)
      }
    })

    test(`${c.name}: label pill hugs the loop without covering it or the node`, () => {
      const { edge, node } = loopOf(c.src, c.loopId)
      expect(edge.label).toBeDefined()
      expect(edge.labelPosition).toBeDefined()
      // Pill rect (renderer geometry: measured text + 8px padding per side).
      const style = resolveRenderStyle({})
      const m = measureMultilineText(edge.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const half = { w: (m.width + 16) / 2, h: (m.height + 16) / 2 }
      const lp = edge.labelPosition!
      // Rect-to-route distance (the rubric's self-loop metric): the pill must
      // hug the arc — within the labelOffRoute allowance, not floating away.
      let d = Infinity
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const qx = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), lp.x))
        const qy = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), lp.y))
        d = Math.min(d, Math.max(Math.abs(lp.x - qx) - half.w, 0) + Math.max(Math.abs(lp.y - qy) - half.h, 0))
      }
      expect(d).toBeLessThanOrEqual((m.height + 16) / 2 + 4)
      // …and the pill must NOT cover the node (the hidden-stub defect).
      const overlapsNode = lp.x + half.w > node.x && lp.x - half.w < node.x + node.width &&
        lp.y + half.h > node.y && lp.y - half.h < node.y + node.height
      expect(overlapsNode).toBe(false)
    })

    test(`${c.name}: certificate names the loop side; gates stay green`, () => {
      const { edge, node, positioned, graph } = loopOf(c.src, c.loopId)
      const cert = edge.routeCertificate!
      expect(cert).toBeDefined()
      expect(cert.routeClass).toBe('self-loop')
      expect(cert.invariant).toBe('self-loop')
      expect(cert.loopSide).toBeDefined()
      expect(['N', 'E', 'S', 'W']).toContain(cert.loopSide!)
      // The declared side matches the geometry: both endpoints on that side.
      const sideOf = (p: Point): string[] => {
        const sides: string[] = []
        if (Math.abs(p.x - node.x) <= 1.5) sides.push('W')
        if (Math.abs(p.x - (node.x + node.width)) <= 1.5) sides.push('E')
        if (Math.abs(p.y - node.y) <= 1.5) sides.push('N')
        if (Math.abs(p.y - (node.y + node.height)) <= 1.5) sides.push('S')
        return sides
      }
      expect(sideOf(edge.points[0]!)).toContain(cert.loopSide!)
      expect(sideOf(edge.points[edge.points.length - 1]!)).toContain(cert.loopSide!)
      // Certificates extended, gates not weakened: audit + hitch prover clean.
      expect(auditRouteContracts(positioned, graph)).toEqual([])
      expect(findRouteHitches(positioned, graph)).toEqual([])
    })
  }

  test('self-loop keeps clear of sibling nodes (no loop-through-node)', () => {
    const { positioned } = loopOf(FLOW_TD, 'B')
    for (const edge of positioned.edges) {
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        for (const n of positioned.nodes) {
          if (n.id === edge.source || n.id === edge.target) continue
          const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
          const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
          const crosses = xHi > n.x + 0.5 && xLo < n.x + n.width - 0.5 &&
            yHi > n.y + 0.5 && yLo < n.y + n.height - 0.5
          expect(crosses).toBe(false)
        }
      }
    }
  })

  test('unlabeled self-loop still arcs', () => {
    const { edge, node } = loopOf(`flowchart TD\n  A --> B\n  B --> B\n`, 'B')
    expect(edge.points.length).toBeGreaterThanOrEqual(4)
    const interior = edge.points.slice(1, -1)
    expect(Math.min(...interior.map(p => clearance(p, node)))).toBeGreaterThanOrEqual(12)
  })

  test('self-loop on a diamond anchors on the diamond outline', () => {
    const graph = parseLegacy(`flowchart TD\n  A --> D{Decide}\n  D -->|loop| D\n  D --> E\n`)
    const positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(e => e.source === 'D' && e.target === 'D')!
    const node = positioned.nodes.find(n => n.id === 'D')!
    for (const p of [edge.points[0]!, edge.points[edge.points.length - 1]!]) {
      const dx = Math.abs(p.x - (node.x + node.width / 2)) / (node.width / 2)
      const dy = Math.abs(p.y - (node.y + node.height / 2)) / (node.height / 2)
      expect(Math.abs(dx + dy - 1)).toBeLessThanOrEqual(0.05)
    }
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  test('two self-loops on one node allocate distinct collision-free geometry', () => {
    const graph = parseLegacy(`flowchart TD\n  A --> B\n  B -->|x| B\n  B -->|y| B\n`)
    const positioned = layoutGraphSync(graph)
    const loops = positioned.edges.filter(e => e.source === 'B' && e.target === 'B')
    expect(loops.length).toBe(2)
    expect(JSON.stringify(loops[0]!.points)).not.toBe(JSON.stringify(loops[1]!.points))
    expect(loops[0]!.labelPosition).not.toEqual(loops[1]!.labelPosition)
    expectSeparatedMarkers(positioned.edges)
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  test.each(['TD', 'BT', 'LR', 'RL'])('reserves loop shafts across different owners in %s', direction => {
    const source = `flowchart ${direction}\nN2 --> N2\nN2 --> N2\nN3 --> N3`
    const graph = parseLegacy(source), positioned = layoutGraphSync(graph)
    expect(positioned.edges.map(edge => [edge.source, edge.target])).toEqual([['N2', 'N2'], ['N2', 'N2'], ['N3', 'N3']])
    expect(positioned.edges.every(edge => edge.routeCertificate?.invariant === 'self-loop')).toBe(true)
    expectSeparatedMarkers(positioned.edges)
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  test('eight labeled loops allocate unique bounded routes and label centers', () => {
    const source = ['flowchart TD', 'A --> B', ...Array.from({ length: 8 }, (_unused, index) => `B -->|loop${index + 1}| B`), 'B --> C'].join('\n')
    const graph = parseLegacy(source)
    const positioned = layoutGraphSync(graph)
    const loops = positioned.edges.filter(edge => edge.source === 'B' && edge.target === 'B')
    const node = positioned.nodes.find(candidate => candidate.id === 'B')!
    expect(loops).toHaveLength(8)
    expectSeparatedMarkers(positioned.edges)
    expect(new Set(loops.map(edge => JSON.stringify(edge.points))).size).toBe(8)
    expect(new Set(loops.map(edge => `${edge.labelPosition?.x},${edge.labelPosition?.y}`)).size).toBe(8)
    const style = resolveRenderStyle({})
    for (const edge of loops) {
      expect(edge.routeCertificate?.invariant).toBe('self-loop')
      expect(Math.hypot(edge.points[0]!.x - edge.points.at(-1)!.x, edge.points[0]!.y - edge.points.at(-1)!.y)).toBeGreaterThanOrEqual(8)
      expect(onBoundary(edge.points[0]!, node)).toBe(true)
      expect(onBoundary(edge.points.at(-1)!, node)).toBe(true)
      const metrics = measureMultilineText(edge.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const label = {
        x: edge.labelPosition!.x - metrics.width / 2 - 8,
        y: edge.labelPosition!.y - metrics.height / 2 - 8,
        w: metrics.width + 16,
        h: metrics.height + 16,
      }
      for (const other of positioned.nodes) {
        if (other.id === node.id) continue
        const overlapX = Math.min(label.x + label.w, other.x + other.width) - Math.max(label.x, other.x)
        const overlapY = Math.min(label.y + label.h, other.y + other.height) - Math.max(label.y, other.y)
        expect(overlapX > 0 && overlapY > 0, `${edge.label} must not cover ${other.id}`).toBe(false)
      }
    }
    expect(auditRouteContracts(positioned, graph)).toEqual([])
    expect(JSON.stringify(layoutGraphSync(parseLegacy(source)).edges)).toBe(JSON.stringify(positioned.edges))
  })

  test('all blocked existing loop sides preserve live routes and report marker owners', () => {
    const node: PositionedNode = { id: 'B', label: 'B', shape: 'rectangle', x: 0, y: 0, width: 80, height: 80 }
    const loop: PositionedEdge = { source: 'B', target: 'B', points: [{ x: 0, y: 20 }, { x: -10, y: 20 }, { x: -10, y: 40 }, { x: 0, y: 40 }], style: 'solid', hasArrowStart: false, hasArrowEnd: true }
    const contacts = [
      [{ x: -10, y: 50 }, { x: 0, y: 50 }],
      [{ x: 90, y: 50 }, { x: 80, y: 50 }],
      [{ x: 50, y: -10 }, { x: 50, y: 0 }],
      [{ x: 50, y: 90 }, { x: 50, y: 80 }],
    ]
    const peers: PositionedEdge[] = contacts.map((points, index) => ({ source: `source${index}`, target: `foreign${index}`, points, style: 'solid', hasArrowStart: false, hasArrowEnd: true }))
    const edges = [loop, ...peers]
    const before = JSON.stringify(edges)
    const blockers: import('../types.ts').RouteBlocker[] = []
    const route = createSelfLoopRouter(new Map([['B', node]]), new Map(), { nodes: [node], edges, style: resolveRenderStyle({}) }, blockers)
    expect(route(loop)).toBeNull()
    expect(route(loop)).toBeNull()
    expect(JSON.stringify(edges)).toBe(before)
    expect(blockers.length).toBeGreaterThanOrEqual(4)
    expect(blockers.every(blocker => blocker.kind === 'port' && blocker.id?.startsWith('peer-marker:'))).toBe(true)
  })

  test('self-loop layout is deterministic', () => {
    const a = JSON.stringify(layoutGraphSync(parseLegacy(FLOW_TD)).edges)
    const b = JSON.stringify(layoutGraphSync(parseLegacy(FLOW_TD)).edges)
    expect(a).toBe(b)
  })

  test('verify stays clean over self-loop diagrams (state + flowchart)', () => {
    for (const src of [STATE_SRC, FLOW_TD]) {
      const v = verifyMermaid(src)
      expect(v.ok).toBe(true)
      expect(v.warnings.filter(w => w.code.startsWith('ROUTE_'))).toEqual([])
    }
  })
})


test('a marker-safe nested state loop also keeps its prepared label clear of foreign states', () => {
  const source = `stateDiagram-v2
  direction TB
  [*] --> S0
  S3 --> S6: warnings
  S4 --> S4: retry
  S2 --> S5: process the request
  S3 --> S3: fan out
  S4 --> S4: a longer label goes here
  S2 --> S5: reads profiles
  S3 --> S3: x
  S4 --> S4: q
  S1 --> [*]`
  const result = renderMermaidSVGWithReceipt(source)
  expect(result.receipt.layoutCertification?.status).toBe('passed')
  for (const label of ['retry', 'a longer label goes here', 'fan out', 'q']) expect(result.svg).toContain(label)
})


for (const side of ['E', 'W', 'N', 'S'] as const) for (const obstacle of ['card', 'header', 'label', 'marker'] as const) {
  test(`a ${side} self-loop admits its complete pill before choosing a side (${obstacle})`, () => {
    const point = (x: number, y: number): Point => side === 'E' ? { x, y } : side === 'W' ? { x: 80 - x, y } : side === 'N' ? { x: y, y: 80 - x } : { x: y, y: x }
    const rect = (x: number, y: number, w: number, h: number) => {
      const corners = [point(x, y), point(x + w, y + h)]
      return { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), width: Math.abs(corners[0]!.x - corners[1]!.x), height: Math.abs(corners[0]!.y - corners[1]!.y) }
    }
    const node: PositionedNode = { id: 'B', label: 'B', shape: 'rectangle', x: 0, y: 0, width: 80, height: 80 }
    const loop: PositionedEdge = { source: 'B', target: 'B', label: 'loop', points: [point(80, 30), point(90, 30), point(90, 50), point(80, 50)], style: 'solid', hasArrowStart: false, hasArrowEnd: true }
    const nodes = [node]
    const groups: PositionedGroup[] = []
    const edges = [loop]
    if (obstacle === 'card') nodes.push({ id: 'foreign', label: 'foreign', shape: 'rectangle', ...rect(140, 30, 20, 20) })
    if (obstacle === 'header') {
      const box = rect(140, 10, 40, 60)
      groups.push({ id: 'foreign-group', label: 'heading', ...box, headerHeight: box.height, children: [] })
    }
    if (obstacle === 'label') edges.push({ source: 'C', target: 'D', label: 'foreign label', labelPosition: point(155, 40), points: [], style: 'solid', hasArrowStart: false, hasArrowEnd: false })
    if (obstacle === 'marker') edges.push({ source: 'C', target: 'D', points: [point(135, 20), point(135, 40)], style: 'solid', hasArrowStart: false, hasArrowEnd: true })
    const route = createSelfLoopRouter(new Map(nodes.map(n => [n.id, n])), new Map(groups.map(g => [g.id, g])), { nodes, edges, style: resolveRenderStyle({}) })
    const selected = route(loop)
    expect(selected).not.toBeNull()
    expect(selected).not.toBe(side)
    expect(loop.labelPosition).toBeDefined()
  })
}

test('a rejected nested loop leaves every earlier label seat and route unchanged', () => {
  const node: PositionedNode = { id: 'B', label: 'B', shape: 'rectangle', x: 0, y: 0, width: 80, height: 80 }
  const nodes: PositionedNode[] = [node,
    { id: 'west', label: '', shape: 'rectangle', x: -100, y: 0, width: 99, height: 80 },
    { id: 'north', label: '', shape: 'rectangle', x: -1, y: -100, width: 82, height: 99 },
    { id: 'south', label: '', shape: 'rectangle', x: -1, y: 81, width: 82, height: 99 },
    { id: 'shifted-label-blocker', label: '', shape: 'rectangle', x: 112, y: -5, width: 45, height: 20 },
  ]
  const loop = (): PositionedEdge => ({ source: 'B', target: 'B', label: 'loop', points: [{ x: 80, y: 30 }, { x: 90, y: 30 }, { x: 90, y: 50 }, { x: 80, y: 50 }], style: 'solid', hasArrowStart: false, hasArrowEnd: false })
  const first = loop(), second = loop(), edges = [first, second]
  const route = createSelfLoopRouter(new Map(nodes.map(n => [n.id, n])), new Map(), { nodes, edges, style: resolveRenderStyle({}) })
  expect(route(first)).toBe('E')
  const before = JSON.stringify(edges)
  expect(route(second)).toBeNull()
  expect(JSON.stringify(edges)).toBe(before)
})


test('a wider nested label cannot detach an earlier short label from its own arc', () => {
  const node: PositionedNode = { id: 'B', label: 'B', shape: 'rectangle', x: 0, y: 0, width: 80, height: 80 }
  const nodes: PositionedNode[] = [node,
    { id: 'west', label: '', shape: 'rectangle', x: -100, y: -1, width: 99, height: 82 },
    { id: 'east', label: '', shape: 'rectangle', x: 81, y: -1, width: 99, height: 82 },
    { id: 'south', label: '', shape: 'rectangle', x: 0, y: 81, width: 80, height: 99 },
  ]
  const loop = (label: string): PositionedEdge => ({ source: 'B', target: 'B', label, points: [{ x: 30, y: 0 }, { x: 30, y: -10 }, { x: 50, y: -10 }, { x: 50, y: 0 }], style: 'solid', hasArrowStart: false, hasArrowEnd: false })
  const first = loop('short'), second = loop('a much wider later label whose seat would detach the earlier short label'), edges = [first, second]
  const route = createSelfLoopRouter(new Map(nodes.map(n => [n.id, n])), new Map(), { nodes, edges, style: resolveRenderStyle({}) })
  expect(route(first)).toBe('N')
  const before = JSON.stringify(edges)
  expect(route(second)).toBeNull()
  expect(JSON.stringify(edges)).toBe(before)
})
