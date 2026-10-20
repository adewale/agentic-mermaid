import { describe, expect, test } from 'bun:test'
import { layoutAgenticGraph, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import type { Direction, Point } from '../types.ts'

function measured(overrides: Partial<MeasuredGraph> = {}): MeasuredGraph {
  return {
    nodes: [
      { id: 'left', width: 120, height: 36 },
      { id: 'right', width: 46, height: 80 },
      { id: 'join', width: 95, height: 42 },
      { id: 'sink', width: 62, height: 38 },
      { id: 'disconnected', width: 73, height: 51 },
    ],
    edges: [
      { source: 0, target: 2, minSpan: 1, label: { width: 112, height: 18 } },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 },
      { source: 0, target: 3, minSpan: 3, label: { width: 156, height: 22 } },
      { source: 0, target: 3, minSpan: 1, label: { width: 85, height: 18 } },
    ],
    direction: 'TD', padding: 17, nodeSpacing: 24, layerSpacing: 44, ...overrides,
  }
}

interface Box { x: number; y: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function crossesInterior(a: Point, b: Point, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
    && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height
    && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  throw new Error('A routed segment is not orthogonal')
}

describe('owned measured layered layout', () => {
  for (const direction of ['TD', 'TB', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`preserves measured geometry, labelled fan-in and long parallel routes in ${direction}`, () => {
      const input = measured({ direction })
      const original = structuredClone(input)
      const output = layoutAgenticGraph(input)
      expect(input).toEqual(original)
      expect(layoutAgenticGraph(input)).toEqual(output)
      expect(output.nodes).toHaveLength(input.nodes.length)
      expect(output.edges).toHaveLength(input.edges.length)
      const boxes = output.nodes.map((node, index) => ({ ...node, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index]!
        expect(box.x).toBeGreaterThanOrEqual(input.padding)
        expect(box.y).toBeGreaterThanOrEqual(input.padding)
        expect(box.x + box.width).toBeLessThanOrEqual(output.width - input.padding)
        expect(box.y + box.height).toBeLessThanOrEqual(output.height - input.padding)
        for (let other = index + 1; other < boxes.length; other++) expect(intersects(box, boxes[other]!)).toBe(false)
      }
      const labelBoxes = output.edges.flatMap((edge, index) => {
        const measuredLabel = input.edges[index]!.label
        if (!measuredLabel) { expect(edge.labelPosition).toBeUndefined(); return [] }
        expect(edge.labelPosition).toBeDefined()
        return [{
          edgeIndex: index,
          x: edge.labelPosition!.x - measuredLabel.width / 2,
          y: edge.labelPosition!.y - measuredLabel.height / 2,
          ...measuredLabel,
        }]
      })
      for (let index = 0; index < labelBoxes.length; index++) {
        const label = labelBoxes[index]!
        for (const box of boxes) expect(intersects(label, box)).toBe(false)
        for (const other of labelBoxes.slice(index + 1)) expect(intersects(label, other)).toBe(false)
      }
      const horizontal = direction === 'LR' || direction === 'RL'
      const reversed = direction === 'BT' || direction === 'RL'
      for (let index = 0; index < input.edges.length; index++) {
        const edge = input.edges[index]!, route = output.edges[index]!.points
        const source = boxes[edge.source]!, target = boxes[edge.target]!
        const start = route[0]!, end = route.at(-1)!
        if (horizontal) {
          expect(start.x).toBe(source.x + (reversed ? 0 : source.width))
          expect(end.x).toBe(target.x + (reversed ? target.width : 0))
          expect(start.y).toBeGreaterThan(source.y)
          expect(start.y).toBeLessThan(source.y + source.height)
          expect(end.y).toBeGreaterThan(target.y)
          expect(end.y).toBeLessThan(target.y + target.height)
        } else {
          expect(start.y).toBe(source.y + (reversed ? 0 : source.height))
          expect(end.y).toBe(target.y + (reversed ? target.height : 0))
          expect(start.x).toBeGreaterThan(source.x)
          expect(start.x).toBeLessThan(source.x + source.width)
          expect(end.x).toBeGreaterThan(target.x)
          expect(end.x).toBeLessThan(target.x + target.width)
        }
        for (let segment = 1; segment < route.length; segment++) {
          const a = route[segment - 1]!, b = route[segment]!
          // The painted pill masks its own shaft. Every foreign route and
          // every node must stay clear of its occupied label rectangle.
          for (const box of [...boxes, ...labelBoxes.filter(label => label.edgeIndex !== index)]) expect(crossesInterior(a, b, box)).toBe(false)
        }
        const label = output.edges[index]!.labelPosition
        if (label) expect(route.some((point, index) => {
          const previous = route[index - 1]
          return previous && ((point.x === previous.x && label.x === point.x && label.y >= Math.min(point.y, previous.y) && label.y <= Math.max(point.y, previous.y))
            || (point.y === previous.y && label.y === point.y && label.x >= Math.min(point.x, previous.x) && label.x <= Math.max(point.x, previous.x)))
        })).toBe(true)
      }
      expect(output.edges[3]!.points).not.toEqual(output.edges[4]!.points)
    })
  }

  test('minimum rank spans reserve actual distance, including an otherwise empty rank', () => {
    const nodes = [{ id: 'a', width: 40, height: 20 }, { id: 'b', width: 40, height: 20 }]
    const short = layoutAgenticGraph(measured({ nodes, edges: [{ source: 0, target: 1, minSpan: 1 }] }))
    const long = layoutAgenticGraph(measured({ nodes, edges: [{ source: 0, target: 1, minSpan: 4 }] }))
    expect(long.nodes[1]!.y - long.nodes[0]!.y).toBeGreaterThanOrEqual(4 * 44)
    expect(long.height).toBeGreaterThan(short.height)
    expect(long.edges[0]!.points[0]).toEqual({ x: 37, y: 37 })
    expect(long.edges[0]!.points.at(-1)).toEqual({ x: 37, y: long.nodes[1]!.y })
  })

  test('can order a crossed authored bipartite pair without crossing its routes', () => {
    const input = measured({
      nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 40, height: 20 })),
      edges: [{ source: 0, target: 3, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }],
    })
    const output = layoutAgenticGraph(input)
    const sourceOrder = output.nodes[0]!.x - output.nodes[1]!.x
    const targetOrder = output.nodes[3]!.x - output.nodes[2]!.x
    expect(sourceOrder * targetOrder).toBeGreaterThan(0)
  })

