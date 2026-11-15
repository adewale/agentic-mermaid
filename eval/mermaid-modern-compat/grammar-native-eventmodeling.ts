import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { NativeOperationProjection } from './grammar-native-operations.ts'
import type { Json } from './reference.ts'
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const scope = ['ordered authored frame IDs, reset kind, type, qualified entity, explicit source refs and frame data', 'inferred relations, data declarations, notes, specifications and metadata are outside this AST/operation scope'] as const
const aliases: Record<string, string> = { ui: 'ui', pcr: 'processor', processor: 'processor', cmd: 'command', command: 'command', rmo: 'readmodel', readmodel: 'readmodel', evt: 'event', event: 'event' }
function nativeFrame(value: unknown): Json {
  const frame = row(value), data = row(frame.data)
  return [text(frame.id), frame.reset === true, text(frame.type), text(frame.entity), list(frame.sources).map(text), text(frame.dataReference), frame.data ? [text(data.type), text(data.text)] : null]
}
function referenceFrame(value: unknown): Json {
  const frame = row(value), raw = text(frame.dataInlineValue)
  // This is the upstream terminal operand, not local source re-parsing. Its
  // first/last delimiter are syntax; every interior character remains data.
  return [text(frame.name), frame.$type === 'EmResetFrame', aliases[text(frame.modelEntityType)] ?? text(frame.modelEntityType), text(frame.entityIdentifier), list(frame.sourceFrames).map(ref => text(row(ref).$refText)), text(row(frame.dataReference).$refText), raw ? [text(frame.dataType), raw.slice(1, -1)] : null]
}
export function projectNativeEventModeling(family: string, model: unknown): NativeSemanticProjection | undefined {
  return family === 'eventmodeling' ? { fields: ['frames'], value: { frames: list(row(model).frames).map(nativeFrame) } } : undefined
}
export function projectReferenceEventModeling(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (family !== 'eventmodeling' || reply.ast.status !== 'available') return undefined
  return { fields: ['frames'], value: { frames: list(row(reply.ast.value).frames).map(referenceFrame) } }
}
export function projectNativeEventModelingOperations(family: string, events: readonly ParserObservation[]): NativeOperationProjection | undefined {
  if (family !== 'eventmodeling') return undefined
  const selected = events.filter(event => event.kind === 'append-frame')
  return { scope, operations: selected.map(event => ['frame', nativeFrame(event.value)]), sourceEvents: events.length, selectedSourceEvents: selected.length, unmapped: Object.fromEntries([...new Set(events.filter(event => event.kind !== 'append-frame').map(event => event.kind))].map(kind => [kind, events.filter(event => event.kind === kind).length])), unmappedOperands: {} }
}
export function projectReferenceEventModelingOperations(family: string, reply: GrammarReferenceReply): NativeOperationProjection | undefined {
  if (family !== 'eventmodeling' || reply.actions.status !== 'available') return undefined
  const actions = reply.actions.value
  const selected = actions.filter(action => action[0] === 'setAst')
  return { scope, operations: selected.flatMap(action => list(row(action[1]).frames).map(frame => ['frame', referenceFrame(frame)])), sourceEvents: actions.length, selectedSourceEvents: selected.length, unmapped: Object.fromEntries([...new Set(actions.filter(action => action[0] !== 'setAst').map(action => text(action[0])))].map(kind => [kind, actions.filter(action => action[0] === kind).length])), unmappedOperands: {} }
}
