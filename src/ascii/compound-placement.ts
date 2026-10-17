import type { AsciiGraph, AsciiNode, AsciiSubgraph } from './types.ts'
import { gridKey } from './types.ts'

interface Item { nodes: AsciiNode[]; width: number; height: number; order: number }

/** Membership is a placement constraint, not a bounding-box repair. Rebuild an
 * infeasible flat embedding as a tree of quotient graphs: a child container is
 * one atomic item at its parent's level, and expands only within that item. */
export function placeCompoundItems(graph: AsciiGraph): void {
  const bounds = (nodes: readonly AsciiNode[]) => ({
    left: Math.min(...nodes.map(node => node.gridCoord!.x)),
    right: Math.max(...nodes.map(node => node.gridCoord!.x + 2)),
    top: Math.min(...nodes.map(node => node.gridCoord!.y)),
    bottom: Math.max(...nodes.map(node => node.gridCoord!.y + 2)),
  })
  const interleaves = graph.subgraphs.some(group => {
    if (!group.nodes.length) return false
    const box = bounds(group.nodes)
    return graph.nodes.some(node => !group.nodes.includes(node)
      && node.gridCoord!.x <= box.right && node.gridCoord!.x + 2 >= box.left
      && node.gridCoord!.y <= box.bottom && node.gridCoord!.y + 2 >= box.top)
  })
  if (!interleaves) return
  graph.compoundRepacked = true

  const layout = (parent: AsciiSubgraph | null): Item => {
    const children = parent ? parent.children : graph.subgraphs.filter(group => !group.parent)
    const members = parent ? parent.nodes : graph.nodes
    const childMembers = new Set(children.flatMap(child => child.nodes))
    const items: Item[] = [
      ...children.map(layout),
      ...members.filter(node => !childMembers.has(node)).map(node => {
        node.gridCoord = { x: 0, y: 0 }
        return { nodes: [node], width: 3, height: 3, order: node.index }
      }),
    ].sort((a, b) => a.order - b.order)
    const itemOf = new Map(items.flatMap(item => item.nodes.map(node => [node, item] as const)))
    const incoming = new Map(items.map(item => [item, new Set<Item>()]))
    for (const edge of graph.edges) {
      const from = itemOf.get(edge.from), to = itemOf.get(edge.to)
      if (from && to && from !== to && edge.routeClass === 'primary-forward') incoming.get(to)!.add(from)
    }
    const levels = new Map<Item, number>(), pending = new Set(items)
    while (pending.size) {
      // Quotient cycles can arise even when the leaf graph is acyclic. Break
      // ties in source order; feedback affects routes, never membership.
      const ready = [...pending].find(item => [...incoming.get(item)!].every(from => !pending.has(from))) ?? [...pending][0]!
      levels.set(ready, Math.max(0, ...[...incoming.get(ready)!].map(from => (levels.get(from) ?? -1) + 1)))
      pending.delete(ready)
    }
    const dir = parent?.direction ?? graph.config.graphDirection
    const extents = new Map<number, number>()
    for (const item of items) {
      const level = levels.get(item)!
      extents.set(level, Math.max(extents.get(level) ?? 0, dir === 'LR' ? item.width : item.height))
    }
    const offsets = new Map<number, number>(), cross = new Map<number, number>()
    let along = 1
    for (const level of [...extents.keys()].sort((a, b) => a - b)) {
      offsets.set(level, along); along += extents.get(level)! + 2
    }
    let width = 1, height = 1
    for (const item of items) {
      const level = levels.get(item)!, perpendicular = cross.get(level) ?? 1
      const x = dir === 'LR' ? offsets.get(level)! : perpendicular
      const y = dir === 'LR' ? perpendicular : offsets.get(level)!
      for (const node of item.nodes) { node.gridCoord!.x += x; node.gridCoord!.y += y }
      cross.set(level, perpendicular + (dir === 'LR' ? item.height : item.width) + 2)
      width = Math.max(width, x + item.width + 1); height = Math.max(height, y + item.height + 1)
    }
    return { nodes: [...members], width, height, order: Math.min(...members.map(node => node.index)) }
  }
  layout(null)
  graph.grid.clear()
  for (const node of graph.nodes) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
    graph.grid.set(gridKey({ x: node.gridCoord!.x + dx, y: node.gridCoord!.y + dy }), node)
  }
}
