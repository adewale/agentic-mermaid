import type { PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'

/** Translate all positioned geometry together so the public canvas origin is non-negative. */
export function translateGeometryToNonNegativeOrigin(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  padding: number,
): void {
  let minX = 0
  let minY = 0
  const visitGroup = (group: PositionedGroup): void => {
    minX = Math.min(minX, group.x)
    minY = Math.min(minY, group.y)
    for (const child of group.children) visitGroup(child)
  }
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
  }
  for (const group of groups) visitGroup(group)
  for (const edge of edges) {
    for (const point of edge.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
    }
    if (edge.labelPosition) {
      minX = Math.min(minX, edge.labelPosition.x)
      minY = Math.min(minY, edge.labelPosition.y)
    }
  }
  if (minX >= 0 && minY >= 0) return
  const dx = minX < 0 ? -minX + padding : 0
  const dy = minY < 0 ? -minY + padding : 0
  const moveGroup = (group: PositionedGroup): void => {
    group.x += dx
    group.y += dy
    for (const child of group.children) moveGroup(child)
  }
  for (const node of nodes) { node.x += dx; node.y += dy }
  for (const group of groups) moveGroup(group)
  for (const edge of edges) {
    for (const point of edge.points) { point.x += dx; point.y += dy }
    if (edge.labelPosition) { edge.labelPosition.x += dx; edge.labelPosition.y += dy }
  }
}
