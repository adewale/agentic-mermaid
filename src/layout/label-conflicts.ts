import type { Point, PositionedGraph, PositionedGroup } from '../types.ts'
import type { RenderedLayout } from '../agent/types.ts'
import { LABEL_PILL_PADDING, LABEL_INTERIOR_TOLERANCE as INTERIOR_TOLERANCE, segmentEntersLabelRect, labelRect } from '../shared/edge-label-geometry.ts'
import { calculatePathMidpoint } from './geometry.ts'

export interface LabelConflictCounts {
  total: number
  labelLabel: number
  labelNode: number
  labelEdge: number
  /** Group frames whose title band the label covers or whose painted outline
   *  passes through it. */
  labelGroup: number
}

type Rect = { x: number; y: number; w: number; h: number }
type Label = { edgeIndex: number; rect: Rect }
type Route = { points: readonly Point[]; hidden: boolean }
/** A group as painted: its frame (when it draws one) and the title band the
 *  producer reserved at its top. */
type Frame = Rect & { header: number; outline: boolean }

function emptyCounts(): LabelConflictCounts {
  return { total: 0, labelLabel: 0, labelNode: 0, labelEdge: 0, labelGroup: 0 }
}

// A physical tolerance, independent of segment length. Touching boundaries and
// subpixel grazes do not make a label unreadable.

function overlappingInteriors(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > INTERIOR_TOLERANCE &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > INTERIOR_TOLERANCE
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
  positioned: Pick<PositionedGraph, 'nodes' | 'edges'> & { groups?: readonly PositionedGroup[] },
  style: Parameters<typeof labelRect>[1],
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
    positionedFrames(positioned.groups ?? []),
  )
}

/** The pill covers a group's title band or a painted side of its frame runs
 *  through it: the measure's labelGroup conflict, for one candidate pill. */
export function pillMeetsGroupFrame(pill: Rect, groups: readonly PositionedGroup[]): boolean {
  return positionedFrames(groups).some(frame => meetsFrame(pill, frame))
}

/** Concurrency regions draw no box of their own and reserve no title band. */
function positionedFrames(groups: readonly PositionedGroup[]): Frame[] {
  const frames: Frame[] = []
  const visit = (group: PositionedGroup): void => {
    const outline = !group.concurrencyRegion
    frames.push({ x: group.x, y: group.y, w: group.width, h: group.height, header: outline ? group.headerHeight ?? 0 : 0, outline })
    group.children.forEach(visit)
  }
  groups.forEach(visit)
  return frames
}

/** Graphs paint padded pills; specialized families use retained text footprints.
 * Missing measurements remain unavailable, rather than becoming zero conflicts. */
export function measureRenderedLabelConflicts(layout: RenderedLayout): LabelConflictCounts | undefined {
  if (layout.edges.some(edge => edge.label?.text && !edge.label.bounds)) return undefined
  const padding = layout.kind === 'flowchart' || layout.kind === 'state' ? LABEL_PILL_PADDING : 0
  const labels = layout.edges.flatMap((edge, edgeIndex) => {
    const bounds = edge.label?.bounds
    return edge.label?.text && bounds ? [{
      edgeIndex,
      rect: {
        x: bounds.x - padding, y: bounds.y - padding,
        w: bounds.w + 2 * padding, h: bounds.h + 2 * padding,
      },
    }] : []
  })
  if (labels.length === 0) return emptyCounts()
  return countLabelConflicts(
    labels, layout.nodes,
    layout.edges.map(edge => ({ points: edge.path.map(([x, y]) => ({ x, y })), hidden: edge.visibility === 'hidden' })),
    undefined,
    layout.groups.map(group => ({ x: group.x, y: group.y, w: group.w, h: group.h, header: group.headerHeight ?? 0, outline: group.outline !== 'none' })),
  )
}

/** The label covers the frame's title band, or a painted side of the frame
 *  runs through its interior. */
function meetsFrame(label: Rect, frame: Frame): boolean {
  if (frame.header > 0 && overlappingInteriors(label, { x: frame.x, y: frame.y, w: frame.w, h: frame.header })) return true
  if (!frame.outline) return false
  const t = INTERIOR_TOLERANCE
  const acrossX = (x: number) => label.x < x - t && label.x + label.w > x + t && label.y < frame.y + frame.h - t && label.y + label.h > frame.y + t
  const acrossY = (y: number) => label.y < y - t && label.y + label.h > y + t && label.x < frame.x + frame.w - t && label.x + label.w > frame.x + t
  return acrossX(frame.x) || acrossX(frame.x + frame.w) || acrossY(frame.y) || acrossY(frame.y + frame.h)
}

function countLabelConflicts(labels: readonly Label[], nodes: readonly Rect[], routes: readonly Route[], involved?: ReadonlySet<number>, frames: readonly Frame[] = []): LabelConflictCounts {
  const counts = emptyCounts()
  const changedLabels = involved ? labels.filter(label => involved.has(label.edgeIndex)) : labels
  const changedRoutes = involved ? [...involved].filter(index => routes[index] !== undefined) : []
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    const changedLabel = !involved || involved.has(label.edgeIndex)
    const peers = changedLabel ? labels : changedLabels
    for (let j = changedLabel ? i + 1 : 0; j < peers.length; j++) {
      const other = peers[j]!
      if (!changedLabel && other.edgeIndex <= label.edgeIndex) continue
      if (overlappingInteriors(label.rect, other.rect)) counts.labelLabel++
    }
    if (changedLabel) for (const node of nodes) {
      if (overlappingInteriors(label.rect, node)) counts.labelNode++
    }
    if (changedLabel) for (const frame of frames) {
      if (meetsFrame(label.rect, frame)) counts.labelGroup++
    }
    for (let cursor = 0; cursor < (changedLabel ? routes.length : changedRoutes.length); cursor++) {
      const j = changedLabel ? cursor : changedRoutes[cursor]!
      const other = routes[j]!
      if (j === label.edgeIndex || other.hidden) continue
      for (let segment = 1; segment < other.points.length; segment++) {
        if (segmentEntersLabelRect(other.points[segment - 1]!, other.points[segment]!, label.rect)) {
          counts.labelEdge++
          break
        }
      }
    }
  }
  counts.total = counts.labelLabel + counts.labelNode + counts.labelEdge + counts.labelGroup
  return counts
}
