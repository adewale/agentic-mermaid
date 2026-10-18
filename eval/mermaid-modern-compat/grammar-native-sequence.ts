import { normalizeBrTags } from '../../src/multiline-utils.ts'
import { getSequenceBlockBoundaries, getSequenceBlockScope } from '../../src/sequence/parser.ts'
import type { SequenceDiagram } from '../../src/sequence/types.ts'
import { REFERENCE_SEQUENCE_SIGNALS as SIGNALS } from './grammar-sequence-kinds.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

const row = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const label = (value: unknown): string => normalizeBrTags(text(value))
const entries = (value: unknown): Array<[string, unknown]> => (Array.isArray(value) ? value.filter(Array.isArray).map(item => [text(item[0]), item[1]]) : Object.entries(row(value)))
const dictionary = (value: unknown): Json =>
  Object.fromEntries(
    entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, text(item)]),
  )
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })

const OPEN: Record<number, string> = { 10: 'loop', 12: 'alt', 15: 'opt', 19: 'par', 22: 'rect', 27: 'critical', 30: 'break', 32: 'par_over' }
const CLOSE = new Set([11, 14, 16, 21, 23, 29, 31])
const DIVIDER = new Set([13, 20, 28])

/** Native RESULT semantics, not reconstructed native actions. Opening-order
 * block ids normalize the engines' different storage orders. Messages, notes,
 * actor/box order and boundary positions stay ordered. Pixel/color/default
 * wrap settings and autonumber display policy are outside this field scope.
 */
export function projectNativeSequence(family: string, model: unknown): NativeSemanticProjection | undefined {
  if (family !== 'sequence') return undefined
  const diagram = model as SequenceDiagram
  const opening = (getSequenceBlockBoundaries(diagram) ?? []).filter(boundary => boundary.kind === 'open').map(boundary => boundary.blockIndex)
  const identities = new Map(opening.map((index, id) => [index, id]))
  const parents = new Map<number, number>()
  diagram.blocks.forEach((block, parent) => {
    for (const child of getSequenceBlockScope(block)?.childBlockIndices ?? []) parents.set(child, parent)
  })
  const activations: Array<{ actor: string; kind: string; messageIndex: number }> = (diagram.activationEvents ?? []).map(event => ({ actor: event.actorId, kind: event.kind, messageIndex: event.messageIndex }))
  diagram.messages.forEach((message, index) => {
    if (message.activate && !message.centralEnd) activations.push({ actor: message.to, kind: 'activate', messageIndex: index + 1 })
    if (message.deactivate) activations.push({ actor: message.from, kind: 'deactivate', messageIndex: index + 1 })
  })
  return projection({
    title: diagram.title ?? '',
    actors: diagram.actors.map(actor => ({ id: actor.id, label: actor.label, type: actor.type ?? 'participant', links: dictionary(actor.links), box: actor.box ?? null })),
    boxes: (diagram.boxes ?? []).map(box => ({ label: box.label ?? '', actors: box.actorIds })),
    messages: diagram.messages.map(message => ({ from: message.from, to: message.to, label: message.label, line: message.lineStyle, startMarker: message.startHead ?? 'none', endMarker: message.endHead ?? 'none', centralStart: message.centralStart === true, centralEnd: message.centralEnd === true })),
    notes: diagram.notes.map(note => ({ actors: note.actorIds, label: note.text, side: note.position, afterMessage: note.afterIndex })),
    blocks: opening.map(index => {
      const block = diagram.blocks[index]!,
        parent = parents.get(index)
      return {
        id: identities.get(index)!,
        parent: parent === undefined ? null : identities.get(parent)!,
        type: block.type,
        label: block.type === 'rect' ? '' : block.label,
        startMessage: block.startIndex,
        endMessageExclusive: getSequenceBlockScope(block)?.endMessageExclusive ?? block.endIndex + 1,
        dividers: block.dividers.map(divider => ({ messageIndex: divider.index, label: divider.label })),
      }
    }),
    activations: activations.sort((a, b) => a.messageIndex - b.messageIndex || a.actor.localeCompare(b.actor) || a.kind.localeCompare(b.kind)),
    createdActorIds: diagram.actors
      .filter(actor => actor.createMessageIndex !== undefined)
      .map(actor => actor.id)
      .sort(),
    destroyedActorIds: diagram.actors
      .filter(actor => actor.destroyMessageIndex !== undefined)
      .map(actor => actor.id)
      .sort(),
  })
}

