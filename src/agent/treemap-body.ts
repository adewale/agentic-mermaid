import { formatUnknownOpMessage } from './unknown-op.ts'
import type { TreemapBody, TreemapMutationOp } from '../treemap/types.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { hierarchyDescendants, validateHierarchy } from '../shared/hierarchy-model.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'

export function parseTreemapBody(lines: string[]): TreemapBody | null {
  try {
    return parseTreemapDiagram(['treemap', ...lines])
  } catch {
    return null
  }
}

function quoted(value: string): string {
  if (!value.includes('"')) return `"${value.replace(/\r?\n/g, '<br/>')}"`
  if (!value.includes("'")) return `'${value.replace(/\r?\n/g, '<br/>')}'`
  throw new Error('Treemap labels must be representable in single or double quotes')
}

export function renderTreemap(body: TreemapBody): string {
  validateHierarchy(body.nodes)
  const lines = ['treemap']
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`title ${body.title.replace(/\r?\n/g, '<br/>')}`)
  const children = new Map<string | undefined, typeof body.nodes>()
  for (const node of body.nodes) {
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  const pending = [...(children.get(undefined) ?? [])].reverse().map(node => ({ node, depth: 0 }))
  while (pending.length) {
    const { node, depth } = pending.pop()!
    // Mermaid's number token is decimal, while JS switches to exponent notation
    // for small/large finite values. Keep the full quantity in portable source.
    const value = node.value?.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 })
    lines.push(`${'  '.repeat(depth)}${quoted(node.label)}${value === undefined ? '' : `: ${value}`}${node.className ? `:::${node.className}` : ''}`)
    for (const child of [...(children.get(node.id) ?? [])].reverse()) pending.push({ node: child, depth: depth + 1 })
  }
  for (const [name, props] of Object.entries(body.classDefs))
    lines.push(
      `classDef ${name} ${Object.entries(props)
        .map(([key, value]) => `${key}:${value}`)
        .join(',')};`,
    )
  return lines.join('\n') + '\n'
}

export function mutateTreemap(body: TreemapBody, op: TreemapMutationOp): Result<TreemapBody, MutationError> {
  try {
    const next = structuredClone(body)
    const find = (id: string) => {
      const node = next.nodes.find(node => node.id === id)
      if (!node) throw new Error(`Treemap node ${id} was not found`)
      return node
    }
    switch (op.kind) {
      case 'set_title':
        next.title = op.title ?? undefined
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title ?? undefined
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description ?? undefined
        break
      case 'add_node': {
        if (op.parentId && find(op.parentId).value !== undefined) throw new Error('A leaf cannot contain children')
        let n = 0
        while (next.nodes.some(node => node.id === `treemap-${n}`)) n++
        next.nodes.push({ id: `treemap-${n}`, label: op.label, ...(op.parentId ? { parentId: op.parentId } : {}), ...(op.value === undefined ? {} : { value: op.value }), ...(op.className ? { className: op.className } : {}) })
        break
      }
      case 'remove_node': {
        find(op.id)
        const ids = hierarchyDescendants(next.nodes, op.id)
        next.nodes = next.nodes.filter(node => !ids.has(node.id))
        break
      }
      case 'set_label':
        find(op.id).label = op.label
        break
      case 'set_value': {
        if (next.nodes.some(node => node.parentId === op.id)) throw new Error('A section containing children cannot become a leaf')
        find(op.id).value = op.value
        break
      }
      case 'move_node': {
        const node = find(op.id)
        if (op.parentId) {
          if (find(op.parentId).value !== undefined) throw new Error('A leaf cannot contain children')
          if (hierarchyDescendants(next.nodes, op.id).has(op.parentId)) throw new Error('A node cannot move inside its own subtree')
        }
        node.parentId = op.parentId
        const siblings = next.nodes.filter(other => other.parentId === op.parentId && other.id !== node.id)
        const index = op.index ?? siblings.length
        if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw new Error('Invalid destination index')
        next.nodes = next.nodes.filter(other => other.id !== node.id)
        const before = siblings[index]
        next.nodes.splice(before ? next.nodes.findIndex(other => other.id === before.id) : next.nodes.length, 0, node)
        break
      }
      case 'define_class':
        if (!/^[A-Za-z_]\w*$/.test(op.name) || /[\r\n]/.test(op.style)) throw new Error('Class name and style must be valid single-line Mermaid')
        next.classDefs[op.name] = checkedAuthoredStyle(parseStyleProps(op.style), `classDef ${op.name}`)
        break
      case 'set_node_class':
        find(op.id).className = op.className ?? undefined
        break
      default:
        throw new Error(formatUnknownOpMessage('treemap', op, TREEMAP_OP_KINDS.join(', ')))
    }
    for (const node of next.nodes) {
      if (typeof node.label !== 'string' || !node.label.trim()) throw new Error('Treemap labels must be nonempty text')
      if (node.value !== undefined && (!Number.isFinite(node.value) || node.value < 0)) throw new Error('Treemap values must be finite and nonnegative')
      if (node.className !== undefined && !/^[A-Za-z_]\w*$/.test(node.className)) throw new Error('Invalid Treemap class name')
    }
    renderTreemap(next)
    return ok(next)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

export function verifyTreemap(body: TreemapBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (!body.nodes.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const overflow = labelOverflowCollector(warnings, opts)
  for (const node of body.nodes) overflow(node.id, node.label)
  return warnings
}

const string = { type: 'string', required: true } as const
const optionalString = { type: 'string', required: false } as const
const nullable = { type: 'string-or-null', required: true } as const
export const TREEMAP_OP_SCHEMAS = {
  set_title: { fields: { title: nullable } },
  add_node: { fields: { label: string, value: { type: 'number', required: false }, parentId: optionalString, className: optionalString } },
  remove_node: { fields: { id: string } },
  set_label: { fields: { id: string, label: string } },
  set_value: { fields: { id: string, value: { type: 'number', required: true } } },
  move_node: { fields: { id: string, parentId: optionalString, index: { type: 'number', required: false } } },
  define_class: { fields: { name: string, style: string } },
  set_node_class: { fields: { id: string, className: nullable } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const TREEMAP_OP_KINDS = Object.keys(TREEMAP_OP_SCHEMAS)
