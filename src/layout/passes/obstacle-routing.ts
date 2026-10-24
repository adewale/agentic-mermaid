import type { MermaidGraph, Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { onShapeOutline, segmentThroughShape } from '../../layout-rubric.ts'
import { recertifyReroutedEdge, shapePorts, simplifyPolyline } from '../../route-contracts.ts'
import { bundleRouteBeforeRewrite, retainBundleRouteAfterRewrite } from '../bundle-routes.ts'
import { calculatePathMidpoint, layoutFlow, nodeCrossSize, nodeCrossStart } from '../geometry.ts'
import { doglegBetween, routeClearOfNodes } from './shared.ts'

/**
 * Post-freeze safety net for STALE edge endpoints. A pass that MOVES a node is
 * responsible for re-anchoring the edges incident to it (honorLinkRankDistance,
 * above, rebuilds its own); but equalizePeerNodeDimensions repositions a fan-in
 * peer without touching a cone edge INTO it (an upstream `U --> S` where S also
 * fans into a hub), so that edge is left pointing at S's pre-move position and
 * its endpoint dangles OFF the moved outline — offOutlineEndpoints (or, if it
 * grazes a neighbour, edgeThroughNode). applyRouteContracts certifies the stale
 * route rather than re-anchoring it. After the freeze, re-route any edge whose
 * endpoint sits off its node's outline as an orthogonal dogleg between the two
 * nodes' flow-side ports, landing the endpoint back on the outline.
 *
 * Fires ONLY on an already-off-outline endpoint — which the HARD-clean corpus
 * never has — so it is a strict no-op there and byte-exact equivalence holds. A
 * rebuilt route is adopted only when it clears every other node (an on-outline
 * endpoint is not worth trading for an edgeThroughNode); self-loops are skipped
 * (their stub is the renderer's). Deterministic; label re-centred on the new route.
 */
export function reanchorOffOutlineEndpoints(nodes: PositionedNode[], edges: PositionedEdge[], graph: MermaidGraph): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  for (const edge of edges) {
    if (edge.source === edge.target || edge.points.length < 2) continue
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (!source || !target) continue
    const srcOff = !onShapeOutline(source, edge.points[0]!)
    const tgtOff = !onShapeOutline(target, edge.points[edge.points.length - 1]!)
    if (!srcOff && !tgtOff) continue
    const start = shapePorts(source)[f.sourceSide]
    const end = shapePorts(target)[f.targetSide]
    const route = doglegBetween(start, end, graph.direction, (start[f.main] + end[f.main]) / 2)
    if (!routeClearOfNodes(route, nodes, new Set([edge.source, edge.target]))) continue
    const savedCert = edge.routeCertificate
    edge.points = route
    recertifyReroutedEdge(edge, savedCert, source, target)
    if (edge.label) edge.labelPosition = calculatePathMidpoint(route)
  }
}

/**
 * Post-freeze safety net for the NODE-MOVE -> edgeThroughNode class — the
 * on-outline-endpoint sibling of reanchorOffOutlineEndpoints (above). A pass that
 * MOVES a node must keep the edges incident to it clear of every OTHER node, but
 * honorLinkRankDistance rebuilds a lengthened skip link, and alignPortLanes
 * straightens a feedback edge, as a plain dogleg WITHOUT a clearance check
 * (unlike applySymmetricFanoutEmissions): a link that skips a collinear node
 * (`A ===> C` over B) or a feedback whose return lane a peer moved into
 * (`T1 --> S1` past S2) is left running straight THROUGH that node.
 * applyRouteContracts cannot always repair it — its Z has no in-span escape lane
 * when the obstacle is as tall as the endpoints, and its escape detour's exit stub
 * is rejected as a channel conflict when a sibling shares the source lane — so the
 * through-node route is certified as-is. Its endpoints stay port-exact (ON the
 * outline), which is why reanchorOffOutlineEndpoints, keyed on OFF-outline
 * endpoints, never sees it.
 *
 * After the freeze, re-route any edge whose polyline passes through a non-endpoint
 * node (the rubric's exact edgeThroughNode predicate). The endpoints are kept —
 * they are correct ports — and only the interior is detoured around the obstacle:
 * first by sliding a blocked INTERIOR segment sideways to the nearest parallel lane
 * that clears every node (fixes a feedback U-route a peer intruded on, preserving
 * its shape), else by BRACKETING the route over/under the obstacle band between its
 * two ports (fixes a straight skip link through a collinear node). A detour is
 * adopted ONLY when it clears every node and both endpoints stay on their outlines;
 * otherwise the edge is left untouched (never traded for a worse route).
 *
 * Fires ONLY on an edge the rubric already flags edgeThroughNode — which the
 * HARD-clean corpus never has — so it is a strict no-op there and byte-exact
 * equivalence holds. Edge-only, deterministic (fixed candidate order); label
 * re-centred on the new route. Self-loops are skipped.
 */
