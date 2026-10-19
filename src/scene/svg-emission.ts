import { formatPercent1 } from '../shared/percent-format.ts'
import { isSafeInlinePaintValue } from '../shared/inline-paint-value.ts'
import type { SvgTextWhitespaceEdit } from './svg-text-whitespace.ts'
/** Private SVG projection recipes. Recipes describe lexical presentation,
 * never a second copy of mark geometry, text, or paint. No markup or executable
 * value can enter this vocabulary. Public Scene contracts stay in ir.ts. */
import type { DiagramColors } from '../theme.ts'
import type { Geometry, MarkPaint, SceneNode, SemanticChannelName, TextMark, DocumentMark } from './ir.ts'
import { SEMANTIC_CHANNEL_NAMES } from './ir.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import { serializeTransform } from './transforms.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { serializeLinearGradientResources } from './gradient-resources.ts'
import { serializeMarkerResources } from './marker-resources.ts'
import { SvgWriter, type SvgWriterOptions, type SvgAttributeEscape } from './svg-writer.ts'

export type SvgNumberFormat = 'exact' | 'round2' | 'round3' | 'percent1'
export type SvgGeometryField = 'x' | 'y' | 'width' | 'height' | 'rx' | 'ry' | 'cx' | 'cy' | 'r' | 'x1' | 'y1' | 'x2' | 'y2' | 'd' | 'points'
export type SvgTextField = 'text' | 'source' | 'x' | 'y' | 'fontSize' | 'fontWeight' | 'letterSpacing' | 'anchor'
export type SvgConnectorField = 'color' | 'width' | 'opacity' | 'mixBlendMode' | 'pathLength' | 'lineCap' | 'lineJoin' | 'miterLimit' | 'lineStyle' | 'relationshipKind' | 'direction'
export type SvgCssProperty = 'mix-blend-mode' | 'fill' | 'stroke' | 'stroke-width' | 'stroke-dasharray' | 'opacity'
  | '--tl-accent' | '--tl-fill' | '--tl-label' | '--tl-line' | '--tl-section-bg' | '--tl-section-band'
  | '--tl-pill-fill' | '--tl-pill-stroke' | '--tl-event-fill'

export interface SvgCssDeclaration {
  readonly property: SvgCssProperty
  readonly value: SvgValue
  /** Preserved authored declaration overridden by a later typed paint value. */
  readonly shadowed?: true
}

export type SvgValue =
  | { readonly source: 'geometry'; readonly field: SvgGeometryField; readonly piece?: number }
  | { readonly source: 'paint'; readonly field: keyof MarkPaint; readonly piece?: number }
  | { readonly source: 'text'; readonly field: SvgTextField }
  | { readonly source: 'identity'; readonly field: keyof SvgSemanticIdentity }
  | { readonly source: 'accessibility'; readonly field: 'label' | 'role' | 'roleDescription' }
  | { readonly source: 'connector'; readonly field: SvgConnectorField }
  | { readonly source: 'channel'; readonly field: SemanticChannelName }
  | { readonly source: 'transform' }
  | { readonly source: 'marker'; readonly position: 'start' | 'mid' | 'end' }
  | { readonly source: 'connectorLabel'; readonly index: number }
  | { readonly source: 'colorMix'; readonly primary: SvgValue; readonly secondary: SvgValue; readonly amount: number }
  | { readonly source: 'document'; readonly field: 'text' | 'domId' }
  | { readonly source: 'style'; readonly declarations: readonly SvgCssDeclaration[] }
  /** Only extra family metadata or presentation values absent from Scene IR.
   * Semantic attributes must use the corresponding projection source. */
  | { readonly source: 'metadata'; readonly value: string | number | boolean }

export type SvgAttributeName =
  | SvgGeometryField | 'class' | 'id' | 'role' | 'tabindex' | 'transform'
  | 'fill' | 'fill-opacity' | 'stroke' | 'stroke-width' | 'stroke-opacity'
  | 'stroke-dasharray' | 'stroke-dashoffset' | 'stroke-linecap' | 'stroke-linejoin' | 'stroke-miterlimit'
  | 'vector-effect' | 'paint-order' | 'opacity' | 'style' | 'pathLength'
  | 'font-size' | 'font-weight' | 'font-family' | 'font-style' | 'letter-spacing'
  | 'text-anchor' | 'dominant-baseline' | 'alignment-baseline' | 'dy' | 'dx'
  | 'text-decoration' | 'textLength' | 'lengthAdjust' | 'xml:space'
  | 'pointer-events' | 'visibility' | 'display' | 'cursor'
  | 'marker-start' | 'marker-mid' | 'marker-end'
  | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-roledescription' | 'aria-hidden'
  | `data-${string}`

export interface SvgAttribute {
  readonly name: SvgAttributeName
  readonly value: SvgValue
  readonly format?: SvgNumberFormat
  readonly omit?: 'undefined' | 'zero' | 'false' | 'empty'
  readonly fallback?: string | number
  /** Existing display metadata sanitizes controls separately from IDs. */
  readonly display?: boolean
  readonly escape?: SvgAttributeEscape
  /** Attribute separators are whitespace only; never markup. */
  readonly before?: ' ' | '\n' | '\n  '
}

export interface SvgPiecePresentation {
  /** Per-piece overrides missing from the public compound mark paint. */
  readonly paint?: MarkPaint
}

export interface SvgPrimitiveEmission {
  readonly kind: 'primitive'
  readonly piece?: number
  readonly attributes: readonly SvgAttribute[]
  readonly close?: ' />' | '/>' | '></' // paired primitive closing tag
  readonly pieces?: readonly SvgPiecePresentation[]
}

