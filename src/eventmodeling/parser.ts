import { observeParserStatement, observeParserMutation, parserObservationActive } from '../shared/parser-observation.ts'
import { sourceLineStarts, sourcePointAt } from '../shared/source-spans.ts'
import { parseMermaidYaml } from '../shared/mermaid-yaml.ts'
import { matchMermaidFrontmatter } from '../mermaid-source-wrapper.ts'
import { scanAccessibilityDirectives, accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { readGrammarText } from '../shared/grammar-text.ts'
import type { EventData, EventFrameType, EventModelingBody, EventSpecification } from './types.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'

const types: Record<string, EventFrameType> = { ui: 'ui', pcr: 'processor', processor: 'processor', cmd: 'command', command: 'command', rmo: 'readmodel', readmodel: 'readmodel', evt: 'event', event: 'event' }
const entity = '[_a-zA-Z]\\w*(?:\\.[_a-zA-Z]\\w*)*'
const framePattern = new RegExp(`^(tf|timeframe|rf|resetframe)\\s+(\\d{1,3})\\s+(\\w+)\\s+(${entity})`)
const dataTypes = new Set(['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'])
export function eventType(value: string): EventFrameType {
  const type = Object.hasOwn(types, value) ? types[value] : undefined
  if (!type) throw Error(`Unknown Event Modeling type: ${value}`)
  return type
}
const sourceTypes: Record<EventFrameType, { allowed: readonly EventFrameType[]; target: string; expected: string }> = {
  command: { allowed: ['ui', 'processor'], target: 'command', expected: 'ui or processor' },
  event: { allowed: ['command'], target: 'event', expected: 'command' },
  readmodel: { allowed: ['event'], target: 'read model', expected: 'event' },
  processor: { allowed: ['readmodel'], target: 'processor', expected: 'read model' },
  ui: { allowed: ['readmodel'], target: 'ui', expected: 'read model' },
}
/** Event-domain lint on resolved explicit inputs. Reading/painting remain
 * generous; chronological inferred relations are not authored source claims. */
export function eventSourceTypeProblems(target: EventFrameType, sources: readonly (EventFrameType | undefined)[]): Array<{ sourceIndex: number; message: string }> {
  const rule = sourceTypes[target]
  return sources.flatMap((source, sourceIndex) => source === undefined || rule.allowed.includes(source) ? [] : [{ sourceIndex, message: `A ${rule.target} can only receive input from a ${rule.expected}, not from '${source}'.` }])
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
export interface EventModelingSourceObservation {
  kind: 'nodes' | 'edges' | 'labels'
  id: string
  start: number
  end: number
}
export function parseEventModeling(source: string | string[], observe?: (event: EventModelingSourceObservation) => void): EventModelingBody {
  const text = (Array.isArray(source) ? source.join('\n') : source).replace(/\r\n/g, '\n')
  const scanned = eventSourceWithoutComments(text, observe !== undefined)
  const lines = scanned.text.split('\n')
  const starts: number[] = [0]
  if (observe) for (let i = 0; i < scanned.text.length; i++) if (scanned.text[i] === '\n') starts.push(i + 1)
  const sourceOffset = (index: number) => scanned.offsets?.[index] ?? text.length
  const report = (kind: EventModelingSourceObservation['kind'], id: string, start: number, end: number) => observe?.({ kind, id, start: sourceOffset(start), end: sourceOffset(Math.max(start, end - 1)) + 1 })
  const frameSpans = observe ? new Map<string, [number, number]>() : undefined
  const explicitSpans = observe ? new Set<string>() : undefined
  const accessibility = scanAccessibilityDirectives(text.split('\n'), eventStatementEndsFromSpans(text, scanned.protectedSpans))
  const body: EventModelingBody = { kind: 'eventmodeling', frames: [], entities: [], data: Object.create(null), notes: [], specifications: [], ...accessibilityFields(readAuthoredGrammarAccessibility(accessibility.accessibility)) }
  const wrapper = matchMermaidFrontmatter(text)
  if (wrapper) {
    const metadata = parseMermaidYaml(wrapper.yaml)
    if (!metadata.ok) throw Error(metadata.message)
    if (metadata.value && typeof metadata.value === 'object' && 'title' in metadata.value && typeof metadata.value.title === 'string') body.title = metadata.value.title
  }
  const frameIds = new Set<string>()
  let index = lines.findIndex(line => line.trim() === 'eventmodeling')
  if (index < 0) throw Error('Expected eventmodeling header')
  let specification: EventSpecification | undefined,
    section: 'given' | 'when' | 'then' = 'given',
    specificationStart = 0,
    sectionOrder = -1,
    sectionHasValue = false
  for (index++; index < lines.length; index++) {
    let line = lines[index]!.trim()
    const statementStart = observe ? starts[index]! + lines[index]!.indexOf(line) : 0
    if (!line || line.startsWith('%%') || line.startsWith('//')) continue
    observeParserStatement('eventmodeling', 'statement', line, { line: index + 1, unit: 'normalized' })
    if (line.startsWith('title ')) {
      if (observe) report('labels', 'title', statementStart, statementStart + line.length)
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
      if (frameIds.has(frame[2]!)) {
        // Source diagnostics reuse the scanner's mapping only on the error path.
        const offsets = scanned.offsets ?? eventSourceWithoutComments(text, true).offsets!
        const statementOffset = lines.slice(0, index).reduce((sum, value) => sum + value.length + 1, 0) + lines[index]!.indexOf(line)
        const at = sourcePointAt(sourceLineStarts(text), offsets[statementOffset] ?? text.length)
        throw Error(`Duplicate event modeling frame ID "${frame[2]}" on line ${at.line}`)
      }
      frameIds.add(frame[2]!)
      specification = undefined
      let rest = line.slice(frame[0].length).trim()
      const sources: string[] = []
      while (rest.startsWith('->>')) {
        const ref = rest.match(/^->>\s*(\d{1,3})(?=\s|$)/)
        if (!ref) throw Error('Invalid frame reference')
        sources.push(ref[1]!)
        if (observe) {
          const edgeId = `relation:${ref[1]}:${frame[2]}`
          const start = statementStart + line.length - rest.length
          report('edges', edgeId, start, start + ref[0].length)
          explicitSpans!.add(edgeId)
        }
        rest = rest.slice(ref[0].length).trim()
      }
      const ref = rest.match(/^\[\[(\w+)\]\]/)
      if (ref) rest = rest.slice(ref[0].length).trim()
      if (observe) {
        const idStart = statementStart + frame[0].indexOf(frame[2]!)
        report('nodes', frame[2]!, idStart, statementStart + line.length)
        frameSpans!.set(frame[2]!, [idStart, statementStart + line.length])
        const labelStart = statementStart + frame[0].lastIndexOf(frame[4]!)
        report('labels', `node:${frame[2]}`, labelStart, labelStart + frame[4]!.length)

      }
      body.frames.push({ id: frame[2]!, reset: frame[1] === 'rf' || frame[1] === 'resetframe', type: eventType(frame[3]!), entity: frame[4]!, sources, ...(ref ? { dataReference: ref[1] } : {}), ...(rest ? { data: readData(rest, false) } : {}) })
      if (parserObservationActive('eventmodeling')) observeParserMutation('eventmodeling', 'append-frame', body.frames.at(-1))
      assertDiagramWorkLimit('nodes', body.frames.length)
      continue
    }
    const declaration = line.match(new RegExp(`^entity\\s+(${entity})$`))
    if (declaration) {
      body.entities.push(declaration[1]!)
      specification = undefined
      continue
    }
    const block = line.match(/^(data\s+([_a-zA-Z]\w*)|note\s+(\d{1,3}))(?:\s+([\s\S]+))?$/)
    if (block) {
      specification = undefined
      let opening = block[4] ?? ''
      while (!opening.includes('{')) {
        if (++index >= lines.length) throw Error('Unclosed Event Modeling data block')
        opening += (opening ? '\n' : '') + lines[index]!.trim()
      }
      const values = [opening]
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
      if (observe) report('labels', block[2] ? `data:${block[2]}` : `note:${block[3]}:${body.notes.length - 1}`, statementStart, starts[index]! + lines[index]!.length)
      continue
    }
    const gwt = line.match(/^gwt\s+(\d{1,3})\s*(.*)$/)
    if (gwt) {
      section = 'given'
      sectionOrder = -1
      sectionHasValue = false
      specificationStart = statementStart
      specification = { frame: gwt[1]!, given: [], when: [], then: [] }
      body.specifications.push(specification)
      if (observe) report('labels', `gwt:${gwt[1]}:${body.specifications.length - 1}`, statementStart, statementStart + line.length)
      line = gwt[2]!
    }
    if (specification) {
      const tokens = line.split(/\s+/).filter(Boolean)
      while (tokens.length) {
        const keyword = tokens.shift()!
        if (keyword === 'given' || keyword === 'when' || keyword === 'then') {
          const order = ['given', 'when', 'then'].indexOf(keyword)
          if (observe && (order <= sectionOrder || (sectionOrder < 0 && order !== 0) || (sectionOrder >= 0 && !sectionHasValue))) report('labels', 'unsupported-gwt', specificationStart, statementStart + line.length)
          sectionOrder = order
          sectionHasValue = false
          section = keyword
          continue
        }
        if (observe && sectionOrder < 0) report('labels', 'unsupported-gwt', specificationStart, statementStart + line.length)
        const name = tokens.shift()
        if (!name || !/^[_a-zA-Z]\w*$/.test(name)) throw Error('Invalid specification entity')
        specification[section].push({ type: eventType(keyword), entity: name })
        sectionHasValue = true
      }
      if (observe) report('labels', `gwt:${specification.frame}:${body.specifications.length - 1}`, specificationStart, statementStart + line.length)
      continue
    }
    throw Error(`Unsupported Event Modeling statement: ${line}`)
  }
  validateEventModeling(body)
  if (observe)
    for (const edge of eventRelations(body)) {
      const span = frameSpans!.get(edge.to)!
      if (!explicitSpans!.has(edge.id)) report('edges', edge.id, span[0], span[1])
    }
  return body
}
const RESERVED_IDENTIFIERS = new Set(['eventmodeling', 'rmo', 'readmodel', 'ui', 'cmd', 'command', 'evt', 'event', 'pcr', 'processor', 'json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text', 'tf', 'timeframe', 'rf', 'resetframe', 'entity', 'data', 'note', 'gwt', 'given', 'when', 'then', 'title'])
export function eventNonportableIdentifiers(body: EventModelingBody): string[] {
  return [...new Set([...body.frames.map(frame => frame.entity), ...body.entities, ...Object.keys(body.data), ...body.specifications.flatMap(spec => [...spec.given, ...spec.when, ...spec.then].map(value => value.entity))].filter(name => name.split('.').some(part => RESERVED_IDENTIFIERS.has(part))))]
}
export function validateEventModeling(body: EventModelingBody, strictIdentifiers = false): void {
  if (strictIdentifiers && eventNonportableIdentifiers(body).length) throw Error('Event Modeling identifiers cannot use reserved Mermaid grammar keywords')
  const ids = new Set<string>()
  for (const value of [body.title, body.accessibilityTitle, body.accessibilityDescription]) if (value !== undefined && typeof value !== 'string') throw Error('Metadata must be text')
  const record = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Unknown or malformed Event Modeling record field')
  }
  const data = (value: EventData) => {
    record(value, ['text', 'type'])
    if (!value || typeof value.text !== 'string' || (value.type !== undefined && !dataTypes.has(value.type))) throw Error('Invalid data record')
  }
  for (const name of body.entities) if (typeof name !== 'string' || !new RegExp(`^${entity}$`).test(name)) throw Error('Invalid entity declaration')
  if (new Set(body.entities).size !== body.entities.length) throw Error('Duplicate entity declaration')
  for (const [id, value] of Object.entries(body.data)) {
    if (!/^[_a-zA-Z]\w*$/.test(id)) throw Error('Invalid data identifier')
    data(value)
  }
  for (const note of body.notes) {
    record(note, ['frame', 'data'])
    data(note.data)
  }

  for (const frame of body.frames) {
    record(frame, ['id', 'reset', 'type', 'entity', 'sources', 'dataReference', 'data'])
    if (typeof frame.id !== 'string' || !/^\d{1,3}$/.test(frame.id) || ids.has(frame.id)) throw Error(`Duplicate or invalid frame ID: ${frame.id}`)
    ids.add(frame.id)
    if (typeof frame.reset !== 'boolean' || !Array.isArray(frame.sources) || !frame.sources.every(value => typeof value === 'string')) throw Error('Invalid frame record')
    if (frame.data) data(frame.data)
    if (typeof frame.entity !== 'string' || !new RegExp(`^${entity}$`).test(frame.entity) || !Object.values(types).includes(frame.type)) throw Error('Invalid frame entity or type')
  }
  for (const frame of body.frames) {
    for (const source of frame.sources) if (!ids.has(source) || source === frame.id) throw Error(`Invalid source frame: ${source}`)
    if (new Set(frame.sources).size !== frame.sources.length) throw Error('Duplicate frame relation')
    if (frame.dataReference !== undefined && (typeof frame.dataReference !== 'string' || !/^[_a-zA-Z]\w*$/.test(frame.dataReference))) throw Error('Invalid data reference')
    if (frame.dataReference && !Object.hasOwn(body.data, frame.dataReference)) throw Error(`Unknown data: ${frame.dataReference}`)
  }
  for (const note of body.notes) if (!ids.has(note.frame)) throw Error(`Unknown note frame: ${note.frame}`)
  for (const spec of body.specifications) {
    record(spec, ['frame', 'given', 'when', 'then'])
    if (!Array.isArray(spec.given) || !Array.isArray(spec.when) || !Array.isArray(spec.then)) throw Error('Invalid specification statements')
    if (!ids.has(spec.frame) || !spec.given.length || !spec.then.length) throw Error('Invalid Given/When/Then specification')
    for (const value of [...spec.given, ...spec.when, ...spec.then]) {
      record(value, ['type', 'entity'])
      if (!Object.values(types).includes(value.type) || typeof value.entity !== 'string' || !/^[_a-zA-Z]\w*$/.test(value.entity)) throw Error('Invalid specification type or entity')
    }
  }
}

/** Classify greedy data terminals before interpreting comments or statements. */
function eventSourceWithoutComments(source: string, track: boolean): { text: string; offsets?: number[]; protectedSpans: Array<[number, number]> } {
  const protectedSpans: Array<[number, number]> = []
  let result = ''
  const offsets = track ? ([] as number[]) : undefined
  const append = (value: string, at: number) => {
    result += value
    if (offsets) for (let index = 0; index < value.length; index++) offsets.push(at + index)
  }
  let lineEnd = source.indexOf('\n')
  if (lineEnd < 0) lineEnd = source.length
  let leadingWhitespace = true
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!,
      next = source[i + 1]
    if (i > lineEnd) {
      // Comments and payloads can jump across physical lines. Rebuild their
      // prefix once at the jump, never once per character of a long line.
      leadingWhitespace = !result.slice(result.lastIndexOf('\n') + 1).trim()
      const nextEnd = source.indexOf('\n', i)
      lineEnd = nextEnd < 0 ? source.length : nextEnd
    }
    const atLineStart: boolean = leadingWhitespace
    leadingWhitespace &&= /\s/.test(char)
    // These terminals own their complete payload, including URLs and braces.
    if (atLineStart && (char === 't' || char === 'a') && /^(?:title(?:[ \t]|$)|accTitle[ \t]*:|accDescr[ \t]*:)/.test(source.slice(i, lineEnd))) {
      const end = source.indexOf('%%', i)
      append(source.slice(i, end >= 0 && end < lineEnd ? end : lineEnd), i)
      i = lineEnd - 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw Error('Unclosed Event Modeling comment')
      protectedSpans.push([i, end + 2])
      const comment = source.slice(i, end + 2)
      append(comment.replace(/[^\n]/g, ' '), i)
      leadingWhitespace = atLineStart || comment.includes('\n')
      i = end + 1
      continue
    }
    if ((char === '%' && next === '%') || (char === '/' && next === '/')) {
      i = lineEnd - 1
      continue
    }
    if (char === '{') {
      if (!source.slice(i + 1, lineEnd).trim() && lineEnd < source.length) {
        const closing = /^}[ \t]*(?=\n|$)/gm
        closing.lastIndex = lineEnd + 1
        const match = closing.exec(source)
        if (!match) throw Error('Unclosed Event Modeling block')
        protectedSpans.push([i, match.index + match[0].length])
        append(source.slice(i, match.index + match[0].length), i)
        i = match.index + match[0].length - 1
        continue
      }
      const end = source.lastIndexOf('}', lineEnd - 1)
      if (end < i) throw Error('Unclosed inline data')
      append(source.slice(i, end + 1), i)
      i = end
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const end = char === '`' ? source.indexOf(char, i + 1) : source.lastIndexOf(char, lineEnd - 1)
      if (end <= i || end >= lineEnd) throw Error('Unclosed inline value')
      append(source.slice(i, end + 1), i)
      i = end
      continue
    }
    if (/\s/.test(source[i - 1] ?? '') && /[tredng]/.test(char) && /^(?:tf|timeframe|rf|resetframe|entity|data|note|gwt)\s/.test(source.slice(i))) {
      const currentLine = result.slice(result.lastIndexOf('\n') + 1)
      if (currentLine.trim()) {
        result = result.trimEnd()
        if (offsets) offsets.length = result.length
        append('\n', i)
      }
    }
    append(char, i)
  }
  return { text: result, offsets, protectedSpans }
}

