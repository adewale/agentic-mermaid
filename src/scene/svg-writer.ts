// ============================================================================
// The default backend's SVG writer: each shape, text and connector mark's
// element is written from its typed fields, so paint certification, which
// reads those fields, describes the bytes a render emits. Families supply
// inert hooks (classes, data-*) through `attributes`; geometry, paint,
// typography, transforms, markers, identity and ARIA come from the mark.
// ============================================================================

import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkAttributes, MarkPaint, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'

// A number's decimal form needs no escaping.
const attribute = (name: string, value: string | number): string => `${name}="${typeof value === 'number' ? value : escapeAttr(value)}"`

/** `data-*` keys the writer derives from typed fields, or that the shared
 * text writer emits itself. */
export const WRITER_OWNED_DATA_KEYS: ReadonlySet<string> = new Set([
  'id', 'role', 'from', 'to', 'relationship', 'direction',
  'prepared-text', 'font-metrics', 'text-fragment', 'connector-label-for',
])
export const MARK_CLASS_TOKENS = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/
export const MARK_DATA_KEY = /^[a-z][a-z0-9-]*$/

function hooks(attributes: MarkAttributes | undefined): string[] {
  if (!attributes) return []
  return [
    ...(attributes.className ? [attribute('class', attributes.className)] : []),
    ...Object.entries(attributes.data ?? {}).map(([key, value]) => attribute(`data-${key}`, value)),
    ...(attributes.ariaHidden ? ['aria-hidden="true"'] : []),
    ...(attributes.tabIndex === 0 ? ['tabindex="0"'] : []),
    ...(attributes.ariaLabel !== undefined ? [attribute('aria-label', attributes.ariaLabel)] : []),
  ]
}

function paintAttributes(paint: MarkPaint): string[] {
  const fields = [
    ['fill', paint.fill], ['fill-opacity', paint.fillOpacity],
    ['stroke', paint.stroke], ['stroke-opacity', paint.strokeOpacity], ['stroke-width', paint.strokeWidth],
    ['stroke-dasharray', paint.strokeDasharray], ['stroke-dashoffset', paint.strokeDashoffset],
    ['stroke-linecap', paint.strokeLinecap], ['stroke-linejoin', paint.strokeLinejoin],
    ['stroke-miterlimit', paint.strokeMiterlimit], ['vector-effect', paint.vectorEffect],
    ['paint-order', paint.paintOrder], ['opacity', paint.opacity],
  ] as const
  return fields.flatMap(([name, value]) => value === undefined ? [] : [attribute(name, value)])
}

function transformAttribute(transform: SceneTransform | undefined): string[] {
  return transform ? [attribute('transform', serializeTransform(transform))] : []
}

/** Identity on the roles whose DOM contract carries it, then relation ARIA. */
function identityAttributes(identity: SvgSemanticIdentity | undefined, accessibility: SvgSemanticAccessibility | undefined): string[] {
  const out: string[] = []
  if (identity && hasDomSvgIdentityRole(identity.role)) {
    out.push(attribute('data-id', identity.id), attribute('data-role', identity.role))
    if (identity.from !== undefined) out.push(attribute('data-from', identity.from))
    if (identity.to !== undefined) out.push(attribute('data-to', identity.to))
  }
  if (accessibility) {
    out.push(attribute('role', accessibility.role), attribute('aria-roledescription', accessibility.roleDescription), attribute('aria-label', accessibility.label))
  }
  return out
}

type ElementGeometry = Exclude<Geometry, { kind: 'compound' }> | Exclude<ConnectorMark['route']['geometry'], { kind: 'line' }> | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

