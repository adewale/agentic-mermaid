import type { ConnectorContourSemantics, Geometry, MarkPaint, ScenePoint, ShapeMark } from './ir.ts'
import { scanSvgStartTagsFresh, decodedSvgAttributeValue } from '../svg-structure.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'

// The complete paint field set read by the shape writer. Only numeric
// attributes can acquire a different literal through SVG number formatting.
export const rectanglePaintFields: Record<keyof MarkPaint, boolean> = {
  fill: false, fillOpacity: true, stroke: false, strokeOpacity: true,
  strokeWidth: true, strokeDasharray: true, strokeDashoffset: true,
  strokeLinecap: false, strokeLinejoin: false, strokeMiterlimit: true,
  vectorEffect: false, paintOrder: false, opacity: true,
}

export interface WrittenPolylineProjection {
  readonly contours: readonly ConnectorContourSemantics[]
  readonly collapsed: boolean
  readonly rawBounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  readonly rawStart: ScenePoint
  readonly rawEnd: ScenePoint
  readonly rawStartTangent?: ScenePoint
  readonly rawEndTangent?: ScenePoint
}

const projections = new WeakMap<object, WrittenPolylineProjection>()

/** Only a fresh geometry receives metadata. Existing projections cannot be
 * overwritten, and this derived data alone supplies no write/context custody.
 * The writer transfers its prepaid, individually frozen points and contours. */
export function createWrittenPolyline(points: ScenePoint[], projection: WrittenPolylineProjection): Extract<Geometry, { kind: 'polyline' }> {
  const geometry = Object.freeze({ kind: 'polyline' as const, points })
  projections.set(geometry, Object.freeze(projection))
  return geometry
}

export function writtenPolylineProjectionOf(geometry: object): WrittenPolylineProjection | undefined { return projections.get(geometry) }

type Pay = (count: number) => boolean
interface Piece { readonly kind: 'rect' | 'line' | 'ellipse'; readonly geometry: Readonly<Record<string, number>>; readonly paint: MarkPaint }
declare const compoundInput: unique symbol
export interface WrittenCompoundInput { readonly [compoundInput]: true }
interface Input { readonly source: Geometry; readonly sources: readonly Geometry[]; readonly pieces: readonly Piece[]; readonly identity: ReadonlyMap<string, string>; observed: number; invalid: boolean }
const inputs = new WeakMap<WrittenCompoundInput, Input>()
const compoundProjections = new WeakSet<object>()
const own = (o: object, key: string): PropertyDescriptor | undefined => Object.getOwnPropertyDescriptor(o, key)
const ownData = (o: object, key: string): unknown => { const d = own(o, key); return d && Object.hasOwn(d, 'value') ? d.value : undefined }
const geometrySlots = { rect: ['x', 'y', 'width', 'height'], line: ['x1', 'y1', 'x2', 'y2'], ellipse: ['cx', 'cy', 'rx', 'ry'] } as const
const attributeName = (field: string): string => field.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
const record = <T extends object>(source: T): T => Object.freeze(Object.assign(Object.create(null), source))

/** Structural eligibility is deliberately exact, not a family or node-ID rule.
 * Only three/five-piece structural candidates pay an SVG scan. No generic raw input
 * may reach this entry point before its existing private ownership gate. */