export function rerouteEdgesThroughNodes(nodes: PositionedNode[], edges: PositionedEdge[], graph: Pick<MermaidGraph, 'direction'>, chargeWork?: (operations: number) => void): void {
  const f = layoutFlow(graph.direction)
  chargeWork?.(nodes.length)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const THROUGH_LANE_GAP = 10
  const throughNode = (pts: Point[], skip: ReadonlySet<string>): boolean => {
    for (const n of nodes) {
      chargeWork?.(1)
      if (skip.has(n.id)) continue
      for (let i = 1; i < pts.length; i++) { chargeWork?.(1); if (segmentThroughShape(pts[i - 1]!, pts[i]!, n)) return true }
    }
    return false
  }
  // Slide a blocked INTERIOR (non-terminal) axis-aligned segment sideways to the
  // nearest parallel lane clear of every node, keeping the polyline's endpoints
  // and orthogonal shape. Only shifts when both neighbours are perpendicular to
  // the segment (so the slide cannot bend a neighbour into a diagonal).
  const shiftInteriorSegment = (pts: Point[], skip: ReadonlySet<string>): Point[] | null => {
    for (let k = 1; k <= pts.length - 3; k++) {
      const a = pts[k]!, b = pts[k + 1]!, before = pts[k - 1]!, after = pts[k + 2]!
      const vertical = Math.abs(a.x - b.x) < 0.5, horizontal = Math.abs(a.y - b.y) < 0.5
      if (vertical === horizontal) continue // diagonal or degenerate — leave it
      if (!throughNode([a, b], skip)) continue // not the offending segment
      const ax: 'x' | 'y' = vertical ? 'x' : 'y'
      const perp: 'x' | 'y' = vertical ? 'y' : 'x'
      if (Math.abs(before[perp] - a[perp]) > 0.5 || Math.abs(after[perp] - b[perp]) > 0.5) continue
      const c = a[ax]
      const cands: number[] = []
      for (const n of nodes) {
        chargeWork?.(1)
        if (skip.has(n.id)) continue
        cands.push(n[ax] - THROUGH_LANE_GAP, n[ax] + (ax === 'x' ? n.width : n.height) + THROUGH_LANE_GAP)
      }
      cands.sort((p, q) => Math.abs(p - c) - Math.abs(q - c))
      for (const cp of cands) {
        const trial = pts.map(p => ({ ...p }))
        trial[k]![ax] = cp; trial[k + 1]![ax] = cp
        if (!throughNode(trial, skip) && routeClearOfNodes(trial, nodes, skip, chargeWork)) return simplifyPolyline(trial)
      }
    }
    return null
  }
  // Bracket a route over/under an obstacle, exiting the source and entering the
  // target along the flow axis: a short stub off each port, a jog to a clear
  // cross-lane, and the corridor run between. Keeps both ports. Candidate lanes
  // are just past EACH corridor obstacle's cross-edges (so a lane in the gap
  // between two obstacles is reachable, e.g. a feedback that must pass between the
  // target and an unrelated node beside it) plus the whole-band edges as a
  // fallback — nearest the ports first. This handles both the forward skip link
  // and the feedback U-route whose return segment cut a node beside the target.
  const bracketOverBand = (pts: Point[], skip: ReadonlySet<string>): Point[] | null => {
    const start = pts[0]!, end = pts[pts.length - 1]!
    const mLo = Math.min(start[f.main], end[f.main]), mHi = Math.max(start[f.main], end[f.main])
    let bandLo = Infinity, bandHi = -Infinity
    const laneSet: number[] = []
    for (const n of nodes) {
      chargeWork?.(1)
      if (skip.has(n.id)) continue
      const ns = n[f.main], ne = n[f.main] + (f.main === 'x' ? n.width : n.height)
      if (ne <= mLo || ns >= mHi) continue // outside the corridor
      const cs = nodeCrossStart(n, graph.direction), ce = cs + nodeCrossSize(n, graph.direction)
      bandLo = Math.min(bandLo, cs); bandHi = Math.max(bandHi, ce)
      laneSet.push(cs - THROUGH_LANE_GAP, ce + THROUGH_LANE_GAP) // just past this obstacle's edges
    }
    if (!Number.isFinite(bandLo)) return null
    laneSet.push(bandLo - THROUGH_LANE_GAP, bandHi + THROUGH_LANE_GAP) // whole-band fallback
    const pt = (mainV: number, crossV: number): Point => (f.main === 'x' ? { x: mainV, y: crossV } : { x: crossV, y: mainV })
    const dir = Math.sign(end[f.main] - start[f.main]) || 1
    const stub = Math.min(12, Math.abs(end[f.main] - start[f.main]) / 3)
    const m1 = start[f.main] + dir * stub, m2 = end[f.main] - dir * stub
    const mean = (start[f.cross] + end[f.cross]) / 2
    const lanes = [...new Set(laneSet)].sort((p, q) => Math.abs(p - mean) - Math.abs(q - mean))
    for (const lane of lanes) {
      const route = simplifyPolyline([start, pt(m1, start[f.cross]), pt(m1, lane), pt(m2, lane), pt(m2, end[f.cross]), end])
      if (!throughNode(route, skip) && routeClearOfNodes(route, nodes, skip, chargeWork)) return route
    }
    return null
  }
  for (const edge of edges) {
    chargeWork?.(1)
    if (edge.source === edge.target || edge.points.length < 2) continue
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (!source || !target) continue
    const skip = new Set([edge.source, edge.target])
    if (!throughNode(edge.points, skip)) continue // no-op gate: only fires on edgeThroughNode
    // Off-outline endpoints are reanchorOffOutlineEndpoints' job; this pass only
    // relocates the interior of an otherwise port-exact route.
    if (!onShapeOutline(source, edge.points[0]!) || !onShapeOutline(target, edge.points[edge.points.length - 1]!)) continue
    const route = shiftInteriorSegment(edge.points, skip) ?? bracketOverBand(edge.points, skip)
    if (!route) continue // never-worse: no clean detour found, leave as-is
    const savedCert = edge.routeCertificate
    edge.points = route
    recertifyReroutedEdge(edge, savedCert, source, target)
    if (edge.label) edge.labelPosition = calculatePathMidpoint(route)
  }
}

