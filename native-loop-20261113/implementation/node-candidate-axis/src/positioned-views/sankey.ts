// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedSankeyChart } from '../sankey/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutNode } from '../agent/types.ts'
import { f, fSpan, canvasOf, retainedLabelGeometry } from './geometry.ts'

export function projectSankeyPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedSankeyChart>): FamilyPositionedView {
  // Node rectangles are the boxes; the value-proportional link ribbons project
  // as edges along their centerline endpoints. The label IS the node identity
  // (the flowchart convention: bare authored ids, no synthetic prefix).
  const nodes: RenderedLayoutNode[] = positioned.nodes.map(node => ({
    id: node.label,
    x: f(node.x0),
    y: f(node.y0),
    w: fSpan(node.x0, node.x1 - node.x0),
    h: fSpan(node.y0, node.y1 - node.y0),
    shape: 'rectangle',
    label: node.label,
    role: 'labelled-mark' as const,
    ...retainedLabelGeometry(node.labelBlock, node.labelX, node.labelY, canvasOf(positioned), node.labelAnchor),
  }))
  const edges: RenderedLayoutEdge[] = positioned.links.map(link => ({
    id: link.id,
    from: link.source,
    to: link.target,
    path: link.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
  }))
  if (positioned.title) {
    const width = positioned.title.block?.width ?? 0
    const height = positioned.title.block?.height ?? 0
    nodes.push({
      id: positioned.title.id,
      x: f(positioned.title.x - width / 2),
      y: f(positioned.title.y - height / 2),
      w: f(width),
      h: f(height),
      shape: 'rectangle',
      label: positioned.title.text,
      role: 'labelled-mark',
      ...retainedLabelGeometry(positioned.title.block, positioned.title.x, positioned.title.y, canvasOf(positioned)),
    })
  }
  return { version: 1, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
