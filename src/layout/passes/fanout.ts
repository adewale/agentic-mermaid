import type { Direction, MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { graphReachability, layoutFlow, nodeCrossCenter, nodeMainStart, rectsOverlap } from '../geometry.ts'
import { positionedEdgeForwardish, sameFlowLayer, nodeInsideGroups, flattenPositionedGroups, expandGroupsForMainShift, sourceEmissionPort, targetFlowPort, symmetricOffsets, doglegBetween, routeClearOfNodes } from './shared.ts'
import { terminalLabelRunLength, terminalLabelCorridorLength, assignBundledFanoutLabels } from './bundled-labels.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'

export function reassignBundledSiblingLabels(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  bundled: ReadonlySet<PositionedEdge>,
  direction: Direction,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!bundled.has(edge) || !edge.label || !positionedEdgeForwardish(edge, nodeMap, direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(edge)
  }
  for (const group of bySource.values()) {
    if (group.length < 2 || group.length > 3) continue
    if (new Set(group.map(edge => edge.target)).size < group.length) continue
    const sorted = [...group].sort((a, b) => {
      const aTarget = nodeMap.get(a.target)
      const bTarget = nodeMap.get(b.target)
      if (!aTarget || !bTarget) return (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0)
      return nodeCrossCenter(aTarget, direction) - nodeCrossCenter(bTarget, direction)
    })
    assignBundledFanoutLabels(sorted.map(edge => ({ edge, points: edge.points })), nodes, direction, style)
  }
}

export function applySymmetricFanoutEmissions(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
): void {
  const reaches = graphReachability(graph.edges)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(edge)
  }
  const f = layoutFlow(graph.direction)
  for (const [sourceId, raw] of bySource) {
    if (raw.length < 2 || raw.length > 3) continue
    const source = nodeMap.get(sourceId)
    if (!source || (source.shape !== 'rectangle' && source.shape !== 'diamond')) continue
    const sourceInGroup = nodeInsideGroups(source, groups)
    if (source.shape !== 'diamond' && sourceInGroup) continue
    const sorted = [...raw].sort((a, b) => nodeCrossCenter(nodeMap.get(a.target)!, graph.direction) - nodeCrossCenter(nodeMap.get(b.target)!, graph.direction))
    const targets = sorted.map(e => nodeMap.get(e.target)!).filter(Boolean)
    if (targets.length !== sorted.length) continue
    if (!targets.every(t => t.shape === 'rectangle' && (source.shape === 'diamond' || !nodeInsideGroups(t, groups)))) continue
    // Same-rank gate. Fan-out targets drift apart on the main axis when their
    // label widths differ ("warnings" 97px vs "ok" 60px → ~32px apart), so the
    // tolerance must clear that width-driven drift to see them as peers — while
    // staying below layerSpacing (48) so genuinely different ranks are still
    // rejected. The peer confirmation just below is the real safety net, so
    // loosening this gate cannot equalize non-peers. (Equalizing such peers is
    // exactly the symmetry the diamond/"warnings"/"ok" fan-out wants; verified
    // byte-identical on the corpus, which has no fan-out in the 28–40px band.)
    if (!sameFlowLayer(targets, graph.direction, 40)) continue
    if (!targets.every(t => edges.every(e => e.source !== t.id && (e.target !== t.id || e.source === source.id)))) continue
    let peer = true
    for (let i = 0; i < targets.length; i++) for (let j = 0; j < targets.length; j++) {
      if (i !== j && reaches(targets[i]!.id, targets[j]!.id)) peer = false
    }
    if (!peer) continue

    const oldTargets = targets.map(t => ({ t, x: t.x, y: t.y, width: t.width, height: t.height }))
    const oldGroups = flattenPositionedGroups(groups).map(group => ({ group, x: group.x, y: group.y, width: group.width, height: group.height }))
    const restoreGeometry = () => {
      for (const old of oldTargets) { old.t.x = old.x; old.t.y = old.y; old.t.width = old.width; old.t.height = old.height }
      for (const old of oldGroups) { old.group.x = old.x; old.group.y = old.y; old.group.width = old.width; old.group.height = old.height }
    }
    const maxWidth = Math.max(...targets.map(t => t.width))
    const maxHeight = Math.max(...targets.map(t => t.height))
    const axis = nodeCrossCenter(source, graph.direction)
    const rank = Math.min(...targets.map(t => nodeMainStart(t, graph.direction)))
    const spacing = (f.isHorizontal ? maxHeight : maxWidth) + 28
    const offsets = symmetricOffsets(targets.length, spacing)
    const sourceAlignedCross = source.shape === 'diamond'
      ? sorted.map((_, i) => sourceEmissionPort(source, graph.direction, i, sorted.length)[f.cross])
      : undefined
    const placeTargets = (crossCenters: number[]) => {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        target.width = maxWidth
        target.height = maxHeight
        if (f.isHorizontal) {
          target.x = rank
          target.y = crossCenters[i]! - maxHeight / 2
        } else {
          target.x = crossCenters[i]! - maxWidth / 2
          target.y = rank
        }
      }
    }
    placeTargets(sourceAlignedCross ?? offsets.map(offset => axis + offset))
    const targetIds = new Set(targets.map(t => t.id))
    const placementClear = (): boolean => {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        if (target.x < 0 || target.y < 0) return false
        for (let j = i + 1; j < targets.length; j++) {
          if (rectsOverlap(target, targets[j]!, 8)) return false
        }
      }
      for (const target of targets) {
        for (const other of nodes) {
          if (targetIds.has(other.id)) continue
          if (rectsOverlap(target, other, 8)) return false
        }
      }
      return true
    }
    let clear = placementClear()
    if (!clear && sourceAlignedCross) {
      placeTargets(offsets.map(offset => axis + offset))
      clear = placementClear()
    }
    if (!clear) {
      restoreGeometry()
      continue
    }

    const sourceEdge = f.isHorizontal
      ? (f.sourceSide === 'E' ? source.x + source.width : source.x)
      : (f.sourceSide === 'S' ? source.y + source.height : source.y)
    let targetEdge = f.isHorizontal
      ? (f.sign > 0 ? Math.min(...targets.map(t => t.x)) : Math.max(...targets.map(t => t.x + t.width)))
      : (f.sign > 0 ? Math.min(...targets.map(t => t.y)) : Math.max(...targets.map(t => t.y + t.height)))
    const requiredCorridor = Math.max(0, ...sorted.map(edge => terminalLabelCorridorLength(edge, graph.direction, style)))
    const currentCorridor = (targetEdge - sourceEdge) * f.sign
    if (requiredCorridor > currentCorridor + 0.001) {
      const delta = requiredCorridor - currentCorridor
      const targetRectsBeforeShift = targets.map(t => ({ x: t.x, y: t.y, width: t.width, height: t.height }))
      for (const target of targets) {
        if (f.isHorizontal) target.x += delta * f.sign
        else target.y += delta * f.sign
      }
      expandGroupsForMainShift(groups, targetRectsBeforeShift, graph.direction, delta)
      clear = placementClear()
      if (!clear) {
        restoreGeometry()
        continue
      }
      targetEdge = f.isHorizontal
        ? (f.sign > 0 ? Math.min(...targets.map(t => t.x)) : Math.max(...targets.map(t => t.x + t.width)))
        : (f.sign > 0 ? Math.min(...targets.map(t => t.y)) : Math.max(...targets.map(t => t.y + t.height)))
    }
    const requiredTerminalRun = Math.max(0, ...sorted.map(edge => terminalLabelRunLength(edge, graph.direction, style, sourceEdge, targetEdge)))
    const midpointElbow = sourceEdge + (targetEdge - sourceEdge) * 0.5
    const capacityElbow = targetEdge - f.sign * requiredTerminalRun
    const elbow = ((capacityElbow - midpointElbow) * f.sign < 0) ? capacityElbow : midpointElbow
    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    for (let i = 0; i < sorted.length; i++) {
      const edge = sorted[i]!
      const target = nodeMap.get(edge.target)!
      const points = doglegBetween(sourceEmissionPort(source, graph.direction, i, sorted.length), targetFlowPort(target, graph.direction), graph.direction, elbow)
      if (!routeClearOfNodes(points, nodes, new Set([edge.source, edge.target]))) { clear = false; break }
      proposed.push({ edge, points })
    }
    if (!clear) {
      restoreGeometry()
      continue
    }
    for (const { edge, points } of proposed) {
      edge.points = points
      edge.routeCertificate = undefined
    }
    retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
    assignBundledFanoutLabels(proposed, nodes, graph.direction, style)
  }
}
