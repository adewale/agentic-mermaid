// ============================================================================
// The default backend's SVG writer: each shape, text and connector mark's
// element is written from its typed fields, so paint certification, which
// reads those fields, describes the bytes a render emits. Families supply
// inert hooks (classes, data-*) through `attributes`; geometry, paint,
// typography, transforms, markers, identity and ARIA come from the mark.
// ============================================================================

import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkAttributes, MarkPaint, ScenePoint, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { connectorUnitTangent } from './connector-geometry.ts'
import { createWrittenPolyline } from './written-geometry.ts'

/** A receipt from this actual geometry write, never from cached markup.
 * Undefined served geometry means numeric spelling exceeded bounded custody. */
export type SvgGeometryWriteSink = ((source: Geometry, served: Geometry | undefined) => void) & {
  /** Bound to this operation's ledger; called before variable projection work. */
  readonly reserveProjection?: (source: Geometry, operations: number) => boolean
  /** One complete shape write's actual paint literals and transform presence.
   * Undefined means the bounded attribute receipt could not be retained. */
  readonly rectangleAttributes?: (source: ShapeMark, attributes: Readonly<Record<string, string>> | undefined) => void
}

/** One append-only writer for a mark. Attribute emission does not allocate
 * arrays, one-element spread operands, or temporary `name="value"` strings.
 * Numeric fields use the shared SVG spelling at this write boundary. */
class SvgWriter {
  value = ''
  observeAttributes?: (name: string, literal: string) => void

  raw(text: string): void { this.value += text }

