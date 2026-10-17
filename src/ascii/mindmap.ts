import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import type { MindmapDiagram, MindmapNode } from '../mindmap/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { wrapText } from './wrap.ts'
import { visualWidth } from './width.ts'
import { displayText } from '../multiline-utils.ts'
import { terminalIds } from './identity.ts'

export function renderMindmapTerminal(diagram: MindmapDiagram, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number): TerminalArtifact {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const authored = (node: MindmapNode): string[] => [node.id, ...node.children.flatMap(authored)]
  const generated = terminalIds(authored(diagram.root))
  const doc = new TerminalDocument()
  const visit = (node: MindmapNode, prefix: string, last: boolean, root = false, parentId?: string, rails: readonly number[] = [], side?: 'L' | 'R'): void => {
    const connector = root ? '' : last ? (config.useAscii ? '`- ' : '└─ ') : (config.useAscii ? '+- ' : '├─ ')
    const branch = prefix + connector
    const icon = node.icon ? `{${node.icon}} ` : ''
    const available = targetWidth === undefined ? undefined : Math.max(1, targetWidth - visualWidth(branch) - visualWidth(icon) - 4)
    const labelLines = wrapText(displayText(node.label), available)
    const element: TerminalOwner = { id: node.id, kind: 'node', parent: parentId === undefined ? undefined : { id: parentId, kind: 'node' } }
    const [open, close] = delimiters(node)
    const edge: TerminalOwner = { id: generated(`edge:${node.id}`), kind: 'edge', from: parentId, to: node.id }
    const branchWidth = visualWidth(branch), prefixWidth = visualWidth(prefix)
    labelLines.forEach((line, index) => {
      const row = doc.height
      doc.line([
        { text: ' '.repeat(branchWidth), owner: edge, role: 'line', kind: 'surface' },
        { text: open + icon, owner: element, role: 'arrow', kind: 'marker' },
        { text: line, owner: element, role: 'text', kind: 'text', textGroup: 'label' },
        { text: close, owner: element, role: 'arrow', kind: 'marker' },
      ])
      if (index !== 0) return
      const paint = { owner: edge, role: 'line' as const, ascii: config.useAscii }
      for (const column of rails) doc.stroke(column, row, 5, paint)
      if (side) {
        if (config.useAscii) doc.put(0, row, side, { owner: edge, role: 'line', kind: 'marker' })
        else doc.marker(0, row, { shape: 'triangle', direction: side }, paint)
      }
      if (!root) {
        if (config.useAscii && last) doc.put(prefixWidth, row, '`', { owner: edge, role: 'line', kind: 'marker' })
        else doc.stroke(prefixWidth, row, last ? 3 : 7, paint)
        doc.stroke(prefixWidth + 1, row, 10, paint)
      }
    })
    const childPrefix = root ? '' : prefix + '   '
    const childRails = !root && !last ? [...rails, prefixWidth] : rails
    node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1, false, node.id, childRails, side))
  }
  if (diagram.root.children.length >= 2) {
    const left: MindmapNode[] = [], right: MindmapNode[] = []
    diagram.root.children.forEach((child, index) => (index % 2 === 1 ? left : right).push(child))
    const root = { id: diagram.root.id, kind: 'node' as const }
    const [open, close] = delimiters(diagram.root)
    const icon = diagram.root.icon ? `{${diagram.root.icon}} ` : ''
    const lines = wrapText(displayText(diagram.root.label), targetWidth === undefined ? undefined : Math.max(1, targetWidth - 8 - visualWidth(open + icon + close)))
    lines.forEach(line => {
      const row = doc.height
      doc.line([
        { text: '    ', owner: root, role: 'arrow', kind: 'surface' },
        { text: open + icon, owner: root, role: 'arrow', kind: 'marker' },
        { text: line, owner: root, role: 'text', kind: 'text', textGroup: 'label' },
        { text: close, owner: root, role: 'arrow', kind: 'marker' },
        { text: '    ', owner: root, role: 'arrow', kind: 'surface' },
      ])
      const paint = { owner: root, role: 'arrow' as const, ascii: config.useAscii }
      const end = 7 + visualWidth(open + icon + line + close)
      doc.marker(0, row, { shape: 'triangle', direction: 'L', ascii: config.useAscii }, paint)
      doc.stroke(1, row, 10, paint); doc.stroke(2, row, 10, paint)
      doc.stroke(end - 2, row, 10, paint); doc.stroke(end - 1, row, 10, paint)
      doc.marker(end, row, { shape: 'triangle', direction: 'R', ascii: config.useAscii }, paint)
    })
    left.forEach((child, index) => visit(child, '  ', index === left.length - 1, false, diagram.root.id, [], 'L'))
    right.forEach((child, index) => visit(child, '  ', index === right.length - 1, false, diagram.root.id, [], 'R'))
  } else visit(diagram.root, '', true, true)
  return terminalArtifact(doc, { colorMode, theme, trimEnd: true })
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

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderMindmapAscii(...args: Parameters<typeof renderMindmapTerminal>): string {
  return serializeTerminalArtifact(renderMindmapTerminal(...args))
}
