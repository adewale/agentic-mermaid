import { onRectPerimeter, flattenGroups, segmentHitsLoopLabel } from './route-geometry.ts'
// Read-only findings over settled route geometry; never repairs or recertifies routes.
import type { MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../types.ts'
import { resolveRenderStyle } from '../styles.ts'
import { renderedEndpointContact } from '../rendered-endpoint-diagnostics.ts'
import { labelRect } from '../shared/edge-label-geometry.ts'
import { EPS, RECT_LIKE, type LabelMetricsStyle, routesCrossOrOverlap, indexRouteNodes } from './route-geometry.ts'
import { edgeId, routeEntersNodeBox, sharedTrunkConflict } from './route-lanes.ts'

export type RouteAuditFinding =
  | { code: 'ROUTE_UNEXPLAINED_BEND'; edge: string }
  | { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: string; sharedWith: string }
  | { code: 'ROUTE_SELF_LOOP_OCCUPANCY'; edge: string; conflictWith?: string; kind: 'allocation' | 'side' | 'boundary' | 'route-route' | 'label-label' | 'label-route' }
  | { code: 'ROUTE_CONTAINER_MISANCHOR'; edge: string; container: string }
  | { code: 'ROUTE_SHAPE_MISANCHOR'; edge: string; node: string }
  | { code: 'ROUTE_STALE_AFTER_NODE_MOVE'; edge: string; node: string }

/** Within `tol` of the rectangle's perimeter (on an edge line, inside its range). */



export function auditRouteContracts(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle = resolveRenderStyle({})): RouteAuditFinding[] {
  const findings: RouteAuditFinding[] = []
  const nodeMap = indexRouteNodes(positioned.nodes)
  const groupMap = flattenGroups(positioned.groups)
  const TOL = 1

  for (const edge of positioned.edges) {
    if (edge.points.length < 2) continue
    const cert = edge.routeCertificate
    const id = edgeId(edge)

    // ROUTE_UNEXPLAINED_BEND: orthogonal routing produced a diagonal segment —
    // a bend that neither the prover nor a blocker list can account for.
    if (cert && (cert.routeClass === 'primary-forward' || cert.routeClass === 'feedback')) {
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!,
          b = edge.points[i]!
        if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
          findings.push({ code: 'ROUTE_UNEXPLAINED_BEND', edge: id })
          break
        }
      }
    }

    // ROUTE_CONTAINER_MISANCHOR: a container edge must terminate on the
    // container's border, not on a phantom node or a child (spec §11.5).
    if (cert?.routeClass === 'container' && cert.edgeIndex >= 0) {
      const graphEdge = graph.edges[cert.edgeIndex]
      if (graphEdge) {
        for (const [endId, point] of [
          [graphEdge.source, edge.points[0]!],
          [graphEdge.target, edge.points[edge.points.length - 1]!],
        ] as const) {
          const group = groupMap.get(endId)
          if (group && !onRectPerimeter(point, group.x, group.y, group.width, group.height, TOL)) {
            findings.push({ code: 'ROUTE_CONTAINER_MISANCHOR', edge: id, container: endId })
          }
        }
      }
    }

    // ROUTE_SHAPE_MISANCHOR / ROUTE_STALE_AFTER_NODE_MOVE: endpoints must sit
    // on the rendered boundary of the shapes we have anchor contracts for
    // (spec §11.6), and may never detach from their node entirely.
    if (cert && cert.routeClass !== 'container') {
      for (const [nodeId, point] of [
        [edge.source, edge.points[0]!],
        [edge.target, edge.points[edge.points.length - 1]!],
      ] as const) {
        const node = nodeMap.get(nodeId)
        if (!node) continue
        const inflated = point.x >= node.x - 2 && point.x <= node.x + node.width + 2 && point.y >= node.y - 2 && point.y <= node.y + node.height + 2
        if (!inflated) {
          findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: nodeId })
          continue
        }
        const contact = renderedEndpointContact(node, point, TOL)
        if (contact.policy !== 'none' && !contact.onBoundary) {
          findings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: id, node: nodeId })
        }
      }
    }

    // ROUTE_STALE_AFTER_NODE_MOVE also catches the other stale-corridor
    // signature: a non-incident node moved onto an already-certified route.
    // Endpoint detachment above catches moved endpoints; this catches moved
    // obstacles in the middle of a route.
    for (const node of positioned.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      if (routeEntersNodeBox(edge.points, node)) findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: node.id })
    }

    // ROUTE_LABEL_ON_SHARED_TRUNK: a label pill sitting on a piece of line
    // that another edge's collinear segment shares (spec §11.4) — the reader
    // cannot tell which edge the label belongs to.
    if (edge.label && edge.labelPosition) {
      const other = sharedTrunkConflict(edge, positioned.edges, style)
      if (other) findings.push({ code: 'ROUTE_LABEL_ON_SHARED_TRUNK', edge: id, sharedWith: edgeId(other) })
    }
  }

  const loops = positioned.edges.filter(edge => edge.source === edge.target)

  for (let i = 0; i < loops.length; i++) {
    const edge = loops[i]!
    const cert = edge.routeCertificate
    const id = edgeId(edge)
    const node = nodeMap.get(edge.source)
    if (!cert || cert.invariant !== 'self-loop' || !cert.loopSide) {
      findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'allocation' })
      continue
    }
    if (node && RECT_LIKE.has(node.shape)) {
      const first = edge.points[0]!
      const last = edge.points[edge.points.length - 1]!
      const onSide = (point: Point): boolean => (cert.loopSide === 'N' ? Math.abs(point.y - node.y) <= TOL : cert.loopSide === 'S' ? Math.abs(point.y - (node.y + node.height)) <= TOL : cert.loopSide === 'W' ? Math.abs(point.x - node.x) <= TOL : Math.abs(point.x - (node.x + node.width)) <= TOL)
      if (!onSide(first) || !onSide(last) || Math.hypot(first.x - last.x, first.y - last.y) < 8) {
        findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'side' })
      }
      for (let segment = 1; segment < edge.points.length; segment++) {
        const a = edge.points[segment - 1]!,
          b = edge.points[segment]!
        const alongHorizontal = Math.abs(a.y - b.y) <= EPS && (Math.abs(a.y - node.y) <= TOL || Math.abs(a.y - (node.y + node.height)) <= TOL) && Math.min(Math.max(a.x, b.x), node.x + node.width) - Math.max(Math.min(a.x, b.x), node.x) > EPS
        const alongVertical = Math.abs(a.x - b.x) <= EPS && (Math.abs(a.x - node.x) <= TOL || Math.abs(a.x - (node.x + node.width)) <= TOL) && Math.min(Math.max(a.y, b.y), node.y + node.height) - Math.max(Math.min(a.y, b.y), node.y) > EPS
        if (alongHorizontal || alongVertical) {
          findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'boundary' })
          break
        }
      }
    }
    for (let j = i + 1; j < loops.length; j++) {
      const other = loops[j]!
      if (routesCrossOrOverlap(edge.points, other.points)) findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, conflictWith: edgeId(other), kind: 'route-route' })
      const edgeLabel = labelRect(edge, style)
      const otherLabel = labelRect(other, style)
      if (edgeLabel && otherLabel && edgeLabel.x < otherLabel.x + otherLabel.w && edgeLabel.x + edgeLabel.w > otherLabel.x && edgeLabel.y < otherLabel.y + otherLabel.h && edgeLabel.y + edgeLabel.h > otherLabel.y) {
        findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, conflictWith: edgeId(other), kind: 'label-label' })
      }
    }
    const ownLabel = labelRect(edge, style)
    if (ownLabel) {
      const labelHitsRoute = loops.some(route => route.points.some((point, index) => index > 0 && segmentHitsLoopLabel(route.points[index - 1]!, point, ownLabel)))
      if (labelHitsRoute) findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'label-route' })
    }
  }
  return findings
}
