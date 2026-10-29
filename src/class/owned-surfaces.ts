import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
import { extendTerminalRuns } from '../layout/terminal-clearance.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { simplifyOrthogonal } from '../layout/compound-visibility.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { connector } from '../scene/marks.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { DIAGRAM_TITLE_GAP, diagramTitleBand, type ResolvedRenderStyle } from '../styles.ts'
import type { Point } from '../types.ts'
import { type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork, createClassMarkerAdmissionWork } from './marker-admission.ts'
import { type ClassHeaderPeerContext, type ClassHeaderNumericCapture, captureClassHeaderNumericContext, classHeaderDetourCandidates } from './header-lanes.ts'
import { type ClassMarkerPiece, classCaptionAnchor, classCardinalityAnchor, classMarkerPieces, classMarkerResources, getMarkerDefId, RELATION_LABEL_HALO_WIDTH, RELATION_LABEL_OFFSET_Y } from './relationship-paint.ts'
import type { PositionedClassDiagram, PositionedClassNote } from './types.ts'
export interface ClassSurfaceBox {
  x: number
  y: number
  width: number
  height: number
}
const emitted = (v: number): number => {
  if (!Number.isFinite(v)) throw new LayoutCertificationError([{ strategy: 'class-owned-surfaces', violations: ['Nonfinite retained Class geometry'] }])
  return Number(formatSvgNumber(v))
}
const emittedPoint = (p: Point): Point => ({ x: emitted(p.x), y: emitted(p.y) })
interface WrittenDecimalParts { n: bigint; e: number }
function writtenDecimalParts(value: number, parts?: Map<number, WrittenDecimalParts>): WrittenDecimalParts {
  const prior = parts?.get(value)
  if (prior) return prior
  const text = formatSvgNumber(value),
    m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
  const parsed = { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
  parts?.set(value, parsed)
  return parsed
}
// Compare written decimal coordinates to a written rectangle face without
// treating binary addition's one-ULP tail as physical interior or clearance.
function compareSvgSum(value: number, a: number, b: number, parts?: Map<number, WrittenDecimalParts>): number {
  const sum = a + b,
    difference = value - sum
  if (Math.abs(difference) > 8 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(a), Math.abs(b))) return Math.sign(difference)
  const valueParts = writtenDecimalParts(value, parts),
    aParts = writtenDecimalParts(a, parts),
    bParts = writtenDecimalParts(b, parts),
    scale = Math.min(valueParts.e, aParts.e, bParts.e),
    scaledValue = valueParts.e === scale ? valueParts.n : valueParts.n * 10n ** BigInt(valueParts.e - scale),
    scaledA = aParts.e === scale ? aParts.n : aParts.n * 10n ** BigInt(aParts.e - scale),
    scaledB = bParts.e === scale ? bParts.n : bParts.n * 10n ** BigInt(bParts.e - scale),
    delta = scaledValue - scaledA - scaledB
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}

/** Raw contact/capacity callers compare the fields that the SVG writer emits. */
export function compareClassSvgSum(value: number, a: number, b: number): number {
  return compareSvgSum(emitted(value), emitted(a), emitted(b))
}

/** A face is the exact sum of the two SVG rectangle fields, not a separately
 * rounded long-tail port. Refuse a sum that the existing writer cannot retain. */
export function addClassSvgNumbers(a: number, b: number): number | undefined {
  const parts = [a, b].map(v => {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(formatSvgNumber(emitted(v)))!
    return { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
  })
  const scale = Math.min(...parts.map(p => p.e)),
    sum = parts.reduce((n, p) => n + p.n * 10n ** BigInt(p.e - scale), 0n),
    value = Number(`${sum}e${scale}`)
  return Number.isFinite(value) && compareClassSvgSum(value, a, b) === 0 ? value : undefined
}

const emittedBox = (b: ClassSurfaceBox): ClassSurfaceBox => {
  if (b.width < 0 || b.height < 0 || !Number.isFinite(b.x + b.width) || !Number.isFinite(b.y + b.height)) throw new LayoutCertificationError([{ strategy: 'class-owned-surfaces', violations: ['Invalid retained Class surface'] }])
  return { x: emitted(b.x), y: emitted(b.y), width: emitted(b.width), height: emitted(b.height) }
}
const overlaps = (left: ClassSurfaceBox, right: ClassSurfaceBox) => {
  const a = emittedBox(left),
    b = emittedBox(right)
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
const HEADER_DETOUR_GAP = 4
const HEADER_ESCAPE_GAP = 8
const expanded = (b: ClassSurfaceBox, d: number): ClassSurfaceBox => ({ x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d })
/** Exact open-rectangle clipping, including diagonal note connectors. */
export function classSegmentEntersBox(a: Point, b: Point, r: ClassSurfaceBox): boolean {
  return writtenSegmentEntersBox(emittedPoint(a), emittedPoint(b), emittedBox(r))
}
function writtenSegmentEntersBox(a: Point, b: Point, r: ClassSurfaceBox, parts?: Map<number, WrittenDecimalParts>): boolean {
  if (!(r.width > 0 && r.height > 0)) return false
  let low = 0,
    high = 1
  for (let index = 0; index < 2; index++) {
    const axis = index === 0 ? 'x' : 'y'
    const size = axis === 'x' ? r.width : r.height,
      start = r[axis]
    if (a[axis] <= start && b[axis] <= start) return false
    const highA = compareSvgSum(a[axis], start, size, parts),
      highB = a[axis] === b[axis] ? highA : compareSvgSum(b[axis], start, size, parts)
    if (highA >= 0 && highB >= 0) return false
    const relativeA = highA === 0 ? size : a[axis] - start,
      relativeB = highB === 0 ? size : b[axis] - start,
      delta = relativeB - relativeA
    if (delta === 0) {
      if (a[axis] <= start || highA >= 0) return false
    } else {
      const u = -relativeA / delta,
        v = (size - relativeA) / delta
      low = Math.max(low, Math.min(u, v))
      high = Math.min(high, Math.max(u, v))
    }
  }

  return low < high
}
const routeEnters = (p: readonly Point[], b: ClassSurfaceBox) => p.some((v, i) => i > 0 && classSegmentEntersBox(p[i - 1]!, v, b))
function ellipseHit(a: Point, b: Point, cx: number, cy: number, rx: number, ry: number): boolean {
  const ax = (a.x - cx) / rx,
    ay = (a.y - cy) / ry,
    dx = (b.x - a.x) / rx,
    dy = (b.y - a.y) / ry,
    d = dx * dx + dy * dy
  const t = d ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / d)) : 0
  return (ax + t * dx) ** 2 + (ay + t * dy) ** 2 < 1
}
function roundedHit(a: Point, b: Point, r: ClassSurfaceBox, radius: number): boolean {
  return writtenClassRoundedHit({ emitted: emittedPoint(a) }, { emitted: emittedPoint(b) }, { source: r, radius })
}
interface WrittenClassPoint {
  emitted: Point
  clipped?: Point
}
interface WrittenClassRoundedBox {
  source: ClassSurfaceBox
  inflation?: number
  radius: number
  emitted?: ClassSurfaceBox
  rx?: number
  ry?: number
  unrounded?: ClassSurfaceBox
  firstStrip?: ClassSurfaceBox
  secondStrip?: ClassSurfaceBox
  left?: number
  right?: number
  top?: number
  bottom?: number
}
/** The shared rounded predicate preserves both writing stages. Final card
 * inspection reuses these records; mutable repair callers supply fresh ones. */
