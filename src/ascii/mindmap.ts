import type { MindmapDiagram, MindmapNode } from '../mindmap/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, finishTerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { wrapText } from './wrap.ts'
import { visualWidth } from './width.ts'
import { displayText } from '../multiline-utils.ts'
import { terminalIds } from './identity.ts'

export function renderMindmapAscii(diagram: MindmapDiagram, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number): string {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const authored = (node: MindmapNode): string[] => [node.id, ...node.children.flatMap(authored)]
  const generated = terminalIds(authored(diagram.root))
  const doc = new TerminalDocument()
  const decorate = (node: MindmapNode, label: string): string => {
    const value = (node.icon ? `{${node.icon}} ` : '') + label
    if (node.shape === 'rect') return `[${value}]`
    if (node.shape === 'rounded') return `(${value})`
    if (node.shape === 'circle') return `((${value}))`
    if (node.shape === 'hexagon') return `{{${value}}}`
    if (node.shape === 'cloud') return `)${value}(`
    if (node.shape === 'bang') return `))${value}((`
    return value
  }
  const visit = (node: MindmapNode, prefix: string, last: boolean, root = false, parentId?: string): void => {
    const connector = root ? '' : last ? (config.useAscii ? '`- ' : '└─ ') : (config.useAscii ? '+- ' : '├─ ')
    const branch = prefix + connector
    const icon = node.icon ? `{${node.icon}} ` : ''
    const available = targetWidth === undefined ? undefined : Math.max(1, targetWidth - visualWidth(branch) - visualWidth(icon) - 4)
    const labelLines = wrapText(displayText(node.label), available)
    const element: TerminalOwner = { id: node.id, kind: 'node', parentId }
    const [open, close] = delimiters(node)
    labelLines.forEach((line, index) => doc.line([
      { text: index === 0 ? branch : ' '.repeat(visualWidth(branch)), owner: { id: generated(`edge:${node.id}`), kind: 'edge', from: parentId, to: node.id }, role: 'line', kind: 'stroke' },
      { text: open + icon, owner: element, role: 'arrow', kind: 'marker' },
      { text: line, owner: element, role: 'text', kind: 'text' },
      { text: close, owner: element, role: 'arrow', kind: 'marker' },
    ]))
    const childPrefix = root ? '' : prefix + (last ? '   ' : (config.useAscii ? '|  ' : '│  '))
    node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1, false, node.id))
  }
  if (diagram.root.children.length >= 2) {
    const left: MindmapNode[] = [], right: MindmapNode[] = []
    diagram.root.children.forEach((child, index) => (index % 2 === 1 ? left : right).push(child))
    const root = { id: diagram.root.id, kind: 'node' as const }
    const lines = wrapText(displayText(diagram.root.label), targetWidth === undefined ? undefined : Math.max(1, targetWidth - 8 - visualWidth(decorate(diagram.root, ''))))
    const [open, close] = delimiters(diagram.root)
    lines.forEach(line => doc.line([
      { text: config.useAscii ? '<-- ' : '◀── ', owner: root, role: 'arrow', kind: 'marker' },
      { text: open + (diagram.root.icon ? `{${diagram.root.icon}} ` : ''), owner: root, role: 'arrow', kind: 'marker' },
      { text: line, owner: root, role: 'text', kind: 'text' },
      { text: close, owner: root, role: 'arrow', kind: 'marker' },
      { text: config.useAscii ? ' -->' : ' ──▶', owner: root, role: 'arrow', kind: 'marker' },
    ]))
    left.forEach((child, index) => visit(child, config.useAscii ? 'L ' : '◀ ', index === left.length - 1, false, diagram.root.id))
    right.forEach((child, index) => visit(child, config.useAscii ? 'R ' : '▶ ', index === right.length - 1, false, diagram.root.id))
  } else visit(diagram.root, '', true, true)
  return finishTerminalDocument(config, doc, { colorMode, theme, trimEnd: true })
}

function delimiters(node: MindmapNode): readonly [string, string] {
  if (node.shape === 'rect') return ['[', ']']
  if (node.shape === 'rounded') return ['(', ')']
  if (node.shape === 'circle') return ['((', '))']
  if (node.shape === 'hexagon') return ['{{', '}}']
  if (node.shape === 'cloud') return [')', '(']
  if (node.shape === 'bang') return ['))', '((']
  return ['', '']
}
