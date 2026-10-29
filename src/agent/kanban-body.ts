import { unknownOpMessage } from './mutation-ops.ts'
import YAML from 'yaml'
import { preservedMermaidFamilyText, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { kanbanMetadataLabel, parseKanbanDiagram } from '../kanban/parser.ts'
import type { KanbanBody, KanbanItem, KanbanMutationOp } from '../kanban/types.ts'
import { encodeMermaidEntities } from '../shared/mermaid-entities.ts'
import { quoteMetadataString } from '../shared/metadata-yaml.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { isPlainRecord } from '../shared/plain-data.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { labelOverflowCollector } from './body-utils.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

export function parseKanbanBody(lines: readonly string[] | string, source?: NormalizedMermaidSource): KanbanBody | null {
  try {
    const input = source ? preservedMermaidFamilyText(source).replace(/^[^\r\n]*/, 'kanban') : lines
    return parseKanbanDiagram(input, source?.accessibility, source)
  } catch (error) {
    if (error instanceof DiagramWorkLimitError && error.resource === 'sourceCharacters') throw error
    return null
  }
}
export function renderKanban(body: KanbanBody): string {
  const lines = ['kanban']
  appendAccessibilityLines(lines, body)
  const emit = (item: KanbanItem, indent: string): void => {
    // Mermaid's case-insensitive keyword token also matches kanban-… and
    // kanban followed by a non-ASCII letter. Its implicit-ID form retains
    // those identities without exposing them to the keyword lexer.
    const implicitId = item.implicitId || /^kanban\b/i.test(item.sourceId)
    // A quoted node label cannot contain a physical quote in Mermaid's Jison
    // lexer. Entity spelling also shields global directive openers; IDs keep
    // the original authored text after the shared entity decoder.
    const label = encodeMermaidEntities(implicitId ? item.sourceId : item.label, '"%&').replace(/\r\n/g, '\r\r\n')
    const identifier = implicitId ? '' : encodeMermaidEntities(item.sourceId, '()[]{}@%&')
    lines.push(`${indent}${identifier}["${label}"]`)
    const metadata = { ...item.metadata }
    // An implicit identity comes from the declaration, independently of a
    // later display-label edit. Keep both through the public writer.
    if (implicitId && item.sourceId !== item.label && !metadata.label) metadata.label = encodeMermaidEntities(item.label)
    if (item.icon !== undefined) metadata.icon = item.icon
    if (Object.keys(metadata).length) {
      // Block YAML also represents metadata whose values contain commas or
      // braces; scalar quotes use the same lexer-safe codec as flowcharts.
      const entries = Object.entries(metadata)
      const quoted = (value: string, authoredLabel = false) => {
        const scalar = quoteMetadataString(value).replaceAll('&', '\\x26')
        return authoredLabel ? scalar : scalar.replaceAll('#', '\\x23')
      }
      if (entries.every(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
        lines[lines.length - 1] += `@{ ${entries.map(([key, value]) => `${quoted(key)}: ${typeof value === 'string' ? quoted(value, key === 'label') : String(value)}`).join(', ')} }`
      } else {
        lines[lines.length - 1] += '@{'
        let labelScalar: unknown
        const document = new YAML.Document(metadata, {
          aliasDuplicateObjects: false,
          customTags: tags => tags.map(tag => typeof tag !== 'string' && tag.collection === undefined && tag.tag === 'tag:yaml.org,2002:str'
            ? { ...tag, stringify: item => quoted(String(item.value), item === labelScalar) }
            : tag),
        })
        labelScalar = document.get('label', true)
        const yaml = document.toString()
        for (const line of yaml.trimEnd().split('\n')) lines.push(`${indent}  ${line}`)
        lines.push(`${indent}}`)
      }
    }
    if (item.className !== undefined) lines.push(`${indent}:::${item.className}`)
  }
  for (const column of body.columns) {
    emit(column, '  ')
    for (const task of column.tasks) emit(task, '    ')
  }
  return lines.join('\n') + '\n'
}

export function mutateKanban(body: KanbanBody, op: KanbanMutationOp): Result<KanbanBody, MutationError> {
  const clone = (item: KanbanItem): KanbanItem => ({ ...item, metadata: structuredClone(item.metadata) })
  const next: KanbanBody = { ...body, columns: body.columns.map(column => ({ ...clone(column), tasks: column.tasks.map(clone) })) }
  const fail = (message: string): Result<KanbanBody, MutationError> => err({ code: 'INVALID_OP', message })
  const items = (): KanbanItem[] => next.columns.flatMap(column => [column, ...column.tasks])
  const item = (id: string): KanbanItem | undefined => items().find(item => item.id === id)
  const parent = (id: string) => next.columns.find(column => column.tasks.some(task => task.id === id))
  const column = (id: string) => next.columns.find(column => column.id === id)
  const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  const idValid = (id: string): boolean => typeof id === 'string' && /^[\p{L}\p{N}_-]+$/u.test(id) && !item(id)
  const at = (value: number | undefined, length: number): number => (value === undefined ? length : Number.isInteger(value) && value >= 0 && value <= length ? value : -1)
  switch (op.kind) {
    case 'set_accessibility_title':
      if (op.title !== undefined && !text(op.title)) return fail('Accessibility title must be text')
      next.accessibilityTitle = op.title
      break
    case 'set_accessibility_description':
      if (op.description !== undefined && !text(op.description)) return fail('Accessibility description must be text')
      next.accessibilityDescription = op.description
      break
    case 'add_column': {
      const index = at(op.index, next.columns.length)
      if (!idValid(op.id) || !text(op.label) || index < 0) return fail('add_column requires a new identifier, non-empty label and valid insertion index')
      next.columns.splice(index, 0, { id: op.id, sourceId: op.id, label: op.label, metadata: {}, tasks: [] })
      break
    }
    case 'remove_column': {
      const target = column(op.id)
      if (!target) return fail(`Kanban column ${op.id} not found`)
      if (target.tasks.length && !op.removeTasks) return fail('Column is not empty; move its cards first or set removeTasks: true')
      next.columns.splice(next.columns.indexOf(target), 1)
      break
    }
    case 'set_column_label': {
      const target = column(op.id)
      if (!target || !text(op.label)) return fail('set_column_label requires an existing column and non-empty label')
      target.label = op.label
      delete target.metadata.label
      break
    }
    case 'move_column': {
      const target = column(op.id),
        index = at(op.index, next.columns.length - 1)
      if (!target || index < 0) return fail('move_column requires an existing column and destination index')
      next.columns.splice(next.columns.indexOf(target), 1)
      next.columns.splice(index, 0, target)
      break
    }
    case 'add_task': {
      const target = column(op.column)
      if (!target) return fail(`Kanban column ${op.column} not found`)
      const index = at(op.index, target.tasks.length)
      if (!idValid(op.id) || !text(op.label) || index < 0 || (op.metadata !== undefined && !isPlainRecord(op.metadata))) return fail('add_task requires a new identifier, non-empty label, metadata object and insertion index in range')
      const metadata = structuredClone(op.metadata ?? {})
      const label = kanbanMetadataLabel(metadata.label) ?? op.label
      target.tasks.splice(index, 0, { id: op.id, sourceId: op.id, label, metadata, ...(metadata.icon ? { icon: String(metadata.icon) } : {}) })
      break
    }
    case 'remove_task': {
      const target = parent(op.id)
      if (!target) return fail(`Kanban task ${op.id} not found`)
      target.tasks.splice(
        target.tasks.findIndex(task => task.id === op.id),
        1,
      )
      break
    }
    case 'set_task_label': {
      const target = parent(op.id)?.tasks.find(task => task.id === op.id)
      if (!target || !text(op.label)) return fail('set_task_label requires an existing task and non-empty label')
      target.label = op.label
      delete target.metadata.label
      break
    }
    case 'set_task_metadata': {
      const target = parent(op.id)?.tasks.find(task => task.id === op.id)
      if (!target || (op.metadata !== null && !isPlainRecord(op.metadata))) return fail('set_task_metadata requires an existing task and metadata object or null')
      target.metadata = structuredClone(op.metadata ?? {})
      target.icon = target.metadata.icon ? String(target.metadata.icon) : undefined
      // Metadata labels carry authored Mermaid codes; set_task_label accepts
      // literal display text and removes that metadata override instead.
      if (target.metadata.label) target.label = kanbanMetadataLabel(target.metadata.label)!
      break
    }
    case 'move_task': {
      const from = parent(op.id),
        to = column(op.column),
        target = item(op.id)
      if (!from || !to || !target) return fail('move_task requires an existing task and destination column')
      from.tasks.splice(from.tasks.indexOf(target), 1)
      const index = at(op.index, to.tasks.length)
      if (index < 0) return fail('move_task index is out of range')
      to.tasks.splice(index, 0, target)
      break
    }
    case 'set_icon': {
      const target = item(op.id)
      if (!target || (op.icon !== undefined && !text(op.icon))) return fail('set_icon requires an existing item and icon text')
      target.icon = op.icon
      delete target.metadata.icon
      break
    }
    case 'set_class': {
      const target = item(op.id)
      if (!target || (op.className !== undefined && !/^[\w -]*$/.test(op.className))) return fail('set_class requires an existing item and CSS class tokens')
      target.className = op.className
      break
    }
    default:
      return fail(unknownOpMessage('kanban', op))
  }
  // Typed edits must remain in the strict writer's grammar, including its
  // unusual metadata lexer (quotes may not contain a literal double quote).
  try {
    parseKanbanDiagram(renderKanban(next))
  } catch (error) {
    if (error instanceof DiagramWorkLimitError) return fail(error.message)
    return fail(`Kanban edit cannot be serialized as Mermaid: ${error instanceof Error ? error.message : String(error)}`)
  }
  return ok(next)
}
export function verifyKanban(body: KanbanBody, options: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, options)
  if (!body.columns.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  for (const column of body.columns)
    for (const item of [column, ...column.tasks]) {
      overflow(item.id, item.label)
      for (const key of ['ticket', 'assigned', 'priority']) if (item.metadata[key]) overflow(`${item.id}:${key}`, String(item.metadata[key]))
    }
  return warnings
}
