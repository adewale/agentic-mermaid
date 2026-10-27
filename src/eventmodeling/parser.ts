import { readGrammarText } from '../shared/grammar-text.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import type { EventModelingBody, EventModelingData, EventModelingEntityType, EventModelingFrame, EventModelingSpecification } from './types.ts'

const types: Record<string, EventModelingEntityType> = { ui: 'ui', pcr: 'processor', processor: 'processor', cmd: 'command', command: 'command', rmo: 'readmodel', readmodel: 'readmodel', evt: 'event', event: 'event' }
const name = /^[_a-zA-Z]\w*(?:\.[_a-zA-Z]\w*)*$/
const isName = (value: unknown): value is string => typeof value === 'string' && name.exec(value)?.[0] === value
const simpleName = (value: unknown): value is string => isName(value) && !value.includes('.')
const dataTypes = new Set(['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'])

/** Inline data is opaque text in the language, not JavaScript. In particular,
 * apostrophes and unmatched quotation marks inside it must remain literal. */
function statements(source: string): string[] {
  const out: string[] = [], lines = source.replace(/\r\n?/g, '\n').split('\n')
  let blockComment = false
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!.trim()
    if (blockComment) { const end = line.indexOf('*/'); if (end < 0) continue; line = line.slice(end + 2).trim(); blockComment = false }
    if (line.startsWith('/*')) { const end = line.indexOf('*/', 2); if (end < 0) { blockComment = true; continue } line = line.slice(end + 2).trim() }
    if (!line || /^(?:%%|\/\/)/.test(line)) continue
    if (line.startsWith('title ')) { out.push(line.split('%%')[0]!); continue }
    if (/^(?:data\s+[_a-zA-Z]\w*|note\s+\d{1,3})\s+(?:`[^`]+`\s*)?\{\s*$/.test(line)) {
      const payload = [line]
      let closed = false
      while (++index < lines.length) { payload.push(lines[index]!); if (/^\s*\}\s*$/.test(lines[index]!)) { closed = true; break } }
      if (!closed) throw Error('Unclosed Event Modeling data block')
      out.push(payload.join('\n'))
    } else out.push(/[{'"`]/.test(line) ? line : line.replace(/\s+(?:%%|\/\/).*$/, ''))
  }
  if (blockComment) throw Error('Unclosed Event Modeling comment')
  return out
}
function readData(text: string): EventModelingData {
  const match = text.match(/^(?:`([^`]+)`\s*)?([\s\S]+)$/)
  if (!match || (match[1] && !dataTypes.has(match[1]))) throw Error('Unsupported Event Modeling data type')
  const payload = match[2]!.trim(), first = payload[0], last = payload.at(-1)
  if (!(first === '{' && last === '}' || (first === '"' || first === "'") && last === first)) throw Error('Event Modeling data must be enclosed in braces or quotes')
  return { ...(match[1] ? { type: match[1] as EventModelingData['type'] } : {}), text: payload.slice(1, -1).replace(/^\r?\n|\r?\n$/g, '') }
}
export function parseEventModeling(source: string): EventModelingBody {
  const rows = statements(source), header = rows.shift()
  if (header !== 'eventmodeling') throw Error('Expected eventmodeling header')
  const body: EventModelingBody = { kind: 'eventmodeling', frames: [], entities: [], data: [], notes: [], specifications: [] }
  let specification: EventModelingSpecification | undefined, section: 'given' | 'when' | 'then' = 'given'
  for (const row of rows) {
    if (parserObservationActive('eventmodeling')) observeParserStatement('eventmodeling', row.split(/\s/, 1)[0]!, row)
    if (row.startsWith('title ')) { body.title = readGrammarText(row.slice(6)); continue }
    const frame = row.match(/^(tf|timeframe|rf|resetframe)\s+(\d{1,3})\s+(\w+)\s+([_a-zA-Z]\w*(?:\.[_a-zA-Z]\w*)*)([\s\S]*)$/)
    if (frame) {
      specification = undefined
      const entityType = types[frame[3]!]
      if (!entityType) throw Error(`Unknown Event Modeling entity type ${frame[3]}`)
      let rest = frame[5]!.trim(), sources: string[] = []
      while (rest.startsWith('->>')) { const ref = rest.match(/^->>\s*(\d{1,3})(?=\s|$)/); if (!ref) throw Error('Invalid Event Modeling source reference'); sources.push(ref[1]!); rest = rest.slice(ref[0].length).trim() }
      let dataReference: string | undefined
      if (rest.startsWith('[[')) { const ref = rest.match(/^\[\[([_a-zA-Z]\w*)\]\]/); if (!ref) throw Error('Invalid data reference'); dataReference = ref[1]; rest = rest.slice(ref[0].length).trim() }
      body.frames.push({ id: frame[2]!, entityType, entity: frame[4]!, reset: frame[1] === 'rf' || frame[1] === 'resetframe', sources, ...(dataReference ? { dataReference } : {}), ...(rest ? { data: readData(rest) } : {}) })
      observeParserMutation('eventmodeling', 'append-frame', body.frames.at(-1))
      continue
    }
    const entity = row.match(/^entity\s+(.+)$/)
    if (entity) { if (!name.test(entity[1]!)) throw Error('Invalid Event Modeling entity identifier'); body.entities.push(entity[1]!); specification = undefined; continue }
    const data = row.match(/^data\s+([_a-zA-Z]\w*)\s+([\s\S]+)$/)
    if (data) { body.data.push({ id: data[1]!, value: readData(data[2]!) }); specification = undefined; continue }
    const note = row.match(/^note\s+(\d{1,3})\s+([\s\S]+)$/)
    if (note) { body.notes.push({ frame: note[1]!, ...readData(note[2]!) }); specification = undefined; continue }
    let rest = row
    const gwt = rest.match(/^gwt\s+(\d{1,3})(?:\s+([\s\S]+))?$/)
    if (gwt) { specification = { frame: gwt[1]!, given: [], when: [], then: [] }; body.specifications.push(specification); section = 'given'; rest = gwt[2] ?? '' }
    if (specification) {
      const tokens = rest.trim() ? rest.trim().split(/\s+/) : []
      for (let i = 0; i < tokens.length;) {
        const token = tokens[i++]!
        if (token === 'given' || token === 'when' || token === 'then') { section = token; continue }
        const entityType = types[token], identifier = tokens[i++]
        if (!entityType || !identifier || !name.test(identifier)) throw Error(`Invalid Given/When/Then statement ${rest}`)
        specification[section].push({ entityType, entity: identifier })
      }
      continue
    }
    throw Error(`Unsupported Event Modeling statement: ${row}`)
  }
  validateEventModeling(body)
  return body
}
export function eventModelingLane(frame: EventModelingFrame): string {
  const pieces = frame.entity.split('.'), namespace = pieces.length > 1 ? pieces.slice(0, -1).join('.') : ''
  const band = frame.entityType === 'event' ? 'Events' : frame.entityType === 'command' || frame.entityType === 'readmodel' ? 'Command / Read Model' : 'UI / Automation'
  return namespace ? `${namespace} · ${band}` : band
}
export function eventModelingSpecificationLines(spec: EventModelingSpecification, includeEmpty = false): string[] {
  return (['given', 'when', 'then'] as const).filter(section => includeEmpty || spec[section].length).map(section => `${section}: ${spec[section].map(item => `${item.entityType} ${item.entity}`).join(', ')}`)
}
export function eventModelingRelations(body: EventModelingBody): { id: string; from: string; to: string; inferred: boolean }[] {
  return body.frames.flatMap((frame, index) => {
    const sources = frame.sources.length ? frame.sources : frame.reset ? [] : [...body.frames.slice(0, index)].reverse().filter(source => eventModelingLane(source) !== eventModelingLane(frame)).slice(0, 1).map(source => source.id)
    return sources.map((from, occurrence) => ({ id: `relation:${frame.id}:${occurrence}`, from, to: frame.id, inferred: !frame.sources.length }))
  })
}
export function validateEventModeling(body: EventModelingBody): void {
  const ids = new Set<string>(), data = new Set<string>()
  for (const frame of body.frames) {
    if (typeof frame.id !== 'string' || /^\d{1,3}$/.exec(frame.id)?.[0] !== frame.id || ids.has(frame.id)) throw Error(`Frame ID must be unique and contain one to three digits: ${frame.id}`)
    if (!Object.values(types).includes(frame.entityType) || !isName(frame.entity)) throw Error('Invalid Event Modeling frame entity')
    ids.add(frame.id)
  }
  for (const entity of body.entities) if (!isName(entity)) throw Error('Invalid Event Modeling entity identifier')
  const dataValue = (value: EventModelingData, block: boolean) => {
    if (!value || typeof value.text !== 'string' || value.type !== undefined && !dataTypes.has(value.type)) throw Error('Invalid Event Modeling data value')
    if (block && /^\s*}/m.test(value.text)) throw Error('Data or note text cannot contain a line beginning with a closing brace')
    if (!block && /[\r\n]/.test(value.text)) throw Error('Inline frame data cannot contain newlines')
  }
  for (const item of body.data) { dataValue(item.value, true); if (!simpleName(item.id) || data.has(item.id)) throw Error(`Duplicate or invalid data ID ${item.id}`); data.add(item.id) }
  for (const frame of body.frames) {
    if (frame.data) dataValue(frame.data, false)
    if (frame.sources.some(id => !ids.has(id))) throw Error(`Unknown source on frame ${frame.id}`)
    if (frame.dataReference && !data.has(frame.dataReference)) throw Error(`Missing data ${frame.dataReference}`)
  }
  for (const note of body.notes) { dataValue(note, true); if (!ids.has(note.frame)) throw Error(`Unknown note frame ${note.frame}`) }
  const entities = new Set(body.entities)
  for (const spec of body.specifications) if (!ids.has(spec.frame) || !spec.given.length || !spec.then.length || [...spec.given, ...spec.when, ...spec.then].some(item => !item || !simpleName(item.entity) || !Object.values(types).includes(item.entityType) || !entities.has(item.entity))) throw Error(`Invalid Given/When/Then specification on frame ${spec.frame}`)
}
