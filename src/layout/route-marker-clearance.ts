import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import type { Point, PositionedEdge, RouteBlocker } from '../types.ts'
import type { LabelMetricsStyle } from './route-geometry.ts'

type MarkerRegion = ReturnType<typeof graphEdgeMarkerPaintRegions>[number]

function markerView(edge: PositionedEdge, style: LabelMetricsStyle): { regions: MarkerRegion[]; points: Point[]; directional: boolean } {
  const points = edge.points.map(point => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) }))
  const multiple = edge.style === 'thick' ? 2 : 1
  const lineWidth = Number(formatSvgNumber((style.lineWidth ?? 1) * multiple)) / multiple
  const writtenStyle = { ...style, lineWidth }
  const directional = !edge.curve && !(style.edgeBendRadius && style.edgeBendRadius > 0)
  if (directional) return { regions: graphEdgeMarkerPaintRegions({ ...edge, points }, writtenStyle), points, directional }
  // A rounded/cubic control can round independently of its endpoint. Keep an
  // orientation-independent complete envelope rather than infer its served
  // tangent from the raw polyline. This is only a rejection guard.
  const regions = graphEdgeMarkerPaintRegions(edge, writtenStyle).map(region => {
    const anchor = region.position === 'start' ? points[0]! : points.at(-1)!
    const box = region.bounds
    if (!box) return { ...region, anchor }
    const radius = Math.max(...[box.x0, box.x1].flatMap(x => [box.y0, box.y1].map(y => Math.hypot(x - region.anchor.x, y - region.anchor.y))))
    return { ...region, anchor, bounds: { x0: anchor.x - radius, y0: anchor.y - radius, x1: anchor.x + radius, y1: anchor.y + radius } }
  })
  return { regions, points, directional }
}

/** Complete written marker supports for optional placement admission. Share
 * the same width/endpoint projection and curved orientation envelope used by
 * route preference guards, rather than preparing a second marker view. */
export function routeMarkerPaintRegions(edge: PositionedEdge, style: LabelMetricsStyle): MarkerRegion[] | undefined {
  if (edge.style === 'invisible' || !edge.hasArrowStart && !edge.hasArrowEnd) return []
  if (!mappingKnown(edge, style)) return undefined
  const { regions } = markerView(edge, style)
  return regions.length === Number(Boolean(edge.hasArrowStart)) + Number(Boolean(edge.hasArrowEnd)) && regions.every(measured) ? regions : undefined
}

