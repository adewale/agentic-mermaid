import { describe, expect, test } from 'bun:test'
import { layoutAgenticGraph, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { GraphLayoutUnsupportedError } from '../layout/backend.ts'
import type { Direction, Point } from '../types.ts'
import { countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'
import { assignChannelTracks } from '../layout/channel-tracks.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

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

function onOutline(point: Point, box: Box): boolean {
  return ((Math.abs(point.x - box.x) < 1e-7 || Math.abs(point.x - box.x - box.width) < 1e-7) && point.y >= box.y && point.y <= box.y + box.height)
    || ((Math.abs(point.y - box.y) < 1e-7 || Math.abs(point.y - box.y - box.height) < 1e-7) && point.x >= box.x && point.x <= box.x + box.width)
}

function crossesInterior(a: Point, b: Point, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x && a.x < box.x + box.width
    && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  if (a.y === b.y) return a.y > box.y && a.y < box.y + box.height
    && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
  throw new Error('A routed segment is not orthogonal')
}

describe('owned measured layered layout', () => {
  for (const direction of ['TD', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`aligns distinct fan-in ports with reserved lanes in ${direction}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL'
      const input = measured({ direction, padding: 16, nodeSpacing: 24, layerSpacing: 48,
        nodes: [80, 80, 220].map((cross, index) => ({ id: String(index), width: horizontal ? 40 : cross, height: horizontal ? cross : 40 })),
        edges: [{ source: 0, target: 2, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }],
      })
      const output = layoutAgenticGraph(input)
      expect(output.edges.reduce((sum, edge) => sum + edge.points.length - 2, 0)).toBeLessThanOrEqual(2)
      expect(countPolylineCrossings(output.edges)).toBe(0)
      const ends = output.edges.map(edge => edge.points.at(-1)!)
      expect(Math.abs(horizontal ? ends[0]!.y - ends[1]!.y : ends[0]!.x - ends[1]!.x)).toBeGreaterThanOrEqual(8)
      const boxes = output.nodes.map((node, index) => ({ ...node, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
      for (const [index, edge] of output.edges.entries()) {
        expect(onOutline(edge.points[0]!, boxes[input.edges[index]!.source]!)).toBe(true)
        expect(onOutline(edge.points.at(-1)!, boxes[2]!)).toBe(true)
        for (let i = 1; i < edge.points.length; i++) for (const box of boxes) expect(crossesInterior(edge.points[i - 1]!, edge.points[i]!, box)).toBe(false)
      }
    })
  }
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
      for (const edge of output.edges) if (edge.labelPosition) expect(edge.points.some(point => point === edge.labelPosition)).toBe(false)
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

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('compacts long measured channels without a turn at every rank in %s', direction => {
    const sizes = [40, 200, 20, 200, 40]
    const input = measured({ direction, nodes: sizes.map((size, index) => ({ id: `n${index}`, width: size, height: size })), edges: [
      { source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 }, { source: 3, target: 4, minSpan: 1 },
      { source: 0, target: 4, minSpan: 1 },
    ] })
    const output = layoutAgenticGraph(input), route = output.edges[4]!.points
    expect(route.length).toBeLessThanOrEqual(6)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    expect(onOutline(route[0]!, boxes[0]!)).toBe(true)
    expect(onOutline(route.at(-1)!, boxes[4]!)).toBe(true)
    for (let index = 1; index < route.length; index++) for (const box of boxes) expect(crossesInterior(route[index - 1]!, route[index]!, box)).toBe(false)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('keeps interleaved routes distinct instead of hiding crossings in shared ink in %s', direction => {
    const input = measured({ direction, nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 40 })), edges: [
      { source: 0, target: 2, minSpan: 1 }, { source: 0, target: 3, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1 }, { source: 1, target: 3, minSpan: 1 },
    ] })
    const output = layoutAgenticGraph(input)
    const routes = output.edges.map((route, index) => ({ ...route, source: input.nodes[input.edges[index]!.source]!.id,
      target: input.nodes[input.edges[index]!.target]!.id, style: 'solid' as const }))
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countPolylineCrossings(routes)).toBeGreaterThan(0)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('shortens parallel routes between unequal boxes without sharing their shafts in %s', direction => {
    const input = measured({ direction, nodes: [{ id: 'a', width: 80, height: 40 }, { id: 'b', width: 40, height: 60 }],
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 0, target: 1, minSpan: 1 }] })
    const original = structuredClone(input), placed = layoutAgenticGraph(input)
    const routes = placed.edges.map(edge => ({ ...edge, source: 'a', target: 'b', style: 'solid' as const }))
    expect(routes).toHaveLength(2)
    for (const route of routes) expect(route.points.length).toBeLessThanOrEqual(4)
    expect(countPolylineCrossings(routes)).toBe(0)
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
    expect(routes[0]!.points).not.toEqual(routes[1]!.points)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(placed)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('keeps a labelled branch beside an unrelated wide root in %s', direction => {
    const horizontal = direction === 'LR' || direction === 'RL'
    const input = measured({ direction, nodes: [80, 80, 80, 200].map((size, index) => ({ id: String(index),
      width: horizontal ? 40 : size, height: horizontal ? size : 40 })), edges: [
      { source: 0, target: 1, minSpan: 1, label: horizontal ? { width: 20, height: 160 } : { width: 160, height: 20 } },
      { source: 1, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input), placed = layoutAgenticGraph(input), axis = horizontal ? 'y' : 'x'
    expect(placed.nodes[1]![axis]).toBeLessThan(placed.nodes[3]![axis])
    expect(placed.nodes[1]![axis]).toBe(placed.nodes[2]![axis])
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    expect(input).toEqual(original)
  })

  test('keeps nearly coincident terminal columns out of parallel route ink', () => {
    const steps = [
      { sourceCross: 100.25, targetCross: 140, offset: 0, track: 0 },
      { sourceCross: 20, targetCross: 100, offset: 0, track: 0 },
    ] as import('../layout/channel-tracks.ts').ChannelStep[]
    const height = assignChannelTracks(steps, 60, 6, 180, { pairs: 100, arcs: 100, swaps: 100 }, reason => { throw new Error(reason) })
    const routes = steps.map(step => ({ source: 'a', target: 'b', style: 'solid' as const, points: [
      { x: step.sourceCross, y: 0 }, { x: step.sourceCross, y: step.offset },
      { x: step.targetEscape ?? step.targetCross, y: step.offset },
      ...(step.targetEscape === undefined ? [] : [{ x: step.targetEscape, y: step.targetExit! }, { x: step.targetCross, y: step.targetExit! }]),
      { x: step.targetCross, y: height },
    ] }))
    expect(countParallelRouteOverlaps(routes)).toBe(0)
    expect(countOpposingRouteOverlaps(routes)).toBe(0)
  })

  test('compacts a short incoming branch without lengthening its minimum span', () => {
    const input = measured({ nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 40 })), edges: [
      { source: 0, target: 1, minSpan: 1 }, { source: 1, target: 2, minSpan: 1 }, { source: 3, target: 2, minSpan: 1 },
    ] })
    const original = structuredClone(input)
    const placed = layoutAgenticGraph(input)
    expect(placed.nodes[3]!.y).toBe(placed.nodes[1]!.y)
    expect(placed.nodes[1]!.y).toBeGreaterThan(placed.nodes[0]!.y)
    expect(placed.nodes[2]!.y).toBeGreaterThan(placed.nodes[1]!.y)
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    expect(input).toEqual(original)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('owns shared routing only for complete, unlabelled fan nets in %s', direction => {
    const input = measured({ direction, shareCompleteFans: true, nodes: ['\0agentic-fan:0', 'b', 'c', 'd'].map((id, index) => ({ id, width: 80 + 10 * index, height: 40 + 20 * index })), edges: [
      { source: 0, target: 2, minSpan: 1 }, { source: 0, target: 3, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1 }, { source: 1, target: 3, minSpan: 1 },
    ] })
    const original = structuredClone(input), shared = layoutAgenticGraph(input)
    expect(shared.nodes).toHaveLength(4)
    expect(shared.edges).toHaveLength(4)
    expect(shared.sharedEdges).toEqual([0, 1, 2, 3])
    expect(countPolylineCrossings(shared.edges)).toBe(0)
    const ink = shared.edges.map((edge, index) => ({ ...edge, style: 'solid' as const, source: input.nodes[input.edges[index]!.source]!.id, target: input.nodes[input.edges[index]!.target]!.id }))
    expect(countParallelRouteOverlaps(ink)).toBe(0)
    expect(countOpposingRouteOverlaps(ink)).toBe(0)
    const boxes = shared.nodes.map((point, index) => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
    for (const [index, edge] of input.edges.entries()) {
      const path = shared.edges[index]!.points
      expect(onOutline(path[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(path.at(-1)!, boxes[edge.target]!)).toBe(true)
      for (let cursor = 1; cursor < path.length; cursor++) for (const box of boxes) expect(crossesInterior(path[cursor - 1]!, path[cursor]!, box)).toBe(false)
    }
    expect(shared.edges[0]!.points[0]).toEqual(shared.edges[1]!.points[0])
    expect(shared.edges[0]!.points[0]).not.toBe(shared.edges[1]!.points[0])
    expect(input).toEqual(original)
    for (const edges of [input.edges.slice(0, 3), [...input.edges, input.edges[0]!],
      input.edges.map((edge, index) => index === 0 ? { ...edge, label: { width: 80, height: 20 } } : edge),
      input.edges.map((edge, index) => index === 0 ? { ...edge, minSpan: 2 } : edge)]) {
      const result = layoutAgenticGraph({ ...input, edges })
      expect(result.nodes).toHaveLength(4)
      expect(result.edges).toHaveLength(edges.length)
      expect(result.sharedEdges).toBeUndefined()
    }
  })

  test('bounds local rank and dummy work before expanding a large minimum span', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 1, minSpan: 1000000 }] })))
      .toThrow(GraphLayoutUnsupportedError)
    const nodes = Array.from({ length: 100 }, (_, index) => ({ id: String(index), width: 40, height: 20 }))
    const edges = Array.from({ length: 400 }, () => ({ source: 0, target: 99, minSpan: 100 }))
    expect(() => layoutAgenticGraph(measured({ nodes, edges }))).toThrow('expanded-graph limit')
    const full = Array.from({ length: 4096 }, (_, index) => ({ id: String(index), width: 40, height: 20 }))
    expect(() => layoutAgenticGraph(measured({ nodes: full, edges: [{ source: 0, target: 0, minSpan: 1 }] }))).toThrow('loop-expansion limit')
    // Each scope fits alone; their combined expanded workspace must also fit.
    const groups = Array.from({ length: 17 }, (_, index) => ({ id: `group${index}`, minWidth: 100, padding: { top: 30, right: 20, bottom: 20, left: 20 } }))
    const scoped = Array.from({ length: 34 }, (_, index) => ({ id: `leaf${index}`, width: 40, height: 20, parent: Math.floor(index / 2) }))
    const links = groups.map((_, index) => ({ source: 2 * index, target: 2 * index + 1, minSpan: 1000 }))
    expect(() => layoutAgenticGraph(measured({ nodes: scoped, groups, edges: links }))).toThrow('compound-expansion limit')
    const fanNodes = Array.from({ length: 1002 }, (_, index) => ({ id: `fan${index}`, width: 40, height: 20 }))
    const fanEdges = fanNodes.slice(1).map((_, index) => ({ source: 0, target: index + 1, minSpan: 1, label: { width: 60, height: 20 } }))
    expect(() => layoutAgenticGraph(measured({ nodes: fanNodes, edges: fanEdges }))).toThrow('channel-pair limit')
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('retains authored cyclic, reciprocal and self-loop routes and labels in %s', direction => {
    const input = measured({ direction, nodes: measured().nodes.map((node, index) => index === 0 ? { ...node, id: '\0agentic-loop:0' } : node), edges: [
      { source: 0, target: 1, minSpan: 1, label: { width: 88, height: 18 } },
      { source: 1, target: 2, minSpan: 1 },
      { source: 2, target: 0, minSpan: 1, label: { width: 72, height: 18 } },
      { source: 0, target: 2, minSpan: 1 },
      { source: 2, target: 3, minSpan: 1 },
      { source: 3, target: 1, minSpan: 1, label: { width: 63, height: 18 } },
      { source: 0, target: 0, minSpan: 1, label: { width: 101, height: 38 } },
      { source: 0, target: 0, minSpan: 1 },
      { source: 2, target: 2, minSpan: 1, label: { width: 78, height: 18 } },
    ] })
    const before = structuredClone(input)
    const output = layoutAgenticGraph(input)
    expect(input).toEqual(before)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.edges).toHaveLength(input.edges.length)
    expect(output.nodes).toHaveLength(input.nodes.length)
    const boxes = output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point }))
    for (const [index, edge] of input.edges.entries()) {
      const route = output.edges[index]!.points
      expect(onOutline(route[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.at(-1)!, boxes[edge.target]!)).toBe(true)
      expect(Boolean(output.edges[index]!.labelPosition)).toBe(Boolean(edge.label))
      for (let point = 1; point < route.length; point++) {
        expect(route[point]!.x === route[point - 1]!.x || route[point]!.y === route[point - 1]!.y).toBe(true)
        for (const box of boxes) expect(crossesInterior(route[point - 1]!, route[point]!, box)).toBe(false)
      }
    }
    expect(output.edges[6]!.points).not.toEqual(output.edges[7]!.points)
  })

  test('reserves nested frame headers and local directions while retaining authored frame endpoints', () => {
    const pad = { top: 35, right: 20, bottom: 20, left: 20 }
    const input = measured({ direction: 'LR', nodes: [
      { id: 'start', width: 80, height: 30 },
      { id: 'a', width: 80, height: 30, parent: 1 }, { id: 'b', width: 100, height: 40, parent: 1 },
      { id: 'c', width: 90, height: 35, parent: 2 }, { id: 'd', width: 110, height: 45, parent: 2 },
      { id: 'end', width: 80, height: 30 },
    ], groups: [
      { id: 'outer', direction: 'TD', minWidth: 300, padding: pad },
      { id: 'left', parent: 0, direction: 'RL', minWidth: 150, padding: pad },
      { id: 'right', parent: 0, direction: 'BT', minWidth: 150, padding: pad },
    ], edges: [
      { source: 0, target: 6, minSpan: 1 }, { source: 6, target: 5, minSpan: 1 },
      { source: 1, target: 2, minSpan: 1, label: { width: 130, height: 25 } },
      { source: 3, target: 4, minSpan: 1 }, { source: 7, target: 8, minSpan: 1 },
    ] })
    const original = structuredClone(input), output = layoutAgenticGraph(input)
    expect(input).toEqual(original)
    expect(layoutAgenticGraph(input)).toEqual(output)
    expect(output.nodes).toHaveLength(6)
    expect(output.groups).toHaveLength(3)
    expect(output.edges).toHaveLength(5)
    const frames = output.groups!
    const boxes = [...output.nodes.map((point, index) => ({ ...input.nodes[index]!, ...point })), ...frames]
    for (const [index, edge] of input.edges.entries()) {
      const route = output.edges[index]!
      expect(onOutline(route.points[0]!, boxes[edge.source]!)).toBe(true)
      expect(onOutline(route.points.at(-1)!, boxes[edge.target]!)).toBe(true)
    }
    for (let index = 1; index < frames.length; index++) {
      const frame = frames[index]!, outer = frames[0]!
      expect(frame.y).toBeGreaterThanOrEqual(outer.y + pad.top)
      expect(frame.x).toBeGreaterThanOrEqual(outer.x + pad.left)
      expect(frame.x + frame.width).toBeLessThanOrEqual(outer.x + outer.width - pad.right)
      expect(frame.y + frame.height).toBeLessThanOrEqual(outer.y + outer.height - pad.bottom)
    }
    for (let index = 1; index <= 4; index++) {
      const node = boxes[index]!, frame = frames[index <= 2 ? 1 : 2]!
      expect(node.y).toBeGreaterThanOrEqual(frame.y + pad.top)
      expect(node.x).toBeGreaterThanOrEqual(frame.x + pad.left)
      expect(node.x + node.width).toBeLessThanOrEqual(frame.x + frame.width - pad.right)
      expect(node.y + node.height).toBeLessThanOrEqual(frame.y + frame.height - pad.bottom)
    }
    expect(output.nodes[1]!.x).toBeGreaterThan(output.nodes[2]!.x)
    expect(output.nodes[3]!.y).toBeGreaterThan(output.nodes[4]!.y)
    expect(frames[0]!.width).toBeGreaterThanOrEqual(300)
    expect(() => layoutAgenticGraph({ ...input, edges: [{ source: 1, target: 3, minSpan: 1 }] })).toThrow('cross-hierarchy leaf routes')
    expect(() => layoutAgenticGraph({ ...input, groups: input.groups!.map((group, index) => index === 0 ? { ...group, parent: 1 } : group) })).toThrow(TypeError)
  })

  test('invalid measured endpoints remain defects instead of unsupported capabilities', () => {
    expect(() => layoutAgenticGraph(measured({ edges: [{ source: 0, target: 99, minSpan: 1 }] }))).toThrow(TypeError)
    expect(() => layoutAgenticGraph(measured({ nodes: [{ id: 'bad', width: NaN, height: 20 }], edges: [] }))).toThrow(TypeError)
  })
})
