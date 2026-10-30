import type { MermaidGraph, Point, PositionedEdge, PositionedNode, PositionedGroup } from '../../types.ts'
import { onShapeOutline, segmentThroughShape } from '../../layout-rubric.ts'
import { recertifyReroutedEdge, shapePorts, simplifyPolyline } from '../../route-contracts.ts'
import { bundleRouteBeforeRewrite, retainBundleRouteAfterRewrite } from '../bundle-routes.ts'
import { calculatePathMidpoint, layoutFlow, nodeCrossSize, nodeCrossStart } from '../geometry.ts'
import { doglegBetween, hookedElbow, routeClearOfNodes } from './shared.ts'
import { terminalHookLength, simpleOrthogonal, type LabelMetricsStyle } from '../route-geometry.ts'
import { isOutwardShapeApproach } from '../../shape-clipping.ts'

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
export function reanchorOffOutlineEndpoints(nodes: PositionedNode[], edges: PositionedEdge[], graph: Pick<MermaidGraph, 'direction'>, style: Pick<LabelMetricsStyle, 'lineWidth' | 'edgeBendRadius'> = {}): void {
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
    const elbow = hookedElbow(start[f.main], end[f.main], terminalHookLength(style, edge, 'start'), terminalHookLength(style, edge, 'end'))
    const route = doglegBetween(start, end, graph.direction, elbow)
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
 * Fires ONLY on an edge the rubric already flags edgeThroughNode, or one that
 * enters a group's reserved title band (the certification group-header check)
 * — which the HARD-clean corpus never has — so it is a strict no-op there and
 * byte-exact equivalence holds. Edge-only, deterministic (fixed candidate
 * order); label re-centred on the new route. Self-loops are skipped. Returns
 * how many title-band entries it repaired: the caller ranks such a placement
 * below an alternative that needed no detour.
 */
export function rerouteEdgesThroughNodes(nodes: PositionedNode[], edges: PositionedEdge[], graph: Pick<MermaidGraph, 'direction'>, chargeWork?: (operations: number) => void, groups: readonly PositionedGroup[] = []): number {
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
  // Headers are live reserved geometry, including endpoint ancestors. A node
  // detour may not trade an opaque card crossing for a reserved-band crossing.
  const clearHeaders = (pts: readonly Point[]): boolean => {
    const visit = (group: PositionedGroup): boolean => {
      chargeWork?.(1)
      const height = group.concurrencyRegion ? 0 : group.headerHeight
      // Final pipeline retains the writer's measured height. Missing metadata
      // cannot prove a clear candidate; a measured band may exceed its frame.
      if (group.width !== 0 && (height === undefined || !Number.isFinite(height) || height < 0)) return false
      if (height !== undefined && height > 0 && group.width > 0) for (let i = 1; i < pts.length; i++) {
        chargeWork?.(1)
        const a = pts[i - 1]!, b = pts[i]!
        if (Math.max(a.x, b.x) > group.x && Math.min(a.x, b.x) < group.x + group.width
          && Math.max(a.y, b.y) > group.y && Math.min(a.y, b.y) < group.y + height) return false
      }
      for (const child of group.children) if (!visit(child)) return false
      return true
    }
    for (const group of groups) if (!visit(group)) return false
    return true
  }
  // Reserved title bands, as rectangles, supply lanes just outside them.
  const headerBands: Array<{ x: number; y: number; width: number; height: number }> = []
  const collectBands = (items: readonly PositionedGroup[]): void => {
    for (const group of items) {
      const height = group.concurrencyRegion ? 0 : group.headerHeight ?? 0
      if (height > 0 && group.width > 0) headerBands.push({ x: group.x, y: group.y, width: group.width, height })
      collectBands(group.children)
    }
  }
  collectBands(groups)
  // Slide a blocked INTERIOR (non-terminal) axis-aligned segment sideways to the
  // nearest parallel lane clear of every node, keeping the polyline's endpoints
  // and orthogonal shape. Only shifts when both neighbours are perpendicular to
  // the segment (so the slide cannot bend a neighbour into a diagonal).
  const shiftInteriorSegment = (pts: Point[], skip: ReadonlySet<string>, admit: (trial: Point[]) => boolean): Point[] | null => {
    for (let k = 1; k <= pts.length - 3; k++) {
      const a = pts[k]!, b = pts[k + 1]!, before = pts[k - 1]!, after = pts[k + 2]!
      const vertical = Math.abs(a.x - b.x) < 0.5, horizontal = Math.abs(a.y - b.y) < 0.5
      if (vertical === horizontal) continue // diagonal or degenerate — leave it
      if (!throughNode([a, b], skip) && clearHeaders([a, b])) continue // not the offending segment
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
      for (const band of headerBands) {
        chargeWork?.(1)
        cands.push(band[ax] - THROUGH_LANE_GAP, band[ax] + (ax === 'x' ? band.width : band.height) + THROUGH_LANE_GAP)
      }
      cands.sort((p, q) => Math.abs(p - c) - Math.abs(q - c))
      for (const cp of cands) {
        const trial = pts.map(p => ({ ...p }))
        trial[k]![ax] = cp; trial[k + 1]![ax] = cp
        // Box clearance applies to the three segments the slide moved; the
        // untouched prefix and suffix keep their exact-shape proof.
        if (!throughNode(trial, skip) && routeClearOfNodes(trial.slice(k - 1, k + 3), nodes, skip, chargeWork) && clearHeaders(trial) && admit(simplifyPolyline(trial))) return simplifyPolyline(trial)
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
  const bracketOverBand = (pts: Point[], skip: ReadonlySet<string>, admit: (trial: Point[]) => boolean): Point[] | null => {
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
      if (!throughNode(route, skip) && routeClearOfNodes(route, nodes, skip, chargeWork) && clearHeaders(route) && admit(route)) return route
    }
    return null
  }
  // A blocked terminal shaft may enter from a different axis than graph flow.
  // Keep that actual port ray; move the preceding turn around the blocking card.
  chargeWork?.(1)
  const noSkip = new Set<string>()
  const detourTerminalSegment = (pts: Point[], skip: ReadonlySet<string>, admit: (trial: Point[]) => boolean): Point[] | null => {
    if (pts.length < 3) return null
    const end = pts.at(-1)!, a = pts.at(-2)!, before = pts.at(-3)!
    const axis = a.y === end.y && a.x !== end.x ? 'x' : a.x === end.x && a.y !== end.y ? 'y' : undefined
    if (!axis) return null
    const cross = axis === 'x' ? 'y' : 'x'
    if (before[axis] !== a[axis] || before[cross] === a[cross] || !throughNode([a, end], skip)) return null
    const lanes: number[] = []
    for (const node of nodes) {
      chargeWork?.(1)
      if (skip.has(node.id) || !segmentThroughShape(a, end, node)) continue
      chargeWork?.(2) // two actual boundary candidates
      lanes.push(node[cross] - THROUGH_LANE_GAP, node[cross] + (cross === 'x' ? node.width : node.height) + THROUGH_LANE_GAP)
    }
    lanes.sort((p, q) => { chargeWork?.(1); return Math.abs(p - a[cross]) - Math.abs(q - a[cross]) })
    const toward = end[axis] + Math.sign(a[axis] - end[axis]) * Math.min(THROUGH_LANE_GAP, Math.abs(a[axis] - end[axis]) / 2)
    for (const lane of lanes) {
      chargeWork?.(2 * pts.length + 12) // slice/spread references, three Point records and terminal checks
      const bend = { ...a, [cross]: lane }, approach = { ...end, [axis]: toward, [cross]: lane }, stub = { ...end, [axis]: toward }
      const trial = simplifyPolyline([...pts.slice(0, -2), bend, approach, stub, end])
      // Prefix/terminal directions must stay the actual original rays.
      const sameRay = (port: Point, oldNext: Point, next: Point): boolean =>
        oldNext.x === port.x && next.x === port.x && Math.sign(oldNext.y - port.y) === Math.sign(next.y - port.y)
        || oldNext.y === port.y && next.y === port.y && Math.sign(oldNext.x - port.x) === Math.sign(next.x - port.x)
      if (!sameRay(pts[0]!, pts[1]!, trial[1]!) || !sameRay(end, a, trial.at(-2)!)) continue
      if (!throughNode(trial, noSkip) && routeClearOfNodes(trial, nodes, skip, chargeWork) && clearHeaders(trial) && simpleOrthogonal(trial, chargeWork) && admit(trial)) return trial
    }
    return null
  }
  // Last resort: a segment that runs straight across one obstacle (a card or
  // a reserved title band) and extends past it on both sides steps around it
  // locally, through a lane just past the obstacle's side. Every other point
  // and both endpoint rays are kept. This is how a route leaving a subgraph
  // through its title band (bottom-to-top flow) exits beside the band instead.
  const detourAroundObstacle = (pts: Point[], skip: ReadonlySet<string>, admit: (trial: Point[]) => boolean): Point[] | null => {
    const obstacles: Array<{ x: number; y: number; width: number; height: number }> = [...headerBands, ...nodes.filter(node => !skip.has(node.id))]
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!, b = pts[k + 1]!
      const axis: 'x' | 'y' | undefined = a.y === b.y && a.x !== b.x ? 'x' : a.x === b.x && a.y !== b.y ? 'y' : undefined
      if (!axis) continue
      const cross = axis === 'x' ? 'y' : 'x', extent = (box: { width: number; height: number }, along: 'x' | 'y') => along === 'x' ? box.width : box.height
      const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]), dir = Math.sign(b[axis] - a[axis])
      for (const box of obstacles) {
        chargeWork?.(1)
        const crossLo = box[cross], crossHi = box[cross] + extent(box, cross)
        if (!(a[cross] > crossLo && a[cross] < crossHi)) continue
        const boxLo = box[axis], boxHi = box[axis] + extent(box, axis)
        if (!(boxLo - THROUGH_LANE_GAP > lo && boxHi + THROUGH_LANE_GAP < hi)) continue
        const enter = dir > 0 ? boxLo - THROUGH_LANE_GAP : boxHi + THROUGH_LANE_GAP
        const leave = dir > 0 ? boxHi + THROUGH_LANE_GAP : boxLo - THROUGH_LANE_GAP
        const lanes = [crossLo - THROUGH_LANE_GAP, crossHi + THROUGH_LANE_GAP].sort((p, q) => Math.abs(p - a[cross]) - Math.abs(q - a[cross]))
        for (const lane of lanes) {
          chargeWork?.(2 * pts.length + 8)
          const at = (main: number, side: number): Point => (axis === 'x' ? { x: main, y: side } : { x: side, y: main })
          const trial = simplifyPolyline([...pts.slice(0, k + 1), at(enter, a[cross]), at(enter, lane), at(leave, lane), at(leave, a[cross]), ...pts.slice(k + 1)])
          if (!throughNode(trial, skip) && routeClearOfNodes(trial, nodes, skip, chargeWork) && clearHeaders(trial) && simpleOrthogonal(trial, chargeWork) && admit(trial)) return trial
        }
      }
    }
    return null
  }
  // An edge to or from a subgraph ends on its frame. The frame stands in as a
  // rectangle endpoint, so a group edge through a card is repaired like any
  // other; the frame's own members sit behind that endpoint.
  const frames = new Map<string, PositionedNode>()
  const collectFrames = (items: readonly PositionedGroup[]): void => {
    for (const group of items) {
      frames.set(group.id, { id: group.id, label: '', shape: 'rectangle', x: group.x, y: group.y, width: group.width, height: group.height })
      collectFrames(group.children)
    }
  }
  collectFrames(groups)
  let titleBandRepairs = 0
  for (const edge of edges) {
    chargeWork?.(1)
    if (edge.source === edge.target || edge.points.length < 2) continue
    const source = nodeMap.get(edge.source) ?? frames.get(edge.source), target = nodeMap.get(edge.target) ?? frames.get(edge.target)
    if (!source || !target) continue
    const skip = new Set([edge.source, edge.target])
    const entersBand = !clearHeaders(edge.points)
    if (!entersBand && !throughNode(edge.points, skip)) continue // no-op gate: only fires on edgeThroughNode or a header-band entry
    // Off-outline endpoints are reanchorOffOutlineEndpoints' job; this pass only
    // relocates the interior of an otherwise port-exact route.
    if (!onShapeOutline(source, edge.points[0]!) || !onShapeOutline(target, edge.points[edge.points.length - 1]!)) continue
    // A detour keeps each endpoint's outward approach: sliding a lane past
    // the port would turn the terminal shaft back into its own card.
    const firstMove = (pts: readonly Point[], start: boolean): Point | undefined => {
      const index = start ? 0 : pts.length - 1, step = start ? 1 : -1
      for (let next = index + step; next >= 0 && next < pts.length; next += step) {
        if (pts[next]!.x !== pts[index]!.x || pts[next]!.y !== pts[index]!.y) return pts[next]
      }
      return undefined
    }
    const outward = (pts: readonly Point[], start: boolean): boolean | undefined => {
      const adjacent = firstMove(pts, start)
      return adjacent && isOutwardShapeApproach(start ? source : target, pts[start ? 0 : pts.length - 1]!, adjacent)
    }
    const wasOutward = [outward(edge.points, true), outward(edge.points, false)]
    const keepsApproach = (trial: Point[]): boolean => [true, false].every((start, end) => wasOutward[end] !== true || outward(trial, start) === true)
    let route = shiftInteriorSegment(edge.points, skip, keepsApproach) ?? bracketOverBand(edge.points, skip, keepsApproach)
      ?? detourTerminalSegment(edge.points, skip, keepsApproach)
    if (!route) {
      chargeWork?.(edge.points.length) // reverse-domain reference initialization
      route = detourTerminalSegment(edge.points.toReversed(), skip, trial => keepsApproach(trial.toReversed()))?.reverse() ?? null
    }
    route ??= detourAroundObstacle(edge.points, skip, keepsApproach)
    if (!route) continue // never-worse: no clean detour found, leave as-is
    const savedCert = edge.routeCertificate
    edge.points = route
    recertifyReroutedEdge(edge, savedCert, nodeMap.get(edge.source), nodeMap.get(edge.target))
    if (edge.label) edge.labelPosition = calculatePathMidpoint(route)
    if (entersBand) titleBandRepairs++
  }
  return titleBandRepairs
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
