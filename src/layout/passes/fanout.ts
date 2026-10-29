import type { Direction, MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { graphReachability, layoutFlow, nodeCrossCenter, nodeMainStart, rectsOverlap } from '../geometry.ts'
import { positionedEdgeForwardish, sameFlowLayer, nodeInsideGroups, flattenPositionedGroups, rectInsideGroup, expandGroupsForMainShift, sourceEmissionPort, targetFlowPort, symmetricOffsets, doglegBetween, routeClearOfNodes } from './shared.ts'
import { terminalLabelRunLength, terminalLabelCorridorLength, assignBundledFanoutLabels } from './bundled-labels.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'
import { countPointPairCrossings } from '../../shared/edge-crossing-pair.ts'
import { terminalHookLength } from '../route-geometry.ts'
import { laneContextFor, straightLaneFor } from '../route-lanes.ts'
import { labelPaintClearance } from '../../route-contracts.ts'
import { labelHaloExtension, labelRect } from '../../shared/edge-label-geometry.ts'
import { labelSeatPaintContext } from '../graph-paint-support.ts'

/** A grouped fork cannot grow its corridor. Retain its existing readable
 * seats, or admit a complete replacement against the proposed route paint. */
function seatGroupedFanout(
  proposed: Array<{ edge: PositionedEdge; points: Point[] }>,
  nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[],
  direction: Direction, style: LabelMetricsStyle,
): boolean {
  let work = 4_000_000
  const paint = labelSeatPaintContext(nodes, edges, groups, style, units => (work -= units) >= 0)
  if (!paint) return false
  const clearance = labelPaintClearance({ nodes, edges, groups }, style)
  const ignored = new Set(proposed.map(({ edge }) => edge))
  const source = nodes.find(node => node.id === proposed[0]!.edge.source)!
  const containers = flattenPositionedGroups(groups).filter(group => rectInsideGroup(source, group))
  const admit = (edge: PositionedEdge, point: Point): boolean => {
    const rect = labelRect({ ...edge, labelPosition: point }, style)
    const halo = rect && clearance.clearPaintRect(rect, labelHaloExtension(edge, style.lineWidth ?? 1), edge)
    return !!halo && containers.every(group => halo.x > group.x && halo.y > group.y
      && halo.x + halo.w < group.x + group.width && halo.y + halo.h < group.y + group.height)
      && paint.clear(edge, point, new Map(), undefined, ignored)
  }
  const complete = () => proposed.every(({ edge }) => !edge.label || !!edge.labelPosition && paint.clear(edge, edge.labelPosition, new Map()))
  const retained = proposed.every(({ edge, points }) => {
    if (!edge.label) return true
    if (!edge.labelPosition || !admit(edge, edge.labelPosition)) return false
    const rect = labelRect(edge, style)!
    return points.some((b, i) => {
      if (!i) return false
      const a = points[i - 1]!
      return a.x === b.x && a.x >= rect.x && a.x <= rect.x + rect.w && rect.y >= Math.min(a.y, b.y) && rect.y + rect.h <= Math.max(a.y, b.y)
        || a.y === b.y && a.y >= rect.y && a.y <= rect.y + rect.h && rect.x >= Math.min(a.x, b.x) && rect.x + rect.w <= Math.max(a.x, b.x)
    })
  })
  return retained && complete() || assignBundledFanoutLabels(proposed, nodes, direction, style, false, admit) && complete()
}

export function reassignBundledSiblingLabels(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  bundled: ReadonlySet<PositionedEdge>,
  direction: Direction,
  style: LabelMetricsStyle,
  groups: PositionedGroup[] = [],
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
    const source = nodeMap.get(sorted[0]!.source)!
    if (source?.shape === 'rectangle' && nodeInsideGroups(source, groups)) {
      const proposed = sorted.map(edge => ({ edge: { ...edge }, points: edge.points }))
      const replacements = new Map(sorted.map((edge, i) => [edge, proposed[i]!.edge]))
      if (seatGroupedFanout(proposed, nodes, edges.map(edge => replacements.get(edge) ?? edge), groups, direction, style)) {
        sorted.forEach((edge, i) => { edge.labelPosition = proposed[i]!.edge.labelPosition })
      }
    } else assignBundledFanoutLabels(sorted.map(edge => ({ edge, points: edge.points })), nodes, direction, style)
  }
}

/** The ids of every group enclosing `node`, outermost first. */
function containingGroups(node: PositionedNode, groups: PositionedGroup[]): string {
  return flattenPositionedGroups(groups).filter(group => rectInsideGroup(node, group)).map(group => group.id).join('\u0000')
}

/** The forward edges of a fan-out the symmetric emitter owns, sorted by
 * target cross centre, or undefined. A rectangle or diamond source emits to
 * 2–3 rectangle leaves fed only by it, peers on one rank that do not reach
 * each other; a grouped rectangle source owns only targets in its groups.
 * `raw` is the source's forward edges. */
