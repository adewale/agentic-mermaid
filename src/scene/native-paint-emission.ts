import type { SceneNode, SceneDoc, ConnectorMark } from './ir.ts'
import type { ScenePaintGeometryInspection, ScenePaintGeometry } from './inspection.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../svg-structure.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { isImmutablePixelTextPart, transferRetainedPixelText } from '../shared/prepared-text.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { deferredTerminalProjectionInput, copyDeferredTerminalProjection } from './deferred-terminal-projection.ts'
import { transferSceneNodeSerialization } from './serialization.ts'
import { retainedGroupEmission } from './marks.ts'

export const MAX_OCCLUSION_OPERATIONS = 400_000

type Leaf = Exclude<SceneNode, { kind: 'group' }>
export interface NativeEmissionWork { readonly operations: number; readonly exhausted: boolean; readonly uncertain: boolean; readonly header: Omit<SceneDoc, 'parts'> }
const emittedOccurrences = new WeakSet<ScenePaintGeometry>()
export function hasNativeEmissionOccurrence(primitive: ScenePaintGeometry): boolean { return emittedOccurrences.has(primitive) }
const emissionWork = new WeakMap<ScenePaintGeometryInspection, NativeEmissionWork>()
export function nativeEmissionWorkOf(inspection: ScenePaintGeometryInspection): NativeEmissionWork | undefined { return emissionWork.get(inspection) }

/** Capture lifetime only: this does not round geometry, decode SVG, or grant a
 * new contact exemption. Every occurrence retains its own immutable fields and
 * are captured BEFORE the single existing writer call, which emits that copy.
 * Accessors/unsupported data or an exhausted capture keep paint conditional. */
