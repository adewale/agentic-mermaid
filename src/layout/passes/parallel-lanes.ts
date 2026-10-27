import type { ResolvedRenderStyle } from '../../styles.ts'
import { measureLabelConflicts } from '../label-conflicts.ts'
import type { Direction, MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { countEdgeCrossings, countParallelRouteOverlaps, onShapeOutline } from '../../layout-rubric.ts'
import { PORT_EXACT, simplifyPolyline } from '../../route-contracts.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { calculatePathMidpoint, layoutFlow, nodeCrossSize, rectsOverlap } from '../geometry.ts'
import { nodeInsideGroups, routeClearOfNodes } from './shared.ts'
import { labelBoxAt, longestSegmentMidpoint, readableLabelGap, bundledLabelCandidates } from './bundled-labels.ts'
import type { BundledLabelCandidate } from './bundled-labels.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'
import { labelHaloExtension } from '../../shared/edge-label-geometry.ts'
import { graphEdgeMarkerPaintRegions } from '../../graph-connectors.ts'

export function segmentIntersectsLabelBox(a: Point, b: Point, box: { x: number; y: number; w: number; h: number }, pad = 2): boolean {
  const x1 = box.x - pad, x2 = box.x + box.w + pad, y1 = box.y - pad, y2 = box.y + box.h + pad
  if (Math.abs(a.x - b.x) < 0.01) {
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y)
    return a.x >= x1 && a.x <= x2 && hi >= y1 && lo <= y2
  }
  if (Math.abs(a.y - b.y) < 0.01) {
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x)
    return a.y >= y1 && a.y <= y2 && hi >= x1 && lo <= x2
  }
  return false
}

export function labelTouchesNeighborRoute(edge: PositionedEdge, labelBox: { x: number; y: number; w: number; h: number }, edges: PositionedEdge[]): boolean {
  for (const other of edges) {
    if (other === edge) continue
    for (let i = 1; i < other.points.length; i++) {
      if (segmentIntersectsLabelBox(other.points[i - 1]!, other.points[i]!, labelBox)) return true
    }
  }
  return false
}

export function parallelRoutesCross(first: Point[], second: Point[]): boolean {
  for (let i = 1; i < first.length; i++) for (let j = 1; j < second.length; j++) {
    const a = first[i - 1]!, b = first[i]!, c = second[j - 1]!, d = second[j]!
    const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
    if (Math.abs(det) < 1e-9) continue
    const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det
    const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det
    if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) return true
  }
  return false
}

export function symmetricParallelOuterLanePoints(source: PositionedNode, target: PositionedNode, direction: Direction, lane: number, index: number, count: number, sourceFraction = (index + 1) / (count + 1), targetFraction = sourceFraction): Point[] {
  const f = layoutFlow(direction)
  if (f.isHorizontal) {
    const p: Point = { x: f.sourceSide === 'E' ? source.x + source.width : source.x, y: source.y + source.height * sourceFraction }
    const q: Point = { x: f.targetSide === 'W' ? target.x : target.x + target.width, y: target.y + target.height * targetFraction }
    const gap = Math.min(28, Math.max(14, Math.abs(q.x - p.x) * 0.18))
    const x1 = p.x + f.sign * gap
    const x2 = q.x - f.sign * gap
    return simplifyPolyline([p, { x: x1, y: p.y }, { x: x1, y: lane }, { x: x2, y: lane }, { x: x2, y: q.y }, q])
  }
  const p: Point = { x: source.x + source.width * sourceFraction, y: f.sourceSide === 'S' ? source.y + source.height : source.y }
  const q: Point = { x: target.x + target.width * targetFraction, y: f.targetSide === 'N' ? target.y : target.y + target.height }
  const gap = Math.min(28, Math.max(14, Math.abs(q.y - p.y) * 0.18))
  const y1 = p.y + f.sign * gap
  const y2 = q.y - f.sign * gap
  return simplifyPolyline([p, { x: p.x, y: y1 }, { x: lane, y: y1 }, { x: lane, y: y2 }, { x: q.x, y: y2 }, q])
}

export function applySymmetricParallelEdgeLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  const byPair = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target || !edge.label) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target || !PORT_EXACT.has(source.shape)
      || !PORT_EXACT.has(target.shape)) continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    const key = `${edge.source}\0${edge.target}`
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key)!.push(edge)
  }
  for (const group of byPair.values()) {
    group.sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
    if (group.length !== 2) continue
    const source = nodeMap.get(group[0]!.source)!
    const target = nodeMap.get(group[0]!.target)!
    const labelBoxes = group.map(edge => labelBoxAt(edge, { x: 0, y: 0 }, style))
    const labelWidths = labelBoxes.map(box => box.width)
    const labelHeights = labelBoxes.map(box => box.height)
    const lanePadding = (f.isHorizontal ? Math.max(...labelHeights) : Math.max(...labelWidths)) / 2 + 18
    const gaps = [lanePadding, lanePadding + 16, lanePadding + 32, lanePadding + 52]
    const slots = [[1 / 3, 2 / 3], [1 / 6, 1 / 3], [2 / 3, 5 / 6]]
    const attempts = gaps.map(gap => ({
      lanes: f.isHorizontal
        ? [Math.min(source.y, target.y) - gap, Math.max(source.y + source.height, target.y + target.height) + gap]
        : [Math.min(source.x, target.x) - gap, Math.max(source.x + source.width, target.x + target.width) + gap],
      sourceSlots: slots[0]!, targetSlots: slots[0]!,
    }))
    // A feeder or feedback edge can occupy one outside lane. Keep the other
    // outside lane and try an inside lane with both arrivals on the free half
    // of the target face, rather than wrapping across that neighboring route.
    if (source.shape === 'diamond') for (const attempt of [...attempts]) {
      for (const sourceSlots of slots) for (const targetSlots of slots) {
        const targetLanes = targetSlots.map(slot => target[f.cross] + nodeCrossSize(target, graph.direction) * slot)
        const sourceLanes = sourceSlots.map(slot => source[f.cross] + nodeCrossSize(source, graph.direction) * slot)
        for (const lanes of [attempt.lanes, [attempt.lanes[0]!, targetLanes[1]!], [targetLanes[0]!, attempt.lanes[1]!], [attempt.lanes[0]!, sourceLanes[1]!], [sourceLanes[0]!, attempt.lanes[1]!]]) {
          attempts.push({ lanes, sourceSlots, targetSlots })
        }
      }
    }
    for (const { lanes, sourceSlots, targetSlots } of attempts) {
      const proposed: Array<{ edge: PositionedEdge; points: Point[]; label: Point }> = []
      let ok = true
      for (let i = 0; i < group.length; i++) {
        const edge = group[i]!
        const points = simplifyPolyline(clipEdgeToShape(
          clipEdgeToShape(symmetricParallelOuterLanePoints(source, target, graph.direction, lanes[i]!, i, group.length, sourceSlots[i], targetSlots[i]), source, true),
          target, false,
        ))
        if (!onShapeOutline(source, points[0]!) || !onShapeOutline(target, points.at(-1)!)) { ok = false; break }
        if (!routeClearOfNodes(points, nodes, new Set([source.id, target.id]))) { ok = false; break }
        proposed.push({ edge, points, label: longestSegmentMidpoint(points) })
      }
      if (!ok) continue
      if (source.shape === 'diamond') {
        const neighbors = edges.filter(edge => !group.includes(edge))
        if (parallelRoutesCross(proposed[0]!.points, proposed[1]!.points) || proposed.some(p => neighbors.some(edge => parallelRoutesCross(p.points, edge.points)))) continue
        const candidateSets = proposed.map(p => {
          const routes = [...neighbors, ...proposed.filter(other => other !== p).map(other => ({ ...other.edge, points: other.points }))]
          return bundledLabelCandidates(p.edge, p.points, nodes, graph.direction, style)
            .filter(candidate => !labelTouchesNeighborRoute(p.edge, { x: candidate.box.x, y: candidate.box.y, w: candidate.box.width, h: candidate.box.height }, routes))
        })
        let labels: [BundledLabelCandidate, BundledLabelCandidate] | undefined
        for (const first of candidateSets[0]!) {
          const second = candidateSets[1]!.find(candidate => !rectsOverlap(first.box, candidate.box, readableLabelGap(style)))
          if (second) { labels = [first, second]; break }
        }
        if (!labels) continue
        proposed[0]!.label = labels[0].point
        proposed[1]!.label = labels[1].point
      }
      for (const p of proposed) {
        const box = labelBoxAt(p.edge, p.label, style)
        if (source.shape !== 'diamond' && labelTouchesNeighborRoute(p.edge, { x: box.x, y: box.y, w: box.width, h: box.height }, edges)) ok = false
      }
      if (!ok || !parallelLaneProposalAllowed(edges, proposed)) continue
      for (const { edge, points, label } of proposed) {
        edge.points = points
        edge.labelPosition = label
        edge.routeCertificate = undefined
      }
      retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
      break
    }
  }
}

