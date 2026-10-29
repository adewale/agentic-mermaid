/**
 * Recursively extract edges from ELK result including those inside subgraphs.
 * Edges are distributed to subgraphs for direction override to work,
 * so we need to collect them from all levels with proper coordinate offsets.
 *
 * For hierarchical edges (cross-hierarchy with ports), combines external and
 * internal segments into a single continuous edge path.
 */
import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import type { MermaidGraph, Point, PositionedEdge } from '../../types.ts'
import { resolveEdgeInlineStyle } from '../../color-resolver.ts'
import { calculatePathMidpoint, type MarginInfo } from '../geometry.ts'
import { orthogonalizeEdgePoints } from './orthogonalize.ts'
import { alignElkRoundoff } from '../elk-roundoff.ts'

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

    // Label position: use ELK's inline label position (on-edge with collision avoidance)
    // Fall back to midpoint for hierarchical edges or when ELK position unavailable
    let labelPosition: Point | undefined
    if (originalEdge.label && allPoints.length >= 2) {
      const elkLabelPos = seg.find(part => part.labelPosition)?.labelPosition
      labelPosition = elkLabelPos ?? calculatePathMidpoint(allPoints)
    }

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

    // Recalculate label position for margin-routed edges
    if (originalEdge.label && orthogonalPoints !== allPoints && orthogonalPoints.length >= 2) {
      labelPosition = calculatePathMidpoint(orthogonalPoints)
    }

    edges.push({
      source: originalEdge.source,
      target: originalEdge.target,
      // Authored v11.6 edge ID: carried through layout so the SVG can emit
      // it as the edge's data-id (stable identity contract).
      ...(originalEdge.id !== undefined ? { id: originalEdge.id } : {}),
      label: originalEdge.label,
      ...(originalEdge.labelContent ? { labelContent: originalEdge.labelContent } : {}),
      style: originalEdge.style,
      hasArrowStart: originalEdge.hasArrowStart,
      hasArrowEnd: originalEdge.hasArrowEnd,
      startMarker: originalEdge.startMarker,
      endMarker: originalEdge.endMarker,
      ...(originalEdge.curve ? { curve: originalEdge.curve } : {}),
      ...(originalEdge.animate ? { animate: true as const } : {}),
      ...(originalEdge.animation ? { animation: originalEdge.animation } : {}),
      points: orthogonalPoints,
      labelPosition,
      inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph),
      ...(originalEdge.id && graph.classAssignments.has(originalEdge.id)
        ? { classNames: graph.classAssignments.get(originalEdge.id)!.split(/\s+/).filter(Boolean) }
        : {}),
      edgeIndex,
    })
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
