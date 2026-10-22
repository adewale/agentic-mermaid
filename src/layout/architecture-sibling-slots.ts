import type { ArchitectureDiagram, PositionedArchitectureEdge, PositionedArchitectureService } from '../architecture/types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'

/** Bounded final-route refinement of free sibling slots. Equal measured sizes
 * preserve container extents; fixed alignments and boundary ports stay owned
 * by their existing solvers. Every relationship participates in each score. */
export function improveArchitectureSiblingSlots(
  diagram: ArchitectureDiagram,
  services: PositionedArchitectureService[],
  edges: PositionedArchitectureEdge[],
  route: () => PositionedArchitectureEdge[],
  legal: () => boolean,
): PositionedArchitectureEdge[] {
  if (services.length > 16 || services.length + diagram.junctions.length + diagram.groups.length > 24 || edges.length > 32 || diagram.alignments.length
    || diagram.edges.some(edge => edge.label !== undefined || edge.source.boundary === 'group' || edge.target.boundary === 'group')) return edges
  // Private all-pair shaft check: synthetic grouping broadens the existing
  // parallel predicate without changing its tolerances or any public IDs.
  const sharedInk = (routes: PositionedArchitectureEdge[]) => {
    const ink = routes.map(({ points }) => ({ points, style: 'solid' as const, source: '', target: '_' }))
    return countOpposingRouteOverlaps(ink) || countParallelRouteOverlaps(ink)
  }
  let score = countPolylineCrossings(edges), attempts = 8
  if (!score || sharedInk(edges)) return edges
  for (let i = 0; i < services.length && attempts > 0 && score > 0; i++) {
    const a = services[i]!
    for (let j = i + 1; j < services.length && attempts > 0 && score > 0; j++) {
      const b = services[j]!
      if (a.parentId !== b.parentId || a.width !== b.width || a.height !== b.height) continue
      for (const axis of ['x', 'y'] as const) {
        if (attempts <= 0 || !score || a[axis] === b[axis]) continue
        attempts--
        const previous = a[axis]
        a[axis] = b[axis]; b[axis] = previous
        if (legal()) {
          const candidate = route(), value = countPolylineCrossings(candidate)
          if (value < score && !sharedInk(candidate) && candidate.every((edge, index) => edge.obstacleFree
            && (!edges[index]!.sourceFacesTarget || edge.sourceFacesTarget)
            && (!edges[index]!.targetFacesSource || edge.targetFacesSource))) {
            edges = candidate; score = value
            continue
          }
        }
        b[axis] = a[axis]; a[axis] = previous
      }
    }
  }
  return edges
}

