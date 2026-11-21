/** Shared sufficient written paint supports. This is optional placement
 * admission, never a paint certificate or a new geometric exception. */
import type { Point, PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import type { Geometry, MarkPaint } from '../scene/ir.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { graphEdgePathProjection } from '../graph-connectors.ts'
import { expandSceneBounds, paintedStrokeExtent, visitTypedPathSegments } from '../scene/bounds.ts'
import { ownsLayoutRouteInputs, routeMarkerPaintRegions } from './route-marker-clearance.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import { labelRect, labelHaloExtension, labelHaloMeetsShaft, labelHaloRect } from '../shared/edge-label-geometry.ts'
import { MAX_PREFERENCE_NODES, MAX_PREFERENCE_EDGES, type LabelMetricsStyle } from './route-geometry.ts'
import { writtenGeometry, writtenPoint, finiteBox, boxesMeet, orthogonalStrokeInk } from '../shared/written-paint.ts'
export { writtenGeometry, finiteBox, boxesMeet } from '../shared/written-paint.ts'
export type GraphPaintStyle = LabelMetricsStyle & { nodeLineWidth?: number; cornerRadius?: number; nodeFillColor?: string; nodeBorderColor?: string }
// Shape arithmetic precedes numeric emission in the renderer. Normalize the
// resulting geometry, not the input node, before asking the shared ink owner.
function shaftPaint(edge: PositionedEdge, style: GraphPaintStyle): MarkPaint {
  return { stroke: edge.inlineStyle?.stroke ?? style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: formatSvgNumericAttribute('stroke-width', edge.inlineStyle?.['stroke-width'] ?? String((style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1))) }
}

/** Occupied paint on a continuous orthogonal shaft. SVG butt caps end at the
 * terminal coordinate; a right-angle miter fills the half-width square at
 * its vertex. Unresolved widths, curved and dashed paths have no such model. */
export function orthogonalShaftInk(edge: PositionedEdge, style: GraphPaintStyle): AxisAlignedBox[] | undefined {
  if (edge.style === 'invisible') return []
  if (edge.curve || style.edgeBendRadius || edge.animate || edge.style === 'dotted') return undefined
  const color = edge.inlineStyle?.stroke ?? style.edgeStrokeColor
  if (color && color !== 'none' && color !== 'transparent' && !tryParseCssColor(color)) return undefined
  return orthogonalStrokeInk(edge.points, shaftPaint(edge, style))
}

const shaftWork = (edge: PositionedEdge, points: readonly Point[]) => 16 + 16 * points.length + 4 * (edge.inlineStyle?.['stroke-width']?.length ?? 0)

/** Within an owned pass the stroke style is fixed. A reroute publishes a
 * replacement points array; its new ink immediately replaces the old view. */
export function labelShafts(edges: readonly PositionedEdge[], style: GraphPaintStyle, pay?: (units: number) => boolean) {
  const retained = ownsLayoutRouteInputs(edges, style) ? new Map<PositionedEdge, { points: Point[]; ink?: AxisAlignedBox[] }>() : undefined
  const measure = (edge: PositionedEdge, points = edge.points): AxisAlignedBox[] | undefined => {
    const prior = retained?.get(edge)
    if (prior?.points === points) return prior.ink
    if (pay && !pay(shaftWork(edge, points))) return undefined
    const ink = orthogonalShaftInk(points === edge.points ? edge : { ...edge, points }, style)
    retained?.set(edge, { points, ink })
    return ink
  }
  return Object.assign(measure, { retain: (edge: PositionedEdge, points: Point[], ink: AxisAlignedBox[]): void => { retained?.set(edge, { points, ink }) } })
}
/** Optional movement needs a sufficient separator, not another collision
 * certifier. Unknown paint/geometry or overlapping conservative supports keep
 * the original layout; every segment and endpoint resource is retained. */
export function edgeInk(edge: PositionedEdge, style: GraphPaintStyle, work: () => boolean, writtenShafts?: AxisAlignedBox[]): { shafts: AxisAlignedBox[]; markers: NonNullable<ReturnType<typeof routeMarkerPaintRegions>>; label?: AxisAlignedBox } | undefined {
  if (edge.style === 'invisible') return { shafts: [], markers: [] }
  if (edge.points.length > MAX_PREFERENCE_NODES * MAX_PREFERENCE_EDGES) return undefined
  if (style.edgeBendRadius !== undefined && !(Number.isFinite(style.edgeBendRadius) && style.edgeBendRadius >= 0)) return undefined
  // renderEdge forwards these two authored fields; connector paint defaults
  // are butt caps and miter joins (limit four), owned by paintedStrokeExtent.
  const paint = shaftPaint(edge, style)
  const extent = paintedStrokeExtent(paint, edge.points.length > 2 || !!edge.curve || (style.edgeBendRadius ?? 0) > 0)
  if (extent === undefined || edge.points.length < 2) return undefined
  if ((edge.hasArrowStart || edge.hasArrowEnd) && paintedStrokeExtent({ ...paint, stroke: 'black' }, false) === undefined) return undefined
  const supports = writtenShafts ?? []
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
  } else if (!writtenShafts) {
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


import { shapeOutline } from '../shape-outline.ts'
import { nodePaintBounds } from '../scene/bounds.ts'
import { STROKE_WIDTHS } from '../styles.ts'

/** Unowned callers can run code from a property read or write. Optional
 * paint-based moves require plain data throughout the geometry and style. */
export function labelPaintInputsStable(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], groups: readonly PositionedGroup[], style: GraphPaintStyle, pay?: (units: number) => boolean): boolean {
  if (ownsLayoutRouteInputs(edges, style)) return true
  const pending: unknown[] = [nodes, edges, groups, style], seen = new Set<object>()
  while (pending.length) {
    if (pay && !pay(1)) return false
    const value = pending.pop()
    if (typeof value === 'function') return false
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) return false
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (pay && !pay(1)) return false
      const field = Object.getOwnPropertyDescriptor(value, key)
      if (!field || !('value' in field)) return false
      pending.push(field.value)
    }
  }
  return true
}