  attribute(name: string, value: string | number, changedToken?: (offset: number, literal: string) => boolean | void, numericToken?: (literal: string, raw: string) => boolean | void): string {
    const literal = typeof value === 'number' ? formatSvgNumber(value) : formatSvgNumericAttribute(name, value, changedToken, numericToken)
    this.value += ` ${name}="${typeof value === 'number' ? literal : escapeAttr(literal)}"`
    this.observeAttributes?.(name, literal)
    return literal
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

function geometryAttributes(out: SvgWriter, geometry: ElementGeometry, sink?: SvgGeometryWriteSink): void {
  switch (geometry.kind) {
    case 'rect': {
      const rawX = geometry.x, x = out.attribute('x', rawX)
      const rawY = geometry.y, y = out.attribute('y', rawY)
      const rawWidth = geometry.width, width = out.attribute('width', rawWidth)
      const rawHeight = geometry.height, height = out.attribute('height', rawHeight)
      let rawRx: number | undefined, rawRy: number | undefined, rx: string | undefined, ry: string | undefined
      // Keep the optional fields' original conditional/read order, including
      // generic getter callers. The receipt retains only actual attribute reads.
      if (geometry.rx !== undefined) { rawRx = geometry.rx; rx = out.attribute('rx', rawRx) }
      if (geometry.ry !== undefined) { rawRy = geometry.ry; ry = out.attribute('ry', rawRy) }
      if (sink) sink(geometry, {
        kind: 'rect', x: Number(x), y: Number(y), width: Number(width), height: Number(height),
        ...(rx === undefined ? {} : { rx: Number(rx) }), ...(ry === undefined ? {} : { ry: Number(ry) }),
      })
      return
    }
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
    case 'line': {
      const rawX1 = geometry.x1, x1 = out.attribute('x1', rawX1)
      const rawY1 = geometry.y1, y1 = out.attribute('y1', rawY1)
      const rawX2 = geometry.x2, x2 = out.attribute('x2', rawX2)
      const rawY2 = geometry.y2, y2 = out.attribute('y2', rawY2)
      if (sink) sink(geometry, Number(x1) === rawX1 && Number(y1) === rawY1 && Number(x2) === rawX2 && Number(y2) === rawY2
        ? geometry : { kind: 'line', x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) })
      return
    }
    case 'polygon':
    case 'polyline': {
      let points = ''
      const observed = geometry.kind === 'polyline' ? sink : undefined
      let pointCount = 0
      for (; pointCount < geometry.points.length; pointCount++) {
        const point = geometry.points[pointCount]!
        const x = `${point.x}`, y = `${point.y}`, prefix = pointCount ? ' ' : ''
        points += `${prefix}${x},${y}`
      }
      let tokens = 0, understood = true, changed = false, x = 0, rawX = 0
      let projected: ScenePoint[] | undefined, previous: ScenePoint | undefined
      let firstTangent: ScenePoint | undefined, lastTangent: ScenePoint | undefined
      let rawPrevious: ScenePoint | undefined, rawFirstTangent: ScenePoint | undefined, rawLastTangent: ScenePoint | undefined
      let rawX0 = Infinity, rawY0 = Infinity, rawX1 = -Infinity, rawY1 = -Infinity
      let rawStartX = 0, rawStartY = 0, rawEndX = 0, rawEndY = 0
      const literal = out.attribute('points', points, undefined, observed ? (literal, raw) => {
        if (tokens === 0) {
          const cost = pointCount * 48 + 128
          if (!Number.isSafeInteger(pointCount) || pointCount < 2 || !Number.isSafeInteger(cost) || !observed.reserveProjection?.(geometry, cost)) { understood = false; return false }
          projected = []
        }
        if (tokens >= pointCount * 2) { understood = false; return false }
        const value = Number(literal), original = Number(raw)
        if (!Number.isFinite(value) || !Number.isFinite(original)) { understood = false; return false }
        changed ||= value !== original
        if (tokens++ % 2 === 0) { x = value; rawX = original; return }
        const point = Object.freeze({ x, y: value })
        const rawPoint = Object.freeze({ x: rawX, y: original })
        Object.defineProperty(projected, tokens / 2 - 1, { value: point, enumerable: true, writable: false, configurable: false })
        if (previous) {
          const tangent = connectorUnitTangent(previous, point)
          if (tangent) { lastTangent = Object.freeze(tangent); firstTangent ??= lastTangent }
        }
        if (rawPrevious) {
          const tangent = connectorUnitTangent(rawPrevious, rawPoint)
          if (tangent) { rawLastTangent = Object.freeze(tangent); rawFirstTangent ??= rawLastTangent }
        }
        previous = point
        rawPrevious = rawPoint
        rawX0 = Math.min(rawX0, rawX); rawY0 = Math.min(rawY0, original)
        rawX1 = Math.max(rawX1, rawX); rawY1 = Math.max(rawY1, original)
        if (tokens === 2) { rawStartX = rawX; rawStartY = original }
        rawEndX = rawX; rawEndY = original
      } : undefined)
      if (observed) {
        let served: Geometry | undefined = literal === points ? geometry : undefined
        if (changed && understood && tokens === pointCount * 2 && projected?.length === pointCount) {
          Object.defineProperty(projected, 'length', { writable: false })
          Object.preventExtensions(projected)
          const contour = Object.freeze({ start: projected[0]!, end: projected.at(-1)!, closed: false,
            ...(firstTangent ? { startTangent: firstTangent } : {}), ...(lastTangent ? { endTangent: lastTangent } : {}) })
          served = createWrittenPolyline(projected, { contours: Object.freeze([contour]), collapsed: !firstTangent,
            rawBounds: Object.freeze({ x0: rawX0, y0: rawY0, x1: rawX1, y1: rawY1 }),
            rawStart: Object.freeze({ x: rawStartX, y: rawStartY }), rawEnd: Object.freeze({ x: rawEndX, y: rawEndY }),
            ...(rawFirstTangent ? { rawStartTangent: rawFirstTangent } : {}), ...(rawLastTangent ? { rawEndTangent: rawLastTangent } : {}) })
        }
        observed(geometry, served)
      }
      return
    }
    case 'path': {
      const raw = geometry.d, literal = out.attribute('d', raw)
      sink?.(geometry, literal === raw ? geometry : { kind: 'path', d: literal })
    }
  }
}

/** Compound geometry writes one element per child, each with its own paint;
 * hooks, identity and ARIA go on the first. */
export function writeShapeSvg(node: ShapeMark, sink?: SvgGeometryWriteSink): string {
  const out = new SvgWriter()
  const compound = node.geometry.kind === 'compound'
  const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
  const report = compound ? undefined : sink?.rectangleAttributes
  const attributes: Record<string, string> | undefined = report ? Object.create(null) : undefined
  let attributeCount = 0, invalidAttributes = false
  const observe = attributes ? (name: string, literal: string): void => {
    if (++attributeCount > 14 || Object.hasOwn(attributes, name)) { invalidAttributes = true; return }
    attributes[name] = literal
  } : undefined
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!
    if (piece.kind === 'compound') throw new TypeError(`Shape "${node.id}" nests compound geometry`)
    if (index) out.raw('\n')
    out.raw(`<${piece.kind}`)
    if (index === 0) hooks(out, node.attributes)
    geometryAttributes(out, piece, sink)
    // Only the13 paint fields and one transform can enter this receipt.
    // Data/identity hooks stay outside the observed writer phase entirely.
    out.observeAttributes = observe
    paintAttributes(out, compound ? node.childPaints?.[index] ?? node.paint : node.paint)
    transformAttribute(out, node.transform)
    out.observeAttributes = undefined
    if (index === 0) identityAttributes(out, node.identity, node.accessibility)
    out.raw(' />')
  }
  report?.(node, invalidAttributes ? undefined : Object.freeze(attributes!))
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
export function writeConnectorSvg(node: ConnectorMark, sink?: SvgGeometryWriteSink): string {
  const out = new SvgWriter()
  const { stroke, markers } = node
  const dash = stroke.dash
  const midMarker = markers.mid[0]
  if (node.lineStyle !== 'invisible') {
    const geometry = node.route.geometry
    out.raw(`<${geometry.kind}`)
    hooks(out, node.attributes)
    geometryAttributes(out, geometry, sink)
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
