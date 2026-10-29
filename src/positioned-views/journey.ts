// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedJourneyDiagram } from '../journey/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, retainedLabelGeometry } from './geometry.ts'

export function projectJourneyPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedJourneyDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = []
  const groups: RenderedLayoutGroup[] = []
  for (const s of positioned.sections) {
    const memberIds: string[] = []
    for (const t of s.tasks) {
      nodes.push({ id: t.id, x: f(t.x), y: f(t.y), w: f(t.width), h: f(t.height), shape: 'rectangle', label: t.text,
        ...retainedLabelGeometry(t.block, t.textX, t.textY, t) })
      memberIds.push(t.id)
    }
    // The group is the section COLUMN (header band down through its task
    // boxes), not just the header rect — so groupContainment verifies the
    // real invariant: every task sits inside its own section span.
    const bottom = s.tasks.length > 0 ? Math.max(s.y + s.height, ...s.tasks.map(t => t.y + t.height)) : s.y + s.height
    groups.push({ id: s.id, x: f(s.x), y: f(s.y), w: f(s.width), h: f(bottom - s.y), members: memberIds, label: s.label })
  }
  return { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
