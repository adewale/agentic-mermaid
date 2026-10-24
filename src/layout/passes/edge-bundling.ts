import type { Direction, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'

/**
 * Find all groups (outermost first) that geometrically contain the given point.
 */
function findGroupsContainingPoint(
  x: number, y: number,
  groups: PositionedGroup[]
): PositionedGroup[] {
  const result: PositionedGroup[] = []
  for (const g of groups) {
    if (x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height) {
      result.push(g)
      result.push(...findGroupsContainingPoint(x, y, g.children))
    }
  }
  return result
}

/**
 * Bundle contract (docs/design/system/route-contracts.md): a rebuilt trunk/branch
 * path may not pass through any node other than the edge's own endpoints.
 * The half-pixel tolerance lets a path graze a border without counting.
 */
function bundlePathClear(
  points: Point[],
  nodes: PositionedNode[],
  sourceId: string,
  targetId: string,
): boolean {
  for (const n of nodes) {
    if (n.id === sourceId || n.id === targetId) continue
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!
      const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
      const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
      if (xHi > n.x + 0.5 && xLo < n.x + n.width - 0.5 && yHi > n.y + 0.5 && yLo < n.y + n.height - 0.5) {
        return false
      }
    }
  }
  return true
}

/**
 * If `junction` falls inside a group that doesn't contain the reference node,
 * move it just outside the outermost such group boundary.
 */
function adjustJunctionForGroups(
  junctionMain: number,  // the junction coordinate along the flow axis (Y for TD, X for LR)
  refX: number,          // reference node center X (for finding its groups)
  refY: number,          // reference node center Y
  groups: PositionedGroup[],
  direction: Direction
): number {
  const GAP = 12
  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL

  // Groups containing the reference node
  const refGroupIds = new Set(findGroupsContainingPoint(refX, refY, groups).map(g => g.id))

  // Check where the junction point would be along the trunk
  const probeX = isHorizontal ? junctionMain : refX
  const probeY = isHorizontal ? refY : junctionMain
  const junctionGroups = findGroupsContainingPoint(probeX, probeY, groups)

  // Find outermost group containing the junction but NOT the reference node
  const crossingGroup = junctionGroups.find(g => !refGroupIds.has(g.id))
  if (!crossingGroup) return junctionMain

  // Move junction just outside this group
  if (isLR) return crossingGroup.x - GAP
  if (isRL) return crossingGroup.x + crossingGroup.width + GAP
  if (isBT) return crossingGroup.y + crossingGroup.height + GAP
  return crossingGroup.y - GAP // TD
}

/**
 * Bundle fan-out and fan-in edge paths so they share a common trunk segment.
 *
 * For fan-out (one source → N targets), all edges exit the source at the same
 * point, travel along a shared trunk, then branch to their individual targets.
 * The overlapping trunk segments render as a single visible line.
 *
 * Junction points are placed outside subgraph boundaries so branches split
 * before entering a group, not inside it.
 *
 * Constraints: edges in a bundle must share the same style and have no labels.
 * Self-loops and backward edges (against the graph direction) are excluded.
 *
 * Returns the set of edges whose paths the bundler owns, so the route-contract
 * pass never straightens a trunk-shared path.
 */
