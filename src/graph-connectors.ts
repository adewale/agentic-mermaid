import type { EdgeMarker, Point, PositionedEdge } from './types.ts'
import { ARROW_HEAD, FLOWCHART_DOTTED_DASH } from './styles.ts'
import type { MarkerDescriptor } from './scene/ir.ts'
import { prepareMarkerTerminals } from './scene/marker-terminals.ts'
import { tipAnchoredArrow } from './scene/marker-resources.ts'
import { connectorContourSemantics, projectRoundedConnectorPath, type ConnectorPathProjection } from './scene/connector-geometry.ts'
import { projectGraphCurve } from './graph-curve.ts'
import { connectorMarkerPaintRegions, geometryBounds, paintedStrokeExtent, type ConnectorMarkerPaintRegion } from './scene/bounds.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from './shared/svg-number.ts'
import { canonicalTextDigest } from './render-contract.ts'
import { SCENE_VALIDATION_LIMITS } from './scene/scene-validation-limits.ts'

type GraphEdgeDashInput = Pick<PositionedEdge, 'style' | 'animate'> & Partial<Pick<PositionedEdge, 'curve' | 'inlineStyle' | 'points' | 'hasArrowStart' | 'hasArrowEnd' | 'startMarker' | 'endMarker'>>
interface GraphEdgeCarrierPaint {
  dashArray: string | undefined
  polyline: { kind: 'polyline'; points: Point[] } | undefined
}
const defineCarrierPoint = Object.defineProperty

/** Preserve authored dash intent. A served one-leg solid carrier can leave a gap
 * beneath a fixed hollow circle without moving its marker attachment. */
export function graphEdgeDashArray(edge: GraphEdgeDashInput, candidatePoints?: readonly Point[], pathProjection?: ConnectorPathProjection): string | undefined {
  return graphEdgeDashArrayImpl(edge, candidatePoints, pathProjection)
}

/** Capture a newly eligible raw carrier once for both its dash and lowering.
 * Standalone dash queries retain their existing raw-point contract. */
export function graphEdgeCarrierPaint(edge: GraphEdgeDashInput, pathProjection?: ConnectorPathProjection): GraphEdgeCarrierPaint {
  const carrier: GraphEdgeCarrierPaint = { dashArray: undefined, polyline: undefined }
  carrier.dashArray = graphEdgeDashArrayImpl(edge, undefined, pathProjection, carrier)
  return carrier
}

