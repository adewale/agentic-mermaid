import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'
import { connectorContourSemantics } from './connector-geometry.ts'
import { isAdmittedSceneDocument } from './scene-admission-state.ts'
import type { SceneDoc, SceneNode, Geometry, MarkPaint, ShapeMark } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { writeConnectorSvg, writeShapeSvg, writeTextSvg, type SvgGeometryWriteSink } from './svg-writer.ts'
import { rectanglePaintFields, writtenPolylineProjectionOf, prepareWrittenCompoundShape, observeWrittenCompoundShape, completeWrittenCompoundShape, type WrittenCompoundInput } from './written-geometry.ts'
import { createEmissionContext, type EmissionColorResolver } from './emission-context.ts'

// SVG serialization is backend-private state, not part of the public Scene IR.
// Shape, text and connector marks are written from their typed fields when
// first serialized (svg-writer.ts); a group is its opening tag, its children
// and its closing tag. Only document marks (the shell, definitions,
// stylesheets, titles, opaque family content) carry construction-time markup,
// normalized before admission: callers cannot use attribute order, quote
// style, or tag spacing as a second byte-level Scene authority.
const SERIALIZED_SCENE_NODES = new WeakMap<object, string>()
/** Marks the mark constructors built, and admitted copies of them: the only
 * shape, text, connector and group nodes the writer draws. A plain object
 * shaped like a mark has no serialization, as it had none before the writer. */
const WRITABLE_SCENE_NODES = new WeakSet<object>()
/** Writer output for frozen (admitted) leaf marks, which cannot change after. */
const WRITTEN_SCENE_NODES = new WeakMap<object, string>()
// The snapshot handoff is private writer provenance, not a caller flag. Check
// membership before reflecting on a node so raw/mutable serialization retains
// its existing observations and strict writer behavior.
const TRANSFERRED_WRITABLE_NODES = new WeakSet<object>()
const POSSIBLE_FITTED_TEXT = /<\s*text/i

/** First-write data belongs to one admission transaction, not a global node
 * proof cache. A later request cannot borrow an earlier cached serialization. */
declare const sceneWriteObserver: unique symbol
export interface SceneSerializationObserver { readonly [sceneWriteObserver]: true }
type SceneWriteCallback = (node: SceneNode, source: Geometry, served: Geometry | undefined, svg: string) => void
interface SceneWriteRecorder {
  reserve(): boolean
  reserveProjection(operations: number): boolean
  document(node: Extract<SceneNode, { kind: 'document' }>, svg: string): void
  connector(node: ConnectorNode): void
  group(node: Extract<SceneNode, { kind: 'group' }>): void
  hint(node: SceneNode): boolean
  compound(node: ShapeMark): WrittenCompoundInput | undefined
  compoundRecord(node: ShapeMark, input: WrittenCompoundInput, svg: string): void
  rectangle(node: ShapeMark): boolean
  rectangleRecord(node: ShapeMark, source: Geometry, served: Geometry | undefined, attributes: Readonly<Record<string, string>> | undefined, svg: string): void
  contextLeaf(node: Exclude<SceneNode, { kind: 'group' }>, svg: string): void
  leaf(node: Exclude<SceneNode, { kind: 'group' }>, svg: string): void
  record: SceneWriteCallback
}
// Explicit transaction tokens identify recorders; there is no active global
// observer, and callers cannot invoke or substitute a recorder callback.
const sceneWriteObservers = new WeakMap<SceneSerializationObserver, SceneWriteRecorder>()
type ConnectorNode = Extract<SceneNode, { kind: 'connector' }>
interface WrittenPath { readonly source: Geometry | undefined; readonly svg: string; readonly served: Exclude<SceneNode, { kind: 'group' }>; readonly conditional: boolean; readonly path: boolean }
export interface SceneWriteWork { readonly scene: SceneDoc; readonly operations: number; readonly exhausted: boolean; readonly uncertain: boolean; readonly fractionalCircleContext: boolean; readonly resolveColor?: EmissionColorResolver }

const ownValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

