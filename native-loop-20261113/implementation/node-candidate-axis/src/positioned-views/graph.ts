// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedGraph } from '../types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { positionedGraphToRenderedView } from '../agent/layout-to-rendered.ts'

export function projectGraphPositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedGraph>): FamilyPositionedView {
  return positionedGraphToRenderedView(positioned, options)
}