function mappingKnown(edge: PositionedEdge, style: LabelMetricsStyle): boolean {
  if (!edge.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false
  if (style.edgeBendRadius !== undefined && !(Number.isFinite(style.edgeBendRadius) && style.edgeBendRadius >= 0)) return false
  // Authored widths select fixed user-space marker resources. Otherwise SVG
  // markerUnits scales both geometry and stroke by the actual carrier width.
  const width = (style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)
  return !!edge.inlineStyle?.['stroke-width'] || Number.isFinite(width) && width > 0
}

function measured(marker: MarkerRegion): boolean {
  const box = marker.bounds
  return !!box && [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
}

function sameEndpointRay(before: readonly Point[], after: readonly Point[], position: MarkerRegion['position']): boolean {
  if (position === 'mid') return false
  const anchor = (points: readonly Point[]) => position === 'start' ? points[0] : points.at(-1)
  const a = anchor(before), b = anchor(after)
  if (!a || !b || a.x !== b.x || a.y !== b.y) return false
  const neighbor = (points: readonly Point[]): Point | undefined => {
    for (let i = 1; i < points.length; i++) {
      const p = points[position === 'start' ? i : points.length - i - 1]!
      if (p.x !== a.x || p.y !== a.y) return p
    }
    return undefined
  }
  const p = neighbor(before), q = neighbor(after)
  if (!p || !q) return false
  if (p.x === q.x && p.y === q.y) return true
  if (a.x !== p.x && a.y !== p.y || a.x !== q.x && a.y !== q.y) return false
  return Math.sign(p.x - a.x) === Math.sign(q.x - a.x) && Math.sign(p.y - a.y) === Math.sign(q.y - a.y)
}

/** A rounded orthogonal route paints its endpoint marker along its final
 * straight segment; the corners before it never reach the marker's tangent. */
function sameTerminalSegment(before: readonly Point[], after: readonly Point[], position: MarkerRegion['position']): boolean {
  if (position === 'mid' || before.length < 2 || after.length < 2) return false
  const pick = (points: readonly Point[]): readonly [Point, Point] => position === 'start' ? [points[0]!, points[1]!] : [points.at(-1)!, points.at(-2)!]
  const [a, b] = pick(before), [c, d] = pick(after)
  return a.x === c.x && a.y === c.y && b.x === d.x && b.y === d.y
}

function separated(a: MarkerRegion, b: MarkerRegion): boolean {
  const x = a.bounds, y = b.bounds
  if (!x || !y || !measured(a) || !measured(b)) return false
  const values = [x.x0, x.y0, x.x1, x.y1, y.x0, y.y0, y.x1, y.y1]
  if (!values.every(Number.isFinite)) return false
  // Reject close arithmetic/serialization uncertainty; never enlarge a clear
  // gap. These are conservative complete stroke/cap/viewport envelopes.
  const error = values.reduce((sum, value) => sum + Math.abs(value), 0) * 1e-10 + 1e-9
  return Number.isFinite(error) && (x.x1 + error < y.x0 || y.x1 + error < x.x0 || x.y1 + error < y.y0 || y.y1 + error < x.y0)
}

/** One shared terminal paints a single final shaft and glyph for every edge
 * merged into it. That ink stands for each member only when the members paint
 * identically and at most one of them is named: a different dash, width or
 * colour would be painted over, and two labels cannot both own one arrowhead. */
export function edgesMayShareTerminal(a: PositionedEdge, b: PositionedEdge): boolean {
  if (a.label && b.label) return false
  if (a.style !== b.style || a.curve !== b.curve || a.animate !== b.animate || a.animation !== b.animation) return false
  const styleA = a.inlineStyle ?? {}, styleB = b.inlineStyle ?? {}
  for (const key in styleA) if (!(key in styleB) || styleB[key] !== styleA[key]) return false
  for (const key in styleB) if (!(key in styleA)) return false
  const classesA = a.classNames ?? [], classesB = b.classNames ?? []
  if (classesA.length !== classesB.length) return false
  for (let index = 0; index < classesA.length; index++) if (classesA[index] !== classesB[index]) return false
  return true
}

/** Optional endpoint-centering candidates may not discard reserved marker
 * seats. Read every peer from live routes; retain no pose or acceptance cache.
 * Unchanged endpoint occurrences keep their existing proof/status, while a
 * changed one must separate from ALL peers and its staged opposite marker. */
export function routeCandidateMarkerBlocker(edge: PositionedEdge, points: Point[], peers: readonly PositionedEdge[], style: LabelMetricsStyle, peerOwner: PositionedEdge = edge): RouteBlocker | undefined {
  if (!edge.hasArrowStart && !edge.hasArrowEnd || edge.style === 'invisible') return undefined
  const blocker = (owner: PositionedEdge, position: string, relation: string): RouteBlocker => ({ kind: 'port', id: `${relation}:${owner.id ?? `${owner.source}->${owner.target}[${owner.edgeIndex ?? peers.indexOf(owner)}]`}:${position}` })
  if (!mappingKnown({ ...edge, points }, style)) return blocker(peerOwner, 'mapping', 'marker')
  const oldView = markerView(edge, style), newView = markerView({ ...edge, points }, style)
  const before = oldView.regions, after = newView.regions
  if (after.length !== Number(Boolean(edge.hasArrowStart)) + Number(Boolean(edge.hasArrowEnd))) return blocker(peerOwner, 'unmeasured', 'marker')
  for (const marker of after) {
    const old = before.find(candidate => candidate.position === marker.position)
    if (old && old.resource === marker.resource && old.repaint === marker.repaint
      && old.anchor.x === marker.anchor.x && old.anchor.y === marker.anchor.y
      && (oldView.directional && newView.directional ? sameEndpointRay(oldView.points, newView.points, marker.position)
        : edge.curve ? edge.points.length === points.length && edge.points.every((point, index) => point.x === points[index]!.x && point.y === points[index]!.y)
          : sameTerminalSegment(edge.points, points, marker.position))) continue
    if (!measured(marker)) return blocker(peerOwner, marker.position, 'marker')
    for (const opposite of after) if (opposite !== marker && !separated(marker, opposite)) return blocker(peerOwner, opposite.position, 'opposite-marker')
    for (const peer of peers) {
      if (peer === peerOwner || peer.style === 'invisible' || !peer.hasArrowStart && !peer.hasArrowEnd) continue
      if (!mappingKnown(peer, style)) return blocker(peer, 'mapping', 'peer-marker')
      const peerView = markerView(peer, style)
      for (const occurrence of peerView.regions) {
        const ownNode = marker.position === 'start' ? edge.source : edge.target
        const peerNode = occurrence.position === 'start' ? peer.source : peer.target
        // Existing Flowchart convergence may repaint one IDENTICAL glyph at
        // one physical port. Neither target identity nor color alone proves
        // this, and staged opposite occurrences above never get this rule.
        if (newView.directional && peerView.directional && measured(occurrence) && marker.position === occurrence.position
          && ownNode === peerNode && marker.resource === occurrence.resource && marker.repaint === occurrence.repaint
          && marker.anchor.x === occurrence.anchor.x && marker.anchor.y === occurrence.anchor.y
          && sameEndpointRay(newView.points, peerView.points, marker.position) && edgesMayShareTerminal(edge, peer)) continue
        if (!separated(marker, occurrence)) return blocker(peer, occurrence.position, 'peer-marker')
      }
    }
  }
  return undefined
}

export function routeCandidateMarkersClear(edge: PositionedEdge, points: Point[], peers: readonly PositionedEdge[], style: LabelMetricsStyle, peerOwner: PositionedEdge = edge): boolean {
  return routeCandidateMarkerBlocker(edge, points, peers, style, peerOwner) === undefined
}
