import type { GitGraphDiagram } from '../gitgraph/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, finishTerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { safeCssColor } from '../shared/css-color.ts'
import { terminalIds } from './identity.ts'

export function renderGitGraphAscii(diagram: GitGraphDiagram, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number, themeVariables?: Record<string, unknown>): string {
  targetWidth ??= config.targetWidth ?? config.maxWidth
  const generated = terminalIds(diagram.commits.map(commit => commit.id))
  const branches = [...diagram.branches].sort((a, b) => a.order - b.order || a.sequence - b.sequence || compareCodePointStrings(a.name, b.name))
  const lane = new Map(branches.map((branch, index) => [branch.name, index]))
  const title = diagram.title ?? config.title
  const titleLines = title ? wrapText(title, targetWidth) : []
  const titleRows = 0
  const labelWidth = Math.max(4, ...branches.map(branch => visualWidth(branch.name)))
  const maxSequence = Math.max(0, ...diagram.commits.map(commit => commit.sequence))
  const vertical = diagram.direction === 'TB' || diagram.direction === 'BT'
  const columns = vertical ? Math.max(1, branches.length) : maxSequence + 1
  const labelBudget = targetWidth === undefined ? undefined : Math.max(1, Math.floor((targetWidth - (vertical ? 1 : labelWidth + 3)) / columns) - (vertical ? 6 : 4))
  const labels = new Map(diagram.commits.map(commit => {
    const lines = wrapText(commit.message || commit.id, labelBudget)
    for (const tag of commit.tags) lines.push(...wrapText(`tag: ${tag}`, labelBudget))
    if (commit.syntheticCherryTag && !commit.tags.includes(commit.syntheticCherryTag)) lines.push(...wrapText(`tag: ${commit.syntheticCherryTag}`, labelBudget))
    return [commit.id, lines]
  }))
  const commitLabelWidth = Math.max(3, ...[...labels.values()].flat().map(line => visualWidth(line) + 2))
  const gap = Math.max(5, commitLabelWidth + 2)
  const laneHeight = Math.max(2, ...[...labels.values()].map(lines => lines.length + 1))
  const xFor = (sequence: number, branch: string) => vertical ? (lane.get(branch) ?? 0) * Math.max(gap + 2, labelWidth + 4) + 1 : labelWidth + 3 + sequence * gap
  const yFor = (sequence: number, branch: string) => vertical ? titleRows + 2 + sequence * (laneHeight + 1) : titleRows + (lane.get(branch) ?? 0) * laneHeight
  const positions = new Map(diagram.commits.map(commit => [commit.id, { x: xFor(commit.sequence, commit.branch), y: yFor(commit.sequence, commit.branch) }]))
  const markerWidth = (commit: typeof diagram.commits[number]) => config.useAscii && (commit.customType ?? commit.type) === 'CHERRY_PICK' ? 2 : 1
  const width = Math.max(1, ...diagram.commits.map(commit => positions.get(commit.id)!.x + markerWidth(commit) + 1 + Math.max(...labels.get(commit.id)!.map(visualWidth)) + 2), ...titleLines.map(visualWidth), vertical ? branches.length * Math.max(gap + 2, labelWidth + 4) : labelWidth)
  const height = Math.max(titleRows + 1, ...diagram.commits.map(commit => positions.get(commit.id)!.y + (labels.get(commit.id)?.length ?? 1)))
  const doc = new TerminalDocument(width, height)
  const rawAccent = theme.accent ?? '#3b82f6', rawBg = theme.bg ?? '#ffffff'
  const accent = /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#3b82f6'
  const bg = /^#[0-9a-f]{6}$/i.test(rawBg) ? rawBg : '#ffffff'
  const palette = categoricalPalette(branches.length, branches.length <= 6 ? { accent, bg } : { accent: rawAccent, bg: rawBg })
  const colors = new Map(branches.map((branch, index) => [branch.name, safeCssColor(themeVariables?.[`git${index % 8}`]) ?? palette[index]!]))
  const paint = (owner: TerminalOwner, branch: string, role: 'line' | 'arrow' | 'text', kind: 'stroke' | 'marker' | 'text') => ({ owner, role, kind, color: colors.get(branch) })
  branches.forEach(branch => {
    const element: TerminalOwner = { id: generated(`branch:${branch.name}`), kind: 'lane', members: diagram.commits.filter(commit => commit.branch === branch.name).map(commit => commit.id) }
    const x = vertical ? xFor(0, branch.name) : Math.max(0, labelWidth - visualWidth(branch.name))
    const y = vertical ? titleRows : yFor(0, branch.name)
    doc.text(x, y, branch.name, paint(element, branch.name, 'text', 'text'))
    if (vertical) for (let row = titleRows + 1; row <= height; row++) doc.put(x, row, config.useAscii ? '|' : '│', paint(element, branch.name, 'line', 'stroke'))
    else for (let col = labelWidth + 1; col < width; col++) doc.put(col, y, config.useAscii ? '-' : '─', paint(element, branch.name, 'line', 'stroke'))
  })
  const byId = new Map(diagram.commits.map(commit => [commit.id, commit]))
  // All relationship routes precede marks and owned text footprints.
  for (const commit of diagram.commits) {
    const { x, y } = positions.get(commit.id)!
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId), point = positions.get(parentId)
      if (!parent || !point) continue
      const element: TerminalOwner = { id: generated(`edge:${parentId}:${commit.id}`), kind: 'edge', from: parentId, to: commit.id }
      const edgePaint = paint(element, commit.branch, 'line', 'stroke')
      if (vertical) {
        for (let row = Math.min(point.y, y); row <= Math.max(point.y, y); row++) doc.put(point.x, row, config.useAscii ? '|' : '│', edgePaint)
        for (let col = Math.min(point.x, x); col <= Math.max(point.x, x); col++) doc.put(col, y, config.useAscii ? '-' : '─', edgePaint)
        if (point.x !== x) doc.put(point.x, y, config.useAscii ? '+' : '└', edgePaint)
      } else {
        for (let col = Math.min(point.x, x); col <= Math.max(point.x, x); col++) doc.put(col, point.y, config.useAscii ? '-' : '─', edgePaint)
        for (let row = Math.min(point.y, y); row <= Math.max(point.y, y); row++) doc.put(x, row, config.useAscii ? '|' : '│', edgePaint)
        if (point.y !== y) doc.put(x, point.y, config.useAscii ? '+' : point.y < y ? '┐' : '┘', edgePaint)
      }
    }
  }
  for (const commit of diagram.commits) {
    const { x, y } = positions.get(commit.id)!
    const type = commit.customType ?? commit.type
    const glyph = type === 'HIGHLIGHT' ? '#' : type === 'REVERSE' ? 'X' : type === 'MERGE' ? (config.useAscii ? 'O' : '◎') : type === 'CHERRY_PICK' ? (config.useAscii ? '<>' : '◆') : '*'
    const element: TerminalOwner = { id: commit.id, kind: 'node', parentId: generated(`branch:${commit.branch}`) }
    doc.put(x, y, glyph, paint(element, commit.branch, 'arrow', 'marker'))
    doc.scope(element, () => {
      for (const [index, line] of (labels.get(commit.id) ?? [commit.message || commit.id]).entries()) doc.text(x + visualWidth(glyph) + 1, y + index, `[${line}]`, paint(element, commit.branch, 'text', 'text'))
    })
  }
  if (diagram.direction === 'BT') doc.flip(false, true)
  if (titleLines.length) {
    const titled = new TerminalDocument(Math.max(doc.width, ...titleLines.map(visualWidth)), doc.height + titleLines.length + 1)
    titled.scope({ id: 'title', kind: 'label' }, () => titleLines.forEach((line, row) => titled.text(Math.floor((titled.width - visualWidth(line)) / 2), row, line)))
    titled.overlay(doc, 0, titleLines.length + 1)
    return finishTerminalDocument(config, titled, { colorMode, theme, trimEnd: true })
  }
  return finishTerminalDocument(config, doc, { colorMode, theme, trimEnd: true })
}
