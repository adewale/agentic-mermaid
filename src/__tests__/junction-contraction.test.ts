import { describe, expect, test } from 'bun:test'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { contractBipartiteBlocks } from '../layout/junction-contraction.ts'
import { parseMermaid } from '../parser.ts'
import type { Point, PositionedGraph, PositionedNode } from '../types.ts'

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const product = (from: string, to: string, n: number, op = '-->'): string => `${ids(from, n).join(' & ')} ${op} ${ids(to, n).join(' & ')}`

describe('complete-bipartite block contraction', () => {
  test('contracts closed blocks of identically painted, unlabeled edges', () => {
    const cases: Array<{ name: string; source: string; blocks?: Array<[string[], string[]]>; layoutEdges?: number }> = [
      { name: '3 x 3 product', source: `flowchart LR\n${product('a', 'b', 3)}`, blocks: [[ids('a', 3), ids('b', 3)]], layoutEdges: 6 },
      // 2 x 2 has as many edges as its junction form.
      { name: '2 x 2 product', source: `flowchart LR\n${product('a', 'b', 2)}` },
      { name: 'edge by edge', source: `flowchart LR\n${ids('a', 3).flatMap(a => ids('b', 3).map(b => `${a} --> ${b}`)).join('\n')}`, blocks: [[ids('a', 3), ids('b', 3)]], layoutEdges: 6 },
      { name: 'shafts form separate blocks', source: `flowchart LR\n${product('a', 'b', 3)}\n${product('c', 'd', 3, '-.->')}`, blocks: [[ids('a', 3), ids('b', 3)], [ids('c', 3), ids('d', 3)]], layoutEdges: 12 },
      { name: 'chained blocks', source: `flowchart LR\n${product('a', 'b', 3)}\n${product('b', 'c', 3)}`, blocks: [[ids('a', 3), ids('b', 3)], [ids('b', 3), ids('c', 3)]], layoutEdges: 12 },
      { name: 'an edge into a source keeps the block closed', source: `flowchart LR\n${product('a', 'b', 3)}\nx --> a0`, blocks: [[ids('a', 3), ids('b', 3)]], layoutEdges: 7 },
      // The labelled duplicate takes a0 -> b0 out; a1, a2 still reach b0..b2,
      // but b0 keeps edges from a0 outside that block, so it is not closed.
      { name: 'a labelled duplicate opens the block', source: `flowchart LR\n${product('a', 'b', 3)}\na0 -->|x| b0` },
      { name: 'another edge into a target opens the block', source: `flowchart LR\n${product('a', 'b', 3)}\nx --> b0` },
      { name: 'a member with its own link style opens the block', source: `flowchart LR\n${product('a', 'b', 3)}\nlinkStyle 0 stroke:#f00` },
      { name: 'endpoints in different scopes', source: `flowchart LR\nsubgraph S\n${ids('a', 3).join('\n')}\nend\n${product('a', 'b', 3)}` },
      { name: 'a block inside one group', source: `flowchart LR\nsubgraph S\n${product('a', 'b', 3)}\nend`, blocks: [[ids('a', 3), ids('b', 3)]], layoutEdges: 6 },
    ]
    for (const { name, source, blocks, layoutEdges } of cases) {
      const contraction = contractBipartiteBlocks(parseMermaid(source))
      expect({ name, blocks: contraction?.blocks.map(block => [block.sources, block.targets]), layoutEdges: contraction?.graph.edges.length }).toEqual({ name, blocks, layoutEdges })
    }
  })

  test('junction identities never take an authored node or group identity', () => {
    const contraction = contractBipartiteBlocks(parseMermaid(`flowchart LR\nsubgraph am-junction-0\nq\nend\n${product('a', 'b', 3)}`))!
    expect(contraction.blocks.map(block => block.junction)).toEqual(['_am-junction-0'])
    expect(contraction.graph.nodes.get('_am-junction-0')).toMatchObject({ label: '', shape: 'rectangle' })
  })
})

// Above the layout cost thresholds (400 edges in one gap): 21 x 21 = 441.
const N = 21

function onBoxBoundary(point: Point, node: PositionedNode): boolean {
  const inX = point.x >= node.x - 0.5 && point.x <= node.x + node.width + 0.5
  const inY = point.y >= node.y - 0.5 && point.y <= node.y + node.height + 0.5
  const onX = Math.abs(point.x - node.x) <= 0.5 || Math.abs(point.x - node.x - node.width) <= 0.5
  const onY = Math.abs(point.y - node.y) <= 0.5 || Math.abs(point.y - node.y - node.height) <= 0.5
  return inX && inY && (onX || onY)
}

interface AxisSegment { line: number; lo: number; hi: number; forward: boolean; route: number }

/** Axis-aligned segments keyed by orientation and carrying line (x of a
 * vertical, y of a horizontal), extent along it and travel direction. */
function axisSegments(routes: readonly Point[][]): { vertical: AxisSegment[]; horizontal: AxisSegment[] } {
  const vertical: AxisSegment[] = [], horizontal: AxisSegment[] = []
  routes.forEach((points, route) => points.slice(1).forEach((b, i) => {
    const a = points[i]!
    if (a.x === b.x && a.y !== b.y) vertical.push({ line: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), forward: b.y > a.y, route })
    else if (a.y === b.y && a.x !== b.x) horizontal.push({ line: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), forward: b.x > a.x, route })
  }))
  return { vertical, horizontal }
}

