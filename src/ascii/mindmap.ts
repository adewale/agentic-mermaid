import type { MindmapDiagram, MindmapNode } from '../mindmap/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { canvasToString, drawText, mkCanvas, mkRoleCanvas, setRole } from './canvas.ts'
import { wrapText } from './wrap.ts'
import { visualWidth } from './width.ts'
import { plainTextFromInlineFormatting } from '../shared/inline-format.ts'

export function renderMindmapAscii(
  diagram: MindmapDiagram,
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  targetWidth?: number,
): string {
  const rows: Array<{ prefix: string; text: string }> = []
  const visit = (node: MindmapNode, prefix: string, last: boolean, root = false): void => {
    const connector = root ? '' : last ? (config.useAscii ? '`- ' : '└─ ') : (config.useAscii ? '+- ' : '├─ ')
    const branch = prefix + connector
    const icon = node.icon ? `{${node.icon}} ` : ''
    const available = targetWidth === undefined ? undefined : Math.max(1, targetWidth - visualWidth(branch) - 4)
    const plainLabel = plainTextFromInlineFormatting(node.label)
    const labelLines = available ? wrapText(plainLabel, available) : plainLabel.split(/\r?\n/)
    const decorate = (label: string): string => {
      const value = icon + label
      if (node.shape === 'rect') return `[${value}]`
      if (node.shape === 'rounded') return `(${value})`
      if (node.shape === 'circle') return `((${value}))`
      if (node.shape === 'hexagon') return `{{${value}}}`
      if (node.shape === 'cloud') return `)${value}(`
      if (node.shape === 'bang') return `))${value}((`
      return value
    }
    rows.push({ prefix: branch, text: decorate(labelLines[0] ?? '') })
    const continuation = ' '.repeat(visualWidth(branch))
    for (const line of labelLines.slice(1)) rows.push({ prefix: continuation, text: decorate(line) })
    const childPrefix = root ? '' : prefix + (last ? '   ' : (config.useAscii ? '|  ' : '│  '))
    node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1))
  }
  if (diagram.root.children.length >= 2) {
    const left: MindmapNode[] = []
    const right: MindmapNode[] = []
    diagram.root.children.forEach((child, index) => (index % 2 === 1 ? left : right).push(child))
    const rootLabel = plainTextFromInlineFormatting(diagram.root.label)
    const central = config.useAscii ? `<-- ${rootLabel} -->` : `◀── ${rootLabel} ──▶`
    rows.push({ prefix: '', text: central })
    left.forEach((child, index) => visit(child, config.useAscii ? 'L ' : '◀ ', index === left.length - 1))
    right.forEach((child, index) => visit(child, config.useAscii ? 'R ' : '▶ ', index === right.length - 1))
  } else {
    visit(diagram.root, '', true, true)
  }
  const width = Math.max(1, ...rows.map(row => visualWidth(row.prefix) + visualWidth(row.text)))
  const canvas = mkCanvas(width - 1, Math.max(0, rows.length - 1))
  const roles = mkRoleCanvas(width - 1, Math.max(0, rows.length - 1))
  rows.forEach((row, y) => {
    drawText(canvas, { x: 0, y }, row.prefix + row.text, true)
    const prefixWidth = visualWidth(row.prefix)
    for (let x = 0; x < prefixWidth; x++) setRole(roles, x, y, 'line')
    for (let x = prefixWidth; x < width; x++) setRole(roles, x, y, 'text')
  })
  return canvasToString(canvas, { roleCanvas: roles, colorMode, theme }).split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
}