function writtenClassRoundedHit(a: WrittenClassPoint, b: WrittenClassPoint, surface: WrittenClassRoundedBox, parts?: Map<number, WrittenDecimalParts>): boolean {
  const r = surface.emitted ??= emittedBox(surface.inflation === undefined ? surface.source : expanded(surface.source, surface.inflation))
  const rx = surface.rx ??= Math.min(Math.max(0, surface.radius), r.width / 2),
    ry = surface.ry ??= Math.min(Math.max(0, surface.radius), r.height / 2)
  const clipA = a.clipped ??= emittedPoint(a.emitted),
    clipB = b.clipped ??= emittedPoint(b.emitted)
  if (!rx || !ry) return writtenSegmentEntersBox(clipA, clipB, surface.unrounded ??= emittedBox(r), parts)
  const first = surface.firstStrip ??= emittedBox({ x: r.x + rx, y: r.y, width: r.width - 2 * rx, height: r.height })
  if (writtenSegmentEntersBox(clipA, clipB, first, parts)) return true
  // The second strip remains lazy: the first may already establish a hit.
  const second = surface.secondStrip ??= emittedBox({ x: r.x, y: r.y + ry, width: r.width, height: r.height - 2 * ry })
  if (writtenSegmentEntersBox(clipA, clipB, second, parts)) return true
  const left = surface.left ??= r.x + rx,
    right = surface.right ??= r.x + r.width - rx,
    top = surface.top ??= r.y + ry,
    bottom = surface.bottom ??= r.y + r.height - ry
  // A constant normalized axis on/outside both unit circles cannot enter a corner.
  if (a.emitted.x === b.emitted.x && Math.abs((a.emitted.x - left) / rx) >= 1 && Math.abs((a.emitted.x - right) / rx) >= 1
    || a.emitted.y === b.emitted.y && Math.abs((a.emitted.y - top) / ry) >= 1 && Math.abs((a.emitted.y - bottom) / ry) >= 1) return false
  return ellipseHit(a.emitted, b.emitted, left, top, rx, ry)
    || ellipseHit(a.emitted, b.emitted, left, bottom, rx, ry)
    || ellipseHit(a.emitted, b.emitted, right, top, rx, ry)
    || ellipseHit(a.emitted, b.emitted, right, bottom, rx, ry)
}
function convexOverlap(left: readonly Point[], right: readonly Point[], charge?: () => void): boolean {
  if (left.length < 3 || right.length < 3) return false
  const origin = left[0]!,
    a = left.map(p => {
      charge?.()
      return { x: p.x - origin.x, y: p.y - origin.y }
    }),
    b = right.map(p => {
      charge?.()
      return { x: p.x - origin.x, y: p.y - origin.y }
    }),
    axes: Point[] = []
  for (const points of [a, b])
    for (let i = 0; i < points.length; i++) {
      charge?.()
      const p = points[i]!,
        q = points[(i + 1) % points.length]!
      if (p.x !== q.x || p.y !== q.y) axes.push({ x: p.y - q.y, y: q.x - p.x })
    }
  for (const n of axes) {
    charge?.()
    let lo = Infinity,
      hi = -Infinity,
      L = Infinity,
      H = -Infinity
    for (const p of a) {
      charge?.()
      const v = p.x * n.x + p.y * n.y
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const p of b) {
      charge?.()
      const v = p.x * n.x + p.y * n.y
      L = Math.min(L, v)
      H = Math.max(H, v)
    }
    if (Math.min(hi, H) <= Math.max(lo, L)) return false
  }
  return axes.length > 0
}
function polygonBox(points: readonly Point[], r: ClassSurfaceBox, charge?: () => void): boolean {
  if (r.width <= 0 || r.height <= 0) return false
  return convexOverlap(
    points,
    [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ],
    charge,
  )
}
function circlePolygon(cx: number, cy: number, r: number, points: readonly Point[]): boolean {
  if (r <= 0 || points.length < 3) return false
  let sign = 0,
    inside = true,
    area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      cross = dx * (cy - a.y) - dy * (cx - a.x)
    area += (a.x - points[0]!.x) * (b.y - points[0]!.y) - (a.y - points[0]!.y) * (b.x - points[0]!.x)
    if (cross) {
      if (sign && Math.sign(cross) !== sign) inside = false
      sign ||= Math.sign(cross)
    }
    const length = dx * dx + dy * dy,
      t = length ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / length)) : 0
    if ((a.x + t * dx - cx) ** 2 + (a.y + t * dy - cy) ** 2 < r * r) return true
  }
  return area !== 0 && inside
}
export function classMarkerEntersBox(pieces: readonly ClassMarkerPiece[], box: ClassSurfaceBox, charge?: () => void): boolean {
  const r = emittedBox(box)
  return pieces.some(piece => {
    charge?.()
    return piece.kind === 'polygon' ? polygonBox(piece.points, r, charge) : ellipseBox(piece.cx, piece.cy, piece.r, r)
  })
}
/** Exact orthogonal carrier pieces: butt strips plus each ninety-degree miter. */
export function classCarrierEntersMarker(a: Point, b: Point, pieces: readonly ClassMarkerPiece[], width: number): boolean {
  a = emittedPoint(a)
  b = emittedPoint(b)
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy),
    half = width / 2
  if (!length || !(half > 0)) return false
  const nx = (-dy / length) * half,
    ny = (dx / length) * half,
    quad = [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ]
  return pieces.some(piece => (piece.kind === 'polygon' ? convexOverlap(quad, piece.points) : circlePolygon(piece.cx, piece.cy, piece.r, quad)))
}
export function classNewMiterEntersMarker(route: readonly Point[], original: readonly Point[], pieces: readonly ClassMarkerPiece[], width: number): boolean {
  const half = width / 2
  if (!(half > 0)) return false
  for (let i = 1; i + 1 < route.length; i++) {
    const a = emittedPoint(route[i - 1]!),
      p = emittedPoint(route[i]!),
      b = emittedPoint(route[i + 1]!)
    if (!((a.x === p.x && p.y === b.y) || (a.y === p.y && p.x === b.x))) continue
    if (original.some((q, j) => j > 0 && j + 1 < original.length && emitted(q.x) === p.x && emitted(q.y) === p.y && emitted(original[j - 1]!.x) === a.x && emitted(original[j - 1]!.y) === a.y && emitted(original[j + 1]!.x) === b.x && emitted(original[j + 1]!.y) === b.y)) continue
    // For a right angle, the two butt strips and miter exactly cover this square.
    if (classMarkerEntersBox(pieces, { x: p.x - half, y: p.y - half, width, height: width })) return true
  }
  return false
}
/** A quadratic lies in its emitted control hull; overlapping hulls are unproved
 * candidates, not claims that every bounding-box overlap is painted ink. */