function graphEdgeDashArrayImpl(edge: GraphEdgeDashInput, candidatePoints?: readonly Point[], pathProjection?: ConnectorPathProjection, carrier?: GraphEdgeCarrierPaint): string | undefined {
  const lineStyle = edge.style
  if (lineStyle === 'dotted') return `${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}`
  if (edge.animate) return '8 4'
  if (lineStyle !== 'solid') return undefined
  const inline = edge.inlineStyle
  if (!inline || 'stroke-dasharray' in inline || 'stroke-dashoffset' in inline) return undefined
  const rawWidth = inline['stroke-width']
  if (typeof rawWidth !== 'string') return undefined
  const startCircle = edge.hasArrowStart && edge.startMarker === 'circle'
  const endCircle = edge.hasArrowEnd && edge.endMarker === 'circle'
  if (!startCircle && !endCircle || pathProjection === undefined && edge.curve) return undefined
  const projectedGeometry = pathProjection?.geometry
  const points = pathProjection === undefined ? candidatePoints ?? edge.points : projectedGeometry?.points
  if (!points || points.length !== 2) {
    if (points && pathProjection !== undefined && projectedGeometry) {
      return projectedCircleDashArray(projectedGeometry, pathProjection.contours, points, rawWidth, startCircle, endCircle)
    }
    if (!carrier || !points || pathProjection !== undefined) return undefined
    const count = points.length
    if (!Number.isSafeInteger(count) || count <= 2 || count > SCENE_VALIDATION_LIMITS.maxPoints) return undefined
    const halfWidth = paintedStrokeExtent({ stroke: 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', rawWidth) }, false)
    if (halfWidth === undefined || !fixedCircleStart || !fixedCircleEnd || halfWidth * 2 < fixedCircleEnd.diameter) return undefined
    // Finish the bounded scalar capture before deciding whether this shape can
    // use a gap. Even a declined shape lowers these same examined coordinates.
    const captured: Point[] = []
    for (let index = 0; index < count; index++) {
      const point = points[index]!, x = point.x, y = point.y
      const descriptor = { __proto__: null, value: { x, y }, enumerable: true, writable: true, configurable: true }
      defineCarrierPoint(captured, index, descriptor)
    }
    const polyline = { kind: 'polyline' as const, points: captured }
    carrier.polyline = polyline
    return projectedCircleDashArray(polyline, undefined, captured, rawWidth, startCircle, endCircle, halfWidth)
  }
  // Match the carrier's numeric/px spelling before measuring its width. This
  // uses the existing stroke parser; relative or unresolved widths stay out.
  const halfWidth = paintedStrokeExtent({ stroke: 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', rawWidth) }, false)
  if (halfWidth === undefined || !fixedCircleStart || !fixedCircleEnd || halfWidth * 2 < fixedCircleEnd.diameter) return undefined
  const ax = points[0]!.x, ay = points[0]!.y, bx = points[1]!.x, by = points[1]!.y
  if (![ax, ay, bx, by].every(Number.isFinite)) return undefined
  if (pathProjection !== undefined) {
    // Reuse the captured path that lowering will write. Any curve factory may
    // realize one line; metadata alone cannot establish that physical shape.
    if (!projectedGeometry || projectedGeometry.kind !== 'path' || projectedGeometry.subpaths !== undefined) return undefined
    const d = projectedGeometry.d
    if (d !== `M ${ax} ${ay} L ${bx} ${by}` && d !== `M${ax},${ay} L${bx},${by}`) return undefined
    const contours = pathProjection.contours
    if (contours.length !== 1) return undefined
    const contour = contours[0]!
    if (contour.closed !== false || contour.start.x !== ax || contour.start.y !== ay || contour.end.x !== bx || contour.end.y !== by) return undefined
  }
  const length = Math.hypot(Number(formatSvgNumber(bx)) - Number(formatSvgNumber(ax)), Number(formatSvgNumber(by)) - Number(formatSvgNumber(ay)))
  const startGap = startCircle ? fixedCircleStart.start : 0, endGap = endCircle ? fixedCircleEnd.end : 0
  const visible = length - startGap - endGap
  if (!Number.isFinite(length) || !Number.isFinite(visible) || visible <= 0) return undefined
  // Keep the original marker attachment sites on this same carrier. One long
  // off interval prevents a new dash from starting at the terminal vertex.
  return formatSvgNumericAttribute('stroke-dasharray', startGap ? `0 ${startGap} ${visible} ${length}` : `${visible} ${length}`)
}

/** Only captured open orthogonal polylines and M/L paths extend the gap beyond
 * one leg. A terminal runway also reserves the adjacent wide corner's half-width
 * reach; the existing two-point carrier policy stays separate. */
function projectedCircleDashArray(geometry: ConnectorPathProjection['geometry'] | NonNullable<GraphEdgeCarrierPaint['polyline']>, contours: ConnectorPathProjection['contours'] | undefined, points: readonly Point[], rawWidth: string, startCircle: boolean | undefined, endCircle: boolean | undefined, capturedHalfWidth?: number): string | undefined {
  const count = points.length
  if (!Number.isSafeInteger(count) || count <= 2 || count > SCENE_VALIDATION_LIMITS.maxPoints) return undefined
  // Only the private raw-carrier call supplies a captured width. Public path
  // projections must still establish their path kind with one observation.
  const pathGeometry = capturedHalfWidth === undefined && geometry.kind === 'path' ? geometry : undefined
  if (capturedHalfWidth === undefined && !pathGeometry
    || pathGeometry && (pathGeometry.subpaths !== undefined || !contours || contours.length !== 1)) return undefined
  const d = pathGeometry ? pathGeometry.d : '', contour = pathGeometry ? contours![0]! : undefined
  if (pathGeometry && (typeof d !== 'string' || d.length > SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode || !contour || contour.closed !== false)) return undefined
  const halfWidth = capturedHalfWidth ?? paintedStrokeExtent({ stroke: 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', rawWidth) }, false)
  if (halfWidth === undefined || !fixedCircleStart || !fixedCircleEnd || halfWidth * 2 < fixedCircleEnd.diameter) return undefined
  const startGap = startCircle ? fixedCircleStart.start : 0, endGap = endCircle ? fixedCircleEnd.end : 0
  let cursor = 0, compact = false
  const consume = (expected: string): boolean => {
    if (cursor + expected.length > d.length) return false
    for (let index = 0; index < expected.length; index++) if (d[cursor + index] !== expected[index]) return false
    cursor += expected.length
    return true
  }
  let firstX = 0, firstY = 0, lastX = 0, lastY = 0, previousX = 0, previousY = 0
  let previousDx = 0, previousDy = 0, length = 0, startRun = 0, endRun = 0
  let hasDirection = false, startOpen = true
  for (let index = 0; index < count; index++) {
    const point = points[index]!, x = point.x, y = point.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    if (pathGeometry) {
      const rawX = `${x}`, rawY = `${y}`
      if (index === 0) {
        if (!consume(`M ${rawX} ${rawY}`)) {
          if (!consume(`M${rawX},${rawY}`)) return undefined
          compact = true
        }
        firstX = x; firstY = y
      } else if (!consume(compact ? ` L${rawX},${rawY}` : ` L ${rawX} ${rawY}`)) return undefined
      lastX = x; lastY = y
    }
    const servedX = Number(formatSvgNumber(x)), servedY = Number(formatSvgNumber(y))
    if (!Number.isFinite(servedX) || !Number.isFinite(servedY)) return undefined
    if (index > 0) {
      const dx = servedX - previousX, dy = servedY - previousY, segment = Math.hypot(dx, dy)
      if (!Number.isFinite(segment)) return undefined
      length += segment
      if (segment > 0) {
        if (dx !== 0 && dy !== 0) return undefined
        if (!hasDirection) {
          hasDirection = true; startRun = segment; endRun = segment
        } else {
          const crossLeft = previousDx * dy, crossRight = previousDy * dx, along = previousDx * dx + previousDy * dy
          if (!Number.isFinite(crossLeft) || !Number.isFinite(crossRight) || !Number.isFinite(along)) return undefined
          const collinear = crossLeft === crossRight
          if (collinear && along <= 0) return undefined
          if (collinear) {
            if (startOpen) startRun += segment
            endRun += segment
          } else {
            startOpen = false; endRun = segment
          }
        }
        previousDx = dx; previousDy = dy
      }
    }
    previousX = servedX; previousY = servedY
  }
  if (pathGeometry && (cursor !== d.length || !contour || contour.start.x !== firstX || contour.start.y !== firstY || contour.end.x !== lastX || contour.end.y !== lastY)) return undefined
  const visible = length - startGap - endGap
  if (!Number.isFinite(length) || !Number.isFinite(visible) || visible <= 0
    || startCircle && startRun < startGap + halfWidth || endCircle && endRun < endGap + halfWidth) return undefined
  return formatSvgNumericAttribute('stroke-dasharray', startGap ? `0 ${startGap} ${visible} ${length}` : `${visible} ${length}`)
}

/**
 * Reusable arrow head markers — both forward (end) and pre-rotated start variants.
 * Start geometry points left in marker space and uses orient="auto". This avoids
 * renderer-dependent auto-start-reverse behavior in SVG rasterizers.
 * Arrow color uses var(--_arrow) CSS variable.
 */
function arrowMarkerResources(color?: string, fixed = false): readonly MarkerDescriptor[] {
  const w = ARROW_HEAD.width
  // A custom-width edge gets a fixed 8×8 head: the default SVG strokeWidth
  // units would magnify the marker by the authored edge width.
  const h = fixed ? w : ARROW_HEAD.height
  // SVG places this reference point at the route vertex. Anchor the polygon
  // tip itself so a correctly clipped route cannot push the visible arrow
  // through the target outline.
  const stroke = color ?? 'var(--_arrow)'
  const suffix = `${color ? `-${markerSuffix(color)}` : ''}${fixed ? '-fixed' : ''}`
  const paint = { fill: stroke, stroke, strokeWidth: String(ARROW_HEAD.strokeWidth), strokeLinejoin: 'round' as const }
  return [
    tipAnchoredArrow(`arrowhead${suffix}`, { width: w, height: h }, 'end', paint, fixed ? 'userSpaceOnUse' : undefined),
    tipAnchoredArrow(`arrowhead-start${suffix}`, { width: w, height: h }, 'start', paint, fixed ? 'userSpaceOnUse' : undefined),
  ]
}

/**
 * Generate arrow markers tinted to a specific color (for linkStyle stroke overrides).
 * IDs are suffixed with a sanitized color string to avoid collisions.
 */
function circleMarkerResources(color?: string, fixed = false): readonly MarkerDescriptor[] {
  const size = ARROW_HEAD.width
  const suffix = `${color ? `-${markerSuffix(color)}` : ''}${fixed ? '-fixed' : ''}`
  const stroke = color ?? 'var(--_arrow)'
  const r = size / 2 - 0.75
  const common = { shape: 'circle' as const, size: { width: size, height: size }, ...(fixed ? { units: 'userSpaceOnUse' as const } : {}), orient: 'auto' as const, geometry: { kind: 'circle' as const, cx: size / 2, cy: size / 2, r }, paint: { fill: 'none', stroke, strokeWidth: '1' } }
  return [
    { ...common, id: `circlehead${suffix}`, ref: { x: size - 0.5, y: size / 2 } },
    { ...common, id: `circlehead-start${suffix}`, ref: { x: 0.5, y: size / 2 } },
  ]
}

function crossMarkerResources(color?: string, fixed = false): readonly MarkerDescriptor[] {
  const size = ARROW_HEAD.width
  const suffix = `${color ? `-${markerSuffix(color)}` : ''}${fixed ? '-fixed' : ''}`
  const stroke = color ?? 'var(--_arrow)'
  const pad = 1.25
  const strokeWidth = 1.25
  const a = pad
  const b = size - pad
  const common = { shape: 'cross' as const, size: { width: size, height: size }, ...(fixed ? { units: 'userSpaceOnUse' as const } : {}), orient: 'auto' as const, geometry: { kind: 'compound' as const, children: [{ kind: 'line' as const, x1: a, y1: a, x2: b, y2: b }, { kind: 'line' as const, x1: a, y1: b, x2: b, y2: a }] }, paint: { stroke, strokeWidth: String(strokeWidth), strokeLinecap: 'round' as const } }
  // Attach the complete round-cap envelope, rather than its line centre.
  // Marker units scale the cap and reference together for every edge width.
  return [
    { ...common, id: `crosshead${suffix}`, ref: { x: b + strokeWidth / 2, y: size / 2 } },
    { ...common, id: `crosshead-start${suffix}`, ref: { x: a - strokeWidth / 2, y: size / 2 } },
  ]
}

export function flowchartMarkerResources(
  colors: ReadonlySet<string>,
  fixedColors: ReadonlySet<string | undefined>,
  needsCircle: boolean,
  needsCross: boolean,
): readonly MarkerDescriptor[] {
  const resources: MarkerDescriptor[] = [...arrowMarkerResources()]
  if (needsCircle) resources.push(...circleMarkerResources())
  if (needsCross) resources.push(...crossMarkerResources())
  for (const color of colors) {
    resources.push(...arrowMarkerResources(color))
    if (needsCircle) resources.push(...circleMarkerResources(color))
    if (needsCross) resources.push(...crossMarkerResources(color))
  }
  for (const color of fixedColors) {
    resources.push(...arrowMarkerResources(color, true))
    if (needsCircle) resources.push(...circleMarkerResources(color, true))
    if (needsCross) resources.push(...crossMarkerResources(color, true))
  }
  return resources
}

export function markerIdPrefix(marker: EdgeMarker): string {
  if (marker === 'circle') return 'circlehead'
  if (marker === 'cross') return 'crosshead'
  return 'arrowhead'
}

/** Keep established hex/named-color IDs. Other paints use separate literal
 * and digest namespaces. Long values retain the existing 256-character Scene
 * resource bound; marker serialization rejects any digest collision. */
export function markerSuffix(color: string): string {
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return `23${color.slice(1)}`
  if (/^[a-z]+$/i.test(color)) return color
  const literal = `color-u-${Array.from(color, char => char.codePointAt(0)!.toString(16)).join('-')}`
  // Reserve 23 characters for the longest resource wrapper:
  // circlehead-start-<suffix>-fixed.
  return literal.length <= 233 ? literal : `color-h-${canonicalTextDigest(color).slice('fnv1a64:'.length)}`
}

const terminalResources = flowchartMarkerResources(new Set(), new Set([undefined]), true, true)
const markerTerminal = prepareMarkerTerminals(terminalResources)
// Absorption depends on the smooth circle's actual stroke, rather than the
// conservative miter envelope retained by general marker certification.
function fixedCirclePaintSupport(marker: MarkerDescriptor | undefined) {
  if (!marker || marker.geometry?.kind !== 'circle' || marker.units !== 'userSpaceOnUse' || !marker.ref
    || marker.viewBox || marker.scale !== undefined && marker.scale !== 1) return undefined
  const bounds = geometryBounds(marker.geometry), extent = paintedStrokeExtent(marker.paint ?? {}, false)
  if (!bounds || extent === undefined || ![bounds.x0, bounds.x1, extent, marker.ref.x].every(Number.isFinite)) return undefined
  return { start: Math.max(0, bounds.x1 + extent - marker.ref.x), end: Math.max(0, marker.ref.x - bounds.x0 + extent), diameter: bounds.x1 - bounds.x0 + 2 * extent }
}
const fixedCircleEnd = fixedCirclePaintSupport(terminalResources.find(marker => marker.id === 'circlehead-fixed'))
const fixedCircleStart = fixedCirclePaintSupport(terminalResources.find(marker => marker.id === 'circlehead-start-fixed'))

export function graphEdgeTerminalClearance(edge: Pick<PositionedEdge, 'style' | 'inlineStyle' | 'hasArrowStart' | 'hasArrowEnd' | 'startMarker' | 'endMarker'>, style: { lineWidth?: number }) {
  const fixed = edge.inlineStyle?.['stroke-width'] ? '-fixed' : ''
  const width = (style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)
  return {
    start: edge.hasArrowStart ? markerTerminal(`${markerIdPrefix(edge.startMarker ?? 'arrow')}-start${fixed}`, width, 'start') : 0,
    end: edge.hasArrowEnd ? markerTerminal(`${markerIdPrefix(edge.endMarker ?? 'arrow')}${fixed}`, width, 'end') : 0,
  }
}

/** The same typed path drives marker tangents during placement and lowering. */
export function graphEdgePathProjection(edge: PositionedEdge, style: { edgeBendRadius?: number; lineWidth?: number }): ConnectorPathProjection | undefined {
  const curve = edge.curve
  return curve ? projectGraphCurve(edge.points, curve)
    : (style.edgeBendRadius ?? 0) > 0 ? projectRoundedConnectorPath(edge.points, style.edgeBendRadius!, { terminalClearance: graphEdgeTerminalClearance(edge, style) }) : undefined
}

/** Reserve painted endpoint resources before opaque labels are moved. These
 * are the renderer's marker factories, including fixed custom-width heads. */
export function graphEdgeMarkerPaintRegions(edge: PositionedEdge, style: { lineWidth?: number; edgeStrokeColor?: string; edgeBendRadius?: number }, includeHull = true): ConnectorMarkerPaintRegion[] {
  if (edge.style === 'invisible' || edge.points.length < 2 || !edge.hasArrowStart && !edge.hasArrowEnd) return []
  const color = edge.inlineStyle?.stroke ?? style.edgeStrokeColor
  const fixed = !!edge.inlineStyle?.['stroke-width']
  // A query needs only its two endpoint resources, not every default, tinted
  // and fixed-width variant that the definitions writer must publish.
  const pair = (kind: EdgeMarker | undefined) => kind === 'circle' ? circleMarkerResources(fixed ? color : color || undefined, fixed)
    : kind === 'cross' ? crossMarkerResources(fixed ? color : color || undefined, fixed)
      : arrowMarkerResources(fixed ? color : color || undefined, fixed)
  const startPair = edge.hasArrowStart ? pair(edge.startMarker) : undefined
  const start = startPair?.[1]
  const end = edge.hasArrowEnd ? (startPair && (edge.startMarker ?? 'arrow') === (edge.endMarker ?? 'arrow') ? startPair : pair(edge.endMarker))[0] : undefined
  const projection = graphEdgePathProjection(edge, style)
  const geometry = projection?.geometry ?? { kind: 'polyline' as const, points: edge.points }
  // This query owns only marker paint. Use the same resources, path and
  // contour authority as lowering, without admitting a discarded Scene mark
  // (identity, hit geometry, terminal projection and immutable snapshots).
  return connectorMarkerPaintRegions({
    route: { geometry, closed: false, contours: projection?.contours ?? connectorContourSemantics(geometry, false) },
    stroke: { width: edge.inlineStyle?.['stroke-width'] ?? String((style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)) },
    markers: { start, mid: [], end },
  }, undefined, undefined, includeHull)
}