export interface SvgDocumentTextEmission {
  readonly kind: 'documentText'
  readonly element: 'title' | 'desc'
  readonly text?: string
  readonly domId?: string
}

export interface SvgGroupEmission {
  readonly kind: 'group'
  readonly attributes: readonly SvgAttribute[]
  readonly prefix?: readonly SvgDocumentTextEmission[]
}

export interface SvgTextEmission {
  readonly kind: 'text'
  readonly attributes: readonly SvgAttribute[]
  /** Identity/accessibility added after generated text-layout attributes. */
  readonly tailAttributes?: readonly SvgAttribute[]
  readonly layout: 'multiline' | 'direct'
  readonly baselineShift?: number
  readonly dy?: string | number
  /** Literal syntax highlighting slices refer to the semantic text, never a
   * second text/markup authority. Prepared shaping keeps priority. */
  readonly spans?: readonly { readonly start: number; readonly end: number; readonly attributes: readonly SvgAttribute[] }[]
  readonly content?: 'text' | 'source'
  readonly whitespace?: readonly SvgTextWhitespaceEdit[]
}

export interface SvgStylesheetEmission {
  readonly kind: 'stylesheet'
  /** Admitted CSS text is a supported input, not an SVG fragment. */
  readonly css: string
}

export interface SvgSharedStyleEmission { readonly kind: 'sharedStyle' }
export interface SvgShadowEmission {
  readonly kind: 'shadow'
  readonly wrap?: boolean
  /** Standalone definitions need their own palette; prelude children can use
   * their enclosing document palette instead. */
  readonly colors: DiagramColors
}

export interface SvgPreludeEmission {
  readonly kind: 'prelude'
  readonly width: number
  readonly height: number
  readonly colors: DiagramColors
  readonly transparent: boolean
  readonly font: string
  readonly hasMonoFont: boolean
  readonly widthAttribute?: string
  readonly heightAttribute?: string
  readonly extraStyle?: string
  readonly attributes?: readonly SvgAttribute[]
  /** Typed ordered furniture preserves each family's historical order. */
  readonly children: readonly (SvgSharedStyleEmission | SvgShadowEmission | SvgDocumentTextEmission | SvgStylesheetEmission)[]
  readonly join?: '' | '\n'
}

export interface SvgResourcesEmission {
  readonly kind: 'resources'
  readonly resources: readonly ('markers' | 'gradients' | SvgShadowEmission)[]
  readonly indent?: number
  readonly join?: '' | '\n'
  readonly layout?: 'inline' | 'block'
}

export type SvgEmissionRecipe = SvgPrimitiveEmission | SvgGroupEmission | SvgTextEmission | SvgDocumentTextEmission
  | SvgPreludeEmission | SvgResourcesEmission | SvgStylesheetEmission
  | { readonly kind: 'close' }
  | { readonly kind: 'connectorLabels' }
  | { readonly kind: 'sequence'; readonly children: readonly SvgEmissionRecipe[]; readonly join?: '' | '\n' }

/** Short constructors keep family recipes readable without accepting paths or
 * callbacks. They intentionally return data, never serialization closures. */
export const svgValue = Object.freeze({
  geometry: (field: SvgGeometryField, piece?: number): SvgValue => ({ source: 'geometry', field, ...(piece === undefined ? {} : { piece }) }),
  paint: (field: keyof MarkPaint, piece?: number): SvgValue => ({ source: 'paint', field, ...(piece === undefined ? {} : { piece }) }),
  text: (field: SvgTextField): SvgValue => ({ source: 'text', field }),
  identity: (field: keyof SvgSemanticIdentity): SvgValue => ({ source: 'identity', field }),
  accessibility: (field: 'label' | 'role' | 'roleDescription'): SvgValue => ({ source: 'accessibility', field }),
  connector: (field: SvgConnectorField): SvgValue => ({ source: 'connector', field }),
  channel: (field: SemanticChannelName): SvgValue => ({ source: 'channel', field }),
  transform: (): SvgValue => ({ source: 'transform' }),
  document: (field: 'text' | 'domId'): SvgValue => ({ source: 'document', field }),
  meta: (value: string | number | boolean): SvgValue => ({ source: 'metadata', value }),
})

/** Engine functions, not recipe data. Callers are the shared backend and typed
 * theme/text implementations, never a family-supplied recipe callback. */
export interface SvgEmissionContext {
  readonly writeChild?: (node: SceneNode, writer: SvgWriter) => void
  readonly writeText?: (node: TextMark, recipe: SvgTextEmission, writer: SvgWriter) => void
  readonly writePrelude?: (node: DocumentMark, recipe: SvgPreludeEmission, writer: SvgWriter) => void
  readonly writeShadow?: (recipe: SvgShadowEmission, writer: SvgWriter) => void
  readonly writeConnectorLabels?: (node: SceneNode, writer: SvgWriter) => void
}

