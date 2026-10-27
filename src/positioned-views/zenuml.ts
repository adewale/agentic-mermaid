import { projectSequencePositioned } from './sequence.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'

export function projectZenUMLPositioned(context: FamilyPositionedProjectionContext<PositionedSequenceDiagram>): FamilyPositionedView {
  const view = projectSequencePositioned(context)
  return { ...view, edges: view.edges.map(edge => {
    const route = edge.route
    return route && 'family' in route && route.family === 'sequence' ? { ...edge, route: { ...route, family: 'zenuml' as const } } : edge
  }) }
}
