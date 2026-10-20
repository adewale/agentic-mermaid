import type { Point, PositionedGraph } from '../types.ts'
import type { RenderedLayout } from '../agent/types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { LABEL_PILL_PADDING, labelRect } from '../shared/edge-label-geometry.ts'
import { calculatePathMidpoint } from './geometry.ts'

export interface LabelConflictCounts {
  total: number
  labelLabel: number
  labelNode: number
  labelEdge: number
}

type Rect = { x: number; y: number; w: number; h: number }
type Label = { edgeIndex: number; rect: Rect }
type Route = { points: readonly Point[]; hidden: boolean }

function emptyCounts(): LabelConflictCounts {
  return { total: 0, labelLabel: 0, labelNode: 0, labelEdge: 0 }
}

// A physical tolerance, independent of segment length. Touching boundaries and
// subpixel grazes do not make a label unreadable.
const INTERIOR_TOLERANCE = 0.5

function overlappingInteriors(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > INTERIOR_TOLERANCE &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > INTERIOR_TOLERANCE
}

/** Clip a segment against the open, slightly inset pill body. */
function segmentEntersInterior(a: Point, b: Point, rect: Rect): boolean {
  const left = rect.x + INTERIOR_TOLERANCE, right = rect.x + rect.w - INTERIOR_TOLERANCE
  const top = rect.y + INTERIOR_TOLERANCE, bottom = rect.y + rect.h - INTERIOR_TOLERANCE
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0) return dy !== 0 && a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
  if (dy === 0) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
  const x0 = (left - a.x) / dx, x1 = (right - a.x) / dx
  const y0 = (top - a.y) / dy, y1 = (bottom - a.y) / dy
  return Math.max(0, Math.min(x0, x1), Math.min(y0, y1)) < Math.min(1, Math.max(x0, x1), Math.max(y0, y1))
}

/**
 * Count conflicting label/obstacle pairs, using the rendered eight-pixel pill
 * padding and retained text metrics. A minimum clearance of zero hides extra
 * collisions; these counts continue to distinguish candidates after the first.
 *
 * Each other label, node, or visible route counts once. Own routes are excluded
 * because their pill intentionally masks them. Invisible links still render
 * their labels, but their shafts are not obstacles. A bundle certificate or
 * matching text does not establish shared label ownership: positioned edges
 * currently retain no contract authorizing one label to stand for another.
 */
export function measureLabelConflicts(
  positioned: Pick<PositionedGraph, 'nodes' | 'edges'>,
  style: ResolvedRenderStyle,
  involved?: ReadonlySet<number>,
): LabelConflictCounts {
  const labels = positioned.edges.flatMap((edge, index) => {
    if (!edge.label) return []
    const rect = labelRect(edge.labelPosition ? edge : { ...edge, labelPosition: calculatePathMidpoint(edge.points) }, style)
    return rect ? [{ edgeIndex: index, rect }] : []
  })
  if (labels.length === 0) return emptyCounts()
  return countLabelConflicts(
    labels,
    positioned.nodes.map(node => ({ x: node.x, y: node.y, w: node.width, h: node.height })),
    positioned.edges.map(edge => ({ points: edge.points, hidden: edge.style === 'invisible' })),
    involved,
  )
}

/** Public graph layouts retain text bounds; other families do not use pills. */
export function measureRenderedLabelConflicts(layout: RenderedLayout): LabelConflictCounts | undefined {
  if (layout.kind !== 'flowchart' && layout.kind !== 'state') return undefined
  const labels = layout.edges.flatMap((edge, edgeIndex) => {
    const bounds = edge.label?.bounds
    return edge.label?.text && bounds ? [{
      edgeIndex,
      rect: {
        x: bounds.x - LABEL_PILL_PADDING, y: bounds.y - LABEL_PILL_PADDING,
        w: bounds.w + 2 * LABEL_PILL_PADDING, h: bounds.h + 2 * LABEL_PILL_PADDING,
      },
    }] : []
  })
  if (labels.length === 0) return emptyCounts()
  return countLabelConflicts(
    labels, layout.nodes,
    layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })), hidden: edge.visibility === 'hidden' })),
  )
}

function countLabelConflicts(labels: readonly Label[], nodes: readonly Rect[], routes: readonly Route[], involved?: ReadonlySet<number>): LabelConflictCounts {
  const counts = emptyCounts()
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    const changedLabel = !involved || involved.has(label.edgeIndex)
    for (let j = i + 1; j < labels.length; j++) {
      if (!changedLabel && !involved!.has(labels[j]!.edgeIndex)) continue
      if (overlappingInteriors(label.rect, labels[j]!.rect)) counts.labelLabel++
    }
    if (changedLabel) for (const node of nodes) {
      if (overlappingInteriors(label.rect, node)) counts.labelNode++
    }
    for (let j = 0; j < routes.length; j++) {
      const other = routes[j]!
      if (j === label.edgeIndex || other.hidden) continue
      if (!changedLabel && !involved!.has(j)) continue
      for (let segment = 1; segment < other.points.length; segment++) {
        if (segmentEntersInterior(other.points[segment - 1]!, other.points[segment]!, label.rect)) {
          counts.labelEdge++
          break
        }
      }
    }
  }
  counts.total = counts.labelLabel + counts.labelNode + counts.labelEdge
  return counts
}
