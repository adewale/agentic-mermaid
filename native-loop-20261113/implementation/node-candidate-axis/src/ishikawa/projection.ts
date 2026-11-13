import type { PositionedIshikawa } from './types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { f, retainedLabelBounds, retainedLabelGeometry, labelRect, canvasOf } from '../positioned-views/geometry.ts'

export function projectIshikawaPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedIshikawa>): FamilyPositionedView {
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.nodes.map(item => ({ id: item.node.id, x: f(item.x), y: f(item.y), w: f(item.width), h: f(item.height), shape: 'rectangle', label: item.node.label, role: item.depth <= 1 ? 'box' : 'labelled-mark', ...retainedLabelGeometry(item.block, item.x + item.width / 2, item.y + item.height / 2, item) })),
    edges: p.branches.map(branch => ({ id: branch.id, from: branch.from, to: branch.to, path: branch.points.map(point => [f(point.x), f(point.y)]) })),
    groups: [],
    labels: p.title ? [{ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) }] : [],
  }
}