export function createNativePaintEmission(maxOperations: number) {
  let operations = 0, exhausted = false, uncertain = false
  const resources = new Map<string, string | undefined>()
  const references: NonNullable<Extract<Leaf, { kind: 'connector' }>['markers']['start']>[] = []
  const pay = (count = 1): boolean => {
    if (exhausted) return false
    if (!Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  const failed = Symbol('unsupported-emission')
  const copy = (value: unknown, depth = 0, parents = new Set<object>()): unknown => {
    if (depth > 64) throw failed
    if (value === null || value === undefined || typeof value === 'boolean') return value
    if (typeof value === 'number' || typeof value === 'string') return value
    if (typeof value !== 'object' || !pay() || parents.has(value)) throw failed
    if (isImmutablePixelTextPart(value)) return value
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw failed
    // The object-entry visit covers constant prototype/reflection work. Key
    // slots and subsequent descriptor/copy visits are distinct paid work.
    const keys = Object.getOwnPropertyNames(value)
    if (!pay(keys.length)) throw failed
    parents.add(value)
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
    let arrayLength: PropertyDescriptor | undefined
    const deferredProjection = deferredTerminalProjectionInput(value)
    for (const key of keys) {
      if (!pay()) throw failed
      // This property visit owns descriptor retention and scalar assignment;
      // a primitive needs no second visit or numeric formatting/replay.
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      if (key === 'length' && Array.isArray(value)) { arrayLength = descriptor; continue }
      // Deferred terminal geometry is neither read nor used by paint writing.
      if (key === 'terminalProjection' && deferredProjection) continue
      if (!('value' in descriptor)) throw failed
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1, parents), enumerable: descriptor.enumerable, configurable: false, writable: false })
    }
    if (Array.isArray(value)) {
      if (!arrayLength || !('value' in arrayLength)) throw failed
      Object.defineProperty(result, 'length', { value: arrayLength.value, writable: false })
    }
    if (deferredProjection) {
      if (!pay(3) || !copyDeferredTerminalProjection(value, result as unknown as ConnectorMark)) throw failed
      const descriptor = Object.getOwnPropertyDescriptor(result, 'terminalProjection')!
      Object.defineProperty(result, 'terminalProjection', { ...descriptor, configurable: false })
    }
    transferRetainedPixelText(value, result)
    parents.delete(value)
    // Every retained data property is already nonwritable/nonconfigurable;
    // arrays also own readonly length. Prevent extensions without rescanning
    // the same fields a second time through Object.freeze.
    return Object.preventExtensions(result)
  }
  const snapshot = <T>(value: T): T | undefined => {
    try { return copy(value) as T } catch { return undefined }
  }
  // Immutable operands make this a finite field walk, without allocating a
  // second descriptor array or JSON representation before its work is paid.
  const same = (a: unknown, b: unknown): boolean => {
    if (!pay()) return false
    if (typeof a === 'string' && typeof b === 'string') return pay(a.length + b.length) && a === b
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    let na = 0, nb = 0
    if (!pay(2)) return false
    const ak = Object.getOwnPropertyNames(a), bk = Object.getOwnPropertyNames(b)
    if (!pay(ak.length + bk.length)) return false
    for (const key of ak) {
      if (!pay(3)) return false
      const da = Object.getOwnPropertyDescriptor(a, key), db = Object.getOwnPropertyDescriptor(b, key)
      if (!da) continue
      na++
      if (!db || !('value' in da) || !('value' in db) || da.enumerable !== db.enumerable || !same(da.value, db.value)) return false
    }
    for (const key of bk) { if (!pay()) return false; if (Object.hasOwn(b, key)) nb++ }
    return na === nb
  }
  // Upper bound for one resource serialization. Fields are already inert and
  // immutable; pay the walk and resulting markup BEFORE calling the writer.
  const markupCost = (value: unknown): number | undefined => {
    if (!pay()) return undefined
    if (typeof value === 'string') return value.length * 6 + 2
    if (typeof value === 'number') return 32
    if (!value || typeof value !== 'object') return 8
    let cost = 64
    if (!pay()) return undefined
    const keys = Object.getOwnPropertyNames(value)
    if (!pay(keys.length)) return undefined
    for (const key of keys) {
      if (!pay(3)) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return undefined
      const child = markupCost(descriptor.value)
      if (child === undefined) return undefined
      cost += key.length + 16 + child
      if (!Number.isSafeInteger(cost) || cost > maxOperations) return undefined
    }
    return cost
  }
  return {
    snapshot,
    same,
    retainFragment(): boolean { return pay() },
    parts<T>(items: readonly T[], max: number): readonly T[] {
      if (!pay()) { uncertain = true; return items }
      if (!Array.isArray(items)) { uncertain = true; return items }
      const length = Object.getOwnPropertyDescriptor(items, 'length')?.value
      if (!Number.isSafeInteger(length) || length < 0 || length > max) throw new RangeError('Native drawing contains too many emitted nodes')
      if (!pay(length * 4)) { uncertain = true; return items }
      const retained: T[] = []
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(items, String(index))
        if (!descriptor || !('value' in descriptor)) { uncertain = true; retained.push(items[index]!) }
        else retained.push(descriptor.value as T)
      }
      return Object.freeze(retained)
    },
    uncertain(): void { uncertain = true },
    header(header: Omit<SceneDoc, 'parts'>, svg: string): Omit<SceneDoc, 'parts'> {
      if (!pay(svg.length * 8 + 128)) return header
      const root = scanSvgStartTags(svg).find(tag => tag.name === 'svg')
      if (!root) { uncertain = true; return header }
      const width = formatSvgNumber(header.width), height = formatSvgNumber(header.height)
      const viewBox = decodedSvgAttributeValue(root, 'viewBox')
      if (viewBox !== undefined ? viewBox !== `0 0 ${width} ${height}`
        : decodedSvgAttributeValue(root, 'width') !== width || decodedSvgAttributeValue(root, 'height') !== height) uncertain = true
      for (const attribute of root.attributes) {
        if (!pay()) return header
        if (!['xmlns', 'width', 'height', 'viewBox', 'style', 'role', 'class', 'id'].includes(attribute.name)
          && !attribute.name.startsWith('data-') && !attribute.name.startsWith('aria-')) uncertain = true
      }
      const captured = Object.freeze({ ...header, width: Number(width), height: Number(height) })
      const colors = header.colors as unknown as Readonly<Record<string, unknown>>
      const style = decodedSvgAttributeValue(root, 'style')
      if (style === undefined) return captured
      const seen = new Set<string>()
      for (const declaration of style.split(';')) {
        if (!pay(declaration.length + 4)) return captured
        if (!declaration.trim()) continue
        const colon = declaration.indexOf(':')
        const name = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim()
        if (colon < 0 || seen.has(name)) { uncertain = true; continue }
        seen.add(name)
        if (name === 'background' && value === 'var(--bg)') continue
        if (name === '--font') {
          if (!pay(typeof colors.font === 'string' ? colors.font.length * 4 : 1) || safeCssFontFamily(colors.font) !== value) uncertain = true
          continue
        }
        if (!['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border', 'font'].some(key => `--${key}` === name) || colors[name.slice(2)] !== value) uncertain = true
      }
      return captured
    },
    group(shell: Extract<SceneNode, { kind: 'group' }>, original?: object) {
      const retained = original && retainedGroupEmission(original)
      if (!pay(3)) return undefined
      if (!retained || retained.open !== shell.open || retained.opacity !== shell.paint?.opacity) { uncertain = true; return undefined }
      if (retained.style || shell.paint?.fill !== undefined) uncertain = true
      return retained.matrix
    },
    observe(node: Leaf, svg: string): boolean {
      // Reserve the actual occurrence's custody records before inspection.
      // Every inline label can add one primitive; noninline labels only make
      // this a conservative upper bound. Failed reservations are conditional.
      if (!pay(2 * (1 + (node.kind === 'connector' ? node.labels.length : 0)))) return false
      if (node.kind === 'connector') {
        const reference = (marker: typeof node.markers.start): void => { if (marker && pay(2)) references.push(marker) }
        reference(node.markers.start)
        for (const marker of node.markers.mid) { if (!pay()) break; reference(marker) }
        reference(node.markers.end)
      } else if (node.kind === 'document' && node.element === 'definitions') {
        if (!pay(svg.length * 8)) return false
        for (const tag of scanSvgStartTags(svg)) {
          if (!pay(tag.attributes.length + 1)) break
          if (tag.name !== 'marker') continue
          const id = decodedSvgAttributeValue(tag, 'id')
          const end = svg.indexOf('</marker>', tag.end)
          if (!id || end < 0 || resources.has(id)) { uncertain = true; continue }
          const bytes = svg.slice(tag.start, end + 9).replace(/(^|\n)[ \t]+(?=<)/g, '$1')
          if (!pay(2)) break
          resources.set(id, bytes)
        }
      }
      return !exhausted
    },
    leaf(node: Leaf): { node: Leaf; conditional: boolean } {
      const captured = snapshot(node)
      if (!captured) return { node, conditional: true }
      transferSceneNodeSerialization(node, captured)
      return { node: captured, conditional: false }
    },
    finish(inspection: ScenePaintGeometryInspection, header: Omit<SceneDoc, 'parts'>): void {
      const checked = new Map<string, (typeof references)[number]>()
      for (const marker of references) {
        if (!pay()) break
        try {
          if (!pay(2)) break
          const prior = checked.get(marker.id)
          if (prior && same(prior, marker)) continue
          const cost = markupCost(marker)
          if (cost === undefined || !pay(cost * 2)) { uncertain = true; break }
          const expected = serializeMarkerResource(marker, { indent: 0 }).replace(/(^|\n)[ \t]+(?=<)/g, '$1')
          if (!pay(expected.length * 3) || resources.get(marker.id) !== expected) uncertain = true
          else if (pay(2)) checked.set(marker.id, marker)
        } catch { uncertain = true }
      }
      // Paid in observe before these immutable occurrences were created.
      // Conditional fallback occurrences already prohibit P, even if rewrapped.
      for (const primitive of inspection.primitives) if (primitive.visibility !== 'conditional') emittedOccurrences.add(primitive)
      emissionWork.set(inspection, Object.freeze({ operations, exhausted, uncertain, header }))
    },
  }
}
