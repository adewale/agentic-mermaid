import type { C4Body } from '../../src/c4/types.ts'
import { normalizeBrTags } from '../../src/multiline-utils.ts'
import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import type { NativeOperationProjection } from './grammar-native-operations.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const label = (value: unknown): string => normalizeBrTags(typeof value === 'string' ? value : text(row(value).text))
const direction = (type: string): string => ({ rel_u: 'BT', rel_d: 'TB', rel_l: 'RL', rel_r: 'LR' } as Record<string, string>)[type] ?? ''
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })

function element(type: string, id: unknown, title: unknown, technology: unknown, description: unknown, parent: string): Json {
  const kind = type.replace(/^external_/, '').replace(/_(?:db|queue)$/, '')
  return { id: text(id), kind, external: type.startsWith('external_'), shape: kind === 'person' ? 'person' : type.endsWith('_db') ? 'database' : type.endsWith('_queue') ? 'queue' : 'rectangle', label: label(title), technology: label(technology), description: label(description), parent }
}
function relationship(type: string, from: unknown, to: unknown, title: unknown, technology: unknown, description: unknown): Json {
  return { from: text(type === 'rel_b' ? to : from), to: text(type === 'rel_b' ? from : to), label: label(title), technology: label(technology), description: label(description), startMarker: type === 'birel', endMarker: true, direction: direction(type) }
}
const nativeRelationshipType = (value: Record<string, unknown>): string => value.reversed ? 'rel_b' : value.bidirectional ? 'birel' : ({ BT: 'rel_u', TB: 'rel_d', RL: 'rel_l', LR: 'rel_r' } as Record<string, string>)[text(value.direction)] ?? 'rel'
function nativeElement(value: Record<string, unknown>): Json {
  return { id: text(value.id), kind: text(value.kind), external: value.external === true, shape: text(value.shape), label: label(value.label), technology: label(value.technology), description: label(value.description), parent: text(value.parentId) }
}
function nativeBoundary(value: Record<string, unknown>): Json {
  return { id: text(value.id), label: label(value.label), description: label(value.description), parent: text(value.parentId) }
}

/** Selected result fields, independently mapped from C4's actual DB. Boundary
 * kind/custom type, paint, tags, links, generated interaction IDs and RelIndex
 * are outside this scope. Repeated reference pairs remain visible as drift. */
export function projectNativeC4(family: string, model: unknown): NativeSemanticProjection | undefined {
  if (family !== 'c4') return undefined
  const body = model as C4Body
  if (!Array.isArray(body.elements) || !Array.isArray(body.boundaries) || !Array.isArray(body.relationships)) return undefined
  return projection({
    variant: body.variant, title: body.title ?? '',
    elements: body.elements.map(item => nativeElement(item as unknown as Record<string, unknown>)),
    boundaries: body.boundaries.map(item => nativeBoundary(item as unknown as Record<string, unknown>)),
    relationships: body.relationships.map(item => relationship(nativeRelationshipType(item as unknown as Record<string, unknown>), item.from, item.to, item.label, item.technology, item.description)),
  })
}
export function projectReferenceC4(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (family !== 'c4' || !reply.accepted) return undefined
  const data = reply.snapshot?.data
  if (!Array.isArray(data?.getC4ShapeArray) || !Array.isArray(data.getBoundaries) || !Array.isArray(data.getRels)) return undefined
  const boundaries = data.getBoundaries.map(row)
  // Only the untouched reference root is synthetic. An authored alias with
  // these bytes must stay observable rather than being globally rewritten.
  const sentinel = boundaries.find(item => item.alias === 'global' && label(item.label) === 'global' && label(item.type) === 'global' && !item.parentBoundary)
  const parent = (value: unknown): string => sentinel && value === sentinel.alias ? '' : text(value)
  return projection({
    variant: text(data.getC4Type), title: label(data.getTitle),
    elements: data.getC4ShapeArray.map(value => { const item = row(value); return element(label(item.typeC4Shape), item.alias, item.label, item.techn, item.descr, parent(item.parentBoundary)) }),
    boundaries: boundaries.filter(item => item !== sentinel).map(item => ({ id: text(item.alias), label: label(item.label), description: label(item.descr), parent: parent(item.parentBoundary) })),
    relationships: data.getRels.map(value => { const item = row(value); return relationship(text(item.type), item.from, item.to, item.label, item.techn, item.descr) }),
  })
}

