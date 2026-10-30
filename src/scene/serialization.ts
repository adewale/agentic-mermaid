import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'
import { connectorContourSemantics } from './connector-geometry.ts'
import { isAdmittedSceneDocument } from './scene-admission-state.ts'
import { isOwnDataSceneSnapshot, isOwnDataSceneSnapshotInert, isOwnDataSceneArrayInert } from './scene-data-snapshot.ts'
import type { SceneDoc, SceneNode, Geometry, MarkPaint, ShapeMark } from './ir.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { writeConnectorSvg, writeShapeSvg, writeTextSvg, type SvgGeometryWriteSink, type SvgXmlCapture, type SvgXmlWrite } from './svg-writer.ts'
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
  string(node: Exclude<SceneNode, { kind: 'group' }>, svg: string): void
  root(scene: SceneDoc): { readonly composition: GroupComposition; underlay(svg: string): void; complete(sealed: boolean): void } | undefined
  reserve(): boolean
  reserveProjection(operations: number): boolean
  document(node: Extract<SceneNode, { kind: 'document' }>, svg: string): void
  connector(node: ConnectorNode): void
  group(node: Extract<SceneNode, { kind: 'group' }>): { readonly composition: GroupComposition | undefined; complete(sealed: boolean): void } | undefined
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
const sceneObserverCreate = Object.create, sceneObserverWeakMap = WeakMap
const sceneObserverGet = WeakMap.prototype.get, sceneObserverSet = WeakMap.prototype.set, sceneObserverDelete = WeakMap.prototype.delete, sceneObserverApply = Reflect.apply
const actualSceneObservers = new WeakSet<object>()
const sceneWriteObservers = new WeakMap<SceneSerializationObserver, SceneWriteRecorder>()
function readSceneWriteObserver(observer: SceneSerializationObserver): SceneWriteRecorder | undefined { return groupObserverApply(groupObserverHas, actualSceneObservers, [observer]) ? sceneObserverApply(sceneObserverGet, sceneWriteObservers, [observer]) : sceneWriteObservers.get(observer) }
const backendWriteObservers = new WeakMap<object, SceneSerializationObserver>()
export function sceneBackendWriteObserver(context: object): SceneSerializationObserver | undefined { return sceneObserverApply(sceneObserverGet, backendWriteObservers, [context]) }
export function sceneDocumentComposition(observer: SceneSerializationObserver, scene: SceneDoc) { return sceneObserverApply(sceneObserverGet, sceneWriteObservers, [observer])?.root(scene) }
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

