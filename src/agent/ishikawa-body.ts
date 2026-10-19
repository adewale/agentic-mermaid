import { formatUnknownOpMessage } from './unknown-op.ts'
import type { IshikawaBody, IshikawaMutationOp } from '../ishikawa/types.ts'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { hierarchyChildren, hierarchyDescendants, validateHierarchy } from '../shared/hierarchy-model.ts'

export function parseIshikawaBody(lines: string[]): IshikawaBody | null {
  try {
    return parseIshikawaDiagram(['ishikawa', ...lines])
  } catch {
    return null
  }
}

export function renderIshikawa(body: IshikawaBody): string {
  validateHierarchy(body.nodes)
  const lines = ['ishikawa']
  appendAccessibilityLines(lines, body)
  const children = hierarchyChildren(body.nodes)
  const pending = [...(children.get(undefined) ?? [])].reverse().map(node => ({ node, depth: 0 }))
  while (pending.length) {
    const { node, depth } = pending.pop()!
    lines.push(`${'  '.repeat(depth)}${node.label}`)
    for (const child of [...(children.get(node.id) ?? [])].reverse()) pending.push({ node: child, depth: depth + 1 })
  }
  return lines.join('\n') + '\n'
}

export function mutateIshikawa(body: IshikawaBody, op: IshikawaMutationOp): Result<IshikawaBody, MutationError> {
  try {
    const next = structuredClone(body)
    const find = (id: string) => {
      const node = next.nodes.find(node => node.id === id)
      if (!node) throw new Error(`Ishikawa node ${id} was not found`)
      return node
    }
    switch (op.kind) {
      case 'set_effect':
        if (next.nodes.length) next.nodes[0]!.label = op.label
        else next.nodes.push({ id: 'effect', label: op.label })
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title ?? undefined
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description ?? undefined
        break
      case 'add_cause': {
        const parentId = op.parentId ?? next.nodes[0]?.id
        if (!parentId) throw new Error('Set the effect before adding a cause')
        find(parentId)
        let n = 1
        while (next.nodes.some(node => node.id === `cause-${n}`)) n++
        next.nodes.push({ id: `cause-${n}`, label: op.label, parentId })
        break
      }
      case 'remove_cause': {
        const node = find(op.id)
        if (!node.parentId) throw new Error('The effect cannot be removed as a cause')
        const ids = hierarchyDescendants(next.nodes, op.id)
        next.nodes = next.nodes.filter(item => !ids.has(item.id))
        break
      }
      case 'set_label':
        find(op.id).label = op.label
        break
      case 'move_cause': {
        const node = find(op.id)
        find(op.parentId)
        if (!node.parentId) throw new Error('The effect cannot move')
        if (hierarchyDescendants(next.nodes, op.id).has(op.parentId)) throw new Error('A cause cannot move into its own subtree')
        node.parentId = op.parentId
        const siblings = next.nodes.filter(other => other.parentId === op.parentId && other.id !== op.id)
        const index = op.index ?? siblings.length
        if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw new Error('Invalid destination index')
        next.nodes = next.nodes.filter(other => other.id !== op.id)
        const before = siblings[index]
        next.nodes.splice(before ? next.nodes.findIndex(other => other.id === before.id) : next.nodes.length, 0, node)
        break
      }
      default:
        throw new Error(formatUnknownOpMessage('ishikawa', op, ISHIKAWA_OP_KINDS.join(', ')))
    }
    for (const node of next.nodes) if (typeof node.label !== 'string' || !node.label.trim() || /[\r\n]/.test(node.label) || /^\s*(?:%%|accTitle\b|accDescr\b)/i.test(node.label)) throw new Error('Ishikawa labels must be nonempty single-line text, not a Mermaid directive')
    renderIshikawa(next)
    return ok(next)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

export function verifyIshikawa(body: IshikawaBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (!body.nodes.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const overflow = labelOverflowCollector(warnings, opts)
  for (const node of body.nodes) overflow(node.id, node.label)
  return warnings
}

const string = { type: 'string', required: true } as const
const nullable = { type: 'string-or-null', required: true } as const
export const ISHIKAWA_OP_SCHEMAS = {
  set_effect: { fields: { label: string } },
  add_cause: { fields: { label: string, parentId: { type: 'string', required: false } } },
  remove_cause: { fields: { id: string } },
  set_label: { fields: { id: string, label: string } },
  move_cause: { fields: { id: string, parentId: string, index: { type: 'number', required: false } } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const ISHIKAWA_OP_KINDS = Object.keys(ISHIKAWA_OP_SCHEMAS)