  test('bounds local rank and dummy work before expanding a large minimum span', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 1, minSpan: 1000000 }] })))
      .toThrow(GraphLayoutUnsupportedError)
    const nodes = Array.from({ length: 100 }, (_, index) => ({ id: String(index), width: 40, height: 20 }))
    const edges = Array.from({ length: 400 }, () => ({ source: 0, target: 99, minSpan: 100 }))
    expect(() => layoutAgenticGraph(measured({ nodes, edges }))).toThrow('expanded-graph limit')
  })

  test('declines a self-loop explicitly', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 0, minSpan: 1 }] }))).toThrow(GraphLayoutUnsupportedError)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('retains authored cyclic and reciprocal routes and labels in %s', direction => {
    const input = measured({ direction, edges: [
      { source: 0, target: 1, minSpan: 1, label: { width: 88, height: 18 } },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 0, minSpan: 1, label: { width: 72, height: 18 } },
      { source: 0, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 },
      { source: 3, target: 1, minSpan: 1, label: { width: 63, height: 18 } },
    ] })
    const before = structuredClone(input)
    const output = layoutAgenticGraph(input)
    expect(input).toEqual(before)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(input.edges.length)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    const onOutline = (point: Point, box: Box): boolean =>
      ((Math.abs(point.x - box.x) < 1e-7 || Math.abs(point.x - box.x - box.width) < 1e-7) && point.y >= box.y && point.y <= box.y + box.height)
      || ((Math.abs(point.y - box.y) < 1e-7 || Math.abs(point.y - box.y - box.height) < 1e-7) && point.x >= box.x && point.x <= box.x + box.width)
    for (const [index, edge] of input.edges.entries()) {
      const route = output.edges[index]!.points
      expect(onOutline(route[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.at(-1)!, boxes[edge.target]!)).toBe(true)
      expect(Boolean(output.edges[index]!.labelPosition)).toBe(Boolean(edge.label))
      for (let point = 1; point < route.length; point++) {
        for (const box of boxes) expect(crossesInterior(route[point - 1]!, route[point]!, box)).toBe(false)
      }
    }
  })

  test('invalid measured endpoints remain defects instead of unsupported capabilities', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 99, minSpan: 1 }] }))).toThrow(TypeError)
    expect(() => layoutAgenticGraph(measured({ nodes: [{ id: 'bad', width: NaN, height: 20 }], edges: [] }))).toThrow(TypeError)
  })
})
