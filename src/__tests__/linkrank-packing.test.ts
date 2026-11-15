// honorLinkRankDistance shoves a variable-length link's target sub-DAG along the
// main axis, but previously left whatever the shove landed on sitting UNDER the
// moved nodes — breaking ELK's no-overlap guarantee (nodeOverlaps) and dragging
// edges through the overlapped boxes (edgeThroughNode); issue #81. The pass now
// (a) pushes ahead any node a shove-introduced overlap lands on, and (b) when a
// rebuilt feedback U-detour or forward dogleg is blocked by a bystander, picks a
// clear variant through free channels (lane switch, rung, elbow, staircase)
// before falling back to the canonical route. These shrunk fuzz repros cover
// every mechanism and are HARD-clean for nodeOverlaps/edgeThroughNode with the
// fix; each shows nodeOverlaps and/or edgeThroughNode without it.
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { auditRouteContracts, invalidEndpointApproaches } from '../route-contracts.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { honorLinkRankDistance } from '../layout/passes/rank-distance.ts'
import { LayoutCertificationError as RankReconnectCertificationError } from '../layout/certification-error.ts'
import type { Point, PositionedNode, PositionedEdge, PositionedGroup, RenderOptions } from '../types.ts'
import { segmentEntersMeasuredBox } from '../layout/measured-route-safety.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

const cases: [string, string][] = [
  // Shove lands a node on a bystander: nodeOverlaps + edgeThroughNode without
  // the push-ahead repair (issue #81 rep1-rep3, one per direction family).
  ['shove overlap, LR diamond', 'flowchart LR\n  N4{warnings}\n  N3 ===>|warnings| N4\n  N3 ----> N0'],
  ['shove overlap, TD 2 components', 'flowchart TD\n  N2((x))\n  N9 ===>|x| N6\n  N7 ----> N0\n  N2 ---> N7'],
  ['shove overlap, RL long-link fan', 'flowchart RL\n  N6((a longer label goes here))\n  N2 ---> N0\n  N6 ===>|warnings| N0\n  N1 ----> N6'],
  // Feedback U-detour risers blocked on BOTH lanes: needs the rung variant
  // through the free channel between rows (issue #81 rep4).
  ['feedback rung, BT 3 components', 'flowchart BT\n  N5[(warnings)]\n  N7 ===>|q| N0\n  N5 --->|done| N3\n  N3 --->|ok| N5\n  N4 --> N6'],
  // A bystander sits over the target's entry port with a 4px free channel
  // beside it: only the double-elbow staircase threads it.
  ['dogleg staircase, TD', `flowchart TD
  N1((a longer label goes here))
  N2(["x"])
  N4((q))
  N6{retry}
  N7((validate input))
  N9{ok}
  N10((same word ok))
  N11(["a longer label goes here"])
  N3 ----> N0
  N4 --> N9
  N11 ----> N8
  N9 ===>|retry| N2
  N6 --->|validate input| N3
  N7 ----> N0
  N4 --> N1
  N1 ===>|same word ok| N10
  N2 --->|a longer label goes here| N7`],
]