export function projectReferenceSequence(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (family !== 'sequence' || !reply.accepted || !reply.snapshot) return undefined
  const data = reply.snapshot.data
  if (!Array.isArray(data.getActors) || !Array.isArray(data.getMessages) || !Array.isArray(data.getActorKeys)) return undefined
  const actors = new Map(entries(data.getActors).map(([id, actor]) => [id, row(actor)]))
  const boxes = list(data.getBoxes).map(row)
  const messages: Json[] = [],
    notes: Json[] = [],
    activations: Array<{ actor: string; kind: string; messageIndex: number }> = []
  const blocks: Array<{ id: number; parent: number | null; type: string; label: string; startMessage: number; endMessageExclusive: number; dividers: Array<{ messageIndex: number; label: string }> }> = []
  const stack: number[] = []
  for (const item of list(data.getMessages).map(row)) {
    const type = Number(item.type),
      signal = SIGNALS[type]
    if (signal) {
      messages.push({ from: text(item.from), to: text(item.to), label: label(item.message), line: signal[0], startMarker: signal[1], endMarker: signal[2], centralStart: item.centralConnection === 60 || item.centralConnection === 61, centralEnd: item.centralConnection === 59 || item.centralConnection === 61 })
    } else if (type === 2) {
      notes.push({ actors: [...new Set([text(item.from), text(item.to)].filter(Boolean))], label: label(item.message), side: ({ 0: 'left', 1: 'right', 2: 'over' } as Record<number, string>)[Number(item.placement)] ?? `unknown:${item.placement}`, afterMessage: messages.length - 1 })
    } else if (OPEN[type]) {
      const id = blocks.length
      blocks.push({ id, parent: stack.at(-1) ?? null, type: OPEN[type]!, label: type === 22 ? '' : label(item.message), startMessage: messages.length, endMessageExclusive: messages.length, dividers: [] })
      stack.push(id)
    } else if (CLOSE.has(type)) {
      const id = stack.pop()
      if (id !== undefined) blocks[id]!.endMessageExclusive = messages.length
    } else if (DIVIDER.has(type)) {
      const id = stack.at(-1)
      if (id !== undefined) blocks[id]!.dividers.push({ messageIndex: messages.length, label: label(item.message) })
    } else if (type === 17 || type === 18) {
      activations.push({ actor: text(item.from) || text(item.to), kind: type === 17 ? 'activate' : 'deactivate', messageIndex: messages.length })
    }
  }
  return projection({
    title: text(data.getDiagramTitle),
    actors: list(data.getActorKeys)
      .map(text)
      .map(id => {
        const actor = actors.get(id) ?? {}
        const box = boxes.findIndex(candidate => list(candidate.actorKeys).includes(id))
        return { id, label: label(actor.description), type: text(actor.type) || 'participant', links: dictionary(actor.links), box: box < 0 ? null : box }
      }),
    boxes: boxes.map(box => ({ label: label(box.name), actors: list(box.actorKeys).map(text) })),
    messages,
    notes,
    blocks,
    activations: activations.sort((a, b) => a.messageIndex - b.messageIndex || a.actor.localeCompare(b.actor) || a.kind.localeCompare(b.kind)),
    createdActorIds: entries(data.getCreatedActors)
      .map(([id]) => id)
      .sort(),
    destroyedActorIds: entries(data.getDestroyedActors)
      .map(([id]) => id)
      .sort(),
  })
}
