import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { HAS_FORMAT_TAGS } from '../shared/inline-format.ts'
import type { MindmapDiagram, MindmapNode, MindmapShape } from './types.ts'
import {
  parseAccessibilityDirective,
  scanAccessibilityDirectives,
} from '../shared/accessibility-directives.ts'

export class MindmapParseError extends Error {
  constructor(message: string, readonly line?: number) { super(message); this.name = 'MindmapParseError' }
}

export class MindmapDuplicateIdError extends MindmapParseError {
  readonly code = 'MINDMAP_DUPLICATE_ID'
  constructor(readonly id: string, line: number) { super(`Duplicate mindmap node identity '${id}' on line ${line}; every node identity must be unique.`, line) }
}

interface ParsedNode { id: string; label: string; shape: MindmapShape; markdown?: true }

/** Parse the indentation-sensitive source from the untrimmed normalized body. */
export function parseMindmap(source: string): MindmapDiagram {
  const sourceLines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  // Accessibility directives use the ordinary inline-comment rule. Shaped
  // node labels have their own lexer state, where %% remains literal text.
  const accessibilityLines = sourceLines.map(line =>
    parseAccessibilityDirective([line], 0)?.form === 'inline' ? stripInlineComment(line, false) : line)
  const scanned = scanAccessibilityDirectives(accessibilityLines)
  if (scanned.unclosedIndex !== undefined) {
    throw new MindmapParseError('Unclosed accDescr block', scanned.unclosedIndex + 1)
  }
  const rawLines = scanned.familyLines
  const headerIndex = rawLines.findIndex(line => /^\s*mindmap\s*$/i.test(line))
  if (headerIndex < 0) throw new MindmapParseError('Mindmap source must start with the mindmap header')
  if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'header', rawLines[headerIndex]!, { line: headerIndex + 1, unit: 'normalized' })
  const stack: Array<{ indent: number; node: MindmapNode }> = []
  const ids = new Set<string>()
  let root: MindmapNode | undefined
  let lastNode: MindmapNode | undefined
  const accessibilityTitle = scanned.accessibility.title !== undefined
    ? normalizeBrTags(scanned.accessibility.title)
    : undefined
  const accessibilityDescription = scanned.accessibility.descr !== undefined
    ? normalizeBrTags(scanned.accessibility.descr)
    : undefined

  if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'initialize', { accessibilityTitle, accessibilityDescription })

  for (let index = headerIndex + 1; index < rawLines.length; index++) {
    const startLine = index + 1
    let raw = rawLines[index]!
    if (raw.includes('["`') && !raw.includes('`"]')) {
      const parts = [raw]
      let closed = false
      while (++index < rawLines.length) {
        parts.push(rawLines[index]!)
        if (rawLines[index]!.includes('`"]')) { closed = true; break }
      }
      if (!closed) throw new MindmapParseError('Unclosed mindmap Markdown String', index + 1)
      raw = parts.join('\n')
    }
    raw = stripInlineComment(raw)
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('%%')) continue
    if (/^acc(?:Title|Descr)\b/i.test(trimmed)) {
      const kind = /^accTitle\b/i.test(trimmed) ? 'accTitle' : 'accDescr'
      throw new MindmapParseError(`Mindmap ${kind} must contain a non-empty value`, index + 1)
    }
    if (/^::icon\b/i.test(trimmed)) {
      if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'icon', trimmed, { line: startLine, unit: 'normalized' })
      const icon = trimmed.match(/^::icon\(([^)]*)\)$/i)
      const value = icon?.[1]?.trim()
      if (!icon || !value) throw new MindmapParseError('Mindmap icon decoration must contain a non-empty value without closing parentheses', index + 1)
      if (!lastNode) throw new MindmapParseError('Mindmap icon decoration requires a preceding node', index + 1)
      lastNode.icon = value
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setIcon', { id: lastNode.id, icon: value }, { line: startLine, unit: 'normalized' })
      continue
    }
    if (trimmed.startsWith(':::')) {
      if (parserObservationActive('mindmap')) observeParserStatement('mindmap', 'class', trimmed, { line: startLine, unit: 'normalized' })
      const className = trimmed.match(/^:::\s*(.+)$/)
      if (!className) throw new MindmapParseError('Mindmap class decoration must contain at least one class name', index + 1)
      if (!lastNode) throw new MindmapParseError('Mindmap class decoration requires a preceding node', index + 1)
      lastNode.className = className[1]!.trim().replace(/\s+/g, ' ')
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setClass', { id: lastNode.id, className: lastNode.className }, { line: startLine, unit: 'normalized' })
      continue
    }

    const parsed = parseNode(trimmed)
    if (parserObservationActive('mindmap')) observeParserStatement('mindmap', parsed ? 'node' : 'invalid', trimmed, { line: startLine, unit: 'normalized' })
    if (!parsed || (parsed.shape === 'default' && looksLikeMalformedShape(trimmed))) {
      throw new MindmapParseError(`Invalid mindmap node syntax on line ${index + 1}: ${trimmed}`, index + 1)
    }
    if (ids.has(parsed.id)) throw new MindmapDuplicateIdError(parsed.id, index + 1)
    ids.add(parsed.id)
    const node: MindmapNode = { ...parsed, children: [] }
    if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'createNode', node, { line: startLine, unit: 'normalized' })
    const indent = indentation(raw)
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop()
    if (stack.length === 0) {
      if (root) throw new MindmapParseError(`There can be only one mindmap root; '${node.label}' has no parent on line ${index + 1}.`, index + 1)
      root = node
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'setRoot', { id: node.id }, { line: startLine, unit: 'normalized' })
    } else {
      stack[stack.length - 1]!.node.children.push(node)
      if (parserObservationActive('mindmap')) observeParserMutation('mindmap', 'attachChild', { id: node.id, parentId: stack[stack.length - 1]!.node.id }, { line: startLine, unit: 'normalized' })
    }
    stack.push({ indent, node })
    lastNode = node
  }
  if (!root) throw new MindmapParseError('Mindmap requires exactly one root node')
  return { root, ...(accessibilityTitle ? { accessibilityTitle } : {}), ...(accessibilityDescription ? { accessibilityDescription } : {}) }
}