describe('honorLinkRankDistance packing: a shove never leaves overlaps or blocked rebuilt routes', () => {
  test.each(['G ---> A', 'A ---> G'])('a public ELK ancestor link preserves the real outward leaf contact without a rank move: %s', relationship => {
    const source = `flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\n${relationship}`, graph = parseMermaid(source)
    const placed = layoutGraphSync(graph, { graphLayout: { backend: 'elk' } }), edge = placed.edges[0]!, leaf = placed.nodes.find(node => node.id === 'A')!
    expect(graph.edges[0]!.length).toBe(2)
    expect([edge.source, edge.target]).toEqual(relationship.startsWith('G') ? ['G', 'A'] : ['A', 'G'])
    expect(invalidEndpointApproaches(edge, edge.source === 'A' ? leaf : undefined, edge.target === 'A' ? leaf : undefined)).toBe(0)
    for (let index = 1; index < edge.points.length; index++) expect(segmentEntersMeasuredBox(edge.points[index - 1]!, edge.points[index]!, leaf)).toBe(false)
    expect(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).receipt.layoutCertification?.status).toBe('passed')
  })

  test('a no-move containing-frame constraint preserves its owned route and label; a real shove still reconnects', () => {
    const graph = parseMermaid('flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\nA --->|distance| G')
    const nodes: PositionedNode[] = [{ id: 'A', label: 'Leaf', shape: 'rectangle', x: 50, y: 100, width: 60, height: 40 }]
    const groups: PositionedGroup[] = [{ id: 'G', label: 'Group', x: 20, y: 20, width: 150, height: 180, children: [] }]
    const edges: PositionedEdge[] = [{ ...graph.edges[0]!, edgeIndex: 0, points: [{ x: 80, y: 140 }, { x: 80, y: 200 }], labelPosition: { x: 80, y: 170 } }]
    const before = structuredClone({ nodes, groups, edges })
    honorLinkRankDistance(nodes, edges, groups, graph)
    expect({ nodes, groups, edges }).toEqual(before)

    const forward = parseMermaid('flowchart TD\nA ---> B')
    const moving: PositionedNode[] = [{ id: 'A', label: 'A', shape: 'rectangle', x: 0, y: 0, width: 10, height: 10 }, { id: 'B', label: 'B', shape: 'rectangle', x: 0, y: 40, width: 10, height: 10 }]
    const routes: PositionedEdge[] = [{ ...forward.edges[0]!, edgeIndex: 0, points: [{ x: 5, y: 10 }, { x: 5, y: 40 }] }]
    honorLinkRankDistance(moving, routes, [], forward)
    expect(moving[1]!.y).toBe(146)
    expect(routes[0]!.points.at(-1)).toEqual({ x: 5, y: 146 })
    expect(invalidEndpointApproaches(routes[0]!, moving[0], moving[1])).toBe(0)
  })

  test.each(['LR', 'RL', 'TD', 'BT'] as const)('repairs simultaneous %s shove overlaps and downstream movement while preserving pre-existing overlaps', direction => {
    const graph = parseMermaid(`flowchart ${direction}\nA ----> B\nB --> C\nD\nE\nP\nQ`)
    const horizontal = direction === 'LR' || direction === 'RL'
    const reverse = direction === 'RL' || direction === 'BT'
    const coordinate = (value: number) => reverse ? -value - 10 : value
    const nodes: PositionedNode[] = [['A', 0], ['B', 40], ['C', 80], ['D', 240], ['E', 280], ['P', 500], ['Q', 505]].map(([id, value]) => {
      const main = coordinate(value as number), cross = id === 'P' || id === 'Q' ? 20 : 0
      return { id: id as string, label: id as string, shape: 'rectangle', x: horizontal ? main : cross, y: horizontal ? cross : main, width: 10, height: 10 }
    })
    honorLinkRankDistance(nodes, [], [], graph)
    expect(nodes.map(node => node[horizontal ? 'x' : 'y'])).toEqual([0, 234, 310, 272, 348, 500, 505].map(coordinate))
  })
  for (const [name, src] of cases) {
    test(`${name}: no nodeOverlaps, no edgeThroughNode`, () => {
      const g = parseMermaid(src)
      const p = layoutGraphSync(g)
      expect(p.nodes.map(node => node.id).sort()).toEqual([...g.nodes.keys()].sort())
      expect(p.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(g.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const bad = hardViolations(assessLayout(g, p))
        .filter(v => v.metric === 'nodeOverlaps' || v.metric === 'edgeThroughNode')
      expect(bad).toEqual([])
    })
  }

  test('packing preserves every requested long-link gap in all four directions', () => {
    const template = (dir: 'LR' | 'RL' | 'TD' | 'BT') =>
      `flowchart ${dir}\n  N2((x))\n  N9 ===>|x| N6\n  N7 ----> N0\n  N2 ---> N7`
    const mainGap = (positioned: ReturnType<typeof layoutGraphSync>, dir: 'LR' | 'RL' | 'TD' | 'BT'): number => {
      const source = positioned.nodes.find(n => n.id === 'N7')!
      const target = positioned.nodes.find(n => n.id === 'N0')!
      switch (dir) {
        case 'LR': return target.x - (source.x + source.width)
        case 'RL': return source.x - (target.x + target.width)
        case 'TD': return target.y - (source.y + source.height)
        default: return source.y - (target.y + target.height)
      }
    }
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const graph = parseMermaid(template(dir))
      const positioned = layoutGraphSync(graph)
      // `---->` parses as length 3: 48 + 2 × (48 + 40) = 224px.
      expect(mainGap(positioned, dir)).toBeGreaterThanOrEqual(223.5)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })
})

// Issue #87 evidence fixtures: an authored `B ----> A` feedback edge requests
// three ranks in every direction (Bug 1), and overlap repair must not compress
// the N7 ----> N0 rank constraint again (Bug 2). These gaps were previously
// asserted only by the gallery generator; they now gate every run.
describe('issue #87 link-rank evidence fixtures keep the requested gap', () => {
  const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'linkrank-feedback-packing', 'fixtures')
  const fixtures = [
    ...(['lr', 'rl', 'td', 'bt'] as const).map(dir => ({ file: `feedback-long-${dir}.mmd`, source: 'A', target: 'B' })),
    { file: 'packing-td.mmd', source: 'N7', target: 'N0' },
    { file: 'packing-bt.mmd', source: 'N7', target: 'N0' },
  ]
  for (const fixture of fixtures) {
    test(`${fixture.file}: ${fixture.source}/${fixture.target} boundary gap is at least 224px`, () => {
      const text = readFileSync(join(FIXTURES, fixture.file), 'utf8')
      const direction = /^flowchart (LR|RL|TD|BT)\b/m.exec(text)![1] as 'LR' | 'RL' | 'TD' | 'BT'
      const graph = parseMermaid(text)
      const positioned = layoutGraphSync(graph)
      const source = positioned.nodes.find(n => n.id === fixture.source)!
      const target = positioned.nodes.find(n => n.id === fixture.target)!
      const gap = direction === 'LR' ? target.x - (source.x + source.width)
        : direction === 'RL' ? source.x - (target.x + target.width)
          : direction === 'TD' ? target.y - (source.y + source.height)
            : source.y - (target.y + target.height)
      expect(gap).toBeGreaterThanOrEqual(223.5)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    })
  }
})

