import type { ConnectorMark, Geometry, MarkPaint } from './ir.ts'
import { escapeAttr, escapeDisplayAttr } from '../multiline-utils.ts'
import { isSafeActionHref } from '../output-security.ts'

export type SerializableShapeGeometry = Exclude<Geometry, { kind: 'compound' }>
export type GeometryShapePaint = MarkPaint

const round = (value: number): number => Math.round(value * 1000) / 1000
const attribute = (name: string, value: string | number): string => `${name}="${escapeAttr(String(value))}"`

function paintAttrs(paint: GeometryShapePaint): string[] {
  const fields = [
    ['fill', paint.fill], ['stroke', paint.stroke], ['stroke-width', paint.strokeWidth],
    ['stroke-dasharray', paint.strokeDasharray], ['stroke-dashoffset', paint.strokeDashoffset],
    ['stroke-linecap', paint.strokeLinecap], ['stroke-linejoin', paint.strokeLinejoin],
    ['stroke-miterlimit', paint.strokeMiterlimit], ['vector-effect', paint.vectorEffect],
    ['paint-order', paint.paintOrder], ['opacity', paint.opacity],
  ] as const
  return fields.flatMap(([name, value]) => value === undefined ? [] : [attribute(name, value)])
}

type GeometryPrecision = 'compact' | 'exact'

function geometryTag(geometry: SerializableShapeGeometry, precision: GeometryPrecision): { tag: string; attrs: string[] } {
  const coordinate = (value: number): number => precision === 'exact' ? value : round(value)
  const dimensions = (values: Record<string, number>): string[] => Object.entries(values).map(([name, value]) => attribute(name, coordinate(value)))
  switch (geometry.kind) {
    case 'rect': return { tag: 'rect', attrs: dimensions({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rx: geometry.rx ?? 0, ry: geometry.ry ?? 0 }) }
    case 'circle': return { tag: 'circle', attrs: dimensions({ cx: geometry.cx, cy: geometry.cy, r: geometry.r }) }
    case 'ellipse': return { tag: 'ellipse', attrs: dimensions({ cx: geometry.cx, cy: geometry.cy, rx: geometry.rx, ry: geometry.ry }) }
    case 'line': return { tag: 'line', attrs: dimensions({ x1: geometry.x1, y1: geometry.y1, x2: geometry.x2, y2: geometry.y2 }) }
    case 'polygon':
    case 'polyline': return { tag: geometry.kind, attrs: [attribute('points', geometry.points.map(point => `${coordinate(point.x)},${coordinate(point.y)}`).join(' '))] }
    case 'path': return { tag: 'path', attrs: [attribute('d', geometry.d)] }
  }
}

/** Serialize the closed primitive geometry and paint vocabulary. Compact
 * coordinates preserve existing family output; exact projections retain the
 * same floating coordinates as geometry-sensitive Scene consumers. */
export function serializeGeometryShape(geometry: SerializableShapeGeometry, paint: GeometryShapePaint, precision: GeometryPrecision = 'compact'): string {
  const { tag, attrs } = geometryTag(geometry, precision)
  return `<${tag} ${[...attrs, ...paintAttrs(paint)].join(' ')} />`
}

/** C4 source inspection metadata has a closed vocabulary, separate from paints,
 * geometry and the identity/relationship projections owned by marks.connector. */
export interface C4ConnectorSourceMetadata {
  macro: string
  authoredFrom: string
  authoredTo: string
  order: number
  index?: string
  tags?: readonly string[]
  href?: string
}

/** Project an existing connector's typed carrier; the mark constructor adds
 * marker references, authoritative identity, relationship and accessibility. */
export function serializeConnectorCarrier(
  connector: Pick<ConnectorMark, 'route' | 'stroke' | 'lineStyle' | 'markers' | 'labels'>,
  metadata?: C4ConnectorSourceMetadata,
): string {
  const { tag, attrs } = geometryTag(connector.route.geometry, 'exact')
  const { stroke, markers } = connector
  const dash = stroke.dash?.array
  const paint: MarkPaint = {
    fill: 'none', stroke: stroke.color, strokeWidth: String(stroke.width),
    strokeLinecap: stroke.lineCap, strokeLinejoin: stroke.lineJoin, strokeMiterlimit: String(stroke.miterLimit),
    ...(dash !== undefined ? { strokeDasharray: typeof dash === 'string' ? dash : dash.join(' ') } : {}),
    ...(stroke.dash?.offset !== undefined ? { strokeDashoffset: String(stroke.dash.offset) } : {}),
    ...(stroke.opacity !== undefined ? { opacity: String(stroke.opacity) } : {}),
    ...(stroke.paintOrder !== undefined ? { paintOrder: stroke.paintOrder } : {}),
    ...(stroke.nonScaling ? { vectorEffect: 'non-scaling-stroke' } : {}),
  }
  const inspection = [
    'class="edge"', attribute('data-style', connector.lineStyle),
    attribute('data-arrow-start', String(!!markers.start)), attribute('data-arrow-end', String(!!markers.end)),
    ...(markers.start ? [attribute('data-marker-start', markers.start.shape)] : []),
    ...(markers.end ? [attribute('data-marker-end', markers.end.shape)] : []),
    ...(connector.labels[0] ? [`data-label="${escapeDisplayAttr(connector.labels[0].text)}"`] : []),
  ]
  if (metadata) inspection.push(
    attribute('data-c4-macro', metadata.macro),
    attribute('data-authored-from', metadata.authoredFrom), attribute('data-authored-to', metadata.authoredTo), attribute('data-order', metadata.order),
    ...(metadata.index !== undefined ? [attribute('data-index', metadata.index)] : []),
    ...(metadata.tags?.length ? [attribute('data-tags', JSON.stringify(metadata.tags))] : []),
    ...(metadata.href && isSafeActionHref(metadata.href) ? [attribute('data-href', metadata.href), 'tabindex="0"'] : []),
  )
  return `<${tag} ${[
    ...inspection, ...attrs, ...paintAttrs(paint),
    ...(stroke.pathLength !== undefined ? [attribute('pathLength', stroke.pathLength)] : []),
    ...(stroke.mixBlendMode ? [attribute('style', `mix-blend-mode:${stroke.mixBlendMode}`)] : []),
  ].join(' ')} />`
}
