import type {
  GitGraphDiagram, PositionedGitGraphBranch, PositionedGitGraphCommit,
  PositionedGitGraphDiagram, PositionedGitGraphEdge,
} from './types.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

export interface GitGraphLayoutOptions {
  padding?: number
  showBranches?: boolean
  showCommitLabel?: boolean
  rotateCommitLabel?: boolean
  parallelCommits?: boolean
  /** Resolved themeVariables.commitLabelFontSize; shared with the renderer. */
  commitLabelFontSize?: number
}

export function layoutGitGraph(diagram: GitGraphDiagram, options: GitGraphLayoutOptions = {}): PositionedGitGraphDiagram {
  const padding = finite(options.padding, 44)
  const showBranches = options.showBranches !== false
  const showCommitLabel = options.showCommitLabel !== false
  const rotateCommitLabel = options.rotateCommitLabel !== false
  const commitLabelFontSize = finitePositive(options.commitLabelFontSize, 11)
  const titleHeight = diagram.title ? 40 : 0
  const orderedBranches = [...diagram.branches].sort((a, b) => a.order - b.order || a.sequence - b.sequence || compareCodePointStrings(a.name, b.name))
  const laneByBranch = new Map(orderedBranches.map((branch, lane) => [branch.name, lane]))
  const commitById = new Map(diagram.commits.map(commit => [commit.id, commit]))
  const depth = new Map<string, number>()
  for (const commit of diagram.commits) {
    const level = commit.parents.length === 0 ? 0 : Math.max(...commit.parents.map(parent => depth.get(parent) ?? 0)) + 1
    depth.set(commit.id, level)
  }
  const axisIndex = (commit: typeof diagram.commits[number]): number => options.parallelCommits ? depth.get(commit.id)! : commit.sequence
  const maxAxis = Math.max(0, ...diagram.commits.map(axisIndex))
  const laneGap = 82
  const commitGap = 94
  const branchLabelSpace = showBranches ? Math.max(80, ...orderedBranches.map(branch => measureTextWidth(branch.name, 12, 600) + 24)) : 20
  const commits: PositionedGitGraphCommit[] = diagram.commits.map(commit => {
    const lane = laneByBranch.get(commit.branch) ?? 0
    const axis = axisIndex(commit)
    if (diagram.direction === 'LR') {
      return { ...commit, lane, x: padding + branchLabelSpace + axis * commitGap, y: padding + titleHeight + lane * laneGap }
    }
    return {
      ...commit,
      lane,
      x: padding + branchLabelSpace + lane * 150,
      y: padding + titleHeight + (diagram.direction === 'BT' ? maxAxis - axis : axis) * commitGap,
    }
  })
  const positionedById = new Map(commits.map(commit => [commit.id, commit]))
  const edges: PositionedGitGraphEdge[] = []
  for (const commit of commits) {
    // Public typed callers can construct a history directly; never emit two
    // coincident semantic relations for a duplicated parent tuple.
    for (const [index, parentId] of [...new Set(commit.parents)].entries()) {
      const parent = positionedById.get(parentId)
      if (!parent) continue
      const middle = diagram.direction === 'LR' ? (parent.x + commit.x) / 2 : (parent.y + commit.y) / 2
      const points = diagram.direction === 'LR'
        ? [{ x: parent.x, y: parent.y }, { x: middle, y: parent.y }, { x: middle, y: commit.y }, { x: commit.x, y: commit.y }]
        : [{ x: parent.x, y: parent.y }, { x: parent.x, y: middle }, { x: commit.x, y: middle }, { x: commit.x, y: commit.y }]
      const kind: PositionedGitGraphEdge['kind'] = index === 0 ? 'parent' : commit.source === 'cherry-pick' ? 'cherry-pick' : 'merge'
      edges.push({ from: parent.id, to: commit.id, kind, points })
    }
  }
  const branches: PositionedGitGraphBranch[] = orderedBranches.map((branch, lane) => {
    const own = commits.filter(commit => commit.branch === branch.name)
    if (diagram.direction === 'LR') {
      const y = padding + titleHeight + lane * laneGap
      return { ...branch, lane, x1: padding + branchLabelSpace - 14, y1: y, x2: Math.max(padding + branchLabelSpace, ...own.map(commit => commit.x)), y2: y }
    }
    const x = padding + branchLabelSpace + lane * 150
    return { ...branch, lane, x1: x, y1: padding + titleHeight - 14, x2: x, y2: Math.max(padding + titleHeight, ...own.map(commit => commit.y)) }
  })
  let width: number
  let height: number
  if (diagram.direction === 'LR') {
    width = Math.max(padding * 2 + branchLabelSpace + 80, ...commits.map(commit => commit.x + (showCommitLabel ? Math.max(26, measureTextWidth(commit.message || commit.id, commitLabelFontSize, 500) * 0.75) : 18))) + padding
    height = padding * 2 + titleHeight + Math.max(1, orderedBranches.length) * laneGap + (showCommitLabel ? commitLabelFontSize * 2 + 26 : 0)
  } else {
    width = padding * 2 + branchLabelSpace + Math.max(1, orderedBranches.length) * 150
    height = Math.max(padding * 2 + titleHeight + 80, ...commits.map(commit => commit.y + (showCommitLabel ? 38 : 18))) + padding
  }

  if (diagram.title) width = Math.max(width, measureTextWidth(diagram.title, 16, 600) + padding * 2)

  // Canvas bounds follow the text the renderer actually displays (message
  // fallback to id), including LR's 45° rotation. The old id-only estimate
  // clipped long authored messages even though their commit marks were inside.
  const textBounds = commits.flatMap(commit => [
    ...(showCommitLabel ? [commitLabelBounds(commit, diagram.direction, rotateCommitLabel, commitLabelFontSize)] : []),
    ...commit.tags.map((tag, index) => measuredTextBounds(tag, commit.x + 14, commit.y - 14 - index * 14, 9, 600, 'start', 0)),
  ])
  if (textBounds.length > 0) {
    const minX = Math.min(...textBounds.map(bounds => bounds.minX))
    const minY = Math.min(...textBounds.map(bounds => bounds.minY))
    const maxX = Math.max(...textBounds.map(bounds => bounds.maxX))
    const maxY = Math.max(...textBounds.map(bounds => bounds.maxY))
    const shiftX = minX < 0 ? padding - minX : 0
    const shiftY = minY < 0 ? padding - minY : 0
    if (shiftX !== 0 || shiftY !== 0) {
      for (const commit of commits) { commit.x += shiftX; commit.y += shiftY }
      for (const branch of branches) {
        branch.x1 += shiftX; branch.x2 += shiftX
        branch.y1 += shiftY; branch.y2 += shiftY
      }
      for (const edge of edges) for (const point of edge.points) { point.x += shiftX; point.y += shiftY }
    }
    width = Math.max(width + shiftX, maxX + shiftX + padding)
    height = Math.max(height + shiftY, maxY + shiftY + padding)
  }
  return {
    width, height, direction: diagram.direction, ...(diagram.title ? { title: diagram.title } : {}), commits, branches, edges,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    showBranches, showCommitLabel, rotateCommitLabel,
  }
}

