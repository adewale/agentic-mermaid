import { accessibilityFields, requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { readAuthoredGrammarAccessibility, readGrammarAuthoredText, readGrammarText } from '../shared/grammar-text.ts'
import { observeParserMutation, observeParserStatement } from '../shared/parser-observation.ts'
import type { TreeviewBody, TreeviewNode } from './types.ts'

export const isTreeviewHeader = (line: string): boolean => /^treeView-beta\s*(?:%%.*)?$/.test(line.trim())
const read = (text: string) => readGrammarText(readGrammarAuthoredText(text), '\r\n')

/** Box-prefix normalization follows Pele's MIT implementation at 3a2f075.
 * Copyright 2026 kepano; see LICENSES/pele-MIT.txt. Labels are never stripped. */
export function treeviewIndentLines(lines: readonly string[]): string[] {
  const hasBox = lines.some(line => /^[\t │┃]*[├└┣┗][─━]/.test(line))
  if (!hasBox) return [...lines]
  const normalized = lines.map(line => line.replace(/\t/g, '    '))
  let segment = 4
  for (const line of normalized) {
    const at = /^[ │┃]*[├└┣┗]/.exec(line)?.[0].length
    if (at !== undefined && at > 1) {
      segment = at - 1
      break
    }
  }
  return normalized.map((line, index) => {
    if (!line.trim() || /^\s*(?:%%|title(?:\s|$)|accTitle\s*:|accDescr\s*[:{])/.test(line) || isTreeviewHeader(line)) return line
    if (/^[ │┃]+$/.test(line)) return ''
    const prefix = /^[ │┃]*[├└┣┗][─━]* */.exec(line)
    if (prefix) {
      const at = prefix[0].search(/[├└┣┗]/)
      const content = line.slice(prefix[0].length)
      if (!content.trim()) throw new Error(`Empty TreeView node at line ${index + 1}`)
      return '    '.repeat(Math.round(at / segment) + 1) + content
    }
    if (/^\s+/.test(line)) throw new Error(`TreeView box format requires a branch prefix at line ${index + 1}`)
    return line
  })
}

export function parseTreeviewDiagram(input: string | readonly string[]): TreeviewBody {
  const original = typeof input === 'string' ? input.split(/\r\n?|\n/) : [...input]
  const scanned = scanAccessibilityDirectives(original)
  requireClosedAccessibility(scanned)
  const lines = treeviewIndentLines(scanned.familyLines)
  const first = lines.findIndex(line => line.trim() && !line.trim().startsWith('%%'))
  if (!isTreeviewHeader(lines[first] ?? '')) throw new Error('TreeView source must start with treeView-beta')
  const body: TreeviewBody = { kind: 'treeview', nodes: [], ...accessibilityFields(readAuthoredGrammarAccessibility(scanned.accessibility)) }
  const stack: { indent: number; node: TreeviewNode }[] = []
  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i]!,
      text = raw.trimStart()
    if (!text.trim() || text.startsWith('%%')) continue
    const title = /^title(?:[\t ](.*)|$)/.exec(text)
    if (title && !body.nodes.length) {
      body.title = read((title[1] ?? '').split('%%')[0]!.trim())
      continue
    }
    observeParserStatement('treeview', 'node', raw, { line: (scanned.familyOrigins[i] ?? i) + 1, unit: 'normalized' })
    const indent = raw.length - text.length
    let label: string, rest: string
    if (text[0] === '"' || text[0] === "'") {
      const quote = text[0],
        end = text.indexOf(quote, 1)
      if (end < 0) throw new Error(`Unclosed TreeView name at line ${i + 1}`)
      label = text.slice(1, end)
      rest = text.slice(end + 1)
    } else {
      if (/^(?::::|icon\(|##)/.test(text)) throw new Error(`Expected TreeView name at line ${i + 1}`)
      const annotation = /[\t ]+(?::::[\t ]*[A-Za-z_]|icon\(|##)/.exec(text)
      label = (annotation ? text.slice(0, annotation.index) : text).trimEnd()
      rest = annotation ? text.slice(annotation.index) : ''
    }
    const node: TreeviewNode = { id: `treeview-${body.nodes.length}`, label: '', nodeType: label.endsWith('/') ? 'directory' : 'file' }
    node.label = read(node.nodeType === 'directory' ? label.slice(0, -1) : label)
    while (rest.trim()) {
      let match: RegExpExecArray | null
      if ((match = /^[\t ]+:::[\t ]*([A-Za-z_][\w-]*)/.exec(rest))) node.className = match[1]
      else if ((match = /^[\t ]+icon\(([\w-]*(?::[\w-]+)?)\)/.exec(rest))) node.icon = match[1] || 'none'
      else if ((match = /^[\t ]+##([^\n\r]*)/.exec(rest))) node.description = read(match[1]!.trim()) || undefined
      else if (/^\s*%%/.test(rest)) break
      else throw new Error(`Invalid TreeView annotation at line ${i + 1}: ${rest.trim()}`)
      rest = rest.slice(match[0].length)
    }
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    node.parentId = stack.at(-1)?.node.id
    assertDiagramWorkLimit('nodes', body.nodes.length + 1)
    assertDiagramWorkLimit('nesting', stack.length + 1)
    body.nodes.push(node)
    stack.push({ indent, node })
    observeParserMutation('treeview', 'add-node', node, { line: (scanned.familyOrigins[i] ?? i) + 1, unit: 'normalized' })
  }
  return body
}