const GEOMETRY_NAMES = new Set<string>(['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'd', 'points'])
const PAINT_FIELDS = new Set<string>(['fill', 'stroke', 'strokeWidth', 'strokeDasharray', 'strokeDashoffset', 'strokeLinecap', 'strokeLinejoin', 'strokeMiterlimit', 'vectorEffect', 'paintOrder', 'opacity'])
const ATTRIBUTE_NAMES = new Set<string>([
  ...GEOMETRY_NAMES, 'class', 'id', 'role', 'tabindex', 'transform',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'vector-effect', 'paint-order', 'opacity', 'style', 'pathLength', 'font-size', 'font-weight', 'font-family', 'font-style', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'dy', 'dx', 'text-decoration', 'textLength', 'lengthAdjust', 'xml:space',
  'pointer-events', 'visibility', 'display', 'cursor', 'marker-start', 'marker-mid', 'marker-end',
  'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-roledescription', 'aria-hidden',
])

function geometryOf(node: SceneNode, piece?: number): Exclude<Geometry, { kind: 'compound' }> {
  if (piece !== undefined && (!Number.isSafeInteger(piece) || piece < 0)) throw new TypeError('SVG geometry piece must be a non-negative safe integer')
  const geometry = node.kind === 'shape' ? node.geometry : node.kind === 'connector' ? node.route.geometry : undefined
  if (!geometry) throw new TypeError(`Scene ${node.id} has no primitive geometry`)
  if (geometry.kind !== 'compound') {
    if (piece !== undefined && piece !== 0) throw new TypeError(`Scene ${node.id} has no geometry piece ${piece}`)
    return geometry
  }
  const selected = geometry.children[piece ?? 0]
  if (!selected || selected.kind === 'compound') throw new TypeError(`Scene ${node.id} requires a primitive geometry piece`)
  return selected
}

function numberString(value: number, format: SvgNumberFormat | undefined): string {
  if (!Number.isFinite(value)) throw new TypeError('SVG numbers must be finite')
  if (format === 'percent1') return formatPercent1(value)
  if (format !== undefined && format !== 'exact' && format !== 'round2' && format !== 'round3') throw new TypeError('Unsupported SVG number format')
  const scale = format === 'round2' ? 100 : format === 'round3' ? 1000 : undefined
  return String(scale === undefined ? value : Math.round(value * scale) / scale)
}

/** Resolve only declared semantic fields; no caller-selected property paths. */
export function svgEmissionValue(node: SceneNode, value: SvgValue, recipe?: SvgPrimitiveEmission, format?: SvgNumberFormat): string | number | boolean | undefined {
  switch (value.source) {
    case 'geometry': {
      if (!GEOMETRY_NAMES.has(value.field)) throw new TypeError(`Unsupported SVG geometry field ${value.field}`)
      const geometry = geometryOf(node, value.piece ?? recipe?.piece)
      if (value.field === 'points' && (geometry.kind === 'polygon' || geometry.kind === 'polyline')) return geometry.points.map(point => `${numberString(point.x, format)},${numberString(point.y, format)}`).join(' ')
      const result = (geometry as unknown as Record<string, unknown>)[value.field]
      if (result === undefined || typeof result === 'number' || typeof result === 'string') return result
      throw new TypeError(`Invalid geometry field ${value.field}`)
    }
    case 'paint': {
      if (!PAINT_FIELDS.has(value.field)) throw new TypeError(`Unsupported SVG paint field ${value.field}`)
      const paint = node.kind === 'shape' || node.kind === 'text' ? node.paint : undefined
      const override = recipe?.pieces?.[value.piece ?? recipe.piece ?? 0]?.paint
      const direct = override?.[value.field] ?? paint?.[value.field]
      if (direct !== undefined || node.kind !== 'connector') return direct
      switch (value.field) {
        case 'fill': return 'none'
        case 'stroke': return node.stroke.color
        case 'strokeWidth': return node.stroke.width
        case 'opacity': return node.stroke.opacity
        case 'paintOrder': return node.stroke.paintOrder
        case 'strokeLinecap': return node.stroke.lineCap
        case 'strokeLinejoin': return node.stroke.lineJoin
        case 'strokeMiterlimit': return node.stroke.miterLimit
        case 'strokeDasharray': return Array.isArray(node.stroke.dash?.array) ? node.stroke.dash.array.join(' ') : node.stroke.dash?.array as string | undefined
        case 'strokeDashoffset': return node.stroke.dash?.offset
        case 'vectorEffect': return node.stroke.nonScaling ? 'non-scaling-stroke' : undefined
      }
      return undefined
    }
    case 'text': return node.kind === 'text' ? value.field === 'source' ? node.block?.prepared.source ?? node.text : node[value.field] : undefined
    case 'identity': {
      const result = node.identity?.[value.field]
      return Array.isArray(result) ? result.join(' ') : result as string | undefined
    }
    case 'accessibility': return node.accessibility?.[value.field]
    case 'channel': return node.channels?.[value.field]
    case 'transform': return node.transform ? serializeTransform(node.transform) : undefined
    case 'marker': {
      if (node.kind !== 'connector') return undefined
      const marker = value.position === 'mid' ? node.markers.mid[0] : node.markers[value.position]
      return marker ? `url(#${marker.id})` : undefined
    }
    case 'connectorLabel': return node.kind === 'connector' ? node.labels[value.index]?.text : undefined
    case 'colorMix': return `color-mix(in srgb, ${svgEmissionValue(node, value.primary, recipe)} ${value.amount}%, ${svgEmissionValue(node, value.secondary, recipe)})`
    case 'document': return node.kind === 'document' ? node[value.field] : undefined
    case 'style': {
      let result = ''
      let finalValues: Map<SvgCssProperty, string | number | boolean | undefined> | undefined
      if (value.declarations.some(declaration => declaration.shadowed)) {
        finalValues = new Map()
        for (const declaration of value.declarations) if (!declaration.shadowed) finalValues.set(declaration.property, svgEmissionValue(node, declaration.value, recipe))
      }
      for (const declaration of value.declarations) {
        if (declaration.shadowed && finalValues?.get(declaration.property) === undefined) throw new TypeError('Shadowed paint requires a defined final semantic value')
        const projected = svgEmissionValue(node, declaration.value, recipe)
        if (projected !== undefined) result += `${result ? ';' : ''}${declaration.property}:${projected}`
      }
      return result
    }
    case 'metadata':
      if (typeof value.value !== 'string' && typeof value.value !== 'number' && typeof value.value !== 'boolean') throw new TypeError('SVG metadata must be scalar data')
      return value.value
    case 'connector': {
      if (node.kind !== 'connector') return undefined
      switch (value.field) {
        case 'lineStyle': return node.lineStyle
        case 'relationshipKind': return node.relationship.kind
        case 'direction': return node.relationship.direction
        case 'color': case 'width': case 'opacity': case 'mixBlendMode': case 'pathLength': case 'lineCap': case 'lineJoin': case 'miterLimit': return node.stroke[value.field]
        default: throw new TypeError('Unsupported SVG connector field')
      }
    }
    default: throw new TypeError('Unsupported SVG value projection')
  }
}

export function writeSvgAttributes(node: SceneNode, attributes: readonly SvgAttribute[], writer: SvgWriter, recipe?: SvgPrimitiveEmission): void {
  if (attributes.length > 256) throw new RangeError('SVG elements may declare at most 256 attributes')
  for (const attribute of attributes) {
    if (!ATTRIBUTE_NAMES.has(attribute.name) && !/^data-[a-zA-Z0-9_.:-]+$/.test(attribute.name)) throw new TypeError(`Unsupported SVG attribute ${attribute.name}`)
    if (GEOMETRY_NAMES.has(attribute.name)) {
      if (attribute.value.source !== 'geometry' && !(node.kind === 'text' && attribute.value.source === 'text')) throw new TypeError(`SVG ${attribute.name} must project typed geometry`)
      if (attribute.value.field !== attribute.name) throw new TypeError(`SVG ${attribute.name} must project its matching semantic field`)
      if (attribute.value.source === 'geometry' && recipe && attribute.value.piece !== undefined && attribute.value.piece !== (recipe.piece ?? 0)) throw new TypeError('SVG primitive coordinates must project their own geometry piece')
    }
    let value = svgEmissionValue(node, attribute.value, recipe, attribute.format) ?? attribute.fallback
    if (value === undefined || attribute.omit === 'zero' && (value === 0 || value === '0') || attribute.omit === 'false' && value === false || attribute.omit === 'empty' && value === '') continue
    if (typeof value === 'number') value = numberString(value, attribute.format)
    let text = String(value)
    if (attribute.display) text = sanitizeDisplayLines(text)
    const before = attribute.before ?? ' '
    if (before !== ' ' && before !== '\n' && before !== '\n  ') throw new TypeError('Unsupported SVG attribute whitespace')
    writer.write(before)
    writer.write(`${attribute.name}="`)
    writer.attributeValue(text, attribute.escape)
    writer.write('"')
  }
}

function writeDocumentText(node: SceneNode, recipe: SvgDocumentTextEmission, writer: SvgWriter): void {
  if (recipe.element !== 'title' && recipe.element !== 'desc') throw new TypeError('Unsupported SVG document text element')
  writer.write(`<${recipe.element}`)
  const domId = recipe.domId ?? (node.kind === 'document' ? node.domId : undefined)
  if (domId) writer.attribute('id', domId)
  writer.write('>')
  writer.text(recipe.text ?? (node.kind === 'document' ? node.text : undefined) ?? '')
  writer.write(`</${recipe.element}>`)
}

function separator(value: '' | '\n' | undefined, defaultValue: '' | '\n' = '\n'): '' | '\n' {
  if (value !== undefined && value !== '' && value !== '\n') throw new TypeError('Unsupported SVG emission separator')
  return value ?? defaultValue
}

export function writeSvgGroupOpen(node: SceneNode, recipe: SvgGroupEmission, writer: SvgWriter): void {
  writer.write('<g')
  writeSvgAttributes(node, recipe.attributes, writer)
  writer.write('>')
  for (const prefix of recipe.prefix ?? []) writeDocumentText(node, prefix, writer)
}

export function writeSvgEmission(node: SceneNode, recipe: SvgEmissionRecipe, writer: SvgWriter, context: SvgEmissionContext = {}, depth = 0): void {
  if (depth > 64) throw new RangeError('SVG emission nesting exceeds 64')
  switch (recipe.kind) {
    case 'primitive': {
      const tag = geometryOf(node, recipe.piece).kind
      writer.write(`<${tag}`)
      writeSvgAttributes(node, recipe.attributes, writer, recipe)
      const close = recipe.close ?? ' />'
      if (close !== ' />' && close !== '/>' && close !== '></') throw new TypeError('Unsupported SVG primitive closing mode')
      writer.write(close === '></' ? `></${tag}>` : close)
      return
    }
    case 'group': {
      if (node.kind !== 'group' || !context.writeChild) throw new TypeError('SVG group requires typed children and an engine child writer')
      if (typeof node.join !== 'string' || !/^\s*$/.test(node.join)) throw new TypeError('SVG group separators must be whitespace')
      writeSvgGroupOpen(node, recipe, writer)
      for (const child of node.children) {
        writer.write(node.join)
        const childWriter = writer.indented(child.indent)
        context.writeChild(child.node, childWriter)
      }
      writer.write(node.join)
      writer.write('</g>')
      return
    }
    case 'text':
      if (node.kind !== 'text' || !context.writeText) throw new TypeError('SVG text requires the shared typed text writer')
      context.writeText(node, recipe, writer)
      return
    case 'prelude':
      if (node.kind !== 'document' || !context.writePrelude) throw new TypeError('SVG prelude requires the shared typed document writer')
      context.writePrelude(node, recipe, writer)
      return
    case 'resources': {
      if (node.kind !== 'document') throw new TypeError('SVG resources require a document mark')
      if (recipe.layout !== undefined && recipe.layout !== 'inline' && recipe.layout !== 'block') throw new TypeError('Unsupported SVG resources layout')
      writer.write(recipe.layout === 'inline' ? '<defs>' : '<defs>\n')
      for (let index = 0; index < recipe.resources.length; index++) {
        if (index) writer.write(separator(recipe.join))
        const resource = recipe.resources[index]!
        if (resource === 'markers') writer.write(serializeMarkerResources(node.markerResources ?? [], { indent: recipe.indent }))
        else if (resource === 'gradients') writer.write(serializeLinearGradientResources(node.gradientResources ?? [], { indent: recipe.indent }))
        else if (resource.kind === 'shadow') {
          if (!context.writeShadow) throw new TypeError('SVG shadows require the shared typed shadow writer')
          context.writeShadow(resource, writer)
        } else throw new TypeError('Unsupported SVG resource projection')
      }
      writer.write(recipe.layout === 'inline' ? '</defs>' : '\n</defs>')
      return
    }
    case 'documentText': writeDocumentText(node, recipe, writer); return
    case 'stylesheet':
      // Only private source-owned CSS enters here. Public raw themeCSS keeps
      // its existing admission policy; final output security still runs last.
      writer.write('<style>'); writer.write(recipe.css); writer.write('</style>'); return
    case 'close': writer.write('</svg>'); return
    case 'connectorLabels':
      if (node.kind !== 'connector' || !context.writeConnectorLabels) throw new TypeError('Connector labels require their shared typed writer')
      context.writeConnectorLabels(node, writer); return
    case 'sequence':
      for (let index = 0; index < recipe.children.length; index++) {
        if (index) writer.write(separator(recipe.join))
        writeSvgEmission(node, recipe.children[index]!, writer, context, depth + 1)
      }
      return
    default: throw new TypeError('Unsupported SVG emission recipe')
  }
}

export function serializeSvgEmission(node: SceneNode, recipe: SvgEmissionRecipe, context: SvgEmissionContext = {}, options: SvgWriterOptions = {}): string {
  const writer = new SvgWriter(options)
  writeSvgEmission(node, recipe, writer, context)
  return writer.finish()
}

/** Exact dry-run, sharing every escaping/number/indent branch with output. It
 * retains no whole-node string, including when the output is close to a cap. */
export function measureSvgEmission(node: SceneNode, recipe: SvgEmissionRecipe, context: SvgEmissionContext = {}, maxBytes = 5_000_000): number {
  const writer = new SvgWriter({ mode: 'count', maxBytes })
  writeSvgEmission(node, recipe, writer, context)
  return writer.bytes
}

export interface SvgEmissionMetadataCounts {
  readonly objects: number
  readonly properties: number
  readonly arrayEntries: number
  readonly textBytes: number
  readonly propertyKeyBytes: number
}

export interface SvgEmissionMetadataLimits {
  readonly maxDepth: number
  readonly maxObjects: number
  readonly maxProperties: number
  readonly maxArrayEntries: number
  readonly maxTextBytes: number
  readonly maxPropertyKeyBytes: number
}

/** Private data participates in admission rather than disappearing behind a
 * WeakMap. These match the existing enclosing first-party data ceilings; the
 * serializer separately enforces the exact per-node/final output budgets. */
export const SVG_EMISSION_METADATA_LIMITS: SvgEmissionMetadataLimits = Object.freeze({
  maxDepth: 64, maxObjects: 400_000, maxProperties: 1_600_000,
  maxArrayEntries: 1_600_000, maxTextBytes: 5_000_000, maxPropertyKeyBytes: 5_000_000,
})

const RECIPE_COUNTS = new WeakMap<object, SvgEmissionMetadataCounts>()
const CANONICAL_RECIPES = new WeakSet<object>()

/** Descriptor-copy before validation: getters/iterators never run, cycles are
 * rejected, aliases remain aliases, and freezing never touches caller data.
 * This helper is for private recipes, not a replacement for external Scene
 * snapshot admission. Callers must aggregate the returned accounting too. */
export function snapshotSvgEmissionRecipe(recipe: SvgEmissionRecipe, limits: SvgEmissionMetadataLimits = SVG_EMISSION_METADATA_LIMITS): SvgEmissionRecipe {
  // Family-wide constant recipes can be snapshotted once and safely reused.
  // Never cache a caller-owned mutable input or assume a shallow freeze is deep.
  if (limits === SVG_EMISSION_METADATA_LIMITS && recipe && CANONICAL_RECIPES.has(recipe)) return recipe
  for (const key of ['maxDepth', 'maxObjects', 'maxProperties', 'maxArrayEntries', 'maxTextBytes', 'maxPropertyKeyBytes'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new TypeError('SVG metadata limits must be non-negative safe integers')
  }
  const counts = { objects: 0, properties: 0, arrayEntries: 0, textBytes: 0, propertyKeyBytes: 0 }
  const snapshots = new WeakMap<object, object>()
  const active = new WeakSet<object>()
  const text = (value: string, key = false): void => {
    const field = key ? 'propertyKeyBytes' : 'textBytes'
    const maximum = key ? limits.maxPropertyKeyBytes : limits.maxTextBytes
    const remaining = maximum - counts[field]
    const bytes = boundedUtf8ByteLength(value, remaining)
    if (bytes > remaining) throw new RangeError(`SVG emission metadata exceeds ${field} budget`)
    counts[field] += bytes
  }
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > limits.maxDepth) throw new RangeError('SVG emission metadata exceeds depth budget')
    if (typeof value === 'string') { text(value); return value }
    if (value === undefined || value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('SVG emission metadata numbers must be finite')
      return value
    }
    if (typeof value !== 'object') throw new TypeError('SVG emission metadata must be plain data')
    if (active.has(value)) throw new TypeError('SVG emission metadata must not contain cycles')
    const prior = snapshots.get(value)
    if (prior) return prior
    if (++counts.objects > limits.maxObjects) throw new RangeError('SVG emission metadata exceeds object budget')
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new TypeError('SVG emission metadata must use plain objects and arrays')
    const keys = Reflect.ownKeys(value)
    if (keys.length > limits.maxProperties - counts.properties + (array ? 1 : 0)) throw new RangeError('SVG emission metadata exceeds property budget')
    const result: Record<string, unknown> | unknown[] = array ? [] : {}
    let arrayLength = 0
    if (array) {
      const length = Reflect.getOwnPropertyDescriptor(value, 'length')
      if (!length || !('value' in length) || typeof length.value !== 'number' || !Number.isSafeInteger(length.value) || length.value < 0) throw new TypeError('Invalid SVG metadata array length')
      if (length.value > limits.maxArrayEntries - counts.arrayEntries) throw new RangeError('SVG emission metadata exceeds array budget')
      counts.arrayEntries += length.value
      arrayLength = length.value
      if (keys.length !== length.value + 1) throw new TypeError('SVG emission metadata arrays must be dense without custom properties')
    }
    snapshots.set(value, result)
    active.add(value)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string' || array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= arrayLength)) throw new TypeError('SVG emission metadata must not contain symbol or custom array keys')
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('SVG emission metadata requires enumerable data properties')
      if (++counts.properties > limits.maxProperties) throw new RangeError('SVG emission metadata exceeds property budget')
      text(key, true)
      Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
    }
    active.delete(value)
    return Object.freeze(result)
  }
  const snapshot = visit(recipe, 0) as SvgEmissionRecipe
  validateSvgEmissionRecipe(snapshot)
  RECIPE_COUNTS.set(snapshot, Object.freeze(counts))
  if (limits === SVG_EMISSION_METADATA_LIMITS) CANONICAL_RECIPES.add(snapshot)
  return snapshot
}

