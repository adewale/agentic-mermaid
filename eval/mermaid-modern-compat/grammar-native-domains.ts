import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import type { ZenUmlBody } from '../../src/zenuml/types.ts'
import { projectZenUmlSequence } from '../../src/zenuml/projection.ts'
import type { NativeOperationProjection } from './grammar-native-operations.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const type = (value: unknown): string => ({ cmd: 'command', rmo: 'readmodel', evt: 'event', pcr: 'processor' }[text(value)] ?? text(value))
const payload = (value: Row): Json => ({ type: text(value.type), text: text(value.text) })
const inline = (value: Row): Json | null => {
  if (typeof value.dataInlineValue !== 'string') return null
  return { type: text(value.dataType), text: value.dataInlineValue.slice(1, -1).replace(/^\r?\n|\r?\n$/g, '') }
}
const nativeFrame = (value: Row): Json => ({ id: text(value.id), type: text(value.entityType), entity: text(value.entity), reset: value.reset === true, sources: list(value.sources).map(text), dataReference: text(value.dataReference), data: value.data ? payload(row(value.data)) : null })
const referenceFrame = (value: Row): Json => ({ id: text(value.name), type: type(value.modelEntityType), entity: text(value.entityIdentifier), reset: value.$type === 'EmResetFrame', sources: list(value.sourceFrames).map(source => text(row(source).$refText)), dataReference: text(row(value.dataReference).$refText), data: inline(value) })
const projection = (value: Json): NativeSemanticProjection => ({ fields: Object.keys(row(value)), value })

/** Returned-model evidence stays separate from actual write observations. */
export function projectNativeDomains(family: string, model: unknown): NativeSemanticProjection | undefined {
  const body = row(model)
  if (family === 'eventmodeling') return projection({ frames: list(body.frames).map(frame => nativeFrame(row(frame))) })
  if (family === 'zenuml') {
    const sequence = projectZenUmlSequence(model as ZenUmlBody)
    return projection({ participants: list(body.participants).map(value => ({ id: text(row(value).id), label: text(row(value).label) })), messages: sequence.messages.map(message => ({ from: message.from === '$zenuml:external' ? '' : message.from, to: message.to === '$zenuml:external' ? '' : message.to, label: message.label })) })
  }
}
export function projectReferenceDomains(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (family === 'eventmodeling') return projection({ frames: list(row(reply.snapshot?.data.getEventModel).frames).map(frame => referenceFrame(row(frame))) })
  if (family === 'zenuml') {
    const body = row(reply.snapshot?.data.getZenModel)
    return projection({ participants: list(body.participants) as Json[], messages: list(body.messages).map(message => ({ from: text(row(message).from), to: text(row(message).to), label: text(row(message).label) })) })
  }
}

const scopes: Record<string, readonly string[]> = {
  eventmodeling: ['ordered frame writes including exact identity, entity/type, reset, explicit references and inline payload; actual reference setAst batch operands expanded; implicit layout inference, named data, notes and GWT omitted'],
  zenuml: ['ordered completed message and explicit return writes: actual endpoints, text and call mode; reference ANTLR statement-rule commit operands observed before context release; declarations, regions, annotations and generated assignment replies omitted'],
}
const create = (family: string, size: number): NativeOperationProjection | undefined => scopes[family] ? { scope: scopes[family]!, operations: [], sourceEvents: size, selectedSourceEvents: 0, unmapped: {}, unmappedOperands: {} } : undefined
export function projectNativeDomainOperations(family: string, events: readonly ParserObservation[]): NativeOperationProjection | undefined {
  const out = create(family, events.length)
  if (!out) return undefined
  for (const event of events) {
    const value = row(event.value)
    if (family === 'eventmodeling' && event.kind === 'append-frame') out.operations.push(['frame', nativeFrame(value)])
    else if (family === 'zenuml' && event.kind === 'append-return') out.operations.push(['return', text(value.from), text(value.to), text(value.text)])
    else if (family === 'zenuml' && event.kind === 'append-message') out.operations.push(value.mode === 'reply' ? ['return', text(value.from), text(value.to), text(value.text)] : ['message', text(value.from), text(value.to), text(value.text), text(value.mode)])
    else { out.unmapped[event.kind] = (out.unmapped[event.kind] ?? 0) + 1; continue }
    out.selectedSourceEvents++
  }
  return out
}
export function projectReferenceDomainOperations(family: string, reply: GrammarReferenceReply): NativeOperationProjection | undefined {
  if (reply.actions.status !== 'available') return undefined
  const out = create(family, reply.actions.value.length)
  if (!out) return undefined
  for (const action of reply.actions.value) {
    if (family === 'eventmodeling' && action[0] === 'setAst') for (const frame of list(row(action[1]).frames)) out.operations.push(['frame', referenceFrame(row(frame))])
    else if (family === 'zenuml' && action[0] === 'commitStatement') out.operations.push(action[1]!)
    else { const kind = text(action[0]); out.unmapped[kind] = (out.unmapped[kind] ?? 0) + 1; continue }
    out.selectedSourceEvents++
  }
  return out
}
