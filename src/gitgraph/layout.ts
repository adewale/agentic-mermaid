import type { InternalStyleFace } from '../scene/style-registry.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { type PixelTextBlock, type PixelTextOptions, preparePixelText } from '../shared/prepared-text.ts'
import { rotateBoxBounds } from '../shared/transformed-bounds.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle } from '../styles.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import type { RenderOptions } from '../types.ts'
import type { GitGraphDiagram, PositionedGitGraphBranch, PositionedGitGraphCommit, PositionedGitGraphDiagram, PositionedGitGraphEdge } from './types.ts'
import { gitGraphCommitLabel } from './types.ts'

/** Horizontal inset on each side of a commit-message pill. Shared with the
 * renderer so measured glyphs cannot touch or escape the rotated outline. */
export const GITGRAPH_COMMIT_LABEL_PADDING_X = 12

export function gitGraphText(text: string, fontSize: number, fontWeight: number, options: Partial<PixelTextOptions> = {}): PixelTextBlock {
  return preparePixelText(text, { display: 'literal', fontSize, fontWeight, ...options })
}

export function gitTagOffset(tags: readonly PixelTextBlock[], index: number): number {
  return -6 - tags[index]!.fontSize - tags.slice(0, index).reduce((sum, block) => sum + block.height + 5, 0) - (tags[index]!.height - tags[index]!.lineHeight) / 2
}

export function gitCommitLabelY(block: PixelTextBlock, direction: GitGraphDiagram['direction']): number {
  const extra = block.height - block.lineHeight
  // Preserve the established single-line baseline when theme font sizes
  // change; the occupied bounds, rather than an extra baseline shift, grow
  // the canvas. Additional authored lines stack clear of the commit mark.
  return direction === 'LR' ? 24 + extra : 4 + extra / 2
}

