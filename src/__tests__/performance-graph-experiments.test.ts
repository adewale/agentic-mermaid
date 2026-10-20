import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { StaticBoundsIndex } from '../experimental/graph-bounds.ts'
import { IncrementalGraphOrder, incrementalSourceOrder } from '../experimental/graph-order.ts'
import { convertToElkFormat, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { applyRouteContracts, classifyRoutes, closeRouteContracts, directLaneBlockers, findRouteHitches, laneContextFor } from '../route-contracts.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { Direction, PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'

const flags = withPerformanceExperiments

describe('incremental graph ordering', () => {
  test('retains author-order cycle choices, duplicates and stable-ready ties', () => {
    const graph = parseMermaid('flowchart LR\nA --> C\nB --> C\nC --> A\nC --> B\nB --> C\nD --> D')
    expect(flags(['incremental-order'], () => classifyRoutes(graph))).toEqual([
      'primary-forward', 'primary-forward', 'feedback', 'feedback', 'primary-forward', 'self-loop',
    ])
    expect(incrementalSourceOrder(['A', 'C', 'B', 'D'], graph.edges)).toEqual(['A', 'B', 'C', 'D'])
  })

  test('maintains the same DAG constraints as independent transitive closure over adversarial insertion orders', () => {
    // A closure matrix is an independent oracle for the online rank/DFS data
    // structure, including rejected backwards insertions and repeated edges.
    for (let seed = 1; seed <= 60; seed++) {
      const count = 2 + seed % 11, ids = Array.from({ length: count }, (_, index) => `N${index}`)
      const dag = new IncrementalGraphOrder(ids), closure = ids.map(() => ids.map(() => false))
      let state = seed
      for (let operation = 0; operation < 80; operation++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const source = state % count
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const target = state % count
        const accepted = source !== target && !closure[target]![source]
        expect(dag.add(ids[source]!, ids[target]!)).toBe(accepted)
        if (accepted) {
          for (let from = 0; from < count; from++) for (let to = 0; to < count; to++) {
            if ((from === source || closure[from]![source]) && (to === target || closure[target]![to])) closure[from]![to] = true
          }
        }
      }
      const order = dag.stableOrder(), rank = new Map(order.map((id, index) => [id, index]))
      expect(order.length).toBe(count)
      for (let from = 0; from < count; from++) for (let to = 0; to < count; to++) {
        if (closure[from]![to]) expect(rank.get(ids[from]!)!).toBeLessThan(rank.get(ids[to]!)!)
      }
    }
  })

  test('retains compound/container classification and the existing ELK model order', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph G[Group]\nA --> C\nB --> C\nend\nC --> D\nD --> A\nG --> E\nE --> G')
    const baseline = flags([], () => ({ classes: classifyRoutes(graph), elk: convertToElkFormat(graph) }))
    expect(flags(['incremental-order'], () => ({ classes: classifyRoutes(graph), elk: convertToElkFormat(graph) }))).toEqual(baseline)
  })
})

describe('pass-owned graph indexes', () => {
  test('returns overlapping bounds in author order, including touching and coincident entries', () => {
    const entries = Array.from({ length: 96 }, (_, value) => {
      const x = value % 6 * 20, y = Math.floor(value / 6) * 20
      return { x0: x, y0: y, x1: x + 15, y1: y + 15, value }
    })
    entries.push({ x0: 20, y0: 20, x1: 35, y1: 35, value: 96 })
    const index = new StaticBoundsIndex(entries)
    for (const [x0, y0, x1, y1] of [[20, 20, 20, 120], [-100, -100, 1000, 1000], [35, 35, 40, 40], [1000, 1000, 1010, 1010]]) {
      expect(index.query(x0!, y0!, x1!, y1!)).toEqual(entries.filter(entry => entry.x0 <= x1! && entry.x1 >= x0! && entry.y0 <= y1! && entry.y1 >= y0!).map(entry => entry.value))
    }
    expect(new StaticBoundsIndex([]).query(0, 0, 1, 1)).toEqual([])
  })

  test('predictor contexts see live moved nodes, moved labels and changed route segments', () => {
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 0, y: 0, width: 40, height: 30 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 400, y: 0, width: 40, height: 30 },
      { id: 'obstacle', label: 'obstacle', shape: 'rectangle', x: 180, y: 0, width: 40, height: 30 },
    ]
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, edgeIndex: 0, points: [{ x: 40, y: 15 }, { x: 400, y: 15 }] }
    const other: PositionedEdge = { ...edge, source: 'C', target: 'D', edgeIndex: 1, label: 'blocker', labelPosition: { x: 200, y: 15 }, points: [{ x: 100, y: 15 }, { x: 300, y: 15 }] }
    flags(['graph-index'], () => {
      const { ctx } = laneContextFor(nodes, [edge, other], 'LR', resolveRenderStyle())
      expect(directLaneBlockers(edge, 15, 40, 400, ctx).map(blocker => blocker.kind)).toEqual(['node', 'label', 'channel'])
      nodes[2]!.y = 200
      other.labelPosition!.y = 200
      other.points[0]!.y = 200; other.points[1]!.y = 200
      expect(directLaneBlockers(edge, 15, 40, 400, ctx)).toEqual([])
    })
  })

  test('read-only segment proofs and mutating closure retain identical final routes and blocker order', () => {
    const source = `flowchart LR\n${Array.from({ length: 36 }, (_, index) => `A${index} --> B${index}`).join('\n')}`
    const graph = parseMermaid(source), style = resolveRenderStyle()
    const positioned: PositionedGraph = { width: 600, height: 4000, groups: [], nodes: [], edges: [] }
    for (let index = 0; index < 36; index++) {
      const y = index * 100
      positioned.nodes.push(
        { ...graph.nodes.get(`A${index}`)!, x: 0, y, width: 40, height: 30 },
        { ...graph.nodes.get(`B${index}`)!, x: 400, y, width: 40, height: 30 },
      )
      positioned.edges.push({ ...graph.edges[index]!, edgeIndex: index,
        points: [{ x: 40, y: y + 15 }, { x: 80, y: y + 15 }, { x: 80, y: y + 50 }, { x: 320, y: y + 50 }, { x: 320, y: y + 15 }, { x: 400, y: y + 15 }],
        routeCertificate: { edgeIndex: index, routeClass: 'primary-forward', invariant: 'explained-detour', bendCount: 4 },
      })
    }
    const hitches = flags([], () => findRouteHitches(positioned, graph, style))
    expect(hitches.length).toBe(36)
    expect(flags(['graph-index'], () => findRouteHitches(positioned, graph, style))).toEqual(hitches)
    const baseline = structuredClone(positioned), indexed = structuredClone(positioned)
    flags([], () => { applyRouteContracts(baseline, graph, new Set(), style); closeRouteContracts(baseline, graph, style) })
    flags(['graph-index'], () => { applyRouteContracts(indexed, graph, new Set(), style); closeRouteContracts(indexed, graph, style) })
    expect(indexed).toEqual(baseline)
    expect(indexed.edges.every(edge => edge.points.length === 2)).toBe(true)
  })
})

