import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { Direction, Point } from '../types.ts'
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

export function routeCrossHierarchy(
  input: MeasuredGraph, placed: AgenticLayout, owners: Int32Array,
  lifted: ReadonlyMap<number, { source: number; target: number; host: number }>, directions: readonly Direction[],
  work: ChannelWork, expansionLimit: number, fail: (reason: string) => never,
): AgenticLayout {
  const leafCount = input.nodes.length, frames = placed.groups!, groups = input.groups!
  if (leafCount > 64 || groups.length > 16 || lifted.size > 16 || input.edges.length > 128) fail('agentic local cross-hierarchy size limit')
  if (placed.edges.reduce((sum, edge) => sum + edge.points.length, 0) > 2048) fail('agentic local cross-hierarchy route-point limit')
  let expanded = placed.expandedVertices ?? 0
  const clearance = Math.max(8, input.edgeSpacing ?? 6)
  const nodes = placed.nodes.map((point, index): RoutingBox => ({ ...point, width: input.nodes[index]!.width, height: input.nodes[index]!.height }))
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
      else if (groups[group]!.padding.top > 0) obstacles.push(inflate({ ...frame, height: groups[group]!.padding.top }, Math.max(2, (input.edgeSpacing ?? 6) / 2)))
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
    const sources = crossingSource ? terminals(nodes[edge.source]!, directions[owners[edge.source]! + 1]!, true, clearance) : []
    const targets = crossingTarget ? terminals(nodes[edge.target]!, directions[owners[edge.target]! + 1]!, false, clearance) : []
    const grid = createVisibilityGrid(bounds, obstacles, [...sources, ...targets], [start, end], clearance, work, expansionLimit - expanded, fail)
    expanded += grid.vertices
    const first = crossingSource ? grid.route(sources, start) : [start]
    const last = crossingTarget ? grid.route(targets, end).reverse() : [end]
    const points = simplifyOrthogonal([...first, ...core.slice(1, -1), ...last])
    if (selfContact(points, work, fail)) fail('cross-hierarchy route needs an unsupported self-contact repair')
    if (edge.label && !points.some((point, cursor) => cursor > 0 && onSegment(raw.labelPosition!, points[cursor - 1]!, point))) fail('cross-hierarchy route lost its reserved label corridor')
    placed.edges[index] = { ...raw, points }
  }
  return { ...placed, expandedVertices: expanded, boundaryRoutes: [...lifted.keys()] }
}
