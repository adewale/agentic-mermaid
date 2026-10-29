import type { Point, PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import { ARROW_HEAD } from '../styles.ts'
import type { C4Body, C4Diagnostic } from './types.ts'

export interface C4LabelRect { x: number; y: number; width: number; height: number }
interface C4MarkerRect extends C4LabelRect { endpoint: string; polygon: Point[]; strokePadding: number }
/** The exact opaque halo emitted by the C4 Scene adapter. */
export function c4LabelRect(edge: PositionedEdge): C4LabelRect | undefined {
  if (!edge.label || !edge.labelPosition || !edge.labelBlock) return undefined
  const width = edge.labelBlock.width + 20, height = edge.labelBlock.height + 16
  return { x: edge.labelPosition.x - width / 2, y: edge.labelPosition.y - height / 2, width, height }
}
const overlap = (a: C4LabelRect, b: C4LabelRect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const inflate = (box: C4LabelRect, padding: number): C4LabelRect => ({ x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 })
const frames = (groups: PositionedGroup[]): PositionedGroup[] => groups.flatMap(group => [group, ...frames(group.children)])
function segmentHits(a: Point, b: Point, box: C4LabelRect): boolean {
  // Clip the segment to the open rectangle. This also handles a diagonal
  // segment supplied by a shared route repair, without a pixel sampling grid.
  let lo = 0, hi = 1
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis], min = box[axis] + .01, max = box[axis] + (axis === 'x' ? box.width : box.height) - .01
    if (Math.abs(delta) < .001) { if (a[axis] <= min || a[axis] >= max) return false; continue }
    const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta
    lo = Math.max(lo, Math.min(first, last)); hi = Math.min(hi, Math.max(first, last))
    if (lo >= hi) return false
  }
  return lo < hi
}
export function c4MarkerRects(edge: PositionedEdge, lineWidth: number): C4MarkerRect[] {
  const result: C4MarkerRect[] = []
  const scale = edge.inlineStyle?.['stroke-width'] ? 1 : lineWidth * (edge.style === 'thick' ? 2 : 1)
  // Shared arrow resources use strokeWidth units unless an inline width
  // selects their fixed 8x8 variant. Their round 0.75px outline scales too.
  const length = ARROW_HEAD.width * scale, half = (edge.inlineStyle?.['stroke-width'] ? ARROW_HEAD.width : ARROW_HEAD.height) * scale / 2, strokePadding = .375 * scale
  for (const start of [true, false]) {
    if (!(start ? edge.hasArrowStart : edge.hasArrowEnd)) continue
    const tip = edge.points.at(start ? 0 : -1)
    const before = (start ? edge.points.slice(1) : edge.points.slice(0, -1).reverse()).find(point => tip && Math.hypot(point.x - tip.x, point.y - tip.y) > .01)
    if (!tip || !before) continue
    const magnitude = Math.hypot(tip.x - before.x, tip.y - before.y), ux = (tip.x - before.x) / magnitude, uy = (tip.y - before.y) / magnitude
    const points = [tip, { x: tip.x - ux * length - uy * half, y: tip.y - uy * length + ux * half }, { x: tip.x - ux * length + uy * half, y: tip.y - uy * length - ux * half }]
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
    result.push({ ...inflate({ x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }, strokePadding), endpoint: start ? edge.source : edge.target, polygon: points, strokePadding })
  }
  return result
}
function markerOverlap(a: C4MarkerRect, b: C4MarkerRect): boolean {
  if (overlap(a, b) <= .01) return false
  // Convex arrowheads can have intersecting bounding boxes while their ink
  // remains separate. Check their actual triangle projections, including the
  // shared round outline, before reporting one marker hiding another.
  for (const polygon of [a.polygon, b.polygon]) for (const [index, point] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]!, nx = -(next.y - point.y), ny = next.x - point.x, magnitude = Math.hypot(nx, ny)
    if (magnitude < .001) continue
    const project = (marker: C4MarkerRect) => marker.polygon.map(vertex => (vertex.x * nx + vertex.y * ny) / magnitude)
    const left = project(a), right = project(b)
    if (Math.max(...left) + a.strokePadding <= Math.min(...right) - b.strokePadding + .01 || Math.max(...right) + b.strokePadding <= Math.min(...left) - a.strokePadding + .01) return false
  }
  return true
}
function blockers(nodes: PositionedNode[], groups: PositionedGroup[]): C4LabelRect[] {
  return [...nodes, ...frames(groups).flatMap(group => [
    { x: group.x, y: group.y, width: group.width, height: group.headerHeight ?? 0 },
    { x: group.x, y: group.y, width: 1, height: group.height },
    { x: group.x + group.width - 1, y: group.y, width: 1, height: group.height },
    { x: group.x, y: group.y + group.height - 1, width: group.width, height: 1 },
  ])]
}

/** Final C4-specific allocation uses the painted halo, not the generic graph
 * label pill. It moves labels only: ports, authored endpoints and route
 * certificates remain owned by the existing route adapter. Candidate count is
 * bounded by route segments; no viewport-dependent search or wall-clock exit.
 * Authored offsets displace each candidate before collision scoring, rather
 * than invalidating a clear slot after allocation. */