export function createSceneWriteCapture(maxOperations: number, options: { fractionalCircleOutput?: boolean; pageUnderlay?: boolean } = {}, actualBackendWrite = false) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0 || maxOperations > MAX_OCCLUSION_OPERATIONS) throw new RangeError('Invalid Scene write work allowance')
  const option = Object.getOwnPropertyDescriptor(options, 'fractionalCircleOutput')
  const fractionalCircleOutput = !!option && Object.hasOwn(option, 'value') && option.value === true
  let operations = 0, exhausted = false, finished = false
  const paths = new Map<SceneNode, WrittenPath>()
  const pay = (count: number): boolean => {
    if (exhausted || !(actualBackendWrite ? groupSafeInteger(count) : Number.isSafeInteger(count)) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  let emitting = false
  const context = createEmissionContext(pay, { pageUnderlay: actualBackendWrite && Object.getOwnPropertyDescriptor(options, 'pageUnderlay')?.value === true })
  const admissionStrings = new sceneObserverWeakMap<object, { readonly svg: string; readonly kind: string }>()
  let preparedScene: SceneDoc | undefined, preparedContext: ReturnType<typeof context.finish> | undefined
  let backendContext: object | undefined
  let actualRoots = 0, actualRootCompleted = false, actualClosed = true
  const string = (node: Exclude<SceneNode, { kind: 'group' }>, svg: string): void => {
    if (!actualBackendWrite || finished) return
    if (!emitting) {
      if (!pay(1)) return
      const prior = sceneObserverApply(sceneObserverGet, admissionStrings, [node]) as { svg: string; kind: string } | undefined
      if (prior) { if (prior.svg !== svg || prior.kind !== node.kind) actualClosed = false; return }
      sceneObserverApply(sceneObserverSet, admissionStrings, [node, { svg, kind: node.kind }])
      return
    }
    // Same primitive equality used by the existing flat leaf-custody check.
    // The first value is this actual return, never a second ambient cache get.
    if (!pay(4)) return
    const pinned = sceneObserverApply(sceneObserverGet, admissionStrings, [node]) as { svg: string; kind: string } | undefined
    if (!pinned || pinned.kind !== node.kind || typeof svg !== 'string' || pinned.svg !== svg) actualClosed = false
  }
  const rectangles = new WeakSet<ShapeMark>()
  const fractional = new WeakSet<SceneNode>()
  const inert = <T extends object>(source: T, field?: string, value?: unknown): T | undefined => {
    if (!pay(2)) return undefined
    const keys = Object.getOwnPropertyNames(source)
    if (!pay(keys.length * 3)) return undefined
    const result = Object.create(null) as T
    let replaced = false
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
      if (key === field) replaced = true
      Object.defineProperty(result, key, { value: key === field ? value : descriptor.value, enumerable: descriptor.enumerable })
    }
    if (field !== undefined && !replaced) return undefined
    return Object.preventExtensions(result)
  }
  const hint = (node: SceneNode): boolean => {
    if (finished || !fractionalCircleOutput || actualBackendWrite && emitting) return false
    // No extra property access or reflection reaches an ordinary raw mark.
    if (!TRANSFERRED_WRITABLE_NODES.has(node)) { context.invalidateFractionalCircle(); return false }
    if (!pay(2)) return false
    if (!isOwnDataSceneSnapshot(node)) {
      if (!pay(4) || Object.getPrototypeOf(node) !== null || !Object.isFrozen(node)) { context.invalidateFractionalCircle(); return false }
      const keys = Object.getOwnPropertyNames(node)
      if (!pay(keys.length * 2)) return false
      for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(node, key)!, 'value')) { context.invalidateFractionalCircle(); return false }
    }
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
      if (!Object.hasOwn(descriptor, 'value') || descriptor.value !== undefined && (typeof descriptor.value !== 'string' || rectanglePaintFields[field].numeric && descriptor.value.length >= 13)) return false
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
      if (!pay(4)) return
      const attribute = rectanglePaintFields[field].attribute, expected = paint[field]
      const descriptor = Object.getOwnPropertyDescriptor(attributes, attribute)
      const ownData = !!descriptor && Object.hasOwn(descriptor, 'value')
      if (descriptor && (!ownData || typeof descriptor.value !== 'string')) conditional = true
      const actual = ownData ? descriptor.value as string | undefined : undefined
      if (!pay((expected?.length ?? 0) + (actual?.length ?? 0))) return
      if (actual !== expected) conditional = true
      if (descriptor) matched++
    }
    if (attributes && (!pay(16) || Object.getOwnPropertyNames(attributes).length !== matched)) conditional = true
    const geometry = served && inert(served)
    const overlay = geometry && inert(node, 'geometry', geometry)
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
  const observe = (actualBackendWrite ? groupFreeze(sceneObserverCreate(null)) : Object.freeze(Object.create(null))) as SceneSerializationObserver
  if (actualBackendWrite) groupObserverApply(groupObserverAdd, actualSceneObservers, [observe])
  const recorder: SceneWriteRecorder = {
    string,
    root: scene => actualBackendWrite && emitting && !finished && scene === preparedScene && pay(4) ? (actualRoots++, {
      composition: groupComposition(scene as never, pay, true),
      underlay: svg => {
        if (svg === '') return
        if (!pay(svg.length * 2 + 16) || svg !== preparedContext?.pageUnderlay
          || groupOwnDescriptor(scene.parts, '0')?.value !== preparedContext?.pagePrelude) actualClosed = false
      },
      complete: sealed => { actualRootCompleted = true; if (!pay(2) || !sealed) actualClosed = false },
    }) : undefined,
    reserve: () => !finished && !emitting && pay(192), reserveProjection: count => !finished && !emitting && pay(count),
    document: (node, svg) => { if (!finished && !emitting) context.document(node, svg) },
    connector: node => { if (!finished && !emitting) context.connector(node) },
    group: node => {
      if (finished) return undefined
      if (!emitting) { context.group(node); return undefined }
      const composition = groupObserverApply(groupObserverHas, TRANSFERRED_WRITABLE_NODES, [node]) && isOwnDataSceneSnapshotInert(node) ? groupComposition(node, pay) : undefined
      return { composition, complete: sealed => { if (!pay(2) || !sealed) actualClosed = false } }
    }, hint, compound, compoundRecord, rectangle, rectangleRecord,
    contextLeaf: (node, svg) => {
      if (finished || emitting || !fractionalCircleOutput) return
      if (!TRANSFERRED_WRITABLE_NODES.has(node)) { context.invalidateFractionalCircle(); return }
      context.leaf(node, svg)
    },
    leaf: (node, svg) => {
      if (finished || emitting || !fractional.has(node) || node.kind !== 'text' || !pay(32)) return
      if (paths.has(node)) { paths.delete(node); exhausted = true; return }
      paths.set(node, Object.freeze({ source: undefined, svg, served: node, conditional: false, path: false }))
    }, record }
  if (actualBackendWrite) sceneObserverApply(sceneObserverSet, sceneWriteObservers, [observe, groupFreeze(recorder)])
  else sceneWriteObservers.set(observe, recorder)
  const detach = (): void => { if (backendContext) { sceneObserverApply(sceneObserverDelete, backendWriteObservers, [backendContext]); backendContext = undefined } }
  const receipt = (scene: SceneDoc, result: ReturnType<typeof context.finish>): SceneWriteReceipt => {
    const value = new CapturedSceneWrites(scene, paths, operations, exhausted, maxOperations, result.uncertain,
      fractionalCircleOutput && result.fractionalCircleContext && !exhausted, result.uncertain ? undefined : result.resolveColor)
    Object.freeze(value); issuedSceneWrites.add(value); return value
  }
  return {
    observe,
    prepare(scene: SceneDoc): SceneWriteReceipt | undefined {
      if (!actualBackendWrite || preparedScene || emitting || finished) throw new Error('Invalid Scene preparation phase')
      if (!isAdmittedSceneDocument(scene)) return undefined
      preparedScene = scene
      preparedContext = context.finish(scene)
      return receipt(scene, preparedContext)
    },
    beginBackendEmission(scene: SceneDoc, contextObject: object, proof: import('./paint-certification.ts').PaintLayoutCertification): void {
      if (!actualBackendWrite || emitting || finished || scene !== preparedScene || !preparedContext) throw new Error('Invalid Scene actual-write phase')
      const completed = proof.checks.operations
      if (!groupSafeInteger(completed) || completed < 0 || completed > maxOperations) throw new Error('Invalid Scene proof continuation')
      if (completed < operations) actualClosed = false
      else pay(completed - operations)
      for (let index = 0; index < proof.issues.length; index++) if (proof.issues[index]!.code === 'CHECK_BUDGET') exhausted = true
      emitting = true; backendContext = contextObject
      sceneObserverApply(sceneObserverSet, backendWriteObservers, [contextObject, observe])
    },
    abortBackendEmission(): void { finished = true; actualClosed = false; detach() },
    finishActual(proof: import('./paint-certification.ts').PaintLayoutCertification): import('./paint-certification.ts').PaintLayoutCertification {
      if (!actualBackendWrite || !emitting || finished || !preparedContext) throw new Error('Invalid Scene actual-write completion')
      finished = true; detach()
      if (actualRoots !== 1 || !actualRootCompleted) actualClosed = false
      pay(16 + proof.issues.length * 2)
      const budget = exhausted, scope = !actualClosed
      let hasBudget = false, hasScope = false
      for (let index = 0; index < proof.issues.length; index++) { const code = proof.issues[index]!.code; hasBudget ||= code === 'CHECK_BUDGET'; hasScope ||= code === 'OUTPUT_SCOPE' }
      const extra = (scope && !hasScope ? 1 : 0) + (budget && !hasBudget ? 1 : 0)
      const issues: import('./paint-certification.ts').PaintCertificationIssue[] = []
      const count = proof.issues.length < 64 - extra ? proof.issues.length : 64 - extra
      for (let index = 0; index < count; index++) groupDefine(issues, index, { value: proof.issues[index], enumerable: true, configurable: false, writable: false })
      if (scope && !hasScope) groupDefine(issues, issues.length, { value: { code: 'OUTPUT_SCOPE', message: budget
        ? 'Actual backend composition could not be established within the paint-work allowance'
        : 'Actual backend composition differs from its admission write evidence' }, enumerable: true })
      if (budget && !hasBudget) groupDefine(issues, issues.length, { value: { code: 'CHECK_BUDGET', message: 'Actual backend composition exhausted the existing paint-work allowance' }, enumerable: true })
      return groupFreeze({ ...proof, status: proof.status === 'failed' ? 'failed' : budget || scope ? 'unverified' : proof.status,
        checks: groupFreeze({ ...proof.checks, operations: budget ? maxOperations : operations }), issues: groupFreeze(issues) })
    },
    finish(scene: SceneDoc): SceneWriteReceipt | undefined {
      if (actualBackendWrite) throw new Error('Actual writes require preparation and same-ledger completion')
      if (finished) throw new Error('Scene write capture already finished')
      finished = true
      if (!isAdmittedSceneDocument(scene)) return undefined
      return receipt(scene, context.finish(scene))
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

/** One actual typed write supplies both the bytes and its XML construction fact.
 * Stored/mutable/cached markup keeps its complete XML in the projection. */
export function sceneNodeWrite(node: SceneNode, capture: SvgXmlCapture, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): SvgXmlWrite {
  return serializeSceneNode(node, sink, observer, capture)
}

function serializeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): string
function serializeSceneNode(node: SceneNode, sink: SvgGeometryWriteSink | undefined, observer: SceneSerializationObserver | undefined, capture: SvgXmlCapture): SvgXmlWrite
function serializeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver, capture?: SvgXmlCapture): string | SvgXmlWrite {
  const recorder = observer && readSceneWriteObserver(observer)
  const stored = SERIALIZED_SCENE_NODES.get(node)
  if (stored !== undefined) {
    if (node.kind === 'group') recorder?.group(node)?.complete(false)
    if (node.kind !== 'group') recorder?.string(node, stored)
    if (node.kind === 'document') recorder?.document(node, stored)
    else if (node.kind !== 'group') recorder?.contextLeaf(node, stored)
    return capture ? capture.raw(stored, node) : stored
  }
  if (!WRITABLE_SCENE_NODES.has(node)) throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  const written = WRITTEN_SCENE_NODES.get(node)
  if (written !== undefined) {
    if (node.kind === 'group') recorder?.group(node)?.complete(false)
    if (node.kind !== 'group') recorder?.string(node, written)
    if (node.kind !== 'group' && node.kind !== 'document') recorder?.contextLeaf(node, written)
    return capture ? capture.raw(written, node) : written
  }
  let source: Geometry | undefined, served: Geometry | undefined, received = false, invalid = false, projectionReserved = false
  const groupWrite = node.kind === 'group' ? recorder?.group(node) : undefined
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
  const output = capture ? writeStructuredSceneNode(node, capture, geometrySink, observer) : writeSceneNode(node, geometrySink, observer, groupWrite?.composition)
  const svg = typeof output === 'string' ? output : output.svg
  groupWrite?.complete(!capture && groupWrite.composition?.valid === true)
  if (node.kind !== 'group') recorder?.string(node, svg)
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
  return capture ? output as SvgXmlWrite : svg
}

