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
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'

/** One append-only writer for a mark. Attribute emission does not allocate
 * arrays, one-element spread operands, or temporary `name="value"` strings.
 * Numeric fields use the shared SVG spelling at this write boundary. */
class SvgWriter {
  value = ''

  raw(text: string): void { this.value += text }

  attribute(name: string, value: string | number): void {
    this.value += ` ${name}="${typeof value === 'number' ? formatSvgNumber(value) : escapeAttr(formatSvgNumericAttribute(name, value))}"`
  }
}

/** `data-*` keys the writer derives from typed fields, or that the shared
 * text writer emits itself. */
export const WRITER_OWNED_DATA_KEYS: ReadonlySet<string> = new Set([
  'id', 'role', 'from', 'to', 'relationship', 'direction',
  'prepared-text', 'font-metrics', 'text-fragment', 'connector-label-for',
])
export const MARK_CLASS_TOKENS = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/
export const MARK_DATA_KEY = /^[a-z][a-z0-9-]*$/

function hooks(out: SvgWriter, attributes: MarkAttributes | undefined): void {
  if (!attributes) return
  if (attributes.className) out.attribute('class', attributes.className)
  if (attributes.data) for (const key of Object.keys(attributes.data)) out.attribute(`data-${key}`, attributes.data[key]!)
  if (attributes.ariaHidden) out.attribute('aria-hidden', 'true')
  if (attributes.tabIndex === 0) out.attribute('tabindex', 0)
  if (attributes.ariaLabel !== undefined) out.attribute('aria-label', attributes.ariaLabel)
}

function paintAttributes(out: SvgWriter, paint: MarkPaint): void {
  if (paint.fill !== undefined) out.attribute('fill', paint.fill)
  if (paint.fillOpacity !== undefined) out.attribute('fill-opacity', paint.fillOpacity)
  if (paint.stroke !== undefined) out.attribute('stroke', paint.stroke)
  if (paint.strokeOpacity !== undefined) out.attribute('stroke-opacity', paint.strokeOpacity)
  if (paint.strokeWidth !== undefined) out.attribute('stroke-width', paint.strokeWidth)
  if (paint.strokeDasharray !== undefined) out.attribute('stroke-dasharray', paint.strokeDasharray)
  if (paint.strokeDashoffset !== undefined) out.attribute('stroke-dashoffset', paint.strokeDashoffset)
  if (paint.strokeLinecap !== undefined) out.attribute('stroke-linecap', paint.strokeLinecap)
  if (paint.strokeLinejoin !== undefined) out.attribute('stroke-linejoin', paint.strokeLinejoin)
  if (paint.strokeMiterlimit !== undefined) out.attribute('stroke-miterlimit', paint.strokeMiterlimit)
  if (paint.vectorEffect !== undefined) out.attribute('vector-effect', paint.vectorEffect)
  if (paint.paintOrder !== undefined) out.attribute('paint-order', paint.paintOrder)
  if (paint.opacity !== undefined) out.attribute('opacity', paint.opacity)
}

function transformAttribute(out: SvgWriter, transform: SceneTransform | undefined): void {
  if (transform) out.attribute('transform', serializeTransform(transform))
}

/** Identity on the roles whose DOM contract carries it, then relation ARIA. */
function identityAttributes(out: SvgWriter, identity: SvgSemanticIdentity | undefined, accessibility: SvgSemanticAccessibility | undefined): void {
  if (identity && hasDomSvgIdentityRole(identity.role)) {
    out.attribute('data-id', identity.id)
    out.attribute('data-role', identity.role)
    if (identity.from !== undefined) out.attribute('data-from', identity.from)
    if (identity.to !== undefined) out.attribute('data-to', identity.to)
  }
  if (accessibility) {
    out.attribute('role', accessibility.role)
    out.attribute('aria-roledescription', accessibility.roleDescription)
    out.attribute('aria-label', accessibility.label)
  }
}

type ElementGeometry = Exclude<Geometry, { kind: 'compound' }> | Exclude<ConnectorMark['route']['geometry'], { kind: 'line' }> | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