/** The envelope and native reader share the same lexical ownership ranges. */
export function eventModelingStatementEnds(lines: readonly string[]): number[] {
  const source = lines.join('\n')
  try {
    return eventStatementEndsFromSpans(source, eventSourceWithoutComments(source, false).protectedSpans)
  } catch {
    return lines.map((_, index) => index)
  }
}
function eventStatementEndsFromSpans(source: string, spans: readonly [number, number][]): number[] {
  const starts = sourceLineStarts(source)
  const ends = starts.map((_, index) => index)
  for (const [start, end] of spans) {
    const first = sourcePointAt(starts, start).line - 1
    const last = sourcePointAt(starts, Math.max(start, end - 1)).line - 1
    ends[first] = Math.max(ends[first]!, last)
  }
  return ends
}

/** Lane identities and membership are semantic; pixels and cells project them. */
export function eventLanes(body: EventModelingBody): Array<{ id: string; label: string; members: string[] }> {
  const lanes = new Map<string, { id: string; label: string; members: string[] }>()
  for (const frame of body.frames) {
    const label = eventLane(frame)
    const lane = lanes.get(label) ?? { id: `lane:${lanes.size}`, label, members: [] }
    lane.members.push(frame.id)
    lanes.set(label, lane)
  }
  return [...lanes.values()]
}
