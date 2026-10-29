// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedArchitectureDiagram, PositionedArchitectureEdge, PositionedArchitectureGroup, PositionedArchitectureJunction, PositionedArchitectureService } from '../architecture/types.ts'
import type { FamilyEdgeRouteCertificate, Point } from '../types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, routeOrthogonal, bendCount, retainedLabelBounds, retainedLabelGeometry } from './geometry.ts'

export function projectArchitecturePositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedArchitectureDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = [
    ...positioned.services.map(s => ({
      id: s.id,
      x: f(s.x),
      y: f(s.y),
      w: f(s.width),
      h: f(s.height),
      shape: 'service',
      label: s.label,
      role: 'box' as const,
      ...(s.labelPosition ? retainedLabelGeometry(s.labelBlock, s.labelPosition.x, s.labelPosition.y, s, 'start') : {}),
    })),
    ...positioned.junctions.map(j => ({
      id: j.id,
      x: f(j.x),
      y: f(j.y),
      w: f(j.width),
      h: f(j.height),
      shape: 'circle' as const,
      label: undefined,
      role: 'mark' as const,
    })),
  ]
  const flatGroups = new Map<string, PositionedArchitectureGroup>()
  const groups: RenderedLayoutGroup[] = []
  const flatten = (g: PositionedArchitectureGroup): void => {
    flatGroups.set(g.id, g)
    groups.push({
      id: g.id,
      x: f(g.x),
      y: f(g.y),
      w: f(g.width),
      h: f(g.height),
      members: [...positioned.services.filter(service => service.parentId === g.id).map(service => service.id), ...positioned.junctions.filter(junction => junction.parentId === g.id).map(junction => junction.id)],
      label: g.label,
      parentId: g.parentId,
    })
    for (const c of g.children) flatten(c)
  }
  for (const g of positioned.groups) flatten(g)
  const serviceById = new Map(positioned.services.map(s => [s.id, s]))
  const junctionById = new Map(positioned.junctions.map(j => [j.id, j]))
  const edges: RenderedLayoutEdge[] = positioned.edges.map((e, i) => ({
    id: `edge#${i}:${e.source.id}->${e.target.id}`,
    from: e.source.id,
    to: e.target.id,
    path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: e.label && e.labelPosition ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label, bounds: retainedLabelBounds(e.labelBlock, e.labelPosition.x, e.labelPosition.y) } : undefined,
    route: options.debug ? architectureRouteCertificate(i, e, serviceById, junctionById, flatGroups) : undefined,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}

function architectureRouteCertificate(edgeIndex: number, edge: PositionedArchitectureEdge, services: Map<string, PositionedArchitectureService>, junctions: Map<string, PositionedArchitectureJunction>, groups: Map<string, PositionedArchitectureGroup>): FamilyEdgeRouteCertificate {
  const boundsFor = (endpoint: PositionedArchitectureEdge['source']) => {
    if (endpoint.boundary === 'group') {
      const service = services.get(endpoint.id)
      return service?.parentId ? groups.get(service.parentId) : undefined
    }
    return services.get(endpoint.id) ?? junctions.get(endpoint.id)
  }
  const sourceBounds = boundsFor(edge.source)
  const targetBounds = boundsFor(edge.target)
  const first = edge.points[0]
  const last = edge.points[edge.points.length - 1]
  const sourceAnchored = !!(first && sourceBounds && pointOnSide(first, sourceBounds, edge.source.side, 1))
  const targetAnchored = !!(last && targetBounds && pointOnSide(last, targetBounds, edge.target.side, 1))
  const orthogonal = routeOrthogonal(edge.points)
  return {
    family: 'architecture',
    edgeIndex,
    routeClass: 'family-layout',
    invariant: sourceAnchored && targetAnchored && orthogonal && edge.obstacleFree ? 'side-anchored' : 'unverified-family-route',
    bendCount: bendCount(edge.points),
    orthogonal,
    sourceSide: edge.source.side,
    targetSide: edge.target.side,
    sourceBoundary: edge.source.boundary,
    targetBoundary: edge.target.boundary,
    sourceAnchored,
    targetAnchored,
    placement: edge.placement,
    sourceFacesTarget: edge.sourceFacesTarget,
    targetFacesSource: edge.targetFacesSource,
    obstacleFree: edge.obstacleFree,
  }
}

function pointOnSide(point: Point, bounds: { x: number; y: number; width: number; height: number }, side: 'L' | 'R' | 'T' | 'B', tol: number): boolean {
  switch (side) {
    case 'L':
      return Math.abs(point.x - bounds.x) <= tol && point.y >= bounds.y - tol && point.y <= bounds.y + bounds.height + tol
    case 'R':
      return Math.abs(point.x - (bounds.x + bounds.width)) <= tol && point.y >= bounds.y - tol && point.y <= bounds.y + bounds.height + tol
    case 'T':
      return Math.abs(point.y - bounds.y) <= tol && point.x >= bounds.x - tol && point.x <= bounds.x + bounds.width + tol
    case 'B':
      return Math.abs(point.y - (bounds.y + bounds.height)) <= tol && point.x >= bounds.x - tol && point.x <= bounds.x + bounds.width + tol
  }
}
