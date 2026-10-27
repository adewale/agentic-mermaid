import { writeGrammarText } from '../shared/grammar-text.ts'
import { mutateNativeMetadata, nativeDomainHooks, nativeMutationFailure, readNativeWrite } from './native-domain-writes.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { eventModelingRelations, parseEventModeling, validateEventModeling } from '../eventmodeling/parser.ts'
import type { EventModelingBody, EventModelingMutationOp } from '../eventmodeling/types.ts'
import type { FamilyOperations } from './family-registry.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { ok, type LayoutWarning, type MutationError, type Result } from './types.ts'

export function renderEventModeling(body: EventModelingBody): string {
  validateEventModeling(body)
  const lines = ['eventmodeling']
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) { if (/[\r\n]/.test(body.title)) throw Error('Event Modeling title must be one line'); lines.push(`title ${writeGrammarText(body.title, '%')}`) }
  for (const entity of body.entities) lines.push(`entity ${entity}`)
  for (const frame of body.frames) {
    let line = `${frame.reset ? 'rf' : 'tf'} ${frame.id} ${frame.entityType} ${frame.entity}`
    for (const source of frame.sources) line += ` ->> ${source}`
    if (frame.dataReference) line += ` [[${frame.dataReference}]]`
    if (frame.data) {
      if (/[\r\n]/.test(frame.data.text)) throw Error('Inline frame data cannot contain newlines; use a named data block')
      line += ` ${frame.data.type ? '`' + frame.data.type + '`' : ''}{${frame.data.text}}`
    }
    lines.push(line)
  }
  for (const item of body.data) lines.push(`data ${item.id} ${item.value.type ? '`' + item.value.type + '`' : ''}{\n${item.value.text}\n}`)
  for (const note of body.notes) lines.push(`note ${note.frame} ${note.type ? '`' + note.type + '`' : ''}{\n${note.text}\n}`)
  for (const spec of body.specifications) lines.push(`gwt ${spec.frame}\n${(['given', 'when', 'then'] as const).filter(section => spec[section].length).map(section => `${section}\n${spec[section].map(item => `${item.entityType} ${item.entity}`).join('\n')}`).join('\n')}`)
  return lines.join('\n') + '\n'
}
export function mutateEventModeling(body: EventModelingBody, op: EventModelingMutationOp): Result<EventModelingBody, MutationError> {
  try {
    const next = structuredClone(body)
    const frame = (id: string) => { const found = next.frames.find(item => item.id === id); if (!found) throw Error(`Unknown frame ${id}`); return found }
    if (!mutateNativeMetadata(next, op)) switch (op.kind) {
      case 'add_frame': {
        const index = op.index ?? next.frames.length
        if (!Number.isSafeInteger(index) || index < 0 || index > next.frames.length) throw Error('Invalid frame insertion index')
        next.frames.splice(index, 0, { id: op.id, entityType: op.entityType, entity: op.entity, reset: op.reset ?? false, sources: op.sources ?? [] })
        break
      }
      case 'rename_frame': {
        const item = frame(op.from)
        if (next.frames.some(frame => frame.id === op.to)) throw Error('Destination frame already exists')
        item.id = op.to
        for (const item of next.frames) item.sources = item.sources.map(id => id === op.from ? op.to : id)
        for (const item of next.notes) if (item.frame === op.from) item.frame = op.to
        for (const item of next.specifications) if (item.frame === op.from) item.frame = op.to
        break
      }
      case 'add_entity': if (next.entities.includes(op.entity)) throw Error('Entity already exists'); next.entities.push(op.entity); break
      case 'remove_entity': {
        if (!next.entities.includes(op.entity)) throw Error('Entity not found')
        const references = next.specifications.filter(spec => [...spec.given, ...spec.when, ...spec.then].some(item => item.entity === op.entity))
        if (references.length && !op.cascade) throw Error('Entity is used by a specification')
        next.entities = next.entities.filter(entity => entity !== op.entity)
        if (op.cascade) next.specifications = next.specifications.filter(spec => !references.includes(spec))
        break
      }
      case 'set_specification': {
        frame(op.frame)
        const matching = next.specifications.filter(spec => spec.frame === op.frame), occurrence = op.occurrence ?? 0
        if (!Number.isSafeInteger(occurrence) || occurrence < 0 || occurrence > matching.length) throw Error('Invalid specification occurrence')
        const value = { frame: op.frame, given: op.given, when: op.when ?? [], then: op.then }
        if (matching[occurrence]) next.specifications[next.specifications.indexOf(matching[occurrence]!)] = value
        else next.specifications.push(value)
        break
      }
      case 'remove_specification': {
        const matching = next.specifications.filter(spec => spec.frame === op.frame), occurrence = op.occurrence ?? 0
        if (!Number.isSafeInteger(occurrence) || occurrence < 0 || !matching[occurrence]) throw Error('Specification not found')
        next.specifications.splice(next.specifications.indexOf(matching[occurrence]!), 1); break
      }
      case 'set_note':
      case 'remove_note': {
        if (!Number.isSafeInteger(op.index) || op.index < 0 || !next.notes[op.index]) throw Error('Note not found')
        if (op.kind === 'set_note') { const note = next.notes[op.index]!; note.text = op.text; if (op.dataType !== undefined) note.type = op.dataType ?? undefined }
        else next.notes.splice(op.index, 1)
        break
      }
      case 'remove_frame': {
        frame(op.id)
        const referenced = next.frames.some(item => item.sources.includes(op.id)) || next.notes.some(item => item.frame === op.id) || next.specifications.some(item => item.frame === op.id)
        if (referenced && !op.cascade) throw Error('Frame has explicit references; request cascade to remove them')
        next.frames = next.frames.filter(item => item.id !== op.id)
        if (op.cascade) { for (const item of next.frames) { const explicit = item.sources.length; item.sources = item.sources.filter(id => id !== op.id); if (explicit && !item.sources.length) item.reset = true } next.notes = next.notes.filter(item => item.frame !== op.id); next.specifications = next.specifications.filter(item => item.frame !== op.id) }
        break
      }
      case 'set_frame_entity': { const item = frame(op.id); item.entity = op.entity; item.entityType = op.entityType ?? item.entityType; break }
      case 'set_frame_sources': { const item = frame(op.id); item.sources = [...op.sources]; item.reset = op.reset ?? item.reset; break }
      case 'move_frame': {
        const item = frame(op.id)
        if (!Number.isSafeInteger(op.index) || op.index < 0 || op.index >= next.frames.length) throw Error('Invalid destination index')
        next.frames.splice(next.frames.indexOf(item), 1); next.frames.splice(op.index, 0, item); break
      }
      case 'set_frame_data': { const item = frame(op.id), type = op.dataType === null ? undefined : op.dataType ?? item.data?.type; item.data = op.text === null ? undefined : { text: op.text, ...(type ? { type } : {}) }; if (op.reference !== undefined) item.dataReference = op.reference ?? undefined; break }
      case 'set_data': { const item = next.data.find(item => item.id === op.id), type = op.dataType === null ? undefined : op.dataType ?? item?.value.type, value = { text: op.text, ...(type ? { type } : {}) }; if (item) item.value = value; else next.data.push({ id: op.id, value }); break }
      case 'add_note': next.notes.push({ frame: op.frame, text: op.text, ...(op.dataType ? { type: op.dataType } : {}) }); break
      default: throw Error(unknownOpMessage('eventmodeling', op))
    }
    return ok(readNativeWrite(next, renderEventModeling, parseEventModeling, 'Event Modeling'))
  } catch (error) { return nativeMutationFailure(error) }
}
export function eventModelingLabels(body: EventModelingBody): { text: string; target: string }[] {
  return [...(body.title ? [{ text: body.title, target: 'title' }] : []), ...body.frames.flatMap(frame => [{ text: frame.entity.split('.').at(-1)!, target: frame.id }, ...(frame.data ? [{ text: frame.data.text, target: frame.id }] : [])]), ...body.data.map(item => ({ text: item.value.text, target: `data:${item.id}` })), ...body.notes.map((note, index) => ({ text: note.text, target: `note:${index}` }))]
}
export const EVENTMODELING_AGENT_HOOKS: FamilyOperations = {
  .../* @__PURE__ */ nativeDomainHooks('eventmodeling', 'Event Modeling', parseEventModeling, renderEventModeling, mutateEventModeling, eventModelingLabels, undefined, true),
  verify: (body, options) => {
    if (body.kind !== 'eventmodeling') return []
    const warnings: LayoutWarning[] = []
    if (!body.frames.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
    for (const item of eventModelingLabels(body)) if (item.text.length > (options.labelCharCap ?? 300)) warnings.push({ code: 'LABEL_OVERFLOW', target: item.target, charCount: item.text.length, limit: options.labelCharCap ?? 300 })
    return warnings
  },
  buildSourceMap: (body, source) => {
    const map = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'eventmodeling') return map
    const lines = source.split('\n')
    for (const [index, line] of lines.entries()) { const frame = line.match(/^\s*(?:tf|timeframe|rf|resetframe)\s+(\d{1,3})\s+\w+\s+([\w.]+)/); if (frame) { map.nodes.set(frame[1]!, { line: index + 1, col: line.indexOf(frame[1]!) + 1 }); map.labels.set(`node:${frame[1]}`, { line: index + 1, col: line.indexOf(frame[2]!) + 1 }) } }
    for (const relation of eventModelingRelations(body)) { const at = map.nodes.get(relation.to); if (at) map.edges.set(relation.id, at) }
    return map
  },
}