/**
 * Parallel-lane contract for duplicate same-direction edges (a multigraph:
 * `A --> B` written two or more times). ELK + the port allocator fan the
 * endpoints across a node side, but only a few pixels apart, and the
 * per-edge bends stack at the same column — a cramped near-overlapping
 * double line. The graph-drawing convention (yFiles ParallelEdgeRouter; OGDF's
 * Kandinsky "center straight, neighbours offset" model) is to route the group
 * as EVENLY-SEPARATED parallel orthogonal lanes. We do exactly that here:
 *
 *  - spread both endpoints across distinct, evenly-spaced slots on the shared
 *    flow sides (separation clamped to fit the shorter side, so endpoints stay
 *    on the outline — verified with the same `onShapeOutline` oracle the tests
 *    use), and
 *  - when the nodes are offset on the cross axis, give each edge its own jog
 *    column (staggered by the lane separation) so the vertical segments run
 *    parallel instead of overlapping.
 *
 * Scoped to the rare duplicate-pair case: only UNLABELED, forward, side-to-side
 * pairs between PORT_EXACT shapes outside any group. Mixed labeled/unlabeled
 * duplicates use private lanes below. Fully labeled pairs are owned by
 * `applySymmetricParallelEdgeLanes`; other cases remain with route certification.
 */
type ParallelLaneProposal = { edge: PositionedEdge; points: Point[]; label?: Point }
type ParallelLabelClearance = { nodes: PositionedNode[]; style: ResolvedRenderStyle }

function parallelLaneLabelAdmission(edges: PositionedEdge[], proposed: ParallelLaneProposal[], clearance: ParallelLabelClearance): boolean {
  const proposals = new Map(proposed.map(candidate => [candidate.edge, candidate]))
  const involved = new Set<number>()
  const candidate = edges.map((edge, index) => {
    const proposal = proposals.get(edge)
    if (!proposal) return edge
    involved.add(index)
    // Prove exactly the seat the publisher will use. A guessed midpoint may
    // reject a safe seat or certify geometry that will never be emitted.
    return { ...edge, points: proposal.points, labelPosition: proposal.label }
  })
  const { nodes, style } = clearance
  return measureLabelConflicts({ nodes, edges: candidate }, style, involved).total <= measureLabelConflicts({ nodes, edges }, style, involved).total
}

function parallelLaneProposalAllowed(edges: PositionedEdge[], proposed: ParallelLaneProposal[], options?: { allowCrossingsForOverlap: boolean; labelClearance?: ParallelLabelClearance }): boolean {
  const points = new Map(proposed.map(candidate => [candidate.edge, candidate.points]))
  const involved = new Set<number>()
  const candidate = edges.map((edge, index) => {
    const route = points.get(edge)
    if (!route) return edge
    involved.add(index)
    return { ...edge, points: route }
  })
  if (options?.labelClearance && !parallelLaneLabelAdmission(edges, proposed, options.labelClearance)) return false
  const extraCrossings = countEdgeCrossings(candidate, involved) - countEdgeCrossings(edges, involved)
  if (!options?.allowCrossingsForOverlap) return extraCrossings <= 0
  const repairedPairs = countParallelRouteOverlaps(edges, involved) - countParallelRouteOverlaps(candidate, involved)
  if (repairedPairs < 0) return false
  if (extraCrossings <= 0) return true
  // Evaluate this proposal alone: unrelated bucket improvements cannot pay for
  // a crossing introduced solely to reduce bends or move preferred ports.
  return extraCrossings <= repairedPairs
}

