import { unknownOpMessage } from '../agent/mutation-ops.ts'
import { parseMermaidYaml, readYamlMappingRanges } from '../shared/mermaid-yaml.ts'
import { matchMermaidFrontmatter } from '../mermaid-source-wrapper.ts'
import { appendNativeAccessibilityLines } from '../shared/accessibility-directives.ts'
import type { ValidDiagramMeta } from '../agent/types.ts'
import type { EventData, EventModelingBody, EventModelingMutationOp } from './types.ts'
import { parseEventModeling, validateEventModeling } from './parser.ts'
import { err, ok, type MutationError, type Result } from '../agent/types.ts'
import { normalizeBodyAccessibility } from '../agent/accessibility-envelope.ts'

function dataText(data: EventData, block: boolean): string {
  if (data.type && !['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'].includes(data.type)) throw Error('Invalid data type')
  if (block ? /^}\s*$/m.test(data.text) : /[\r\n]/.test(data.text)) throw Error('Data cannot be represented without changing its meaning')
  return `${data.type ? `\`${data.type}\`` : ''}{${block ? '\n' : ''}${data.text}${block ? '\n' : ''}}`
}
export function serializeEventModeling(body: EventModelingBody, includeTitleWrapper = true): string {
  validateEventModeling(body, true)
  const lines = ['eventmodeling']
  appendNativeAccessibilityLines(lines, body)
  if (body.title !== undefined) {
    if (includeTitleWrapper) lines.unshift(`---\ntitle: ${JSON.stringify(body.title)}\n---`)
  }
  for (const name of body.entities) lines.push(`entity ${name}`)
  for (const frame of body.frames) lines.push(`${frame.reset ? 'rf' : 'tf'} ${frame.id} ${frame.type} ${frame.entity}${frame.sources.map(id => ` ->> ${id}`).join('')}${frame.dataReference ? ` [[${frame.dataReference}]]` : ''}${frame.data ? ` ${dataText(frame.data, false)}` : ''}`)
  for (const [id, data] of Object.entries(body.data)) lines.push(`data ${id} ${dataText(data, true)}`)
  for (const note of body.notes) lines.push(`note ${note.frame} ${dataText(note.data, true)}`)
  for (const spec of body.specifications)
    lines.push(
      `gwt ${spec.frame}\n${(['given', 'when', 'then'] as const)
        .filter(key => spec[key].length)
        .map(key => `${key}\n${spec[key].map(value => `  ${value.type} ${value.entity}`).join('\n')}`)
        .join('\n')}`,
    )
  return lines.join('\n') + '\n'
}
export function mutateEventModeling(body: EventModelingBody, op: EventModelingMutationOp): Result<EventModelingBody, MutationError> {
  try {
    const next = structuredClone(body)
    next.data = Object.assign(Object.create(null), next.data)
    const find = (id: string) => {
      const index = next.frames.findIndex(frame => frame.id === id)
      if (index < 0) throw Error(`Unknown frame: ${id}`)
      return index
    }
    const index = (value: number | undefined, size: number) => {
      const at = value ?? size
      if (!Number.isSafeInteger(at) || at < 0 || at > size) throw Error('Invalid frame position')
      return at
    }
    switch (op.kind) {
      case 'insert_frame':
        next.frames.splice(index(op.index, next.frames.length), 0, structuredClone(op.frame))
        break
      case 'remove_frame':
        next.frames.splice(find(op.id), 1)
        break
      case 'move_frame': {
        const [frame] = next.frames.splice(find(op.id), 1)
        next.frames.splice(index(op.index, next.frames.length), 0, frame!)
        break
      }
      case 'set_frame': {
        if (op.frame.id !== op.id) throw Error('Frame replacement must retain identity')
        next.frames[find(op.id)] = structuredClone(op.frame)
        break
      }
      case 'set_entities':
        next.entities = structuredClone(op.entities)
        break
      case 'set_notes':
        next.notes = structuredClone(op.notes)
        break
      case 'set_specifications':
        next.specifications = structuredClone(op.specifications)
        break
      case 'set_data':
        next.data[op.id] = structuredClone(op.data)
        break
      case 'set_title':
        next.title = op.title
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description
        break
      default:
        throw Error(unknownOpMessage('eventmodeling', op))
    }
    // Reparse at the write boundary so malformed untyped records fail atomically.
    const normalized = normalizeBodyAccessibility(next)
    const reparsed = parseEventModeling(serializeEventModeling(normalized))
    if (eventModelMeaning(normalized) !== eventModelMeaning(reparsed)) throw Error('Edit cannot be written without changing owned Event Modeling content')
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

function eventModelMeaning(body: EventModelingBody): string {
  return JSON.stringify([
    body.frames.map(frame => [frame.id, frame.reset, frame.type, frame.entity, frame.sources, frame.dataReference, frame.data?.type, frame.data?.text]),
    body.entities,
    Object.entries(body.data)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, data]) => [id, data.type, data.text]),
    body.notes.map(note => [note.frame, note.data.type, note.data.text]),
    body.specifications.map(spec => [spec.frame, ...(['given', 'when', 'then'] as const).map(section => spec[section].map(item => [item.type, item.entity]))]),
    body.title,
    body.accessibilityTitle,
    body.accessibilityDescription,
  ])
}

/** Change only the owned title scalar; keep unrelated wrapper bytes intact. */
export function eventModelingMeta(body: EventModelingBody, meta: ValidDiagramMeta): ValidDiagramMeta {
  const previous = meta.frontmatter?.title
  if (body.title === previous || (body.title === undefined && typeof previous !== 'string')) return meta
  const frontmatter = { ...meta.frontmatter }
  if (body.title === undefined) delete frontmatter.title
  else frontmatter.title = body.title
  if (meta.wrapperSource === undefined) return { ...meta, frontmatter }
  const wrapper = meta.wrapperSource
  const match = matchMermaidFrontmatter(wrapper)
  if (!match) return { ...meta, frontmatter, wrapperSource: body.title === undefined ? wrapper : `---\ntitle: ${JSON.stringify(body.title)}\n---\n${wrapper}` }
  const range = readYamlMappingRanges(match.yaml).find(field => field.name === 'title')
  let yaml = match.yaml
  if (range) {
    if (body.title === undefined) {
      let start = range.keyStart, end = range.valueEnd
      if (yaml.trimStart().startsWith('{')) {
        const comma = yaml.slice(end).match(/^\s*,/)
        if (comma) end += comma[0].length
        else {
          const preceding = yaml.slice(0, start).match(/,\s*$/)
          if (preceding) start -= preceding[0].length
        }
      }
      yaml = yaml.slice(0, start) + yaml.slice(end)
    }
    else yaml = yaml.slice(0, range.valueStart) + JSON.stringify(body.title) + (/[\r\n]$/.test(yaml.slice(range.valueStart, range.valueEnd)) ? '\n' : '') + yaml.slice(range.valueEnd)
  } else if (body.title !== undefined) yaml = `title: ${JSON.stringify(body.title)}\n${yaml}`
  // YAML aliases can couple the title scalar to unrelated configuration.
  // Never commit an apparently local edit that changes another resolved value.
  const unrelated = (source: string) => {
    const parsed = parseMermaidYaml(source)
    if (!parsed.ok) throw Error(parsed.message)
    if (parsed.value == null) return '{}'
    if (typeof parsed.value !== 'object' || Array.isArray(parsed.value)) throw Error('Expected metadata mapping')
    const rest = { ...parsed.value } as Record<string, unknown>
    delete rest.title
    return JSON.stringify(rest)
  }
  if (unrelated(match.yaml) !== unrelated(yaml)) throw Error('Title edit would change unrelated YAML metadata through an alias')
  const yamlStart = match.source.indexOf('\n') + 1
  return { ...meta, frontmatter, wrapperSource: wrapper.slice(0, yamlStart) + yaml + wrapper.slice(yamlStart + match.yaml.length) }
}