export function prepareWrittenCompoundShape(node: ShapeMark, pay: Pay): WrittenCompoundInput | undefined {
  if (!pay(24)) return undefined
  const geometry = ownData(node, 'geometry') as Geometry | undefined
  if (!geometry || ownData(geometry, 'kind') !== 'compound') return undefined
  const children = ownData(geometry, 'children') as unknown
  const childPaints = ownData(node, 'childPaints') as unknown
  if (!Array.isArray(children) || children.length !== 3 && children.length !== 5 || !Array.isArray(childPaints) || childPaints.length !== children.length) return undefined
  // Reject other compound structures before identity or paint capture.
  if (!pay(12)) return undefined
  const kinds: readonly Piece['kind'][] = children.length === 3 ? ['rect', 'line', 'line'] : ['rect', 'line', 'line', 'ellipse', 'ellipse']
  for (let i = 0; i < kinds.length; i++) {
    if (!pay(6)) return undefined
    const child = ownData(children, String(i))
    if (!child || typeof child !== 'object' || ownData(child, 'kind') !== kinds[i]) return undefined
  }
  const transform = own(node, 'transform')
  if (transform ? !Object.hasOwn(transform, 'value') || transform.value !== undefined : 'transform' in node) return undefined
  const pieces: Piece[] = [], sources: Geometry[] = []
  const identity = ownData(node, 'identity')
  if (!identity || typeof identity !== 'object') return undefined
  const expectedIdentity = new Map<string, string>()
  for (const field of ['id', 'role', 'from', 'to']) {
    if (!pay(2)) return undefined
    const d = own(identity, field)
    if (!d) { if (field in identity || field === 'id' || field === 'role') return undefined; continue }
    if (!Object.hasOwn(d, 'value') || typeof d.value !== 'string' || !pay(d.value.length)) return undefined
    expectedIdentity.set(`data-${field}`, d.value)
  }
  for (const field of ['attributes', 'accessibility']) {
    if (!pay(4)) return undefined
    const descriptor = own(node, field)
    if (!descriptor) { if (field in node) return undefined; continue }
    if (!Object.hasOwn(descriptor, 'value')) return undefined
    const value = descriptor.value
    if (value === undefined) continue
    if (!value || typeof value !== 'object') return undefined
    if (field === 'accessibility') {
      for (const [key, attribute] of [['role', 'role'], ['roleDescription', 'aria-roledescription'], ['label', 'aria-label']] as const) {
        if (!pay(2)) return undefined
        const text = ownData(value, key)
        if (typeof text !== 'string' || !pay(text.length)) return undefined
        expectedIdentity.set(attribute, text)
      }
      continue
    }
    for (const key of ['className', 'data', 'ariaHidden', 'tabIndex', 'ariaLabel']) {
      if (!pay(2)) return undefined
      const d = own(value, key)
      if (!d) { if (key in value) return undefined; continue }
      if (!Object.hasOwn(d, 'value')) return undefined
      const item = d.value
      if (item === undefined) continue
      if (key === 'className') { if (item !== '') return undefined }
      else if (key === 'data') {
        if (!item || typeof item !== 'object' || !pay(2)) return undefined
        const keys = Object.keys(item)
        if (!pay(keys.length * 3)) return undefined
        for (const dataKey of keys) {
          const text = ownData(item, dataKey)
          if (typeof text !== 'string' || !pay(dataKey.length + text.length)) return undefined
          expectedIdentity.set(`data-${dataKey}`, text)
        }
      } else if (key === 'ariaHidden') { if (item !== true) return undefined; expectedIdentity.set('aria-hidden', 'true') }
      else if (key === 'tabIndex') { if (item !== 0) return undefined; expectedIdentity.set('tabindex', '0') }
      else if (typeof item !== 'string' || !pay(item.length)) return undefined
      else expectedIdentity.set('aria-label', item)
    }
  }
  for (let i = 0; i < kinds.length; i++) {
    if (!pay(6)) return undefined
    const slot = own(children, String(i)), paintSlot = own(childPaints, String(i))
    if (!slot || !Object.hasOwn(slot, 'value') || !paintSlot || !Object.hasOwn(paintSlot, 'value')) return undefined
    const child = slot.value, paint = paintSlot.value, kind = kinds[i]!
    if (!child || typeof child !== 'object' || !paint || typeof paint !== 'object' || ownData(child, 'kind') !== kind) return undefined
    const scalar: Record<string, number> = Object.create(null)
    for (const field of geometrySlots[kind]) {
      if (!pay(2)) return undefined
      const d = own(child, field)
      if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'number' || !Number.isFinite(d.value)) return undefined
      scalar[field] = d.value
    }
    if (kind === 'rect') for (const field of ['rx', 'ry']) {
      if (!pay(2)) return undefined
      const d = own(child, field)
      if (d ? !Object.hasOwn(d, 'value') || d.value !== undefined && d.value !== 0 : field in child) return undefined
      if (d?.value === 0) scalar[field] = 0
    }
    const retained: Record<string, string> = Object.create(null)
    for (const field of Object.keys(rectanglePaintFields)) {
      if (!pay(2)) return undefined
      const d = own(paint, field)
      if (!d) { if (field in paint) return undefined; continue }
      if (!Object.hasOwn(d, 'value') || d.value !== undefined && typeof d.value !== 'string') return undefined
      if (d.value !== undefined) {
        if (!pay(d.value.length)) return undefined
        retained[field] = d.value
      }
    }
    sources.push(child)
    pieces.push(Object.freeze({ kind, geometry: record(scalar), paint: record(retained) }))
  }
  const token = Object.freeze(Object.create(null)) as WrittenCompoundInput
  inputs.set(token, { source: geometry, sources: Object.freeze(sources), pieces: Object.freeze(pieces), identity: expectedIdentity, observed: 0, invalid: false })
  return token
}