export function classNewRoundedCornersClear(route: readonly Point[], original: readonly Point[], boxes: readonly ClassSurfaceBox[], markers: readonly ClassMarkerPiece[][], style: ResolvedRenderStyle, charge?: () => void): boolean {
  if (!(style.edgeBendRadius > 0)) return true
  const half = emitted(style.lineWidth) / 2
  for (let i = 1; i + 1 < route.length; i++) {
    charge?.()
    const a = route[i - 1]!,
      p = route[i]!,
      b = route[i + 1]!
    if (original.some((q, j) => {charge?.();return j > 0 && j + 1 < original.length && q.x === p.x && q.y === p.y && original[j - 1]!.x === a.x && original[j - 1]!.y === a.y && original[j + 1]!.x === b.x && original[j + 1]!.y === b.y})) continue
    const projection = projectRoundedConnectorPath([a, p, b], style.edgeBendRadius, { metric: 'manhattan' })
    if (projection.geometry.kind !== 'path') return false
    const match = /L([^LQ]+)Q([^LQ]+)/.exec(projection.geometry.d)
    if (!match) continue
    const values = (match[1] + ' ' + match[2]).trim().split(/[ ,]+/).map(Number)
    if (values.length !== 6 || values.some(v => !Number.isFinite(v))) return false
    const hull: Point[] = [
      { x: emitted(values[0]!), y: emitted(values[1]!) },
      { x: emitted(values[2]!), y: emitted(values[3]!) },
      { x: emitted(values[4]!), y: emitted(values[5]!) },
    ]
    if (boxes.some(box => {charge?.();return polygonBox(hull, expanded(emittedBox(box), half),charge)})) return false
    const xs = hull.map(q => q.x),
      ys = hull.map(q => q.y),
      bounds = { x: Math.min(...xs) - half, y: Math.min(...ys) - half, width: Math.max(...xs) - Math.min(...xs) + 2 * half, height: Math.max(...ys) - Math.min(...ys) + 2 * half }
    if (markers.some(pieces => {charge?.();return classMarkerEntersBox(pieces, bounds,charge)})) return false
  }
  return true
}
function classMarkerEntersNote(pieces: readonly ClassMarkerPiece[], note: ClassSurfaceBox): boolean {
  const r = emittedBox(note),
    radius = Math.min(2, r.width / 2, r.height / 2)
  if (!radius) return false
  const cores = [
    { x: r.x + radius, y: r.y, width: r.width - 2 * radius, height: r.height },
    { x: r.x, y: r.y + radius, width: r.width, height: r.height - 2 * radius },
  ]
  if (cores.some(box => classMarkerEntersBox(pieces, box))) return true
  for (const x of [r.x + radius, r.x + r.width - radius])
    for (const y of [r.y + radius, r.y + r.height - radius])
      for (const piece of pieces) {
        if (piece.kind === 'circle' ? (piece.cx - x) ** 2 + (piece.cy - y) ** 2 < (piece.r + radius) ** 2 : circlePolygon(x, y, radius, piece.points)) return true
      }
  return false
}
function ellipseBox(cx: number, cy: number, radius: number, r: ClassSurfaceBox): boolean {
  if (radius <= 0 || r.width <= 0 || r.height <= 0) return false
  const dx = cx - Math.max(r.x, Math.min(r.x + r.width, cx)),
    dy = cy - Math.max(r.y, Math.min(r.y + r.height, cy))
  return dx * dx + dy * dy < radius * radius
}
export function classRelationshipPaintBoxes(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, includeMarkers = true, charge?: () => void, includeText = true): { box: ClassSurfaceBox; edge: number; kind: 'label' | 'cardinality' | 'marker'; endpoint?: 'from' | 'to'; pieces?: ClassMarkerPiece[] }[] {
  const result: { box: ClassSurfaceBox; edge: number; kind: 'label' | 'cardinality' | 'marker'; endpoint?: 'from' | 'to'; pieces?: ClassMarkerPiece[] }[] = [],
    resources = includeMarkers ? classMarkerResources(style) : [],
    halo = RELATION_LABEL_HALO_WIDTH / 2
  diagram.relationships.forEach((rel, edge) => {
    charge?.()
    const caption = classCaptionAnchor(rel)
    if (includeText && rel.label && caption && rel.labelBlock?.text) result.push({ edge, kind: 'label', box: { x: caption.x - rel.labelBlock.width / 2 - halo, y: caption.y - RELATION_LABEL_OFFSET_Y - rel.labelBlock.height / 2 - halo, width: rel.labelBlock.width + 2 * halo, height: rel.labelBlock.height + 2 * halo } })
    for (const side of ['from', 'to'] as const) {
      charge?.()
      const block = rel[`${side}CardinalityBlock`],
        p = classCardinalityAnchor(rel, side)
      if (includeText && block?.text && p) result.push({ edge, kind: 'cardinality', box: { x: p.x - block.width / 2 - halo, y: p.y - block.height / 2 - halo, width: block.width + 2 * halo, height: block.height + 2 * halo } })
    }
    if (!includeMarkers) return
    const startId = rel.markerAt === 'from' || rel.markerAt === 'both' ? getMarkerDefId(rel.fromType ?? rel.type) : null,
      endId = rel.markerAt === 'to' || rel.markerAt === 'both' ? getMarkerDefId(rel.toType ?? rel.type) : null
    // Rounding clamps each corner to half its adjacent legs, preserving the
    // admitted cardinal endpoint tangent. SvgWriter normalizes both path d
    // and sharp polyline coordinates, so both poses use written endpoints.
    const first = emittedPoint(rel.points[0] ?? { x: 0, y: 0 }),
      last = emittedPoint(rel.points.at(-1) ?? first)
    let next = first,
      previous = last
    for (let i = 1; i < rel.points.length; i++) {
      charge?.()
      const p = emittedPoint(rel.points[i]!)
      if (p.x !== first.x || p.y !== first.y) {
        next = p
        break
      }
    }
    for (let i = rel.points.length - 2; i >= 0; i--) {
      charge?.()
      const p = emittedPoint(rel.points[i]!)
      if (p.x !== last.x || p.y !== last.y) {
        previous = p
        break
      }
    }
    const mark = connector({
      id: 'class-owned-paint',
      role: 'relationship',
      geometry: { kind: 'polyline', points: [first, next, previous, last] },
      lineStyle: 'solid',
      paint: { strokeWidth: String(emitted(style.lineWidth)) },
      markers: { ...(startId ? { start: resources.find(m => m.id === startId) } : {}), ...(endId ? { end: resources.find(m => m.id === endId) } : {}) },
    })
    for (const region of connectorMarkerPaintRegions(mark)) {
      charge?.()
      const b = region.bounds
      if (!b) throw new TypeError('Class marker paint has no finite bound')
      const start = region.position === 'start',
        descriptor = resources.find(m => m.id === region.resource)!
      const anchor = start ? first : last,
        tangent = start ? { x: next.x - first.x, y: next.y - first.y } : { x: last.x - previous.x, y: last.y - previous.y }
      const pieces = classMarkerPieces(descriptor, anchor, tangent, start ? 'start' : 'end', emitted(style.lineWidth), charge)
      let x0 = b.x0,
        y0 = b.y0,
        x1 = b.x1,
        y1 = b.y1
      for (const piece of pieces) {
        charge?.()
        if (piece.kind === 'circle') {
          x0 = Math.min(x0, piece.cx - piece.r)
          x1 = Math.max(x1, piece.cx + piece.r)
          y0 = Math.min(y0, piece.cy - piece.r)
          y1 = Math.max(y1, piece.cy + piece.r)
        } else
          for (const p of piece.points) {
            charge?.()
            x0 = Math.min(x0, p.x)
            x1 = Math.max(x1, p.x)
            y0 = Math.min(y0, p.y)
            y1 = Math.max(y1, p.y)
          }
      }
      result.push({ edge, kind: 'marker', endpoint: start ? 'from' : 'to', pieces, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
    }
  })
  return result
}
function simpleClassRoute(route: readonly Point[]): boolean {
  const points = simplifyOrthogonal(route.map(emittedPoint))
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      vertical = a.x === b.x
    if (!vertical && a.y !== b.y) return false
    for (let j = 1; j < i; j++) {
      const c = points[j - 1]!,
        d = points[j]!,
        peerVertical = c.x === d.x
      if (vertical === peerVertical) {
        const axis = vertical ? 'y' : 'x',
          fixed = vertical ? 'x' : 'y'
        if (a[fixed] !== c[fixed]) continue
        const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])),
          high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
        if (j === i - 1 ? low < high : low <= high) return false
      } else if (j !== i - 1) {
        const x = vertical ? a.x : c.x,
          y = vertical ? c.y : a.y
        if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y) && x >= Math.min(c.x, d.x) && x <= Math.max(c.x, d.x) && y >= Math.min(c.y, d.y) && y <= Math.max(c.y, d.y)) return false
      }
    }
  }
  return true
}
interface HeaderMarkerSupport { x0: number; y0: number; x1: number; y1: number }
/** Candidate points are already canonical header coordinates. Full-width
 * expansion covers every butt strip; unknown arithmetic keeps exact checks. */