interface NodeFrame { id: string; label: string; shape: MindmapShape; end: number }

/** Read the first shape boundary in the same states as Mindmap's lexer:
 * nested opening brackets are ordinary label text, closing tokens end it,
 * and a quote at the beginning of the description protects delimiters.
 */
function readNodeFrame(source: string): NodeFrame | null {
  const opening = source.match(/^([^()[{}]*?)(\(\(|\{\{|\[|\)\)|\)|\()/)
  if (!opening) return null
  const opener = opening[2]!
  const begin = opening[0].length
  let end = begin
  if (source.startsWith('"`', begin)) {
    const closing = source.indexOf('`"', begin + 2)
    if (closing < 0) return null
    end = closing + 2
  } else if (source[begin] === '"') {
    end = begin + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end++] === '"') break
    }
    if (source[end - 1] !== '"') return null
  } else {
    while (end < source.length && !/[)\](}]/.test(source[end]!)) end++
  }
  const label = source.slice(begin, end)
  while (/\s/.test(source[end] ?? '') && end < source.length) end++
  const closer = ['))', '}}', '((', '(-', '-)', ')', ']', '('].find(token => source.startsWith(token, end))
  if (!closer) return null
  const shape: MindmapShape = opener === '[' ? 'rect' : opener === '{{' ? 'hexagon'
    : opener === '((' ? 'circle' : opener === '))' ? 'bang'
    : opener === ')' || closer !== ')' ? 'cloud' : 'rounded'
  return { id: opening[1]!.trim(), label, shape, end: end + closer.length }
}