// Both supported structures emit exactly the rect/line/line callbacks. The
// ellipse writer emits no geometry callback; its two literal tags and paints
// are still checked by the complete fresh-fragment scan below.
export function observeWrittenCompoundShape(token: WrittenCompoundInput, source: Geometry, written: Geometry | undefined, pay: Pay): void {
  const input = inputs.get(token)
  if (!input) return
  if (!pay(16) || input.observed >= 3 || source !== input.sources[input.observed] || !written || ownData(written, 'kind') !== input.pieces[input.observed]!.kind) { input.invalid = true; return }
  const piece = input.pieces[input.observed]!
  for (const field of Object.keys(piece.geometry)) if (ownData(written, field) !== Number(formatSvgNumber(piece.geometry[field]!))) input.invalid = true
  input.observed++
}

/** Consume exactly this first write. Derived data alone conveys no emission
 * authority: Native/Scene must still bind this source, bytes, and occurrence. */
export function completeWrittenCompoundShape(token: WrittenCompoundInput, source: Geometry, svg: string, pay: Pay): { geometry: Extract<Geometry, { kind: 'compound' }>; childPaints: readonly MarkPaint[] } | undefined {
  const input = inputs.get(token)
  inputs.delete(token)
  if (!input || input.invalid || input.observed !== 3 || source !== input.source || !pay(6 * svg.length + 8)) return undefined
  const tags = scanSvgStartTagsFresh(svg)
  if (tags.length !== input.pieces.length) return undefined
  const children: Geometry[] = [], paints: MarkPaint[] = []
  let cursor = 0
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!, piece = input.pieces[i]!
    if (!pay(tag.attributes.length * 4 + tag.start - cursor) || tag.name !== piece.kind || !tag.selfClosing || !/^[\t\n\r ]*$/.test(svg.slice(cursor, tag.start))) return undefined
    cursor = tag.end
    const expected = new Map<string, string>(), numbers: Record<string, number> = Object.create(null), paint: Record<string, string> = Object.create(null)
    for (const [field, value] of Object.entries(piece.geometry)) expected.set(field, formatSvgNumber(value))
    for (const [field, value] of Object.entries(piece.paint)) expected.set(attributeName(field), formatSvgNumericAttribute(attributeName(field), value!))
    if (i === 0) for (const [field, value] of input.identity) expected.set(field, value)
    const seen = new Set<string>()
    for (const attribute of tag.attributes) {
      if (seen.has(attribute.name)) return undefined
      seen.add(attribute.name)
      const literal = decodedSvgAttributeValue(tag, attribute.name)
      if (expected.has(attribute.name)) {
        if (literal !== expected.get(attribute.name)) return undefined
        expected.delete(attribute.name)
      } else return undefined
    }
    if (expected.size) return undefined
    for (const field of Object.keys(piece.geometry)) {
      const value = Number(decodedSvgAttributeValue(tag, field))
      if (!Number.isFinite(value)) return undefined
      numbers[field] = value
    }
    for (const field of Object.keys(piece.paint)) paint[field] = decodedSvgAttributeValue(tag, attributeName(field))!
    const child = record({ kind: piece.kind, ...numbers }) as unknown as Geometry
    if (child.kind === 'rect' && !(child.width > 0 && child.height > 0) || child.kind === 'ellipse' && !(child.rx > 0 && child.ry > 0)) return undefined
    children.push(child); paints.push(record(paint))
  }
  if (!pay(svg.length - cursor) || !/^[\t\n\r ]*$/.test(svg.slice(cursor))) return undefined
  Object.freeze(children)
  const geometry = record({ kind: 'compound' as const, children })
  compoundProjections.add(geometry)
  return { geometry, childPaints: Object.freeze(paints) }
}

export function hasWrittenCompoundProjection(geometry: object): boolean { return compoundProjections.has(geometry) }