export function placeC4PixelLabels(positioned: { nodes: PositionedNode[]; groups: PositionedGroup[]; edges: PositionedEdge[] }, lineWidth: number, body: C4Body): void {
  const { edges } = positioned, obstacles = blockers(positioned.nodes, positioned.groups), heads = edges.flatMap(edge => c4MarkerRects(edge, lineWidth)), accepted: C4LabelRect[] = []
  const authoredStyles = new Map(body.relationships.map(relationship => [relationship.id, relationship.style]))
  const routes = edges.flatMap(edge => edge.points.slice(1).map((end, index) => ({ edge, start: edge.points[index]!, end })))
  const ordered = edges.map((edge, index) => ({ edge, index, rect: c4LabelRect(edge) })).filter(item => item.rect).sort((a, b) => b.rect!.width * b.rect!.height - a.rect!.width * a.rect!.height || a.index - b.index)
  for (const { edge, rect } of ordered) {
    const authored = authoredStyles.get(edge.id!)
    const finiteOffset = (value: string | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0
    const dx = finiteOffset(authored?.offsetX), dy = finiteOffset(authored?.offsetY)
    const shifted = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy })
    const original = shifted(edge.labelPosition!), candidates: Point[] = [original], width = rect!.width, height = rect!.height
    const penalty = (candidate: Point): number[] => {
      const box = { x: candidate.x - width / 2, y: candidate.y - height / 2, width, height }, clearance = inflate(box, 3)
      return [
        heads.reduce((sum, head) => sum + overlap(clearance, head), 0),
        obstacles.reduce((sum, obstacle) => sum + overlap(clearance, obstacle), 0),
        accepted.reduce((sum, other) => sum + overlap(inflate(box, 4), other), 0),
        routes.reduce((sum, route) => sum + (route.edge !== edge && segmentHits(route.start, route.end, inflate(box, 2)) ? 1 : 0), 0),
      ]
    }
    let best = original, bestPenalty = penalty(original)
    // A clear unchanged position is already the nearest possible candidate.
    if (bestPenalty.every(value => value === 0)) { edge.labelPosition = original; accepted.push(c4LabelRect(edge)!); continue }
    const segments = routes.filter(route => route.edge === edge).sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y))
    for (const { start, end } of segments) {
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length < .01) continue
      const nx = -(end.y - start.y) / length, ny = (end.x - start.x) / length
      const normalSize = Math.abs(nx) * width / 2 + Math.abs(ny) * height / 2
      for (const fraction of [.5, .25, .75, .1, .9]) for (const offset of [0, normalSize + 6, -normalSize - 6, normalSize + 20, -normalSize - 20]) {
        candidates.push(shifted({ x: start.x + (end.x - start.x) * fraction + nx * offset, y: start.y + (end.y - start.y) * fraction + ny * offset }))
      }
    }
    // If no completely clear slot exists, preserve arrow visibility before
    // preferring a smaller text collision; the final checker reports any loss.
    candidates.sort((a, b) => Math.hypot(a.x - original.x, a.y - original.y) - Math.hypot(b.x - original.x, b.y - original.y))
    for (const candidate of candidates) {
      const score = penalty(candidate), different = score.findIndex((value, index) => value !== bestPenalty[index])
      if (different >= 0 && score[different]! < bestPenalty[different]!) { best = candidate; bestPenalty = score }
      if (score.every(value => value === 0)) break
    }
    edge.labelPosition = best
    accepted.push(c4LabelRect(edge)!)
  }
}

/** Diagnose final geometry after authored label offsets. These are limitations
 * of this rendered artifact, never syntax errors or a claim that text was lost
 * from the authored model. */
export function c4PixelVisibilityDiagnostics(body: C4Body, positioned: { nodes: PositionedNode[]; groups: PositionedGroup[]; edges: PositionedEdge[] }, lineWidth: number, canvas?: { width: number; height: number }): C4Diagnostic[] {
  const diagnostics: C4Diagnostic[] = [], { edges, nodes, groups } = positioned, obstacles = blockers(nodes, groups), labels = edges.map(edge => ({ edge, box: c4LabelRect(edge) })).filter(item => item.box)
  const statementId = (edge: PositionedEdge) => body.relationships.find(item => item.id === edge.id)?.statementId
  for (const { edge, box } of labels) {
    if (obstacles.some(obstacle => overlap(box!, obstacle) > .01) || labels.some(other => other.edge !== edge && overlap(box!, other.box!) > .01) || edges.some(other => other !== edge && other.points.slice(1).some((point, index) => segmentHits(other.points[index]!, point, box!)))) diagnostics.push({ code: 'C4_LABEL_COLLISION', severity: 'warning', statementId: statementId(edge), message: `Relationship ${edge.id} has a label halo overlapping another label, card, boundary header/frame or relationship route; all authored text is retained.` })
  }
  const headers = frames(groups).map(group => ({ ...group, height: group.headerHeight ?? 0 }))
  const allHeads = edges.flatMap(edge => c4MarkerRects(edge, lineWidth).map(head => ({ edge, head })))
  for (const edge of edges) {
    const heads = allHeads.filter(item => item.edge === edge).map(item => item.head)
    if ((edge.hasArrowEnd || edge.hasArrowStart) && !heads.length || heads.some(head => labels.some(label => overlap(head, label.box!) > .01) || [...nodes, ...headers].some(node => node.id !== head.endpoint && overlap(head, node) > .01) || allHeads.some(other => other.head !== head && markerOverlap(head, other.head)) || canvas && (head.x < -.01 || head.y < -.01 || head.x + head.width > canvas.width + .01 || head.y + head.height > canvas.height + .01))) diagnostics.push({ code: 'C4_ARROW_OCCLUDED', severity: 'warning', statementId: statementId(edge), message: `Relationship ${edge.id} has an arrowhead overlapping a label, card, boundary header or another arrowhead, exceeds the final canvas, or lacks a nonzero terminal segment.` })
  }
  return diagnostics
}
