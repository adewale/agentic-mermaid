// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedGitGraphDiagram } from '../gitgraph/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, fSpan, canvasOf, labelRect, retainedLabelBounds } from './geometry.ts'
import { gitCommitLabelY } from '../gitgraph/layout.ts'
import { rotateBoxBounds } from '../shared/transformed-bounds.ts'

export function projectGitGraphPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedGitGraphDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.commits.map(commit => {
    const type = commit.customType ?? commit.type
    const block = commit.labelBlock
    let labelBounds = block && positioned.showCommitLabel
      ? retainedLabelBounds(block, positioned.direction === 'LR' ? commit.x : commit.x + 14, commit.y + gitCommitLabelY(block, positioned.direction) - block.fontSize * 0.35, positioned.direction === 'LR' ? 'middle' : 'start')
      : undefined
    if (labelBounds && positioned.direction === 'LR' && positioned.rotateCommitLabel && block) {
      const bounds = rotateBoxBounds({ x0: labelBounds.x, y0: labelBounds.y, x1: labelBounds.x + labelBounds.w, y1: labelBounds.y + labelBounds.h }, { x: commit.x, y: commit.y + gitCommitLabelY(block, positioned.direction) }, 45)
      labelBounds = labelRect({ x: bounds.x0, y: bounds.y0, width: bounds.x1 - bounds.x0, height: bounds.y1 - bounds.y0 })
    }
    return {
      id: commit.id,
      x: f(commit.x - 10),
      y: f(commit.y - 10),
      w: f(20),
      h: f(20),
      shape: type === 'CHERRY_PICK' ? 'diamond' : type === 'HIGHLIGHT' ? 'rectangle' : 'ellipse',
      label: commit.message || commit.id,
      labelVisibility: positioned.showCommitLabel ? 'visible' : 'hidden',
      labelBounds,
      labelContainer: labelRect(canvasOf(positioned)),
    }
  })
  const edges: RenderedLayoutEdge[] = positioned.edges.map((edge, index) => ({
    id: `edge#${index}:${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    path: edge.points.map(point => [f(point.x), f(point.y)] as [Finite, Finite]),
  }))
  const groups: RenderedLayoutGroup[] = positioned.showBranches
    ? positioned.branches.map(branch => {
        const commits = positioned.commits.filter(commit => commit.branch === branch.name)
        const minX = Math.min(branch.x1, branch.x2, ...commits.map(commit => commit.x - 10))
        const minY = Math.min(branch.y1, branch.y2, ...commits.map(commit => commit.y - 10))
        const maxX = Math.max(branch.x1, branch.x2, ...commits.map(commit => commit.x + 10))
        const maxY = Math.max(branch.y1, branch.y2, ...commits.map(commit => commit.y + 10))
        return {
          id: `branch:${branch.name}`,
          x: f(minX),
          y: f(minY),
          w: fSpan(minX, Math.max(1, maxX - minX)),
          h: fSpan(minY, Math.max(1, maxY - minY)),
          members: commits.map(commit => commit.id),
          label: branch.name,
        }
      })
    : []
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
