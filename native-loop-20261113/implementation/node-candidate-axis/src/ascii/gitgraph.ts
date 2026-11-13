import type { GitGraphDiagram } from '../gitgraph/types.ts'
import { gitGraphCommitLabel } from '../gitgraph/types.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { safeCssColor } from '../shared/css-color.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { terminalIds } from './identity.ts'
import { type TerminalArtifact, terminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

export function renderGitGraphTerminal(diagram: GitGraphDiagram, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number, themeVariables?: Record<string, unknown>): TerminalArtifact {
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
  const labels = new Map(
    diagram.commits.map(commit => {
      const lines = wrapText(gitGraphCommitLabel(commit), labelBudget)
      for (const tag of commit.tags) lines.push(...wrapText(`tag: ${tag}`, labelBudget))
      if (commit.syntheticCherryTag && !commit.tags.includes(commit.syntheticCherryTag)) lines.push(...wrapText(`tag: ${commit.syntheticCherryTag}`, labelBudget))
      return [commit.id, lines]
    }),
  )
  const commitLabelWidth = Math.max(3, ...[...labels.values()].flat().map(line => visualWidth(line) + 2))
  const gap = Math.max(5, commitLabelWidth + 2)
  const laneHeight = Math.max(3, ...[...labels.values()].map(lines => lines.length + 2))
  const xFor = (sequence: number, branch: string) => (vertical ? (lane.get(branch) ?? 0) * Math.max(gap + 2, labelWidth + 4) + 1 : labelWidth + 3 + sequence * gap)
  const yFor = (sequence: number, branch: string) => (vertical ? titleRows + 2 + sequence * (laneHeight + 1) : titleRows + (lane.get(branch) ?? 0) * laneHeight)
  const positions = new Map(diagram.commits.map(commit => [commit.id, { x: xFor(commit.sequence, commit.branch), y: yFor(commit.sequence, commit.branch) }]))
  const markerWidth = (commit: (typeof diagram.commits)[number]) => (config.useAscii && (commit.customType ?? commit.type) === 'CHERRY_PICK' ? 2 : 1)
  const width = Math.max(1, ...diagram.commits.map(commit => positions.get(commit.id)!.x + markerWidth(commit) + 1 + Math.max(...labels.get(commit.id)!.map(visualWidth)) + 2), ...titleLines.map(visualWidth), vertical ? branches.length * Math.max(gap + 2, labelWidth + 4) : labelWidth)
  const height = Math.max(titleRows + 1, ...diagram.commits.map(commit => positions.get(commit.id)!.y + (labels.get(commit.id)?.length ?? 1) + 1))
  const doc = new TerminalDocument(width, height)
  const rawAccent = theme.accent ?? '#3b82f6',
    rawBg = theme.bg ?? '#ffffff'
  const accent = /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#3b82f6'
  const bg = /^#[0-9a-f]{6}$/i.test(rawBg) ? rawBg : '#ffffff'
  const palette = categoricalPalette(branches.length, branches.length <= 6 ? { accent, bg } : { accent: rawAccent, bg: rawBg })
  const colors = new Map(branches.map((branch, index) => [branch.name, safeCssColor(themeVariables?.[`git${index % 8}`]) ?? palette[index]!]))
  const paint = (owner: TerminalOwner, branch: string, role: 'line' | 'arrow' | 'text', kind: 'stroke' | 'marker' | 'text') => ({ owner, role, kind, color: colors.get(branch) })
  branches.forEach(branch => {
    // Registered once: the rail paints a cell per column, and each import of
    // an unregistered owner snapshots and revalidates its whole member list.
    const element = doc.element({ id: generated(`branch:${branch.name}`, ['branch', branch.name]), kind: 'lane', members: diagram.commits.filter(commit => commit.branch === branch.name).map(commit => commit.id) })
    const x = vertical ? xFor(0, branch.name) : Math.max(0, labelWidth - visualWidth(branch.name))
    const y = vertical ? titleRows : yFor(0, branch.name)
    doc.textBlock(x, y, branch.name, paint(element, branch.name, 'text', 'text'))
    if (vertical) for (let row = titleRows + 1; row <= height; row++) doc.stroke(x, row, 5, { ...paint(element, branch.name, 'line', 'stroke'), ascii: config.useAscii })
    else for (let col = labelWidth + 1; col < width; col++) doc.stroke(col, y, 10, { ...paint(element, branch.name, 'line', 'stroke'), ascii: config.useAscii })
  })
  const byId = new Map(diagram.commits.map(commit => [commit.id, commit]))
  const plans = diagram.commits.flatMap(commit =>
    commit.parents.flatMap(parentId => {
      const parent = byId.get(parentId),
        source = positions.get(parentId),
        target = positions.get(commit.id)!
      return parent && source ? [{ commit, parent, source, target, id: generated(`edge:${parentId}:${commit.id}`, ['edge', parentId, commit.id]) }] : []
    }),
  )
  // Shared runs are allocated from actual branch rails and merge stems.
  // Merely crossing a different rail does not make two routes a bundle.
  const roots = plans.map((_, index) => index)
  const root = (index: number): number => (roots[index] === index ? index : (roots[index] = root(roots[index]!)))
  const runs = new Map<string, Array<{ index: number; start: number; end: number }>>()
  const reserve = (key: string, index: number, a: number, b: number): void => {
    if (a === b) return
    const list = runs.get(key) ?? []
    list.push({ index, start: Math.min(a, b), end: Math.max(a, b) })
    runs.set(key, list)
  }
  plans.forEach((plan, index) => {
    reserve(JSON.stringify(['rail', plan.parent.branch]), index, vertical ? plan.source.y : plan.source.x, vertical ? plan.target.y : plan.target.x)
    reserve(JSON.stringify(['stem', plan.commit.id]), index, vertical ? plan.source.x : plan.source.y, vertical ? plan.target.x : plan.target.y)
  })
  for (const list of runs.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
    let previous = list[0]!
    for (const current of list.slice(1)) {
      if (current.start < previous.end) {
        roots[root(current.index)] = root(previous.index)
        if (current.end > previous.end) previous = current
      } else previous = current
    }
  }
  const counts = new Map<number, number>()
  plans.forEach((_, index) => {
    const key = root(index)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  // All relationship routes precede marks and owned text footprints.
  for (const [index, plan] of plans.entries()) {
    const { commit, parent, source, target, id } = plan
    const shared = root(index)
    const element = doc.element({ id, kind: 'edge', from: parent.id, to: commit.id, ...((counts.get(shared) ?? 0) > 1 ? { bundle: generated(`shared-rail:${plans[shared]!.id}`, ['shared-rail', plans[shared]!.id]) } : {}) })
    doc.port(element, { nodeId: parent.id, ...source, side: vertical ? 'B' : 'R', end: 'start', markers: [] })
    doc.port(element, { nodeId: commit.id, ...target, side: vertical ? (source.x === target.x ? 'T' : source.x < target.x ? 'L' : 'R') : source.y === target.y ? 'L' : source.y < target.y ? 'T' : 'B', end: 'end', markers: [] })
    const points = [source, vertical ? { x: source.x, y: target.y } : { x: target.x, y: source.y }, target]
    const cells = new Map<string, { x: number; y: number; mask: number }>()
    const add = (x: number, y: number, mask: number): void => {
      const key = `${x},${y}`,
        cell = cells.get(key)
      if (cell) cell.mask |= mask
      else cells.set(key, { x, y, mask })
    }
    for (let segment = 1; segment < points.length; segment++) {
      const start = points[segment - 1]!,
        end = points[segment]!,
        dx = Math.sign(end.x - start.x),
        dy = Math.sign(end.y - start.y)
      const forward = dx > 0 ? 2 : dx < 0 ? 8 : dy > 0 ? 4 : 1,
        backward = dx > 0 ? 8 : dx < 0 ? 2 : dy > 0 ? 1 : 4
      let { x, y } = start
      while (x !== end.x || y !== end.y) {
        add(x, y, forward)
        x += dx
        y += dy
        add(x, y, backward)
      }
    }
    for (const { x, y, mask } of cells.values()) {
      if ((x === source.x && y === source.y) || (x === target.x && y === target.y)) continue
      doc.stroke(x, y, mask, { ...paint(element, commit.branch, 'line', 'stroke'), ascii: config.useAscii })
    }
  }
  for (const commit of diagram.commits) {
    const { x, y } = positions.get(commit.id)!
    const type = commit.customType ?? commit.type
    const glyph = type === 'HIGHLIGHT' ? '#' : type === 'REVERSE' ? 'X' : type === 'MERGE' ? (config.useAscii ? 'O' : '◎') : type === 'CHERRY_PICK' ? (config.useAscii ? '<>' : '◆') : '*'
    const element: TerminalOwner = { id: commit.id, kind: 'node', parent: { id: generated(`branch:${commit.branch}`, ['branch', commit.branch]), kind: 'lane' } }
    doc.mark(x, y, glyph, paint(element, commit.branch, 'arrow', 'marker'))
    doc.scope(element, () => {
      doc.textBlock(
        x + visualWidth(glyph) + 1,
        y + 1,
        (labels.get(commit.id) ?? [gitGraphCommitLabel(commit)]).map(line => `[${line}]`),
        paint(element, commit.branch, 'text', 'text'),
      )
    })
  }
  if (diagram.direction === 'BT') doc.flip(false, true)
  if (titleLines.length) {
    const titled = new TerminalDocument(Math.max(doc.width, ...titleLines.map(visualWidth)), doc.height + titleLines.length + 1)
    titled.scope({ id: 'title', kind: 'label' }, () => titleLines.forEach((line, row) => titled.textBlock(Math.floor((titled.width - visualWidth(line)) / 2), row, line)))
    titled.overlay(doc, 0, titleLines.length + 1)
    return terminalArtifact(titled, { colorMode, theme, trimEnd: true })
  }
  return terminalArtifact(doc, { colorMode, theme, trimEnd: true })
}

