import type { ConnectorLabelDescriptor, ConnectorMark, Geometry, MarkAttributes, MarkPaint, SceneTransform, ShapeMark, TextMark } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { connectorInlineLabelText } from './bounds.ts'
import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'


/** Request-local SVG output. Limits count the UTF-8 encoding of the joined
 * string, including surrogate pairs split between writes; no byte buffers. */
export interface SvgWriterOptions {
  readonly maxBytes?: number
  readonly mode?: 'string' | 'chunks' | 'count'
}

export type SvgAttributeEscape = 'attribute' | 'xml' | 'safe'

/** A typed distinction lets the graphical owner retain its existing public
 * limit diagnostic without mistaking a smaller node limit for the final cap. */
export class SvgByteLimitError extends RangeError {
  constructor(readonly maxBytes: number) { super(`SVG serialization exceeds ${maxBytes} bytes`) }
}

interface WriterState {
  readonly maxBytes: number
  readonly mode: 'string' | 'chunks' | 'count'
  value: string
  chunks: string[]
  bytes: number
  highSurrogate: boolean
}

export class SvgWriter {
  private readonly state: WriterState
  private readonly parent?: SvgWriter
  private destination?: SvgWriter
  private readonly indentation: string
  private lineStart = true

  constructor(options: SvgWriterOptions = {}, parent?: SvgWriter, indentation = '') {
    const maxBytes = options.maxBytes ?? 5_000_000
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('SVG byte limit must be a non-negative safe integer')
    if (options.mode !== undefined && options.mode !== 'string' && options.mode !== 'chunks' && options.mode !== 'count') throw new TypeError('Unknown SVG writer mode')
    this.parent = parent
    this.indentation = indentation
    this.state = parent?.state ?? { maxBytes, mode: options.mode ?? 'string', value: '', chunks: [], bytes: 0, highSurrogate: false }
  }

  get bytes(): number { return this.state.bytes }

  /** Compatibility for native typed mark writers; the same bounded sink owns all bytes. */
  raw(value: string): void { this.write(value) }
  get value(): string { return this.finish() }

