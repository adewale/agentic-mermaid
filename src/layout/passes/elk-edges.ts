/**
 * Recursively extract edges from ELK result including those inside subgraphs.
 * Edges are distributed to subgraphs for direction override to work,
 * so we need to collect them from all levels with proper coordinate offsets.
 *
 * For hierarchical edges (cross-hierarchy with ports), combines external and
 * internal segments into a single continuous edge path.
 */
import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import type { MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { resolveEdgeInlineStyle } from '../../color-resolver.ts'
import type { MarginInfo } from '../geometry.ts'
import { orthogonalizeEdgePoints } from './orthogonalize.ts'
import { alignElkRoundoff } from '../elk-roundoff.ts'
import { ownedLabelContent } from '../positioned-values.ts'

/** Private adapter metadata retained by ELK and its layout cache. */
export interface ElkHierarchySegment extends ElkExtendedEdge {
  hierarchySegment: { edgeIndex: number; order: number }
}

interface EdgeSegment {
  order: number
  points: Point[]
  labelPosition?: Point
}
export function extractEdgesRecursively(
  elkNode: ElkNode,
  graph: MermaidGraph,
  edges: PositionedEdge[],
  offsetX: number,
  offsetY: number,
  margins?: MarginInfo
): void {
  // First pass: collect all edge segments
  const segments = new Map<number, EdgeSegment[]>()
  const origins = new Map<string, Point>()
  const indexOrigins = (node: ElkNode, x: number, y: number): void => {
    origins.set(node.id, { x, y })
    for (const child of node.children ?? []) indexOrigins(child, x + (child.x ?? 0), y + (child.y ?? 0))
  }
  indexOrigins(elkNode, offsetX, offsetY)
  collectEdgeSegments(elkNode, segments, offsetX, offsetY, origins)

  // Track margin-routed edge count for spacing offsets
  let marginEdgeIndex = 0

  // Second pass: combine segments and create positioned edges
  for (const [edgeIndex, seg] of segments) {
    const originalEdge = graph.edges[edgeIndex]
    if (!originalEdge) continue

    // The producer retains the full path through container scopes. Sorting by
    // that order supports arbitrary depth without inferring roles from IDs.
    const allPoints: Point[] = []
    for (const part of seg.sort((a, b) => a.order - b.order)) {
      const previous = allPoints.at(-1)
      // Parts from different container frames can meet one roundoff apart;
      // align them to the path so far before judging the join.
      const points = previous ? alignElkRoundoff([previous, ...part.points]).slice(1) : alignElkRoundoff(part.points)
      const first = points[0], next = points[1]
      const shared = previous && first && Math.abs(previous.x - first.x) < 1e-6 && Math.abs(previous.y - first.y) < 1e-6
      // ELK can relocate a compound port after its internal layout. Keep real
      // joins, but do not turn a subdivision of the same ink into a new bend
      // when later passes move an endpoint.
      const redundant = previous && first && next && (
        previous.x === first.x && first.x === next.x && first.y >= Math.min(previous.y, next.y) && first.y <= Math.max(previous.y, next.y)
        || previous.y === first.y && first.y === next.y && first.x >= Math.min(previous.x, next.x) && first.x <= Math.max(previous.x, next.x)
      )
      allPoints.push(...(shared || redundant ? points.slice(1) : points))
    }

    // The room ELK reserved for the caption. A route without one, or one
    // rebuilt below, has its caption seated on it after extraction.
    let labelPosition = originalEdge.label ? seg.find(part => part.labelPosition)?.labelPosition : undefined

    // Ensure all edge segments are orthogonal (horizontal or vertical only).
    // In SEPARATE hierarchy mode, ELK may produce diagonal segments for
    // cross-hierarchy edges where it only returns start/end points without
    // proper orthogonal bend points.
    // When margins are available, route through the diagram margins instead
    // of Z-paths through the middle (which cross through subgraphs).
    const orthogonalPoints = orthogonalizeEdgePoints(allPoints, margins, marginEdgeIndex)
    if (orthogonalPoints !== allPoints) {
      marginEdgeIndex++
    }

    if (orthogonalPoints !== allPoints) labelPosition = undefined

    edges.push(positionedEdgeFromAuthored(graph, edgeIndex, orthogonalPoints, labelPosition))
  }
}

/** How far a group-side end stays from that side's corners. */
const GROUP_CORNER_INSET = 12

/**
 * ELK can attach an edge to a group (a container endpoint) at a corner of its
 * frame, so the terminal run continues the frame's other side: the route
 * reads as leaving the frame line rather than the group. Slide such a
 * terminal run along its side, keeping it perpendicular to the side and every
 * bend, until it is GROUP_CORNER_INSET from the corner (or at the middle of a
 * short side). A run that would enter a node box stays where it was.
 */
export function keepGroupEndsOffCorners(edges: PositionedEdge[], groups: readonly PositionedGroup[], nodes: readonly PositionedNode[]): void {
  const byId = new Map<string, PositionedGroup>()
  const visit = (list: readonly PositionedGroup[]): void => { for (const group of list) { byId.set(group.id, group); visit(group.children) } }
  visit(groups)
  if (byId.size === 0) return
  for (const edge of edges) {
    for (const start of [true, false]) {
      const group = byId.get(start ? edge.source : edge.target)
      const points = start ? edge.points : edge.points.toReversed()
      if (!group || points.length < 2) continue
      const [end, run] = points as [Point, Point]
      const after = points[2]
      // A run across a top or bottom side slides along x; one across a left
      // or right side slides along y.
      const along: 'x' | 'y' | undefined = end.x === run.x && run.y !== end.y ? 'x' : end.y === run.y && run.x !== end.x ? 'y' : undefined
      if (!along) continue
      const across = along === 'x' ? 'y' : 'x'
      const sideAt = across === 'y' ? [group.y, group.y + group.height] : [group.x, group.x + group.width]
      if (!sideAt.some(value => Math.abs(end[across] - value) < 0.5) || after && Math.abs(after[across] - run[across]) > 1e-9) continue
      const lo = group[along], size = along === 'x' ? group.width : group.height
      const inset = Math.min(size / 2, GROUP_CORNER_INSET)
      const lane = Math.min(Math.max(end[along], lo + inset), lo + size - inset)
      if (Math.abs(lane - end[along]) < 1e-9 || Math.min(end[along] - lo, lo + size - end[along]) >= ROUTE_CORNER_CLEARANCE) continue
      // A straight route slides whole, so its far end must stay on its own
      // box's face, clear of that face's corners too.
      if (!after) {
        const farId = start ? edge.target : edge.source
        const far = nodes.find(node => node.id === farId) ?? byId.get(farId)
        const farLo = far?.[along], farSize = far ? (along === 'x' ? far.width : far.height) : 0
        if (farLo === undefined || lane < farLo + ROUTE_CORNER_CLEARANCE || lane > farLo + farSize - ROUTE_CORNER_CLEARANCE) continue
      }
      const moved = points.map((point, index) => index < 2 ? { ...point, [along]: lane } : point)
      if (nodes.some(node => node.id !== edge.source && node.id !== edge.target && enters(moved.slice(0, 3), node))) continue
      edge.points = start ? moved : moved.toReversed()
      // A caption ELK reserved on the slid run moves with it.
      const label = edge.labelPosition
      if (label && Math.abs(label[along] - end[along]) < 1e-6) edge.labelPosition = { ...label, [along]: lane }
    }
  }
}

/** Ends closer than this to a side's corner read as leaving the corner. */
const ROUTE_CORNER_CLEARANCE = 4

const enters = (points: readonly Point[], box: PositionedNode): boolean => points.slice(1).some((b, i) => {
  const a = points[i]!
  return Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
})

/** The authored identity, shaft, markers and presentation of `graph.edges[edgeIndex]`
 * on a produced route. Every producer of graph edges shares this projection. */
export function positionedEdgeFromAuthored(graph: MermaidGraph, edgeIndex: number, points: Point[], labelPosition: Point | undefined): PositionedEdge {
  const originalEdge = graph.edges[edgeIndex]!
  return {
    source: originalEdge.source,
    target: originalEdge.target,
    // Authored v11.6 edge ID: carried through layout so the SVG can emit
    // it as the edge's data-id (stable identity contract).
    ...(originalEdge.id !== undefined ? { id: originalEdge.id } : {}),
    label: originalEdge.label,
    ...(originalEdge.labelContent ? { labelContent: ownedLabelContent(originalEdge.labelContent) } : {}),
    style: originalEdge.style,
    hasArrowStart: originalEdge.hasArrowStart,
    hasArrowEnd: originalEdge.hasArrowEnd,
    startMarker: originalEdge.startMarker,
    endMarker: originalEdge.endMarker,
    ...(originalEdge.curve ? { curve: originalEdge.curve } : {}),
    ...(originalEdge.animate ? { animate: true as const } : {}),
    ...(originalEdge.animation ? { animation: originalEdge.animation } : {}),
    points,
    labelPosition,
    inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph),
    ...(originalEdge.id && graph.classAssignments.has(originalEdge.id)
      ? { classNames: graph.classAssignments.get(originalEdge.id)!.split(/\s+/).filter(Boolean) }
      : {}),
    edgeIndex,
  }
}

