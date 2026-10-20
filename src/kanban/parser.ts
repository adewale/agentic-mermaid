import { isMap, isScalar, parseDocument } from 'yaml'
import type { Accessibility } from '../agent/types.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { fromEntityMarkers, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { readMetadataBlock } from '../shared/metadata-yaml.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { stripTrailingComment } from '../shared/trailing-comment.ts'
import type { KanbanBody, KanbanColumn, KanbanItem } from './types.ts'

const OPEN = /(\(\(|\{\{|\(-|-\)|\)\)|\[|\(|\))/
const CLOSE: Readonly<Record<string, string>> = { '[': ']', '(': ')', '((': '))', '{{': '}}', ')': '(', '))': '((', '(-': '-)', '-)': '(-' }

/** Lexical ranges are observed only when a caller requests parser provenance.
 * YAML still has one semantic authority: readMetadataBlock above. */
function metadataRanges(block: string, end: number, offset: number): Array<{ name: string; keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }> {
  const body = block.slice(2, end),
    multiline = body.includes('\n'),
    raw = multiline ? body : block.slice(1, end + 1),
    base = offset + (multiline ? 2 : 1),
    result: Array<{ name: string; keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }> = []
  // Use the same entity prepass as metadata YAML: a bare #quot; must not
  // become a YAML comment. Retain the edits to recover original byte ranges.
  const edits: Array<{ start: number; end: number; sourceStart: number; sourceEnd: number }> = []
  let delta = 0
  for (const match of raw.matchAll(/#\w+;/g)) {
    const marker = toEntityMarkers(match[0]), start = match.index + delta
    edits.push({ start, end: start + marker.length, sourceStart: match.index, sourceEnd: match.index + match[0].length })
    delta += marker.length - match[0].length
  }
  const authored = (at: number): number => {
    let lo = 0, hi = edits.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (edits[mid]!.start <= at) lo = mid + 1; else hi = mid }
    const edit = edits[lo - 1]
    return base + (edit ? at < edit.end ? edit.sourceStart : at - edit.end + edit.sourceEnd : at)
  }
  const doc = parseDocument(toEntityMarkers(raw))
  if (!isMap(doc.contents)) return result
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || !pair.key.range || !pair.value || !('range' in pair.value) || !pair.value.range) continue
    result.push({ name: fromEntityMarkers(String(pair.key.value)), keyStart: authored(pair.key.range[0]), keyEnd: authored(pair.key.range[1]), valueStart: authored(pair.value.range[0]), valueEnd: authored(pair.value.range[1]) })
  }
  return result
}

/** The first node's indentation defines the column level. All deeper levels
 * belong to the most recent column, including levels deeper than one card. */
export function parseKanbanDiagram(input: readonly string[] | string, accessibility: Accessibility = {}, origin?: Pick<NormalizedMermaidSource, 'originalText' | 'wrapperSource'>): KanbanBody {
  const scanned = scanAccessibilityDirectives(typeof input === 'string' ? input.split(/\r?\n/) : [...input])
  const lines = [...scanned.familyLines]
  let bodyLine = 2
  while (lines.length && (!lines[0]!.trim() || lines[0]!.trim().startsWith('%%'))) {
    lines.shift()
    bodyLine++
  }
  const header = lines.shift() ?? ''
  observeParserStatement('kanban', 'header', header, { line: bodyLine - 1, unit: 'normalized' })
  if (!/^kanban\s*$/i.test(stripTrailingComment(header).trim())) throw syntaxError({ what: 'Invalid Kanban header', expectedForm: 'kanban', example: 'kanban\nTodo\n  task[Write documentation]' })
  const body: KanbanBody = { kind: 'kanban', columns: [], accessibilityTitle: accessibility.title ?? scanned.accessibility.title, accessibilityDescription: accessibility.descr ?? scanned.accessibility.descr }
  const used = new Set<string>(),
    counters = new Map<string, number>()
  let baseIndent: number | undefined, column: KanbanColumn | undefined, previous: KanbanItem | undefined
  // Resolve errors lazily against physical authored lines. The known wrapper
  // anchors the search after any Mermaid-looking text in YAML or directives.
  const position = (index: number, column: number): string => {
    if (!origin) return `line ${bodyLine + index}, column ${column + 1}`
    const authored = origin.originalText.split(/\r?\n/)
    let cursor = (origin.wrapperSource?.match(/\n/g)?.length ?? 0) + 1
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
    let line = lines[index]!,
      text = line.trim()
    if (!text || text.startsWith('%%')) continue
    const startIndex = index
    const indent = line.length - line.trimStart().length
    const fail = (what: string, column: number, expectedForm: string, atIndex = startIndex): Error => syntaxError({ what: `Kanban syntax at ${position(atIndex, column)}: ${what}`, expectedForm, example: 'task[Work]@{ assigned: Alice }' })
    if (text.startsWith(':::') || text.startsWith('::icon(')) {
      if (!previous) throw fail('Kanban decoration has no preceding item', indent, 'a column or task before its decoration')
      if (text.startsWith(':::')) previous.className = stripTrailingComment(text.slice(3)).trim()
      else {
        const match = /^::icon\(([^)]*)\)\s*(?:%%.*)?$/.exec(text)
        if (!match) throw fail('Invalid Kanban icon decoration', indent, '::icon(icon-name)')
        previous.icon = match[1]!.trim()
      }
      observeParserStatement('kanban', text.startsWith(':::') ? 'class' : 'icon', line, { line: index + bodyLine, unit: 'normalized' })
      if (parserObservationActive('kanban')) observeParserMutation('kanban', text.startsWith(':::') ? 'set-class' : 'set-icon', { id: previous.id, sourceId: previous.sourceId, value: text.startsWith(':::') ? previous.className : previous.icon })
      continue
    }
    let rawId = '',
      label = '',
      implicitId = false,
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
        while (rest.indexOf(delimiter, start) < 0 && index + 1 < lines.length) rest += '\n' + lines[++index]!
        const end = rest.indexOf(delimiter, start)
        if (end < 0) throw fail('Unclosed Kanban quoted label', indent + opener.index + opening.length, `closing ${delimiter}${closing}`)
        label = rest.slice(start, end)
        consumed = end + delimiter.length
        if (!rest.slice(consumed).startsWith(closing)) throw fail('Unclosed Kanban label', indent + opener.index, `closing ${closing}`)
        consumed += closing.length
      } else {
        while (!rest.includes(closing) && index + 1 < lines.length) rest += '\n' + lines[++index]!
        const end = rest.indexOf(closing)
        if (end < 0) throw fail('Unclosed Kanban label', indent + opener.index, `closing ${closing}`)
        label = rest.slice(0, end)
        consumed = end + closing.length
      }
      suffix = rest.slice(consumed).trim()
      if (implicitId) rawId = label
    } else {
      const plain = stripTrailingComment(metadataAt < 0 ? text : text.slice(0, metadataAt)).trim()
      rawId = label = plain
      suffix = metadataAt < 0 ? '' : text.slice(metadataAt)
    }
    if (!rawId || !label) throw fail('Empty Kanban item', indent, 'a column or card with a non-empty label')
    const declaredLabel = label
    let metadata: Record<string, unknown> = {}
    let ranges: ReturnType<typeof metadataRanges> | undefined
    if (suffix.startsWith('@{')) {
      const before = lines.slice(startIndex, index + 1).join('\n'),
        metadataOffset = before.lastIndexOf(suffix)
      let block = suffix,
        parsed = readMetadataBlock(block, 1, 'flowchart')
      while (!parsed.ok && parsed.unclosed && index + 1 < lines.length) {
        block += '\n' + lines[++index]!
        parsed = readMetadataBlock(block, 1, 'flowchart')
      }
      if (!parsed.ok) {
        const prefix = before.slice(0, metadataOffset),
          metadataLine = prefix.split('\n').length - 1,
          metadataCol = metadataOffset - (prefix.lastIndexOf('\n') + 1)
        throw fail(`Invalid Kanban metadata (${parsed.message})`, metadataCol, 'a closed @{ key: value } metadata mapping', startIndex + metadataLine)
      }
      metadata = Object.fromEntries(parsed.entries)
      if (parserObservationActive('kanban')) ranges = metadataRanges(block, parsed.end, metadataOffset)
      suffix = block.slice(parsed.end + 1).trim()
      if (metadata.shape && (typeof metadata.shape !== 'string' || metadata.shape !== metadata.shape.toLowerCase() || metadata.shape.includes('_'))) throw fail('Invalid Kanban metadata shape', indent, 'a lowercase shape without underscores')
      if (metadata.label) label = String(metadata.label)
    }
    if (stripTrailingComment(suffix).trim()) throw fail(`Unexpected Kanban suffix: ${suffix}`, indent, 'a node followed by optional @{ metadata }')
    if (parserObservationActive('kanban')) observeParserStatement('kanban', 'node', lines.slice(startIndex, index + 1).join('\n'), { line: startIndex + bodyLine, unit: 'normalized' })
    rawId = decodeMermaidEntities(rawId)
    label = decodeMermaidEntities(label)
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
      if (parserObservationActive('kanban')) observeParserMutation('kanban', 'add-column', { ...item, indent, declaredLabel, ...(ranges ? { metadataSpans: ranges } : {}) })
    } else {
      if (!column) throw new Error('Kanban card has no column')
      column.tasks.push(item)
      previous = item
      if (parserObservationActive('kanban')) observeParserMutation('kanban', 'add-task', { ...item, indent, declaredLabel, parentId: column.sourceId, ...(ranges ? { metadataSpans: ranges } : {}) })
    }
    assertDiagramWorkLimit('nodes', used.size)
  }
  return body
}
