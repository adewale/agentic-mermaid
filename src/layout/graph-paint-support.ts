/** Shared sufficient written paint supports. This is optional placement
 * admission, never a paint certificate or a new geometric exception. */
import type { Point, PositionedEdge } from '../types.ts'
import type { Geometry, MarkPaint } from '../scene/ir.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { graphEdgePathProjection, graphEdgeDashArray } from '../graph-connectors.ts'
import { expandSceneBounds, paintedStrokeExtent, visitTypedPathSegments } from '../scene/bounds.ts'
import { routeMarkerPaintRegions } from './route-marker-clearance.ts'
import { labelRect, labelHaloExtension } from '../shared/edge-label-geometry.ts'
import { MAX_PREFERENCE_NODES, MAX_PREFERENCE_EDGES, type LabelMetricsStyle } from './route-geometry.ts'
export type GraphPaintStyle = LabelMetricsStyle & { nodeLineWidth?: number; cornerRadius?: number; nodeFillColor?: string; nodeBorderColor?: string }
// Shape arithmetic precedes numeric emission in the renderer. Normalize the
// resulting geometry, not the input node, before asking the shared ink owner.
export function writtenGeometry(geometry: Geometry): Geometry {
  if (geometry.kind === 'compound') return { ...geometry, children: geometry.children.map(writtenGeometry) }
  if (geometry.kind === 'path') return { ...geometry, d: formatSvgNumericAttribute('d', geometry.d) }
  if (geometry.kind === 'polygon' || geometry.kind === 'polyline') return { ...geometry, points: geometry.points.map(writtenPoint) }
  return Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key, typeof value === 'number' ? Number(formatSvgNumber(value)) : value])) as Geometry
}

const writtenPoint = (point: Point): Point => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) })
export const finiteBox = (box: AxisAlignedBox | undefined): box is AxisAlignedBox => !!box && Object.values(box).every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
export const boxesMeet = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => {
  // Preserve the incoming conservative arithmetic/serialization separator.
  const error = (Math.abs(a.x0) + Math.abs(a.y0) + Math.abs(a.x1) + Math.abs(a.y1) + Math.abs(b.x0) + Math.abs(b.y0) + Math.abs(b.x1) + Math.abs(b.y1)) * 1e-10 + 1e-9
  return !Number.isFinite(error) || a.x0 < b.x1 + error && b.x0 < a.x1 + error && a.y0 < b.y1 + error && b.y0 < a.y1 + error
}
function edgeShaftPaint(edge: PositionedEdge, style: GraphPaintStyle): MarkPaint {
  return { stroke: edge.inlineStyle?.stroke ?? style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: formatSvgNumericAttribute('stroke-width', edge.inlineStyle?.['stroke-width'] ?? String((style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1))) }
}
/** Optional movement needs a sufficient separator, not another collision
 * certifier. Unknown paint/geometry or overlapping conservative supports keep
 * the original layout; every segment and endpoint resource is retained. */
export function edgeInk(edge: PositionedEdge, style: GraphPaintStyle, work: () => boolean): { shafts: AxisAlignedBox[]; markers: NonNullable<ReturnType<typeof routeMarkerPaintRegions>>; label?: AxisAlignedBox } | undefined {
  if (edge.style === 'invisible') return { shafts: [], markers: [] }
  if (edge.points.length > MAX_PREFERENCE_NODES * MAX_PREFERENCE_EDGES) return undefined
  if (style.edgeBendRadius !== undefined && !(Number.isFinite(style.edgeBendRadius) && style.edgeBendRadius >= 0)) return undefined
  // renderEdge forwards these two authored fields; connector paint defaults
  // are butt caps and miter joins (limit four), owned by paintedStrokeExtent.
  const paint = edgeShaftPaint(edge, style)
  const extent = paintedStrokeExtent(paint, edge.points.length > 2 || !!edge.curve || (style.edgeBendRadius ?? 0) > 0)
  if (extent === undefined || edge.points.length < 2) return undefined
  if ((edge.hasArrowStart || edge.hasArrowEnd) && paintedStrokeExtent({ ...paint, stroke: 'black' }, false) === undefined) return undefined
  const supports: AxisAlignedBox[] = []
  const include = (box: AxisAlignedBox): boolean => {
    if (!work()) return false
    const support = expandSceneBounds(box, extent)
    if (!finiteBox(support)) return false
    if (extent > 0) supports.push(support)
    return true
  }
  const projection = graphEdgePathProjection(edge, style)
  if (projection) {
    if (!visitTypedPathSegments(formatSvgNumericAttribute('d', projection.geometry.d), segment => include(segment.bounds), work)) return undefined
  } else {
    const points = edge.points.map(writtenPoint)
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!
      if (!include({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })) return undefined
    }
  }
  const markers = routeMarkerPaintRegions(edge, style)
  if (!markers) return undefined
  for (const marker of markers) if (!work() || !finiteBox(marker.bounds)) return undefined
  const rect = labelRect(edge, style)
  const halo = rect ? labelHaloExtension(edge, style.lineWidth ?? 1) : 0
  const label = rect ? { x0: rect.x - halo, y0: rect.y - halo, x1: rect.x + rect.w + halo, y1: rect.y + rect.h + halo } : undefined
  if (label && !finiteBox(label)) return undefined
  return { shafts: supports, markers, ...(label ? { label } : {}) }
}


