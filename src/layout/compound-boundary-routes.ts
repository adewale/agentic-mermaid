import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { Direction, Point } from '../types.ts'
import { segmentEntersMeasuredBox } from './measured-route-safety.ts'
import { createVisibilityGrid, simplifyOrthogonal, type RoutingBox, type Terminal } from './compound-visibility.ts'

const inflate = (box: RoutingBox, margin: number): RoutingBox => ({ x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin })
const onSegment = (point: Point, a: Point, b: Point): boolean => (a.x === b.x ? Math.abs(point.x - a.x) < 1e-7 : Math.abs(point.y - a.y) < 1e-7)
  && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)

function terminals(box: RoutingBox, direction: Direction, source: boolean, clearance: number): Terminal[] {
  const forward = direction === 'LR' ? 'E' : direction === 'RL' ? 'W' : direction === 'BT' ? 'N' : 'S'
  const opposite = { N: 'S', E: 'W', S: 'N', W: 'E' } as const
  const preferred = source ? forward : opposite[forward]
  const sides = [preferred, ...(['N', 'E', 'S', 'W'] as const).filter(side => side !== preferred)]
  return sides.flatMap((side, index) => [.5, .25, .75].map(fraction => {
    const port = side === 'N' || side === 'S'
      ? { x: box.x + fraction * box.width, y: side === 'N' ? box.y : box.y + box.height }
      : { x: side === 'W' ? box.x : box.x + box.width, y: box.y + fraction * box.height }
    const stub = { x: port.x + (side === 'E' ? clearance : side === 'W' ? -clearance : 0), y: port.y + (side === 'S' ? clearance : side === 'N' ? -clearance : 0) }
    return { port, stub, penalty: index * clearance * 2 + Math.abs(fraction - .5) * clearance }
  }))
}

function selfContact(points: readonly Point[], work: ChannelWork, fail: (reason: string) => never): boolean {
  for (let index = 2; index < points.length; index++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
    const a = points[index - 2]!, b = points[index - 1]!, c = points[index]!
    if ((a.x === b.x && b.x === c.x && Math.sign(b.y - a.y) !== Math.sign(c.y - b.y))
      || (a.y === b.y && b.y === c.y && Math.sign(b.x - a.x) !== Math.sign(c.x - b.x))) return true
  }
  for (let i = 1; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (--work.pairs < 0) fail('agentic local cross-hierarchy self-check limit')
    const a = points[i - 1]!, b = points[i]!, c = points[j - 1]!, d = points[j]!
    if (a.x === b.x && c.x === d.x) {
      if (a.x === c.x && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >= Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) return true
    } else if (a.y === b.y && c.y === d.y) {
      if (a.y === c.y && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >= Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) return true
    } else {
      const x = a.x === b.x ? a.x : c.x, y = a.x === b.x ? c.y : a.y
      if (onSegment({ x, y }, a, b) && onSegment({ x, y }, c, d)) return true
    }
  }
  return false
}

/** Large scopes first try at most64 short rectilinear corridors, sharing a
 * small fraction of the existing pair budget. Every tested shaft still clears
 * all obstacles. Larger scopes decline if these complete paths are blocked. */
