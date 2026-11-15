import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { positionedGraphToRenderedView, retainedLabelGeometry } from '../agent/layout-to-rendered.ts'
import type { PositionedUsecase } from './types.ts'

/** Actors put their prepared labels below the silhouette. The inspection
 * projection uses the same placement as drawing, within its measured envelope. */
export function projectUsecasePositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedUsecase>): FamilyPositionedView {
  const view = positionedGraphToRenderedView(positioned, options)
  const actors = new Map(positioned.body.nodes.filter(node => node.kind === 'actor').map(node => [node.id, node]))
  const placed = new Map(positioned.nodes.map(node => [node.id, node]))
  for (const node of view.nodes) {
    const actor = actors.get(node.id),
      geometry = placed.get(node.id)
    if (!actor || !geometry?.labelBlock) continue
    Object.assign(node, retainedLabelGeometry(geometry.labelBlock, geometry.x + geometry.width / 2, geometry.y + geometry.height - geometry.labelBlock.height / 2 - (actor.icon ? 24 : 8), geometry))
  }
  return view
}