function headerMarkerSupport(points: readonly Point[], width: number, pay: () => void): HeaderMarkerSupport | undefined {
  pay()
  if (!(width > 0) || !Number.isFinite(width)) return undefined
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const point of points) {
    pay()
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
    x0 = Math.min(x0, point.x); y0 = Math.min(y0, point.y)
    x1 = Math.max(x1, point.x); y1 = Math.max(y1, point.y)
  }
  x0 -= width; y0 -= width; x1 += width; y1 += width
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return undefined
  for (let i = 0; i < 5; i++) pay()
  return { x0, y0, x1, y1 }
}
function headerMarkerMayMeet(support: HeaderMarkerSupport | undefined, box: ClassSurfaceBox, pay: () => void): boolean {
  pay()
  if (!support || !(box.width >= 0 && box.height >= 0)) return true
  const x1 = box.x + box.width, y1 = box.y + box.height,
    error = (Math.abs(support.x0) + Math.abs(support.y0) + Math.abs(support.x1) + Math.abs(support.y1)
      + Math.abs(box.x) + Math.abs(box.y) + Math.abs(x1) + Math.abs(y1)) * 1e-10 + 1e-9,
    left = box.x - support.x1, right = support.x0 - x1, top = box.y - support.y1, bottom = support.y0 - y1
  return !Number.isFinite(error) || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)
    || !(left > error || right > error || top > error || bottom > error)
}
// Also used for a fresh, fail-closed final proof. Complete full-width endpoint
// envelopes include sharp joins; overlap is unproved, not a collision claim.
export { headerMarkerSupport as classCarrierSupportBounds, headerMarkerMayMeet as classCarrierBoundsMayMeetMarker }
/** Test every retained band; endpoint ancestry grants no header exemption. */
export function repairClassHeaderRoutes(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, work?: ClassMarkerAdmissionWork, numeric?: ClassHeaderNumericCapture): Set<number> {
  const changed = new Set<number>()
  if (!diagram.namespaces.length) {
    if (numeric) {
      const ledger = work ?? createClassMarkerAdmissionWork()
      if (!chargeClassMarkerAdmissionWork(ledger)) throw new LayoutCertificationError([{strategy:'class-header-lanes',violations:['Class header proof work limit']}])
      captureClassHeaderNumericContext(numeric, undefined)
    }
    return changed
  }
  const ledger = work ?? createClassMarkerAdmissionWork(),
    charge = () => chargeClassMarkerAdmissionWork(ledger),
    pay = () => { if (!charge()) throw new LayoutCertificationError([{strategy:'class-header-lanes',violations:['Class header proof work limit']}]) }
  if (numeric) { pay(); captureClassHeaderNumericContext(numeric, undefined) }
  const terminal = prepareMarkerTerminals(classMarkerResources(style))
  const headers = diagram.namespaces.map(ns => { pay(); return expanded({ x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight }, style.lineWidth / 2) }),
    paint = classRelationshipPaintBoxes(diagram, style, true, pay, false),
    cards = diagram.classes.filter(c => { pay(); return !c.isInterface }),
    furniture: ClassSurfaceBox[] = []
  // includeText=false above already supplies the stable marker-only roster.
  const markers = paint
  let titleFloor = 0
  for (const node of diagram.classes) {
    pay()
    if (!node.isInterface) continue
    if (node.interfaceBox) furniture.push(node.interfaceBox)
    const block = node.labelBlock
    if (block) furniture.push({ x: node.x + (node.width - block.width) / 2, y: node.y + node.headerHeight / 2 - block.height / 2, width: block.width, height: block.height })
  }
  if (diagram.title) {
    pay()
    const title=diagram.title,block=title.block??diagramTitleBand(title.text,style)?.block
    if(block){furniture.push({x:title.x-block.width/2,y:title.y-block.height/2,width:block.width,height:block.height});titleFloor=title.y+block.height/2+style.lineWidth/2}
  }
  // Relationship annotations and unauthored notes are finalized AFTER routes.
  // They cannot veto immutable geometry using stale, initially unsafe seats.
  const localBoxes = [...cards.map(c=>{pay();return expanded(c,style.lineWidth/2)}), ...headers, ...furniture.map(c=>{pay();return expanded(c,style.lineWidth/2)})]
  let peerContext: ClassHeaderPeerContext | undefined
  // Allocate scarce bypass room before flexible carriers can consume it.
  // Keep authored occurrence order intact; only this repair schedule changes.
  const order = diagram.relationships.map((relation, ri) => {
    pay()
    let slack = Infinity
    for (const header of headers) for (let i = 1; i < relation.points.length; i++) {
      pay()
      const a = emittedPoint(relation.points[i - 1]!), b = emittedPoint(relation.points[i]!)
      if (!classSegmentEntersBox(a, b, header)) continue
      const vertical = a.x === b.x
      if (!vertical && a.y !== b.y) continue
      const main = vertical ? 'y' : 'x', start = emitted(header[main]), size = emitted(vertical ? header.height : header.width), gap = Math.max(HEADER_DETOUR_GAP, style.lineWidth / 2), lo = emitted(start - gap), hi = emitted(start + size + gap)
      slack = Math.min(slack, lo - Math.min(a[main], b[main]), Math.max(a[main], b[main]) - hi)
    }
    return { ri, slack }
  }).sort((a, b) => { pay(); return a.slack - b.slack || a.ri - b.ri })
  for (const { ri } of order) {
    pay()
    const relation = diagram.relationships[ri]!
    for (const header of headers) {
      pay()
      if (!routeEnters(relation.points, header)) continue
      for (let segment = 1; segment < relation.points.length; segment++) {
        pay()
        const a = relation.points[segment - 1]!, b = relation.points[segment]!
        if (!classSegmentEntersBox(a, b, header)) continue
        const gap = Math.max(HEADER_DETOUR_GAP, style.lineWidth / 2),
          escape = Math.max(HEADER_ESCAPE_GAP, style.edgeBendRadius + style.lineWidth / 2)
        let accepted: {points:Point[];length:number} | undefined
        for (const candidate of classHeaderDetourCandidates({header,a,b,owner:ri,relationships:diagram.relationships,width:diagram.width,height:diagram.height,style,gap,escape,charge,peerContext})) {
          peerContext = candidate.peerContext
          pay()
          const detour = candidate.points
          if(detour.some(p=>{pay();return p.y<titleFloor}))continue
          if (localBoxes.some(box => { pay(); return routeEnters(detour, box) })) continue
          const support = headerMarkerSupport(detour, style.lineWidth, pay)
          if (markers.some(p => headerMarkerMayMeet(support, p.box, pay) && detour.some((point, i) => { pay(); return i > 0 && classCarrierEntersMarker(detour[i - 1]!, point, p.pieces ?? [], style.lineWidth) }))) continue
          const raw = simplifyOrthogonal([...relation.points.slice(0, segment), ...detour, ...relation.points.slice(segment)])
          const trial = extendTerminalRuns(raw, {
            start: terminal(relation.markerAt === 'from' || relation.markerAt === 'both' ? getMarkerDefId(relation.fromType ?? relation.type) ?? undefined : undefined, style.lineWidth, 'start'),
            end: terminal(relation.markerAt === 'to' || relation.markerAt === 'both' ? getMarkerDefId(relation.toType ?? relation.type) ?? undefined : undefined, style.lineWidth, 'end'),
          })
          if (!trial) continue
          if (trial !== raw && markers.some(p => trial.some((point, i) => {
            pay()
            if (!i || p.edge === ri && (p.endpoint === 'from' && i === 1 || p.endpoint === 'to' && i === trial.length - 1)) return false
            const a = trial[i - 1]!, oldA = raw[i - 1]!, oldB = raw[i]!
            if (a.x === oldA.x && a.y === oldA.y && point.x === oldB.x && point.y === oldB.y) return false
            return classCarrierEntersMarker(a, point, p.pieces ?? [], style.lineWidth)
          }))) continue
          if (!simpleClassRoute(trial) || (style.edgeBendRadius <= 0 && markers.some(p => { pay(); return classNewMiterEntersMarker(trial, relation.points, p.pieces ?? [], style.lineWidth) }))) continue
          if (style.edgeBendRadius > 0 && !classNewRoundedCornersClear(trial,relation.points,localBoxes,paint.filter(p=>p.kind==='marker').map(p=>p.pieces??[]),style,pay)) continue
          if (trial[0]!.x !== relation.points[0]!.x || trial[0]!.y !== relation.points[0]!.y || trial.at(-1)!.x !== relation.points.at(-1)!.x || trial.at(-1)!.y !== relation.points.at(-1)!.y) continue
          if ([...cards,...furniture,...headers.filter(h=>h!==header&&!routeEnters(relation.points,h))].some(box=>{pay();return routeEnters(trial,box)})) continue
          if (!candidate.peerProof.clear(trial)) continue
          pay()
          accepted={points:trial,length:detour.length}
          break // Close/release the candidate iterator before publishing geometry.
        }
        if(accepted){pay();relation.points=accepted.points;changed.add(ri);segment+=Math.max(0,accepted.length-2)}
      }
    }
  }
  // Every candidate iterator has closed before this data-only capture. The
  // final accepted owner may still need the accessor's exact raw refresh.
  if (numeric) { pay(); captureClassHeaderNumericContext(numeric, peerContext) }
  return changed
}
/** Move only an unsafe unauthored annotation seat; preserve every relationship. */
export function repairClassNoteSeats(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, padding: number, work?: ClassMarkerAdmissionWork): void {
  if (!diagram.notes.length) return
  const ledger=work??createClassMarkerAdmissionWork(), pay=()=>{if(!chargeClassMarkerAdmissionWork(ledger))throw new LayoutCertificationError([{strategy:'class-owned-note',violations:['Class note proof work limit']}])},
    titleBlock=diagram.title?(diagram.title.block??diagramTitleBand(diagram.title.text,style)?.block):undefined,
    minimumTop=Math.max(padding,diagram.title&&titleBlock?diagram.title.y+titleBlock.height/2+DIAGRAM_TITLE_GAP:padding),
    headers=diagram.namespaces.map(ns=>{pay();return{x:ns.x,y:ns.y,width:ns.width,height:ns.headerHeight}})
  let paint=classRelationshipPaintBoxes(diagram,style,true,pay,false)
  const interfaceLabels=diagram.classes.filter(node=>{pay();return node.isInterface}).map(node=>{
    pay();const block=node.labelBlock
    return block?{x:node.x+(node.width-block.width)/2,y:node.y+node.headerHeight/2-block.height/2,width:block.width,height:block.height}:{x:node.x,y:node.y,width:node.width,height:node.height}
  })
  const safe=(note:PositionedClassNote,index:number,leading=false):boolean=>{
    pay()
    if(!leading&&note.y<minimumTop)return false
    const others=diagram.notes.filter((_,i)=>{pay();return i!==index}),fixed=[...diagram.classes.filter(c=>{pay();return !c.isInterface}),...interfaceLabels,...headers,...others]
    // Captions/cardinalities are future joint-seater outputs. Immutable cards,
    // full headers, markers and actual shafts remain authoritative here.
    if(fixed.some(box=>{pay();return overlaps(note,box)})||paint.some(p=>{pay();return p.kind==='marker'&&classMarkerEntersNote(p.pieces??[],note)}))return false
    for(const rel of diagram.relationships)for(let i=1;i<rel.points.length;i++){pay();if(roundedHit(rel.points[i-1]!,rel.points[i]!,note,2))return false}
    if(style.edgeBendRadius>0)for(const rel of diagram.relationships){pay();if(!classNewRoundedCornersClear(rel.points,[],[note],[],style,pay))return false}
    if(note.targetX!==undefined&&note.targetY!==undefined){
      const a={x:note.targetX,y:note.targetY},b={x:note.noteX??note.x,y:note.noteY??note.y+note.height/2}
      if(fixed.some(box=>{pay();return classSegmentEntersBox(a,b,box)})||paint.some(p=>{pay();return p.kind==='marker'&&classCarrierEntersMarker(a,b,p.pieces??[],1)}))return false
      const A=emittedPoint(a),B=emittedPoint(b),horizontal=A.y===B.y,vertical=A.x===B.x
      if(horizontal&&vertical)return false
      if((horizontal||vertical)&&style.lineWidth>0)for(const rel of diagram.relationships)for(let j=1;j<rel.points.length;j++){
        pay();const c=emittedPoint(rel.points[j-1]!),d=emittedPoint(rel.points[j]!),half=(1+emitted(style.lineWidth))/2
        const parallel=horizontal?c.y===d.y&&Math.abs(c.y-A.y)<half:c.x===d.x&&Math.abs(c.x-A.x)<half
        if(!parallel)continue
        const axis=horizontal?'x':'y'
        if(Math.max(Math.min(A[axis],B[axis]),Math.min(c[axis],d[axis]))<Math.min(Math.max(A[axis],B[axis]),Math.max(c[axis],d[axis])))return false
      }
    }
    return true
  }
  for(let i=0;i<diagram.notes.length;i++){
    pay();const note=diagram.notes[i]!
    if(safe(note,i))continue
    const target=diagram.classes.find(c=>{pay();return c.id===note.for}),candidates:PositionedClassNote[]=[]
    if(target){
      for(let lane=0;lane<Math.max(4,diagram.notes.length+1);lane++){
        pay();const offset=lane*(note.height+12)
        candidates.push(
          {...note,x:target.x+target.width+24,y:target.y+offset,targetX:target.x+target.width,targetY:target.y+target.height/2,noteX:target.x+target.width+24,noteY:target.y+offset+note.height/2},
          {...note,x:target.x-note.width-24,y:target.y+offset,targetX:target.x,targetY:target.y+target.height/2,noteX:target.x-24,noteY:target.y+offset+note.height/2},
          {...note,x:target.x,y:target.y+target.height+24+offset,targetX:target.x+target.width/2,targetY:target.y+target.height,noteX:target.x+note.width/2,noteY:target.y+target.height+24+offset},
        )
      }
      candidates.push({...note,x:diagram.width+24,y:target.y,targetX:target.x+target.width,targetY:target.y+target.height/2,noteX:diagram.width+24,noteY:target.y+note.height/2})
      const radius=Math.min(style.cornerRadius??0,target.width/2,target.height/2)
      for(let lane=0;lane<Math.max(4,diagram.notes.length+1);lane++){
        const y=target.y+target.height+12+lane*(note.height+12)
        for(const right of[true,false]){pay();const center=target.x+(right?target.width:0),contact=target.x+(right?Math.min(target.width*.75,target.width-radius):Math.max(target.width*.25,radius));candidates.push({...note,x:center-note.width/2,y,targetX:contact,targetY:target.y+target.height,noteX:center,noteY:y})}
      }
    }else candidates.push({...note,x:padding,y:diagram.height+16})
    let seat=candidates.find(c=>{pay();return c.x>=padding&&c.y>=minimumTop&&safe(c,i)})
    if(!seat)seat=candidates.find(c=>{pay();return c.x<padding&&c.y>=minimumTop&&safe(c,i)})
    // Preserve every old successful seat before trying the bounded north
    // mirrors. A proved leading seat gets real canvas room, never clipping.
    if(!seat&&target&&!target.isInterface){
      const radius=Math.min(style.cornerRadius??0,target.width/2,target.height/2)
      north:for(let lane=0;lane<Math.max(4,diagram.notes.length+1);lane++)for(const right of[true,false]){
        pay();const center=target.x+(right?target.width:0),contact=target.x+(right?Math.min(target.width*.75,target.width-radius):Math.max(target.width*.25,radius)),y=target.y-note.height-12-lane*(note.height+12),candidate={...note,x:center-note.width/2,y,targetX:contact,targetY:target.y,noteX:center,noteY:y+note.height}
        if(safe(candidate,i,true)){seat=candidate;break north}
      }
    }
    if(!seat)throw new LayoutCertificationError([{strategy:'class-owned-note',violations:[`No safe note seat for ${note.for??'unattached annotation'}`]}])
    const dx=Math.max(0,padding-seat.x),dy=Math.max(0,minimumTop-seat.y)
    if(!Number.isFinite(diagram.width+dx)||!Number.isFinite(diagram.height+dy))throw new LayoutCertificationError([{strategy:'class-owned-note',violations:['No finite leading room for note']}])
    for(const _key of Object.keys(seat))pay()
    Object.assign(note,seat)
    if(dx>0||dy>0){
      // These poses are unauthored factory seats: separated horizontal seats
      // use facing E/W contacts; the overlapping corner seats use facing N/S.
      // Retain that identity across the rigid shift, then spell high faces as
      // exact sums of actual rectangle fields, not independent rounded tails.
      const anchors:{note:PositionedClassNote;node:PositionedClassDiagram['classes'][number];side:'E'|'W'|'S'|'N'}[]=[]
      for(const n of diagram.notes){
        pay();const node=diagram.classes.find(c=>{pay();return c.id===n.for})
        if(!node||node.isInterface||n.targetX===undefined||n.targetY===undefined)continue
        const side=n.x>node.x+node.width?'E':n.x+n.width<node.x?'W':n.y>node.y+node.height?'S':n.y+n.height<node.y?'N':undefined
        if(side){pay();anchors.push({note:n,node,side})}
      }
      for(const node of diagram.classes){pay();node.x+=dx;node.y+=dy;if(node.interfaceBox){pay();node.interfaceBox.x+=dx;node.interfaceBox.y+=dy}}
      for(const ns of diagram.namespaces){pay();ns.x+=dx;ns.y+=dy}
      for(const n of diagram.notes){pay();n.x+=dx;n.y+=dy;if(n.targetX!==undefined)n.targetX+=dx;if(n.targetY!==undefined)n.targetY+=dy;if(n.noteX!==undefined)n.noteX+=dx;if(n.noteY!==undefined)n.noteY+=dy}
      for(const rel of diagram.relationships){pay();for(const p of rel.points){pay();p.x+=dx;p.y+=dy}for(const p of[rel.labelPosition,rel.fromCardinalityPosition,rel.toCardinalityPosition])if(p){pay();p.x+=dx;p.y+=dy}}
      for(const h of headers){pay();h.x+=dx;h.y+=dy}
      for(const label of interfaceLabels){pay();label.x+=dx;label.y+=dy}
      diagram.width+=dx;diagram.height+=dy
      for(const{note:n,node,side}of anchors){
        pay();const high=side==='E'||side==='S',axis=side==='E'||side==='W'?'x':'y',origin=node[axis],extent=axis==='x'?node.width:node.height,source=high?addClassSvgNumbers(origin,extent):emitted(origin),sink=high?emitted(n[axis]):addClassSvgNumbers(n[axis],axis==='x'?n.width:n.height)
        if(source===undefined||sink===undefined)throw new LayoutCertificationError([{strategy:'class-owned-note',violations:['Exact note contact is not representable']}])
        if(axis==='x'){n.targetX=source;n.noteX=sink}else{n.targetY=source;n.noteY=sink}
      }
      paint=classRelationshipPaintBoxes(diagram,style,true,pay,false)
    }
    diagram.width=Math.max(diagram.width,note.x+note.width+padding)
    diagram.height=Math.max(diagram.height,note.y+note.height+padding)
    if(diagram.title)diagram.title.x=diagram.width/2 // Its vertical band stays above content.
    if(!safe(note,i))throw new LayoutCertificationError([{strategy:'class-owned-note',violations:['Unproved translated note seat']}])
  }
}
export function classOwnedSurfaceViolations(diagram: PositionedClassDiagram, style: ResolvedRenderStyle): string[] {
  const violations: string[] = [],
    headers = diagram.namespaces.map(ns => ({ id: ns.id, x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight })),
    paint = classRelationshipPaintBoxes(diagram, style, headers.length > 0 || diagram.notes.length > 0),
    shaftHalf = style.lineWidth / 2
  for (const box of [...diagram.classes, ...diagram.notes, ...headers]) emittedBox(box)
  const nodeMap = new Map(diagram.classes.map(c => [c.id, c]))
  // Only exact near-boundary fallbacks populate this inspection's parts.
  const decimalParts = new Map<number, WrittenDecimalParts>()
  const originalCards: Array<WrittenClassRoundedBox | undefined> = [],
    inflatedCards: Array<WrittenClassRoundedBox | undefined> = []
  for (let edge = 0; edge < diagram.relationships.length; edge++) {
    const rel = diagram.relationships[edge]!
    if (rel.points.length < 2) {
      violations.push(`Relationship ${rel.from} -> ${rel.to} has no visible route`)
      continue
    }
    for (const from of [true, false]) {
      const node = nodeMap.get(from ? rel.from : rel.to)
      if (!node) {
        violations.push('Undeclared Class endpoint')
        continue
      }
      if (node.isInterface) continue
      const a = emittedPoint(from ? rel.points[0]! : rel.points.at(-1)!),
        b = emittedPoint(from ? rel.points[1]! : rel.points.at(-2)!),
        box = emittedBox(node),
        right = box.x + box.width,
        bottom = box.y + box.height
      if (
        !(
          (a.x === box.x && a.y >= box.y && a.y <= bottom && b.x < a.x && b.y === a.y) ||
          (compareSvgSum(a.x, box.x, box.width, decimalParts) === 0 && a.y >= box.y && a.y <= bottom && b.x > a.x && b.y === a.y) ||
          (a.y === box.y && a.x >= box.x && a.x <= right && b.y < a.y && b.x === a.x) ||
          (compareSvgSum(a.y, box.y, box.height, decimalParts) === 0 && a.x >= box.x && a.x <= right && b.y > a.y && b.x === a.x)
        )
      )
        violations.push(`Relationship ${rel.from} -> ${rel.to} lacks an outward Class contact`)
    }
    const writtenPoints: Array<WrittenClassPoint | undefined> = []
    const writtenPoint = (index: number): WrittenClassPoint => writtenPoints[index] ??= { emitted: emittedPoint(rel.points[index]!) }
    for (let i = 1; i < rel.points.length; i++) {
      const a = rel.points[i - 1]!,
        b = rel.points[i]!
      for (const h of headers) if (classSegmentEntersBox(a, b, expanded(h, shaftHalf))) violations.push(`Relationship ${rel.from} -> ${rel.to} enters namespace header ${h.id}`)
      for (const note of diagram.notes) if (roundedHit(a, b, expanded(note, shaftHalf), 2 + shaftHalf)) violations.push(`Relationship ${rel.from} -> ${rel.to} enters note ${note.for ?? ''}`)
      for (let card = 0; card < diagram.classes.length; card++) {
        const cls = diagram.classes[card]!
        if (cls.isInterface) continue
        const terminal = (i === 1 && cls.id === rel.from) || (i === rel.points.length - 1 && cls.id === rel.to)
        const radius = style.cornerRadius ?? 0,
          cards = terminal ? originalCards : inflatedCards
        const surface = cards[card] ??= { source: cls, ...(terminal ? {} : { inflation: shaftHalf }), radius: terminal ? radius : radius + shaftHalf }
        if (writtenClassRoundedHit(writtenPoint(i - 1), writtenPoint(i), surface, decimalParts)) violations.push(`Relationship ${rel.from} -> ${rel.to} enters card ${cls.id}`)
      }
    }
  }
  for (let i = 0; i < paint.length; i++) {
    const item = paint[i]!,
      rel = diagram.relationships[item.edge]!
    for (const h of headers) if (item.kind === 'marker' ? classMarkerEntersBox(item.pieces ?? [], h) : overlaps(item.box, h)) violations.push(`${item.kind} enters namespace header ${h.id}`)
    for (const note of diagram.notes) if (item.kind === 'marker' ? classMarkerEntersNote(item.pieces ?? [], note) : overlaps(item.box, note)) violations.push(`${item.kind} enters note ${note.for ?? ''}`)
    if (item.kind !== 'marker') for (const cls of diagram.classes) if (!cls.isInterface && overlaps(item.box, cls)) violations.push(`${item.kind} enters card ${cls.id}`)
  }
  return violations
}