function directCorridor(
  bounds: RoutingBox, obstacles: readonly RoutingBox[], starts: readonly Terminal[], goal: Point,
  frames: readonly RoutingBox[], clearance: number, work: ChannelWork,
  probes: { pairs: number; candidates: number }, fail: (reason: string) => never,
): Point[] | undefined {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
  const test = (raw: Point[]): Point[] | undefined => {
    if (probes.candidates-- <= 0) return
    const path = simplifyOrthogonal(raw)
    for (const point of path) if (!Number.isFinite(point.x + point.y) || point.x < bounds.x || point.x > right || point.y < bounds.y || point.y > bottom) return
    if (selfContact(path, work, fail)) return
    for (let index = 1; index < path.length; index++) {
      if (--work.arcs < 0) fail('agentic local cross-hierarchy direct-arc limit')
      const a = path[index - 1]!, b = path[index]!
      for (const box of obstacles) {
        if (probes.pairs <= 0) return
        probes.pairs--
        if (--work.pairs < 0) fail('agentic local cross-hierarchy direct-pair limit')
        if (segmentEntersMeasuredBox(a, b, box)) return
      }
    }
    return path
  }
  // Check each side's center before considering quarter ports. A blocked
  // endpoint ray cannot be rescued by any subsequent corridor proposal.
  for (let fraction = 0; fraction < 3; fraction++) for (let side = 0; side < 4; side++) {
    const { port, stub } = starts[side * 3 + fraction]!
    if (!test([port, stub])) {
      if (probes.pairs <= 0 || probes.candidates <= 0) return
      continue
    }
    for (const middle of [{ x: goal.x, y: stub.y }, { x: stub.x, y: goal.y }]) {
      const result = test([port, stub, middle, goal])
      if (result) return result
      if (probes.pairs <= 0 || probes.candidates <= 0) return
    }
    for (const frame of frames) {
      const xs = [frame.x - clearance, frame.x + frame.width + clearance]
      const ys = [frame.y - clearance, frame.y + frame.height + clearance]
      for (const x of xs) {
        const result = test([port, stub, { x, y: stub.y }, { x, y: goal.y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
      for (const y of ys) {
        const result = test([port, stub, { x: stub.x, y }, { x: goal.x, y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
      for (const x of xs) for (const y of ys) {
        const result = test([port, stub, { x, y: stub.y }, { x, y }, { x: goal.x, y }, goal])
        if (result) return result
        if (probes.pairs <= 0 || probes.candidates <= 0) return
      }
    }
  }
  return undefined
}

export function routeCrossHierarchy(
  input: MeasuredGraph, placed: AgenticLayout, owners: Int32Array,
  lifted: ReadonlyMap<number, { source: number; target: number; host: number }>, directions: readonly Direction[],
  work: ChannelWork, expansionLimit: number, fail: (reason: string) => never,
): AgenticLayout {
  const leafCount = input.nodes.length, frames = placed.groups!, groups = input.groups!
  if (groups.length > 16 || lifted.size > 16 || input.edges.length > 128) fail('agentic local cross-hierarchy size limit')
  if (placed.edges.reduce((sum, edge) => sum + edge.points.length, 0) > 2048) fail('agentic local cross-hierarchy route-point limit')
  let expanded = placed.expandedVertices ?? 0
  const clearance = Math.max(8, input.edgeSpacing ?? 6)
  const nodes = placed.nodes.map((point, index): RoutingBox => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
  const subjects = [...nodes, ...frames]
  for (const [index, endpoints] of lifted) {
    const edge = input.edges[index]!, raw = placed.edges[index]!
    const quotient = simplifyOrthogonal(raw.points)
    if (quotient.length < 2 || edge.label && !raw.labelPosition) throw new TypeError('Compound quotient lost its route or label')
    const crossingSource = edge.source !== endpoints.source, crossingTarget = edge.target !== endpoints.target
    const escape = (a: Point, b: Point): Point => {
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y), offset = Math.min(clearance, length / 2)
      return { x: a.x + Math.sign(b.x - a.x) * offset, y: a.y + Math.sign(b.y - a.y) * offset }
    }
    const start = crossingSource ? escape(quotient[0]!, quotient[1]!) : quotient[0]!
    const end = crossingTarget ? escape(quotient.at(-1)!, quotient.at(-2)!) : quotient.at(-1)!
    const core = [start, ...quotient.slice(1, -1), end]
    const related = new Set<number>()
    for (const endpoint of [edge.source, edge.target]) for (let parent = owners[endpoint]!; parent >= 0; parent = owners[leafCount + parent]!) related.add(parent)
    const obstacles: RoutingBox[] = nodes.map((box, node) => node === edge.source || node === edge.target ? box : inflate(box, clearance))
    for (let group = 0; group < frames.length; group++) {
      const frame = frames[group]!
      if (!related.has(group)) obstacles.push(inflate(frame, clearance))
      else if (groups[group]!.padding.top > 0) obstacles.push(inflate({ ...frame, height: leafCount > 64 ? (groups[group]!.headerHeight ?? groups[group]!.padding.top) : groups[group]!.padding.top }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
    }
    for (let other = 0; other < placed.edges.length; other++) {
      if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
      const route = placed.edges[other]!, measured = input.edges[other]!
      if (measured.label && route.labelPosition) obstacles.push(inflate({ x: route.labelPosition.x - measured.label.width / 2, y: route.labelPosition.y - measured.label.height / 2, width: measured.label.width, height: measured.label.height }, 2))
      if (other === index || measured.visible === false) continue
      for (let cursor = 1; cursor < route.points.length; cursor++) {
        if (--work.pairs < 0) fail('agentic local cross-hierarchy obstacle-work limit')
        const a = route.points[cursor - 1]!, b = route.points[cursor]!
        obstacles.push(inflate({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
      }
    }
    const host = endpoints.host, frame = host < 0 ? undefined : frames[host], pad = host < 0 ? undefined : groups[host]!.padding
    const bounds = frame && pad ? { x: frame.x + pad.left, y: frame.y + pad.top, width: frame.width - pad.left - pad.right, height: frame.height - pad.top - pad.bottom }
      : { x: 0, y: 0, width: placed.width, height: placed.height }
    const sources = crossingSource ? terminals(subjects[edge.source]!, directions[owners[edge.source]! + 1]!, true, clearance) : []
    const targets = crossingTarget ? terminals(subjects[edge.target]!, directions[owners[edge.target]! + 1]!, false, clearance) : []
    let first = crossingSource ? undefined : [start]
    let last = crossingTarget ? undefined : [end]
    if (leafCount > 64) {
      const probes = { pairs: Math.min(16384, Math.floor(work.pairs / 8)), candidates: 64 }
      const endpointFrames = (endpoint: number): RoutingBox[] => {
        const result: RoutingBox[] = []
        for (let group = owners[endpoint]!; group >= 0; group = owners[leafCount + group]!) result.push(frames[group]!)
        return result
      }
      if (!first) first = directCorridor(bounds, obstacles, sources, start, endpointFrames(edge.source), clearance, work, probes, fail)
      if (!last) last = directCorridor(bounds, obstacles, targets, end, endpointFrames(edge.target), clearance, work, probes, fail)?.reverse()
      if (!first || !last) fail('large cross-hierarchy route has no bounded direct corridor')
    }
    if (!first || !last) {
      const grid = createVisibilityGrid(bounds, obstacles, [...sources, ...targets], [start, end], clearance, work, expansionLimit - expanded, fail)
      expanded += grid.vertices
      first ??= grid.route(sources, start)
      last ??= grid.route(targets, end).reverse()
    }
    const points = simplifyOrthogonal([...first, ...core.slice(1, -1), ...last])
    if (selfContact(points, work, fail)) fail('cross-hierarchy route needs an unsupported self-contact repair')
    if (edge.label && !points.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, points[cursor - 1]!, point))) fail('cross-hierarchy route lost its reserved label corridor')
    placed.edges[index] = { ...raw, points }
  }
  return { ...placed, expandedVertices: expanded, boundaryRoutes: [...lifted.keys()] }
}