interface TextBounds { minX: number; minY: number; maxX: number; maxY: number }

function commitLabelBounds(
  commit: PositionedGitGraphCommit,
  direction: GitGraphDiagram['direction'],
  rotate: boolean,
  fontSize: number,
): TextBounds {
  const label = commit.message || commit.id
  return direction === 'LR'
    ? measuredTextBounds(label, commit.x, commit.y + 24, fontSize, 500, 'middle', rotate ? 45 : 0)
    : measuredTextBounds(label, commit.x + 14, commit.y + 4, fontSize, 500, 'start', 0)
}

function measuredTextBounds(
  text: string,
  x: number,
  baselineY: number,
  fontSize: number,
  fontWeight: number,
  anchor: 'start' | 'middle',
  angle: number,
): TextBounds {
  const width = measureTextWidth(text, fontSize, fontWeight)
  const left = anchor === 'middle' ? -width / 2 : 0
  const top = -fontSize
  const bottom = fontSize * 0.28
  const radians = angle * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const points = [
    [left, top], [left + width, top], [left, bottom], [left + width, bottom],
  ].map(([offsetX, offsetY]) => ({
    x: x + offsetX! * cos - offsetY! * sin,
    y: baselineY + offsetX! * sin + offsetY! * cos,
  }))
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  }
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