function geometryAttributes(geometry: ElementGeometry): { tag: string; attrs: string[] } {
  switch (geometry.kind) {
    case 'rect': return {
      tag: 'rect',
      attrs: [
        attribute('x', geometry.x), attribute('y', geometry.y), attribute('width', geometry.width), attribute('height', geometry.height),
        ...(geometry.rx !== undefined ? [attribute('rx', geometry.rx)] : []),
        ...(geometry.ry !== undefined ? [attribute('ry', geometry.ry)] : []),
      ],
    }
    case 'circle': return { tag: 'circle', attrs: [attribute('cx', geometry.cx), attribute('cy', geometry.cy), attribute('r', geometry.r)] }
    case 'ellipse': return { tag: 'ellipse', attrs: [attribute('cx', geometry.cx), attribute('cy', geometry.cy), attribute('rx', geometry.rx), attribute('ry', geometry.ry)] }
    case 'line': return { tag: 'line', attrs: [attribute('x1', geometry.x1), attribute('y1', geometry.y1), attribute('x2', geometry.x2), attribute('y2', geometry.y2)] }
    case 'polygon':
    case 'polyline': return { tag: geometry.kind, attrs: [attribute('points', geometry.points.map(point => `${point.x},${point.y}`).join(' '))] }
    case 'path': return { tag: 'path', attrs: [attribute('d', geometry.d)] }
  }
}

function element(tag: string, attrs: readonly string[]): string {
  return `<${tag} ${attrs.join(' ')} />`
}

/** Compound geometry writes one element per child, each with its own paint;
 * hooks, identity and ARIA go on the first. */
export function writeShapeSvg(node: ShapeMark): string {
  const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  return pieces.map((piece, index) => {
    if (piece.kind === 'compound') throw new TypeError(`Shape "${node.id}" nests compound geometry`)
    const { tag, attrs } = geometryAttributes(piece)
    const paint = node.geometry.kind === 'compound' ? node.childPaints?.[index] ?? node.paint : node.paint
    return element(tag, [
      ...(index === 0 ? hooks(node.attributes) : []),
      ...attrs,
      ...paintAttributes(paint),
      ...transformAttribute(node.transform),
      ...(index === 0 ? identityAttributes(node.identity, node.accessibility) : []),
    ])
  }).join('\n')
}

function typographyAttributes(node: TextMark): string[] {
  return [
    attribute('text-anchor', node.anchor),
    ...(node.dominantBaseline ? [attribute('dominant-baseline', node.dominantBaseline)] : []),
    // A block measured in a named face is drawn in it; otherwise the document font applies.
    ...(node.block?.fontFamily ? [attribute('font-family', node.block.fontFamily)] : []),
    attribute('font-size', node.fontSize),
    attribute('font-weight', node.fontWeight ?? node.block?.fontWeight ?? 400),
    ...((node.letterSpacing ?? 0) !== 0 ? [attribute('letter-spacing', node.letterSpacing!)] : []),
    ...(node.fontStyle ? [attribute('font-style', node.fontStyle)] : []),
    ...(node.textDecoration ? [attribute('text-decoration', node.textDecoration)] : []),
  ]
}

/** Text goes through the shared multi-line writer, which owns line wrappers,
 * prepared runs and fitted advances. A fallback-measured mark is written from
 * its source text, as families wrote unprepared labels. */
export function writeTextSvg(node: TextMark): string {
  const attrs = [
    ...hooks(node.attributes),
    ...typographyAttributes(node),
    ...paintAttributes(node.paint),
    ...transformAttribute(node.transform),
    ...identityAttributes(node.identity, node.accessibility),
  ].join(' ')
  const prepared = node.measurement === 'prepared' && node.block
  const svg = renderMultilineText(prepared ? node.block! : node.text, node.x, node.y, node.fontSize, attrs, node.baselineShift ?? 0.35, node.display === 'literal')
  if (!node.spans) return svg
  const shown = prepared ? node.block!.text : node.text
  const content = `>${escapeXml(shown)}</text>`
  if (!svg.endsWith(content)) throw new TypeError(`Text "${node.id}" spans require a one-line label`)
  const spans = node.spans.map(span => `<tspan ${attribute('fill', span.fill)}>${escapeXml(span.text)}</tspan>`).join('')
  return `${svg.slice(0, -content.length)}>${spans}</text>`
}