export interface GitGraphLayoutOptions {
  padding?: number
  renderOptions?: RenderOptions
  styleFace?: Readonly<InternalStyleFace>
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
  const style = resolveRenderStyle(options.renderOptions ?? {}, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: commitLabelFontSize, nodeLabelFontWeight: 500, groupHeaderFontSize: 12, groupHeaderFontWeight: 600 }, options.styleFace)
  const tagStyle = resolveRenderStyle(options.renderOptions ?? {}, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: 10, nodeLabelFontWeight: 600 }, options.styleFace)
  const titleStyle = resolveRenderStyle(options.renderOptions ?? {}, { ...FLOWCHART_STYLE_DEFAULTS, groupHeaderFontSize: 16, groupHeaderFontWeight: 600 }, options.styleFace)
  const prepareCommit = (commit: GitGraphDiagram['commits'][number]) => ({
    ...commit,
    labelBlock: gitGraphText(gitGraphCommitLabel(commit), style.nodeLabelFontSize, style.nodeLabelFontWeight, { transform: style.nodeTextTransform, letterSpacing: style.nodeLetterSpacing }),
    tagBlocks: commit.tags.map(tag => gitGraphText(tag, tagStyle.nodeLabelFontSize, tagStyle.nodeLabelFontWeight, { transform: tagStyle.nodeTextTransform, letterSpacing: tagStyle.nodeLetterSpacing })),
  })
  const preparedCommits = diagram.commits.map(prepareCommit)
  const titleBlock = diagram.title ? gitGraphText(diagram.title, titleStyle.groupHeaderFontSize, titleStyle.groupHeaderFontWeight, { transform: titleStyle.groupTextTransform, letterSpacing: titleStyle.groupLetterSpacing }) : undefined
  const titleHeight = titleBlock ? 40 - 16 * LINE_HEIGHT_RATIO + titleBlock.height : 0
  const orderedBranches = diagram.branches
    .map(branch => ({ ...branch, labelBlock: gitGraphText(branch.name, style.groupHeaderFontSize, style.groupHeaderFontWeight, { transform: style.groupTextTransform, letterSpacing: style.groupLetterSpacing }) }))
    .sort((a, b) => a.order - b.order || a.sequence - b.sequence || compareCodePointStrings(a.name, b.name))
  const laneByBranch = new Map(orderedBranches.map((branch, lane) => [branch.name, lane]))
  const commitById = new Map(preparedCommits.map(commit => [commit.id, commit]))
  const depth = new Map<string, number>()
  for (const commit of preparedCommits) {
    const level = commit.parents.length === 0 ? 0 : Math.max(...commit.parents.map(parent => depth.get(parent) ?? 0)) + 1
    depth.set(commit.id, level)
  }
  const axisIndex = (commit: (typeof diagram.commits)[number]): number => (options.parallelCommits ? depth.get(commit.id)! : commit.sequence)
  const maxAxis = Math.max(0, ...preparedCommits.map(axisIndex))
  const laneGap = Math.max(
    82,
    ...orderedBranches.map(branch => branch.labelBlock.height + 20),
    ...preparedCommits.map(commit => {
      const bounds = relativeCommitTextBounds(commit, diagram.direction, rotateCommitLabel, commitLabelFontSize, showCommitLabel)
      return bounds.maxY - bounds.minY + 20
    }),
  )
  const verticalLaneGap = Math.max(150, ...orderedBranches.map(branch => branch.labelBlock.width + 20))
  const commitGap = 94
  const branchLabelSpace = showBranches ? Math.max(80, ...orderedBranches.map(branch => branch.labelBlock.width + 24)) : 20

  // Pack chronological slots by the actual label/tag extents. A fixed 94px
  // stride made adjacent 45° messages overlap in Gitflow, backport, transit,
  // and CI/CD histories. This keeps topology order fixed while adding only the
  // space required by authored text.
  const axisExtents = new Map<number, TextBounds>()
  for (const commit of preparedCommits) {
    const axis = axisIndex(commit)
    const bounds = relativeCommitTextBounds(commit, diagram.direction, rotateCommitLabel, commitLabelFontSize, showCommitLabel)
    const previous = axisExtents.get(axis)
    axisExtents.set(
      axis,
      previous
        ? {
            minX: Math.min(previous.minX, bounds.minX),
            minY: Math.min(previous.minY, bounds.minY),
            maxX: Math.max(previous.maxX, bounds.maxX),
            maxY: Math.max(previous.maxY, bounds.maxY),
          }
        : bounds,
    )
  }
  const axisPositions = new Map<number, number>()
  const axisOrder = Array.from({ length: maxAxis + 1 }, (_, index) => (diagram.direction === 'BT' ? maxAxis - index : index))
  for (const [index, axis] of axisOrder.entries()) {
    const current = axisExtents.get(axis) ?? { minX: -10, minY: -10, maxX: 10, maxY: 10 }
    const low = diagram.direction === 'LR' ? current.minX : current.minY
    if (index === 0) {
      axisPositions.set(axis, diagram.direction === 'LR' ? Math.max(0, -low) : 0)
      continue
    }
    const previousAxis = axisOrder[index - 1]!
    const previous = axisExtents.get(previousAxis) ?? { minX: -10, minY: -10, maxX: 10, maxY: 10 }
    const previousPosition = axisPositions.get(previousAxis)!
    const high = diagram.direction === 'LR' ? previous.maxX : previous.maxY
    axisPositions.set(axis, Math.max(previousPosition + commitGap, previousPosition + high - low + 18))
  }
  const commitStart = padding + branchLabelSpace + 20
  const verticalStart = padding + titleHeight + 38
  const commits: PositionedGitGraphCommit[] = preparedCommits.map(commit => {
    const lane = laneByBranch.get(commit.branch) ?? 0
    const axis = axisIndex(commit)
    if (diagram.direction === 'LR') {
      return { ...commit, lane, x: commitStart + axisPositions.get(axis)!, y: padding + titleHeight + lane * laneGap }
    }
    return {
      ...commit,
      lane,
      x: padding + branchLabelSpace + lane * verticalLaneGap,
      y: verticalStart + axisPositions.get(axis)!,
    }
  })
  const positionedById = new Map(commits.map(commit => [commit.id, commit]))
  const edges: PositionedGitGraphEdge[] = []
  const extentByBranch = new Map<string, number>()
  for (const commit of commits) {
    const coordinate = diagram.direction === 'LR' ? commit.x : commit.y
    extentByBranch.set(commit.branch, Math.max(extentByBranch.get(commit.branch) ?? -Infinity, coordinate))
    // Public typed callers can construct a history directly; never emit two
    // coincident semantic relations for a duplicated parent tuple.
    for (const [index, parentId] of [...new Set(commit.parents)].entries()) {
      const parent = positionedById.get(parentId)
      if (!parent) continue
      const middle = diagram.direction === 'LR' ? (parent.x + commit.x) / 2 : (parent.y + commit.y) / 2
      const points =
        diagram.direction === 'LR'
          ? [
              { x: parent.x, y: parent.y },
              { x: middle, y: parent.y },
              { x: middle, y: commit.y },
              { x: commit.x, y: commit.y },
            ]
          : [
              { x: parent.x, y: parent.y },
              { x: parent.x, y: middle },
              { x: commit.x, y: middle },
              { x: commit.x, y: commit.y },
            ]
      const kind: PositionedGitGraphEdge['kind'] = index === 0 ? 'parent' : commit.source === 'cherry-pick' ? 'cherry-pick' : 'merge'
      edges.push({ from: parent.id, to: commit.id, kind, points })
    }
  }
  const branches: PositionedGitGraphBranch[] = orderedBranches.map((branch, lane) => {
    const extent = extentByBranch.get(branch.name) ?? -Infinity
    if (diagram.direction === 'LR') {
      const y = padding + titleHeight + lane * laneGap
      return { ...branch, lane, x1: commitStart - 14, y1: y, x2: Math.max(commitStart, extent), y2: y }
    }
    const x = padding + branchLabelSpace + lane * verticalLaneGap
    return { ...branch, lane, x1: x, y1: padding + titleHeight - 14, x2: x, y2: Math.max(verticalStart, extent) }
  })
  let width: number
  let height: number
  if (diagram.direction === 'LR') {
    width = Math.max(padding * 2 + branchLabelSpace + 80, ...commits.map(commit => commit.x + (showCommitLabel ? Math.max(26, commit.labelBlock!.width * 0.75) : 18))) + padding
    height = padding * 2 + titleHeight + Math.max(0, orderedBranches.length - 1) * laneGap + 82 + (showCommitLabel ? commitLabelFontSize * 2 + 26 : 0)
  } else {
    width = padding * 2 + branchLabelSpace + Math.max(1, orderedBranches.length) * verticalLaneGap
    height = Math.max(padding * 2 + titleHeight + 80, ...commits.map(commit => commit.y + (showCommitLabel ? 38 : 18))) + padding
  }

  if (diagram.title) width = Math.max(width, titleBlock!.width + padding * 2)

  // Canvas bounds follow the text the renderer actually displays (message
  // fallback to id), including LR's 45° rotation. The old id-only estimate
  // clipped long authored messages even though their commit marks were inside.
  const textBounds = [
    ...commits.flatMap(commit => [
      ...(showCommitLabel ? [commitLabelBounds(commit, diagram.direction, rotateCommitLabel, commitLabelFontSize)] : []),
      ...commit.tags.map((tag, index) => measuredTextBounds(commit.tagBlocks![index]!, commit.x + 14, commit.y + gitTagOffset(commit.tagBlocks!, index), 10, 600, 'start', 0)),
    ]),
    ...(showBranches ? branches.map(branch => measuredTextBounds(branch.labelBlock!, diagram.direction === 'LR' ? branch.x1 - 10 : branch.x1, diagram.direction === 'LR' ? branch.y1 : branch.y1 - 16, 12, 600, diagram.direction === 'LR' ? 'end' : 'middle', 0)) : []),
  ]
  if (textBounds.length > 0) {
    const minX = Math.min(...textBounds.map(bounds => bounds.minX))
    const minY = Math.min(...textBounds.map(bounds => bounds.minY))
    const maxX = Math.max(...textBounds.map(bounds => bounds.maxX))
    const maxY = Math.max(...textBounds.map(bounds => bounds.maxY))
    const shiftX = minX < padding ? padding - minX : 0
    const reservedTitleBottom = padding + titleHeight
    const shiftY = minY < reservedTitleBottom ? reservedTitleBottom - minY : 0
    if (shiftX !== 0 || shiftY !== 0) {
      for (const commit of commits) {
        commit.x += shiftX
        commit.y += shiftY
      }
      for (const branch of branches) {
        branch.x1 += shiftX
        branch.x2 += shiftX
        branch.y1 += shiftY
        branch.y2 += shiftY
      }
      for (const edge of edges)
        for (const point of edge.points) {
          point.x += shiftX
          point.y += shiftY
        }
    }
    width = Math.max(width + shiftX, maxX + shiftX + padding)
    height = Math.max(height + shiftY, maxY + shiftY + padding)
  }
  // Scene IR and crisp SVG share exact geometry. Quantize once at the layout
  // boundary instead of letting SVG serialization round a different copy.
  for (const commit of commits) {
    commit.x = round3(commit.x)
    commit.y = round3(commit.y)
  }
  for (const branch of branches) {
    branch.x1 = round3(branch.x1)
    branch.y1 = round3(branch.y1)
    branch.x2 = round3(branch.x2)
    branch.y2 = round3(branch.y2)
  }
  for (const edge of edges)
    for (const point of edge.points) {
      point.x = round3(point.x)
      point.y = round3(point.y)
    }
  return {
    width: round3(width),
    height: round3(height),
    direction: diagram.direction,
    ...(diagram.title ? { title: diagram.title, titleBlock } : {}),
    commits,
    branches,
    edges,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    showBranches,
    showCommitLabel,
    rotateCommitLabel,
  }
}

