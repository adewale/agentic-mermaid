import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { canvasOf, f, fSpan, labelRect, retainedLabelBounds, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import type { PositionedTreeview } from './types.ts'

export function projectTreeviewPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedTreeview>): FamilyPositionedView {
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.rows.map(row => ({
      id: row.node.id,
      ...(row.node.parentId ? { parentId: row.node.parentId } : {}),
      x: f(row.x),
      y: f(row.y),
      w: fSpan(row.x, row.width),
      h: fSpan(row.y, row.height),
      shape: 'rectangle',
      role: 'labelled-mark',
      label: row.node.label,
      ...retainedLabelGeometry(row.label, row.labelX + row.label.width / 2, row.y + row.height / 2, row),
    })),
    edges: p.guides.map(guide => ({ id: guide.id, from: guide.from, to: guide.to, path: guide.points.map(point => [f(point.x), f(point.y)]) })),
    groups: [],
    labels: [
      ...(p.title ? [{ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) }] : []),
      ...p.rows.flatMap(row => (row.description ? [{ id: `description:${row.node.id}`, text: row.description.text, bounds: retainedLabelBounds(row.description, row.descriptionX! + row.description.width / 2, row.y + row.height / 2), container: labelRect(row) }] : [])),
    ],
  }
}
