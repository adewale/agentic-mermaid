import type { EventModelingBody } from '../eventmodeling/types.ts'
import type { ZenUmlBody } from '../zenuml/types.ts'
import { eventModelingLane, eventModelingRelations } from '../eventmodeling/parser.ts'
import { projectZenUmlSequence } from '../zenuml/projection.ts'
import { walkZenUml } from '../zenuml/parser.ts'
export function nativeDomainTree(body: EventModelingBody | ZenUmlBody) {
  if (body.kind === 'eventmodeling') {
    const lanes = [...new Set(body.frames.map(eventModelingLane))]
    return { nodes: [...lanes.map(lane => ({ id: `lane:${lane}`, label: lane })), ...body.frames.map(frame => ({ id: frame.id, label: frame.entity, parentId: `lane:${eventModelingLane(frame)}` }))], edges: eventModelingRelations(body).map(edge => ({ from: edge.from, to: edge.to })) }
  }
  const sequence = projectZenUmlSequence(body)
  return { nodes: sequence.actors.map(actor => ({ id: actor.id, label: actor.label })), edges: sequence.messages.map(message => ({ from: message.from, to: message.to, label: message.label })) }
}
export function nativeDomainCount(body: EventModelingBody | ZenUmlBody) {
  if (body.kind === 'eventmodeling') return { nodes: body.frames.length, edges: eventModelingRelations(body).length, groups: new Set(body.frames.map(eventModelingLane)).size }
  const sequence = projectZenUmlSequence(body)
  return { nodes: sequence.actors.length, edges: sequence.messages.length, groups: sequence.blocks.length }
}
export function nativeDomainFacts(body: EventModelingBody | ZenUmlBody): string[] {
  const text = JSON.stringify
  const facts: string[] = []
  if (body.title !== undefined) facts.push(`title ${text(body.title)}`)
  if (body.kind === 'eventmodeling') {
    for (const frame of body.frames) facts.push(`frame ${frame.id} ${frame.reset ? 'reset' : 'time'} ${frame.entityType} ${text(frame.entity)}`)
    for (const edge of eventModelingRelations(body)) facts.push(`edge ${edge.from} -> ${edge.to} ${edge.inferred ? 'inferred' : 'explicit'}`)
    for (const frame of body.frames) if (frame.data) facts.push(`frame ${frame.id} data ${text(frame.data.text)}`); else if (frame.dataReference) facts.push(`frame ${frame.id} data-reference ${frame.dataReference}`)
    for (const item of body.data) facts.push(`data ${item.id} ${text(item.value.text)}`)
    for (const note of body.notes) facts.push(`note ${note.frame} ${text(note.text)}`)
    for (const spec of body.specifications) for (const section of ['given', 'when', 'then'] as const) for (const item of spec[section]) facts.push(`specification ${spec.frame} ${section} ${item.entityType} ${text(item.entity)}`)
  } else {
    const sequence = projectZenUmlSequence(body)
    for (const actor of sequence.actors) facts.push(`participant ${actor.id} ${actor.type} ${text(actor.label)}`)
    for (const message of sequence.messages) facts.push(`edge ${message.from} -> ${message.to} : ${message.label}`)
    walkZenUml(body.statements, statement => { if (statement.kind === 'region') facts.push(`region ${statement.id} ${statement.type} ${text(statement.branches.map(branch => branch.label))}`); else if (statement.kind === 'comment') facts.push(`comment ${statement.id} ${text(statement.text)}`) })
  }
  return facts
}
