export { TREEMAP_OP_SCHEMAS, TREEMAP_OP_KINDS } from '../treemap/ops.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { TreemapBody, TreemapMutationOp } from '../treemap/types.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { accessibilityDescriptionText, accessibilityTitleText, appendAccessibilityLines } from './accessibility-envelope.ts'
import { hierarchyDescendants, validateHierarchy } from '../shared/hierarchy-model.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import { writeGrammarText } from '../shared/grammar-text.ts'

export function parseTreemapBody(lines: string[]): TreemapBody | null {
  try {
    const body = parseTreemapDiagram(['treemap', ...lines])
    renderTreemap(body)
    return body
  } catch {
    return null
  }
}

function quoted(value: string): string {
  return `"${treemapText(value, '"%')}"`
}

function treemapText(value: string, reserved: string): string {
  // Newlines are text, as are authored <br/> and entity-looking strings.
  // Escape after the hash layer, then read once after token classification.
  return writeGrammarText(value, reserved).replace(/\r/g, '#13;').replace(/\n/g, '#10;')
}

export function renderTreemap(body: TreemapBody): string {
  validateHierarchy(body.nodes)
  const lines = ['treemap']
  appendAccessibilityLines(lines, {
    ...(body.accessibilityTitle !== undefined ? { accessibilityTitle: writeGrammarText(body.accessibilityTitle, ':;,%{}') } : {}),
    ...(body.accessibilityDescription !== undefined ? { accessibilityDescription: writeGrammarText(body.accessibilityDescription, ':;,%{}') } : {}),
  })
  if (body.title !== undefined) lines.push(`title ${treemapText(body.title, '%')}`)
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
  for (const [name, props] of Object.entries(body.classDefs)) {
    // The pinned CLASS_DEF token requires at least two name characters;
    // references use the separate, single-character-capable ID2 token.
    if (!/^[A-Za-z_]\w+$/.test(name)) throw new Error('Treemap class definitions require at least two identifier characters')
    lines.push(
      `classDef ${name} ${Object.entries(props)
        .map(([key, value]) => `${key}:${value}`)
        .join(',')};`,
    )
  }
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
        next.accessibilityTitle = op.title == null ? undefined : accessibilityTitleText(op.title)
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description == null ? undefined : accessibilityDescriptionText(op.description)
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
        {
          const props = checkedAuthoredStyle(parseStyleProps(op.style), `classDef ${op.name}`)
          // Mermaid's CLASS_DEF token ends the style text at `;`, and the
          // writer joins declarations with `,`: a declaration holding either
          // has no spelling.
          const written = Object.entries(props).map(([key, value]) => `${key}:${value}`).join(',')
          if (/;/.test(written) || JSON.stringify(parseStyleProps(written)) !== JSON.stringify(props)) throw new Error(`Treemap classDef ${op.name} style ${JSON.stringify(op.style)} has no Mermaid spelling: a declaration holds \`;\` or \`,\``)
          next.classDefs[op.name] = props
        }
        break
      case 'set_node_class':
        find(op.id).className = op.className ?? undefined
        break
      default:
        throw new Error(unknownOpMessage('treemap', op))
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