/** Measured marker/header or own-boundary channel pressure in the existing sizing loop. */
export function classMarkerHeaderInsets(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, current: ReadonlyMap<string, number>, work?: ClassMarkerAdmissionWork): Map<string, number> {
  const next = new Map(current),
    paint = classRelationshipPaintBoxes(diagram, style).filter(p => p.kind === 'marker'),
    groups = new Map(diagram.namespaces.map(ns => [ns.id, ns])),
    owners = new Map(diagram.namespaces.flatMap(ns => ns.classIds.map(id => [id, ns.id] as const)))
  for (const ns of diagram.namespaces) {
    const header = { x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight },
      channel = diagram.relationships.some(r => routeEnters(r.points, header)) ? HEADER_DETOUR_GAP + style.lineWidth / 2 : 0,
      required = { ...header, height: header.height + channel }
    for (const p of paint) {
      if (!classMarkerEntersBox(p.pieces ?? [], required)) continue
      const edge = diagram.relationships[p.edge]!,
        id = p.endpoint === 'from' ? edge.from : edge.to,
        node = diagram.classes.find(c => c.id === id)
      let parent = owners.get(id)
      for (let depth = 0; parent && parent !== ns.id && depth <= groups.size; depth++) parent = groups.get(parent)?.parentId
      if (parent !== ns.id || !node || node.y < header.y + header.height) continue
      const overlap = header.y + header.height + channel - p.box.y
      if (overlap > 0 && Number.isFinite(overlap)) next.set(ns.id, Math.max(next.get(ns.id) ?? style.groupPaddingY, Math.ceil((current.get(ns.id) ?? style.groupPaddingY) + overlap)))
    }
  }
  // Distinct crossings need two-sided horizontal bypass rows as well as
  // glyph room. Reserve only measured missing space in the existing loop;
  // the actual returned routes and full peer proof remain authoritative.
  const half=emitted(style.lineWidth)/2
  if(!(half>0))return next
  const pay=()=>{if(work&&!chargeClassMarkerAdmissionWork(work))throw new LayoutCertificationError([{strategy:'class-header-capacity',violations:['Class header capacity proof work limit']}])},
    nodes=new Map(diagram.classes.map(n=>{pay();return[n.id,n]})),
    glyphs=new Map(paint.map(p=>{pay();return[`${p.edge}:${p.endpoint}`,p]})),
    demands=new Map<string,{count:number;free:number}>()
  for(let index=0;index<diagram.relationships.length;index++){
    const rel=diagram.relationships[index]!
    for(const from of[true,false]){
      pay();const node=nodes.get(from?rel.from:rel.to)
      if(!node||node.isInterface||rel.points.length<2)continue
      const a=from?rel.points[0]!:rel.points.at(-1)!,b=from?rel.points[1]!:rel.points.at(-2)!
      if(compareClassSvgSum(a.y,node.y,0)!==0||emitted(b.x)!==emitted(a.x)||emitted(b.y)>=emitted(a.y))continue
      let reach=half
      const marker=glyphs.get(`${index}:${from?'from':'to'}`)
      for(const piece of marker?.pieces??[]){
        pay()
        if(piece.kind==='circle')reach=Math.max(reach,emitted(a.y)-piece.cy+piece.r)
        else for(const point of piece.points){pay();reach=Math.max(reach,emitted(a.y)-point.y)}
      }
      // A rounded bypass corner spends min(radius, drop/2) of the drop into
      // this contact; it clears the glyph once the drop also holds this much.
      // Under an outer header the drop ends at the nearest crossed inner
      // header instead, whose stroke-expanded box the whole corner must clear.
      const radius=Math.max(0,style.edgeBendRadius)
      let floor=emitted(a.y)-reach-Math.min(radius,half+reach),parent=owners.get(node.id)
      for(let depth=0;parent&&depth<=groups.size;depth++){
        pay();const ns=groups.get(parent)!
        const header={x:ns.x,y:ns.y,width:ns.width,height:ns.headerHeight}
        if(routeEnters(rel.points,expanded(header,half))){
          const free=floor-emitted(ns.y)-emitted(ns.headerHeight),old=demands.get(parent)
          demands.set(parent,{count:(old?.count??0)+1,free:Math.min(old?.free??Infinity,free)})
          floor=emitted(ns.y)-radius-half
        }
        parent=ns.parentId
      }
    }
  }
  for(const[id,demand]of demands){
    pay();const rows=Math.ceil(demand.count/2),required=HEADER_DETOUR_GAP+2*half+(rows-1)*Math.max(1,emitted(style.lineWidth))
    if(demand.free<required){const padding=Math.ceil((current.get(id)??style.groupPaddingY)+required-demand.free);if(Number.isFinite(padding))next.set(id,Math.max(next.get(id)??style.groupPaddingY,padding))}
  }

  return next
}
