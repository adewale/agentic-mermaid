// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedMindmapDiagram } from '../mindmap/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { Finite, RenderedLayoutEdge, RenderedLayoutNode } from '../agent/types.ts'
import { f, retainedLabelGeometry } from './geometry.ts'

export function projectMindmapPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedMindmapDiagram>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.nodes.map(node => ({
    id: node.id,
    x: f(node.x),
    y: f(node.y),
    w: f(node.width),
    h: f(node.height),
    shape: node.shape === 'circle' ? 'ellipse' : 'rectangle',
    label: node.label,
    ...retainedLabelGeometry(node.labelBlock, node.x + node.width / 2, node.y + node.height / 2 + (node.icon ? 5 : 0), node),
  }))
  const edges: RenderedLayoutEdge[] = positioned.edges.map((edge, index) => ({
    id: `edge#${index}:${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    path: edge.points.map(point => [f(point.x), f(point.y)] as [Finite, Finite]),
  }))
  return { version: 1, nodes, edges, groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