interface TextBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function relativeCommitTextBounds(commit: GitGraphDiagram['commits'][number] & { labelBlock?: PixelTextBlock; tagBlocks?: PixelTextBlock[] }, direction: GitGraphDiagram['direction'], rotate: boolean, fontSize: number, showCommitLabel: boolean): TextBounds {
  const bounds: TextBounds[] = [{ minX: -10, minY: -10, maxX: 10, maxY: 10 }]
  if (showCommitLabel) {
    const label = commit.labelBlock ?? gitGraphText(gitGraphCommitLabel(commit), fontSize, 500)
    bounds.push(commitLabelBackgroundBounds(label, direction === 'LR' ? 0 : 14, gitCommitLabelY(label, direction), fontSize, direction === 'LR' ? 'middle' : 'start', direction === 'LR' && rotate ? 45 : 0))
  }
  const tagBlocks = commit.tagBlocks ?? commit.tags.map(tag => gitGraphText(tag, 10, 600))
  for (const [index, tag] of commit.tags.entries()) {
    const tagBounds = measuredTextBounds(tagBlocks[index]!, 14, gitTagOffset(tagBlocks, index), 10, 600, 'start', 0)
    bounds.push({ ...tagBounds, minX: tagBounds.minX - 4, maxX: tagBounds.maxX + 6, minY: tagBounds.minY - 2, maxY: tagBounds.maxY + 2 })
  }
  return {
    minX: Math.min(...bounds.map(bound => bound.minX)),
    minY: Math.min(...bounds.map(bound => bound.minY)),
    maxX: Math.max(...bounds.map(bound => bound.maxX)),
    maxY: Math.max(...bounds.map(bound => bound.maxY)),
  }
}

