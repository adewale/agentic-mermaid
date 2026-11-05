export { TREEVIEW_OP_KINDS, TREEVIEW_OP_SCHEMAS } from '../treeview/ops.ts'

import { writeGrammarText } from '../shared/grammar-text.ts'
import { hierarchyChildren, hierarchyDescendants, validateHierarchy } from '../shared/hierarchy-model.ts'
import { parseTreeviewDiagram } from '../treeview/parser.ts'
import type { TreeviewBody, TreeviewMutationOp } from '../treeview/types.ts'
import { accessibilityDescriptionText, accessibilityTitleText, appendAccessibilityLines } from './accessibility-envelope.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

const text = (value: string, reserved = '') =>
  writeGrammarText(value, reserved + '%')
    .replace(/\r/g, '#13;')
    .replace(/\n/g, '#10;')
export function parseTreeviewBody(lines: string[]): TreeviewBody | null {
  try {
    return parseTreeviewDiagram(['treeView-beta', ...lines])
  } catch {
    return null
  }
}
export function renderTreeview(body: TreeviewBody): string {
  validateHierarchy(body.nodes)
  const lines = ['treeView-beta']
  appendAccessibilityLines(lines, {
    ...(body.accessibilityTitle !== undefined ? { accessibilityTitle: writeGrammarText(body.accessibilityTitle, ':;,%{}') } : {}),
    ...(body.accessibilityDescription !== undefined ? { accessibilityDescription: writeGrammarText(body.accessibilityDescription, ':;,%{}') } : {}),
  })
  if (body.title !== undefined) lines.push(`title ${text(body.title)}`)
  const children = hierarchyChildren(body.nodes)
  const pending = [...(children.get(undefined) ?? [])].reverse().map(node => ({ node, depth: 0 }))
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (typeof node.label !== 'string') throw new Error('TreeView names must be text')
    if (node.nodeType !== 'file' && node.nodeType !== 'directory') throw new Error('TreeView node type must be file or directory')
    if (node.nodeType === 'file' && node.label.endsWith('/')) throw new Error('A TreeView file name cannot end in a directory slash')
    if (node.className !== undefined && !/^[A-Za-z_][\w-]*$/.test(node.className)) throw new Error('Invalid TreeView class name')
    if (node.icon !== undefined && !/^[\w-]*(?::[\w-]+)?$/.test(node.icon)) throw new Error('Invalid TreeView icon reference')
    if (node.description !== undefined && node.description !== node.description.trim()) throw new Error('TreeView descriptions cannot have surrounding whitespace')
    lines.push(`${'    '.repeat(depth)}"${text(node.label + (node.nodeType === 'directory' ? '/' : ''), '"')}"${node.className ? ` :::${node.className}` : ''}${node.icon !== undefined ? ` icon(${node.icon})` : ''}${node.description !== undefined ? ` ## ${text(node.description)}` : ''}`)
    for (const child of [...(children.get(node.id) ?? [])].reverse()) pending.push({ node: child, depth: depth + 1 })
  }
  return lines.join('\n') + '\n'
}
export function mutateTreeview(body: TreeviewBody, op: TreeviewMutationOp): Result<TreeviewBody, MutationError> {
  try {
    const next = structuredClone(body)
    const find = (id: string) => {
      const node = next.nodes.find(node => node.id === id)
      if (!node) throw new Error(`TreeView node ${id} was not found`)
      return node
    }
    switch (op.kind) {
      case 'add_node': {
        if (op.parentId !== undefined) find(op.parentId)
        let index = 0
        while (next.nodes.some(node => node.id === `treeview-${index}`)) index++
        next.nodes.push({ id: `treeview-${index}`, label: op.label, nodeType: op.nodeType ?? 'file', parentId: op.parentId, icon: op.icon, description: op.description, className: op.className })
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
      case 'set_description':
        find(op.id).description = op.description ?? undefined
        break
      case 'set_icon':
        find(op.id).icon = op.icon ?? undefined
        break
      case 'set_class':
        find(op.id).className = op.className ?? undefined
        break
      case 'set_node_type':
        find(op.id).nodeType = op.nodeType
        break
      case 'move_node': {
        const node = find(op.id)
        if (op.parentId !== undefined) find(op.parentId)
        if (op.parentId !== undefined && hierarchyDescendants(next.nodes, op.id).has(op.parentId)) throw new Error('A TreeView node cannot move into its own subtree')
        const siblings = next.nodes.filter(other => other.parentId === op.parentId && other.id !== op.id)
        const index = op.index ?? siblings.length
        if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw new Error('Invalid TreeView destination index')
        node.parentId = op.parentId
        next.nodes = next.nodes.filter(other => other.id !== op.id)
        const before = siblings[index]
        next.nodes.splice(before ? next.nodes.findIndex(other => other.id === before.id) : next.nodes.length, 0, node)
        break
      }
      case 'set_title':
        next.title = op.title ?? undefined
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title === null ? undefined : accessibilityTitleText(op.title)
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description === null ? undefined : accessibilityDescriptionText(op.description)
        break
      default:
        throw new Error(unknownOpMessage('treeview', op))
    }
    renderTreeview(next)
    return ok(next)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}
export function verifyTreeview(body: TreeviewBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  if (!body.nodes.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  const overflow = labelOverflowCollector(warnings, opts)
  for (const node of body.nodes) {
    overflow(node.id, node.label)
    if (node.description) overflow(`${node.id}:description`, node.description)
  }
  return warnings
}
export function treeviewUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  try {
    parseTreeviewDiagram(source)
    return source
      .split(/\r?\n/)
      .flatMap((line, index) => (/^(?:\s*)treeView-beta\s+%%/.test(line) ? [{ code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'treeview_header_comment', line: index + 1, message: 'TreeView header comments are read as comments. Canonical export puts the pinned Mermaid header on its own line.' }] : []))
  } catch {
    return []
  }
}

import { accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import type { FamilyOperations } from './families.ts'
import type { SourceMap } from './types.ts'

export const TREEVIEW_SOURCE_HOOKS: FamilyOperations = {
  parse: ctx => {
    try {
      const body = parseTreeviewDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
      const accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      ctx.meta.accessibility = accessibility
      Object.assign(body, accessibilityFields(accessibility))
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'treeview', source: ctx.opaqueSource })
    }
  },
  serialize: body => {
    if (body.kind !== 'treeview') throw new Error('Expected TreeView body')
    return renderTreeview(body)
  },
  renderSource: () => 'serialized',
  mutate: (body, op) => (body.kind === 'treeview' ? mutateTreeview(body, op as TreeviewMutationOp) : err({ code: 'INVALID_OP', message: 'Expected TreeView body' })),
  verify: (body, options) => (body.kind === 'treeview' ? verifyTreeview(body, options) : []),
  extractLabels: source => {
    try {
      return parseTreeviewDiagram(source).nodes.flatMap(node => [{ text: node.label, target: node.id }, ...(node.description === undefined ? [] : [{ text: node.description, target: `${node.id}:description` }])])
    } catch {
      return []
    }
  },
  buildSourceMap: (body, source) => {
    const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'treeview') return map
    const lines = source.split(/\r?\n/)
    withParserObservation(
      'treeview',
      event => {
        if (event.unit !== 'mutation' || event.kind !== 'add-node' || !event.source?.line) return
        const node = event.value as unknown as TreeviewBody['nodes'][number],
          line = event.source.line
        const raw = lines[line - 1] ?? '',
          col = raw.length - raw.trimStart().length + 1
        map.nodes.set(node.id, { line, col })
        map.labels.set(`node:${node.id}`, { line, col })
        if (node.parentId) map.edges.set(`branch:${node.id}`, { line, col })
      },
      () => parseTreeviewDiagram(source),
    )
    return map
  },
}
