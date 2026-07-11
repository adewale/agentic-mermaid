import { normalizeBrTags } from '../multiline-utils.ts'
import type { MindmapDiagram, MindmapNode, MindmapShape } from './types.ts'

export class MindmapParseError extends Error {
  constructor(message: string, readonly line?: number) { super(message); this.name = 'MindmapParseError' }
}

export class MindmapDuplicateIdError extends MindmapParseError {
  readonly code = 'MINDMAP_DUPLICATE_ID'
  constructor(readonly id: string, line: number) { super(`Duplicate mindmap node identity '${id}' on line ${line}; every node identity must be unique.`, line) }
}

interface ParsedNode { id: string; label: string; shape: MindmapShape }

/** Parse the indentation-sensitive source from the untrimmed normalized body. */
export function parseMindmap(source: string): MindmapDiagram {
  const rawLines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headerIndex = rawLines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  if (headerIndex < 0) throw new MindmapParseError('Mindmap source must start with the mindmap header')
  const stack: Array<{ indent: number; node: MindmapNode }> = []
  const ids = new Set<string>()
  let root: MindmapNode | undefined
  let lastNode: MindmapNode | undefined
  let accessibilityTitle: string | undefined
  let accessibilityDescription: string | undefined

  for (let index = headerIndex + 1; index < rawLines.length; index++) {
    const raw = stripInlineComment(rawLines[index]!)
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('%%')) continue
    const accTitle = trimmed.match(/^accTitle\s*:\s*(.+)$/i)
    if (accTitle) { accessibilityTitle = normalizeBrTags(accTitle[1]!.trim()); continue }
    const accDescr = trimmed.match(/^accDescr\s*:\s*(.+)$/i)
    if (accDescr) { accessibilityDescription = normalizeBrTags(accDescr[1]!.trim()); continue }
    const accDescrBlock = trimmed.match(/^accDescr\s*\{\s*(.*)$/i)
    if (accDescrBlock) {
      const parts: string[] = []
      let rest = accDescrBlock[1]!
      let closed = false
      while (true) {
        const close = rest.indexOf('}')
        if (close >= 0) { if (rest.slice(0, close).trim()) parts.push(rest.slice(0, close).trim()); closed = true; break }
        if (rest.trim()) parts.push(rest.trim())
        index++
        if (index >= rawLines.length) break
        rest = rawLines[index]!.trim()
      }
      if (!closed) throw new MindmapParseError('Unclosed accDescr block', index + 1)
      accessibilityDescription = normalizeBrTags(parts.join(' ').trim())
      continue
    }
    if (/^::icon\(/.test(trimmed)) {
      const icon = trimmed.match(/^::icon\(([^)]*)\)$/)
      const value = icon?.[1]?.trim()
      if (!icon || !value) throw new MindmapParseError('Mindmap icon decoration must contain a non-empty value without closing parentheses', index + 1)
      if (!lastNode) throw new MindmapParseError('Mindmap icon decoration requires a preceding node', index + 1)
      lastNode.icon = value
      continue
    }
    const className = trimmed.match(/^:::\s*(.+)$/)
    if (className) {
      if (!lastNode) throw new MindmapParseError('Mindmap class decoration requires a preceding node', index + 1)
      lastNode.className = className[1]!.trim().replace(/\s+/g, ' ')
      continue
    }

    const parsed = parseNode(trimmed)
    if (!parsed) throw new MindmapParseError(`Invalid mindmap node syntax on line ${index + 1}: ${trimmed}`, index + 1)
    if (ids.has(parsed.id)) throw new MindmapDuplicateIdError(parsed.id, index + 1)
    ids.add(parsed.id)
    const node: MindmapNode = { ...parsed, children: [] }
    const indent = indentation(raw)
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop()
    if (stack.length === 0) {
      if (root) throw new MindmapParseError(`There can be only one mindmap root; '${node.label}' has no parent on line ${index + 1}.`, index + 1)
      root = node
    } else {
      stack[stack.length - 1]!.node.children.push(node)
    }
    stack.push({ indent, node })
    lastNode = node
  }
  if (!root) throw new MindmapParseError('Mindmap requires exactly one root node')
  return { root, ...(accessibilityTitle ? { accessibilityTitle } : {}), ...(accessibilityDescription ? { accessibilityDescription } : {}) }
}

function stripInlineComment(line: string): string {
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (!quoted && char === '%' && line[index + 1] === '%') return line.slice(0, index)
  }
  return line
}

function indentation(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width++
    else if (char === '\t') width += 4
    else break
  }
  return width
}

function parseNode(source: string): ParsedNode | null {
  const patterns: Array<{ regex: RegExp; shape: MindmapShape }> = [
    { regex: /^(.*?)\(\((.*)\)\)$/, shape: 'circle' },
    { regex: /^(.*?)\{\{(.*)\}\}$/, shape: 'hexagon' },
    { regex: /^(.*?)\[([\s\S]*)\]$/, shape: 'rect' },
    { regex: /^(.*?)\)\)(.*)\(\($/, shape: 'bang' },
    { regex: /^(.*?)\)(.*)\($/, shape: 'cloud' },
    { regex: /^(.*?)\((.*)\)$/, shape: 'rounded' },
  ]
  for (const { regex, shape } of patterns) {
    const match = source.match(regex)
    if (!match) continue
    const label = cleanLabel(match[2]!)
    const explicit = match[1]!.trim()
    const id = explicit || label
    if (!id || !label) return null
    return { id, label, shape }
  }
  const label = cleanLabel(source)
  return label ? { id: label, label, shape: 'default' } : null
}

function cleanLabel(value: string): string {
  let label = value.trim()
  if (label.startsWith('"`') && label.endsWith('`"')) label = label.slice(2, -2)
  else if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1)
  label = label.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  return normalizeBrTags(label).trim()
}

export function serializeMindmap(diagram: MindmapDiagram): string {
  const lines = ['mindmap']
  if (diagram.accessibilityTitle) lines.push(`  accTitle: ${diagram.accessibilityTitle}`)
  if (diagram.accessibilityDescription) lines.push(`  accDescr: ${diagram.accessibilityDescription}`)
  const visit = (node: MindmapNode, depth: number): void => {
    const indent = '  '.repeat(depth + 1)
    const label = node.label.replace(/\n/g, '<br/>')
    const text = node.shape === 'default' ? label
      : node.shape === 'rect' ? `${node.id}[${label}]`
      : node.shape === 'rounded' ? `${node.id}(${label})`
      : node.shape === 'circle' ? `${node.id}((${label}))`
      : node.shape === 'hexagon' ? `${node.id}{{${label}}}`
      : node.shape === 'cloud' ? `${node.id})${label}(`
      : `${node.id}))${label}((`
    lines.push(indent + text)
    if (node.icon) lines.push(`${indent}  ::icon(${node.icon})`)
    if (node.className) lines.push(`${indent}  :::${node.className}`)
    for (const child of node.children) visit(child, depth + 1)
  }
  visit(diagram.root, 0)
  return lines.join('\n') + '\n'
}