export function collapseTinyBundledHitches(nodes: PositionedNode[], edges: PositionedEdge[], bundled: Set<PositionedEdge>): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const edge of edges) {
    if (!bundled.has(edge) || edge.label || edge.points.length !== 4) continue
    const bundle = bundleRouteBeforeRewrite(edge)
    const [a, b, c, d] = edge.points
    if (!a || !b || !c || !d) continue
    const target = nodeMap.get(edge.target)
    if (!target || target.shape !== 'rectangle') continue
    const exclude = new Set([edge.source, edge.target])
    if (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.x - c.x) < 0.01 && Math.abs(c.y - d.y) < 0.01 && Math.abs(b.y - c.y) <= 6) {
      const end = { x: d.x, y: a.y }
      const onTargetSide = Math.abs(d.x - target.x) < 0.01 || Math.abs(d.x - (target.x + target.width)) < 0.01
      if (onTargetSide && end.y >= target.y - 0.5 && end.y <= target.y + target.height + 0.5 && routeClearOfNodes([a, end], nodes, exclude)) {
        edge.points = [a, end]
        edge.routeCertificate = undefined
        retainBundleRouteAfterRewrite(edge, bundle)
      }
      continue
    }
    if (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.y - c.y) < 0.01 && Math.abs(c.x - d.x) < 0.01 && Math.abs(b.x - c.x) <= 6) {
      const end = { x: a.x, y: d.y }
      const onTargetSide = Math.abs(d.y - target.y) < 0.01 || Math.abs(d.y - (target.y + target.height)) < 0.01
      if (onTargetSide && end.x >= target.x - 0.5 && end.x <= target.x + target.width + 0.5 && routeClearOfNodes([a, end], nodes, exclude)) {
        edge.points = [a, end]
        edge.routeCertificate = undefined
        retainBundleRouteAfterRewrite(edge, bundle)
      }
    }
  }
}
