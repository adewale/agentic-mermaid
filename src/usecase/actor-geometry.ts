import { simplifyOrthogonal } from '../layout/compound-visibility.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
import type { Geometry } from '../scene/ir.ts'
import { pointOnRoutingBoundary, type ShapeRoutingBoundary } from '../shape-outline.ts'
import type { Point, PortSide, PositionedNode } from '../types.ts'

export interface UsecaseActorGlyph {
  geometry: Geometry
  boundary: ShapeRoutingBoundary
  head: { cx: number; cy: number; r: number }
  segments: [Point, Point][]
  strokeHalf: number
  strokeRegions: Point[][]
  ports: Map<string, Point>
}

export interface UsecaseActorAttachment { ownerId: string; portId: string; point: Point }

/** Packing includes the caption, but this open glyph has no rectangular
 * painted enclosure. Ports use the native stroke's outside boundary, including
 * its finite butt caps and the joined legs, rather than its centerline. */
export function usecaseActorGlyph(node: PositionedNode, paddingY: number, strokeWidth: number): UsecaseActorGlyph {
  const cx = node.x + node.width / 2, top = node.y + paddingY, r = 7
  const head = { cx, cy: top + r, r }
  const strokeHalf = paintedStrokeExtent({ stroke: 'black', strokeWidth: String(strokeWidth) }, false)!
  const segments: [Point, Point][] = [
    [{ x: cx, y: top + 14 }, { x: cx, y: top + 36 }],
    [{ x: cx - 15, y: top + 24 }, { x: cx + 15, y: top + 24 }],
    [{ x: cx - 13, y: top + 50 }, { x: cx, y: top + 36 }],
    [{ x: cx, y: top + 36 }, { x: cx + 13, y: top + 50 }],
  ]
  const strokeRegions = segments.map(([a, b]) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.y - a.y) / length * strokeHalf, dy = (a.x - b.x) / length * strokeHalf
    return [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }, { x: b.x - dx, y: b.y - dy }, { x: a.x - dx, y: a.y - dy }]
  })
  // The only joined subpath is the two legs. Its upper miter is shorter
  // than the SVG default limit of four; straight body/arms have butt caps.
  const legLength = Math.hypot(13, 14), hip = top + 36
  strokeRegions.push([{ x: cx - 14 / legLength * strokeHalf, y: hip - 13 / legLength * strokeHalf }, { x: cx, y: hip - legLength / 13 * strokeHalf }, { x: cx + 14 / legLength * strokeHalf, y: hip - 13 / legLength * strokeHalf }])
  return {
    geometry: { kind: 'compound', children: [
      { kind: 'circle', ...head },
      { kind: 'path', d: `M${cx} ${top + 14}V${top + 36}M${cx - 15} ${top + 24}H${cx + 15}M${cx - 13} ${top + 50}L${cx} ${top + 36}L${cx + 13} ${top + 50}` },
    ] },
    boundary: { kind: 'none', reason: 'Open actor glyph uses explicit painted-stroke ports; its caption envelope is not an outline' },
    head, segments, strokeHalf, strokeRegions, ports: new Map(),
  }
}

export function actorEnvelopeSide(node: PositionedNode, point: Point): PortSide {
  const sides: [PortSide, number][] = [['N', Math.abs(point.y - node.y)], ['E', Math.abs(point.x - node.x - node.width)], ['S', Math.abs(point.y - node.y - node.height)], ['W', Math.abs(point.x - node.x)]]
  return sides.sort((a, b) => a[1] - b[1])[0]![0]
}

/** Adapt just the terminal inside its own packing envelope. Separate slots
 * retain parallel occurrences; south-facing routes escape beside the caption
 * rather than running through its text. Exterior routes and labels stay put. */
export function attachUsecaseActor(node: PositionedNode, glyph: UsecaseActorGlyph, points: Point[], start: boolean, side: PortSide, index: number, count: number): { points: Point[]; attachment: UsecaseActorAttachment } {
  const ordered = start ? points : [...points].reverse(), endpoint = ordered[0]!, top = glyph.head.cy - glyph.head.r, cx = glyph.head.cx
  let point: Point, adapter: Point[], facing: PortSide = side
  if (side === 'N') {
    const radius = glyph.head.r + glyph.strokeHalf, dx = radius * 0.8 * (2 * (index + 1) / (count + 1) - 1), escapeY = Math.min(node.y, glyph.head.cy - radius)
    point = { x: cx + dx, y: glyph.head.cy - Math.sqrt(radius ** 2 - dx ** 2) }
    adapter = [point, { x: point.x, y: escapeY }, { x: endpoint.x, y: escapeY }]
  } else {
    if (side === 'S') facing = endpoint.x < cx || endpoint.x === cx && index % 2 ? 'W' : 'E'
    const y = side === 'S' ? top + 37 + 12 * (index + 1) / (count + 1)
      : count > 1 ? top + 14 + 35 * (index + 1) / (count + 1) : Math.max(top + 1, Math.min(top + 49, endpoint.y))
    const xs: number[] = []
    const radius = glyph.head.r + glyph.strokeHalf
    if (Math.abs(y - glyph.head.cy) <= radius) {
      const dx = Math.sqrt(Math.max(0, radius ** 2 - (y - glyph.head.cy) ** 2))
      xs.push(cx - dx, cx + dx)
    }
    for (const region of glyph.strokeRegions) {
      const hit = pointOnRoutingBoundary({ kind: 'polygon', points: region }, facing === 'E' ? 'E' : 'W', y)
      if (hit) xs.push(hit.x)
    }
    point = { x: facing === 'E' ? Math.max(...xs) : Math.min(...xs), y }
    const padding = Math.max(0, (node.width - (node.labelBlock?.width ?? node.width)) / 2)
    const escapeX = facing === 'E' ? Math.max(point.x + 1, node.x + node.width - padding * (index + 1) / (count + 1)) : Math.min(point.x - 1, node.x + padding * (index + 1) / (count + 1))
    adapter = [point, { x: escapeX, y }, { x: escapeX, y: endpoint.y }, endpoint]
  }
  const portId = `actor:${side}:${facing}:${index}`
  glyph.ports.set(portId, point)
  const route = simplifyOrthogonal([...adapter, ...ordered.slice(1)])
  return { points: start ? route : route.reverse(), attachment: { ownerId: node.id, portId, point } }
}
