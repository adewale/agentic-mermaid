/**
 * Recursively extract edges from ELK result including those inside subgraphs.
 * Edges are distributed to subgraphs for direction override to work,
 * so we need to collect them from all levels with proper coordinate offsets.
 *
 * For hierarchical edges (cross-hierarchy with ports), combines external and
 * internal segments into a single continuous edge path.
 */
import type { ElkNode } from 'elkjs'
import type { MermaidGraph, Point, PositionedEdge } from '../../types.ts'
import { resolveEdgeInlineStyle } from '../../color-resolver.ts'
import { calculatePathMidpoint, type MarginInfo } from '../geometry.ts'
import { orthogonalizeEdgePoints } from './orthogonalize.ts'

interface EdgeSegment {
  edgeIndex: number
  isInternal: boolean  // true for port-to-node segments (e.g., "e3_internal")
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
  const segments = new Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>()
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

    // Combine points from all segments in correct order:
    // - For incoming cross-hierarchy (external → subgraph): external then incoming
    // - For outgoing cross-hierarchy (subgraph → external): outgoing then external
    // - For both (subgraph A → subgraph B): outgoing → external → incoming
    const allPoints: Point[] = []

    // First: outgoing internal segment (source node → exit port)
    if (seg.outgoing && seg.outgoing.points.length > 0) {
      allPoints.push(...seg.outgoing.points)
    }

    // Second: external segment (exit port → entry port, or source → entry port, or exit port → target)
    if (seg.external && seg.external.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at outgoing port
        allPoints.push(...seg.external.points.slice(1))
      } else {
        allPoints.push(...seg.external.points)
      }
    }

    // Third: incoming internal segment (entry port → target node)
    if (seg.incoming && seg.incoming.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at incoming port
        allPoints.push(...seg.incoming.points.slice(1))
      } else {
        allPoints.push(...seg.incoming.points)
      }
    }

    // Label position: use ELK's inline label position (on-edge with collision avoidance)
    // Fall back to midpoint for hierarchical edges or when ELK position unavailable
    let labelPosition: Point | undefined
    if (originalEdge.label && allPoints.length >= 2) {
      const elkLabelPos = seg.external?.labelPosition
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
  segments: Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>,
  offsetX: number,
  offsetY: number,
  origins: ReadonlyMap<string, Point>,
): void {
  if (elkNode.edges) {
    for (const elkEdge of elkNode.edges) {
      // Parse edge ID: "e{index}" or "e{index}_internal"
      const isInternal = elkEdge.id.endsWith('_internal')
      const edgeIndex = parseInt(elkEdge.id.substring(1), 10)
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

      // Store segment
      if (!segments.has(edgeIndex)) {
        segments.set(edgeIndex, {})
      }
      const seg = segments.get(edgeIndex)!

      if (isInternal) {
        // Determine if this is an incoming or outgoing internal segment
        // by checking if source is a port (incoming) or target is a port (outgoing)
        const source = elkEdge.sources?.[0] ?? ''
        const target = elkEdge.targets?.[0] ?? ''
        const sourceIsPort = source.includes('_in_') || source.includes('_out_')
        const targetIsPort = target.includes('_in_') || target.includes('_out_')

        if (sourceIsPort) {
          // Port → node: incoming internal segment
          seg.incoming = { edgeIndex, isInternal, points, labelPosition }
        } else if (targetIsPort) {
          // Node → port: outgoing internal segment
          seg.outgoing = { edgeIndex, isInternal, points, labelPosition }
        }
      } else {
        seg.external = { edgeIndex, isInternal, points, labelPosition }
      }
    }
  }

  // Recurse into children with accumulated offset
  if (elkNode.children) {
    for (const child of elkNode.children) {
      collectEdgeSegments(child, segments, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0), origins)
    }
  }
}