type RouteInk = NonNullable<ReturnType<typeof edgeInk>>
type PreparedRoute = { points: Point[]; values: unknown[]; ink: RouteInk; coldWork: number }
/** Data carried only between the two adjacent, frozen graph passes. Each new
 * admission retains its own work ledger and label/shaft memoization. */
interface PreparedPaintSupports {
  readonly nodes: readonly PositionedNode[]
  readonly edges: readonly PositionedEdge[]
  readonly groups: readonly PositionedGroup[]
  readonly style: GraphPaintStyle
  readonly styleValues: unknown[]
  readonly nodeValues: unknown[][]
  readonly bodies: AxisAlignedBox[]
  readonly bodyWork: number[]
  readonly routes: ReadonlyMap<PositionedEdge, PreparedRoute>
}
/** Consuming the handoff releases its data even while an outer closing frame
 * still holds the handle. It never carries the previous admission's callbacks. */
export class LabelSeatPaintSupports {
  #value: PreparedPaintSupports | undefined
  constructor(value: PreparedPaintSupports) { this.#value = value }
  take(): PreparedPaintSupports | undefined {
    const value = this.#value
    this.#value = undefined
    return value
  }
}
const bodyPaintFields = ['id', 'x', 'y', 'width', 'height', 'shape', 'semanticShape', 'borders'] as const
const bodyInputs = (node: PositionedNode): unknown[] => [node, ...bodyPaintFields.map(field => node[field]), node.inlineStyle?.fill, node.inlineStyle?.stroke, node.inlineStyle?.['stroke-width']]
const sameBodyInputs = (values: readonly unknown[], node: PositionedNode): boolean => {
  if (values[0] !== node) return false
  let index = 1
  for (const field of bodyPaintFields) if (!Object.is(values[index++], node[field])) return false
  return Object.is(values[index++], node.inlineStyle?.fill) && Object.is(values[index++], node.inlineStyle?.stroke) && Object.is(values[index], node.inlineStyle?.['stroke-width'])
}
const paintStyleInputs = (style: GraphPaintStyle): unknown[] => [style.lineWidth, style.nodeLineWidth, style.cornerRadius, style.nodeFillColor, style.nodeBorderColor, style.edgeBendRadius, style.edgeStrokeColor, style.edgeLabelFontSize, style.edgeLabelFontWeight, style.edgeTextTransform, style.edgeLetterSpacing]
const routePaintFields = ['source', 'target', 'id', 'style', 'curve', 'animate', 'hasArrowStart', 'hasArrowEnd', 'startMarker', 'endMarker', 'label', 'labelContent', 'labelBlock'] as const
const routeInputs = (edge: PositionedEdge, points: readonly Point[]): unknown[] => {
  const values: unknown[] = routePaintFields.map(field => edge[field])
  values.push(edge.inlineStyle?.stroke, edge.inlineStyle?.['stroke-width'], edge.labelBlock?.width, edge.labelBlock?.height, edge.labelPosition?.x, edge.labelPosition?.y)
  for (const point of points) values.push(point.x, point.y)
  return values
}
const sameRouteInputs = (values: readonly unknown[], edge: PositionedEdge, points: readonly Point[]): boolean => {
  let index = 0
  for (const field of routePaintFields) if (!Object.is(values[index++], edge[field])) return false
  if (!Object.is(values[index++], edge.inlineStyle?.stroke) || !Object.is(values[index++], edge.inlineStyle?.['stroke-width'])
    || !Object.is(values[index++], edge.labelBlock?.width) || !Object.is(values[index++], edge.labelBlock?.height)
    || !Object.is(values[index++], edge.labelPosition?.x) || !Object.is(values[index++], edge.labelPosition?.y)) return false
  for (const point of points) if (!Object.is(values[index++], point.x) || !Object.is(values[index++], point.y)) return false
  return index === values.length
}
const sameInputs = (before: readonly unknown[], after: readonly unknown[]): boolean => before.length === after.length && before.every((value, index) => Object.is(value, after[index]))
const routePaintWork = (edge: PositionedEdge, points: readonly Point[], style: GraphPaintStyle): number => {
  const width = edge.inlineStyle?.['stroke-width'] ?? ''
  const fields = edge.curve || (style.edgeBendRadius ?? 0) > 0 ? 18 : 4
  const color = edge.inlineStyle?.stroke ?? style.edgeStrokeColor ?? ''
  return 2048 + points.length * (fields * 384 + 32) + width.length * 8 + (edge.label?.length ?? 0) * 12 + (color.length + edge.source.length + edge.target.length + (edge.id?.length ?? 0)) * 8
}

/** A settled graph proposal owns this snapshot. Labels stay live; the route
 * owner refreshes its changed shaft and markers before publishing a channel. */
export function labelSeatPaintContext(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], groups: readonly PositionedGroup[], style: GraphPaintStyle & { groupLineWidth?: number; groupCornerRadius?: number }, pay: (units: number) => boolean, measuredShafts?: ReturnType<typeof labelShafts>, handoff?: 'prepare' | LabelSeatPaintSupports) {
  if (!pay(16) || !labelPaintInputsStable(nodes, edges, groups, style, pay)) return undefined
  const retain = handoff !== undefined && ownsLayoutRouteInputs(edges, style) && !groups.length && nodes.length <= MAX_PREFERENCE_NODES && edges.length <= MAX_PREFERENCE_EDGES
  const previous = retain && handoff instanceof LabelSeatPaintSupports ? handoff.take() : undefined
  const styleValues = retain ? paintStyleInputs(style) : []
  let prior = previous?.nodes === nodes && previous.edges === edges && previous.groups === groups && previous.style === style && sameInputs(previous.styleValues, styleValues) ? previous : undefined
  const bodies: AxisAlignedBox[] = [], headers: AxisAlignedBox[] = []
  const nodeValues: unknown[][] = [], bodyWork: number[] = []
  const capture = retain && handoff === 'prepare'
  const prepared = capture ? new Map<PositionedEdge, PreparedRoute>() : undefined
  const routes = new Map<PositionedEdge, NonNullable<ReturnType<typeof edgeInk>>>()
  const orthogonal = new Set<PositionedEdge>()
  const labels = new Map<PositionedEdge, { x: number; y: number; box: AxisAlignedBox }>()
  let geometryUnits = 0
  const geometryPay = capture ? (units: number): boolean => { geometryUnits += units; return pay(units) } : pay
  const geometryWork = (g: Geometry): boolean => {
    if (!geometryPay(32)) return false
    if (g.kind === 'compound') return geometryPay(g.children.length + 1) && g.children.every(geometryWork)
    if (g.kind === 'path') return geometryPay(6 * g.d.length + 16)
    if (g.kind === 'polygon' || g.kind === 'polyline') return geometryPay(g.points.length * (2 * 384 + 4) + 4)
    // The scalar shape vocabulary has at most eight numeric fields. Each
    // finite Number spelling is at most 324 characters; reserve formatting,
    // record slots and the shared bounds owner's fixed scalar visits first.
    return geometryPay(8 * 384 + 32)
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    const width = node.inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)
    if (!pay(512 + width.length * 6 + node.id.length)) return undefined
    if (prior?.nodeValues[index] && sameBodyInputs(prior.nodeValues[index]!, node)) {
      if (!pay(prior.bodyWork[index]!)) return undefined
      bodies.push(prior.bodies[index]!)
      continue
    }
    const piece = shapeOutline(node, { fill: node.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke: node.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: formatSvgNumericAttribute('stroke-width', width) }, style.cornerRadius)
    geometryUnits = 0
    if (!geometryWork(piece.geometry)) return undefined
    const box = nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', geometry: writtenGeometry(piece.geometry), paint: piece.paint, ...(piece.childPaints ? { childPaints: piece.childPaints } : {}) })
    if (!finiteBox(box)) return undefined
    bodies.push(box)
    if (capture) { nodeValues.push(bodyInputs(node)); bodyWork.push(geometryUnits) }
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
  let initializing = true
  const refreshRoute = (owner: PositionedEdge, points = owner.points): boolean => {
    const edge = points === owner.points ? owner : { ...owner, points }
    if (edge.label && !edge.labelPosition) return false
    // Charge the same cold projection allowance even when its already-proved
    // supports survive this phase boundary. Changed routes are rebuilt below.
    const reservation = routePaintWork(edge, points, style)
    if (!pay(reservation)) return false
    const saved = initializing ? prior?.routes.get(owner) : undefined
    if (saved?.points === points && measuredShafts && sameRouteInputs(saved.values, edge, points)) {
      if (!pay(saved.coldWork - reservation)) return false
      measuredShafts.retain(owner, points, saved.ink.shafts)
      orthogonal.add(owner)
      routes.set(owner, saved.ink)
      return true
    }
    const shafts = measuredShafts?.(owner, points)
    const ink = edgeInk(edge, style, () => pay(1), shafts)
    if (!ink) return false
    if (shafts) orthogonal.add(owner)
    else orthogonal.delete(owner)
    routes.set(owner, ink)
    // Orthogonal supports bypass path traversal. edgeInk then charges one work
    // visit per endpoint marker; the shaft's full cold charge is independent
    // of whether the preceding label search had already measured it.
    if (initializing && prepared && shafts) prepared.set(owner, { points, values: routeInputs(edge, points), ink, coldWork: reservation + shaftWork(edge, points) + ink.markers.length })
    return true
  }
  for (const edge of edges) if (!refreshRoute(edge)) return undefined
  initializing = false
  prior = undefined
  const label = (edge: PositionedEdge, point: Point): AxisAlignedBox | undefined => {
    if (!pay(4)) return undefined
    const prior = labels.get(edge)
    if (prior && prior.x === point.x && prior.y === point.y) return prior.box
    if (!pay(64 + (edge.label?.length ?? 0) * 12)) return undefined
    const rect = labelRect({ ...edge, labelPosition: point }, style)
    if (!rect) return undefined
    const halo = labelHaloRect(rect, labelHaloExtension(edge, style.lineWidth ?? 1))
    const box = { x0: halo.x, y0: halo.y, x1: halo.x + halo.w, y1: halo.y + halo.h }
    if (!finiteBox(box) || !pay(6)) return undefined
    labels.set(edge, { x: point.x, y: point.y, box })
    return box
  }
  const protectedHalos = (owner: PositionedEdge, blocker: PositionedEdge): { x: number; y: number; w: number; h: number }[] | undefined => {
    if (!orthogonal.has(blocker)) return undefined
    const shafts = routes.get(blocker)!.shafts, result = []
    for (const peer of edges) {
      if (!pay(1)) return undefined
      if (!peer.label) continue
      const box = label(peer, peer.labelPosition!)
      if (!box) return undefined
      const halo = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }
      if (peer === owner || !shafts.some(shaft => labelHaloMeetsShaft(halo, shaft))) result.push(halo)
    }
    return result
  }
  const hitsMarker = (box: AxisAlignedBox, ink: NonNullable<ReturnType<typeof edgeInk>>): boolean =>
    ink.markers.some(marker => !pay(1) || !finiteBox(marker.bounds) || boxesMeet(box, marker.bounds))
  const markerContact = (rect: { x: number; y: number; w: number; h: number }): boolean => {
    const box = { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h }
    for (const ink of routes.values()) if (!pay(1) || hitsMarker(box, ink)) return true
    return false
  }
  const clear = (edge: PositionedEdge, point: Point, positions: ReadonlyMap<PositionedEdge, Point>, blocked?: Set<PositionedEdge>, ignoredLabel?: PositionedEdge | ReadonlySet<PositionedEdge>): boolean => {
    const box = label(edge, point)
    if (!box) return false
    const halo = { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }
    for (const obstacle of bodies) if (!pay(1) || boxesMeet(box, obstacle)) return false
    for (const obstacle of headers) if (!pay(1) || boxesMeet(box, obstacle)) return false
    let labelsClear = true
    for (const other of edges) {
      if (!pay(1)) return false
      const ink = routes.get(other)!
      if (hitsMarker(box, ink)) return false
      if (other === edge) continue
      for (const shaft of ink.shafts) if (!pay(1) || (orthogonal.has(other) ? labelHaloMeetsShaft(halo, shaft) : boxesMeet(box, shaft))) return false
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
  // A staged solid orthogonal route has one shaft per segment, interleaved
  // with its written right-angle miter supports. Only its own contact segment
  // may touch an endpoint body; stationary foreign captions and glyphs remain
  // obstacles even when the endpoint resources themselves did not move.
  const clearRoute = (edge: PositionedEdge, points: readonly Point[]): boolean => {
    const ink = routes.get(edge)
    if (!ink || !orthogonal.has(edge) || ink.shafts.length !== 2 * points.length - 3) return false
    for (let index = 0; index < ink.shafts.length; index++) {
      const shaft = ink.shafts[index]!
      for (const marker of ink.markers) {
        if (marker.position === 'start' && index === 0 || marker.position === 'end' && index === ink.shafts.length - 1) continue
        if (!pay(1) || !finiteBox(marker.bounds) || boxesMeet(shaft, marker.bounds)) return false
      }
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        const node = nodes[nodeIndex]!
        if (node.id === edge.source && index === 0 || node.id === edge.target && index === ink.shafts.length - 1) continue
        if (!pay(1) || boxesMeet(shaft, bodies[nodeIndex]!)) return false
      }
      for (const header of headers) if (!pay(1) || boxesMeet(shaft, header)) return false
      for (const peer of edges) {
        if (peer === edge) continue
        const other = routes.get(peer)!
        if (!pay(1) || hitsMarker(shaft, other)) return false
        // Aesthetic contraction requires complete separation. This also
        // protects thick parallel shafts, whose paint can overlap while
        // their distinct centerlines have no proper crossing.
        for (const support of other.shafts) if (!pay(1) || boxesMeet(shaft, support)) return false
        if (peer.label) {
          const box = label(peer, peer.labelPosition!)
          if (!box || !pay(1) || labelHaloMeetsShaft({ x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }, shaft)) return false
        }
      }
    }
    return true
  }
  const supports = prepared ? new LabelSeatPaintSupports({ nodes, edges, groups, style, styleValues, nodeValues, bodies, bodyWork, routes: prepared }) : undefined
  return { clear, clearRoute, label, refreshRoute, markerContact, protectedHalos, supports }
}
