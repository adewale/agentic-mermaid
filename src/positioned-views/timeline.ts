// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedTimelineDiagram } from '../timeline/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, elementCertificates, retainedLabelGeometry } from './geometry.ts'

export function projectTimelinePositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedTimelineDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = []
  const groups: RenderedLayoutGroup[] = []
  for (const section of positioned.sections) {
    const members: string[] = []
    for (const period of section.periods) {
      const periodId = `${period.id}:period`
      nodes.push({
        id: periodId,
        x: f(period.pillX),
        y: f(period.pillY),
        w: f(period.pillWidth),
        h: f(period.pillHeight),
        shape: 'rounded',
        label: period.label,
        ...retainedLabelGeometry(period.block, period.centerX, period.pillY + period.pillHeight / 2, { x: period.pillX, y: period.pillY, width: period.pillWidth, height: period.pillHeight }),
      })
      members.push(periodId)
      for (const event of period.events) {
        nodes.push({
          id: event.id,
          x: f(event.x),
          y: f(event.y),
          w: f(event.width),
          h: f(event.height),
          shape: 'rectangle',
          label: event.text,
          ...(event.labelX === undefined ? {} : retainedLabelGeometry(event.block, event.labelX, event.y + event.height / 2, event, 'start')),
        })
        members.push(event.id)
      }
    }
    if (section.framed) {
      groups.push({ id: section.id, x: f(section.x), y: f(section.y), w: f(section.width), h: f(section.height), members, label: section.label })
    }
  }
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('timeline', layout, 'timeline-interval')
  return layout
}
