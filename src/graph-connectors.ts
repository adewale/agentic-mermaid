import type { EdgeMarker, Point, PositionedEdge } from './types.ts'
import { ARROW_HEAD } from './styles.ts'
import type { MarkerDescriptor } from './scene/ir.ts'
import { prepareMarkerTerminals } from './scene/marker-terminals.ts'
import { tipAnchoredArrow } from './scene/marker-resources.ts'
import { connectorContourSemantics, projectConnectorPath, projectRoundedConnectorPath, type ConnectorPathProjection, type ConnectorPathProjectionSegment } from './scene/connector-geometry.ts'
import { connectorMarkerPaintRegions, type ConnectorMarkerPaintRegion } from './scene/bounds.ts'
import { canonicalTextDigest } from './render-contract.ts'

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

export function graphEdgeTerminalClearance(edge: Pick<PositionedEdge, 'style' | 'inlineStyle' | 'hasArrowStart' | 'hasArrowEnd' | 'startMarker' | 'endMarker'>, style: { lineWidth?: number }) {
  const fixed = edge.inlineStyle?.['stroke-width'] ? '-fixed' : ''
  const width = (style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)
  return {
    start: edge.hasArrowStart ? markerTerminal(`${markerIdPrefix(edge.startMarker ?? 'arrow')}-start${fixed}`, width, 'start') : 0,
    end: edge.hasArrowEnd ? markerTerminal(`${markerIdPrefix(edge.endMarker ?? 'arrow')}${fixed}`, width, 'end') : 0,
  }
}

function pointsToCurveProjection(points: Point[]): ConnectorPathProjection {
  const first = points[0]!
  let d = `M ${first.x} ${first.y}`
  const segments: ConnectorPathProjectionSegment[] = []
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!
    const point = points[index]!
    const mx = (previous.x + point.x) / 2
    d += ` C ${mx} ${previous.y}, ${mx} ${point.y}, ${point.x} ${point.y}`
    segments.push({
      kind: 'cubic',
      control1: { x: mx, y: previous.y },
      control2: { x: mx, y: point.y },
      end: point,
    })
  }
  return projectConnectorPath(d, first, segments)
}

/** The same typed path drives marker tangents during placement and lowering. */
export function graphEdgePathProjection(edge: PositionedEdge, style: { edgeBendRadius?: number; lineWidth?: number }): ConnectorPathProjection | undefined {
  return edge.curve ? pointsToCurveProjection(edge.points)
    : (style.edgeBendRadius ?? 0) > 0 ? projectRoundedConnectorPath(edge.points, style.edgeBendRadius!, { terminalClearance: graphEdgeTerminalClearance(edge, style) }) : undefined
}

/** Reserve painted endpoint resources before opaque labels are moved. These
 * are the renderer's marker factories, including fixed custom-width heads. */
export function graphEdgeMarkerPaintRegions(edge: PositionedEdge, style: { lineWidth?: number; edgeStrokeColor?: string; edgeBendRadius?: number }): ConnectorMarkerPaintRegion[] {
  if (edge.style === 'invisible' || edge.points.length < 2 || !edge.hasArrowStart && !edge.hasArrowEnd) return []
  const color = edge.inlineStyle?.stroke ?? style.edgeStrokeColor
  const fixed = !!edge.inlineStyle?.['stroke-width']
  const resources = flowchartMarkerResources(new Set(color ? [color] : []), new Set(fixed ? [color] : []), edge.startMarker === 'circle' || edge.endMarker === 'circle', edge.startMarker === 'cross' || edge.endMarker === 'cross')
  const suffix = `${color ? `-${markerSuffix(color)}` : ''}${fixed ? '-fixed' : ''}`
  const start = edge.hasArrowStart ? resources.find(marker => marker.id === `${markerIdPrefix(edge.startMarker ?? 'arrow')}-start${suffix}`) : undefined
  const end = edge.hasArrowEnd ? resources.find(marker => marker.id === `${markerIdPrefix(edge.endMarker ?? 'arrow')}${suffix}`) : undefined
  const projection = graphEdgePathProjection(edge, style)
  const geometry = projection?.geometry ?? { kind: 'polyline' as const, points: edge.points }
  // This query owns only marker paint. Use the same resources, path and
  // contour authority as lowering, without admitting a discarded Scene mark
  // (identity, hit geometry, terminal projection and immutable snapshots).
  return connectorMarkerPaintRegions({
    route: { geometry, closed: false, contours: projection?.contours ?? connectorContourSemantics(geometry, false) },
    stroke: { width: edge.inlineStyle?.['stroke-width'] ?? String((style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)) },
    markers: { start, mid: [], end },
  })
}
