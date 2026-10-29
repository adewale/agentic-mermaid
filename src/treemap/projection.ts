import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { canvasOf, f, fSpan, labelRect, retainedLabelBounds, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import { hierarchyChildren } from '../shared/hierarchy-model.ts'
import type { PositionedTreemap } from './types.ts'

export function projectTreemapPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedTreemap>): FamilyPositionedView {
  const childrenByParent = hierarchyChildren(p.body.nodes)
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.cells
      .filter(cell => cell.node.value !== undefined)
      .map(cell => ({
        id: cell.node.id,
        ...(cell.node.parentId ? { parentId: cell.node.parentId } : {}),
        x: f(cell.x),
        y: f(cell.y),
        w: fSpan(cell.x, cell.width),
        h: fSpan(cell.y, cell.height),
        shape: 'rectangle',
        label: cell.node.label,
        role: 'mark',
        labelVisibility: cell.label ? 'visible' : 'hidden',
        ...(cell.label ? retainedLabelGeometry(cell.label, cell.x + cell.width / 2, cell.labelY!, cell) : {}),
      })),
    edges: [],
    groups: p.cells
      .filter(cell => cell.node.value === undefined)
      .map(cell => ({
        id: cell.node.id,
        ...(cell.node.parentId ? { parentId: cell.node.parentId } : {}),
        x: f(cell.x),
        y: f(cell.y),
        w: fSpan(cell.x, cell.width),
        h: fSpan(cell.y, cell.height),
        members: (childrenByParent.get(cell.node.id) ?? []).map(node => node.id),
        label: cell.node.label,
        regionKind: 'compartment',
      })),
    labels: [
      ...(p.title ? [{ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) }] : []),
      ...p.cells.flatMap(cell => [
        ...(cell.node.value === undefined && cell.label ? [{ id: `section-label:${cell.node.id}`, text: cell.label.text, bounds: retainedLabelBounds(cell.label, cell.x + cell.width / 2, cell.labelY!), container: labelRect(cell) }] : []),
        ...(cell.valueLabel ? [{ id: `value:${cell.node.id}`, text: cell.valueLabel.text, bounds: retainedLabelBounds(cell.valueLabel, cell.x + cell.width / 2, cell.valueY!), container: labelRect(cell) }] : []),
      ]),
    ],
  }
}