function collectEdgeSegments(
  elkNode: ElkNode,
  segments: Map<number, EdgeSegment[]>,
  offsetX: number,
  offsetY: number,
  origins: ReadonlyMap<string, Point>,
): void {
  if (elkNode.edges) {
    for (const elkEdge of elkNode.edges) {
      const hierarchy = (elkEdge as Partial<ElkHierarchySegment>).hierarchySegment
      const edgeIndex = hierarchy?.edgeIndex ?? parseInt(elkEdge.id.substring(1), 10)
      if (isNaN(edgeIndex)) continue

      // ELK can keep an edge in its authored host's array while reporting
      // section/label coordinates in another container (including root).
      const origin = elkEdge.container ? origins.get(elkEdge.container) : undefined
      const edgeOffsetX = origin?.x ?? offsetX, edgeOffsetY = origin?.y ?? offsetY

      // Extract points
      const points: Point[] = []
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0]!
        points.push({
          x: section.startPoint.x + edgeOffsetX,
          y: section.startPoint.y + edgeOffsetY,
        })
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            points.push({ x: bp.x + edgeOffsetX, y: bp.y + edgeOffsetY })
          }
        }
        points.push({
          x: section.endPoint.x + edgeOffsetX,
          y: section.endPoint.y + edgeOffsetY,
        })
      }

      // Extract label position
      let labelPosition: Point | undefined
      if (elkEdge.labels && elkEdge.labels.length > 0) {
        const label = elkEdge.labels[0]!
        if (label.x != null && label.y != null) {
          labelPosition = {
            x: label.x + (label.width ?? 0) / 2 + edgeOffsetX,
            y: label.y + (label.height ?? 0) / 2 + edgeOffsetY,
          }
        }
      }

      const parts = segments.get(edgeIndex) ?? []
      parts.push({ order: hierarchy?.order ?? 0, points, labelPosition })
      segments.set(edgeIndex, parts)
    }
  }

  // Recurse into children with accumulated offset
  if (elkNode.children) {
    for (const child of elkNode.children) {
      collectEdgeSegments(child, segments, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), origins)
    }
  }
}