function stripInlineComment(line: string, shapedLabel = true): string {
  if (line.trimStart().startsWith(':::')) return line
  const inlineDirective = parseAccessibilityDirective([line], 0)?.form === 'inline'
  const trimmed = line.trimStart()
  const frame = shapedLabel && !trimmed.startsWith('::') ? readNodeFrame(trimmed) : null
  if (frame) {
    const comment = line.indexOf('%%', line.length - trimmed.length + frame.end)
    return comment < 0 ? line : line.slice(0, comment)
  }
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted || char !== '%' || line[index + 1] !== '%') continue
    const prefix = line.slice(0, index).trim()
    // Bare-node, shape, icon and class payloads consume %% as text. Once a
    // shape or icon closes, the lexer can start a trailing comment again.
    if (!prefix || inlineDirective || /^::icon\([^)]*\)$/.test(prefix)) return line.slice(0, index)
    const node = parseNode(prefix)
    if (node && node.shape !== 'default') return line.slice(0, index)
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
  const frame = readNodeFrame(source)
  if (frame && !source.slice(frame.end).trim()) {
    const cleaned = cleanLabel(frame.label)
    const id = frame.id || plainLabel(cleaned.label)
    return id && cleaned.label ? { id, label: cleaned.label, shape: frame.shape, ...(cleaned.markdown ? { markdown: true } : {}) } : null
  }
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
    const cleaned = cleanLabel(match[2]!)
    const explicit = match[1]!.trim()
    const id = explicit || plainLabel(cleaned.label)
    if (!id || !cleaned.label) return null
    return { id, label: cleaned.label, shape, ...(cleaned.markdown ? { markdown: true } : {}) }
  }
  const cleaned = cleanLabel(source)
  const id = plainLabel(cleaned.label)
  return id ? { id, label: cleaned.label, shape: 'default', ...(cleaned.markdown ? { markdown: true } : {}) } : null
}

function cleanLabel(value: string): { label: string; markdown: boolean } {
  let label = value.trim()
  const markdown = label.startsWith('"`') && label.endsWith('`"')
  if (markdown) label = markdownToInlineTags(label.slice(2, -2))
  else {
    if (label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1)
    label = label.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  }
  return { label: normalizeBrTags(label).trim(), markdown }
}

function markdownToInlineTags(value: string): string {
  return value
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/\*([\s\S]+?)\*/g, '<i>$1</i>')
}

function inlineTagsToMarkdown(value: string): string {
  return value
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
}

function plainLabel(value: string): string {
  return value.replace(/<\/?(?:b|i)>/gi, '').trim()
}

function looksLikeMalformedShape(value: string): boolean {
  return /^[^\s[\](){}]+\s*(?:\[|\(\(?|\{\{|\)\))/.test(value)
}

export function serializeMindmap(diagram: MindmapDiagram): string {
  const lines = ['mindmap']
  if (diagram.accessibilityTitle) lines.push(`  accTitle: ${diagram.accessibilityTitle}`)
  if (diagram.accessibilityDescription) {
    if (diagram.accessibilityDescription.includes('\n')) {
      lines.push('  accDescr {')
      for (const line of diagram.accessibilityDescription.split(/\r?\n/)) lines.push(`    ${line.trim()}`)
      lines.push('  }')
    } else {
      lines.push(`  accDescr: ${diagram.accessibilityDescription}`)
    }
  }
  const visit = (node: MindmapNode, depth: number): void => {
    const indent = '  '.repeat(depth + 1)
    let label = node.markdown || HAS_FORMAT_TAGS.test(node.label)
      ? `"\`${inlineTagsToMarkdown(node.label)}\`"`
      : node.label.replace(/\n/g, '<br/>')
    // A shaped node's closing delimiter is syntax outside a quoted label.
    // Keep nested delimiters as text rather than ending the node early.
    if (node.shape !== 'default' && !label.startsWith('"`') && /[()\]}]/.test(label)) label = `"${label}"`
    // Anonymous shapes derive their logical ID from the description. An ID
    // containing delimiters or line breaks cannot be a nodeWithId prefix.
    const id = node.id === plainLabel(node.label) && /[()[\]{}\r\n]/.test(node.id) ? '' : node.id
    const text = node.shape === 'default' ? label
      : node.shape === 'rect' ? `${id}[${label}]`
      : node.shape === 'rounded' ? `${id}(${label})`
      : node.shape === 'circle' ? `${id}((${label}))`
      : node.shape === 'hexagon' ? `${id}{{${label}}}`
      : node.shape === 'cloud' ? `${id})${label}(`
      : `${id}))${label}((`
    lines.push(indent + text)
    if (node.icon) lines.push(`${indent}  ::icon(${node.icon})`)
    if (node.className) lines.push(`${indent}  :::${node.className}`)
    for (const child of node.children) visit(child, depth + 1)
  }
  visit(diagram.root, 0)
  return lines.join('\n') + '\n'
}
