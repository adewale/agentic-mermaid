import { expect, test } from 'bun:test'
import { toFinite as f, type RenderedLayout } from '../../src/agent/types.ts'
import { measureEditStability } from './stability.ts'

const layout: RenderedLayout = { version: 1, kind: 'flowchart', bounds: { w: f(100), h: f(100) }, groups: [], nodes: [
  { id: 'A', x: f(0), y: f(0), w: f(30), h: f(40), shape: 'rectangle' },
  { id: 'B', x: f(70), y: f(0), w: f(30), h: f(40), shape: 'rectangle' },
], edges: [
  { id: 'duplicate', from: 'A', to: 'B', path: [[f(30), f(10)], [f(70), f(10)]] },
  { id: 'duplicate', from: 'A', to: 'B', path: [[f(30), f(30)], [f(70), f(30)]] },
] }

test('translation alignment retains raw movement and both duplicate relationships', () => {
  const moved: RenderedLayout = { ...layout, nodes: layout.nodes.map(node => ({ ...node, x: f(node.x + 30), y: f(node.y + 40) })), edges: layout.edges.map(edge => ({ ...edge, path: edge.path.map(([x, y]) => [f(x + 30), f(y + 40)]) })) }
  const score = measureEditStability(layout, moved, new Set())
  expect(score.unchanged.raw.normalizedMean).toBe(1)
  expect(score.unchanged.aligned.max).toBe(0)
  expect(score.comparedEdges).toBe(2)
  expect(score.rawRouteChanges).toBe(2)
  expect(score.alignedRouteChanges).toBe(0)
  expect(score.boundingBoxSideChanges).toBe(0)
})

test('a declared affected subject cannot hide whole-graph movement or unchanged ordering inversions', () => {
  const swapped = { ...layout, nodes: layout.nodes.map((node, index) => ({ ...node, x: f(index ? 0 : 70) })) }
  const all = measureEditStability(layout, swapped, new Set())
  expect(all.relativeOrderInversions).toBe(1)
  expect(all.unchanged.aligned.mean).toBe(70)
  const scoped = measureEditStability(layout, swapped, new Set(['A']))
  expect(scoped.unchanged.aligned.max).toBe(0)
  expect(scoped.wholeGraph.aligned.max).toBe(140)
  expect(scoped.affected).toEqual(['A'])
})
