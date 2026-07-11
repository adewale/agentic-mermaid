import type { GitGraphDiagram } from '../gitgraph/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { canvasToString, drawText, increaseRoleCanvasSize, increaseSize, mkCanvas, mkRoleCanvas, setRole } from './canvas.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

export function renderGitGraphAscii(
  diagram: GitGraphDiagram,
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  targetWidth?: number,
): string {
  const branches = [...diagram.branches].sort((a, b) => a.order - b.order || a.sequence - b.sequence || compareCodePointStrings(a.name, b.name))
  const lane = new Map(branches.map((branch, index) => [branch.name, index]))
  const titleLines = diagram.title
    ? targetWidth === undefined ? [diagram.title] : wrapText(diagram.title, Math.max(1, targetWidth))
    : []
  const titleRows = titleLines.length > 0 ? titleLines.length + 1 : 0
  const labelWidth = Math.max(4, ...branches.map(branch => visualWidth(branch.name)))
  const maxSequence = Math.max(0, ...diagram.commits.map(commit => commit.sequence))
  const columns = maxSequence + 1
  const labelBudget = targetWidth === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor((targetWidth - labelWidth - 3) / columns) - 4)
  const labelLines = new Map(diagram.commits.map(commit => {
    const label = commit.message || commit.id
    return [commit.id, Number.isFinite(labelBudget) ? wrapText(label, labelBudget) : [label]]
  }))
  const commitLabelWidth = Math.max(3, ...[...labelLines.values()].flat().map(line => visualWidth(line) + 2))
  const gap = Math.max(5, commitLabelWidth + 2)
  const xFor = (sequence: number) => labelWidth + 3 + sequence * gap
  const laneHeight = Math.max(2, ...[...labelLines.values()].map(lines => lines.length + 1))
  const yFor = (branch: string) => titleRows + (lane.get(branch) ?? 0) * laneHeight
  const width = Math.max(xFor(maxSequence) + commitLabelWidth + 2, ...titleLines.map(visualWidth))
  const height = titleRows + Math.max(1, (branches.length - 1) * laneHeight + Math.max(1, ...[...labelLines.values()].map(lines => lines.length)))
  const canvas = mkCanvas(width, height)
  const roles = mkRoleCanvas(width, height)
  const put = (x: number, y: number, char: string, role: 'line' | 'arrow' | 'text'): void => {
    increaseSize(canvas, x, y); increaseRoleCanvasSize(roles, x, y)
    canvas[x]![y] = char; setRole(roles, x, y, role)
  }
  titleLines.forEach((line, row) => {
    const x = Math.max(0, Math.floor((width - visualWidth(line)) / 2))
    drawText(canvas, { x, y: row }, line, true)
    for (let col = x; col < x + visualWidth(line); col++) setRole(roles, col, row, 'text')
  })
  branches.forEach(branch => {
    const y = yFor(branch.name)
    drawText(canvas, { x: Math.max(0, labelWidth - visualWidth(branch.name)), y }, branch.name, true)
    for (let x = 0; x < labelWidth; x++) setRole(roles, x, y, 'text')
    for (let x = labelWidth + 1; x < width; x++) put(x, y, config.useAscii ? '-' : '─', 'line')
  })
  const byId = new Map(diagram.commits.map(commit => [commit.id, commit]))
  // Paint every route before commit marks so a later merge path cannot erase an
  // earlier commit glyph or label on the same rail.
  for (const commit of diagram.commits) {
    const x = xFor(commit.sequence)
    const y = yFor(commit.branch)
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId)
      if (!parent) continue
      const px = xFor(parent.sequence)
      const py = yFor(parent.branch)
      for (let cx = Math.min(px, x); cx <= Math.max(px, x); cx++) put(cx, py, config.useAscii ? '-' : '─', 'line')
      for (let cy = Math.min(py, y); cy <= Math.max(py, y); cy++) put(x, cy, config.useAscii ? '|' : '│', 'line')
      if (py !== y) put(x, py, config.useAscii ? '+' : (py < y ? '┐' : '┘'), 'line')
    }
  }
  for (const commit of diagram.commits) {
    const x = xFor(commit.sequence)
    const y = yFor(commit.branch)
    const type = commit.customType ?? commit.type
    const glyph = type === 'HIGHLIGHT' ? '#' : type === 'REVERSE' ? 'X' : type === 'MERGE' ? (config.useAscii ? 'O' : '◎') : type === 'CHERRY_PICK' ? (config.useAscii ? '<>' : '◆') : '*'
    drawText(canvas, { x, y }, glyph, true)
    for (let col = x; col < x + visualWidth(glyph); col++) setRole(roles, col, y, 'arrow')
    const lines = labelLines.get(commit.id) ?? [commit.message || commit.id]
    lines.forEach((line, index) => {
      const label = `[${line}]`
      drawText(canvas, { x: x + visualWidth(glyph) + 1, y: y + index }, label, true)
      for (let col = x + visualWidth(glyph) + 1; col < x + visualWidth(glyph) + 1 + visualWidth(label); col++) setRole(roles, col, y + index, 'text')
    })
  }
  return canvasToString(canvas, { roleCanvas: roles, colorMode, theme }).split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
}