import type { PositionedNode, PositionedGroup } from '../types.ts'
import { shapeOutline } from '../shape-outline.ts'
import { nodePaintBounds } from '../scene/bounds.ts'
import { STROKE_WIDTHS } from '../styles.ts'
import { tryParseCssColor } from '../shared/color-math.ts'

/** Construction-level contact for a written circle and an orthogonal shaft.
 * Strip rectangles retain butt caps; right-angle joins retain their complete
 * miter square. A circle's empty bounding-box corners cannot trigger repair.
 * Curved/diagonal/dashed routes and unknown paint stay outside this domain. */
export function circleShaftPaintContext(style: GraphPaintStyle, pay: (units: number) => boolean) {
  type Circle = { cx: number; cy: number; radius: number; innerRadius: number; bounds: AxisAlignedBox }
  const circles = new Map<PositionedNode, Circle | false | undefined>()
  const shafts = new WeakMap<PositionedEdge, WeakMap<readonly Point[], AxisAlignedBox[] | undefined>>()
  const circle = (node: PositionedNode): Circle | false | undefined => {
    if (circles.has(node)) return circles.get(node)
    if (!pay(32)) return undefined
    const width = node.inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)
    if (!pay(width.length + node.id.length + 8)) return undefined
    const piece = shapeOutline(node, { fill: node.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke: node.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: formatSvgNumericAttribute('stroke-width', width) }, style.cornerRadius)
    if (piece.geometry.kind !== 'circle') { circles.set(node, false); return false }
    const geometry = writtenGeometry(piece.geometry)
    if (geometry.kind !== 'circle' || !pay(32)) return undefined
    const bounds = nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', geometry, paint: piece.paint })
    const extent = paintedStrokeExtent(piece.paint, false)
    const filled = piece.paint.fill !== 'none' && piece.paint.fill !== 'transparent' && tryParseCssColor(piece.paint.fill ?? '')?.[3] !== 0
    if (!filled && extent === 0) { circles.set(node, false); return false }
    const radius = geometry.r + (extent ?? 0)
    const result = finiteBox(bounds) && extent !== undefined && geometry.r > 0 && Number.isFinite(radius ** 2)
      ? { cx: geometry.cx, cy: geometry.cy, radius, innerRadius: filled ? 0 : Math.max(0, geometry.r - extent), bounds } : undefined
    circles.set(node, result)
    return result
  }
  const shaft = (edge: PositionedEdge, points: readonly Point[]): AxisAlignedBox[] | undefined => {
    let routes = shafts.get(edge)
    if (!routes) { routes = new WeakMap(); shafts.set(edge, routes) }
    if (routes.has(points)) return routes.get(points)
    if (!pay(8) || points.length < 2 || points.length > MAX_PREFERENCE_NODES * MAX_PREFERENCE_EDGES
      || edge.curve || graphEdgeDashArray(edge) !== undefined || (style.edgeBendRadius ?? 0) !== 0) return undefined
    if (edge.style === 'invisible') return []
    const half = paintedStrokeExtent(edgeShaftPaint(edge, style), false)
    if (half === undefined || !pay(points.length * 8 + 8)) return undefined
    const written = points.map(writtenPoint), boxes: AxisAlignedBox[] = []
    let previous: Point | undefined
    for (let index = 1; index < written.length; index++) {
      const a = written[index - 1]!, b = written[index]!
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return undefined
      const dx = b.x - a.x, dy = b.y - a.y
      if (dx === 0 && dy === 0) continue
      if (dx !== 0 && dy !== 0) return undefined
      if (previous) {
        if (previous.x * dx + previous.y * dy < 0) return undefined
        if (previous.x * dy !== previous.y * dx) boxes.push({ x0: a.x - half, y0: a.y - half, x1: a.x + half, y1: a.y + half })
      }
      boxes.push(dx === 0 ? { x0: a.x - half, y0: Math.min(a.y, b.y), x1: a.x + half, y1: Math.max(a.y, b.y) }
        : { x0: Math.min(a.x, b.x), y0: a.y - half, x1: Math.max(a.x, b.x), y1: a.y + half })
      previous = { x: dx, y: dy }
    }
    if (!half) boxes.length = 0
    routes.set(points, boxes)
    return boxes
  }
  return (edge: PositionedEdge, points: readonly Point[], node: PositionedNode): boolean | undefined => {
    if (!pay(2)) return undefined
    const body = circle(node)
    if (body === false) return false
    const strips = shaft(edge, points)
    if (!body || !strips) return undefined
    for (const strip of strips) {
      if (!pay(4)) return undefined
      if (!boxesMeet(body.bounds, strip)) continue
      const x = Math.max(strip.x0, Math.min(body.cx, strip.x1)), y = Math.max(strip.y0, Math.min(body.cy, strip.y1))
      const near = (x - body.cx) ** 2 + (y - body.cy) ** 2
      const far = Math.max(Math.abs(strip.x0 - body.cx), Math.abs(strip.x1 - body.cx)) ** 2 + Math.max(Math.abs(strip.y0 - body.cy), Math.abs(strip.y1 - body.cy)) ** 2
      if (!Number.isFinite(near) || !Number.isFinite(far)) return undefined
      if (near <= body.radius ** 2 && far >= body.innerRadius ** 2) return true
    }
    return false
  }
}

