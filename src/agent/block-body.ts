export { BLOCK_OP_SCHEMAS, BLOCK_OP_KINDS } from '../block/ops.ts'
import { appendNativeAccessibilityLines, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import type { Block, BlockBody, BlockInput, BlockMutationOp } from '../block/types.ts'
import type { Accessibility, LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { parseMutableStyleProps, serializeStyleProps } from '../shared/style-props.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { writeBlockText } from '../block/text-codec.ts'

export function parseBlockBody(lines: string[], accessibility: Accessibility = {}): BlockBody | null {
  const scanned = scanAccessibilityDirectives(lines)
  accessibility = readAuthoredGrammarAccessibility({ ...scanned.accessibility, ...accessibility })
  try {
    const body = parseBlockDiagram(['block', ...scanned.familyLines])
    // Validate structural syntax before comment retention invokes the writer.
    renderBlock(body)
    body.accessibilityTitle = accessibility.title
    body.accessibilityDescription = accessibility.descr
    return body
  } catch {
    return null
  }
}
export function blockEntries(body: BlockBody): { node: Block; parent: Block; parentId?: string }[] {
  const out: { node: Block; parent: Block; parentId?: string }[] = []
  const stack = (body.root.children ?? []).map(node => ({ node, parent: body.root, parentId: undefined as string | undefined })).reverse()
  while (stack.length) {
    const entry = stack.pop()!
    out.push(entry)
    for (let i = (entry.node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: entry.node.children![i]!, parent: entry.node, parentId: entry.node.id })
  }
  return out
}
function hasDirectiveLabel(body: BlockBody): boolean {
  return blockEntries(body).some(({ node }) => node.label?.includes('%%{')) || body.edges.some(edge => edge.label?.includes('%%{'))
}
const DELIMITERS: Record<string, [string, string]> = {
  na: ['[', ']'],
  square: ['[', ']'],
  round: ['(', ')'],
  circle: ['((', '))'],
  rect_left_inv_arrow: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  doublecircle: ['(((', ')))'],
  lean_right: ['[/', '/]'],
  lean_left: ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  inv_trapezoid: ['[\\', '/]'],
}
function id(value: string): string {
  // A closing square bracket is ordinary ID text outside a node's label.
  // `space` followed by punctuation instead starts a spacer token.
  if (!value || /[\s()[{}<>:=\-]/.test(value) || value === 'end' || value === 'block' || /^space\b/.test(value) || value === 'columns') throw new Error(`Invalid block id ${value}`)
  return value
}
function quote(value: string): string {
  if (typeof value !== 'string' || value.includes('\u0000')) throw new Error('Block labels must be text without NUL')
  return `"${writeBlockText(value)}"`
}
function declaration(node: Block): string {
  const name = id(node.id),
    label = quote(node.label ?? node.id)
  if (node.type === 'block_arrow') return `${name}<[${label}]>(${(node.directions ?? ['right']).join(',')})`
  const pair = DELIMITERS[node.type ?? 'na']
  if (!pair) throw new Error(`Unknown block shape ${node.type}`)
  return `${name}${pair[0]}${label}${pair[1]}`
}
export function renderBlock(body: BlockBody): string {
  const lines = ['block']
  appendNativeAccessibilityLines(lines, body)
  const stack: { node: Block; depth: number; close?: boolean }[] = [{ node: body.root, depth: 0 }]
  while (stack.length) {
    const { node, depth, close } = stack.pop()!,
      pad = '  '.repeat(depth)
    if (close) {
      lines.push(`${pad}end`)
      continue
    }
    if (node === body.root || node.type === 'composite') {
      if (node !== body.root) lines.push(`${pad}block:${id(node.id)}${node.label ? `[${quote(node.label)}]` : ''}${node.widthInColumns && node.widthInColumns !== 1 ? `:${node.widthInColumns}` : ''}`)
      const inner = node === body.root ? depth + 1 : depth + 1
      if (node.columns !== undefined) lines.push(`${'  '.repeat(inner)}columns ${node.columns < 0 ? 'auto' : node.columns}`)
      if (node !== body.root) stack.push({ node, depth, close: true })
      for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: node.children![i]!, depth: inner })
    } else if (node.type === 'space') lines.push(`${pad}space${node.width && node.width !== 1 ? `:${node.width}` : ''}`)
    else lines.push(`${pad}${declaration(node)}${node.widthInColumns && node.widthInColumns !== 1 ? `:${node.widthInColumns}` : ''}`)
  }
  for (const edge of body.edges) {
    const start = edge.arrowTypeStart === 'arrow_point' ? '<' : edge.arrowTypeStart === 'arrow_circle' ? 'o' : edge.arrowTypeStart === 'arrow_cross' ? 'x' : ''
    const end = edge.arrowTypeEnd === 'arrow_point' ? '>' : edge.arrowTypeEnd === 'arrow_circle' ? 'o' : edge.arrowTypeEnd === 'arrow_cross' ? 'x' : ''
    const base = edge.thickness === 'thick' ? '===' : edge.pattern === 'dotted' ? '-.-' : '---'
    const link = `${start}${base}${end}`
    lines.push(`  ${id(edge.start!)} ${edge.label ? `${start}${base.slice(0, 2)} ${quote(edge.label)} ${base}${end}` : link} ${id(edge.end!)}`)
  }
  for (const def of body.classDefs) if (def.styles.length) lines.push(`  classDef ${def.id} ${def.styles.join(',')}`)
  for (const { node } of blockEntries(body)) {
    if (node.type === 'space') continue
    for (const className of node.classes ?? []) lines.push(`  class ${id(node.id)} ${className}`)
    if (node.styles?.length) lines.push(`  style ${id(node.id)} ${node.styles.join(',')}`)
  }
  return lines.join('\n') + '\n'
}
function checkedBlock(input: BlockInput, depth = 0): Block {
  if (!input || typeof input !== 'object' || depth > 64) throw new Error('Block input must be a bounded object')
  id(input.id)
  if (input.label !== undefined) quote(input.label)
  if (input.type !== undefined && input.type !== 'composite' && input.type !== 'space' && input.type !== 'block_arrow' && !(input.type in DELIMITERS)) throw new Error('Invalid block shape')
  if (input.widthInColumns !== undefined && (!Number.isInteger(input.widthInColumns) || input.widthInColumns < 1 || input.widthInColumns > 1000)) throw new Error('Block span must be 1..1000')
  if (input.columns !== undefined && (!Number.isInteger(input.columns) || input.columns === 0 || input.columns < -1 || input.columns > 1000)) throw new Error('Columns must be -1 (auto) or 1..1000')
  if (input.directions?.some(d => !['right', 'left', 'up', 'down', 'x', 'y'].includes(d))) throw new Error('Invalid block arrow direction')
  if (input.children && (!Array.isArray(input.children) || input.children.length > 10000)) throw new Error('Block children exceed work limit')
  const children = (input.children ?? []).map(child => checkedBlock(child, depth + 1))
  if (input.type === 'composite' && !children.length) throw new Error('A composite needs at least one child in pinned Mermaid; supply children with add_block')
  if (input.type !== 'composite' && children.length) throw new Error('Only composite blocks can contain children')
  if (input.width !== undefined && (!Number.isInteger(input.width) || input.width < 1 || input.width > 10000)) throw new Error('Space width must be 1..10000')
  return { type: 'square', label: input.id, widthInColumns: 1, ...input, children }
}
export function mutateBlock(body: BlockBody, op: BlockMutationOp): Result<BlockBody, MutationError> {
  const next = structuredClone(body),
    entries = blockEntries(next),
    byId = new Map(entries.map(e => [e.node.id, e]))
  const find = (name: string) => {
    const entry = byId.get(name)
    if (!entry) throw new Error(`Block ${name} not found`)
    return entry
  }
  const parent = (name?: string) => {
    if (name === undefined) return next.root
    const node = find(name).node
    if (node.type !== 'composite') throw new Error('Parent must be a composite block')
    return node
  }
  const insert = (node: Block, owner: Block, index?: number) => {
    const children = (owner.children ??= [])
    const at = index ?? children.length
    if (!Number.isInteger(at) || at < 0 || at > children.length) throw new Error('Invalid block index')
    children.splice(at, 0, node)
  }
  try {
    switch (op.kind) {
      case 'set_columns':
        checkedBlock({ id: 'validate', columns: op.columns })
        parent(op.parentId).columns = op.columns
        break
      case 'add_block': {
        const node = checkedBlock(op.block)
        if (byId.has(node.id)) throw new Error('Block id already exists')
        insert(node, parent(op.parentId), op.index)
        break
      }
      case 'update_block': {
        const node = find(op.id).node
        const changes = checkedBlock({ ...node, ...op.changes })
        Object.assign(node, changes)
        break
      }
      case 'rename_block': {
        id(op.to)
        const node = find(op.from).node
        if (op.to !== op.from && byId.has(op.to)) throw new Error('Block id already exists')
        node.id = op.to
        for (const edge of next.edges) {
          if (edge.start === op.from) edge.start = op.to
          if (edge.end === op.from) edge.end = op.to
        }
        break
      }
      case 'remove_block': {
        const entry = find(op.id),
          ids = new Set([op.id])
        for (const e of entries) if (e.parentId && ids.has(e.parentId)) ids.add(e.node.id)
        if (!op.cascade && (ids.size > 1 || next.edges.some(e => ids.has(e.start!) || ids.has(e.end!)))) throw new Error('Block has children or edges; pass cascade: true')
        entry.parent.children = entry.parent.children!.filter(n => n !== entry.node)
        next.edges = next.edges.filter(e => !ids.has(e.start!) && !ids.has(e.end!))
        break
      }
      case 'move_block': {
        const entry = find(op.id),
          destination = parent(op.parentId)
        let at = op.parentId
        while (at !== undefined) {
          if (at === op.id) throw new Error('Cannot move a block into its descendant')
          at = find(at).parentId
        }
        entry.parent.children = entry.parent.children!.filter(n => n !== entry.node)
        insert(entry.node, destination, op.index)
        break
      }
      case 'add_edge': {
        find(op.from)
        find(op.to)
        if (op.label !== undefined) quote(op.label)
        let i = 1
        while (next.edges.some(e => e.id === `edge-${i}`)) i++
        next.edges.push({ id: `edge-${i}`, type: 'edge', start: op.from, end: op.to, label: op.label ?? '', thickness: op.style === 'thick' ? 'thick' : 'normal', pattern: op.style === 'dotted' ? 'dotted' : 'solid', arrowTypeStart: op.arrowStart ?? 'arrow_open', arrowTypeEnd: op.arrowEnd ?? 'arrow_point' })
        break
      }
      case 'remove_edge':
        if (!next.edges.some(e => e.id === op.id)) throw new Error('Edge not found')
        next.edges = next.edges.filter(e => e.id !== op.id)
        break
      case 'define_class': {
        if (!/^\w+$/.test(op.name)) throw new Error('Invalid class name')
        const parsed = parseMutableStyleProps(op.style)
        if (!parsed.ok) throw new Error(`Invalid style: ${parsed.reason}`)
        const styles = serializeStyleProps(parsed.value).split(',')
        const def = next.classDefs.find(d => d.id === op.name)
        if (def) def.styles = styles
        else next.classDefs.push({ id: op.name, styles, textStyles: [] })
        break
      }
      case 'set_node_class':
        if (op.className !== null && !/^\w+$/.test(op.className)) throw new Error('Invalid class name')
        find(op.id).node.classes = op.className === null ? [] : [op.className]
        break
      case 'set_node_style': {
        const node = find(op.id).node
        if (op.style === null) node.styles = []
        else {
          const parsed = parseMutableStyleProps(op.style)
          if (!parsed.ok) throw new Error(`Invalid style: ${parsed.reason}`)
          node.styles = serializeStyleProps(parsed.value).split(',')
        }
        break
      }
      default:
        throw new Error(unknownOpMessage('block', op))
    }
    const identities = new Set<string>()
    for (const { node } of blockEntries(next)) {
      if (identities.has(node.id)) throw new Error(`Duplicate block id ${node.id}`)
      identities.add(node.id)
    }
    const reparsed = parseBlockDiagram(renderBlock(next))
    reparsed.edges.forEach((edge, i) => {
      edge.id = next.edges[i]!.id
    })
    reparsed.accessibilityTitle = next.accessibilityTitle
    reparsed.accessibilityDescription = next.accessibilityDescription
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}
export function verifyBlock(body: BlockBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = [],
    overflow = labelOverflowCollector(warnings, opts)
  const entries = blockEntries(body),
    ids = new Set(entries.map(e => e.node.id))
  if (!entries.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  for (const { node } of entries) if (node.type !== 'space' && node.label) overflow(node.id, node.label)
  for (const edge of body.edges) if (!ids.has(edge.start!) || !ids.has(edge.end!)) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'undeclared endpoint', message: `Block edge ${edge.id} references an undeclared endpoint` })
  return warnings
}
export function blockUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  if (!/acc(?:Title|Descr)|%%\{/i.test(source)) return []
  const normalized = normalizeMermaidSource(source)
  const warnings: LayoutWarning[] = []
  if (normalized.accessibility.title !== undefined || normalized.accessibility.descr !== undefined) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'block_accessibility', message: 'Block accessibility metadata is carried in native comments on export. External Mermaid ignores this metadata; diagram topology is preserved.' })
  try {
    if (source.includes('%%{') && hasDirectiveLabel(parseBlockDiagram(normalized.familyLines))) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'block_directive_text', message: 'Block labels containing a directive opener are read literally. The writer protects their quoted payloads with entity codes for pinned Mermaid.' })
  } catch { /* Native syntax failures are diagnosed by the render path. */ }
  return warnings
}
