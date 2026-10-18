// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { GanttLayoutResult } from '../gantt/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, fSpan, elementCertificates, canvasOf, retainedLabelGeometry } from './geometry.ts'

export function projectGanttPositioned({ positioned, options }: FamilyPositionedProjectionContext<GanttLayoutResult>): FamilyPositionedView {
  // Bars and milestones are the nodes; section bands are the groups. Verts
  // and ticks are markers, not boxes — they carry no node area. Milestones
  // report the diamond's true bounding box; the zero-width floor on bars is
  // pulled back inside the plot so a range-edge task never fakes a breach.
  const plotRight = positioned.plot.x + positioned.plot.w
  const nodes: RenderedLayoutNode[] = positioned.bars.map(b => {
    const id = b.id ?? `task#${b.taskIndex}`
    const at = b.labelPosition
    const textY = at && !positioned.compact && b.labelBlock ? at.y + (b.labelBlock.height - b.labelBlock.lineHeight) / 2 : at?.y
    const labelGeometry = at && textY !== undefined ? retainedLabelGeometry(b.labelBlock, at.x, textY, canvasOf(positioned), at.anchor) : {}
    if (b.milestoneX !== undefined) {
      const r = b.h / 2
      return { id, x: f(b.milestoneX - r), y: f(b.y), w: fSpan(b.milestoneX - r, b.h), h: fSpan(b.y, b.h), shape: 'diamond', label: b.label, ...labelGeometry }
    }
    const w = Math.max(2, b.w)
    const x = Math.min(b.x, plotRight - w)
    return { id, x: f(x), y: f(b.y), w: fSpan(x, w), h: fSpan(b.y, b.h), shape: 'rectangle', label: b.label, ...labelGeometry }
  })
  const groups: RenderedLayoutGroup[] = positioned.sections.map((s, i) => ({
    id: `section#${i}`,
    x: f(positioned.plot.x),
    y: f(s.y),
    w: fSpan(positioned.plot.x, positioned.plot.w),
    h: fSpan(s.y, s.h),
    members: positioned.bars.filter(b => b.sectionIndex === i).map(b => b.id ?? `task#${b.taskIndex}`),
    label: s.label,
  }))
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('gantt', layout, 'section-contained')
  return layout
}