export function applyParallelDuplicateLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
  preserveLabels?: ResolvedRenderStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  const TARGET_SEP = 14
  const MARGIN = 5
  const BASE_GAP = 16
  const proposalOptions = { allowCrossingsForOverlap: true,
    ...(preserveLabels ? { labelClearance: { nodes, style: preserveLabels } } : {}) }
  const mainSize = (n: PositionedNode) => (f.isHorizontal ? n.width : n.height)
  const crossSize = (n: PositionedNode) => (f.isHorizontal ? n.height : n.width)
  const mk = (mainVal: number, crossVal: number): Point =>
    f.isHorizontal ? { x: mainVal, y: crossVal } : { x: crossVal, y: mainVal }

  // Target-centric fan-in distribution. We bucket every side-to-side, unlabeled
  // edge by the hub it enters — not just by directed pair — because a duplicate
  // band is only readable if the OTHER edges sharing that hub's entry face are
  // spread with it. Distributing the whole bucket fixes three defects the old
  // pair-only pass left behind:
  //   - crowding/crossing: a third distinct feeder (e.g. N4->N3 in issue #62)
  //     used to land inside a separated duplicate band, crossing through it;
  //   - silent collapse: when a hub had other feeders the pair-only pass often
  //     bailed, leaving ELK's overlap so the duplicates rendered as one line;
  //   - tight feedback pairs: a duplicate BACK-edge entered the hub's flow-exit
  //     face at ~6px because neither lane pass owned it.
  // Forward edges enter the hub's flow-facing side; feedback (back) edges enter
  // the opposite, flow-exit side. We handle the two faces as independent buckets
  // with mirrored exit/entry sides and jog direction. Gated on a genuine
  // duplicate (same source >= 2) per face, so pure distinct-peer fan-in is left
  // to the merge-centering pass (issue #26 WS3).
  const highSide = (n: PositionedNode) => n[f.main] + mainSize(n)
  const lowSide = (n: PositionedNode) => n[f.main]
  const sourceOnHigh = f.sourceSide === 'E' || f.sourceSide === 'S'
  const targetOnLow = f.targetSide === 'W' || f.targetSide === 'N'
  // Forward uses the flow sides; feedback uses their opposites.
  const exitSide = (n: PositionedNode, back: boolean) => (sourceOnHigh !== back ? highSide(n) : lowSide(n))
  const entrySide = (n: PositionedNode, back: boolean) => (targetOnLow !== back ? lowSide(n) : highSide(n))
  const preSeparated = new Set<PositionedEdge>()
  const routesShareCollinearRun = (a: PositionedEdge, b: PositionedEdge): boolean => {
    for (let i = 1; i < a.points.length; i++) {
      const a0 = a.points[i - 1]!, a1 = a.points[i]!
      const aVertical = Math.abs(a0.x - a1.x) < 0.5
      const aHorizontal = Math.abs(a0.y - a1.y) < 0.5
      if (!aVertical && !aHorizontal) continue
      for (let j = 1; j < b.points.length; j++) {
        const b0 = b.points[j - 1]!, b1 = b.points[j]!
        if (aVertical) {
          if (Math.abs(b0.x - b1.x) >= 0.5 || Math.abs(a0.x - b0.x) >= 1) continue
          const overlap = Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) -
            Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y))
          if (overlap > 1) return true
        } else if (aHorizontal) {
          if (Math.abs(b0.y - b1.y) >= 0.5 || Math.abs(a0.y - b0.y) >= 1) continue
          const overlap = Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) -
            Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x))
          if (overlap > 1) return true
        }
      }
    }
    return false
  }

  // Mixed labeled+unlabeled duplicates used to fall through every pre-freeze
  // lane splitter: the labeled member was not eligible for duplicate lanes,
  // and the lone unlabeled member was not a duplicate by itself. The
  // post-freeze shared-trunk label repair then had to reroute geometry. Own the
  // exact-pair case here instead, before route certificates are issued.
  const byDirectedPair = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!PORT_EXACT.has(source.shape) || !PORT_EXACT.has(target.shape)) continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    const forwardGap = (entrySide(target, false) - exitSide(source, false)) * f.sign
    const feedbackGap = (exitSide(source, true) - entrySide(target, true)) * f.sign
    if (forwardGap <= BASE_GAP && feedbackGap <= BASE_GAP) continue
    const key = `${edge.source}\0${edge.target}`
    if (!byDirectedPair.has(key)) byDirectedPair.set(key, [])
    byDirectedPair.get(key)!.push(edge)
  }

  const haloBoxAt = (edge: PositionedEdge, point: Point) => {
    const box = labelBoxAt(edge, point, style), halo = labelHaloExtension(edge, style.lineWidth ?? 1)
    return { x: box.x - halo, y: box.y - halo, width: box.width + 2 * halo, height: box.height + 2 * halo }
  }
  const separateMixedPair = (bucket: PositionedEdge[], back: boolean, sep: number, placement: 'source' | 'target' | 'original'): boolean => {
    bucket.sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
    const source = nodeMap.get(bucket[0]!.source)!
    const target = nodeMap.get(bucket[0]!.target)!
    const exitMain = exitSide(source, back)
    const entryMain = entrySide(target, back)
    const k = bucket.length
    if (sep < 4) return false
    const fromTarget = placement === 'target'
    const sourceCenter = source[f.cross] + crossSize(source) / 2
    const targetCenter = target[f.cross] + crossSize(target) / 2

    const lanes: Array<{ edge: PositionedEdge; sCross: number; tCross: number }> = []
    const col: number[] = []
    for (let i = 0; i < k; i++) {
      const sCross = sourceCenter + (i - (k - 1) / 2) * sep
      const tCross = targetCenter + (i - (k - 1) / 2) * sep
      const sign = (back ? -1 : 1) * f.sign
      let jog = fromTarget ? entryMain - sign * (BASE_GAP + i * sep) : exitMain + sign * (BASE_GAP + i * sep)
      const lo = Math.min(exitMain, entryMain), hi = Math.max(exitMain, entryMain)
      if (jog <= lo + 4 || jog >= hi - 4) jog = (exitMain + entryMain) / 2
      lanes.push({ edge: bucket[i]!, sCross, tCross })
      col.push(jog)
    }
    if ((lanes[0]!.tCross - lanes[0]!.sCross > 0) !== fromTarget) col.reverse()

    const proposed: Array<{ edge: PositionedEdge; points: Point[]; label?: Point }> = []
    for (let i = 0; i < k; i++) {
      const { edge, sCross, tCross } = lanes[i]!
      const jog = col[i]!
      const raw = sCross === tCross
        ? [mk(exitMain, sCross), mk(entryMain, tCross)]
        : [mk(exitMain, sCross), mk(jog, sCross), mk(jog, tCross), mk(entryMain, tCross)]
      const clipped = simplifyPolyline(
        clipEdgeToShape(
          clipEdgeToShape(raw, source, true),
          target,
          false,
        ),
      )
      if (clipped.length < 2 ||
        !onShapeOutline(source, clipped[0]!) ||
        !onShapeOutline(target, clipped[clipped.length - 1]!) ||
        !routeClearOfNodes(clipped, nodes, new Set([source.id, target.id]))) {
        return false
      }
      proposed.push({ edge, points: clipped, label: edge.label ? longestSegmentMidpoint(clipped) : undefined })
    }
    if (!parallelLaneProposalAllowed(edges, proposed, { allowCrossingsForOverlap: true })) return false
    if (placement !== 'original') {
      const outside = edges.filter(edge => !bucket.includes(edge))
      const candidateRoutes = [...outside, ...proposed.map(p => ({ ...p.edge, points: p.points }))]
      const markers = candidateRoutes.flatMap(edge => graphEdgeMarkerPaintRegions(edge, style)).flatMap(marker => marker.bounds ? [{ x: marker.bounds.x0, y: marker.bounds.y0, width: marker.bounds.x1 - marker.bounds.x0, height: marker.bounds.y1 - marker.bounds.y0 }] : [])
      const labels = outside.filter(edge => edge.label).map(edge => haloBoxAt(edge, edge.labelPosition ?? calculatePathMidpoint(edge.points)))
      for (const p of proposed) {
        if (!p.edge.label) continue
        const neighbors = [...outside, ...proposed.filter(other => other !== p).map(other => ({ ...other.edge, points: other.points }))]
        const label = bundledLabelCandidates(p.edge, p.points, nodes, graph.direction, style).find(candidate => {
          const box = haloBoxAt(p.edge, candidate.point)
          return !nodes.some(node => rectsOverlap(box, node, 2)) && !markers.some(marker => rectsOverlap(box, marker, 0)) &&
            !labels.some(other => rectsOverlap(box, other, 2)) && !labelTouchesNeighborRoute(p.edge, { x: box.x, y: box.y, w: box.width, h: box.height }, neighbors)
        })
        if (!label) return false
        p.label = label.point
        labels.push(haloBoxAt(p.edge, p.label))
      }
    }
    if (proposalOptions.labelClearance && !parallelLaneLabelAdmission(edges, proposed, proposalOptions.labelClearance)) return false
    for (const { edge, points, label } of proposed) {
      edge.points = points
      edge.labelPosition = label
      edge.routeCertificate = undefined
      preSeparated.add(edge)
    }
    retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
    return true
  }

  for (const bucket of byDirectedPair.values()) {
    if (bucket.length < 2 || !bucket.some(edge => edge.label) || !bucket.some(edge => !edge.label)) continue
    if (!bucket.some(edge => edge.label && bucket.some(other => !other.label && routesShareCollinearRun(edge, other)))) continue
    const source = nodeMap.get(bucket[0]!.source)
    const target = nodeMap.get(bucket[0]!.target)
    if (!source || !target) continue
    const back = !((entrySide(target, false) - exitSide(source, false)) * f.sign > BASE_GAP)
    const capacity = (Math.min(crossSize(source), crossSize(target)) - 2 * MARGIN) / (bucket.length - 1)
    const required = Math.max(TARGET_SEP, ...bucket.filter(edge => edge.label).map(edge => {
      const box = haloBoxAt(edge, { x: 0, y: 0 })
      return Math.max(box.width, box.height) / 2 + 3
    }))
    // A feedback route can block the source-side jog while leaving the target
    // approach clear. Try the mirrored corridor under the same route budgets.
    if (required <= capacity && (separateMixedPair(bucket, back, required, 'source') || separateMixedPair(bucket, back, required, 'target'))) continue
    // Do not partially widen a cramped face or move a label onto a new obstacle.
    // Keep the existing construction when no complete halo-safe proposal fits.
    separateMixedPair(bucket, back, Math.min(TARGET_SEP, capacity), 'original')
  }

  const fwdByTarget = new Map<string, PositionedEdge[]>()
  const backByTarget = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (preSeparated.has(edge)) continue
    if (edge.source === edge.target || edge.label) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!PORT_EXACT.has(source.shape) || !PORT_EXACT.has(target.shape)) continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    // Forward: target sits ahead on the source's flow side, side-to-side with
    // room for a lane. Feedback: target sits behind, so the edge enters the
    // hub's flow-exit face. Anything else stays with its route contract.
    const push = (m: Map<string, PositionedEdge[]>) => {
      if (!m.has(edge.target)) m.set(edge.target, [])
      m.get(edge.target)!.push(edge)
    }
    if ((entrySide(target, false) - exitSide(source, false)) * f.sign > BASE_GAP) push(fwdByTarget)
    else if ((exitSide(source, true) - entrySide(target, true)) * f.sign > BASE_GAP) push(backByTarget)
  }

  const distribute = (bucket: PositionedEdge[], back: boolean): void => {
    if (bucket.length < 2) return
    // Gate: act only when a real duplicate shares this face. Without one this is
    // ordinary distinct fan-in, which merge-centering renders as a clean merge.
    const srcCounts = new Map<string, number>()
    for (const edge of bucket) srcCounts.set(edge.source, (srcCounts.get(edge.source) ?? 0) + 1)
    if (![...srcCounts.values()].some(count => count >= 2)) return

    const target = nodeMap.get(bucket[0]!.target)!
    const entryMain = entrySide(target, back)
    const tCenter = target[f.cross] + crossSize(target) / 2

    // Order by source cross-position (duplicates from one source kept adjacent
    // and stable by edgeIndex) so the assigned lanes never cross.
    const srcCenter = (edge: PositionedEdge) => {
      const s = nodeMap.get(edge.source)!
      return s[f.cross] + crossSize(s) / 2
    }
    bucket.sort((a, b) => srcCenter(a) - srcCenter(b) || (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))

    const k = bucket.length
    const sep = Math.min(TARGET_SEP, (crossSize(target) - 2 * MARGIN) / (k - 1))
    if (sep < 4) return // too tight to separate meaningfully — leave as-is

    // Duplicates from the same source also need distinct exit lanes on their
    // shared source side, else their source endpoints would overlap.
    const bySource = new Map<string, PositionedEdge[]>()
    for (const edge of bucket) {
      if (!bySource.has(edge.source)) bySource.set(edge.source, [])
      bySource.get(edge.source)!.push(edge)
    }

    // Lay out each lane (source exit slot, target entry slot, riser column),
    // then order the riser columns so duplicate lanes NEST instead of crossing.
    const lanes: Array<{ edge: PositionedEdge; source: PositionedNode; exitMain: number; sCross: number; tCross: number }> = []
    const col: number[] = []
    for (let i = 0; i < k; i++) {
      const edge = bucket[i]!
      const source = nodeMap.get(edge.source)!
      const exitMain = exitSide(source, back)
      const tCross = tCenter + (i - (k - 1) / 2) * sep

      const sibs = bySource.get(edge.source)!
      const sSep = sibs.length > 1
        ? Math.min(sep, (crossSize(source) - 2 * MARGIN) / (sibs.length - 1))
        : 0
      const sCross = source[f.cross] + crossSize(source) / 2 + (sibs.indexOf(edge) - (sibs.length - 1) / 2) * sSep

      // Each edge jogs at its own column, staggered by the lane separation, so
      // the cross-axis segments stay parallel rather than overlapping. Feedback
      // edges run against the flow, so their jog steps the other way.
      let jog = exitMain + (back ? -1 : 1) * f.sign * (BASE_GAP + i * sep)
      const lo = Math.min(exitMain, entryMain), hi = Math.max(exitMain, entryMain)
      if (jog <= lo + 4 || jog >= hi - 4) jog = (exitMain + entryMain) / 2
      lanes.push({ edge, source, exitMain, sCross, tCross })
      col.push(jog)
    }

    // Nest riser columns within each run of duplicate lanes (same source, hence
    // same directed pair in this target bucket). When the pair bends across the
    // flow, the UPPER lane's riser must sit farther out so the lower lane's exit
    // run does not cut across it (an upward bend is the mirror, handled by the
    // reversal below). Endpoints are untouched, so separation/order is preserved.
    for (let a = 0; a < k;) {
      let b = a
      while (b + 1 < k && bucket[b + 1]!.source === bucket[a]!.source) b++
      if (b > a && lanes[a]!.tCross - lanes[a]!.sCross > 0) {
        const slice = col.slice(a, b + 1).reverse()
        for (let r = a; r <= b; r++) col[r] = slice[r - a]!
      }
      a = b + 1
    }

    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    let ok = true
    for (let i = 0; i < k; i++) {
      const { edge, source, exitMain, sCross, tCross } = lanes[i]!
      const jog = col[i]!
      let pts: Point[]
      if (sCross === tCross) {
        pts = [mk(exitMain, sCross), mk(entryMain, tCross)]
      } else {
        pts = [mk(exitMain, sCross), mk(jog, sCross), mk(jog, tCross), mk(entryMain, tCross)]
      }
      pts = clipEdgeToShape(pts, source, true)
      pts = clipEdgeToShape(pts, target, false)
      pts = simplifyPolyline(pts)
      if (pts.length < 2 ||
        !onShapeOutline(source, pts[0]!) ||
        !onShapeOutline(target, pts[pts.length - 1]!) ||
        !routeClearOfNodes(pts, nodes, new Set([source.id, target.id]))) {
        ok = false
        break
      }
      proposed.push({ edge, points: pts })
    }
    if (!ok || !parallelLaneProposalAllowed(edges, proposed, proposalOptions)) return
    for (const { edge, points } of proposed) {
      edge.points = points
      edge.labelPosition = undefined
      edge.routeCertificate = undefined
    }
    retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
  }

  for (const bucket of fwdByTarget.values()) distribute(bucket, false)
  for (const bucket of backByTarget.values()) distribute(bucket, true)
}