export function bundleEdgePaths(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  direction: Direction
): Set<PositionedEdge> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const processed = new Set<PositionedEdge>()

  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL

  // --- Fan-out: group edges by shared source ---
  const fanOutGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!fanOutGroups.has(edge.source)) fanOutGroups.set(edge.source, [])
    fanOutGroups.get(edge.source)!.push(edge)
  }

  for (const [sourceId, group] of fanOutGroups) {
    if (group.length < 2) continue

    const style = group[0]!.style
    if (group.some(e => e.label || e.style !== style)) continue

    const source = nodeMap.get(sourceId)
    if (!source) continue

    // Only bundle edges going in the forward direction
    const forward = group.filter(e => {
      const t = nodeMap.get(e.target)
      if (!t) return false
      if (isLR) return t.x > source.x + source.width
      if (isRL) return t.x + t.width < source.x
      if (isBT) return t.y + t.height < source.y
      return t.y > source.y + source.height // TD/TB
    })
    if (forward.length < 2) continue
    // A fan needs >= 2 distinct targets: duplicate edges to one target would
    // bundle onto byte-identical overlapping paths, hiding one of them.
    if (new Set(forward.map(e => e.target)).size < 2) continue

    const srcCX = source.x + source.width / 2
    const srcCY = source.y + source.height / 2

    // Bundle contract: rebuild candidate paths, drop any member whose path
    // would pass through a node (it keeps its ELK route and the route-contract
    // pass certifies it), and re-derive the junction from the members that
    // remain — until the bundle is clear or too small to exist.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.target)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const exitX = isLR ? source.x + source.width : source.x
        const exitY = srcCY

        const nearestX = isLR
          ? Math.min(...members.map(t => t.node.x))
          : Math.max(...members.map(t => t.node.x + t.node.width))
        let junctionX = exitX + (nearestX - exitX) / 2
        junctionX = adjustJunctionForGroups(junctionX, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = isLR ? target.x : target.x + target.width
          const entryY = target.y + target.height / 2
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const exitX = srcCX
        const exitY = isBT ? source.y : source.y + source.height

        const nearestY = isBT
          ? Math.max(...members.map(t => t.node.y + t.node.height))
          : Math.min(...members.map(t => t.node.y))
        let junctionY = exitY + (nearestY - exitY) / 2
        junctionY = adjustJunctionForGroups(junctionY, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = target.x + target.width / 2
          const entryY = isBT ? target.y + target.height : target.y
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      const clear = members.filter(m => bundlePathClear(candidates.get(m.edge)!, nodes, m.edge.source, m.edge.target))
      if (clear.length === members.length) {
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
        }
        retainConstructedBundleRoutes(members.map(member => member.edge), processed)
        break
      }
      members = clear
      if (new Set(members.map(m => m.edge.target)).size < 2) break
    }
  }

  // --- Fan-in: group edges by shared target (skip already-bundled edges) ---
  const fanInGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (processed.has(edge) || edge.source === edge.target) continue
    if (!fanInGroups.has(edge.target)) fanInGroups.set(edge.target, [])
    fanInGroups.get(edge.target)!.push(edge)
  }

  for (const [targetId, group] of fanInGroups) {
    if (group.length < 2) continue

    const style = group[0]!.style
    if (group.some(e => e.label || e.style !== style)) continue

    const target = nodeMap.get(targetId)
    if (!target) continue

    const forward = group.filter(e => {
      const s = nodeMap.get(e.source)
      if (!s) return false
      if (isLR) return s.x + s.width < target.x
      if (isRL) return s.x > target.x + target.width
      if (isBT) return s.y > target.y + target.height
      return s.y + s.height < target.y // TD/TB
    })
    if (forward.length < 2) continue
    // Same distinctness rule as fan-out, for duplicate edges from one source.
    if (new Set(forward.map(e => e.source)).size < 2) continue

    const tgtCX = target.x + target.width / 2
    const tgtCY = target.y + target.height / 2

    // Same bundle contract as fan-out: shrink the bundle until every rebuilt
    // path proves clear of other nodes.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.source)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const entryX = isLR ? target.x : target.x + target.width
        const entryY = tgtCY

        const farthestX = isLR
          ? Math.max(...members.map(s => s.node.x + s.node.width))
          : Math.min(...members.map(s => s.node.x))
        let junctionX = farthestX + (entryX - farthestX) / 2
        junctionX = adjustJunctionForGroups(junctionX, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = isLR ? src.x + src.width : src.x
          const exitY = src.y + src.height / 2
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const entryX = tgtCX
        const entryY = isBT ? target.y + target.height : target.y

        const farthestY = isBT
          ? Math.min(...members.map(s => s.node.y))
          : Math.max(...members.map(s => s.node.y + s.node.height))
        let junctionY = farthestY + (entryY - farthestY) / 2
        junctionY = adjustJunctionForGroups(junctionY, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = src.x + src.width / 2
          const exitY = isBT ? src.y : src.y + src.height
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      const clear = members.filter(m => bundlePathClear(candidates.get(m.edge)!, nodes, m.edge.source, m.edge.target))
      if (clear.length === members.length) {
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
        }
        retainConstructedBundleRoutes(members.map(member => member.edge), processed)
        break
      }
      members = clear
      if (new Set(members.map(m => m.edge.source)).size < 2) break
    }
  }

  return processed
}