function geometryAttributes(out: SvgWriter, geometry: ElementGeometry): void {
  switch (geometry.kind) {
    case 'rect':
      out.attribute('x', geometry.x)
      out.attribute('y', geometry.y)
      out.attribute('width', geometry.width)
      out.attribute('height', geometry.height)
      if (geometry.rx !== undefined) out.attribute('rx', geometry.rx)
      if (geometry.ry !== undefined) out.attribute('ry', geometry.ry)
      return
    case 'circle':
      out.attribute('cx', geometry.cx)
      out.attribute('cy', geometry.cy)
      out.attribute('r', geometry.r)
      return
    case 'ellipse':
      out.attribute('cx', geometry.cx)
      out.attribute('cy', geometry.cy)
      out.attribute('rx', geometry.rx)
      out.attribute('ry', geometry.ry)
      return
    case 'line':
      out.attribute('x1', geometry.x1)
      out.attribute('y1', geometry.y1)
      out.attribute('x2', geometry.x2)
      out.attribute('y2', geometry.y2)
      return
    case 'polygon':
    case 'polyline': {
      let points = ''
      for (let i = 0; i < geometry.points.length; i++) {
        const point = geometry.points[i]!
        points += `${i ? ' ' : ''}${point.x},${point.y}`
      }
      out.attribute('points', points)
      return
    }
    case 'path': out.attribute('d', geometry.d)
  }
}

/** Compound geometry writes one element per child, each with its own paint;
 * hooks, identity and ARIA go on the first. */
export function writeShapeSvg(node: ShapeMark): string {
  const out = new SvgWriter()
  const compound = node.geometry.kind === 'compound'
  const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!
    if (piece.kind === 'compound') throw new TypeError(`Shape "${node.id}" nests compound geometry`)
    if (index) out.raw('\n')
    out.raw(`<${piece.kind}`)
    if (index === 0) hooks(out, node.attributes)
    geometryAttributes(out, piece)
    paintAttributes(out, compound ? node.childPaints?.[index] ?? node.paint : node.paint)
    transformAttribute(out, node.transform)
    if (index === 0) identityAttributes(out, node.identity, node.accessibility)
    out.raw(' />')
  }
  return out.value
}

function typographyAttributes(out: SvgWriter, node: TextMark): void {
  out.attribute('text-anchor', node.anchor)
  if (node.dominantBaseline) out.attribute('dominant-baseline', node.dominantBaseline)
  // A block measured in a named face is drawn in it; otherwise the document font applies.
  if (node.block?.fontFamily) out.attribute('font-family', node.block.fontFamily)
  out.attribute('font-size', node.fontSize)
  out.attribute('font-weight', node.fontWeight ?? node.block?.fontWeight ?? 400)
  if ((node.letterSpacing ?? 0) !== 0) out.attribute('letter-spacing', node.letterSpacing!)
  if (node.fontStyle) out.attribute('font-style', node.fontStyle)
  if (node.textDecoration) out.attribute('text-decoration', node.textDecoration)
}

/** Text goes through the shared multi-line writer, which owns line wrappers,
 * prepared runs and fitted advances. A fallback-measured mark is written from
 * its source text, as families wrote unprepared labels. */
