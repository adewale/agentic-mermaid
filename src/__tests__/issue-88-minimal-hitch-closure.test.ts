import { describe, expect, test } from 'bun:test'
import { denseDag, diamondFan } from '../../eval/degenerate-etn/generators.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { closeRouteContracts, findRouteHitches } from '../route-contracts.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

const REGRESSIONS = [
  ...[31, 157, 217, 229, 269, 319, 363, 464, 605, 733, 937, 1177, 1653, 1656, 1768, 1938, 1952]
    .map(seed => ({ id: `denseDag #${seed}`, source: denseDag(seed) })),
  ...[269, 373].map(seed => ({ id: `diamondFan #${seed}`, source: diamondFan(seed) })),
] as const

describe('minimal final hitch closure (issue #88)', () => {
  for (const seed of [849, 1368]) {
    test(`denseDag #${seed} keeps arrow arrival normal after sub-pixel port rounding`, () => {
      const graph = parseMermaid(denseDag(seed))
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const edges = positioned.edges.filter(edge => seed === 849
        ? edge.source === 'N6' && edge.target === 'N5'
        : edge.source === 'N2' && edge.target === 'N3')
      expect(edges.length).toBeGreaterThan(0)
      for (const edge of edges) {
        const end = edge.points.at(-1)!, previous = edge.points.at(-2)!
        expect(previous.y).toBe(end.y)
        expect(Math.abs(previous.x - end.x)).toBeGreaterThan(1)
      }
      expect(findRouteHitches(positioned, graph)).toEqual([])
    })
  }

  test('tiny face segments are removed at either end on all faces, but genuine turns are retained', () => {
    const node: PositionedNode = { id: 'box', label: 'Box', shape: 'rectangle', x: 20, y: 20, width: 40, height: 40 }
    for (const source of [true, false]) {
      for (const face of [
        [{ x: 0, y: 40 }, { x: 20, y: 40 }, { x: 20, y: 40.5 }],
        [{ x: 80, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 40.5 }],
        [{ x: 40, y: 0 }, { x: 40, y: 20 }, { x: 40.5, y: 20 }],
        [{ x: 40, y: 80 }, { x: 40, y: 60 }, { x: 40.5, y: 60 }],
      ]) {
        const edge: PositionedEdge = { source: source ? 'box' : 'outside', target: source ? 'outside' : 'box', style: 'solid', hasArrowStart: source, hasArrowEnd: !source, label: 'kept', points: source ? [...face].reverse() : face }
        closeRouteContracts({ nodes: [node], edges: [edge], groups: [] }, parseMermaid('flowchart LR\noutside --> box'), resolveRenderStyle({}))
        expect(edge.points).toEqual(source ? [...face.slice(0, 2)].reverse() : face.slice(0, 2))
        expect(edge.label).toBe('kept')
      }
    }
    for (const shape of ['rectangle', 'diamond'] as const) {
      const edge: PositionedEdge = { source: 'outside', target: 'box', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 0, y: 40 }, { x: 20, y: 40 }, { x: 20, y: shape === 'rectangle' ? 42 : 40.5 }] }
      const original = [...edge.points]
      closeRouteContracts({ nodes: [{ ...node, shape }], edges: [edge], groups: [] }, parseMermaid('flowchart LR\noutside --> box'), resolveRenderStyle({}))
      expect(edge.points).toEqual(original)
    }
  })
  for (const regression of REGRESSIONS) {
    test(regression.id, () => {
      const graph = parseMermaid(regression.source)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      expect(findRouteHitches(positioned, graph)).toEqual([])
    })
  }
})