function connectorInlineLabelSvg(node: ConnectorMark, label: ConnectorLabelDescriptor, index: number): string | undefined {
  if (label.visual?.kind !== 'inline') return undefined
  if (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined) {
    throw new TypeError(`Connector "${node.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
  }
  const block = connectorInlineLabelText(label)
  const paint: MarkPaint = {
    ...label.paint,
    ...(label.halo ? {
      stroke: label.halo.color ?? 'var(--bg)',
      strokeWidth: String(label.halo.width),
      paintOrder: 'stroke fill',
    } : {}),
  }
  const attrs = [
    attribute('data-id', label.id ?? `${node.id}-label-${index + 1}`),
    'data-role="label"',
    attribute('data-connector-label-for', node.id),
    attribute('font-size', block.fontSize),
    attribute('font-weight', block.fontWeight),
    ...(block.letterSpacing ? [attribute('letter-spacing', block.letterSpacing)] : []),
    attribute('text-anchor', label.textAnchor),
    ...transformAttribute(node.transform),
    ...paintAttributes(paint),
  ]
  return renderMultilineText(block, label.anchor.x, label.anchor.y - Math.max(0, label.clearance ?? 0), block.fontSize, attrs.join(' '), 0)
}

/** A connector is one marker carrier element plus any labels it owns; an
 * invisible connector draws its labels without the carrier. SVG defaults
 * (butt caps, miter joins, limit 4) are left implicit. */
export function writeConnectorSvg(node: ConnectorMark): string {
  const labels = node.labels.flatMap((label, index) => connectorInlineLabelSvg(node, label, index) ?? [])
  if (node.lineStyle === 'invisible') return labels.join('\n')
  const { tag, attrs } = geometryAttributes(node.route.geometry)
  const { stroke, markers } = node
  const dash = stroke.dash
  const midMarker = markers.mid[0]
  const carrier = element(tag, [
    ...hooks(node.attributes),
    ...attrs,
    ...(tag === 'line' ? [] : ['fill="none"']),
    attribute('stroke', stroke.color),
    ...(stroke.opacity !== undefined ? [attribute('stroke-opacity', stroke.opacity)] : []),
    attribute('stroke-width', stroke.width),
    ...(dash ? [attribute('stroke-dasharray', typeof dash.array === 'string' ? dash.array : dash.array.join(' '))] : []),
    ...(dash?.offset !== undefined ? [attribute('stroke-dashoffset', dash.offset)] : []),
    ...(stroke.lineCap !== 'butt' ? [attribute('stroke-linecap', stroke.lineCap)] : []),
    ...(stroke.lineJoin !== 'miter' ? [attribute('stroke-linejoin', stroke.lineJoin)] : []),
    ...(stroke.miterLimit !== 4 ? [attribute('stroke-miterlimit', stroke.miterLimit)] : []),
    ...(stroke.pathLength !== undefined ? [attribute('pathLength', stroke.pathLength)] : []),
    ...(stroke.paintOrder !== undefined ? [attribute('paint-order', stroke.paintOrder)] : []),
    ...(stroke.nonScaling ? ['vector-effect="non-scaling-stroke"'] : []),
    ...(stroke.mixBlendMode ? [attribute('style', `mix-blend-mode:${stroke.mixBlendMode}`)] : []),
    ...(markers.start ? [attribute('marker-start', `url(#${markers.start.id})`)] : []),
    ...(midMarker ? [attribute('marker-mid', `url(#${midMarker.id})`)] : []),
    ...(markers.end ? [attribute('marker-end', `url(#${markers.end.id})`)] : []),
    ...(node.hit.pointerEvents === 'none' ? ['pointer-events="none"'] : []),
    ...transformAttribute(node.transform),
    attribute('data-relationship', node.relationship.kind),
    attribute('data-direction', node.relationship.direction),
    ...identityAttributes(node.identity, node.accessibility),
  ])
  return [carrier, ...labels].join('\n')
}