/** Pairs of routes sharing a collinear stretch of ink in opposite directions. */
function opposingSharedInk(segments: readonly AxisSegment[]): number {
  const byLine = new Map<number, AxisSegment[]>()
  for (const segment of segments) byLine.set(segment.line, [...byLine.get(segment.line) ?? [], segment])
  let opposing = 0
  for (const line of byLine.values()) {
    for (let i = 0; i < line.length; i++) for (let j = i + 1; j < line.length; j++) {
      const s = line[i]!, t = line[j]!
      if (s.route !== t.route && s.forward !== t.forward && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 0.5) opposing++
    }
  }
  return opposing
}

/** Whether some point lies on every route (the junction the bus passes through). */
function sharedPoint(routes: readonly Point[][]): boolean {
  const onRoute = (p: Point, points: readonly Point[]): boolean => points.slice(1).some((b, i) => {
    const a = points[i]!
    return p.x >= Math.min(a.x, b.x) - 1e-6 && p.x <= Math.max(a.x, b.x) + 1e-6 && p.y >= Math.min(a.y, b.y) - 1e-6 && p.y <= Math.max(a.y, b.y) + 1e-6
      && Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-6
  })
  // Candidates: vertices and segment midpoints of the first route.
  const first = routes[0]!
  const candidates = [...first, ...first.slice(1).map((b, i) => ({ x: (b.x + first[i]!.x) / 2, y: (b.y + first[i]!.y) / 2 }))]
  return candidates.some(p => routes.every(points => onRoute(p, points)))
}

describe('dense complete-bipartite layouts above the cost thresholds', () => {
  const cases: Array<{ name: string; source: string; flow: 'horizontal' | 'vertical' }> = [
    { name: 'LR arrows', source: `flowchart LR\n${product('a', 'b', N)}`, flow: 'horizontal' },
    { name: 'TD bidirectional', source: `flowchart TD\n${product('a', 'b', N, '<-->')}`, flow: 'vertical' },
    { name: 'RL dotted inside a group, fed from outside', source: `flowchart RL\nsubgraph G[Grid]\n${product('a', 'b', N, '-.->')}\nend\nx --> a0`, flow: 'horizontal' },
    { name: 'BT open links', source: `flowchart BT\n${product('a', 'b', N, '---')}`, flow: 'vertical' },
  ]

  for (const { name, source, flow } of cases) {
    test(`${name}: every authored edge keeps its identity on a shared, one-way bus`, () => {
      const graph = parseMermaid(source)
      const positioned: PositionedGraph = layoutGraphSync(graph)
      // The receipt names the relaxation and the graph actually laid out.
      expect(positioned.layoutCost?.relaxed[0]).toBe('junction-contraction')
      expect(positioned.layoutCost?.estimate.edges).toBe(graph.edges.length)
      expect(positioned.layoutCost?.contracted?.edges).toBe(graph.edges.length - N * N + 2 * N)
      expect(positioned.certification?.status).toBe('passed')

      // Authored node identities only: the junction is not drawn.
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      const nodes = new Map(positioned.nodes.map(node => [node.id, node]))

      // One positioned edge per authored edge, with its own endpoints and paint.
      expect(positioned.edges.map(edge => edge.edgeIndex).sort((a, b) => a! - b!)).toEqual(graph.edges.map((_, index) => index))
      for (const edge of positioned.edges) {
        const authored = graph.edges[edge.edgeIndex!]!
        expect([edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker, edge.endMarker])
          .toEqual([authored.source, authored.target, authored.style, authored.hasArrowStart, authored.hasArrowEnd, authored.startMarker, authored.endMarker])
        expect(edge.points.slice(1).every((b, i) => b.x === edge.points[i]!.x || b.y === edge.points[i]!.y)).toBe(true)
        expect(onBoxBoundary(edge.points[0]!, nodes.get(edge.source)!)).toBe(true)
        expect(onBoxBoundary(edge.points.at(-1)!, nodes.get(edge.target)!)).toBe(true)
      }

      const members = positioned.edges.filter(edge => edge.source.startsWith('a') && edge.target.startsWith('b')).map(edge => edge.points)
      expect(members).toHaveLength(N * N)
      // Owned ink is connected through one junction, and the bus runs on
      // exactly two trunk lines across the flow (collector and distributor)
      // instead of a routing slot per edge.
      expect(sharedPoint(members)).toBe(true)
      const { vertical, horizontal } = axisSegments(members)
      const trunks = flow === 'horizontal' ? vertical : horizontal
      expect(new Set(trunks.map(segment => segment.line)).size).toBe(2)
      // No two members share ink in opposite directions.
      expect(opposingSharedInk(vertical) + opposingSharedInk(horizontal)).toBe(0)
    })
  }

  test('the SVG draws each authored edge once, deterministically, under strict layout safety', () => {
    const source = `flowchart LR\n${product('a', 'b', N, '<-->')}`
    const first = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })
    const pairs = [...first.svg.matchAll(/data-from="([^"]+)" data-to="([^"]+)"/g)].map(match => `${match[1]}->${match[2]}`)
    expect(new Set(pairs)).toEqual(new Set(ids('a', N).flatMap(a => ids('b', N).map(b => `${a}->${b}`))))
    expect(pairs).toHaveLength(N * N)
    expect((first.receipt.layoutCertification as { layoutCost?: { relaxed: readonly string[] } }).layoutCost?.relaxed).toEqual(['junction-contraction'])
    expect(renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' }).svg).toBe(first.svg)
  })
})
