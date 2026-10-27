import { readGrammarText } from '../shared/grammar-text.ts'
import type { EventData, EventFrameType, EventModelingBody, EventSpecification } from './types.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'

const types: Record<string, EventFrameType> = { ui: 'ui', pcr: 'processor', processor: 'processor', cmd: 'command', command: 'command', rmo: 'readmodel', readmodel: 'readmodel', evt: 'event', event: 'event' }
const entity = '[_a-zA-Z]\\w*(?:\\.[_a-zA-Z]\\w*)*'
const framePattern = new RegExp(`^(tf|timeframe|rf|resetframe)\\s+(\\d{1,3})\\s+(\\w+)\\s+(${entity})`)
const dataTypes = new Set(['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'])
export function eventType(value: string): EventFrameType {
  const type = types[value]
  if (!type) throw Error(`Unknown Event Modeling type: ${value}`)
  return type
}
function readData(value: string, block: boolean): EventData {
  const match = value.match(/^(?:`(\w+)`\s*)?([\s\S]+)$/)
  if (!match || (match[1] && !dataTypes.has(match[1]))) throw Error('Invalid Event Modeling data type')
  const raw = match[2]!
  if (block ? !/^\{\s*\n[\s\S]*\n?\}$/.test(raw) : !/^(?:\{.*\}|".*"|'.*')$/.test(raw)) throw Error('Invalid Event Modeling data')
  return { ...(match[1] ? { type: match[1] } : {}), text: raw.slice(1, -1).replace(block ? /^\n|\n$/g : /$^/g, '') }
}
export function eventLane(frame: { entity: string; type: EventFrameType }): string {
  const parts = frame.entity.split('.')
  const namespace = parts.length > 1 ? parts.slice(0, -1).join('.') : ''
  const band = frame.type === 'event' ? 'Events' : frame.type === 'command' || frame.type === 'readmodel' ? 'Command / Read Model' : 'UI / Automation'
  return namespace ? `${namespace} · ${band}` : band
}
export function eventRelations(body: EventModelingBody): Array<{ id: string; from: string; to: string; explicit: boolean }> {
  const result: Array<{ id: string; from: string; to: string; explicit: boolean }> = []
  let last: EventModelingBody['frames'][number] | undefined, beforeRun: typeof last
  for (const frame of body.frames) {
    const sameLane = last !== undefined && eventLane(last) === eventLane(frame)
    const previous = sameLane ? beforeRun : last
    const sources = [...frame.sources]
    if (!frame.reset && previous && !sources.length) sources.unshift(previous.id)
    for (const from of sources) result.push({ id: `relation:${from}:${frame.id}`, from, to: frame.id, explicit: frame.sources.includes(from) })
    if (!sameLane) beforeRun = last
    last = frame
  }
  assertDiagramWorkLimit('edges', result.length)
  return result
}
export function parseEventModeling(source: string | string[]): EventModelingBody {
  const text = (Array.isArray(source) ? source.join('\n') : source).replace(/\r\n/g, '\n')
  const lines = eventSourceWithoutComments(text).split('\n')
  const body: EventModelingBody = { kind: 'eventmodeling', frames: [], entities: [], data: Object.create(null), notes: [], specifications: [] }
  let index = lines.findIndex(line => line.trim() === 'eventmodeling')
  if (index < 0) throw Error('Expected eventmodeling header')
  let specification: EventSpecification | undefined,
    section: 'given' | 'when' | 'then' = 'given'
  for (index++; index < lines.length; index++) {
    let line = lines[index]!.trim()
    if (!line || line.startsWith('%%') || line.startsWith('//')) continue
    if (line.startsWith('title ')) {
      body.title = readGrammarText(line.slice(6))
      continue
    }
    if (line.startsWith('accTitle:')) {
      body.accessibilityTitle = line.slice(9).trim()
      continue
    }
    if (line.startsWith('accDescr:')) {
      body.accessibilityDescription = line.slice(9).trim()
      continue
    }
    if (line.startsWith('accDescr {')) {
      const values = [line.slice(10)]
      while (!values[values.length - 1]!.includes('}') && ++index < lines.length) values.push(lines[index]!)
      if (!values[values.length - 1]!.includes('}')) throw Error('Unclosed accessibility description')
      body.accessibilityDescription = values.join('\n').replace(/}\s*$/, '').trim()
      continue
    }
    const frame = line.match(framePattern)
    if (frame) {
      specification = undefined
      let rest = line.slice(frame[0].length).trim()
      const sources: string[] = []
      while (rest.startsWith('->>')) {
        const ref = rest.match(/^->>\s*(\d{1,3})(?=\s|$)/)
        if (!ref) throw Error('Invalid frame reference')
        sources.push(ref[1]!)
        rest = rest.slice(ref[0].length).trim()
      }
      const ref = rest.match(/^\[\[(\w+)\]\]/)
      if (ref) rest = rest.slice(ref[0].length).trim()
      body.frames.push({ id: frame[2]!, reset: frame[1] === 'rf' || frame[1] === 'resetframe', type: eventType(frame[3]!), entity: frame[4]!, sources, ...(ref ? { dataReference: ref[1] } : {}), ...(rest ? { data: readData(rest, false) } : {}) })
      assertDiagramWorkLimit('nodes', body.frames.length)
      continue
    }
    const declaration = line.match(new RegExp(`^entity\\s+(${entity})$`))
    if (declaration) {
      body.entities.push(declaration[1]!)
      specification = undefined
      continue
    }
    const block = line.match(/^(data\s+([_a-zA-Z]\w*)|note\s+(\d{1,3}))\s+([\s\S]+)$/)
    if (block) {
      specification = undefined
      const values = [block[4]!]
      while (!/^}\s*$/.test(lines[++index] ?? '')) {
        if (index >= lines.length) throw Error('Unclosed Event Modeling data block')
        values.push(lines[index]!)
      }
      values.push('}')
      const value = readData(values.join('\n'), true)
      if (block[2]) {
        if (Object.hasOwn(body.data, block[2])) throw Error(`Duplicate data: ${block[2]}`)
        body.data[block[2]] = value
      } else body.notes.push({ frame: block[3]!, data: value })
      continue
    }
    const gwt = line.match(/^gwt\s+(\d{1,3})\s*(.*)$/)
    if (gwt) {
      section = 'given'
      specification = { frame: gwt[1]!, given: [], when: [], then: [] }
      body.specifications.push(specification)
      line = gwt[2]!
    }
    if (specification) {
      const tokens = line.split(/\s+/).filter(Boolean)
      while (tokens.length) {
        const token = tokens.shift()!
        if (token === 'given' || token === 'when' || token === 'then') {
          section = token
          continue
        }
        const name = tokens.shift()
        if (!name || !/^[_a-zA-Z]\w*$/.test(name)) throw Error('Invalid specification entity')
        specification[section].push({ type: eventType(token), entity: name })
      }
      continue
    }
    throw Error(`Unsupported Event Modeling statement: ${line}`)
  }
  validateEventModeling(body)
  return body
}
export function validateEventModeling(body: EventModelingBody): void {
  const ids = new Set<string>()
  const data = (value: EventData) => {
    if (!value || typeof value.text !== 'string' || (value.type !== undefined && !dataTypes.has(value.type))) throw Error('Invalid data record')
  }
  for (const name of body.entities) if (!new RegExp(`^${entity}$`).test(name)) throw Error('Invalid entity declaration')
  if (new Set(body.entities).size !== body.entities.length) throw Error('Duplicate entity declaration')
  for (const [id, value] of Object.entries(body.data)) {
    if (!/^[_a-zA-Z]\w*$/.test(id)) throw Error('Invalid data identifier')
    data(value)
  }
  for (const note of body.notes) data(note.data)

  for (const frame of body.frames) {
    if (!/^\d{1,3}$/.test(frame.id) || ids.has(frame.id)) throw Error(`Duplicate or invalid frame ID: ${frame.id}`)
    ids.add(frame.id)
    if (typeof frame.reset !== 'boolean' || !Array.isArray(frame.sources) || !frame.sources.every(value => typeof value === 'string')) throw Error('Invalid frame record')
    if (frame.data) data(frame.data)
    if (!new RegExp(`^${entity}$`).test(frame.entity) || !Object.values(types).includes(frame.type)) throw Error('Invalid frame entity or type')
  }
  for (const frame of body.frames) {
    for (const source of frame.sources) if (!ids.has(source) || source === frame.id) throw Error(`Invalid source frame: ${source}`)
    if (new Set(frame.sources).size !== frame.sources.length) throw Error('Duplicate frame relation')
    if (frame.dataReference && !Object.hasOwn(body.data, frame.dataReference)) throw Error(`Unknown data: ${frame.dataReference}`)
  }
  for (const note of body.notes) if (!ids.has(note.frame)) throw Error(`Unknown note frame: ${note.frame}`)
  for (const spec of body.specifications) {
    if (!ids.has(spec.frame) || !spec.given.length || !spec.then.length) throw Error('Invalid Given/When/Then specification')
    for (const value of [...spec.given, ...spec.when, ...spec.then]) if (!body.entities.includes(value.entity)) throw Error(`Unknown specification entity: ${value.entity}`)
  }
}

