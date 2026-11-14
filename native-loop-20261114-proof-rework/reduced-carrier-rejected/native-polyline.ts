import { FLOWCHART_DOTTED_DASH } from '../styles.ts'
import { relationPhrase } from '../shared/relation-direction.ts'
import type { ConnectorMark, MarkerDescriptor, ConnectorRelationship } from './ir.ts'
import { SCENE_VALIDATION_LIMITS } from './scene-validation-limits.ts'

/** Source content, not a Scene geometry/route/hit graph. */
export interface NativePolylineContent {
  id: string
  identityId: string
  from: string
  to: string
  relationship: string
  direction: ConnectorRelationship['direction']
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'thick'
  coordinates: readonly number[]
  classNames: readonly string[]
  className: string
  data: readonly (readonly [string, string])[]
  color: string
  width: string
  dash?: string
  startMarker?: string
  endMarker?: string
}
/** Only the fields emitted or retained by native paint inspection. Scene
 * diagnostic contours, endpoint copies, hit geometry and terminal projections
 * are not another stored representation of this route. */
export type NativePolylineNode = Omit<ConnectorMark, 'endpoints' | 'route' | 'hit' | 'labels' | 'terminalProjection'> & {
  endpoints: Pick<ConnectorMark['endpoints'], 'from' | 'to'>
  route: Pick<ConnectorMark['route'], 'ownership' | 'closed' | 'bendRadius' | 'labelAnchors'> & { geometry: Extract<ConnectorMark['route']['geometry'], { kind: 'polyline' }> }
  hit: Pick<ConnectorMark['hit'], 'pointerEvents'>
  labels: []
}
const freeze = Object.freeze, names = Object.getOwnPropertyNames, descriptor = Object.getOwnPropertyDescriptor
const extensible = Object.isExtensible, own = Object.hasOwn
const define = Object.defineProperty

/** Construct the one carrier required by the existing validator/writer. Every
 * leaf operand is detached primitive content or a private definition operand. */