/** One synchronous label-only proposal owns this snapshot. No route/node/style
 * writes or host measurement callbacks occur before publication. Labels stay
 * live: each query receives the complete staged positions of its transaction. */
export function labelSeatPaintContext(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], groups: readonly PositionedGroup[], style: GraphPaintStyle & { groupLineWidth?: number; groupCornerRadius?: number }, pay: (units: number) => boolean) {
  if (!pay(16)) return undefined
  const bodies: AxisAlignedBox[] = [], headers: AxisAlignedBox[] = []
  const routes = new Map<PositionedEdge, NonNullable<ReturnType<typeof edgeInk>>>()
  const labels = new Map<PositionedEdge, { x: number; y: number; box: AxisAlignedBox }>()
  const geometryWork = (g: Geometry): boolean => {
    if (!pay(32)) return false
    if (g.kind === 'compound') return pay(g.children.length + 1) && g.children.every(geometryWork)
    if (g.kind === 'path') return pay(6 * g.d.length + 16)
    if (g.kind === 'polygon' || g.kind === 'polyline') return pay(g.points.length * (2 * 384 + 4) + 4)
    // The scalar shape vocabulary has at most eight numeric fields. Each
    // finite Number spelling is at most 324 characters; reserve formatting,
    // record slots and the shared bounds owner's fixed scalar visits first.
    return pay(8 * 384 + 32)
  }
  for (const node of nodes) {
    const width = node.inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)
    // Canonical shape construction has a fixed finite vocabulary; its
    // constructed fields/path are charged separately before numeric/bounds work.
    if (!pay(512 + width.length * 6 + node.id.length)) return undefined
    const piece = shapeOutline(node, { fill: node.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke: node.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: formatSvgNumericAttribute('stroke-width', width) }, style.cornerRadius)
    if (!geometryWork(piece.geometry)) return undefined
    const box = nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', geometry: writtenGeometry(piece.geometry), paint: piece.paint, ...(piece.childPaints ? { childPaints: piece.childPaints } : {}) })
    if (!finiteBox(box)) return undefined
    bodies.push(box)
  }
  const visit = (items: readonly PositionedGroup[], depth = 0): boolean => {
    if (depth > 64 || !pay(items.length + 1)) return false
    for (const group of items) {
      const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
      const width = group.inlineStyle?.['stroke-width'] ?? String(style.groupLineWidth ?? STROKE_WIDTHS.innerBox)
      if (!pay(8 * 384 + width.length * 6 + 88) || !Number.isFinite(height) || height < 0 || style.groupCornerRadius !== undefined && !(Number.isFinite(style.groupCornerRadius) && style.groupCornerRadius >= 0)) return false
      if (height > 0) {
        const geometry = writtenGeometry({ kind: 'rect', x: group.x, y: group.y, width: group.width, height })
        const paint: MarkPaint = { fill: 'black', stroke: group.inlineStyle?.stroke ?? 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', width) }
        // A known sharp header has only right-angle joins, whose per-axis
        // reach is half the stroke width. Separately written rounded arcs can
        // lose tangent agreement; retain the generic miter support for those.
        let box: AxisAlignedBox | undefined
        if (style.groupCornerRadius === 0) box = nodePaintBounds({ kind: 'shape', id: group.id, role: 'group-header', geometry, paint })
        else {
          const extent = paintedStrokeExtent(paint, true)
          const fill = nodePaintBounds({ kind: 'shape', id: group.id, role: 'group-header', geometry, paint: { fill: 'black', stroke: 'none' } })
          if (extent === undefined || !finiteBox(fill)) return false
          box = expandSceneBounds(fill, extent)
        }
        if (!finiteBox(box)) return false
        headers.push(box)
      }
      if (!visit(group.children, depth + 1)) return false
    }
    return true
  }
  if (!visit(groups)) return undefined
  for (const edge of edges) {
    if (edge.label && !edge.labelPosition) return undefined
    const width = edge.inlineStyle?.['stroke-width'] ?? ''
    const fields = edge.curve || (style.edgeBendRadius ?? 0) > 0 ? 18 : 4
    const color = edge.inlineStyle?.stroke ?? style.edgeStrokeColor ?? ''
    // Both shaft projection and markerView/factory traverse the route. Reserve
    // their independent numeric writes, contour/model slots and bounded resource
    // construction, including actual source/target/color suffix scans.
    if (!pay(2048 + edge.points.length * (fields * 384 + 32) + width.length * 8 + (edge.label?.length ?? 0) * 12 + (color.length + edge.source.length + edge.target.length + (edge.id?.length ?? 0)) * 8)) return undefined
    const ink = edgeInk(edge, style, () => pay(1))
    if (!ink) return undefined
    routes.set(edge, ink)
  }
  const label = (edge: PositionedEdge, point: Point): AxisAlignedBox | undefined => {
    if (!pay(4)) return undefined
    const prior = labels.get(edge)
    if (prior && prior.x === point.x && prior.y === point.y) return prior.box
    if (!pay(64 + (edge.label?.length ?? 0) * 12)) return undefined
    const rect = labelRect({ ...edge, labelPosition: point }, style)
    if (!rect) return undefined
    const halo = labelHaloExtension(edge, style.lineWidth ?? 1)
    const box = { x0: rect.x - halo, y0: rect.y - halo, x1: rect.x + rect.w + halo, y1: rect.y + rect.h + halo }
    if (!finiteBox(box) || !pay(6)) return undefined
    labels.set(edge, { x: point.x, y: point.y, box })
    return box
  }
  const clear = (edge: PositionedEdge, point: Point, positions: ReadonlyMap<PositionedEdge, Point>, blocked?: Set<PositionedEdge>, ignoredLabel?: PositionedEdge | ReadonlySet<PositionedEdge>): boolean => {
    const box = label(edge, point)
    if (!box) return false
    for (const obstacle of bodies) if (!pay(1) || boxesMeet(box, obstacle)) return false
    for (const obstacle of headers) if (!pay(1) || boxesMeet(box, obstacle)) return false
    let labelsClear = true
    for (const other of edges) {
      if (!pay(1)) return false
      const ink = routes.get(other)!
      for (const marker of ink.markers) if (!pay(1) || !finiteBox(marker.bounds) || boxesMeet(box, marker.bounds)) return false
      if (other === edge) continue
      for (const shaft of ink.shafts) if (!pay(1) || boxesMeet(box, shaft)) return false
      if (ignoredLabel instanceof Set ? ignoredLabel.has(other) : other === ignoredLabel) continue
      const center = positions.get(other) ?? other.labelPosition
      if (!other.label || !center) continue
      const peer = label(other, center)
      if (!peer) return false
      if (boxesMeet(box, peer)) {
        if (blocked && !blocked.has(other)) { if (!pay(1)) return false; blocked.add(other) }
        labelsClear = false
      }
    }
    return labelsClear
  }
  return { clear, label }
}
