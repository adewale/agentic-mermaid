import type { SceneNode, SceneDoc, ConnectorMark, Geometry, MarkPaint, ShapeMark } from './ir.ts'
import type { ScenePaintGeometryInspection, ScenePaintGeometry } from './inspection.ts'
import { scanSvgStartTags, decodedSvgAttributeValue } from '../svg-structure.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { transferRetainedPixelText } from '../shared/prepared-text.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { parseSvgTransform } from './transforms.ts'
import { deferredTerminalProjectionInput, copyDeferredTerminalProjection } from './deferred-terminal-projection.ts'
import { transferSceneNodeSerialization } from './serialization.ts'
import type { SvgGeometryWriteSink } from './svg-writer.ts'
import { connectorContourSemantics } from './connector-geometry.ts'
import { rectanglePaintFields, writtenPolylineProjectionOf } from './written-geometry.ts'
import { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'
import { createEmissionContext, type EmissionColorResolver } from './emission-context.ts'
import { verifySvgDocumentEnvelope } from '../output-security.ts'

export { MAX_OCCLUSION_OPERATIONS } from './paint-work.ts'

type Leaf = Exclude<SceneNode, { kind: 'group' }>
export interface NativeEmissionWork { readonly operations: number; readonly exhausted: boolean; readonly uncertain: boolean; readonly closedMarkerContext: boolean; readonly fractionalCircleContext: boolean; readonly header: Omit<SceneDoc, 'parts'>; readonly resolveColor?: EmissionColorResolver }
const emittedOccurrences = new WeakSet<ScenePaintGeometry>()
export function hasNativeEmissionOccurrence(primitive: ScenePaintGeometry): boolean { return emittedOccurrences.has(primitive) }
const emissionWork = new WeakMap<ScenePaintGeometryInspection, NativeEmissionWork>()
export function nativeEmissionWorkOf(inspection: ScenePaintGeometryInspection): NativeEmissionWork | undefined { return emissionWork.get(inspection) }

/** Every occurrence retains immutable operands BEFORE the existing writer
 * call. Lines and polylines retain that actual write's numeric operands;
 * the original operands still supply validation and SVG serialization.
 * Accessors/unsupported data or an exhausted capture keep paint conditional. */
export function createNativePaintEmission(maxOperations: number) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 0 || maxOperations > MAX_OCCLUSION_OPERATIONS) throw new RangeError('Invalid Native emission work allowance')
  let operations = 0, exhausted = false, uncertain = false, pendingCustomRootStyle = false, hasMarkedConnector = false
  // A deliberately smaller admission domain for new served marker proofs.
  // Existing proofs do not depend on this flat, stylesheet-free context.
  let closedMarkerContext = true, definitionsClosed = true, rootOpens = 0, rootCloses = 0
  const resources = new Map<string, string | undefined>()
  const references: NonNullable<Extract<Leaf, { kind: 'connector' }>['markers']['start']>[] = []
  const pay = (count = 1): boolean => {
    if (exhausted) return false
    if (!Number.isSafeInteger(count) || count < 0 || count > maxOperations - operations) { exhausted = true; return false }
    operations += count
    return true
  }
  const context = createEmissionContext(pay, { resources: false })
  const failed = Symbol('unsupported-emission')
  const capturedLeaves = new WeakSet<object>()
  type CaptureContext = 'leaf' | 'route' | 'geometry' | 'points' | 'point'
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
    const kind = context === 'leaf' || context === 'geometry' ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : undefined
    if ((context === 'leaf' || context === 'geometry') && typeof kind !== 'string') throw failed
    let ownedFields = 0, ownedPointSlots = 0
    let arrayLength: PropertyDescriptor | undefined
    const deferredProjection = deferredTerminalProjectionInput(value)
    for (const key of keys) {
      if (!pay()) throw failed
      // This visit owns descriptor retention and scalar assignment.
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      if (key === 'length' && Array.isArray(value)) { arrayLength = descriptor; continue }
      // Deferred terminal geometry is neither read nor used by paint writing.
      if (key === 'terminalProjection' && deferredProjection) continue
      if (!('value' in descriptor)) throw failed
      // Custody comes from the paid descriptor visits, never inherited fields
      // which could become getters after capture. No second point pass.
      if (context === 'point') {
        if (key === 'x') ownedFields |= 1
        else if (key === 'y') ownedFields |= 2
      } else if (context === 'geometry') {
        if (kind === 'line') {
          if (key === 'x1') ownedFields |= 1
          else if (key === 'y1') ownedFields |= 2
          else if (key === 'x2') ownedFields |= 4
          else if (key === 'y2') ownedFields |= 8
        } else if (kind === 'rect') {
          if (key === 'x') ownedFields |= 1
          else if (key === 'y') ownedFields |= 2
          else if (key === 'width') ownedFields |= 4
          else if (key === 'height') ownedFields |= 8
        } else if (kind === 'path' && key === 'd' || kind === 'polyline' && key === 'points') ownedFields |= 1
      } else if (context === 'leaf' && (kind === 'connector' && key === 'route' || kind === 'shape' && key === 'geometry')
        || context === 'route' && key === 'geometry') ownedFields |= 1
      const pointSlot = context === 'points' && /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 0xffff_ffff
      if (pointSlot) ownedPointSlots++
      const childContext = context === 'leaf' && kind === 'connector' && key === 'route' ? 'route'
        : (context === 'leaf' && kind === 'shape' || context === 'route') && key === 'geometry' ? 'geometry' : context === 'geometry' && kind === 'polyline' && key === 'points' ? 'points' : pointSlot ? 'point' : undefined
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1, parents, childContext), enumerable: descriptor.enumerable, configurable: false, writable: false })
    }
    const requiredFields = context === 'point' ? 3 : context === 'geometry' ? kind === 'line' || kind === 'rect' ? 15 : kind === 'polyline' || kind === 'path' ? 1 : 0
      : context === 'route' || context === 'leaf' && (kind === 'shape' || kind === 'connector') ? 1 : 0
    if (ownedFields !== requiredFields) throw failed
    if (Array.isArray(value)) {
      if (context === 'points' && ownedPointSlots !== arrayLength?.value) throw failed
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
    if ((context === 'leaf' || context === 'geometry') && Object.getOwnPropertyDescriptor(result, 'kind')?.value !== kind) throw failed
    parents.delete(value)
    // Every retained data property is already nonwritable/nonconfigurable;
    // arrays also own readonly length. Prevent extensions without rescanning
    // the same fields a second time through Object.freeze.
    return Object.preventExtensions(result)
  }
  const snapshot = <T>(value: T): T | undefined => {
    try { return copy(value) as T } catch { return undefined }
  }
  // Overlay one field of an already captured record without reading getters
  // or losing optional/nonenumerable metadata. Pay before each shallow copy.
  const replaceField = <T extends object>(source: T, field: string, value: unknown): T | undefined => {
    if (!pay(2)) return undefined
    const keys = Object.getOwnPropertyNames(source)
    const ownField = Object.getOwnPropertyDescriptor(source, field)
    if (!ownField || !('value' in ownField)) return undefined
    if (!pay(keys.length * 3)) return undefined
    const result = Object.create(Object.getPrototypeOf(source)) as T
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)!
      Object.defineProperty(result, key, key === field ? { ...descriptor, value } : descriptor)
    }
    if (capturedLeaves.has(source) && pay()) capturedLeaves.add(result)
    return Object.preventExtensions(result)
  }
  // This proof-only record cannot acquire an inherited opacity or radius
  // after emission. The writer and generic caller objects remain unchanged.
  const inertRectangleRecord = <T extends object>(source: T): T | undefined => {
    if (!pay(2)) return undefined
    const keys = Object.getOwnPropertyNames(source)
    if (!pay(keys.length * 3)) return undefined
    const result = Object.create(null) as T
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (!descriptor || !('value' in descriptor)) return undefined
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: descriptor.enumerable, writable: false, configurable: false })
    }
    if (capturedLeaves.has(source) && pay()) capturedLeaves.add(result)
    return Object.preventExtensions(result)
  }
  const rectanglePaint = (paint: MarkPaint): MarkPaint | undefined => {
    if (!pay(16)) return undefined
    const fields = Object.keys(rectanglePaintFields) as (keyof MarkPaint)[]
    if (!pay(fields.length * 4)) return undefined
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(paint, field)
      if (!descriptor) {
        if (field in paint) { uncertain = true; return undefined }
        continue
      }
      if (!('value' in descriptor)) return undefined
      const value = descriptor.value
      // The existing numeric formatter returns strings shorter than13
      // verbatim. Longer numeric paints need their own emitted authority.
      if (value !== undefined && (typeof value !== 'string' || rectanglePaintFields[field] && value.length >= 13)) return undefined
    }
    return inertRectangleRecord(paint)
  }
  const rectangleInput = (node: ShapeMark, geometry: Extract<Geometry, { kind: 'rect' }>): { paint: MarkPaint } | undefined => {
    if (!pay(16) || 'transform' in node || !(geometry.width > 0 && geometry.height > 0)) return undefined
    for (const field of ['rx', 'ry'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(geometry, field)
      if (descriptor ? !('value' in descriptor) || descriptor.value !== undefined && descriptor.value !== 0 : field in geometry) return undefined
    }
    const paint = rectanglePaint(node.paint)
    return paint ? { paint } : undefined
  }
  const sameRectanglePaint = (paint: MarkPaint, attributes: Readonly<Record<string, string>>): boolean => {
    if (!pay(16) || Object.hasOwn(attributes, 'transform')) return false
    let matched = 0
    for (const field of Object.keys(rectanglePaintFields) as (keyof MarkPaint)[]) {
      const expected = paint[field]
      // Field names are a fixed bounded inventory; arbitrary data hooks never
      // reach this record. Pay both the name conversion and string equality.
      if (!pay(field.length * 2 + 4)) return false
      const attribute = field.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
      const descriptor = Object.getOwnPropertyDescriptor(attributes, attribute)
      if (descriptor && (!('value' in descriptor) || typeof descriptor.value !== 'string')) return false
      const actual = descriptor?.value as string | undefined
      if (!pay((expected?.length ?? 0) + (actual?.length ?? 0))) return false
      if (actual !== expected) return false
      if (descriptor) matched++
    }
    return Object.getOwnPropertyNames(attributes).length === matched
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
        if (!['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border', 'font'].some(key => `--${key}` === name)) {
          if (name.startsWith('--')) pendingCustomRootStyle = true
          else uncertain = true
        } else if (colors[name.slice(2)] !== value) uncertain = true
      }
      return captured
    },
    group(shell: Extract<SceneNode, { kind: 'group' }>) {
      context.group(shell)
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
      if (node.kind === 'document') context.document(node, svg)
      else if (node.kind === 'connector') context.connector(node)
      const opens = node.kind === 'document' && node.element === 'open'
      if (opens ? rootOpens !== 0 || rootCloses !== 0 : rootOpens !== 1 || rootCloses !== 0) closedMarkerContext = false
      if (node.kind === 'connector') {
        if (node.lineStyle !== 'invisible' && (node.markers.start || node.markers.end || node.markers.mid.length)) hasMarkedConnector = true
        const reference = (marker: typeof node.markers.start): void => {
          if (!marker || !pay(4)) return
          references.push(marker)
        }
        reference(node.markers.start)
        for (const marker of node.markers.mid) { if (!pay()) break; reference(marker) }
        reference(node.markers.end)
      } else if (node.kind === 'document' && node.element === 'open') rootOpens++
      else if (node.kind === 'document' && node.element === 'close') {
        rootCloses++
        if (svg !== '</svg>') closedMarkerContext = false
      } else if (node.kind === 'document' && node.element === 'definitions') {
        if (!pay(svg.length * 8)) return false
        if (svg.includes('<?') || svg.includes('<!')) definitionsClosed = false
        const tags = scanSvgStartTags(svg), outer = tags[0]
        if (!outer || outer.name !== 'defs' || outer.selfClosing || outer.attributes.length
          || !/^<defs[ \t\r\n]*>$/.test(svg.slice(outer.start, outer.end))
          || !/^[ \t\r\n]*$/.test(svg.slice(0, outer.start))) definitionsClosed = false
        // Declarations belong to this captured definitions occurrence. Read
        // only own data slots, so fallback metadata cannot invoke getters.
        if (!pay(2)) return false
        const declaration = Object.getOwnPropertyDescriptor(node, 'markerResources')
        if (declaration) {
          if (!('value' in declaration) || declaration.value !== undefined && !Array.isArray(declaration.value)) uncertain = true
          else if (declaration.value !== undefined) {
            if (!pay(2)) return false
            const markers = declaration.value as NonNullable<typeof node.markerResources>
            const length = Object.getOwnPropertyDescriptor(markers, 'length')?.value
            if (!Number.isSafeInteger(length) || length < 0) uncertain = true
            else for (let index = 0; index < length; index++) {
              if (!pay(3)) break
              const marker = Object.getOwnPropertyDescriptor(markers, String(index))
              if (!marker || !('value' in marker)) uncertain = true
              else references.push(marker.value)
            }
          }
        }
        let resourceCursor = outer?.end ?? 0
        let markerEnd = -1
        for (const tag of tags) {
          if (!pay(tag.attributes.length + 1)) break
          if (tag.name === 'defs') {
            if (tag.attributes.length || tag.start < markerEnd) definitionsClosed = false
          } else if (tag.name !== 'marker' && (tag.start >= markerEnd || !['circle', 'ellipse', 'line', 'rect', 'polygon', 'polyline', 'path'].includes(tag.name))) definitionsClosed = false
          if (tag.name !== 'marker') continue
          const id = decodedSvgAttributeValue(tag, 'id')
          const end = svg.indexOf('</marker>', tag.end)
          if (!id || end < 0 || resources.has(id)) { uncertain = true; continue }
          if (!/^[ \t\r\n]*$/.test(svg.slice(resourceCursor, tag.start))) definitionsClosed = false
          markerEnd = end + 9
          resourceCursor = markerEnd
          const bytes = svg.slice(tag.start, end + 9).replace(/(^|\n)[ \t]+(?=<)/g, '$1')
          if (!pay(2)) break
          resources.set(id, bytes)
        }
        if (!/^[ \t\r\n]*<\/defs>[ \t\r\n]*$/.test(svg.slice(resourceCursor))) definitionsClosed = false
      } else if (node.kind === 'document') closedMarkerContext = false
      if (capturedLeaves.has(node)) {
        if (context.hint(node)) context.leaf(node, svg)
      } else context.invalidateFractionalCircle()
      return !exhausted
    },
    leaf(node: Leaf, write: (node: Leaf, sink?: SvgGeometryWriteSink) => string): { node: Leaf; paintNode: Leaf; svg: string; conditional: boolean } {
      let captured: Leaf | undefined
      try { captured = copy(node, 0, new Set(), 'leaf') as Leaf } catch { /* Strict mutable fallback. */ }
      if (!captured) return { node, paintNode: node, svg: write(node), conditional: true }
      transferSceneNodeSerialization(node, captured)
      const geometry = captured.kind === 'shape' ? captured.geometry : captured.kind === 'connector' && captured.lineStyle !== 'invisible' ? captured.route.geometry : undefined
      // Eligibility is decided before validation/writing can observe inherited
      // caller hooks. Unsupported rectangles retain their legacy inspection.
      const rectangle = captured.kind === 'shape' && geometry?.kind === 'rect' ? rectangleInput(captured, geometry) : undefined
      const supported = geometry?.kind === 'line' || geometry?.kind === 'polyline' || !!rectangle || captured.kind === 'connector' && geometry?.kind === 'path'
      // Constant custody is separate from variable projection work. The writer
      // reserves the entire token stream before allocating its first point.
      const reserved = supported && pay(192)
      let received = false, invalid = false, projectionReserved = false, served: Geometry | undefined
      let attributesReceived = false, invalidAttributes = false, attributes: Readonly<Record<string, string>> | undefined
      const sink: SvgGeometryWriteSink | undefined = reserved ? Object.assign((source: Geometry, written: Geometry | undefined) => {
        if (source !== geometry || received) { invalid = true; return }
        received = true
        // The writer's fresh rectangle record owns actual optional radii too.
        // Seal it before later attribute hooks can change Object.prototype.
        served = rectangle && written ? inertRectangleRecord(written) : written
      }, { reserveProjection: (source: Geometry, operations: number) => {
        if (source !== geometry || projectionReserved) { invalid = true; return false }
        projectionReserved = true
        return pay(operations)
      }, rectangleAttributes: rectangle ? (source: ShapeMark, written: Readonly<Record<string, string>> | undefined): void => {
        if (source !== captured || attributesReceived) { invalidAttributes = true; return }
        attributesReceived = true
        attributes = written
      } : undefined }) : undefined
      const svg = write(captured, sink)
      if (pay()) capturedLeaves.add(captured)
      const retained = { node: captured, paintNode: captured, svg, conditional: false }
      if (!supported) return retained
      // A cached serialization, missing/duplicate receipt, failed capture or
      // unsupported numeric projection cannot borrow another write's proof.
      if (!reserved || !received || invalid || !served || !geometry || served.kind !== geometry.kind) return { ...retained, conditional: true }
      if (rectangle && captured.kind === 'shape' && served.kind === 'rect') {
        if (!attributesReceived || invalidAttributes || !attributes || !sameRectanglePaint(rectangle.paint, attributes)) return { ...retained, conditional: true }
        // A rectangle has extent, not a line's start/end topology. Never
        // borrow the line-collapse branch or pre-write radii for served ink.
        if (!(served.width > 0 && served.height > 0) || (served.rx ?? 0) !== 0 || (served.ry ?? 0) !== 0) return { ...retained, conditional: true }
        const proof = inertRectangleRecord(captured)
        const overlay = proof && replaceField(proof, 'geometry', served)
        const paintNode = overlay && replaceField(overlay, 'paint', rectangle.paint)
        return paintNode ? { ...retained, paintNode, conditional: false } : { ...retained, conditional: true }
      }
      if (served === geometry) return retained
      if (captured.transform || captured.kind === 'connector' && (captured.route.closed || served.kind === 'polyline' && captured.markers.mid.length !== 0)) return { ...retained, conditional: true }
      if (!pay(48)) return { ...retained, conditional: true }
      // A path receipt owns only the actual d literal. Keep the already paid,
      // immutable routing metadata; the certifier measures actual d segments.
      const path = captured.kind === 'connector' && captured.route.geometry.kind === 'path' && served.kind === 'path'
        ? replaceField(captured.route.geometry, 'd', served.d) : undefined
      if (served.kind === 'path' && !path) return { ...retained, conditional: true }
      const projection = served.kind === 'polyline' ? writtenPolylineProjectionOf(served) : undefined
      const frozen = path ?? (served.kind === 'polyline' ? projection && served : snapshot(served))
      if (!frozen) return { ...retained, conditional: true }
      const start = frozen.kind === 'line' ? { x: frozen.x1, y: frozen.y1 } : frozen.kind === 'polyline' ? frozen.points[0] : undefined
      const end = frozen.kind === 'line' ? { x: frozen.x2, y: frozen.y2 } : frozen.kind === 'polyline' ? frozen.points.at(-1) : undefined
      const collapsed = !start || !end || (frozen.kind === 'polyline'
        ? projection!.collapsed
        : start.x === end.x && start.y === end.y)
      if (captured.kind === 'shape') return { ...retained, paintNode: Object.freeze({ ...captured, geometry: frozen }), conditional: collapsed }
      if (captured.kind !== 'connector' || !pay(64)) return { ...retained, conditional: true }
      // Rebuild directions from served coordinates, never round unit tangents.
      const contours = path ? captured.route.contours : projection?.contours ?? snapshot(connectorContourSemantics(frozen as typeof captured.route.geometry, false))
      if (!contours) return { ...retained, conditional: true }
      const route = Object.freeze({ ...captured.route, geometry: frozen, contours,
        startTangent: contours[0]?.startTangent, endTangent: contours.at(-1)?.endTangent })
      const paintNode = replaceField(captured, 'route', route)
      return paintNode ? { ...retained, paintNode, conditional: !path && collapsed } : { ...retained, conditional: true }
    },
    finish(inspection: ScenePaintGeometryInspection, header: Omit<SceneDoc, 'parts'>, svg: string, unrecordedPaint = false): void {
      // An issued inspection cannot be resealed with another document. Nor can
      // a wrapper around its already-issued occurrences borrow fresh custody.
      if (emissionWork.has(inspection)) return
      if (pay(inspection.primitives.length) && inspection.primitives.some(primitive => emittedOccurrences.has(primitive))) uncertain = true
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
      // Unbound opaque resources have no descriptor/byte comparison and
      // could contain a shadowing child ID or malformed XML. The new closed
      // domain admits only resources checked against declarations or references.
      if (closedMarkerContext && definitionsClosed && (!pay() || resources.size !== checked.size)) closedMarkerContext = false
      const checkedContext = context.finish(header)
      if (checkedContext.uncertain || pendingCustomRootStyle && !checkedContext.resolveColor) uncertain = true
      // A resolver is issued only for a validated marker-bearing context.
      // Every declared resource in that context needs actual-byte custody;
      // unrelated unmarked definitions retain their existing proof scope.
      if (checkedContext.resolveColor && (!definitionsClosed || !pay() || resources.size !== checked.size)) uncertain = true
      // This raw-document obligation belongs to marker-bearing emission proofs.
      // The callback forces a fresh parse and pays its scans and namespace work
      // from the same unchanged allowance as capture and geometric proof.
      if (hasMarkedConnector && !verifySvgDocumentEnvelope(svg, pay)) uncertain = true
      // Paid in observe before these immutable occurrences were created.
      // Conditional fallback occurrences already prohibit P, even if rewrapped.
      for (const primitive of inspection.primitives) if (primitive.visibility !== 'conditional') emittedOccurrences.add(primitive)
      emissionWork.set(inspection, Object.freeze({ operations, exhausted, uncertain,
        closedMarkerContext: closedMarkerContext && definitionsClosed && !unrecordedPaint && rootOpens === 1 && rootCloses === 1 && !uncertain && !exhausted,
        fractionalCircleContext: checkedContext.fractionalCircleContext && definitionsClosed && resources.size === checked.size
          && !unrecordedPaint && rootOpens === 1 && rootCloses === 1 && !uncertain && !exhausted,
        header, resolveColor: uncertain ? undefined : checkedContext.resolveColor }))
    },
  }
}
