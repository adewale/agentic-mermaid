import type { Accessibility } from '../agent/types.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { readMetadataBlock } from '../shared/metadata-yaml.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { stripTrailingComment } from '../shared/trailing-comment.ts'
import type { KanbanBody, KanbanColumn, KanbanItem } from './types.ts'

const OPEN = /(\(\(|\{\{|\(-|-\)|\)\)|\[|\(|\))/
const CLOSE: Readonly<Record<string, string>> = { '[': ']', '(': ')', '((': '))', '{{': '}}', ')': '(', '))': '((', '(-': '-)', '-)': '(-' }

/** The first node's indentation defines the column level. All deeper levels
 * belong to the most recent column, including levels deeper than one card. */
export function parseKanbanDiagram(input: readonly string[] | string, accessibility: Accessibility = {}): KanbanBody {
  const scanned = scanAccessibilityDirectives(typeof input === 'string' ? input.split(/\r?\n/) : [...input])
  const lines = [...scanned.familyLines]
  while (lines.length && (!lines[0]!.trim() || lines[0]!.trim().startsWith('%%'))) lines.shift()
  const header = lines.shift() ?? ''
  observeParserStatement('kanban', 'header', header, { line: 1, unit: 'normalized' })
  if (!/^kanban\s*$/i.test(stripTrailingComment(header).trim())) throw syntaxError({ what: 'Invalid Kanban header', expectedForm: 'kanban', example: 'kanban\nTodo\n  task[Write documentation]' })
  const body: KanbanBody = { kind: 'kanban', columns: [], accessibilityTitle: accessibility.title ?? scanned.accessibility.title, accessibilityDescription: accessibility.descr ?? scanned.accessibility.descr }
  const used = new Set<string>(),
    counters = new Map<string, number>()
  let baseIndent: number | undefined, column: KanbanColumn | undefined, previous: KanbanItem | undefined
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!,
      text = line.trim()
    if (!text || text.startsWith('%%')) continue
    const startIndex = index
    const indent = line.length - line.trimStart().length
    if (text.startsWith(':::') || text.startsWith('::icon(')) {
      if (!previous) throw new Error('Kanban decoration must follow a column or task')
      if (text.startsWith(':::')) previous.className = stripTrailingComment(text.slice(3)).trim()
      else {
        const match = /^::icon\(([^)]*)\)\s*(?:%%.*)?$/.exec(text)
        if (!match) throw new Error('Invalid Kanban ::icon decoration')
        previous.icon = match[1]!.trim()
      }
      observeParserStatement('kanban', text.startsWith(':::') ? 'class' : 'icon', line, { line: index + 2, unit: 'normalized' })
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
        if (end < 0) throw new Error('Unclosed Kanban quoted label')
        label = rest.slice(start, end)
        consumed = end + delimiter.length
        if (!rest.slice(consumed).startsWith(closing)) throw new Error(`Kanban label must close with ${closing}`)
        consumed += closing.length
      } else {
        while (!rest.includes(closing) && index + 1 < lines.length) rest += '\n' + lines[++index]!
        const end = rest.indexOf(closing)
        if (end < 0) throw new Error(`Unclosed Kanban label; expected ${closing}`)
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
    if (!rawId || !label) throw new Error('Kanban columns and cards require a non-empty label')
    const declaredLabel = label
    let metadata: Record<string, unknown> = {}
    if (suffix.startsWith('@{')) {
      let block = suffix,
        parsed = readMetadataBlock(block, 1, 'flowchart')
      while (!parsed.ok && parsed.unclosed && index + 1 < lines.length) {
        block += '\n' + lines[++index]!
        parsed = readMetadataBlock(block, 1, 'flowchart')
      }
      if (!parsed.ok) throw new Error(`Invalid Kanban metadata: ${parsed.message}`)
      metadata = Object.fromEntries(parsed.entries)
      suffix = block.slice(parsed.end + 1).trim()
      if (metadata.shape && (typeof metadata.shape !== 'string' || metadata.shape !== metadata.shape.toLowerCase() || metadata.shape.includes('_'))) throw new Error('Kanban metadata shape must be lowercase without underscores')
      if (metadata.label) label = String(metadata.label)
    }
    if (stripTrailingComment(suffix).trim()) throw syntaxError({ what: `Unexpected Kanban suffix: ${suffix}`, expectedForm: 'a node followed by optional @{ metadata }', example: 'task[Fix bug]@{ assigned: Alice }' })
    if (parserObservationActive('kanban')) observeParserStatement('kanban', 'node', lines.slice(startIndex, index + 1).join('\n'), { line: startIndex + 2, unit: 'normalized' })
    rawId = decodeMermaidEntities(rawId)
    label = decodeMermaidEntities(label)
    const occurrence = counters.get(rawId) ?? 0
    counters.set(rawId, occurrence + 1)
    let id = occurrence ? `${rawId}#${occurrence + 1}` : rawId
    while (used.has(id)) id += '#'
    used.add(id)
    const item: KanbanItem = { id, sourceId: rawId, ...(implicitId ? { implicitId: true } : {}), label, metadata, ...(metadata.icon ? { icon: String(metadata.icon) } : {}) }
    baseIndent ??= indent
    if (indent < baseIndent) throw new Error(`Items without section detected, found section ("${label}")`)
    if (indent === baseIndent) {
      column = { ...item, tasks: [] }
      body.columns.push(column)
      previous = column
      if (parserObservationActive('kanban')) observeParserMutation('kanban', 'add-column', { ...item, indent, declaredLabel })
    } else {
      if (!column) throw new Error('Kanban card has no column')
      column.tasks.push(item)
      previous = item
      if (parserObservationActive('kanban')) observeParserMutation('kanban', 'add-task', { ...item, indent, declaredLabel, parentId: column.sourceId })
    }
    assertDiagramWorkLimit('nodes', used.size)
  }
  return body
}