class CapturedSceneWrites {
  readonly #scene: SceneDoc
  readonly #paths: ReadonlyMap<SceneNode, WrittenPath>
  readonly #operations: number
  readonly #exhausted: boolean
  readonly #maxOperations: number
  readonly #uncertain: boolean
  readonly #resolveColor: EmissionColorResolver | undefined
  readonly #fractionalCircleContext: boolean
  constructor(scene: SceneDoc, paths: ReadonlyMap<SceneNode, WrittenPath>, operations: number, exhausted: boolean, maxOperations: number, uncertain: boolean, fractionalCircleContext: boolean, resolveColor?: EmissionColorResolver) {
    this.#scene = scene; this.#paths = paths; this.#operations = operations; this.#exhausted = exhausted; this.#maxOperations = maxOperations; this.#uncertain = uncertain; this.#fractionalCircleContext = fractionalCircleContext; this.#resolveColor = resolveColor
  }

  begin(scene: SceneDoc) {
    if (scene !== this.#scene) return undefined
    let operations = this.#operations, exhausted = this.#exhausted
    const consumed = new Set<SceneNode>()
    return {
      node: (node: Exclude<SceneNode, { kind: 'group' }>): WrittenPath | undefined => {
        if (exhausted || operations > this.#maxOperations - 16) { exhausted = true; return undefined }
        operations += 16
        const written = this.#paths.get(node)
        if (!written || written.served.kind !== node.kind || WRITTEN_SCENE_NODES.get(node) !== written.svg) return undefined
        if (node.kind === 'connector') {
          const route = ownValue(node, 'route')
          if (!route || typeof route !== 'object' || ownValue(route, 'geometry') !== written.source) return undefined
        } else {
          if (consumed.has(node)) return undefined
          consumed.add(node)
          if (node.kind === 'shape' ? ownValue(node, 'geometry') !== written.source : node.kind !== 'text' || written.source !== undefined) return undefined
        }
        return written
      },
      work: (): SceneWriteWork => Object.freeze({ scene, operations, exhausted, uncertain: this.#uncertain, fractionalCircleContext: this.#fractionalCircleContext, resolveColor: this.#resolveColor }),
    }
  }
}
const issuedSceneWrites = new WeakSet<CapturedSceneWrites>()
Object.freeze(CapturedSceneWrites.prototype)
export type SceneWriteReceipt = CapturedSceneWrites

export function beginSceneWriteInspection(receipt: SceneWriteReceipt | undefined, scene: SceneDoc) {
  try { return receipt !== undefined && issuedSceneWrites.has(receipt) && receipt instanceof CapturedSceneWrites && isAdmittedSceneDocument(scene) ? receipt.begin(scene) : undefined } catch { return undefined }
}

export function createSceneWriteCapture(maxOperations: number, options: { fractionalCircleOutput?: boolean } = {}) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0 || maxOperations > MAX_OCCLUSION_OPERATIONS) throw new RangeError('Invalid Scene write work allowance')
  const option = Object.getOwnPropertyDescriptor(options, 'fractionalCircleOutput')
  const fractionalCircleOutput = !!option && Object.hasOwn(option, 'value') && option.value === true
  let operations = 0, exhausted = false, finished = false
  const paths = new Map<SceneNode, WrittenPath>()
  const pay = (count: number): boolean => {
    if (exhausted || !Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  const context = createEmissionContext(pay)
  const rectangles = new WeakSet<ShapeMark>()
  const fractional = new WeakSet<SceneNode>()
  const inert = <T extends object>(source: T): T | undefined => {
    if (!pay(2)) return undefined
    const keys = Object.getOwnPropertyNames(source)
    if (!pay(keys.length * 3)) return undefined
    const result = Object.create(null) as T
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: descriptor.enumerable })
    }
    return Object.preventExtensions(result)
  }
  const hint = (node: SceneNode): boolean => {
    if (finished || !fractionalCircleOutput) return false
    // No extra property access or reflection reaches an ordinary raw mark.
    if (!TRANSFERRED_WRITABLE_NODES.has(node)) { context.invalidateFractionalCircle(); return false }
    if (!pay(4) || Object.getPrototypeOf(node) !== null || !Object.isFrozen(node)) { context.invalidateFractionalCircle(); return false }
    const keys = Object.getOwnPropertyNames(node)
    if (!pay(keys.length * 2)) return false
    for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(node, key)!, 'value')) { context.invalidateFractionalCircle(); return false }
    if (!context.hint(node)) return false
    fractional.add(node)
    return true
  }
  const compound = (node: ShapeMark): WrittenCompoundInput | undefined => {
    // This independent first-write receipt also serves polygon markers. The
    // circle/cross hint is not a prerequisite, and raw marks are never reflected.
    if (finished || !fractionalCircleOutput || !TRANSFERRED_WRITABLE_NODES.has(node)) return undefined
    if (!pay(4) || Object.getPrototypeOf(node) !== null || !Object.isFrozen(node)) return undefined
    const geometry = ownValue(node, 'geometry')
    if (!geometry || typeof geometry !== 'object' || ownValue(geometry, 'kind') !== 'compound') return undefined
    return prepareWrittenCompoundShape(node, pay)
  }
  const compoundRecord = (node: ShapeMark, input: WrittenCompoundInput, svg: string): void => {
    if (finished) return
    const source = ownValue(node, 'geometry')
    if (!source || typeof source !== 'object') return
    const projection = completeWrittenCompoundShape(input, source as Geometry, svg, pay)
    if (!projection) return
    const proof = inert(node), overlay = proof && replace(proof, 'geometry', projection.geometry)
    const served = overlay && replace(overlay, 'childPaints', projection.childPaints)
    if (!served) return
    if (paths.has(node)) { paths.delete(node); exhausted = true; return }
    paths.set(node, Object.freeze({ source: source as Geometry, svg, served, conditional: false, path: false }))
  }
  const rectangle = (node: ShapeMark): boolean => {
    if (!fractional.has(node) || !pay(32)) return false
    const geometry = ownValue(node, 'geometry'), paint = ownValue(node, 'paint')
    if (!geometry || typeof geometry !== 'object' || !paint || typeof paint !== 'object'
      || Object.getPrototypeOf(geometry) !== null || !Object.isFrozen(geometry)
      || Object.getPrototypeOf(paint) !== null || !Object.isFrozen(paint) || 'transform' in node
      || ownValue(geometry, 'kind') !== 'rect') return false
    for (const field of ['x', 'y', 'width', 'height']) if (typeof ownValue(geometry, field) !== 'number') return false
    if (!((ownValue(geometry, 'width') as number) > 0 && (ownValue(geometry, 'height') as number) > 0)) return false
    for (const field of ['rx', 'ry']) if (ownValue(geometry, field) !== undefined && ownValue(geometry, field) !== 0) return false
    for (const field of Object.keys(rectanglePaintFields) as (keyof MarkPaint)[]) {
      if (!pay(4)) return false
      const descriptor = Object.getOwnPropertyDescriptor(paint, field)
      if (!descriptor) { if (field in paint) return false; continue }
      if (!Object.hasOwn(descriptor, 'value') || descriptor.value !== undefined && (typeof descriptor.value !== 'string' || rectanglePaintFields[field] && descriptor.value.length >= 13)) return false
    }
    rectangles.add(node)
    return true
  }
  const rectangleRecord = (node: ShapeMark, source: Geometry, served: Geometry | undefined, attributes: Readonly<Record<string, string>> | undefined, svg: string): void => {
    if (finished || !rectangles.has(node) || !pay(64) || ownValue(node, 'geometry') !== source) return
    let conditional = !served || served.kind !== 'rect' || source.kind !== 'rect' || !attributes
    if (served?.kind === 'rect' && (!(served.width > 0 && served.height > 0) || (served.rx ?? 0) !== 0 || (served.ry ?? 0) !== 0)) conditional = true
    let matched = 0
    const paint = node.paint
    if (attributes) for (const field of Object.keys(rectanglePaintFields) as (keyof MarkPaint)[]) {
      if (!pay(field.length * 2 + 4)) return
      const attribute = field.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`), expected = paint[field]
      const descriptor = Object.getOwnPropertyDescriptor(attributes, attribute)
      const ownData = !!descriptor && Object.hasOwn(descriptor, 'value')
      if (descriptor && (!ownData || typeof descriptor.value !== 'string')) conditional = true
      const actual = ownData ? descriptor.value as string | undefined : undefined
      if (!pay((expected?.length ?? 0) + (actual?.length ?? 0))) return
      if (actual !== expected) conditional = true
      if (descriptor) matched++
    }
    if (attributes && (!pay(16) || Object.getOwnPropertyNames(attributes).length !== matched)) conditional = true
    const geometry = served && inert(served), proof = inert(node)
    const overlay = geometry && proof && replace(proof, 'geometry', geometry)
    if (paths.has(node)) { paths.delete(node); exhausted = true; return }
    paths.set(node, Object.freeze({ source, svg, served: overlay ?? node, conditional: conditional || !overlay, path: false }))
  }
  const replace = <T extends object>(source: T, key: string, value: unknown): T | undefined => {
    if (!pay(2)) return undefined
    const keys = Object.getOwnPropertyNames(source)
    if (!pay(keys.length * 3) || !Object.hasOwn(source, key)) return undefined
    const result = Object.create(Object.getPrototypeOf(source)) as T
    for (const name of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, name)!
      Object.defineProperty(result, name, name === key ? { ...descriptor, value } : descriptor)
    }
    return Object.preventExtensions(result)
  }
  const record: SceneWriteCallback = (node, source, served, svg) => {
    if (finished || !pay(64) || node.kind !== 'connector') return
    const route = ownValue(node, 'route')
    if (!route || typeof route !== 'object' || ownValue(route, 'geometry') !== source) return
    let paintNode = node, conditional = !served || served.kind !== source.kind
    if (served && !conditional && served !== source) {
      if (ownValue(node, 'transform') || ownValue(route, 'closed') || served.kind === 'polyline' && node.markers.mid.length !== 0) conditional = true
      else if (served.kind === 'path') {
        if (typeof ownValue(source, 'd') !== 'string') return
        const geometry = replace(source, 'd', served.d)
        const paintRoute = geometry && replace(route, 'geometry', geometry)
        const overlay = paintRoute && replace(node, 'route', paintRoute)
        if (!overlay) return
        paintNode = overlay
      } else if (served.kind === 'line' || served.kind === 'polyline') {
        if (!pay(192)) return
        const projection = served.kind === 'polyline' ? writtenPolylineProjectionOf(served) : undefined
        if (served.kind === 'polyline' && !projection) return
        Object.freeze(served)
        const contours = projection?.contours ?? connectorContourSemantics(served, false)
        if (!projection) {
          for (const contour of contours) {
            Object.freeze(contour.start); Object.freeze(contour.end)
            if (contour.startTangent) Object.freeze(contour.startTangent)
            if (contour.endTangent) Object.freeze(contour.endTangent)
            Object.freeze(contour)
          }
          Object.freeze(contours)
        }
        const first = contours[0], last = contours.at(-1)
        conditional = !first || !last || (served.kind === 'polyline'
          ? projection!.collapsed
          : first.start.x === last.end.x && first.start.y === last.end.y)
        if (!pay(2)) return
        const routeKeys = Object.getOwnPropertyNames(node.route)
        if (!pay(routeKeys.length * 3 + 12)) return
        const paintRoute = Object.create(Object.getPrototypeOf(node.route)) as ConnectorNode['route']
        for (const key of routeKeys) {
          const descriptor = Object.getOwnPropertyDescriptor(node.route, key)
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) return
          const value = key === 'geometry' ? served : key === 'contours' ? contours : key === 'startTangent' ? first?.startTangent : key === 'endTangent' ? last?.endTangent : descriptor.value
          Object.defineProperty(paintRoute, key, { ...descriptor, value })
        }
        Object.preventExtensions(paintRoute)
        const overlay = replace(node, 'route', paintRoute)
        if (!overlay) return
        paintNode = overlay
      } else conditional = true
    }
    if (paths.has(node)) { paths.delete(node); exhausted = true; return }
    paths.set(node, Object.freeze({ source, svg, served: paintNode, conditional, path: source.kind === 'path' }))
  }
  const observe = Object.freeze(Object.create(null)) as SceneSerializationObserver
  sceneWriteObservers.set(observe, { reserve: () => !finished && pay(192), reserveProjection: operations => !finished && pay(operations),
    document: (node, svg) => { if (!finished) context.document(node, svg) },
    connector: node => { if (!finished) context.connector(node) },
    group: node => { if (!finished) context.group(node) }, hint, compound, compoundRecord, rectangle, rectangleRecord,
    contextLeaf: (node, svg) => {
      if (finished || !fractionalCircleOutput) return
      if (!TRANSFERRED_WRITABLE_NODES.has(node)) { context.invalidateFractionalCircle(); return }
      context.leaf(node, svg)
    },
    leaf: (node, svg) => {
      if (finished || !fractional.has(node) || node.kind !== 'text' || !pay(32)) return
      if (paths.has(node)) { paths.delete(node); exhausted = true; return }
      paths.set(node, Object.freeze({ source: undefined, svg, served: node, conditional: false, path: false }))
    }, record })
  return {
    observe,
    finish(scene: SceneDoc): SceneWriteReceipt | undefined {
      if (finished) throw new Error('Scene write capture already finished')
      finished = true
      if (!isAdmittedSceneDocument(scene)) return undefined
      const result = context.finish(scene)
      const receipt = new CapturedSceneWrites(scene, paths, operations, exhausted, maxOperations, result.uncertain,
        fractionalCircleOutput && result.fractionalCircleContext && !exhausted, result.uncertain ? undefined : result.resolveColor)
      Object.freeze(receipt)
      issuedSceneWrites.add(receipt)
      return receipt
    },
  }
}

interface SerializedAttribute {
  readonly name: string
  readonly value: string
  readonly index: number
}

function canonicalOpeningTag(tag: string): string {
  const head = tag.match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)/)
  if (!head || tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) return tag
  const name = head[1]!
  // The v2 Scene contract owns the document shell. Family mark serialization
  // remains an internal projection of its typed geometry/presentation fields;
  // reordering those attributes would add no contract value and would make
  // family-level semantic probes needlessly depend on the shell migration.
  if (name !== 'svg') return tag
  const selfClosing = /\/\s*>$/.test(tag)
  const boundary = selfClosing ? tag.lastIndexOf('/') : tag.length - 1
  const attributes: SerializedAttribute[] = []
  let cursor = head[0].length
  while (cursor < boundary) {
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    if (cursor >= boundary) break
    const attribute = tag.slice(cursor).match(/^([^\s=<>/]+)/)
    if (!attribute) return tag
    const attributeName = attribute[1]!
    cursor += attribute[0].length
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    if (tag[cursor] !== '=') return tag
    cursor++
    while (/\s/.test(tag[cursor] ?? '')) cursor++
    const quote = tag[cursor]
    if (quote !== '"' && quote !== "'") return tag
    cursor++
    const valueStart = cursor
    while (cursor < boundary && tag[cursor] !== quote) cursor++
    if (tag[cursor] !== quote) return tag
    const rawValue = tag.slice(valueStart, cursor)
    cursor++
    attributes.push({
      name: attributeName,
      value: quote === '"' ? rawValue : rawValue.replaceAll('"', '&quot;'),
      index: attributes.length,
    })
  }
  const shellOrder = new Map([
    ['xmlns', 0], ['width', 1], ['height', 2], ['viewBox', 3], ['style', 4],
  ])
  attributes.sort((a, b) => {
    const aOrder = shellOrder.get(a.name) ?? 100
    const bOrder = shellOrder.get(b.name) ?? 100
    return aOrder - bOrder || compareCodePointStrings(a.name, b.name) || a.index - b.index
  })
  const serialized = attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ')
  return `<${name}${serialized ? ` ${serialized}` : ''}${selfClosing ? ' /' : ''}>`
}

/** Canonicalize the owned SVG document shell without reparsing or rewriting
 * family elements, text, CSS, comments, or closing tags. This is deliberately
 * one-way: historical root ordering cannot survive as backend output. */
export function canonicalizeSceneNodeSerialization(svg: string): string {
  // Only opening <svg> tags are canonicalized. Most document fragments are
  // styles, definitions or metadata and cannot contain one at all.
  if (!svg.includes('<svg')) return svg
  let output = ''
  let cursor = 0
  while (cursor < svg.length) {
    const start = svg.indexOf('<', cursor)
    if (start < 0) return output + svg.slice(cursor)
    output += svg.slice(cursor, start)
    if (svg.startsWith('<!--', start)) {
      const end = svg.indexOf('-->', start + 4)
      if (end < 0) return output + svg.slice(start)
      output += svg.slice(start, end + 3)
      cursor = end + 3
      continue
    }
    let quote: '"' | "'" | undefined
    let end = start + 1
    for (; end < svg.length; end++) {
      const char = svg[end]
      if (quote) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (end >= svg.length) return output + svg.slice(start)
    output += canonicalOpeningTag(svg.slice(start, end + 1))
    cursor = end + 1
  }
  return output
}

/** Attach a document mark's markup. Every other mark's SVG is written from
 * its fields, so what paint certification reads is what the output shows. */
export function attachSceneNodeSerialization<T extends SceneNode>(node: T, svg: string): T {
  if (node.kind !== 'document') throw new TypeError(`Scene ${node.kind} "${node.id}" is written from its fields, not stored markup`)
  SERIALIZED_SCENE_NODES.set(node, canonicalizeSceneNodeSerialization(svg))
  return node
}

/** Record that a mark constructor built `node`, so the writer may draw it. */
export function admitWritableSceneNode<T extends SceneNode>(node: T): T {
  WRITABLE_SCENE_NODES.add(node)
  return node
}

export function sceneNodeSerialization(node: SceneNode): string {
  return serializeSceneNode(node)
}

/** Observe only this actual write. Cached markup supplies no new receipt. */
export function sceneNodeSerializationObserved(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): string {
  return serializeSceneNode(node, sink, observer)
}

function serializeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): string {
  const recorder = observer && sceneWriteObservers.get(observer)
  const stored = SERIALIZED_SCENE_NODES.get(node)
  if (stored !== undefined) {
    if (node.kind === 'document') recorder?.document(node, stored)
    else if (node.kind !== 'group') recorder?.contextLeaf(node, stored)
    return stored
  }
  if (!WRITABLE_SCENE_NODES.has(node)) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  const written = WRITTEN_SCENE_NODES.get(node)
  if (written !== undefined) {
    if (node.kind !== 'group' && node.kind !== 'document') recorder?.contextLeaf(node, written)
    return written
  }
  let source: Geometry | undefined, served: Geometry | undefined, received = false, invalid = false, projectionReserved = false
  if (node.kind === 'group') recorder?.group(node)
  if (node.kind === 'connector') recorder?.connector(node)
  const fractional = recorder?.hint(node) ?? false
  const rectangle = fractional && node.kind === 'shape' && recorder!.rectangle(node)
  const compound = node.kind === 'shape' ? recorder?.compound(node) : undefined
  const watchedConnector = recorder && node.kind === 'connector'
  const watched = recorder && (watchedConnector || rectangle || compound) && recorder.reserve()
  let attributesReceived = false, invalidAttributes = false, attributes: Readonly<Record<string, string>> | undefined
  const geometrySink: SvgGeometryWriteSink | undefined = watched ? Object.assign((geometry: Geometry, written: Geometry | undefined) => {
    if (compound) { observeWrittenCompoundShape(compound, geometry, written, count => recorder!.reserveProjection(count)); sink?.(geometry, written); return }
    if (received) { invalid = true; return }
    received = true
    source = geometry
    if (rectangle && written) {
      if (!recorder!.reserveProjection(48)) { invalid = true; return }
      const fresh = Object.create(null) as Geometry
      for (const key of Object.getOwnPropertyNames(written)) {
        const descriptor = Object.getOwnPropertyDescriptor(written, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) { invalid = true; return }
        Object.defineProperty(fresh, key, { value: descriptor.value, enumerable: descriptor.enumerable })
      }
      served = Object.preventExtensions(fresh)
    } else served = written
    sink?.(geometry, written)
  }, { reserveProjection: (geometry: Geometry, operations: number) => {
    if (node.kind !== 'connector' || geometry !== node.route.geometry || projectionReserved) { invalid = true; return false }
    projectionReserved = true
    return recorder!.reserveProjection(operations)
  }, rectangleAttributes: rectangle ? (shape: ShapeMark, actual: Readonly<Record<string, string>> | undefined): void => {
    if (shape !== node || attributesReceived) { invalidAttributes = true; return }
    attributesReceived = true
    attributes = actual
    sink?.rectangleAttributes?.(shape, actual)
  } : undefined }) : sink
  const actualSink = fractional && node.kind === 'text' ? Object.assign(() => {}, {
    captureTextContext: true as const, reserveTextContext: (operations: number) => recorder!.reserveProjection(operations),
  }) : geometrySink
  const svg = writeSceneNode(node, actualSink, observer)
  // A group is written from its children each time: its children array is
  // not part of what freezing it protects.
  if (node.kind !== 'group' && Object.isFrozen(node)) WRITTEN_SCENE_NODES.set(node, svg)
  if (compound && node.kind === 'shape') recorder!.compoundRecord(node, compound, svg)
  if (watched && source) {
    if (watchedConnector && !invalid && source === (node as ConnectorNode).route.geometry) recorder!.record(node, source, served, svg)
    else if (rectangle && node.kind === 'shape') recorder!.rectangleRecord(node, source, invalid ? undefined : served,
      attributesReceived && !invalidAttributes ? attributes : undefined, svg)
  }
  if (node.kind !== 'group' && node.kind !== 'document') recorder?.contextLeaf(node, svg)
  if (fractional && node.kind !== 'group' && node.kind !== 'document') recorder!.leaf(node, svg)
  return svg
}

function writeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): string {
  switch (node.kind) {
    case 'shape': return writeShapeSvg(node, sink)
    case 'text': return writeTextSvg(node, sink)
    case 'connector': return writeConnectorSvg(node, sink)
    case 'group': return [
      node.open,
      ...node.children.map(child => indentLines(serializeSceneNode(child.node, undefined, observer), child.indent)),
      node.close,
    ].join(node.join)
    case 'document': throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  }
}

/** Indent every line of a serialized chunk by `n` spaces. */
export function indentLines(s: string, n: number): string {
  if (n <= 0 || s === '') return s
  const pad = ' '.repeat(n)
  return pad + s.replace(/\n/g, `\n${pad}`)
}

export function transferSceneNodeSerialization(source: object, target: object): void {
  const svg = SERIALIZED_SCENE_NODES.get(source)
  if (svg !== undefined) SERIALIZED_SCENE_NODES.set(target, svg)
  if (WRITABLE_SCENE_NODES.has(source)) {
    WRITABLE_SCENE_NODES.add(target)
    // Only the Scene snapshot handoff starts with an inert target. A public
    // group clone starts plain; changing its prototype later cannot upgrade it.
    if (Object.getPrototypeOf(target) === null) TRANSFERRED_WRITABLE_NODES.add(target)
  }
}

export function hasSceneNodeSerialization(value: object): boolean {
  return SERIALIZED_SCENE_NODES.has(value) || WRITABLE_SCENE_NODES.has(value)
}

/** A conservative proof for the canonical default writer only. The font-fit
 * postpass ignores prepared text trees. Opaque fragments can still contain
 * unprepared text, so an unknown fragment or even a possible text token keeps
 * that postpass. Styled/custom backends cannot use this proof. */
export function sceneHasOnlyPreparedText(scene: SceneDoc): boolean {
  // The fitting pass accepts whitespace after '<' and compares names without
  // case. Opaque fragments must conservatively cover that same lexical model.
  const prepared = (node: SceneNode): boolean => {
    if (node.kind === 'document') {
      const svg = SERIALIZED_SCENE_NODES.get(node)
      return svg !== undefined && !POSSIBLE_FITTED_TEXT.test(svg)
    }
    if (!WRITABLE_SCENE_NODES.has(node)) return false
    switch (node.kind) {
      case 'text': return node.measurement === 'prepared' && node.block !== undefined
      case 'shape': return true
      // The connector writer sends every inline label through the prepared
      // shared text writer; companion labels are separate Text marks.
      case 'connector': return true
      case 'group': return !POSSIBLE_FITTED_TEXT.test(node.open) && !POSSIBLE_FITTED_TEXT.test(node.close) && node.children.every(child => prepared(child.node))
    }
  }
  return scene.parts.every(prepared)
}