function writeStructuredSceneNode(node: SceneNode, capture: SvgXmlCapture, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver): SvgXmlWrite {
  switch (node.kind) {
    case 'shape': return writeShapeSvg(node, sink, capture)
    case 'text': return writeTextSvg(node, capture, sink)
    case 'connector': return writeConnectorSvg(node, sink, capture)
    case 'group': return capture.join([
      capture.raw(node.open),
      ...node.children.map(child => capture.indent(serializeSceneNode(child.node, undefined, observer, capture), child.indent)),
      capture.raw(node.close),
    ], node.join)
    case 'document': throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  }
}

function writeSceneNode(node: SceneNode, sink?: SvgGeometryWriteSink, observer?: SceneSerializationObserver, composition?: GroupComposition): string {
  switch (node.kind) {
    case 'shape': return writeShapeSvg(node, sink)
    case 'text': return writeTextSvg(node)
    case 'connector': return writeConnectorSvg(node, sink)
    case 'group': {
      if (!composition) return [
        node.open,
        ...node.children.map(child => indentLines(serializeSceneNode(child.node, undefined, observer), child.indent)),
        node.close,
      ].join(node.join)
      {
        const indentLines = composition.indent
        const open = node.open
        composition.beforeMap(node.children)
        const mapped = node.children.map(child => indentLines(serializeSceneNode(child.node, undefined, observer), child.indent))
        composition.beforeSpread(mapped)
        const parts = [open, ...mapped, node.close]
        composition.beforeJoin(parts)
        return parts.join(node.join)
      }
    }
    case 'document': throw new TypeError(`Scene node "${node.id}" has no admitted SVG serialization`)
  }
}

