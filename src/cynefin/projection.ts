import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { f, retainedLabelBounds, retainedLabelGeometry, canvasOf, labelRect } from '../positioned-views/geometry.ts'
import type { PositionedCynefin } from './types.ts'
export function projectCynefinPositioned({ positioned: chart }: FamilyPositionedProjectionContext<PositionedCynefin>): FamilyPositionedView {
  return { version: 1, bounds: { w: f(chart.width), h: f(chart.height) },
    nodes: chart.domains.flatMap(domain => domain.items.map(item => ({ id: item.id, parentId: domain.name, x: f(item.x - item.block.width / 2), y: f(item.y - item.block.height / 2), w: f(item.block.width), h: f(item.block.height), shape: 'rectangle', role: 'labelled-mark', label: item.text, ...retainedLabelGeometry(item.block, item.x, item.y, domain) }))),
    edges: chart.transitions.map(transition => ({ id: transition.id, from: transition.from, to: transition.to, path: transition.points.map(point => [f(point.x), f(point.y)]), ...(transition.label ? { label: { x: f(transition.label.x), y: f(transition.label.y), text: transition.label.text, bounds: retainedLabelBounds(transition.label.block, transition.label.x, transition.label.y) } } : {}) })),
    groups: chart.domains.map(domain => ({ id: domain.name, x: f(domain.x), y: f(domain.y), w: f(domain.width), h: f(domain.height), label: domain.heading.text, members: domain.items.map(item => item.id) })),
    labels: [...chart.domains.map(domain => ({ id: domain.heading.id, text: domain.heading.text, bounds: retainedLabelBounds(domain.heading.block, domain.heading.x, domain.heading.y), container: labelRect(domain) })), ...chart.transitions.flatMap(transition => transition.label ? [{ id: transition.label.id, text: transition.label.text, bounds: retainedLabelBounds(transition.label.block, transition.label.x, transition.label.y), container: labelRect(canvasOf(chart)) }] : []), ...(chart.title ? [{ id: 'title', text: chart.title.text, bounds: retainedLabelBounds(chart.title.block, chart.title.x, chart.title.y), container: labelRect(canvasOf(chart)) }] : [])],
  }
}