const SCOPE = [
  'ordered element declarations: alias, kind, external status, shape, labels, technology, description and parent',
  'ordered boundary open/close: alias, labels, description and parent',
  'ordered relationship writes: effective endpoints, labels, technology, description, marker sides and direction',
  'variant/title, styles/config, tags/links, generated IDs and RelIndex omitted; reference variant is committed last',
] as const
const operationProjection = (size: number): NativeOperationProjection => ({ scope: SCOPE, operations: [], sourceEvents: size, selectedSourceEvents: 0, unmapped: {}, unmappedOperands: {} })
const operands = (kind: string, value: Json): Json[] => [kind, value]

export function projectNativeC4Operations(events: readonly ParserObservation[]): NativeOperationProjection {
  const result = operationProjection(events.length)
  for (const event of events) {
    const item = row(event.value)
    if (event.kind === 'add-element') result.operations.push(operands('element', nativeElement(item)))
    else if (event.kind === 'open-boundary') result.operations.push(operands('open-boundary', nativeBoundary(item)))
    else if (event.kind === 'close-boundary') result.operations.push(['close-boundary', text(item.id)])
    else if (event.kind === 'add-relationship') result.operations.push(operands('relationship', relationship(nativeRelationshipType(item), item.from, item.to, item.label, item.technology, item.description)))
    else { result.unmapped[event.kind] = (result.unmapped[event.kind] ?? 0) + 1; continue }
    result.selectedSourceEvents++
  }
  return result
}

/** Optional named yy operands are single-key objects in arbitrary slots. This
 * table follows the reference DB signatures rather than native argument code. */
function optionalFields(values: unknown[], names: string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  values.forEach((value, index) => {
    if (value === null || value === undefined) return
    if (typeof value === 'object') Object.assign(fields, row(value))
    else if (names[index]) fields[names[index]!] = value
  })
  return fields
}
export function projectReferenceC4Operations(reply: GrammarReferenceReply): NativeOperationProjection | undefined {
  if (reply.actions.status !== 'available') return undefined
  const result = operationProjection(reply.actions.value.length), parents: string[] = []
  for (const action of reply.actions.value) {
    const kind = text(action[0])
    if (['addPersonOrSystem', 'addContainer', 'addComponent'].includes(kind)) {
      const names = kind === 'addPersonOrSystem' ? ['descr', 'sprite', 'tags', 'link'] : ['techn', 'descr', 'sprite', 'tags', 'link']
      const fields = optionalFields(action.slice(4), names)
      result.operations.push(operands('element', element(text(action[1]), action[2], action[3], fields.techn, fields.descr, parents.at(-1) ?? '')))
    } else if (['addPersonOrSystemBoundary', 'addContainerBoundary', 'addDeploymentNode'].includes(kind)) {
      const deployment = kind === 'addDeploymentNode', offset = deployment ? 2 : 1
      const fields = optionalFields(action.slice(offset + 2), deployment ? ['type', 'descr', 'sprite', 'tags', 'link'] : ['type', 'tags', 'link'])
      const id = text(action[offset])
      result.operations.push(operands('open-boundary', { id, label: label(action[offset + 1]), description: label(fields.descr), parent: parents.at(-1) ?? '' }))
      parents.push(id)
    } else if (kind === 'popBoundaryParseStack') result.operations.push(['close-boundary', parents.pop() ?? ''])
    else if (kind === 'addRel') {
      const fields = optionalFields(action.slice(5), ['techn', 'descr', 'sprite', 'tags', 'link'])
      result.operations.push(operands('relationship', relationship(text(action[1]), action[2], action[3], action[4], fields.techn, fields.descr)))
    } else { result.unmapped[kind] = (result.unmapped[kind] ?? 0) + 1; continue }
    result.selectedSourceEvents++
  }
  return result
}
