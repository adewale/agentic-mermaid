import type { Accessibility } from '../agent/types.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { encodeMermaidAuthoredEntities } from '../shared/mermaid-entities.ts'
import { readMetadataBlock, type MetadataBlock } from '../shared/metadata-yaml.ts'
import { scanMetadataBlock } from '../shared/metadata-block-scan.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive, withParserObservation } from '../shared/parser-observation.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { stripTrailingComment, trailingCommentStart } from '../shared/trailing-comment.ts'
import type { KanbanBody, KanbanColumn, KanbanItem } from './types.ts'

const OPEN = /(\(\(|\{\{|\(-|-\)|\)\)|\[|\(|\))/
const CLOSE: Readonly<Record<string, string>> = { '[': ']', '(': ')', '((': '))', '{{': '}}', ')': '(', '))': '((', '(-': '-)', '-)': '(-' }

/** Metadata labels interpret authored codes while retaining literal marker text. */
export function kanbanMetadataLabel(value: unknown): string | undefined {
  return value ? decodeMermaidEntities(encodeMermaidAuthoredEntities(String(value))) : undefined
}

export interface KanbanDeclaration {
  readonly id: string
  readonly group: boolean
  readonly start: number
  readonly end: number
  readonly line: number
  readonly endLine: number
  readonly declaredStart: number
  readonly declaredLabel: string
  readonly declaredLabelStart: number
  readonly metadataSpans?: readonly { name: string; keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }[]
}

/** The first node's indentation defines the column level. All deeper levels
 * belong to the most recent column, including levels deeper than one card. */
export function parseKanbanDiagram(input: readonly string[] | string, accessibility: Accessibility = {}, origin?: Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource'>, onComment?: (text: string, line: number, range: { start: number; end: number }) => void, onDeclaration?: (record: KanbanDeclaration) => void): KanbanBody {
  return readKanbanDiagram(input, accessibility, origin, onComment, onDeclaration)
}

function readKanbanDiagram(input: readonly string[] | string, accessibility: Accessibility, origin?: Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource'>, onComment?: (text: string, line: number, range: { start: number; end: number }) => void, onDeclaration?: (record: KanbanDeclaration) => void, boundariesOnly = false): KanbanBody {
  const source = typeof input === 'string' ? input : input.join('\n')
  // Shared payload views have normalized CRLF already. A remaining CR beside
  // LF is payload, so never combine those characters a second time.
  const breaks = origin ? /\r|\n/g : /\r\n?|\n/g
  const lines = source.split(breaks)
  const endings = source.match(breaks) ?? []
  let bodyLine = 2, bodyOffset = 0
  while (lines.length && (!lines[0]!.trim() || lines[0]!.trim().startsWith('%%'))) {
    bodyOffset += lines[0]!.length + (endings[0]?.length ?? 0)
    lines.shift()
    endings.shift()
    bodyLine++
  }
  const headerOffset = bodyOffset, header = lines.shift() ?? ''
  bodyOffset += header.length + (endings[0]?.length ?? 0)
  const reportComment = (source: string, line: number, offset: number): void => {
    if (!onComment) return
    const start = trailingCommentStart(source)
    if (start >= 0) onComment(source.slice(start + 2).trim(), line, { start: offset + start + 2, end: offset + source.length })
  }
  reportComment(header, bodyLine - 1, headerOffset)
  endings.shift()
  let offset = bodyOffset
  const offsets = parserObservationActive('kanban') || onComment || onDeclaration ? lines.map((line, index) => {
    const start = offset
    offset += line.length + (endings[index]?.length ?? 0)
    return start
  }) : undefined
  observeParserStatement('kanban', 'header', header, { line: bodyLine - 1, unit: 'normalized' })
  if (!/^kanban\s*$/i.test(stripTrailingComment(header).trim())) throw syntaxError({ what: 'Invalid Kanban header', expectedForm: 'kanban', example: 'kanban\nTodo\n  task[Write documentation]' })
  const body: KanbanBody = { kind: 'kanban', columns: [], accessibilityTitle: accessibility.title, accessibilityDescription: accessibility.descr }
  const used = new Set<string>(),
    counters = new Map<string, number>()
  let baseIndent: number | undefined, column: KanbanColumn | undefined, previous: KanbanItem | undefined
  // Resolve errors lazily against physical authored lines. The known wrapper
  // anchors the search after any Mermaid-looking text in YAML or directives.
  const position = (index: number, column: number): string => {
    if (!origin) return `line ${bodyLine + index}, column ${column + 1}`
    const authored = origin.originalText.split(/\r\n?|\n/)
    let cursor = (origin.wrapperSource?.match(/\r\n?|\n/g)?.length ?? 0) + 1
    for (let line = 0; line <= index; line++) {
      const wanted = lines[line]!.trim()
      while (cursor < authored.length && authored[cursor]!.trim() !== wanted) cursor++
      if (cursor >= authored.length) break
      if (line === index) {
        const actualIndent = authored[cursor]!.length - authored[cursor]!.trimStart().length,
          grammarIndent = lines[line]!.length - lines[line]!.trimStart().length
        return `line ${cursor + 1}, column ${column + actualIndent - grammarIndent + 1}`
      }
      cursor++
    }
    return `line ${bodyLine + index}, column ${column + 1}`
  }
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!, linePrefix = 0,
      text = line.trim()
    if (!text || text.startsWith('%%')) continue
    const directive = parseAccessibilityDirective(lines, index)
    if (directive) {
      if (directive.title && accessibility.title === undefined) body.accessibilityTitle = directive.value
      else if (!directive.title && accessibility.descr === undefined) body.accessibilityDescription = directive.value
      index = directive.endIndex
      if (!directive.suffixLine) continue
      line = directive.suffixLine
      linePrefix = lines[index]!.length - line.length
      text = line.trim()
    }
    const startIndex = index
    const indent = line.length - line.trimStart().length
    const fail = (what: string, column: number, expectedForm: string, atIndex = startIndex): Error => syntaxError({ what: `Kanban syntax at ${position(atIndex, column)}: ${what}`, expectedForm, example: 'task[Work]@{ assigned: Alice }' })
    if (text.startsWith(':::') || text.startsWith('::icon(')) {
      if (!previous) throw fail('Kanban decoration has no preceding item', indent, 'a column or task before its decoration')
      if (text.startsWith(':::')) {
        reportComment(text.slice(3), index + bodyLine, (offsets?.[index] ?? 0) + linePrefix + indent + 3)
        previous.className = stripTrailingComment(text.slice(3)).trim()
      }
      else {
        const match = /^::icon\(([^)]*)\)\s*(?:%%.*)?$/.exec(text)
        if (!match) throw fail('Invalid Kanban icon decoration', indent, '::icon(icon-name)')
        reportComment(text.slice(text.indexOf(')') + 1), index + bodyLine, (offsets?.[index] ?? 0) + linePrefix + indent + text.indexOf(')') + 1)
        previous.icon = match[1]!.trim()
      }
      observeParserStatement('kanban', text.startsWith(':::') ? 'class' : 'icon', line, { line: index + bodyLine, unit: 'normalized' })
      const mutation = text.startsWith(':::') ? 'set-class' : 'set-icon'
      if (parserObservationActive('kanban', mutation)) observeParserMutation('kanban', mutation, { id: previous.id, sourceId: previous.sourceId, value: text.startsWith(':::') ? previous.className : previous.icon })
      continue
    }
    let rawId = '',
      label = '',
      implicitId = false,
      declaredLabelStart = indent,
      suffix = ''
    const metadataAt = text.indexOf('@{'),
      opener = OPEN.exec(metadataAt < 0 ? text : text.slice(0, metadataAt))
    if (opener) {
      rawId = text.slice(0, opener.index).trim()
      implicitId = !rawId
      const opening = opener[0],
        closing = CLOSE[opening]!
      let rest = text.slice(opener.index + opening.length),
        consumed: number
      if (rest.startsWith('"')) {
        const markdown = rest.startsWith('"`'),
          delimiter = markdown ? '`"' : '"'
        const start = markdown ? 2 : 1
        declaredLabelStart = indent + opener.index + opening.length + start
        while (rest.indexOf(delimiter, start) < 0 && index + 1 < lines.length) rest += (endings[index] === '\r' ? '\r' : '\n') + lines[++index]!
        const end = rest.indexOf(delimiter, start)
        if (end < 0) throw fail('Unclosed Kanban quoted label', indent + opener.index + opening.length, `closing ${delimiter}${closing}`)
        label = rest.slice(start, end)
        consumed = end + delimiter.length
        if (!rest.slice(consumed).startsWith(closing)) throw fail('Unclosed Kanban label', indent + opener.index, `closing ${closing}`)
        consumed += closing.length
      } else {
        declaredLabelStart = indent + opener.index + opening.length
        while (!rest.includes(closing) && index + 1 < lines.length) rest += (endings[index] === '\r' ? '\r' : '\n') + lines[++index]!
        const end = rest.indexOf(closing)
        if (end < 0) throw fail('Unclosed Kanban label', indent + opener.index, `closing ${closing}`)
        label = rest.slice(0, end)
        consumed = end + closing.length
      }
      suffix = rest.slice(consumed).trim()
      if (implicitId) rawId = label
    } else {
      const prefix = metadataAt < 0 ? text : text.slice(0, metadataAt)
      reportComment(prefix, index + bodyLine, (offsets?.[index] ?? 0) + linePrefix + indent)
      const plain = stripTrailingComment(prefix).trim()
      rawId = label = plain
      suffix = metadataAt < 0 ? '' : text.slice(metadataAt)
    }
    if (!rawId || !label) throw fail('Empty Kanban item', indent, 'a column or card with a non-empty label')
    const declaredLabel = label
    let metadata: Record<string, unknown> = {}
    let ranges: KanbanDeclaration['metadataSpans'] | undefined
    if (suffix.startsWith('@{')) {
      const before = lines.slice(startIndex, index + 1).join('\n'),
        metadataOffset = before.lastIndexOf(suffix)
      const wantsRanges = !boundariesOnly && (!!onDeclaration || parserObservationActive('kanban', indent === (baseIndent ?? indent) ? 'add-column' : 'add-task'))
      const readBlock = (block: string): MetadataBlock => {
        if (boundariesOnly) {
          const scan = scanMetadataBlock(block, 1, 'flowchart')
          return scan.kind === 'closed' ? { ok: true, end: scan.end, entries: new Map() }
            : { ok: false, unclosed: scan.kind === 'unclosed', message: scan.kind === 'invalid' ? scan.message : 'unclosed @{ metadata block' }
        }
        return readMetadataBlock(block, 1, 'flowchart', wantsRanges ? fields => {
          ranges = fields.map(field => ({ name: field.name, keyStart: metadataOffset + field.keyStart, keyEnd: metadataOffset + field.keyEnd, valueStart: metadataOffset + field.valueStart, valueEnd: metadataOffset + field.valueEnd }))
        } : undefined)
      }
      let block = suffix,
        parsed = readBlock(block)
      while (!parsed.ok && parsed.unclosed && index + 1 < lines.length) {
        block += '\n' + lines[++index]!
        parsed = readBlock(block)
      }
      if (!parsed.ok) {
        const prefix = before.slice(0, metadataOffset),
          metadataLine = prefix.split('\n').length - 1,
          metadataCol = metadataOffset - (prefix.lastIndexOf('\n') + 1)
        throw fail(`Invalid Kanban metadata (${parsed.message})`, metadataCol, 'a closed @{ key: value } metadata mapping', startIndex + metadataLine)
      }
      metadata = Object.fromEntries(parsed.entries)
      suffix = block.slice(parsed.end + 1).trim()
      if (metadata.shape && (typeof metadata.shape !== 'string' || metadata.shape !== metadata.shape.toLowerCase() || metadata.shape.includes('_'))) throw fail('Invalid Kanban metadata shape', indent, 'a lowercase shape without underscores')
      if (metadata.label) label = String(metadata.label)
    }
    if (stripTrailingComment(suffix).trim()) throw fail(`Unexpected Kanban suffix: ${suffix}`, indent, 'a node followed by optional @{ metadata }')
    const trailingSpace = onComment ? lines[index]!.length - lines[index]!.trimEnd().length : 0
    reportComment(suffix, index + bodyLine, (offsets?.[index] ?? 0) + lines[index]!.length - trailingSpace - suffix.length)
    if (parserObservationActive('kanban')) observeParserStatement('kanban', 'node', lines.slice(startIndex, index + 1).join('\n'), { line: startIndex + bodyLine, offset: offsets![startIndex], endOffset: offsets![index]! + lines[index]!.length, unit: 'normalized' })
    rawId = decodeMermaidEntities(rawId)
    // Metadata labels interpret authored codes, but literal marker-looking
    // text is still content; only declaration labels use upstream markers.
    label = kanbanMetadataLabel(metadata.label) ?? decodeMermaidEntities(label)
    const occurrence = counters.get(rawId) ?? 0
    counters.set(rawId, occurrence + 1)
    let id = occurrence ? `${rawId}#${occurrence + 1}` : rawId
    while (used.has(id)) id += '#'
    used.add(id)
    const item: KanbanItem = { id, sourceId: rawId, ...(implicitId ? { implicitId: true } : {}), label, metadata, ...(metadata.icon ? { icon: String(metadata.icon) } : {}) }
    baseIndent ??= indent
    if (indent < baseIndent) throw fail(`Items without section detected, found section ("${label}")`, indent, 'columns at the first column indentation and cards indented beneath them')
    if (indent === baseIndent) {
      column = { ...item, tasks: [] }
      body.columns.push(column)
      previous = column
      if (parserObservationActive('kanban', 'add-column')) observeParserMutation('kanban', 'add-column', { ...item, indent, declaredStart: linePrefix + indent, declaredLabel, declaredLabelStart: linePrefix + declaredLabelStart, ...(ranges ? { metadataSpans: ranges } : {}) })
    } else {
      if (!column) throw new Error('Kanban card has no column')
      column.tasks.push(item)
      previous = item
      if (parserObservationActive('kanban', 'add-task')) observeParserMutation('kanban', 'add-task', { ...item, indent, declaredStart: linePrefix + indent, declaredLabel, declaredLabelStart: linePrefix + declaredLabelStart, parentId: column.sourceId, ...(ranges ? { metadataSpans: ranges } : {}) })
    }
    onDeclaration?.({ id, group: indent === baseIndent, start: offsets![startIndex]!, end: offsets![index]! + lines[index]!.length, line: startIndex + bodyLine, endLine: index + bodyLine, declaredStart: linePrefix + indent, declaredLabel, declaredLabelStart: linePrefix + declaredLabelStart, ...(ranges ? { metadataSpans: ranges } : {}) })
    assertDiagramWorkLimit('nodes', used.size)
  }
  return body
}


/** Let universal accessibility removal reuse consumed native records rather
 * than treating directive-looking lines inside a label as envelope metadata. */
export function kanbanStatementEnds(lines: readonly string[]): number[] {
  const ends = lines.map((_, index) => index)
  let spanning = false
  // A single-line roster has the identity boundary map even if a later
  // semantic error rejects it. Reuse the real reader's record consumption,
  // without loading YAML just to discover that identity map.
  withParserObservation('kanban', () => {}, () => {
    try {
      readKanbanDiagram(lines, {}, undefined, undefined, record => {
        if (record.line !== record.endLine) spanning = true
      }, true)
    } catch (error) {
      if (error instanceof DeferredDependencyError) throw error
    }
  }, { mutations: [] })
  if (!spanning) return ends
  // For spanning records, semantic rejection determines how far the historic
  // recovery map progressed. Keep that ordering for malformed metadata.
  try {
    withParserObservation('kanban', event => {
      if (event.unit !== 'statement' || event.kind !== 'node' || !event.source?.line || event.text === undefined) return
      const start = event.source.line - 1
      ends[start] = Math.min(lines.length - 1, start + event.text.split('\n').length - 1)
    }, () => parseKanbanDiagram(lines), { mutations: [] })
  } catch (error) {
    if (error instanceof DeferredDependencyError) throw error
  }
  return ends
}