export function symmetricFanout(
  source: PositionedNode,
  raw: readonly PositionedEdge[],
  edges: readonly PositionedEdge[],
  nodeMap: ReadonlyMap<string, PositionedNode>,
  groups: PositionedGroup[],
  direction: Direction,
  reaches: (from: string, to: string) => boolean,
): PositionedEdge[] | undefined {
  if (raw.length < 2 || raw.length > 3) return undefined
  if (source.shape !== 'rectangle' && source.shape !== 'diamond') return undefined
  const routeOnly = source.shape !== 'diamond' && nodeInsideGroups(source, groups)
  const sorted = [...raw].sort((a, b) => nodeCrossCenter(nodeMap.get(a.target)!, direction) - nodeCrossCenter(nodeMap.get(b.target)!, direction))
  const targets = sorted.map(e => nodeMap.get(e.target)!).filter(Boolean)
  if (targets.length !== sorted.length) return undefined
  const scope = routeOnly ? containingGroups(source, groups) : ''
  if (!targets.every(t => t.shape === 'rectangle' && (routeOnly ? containingGroups(t, groups) === scope : source.shape === 'diamond' || !nodeInsideGroups(t, groups)))) return undefined
  // Same-rank gate. Fan-out targets drift apart on the main axis when their
  // label widths differ ("warnings" 97px vs "ok" 60px → ~32px apart), so the
  // tolerance must clear that width-driven drift to see them as peers — while
  // staying below layerSpacing (48) so genuinely different ranks are still
  // rejected. The peer confirmation just below is the real safety net, so
  // loosening this gate cannot equalize non-peers. (Equalizing such peers is
  // exactly the symmetry the diamond/"warnings"/"ok" fan-out wants; verified
  // byte-identical on the corpus, which has no fan-out in the 28–40px band.)
  if (!sameFlowLayer(targets, direction, 40)) return undefined
  if (!targets.every(t => edges.every(e => e.source !== t.id && (e.target !== t.id || e.source === source.id)))) return undefined
  for (let i = 0; i < targets.length; i++) for (let j = 0; j < targets.length; j++) {
    if (i !== j && reaches(targets[i]!.id, targets[j]!.id)) return undefined
  }
  return sorted
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
    const source = nodeMap.get(sourceId)
    const sorted = source && symmetricFanout(source, raw, edges, nodeMap, groups, graph.direction, reaches)
    if (!source || !sorted) continue
    const targets = sorted.map(e => nodeMap.get(e.target)!)
    // A grouped rectangle keeps ELK's target placement: moving a member would
    // need its group refitted. Its fork is still emitted symmetrically, with
    // one shared elbow and level label seats; the terminal runs follow the
    // targets where ELK centred them under the source.
    const routeOnly = source.shape !== 'diamond' && nodeInsideGroups(source, groups)
    if (routeOnly) {
      // The straightener's own lanes stand when they already mirror about the
      // source: a symmetric pair of straight lines needs no constructed fork.
      const { ctx, axis: laneAxis } = laneContextFor(nodes, edges, graph.direction, style, groups)
      const centre = nodeCrossCenter(source, graph.direction)
      const lanes = sorted.map(edge => straightLaneFor(edge, source, nodeMap.get(edge.target)!, ctx, laneAxis))
      if (lanes.every((lane, i) => lane !== null && Math.abs(lane - centre + (lanes[lanes.length - 1 - i]! - centre)) <= 1)) continue
    }

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
    if (!routeOnly) placeTargets(sourceAlignedCross ?? offsets.map(offset => axis + offset))
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
    let clear = routeOnly || placementClear()
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
    if (!routeOnly && requiredCorridor > currentCorridor + 0.001) {
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
    // Unmoved targets must still leave the source its own hook before the elbow.
    if (routeOnly && (elbow - sourceEdge) * f.sign < Math.max(...sorted.map(edge => terminalHookLength(style, edge, 'start'))) - 0.001) continue
    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    for (let i = 0; i < sorted.length; i++) {
      const edge = sorted[i]!
      const target = nodeMap.get(edge.target)!
      const points = doglegBetween(sourceEmissionPort(source, graph.direction, i, sorted.length), targetFlowPort(target, graph.direction), graph.direction, elbow)
      if (!routeClearOfNodes(points, nodes, new Set([edge.source, edge.target]))) { clear = false; break }
      proposed.push({ edge, points })
    }
    // Unmoved neighbours keep their routes; the rebuilt fork may not cross more of them.
    if (clear && routeOnly) {
      const foreign = edges.filter(edge => !raw.includes(edge) && edge.style !== 'invisible')
      const crossings = (route: Point[]) => foreign.reduce((sum, other) => sum + countPointPairCrossings(route, other.points), 0)
      clear = proposed.reduce((sum, { points }) => sum + crossings(points), 0) <= proposed.reduce((sum, { edge }) => sum + crossings(edge.points), 0)
    }
    if (!clear) {
      restoreGeometry()
      continue
    }
    // Route-only forks cannot enlarge their corridor. Prove the entire label
    // transaction against the proposed ink before replacing the live routes.
    const staged = proposed.map(({ edge, points }) => ({ edge: { ...edge, points }, points }))
    if (routeOnly && staged.some(({ edge }) => edge.label)) {
      const replacements = new Map(proposed.map(({ edge }, i) => [edge, staged[i]!.edge]))
      const peers = edges.map(edge => replacements.get(edge) ?? edge)
      if (!seatGroupedFanout(staged, nodes, peers, groups, graph.direction, style)) {
        restoreGeometry()
        continue
      }
    } else assignBundledFanoutLabels(staged, nodes, graph.direction, style)
    for (let i = 0; i < proposed.length; i++) {
      const { edge, points } = proposed[i]!
      edge.points = points
      edge.labelPosition = staged[i]!.edge.labelPosition
      edge.routeCertificate = undefined
    }
    retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
  }
}
