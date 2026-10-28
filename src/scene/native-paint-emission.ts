import type { SceneNode, SceneDoc, ConnectorMark, Geometry } from './ir.ts'
import type { ScenePaintGeometryInspection, ScenePaintGeometry } from './inspection.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../svg-structure.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { parseSvgTransform } from './transforms.ts'
import { deferredTerminalProjectionInput, copyDeferredTerminalProjection } from './deferred-terminal-projection.ts'
import { transferSceneNodeSerialization } from './serialization.ts'
import { connectorContourSemantics } from './connector-geometry.ts'

export const MAX_OCCLUSION_OPERATIONS = 400_000

type Leaf = Exclude<SceneNode, { kind: 'group' }>
export interface NativeEmissionWork { readonly operations: number; readonly exhausted: boolean; readonly uncertain: boolean; readonly closedMarkerContext: boolean; readonly header: Omit<SceneDoc, 'parts'> }
const emittedOccurrences = new WeakSet<ScenePaintGeometry>()
export function hasNativeEmissionOccurrence(primitive: ScenePaintGeometry): boolean { return emittedOccurrences.has(primitive) }
const emissionWork = new WeakMap<ScenePaintGeometryInspection, NativeEmissionWork>()
export function nativeEmissionWorkOf(inspection: ScenePaintGeometryInspection): NativeEmissionWork | undefined { return emissionWork.get(inspection) }

/** Every occurrence retains immutable operands BEFORE the existing writer
 * call. Scalar lines also retain that writer's numeric spelling for inspection;
 * the original operands still supply validation and SVG serialization.
 * Accessors/unsupported data or an exhausted capture keep paint conditional. */