export function writeTextSvg(node: TextMark): string {
  const out = new SvgWriter()
  hooks(out, node.attributes)
  typographyAttributes(out, node)
  paintAttributes(out, node.paint)
  transformAttribute(out, node.transform)
  identityAttributes(out, node.identity, node.accessibility)
  const attrs = out.value.slice(1)
  const prepared = node.measurement === 'prepared' && node.block
  const svg = renderMultilineText(prepared ? node.block! : node.text, node.x, node.y, node.fontSize, attrs, node.baselineShift ?? 0.35, node.display === 'literal')
  if (!node.spans) return svg
  const shown = prepared ? node.block!.text : node.text
  const content = `>${escapeXml(shown)}</text>`
  if (!svg.endsWith(content)) throw new TypeError(`Text "${node.id}" spans require a one-line label`)
  let spans = ''
  for (const span of node.spans) spans += `<tspan fill="${escapeAttr(span.fill)}">${escapeXml(span.text)}</tspan>`
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
  const out = new SvgWriter()
  out.attribute('data-id', label.id ?? `${node.id}-label-${index + 1}`)
  out.attribute('data-role', 'label')
  out.attribute('data-connector-label-for', node.id)
  out.attribute('font-size', block.fontSize)
  out.attribute('font-weight', block.fontWeight)
  if (block.letterSpacing) out.attribute('letter-spacing', block.letterSpacing)
  out.attribute('text-anchor', label.textAnchor)
  transformAttribute(out, node.transform)
  paintAttributes(out, paint)
  return renderMultilineText(block, label.anchor.x, label.anchor.y - Math.max(0, label.clearance ?? 0), block.fontSize, out.value.slice(1), 0)
}

/** A connector is one marker carrier element plus any labels it owns; an
 * invisible connector draws its labels without the carrier. SVG defaults
 * (butt caps, miter joins, limit 4) are left implicit. */
export function writeConnectorSvg(node: ConnectorMark): string {
  const out = new SvgWriter()
  const { stroke, markers } = node
  const dash = stroke.dash
  const midMarker = markers.mid[0]
  if (node.lineStyle !== 'invisible') {
    const geometry = node.route.geometry
    out.raw(`<${geometry.kind}`)
    hooks(out, node.attributes)
    geometryAttributes(out, geometry)
    if (geometry.kind !== 'line') out.attribute('fill', 'none')
    out.attribute('stroke', stroke.color)
    if (stroke.opacity !== undefined) out.attribute('stroke-opacity', stroke.opacity)
    out.attribute('stroke-width', stroke.width)
    if (dash) out.attribute('stroke-dasharray', typeof dash.array === 'string' ? dash.array : dash.array.join(' '))
    if (dash?.offset !== undefined) out.attribute('stroke-dashoffset', dash.offset)
    if (stroke.lineCap !== 'butt') out.attribute('stroke-linecap', stroke.lineCap)
    if (stroke.lineJoin !== 'miter') out.attribute('stroke-linejoin', stroke.lineJoin)
    if (stroke.miterLimit !== 4) out.attribute('stroke-miterlimit', stroke.miterLimit)
    if (stroke.pathLength !== undefined) out.attribute('pathLength', stroke.pathLength)
    if (stroke.paintOrder !== undefined) out.attribute('paint-order', stroke.paintOrder)
    if (stroke.nonScaling) out.attribute('vector-effect', 'non-scaling-stroke')
    if (stroke.mixBlendMode) out.attribute('style', `mix-blend-mode:${stroke.mixBlendMode}`)
    if (markers.start) out.attribute('marker-start', `url(#${markers.start.id})`)
    if (midMarker) out.attribute('marker-mid', `url(#${midMarker.id})`)
    if (markers.end) out.attribute('marker-end', `url(#${markers.end.id})`)
    if (node.hit.pointerEvents === 'none') out.attribute('pointer-events', 'none')
    transformAttribute(out, node.transform)
    out.attribute('data-relationship', node.relationship.kind)
    out.attribute('data-direction', node.relationship.direction)
    identityAttributes(out, node.identity, node.accessibility)
    out.raw(' />')
  }
  for (let index = 0; index < node.labels.length; index++) {
    const label = connectorInlineLabelSvg(node, node.labels[index]!, index)
    if (label !== undefined) {
      if (out.value) out.raw('\n')
      out.raw(label)
    }
  }
  return out.value
}

/** Path for a header band with rounded top corners and a square bottom. */
export function topRoundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = clampRadius(radius, width / 2, height)
  if (r === 0) return `M${x},${y} H${x + width} V${y + height} H${x} Z`

  return [
    `M${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height}`,
    `H${x}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    'Z',
  ].join(' ')
}


function clampRadius(radius: number, maxX: number, maxY: number): number {
  return Math.max(0, Math.min(radius, maxX, maxY))
}
