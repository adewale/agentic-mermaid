// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedErDiagram } from '../er/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, fSpan, boxRouteCertificate, retainedLabelBounds, retainedLabelGeometry } from './geometry.ts'
import { ER_STYLE_DEFAULTS } from '../er/layout.ts'
import { separateRelationshipLabels, retainedErRelationshipLabels } from '../er/label-layout.ts'
import { resolveRenderStyle } from '../styles.ts'

export function projectErPositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedErDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.entities.map(e => ({
    id: e.id,
    x: f(e.x),
    y: f(e.y),
    w: fSpan(e.x, e.width),
    h: fSpan(e.y, e.height),
    shape: 'rectangle',
    label: e.label,
    ...retainedLabelGeometry(e.labelBlock, e.x + e.width / 2, e.y + e.headerHeight / 2, { ...e, height: e.headerHeight }),
  }))
  const boxById = new Map(positioned.entities.map(e => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]))
  const retained = retainedErRelationshipLabels(positioned)
  if (positioned.labelPlacement === 'shaft-aware' && !retained) throw new Error('ER_LABEL_LAYOUT_MISSING: project the complete native family layout artifact')
  const labelPositions = retained ?? separateRelationshipLabels(positioned, resolveRenderStyle({}, ER_STYLE_DEFAULTS))
  const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => {
    const at = labelPositions.get(r)
    return {
      id: `rel#${i}:${r.entity1}->${r.entity2}`,
      from: r.entity1,
      to: r.entity2,
      path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
      label: r.label && at ? { x: f(at.x), y: f(at.y), text: r.label, bounds: retainedLabelBounds(r.labelBlock, at.x, at.y) } : undefined,
      route: options.debug ? boxRouteCertificate('er', i, r.points, boxById.get(r.entity1), boxById.get(r.entity2)) : undefined,
    }
  })
  const groups: RenderedLayoutGroup[] = positioned.groups.map(group => ({
    id: group.id,
    x: f(group.x),
    y: f(group.y),
    w: fSpan(group.x, group.width),
    h: fSpan(group.y, group.height),
    members: [...positioned.entities.filter(entity => entity.groupId === group.id).map(entity => entity.id), ...positioned.groups.filter(child => child.parentId === group.id).map(child => child.id)],
    label: group.label,
    parentId: group.parentId,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