  write(value: string): void {
    if (typeof value !== 'string') throw new TypeError('SVG output chunks must be strings')
    if (this.parent) {
      if (value === '') return
      if (this.lineStart) { this.parent.write(this.indentation); this.lineStart = false }
      let start = 0
      for (;;) {
        const end = value.indexOf('\n', start)
        if (end < 0) { this.parent.write(value.slice(start)); return }
        this.parent.write(value.slice(start, end + 1))
        this.parent.write(this.indentation)
        start = end + 1
      }
    }
    const state = this.state
    let bytes = state.bytes
    let high = state.highSurrogate
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (high && code >= 0xdc00 && code <= 0xdfff) bytes += 1
      else if (code <= 0x7f) bytes += 1
      else if (code <= 0x7ff) bytes += 2
      else bytes += 3
      high = code >= 0xd800 && code <= 0xdbff
      if (bytes > state.maxBytes) throw new SvgByteLimitError(state.maxBytes)
    }
    // A node scope checks its unindented bytes before the outer sink receives
    // anything. The destination can itself be an indented/group scope view.
    if (this.destination) this.destination.write(value)
    state.bytes = bytes
    state.highSurrogate = high
    if (state.mode === 'chunks') { if (value) state.chunks.push(value) }
    else if (state.mode === 'string') state.value += value
  }

  /** Escape content, with attribute whitespace references when requested. */
  text(value: string, attribute = false): void {
    let start = 0
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      const replacement = code === 38 ? '&amp;' : code === 60 ? '&lt;' : code === 62 ? '&gt;' : code === 34 ? '&quot;' : code === 39 ? '&#39;'
        : attribute && code === 9 ? '&#9;' : attribute && code === 10 ? '&#10;' : attribute && code === 13 ? '&#13;' : undefined
      if (replacement !== undefined) {
        this.write(value.slice(start, index))
        this.write(replacement)
        start = index + 1
      }
    }
    this.write(value.slice(start))
  }

  /** Names are checked by the closed emission vocabulary before this call. */
  attribute(name: string, value: string | number, escape: SvgAttributeEscape = 'attribute'): void {
    this.write(` ${name}="`)
    if (typeof value === 'number') this.write(String(value))
    else this.attributeValue(value, escape)
    this.write('"')
  }

  /** The safe lexical profile preserves legacy validated root CSS exactly.
   * It cannot contain XML delimiters, and is not an unescaped-markup slot. */
  attributeValue(value: string, escape: SvgAttributeEscape = 'attribute'): void {
    if (escape === 'safe') {
      if (/[&<>"]/.test(value)) throw new TypeError('Safe SVG attribute values must not contain XML delimiters')
      this.write(value)
    } else if (escape === 'attribute' || escape === 'xml') this.text(value, escape === 'attribute')
    else throw new TypeError('Unsupported SVG attribute escaping')
  }

  /** A view sharing this request's sink and byte budget. Its first write and
   * every newline receive exactly the old indentLines prefix. */
  indented(spaces: number): SvgWriter {
    if (!Number.isSafeInteger(spaces) || spaces < 0 || spaces > 1_000_000) throw new TypeError('Invalid SVG indentation')
    return spaces === 0 ? this : new SvgWriter({}, this, ' '.repeat(spaces))
  }

  /** Count this node independently without retaining its string. Apply after
   * an indentation view so the node's cap excludes its parent's added spaces;
   * outer group/document scopes still count those actual emitted spaces. */
  scoped(maxBytes: number): SvgWriter {
    const scope = new SvgWriter({ maxBytes, mode: 'count' })
    scope.destination = this
    return scope
  }

  finish(): string {
    const state = this.state
    if (state.mode === 'count') throw new TypeError('A counting SVG writer has no retained output')
    return state.mode === 'chunks' ? state.chunks.join('') : state.value
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

/** Native marks are emitted from their admitted own fields. An absent optional
 * field must not become new input through a later prototype mutation. Own
 * accessors retain their original receiver and read at the existing call site. */
function own<T extends object, K extends keyof T>(value: T | undefined, key: K): T[K] | undefined {
  return value !== undefined && Object.hasOwn(value, key) ? value[key] : undefined
}

function hooks(out: SvgWriter, attributes: MarkAttributes | undefined): void {
  if (!attributes) return
  if (own(attributes, 'className')) out.attribute('class', own(attributes, 'className')!)
  if (own(attributes, 'data')) for (const key of Object.keys(own(attributes, 'data')!)) out.attribute(`data-${key}`, own(attributes, 'data')![key]!)
  if (own(attributes, 'ariaHidden')) out.attribute('aria-hidden', 'true')
  if (own(attributes, 'tabIndex') === 0) out.attribute('tabindex', 0)
  if (own(attributes, 'ariaLabel') !== undefined) out.attribute('aria-label', own(attributes, 'ariaLabel')!)
}

function paintAttributes(out: SvgWriter, paint: MarkPaint): void {
  if (own(paint, 'fill') !== undefined) out.attribute('fill', own(paint, 'fill')!)
  if (own(paint, 'fillOpacity') !== undefined) out.attribute('fill-opacity', own(paint, 'fillOpacity')!)
  if (own(paint, 'stroke') !== undefined) out.attribute('stroke', own(paint, 'stroke')!)
  if (own(paint, 'strokeOpacity') !== undefined) out.attribute('stroke-opacity', own(paint, 'strokeOpacity')!)
  if (own(paint, 'strokeWidth') !== undefined) out.attribute('stroke-width', own(paint, 'strokeWidth')!)
  if (own(paint, 'strokeDasharray') !== undefined) out.attribute('stroke-dasharray', own(paint, 'strokeDasharray')!)
  if (own(paint, 'strokeDashoffset') !== undefined) out.attribute('stroke-dashoffset', own(paint, 'strokeDashoffset')!)
  if (own(paint, 'strokeLinecap') !== undefined) out.attribute('stroke-linecap', own(paint, 'strokeLinecap')!)
  if (own(paint, 'strokeLinejoin') !== undefined) out.attribute('stroke-linejoin', own(paint, 'strokeLinejoin')!)
  if (own(paint, 'strokeMiterlimit') !== undefined) out.attribute('stroke-miterlimit', own(paint, 'strokeMiterlimit')!)
  if (own(paint, 'vectorEffect') !== undefined) out.attribute('vector-effect', own(paint, 'vectorEffect')!)
  if (own(paint, 'paintOrder') !== undefined) out.attribute('paint-order', own(paint, 'paintOrder')!)
  if (own(paint, 'opacity') !== undefined) out.attribute('opacity', own(paint, 'opacity')!)
}

function transformAttribute(out: SvgWriter, transform: SceneTransform | undefined): void {
  if (transform) out.attribute('transform', serializeTransform(transform))
}

/** Identity on the roles whose DOM contract carries it, then relation ARIA. */
function identityAttributes(out: SvgWriter, identity: SvgSemanticIdentity | undefined, accessibility: SvgSemanticAccessibility | undefined): void {
  if (identity && hasDomSvgIdentityRole(identity.role)) {
    out.attribute('data-id', identity.id)
    out.attribute('data-role', identity.role)
    if (own(identity, 'from') !== undefined) out.attribute('data-from', own(identity, 'from')!)
    if (own(identity, 'to') !== undefined) out.attribute('data-to', own(identity, 'to')!)
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
      if (own(geometry, 'rx') !== undefined) out.attribute('rx', own(geometry, 'rx')!)
      if (own(geometry, 'ry') !== undefined) out.attribute('ry', own(geometry, 'ry')!)
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
    if (index === 0) hooks(out, own(node, 'attributes'))
    geometryAttributes(out, piece)
    paintAttributes(out, compound ? own(node, 'childPaints')?.[index] ?? node.paint : node.paint)
    transformAttribute(out, own(node, 'transform'))
    if (index === 0) identityAttributes(out, own(node, 'identity'), own(node, 'accessibility'))
    out.raw(' />')
  }
  return out.value
}

function typographyAttributes(out: SvgWriter, node: TextMark): void {
  out.attribute('text-anchor', node.anchor)
  if (own(node, 'dominantBaseline')) out.attribute('dominant-baseline', own(node, 'dominantBaseline')!)
  // A block measured in a named face is drawn in it; otherwise the document font applies.
  if (own(own(node, 'block'), 'fontFamily')) out.attribute('font-family', own(own(node, 'block'), 'fontFamily')!)
  out.attribute('font-size', node.fontSize)
  out.attribute('font-weight', own(node, 'fontWeight') ?? own(node, 'block')?.fontWeight ?? 400)
  if ((own(node, 'letterSpacing') ?? 0) !== 0) out.attribute('letter-spacing', own(node, 'letterSpacing')!)
  if (own(node, 'fontStyle')) out.attribute('font-style', own(node, 'fontStyle')!)
  if (own(node, 'textDecoration')) out.attribute('text-decoration', own(node, 'textDecoration')!)
}

/** Text goes through the shared multi-line writer, which owns line wrappers,
 * prepared runs and fitted advances. A fallback-measured mark is written from
 * its source text, as families wrote unprepared labels. */
export function writeTextSvg(node: TextMark): string {
  const out = new SvgWriter()
  hooks(out, own(node, 'attributes'))
  typographyAttributes(out, node)
  paintAttributes(out, node.paint)
  transformAttribute(out, own(node, 'transform'))
  identityAttributes(out, own(node, 'identity'), own(node, 'accessibility'))
  const attrs = out.value.slice(1)
  const prepared = own(node, 'measurement') === 'prepared' && own(node, 'block')
  const svg = renderMultilineText(prepared ? own(node, 'block')! : node.text, node.x, node.y, node.fontSize, attrs, own(node, 'baselineShift') ?? 0.35, own(node, 'display') === 'literal')
  if (!own(node, 'spans')) return svg
  const shown = prepared ? own(node, 'block')!.text : node.text
  const content = `>${escapeXml(shown)}</text>`
  if (!svg.endsWith(content)) throw new TypeError(`Text "${node.id}" spans require a one-line label`)
  let spans = ''
  for (const span of own(node, 'spans')!) spans += `<tspan fill="${escapeAttr(span.fill)}">${escapeXml(span.text)}</tspan>`
  return `${svg.slice(0, -content.length)}>${spans}</text>`
}

function connectorInlineLabelSvg(node: ConnectorMark, label: ConnectorLabelDescriptor, index: number): string | undefined {
  if (own(label, 'visual')?.kind !== 'inline') return undefined
  if (!own(label, 'anchor') || !own(label, 'paint') || own(label, 'fontSize') === undefined || own(label, 'textAnchor') === undefined) {
    throw new TypeError(`Connector "${node.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
  }
  const block = connectorInlineLabelText(label)
  const paint: MarkPaint = {
    ...own(label, 'paint')!,
    ...(own(label, 'halo') ? {
      stroke: own(own(label, 'halo'), 'color') ?? 'var(--bg)',
      strokeWidth: String(own(label, 'halo')!.width),
      paintOrder: 'stroke fill',
    } : {}),
  }
  const out = new SvgWriter()
  out.attribute('data-id', own(label, 'id') ?? `${node.id}-label-${index + 1}`)
  out.attribute('data-role', 'label')
  out.attribute('data-connector-label-for', node.id)
  out.attribute('font-size', block.fontSize)
  out.attribute('font-weight', block.fontWeight)
  if (block.letterSpacing) out.attribute('letter-spacing', block.letterSpacing)
  out.attribute('text-anchor', own(label, 'textAnchor')!)
  transformAttribute(out, own(node, 'transform'))
  paintAttributes(out, paint)
  return renderMultilineText(block, own(label, 'anchor')!.x, own(label, 'anchor')!.y - Math.max(0, own(label, 'clearance') ?? 0), block.fontSize, out.value.slice(1), 0)
}

/** A connector is one marker carrier element plus any labels it owns; an
 * invisible connector draws its labels without the carrier. SVG defaults
 * (butt caps, miter joins, limit 4) are left implicit. */
export function writeConnectorSvg(node: ConnectorMark): string {
  const out = new SvgWriter()
  const { stroke, markers } = node
  const dash = own(stroke, 'dash')
  const midMarker = own(markers.mid, 0)
  if (node.lineStyle !== 'invisible') {
    const geometry = node.route.geometry
    out.raw(`<${geometry.kind}`)
    hooks(out, own(node, 'attributes'))
    geometryAttributes(out, geometry)
    if (geometry.kind !== 'line') out.attribute('fill', 'none')
    out.attribute('stroke', stroke.color)
    if (own(stroke, 'opacity') !== undefined) out.attribute('stroke-opacity', own(stroke, 'opacity')!)
    out.attribute('stroke-width', stroke.width)
    if (dash) out.attribute('stroke-dasharray', typeof dash.array === 'string' ? dash.array : dash.array.join(' '))
    if (own(dash, 'offset') !== undefined) out.attribute('stroke-dashoffset', own(dash, 'offset')!)
    if (stroke.lineCap !== 'butt') out.attribute('stroke-linecap', stroke.lineCap)
    if (stroke.lineJoin !== 'miter') out.attribute('stroke-linejoin', stroke.lineJoin)
    if (stroke.miterLimit !== 4) out.attribute('stroke-miterlimit', stroke.miterLimit)
    if (own(stroke, 'pathLength') !== undefined) out.attribute('pathLength', own(stroke, 'pathLength')!)
    if (own(stroke, 'paintOrder') !== undefined) out.attribute('paint-order', own(stroke, 'paintOrder')!)
    if (own(stroke, 'nonScaling')) out.attribute('vector-effect', 'non-scaling-stroke')
    if (own(stroke, 'mixBlendMode')) out.attribute('style', `mix-blend-mode:${own(stroke, 'mixBlendMode')}`)
    if (own(markers, 'start')) out.attribute('marker-start', `url(#${own(markers, 'start')!.id})`)
    if (midMarker) out.attribute('marker-mid', `url(#${midMarker.id})`)
    if (own(markers, 'end')) out.attribute('marker-end', `url(#${own(markers, 'end')!.id})`)
    if (node.hit.pointerEvents === 'none') out.attribute('pointer-events', 'none')
    transformAttribute(out, own(node, 'transform'))
    out.attribute('data-relationship', node.relationship.kind)
    out.attribute('data-direction', node.relationship.direction)
    identityAttributes(out, own(node, 'identity'), own(node, 'accessibility'))
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