describe('rank reconnection preserves owned header-safe geometry', () => {
  test.each([{}, { style: 'publication-figure' }, { style: ['publication-figure', 'nord-light', { font: 'Inter' }] }] satisfies RenderOptions[])(
    'docs flowchart 98 preserves every node, group and relationship under %j', options => {
      const corpus = JSON.parse(readFileSync(join(import.meta.dir, '../../eval/mermaid-docs-corpus/corpus.json'), 'utf8')) as Array<{ family: string; index: number; source: string }>
      const source = corpus.find(sample => sample.family === 'flowchart' && sample.index === 98)!.source
      expect(() => renderMermaidSVGWithReceipt(source, options)).not.toThrow()
      const rendered = renderMermaidSVGWithReceipt(source, options)
      expect(rendered.receipt.layoutCertification?.status).toBe('passed')
      const tags = scanSvgStartTags(rendered.svg).map(tag => Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])))
      expect(tags.filter(tag => tag.class === 'node').map(tag => tag['data-id']).sort()).toEqual(['bottom1', 'bottom2', 'outside', 'top1', 'top2'])
      expect(tags.filter(tag => tag.class === 'subgraph').map(tag => tag['data-id']).sort()).toEqual(['subgraph1', 'subgraph2'])
      expect(tags.filter(tag => tag.class === 'edge').map(tag => [tag['data-from'], tag['data-to'], tag['data-arrow-end']]).sort()).toEqual([
        ['outside', 'subgraph1', 'true'], ['outside', 'top2', 'true'], ['top1', 'bottom1', 'true'], ['top2', 'bottom2', 'true'],
      ])
    },
  )

  test.each(['LR', 'RL', 'TD', 'BT'] as const)('%s section roundoff retains a safe route and its contacts; a real diagonal still refuses', direction => {
    const graph = parseMermaid(`flowchart ${direction}\nsubgraph G\nT[Target]\nend\nS ---> T`)
    const horizontal = direction === 'LR' || direction === 'RL', sign = direction === 'RL' || direction === 'BT' ? -1 : 1
    let crossOffset = 0
    const project = ({ x, y }: Point): Point => horizontal ? { x: sign * x, y: y + crossOffset } : { x: y + crossOffset, y: sign * x }
    const box = <T extends { x: number; y: number; width: number; height: number }>(item: T): T => {
      const a = project(item), b = project({ x: item.x + item.width, y: item.y + item.height })
      return { ...item, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    for (const seam of [64 * Number.EPSILON, 0.00000000001, 0.00001, 2]) {
      // The small real diagonal has the same SVG spelling but exceeds
      // roundoff. At a huge translation, 2px is within the relative error
      // bound but spells differently. Neither may reuse the retained route.
      crossOffset = seam === 2 ? 1e16 : 0
      const nodes: PositionedNode[] = [
        box({ id: 'S', label: 'Source', shape: 'rectangle' as const, x: 0, y: 50, width: 20, height: 20 }),
        box({ id: 'T', label: 'Target', shape: 'rectangle' as const, x: 100, y: 50, width: 20, height: 20 }),
      ]
      const groups: PositionedGroup[] = [box({ id: 'G', label: 'Group', x: 90, y: 20, width: 40, height: 70, children: [], headerHeight: 0 })]
      // Target contact is on the cross face: a generic main-axis dogleg cannot
      // replace this exterior detour while retaining the outward approach.
      const points = [{ x: 20, y: 60 }, { x: 40, y: 60 + seam }, { x: 40, y: 110 }, { x: 110, y: 110 }, { x: 110, y: 70 }].map(project)
      const saved = structuredClone(points), edges: PositionedEdge[] = [{ ...graph.edges[0]!, edgeIndex: 0, points }]
      if (seam !== 64 * Number.EPSILON) {
        expect(() => honorLinkRankDistance(nodes, edges, groups, graph)).toThrow(RankReconnectCertificationError)
        expect(edges[0]!.points).toBe(points)
      } else {
        expect(() => honorLinkRankDistance(nodes, edges, groups, graph)).not.toThrow()
        expect(edges[0]!.points[0]).toEqual(saved[0])
        expect(edges[0]!.points.at(-1)).toEqual(project({ x: 166, y: 70 }))
        expect(edges[0]!.points.map(point => point[horizontal ? 'y' : 'x'])).toEqual(saved.map(point => point[horizontal ? 'y' : 'x']))
        expect(invalidEndpointApproaches(edges[0]!, nodes[0], nodes[1])).toBe(0)
        for (let index = 1; index < edges[0]!.points.length; index++) for (const node of nodes) {
          expect(segmentEntersMeasuredBox(edges[0]!.points[index - 1]!, edges[0]!.points[index]!, node)).toBe(false)
        }
      }
      expect(points).toEqual(saved)
      const main = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height'
      const gap = sign === 1 ? nodes[1]![main] - nodes[0]![main] - nodes[0]![size] : nodes[0]![main] - nodes[1]![main] - nodes[1]![size]
      expect(gap).toBe(136)
    }
  })

  const source = (direction: string, operator = '---->') => `flowchart ${direction}\nsubgraph S1\nA[One]\nend\nsubgraph S2\nB[Two]\nend\nA ${operator} B`
  const clear = (edges: PositionedEdge[], groups: PositionedGroup[], nodes: PositionedNode[]) => {
    const all = [...groups]
    for (let index = 0; index < all.length; index++) {
      const band = all[index]!
      all.push(...band.children)
      for (const edge of edges) for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const hit = Math.max(a.x, b.x) > band.x && Math.min(a.x, b.x) < band.x + band.width
          && Math.max(a.y, b.y) > band.y && Math.min(a.y, b.y) < band.y + band.headerHeight!
        expect(hit, `${edge.source}->${edge.target} enters ${band.id}'s full band`).toBe(false)
      }
    }
    for (const edge of edges) {
      expect(invalidEndpointApproaches(edge, nodes.find(node => node.id === edge.source), nodes.find(node => node.id === edge.target))).toBe(0)
      for (let i = 1; i < edge.points.length; i++) for (const node of nodes) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        expect(Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + node.width
          && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height).toBe(false)
      }
    }
  }
  test('a TD shove retains the real leaf and ancestor-boundary ports of the safe SEPARATE route', () => {
    // Literal pre-shove geometry from the refused canonical TD case.
    const graph = parseMermaid(source('TD'))
    const nodes: PositionedNode[] = [
      {id: 'A', label: 'One', shape: 'rectangle', x: 56, y: 84, width: 65.662, height: 36.900000000000006},
      {id: 'B', label: 'Two', shape: 'rectangle', x: 114.831, y: 276.9, width: 67.14399999999999, height: 36.900000000000006},
    ]
    const groups: PositionedGroup[] = [
      {id: 'S1', label: 'S1', x: 40, y: 40, width: 97.662, height: 96.9, children: [], headerHeight: 28},
      {id: 'S2', label: 'S2', x: 98.831, y: 184.9, width: 99.14399999999999, height: 144.9, children: [], headerHeight: 28},
    ]
    const original = [{x: 88.831, y: 120.9}, {x: 88.831, y: 136.9}, {x: 88.831, y: 228.9}, {x: 98.831, y: 228.9}, {x: 148.403, y: 228.9}, {x: 148.403, y: 276.9}]
    const saved = structuredClone(original), edges: PositionedEdge[] = [{...graph.edges[0]!, edgeIndex: 0, points: original}]
    honorLinkRankDistance(nodes, edges, groups, graph)
    // Six bounded additions/subtractions form and measure this fractional
    // shove. This independent eight-epsilon magnitude bound covers roundoff only.
    const roundoff = 8 * Number.EPSILON * Math.max(1, Math.abs(nodes[1]!.y), Math.abs(nodes[0]!.y), nodes[0]!.height, 224)
    expect(nodes[1]!.y - (nodes[0]!.y + nodes[0]!.height) + roundoff).toBeGreaterThanOrEqual(224)
    expect(edges[0]!.points[0]).toEqual(saved[0])
    expect(edges[0]!.points.at(-1)).toEqual({x: 148.403, y: nodes[1]!.y})
    expect(edges[0]!.points).toContainEqual({x: 98.831, y: 228.9 + (nodes[1]!.y - 276.9)})
    expect(original).toEqual(saved)
    clear(edges, groups, nodes)
  })

  test('a BT shove preserves the source-side escape and the target ancestor entry instead of crossing its own header', () => {
    const graph = parseMermaid(source('BT'))
    const nodes: PositionedNode[] = [
      {id: 'A', label: 'One', shape: 'rectangle', x: 56, y: 384, width: 64, height: 32},
      {id: 'B', label: 'Two', shape: 'rectangle', x: 186, y: 184, width: 64, height: 32},
    ]
    const groups: PositionedGroup[] = [
      {id: 'S1', label: 'S1', x: 40, y: 340, width: 100, height: 100, children: [], headerHeight: 28},
      {id: 'S2', label: 'S2', x: 170, y: 140, width: 100, height: 100, children: [], headerHeight: 28},
    ]
    const original = [{x: 88, y: 384}, {x: 88, y: 376}, {x: 150, y: 376}, {x: 150, y: 228}, {x: 218, y: 228}, {x: 218, y: 216}]
    const saved = structuredClone(original), edges: PositionedEdge[] = [{...graph.edges[0]!, edgeIndex: 0, points: original}]
    honorLinkRankDistance(nodes, edges, groups, graph)
    expect(nodes[0]!.y - (nodes[1]!.y + nodes[1]!.height)).toBe(224)
    expect(edges[0]!.points.slice(0, 3)).toEqual(saved.slice(0, 3))
    expect(edges[0]!.points.at(-1)).toEqual({x: 218, y: 160})
    expect(edges[0]!.points).toContainEqual({x: 218, y: 172})
    expect(original).toEqual(saved)
    clear(edges, groups, nodes)
  })

  test('bounded fallback channels repair a bad included route around aligned headers without changing its ports', () => {
    const graph = parseMermaid(source('TD'))
    const nodes: PositionedNode[] = [
      {id: 'A', label: 'One', shape: 'rectangle', x: 56, y: 84, width: 64, height: 32},
      {id: 'B', label: 'Two', shape: 'rectangle', x: 56, y: 200, width: 64, height: 32},
    ]
    const groups: PositionedGroup[] = [
      {id: 'S1', label: 'S1', x: 40, y: 40, width: 96, height: 96, children: [], headerHeight: 28},
      {id: 'S2', label: 'S2', x: 40, y: 156, width: 96, height: 96, children: [], headerHeight: 28},
    ]
    const edges: PositionedEdge[] = [{...graph.edges[0]!, edgeIndex: 0, points: [{x: 88, y: 116}, {x: 88, y: 200}]}]
    honorLinkRankDistance(nodes, edges, groups, graph)
    expect(nodes[1]!.y - (nodes[0]!.y + nodes[0]!.height)).toBe(224)
    expect(edges[0]!.points[0]).toEqual({x: 88, y: 116})
    expect(edges[0]!.points.at(-1)).toEqual({x: 88, y: 340})
    clear(edges, groups, nodes)
  })

  test.each(['-->', '---->'])('a %s link with no actual shove preserves the original route and object identities', operator => {
    const graph = parseMermaid(source('TD', operator))
    const nodes: PositionedNode[] = [
      {id: 'A', label: 'One', shape: 'rectangle', x: 56, y: 84, width: 64, height: 32},
      {id: 'B', label: 'Two', shape: 'rectangle', x: 56, y: 500, width: 64, height: 32},
    ]
    const points = [{x: 88, y: 116}, {x: 150, y: 116}, {x: 150, y: 500}, {x: 88, y: 500}]
    const edges: PositionedEdge[] = [{...graph.edges[0]!, edgeIndex: 0, points}], before = structuredClone({nodes, edges})
    honorLinkRankDistance(nodes, edges, [], graph)
    expect({nodes, edges}).toEqual(before)
    expect(edges[0]!.points).toBe(points)
  })

  test.each([100, 80])('a fallback checks the whole diamond body or explicitly refuses an unproven route (target x%s)', targetX => {
    const graph = parseMermaid('flowchart LR\nsubgraph G1\nS{Source}\nend\nsubgraph G2\nT[Target]\nend\nS --> T\nU ----> T')
    const nodes: PositionedNode[] = [
      {id: 'S', label: 'Source', shape: 'diamond', x: 0, y: 0, width: 100, height: 100},
      {id: 'T', label: 'Target', shape: 'rectangle', x: targetX, y: 200, width: 40, height: 30},
      {id: 'U', label: 'U', shape: 'rectangle', x: targetX - 224, y: 300, width: 10, height: 10},
    ]
    const groups: PositionedGroup[] = [
      {id: 'G1', label: 'G1', x: -20, y: -60, width: 140, height: 180, children: [], headerHeight: 28},
      {id: 'G2', label: 'G2', x: targetX - 20, y: -100, width: 80, height: 400, children: [], headerHeight: 28},
    ]
    const edges: PositionedEdge[] = [
      {...graph.edges[0]!, edgeIndex: 0, points: [{x: 75, y: 25}, {x: 110, y: 25}, {x: 110, y: 150}, {x: targetX - 10, y: 150}, {x: targetX - 10, y: 215}, {x: targetX, y: 215}]},
      {...graph.edges[1]!, edgeIndex: 1, points: [{x: targetX - 214, y: 305}, {x: targetX - 204, y: 305}, {x: targetX - 204, y: 215}, {x: targetX, y: 215}]},
    ]
    if (targetX === 80) {
      const original = edges[0]!.points
      expect(() => honorLinkRankDistance(nodes, edges, groups, graph)).toThrow(RankReconnectCertificationError)
      expect(nodes[1]!.x).toBe(90)
      expect(edges[0]!.points).toBe(original)
      return
    }
    honorLinkRankDistance(nodes, edges, groups, graph)
    const points = edges[0]!.points
    expect(points[0]).toEqual({x: 75, y: 25})
    expect(points[1]!.y).toBe(25)
    expect(points[1]!.x).toBeGreaterThan(75)
    expect(points.at(-1)).toEqual({x: 110, y: 215})
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, vertical = a.x === b.x
      // Independent exact diamond interior: |x-50| + |y-50| < 50.
      const fixed = vertical ? a.x : a.y, lo = Math.abs(fixed - 50), hi = 100 - lo
      const first = vertical ? a.y : a.x, last = vertical ? b.y : b.x
      expect(Math.max(Math.min(first, last), lo) < Math.min(Math.max(first, last), hi)).toBe(false)
    }
    clear(edges, groups, nodes.filter(node => node.id !== 'S'))
  })

  test.each(['source', 'target'] as const)('an unrelated shove retains an ancestor frame inward %s contact', frameEnd => {
    const graph = parseMermaid(`flowchart LR\nsubgraph Outer\nA[Leaf]\nend\n${frameEnd === 'source' ? 'Outer -->|inside| A' : 'A -->|inside| Outer'}\nC ----> D`)
    const nodes: PositionedNode[] = [
      {id: 'A', label: 'Leaf', shape: 'rectangle', x: 50, y: 100, width: 40, height: 30},
      {id: 'C', label: 'C', shape: 'rectangle', x: 300, y: 200, width: 40, height: 30},
      {id: 'D', label: 'D', shape: 'rectangle', x: 400, y: 200, width: 40, height: 30},
    ]
    const groups: PositionedGroup[] = [{id: 'Outer', label: 'Outer', x: 20, y: 50, width: 100, height: 120, children: [], headerHeight: 28}]
    const line = [{x: 20, y: 115}, {x: 50, y: 115}], original = frameEnd === 'source' ? line : line.toReversed()
    const edges: PositionedEdge[] = [
      {...graph.edges[0]!, edgeIndex: 0, points: original, labelPosition: {x: 35, y: 115}},
      {...graph.edges[1]!, edgeIndex: 1, points: [{x: 340, y: 215}, {x: 400, y: 215}]},
    ]
    const saved = structuredClone(edges[0])
    honorLinkRankDistance(nodes, edges, groups, graph)
    expect(nodes[2]!.x - (nodes[1]!.x + nodes[1]!.width)).toBe(224)
    expect(edges[0]).toEqual(saved)
    const port = frameEnd === 'source' ? edges[0]!.points[0]! : edges[0]!.points.at(-1)!
    const inside = frameEnd === 'source' ? edges[0]!.points[1]! : edges[0]!.points.at(-2)!
    expect(port).toEqual({x: 20, y: 115})
    expect(inside.x).toBeGreaterThan(port.x)
    clear(edges, groups, nodes)
  })

})
