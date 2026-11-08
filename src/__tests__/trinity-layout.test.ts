import { describe, expect, test } from 'bun:test'
import { fitMeasuredLayout } from '../layout/fit-measured-layout.ts'
import { GraphLayoutUnsupportedError, LayoutWorkLimitError, runMeasuredGraphBackend } from '../layout/backend.ts'
import type { MeasuredGraph } from '../layout/measured-graph.ts'
import { solveMeasuredLayout } from '../layout/measured-backend.ts'
import { trinityPlacementAdapter } from '../layout/trinity-placement.ts'
import { trinityMeasuredAdapter } from '../layout/trinity.ts'

const ledger = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
const node = (id: string, width = 100) => ({ id, width, height: 60, contact: 'rectangle' as const, paintStrokeWidth: 2 })
const base = (): MeasuredGraph => ({
  nodes: [node('relation-1 漢🙂'), node('B'), node('C')],
  edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 90, height: 24 } , sourcePortSpan: 2, targetPortSpan: 2}, { source: 0, target: 2, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}, { source: 2, target: 0, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}],
  direction: 'TB', padding: 32, nodeSpacing: 40, layerSpacing: 72, edgeSpacing: 8, minimumTerminalLead: 16, maximumEdgeStrokeWidth: 2,
})

describe('Trinity flat measured solve', () => {
  test.each(['TB', 'BT', 'LR', 'RL'] as const)('retains cyclic authored endpoints, label anchors and fixed bodies in %s', direction => {
    const input = { ...base(), direction }, before = structuredClone(input), adapter = trinityMeasuredAdapter(ledger())
    const result = solveMeasuredLayout({ role: 'routed', graph: input }, adapter)
    expect(input).toEqual(before)
    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toHaveLength(3)
    for (const [i, edge] of result.edges.entries()) {
      const authored = input.edges[i]!, source = result.nodes[authored.source]!, target = result.nodes[authored.target]!
      const first = edge.points[0]!, last = edge.points.at(-1)!
      for (const [at, body] of [[first, source], [last, target]] as const) {
        expect(at.x >= body.x && at.x <= body.x + body.width! && at.y >= body.y && at.y <= body.y + body.height!).toBe(true)
        expect(at.x === body.x || at.x === body.x + body.width! || at.y === body.y || at.y === body.y + body.height!).toBe(true)
      }
      for (let point = 1; point < edge.points.length; point++) {
        const a = edge.points[point - 1]!, b = edge.points[point]!
        expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true)
        expect(a.x === b.x || a.y === b.y).toBe(true)
      }
      if (authored.label) {
        const at = edge.labelPosition!
        expect(at).toBeDefined()
        expect(edge.points.some((a, j) => { const b = edge.points[j + 1]; return b && (a.x === at.x && b.x === at.x && at.y >= Math.min(a.y, b.y) && at.y <= Math.max(a.y, b.y) || a.y === at.y && b.y === at.y && at.x >= Math.min(a.x, b.x) && at.x <= Math.max(a.x, b.x)) })).toBe(true)
      }
    }
    expect(result.nodes.map((body, i) => [body.width, body.height])).toEqual(input.nodes.map(body => [body.width, body.height]))
  })

  test.each(['TB', 'BT', 'LR', 'RL'] as const)('reserves a rounded-body loop and its occupied caption before %s placement', direction => {
    const input: MeasuredGraph = { ...base(), direction, nodes: [{ ...node('loop', 80), contact: 'rounded-rectangle', paintCornerRadius: 8, sizePolicy: 'minimum' }],
      edges: [{ source: 0, target: 0, minSpan: 1, sourcePortSpan: 20, targetPortSpan: 20, label: { width: 90, height: 24 } }] }
    const result = solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))
    const body = result.nodes[0]!, edge = result.edges[0]!, first = edge.points[0]!, last = edge.points.at(-1)!, at = edge.labelPosition!
    expect(first).not.toEqual(last)
    const horizontal = direction === 'LR' || direction === 'RL'
    expect(Math.abs(horizontal ? first.x - last.x : first.y - last.y)).toBeGreaterThanOrEqual(28)
    const start = horizontal ? body.x : body.y, length = horizontal ? body.width! : body.height!, firstPort = horizontal ? first.x : first.y, lastPort = horizontal ? last.x : last.y
    expect(Math.min(firstPort, lastPort) - 10).toBeGreaterThanOrEqual(start + 9)
    expect(Math.max(firstPort, lastPort) + 10).toBeLessThanOrEqual(start + length - 9)
    expect(horizontal ? at.y - 12 > body.y + body.height! : at.x - 45 > body.x + body.width!).toBe(true)
    expect(body.width).toBeGreaterThanOrEqual(input.nodes[0]!.width)
    expect(body.height).toBeGreaterThanOrEqual(input.nodes[0]!.height)
    expect(edge.points).toHaveLength(4)
  })

  test.each(['TB', 'BT', 'LR', 'RL'] as const)('uses fixed centered ellipse contacts without changing the logical footprint in %s', direction => {
    const input: MeasuredGraph = { ...base(), direction, nodes: [
      { id: 'initial', width: 44, height: 28, contact: 'ellipse', contactEllipse: { rx: 12, ry: 12 }, paintStrokeWidth: 0 },
      node('body'),
      { id: 'final', width: 32, height: 40, contact: 'ellipse', contactEllipse: { rx: 14, ry: 14 }, paintStrokeWidth: 1.5 },
    ], edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7 }, { source: 1, target: 2, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7 }] }
    const before = structuredClone(input)
    const result = solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))
    expect(input).toEqual(before)
    expect(result.nodes.map(body => [body.width, body.height])).toEqual(input.nodes.map(body => [body.width, body.height]))
    for (const [index, at] of [[0, result.edges[0]!.points[0]!], [2, result.edges[1]!.points.at(-1)!]] as const) {
      const node = result.nodes[index]!, ellipse = input.nodes[index]!.contactEllipse!
      expect(((at.x - node.x - node.width! / 2) / ellipse.rx) ** 2 + ((at.y - node.y - node.height! / 2) / ellipse.ry) ** 2).toBeCloseTo(1, 10)
    }
  })

  test('declines ellipse loops, reversed duplicate-face demands and oversized artwork; hard ledger exhaustion is not fallback', () => {
    const input: MeasuredGraph = { ...base(), nodes: [{ id: 'dot', width: 28, height: 28, contact: 'ellipse', contactEllipse: { rx: 12, ry: 12 }, paintStrokeWidth: 0 }, node('body')], edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7 }] }
    const solve = (graph: MeasuredGraph, work = ledger()) => solveMeasuredLayout({ role: 'routed', graph }, trinityMeasuredAdapter(work))
    expect(() => solve({ ...input, edges: [...input.edges, { source: 1, target: 0, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7 }] })).toThrow('fixed ellipse has insufficient physical port capacity')
    expect(() => solve({ ...input, edges: [{ source: 0, target: 0, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7 }] })).toThrow('fixed ellipse has insufficient physical port capacity')
    expect(() => solve({ ...input, edges: [{ ...input.edges[0]!, sourcePortSpan: 29 }] })).toThrow('fixed ellipse has insufficient physical port capacity')
    for (const paintStrokeWidth of [NaN, -1]) expect(() => solve({ ...input, nodes: [{ ...input.nodes[0]!, paintStrokeWidth, sizePolicy: 'minimum' }, input.nodes[1]!] })).toThrow(TypeError)
    expect(() => solve(input, { ...ledger(), pairs: -1 })).toThrow(LayoutWorkLimitError)
    for (const contactEllipse of [{ rx: NaN, ry: 12 }, { rx: 15, ry: 12 }]) expect(() => solve({ ...input, nodes: [{ ...input.nodes[0]!, contactEllipse }, input.nodes[1]!] })).toThrow(TypeError)
    expect(() => solve({ ...input, nodes: [{ ...input.nodes[0]!, sizePolicy: 'minimum' }, input.nodes[1]!] })).toThrow('ellipse contact requires a fixed body')
    expect(() => solve({ ...input, nodes: [{ ...input.nodes[0]!, contact: 'rectangle', contactEllipse: undefined }, input.nodes[1]!] })).toThrow(TypeError)
  })

  test('keeps external inlet and cycle peer co-ranked instead of adding a DFS-dependent rank', () => {
    const input: MeasuredGraph = { ...base(), nodes: [node('fast', 180), node('suite', 120), node('report', 120)], edges: [
      { source: 1, target: 0, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}, { source: 1, target: 0, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2},
      { source: 0, target: 2, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}, { source: 2, target: 0, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}, { source: 0, target: 0, minSpan: 1, label: { width: 64, height: 24 } , sourcePortSpan: 2, targetPortSpan: 2},
    ] }
    const result = solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))
    expect(result.nodes[1]!.y).toBe(result.nodes[2]!.y)
    expect(result.nodes[0]!.y).toBeGreaterThan(result.nodes[1]!.y)
    expect(result.edges).toHaveLength(5)
  })

  test('declines insufficient fixed capacity and returns permitted growth before coordinates', () => {
    const input: MeasuredGraph = { ...base(), nodes: [node('root', 20), node('B'), node('C')], edges: [
      { source: 0, target: 1, minSpan: 1, sourcePortSpan: 24 , targetPortSpan: 2}, { source: 0, target: 2, minSpan: 1, sourcePortSpan: 24 , targetPortSpan: 2},
    ] }
    expect(() => solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))).toThrow('fixed body has insufficient physical port capacity')
    const growing = { ...input, nodes: input.nodes.map((body, i) => i ? body : { ...body, sizePolicy: 'minimum' as const }) }
    const result = solveMeasuredLayout({ role: 'routed', graph: growing }, trinityMeasuredAdapter(ledger()))
    const root = result.nodes[0]!
    expect(root.width).toBeGreaterThanOrEqual(48)
    expect(root.height).toBe(60)
    const [a, b] = result.edges.map(edge => edge.points[0]!)
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThanOrEqual(32)
    expect(input.nodes[0]!.width).toBe(20)
  })

  test('includes endpoint half-support at face ends, including a single oversized decoration', () => {
    const input: MeasuredGraph = { ...base(), nodes: [node('small', 16), node('other')], edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: 100, targetPortSpan: 2 }] }
    expect(() => solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))).toThrow('fixed body has insufficient physical port capacity')
    const growing = { ...input, nodes: [{ ...input.nodes[0]!, sizePolicy: 'minimum' as const }, input.nodes[1]!] }
    const result = solveMeasuredLayout({ role: 'routed', graph: growing }, trinityMeasuredAdapter(ledger()))
    const body = result.nodes[0]!, port = result.edges[0]!.points[0]!
    expect(port.x - 50).toBeGreaterThanOrEqual(body.x + 1)
    expect(port.x + 50).toBeLessThanOrEqual(body.x + body.width! - 1)
  })

  test('accepts measured thin-edge supports beside an unrelated thicker edge', () => {
    const input: MeasuredGraph = { ...base(), maximumEdgeStrokeWidth: 10, nodes: ['A', 'B', 'C', 'D'].map(id => node(id)), edges: [
      { source: 0, target: 1, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 2 },
      { source: 2, target: 3, minSpan: 1, sourcePortSpan: 10, targetPortSpan: 10 },
    ] }
    expect(solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger())).edges).toHaveLength(2)
  })

  test('declines unknown paint/support and unused long-loop constraints explicitly', () => {
    for (const input of [
      { ...base(), maximumEdgeStrokeWidth: undefined },
      { ...base(), nodes: base().nodes.map(body => ({ ...body, paintStrokeWidth: undefined })) },
      { ...base(), edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: undefined, targetPortSpan: 2 }] },
      { ...base(), edges: [{ source: 0, target: 0, minSpan: 2, sourcePortSpan: 2, targetPortSpan: 2 }] },
    ]) expect(() => solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))).toThrow(GraphLayoutUnsupportedError)
  })

  test('supplied-ledger exhaustion cannot authorize an ELK fallback', () => {
    let fallback = 0
    expect(() => runMeasuredGraphBackend({ graphLayout: { backend: 'agentic', fallback: 'elk' } },
      () => solveMeasuredLayout({ role: 'routed', graph: base() }, trinityMeasuredAdapter({ pairs: 0, arcs: 100, swaps: 100 })),
      () => { fallback++; return undefined },
    )).toThrow(LayoutWorkLimitError)
    expect(fallback).toBe(0)
  })

  test('shared fitting retains actual permitted dimensions rather than the smaller measured minimum', () => {
    const input: MeasuredGraph = { ...base(), nodes: [{ ...node('small', 20), height: 20, sizePolicy: 'minimum' }],
      edges: [{ source: 0, target: 0, minSpan: 1, label: { width: 90, height: 24 } , sourcePortSpan: 2, targetPortSpan: 2}] }
    const result = solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(ledger()))
    const size = [result.nodes[0]!.width, result.nodes[0]!.height]
    const fitted = fitMeasuredLayout(input, result)
    expect([fitted.nodes[0]!.width, fitted.nodes[0]!.height]).toEqual(size)
    expect(fitted.width).toBeGreaterThanOrEqual(fitted.nodes[0]!.x + size[0]! + input.padding)
    expect(fitted.height).toBeGreaterThanOrEqual(fitted.nodes[0]!.y + size[1]! + input.padding)
    expect(size[1]).toBeGreaterThan(20)
  })

  test('placement does not spend route-validation work or return temporary routes', () => {
    const input = base(), placementWork = ledger(), routedWork = ledger()
    const placement = solveMeasuredLayout({ role: 'placement', graph: input }, trinityMeasuredAdapter(placementWork))
    const routed = solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter(routedWork))
    expect(placement.nodes).toEqual(routed.nodes)
    expect(placementWork.pairs).toBeGreaterThan(routedWork.pairs)
    expect('edges' in placement && placement.edges).toEqual([])
  })

  test('does not reset the caller ledger or cache mutable results', () => {
    const input = base(), work = ledger(), adapter = trinityMeasuredAdapter(work)
    const first = solveMeasuredLayout({ role: 'routed', graph: input }, adapter), remaining = work.pairs
    const expected = structuredClone(first)
    first.nodes[0]!.x = -999; first.edges[0]!.points[0]!.x = -999
    expect(solveMeasuredLayout({ role: 'routed', graph: input }, adapter)).toEqual(expected)
    expect(work.pairs).toBeLessThan(remaining)
    work.pairs = 0
    expect(() => solveMeasuredLayout({ role: 'routed', graph: input }, adapter)).toThrow(LayoutWorkLimitError)
    expect(work.pairs).toBeLessThan(0)
  })

  test('separates malformed geometry from unsupported contact and scope constraints', () => {
    const input = base()
    expect(() => solveMeasuredLayout({ role: 'routed', graph: { ...input, edges: [{ source: 0, target: 3, minSpan: 1 , sourcePortSpan: 2, targetPortSpan: 2}] } }, trinityMeasuredAdapter(ledger()))).toThrow(TypeError)
    expect(() => solveMeasuredLayout({ role: 'routed', graph: { ...input, nodes: [node('A', NaN)] } }, trinityMeasuredAdapter(ledger()))).toThrow(TypeError)
    const unknown = { ...input, nodes: input.nodes.map(body => ({ ...body, contact: undefined })) }
    expect(() => solveMeasuredLayout({ role: 'routed', graph: unknown }, trinityMeasuredAdapter(ledger()))).toThrow(GraphLayoutUnsupportedError)
    expect(() => solveMeasuredLayout({ role: 'routed', graph: { ...input, edges: [{ source: 0, target: 1, minSpan: 1, short: true , sourcePortSpan: 2, targetPortSpan: 2}] } }, trinityMeasuredAdapter(ledger()))).toThrow('short edges')
  })
  test.each(['TB', 'BT', 'LR', 'RL'] as const)('reuses ordered forest body placement with painted bounds in %s', direction => {
    const input: MeasuredGraph = {
      nodes: [node('root'), { ...node('left'), height: 40 }, { ...node('right'), height: 90 }, node('leaf'), node('island 漢🙂')],
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 2, minSpan: 1 }, { source: 2, target: 3, minSpan: 1 }],
      direction, padding: 16, nodeSpacing: 20, layerSpacing: 40,
    }
    const before = structuredClone(input), placed = solveMeasuredLayout({ role: 'placement', graph: input }, trinityPlacementAdapter(ledger()))
    expect(input).toEqual(before)
    expect(placed.nodes).toHaveLength(5)
    expect('edges' in placed).toBe(false)
    for (let i = 0; i < placed.nodes.length; i++) {
      const a = placed.nodes[i]!, source = input.nodes[i]!
      expect([a.width, a.height]).toEqual([source.width, source.height])
      expect(a.x - 1).toBeGreaterThanOrEqual(16)
      expect(a.y - 1).toBeGreaterThanOrEqual(16)
      expect(a.x + a.width! + 1).toBeLessThanOrEqual(placed.width - 16)
      expect(a.y + a.height! + 1).toBeLessThanOrEqual(placed.height - 16)
      for (let j = 0; j < i; j++) {
        const b = placed.nodes[j]!
        expect(a.x - 1 < b.x + b.width! + 1 && a.x + a.width! + 1 > b.x - 1 && a.y - 1 < b.y + b.height! + 1 && a.y + a.height! + 1 > b.y - 1).toBe(false)
      }
    }
    const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
    for (const edge of input.edges) {
      const source = placed.nodes[edge.source]!, target = placed.nodes[edge.target]!
      const delta = horizontal ? target.x - source.x : target.y - source.y
      expect(reverse ? delta < 0 : delta > 0).toBe(true)
    }
  })

  test('placement cannot silently ignore contradictory ellipse metadata', () => {
    const input: MeasuredGraph = { nodes: [{ ...node('body'), contactEllipse: { rx: 12, ry: 12 } }], edges: [], direction: 'TB', padding: 16, nodeSpacing: 20, layerSpacing: 40 }
    for (const adapter of [trinityPlacementAdapter(ledger()), trinityMeasuredAdapter(ledger())]) expect(() => solveMeasuredLayout({ role: 'placement', graph: input }, adapter)).toThrow(TypeError)
  })

  test('places a 128-body chain without constructing generic routes or loading its routed slice', () => {
    const input: MeasuredGraph = {
      nodes: Array.from({ length: 128 }, (_, i) => node(`entity-${i}`)),
      edges: Array.from({ length: 127 }, (_, i) => ({ source: i, target: i + 1, minSpan: 1 })),
      direction: 'LR', padding: 16, nodeSpacing: 20, layerSpacing: 40,
    }
    const work = ledger(), result = solveMeasuredLayout({ role: 'placement', graph: input }, trinityPlacementAdapter(work))
    expect(result.nodes).toHaveLength(128)
    expect('edges' in result).toBe(false)
    expect(result.nodes[127]!.x).toBeGreaterThan(result.nodes[0]!.x)
    expect(work.pairs).toBe(1_000_000 - 255)
    expect(work.arcs).toBe(65536 - 127)
  })

  test('a single placement body reserves its actual stroke without growing its fixed dimensions', () => {
    const input: MeasuredGraph = { nodes: [{ id: 'solo', width: 20, height: 12, contact: 'rectangle', paintStrokeWidth: 4 }], edges: [], direction: 'TB', padding: 2, nodeSpacing: 0, layerSpacing: 0 }
    const result = solveMeasuredLayout({ role: 'placement', graph: input }, trinityPlacementAdapter(ledger()))
    expect(result).toEqual({ width: 28, height: 20, nodes: [{ x: 4, y: 4, width: 20, height: 12 }] })
  })

  test('placement declines declared routing demands and preserves spent work across failed preparation', () => {
    const input: MeasuredGraph = { nodes: [node('A'), node('B')], edges: [{ source: 0, target: 1, minSpan: 1 }], direction: 'TB', padding: 16, nodeSpacing: 20, layerSpacing: 40 }
    expect(() => solveMeasuredLayout({ role: 'placement', graph: { ...input, nodes: input.nodes.map(body => ({ ...body, contact: undefined })) } }, trinityPlacementAdapter(ledger()))).toThrow(GraphLayoutUnsupportedError)
    expect(() => solveMeasuredLayout({ role: 'placement', graph: { ...input, edges: [{ ...input.edges[0]!, label: { width: 40, height: 20 } }] } }, trinityPlacementAdapter(ledger()))).toThrow(GraphLayoutUnsupportedError)
    const work = { pairs: 8, arcs: 4, swaps: 0 }, adapter = trinityPlacementAdapter(work)
    const cycle = { ...input, edges: [...input.edges, { source: 1, target: 0, minSpan: 1 }] }
    expect(() => solveMeasuredLayout({ role: 'placement', graph: cycle }, adapter)).toThrow(GraphLayoutUnsupportedError)
    expect(work.pairs).toBe(4)
    expect(work.arcs).toBe(2)
    expect(() => solveMeasuredLayout({ role: 'placement', graph: cycle }, adapter)).toThrow(GraphLayoutUnsupportedError)
    expect(work.pairs).toBe(0)
    expect(() => solveMeasuredLayout({ role: 'placement', graph: input }, adapter)).toThrow(LayoutWorkLimitError)
  })

  test('an already exhausted ledger precedes even an unsupported routed size', () => {
    const input = { ...base(), nodes: Array.from({ length: 65 }, (_, i) => node(`N${i}`)) }
    expect(() => solveMeasuredLayout({ role: 'routed', graph: input }, trinityMeasuredAdapter({ pairs: -1, arcs: 100, swaps: 100 }))).toThrow(LayoutWorkLimitError)
  })

})
