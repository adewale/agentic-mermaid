import { LayoutCertificationError } from '../layout/certification-error.ts'
import { simplifyOrthogonal } from '../layout/compound-visibility.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { connector } from '../scene/marks.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { Point } from '../types.ts'
import { type ClassMarkerPiece, classMarkerPieces, classMarkerResources, getMarkerDefId, RELATION_LABEL_HALO_WIDTH } from './relationship-paint.ts'
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
// Compare written decimal coordinates to a written rectangle face without
// treating binary addition's one-ULP tail as physical interior or clearance.
function compareSvgSum(value: number, a: number, b: number): number {
  const sum = a + b,
    difference = value - sum
  if (Math.abs(difference) > 8 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(a), Math.abs(b))) return Math.sign(difference)
  const parts = [value, a, b].map(v => {
    const text = formatSvgNumber(v),
      m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
    return { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
  })
  const scale = Math.min(...parts.map(p => p.e)),
    n = parts.map(p => p.n * 10n ** BigInt(p.e - scale)),
    delta = n[0]! - n[1]! - n[2]!
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
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
  a = emittedPoint(a)
  b = emittedPoint(b)
  r = emittedBox(r)
  if (!(r.width > 0 && r.height > 0)) return false
  let low = 0,
    high = 1
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? r.width : r.height,
      start = r[axis],
      end = start + size
    const highA = compareSvgSum(a[axis], start, size),
      highB = compareSvgSum(b[axis], start, size)
    if ((a[axis] <= start && b[axis] <= start) || (highA >= 0 && highB >= 0)) return false
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
  a = emittedPoint(a)
  b = emittedPoint(b)
  r = emittedBox(r)
  const rx = Math.min(Math.max(0, radius), r.width / 2),
    ry = Math.min(Math.max(0, radius), r.height / 2)
  if (!rx || !ry) return classSegmentEntersBox(a, b, r)
  if (classSegmentEntersBox(a, b, { x: r.x + rx, y: r.y, width: r.width - 2 * rx, height: r.height }) || classSegmentEntersBox(a, b, { x: r.x, y: r.y + ry, width: r.width, height: r.height - 2 * ry })) return true
  for (const x of [r.x + rx, r.x + r.width - rx]) for (const y of [r.y + ry, r.y + r.height - ry]) if (ellipseHit(a, b, x, y, rx, ry)) return true
  return false
}
function convexOverlap(left: readonly Point[], right: readonly Point[]): boolean {
  if (left.length < 3 || right.length < 3) return false
  const origin = left[0]!,
    a = left.map(p => ({ x: p.x - origin.x, y: p.y - origin.y })),
    b = right.map(p => ({ x: p.x - origin.x, y: p.y - origin.y })),
    axes: Point[] = []
  for (const points of [a, b])
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!,
        q = points[(i + 1) % points.length]!
      if (p.x !== q.x || p.y !== q.y) axes.push({ x: p.y - q.y, y: q.x - p.x })
    }
  for (const n of axes) {
    let lo = Infinity,
      hi = -Infinity,
      L = Infinity,
      H = -Infinity
    for (const p of a) {
      const v = p.x * n.x + p.y * n.y
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const p of b) {
      const v = p.x * n.x + p.y * n.y
      L = Math.min(L, v)
      H = Math.max(H, v)
    }
    if (Math.min(hi, H) <= Math.max(lo, L)) return false
  }
  return axes.length > 0
}
function polygonBox(points: readonly Point[], r: ClassSurfaceBox): boolean {
  if (r.width <= 0 || r.height <= 0) return false
  return convexOverlap(points, [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ])
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
export function classMarkerEntersBox(pieces: readonly ClassMarkerPiece[], box: ClassSurfaceBox): boolean {
  const r = emittedBox(box)
  return pieces.some(piece => (piece.kind === 'polygon' ? polygonBox(piece.points, r) : ellipseBox(piece.cx, piece.cy, piece.r, r)))
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
export function classNewRoundedCornersClear(route: readonly Point[], original: readonly Point[], boxes: readonly ClassSurfaceBox[], markers: readonly ClassMarkerPiece[][], style: ResolvedRenderStyle): boolean {
  if (!(style.edgeBendRadius > 0)) return true
  const half = style.lineWidth / 2
  for (let i = 1; i + 1 < route.length; i++) {
    const a = route[i - 1]!,
      p = route[i]!,
      b = route[i + 1]!
    if (original.some((q, j) => j > 0 && j + 1 < original.length && q.x === p.x && q.y === p.y && original[j - 1]!.x === a.x && original[j - 1]!.y === a.y && original[j + 1]!.x === b.x && original[j + 1]!.y === b.y)) continue
    const projection = projectRoundedConnectorPath([a, p, b], style.edgeBendRadius, { metric: 'manhattan', precision: 3 })
    if (projection.geometry.kind !== 'path') return false
    const match = /L([^LQ]+)Q([^LQ]+)/.exec(projection.geometry.d)
    if (!match) continue
    const values = (match[1] + ' ' + match[2]).trim().split(/[ ,]+/).map(Number)
    if (values.length !== 6 || values.some(v => !Number.isFinite(v))) return false
    const hull: Point[] = [
      { x: values[0]!, y: values[1]! },
      { x: values[2]!, y: values[3]! },
      { x: values[4]!, y: values[5]! },
    ]
    if (boxes.some(box => polygonBox(hull, expanded(emittedBox(box), half)))) return false
    const xs = hull.map(q => q.x),
      ys = hull.map(q => q.y),
      bounds = { x: Math.min(...xs) - half, y: Math.min(...ys) - half, width: Math.max(...xs) - Math.min(...xs) + 2 * half, height: Math.max(...ys) - Math.min(...ys) + 2 * half }
    if (markers.some(pieces => classMarkerEntersBox(pieces, bounds))) return false
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
export function classRelationshipPaintBoxes(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, options: { markers?: boolean } = {}): { box: ClassSurfaceBox; edge: number; kind: 'label' | 'cardinality' | 'marker'; endpoint?: 'from' | 'to'; pieces?: ClassMarkerPiece[] }[] {
  const result: { box: ClassSurfaceBox; edge: number; kind: 'label' | 'cardinality' | 'marker'; endpoint?: 'from' | 'to'; pieces?: ClassMarkerPiece[] }[] = [],
    resources = options.markers === false ? undefined : classMarkerResources(style),
    halo = RELATION_LABEL_HALO_WIDTH / 2
  diagram.relationships.forEach((rel, edge) => {
    if (rel.label && rel.labelPosition && rel.labelBlock) result.push({ edge, kind: 'label', box: { x: rel.labelPosition.x - rel.labelBlock.width / 2 - halo, y: rel.labelPosition.y - 8 - rel.labelBlock.height / 2 - halo, width: rel.labelBlock.width + 2 * halo, height: rel.labelBlock.height + 2 * halo } })
    for (const side of ['from', 'to'] as const) {
      const block = rel[`${side}CardinalityBlock`],
        p = rel[`${side}CardinalityPosition`]
      if (block && p) result.push({ edge, kind: 'cardinality', box: { x: p.x - block.width / 2 - halo, y: p.y - block.height / 2 - halo, width: block.width + 2 * halo, height: block.height + 2 * halo } })
    }
    if (!resources) return
    const startId = rel.markerAt === 'from' || rel.markerAt === 'both' ? getMarkerDefId(rel.fromType ?? rel.type) : null,
      endId = rel.markerAt === 'to' || rel.markerAt === 'both' ? getMarkerDefId(rel.toType ?? rel.type) : null
    const first = emittedPoint(rel.points[0] ?? { x: 0, y: 0 }),
      last = emittedPoint(rel.points.at(-1) ?? first)
    let next = first,
      previous = last
    for (let i = 1; i < rel.points.length; i++) {
      const p = emittedPoint(rel.points[i]!)
      if (p.x !== first.x || p.y !== first.y) {
        next = p
        break
      }
    }
    for (let i = rel.points.length - 2; i >= 0; i--) {
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
      paint: { strokeWidth: String(style.lineWidth) },
      markers: { ...(startId ? { start: resources.find(m => m.id === startId) } : {}), ...(endId ? { end: resources.find(m => m.id === endId) } : {}) },
    })
    for (const region of connectorMarkerPaintRegions(mark)) {
      const b = region.bounds
      if (!b) throw new TypeError('Class marker paint has no finite bound')
      const start = region.position === 'start',
        descriptor = resources.find(m => m.id === region.resource)!
      result.push({
        edge,
        kind: 'marker',
        endpoint: start ? 'from' : 'to',
        pieces: classMarkerPieces(descriptor, start ? first : last, start ? { x: next.x - first.x, y: next.y - first.y } : { x: last.x - previous.x, y: last.y - previous.y }, start ? 'start' : 'end', emitted(style.lineWidth)),
        box: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 },
      })
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
/** Test every retained band; endpoint ancestry grants no header exemption. */
export function repairClassHeaderRoutes(diagram: PositionedClassDiagram, style: ResolvedRenderStyle): void {
  if (!diagram.namespaces.length) return
  const headers = diagram.namespaces.map(ns => ({ x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight }))
  let cachedPaint: ReturnType<typeof classRelationshipPaintBoxes> | undefined
  for (let ri = 0; ri < diagram.relationships.length; ri++) {
    const relation = diagram.relationships[ri]!
    for (const header of headers) {
      if (!routeEnters(relation.points, header)) continue
      for (let segment = 1; segment < relation.points.length; segment++) {
        const a = relation.points[segment - 1]!,
          b = relation.points[segment]!
        if (!classSegmentEntersBox(a, b, header)) continue
        const vertical = emitted(a.x) === emitted(b.x),
          horizontal = emitted(a.y) === emitted(b.y)
        if (!vertical && !horizontal) continue
        const main = vertical ? 'y' : 'x',
          cross = vertical ? 'x' : 'y',
          gap = Math.max(HEADER_DETOUR_GAP, style.lineWidth / 2),
          low = header[main] - gap,
          high = header[main] + (vertical ? header.height : header.width) + gap
        if (Math.min(a[main], b[main]) >= low || Math.max(a[main], b[main]) <= high) continue
        const before = { ...a, [main]: a[main] < b[main] ? low : high },
          after = { ...b, [main]: a[main] < b[main] ? high : low }
        const escape = Math.max(HEADER_ESCAPE_GAP, style.edgeBendRadius + style.lineWidth / 2),
          lanes = [header[cross] - escape, header[cross] + (vertical ? header.width : header.height) + escape].sort((x, y) => Math.abs(x - a[cross]) - Math.abs(y - a[cross]))
        for (const lane of lanes) {
          const detour = [before, { ...before, [cross]: lane }, { ...after, [cross]: lane }, after]
          if (detour.some(p => p.x < 0 || p.y < 0 || p.x > diagram.width || p.y > diagram.height)) continue
          const paint = cachedPaint ??= classRelationshipPaintBoxes(diagram, style)
          const boxes = [...diagram.classes.filter(c => !c.isInterface), ...headers, ...diagram.notes, ...paint.filter(p => p.edge !== ri && p.kind !== 'marker').map(p => p.box)]
          if (boxes.some(box => routeEnters(detour, box)) || paint.some(p => p.edge !== ri && p.kind === 'marker' && detour.some((point, i) => i > 0 && classCarrierEntersMarker(detour[i - 1]!, point, p.pieces ?? [], style.lineWidth)))) continue
          const trial = simplifyOrthogonal([...relation.points.slice(0, segment), ...detour, ...relation.points.slice(segment)])
          if (!simpleClassRoute(trial) || (style.edgeBendRadius <= 0 && paint.some(p => p.edge !== ri && p.kind === 'marker' && classNewMiterEntersMarker(trial, relation.points, p.pieces ?? [], style.lineWidth)))) continue
          if (
            style.edgeBendRadius > 0 &&
            !classNewRoundedCornersClear(
              trial,
              relation.points,
              [...diagram.classes.filter(c => !c.isInterface), ...headers, ...diagram.notes, ...paint.filter(p => p.edge !== ri && p.kind !== 'marker').map(p => p.box)],
              paint.filter(p => p.edge !== ri && p.kind === 'marker').map(p => p.pieces ?? []),
              style,
            )
          )
            continue
          // Actual endpoints/rays and all existing points outside this replaced interval survive.
          if (trial[0]!.x !== relation.points[0]!.x || trial[0]!.y !== relation.points[0]!.y || trial.at(-1)!.x !== relation.points.at(-1)!.x || trial.at(-1)!.y !== relation.points.at(-1)!.y) continue
          if ([...diagram.classes.filter(c => !c.isInterface), ...diagram.notes, ...headers.filter(h => h !== header && !routeEnters(relation.points, h)), ...paint.filter(p => p.edge !== ri && p.kind !== 'marker').map(p => p.box)].some(box => routeEnters(trial, box))) continue
          relation.points = trial
          cachedPaint = undefined // Later detours inspect the newly accepted geometry.
          segment += Math.max(0, detour.length - 2)
          break
        }
      }
    }
  }
}
/** Move only an unsafe unauthored annotation seat; preserve every relationship. */
export function repairClassNoteSeats(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, padding: number): void {
  if (!diagram.notes.length) return
  const headers = diagram.namespaces.map(ns => ({ x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight })),
    paint = classRelationshipPaintBoxes(diagram, style)
  const safe = (note: PositionedClassNote, index: number): boolean => {
    const otherNotes = diagram.notes.filter((_, i) => i !== index),
      fixed = [...diagram.classes.filter(c => !c.isInterface), ...headers, ...otherNotes, ...paint.filter(p => p.kind !== 'marker').map(p => p.box)]
    if (fixed.some(box => overlaps(note, box)) || paint.some(p => p.kind === 'marker' && classMarkerEntersNote(p.pieces ?? [], note))) return false
    for (const rel of diagram.relationships) for (let i = 1; i < rel.points.length; i++) if (roundedHit(rel.points[i - 1]!, rel.points[i]!, note, 2)) return false
    if (note.targetX !== undefined && note.targetY !== undefined) {
      const a = { x: note.targetX, y: note.targetY },
        b = { x: note.noteX ?? note.x, y: note.noteY ?? note.y + note.height / 2 }
      if ([...diagram.classes.filter(c => !c.isInterface), ...headers, ...otherNotes, ...paint.filter(p => p.kind !== 'marker').map(p => p.box)].some(box => classSegmentEntersBox(a, b, box)) || paint.some(p => p.kind === 'marker' && classCarrierEntersMarker(a, b, p.pieces ?? [], 1))) return false
    }
    return true
  }
  for (let i = 0; i < diagram.notes.length; i++) {
    const note = diagram.notes[i]!
    if (safe(note, i)) continue
    const target = diagram.classes.find(c => c.id === note.for),
      candidates: PositionedClassNote[] = []
    if (target) {
      for (let lane = 0; lane < Math.max(4, diagram.notes.length + 1); lane++) {
        const offset = lane * (note.height + 12)
        candidates.push(
          { ...note, x: target.x + target.width + 24, y: target.y + offset, targetX: target.x + target.width, targetY: target.y + target.height / 2, noteX: target.x + target.width + 24, noteY: target.y + offset + note.height / 2 },
          { ...note, x: target.x - note.width - 24, y: target.y + offset, targetX: target.x, targetY: target.y + target.height / 2, noteX: target.x - 24, noteY: target.y + offset + note.height / 2 },
          { ...note, x: target.x, y: target.y + target.height + 24 + offset, targetX: target.x + target.width / 2, targetY: target.y + target.height, noteX: target.x + note.width / 2, noteY: target.y + target.height + 24 + offset },
        )
      }
      candidates.push({ ...note, x: diagram.width + 24, y: target.y, targetX: target.x + target.width, targetY: target.y + target.height / 2, noteX: diagram.width + 24, noteY: target.y + note.height / 2 })
      // A neighboring column or an endpoint marker can block every midpoint
      // seat. Try the lower corners without changing a relationship's route.
      const radius = Math.min(style.cornerRadius ?? 0, target.width / 2, target.height / 2)
      for (let lane = 0; lane < Math.max(4, diagram.notes.length + 1); lane++) {
        const y = target.y + target.height + 12 + lane * (note.height + 12)
        for (const right of [true, false]) {
          const center = target.x + (right ? target.width : 0)
          const contact = target.x + (right ? Math.min(target.width * 0.75, target.width - radius) : Math.max(target.width * 0.25, radius))
          candidates.push({ ...note, x: center - note.width / 2, y, targetX: contact, targetY: target.y + target.height, noteX: center, noteY: y })
        }
      }
    } else candidates.push({ ...note, x: padding, y: diagram.height + 16 })
    const seat = candidates.find(candidate => candidate.x >= padding && candidate.y >= padding && safe(candidate, i))
    if (!seat) throw new LayoutCertificationError([{ strategy: 'class-owned-note', violations: [`No safe note seat for ${note.for ?? 'unattached annotation'}`] }])
    Object.assign(note, seat)
    diagram.width = Math.max(diagram.width, note.x + note.width + padding)
    diagram.height = Math.max(diagram.height, note.y + note.height + padding)
  }
}
export function classOwnedSurfaceViolations(diagram: PositionedClassDiagram, style: ResolvedRenderStyle): string[] {
  const violations: string[] = [],
    headers = diagram.namespaces.map(ns => ({ id: ns.id, x: ns.x, y: ns.y, width: ns.width, height: ns.headerHeight })),
    paint = classRelationshipPaintBoxes(diagram, style, { markers: headers.length > 0 || diagram.notes.length > 0 }),
    shaftHalf = style.lineWidth / 2
  for (const box of [...diagram.classes, ...diagram.notes, ...headers]) emittedBox(box)
  const nodeMap = new Map(diagram.classes.map(c => [c.id, c]))
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
          (compareSvgSum(a.x, box.x, box.width) === 0 && a.y >= box.y && a.y <= bottom && b.x > a.x && b.y === a.y) ||
          (a.y === box.y && a.x >= box.x && a.x <= right && b.y < a.y && b.x === a.x) ||
          (compareSvgSum(a.y, box.y, box.height) === 0 && a.x >= box.x && a.x <= right && b.y > a.y && b.x === a.x)
        )
      )
        violations.push(`Relationship ${rel.from} -> ${rel.to} lacks an outward Class contact`)
    }
    for (let i = 1; i < rel.points.length; i++) {
      const a = rel.points[i - 1]!,
        b = rel.points[i]!
      for (const h of headers) if (classSegmentEntersBox(a, b, expanded(h, shaftHalf))) violations.push(`Relationship ${rel.from} -> ${rel.to} enters namespace header ${h.id}`)
      for (const note of diagram.notes) if (roundedHit(a, b, expanded(note, shaftHalf), 2 + shaftHalf)) violations.push(`Relationship ${rel.from} -> ${rel.to} enters note ${note.for ?? ''}`)
      for (const cls of diagram.classes) {
        if (cls.isInterface) continue
        const terminal = (i === 1 && cls.id === rel.from) || (i === rel.points.length - 1 && cls.id === rel.to)
        const radius = style.cornerRadius ?? 0
        if (roundedHit(a, b, terminal ? cls : expanded(cls, shaftHalf), terminal ? radius : radius + shaftHalf)) violations.push(`Relationship ${rel.from} -> ${rel.to} enters card ${cls.id}`)
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

/** Only existing marker/header conflicts request more content inset in the existing sizing loop. */
export function classMarkerHeaderInsets(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, current: ReadonlyMap<string, number>): Map<string, number> {
  if (!diagram.namespaces.length) return new Map(current)
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
  return next
}
