// Read final public SVG independently of Architecture's ports and certificates.
// This is an audit adapter for Architecture's rect/ring surfaces, not a shape
// policy for other families. The generic crossing/overlap detectors stay shared.
import type { RenderedLayout } from '../../src/agent/types.ts'
import type { PaintLayoutCertification } from '../../src/scene/paint-certification.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../../src/svg-structure.ts'
import { countPolylineCrossings } from '../../src/shared/edge-crossings.ts'
import { detect } from '../ugly-detector/detect.ts'
import { audit, extract } from '../overlap-audit/audit.ts'

type Point = { x: number; y: number }
type Tag = { name: string; start: number; attrs: Record<string, string> }
type Rect = { x: number; y: number; w: number; h: number }

function numbers(value: string): number[] {
  const tokens = value.trim().split(/[\s,]+/)
  if (!tokens.every(token => /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?$/i.test(token) && Number.isFinite(Number(token)))) {
    throw new Error('Invalid SVG numeric list')
  }
  return tokens.map(Number)
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-5
const length = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)
function points(tag: Tag): Point[] {
  // Audit the actual native polyline, not an inferred control polygon for a
  // curved path. Refuse missing coverage instead of reporting invented zeros.
  if (tag.name !== 'polyline') throw new Error(`Unsupported Architecture carrier: ${tag.name}`)
  const coords = numbers(tag.attrs.points!)
  if (coords.length % 2) throw new Error('Incomplete carrier coordinate pair')
  const result = Array.from({ length: coords.length / 2 }, (_, i) => ({ x: coords[2 * i]!, y: coords[2 * i + 1]! }))
  if (result.length < 2 || !result.every(p => Number.isFinite(p.x + p.y))) throw new Error('Invalid carrier')
  return result.filter((p, i) => !i || length(p, result[i - 1]!) > 1e-5)
}
function bends(route: Point[]): number {
  let count = 0
  for (let i = 1; i + 1 < route.length; i++) {
    const [a, b, c] = [route[i - 1]!, route[i]!, route[i + 1]!]
    if (!near((b.x - a.x) * (c.y - b.y), (b.y - a.y) * (c.x - b.x))) count++
  }
  return count
}
function surfaceError(point: Point, surface: Tag, side: string): number {
  const a = surface.attrs
  if (surface.name === 'circle') return Math.abs(length(point, { x: Number(a.cx), y: Number(a.cy) }) - Number(a.r))
  const x = Number(a.x), y = Number(a.y), right = x + Number(a.width), bottom = y + Number(a.height)
  if (side === 'L' || side === 'R') return Math.hypot(point.x - (side === 'L' ? x : right), Math.max(y - point.y, point.y - bottom, 0))
  return Math.hypot(point.y - (side === 'T' ? y : bottom), Math.max(x - point.x, point.x - right, 0))
}
function rect(tag: Tag): Rect {
  return { x: Number(tag.attrs.x), y: Number(tag.attrs.y), w: Number(tag.attrs.width), h: Number(tag.attrs.height) }
}
function intersects(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5
}
function crosses(a: Point, b: Point, box: Rect): boolean {
  if (near(a.y, b.y)) return a.y > box.y + 0.5 && a.y < box.y + box.h - 0.5 && Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.w - 0.5
  if (near(a.x, b.x)) return a.x > box.x + 0.5 && a.x < box.x + box.w - 0.5 && Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.h - 0.5
  throw new Error('Architecture audit expected orthogonal segments')
}
function markerPlacement(tags: Tag[], carrier: Tag, route: Point[], end: 'start' | 'end') {
  const markerId = carrier.attrs[`marker-${end}`]!.match(/^url\(#(.+)\)$/)![1]!
  const marker = tags.find(tag => tag.name === 'marker' && tag.attrs.id === markerId)
  if (!marker) throw new Error(`Missing marker ${markerId}`)
  const shape = tags.find(tag => tag.start > marker.start && tag.name === 'polygon')
  if (!shape) throw new Error(`Missing arrow polygon ${markerId}`)
  const coords = numbers(shape.attrs.points!)
  if (coords.length < 6 || coords.length % 2) throw new Error('Invalid arrow polygon')
  const contact = { x: coords[2]!, y: coords[3]! }
  const start = end === 'start', anchor = start ? route[0]! : route.at(-1)!
  const neighbour = start ? route[1]! : route.at(-2)!
  const dx = start ? neighbour.x - anchor.x : anchor.x - neighbour.x
  const dy = start ? neighbour.y - anchor.y : anchor.y - neighbour.y
  const m = marker.attrs
  let angle = m.orient === 'auto' || m.orient === 'auto-start-reverse' ? Math.atan2(dy, dx) : Number(m.orient ?? 0) * Math.PI / 180
  if (start && m.orient === 'auto-start-reverse') angle += Math.PI
  const view = m.viewBox ? numbers(m.viewBox) : undefined
  const viewport = view ? Math.min(Number(m.markerWidth) / view[2]!, Number(m.markerHeight) / view[3]!) : 1
  const scale = viewport * (m.markerUnits === 'userSpaceOnUse' ? 1 : Number(carrier.attrs['stroke-width'] ?? 1))
  const project = (point: Point): Point => {
    const x = (point.x - Number(m.refX)) * scale, y = (point.y - Number(m.refY)) * scale
    return { x: anchor.x + x * Math.cos(angle) - y * Math.sin(angle), y: anchor.y + x * Math.sin(angle) + y * Math.cos(angle) }
  }
  if (m.preserveAspectRatio && m.preserveAspectRatio !== 'xMidYMid meet') throw new Error('Unsupported marker viewport alignment')
  const width = Number(m.markerWidth) / viewport, height = Number(m.markerHeight) / viewport
  const x = view ? view[0]! - (width - view[2]!) / 2 : 0, y = view ? view[1]! - (height - view[3]!) / 2 : 0
  const clipped = m.overflow === undefined || m.overflow === 'hidden'
  const retainedContact = !clipped || (contact.x >= x - 1e-6 && contact.x <= x + width + 1e-6
    && contact.y >= y - 1e-6 && contact.y <= y + height + 1e-6)
  // SVG marker viewports default to overflow:hidden. Paint, including the
  // arrow's stroke, is clipped to this box. A separating tangent proves that
  // the entire visible marker stays outside its attached filled rect or disk.
  const clip = clipped
    ? [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map(project) : undefined
  return { contact: project(contact), retainedContact, clip }
}
function outsideSurface(points: Point[] | undefined, surface: Tag, side: string): boolean {
  if (!points) return false
  const a = surface.attrs, circle = surface.name === 'circle'
  const left = circle ? Number(a.cx) - Number(a.r) : Number(a.x)
  const right = circle ? Number(a.cx) + Number(a.r) : Number(a.x) + Number(a.width)
  const top = circle ? Number(a.cy) - Number(a.r) : Number(a.y)
  const bottom = circle ? Number(a.cy) + Number(a.r) : Number(a.y) + Number(a.height)
  return points.every(p => side === 'L' ? p.x <= left + 0.001 : side === 'R' ? p.x >= right - 0.001 : side === 'T' ? p.y <= top + 0.001 : p.y >= bottom - 0.001)
}

export function architectureSvgMetrics(svg: string, layout: RenderedLayout, paint: PaintLayoutCertification) {
  const tags: Tag[] = scanSvgStartTags(svg).map(tag => ({ name: tag.name, start: tag.start,
    attrs: Object.fromEntries(tag.attributes.map(a => [a.name, decodedSvgAttributeValue(tag, a.name)!])),
  }))
  const carriers = tags.filter(tag => tag.attrs.class === 'architecture-edge')
  if (carriers.length !== layout.edges.length) throw new Error('SVG/public route coverage mismatch')
  const routes = carriers.map(points)
  const surfaces = tags.filter(tag => /^(?:service-card:|junction-ring:|group-frame:)/.test(tag.attrs['data-id'] ?? ''))
  const byId = new Map(surfaces.map(tag => [tag.attrs['data-id'], tag]))
  const findings: string[] = []
  let offOutlineEndpoints = 0, offOutlineMarkers = 0, unverifiedMarkerBodies = 0, maxShaftErrorPx = 0, maxMarkerErrorPx = 0, certificateFindings = 0
  for (const [index, carrier] of carriers.entries()) {
    const route = routes[index]!, edge = layout.edges[index]!
    if (carrier.attrs['data-from'] !== edge.from || carrier.attrs['data-to'] !== edge.to) throw new Error('SVG/public endpoint identity mismatch')
    const certificate = edge.route
    if (!certificate || !('family' in certificate) || certificate.family !== 'architecture') throw new Error('Missing Architecture certificate coverage')
    if (certificate.invariant !== 'side-anchored') { certificateFindings++; findings.push(`${index}: unverified route`) }
    if (certificate.bendCount !== bends(route)) { certificateFindings++; findings.push(`${index}: certificate bend count mismatch`) }
    for (const end of ['start', 'end'] as const) {
      const id = carrier.attrs[end === 'start' ? 'data-from' : 'data-to']!
      const groupBoundary = carrier.attrs[end === 'start' ? 'data-from-boundary' : 'data-to-boundary'] === 'group'
      const group = groupBoundary ? layout.groups.find(group => group.members.includes(id)) : undefined
      const surface = groupBoundary ? byId.get(`group-frame:${group?.id}`) : byId.get(`service-card:${id}`) ?? byId.get(`junction-ring:${id}`)
      if (!surface) throw new Error(`Missing declared ${end} surface: ${id}`)
      const side = carrier.attrs[end === 'start' ? 'data-from-side' : 'data-to-side']!
      const error = surfaceError(end === 'start' ? route[0]! : route.at(-1)!, surface, side)
      maxShaftErrorPx = Math.max(maxShaftErrorPx, error)
      if (error > 0.01) { offOutlineEndpoints++; findings.push(`${index}/${end}: shaft ${error.toFixed(3)}px off ${id}`) }
      const anchored = end === 'start' ? certificate.sourceAnchored : certificate.targetAnchored
      if (anchored !== (error <= 1)) { certificateFindings++; findings.push(`${index}/${end}: certificate disagrees with drawn surface`) }
      if (carrier.attrs[`marker-${end}`]) {
        const placement = markerPlacement(tags, carrier, route, end)
        const markerError = surfaceError(placement.contact, surface, side)
        if (!outsideSurface(placement.clip, surface, side)) { unverifiedMarkerBodies++; findings.push(`${index}/${end}: marker viewport has no separating tangent from ${id}`) }
        maxMarkerErrorPx = Math.max(maxMarkerErrorPx, markerError)
        if (!placement.retainedContact || markerError > 0.01) {
          offOutlineMarkers++
          findings.push(`${index}/${end}: ${placement.retainedContact ? `marker ${markerError.toFixed(3)}px off ${id}` : 'marker contact clipped by its viewport'}`)
        }
      }
    }
  }
  // Existing rendered short-jog detector, including its rotated equivalent.
  // Both passes have no nodes, so graph-specific outline policy cannot leak in.
  const hitchRoutes = routes.map((pts, i) => ({ from: String(i), to: '', pts }))
  const hitches = [hitchRoutes, hitchRoutes.map(e => ({ ...e, pts: e.pts.map(p => ({ x: p.y, y: p.x })) }))]
    .flatMap(edges => detect({ nodes: [], edges })).filter(f => f.kind === 'hitch')
  const overlaps = audit(svg).filter(f => f.kind === 'TEXT-TEXT' || f.kind === 'TEXT-STRADDLE')
  // Architecture has filled edge-label pills. Measure their real SVG boxes
  // against other pills, service cards and non-own routes, including whitespace
  // that a text-only overlap estimator would miss.
  const pills = tags.filter(tag => tag.attrs.class === 'architecture-edge-label-bg')
  const textBoxes = extract(svg).texts.map(t => ({ x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0 }))
  let clearLaneHitches = 0
  for (const [i, route] of routes.entries()) {
    if (!bends(route)) continue
    const a = route[0]!, b = route.at(-1)!, carrier = carriers[i]!
    const requiredSides = near(a.y, b.y) ? (b.x > a.x ? ['R', 'L'] : ['L', 'R'])
      : near(a.x, b.x) ? (b.y > a.y ? ['B', 'T'] : ['T', 'B']) : undefined
    if (!requiredSides || length(a, b) < 1 || carrier.attrs['data-from-side'] !== requiredSides[0] || carrier.attrs['data-to-side'] !== requiredSides[1]) continue
    const obstacle = surfaces.some(surface => {
      const id = surface.attrs['data-id']!
      if ([`service-card:${carrier.attrs['data-from']}`, `junction-ring:${carrier.attrs['data-from']}`, `service-card:${carrier.attrs['data-to']}`, `junction-ring:${carrier.attrs['data-to']}`].includes(id)) return false
      if (surface.name === 'circle') {
        const centre = { x: Number(surface.attrs.cx), y: Number(surface.attrs.cy) }
        const t = Math.max(0, Math.min(1, ((centre.x - a.x) * (b.x - a.x) + (centre.y - a.y) * (b.y - a.y)) / length(a, b) ** 2))
        return length(centre, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }) < Number(surface.attrs.r) - 0.5
      }
      const box = rect(surface)
      const contains = (p: Point) => p.x >= box.x - 0.5 && p.x <= box.x + box.w + 0.5 && p.y >= box.y - 0.5 && p.y <= box.y + box.h + 0.5
      if (id.startsWith('group-frame:') && (contains(a) || contains(b))) return false
      return crosses(a, b, box)
    })
    // Other labels are obstacles. An own label that cannot fit on the direct
    // span can justify a detour; never count that as a straightenable hitch.
    const ownPill = pills.find(pill => carriers.findLastIndex(c => c.start < pill.start) === i)
    if (ownPill && (near(a.y, b.y) ? rect(ownPill).w : rect(ownPill).h) + 14 >= length(a, b)) continue
    if (!obstacle && !textBoxes.some(box => crosses(a, b, box)) && !pills.some(pill => pill !== ownPill && crosses(a, b, rect(pill)))) clearLaneHitches++
  }
  let labelPillConflicts = 0
  for (const [i, pill] of pills.entries()) {
    const box = rect(pill)
    labelPillConflicts += pills.slice(i + 1).filter(other => intersects(box, rect(other))).length
    labelPillConflicts += surfaces.filter(tag => {
      if (tag.attrs['data-id']!.startsWith('service-card:')) return intersects(box, rect(tag))
      if (tag.name !== 'circle') return false
      const cx = Number(tag.attrs.cx), cy = Number(tag.attrs.cy)
      const closest = { x: Math.max(box.x, Math.min(box.x + box.w, cx)), y: Math.max(box.y, Math.min(box.y + box.h, cy)) }
      return length(closest, { x: cx, y: cy }) < Number(tag.attrs.r) - 0.5
    }).length
    const own = carriers.findLastIndex(carrier => carrier.start < pill.start)
    for (const [j, route] of routes.entries()) if (j !== own && route.slice(1).some((p, k) => crosses(route[k]!, p, box))) labelPillConflicts++
  }
  if (!paint) throw new Error('Missing native paint certificate coverage')
  return {
    markerEndpoints: carriers.map(carrier => ({
      start: carrier.attrs['marker-start'] ?? null,
      end: carrier.attrs['marker-end'] ?? null,
      mid: carrier.attrs['marker-mid'] ?? null,
    })),
    metrics: {
      routes: routes.length, endpointChecks: 2 * routes.length,
      markerChecks: carriers.reduce((n, c) => n + Number(!!c.attrs['marker-start']) + Number(!!c.attrs['marker-end']), 0),
      crossings: countPolylineCrossings(routes.map(points => ({ points }))),
      bends: routes.reduce((n, route) => n + bends(route), 0),
      maxBendsPerEdge: Math.max(0, ...routes.map(bends)),
      hitches: hitches.length, clearLaneHitches, offOutlineEndpoints, offOutlineMarkers, unverifiedMarkerBodies,
      labelOverlaps: overlaps.length, labelPillConflicts,
      routeCertificateFindings: certificateFindings, paintCertificateFindings: paint.issues.length,
      placementConflicts: layout.edges.filter(edge => edge.route && 'family' in edge.route && edge.route.family === 'architecture' && edge.route.placement === 'conflicted').length,
      unverifiedPaint: Number(paint.status !== 'passed'), unmeasuredPaint: paint.coverage.unmeasured,
      maxShaftErrorPx, maxMarkerErrorPx,
    },
    findings: [...findings, ...hitches.map(f => f.detail), ...overlaps.map(f => `${f.kind}: ${f.a} / ${f.b}`), ...paint.issues.map(f => `${f.code}: ${f.id ?? ''}`)],
    paintFindings: paint.issues,
    paintStatus: paint.status,
  }
}