describe('certified indexed forest layout', () => {
  for (const direction of ['TD', 'LR', 'BT', 'RL'] satisfies Direction[]) {
    test(`keeps variable-size nodes and edges connected without overlap in ${direction}`, () => {
      const graph = parseMermaid(`flowchart ${direction}\nA[A wider root label] --> B[B]\nA --> C[Wide child label]\nC --> D[D]\nC --> E[Another long descendant]\nF[Disconnected]\nG --> H`)
      const positioned = flags(['indexed-layout', 'graph-index', 'incremental-order'], () => layoutGraphSync(graph))
      expect(positioned.certification).toMatchObject({ status: 'passed', strategy: 'indexed-forest', hardViolations: 0 })
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      for (const edge of positioned.edges) {
        const source = positioned.nodes.find(node => node.id === edge.source)!, target = positioned.nodes.find(node => node.id === edge.target)!
        expect(onShapeOutline(source, edge.points[0]!, 1)).toBe(true)
        expect(onShapeOutline(target, edge.points.at(-1)!, 1)).toBe(true)
        const sourceMain = direction === 'LR' || direction === 'RL' ? source.x : source.y
        const targetMain = direction === 'LR' || direction === 'RL' ? target.x : target.y
        expect((targetMain - sourceMain) * (direction === 'BT' || direction === 'RL' ? -1 : 1)).toBeGreaterThan(0)
      }
      const again = flags(['indexed-layout', 'graph-index', 'incremental-order'], () => layoutGraphSync(graph))
      expect(again).toEqual(positioned)
    })
  }

  test.each([
    'flowchart LR\nA --> B\nB --> A',
    'flowchart TD\nA --> B\nA --> C\nB --> D\nC --> D',
    'flowchart TD\nA --> B\nA --> B',
    'flowchart TD\nA -- label --> B',
    'flowchart TD\nA ---> B',
    'flowchart TD\nA{Decision} --> B',
    'flowchart TD\nsubgraph S[Group]\nA --> B\nend',
  ])('keeps the original certified ELK strategies for an ineligible graph: %s', source => {
    const graph = parseMermaid(source)
    const baseline = flags([], () => layoutGraphSync(graph))
    expect(flags(['indexed-layout'], () => layoutGraphSync(graph))).toEqual(baseline)
  })
})

test('positioned caching preserves C4 artifacts with private identity callbacks', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  const source = 'C4Deployment\ntitle Runtime\nNode(parent,"Production","Linux") {\nContainer(api,"API","Go")\n}\nPerson(user,"User")\nRel(user,api,"Calls","HTTPS")'
  try {
    process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
    const baseline = flags([], () => renderMermaidSVGWithReceipt(source))
    expect(baseline.receipt.layoutCertification?.status).toBe('passed')
    for (let request = 0; request < 2; request++) {
      const actual = flags(['position-cache'], () => renderMermaidSVGWithReceipt(source))
      expect(actual.svg).toBe(baseline.svg)
      expect(actual.receipt.layoutCertification).toEqual(baseline.receipt.layoutCertification)
    }
  } finally {
    if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE
    else process.env.AGENTIC_MERMAID_ELK_CACHE = prior
  }
})
