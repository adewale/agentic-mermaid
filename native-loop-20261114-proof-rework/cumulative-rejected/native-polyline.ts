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
export type NativePolylineNode = Pick<ConnectorMark, 'kind' | 'id' | 'role' | 'lineStyle' | 'stroke' | 'markers' | 'identity' | 'attributes'> & {
  endpoints: Pick<ConnectorMark['endpoints'], 'from' | 'to'>
  coordinates: readonly number[]
  relationshipKind: string
  direction: ConnectorRelationship['direction']
  accessibilityLabel: string
}
export type NativePolylinePaintNode = Pick<ConnectorMark, 'kind' | 'id' | 'role' | 'lineStyle' | 'stroke' | 'markers' | 'identity' | 'transform' | 'visibility' | 'owner'> & {
  endpoints: Pick<ConnectorMark['endpoints'], 'from' | 'to'>
  route: ConnectorMark['route']
  labels: []
}
const freeze = Object.freeze, names = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor
const extensible = Object.isExtensible, own = Object.hasOwn
const define = Object.defineProperty

const contentFields = { __proto__: null, id: true, identityId: true, from: true, to: true, relationship: true, direction: true, lineStyle: true, coordinates: true, classNames: true, className: true, data: true, color: true, width: true, dash: true, startMarker: true, endMarker: true }

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
    if (!pay(18)) return undefined
    const keys = names(content)
    if (keys.length > 16 || !pay(keys.length)) return undefined
    for (let index = 0; index < keys.length; index++) if (typeof keys[index] !== 'string' || !own(contentFields, keys[index]!)) return undefined
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
    for (let index = 0; index < coordinates.length; index++) {
      if (typeof coordinates[index] !== 'number' || !Number.isFinite(coordinates[index])) return undefined
    }
    if (!pay(coordinates.length + 4)) return undefined
    const retainedCoordinates = freeze(coordinates as number[])
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
    const empty = (): never[] => { reserve(1); return seal([]) }
    reserve(classes.length + 1); seal(classes)
    reserve(dataRows.length); seal(data)
    reserve(2); const endpoints = seal({ from, to })
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
    reserve(2); const attributes = seal({ className, data })
    reserve(13)
    const node: NativePolylineNode = {
      kind: 'connector', id, role: 'edge', lineStyle: lineStyle as NativePolylineContent['lineStyle'],
      endpoints, stroke, markers, identity, attributes, coordinates: retainedCoordinates, relationshipKind: relationship,
      direction: direction as ConnectorRelationship['direction'], accessibilityLabel: relationPhrase(from, to, direction as ConnectorRelationship['direction']),
    }
    seal(node)
    if (!pay(1) || Array.isArray(content)) return undefined
    return node
  } catch { return undefined }
}