// This private receipt assumes standard intrinsics when this module loads.
// It does not fingerprint a hostile pre-import realm. Captured reflection only
// inspects admitted own-data objects; every actual unknown operator still runs.
const groupDefine = Object.defineProperty, groupFreeze = Object.freeze
const groupObserverHas = WeakSet.prototype.has, groupObserverAdd = WeakSet.prototype.add, groupObserverApply = Reflect.apply
const groupSafeInteger = Number.isSafeInteger
const groupHasOwn = Object.hasOwn
const groupOwnDescriptor = Object.getOwnPropertyDescriptor
const groupPrototype = Object.getPrototypeOf
const groupFrozen = Object.isFrozen
const groupIsArray = Array.isArray
const groupArray = Array, groupArrayPrototype = Array.prototype
const groupStringPrototype = String.prototype, groupRegExpPrototype = RegExp.prototype
const groupMap = Array.prototype.map, groupJoin = Array.prototype.join
const groupIterator = Array.prototype[Symbol.iterator]
const groupIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]())
const groupNext = groupOwnDescriptor(groupIteratorPrototype, 'next')!.value
const groupSpecies = groupOwnDescriptor(Array, Symbol.species)!.get
const groupRepeat = String.prototype.repeat, groupReplace = String.prototype.replace
const groupRegExpReplace = RegExp.prototype[Symbol.replace], groupRegExpExec = RegExp.prototype.exec
const groupRegExpFlags = ['global', 'unicode', 'unicodeSets'] as const
const groupRegExpGetters = groupRegExpFlags.map(name => groupOwnDescriptor(RegExp.prototype, name)?.get)
interface GroupComposition {
  readonly valid: boolean
  invalidate(): void
  beforeMap(children: unknown): void
  beforeSpread(mapped: unknown): void
  beforeJoin(parts: unknown): void
  indent(svg: string, spaces: number): string
}
function groupComposition(node: Extract<SceneNode, { kind: 'group' }>, pay: (count: number) => boolean, root = false): GroupComposition {
  let valid = true
  const charge = (count = 1): boolean => { if (valid && !pay(count)) valid = false; return valid }
  const descriptor = (source: object, key: PropertyKey): PropertyDescriptor | undefined => charge() ? groupOwnDescriptor(source, key) : undefined
  const data = (source: object, key: PropertyKey, expected: unknown): boolean => {
    const slot = descriptor(source, key)
    return !!slot && groupHasOwn(slot, 'value') && slot.value === expected
  }
  const getter = (source: object, key: PropertyKey, expected: unknown): boolean => {
    const slot = descriptor(source, key)
    return !!slot && !groupHasOwn(slot, 'value') && slot.get === expected && expected !== undefined
  }
  const array = (value: unknown): value is unknown[] => charge(2) && !!value && typeof value === 'object' && groupIsArray(value) && groupPrototype(value) === groupArrayPrototype
  const dense = (value: unknown, strings: boolean): value is unknown[] => {
    if (!array(value)) return false
    const length = descriptor(value, 'length')
    if (!length || !groupHasOwn(length, 'value')) return false
    for (let index = 0; index < length.value; index++) {
      const slot = descriptor(value, String(index))
      if (!slot || !groupHasOwn(slot, 'value') || strings && typeof slot.value !== 'string') return false
    }
    return true
  }
  if (!charge(2) || !groupFrozen(node) || groupPrototype(node) !== null) valid = false
  const fields = root ? [] : ['open', 'close', 'join']
  for (let index = 0; index < fields.length; index++) {
    const slot = descriptor(node, fields[index]!)
    if (!slot || !groupHasOwn(slot, 'value') || typeof slot.value !== 'string') valid = false
  }
  const field = descriptor(node, root ? 'parts' : 'children')
  if (!field || !groupHasOwn(field, 'value')) valid = false
  return {
    get valid() { return valid },
    invalidate(): void { if (!charge()) return; valid = false },
    beforeMap(children): void {
      if (!valid) return
      if (children !== field!.value) { valid = false; return }
      // Admission checked the roles/order of these producer-owned immutable
      // slots. Reuse their closed construction rather than reflect them again.
      const owned = !!children && typeof children === 'object' && charge(2) && isOwnDataSceneArrayInert(children)
      if (!owned) {
        if (!dense(children, false) || !charge() || !groupFrozen(children)) { valid = false; return }
        for (let index = 0; index < children.length; index++) {
          const child = groupOwnDescriptor(children, String(index))!.value
          if (!charge(2) || !child || typeof child !== 'object' || !isOwnDataSceneSnapshotInert(child) || !groupFrozen(child)) { valid = false; return }
          const node = root ? undefined : descriptor(child, 'node'), indent = root ? undefined : descriptor(child, 'indent')
          if (!root && (!node || !groupHasOwn(node, 'value') || !indent || !groupHasOwn(indent, 'value') || typeof indent.value !== 'number' || indent.value !== indent.value)) { valid = false; return }
        }
      }
      if (descriptor(children, 'map') || descriptor(children, 'constructor')
        || !data(groupArrayPrototype, 'map', groupMap) || !data(groupArrayPrototype, 'constructor', groupArray)
        || !getter(groupArray, Symbol.species, groupSpecies)) valid = false
    },
    beforeSpread(mapped): void {
      if (!valid) return
      if (!dense(mapped, true) || descriptor(mapped as object, Symbol.iterator)
        || !data(groupArrayPrototype, Symbol.iterator, groupIterator)
        || !data(groupIteratorPrototype, 'next', groupNext)) valid = false
    },
    beforeJoin(parts): void {
      if (!valid) return
      if (!(root ? dense(parts, true) : array(parts)) || descriptor(parts as object, 'join') || !data(groupArrayPrototype, 'join', groupJoin)) valid = false
    },
    indent(svg, spaces): string {
      if (!valid || spaces <= 0 || svg === '') return indentLines(svg, spaces)
      if (typeof svg !== 'string' || typeof spaces !== 'number' || !data(groupStringPrototype, 'repeat', groupRepeat)) valid = false
      const pad = ' '.repeat(spaces)
      if (valid) {
        if (!data(groupStringPrototype, 'replace', groupReplace) || !data(groupRegExpPrototype, Symbol.replace, groupRegExpReplace)
          || !data(groupRegExpPrototype, 'exec', groupRegExpExec)) valid = false
        for (let index = 0; valid && index < groupRegExpFlags.length; index++) if (!getter(groupRegExpPrototype, groupRegExpFlags[index]!, groupRegExpGetters[index])) valid = false
      }
      return pad + svg.replace(/\n/g, `\n${pad}`)
    },
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
