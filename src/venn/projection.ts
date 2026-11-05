import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/family-registry.ts'
import { f, retainedLabelBounds, labelRect, canvasOf } from '../positioned-views/geometry.ts'
import type { PositionedVenn } from './types.ts'

export function projectVennPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedVenn>): FamilyPositionedView {
  const nodes: FamilyPositionedView['nodes'] = p.circles.map(circle => ({
    id: circle.id,
    x: f(circle.x - circle.r),
    y: f(circle.y - circle.r),
    w: f(circle.r * 2),
    h: f(circle.r * 2),
    shape: 'circle',
    role: 'labelled-mark',
    label: p.body.subsets.find(subset => subset.sets.length === 1 && subset.sets[0] === circle.id)?.label ?? circle.id,
  }))
  for (const owner of [...p.regions.map(region => region.id), ...p.body.textNodes.map(node => node.id)]) {
    const labels = p.labels.filter(label => label.ownerId === owner)
    if (!labels.length) continue
    const bounds = labels.map(label => retainedLabelBounds(label.block, label.x, label.y)!)
    const x = Math.min(...bounds.map(bound => bound.x)),
      y = Math.min(...bounds.map(bound => bound.y))
    const right = Math.max(...bounds.map(bound => bound.x + bound.w)),
      bottom = Math.max(...bounds.map(bound => bound.y + bound.h))
    nodes.push({ id: owner, x: f(x), y: f(y), w: f(right - x), h: f(bottom - y), shape: 'text', role: 'labelled-mark', label: labels.map(label => label.text).join('\n') })
  }
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes,
    edges: [],
    groups: [],
    labels: [
      ...p.labels.map(label => ({ id: label.id, text: label.text, bounds: retainedLabelBounds(label.block, label.x, label.y), container: labelRect(canvasOf(p)) })),
      ...(p.title ? [{ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) }] : []),
    ],
  }
}
