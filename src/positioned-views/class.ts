// Pure positioned-artifact projection shared by graphical and agent adapters.

import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import type { PositionedClassDiagram } from '../class/types.ts'
import { boxRouteCertificate, f, fSpan, retainedLabelBounds, retainedLabelGeometry } from './geometry.ts'

export function projectClassPositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedClassDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.classes.map(c => {
    const box = c.interfaceBox ?? c
    return {
      id: c.id,
      x: f(box.x),
      y: f(box.y),
      w: fSpan(box.x, box.width),
      h: fSpan(box.y, box.height),
      shape: c.isInterface ? 'circle' : 'rectangle',
      label: c.label,
      ...retainedLabelGeometry(c.labelBlock, c.x + c.width / 2, c.y + c.headerHeight / 2 + (c.annotation ? 6 : 0), { ...c, height: c.headerHeight }),
    }
  })
  const boxById = new Map(positioned.classes.map(c => [c.id, c.interfaceBox ?? { x: c.x, y: c.y, width: c.width, height: c.height }]))
  const edges: RenderedLayoutEdge[] = positioned.relationships.map((r, i) => ({
    id: `rel#${i}:${r.from}->${r.to}`,
    from: r.from,
    to: r.to,
    path: r.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: r.label && r.labelPosition ? { x: f(r.labelPosition.x), y: f(r.labelPosition.y - 8), text: r.label, bounds: retainedLabelBounds(r.labelBlock, r.labelPosition.x, r.labelPosition.y - 8) } : undefined,
    route: options.debug ? boxRouteCertificate('class', i, r.points, boxById.get(r.from), boxById.get(r.to)) : undefined,
  }))
  // Namespaces are groups whose members are their directly-declared classes
  // (the family rubric's group-containment axis judges them).
  const groups: RenderedLayoutGroup[] = positioned.namespaces.map(ns => ({
    id: ns.id,
    x: f(ns.x),
    y: f(ns.y),
    w: fSpan(ns.x, ns.width),
    h: fSpan(ns.y, ns.height),
    members: [...ns.classIds],
    label: ns.label,
    parentId: ns.parentId,
  }))
  return { version: 1, nodes, edges, groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