export function createNativePaintEmission(maxOperations: number) {
  let operations = 0, exhausted = false, uncertain = false
  // A deliberately smaller admission domain for new served marker proofs.
  // Existing proofs do not depend on this flat, stylesheet-free context.
  let closedMarkerContext = true, rootOpens = 0, rootCloses = 0
  const resources = new Map<string, string | undefined>()
  const references: NonNullable<Extract<Leaf, { kind: 'connector' }>['markers']['start']>[] = []
  const pay = (count = 1): boolean => {
    if (exhausted) return false
    if (!Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  const failed = Symbol('unsupported-emission')
  type Line = Extract<Geometry, { kind: 'line' }>
  const servedLines = new WeakMap<object, Line>()
  type CaptureContext = 'leaf' | 'route' | 'geometry'
  const copy = (value: unknown, depth = 0, parents = new Set<object>(), context?: CaptureContext): unknown => {
    if (depth > 64) throw failed
    if (value === null || value === undefined || typeof value === 'boolean') return value
    if (typeof value === 'number' || typeof value === 'string') return value
    if (typeof value !== 'object' || !pay() || parents.has(value)) throw failed
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw failed
    // The object-entry visit covers constant prototype/reflection work. Key
    // slots and subsequent descriptor/copy visits are distinct paid work.
    const keys = Object.getOwnPropertyNames(value)
    if (!pay(keys.length)) throw failed
    parents.add(value)
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
    // The paid object-entry reflection and scalar descriptor visits own this
    // fixed-size line projection. Number spelling is bounded for JS doubles;
    // no points, path strings, resource fields or marker bounds are replayed.
    const kind = context ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : undefined
    const line = context === 'geometry' && kind === 'line'
    let changedLine = false, x1 = 0, y1 = 0, x2 = 0, y2 = 0
    let arrayLength: PropertyDescriptor | undefined
    const deferredProjection = deferredTerminalProjectionInput(value)
    for (const key of keys) {
      if (!pay()) throw failed
      // This visit owns descriptor retention, scalar assignment and, for the
      // four recognized line coordinates, the writer's bounded number format.
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      if (key === 'length' && Array.isArray(value)) { arrayLength = descriptor; continue }
      // Deferred terminal geometry is neither read nor used by paint writing.
      if (key === 'terminalProjection' && deferredProjection) continue
      if (!('value' in descriptor)) throw failed
      if (line && typeof descriptor.value === 'number' && (key === 'x1' || key === 'y1' || key === 'x2' || key === 'y2')) {
        const written = Number(formatSvgNumber(descriptor.value))
        changedLine ||= written !== descriptor.value
        if (key === 'x1') x1 = written
        else if (key === 'y1') y1 = written
        else if (key === 'x2') x2 = written
        else y2 = written
      }
      const childContext = context === 'leaf' && kind === 'connector' && key === 'route' ? 'route'
        : (context === 'leaf' && kind === 'shape' || context === 'route') && key === 'geometry' ? 'geometry' : undefined
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1, parents, childContext), enumerable: descriptor.enumerable, configurable: false, writable: false })
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
    // A hostile proxy can change its kind between reflective observations.
    // Never attach a line projection to a different captured geometry kind.
    if (context && Object.getOwnPropertyDescriptor(result, 'kind')?.value !== kind) throw failed
    if (changedLine) {
      if (!pay(8)) throw failed
      servedLines.set(result, Object.freeze({ kind: 'line', x1, y1, x2, y2 }))
    }
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
      const tags = scanSvgStartTags(svg)
      const root = tags.find(tag => tag.name === 'svg')
      if (!root) { uncertain = true; return header }
      if (tags.length !== 1 || root.selfClosing || decodedSvgAttributeValue(root, 'xmlns') !== 'http://www.w3.org/2000/svg'
        || !/^[ \t\r\n]*$/.test(svg.slice(0, root.start)) || !/^[ \t\r\n]*$/.test(svg.slice(root.end))) closedMarkerContext = false
      const width = formatSvgNumber(header.width), height = formatSvgNumber(header.height)
      if (decodedSvgAttributeValue(root, 'width') !== width || decodedSvgAttributeValue(root, 'height') !== height) closedMarkerContext = false
      // The new proof admits only this small, complete XML root grammar. In
      // particular, IDs, styles, ignored malformed attributes and duplicate
      // attributes cannot create a second resource or cascade authority.
      const rootNames = new Set<string>()
      let rootCursor = root.start + 4
      for (const attribute of root.attributes) {
        if (!['xmlns', 'width', 'height', 'viewBox'].includes(attribute.name) || rootNames.has(attribute.name)
          || !/^[ \t\r\n]+$/.test(svg.slice(rootCursor, attribute.nameStart))
          || svg.slice(attribute.nameStart, attribute.valueStart) !== `${attribute.name}="`
          || attribute.value.includes('&') || attribute.value.includes('<')) closedMarkerContext = false
        rootNames.add(attribute.name)
        rootCursor = attribute.valueEnd + 1
      }
      if (!/^[ \t\r\n]*>$/.test(svg.slice(rootCursor, root.end))) closedMarkerContext = false
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
    group(shell: Extract<SceneNode, { kind: 'group' }>) {
      closedMarkerContext = false
      if (!pay(shell.open.length * 8)) return undefined
      const tag = scanSvgStartTags(shell.open)[0]
      if (!tag || tag.name !== 'g') { uncertain = true; return undefined }
      const opacity = decodedSvgAttributeValue(tag, 'opacity')
      if (opacity !== shell.paint?.opacity || shell.paint?.fill !== undefined || decodedSvgAttributeValue(tag, 'style') !== undefined) uncertain = true
      const transform = decodedSvgAttributeValue(tag, 'transform')
      if (transform === undefined) return undefined
      const matrix = parseSvgTransform(transform)
      if (!matrix) uncertain = true
      return matrix && Object.freeze(matrix)
    },
    observe(node: Leaf, svg: string): boolean {
      // Reserve the actual occurrence's custody records before inspection.
      // Every inline label can add one primitive; noninline labels only make
      // this a conservative upper bound. Failed reservations are conditional.
      if (!pay(2 * (1 + (node.kind === 'connector' ? node.labels.length : 0)))) return false
      const opens = node.kind === 'document' && node.element === 'open'
      if (opens ? rootOpens !== 0 || rootCloses !== 0 : rootOpens !== 1 || rootCloses !== 0) closedMarkerContext = false
      if (node.kind === 'connector') {
        const reference = (marker: typeof node.markers.start): void => { if (marker && pay(2)) references.push(marker) }
        reference(node.markers.start)
        for (const marker of node.markers.mid) { if (!pay()) break; reference(marker) }
        reference(node.markers.end)
      } else if (node.kind === 'document' && node.element === 'open') rootOpens++
      else if (node.kind === 'document' && node.element === 'close') {
        rootCloses++
        if (svg !== '</svg>') closedMarkerContext = false
      } else if (node.kind === 'document' && node.element === 'definitions') {
        if (!pay(svg.length * 8)) return false
        if (svg.includes('<?') || svg.includes('<!')) closedMarkerContext = false
        const tags = scanSvgStartTags(svg), outer = tags[0]
        if (!outer || outer.name !== 'defs' || outer.selfClosing || outer.attributes.length
          || !/^[ \t\r\n]*$/.test(svg.slice(0, outer.start))) closedMarkerContext = false
        let resourceCursor = outer?.end ?? 0
        let markerEnd = -1
        for (const tag of tags) {
          if (!pay(tag.attributes.length + 1)) break
          if (tag.name === 'defs') {
            if (tag.attributes.length || tag.start < markerEnd) closedMarkerContext = false
          } else if (tag.name !== 'marker' && (tag.start >= markerEnd || !['circle', 'ellipse', 'line', 'rect', 'polygon', 'polyline', 'path'].includes(tag.name))) closedMarkerContext = false
          if (tag.name !== 'marker') continue
          const id = decodedSvgAttributeValue(tag, 'id')
          const end = svg.indexOf('</marker>', tag.end)
          if (!id || end < 0 || resources.has(id)) { uncertain = true; continue }
          if (!/^[ \t\r\n]*$/.test(svg.slice(resourceCursor, tag.start))) closedMarkerContext = false
          markerEnd = end + 9
          resourceCursor = markerEnd
          const bytes = svg.slice(tag.start, end + 9).replace(/(^|\n)[ \t]+(?=<)/g, '$1')
          if (!pay(2)) break
          resources.set(id, bytes)
        }
        if (!/^[ \t\r\n]*<\/defs>[ \t\r\n]*$/.test(svg.slice(resourceCursor))) closedMarkerContext = false
      } else if (node.kind === 'document') closedMarkerContext = false
      return !exhausted
    },
    leaf(node: Leaf): { node: Leaf; paintNode: Leaf; conditional: boolean } {
      let captured: Leaf | undefined
      try { captured = copy(node, 0, new Set(), 'leaf') as Leaf } catch { /* Strict mutable fallback. */ }
      if (!captured) return { node, paintNode: node, conditional: true }
      transferSceneNodeSerialization(node, captured)
      const geometry = captured.kind === 'shape' ? captured.geometry : captured.kind === 'connector' ? captured.route.geometry : undefined
      const served = geometry && servedLines.get(geometry)
      // Constructor-owned leaf/route records have fixed field sets. Reserve
      // their shallow inspection copies and overrides before allocating them.
      if (!served || !pay(48)) return { node: captured, paintNode: captured, conditional: !!served }
      // Transform operands and non-line geometry retain their existing strict
      // path; this bounded authority does not borrow a raw-space direction.
      if (captured.transform) return { node: captured, paintNode: captured, conditional: true }
      if (geometry?.kind !== 'line') return { node: captured, paintNode: captured, conditional: true }
      const collapsed = (geometry.x1 !== geometry.x2 || geometry.y1 !== geometry.y2) && served.x1 === served.x2 && served.y1 === served.y2
      if (captured.kind === 'shape') return { node: captured, paintNode: Object.freeze({ ...captured, geometry: served }), conditional: collapsed }
      if (captured.kind !== 'connector') return { node: captured, paintNode: captured, conditional: true }
      // The helper performs constant work for a scalar line, prepaid here.
      // Rebuild metadata from served coordinates, never round unit tangents.
      if (!pay(32)) return { node: captured, paintNode: captured, conditional: true }
      const contours = snapshot(connectorContourSemantics(served, captured.route.closed))
      if (!contours) return { node: captured, paintNode: captured, conditional: true }
      const route = Object.freeze({ ...captured.route, geometry: served, contours,
        startTangent: contours[0]?.startTangent, endTangent: contours.at(-1)?.endTangent })
      // Preserve the established deferred terminalProjection getter without
      // invoking it through object spread. Every descriptor is already owned;
      // charge key slots, descriptor reads and definitions before copying.
      if (!pay(2)) return { node: captured, paintNode: captured, conditional: true }
      const keys = Object.getOwnPropertyNames(captured)
      if (!pay(keys.length * 3)) return { node: captured, paintNode: captured, conditional: true }
      const paintNode = Object.create(Object.getPrototypeOf(captured)) as ConnectorMark
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(captured, key)!
        Object.defineProperty(paintNode, key, key === 'route' ? { ...descriptor, value: route } : descriptor)
      }
      return { node: captured, paintNode: Object.preventExtensions(paintNode), conditional: collapsed }
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
      // Unreferenced opaque resources have no descriptor/byte comparison and
      // could contain a shadowing child ID or malformed XML. The new closed
      // domain admits only resources checked against their actual references.
      if (closedMarkerContext && (!pay() || resources.size !== checked.size)) closedMarkerContext = false
      // Paid in observe before these immutable occurrences were created.
      // Conditional fallback occurrences already prohibit P, even if rewrapped.
      for (const primitive of inspection.primitives) if (primitive.visibility !== 'conditional') emittedOccurrences.add(primitive)
      emissionWork.set(inspection, Object.freeze({ operations, exhausted, uncertain,
        closedMarkerContext: closedMarkerContext && rootOpens === 1 && rootCloses === 1 && !uncertain && !exhausted, header }))
    },
  }
}
