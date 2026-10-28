import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'
import { connectorContourSemantics } from './connector-geometry.ts'
import { isAdmittedSceneDocument } from './scene-admission-state.ts'
import type { SceneDoc, SceneNode, Geometry } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { writeConnectorSvg, writeShapeSvg, writeTextSvg, type SvgGeometryWriteSink } from './svg-writer.ts'
import { writtenPolylineProjectionOf } from './written-geometry.ts'
import { createEmissionContext } from './emission-context.ts'

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
  record: SceneWriteCallback
}
// Explicit transaction tokens identify recorders; there is no active global
// observer, and callers cannot invoke or substitute a recorder callback.
const sceneWriteObservers = new WeakMap<SceneSerializationObserver, SceneWriteRecorder>()
type ConnectorNode = Extract<SceneNode, { kind: 'connector' }>
interface WrittenPath { readonly source: Geometry; readonly svg: string; readonly served: ConnectorNode; readonly conditional: boolean; readonly path: boolean }
export interface SceneWriteWork { readonly scene: SceneDoc; readonly operations: number; readonly exhausted: boolean; readonly uncertain: boolean }

const ownValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

class CapturedSceneWrites {
  readonly #scene: SceneDoc
  readonly #paths: ReadonlyMap<SceneNode, WrittenPath>
  readonly #operations: number
  readonly #exhausted: boolean
  readonly #maxOperations: number
  readonly #uncertain: boolean
  constructor(scene: SceneDoc, paths: ReadonlyMap<SceneNode, WrittenPath>, operations: number, exhausted: boolean, maxOperations: number, uncertain: boolean) {
    this.#scene = scene; this.#paths = paths; this.#operations = operations; this.#exhausted = exhausted; this.#maxOperations = maxOperations; this.#uncertain = uncertain
  }

  begin(scene: SceneDoc) {
    if (scene !== this.#scene) return undefined
    let operations = this.#operations, exhausted = this.#exhausted
    return {
      node: (node: Exclude<SceneNode, { kind: 'group' }>): WrittenPath | undefined => {
        if (exhausted || operations > this.#maxOperations - 16) { exhausted = true; return undefined }
        operations += 16
        const written = this.#paths.get(node)
        if (!written || WRITTEN_SCENE_NODES.get(node) !== written.svg) return undefined
        const route = ownValue(node, 'route')
        if (!route || typeof route !== 'object' || ownValue(route, 'geometry') !== written.source) return undefined
        return written
      },
      work: (): SceneWriteWork => Object.freeze({ scene, operations, exhausted, uncertain: this.#uncertain }),
    }
  }
}
const issuedSceneWrites = new WeakSet<CapturedSceneWrites>()
Object.freeze(CapturedSceneWrites.prototype)
export type SceneWriteReceipt = CapturedSceneWrites

export function beginSceneWriteInspection(receipt: SceneWriteReceipt | undefined, scene: SceneDoc) {
  try { return receipt !== undefined && issuedSceneWrites.has(receipt) && receipt instanceof CapturedSceneWrites && isAdmittedSceneDocument(scene) ? receipt.begin(scene) : undefined } catch { return undefined }
}

export function createSceneWriteCapture(maxOperations: number) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0 || maxOperations > MAX_OCCLUSION_OPERATIONS) throw new RangeError('Invalid Scene write work allowance')
  let operations = 0, exhausted = false, finished = false
  const paths = new Map<SceneNode, WrittenPath>()
  const pay = (count: number): boolean => {
    if (exhausted || !Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  const context = createEmissionContext(pay)
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
          const descriptor = Object.getOwnPropertyDescriptor(node.route, key)!
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
    group: node => { if (!finished) context.group(node) }, record })
  return {
    observe,
    finish(scene: SceneDoc): SceneWriteReceipt | undefined {
      if (finished) throw new Error('Scene write capture already finished')
      finished = true
      if (!isAdmittedSceneDocument(scene)) return undefined
      const result = context.finish(scene)
      const receipt = new CapturedSceneWrites(scene, paths, operations, exhausted, maxOperations, result.uncertain)
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
    return stored
  }
  if (!WRITABLE_SCENE_NODES.has(node)) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  const written = WRITTEN_SCENE_NODES.get(node)
  if (written !== undefined) return written
  let source: Geometry | undefined, served: Geometry | undefined, received = false, invalid = false, projectionReserved = false
  if (node.kind === 'group') recorder?.group(node)
  if (node.kind === 'connector') recorder?.connector(node)
  const watched = recorder && node.kind === 'connector' && recorder.reserve()
  const geometrySink: SvgGeometryWriteSink | undefined = watched ? Object.assign((geometry: Geometry, written: Geometry | undefined) => {
    if (received) { invalid = true; return }
    received = true
    source = geometry
    served = written
    sink?.(geometry, written)
  }, { reserveProjection: (geometry: Geometry, operations: number) => {
    if (node.kind !== 'connector' || geometry !== node.route.geometry || projectionReserved) { invalid = true; return false }
    projectionReserved = true
    return recorder!.reserveProjection(operations)
  } }) : sink
  const svg = writeSceneNode(node, geometrySink, observer)
  // A group is written from its children each time: its children array is
  // not part of what freezing it protects.
  if (node.kind !== 'group' && Object.isFrozen(node)) WRITTEN_SCENE_NODES.set(node, svg)
  if (watched && source && !invalid && source === node.route.geometry) recorder!.record(node, source, served, svg)
  return svg
}

function writeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): string {
  switch (node.kind) {
    case 'shape': return writeShapeSvg(node, sink)
    case 'text': return writeTextSvg(node)
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
  if (WRITABLE_SCENE_NODES.has(source)) WRITABLE_SCENE_NODES.add(target)
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