function commitLabelBounds(commit: PositionedGitGraphCommit, direction: GitGraphDiagram['direction'], rotate: boolean, fontSize: number): TextBounds {
  const label = commit.labelBlock ?? gitGraphText(gitGraphCommitLabel(commit), fontSize, 500)
  return direction === 'LR' ? commitLabelBackgroundBounds(label, commit.x, commit.y + gitCommitLabelY(label, direction), fontSize, 'middle', rotate ? 45 : 0) : commitLabelBackgroundBounds(label, commit.x + 14, commit.y + gitCommitLabelY(label, direction), fontSize, 'start', 0)
}

function commitLabelBackgroundBounds(text: string | PixelTextBlock, x: number, baselineY: number, fontSize: number, anchor: 'start' | 'middle' | 'end', angle: number): TextBounds {
  const block = typeof text === 'string' ? gitGraphText(text, fontSize, 500) : text
  fontSize = block.fontSize
  const extraHeight = block.height - block.lineHeight
  const width = Math.max(18, block.width + GITGRAPH_COMMIT_LABEL_PADDING_X * 2)
  const left = anchor === 'middle' ? -width / 2 : -GITGRAPH_COMMIT_LABEL_PADDING_X
  const bounds = rotateBoxBounds({ x0: x + left, y0: baselineY - fontSize - extraHeight / 2, x1: x + left + width, y1: baselineY + 6 + extraHeight / 2 }, { x, y: baselineY }, angle)
  return { minX: bounds.x0, minY: bounds.y0, maxX: bounds.x1, maxY: bounds.y1 }
}

function measuredTextBounds(text: string | PixelTextBlock, x: number, baselineY: number, fontSize: number, fontWeight: number, anchor: 'start' | 'middle' | 'end', angle: number): TextBounds {
  const block = typeof text === 'string' ? gitGraphText(text, fontSize, fontWeight) : text
  fontSize = block.fontSize
  const extraHeight = block.height - block.lineHeight
  const width = block.width
  const left = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0
  const top = -fontSize - extraHeight / 2
  const bottom = fontSize * 0.28 + extraHeight / 2
  const bounds = rotateBoxBounds({ x0: x + left, y0: baselineY + top, x1: x + left + width, y1: baselineY + bottom }, { x, y: baselineY }, angle)
  return { minX: bounds.x0, minY: bounds.y0, maxX: bounds.x1, maxY: bounds.y1 }
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