export function buildNativePolyline(
  content: NativePolylineContent,
  pay: (count?: number) => boolean,
  marker: (id: string) => MarkerDescriptor | undefined,
): NativePolylineNode | undefined {
  const scalar = (key: keyof NativePolylineContent, optional = false): string | undefined => {
    if (!pay(3)) throw new RangeError('Native connector content work limit')
    const slot = descriptor(content, key)
    if (!slot && optional) return undefined
    if (!slot || !own(slot, 'value') || typeof slot.value !== 'string') throw new TypeError('Native connector content requires own string operands')
    return slot.value
  }
  const array = (input: readonly unknown[]): unknown[] => {
    if (!pay(4)) throw new RangeError('Native connector content work limit')
    const length = descriptor(input, 'length')
    if (!Array.isArray(input) || !length || !own(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > SCENE_VALIDATION_LIMITS.maxPoints * 2) throw new TypeError('Native connector content has invalid capacity')
    if (!pay(length.value * 3 + 1)) throw new RangeError('Native connector content work limit')
    if (names(input).length !== length.value + 1) throw new TypeError('Native connector content cannot carry opaque array metadata')
    const result: unknown[] = []
    for (let index = 0; index < length.value; index++) {
      const slot = descriptor(input, String(index))
      if (!slot || !own(slot, 'value')) throw new TypeError('Native connector content cannot contain accessors')
      define(result, index, { __proto__: null, value: slot.value, enumerable: true, writable: true, configurable: true } as PropertyDescriptor)
    }
    if (!Array.isArray(input)) throw new TypeError('Native connector content was revoked')
    return result
  }
  try {
    const id = scalar('id')!, identityId = scalar('identityId')!, from = scalar('from')!, to = scalar('to')!
    const relationship = scalar('relationship')!, direction = scalar('direction')!, lineStyle = scalar('lineStyle')!
    const color = scalar('color')!, width = scalar('width')!, className = scalar('className')!, dash = scalar('dash', true)
    const startId = scalar('startMarker', true), endId = scalar('endMarker', true)
    if (from === to || !['forward', 'reverse', 'bidirectional', 'undirected'].includes(direction) || !['solid', 'dashed', 'dotted', 'thick'].includes(lineStyle)) return undefined
    const start = startId === undefined ? undefined : marker(startId), end = endId === undefined ? undefined : marker(endId)
    if (startId !== undefined && !start || endId !== undefined && !end) return undefined
    const arrayField = (key: keyof NativePolylineContent): unknown[] => {
      if (!pay(3)) throw new RangeError('Native connector content work limit')
      const slot = descriptor(content, key)
      if (!slot || !own(slot, 'value')) throw new TypeError('Native connector content requires own arrays')
      return array(slot.value)
    }
    const coordinates = arrayField('coordinates'), classes = arrayField('classNames'), dataRows = arrayField('data')
    if (coordinates.length < 4 || coordinates.length % 2) return undefined
    for (let index = 0; index < classes.length; index++) if (typeof classes[index] !== 'string') return undefined
    const points: Array<{ x: number; y: number }> = []
    for (let index = 0; index < coordinates.length; index += 2) {
      const x = coordinates[index], y = coordinates[index + 1]
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || !pay(3)) return undefined
      define(points, points.length, { __proto__: null, value: freeze({ x, y }), enumerable: true, writable: true, configurable: true } as PropertyDescriptor)
    }
    const geometry = freeze({ kind: 'polyline' as const, points: freeze(points) as unknown as Array<{ x: number; y: number }> })
    const data = { __proto__: null } as unknown as Record<string, string>
    for (let index = 0; index < dataRows.length; index++) {
      const pair = array(dataRows[index] as readonly unknown[])
      if (pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || own(data, pair[0])) return undefined
      define(data, pair[0], { __proto__: null, value: pair[1], enumerable: true } as PropertyDescriptor)
    }
    // These are literal construction sites, not admission of arbitrary Scene
    // records. Reserve allocation/slot and seal work before each allocation;
    // every child is already owned before its parent can be exposed.
    const reserve = (slots: number): void => {
      if (!pay(slots + 2)) throw new RangeError('Native connector construction work limit')
    }
    const seal = <T extends object>(value: T): T => {
      if (freeze(value) !== value || extensible(value)) throw new TypeError('Native connector could not be closed')
      return value
    }
    const point = (x: number, y: number): { x: number; y: number } => { reserve(2); return seal({ x, y }) }
    const empty = (): never[] => { reserve(1); return seal([]) }
    reserve(classes.length + 1); seal(classes)
    reserve(dataRows.length); seal(data)
    reserve(2); const endpoints = seal({ from, to })
    reserve(2); const relation = seal({ kind: relationship, direction: direction as ConnectorRelationship['direction'] })
    const labelAnchors = empty()
    reserve(5)
    const route = seal({ geometry, ownership: 'layout' as const, closed: false, bendRadius: 0, labelAnchors })
    const dashArray = dash ?? (lineStyle === 'dashed' ? '6 4' : lineStyle === 'dotted' ? `${FLOWCHART_DOTTED_DASH.dash} ${FLOWCHART_DOTTED_DASH.gap}` : undefined)
    let strokeDash
    if (dashArray) { reserve(1); strokeDash = seal({ array: dashArray }) }
    reserve(6 + Number(!!strokeDash))
    const stroke = seal({ color, width, ...(strokeDash ? { dash: strokeDash } : {}), lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 4, nonScaling: false })
    const mid = empty()
    reserve(1 + Number(!!start) + Number(!!end))
    const markers = seal({ ...(start ? { start } : {}), mid, ...(end ? { end } : {}) })
    reserve(4 + Number(!!classes.length))
    const identity = seal({ id: identityId, role: 'edge' as const, from, to, ...(classes.length ? { classNames: classes as string[] } : {}) })
    reserve(2); const accessibilityRelation = seal({ from, to })
    reserve(4); const accessibility = seal({ label: relationPhrase(from, to, relation.direction), role: 'graphics-symbol' as const, roleDescription: 'relation' as const, relation: accessibilityRelation })
    reserve(1); const hit = seal({ pointerEvents: 'stroke' as const })
    const labels = empty() as []
    reserve(2); const attributes = seal({ className, data })
    reserve(14)
    const node: NativePolylineNode = {
      kind: 'connector', id, role: 'edge', lineStyle: lineStyle as NativePolylineContent['lineStyle'],
      endpoints, relationship: relation, route, stroke, markers, labels, hit, identity,
      accessibility, attributes,
    }
    seal(node)
    return node
  } catch { return undefined }
}