/** Comments are syntax only outside authored data and quoted inline values. */
function eventSourceWithoutComments(source: string): string {
  let result = '',
    depth = 0,
    quote = '',
    comment = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!,
      next = source[i + 1]
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false
        i++
        result += ' '
      } else if (char === '\n') result += char
      continue
    }
    if (quote) {
      if (char === '\n' && depth === 0) quote = ''
      result += char
      if (char === '\\' && next !== undefined) {
        result += next
        i++
      } else if (char === quote) quote = ''
      continue
    }
    if (!depth && char === '/' && next === '*') {
      comment = true
      i++
      continue
    }
    if (!depth && ((char === '%' && next === '%') || (char === '/' && next === '/'))) {
      while (i < source.length && source[i] !== '\n') i++
      if (i < source.length) result += '\n'
      continue
    }
    if (depth === 0 && /\s/.test(source[i - 1] ?? '') && /[tredng]/.test(char) && /^(?:tf|timeframe|rf|resetframe|entity|data|note|gwt)\s/.test(source.slice(i))) {
      const currentLine = result.slice(result.lastIndexOf('\n') + 1)
      if (currentLine.trim() && !/^\s*(?:title\b|accTitle:|accDescr:)/.test(currentLine)) result = result.trimEnd() + '\n'
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    if (char === '{') depth++
    if (char === '}') depth--
    result += char
  }
  if (comment) throw Error('Unclosed Event Modeling comment')
  return result
}