export function svgEmissionMetadataCounts(recipe: SvgEmissionRecipe): SvgEmissionMetadataCounts {
  const counts = RECIPE_COUNTS.get(recipe)
  if (!counts) throw new TypeError('SVG emission metadata must be snapshotted before accounting')
  return counts
}

/** Closed runtime grammar too: a TypeScript cast or object spread must not add
 * markup slots, executable hooks, arbitrary paths, or new element types. The
 * snapshot boundary calls this only after descriptor-copying plain data. */
export function validateSvgEmissionRecipe(recipe: SvgEmissionRecipe): void {
  const seen = new WeakSet<object>()
  const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SVG recipe fields must be objects')
    for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !keys.includes(key)) throw new TypeError(`Unknown SVG recipe field ${String(key)}`)
    return value as Record<string, unknown>
  }
  const array = (value: unknown): readonly unknown[] => {
    if (!Array.isArray(value)) throw new TypeError('SVG recipe lists must be arrays')
    return value
  }
  const optionalString = (value: unknown): void => { if (value !== undefined && typeof value !== 'string') throw new TypeError('SVG recipe text must be strings') }
  const optionalBoolean = (value: unknown): void => { if (value !== undefined && typeof value !== 'boolean') throw new TypeError('SVG recipe flags must be booleans') }
  const optionalNumber = (value: unknown): void => { if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('SVG recipe numbers must be finite') }
  const index = (value: unknown): void => { if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) throw new TypeError('SVG recipe indices must be non-negative safe integers') }
  const oneOf = (value: unknown, choices: readonly unknown[], optional = true): void => {
    if (!(optional && value === undefined) && !choices.includes(value)) throw new TypeError(`Unsupported SVG recipe value ${String(value)}`)
  }
  const colors = (value: unknown): void => {
    const color = object(value, ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border', 'shadow', 'font', 'embedFontImport'])
    if (typeof color.bg !== 'string' || typeof color.fg !== 'string') throw new TypeError('SVG palette requires background and foreground')
    for (const key of ['line', 'accent', 'muted', 'surface', 'border', 'font']) optionalString(color[key])
    optionalBoolean(color.shadow); optionalBoolean(color.embedFontImport)
  }
  const shadow = (value: unknown): void => {
    const item = object(value, ['kind', 'wrap', 'colors'])
    oneOf(item.kind, ['shadow'], false); optionalBoolean(item.wrap); colors(item.colors)
  }
  const projection = (value: unknown): void => {
    const item = object(value, ['source', 'field', 'piece', 'value', 'declarations', 'position', 'index', 'primary', 'secondary', 'amount'])
    const source = item.source
    if (source === 'colorMix') {
      object(value, ['source', 'primary', 'secondary', 'amount'])
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0 || item.amount > 100) throw new TypeError('SVG color mix requires a bounded percentage')
      for (const color of [item.primary, item.secondary]) {
        const value = color as SvgValue
        if (value?.source !== 'metadata' && value?.source !== 'paint') throw new TypeError('SVG color mix requires non-recursive typed paints')
        if (value.source === 'metadata' && typeof value.value !== 'string') throw new TypeError('SVG color mix requires CSS text')
        projection(color)
      }
      return
    }
    if (source === 'connectorLabel') { object(value, ['source', 'index']); index(item.index); if (item.index === undefined) throw new TypeError('Connector label projection requires an index'); return }
    if (source === 'marker') { object(value, ['source', 'position']); oneOf(item.position, ['start', 'mid', 'end'], false); return }
    if (source === 'style') {
      object(value, ['source', 'declarations'])
      const declarations = array(item.declarations)
      const canonicalPositions = new Map<unknown, number>()
      for (let position = 0; position < declarations.length; position++) {
        const entry = object(declarations[position], ['property', 'value', 'shadowed'])
        if (entry.shadowed === undefined) canonicalPositions.set(entry.property, position)
      }
      for (const [position, declaration] of declarations.entries()) {
        const item = object(declaration, ['property', 'value', 'shadowed'])
        const properties = { 'mix-blend-mode': ['connector', 'mixBlendMode'], fill: ['paint', 'fill'], stroke: ['paint', 'stroke'], 'stroke-width': ['paint', 'strokeWidth'], 'stroke-dasharray': ['paint', 'strokeDasharray'], opacity: ['paint', 'opacity'] } as const
        if (['--tl-accent', '--tl-fill', '--tl-label', '--tl-line', '--tl-section-bg', '--tl-section-band', '--tl-pill-fill', '--tl-pill-stroke', '--tl-event-fill'].includes(String(item.property))) {
          const value = item.value as SvgValue
          if (item.shadowed !== undefined || value?.source !== 'metadata' && value?.source !== 'colorMix') throw new TypeError('Scoped palette properties require typed palette paints')
          if (value.source === 'metadata' && typeof value.value !== 'string') throw new TypeError('Scoped palette paints require CSS text')
          projection(value)
          continue
        }
        oneOf(item.property, Object.keys(properties), false)
        if (item.shadowed !== undefined) {
          if (item.shadowed !== true || !['stroke', 'stroke-width', 'stroke-dasharray', 'opacity'].includes(String(item.property))) throw new TypeError('Only overridden line-paint declarations may retain lexical values')
          const projected = object(item.value, ['source', 'value'])
          if (projected.source !== 'metadata' || typeof projected.value !== 'string' || !isSafeInlinePaintValue(projected.value)) throw new TypeError('Shadowed paint requires a safe lexical value')
          if ((canonicalPositions.get(item.property) ?? -1) <= position) throw new TypeError('Shadowed paint requires a later semantic declaration')
          continue
        }
        const projected = object(item.value, ['source', 'field'])
        const expected = properties[item.property as keyof typeof properties]
        if (projected.source !== expected[0] || projected.field !== expected[1]) throw new TypeError('SVG style must project its matching semantic field')
        projection(item.value)
      }
      return
    }
    if (source === 'metadata') {
      object(value, ['source', 'value'])
      if (!['string', 'number', 'boolean'].includes(typeof item.value)) throw new TypeError('SVG metadata values must be scalars')
      optionalNumber(typeof item.value === 'number' ? item.value : undefined)
      return
    }
    if (source === 'transform') { object(value, ['source']); return }
    object(value, source === 'geometry' || source === 'paint' ? ['source', 'field', 'piece'] : ['source', 'field'])
    index(item.piece)
    switch (source) {
      case 'geometry': if (!GEOMETRY_NAMES.has(item.field as string)) throw new TypeError('Unknown SVG geometry projection'); return
      case 'paint': if (!PAINT_FIELDS.has(item.field as string)) throw new TypeError('Unknown SVG paint projection'); return
      case 'text': oneOf(item.field, ['text', 'source', 'x', 'y', 'fontSize', 'fontWeight', 'letterSpacing', 'anchor'], false); return
      case 'identity': oneOf(item.field, ['id', 'role', 'from', 'to', 'classNames'], false); return
      case 'accessibility': oneOf(item.field, ['label', 'role', 'roleDescription'], false); return
      case 'connector': oneOf(item.field, ['color', 'width', 'opacity', 'mixBlendMode', 'pathLength', 'lineCap', 'lineJoin', 'miterLimit', 'lineStyle', 'relationshipKind', 'direction'], false); return
      case 'channel': oneOf(item.field, SEMANTIC_CHANNEL_NAMES, false); return
      case 'document': oneOf(item.field, ['text', 'domId'], false); return
      default: throw new TypeError('Unsupported SVG projection source')
    }
  }
  const attributes = (value: unknown): void => {
    const list = array(value)
    if (list.length > 256) throw new RangeError('SVG elements may declare at most 256 attributes')
    for (const entry of list) {
      const attribute = object(entry, ['name', 'value', 'format', 'omit', 'fallback', 'display', 'escape', 'before'])
      if (typeof attribute.name !== 'string' || !ATTRIBUTE_NAMES.has(attribute.name) && !/^data-[a-zA-Z0-9_.:-]+$/.test(attribute.name)) throw new TypeError('Unsupported SVG attribute name')
      projection(attribute.value)
      oneOf(attribute.format, ['exact', 'round2', 'round3', 'percent1'])
      if (attribute.format === 'percent1' && attribute.name !== 'data-percent') throw new TypeError('Percent formatting is limited to percentage metadata')
      oneOf(attribute.omit, ['undefined', 'zero', 'false', 'empty'])
      oneOf(attribute.escape, ['attribute', 'xml', 'safe'])
      oneOf(attribute.before, [' ', '\n', '\n  '])
      optionalBoolean(attribute.display)
      if (attribute.fallback !== undefined && typeof attribute.fallback !== 'string' && typeof attribute.fallback !== 'number') throw new TypeError('SVG attribute defaults must be strings or numbers')
      optionalNumber(typeof attribute.fallback === 'number' ? attribute.fallback : undefined)
    }
  }
  const documentText = (value: unknown): void => {
    const item = object(value, ['kind', 'element', 'text', 'domId'])
    oneOf(item.kind, ['documentText'], false); oneOf(item.element, ['title', 'desc'], false)
    optionalString(item.text); optionalString(item.domId)
  }
  const stylesheet = (value: unknown): void => {
    const item = object(value, ['kind', 'css'])
    if (item.kind !== 'stylesheet' || typeof item.css !== 'string') throw new TypeError('SVG stylesheets require CSS text')
    if (item.css.includes('<')) throw new TypeError('SVG stylesheet text must not contain XML markup delimiters')
  }
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64) throw new RangeError('SVG recipe exceeds depth budget')
    const item = object(value, ['kind', 'piece', 'attributes', 'tailAttributes', 'close', 'pieces', 'prefix', 'layout', 'baselineShift', 'dy', 'spans', 'content', 'whitespace', 'width', 'height', 'colors', 'transparent', 'font', 'hasMonoFont', 'widthAttribute', 'heightAttribute', 'extraStyle', 'children', 'join', 'resources', 'indent', 'element', 'text', 'domId', 'css'])
    if (seen.has(item)) return
    seen.add(item)
    switch (item.kind) {
      case 'primitive':
        object(item, ['kind', 'piece', 'attributes', 'close', 'pieces']); index(item.piece); attributes(item.attributes)
        oneOf(item.close, [' />', '/>', '></'])
        if (item.pieces !== undefined) for (const value of array(item.pieces)) {
          const piece = object(value, ['paint'])
          if (piece.paint !== undefined) {
            const paint = object(piece.paint, [...PAINT_FIELDS])
            for (const value of Object.values(paint)) optionalString(value)
          }
        }
        return
      case 'group':
        object(item, ['kind', 'attributes', 'prefix']); attributes(item.attributes)
        if (item.prefix !== undefined) for (const value of array(item.prefix)) documentText(value)
        return
      case 'text':
        object(item, ['kind', 'attributes', 'tailAttributes', 'layout', 'baselineShift', 'dy', 'spans', 'content', 'whitespace']); attributes(item.attributes)
        if (item.tailAttributes !== undefined) attributes(item.tailAttributes)
        if (item.spans !== undefined) for (const value of array(item.spans)) {
          const span = object(value, ['start', 'end', 'attributes'])
          index(span.start); index(span.end)
          if (typeof span.start !== 'number' || typeof span.end !== 'number' || span.end < span.start) throw new TypeError('SVG text spans require ordered semantic-text indices')
          attributes(span.attributes)
        }
        oneOf(item.layout, ['multiline', 'direct'], false); optionalNumber(item.baselineShift)
        oneOf(item.content, ['text', 'source'])
        if (item.spans !== undefined && item.layout !== 'multiline') throw new TypeError('Syntax spans require multiline text emission')
        if ((item.whitespace !== undefined || item.content === 'source') && item.layout !== 'direct') throw new TypeError('Source whitespace requires direct literal text emission')
        if (item.whitespace !== undefined) for (const value of array(item.whitespace)) {
          const edit = object(value, ['offset', 'length', 'value'])
          index(edit.offset); oneOf(edit.length, [0, 1], false)
          if (edit.offset === undefined || typeof edit.value !== 'string' || !edit.value.length || edit.value.trim() !== '') throw new TypeError('SVG lexical edits must contain only bounded whitespace')
        }
        if (item.dy !== undefined && typeof item.dy !== 'string' && typeof item.dy !== 'number') throw new TypeError('SVG text dy must be text or a number')
        optionalNumber(typeof item.dy === 'number' ? item.dy : undefined)
        return
      case 'prelude':
        object(item, ['kind', 'width', 'height', 'colors', 'transparent', 'font', 'hasMonoFont', 'widthAttribute', 'heightAttribute', 'extraStyle', 'attributes', 'children', 'join'])
        if (typeof item.width !== 'number' || typeof item.height !== 'number' || typeof item.font !== 'string' || typeof item.transparent !== 'boolean' || typeof item.hasMonoFont !== 'boolean') throw new TypeError('SVG prelude requires typed document fields')
        optionalNumber(item.width); optionalNumber(item.height); colors(item.colors)
        optionalString(item.widthAttribute); optionalString(item.heightAttribute); optionalString(item.extraStyle)
        if (item.attributes !== undefined) attributes(item.attributes)
        oneOf(item.join, ['', '\n'])
        for (const value of array(item.children)) {
          const child = object(value, ['kind', 'colors', 'wrap', 'element', 'text', 'domId', 'css'])
          if (child.kind === 'sharedStyle') object(child, ['kind'])
          else if (child.kind === 'shadow') shadow(child)
          else if (child.kind === 'documentText') documentText(child)
          else if (child.kind === 'stylesheet') stylesheet(child)
          else throw new TypeError('Unsupported SVG prelude child')
        }
        return
      case 'resources':
        object(item, ['kind', 'resources', 'indent', 'join', 'layout']); index(item.indent)
        oneOf(item.join, ['', '\n']); oneOf(item.layout, ['inline', 'block'])
        for (const value of array(item.resources)) if (value !== 'markers' && value !== 'gradients') shadow(value)
        return
      case 'documentText': documentText(item); return
      case 'stylesheet': stylesheet(item); return
      case 'close': object(item, ['kind']); return
      case 'connectorLabels': object(item, ['kind']); return
      case 'sequence':
        object(item, ['kind', 'children', 'join']); oneOf(item.join, ['', '\n'])
        for (const value of array(item.children)) visit(value, depth + 1)
        return
      default: throw new TypeError('Unsupported SVG recipe kind')
    }
  }
  visit(recipe, 0)
  // Aliases are legal data, but a tiny repeated sequence DAG must not expand
  // into unbounded work even when every leaf emits zero bytes. Memoize the
  // expansion count so admission itself remains linear in the captured data.
  const steps = new WeakMap<object, number>()
  const count = (item: SvgEmissionRecipe): number => {
    const prior = steps.get(item)
    if (prior !== undefined) return prior
    let result = 1
    if (item.kind === 'sequence') for (const child of item.children) {
      result += count(child)
      if (result > SVG_EMISSION_METADATA_LIMITS.maxObjects) throw new RangeError('SVG recipe exceeds expanded emission budget')
    }
    steps.set(item, result)
    return result
  }
  count(recipe)
}
