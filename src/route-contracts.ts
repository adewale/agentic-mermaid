// Route-contract orchestration, certificate closure, and final audit. Geometry,
// lane proofs, feedback shortening, and per-pass self-loop occupancy have
// separate owners; the pass order and certificate lifecycle remain here.
import { customTextMeasurementActive } from './text-measurement-profile.ts'
import { resolveLabelContent } from './shared/display-text.ts'
import { countPointPairCrossings } from './shared/edge-crossing-pair.ts'
import type { Direction, MermaidGraph, Point, PortSide, PositionedEdge, PositionedGroup, PositionedNode, RouteBlocker, RouteCertificate, RouteClass, RouteInvariant } from './types.ts'
import { graphEdgeTextBlock } from './graph-text.ts'
import { graphEdgeMarkerPaintRegions } from './graph-connectors.ts'
import { labelSeatPaintContext } from './layout/graph-paint-support.ts'
import { resolveRenderStyle } from './styles.ts'
import { trimOccludedShapeEndpoint } from './shape-clipping.ts'
import { renderedEndpointContact } from './rendered-endpoint-diagnostics.ts'
import { LABEL_PILL_PADDING, labelEndpointClearance, labelHaloExtension, labelRect, pillRect, segmentEntersLabelRect } from './shared/edge-label-geometry.ts'
import { bundleRouteBeforeRewrite, hasConstructedBundleRoute, retainBundleRouteAfterRewrite } from './layout/bundle-routes.ts'
import {
  withinLayoutPreferenceBudget,
  EPS,
  CLEARANCE,
  RECT_LIKE,
  PORT_TOLERANCE,
  PAIR_SEPARATION,
  HOOK_STUB_MIN,
  terminalHookLength,
  shapePorts,
  portAt,
  invalidEndpointApproaches,
  isStraightenable,
  hasFacetAttachments,
  type LabelMetricsStyle,
  classifyRoutes,
  type Axis,
  axisPoint,
  perpendicularAxis,
  simplifyPolyline,
  orthogonalizeResidualDiagonals,
  bendCount,
  routesCrossOrOverlap,
  simpleOrthogonal,
  crossDeviation,
  isMonotoneStaircase,
  type CrossSpan,
  attachSpan,
  anchorMain,
  type LaneContext,
  setRoutePoints,
  indexRouteNodes,
  facingSide,
  allocateRoutePorts,
  buildRouteLaneContext,
} from './layout/route-geometry.ts'
import {
  portSharpness,
  repairRectLikeEndpointOverflow,
  diamondSpreadTargetPortConstraint,
  satisfiesDiamondSpreadTargetPortConstraint,
  edgeId,
  directLaneBlockers,
  hasDirectLaneBlocker,
  findLabelSlot,
  countRouteCrossings,
  routeAddsCrossings,
  routeThroughNodeBBox,
  routeEntersNodeBox,
  dedupeBlockers,
  tryStraighten,
  sharedTrunkConflict,
  laneContextFor,
} from './layout/route-lanes.ts'
import { tightenOuterFeedback, feedbackDetourKind } from './layout/route-feedback.ts'
import { createSelfLoopRouter } from './layout/route-self-loops.ts'
import { edgesMayShareTerminal, routeCandidateMarkersClear, routeMarkerPaintRegions } from './layout/route-marker-clearance.ts'
export { PORT_EXACT, shapePorts, diamondFacetPorts, invalidEndpointApproaches, trimBoundaryEndpointRuns, type LabelMetricsStyle, classifyRoutes, simplifyPolyline, type RoutePortAllocation, allocateRoutePorts } from './layout/route-geometry.ts'
export { directLaneBlockers, findLabelSlot, straightLaneFor, laneContextFor } from './layout/route-lanes.ts'
export { labelRect } from './shared/edge-label-geometry.ts'

type DraftRouteCertificate = Omit<RouteCertificate, 'invariant' | 'straightened'> & {
  invariant: RouteInvariant
  /** Internal draft bit; finalized public certificates only keep this for straight routes. */
  straightened?: true
}

/** Bundle exemptions belong to the constructed route, including separated
 * parallel lanes. Uniform translation and label-only changes preserve it. */
export function hasBundleRouteExemption(edge: PositionedEdge): boolean {
  return edge.routeCertificate?.invariant === 'bundle' && hasConstructedBundleRoute(edge)
}

function hasDiagonalSegment(points: readonly Point[]): boolean {
  return points.some((point, index) => index > 0 && Math.abs(point.x - points[index - 1]!.x) > EPS && Math.abs(point.y - points[index - 1]!.y) > EPS)
}

function markStraightDraft(cert: DraftRouteCertificate, mutated = false): void {
  cert.invariant = 'straight'
  cert.bendCount = 0
  cert.directLaneClear = true
  if (mutated) cert.straightened = true
  cert.directLaneBlockedBy = undefined
}

/**
 * The route-contract pass: simplify every polyline (proof-free), straighten
 * primary-forward and feedback staircases whose direct lane proves clear
 * (proof-carrying), and certify every edge. Edges are processed in author
 * order, and the pass iterates to a fixed point: straightening one edge can
 * vacate the channel that blocked a sibling (duplicate parallel edges do
 * exactly this), so blocked edges are re-proved until nothing changes.
 * Attaches the certificate to the edge and returns all certificates.
 */
export function applyRouteContracts(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  graph: MermaidGraph,
  bundled: ReadonlySet<PositionedEdge>,
  style: LabelMetricsStyle,
  options?: { preserveSelfLoops?: boolean; preserveLabels?: boolean; preserveStraightRoutes?: boolean },
): RouteCertificate[] {
  const classes = classifyRoutes(graph)
  const { axis, ctx } = buildRouteLaneContext(
    positioned,
    graph,
    style,
    classes,
    edge => bundled.has(edge) && hasConstructedBundleRoute(edge),
    Boolean(options?.preserveLabels),
  )
  ctx.fixedLabels = Boolean(options?.preserveLabels)
  const nodeMap = indexRouteNodes(positioned.nodes)
  const groupMap = flattenGroups(positioned.groups)
  const drafts: Array<{ edge: PositionedEdge; cert: DraftRouteCertificate }> = []
  let unlabelledContainerRepair: boolean | undefined

  // Attempt one proof-carrying straightening; updates geometry + certificate.
  // `applied` means the route is straight; `mutated` means geometry moved this
  // call; `upgradeable` means a non-preferred lane won, so the edge stays in
  // the fixed-point pool — a later repair may free the preferred lane (e.g.
  // the symmetric lane of a reciprocal pair blocked by its partner's
  // not-yet-repaired geometry).
  const attemptStraighten = (edge: PositionedEdge, cert: DraftRouteCertificate): { applied: boolean; mutated: boolean; upgradeable?: boolean } => {
    const edgeAxis: Axis = cert.routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    // Feedback loops from ELK's feedbackEdges routing start by moving AWAY
    // from the target (around the nodes), so they are never monotone; the
    // lane proof alone gates whether they may collapse onto a parallel
    // back-lane. Primary edges keep the monotone gate.
    // A residual diagonal (normalization refused for a marker seat) is judged
    // by the staircase it orthogonalizes to; straightening replaces it anyway.
    const eligible = source && target && isStraightenable(source) && isStraightenable(target) && (cert.routeClass === 'feedback' || isMonotoneStaircase(orthogonalizeResidualDiagonals(edge.points), edgeAxis))
    if (!eligible) {
      cert.invariant = feedbackDetourKind(edge, cert.routeClass, source, target, ctx.axis) ?? 'unverified-shape'
      return { applied: false, mutated: false }
    }
    // A valid native contact need not move to a preferred diamond vertex.
    // Preserve its straight lane only after checking current obstacles and
    // actual endpoint approaches; blocked or invalid routes still need repair.
    if (options?.preserveStraightRoutes && edge.points.length === 2) {
      const start = edge.points[0]!, end = edge.points[1]!, main = axis.main, cross = axis.cross
      if (start[cross] === end[cross] && invalidEndpointApproaches(edge, source!, target!) === 0
        && !hasDirectLaneBlocker(edge, start[cross], Math.min(start[main], end[main]), Math.max(start[main], end[main]), ctx, edgeAxis)) {
        markStraightDraft(cert)
        return { applied: true, mutated: false }
      }
    }
    // Port ranking, hard case: a diamond side carrying exactly ONE line
    // always emits from its vertex (the user-facing convention dot and
    // yFiles follow). If no straight lane through the vertex exists, a
    // 2-bend Z from the vertex into the target's port still outranks a
    // straight lane that floats off the vertex.
    const srcSideUse = ctx.sideUse?.get(`${source!.id}:${facingSide(edgeAxis, 1)}`) ?? 1
    const emitFromVertex = cert.routeClass === 'primary-forward' && hasFacetAttachments(source!) && srcSideUse === 1 && portSharpness(source!) >= portSharpness(target!)
    const beforeGeometry = JSON.stringify(edge.points)
    if (emitFromVertex) {
      const vertexLane = source![edgeAxis.cross] + (edgeAxis.cross === 'y' ? source!.height : source!.width) / 2
      const direct = tryStraighten(edge, source!, target!, ctx, edgeAxis, vertexLane)
      if (direct.applied) {
        const mutated = JSON.stringify(edge.points) !== beforeGeometry
        markStraightDraft(cert, mutated)
        return { applied: true, mutated }
      }
      // Next-best after the straight vertex lane: the 1-bend hook into the
      // target's facing cross-side port; the 2-bend Z into the flow-side
      // port only when no hook exists.
      if (tryVertexHook(edge, source!, target!, ctx, edgeAxis) || tryZRoute(edge, source!, target!, ctx, edgeAxis, true)) {
        cert.invariant = 'explained-detour'
        cert.directLaneClear = false
        cert.directLaneBlockedBy = dedupeBlockers(direct.blockers)
        cert.bendCount = bendCount(edge.points)
        // applied=false keeps the edge in the fixed-point retry pool: if a
        // later repair clears the straight vertex lane (a blocking pill
        // moves), the hook/Z upgrades to the straight emit on the next round.
        return { applied: false, mutated: JSON.stringify(edge.points) !== beforeGeometry }
      }
    }
    const portConstraint = diamondSpreadTargetPortConstraint(edge, source!, target!, ctx, edgeAxis)
    if (
      portConstraint &&
      tryZRoute(edge, source!, target!, ctx, edgeAxis, false, {
        sourceLane: portConstraint.sourceLane,
        targetLane: portConstraint.targetLane,
        preferSourceJog: true,
      })
    ) {
      cert.invariant = 'explained-detour'
      cert.directLaneClear = false
      cert.directLaneBlockedBy = [{ kind: 'port', id: edgeId(edge) }]
      cert.bendCount = bendCount(edge.points)
      return { applied: false, mutated: JSON.stringify(edge.points) !== beforeGeometry }
    }
    const attempt = tryStraighten(edge, source!, target!, ctx, edgeAxis)
    if (attempt.applied) {
      const mutated = JSON.stringify(edge.points) !== beforeGeometry
      markStraightDraft(cert, mutated)
      return { applied: true, mutated, upgradeable: (attempt.usedCandidateIndex ?? 0) > 0 }
    }
    cert.invariant = feedbackDetourKind(edge, cert.routeClass, source, target, ctx.axis) ?? 'explained-detour'
    cert.directLaneClear = false
    cert.directLaneBlockedBy = attempt.blockers
    // Geometry mutations below (loop tightening, Z-repair) must drive the
    // fixed-point retry loop: a tightened loop can vacate the lane that
    // blocked a sibling, exactly like a straightening can.
    let mutated = false
    if (cert.invariant === 'outer-feedback' || cert.invariant === 'feedback-detour') {
      if (cert.invariant === 'outer-feedback') {
        mutated = tightenOuterFeedback(edge, ctx, nodeMap)
        cert.bendCount = bendCount(edge.points)
      }
      // A loop that passes THROUGH a node (a later pass moved the node into
      // the routed corridor) is repaired like any stale route: a reverse-axis
      // Z through proven-clear lanes, or the loop stays as the explained
      // fallback.
      if (routeThroughNodeBBox(edge, ctx) && tryZRoute(edge, source!, target!, ctx, edgeAxis)) {
        cert.bendCount = bendCount(edge.points)
        mutated = true
      }
    } else if (cert.invariant === 'explained-detour' && (cert.bendCount > 2 || hasDiagonalSegment(edge.points) || routeThroughNodeBBox(edge, ctx) || !portAt(source!, edge.points[0]!) || !portAt(target!, edge.points[edge.points.length - 1]!))) {
      // Bend minimization (the Tamassia tradition): when the lane is
      // genuinely blocked, a 2-bend Z that terminates on the target's port
      // still beats ELK's multi-bend staircase. The same repair applies when
      // either endpoint has drifted off its rendered outline. Also triggered
      // whenever the kept route passes through a node — the stale-corridor
      // signature of a later pass moving a node into an already-routed channel.
      // Proof-gated like everything else; failure keeps the explained route.
      // When even the Z can't clear the obstacle (the source's whole flow side
      // is shadowed), the 3-bend sidestep detour is the last resort — it steps
      // clear of the obstacle band through a proven gap. Both are proof-gated;
      // failure keeps the explained route.
      const repaired = tryZRoute(edge, source!, target!, ctx, edgeAxis) || tryEscapeDetour(edge, source!, target!, ctx, edgeAxis)
      if (tryCrossSideEntry(edge, target!, ctx, edgeAxis) || repaired) {
        cert.bendCount = bendCount(edge.points)
        mutated = true
      }
    }
    return { applied: false, mutated }
  }

  /** Another terminal this route may not share already ends on `lane`. */
  const portHeldAgainst = (edge: PositionedEdge, lane: number, axis: Axis): boolean => ctx.edges.some(peer =>
    peer !== edge && peer.target === edge.target && peer.points.length > 1
    && Math.abs(peer.points.at(-1)![axis.cross] - lane) <= PORT_TOLERANCE && !edgesMayShareTerminal(edge, peer))

  /** A peer this route may not share a terminal with ends on the target's
   * port lane, or emits on it and so can enter it straight. */
  const portClaimedAgainst = (edge: PositionedEdge, lane: number, axis: Axis): boolean => portHeldAgainst(edge, lane, axis) || ctx.edges.some(peer => {
    if (peer === edge || peer.target !== edge.target || peer.source === edge.target || edgesMayShareTerminal(edge, peer)) return false
    const emitter = nodeMap.get(peer.source)
    return emitter !== undefined && Math.abs(emitter[axis.cross] + (axis.cross === 'y' ? emitter.height : emitter.width) / 2 - lane) <= PORT_TOLERANCE
  })

  /**
   * The target's flow-side port is claimed by a terminal this route may not
   * share. A route already reaching the target along a channel beside it can
   * carry that channel on to the target's centre and enter through the facing
   * cross-side port: port-exact, distinct, and one bend fewer than turning in
   * beside the held port. Proof-gated like the Z; failure keeps the route.
   */
  function tryCrossSideEntry(edge: PositionedEdge, target: PositionedNode, ctx: LaneContext, axis: Axis): boolean {
    if (edge.points.length < 3 || !ctx.edges.some(peer => peer !== edge && peer.target === edge.target)) return false
    const ports = shapePorts(target)
    const flowPort = ports[facingSide(axis, -1)]
    if (!portClaimedAgainst(edge, flowPort[axis.cross], axis)) return false
    const crossLo = target[axis.cross], crossHi = crossLo + (axis.cross === 'y' ? target.height : target.width)
    // The last run along the flow axis in a channel beside the target.
    let run = -1
    for (let i = edge.points.length - 1; i > 0 && run < 0; i--) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, channel = b[axis.cross]
      if (Math.abs(a[axis.cross] - channel) <= EPS && Math.abs(a[axis.main] - b[axis.main]) > EPS
        && (channel <= crossLo - CLEARANCE || channel >= crossHi + CLEARANCE)) run = i
    }
    if (run < 1) return false
    const channel = edge.points[run]![axis.cross]
    const side: PortSide = axis.cross === 'y' ? (channel < crossLo ? 'N' : 'S') : (channel < crossLo ? 'W' : 'E')
    const entry = ports[side]
    const start = edge.points[run - 1]!
    if ((entry[axis.main] - start[axis.main]) * Math.sign(edge.points[run]![axis.main] - start[axis.main]) <= EPS) return false
    const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
    if (hasDirectLaneBlocker(unlabeled, channel, Math.min(start[axis.main], entry[axis.main]), Math.max(start[axis.main], entry[axis.main]), ctx, axis)) return false
    const dropAxis = perpendicularAxis(axis, channel, entry[axis.cross])
    if (hasDirectLaneBlocker(unlabeled, entry[axis.main], Math.min(channel, entry[axis.cross]), Math.max(channel, entry[axis.cross]), ctx, dropAxis)) return false
    const route = simplifyPolyline([...edge.points.slice(0, run), axisPoint(axis, entry[axis.main], channel), entry])
    if (bendCount(route) > bendCount(edge.points) || routeAddsCrossings(route, edge, ctx) || !routeCandidateMarkersClear(edge, route, ctx.edges, ctx.style)) return false
    if (edge.label) {
      // Seat the label on the longest run of the new route, as the Z does.
      let best: [Point, Point] | undefined
      for (let i = 1; i < route.length; i++) {
        const length = Math.abs(route[i]!.x - route[i - 1]!.x) + Math.abs(route[i]!.y - route[i - 1]!.y)
        if (!best || length > Math.abs(best[1].x - best[0].x) + Math.abs(best[1].y - best[0].y)) best = [route[i - 1]!, route[i]!]
      }
      const slot = best && findLabelSlot(edge, best[0], best[1], ctx)
      if (!slot) return false
      edge.labelPosition = slot
    }
    setRoutePoints(ctx, edge, route)
    return true
  }

  /**
   * Try to replace a blocked edge's multi-bend route with a single Z:
   * lane at c1 from the source → perpendicular hop at `jog` → lane at c2
   * into the target. Candidates prefer the ports (c2 = target port, c1 =
   * source port) and fall back to the existing route's cross values — the
   * channels ELK already proved navigable. All three segments are proved,
   * the label must fit on the longest lane, and crossings may not increase.
   */
  function tryZRoute(
    edge: PositionedEdge,
    source: PositionedNode,
    target: PositionedNode,
    ctx: LaneContext,
    axis: Axis,
    sourcePortOnly = false,
    forcedLanes?: { sourceLane?: number; targetLane?: number; preferSourceJog?: boolean; requireFewerCrossings?: boolean },
  ): boolean {
    if (edge.points.length < 2) return false
    const srcSpan = attachSpan(source, axis, 1)
    const tgtSpan = attachSpan(target, axis, -1)
    if (!srcSpan || !tgtSpan) return false
    const crossVals = edge.points.map(pt => pt[axis.cross])

    const c1s: number[] = []
    const c2s: number[] = []
    const pushTo = (arr: number[], v: number) => {
      if (arr.every(prev => Math.abs(prev - v) > 0.5)) arr.push(v)
    }
    if (forcedLanes?.sourceLane !== undefined) {
      pushTo(c1s, forcedLanes.sourceLane)
    } else {
      pushTo(c1s, source[axis.cross] + (axis.cross === 'y' ? source.height : source.width) / 2)
      if (!sourcePortOnly) {
        pushTo(c1s, edge.points[0]![axis.cross])
        for (const v of crossVals) pushTo(c1s, v)
      }
    }
    if (forcedLanes?.targetLane !== undefined) {
      pushTo(c2s, forcedLanes.targetLane)
    } else {
      // This route bends anyway. When a peer that may not share its terminal
      // emits on the target's port lane, that peer can enter straight, so the
      // port goes to it and this route keeps its own entry first.
      const portLane = target[axis.cross] + (axis.cross === 'y' ? target.height : target.width) / 2
      const peerOwnsPort = ctx.edges.some(peer => {
        if (peer === edge || peer.target !== edge.target || peer.source === edge.target || edgesMayShareTerminal(edge, peer)) return false
        const emitter = nodeMap.get(peer.source)
        return emitter !== undefined && Math.abs(emitter[axis.cross] + (axis.cross === 'y' ? emitter.height : emitter.width) / 2 - portLane) <= PORT_TOLERANCE
      })
      if (peerOwnsPort) pushTo(c2s, edge.points[edge.points.length - 1]![axis.cross])
      pushTo(c2s, portLane)
      pushTo(c2s, edge.points[edge.points.length - 1]![axis.cross])
      // A port held by a terminal this route may not share leaves the lanes
      // beside it, one parallel-pair separation away, for a distinct arrowhead.
      if (portHeldAgainst(edge, portLane, axis)) for (const offset of [PAIR_SEPARATION, -PAIR_SEPARATION]) pushTo(c2s, portLane + offset)
    }

    // Obstacle-clearing escape lanes. When a later node-mover parks an
    // intervening node directly in the entry/exit lane — e.g. a BT hub centred
    // over its fan-in lands its N-side riser under a sibling diamond, the
    // edgeThroughNode signature — the node-centre and existing-route lanes above
    // are ALL blocked, so the Z falls through and the occluding route is kept.
    // For every node sitting in the source→target main-axis corridor, offer the
    // two lanes just past its cross-edges (± CLEARANCE): still on the endpoint's
    // own attach span (the emit stays port-exact), but stepped clear of the
    // obstacle. Appended AFTER the preferred lanes, so a clean case still takes
    // its centre lane first (zero churn); every escape lane is still fully
    // lane-proved below, so this only WIDENS the candidate set — it can never
    // admit an unproved route. Direction-agnostic (keyed off axis.main/cross).
    const mainExtent = (node: PositionedNode): [number, number] => {
      const lo = node[axis.main]
      return [lo, lo + (axis.main === 'x' ? node.width : node.height)]
    }
    const [srcMainLo, srcMainHi] = mainExtent(source)
    const [tgtMainLo, tgtMainHi] = mainExtent(target)
    const corridorLo = Math.min(srcMainLo, srcMainHi, tgtMainLo, tgtMainHi)
    const corridorHi = Math.max(srcMainLo, srcMainHi, tgtMainLo, tgtMainHi)
    const addEscapeLanes = (arr: number[], span: CrossSpan | null): void => {
      if (!span) return
      for (const node of ctx.nodes) {
        if (node.id === edge.source || node.id === edge.target) continue
        const [nMainLo, nMainHi] = mainExtent(node)
        if (nMainHi <= corridorLo + EPS || nMainLo >= corridorHi - EPS) continue // outside the corridor
        const nCrossLo = node[axis.cross]
        const nCrossHi = nCrossLo + (axis.cross === 'y' ? node.height : node.width)
        for (const lane of [nCrossLo - CLEARANCE - EPS, nCrossHi + CLEARANCE + EPS]) {
          if (lane >= span.lo - EPS && lane <= span.hi + EPS) pushTo(arr, lane)
        }
      }
    }
    addEscapeLanes(c1s, forcedLanes?.sourceLane === undefined ? srcSpan : null)
    addEscapeLanes(c2s, forcedLanes?.targetLane === undefined ? tgtSpan : null)

    const relaxDiamond = (node: PositionedNode, span: CrossSpan): CrossSpan => (hasFacetAttachments(node) ? { lo: node[axis.cross] + 2, hi: node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) - 2 } : span)
    const s1 = relaxDiamond(source, srcSpan)
    const s2 = relaxDiamond(target, tgtSpan)

    // The route being replaced occludes a non-incident node — a HARD defect
    // (e.g. a later node-mover parked a node in the routed corridor). Only in
    // that repair does the label fall back to an on-route seat when no clear
    // pill slot exists (see below); an ordinary blockage keeps the strict slot.
    const repairingOcclusion = !forcedLanes?.requireFewerCrossings && routeThroughNodeBBox(edge, ctx)
    // Deferred on-route label fallback: the first proven occlusion-clearing
    // route whose label lane has capacity but no fully-clear pill slot. Used
    // only if the whole search finds no route with a clear slot, so a clean
    // labelled reroute is always preferred over a grazing one. Deterministic:
    // it is the first such route in the fixed c2×c1×jog candidate order.
    let occlusionFallback: { route: Point[]; labelMid: Point } | null = null
    // This search does not mutate the edge until a candidate wins. Reuse its
    // label-free probe and lazily compute the unchanged route's crossing count.
    const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
    let priorCrossings: number | undefined
    // A successful candidate's first geometry/label write immediately returns.
    // Until then this Boolean proof depends only on the source leg and which
    // probe owns the label/self-exclusion rules. Keep its cache inside this
    // immutable search; a later edge or fixed-point round must re-prove it.
    const memoFirstLeg = !customTextMeasurementActive()
    let firstLegProofs: Array<{ jog: number; blocked: boolean } | undefined> | undefined
    // A jog beside an endpoint leaves that end's painted marker a straight shaft.
    const sourceHook = terminalHookLength(ctx.style, edge, 'start'), targetHook = terminalHookLength(ctx.style, edge, 'end')

    for (const c2 of c2s) {
      if (c2 < s2.lo - EPS || c2 > s2.hi + EPS) continue
      const tgtMain = anchorMain(target, c2, axis, -1)
      if (tgtMain === null) continue
      for (let c1Index = 0; c1Index < c1s.length; c1Index++) {
        const c1 = c1s[c1Index]!
        if (c1 < s1.lo - EPS || c1 > s1.hi + EPS) continue
        if (Math.abs(c1 - c2) < CLEARANCE) continue // that would be a hitch, not a Z
        const srcMain = anchorMain(source, c1, axis, 1)
        if (srcMain === null) continue
        // The optional container tier proves its jog lies outside both endpoint
        // bodies via their separated boxes. A slanted facet inside either box
        // cannot borrow that proof, even when its first/last ray is outward.
        if (forcedLanes?.requireFewerCrossings
          && (srcMain !== (axis.sign === 1 ? srcMainHi : srcMainLo)
            || tgtMain !== (axis.sign === 1 ? tgtMainLo : tgtMainHi))) continue
        if ((tgtMain - srcMain) * axis.sign <= EPS) continue
        const jogs = forcedLanes?.preferSourceJog
          ? [srcMain + axis.sign * sourceHook, (srcMain + tgtMain) / 2, tgtMain - axis.sign * targetHook]
          : [tgtMain - axis.sign * targetHook, (srcMain + tgtMain) / 2, srcMain + axis.sign * sourceHook]
        for (let jogIndex = 0; jogIndex < jogs.length; jogIndex++) {
          const jog = jogs[jogIndex]!
          if ((jog - srcMain) * axis.sign <= EPS || (tgtMain - jog) * axis.sign <= EPS) continue
          // The label rides the longest lane only; the other lane and the
          // hop are proved with a label-stripped probe so the own-label
          // capacity check applies exactly once, where the pill will live.
          const longFirst = Math.abs(jog - srcMain) >= Math.abs(tgtMain - jog)
          // The source anchor is fixed for c1Index throughout this search.
          // Only the target-dependent jog and probe identity can vary.
          const proofIndex = memoFirstLeg ? (c1Index * 3 + jogIndex) * 2 + Number(longFirst) : 0
          const cached = memoFirstLeg ? firstLegProofs?.[proofIndex] : undefined
          let firstBlocked: boolean
          if (cached && Object.is(cached.jog, jog)) firstBlocked = cached.blocked
          else {
            firstBlocked = hasDirectLaneBlocker(longFirst ? edge : unlabeled, c1, Math.min(srcMain, jog), Math.max(srcMain, jog), ctx, axis)
            if (memoFirstLeg) {
              if (cached) {
                cached.jog = jog
                cached.blocked = firstBlocked
              } else (firstLegProofs ??= [])[proofIndex] = { jog, blocked: firstBlocked }
            }
          }
          if (firstBlocked) continue
          const hopAxis = perpendicularAxis(axis, c1, c2)
          if (hasDirectLaneBlocker(unlabeled, jog, Math.min(c1, c2), Math.max(c1, c2), ctx, hopAxis)) continue
          if (hasDirectLaneBlocker(longFirst ? unlabeled : edge, c2, Math.min(jog, tgtMain), Math.max(jog, tgtMain), ctx, axis)) continue
          const route = [axisPoint(axis, srcMain, c1), axisPoint(axis, jog, c1), axisPoint(axis, jog, c2), axisPoint(axis, tgtMain, c2)]
          // Both the seat and the proofs below must hold, and the seat is far
          // cheaper: find it first. Only an occlusion repair still proves a
          // seatless route, to keep it as the fallback.
          const labelLane: [Point, Point] = longFirst ? [route[0]!, route[1]!] : [route[2]!, route[3]!]
          let slot: Point | null = null
          if (edge.label) {
            slot = findLabelSlot(edge, labelLane[0], labelLane[1], ctx)
            // The longer leg is preferred, but when every seat on it is taken
            // the other leg may carry the pill if it proves the capacity.
            if (!slot) {
              const other = longFirst ? findLabelSlot(edge, route[2]!, route[3]!, ctx) : findLabelSlot(edge, route[0]!, route[1]!, ctx)
              if (other && !hasDirectLaneBlocker(edge, longFirst ? c2 : c1, Math.min(longFirst ? jog : srcMain, longFirst ? tgtMain : jog), Math.max(longFirst ? jog : srcMain, longFirst ? tgtMain : jog), ctx, axis)) slot = other
            }
            if (!slot && !(repairingOcclusion && !occlusionFallback)) continue
          }
          if (!routeCandidateMarkersClear(edge, route, ctx.edges, ctx.style)) continue
          const priorContacts = Number(Boolean(portAt(source, edge.points[0]!))) + Number(Boolean(portAt(target, edge.points.at(-1)!)))
          const nextContacts = Number(Boolean(portAt(source, route[0]!))) + Number(Boolean(portAt(target, route.at(-1)!)))
          // Occlusion repair does not consult either count. It ranks a clear
          // lane above an illegal through-node route regardless of crossings.
          priorCrossings ??= repairingOcclusion ? 0 : countRouteCrossings(edge.points, edge, ctx)
          const nextCrossings = repairingOcclusion ? 0 : countRouteCrossings(route, edge, ctx, priorCrossings)
          // Crossings may not increase — unless the current route passes
          // THROUGH a node (a hard defect, e.g. a later pass moved a node
          // into the routed corridor): a legal crossing always beats an
          // occlusion. The Z itself is lane-proved through clear space.
          if (!repairingOcclusion && nextCrossings > priorCrossings) continue
          if (forcedLanes?.requireFewerCrossings && nextCrossings >= priorCrossings) continue
          if (!repairingOcclusion && nextCrossings >= priorCrossings &&
            invalidEndpointApproaches({ ...edge, points: route }, source, target) >= invalidEndpointApproaches(edge, source, target) &&
            (bendCount(route) > bendCount(edge.points) || (bendCount(route) === bendCount(edge.points) && nextContacts < priorContacts))
          )
            continue
          if (edge.label) {
            if (!slot) {
              // No fully-clear pill slot on this route's label lane. When we are
              // clearing a through-node OCCLUSION (a HARD defect) and the lane
              // proved long enough to CARRY the label (the labeled
              // directLaneBlockers check above passed), remember it as a
              // fallback and keep searching for a route WITH a clear slot: a
              // pill grazing a neighbour's bbox corner is a soft label-placement
              // concern, and trading it for a cleared HARD occlusion is strictly
              // correct by the rubric (labelOffRoute stays satisfied — the pill
              // sits on a real segment). Ordinary blockages never set this, so
              // clean cases keep the strict slot requirement.
              if (repairingOcclusion && !occlusionFallback) {
                occlusionFallback = { route, labelMid: { x: (labelLane[0].x + labelLane[1].x) / 2, y: (labelLane[0].y + labelLane[1].y) / 2 } }
              }
              continue
            }
            edge.labelPosition = slot
          }
          setRoutePoints(ctx, edge, route)
          return true
        }
      }
    }
    if (occlusionFallback) {
      setRoutePoints(ctx, edge, occlusionFallback.route)
      if (edge.label) edge.labelPosition = occlusionFallback.labelMid
      return true
    }
    return false
  }

  /**
   * Last-resort occlusion repair: a 3-bend "sidestep" detour for the case a
   * 2-bend Z cannot reach — the source's whole flow-side attach span is
   * shadowed by an obstacle, so NO straight riser off that side clears it (a BT
   * hub centred over its fan-in that lands directly beneath a wide downstream
   * diamond — the edgeThroughNode signature this pass exists to kill). The
   * detour leaves the source's flow port, rises a short way into the clear gap
   * just past the source (BEFORE the obstacle), steps sideways to an escape
   * cross-lane that proves clear through the whole corridor, rises along it past
   * the obstacle, then Z-hops into the target's flow port:
   *
   *     source ─┐(gap)                 in BT (main=y, cross=x, "up" = −y):
   *             └──────┐(escape lane)  a short N riser, a sidestep in the gap
   *                    │               below the obstacle, a full riser in a
   *                    └───┐(hop)       clear cross-lane, then the hop into H2.
   *                        ▼target
   *
   * Every one of the five segments is lane-proved (directLaneBlockers), the
   * endpoints stay exact flow ports, and the label rides the longest proven
   * lane (falling back to an on-route seat, exactly as tryZRoute does, since we
   * only run when the alternative is a HARD through-node occlusion). Runs ONLY
   * after tryZRoute fails and the current route occludes a node, so no clean or
   * Z-repairable case is touched. Deterministic: fixed candidate order over the
   * frozen geometry. Returns true iff it rerouted.
   */
  function tryEscapeDetour(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, ctx: LaneContext, axis: Axis): boolean {
    if (!routeThroughNodeBBox(edge, ctx)) return false
    const srcSpan = attachSpan(source, axis, 1)
    const tgtSpan = attachSpan(target, axis, -1)
    if (!srcSpan || !tgtSpan) return false
    const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
    const crossSize = (n: PositionedNode) => (axis.cross === 'y' ? n.height : n.width)
    const mainSizeOf = (n: PositionedNode) => (axis.main === 'x' ? n.width : n.height)

    // Source flow-port lane (cross-centre) and its forward main edge.
    const spCross = source[axis.cross] + crossSize(source) / 2
    const srcMain = anchorMain(source, spCross, axis, 1)
    // Target flow-port lane and its backward main edge.
    const tpCross = target[axis.cross] + crossSize(target) / 2
    const tgtMain = anchorMain(target, tpCross, axis, -1)
    if (srcMain === null || tgtMain === null) return false
    if (Math.abs(spCross - srcSpan.lo) > EPS && Math.abs(spCross - srcSpan.hi) > EPS && (spCross < srcSpan.lo - EPS || spCross > srcSpan.hi + EPS)) return false

    // Corridor obstacles: non-incident nodes whose main-extent lies between the
    // source's forward edge and the target's backward edge. The nearest one
    // (measured forward from the source) bounds the gap the sidestep runs in.
    interface Obs {
      mainNear: number
      crossLo: number
      crossHi: number
    }
    const obstacles: Obs[] = []
    for (const n of ctx.nodes) {
      if (n.id === edge.source || n.id === edge.target) continue
      const nMainLo = n[axis.main],
        nMainHi = nMainLo + mainSizeOf(n)
      const beyondSrc = (nMainLo - srcMain) * axis.sign > EPS || (nMainHi - srcMain) * axis.sign > EPS
      const beforeTgt = (tgtMain - nMainLo) * axis.sign > EPS || (tgtMain - nMainHi) * axis.sign > EPS
      if (!beyondSrc || !beforeTgt) continue
      const mainNear = axis.sign > 0 ? nMainLo : nMainHi
      obstacles.push({ mainNear, crossLo: n[axis.cross], crossHi: n[axis.cross] + crossSize(n) })
    }
    // Only worth attempting when an obstacle actually shadows the source lane.
    const shadowing = obstacles.filter(o => spCross > o.crossLo - CLEARANCE && spCross < o.crossHi + CLEARANCE)
    if (shadowing.length === 0) return false
    // Gap main-coord between the source's exit and the nearest shadowing
    // obstacle's near edge — the lane the sidestep travels along.
    const nearestNear = shadowing.reduce((best, o) => ((o.mainNear - srcMain) * axis.sign < (best - srcMain) * axis.sign ? o.mainNear : best), shadowing[0]!.mainNear)
    if ((nearestNear - srcMain) * axis.sign <= CLEARANCE) return false // no room to sidestep before the obstacle
    const gapMain = srcMain + (nearestNear - srcMain) / 2
    // The flow-port lane first; one held by a terminal this route may not
    // share leaves the lanes beside it (mirrors tryZRoute's target lanes).
    const entryLanes = [tpCross]
    if (portHeldAgainst(edge, tpCross, axis)) entryLanes.push(tpCross + PAIR_SEPARATION, tpCross - PAIR_SEPARATION)

    // Escape cross-lanes: just past every obstacle's cross-edges, and the
    // midpoints of the gaps BETWEEN adjacent obstacles (a clean channel like the
    // R0|R1 gap). Nearest-to-the-source-lane first, so the detour stays compact.
    const escCandidates: number[] = []
    const pushCand = (v: number) => {
      if (escCandidates.every(p => Math.abs(p - v) > 0.5)) escCandidates.push(v)
    }
    for (const o of obstacles) {
      pushCand(o.crossLo - CLEARANCE - EPS)
      pushCand(o.crossHi + CLEARANCE + EPS)
    }
    const crossSorted = [...obstacles].sort((a, b) => a.crossLo - b.crossLo)
    for (let i = 1; i < crossSorted.length; i++) {
      const gapLo = crossSorted[i - 1]!.crossHi,
        gapHi = crossSorted[i]!.crossLo
      if (gapHi - gapLo > 2 * CLEARANCE) pushCand((gapLo + gapHi) / 2)
    }
    escCandidates.sort((a, b) => Math.abs(a - spCross) - Math.abs(b - spCross))


    let fallback: { route: Point[]; labelMid: Point } | null = null
    for (const entryCross of entryLanes) {
      if (entryCross < tgtSpan.lo - EPS || entryCross > tgtSpan.hi + EPS) continue
      const entryMain = anchorMain(target, entryCross, axis, -1)
      if (entryMain === null) continue
      // Hop main-coord just short of the target's backward edge (mirrors tryZRoute's jog).
      const hopMain = entryMain - axis.sign * terminalHookLength(ctx.style, edge, 'end')
      if ((hopMain - gapMain) * axis.sign <= EPS) continue
      for (const escCross of escCandidates) {
        if (Math.abs(escCross - spCross) < CLEARANCE) continue // that is just the shadowed lane
        // A: short riser off the source flow port, in the pre-obstacle gap.
        if (hasDirectLaneBlocker(unlabeled, spCross, Math.min(srcMain, gapMain), Math.max(srcMain, gapMain), ctx, axis)) continue
        // B: sidestep along the gap to the escape lane.
        if (hasDirectLaneBlocker(unlabeled, gapMain, Math.min(spCross, escCross), Math.max(spCross, escCross), ctx, perpendicularAxis(axis, spCross, escCross))) continue
        // C: full riser along the escape lane, up to the hop.
        if (hasDirectLaneBlocker(unlabeled, escCross, Math.min(gapMain, hopMain), Math.max(gapMain, hopMain), ctx, axis)) continue
        // D: hop across to the target's entry lane.
        if (hasDirectLaneBlocker(unlabeled, hopMain, Math.min(escCross, entryCross), Math.max(escCross, entryCross), ctx, perpendicularAxis(axis, escCross, entryCross))) continue
        // E: drop into the target.
        if (hasDirectLaneBlocker(unlabeled, entryCross, Math.min(hopMain, entryMain), Math.max(hopMain, entryMain), ctx, axis)) continue
        const route = simplifyPolyline([
          axisPoint(axis, srcMain, spCross), axisPoint(axis, gapMain, spCross), axisPoint(axis, gapMain, escCross),
          axisPoint(axis, hopMain, escCross), axisPoint(axis, hopMain, entryCross), axisPoint(axis, entryMain, entryCross),
        ])
        if (!routeCandidateMarkersClear(edge, route, ctx.edges, ctx.style)) continue
        // The escape riser (segment C) is the longest lane and the only one that
        // reliably clears the obstacle band — seat the label there.
        const labelLane: [Point, Point] = [axisPoint(axis, gapMain, escCross), axisPoint(axis, hopMain, escCross)]
        if (edge.label) {
          const slot = findLabelSlot(edge, labelLane[0], labelLane[1], ctx)
          if (slot) { edge.labelPosition = slot; setRoutePoints(ctx, edge, route); return true }
          if (!fallback) fallback = { route, labelMid: { x: (labelLane[0].x + labelLane[1].x) / 2, y: (labelLane[0].y + labelLane[1].y) / 2 } }
          continue
        }
        setRoutePoints(ctx, edge, route)
        return true
      }
    }
    if (fallback) {
      setRoutePoints(ctx, edge, fallback.route)
      if (edge.label) edge.labelPosition = fallback.labelMid
      return true
    }
    return false
  }

  /**
   * Port-ranking hook (the flowchart convention IBM's manuals illustrate and
   * yFiles' FlowchartLayout encodes): when a vertex emit cannot go straight,
   * the next-best route is a single-bend L — the vertex lane along the flow
   * axis, then ONE perpendicular drop into the target's FACING cross-side
   * port (the box's top/bottom in horizontal flow). One bend beats the
   * 2-bend Z, both endpoints are exact canonical ports, and the target's
   * flow-side port stays free for its fan-in siblings. Skipped when the
   * entry stub would be shorter than HOOK_STUB_MIN (degenerate when the
   * vertex lane grazes the target, as in TD where siblings sit beside each
   * other) — the Z remains the fallback there.
   */
  function tryVertexHook(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, ctx: LaneContext, axis: Axis): boolean {
    if (edge.points.length < 2) return false
    const lane = source[axis.cross] + (axis.cross === 'y' ? source.height : source.width) / 2
    const tgtCrossLo = target[axis.cross]
    const tgtCrossHi = tgtCrossLo + (axis.cross === 'y' ? target.height : target.width)
    // The lane must pass clear of the target's cross extent; when it
    // overlaps, the straight emit or the Z is the right tool, not a hook.
    // The entry point is the exact facing cross-side port from shapePorts
    // (bbox side midpoint for symmetric shapes, on-outline for the slanted
    // family), not a bare bbox coordinate.
    let entrySide: PortSide
    if (lane < tgtCrossLo - EPS) entrySide = axis.cross === 'y' ? 'N' : 'W'
    else if (lane > tgtCrossHi + EPS) entrySide = axis.cross === 'y' ? 'S' : 'E'
    else return false
    const entryCross = shapePorts(target)[entrySide][axis.cross]
    if (Math.abs(entryCross - lane) < HOOK_STUB_MIN) return false
    // Fan-in merge outranks the hook: when a same-target sibling already
    // holds the flow-side entry port, the Z that converges there into one
    // shared arrowhead (yFiles edge grouping; Kakoulis–Tollis label/edge
    // unambiguity) beats splitting the fan-in across two sides. The fixed
    // point makes this order-independent: a hook taken before the sibling
    // settles is re-proved and downgraded on the next round.
    const entryPort = shapePorts(target)[facingSide(axis, -1)]
    const mergeAvailable = ctx.edges.some(
      other => other !== edge && other.target === edge.target && other.source !== edge.source && other.points.length > 0 && edgesMayShareTerminal(edge, other) && Math.abs(other.points[other.points.length - 1]!.x - entryPort.x) <= PORT_TOLERANCE && Math.abs(other.points[other.points.length - 1]!.y - entryPort.y) <= PORT_TOLERANCE,
    )
    if (mergeAvailable) return false
    const portMain = shapePorts(target)[entrySide][axis.main]
    const srcMain = anchorMain(source, lane, axis, 1)
    if (srcMain === null) return false
    if ((portMain - srcMain) * axis.sign <= EPS) return false
    // The label rides the lane; the entry stub is proved label-stripped
    // (own-label capacity applies exactly once, where the pill lives).
    const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
    if (hasDirectLaneBlocker(edge, lane, Math.min(srcMain, portMain), Math.max(srcMain, portMain), ctx, axis)) return false
    const stubAxis = perpendicularAxis(axis, lane, entryCross)
    if (hasDirectLaneBlocker(unlabeled, portMain, Math.min(lane, entryCross), Math.max(lane, entryCross), ctx, stubAxis)) return false
    const route = [axisPoint(axis, srcMain, lane), axisPoint(axis, portMain, lane), axisPoint(axis, portMain, entryCross)]
    if (!routeCandidateMarkersClear(edge, route, ctx.edges, ctx.style)) return false
    if (!routeThroughNodeBBox(edge, ctx) &&
      routeAddsCrossings(route, edge, ctx)) return false
    if (edge.label) {
      const slot = findLabelSlot(edge, route[0]!, route[1]!, ctx)
      if (!slot) return false
      edge.labelPosition = slot
    }
    setRoutePoints(ctx, edge, route)
    return true
  }
  const loopMarkerBlockers: RouteBlocker[] = []
  const reservedLoops = new Set<PositionedEdge>()
  const repairSelfLoopArc = createSelfLoopRouter(nodeMap, groupMap, ctx, loopMarkerBlockers, reservedLoops)

  const retry: Array<{ edge: PositionedEdge; cert: DraftRouteCertificate }> = []
  for (const edge of positioned.edges) {
    const bundle = bundled.has(edge) ? bundleRouteBeforeRewrite(edge) : undefined
    let normalized = simplifyPolyline(orthogonalizeResidualDiagonals(edge.points))
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (source) normalized = trimOccludedShapeEndpoint(normalized, source, true)
    if (target) normalized = trimOccludedShapeEndpoint(normalized, target, false)
    if (routeCandidateMarkersClear(edge, normalized, ctx.edges, ctx.style)) setRoutePoints(ctx, edge, normalized)
    retainBundleRouteAfterRewrite(edge, bundle)

    const edgeIndex = edge.edgeIndex ?? -1
    const routeClass: RouteClass = classes[edgeIndex] ?? 'primary-forward'
    const cert: DraftRouteCertificate = {
      edgeIndex,
      routeClass,
      bendCount: bendCount(edge.points),
      invariant: 'straight',
    }

    if (bundled.has(edge) && hasConstructedBundleRoute(edge)) {
      cert.invariant = 'bundle'
    } else if (routeClass === 'self-loop') {
      let retained: PortSide | undefined
      if (options?.preserveSelfLoops) {
        const node = nodeMap.get(edge.source)
        const outwardSide = (a: Point, b: Point): PortSide | undefined => {
          if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) > EPS) return b.y > a.y ? 'S' : 'N'
          if (Math.abs(a.y - b.y) <= EPS && Math.abs(a.x - b.x) > EPS) return b.x > a.x ? 'E' : 'W'
          return undefined
        }
        const first = edge.points[0], last = edge.points.at(-1)
        const next = first && edge.points.find(point => Math.hypot(point.x - first.x, point.y - first.y) > EPS)
        const previous = last && [...edge.points].reverse().find(point => Math.hypot(point.x - last.x, point.y - last.y) > EPS)
        retained = node && first && last && next && previous && Math.hypot(first.x - last.x, first.y - last.y) >= 8
          && outwardSide(first, next) === outwardSide(last, previous) ? outwardSide(first, next) : undefined
      }
      // Native placement reserves the arc and its label before positioning.
      // Retain that proposal; the same final occupancy/outline auditor still
      // proves it, including distinct contacts and clearance from every loop.
      loopMarkerBlockers.length = 0
      if (retained && positioned.edges.some(other => other !== edge && other.source === other.target && routesCrossOrOverlap(edge.points, other.points))) retained = undefined
      const side = retained ?? repairSelfLoopArc(edge)
      if (side) {
        reservedLoops.add(edge)
        cert.invariant = 'self-loop'
        cert.loopSide = side
        cert.bendCount = bendCount(edge.points)
      } else {
        // Never stamp a self-loop certificate when bounded attachment
        // allocation failed; downstream audits must see an unproven detour.
        cert.invariant = 'explained-detour'
        if (loopMarkerBlockers.length) cert.directLaneBlockedBy = [...loopMarkerBlockers]
      }
    } else if (routeClass === 'container') {
      cert.invariant = 'container-attach'
      const repair = containerRepairGeometry(edge, groupMap, nodeMap)
      if (repair) {
        const straight = tryStraighten(edge, repair.source, repair.target, ctx, repair.axis).applied
        // A separated frame can have no common straight lane while another
        // automatic face slot admits a clear Z. Reuse the existing constructor
        // only for an actual crossing in an unlabelled graph, requiring strict
        // crossing improvement. Label/halo placement keeps its existing path.
        const improved = !straight
          && (unlabelledContainerRepair ??= withinLayoutPreferenceBudget(graph) && !customTextMeasurementActive() && !positioned.edges.some(candidate => candidate.label))
          && countRouteCrossings(edge.points, edge, ctx) > 0
          && tryZRoute(edge, repair.source, repair.target, ctx, repair.axis, false, { requireFewerCrossings: true })
        if (straight || improved) {
          cert.bendCount = bendCount(edge.points)
          if (straight) { cert.directLaneClear = true; cert.straightened = true }
        }
      }
    } else if (routeClass === 'primary-forward' || routeClass === 'feedback') {
      // Writer-equivalent elbows still need structural normalization.
      if (edge.points.length > 2) {
        const r = attemptStraighten(edge, cert)
        if (!r.applied || r.upgradeable) retry.push({ edge, cert })
      } else {
        // Already straight, but possibly off-port: ELK's FREE placement can
        // leave a straight lane floating beside the side midpoints. Re-lane
        // through the ports when that proves clear — the candidate order
        // tries the target port first and falls back to the current lane,
        // so a blocked port lane leaves the edge untouched.
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        // A reciprocal-pair member must enroll even when straight and
        // on-port: its contract lane is the symmetric one (center ± SEP/2),
        // not the port lane, and the symmetric lane often only clears after
        // its partner is repaired.
        const reciprocal = !edge.label && edge.edgeIndex !== undefined && positioned.edges.some(other => other !== edge && other.source === edge.target && other.target === edge.source && !other.label && other.edgeIndex !== undefined)
        // A bendless route can still be one diagonal: a placement pass that
        // moved one endpoint onto a predicted lane leaves it for this proof.
        const [first, last] = [edge.points[0]!, edge.points[edge.points.length - 1]!]
        if (sourceNode && targetNode && (hasDiagonalSegment(edge.points) || !portAt(sourceNode, first) || !portAt(targetNode, last) || invalidEndpointApproaches(edge, sourceNode, targetNode) > 0 || routeThroughNodeBBox(edge, ctx) || reciprocal)) {
          // Enroll in the fixed-point pool like every other repair: an
          // upgrade blocked now (e.g. a label pill in the vertex lane) may
          // clear once a later repair moves the obstacle.
          const r = attemptStraighten(edge, cert)
          if (!r.applied || r.upgradeable) retry.push({ edge, cert })
        }
      }
    }

    drafts.push({ edge, cert })
  }

  // Fixed point: each round re-proves edges that failed OR landed on a
  // non-preferred lane (upgradeable), and only keeps iterating while some
  // geometry actually moved — re-proving an unchanged lane is idempotent, so
  // the loop terminates as soon as a round is a no-op; 4 rounds cover practice.
  for (let round = 0; round < 4 && retry.length > 0; round++) {
    const still: typeof retry = []
    let changed = false
    for (const item of retry) {
      if (item.cert.invariant === 'unverified-shape') continue
      const r = attemptStraighten(item.edge, item.cert)
      if (r.mutated) changed = true
      if (!r.applied || r.upgradeable) still.push(item)
    }
    if (!changed) break
    retry.length = 0
    retry.push(...still)
  }

  for (const edge of positioned.edges) {
    const bundle = bundled.has(edge) ? bundleRouteBeforeRewrite(edge) : undefined
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (sourceNode) repairRectLikeEndpointOverflow(edge, sourceNode, true, ctx)
    if (targetNode) repairRectLikeEndpointOverflow(edge, targetNode, false, ctx)
    let normalized = edge.points
    if (sourceNode) normalized = trimOccludedShapeEndpoint(normalized, sourceNode, true)
    if (targetNode) normalized = trimOccludedShapeEndpoint(normalized, targetNode, false)
    if (routeCandidateMarkersClear(edge, normalized, ctx.edges, ctx.style)) setRoutePoints(ctx, edge, normalized)
    retainBundleRouteAfterRewrite(edge, bundle)
  }

  const certificates: RouteCertificate[] = []
  const finalPortPlan = allocateRoutePorts(positioned, graph, classes)
  const finalizeCertificate = (edge: PositionedEdge, draft: DraftRouteCertificate): RouteCertificate => {
    const bendCountFinal = bendCount(edge.points)
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    const portAssignment = finalPortPlan.byEdge.get(edge)
    const base = {
      edgeIndex: draft.edgeIndex,
      routeClass: draft.routeClass,
      bendCount: bendCountFinal,
      directLaneClear: draft.directLaneClear,
      directLaneBlockedBy: draft.directLaneBlockedBy,
      sourcePort: sourceNode && edge.points.length > 0 ? portAt(sourceNode, edge.points[0]!) : undefined,
      targetPort: targetNode && edge.points.length > 0 ? portAt(targetNode, edge.points[edge.points.length - 1]!) : undefined,
      sourcePortAssignment: portAssignment?.source,
      targetPortAssignment: portAssignment?.target,
      ...(draft.loopSide !== undefined ? { loopSide: draft.loopSide } : {}),
    }
    // Public route certificates are a discriminated union: only final
    // straight routes may carry `straightened`. A retry can downgrade an
    // earlier straightening to a detour; the type forbids exporting that
    // stale impossible state.
    if (draft.invariant === 'straight' && bendCountFinal === 0 && edge.points.length === 2) {
      return { ...base, invariant: 'straight', ...(draft.straightened ? { straightened: true as const } : {}) }
    }
    return { ...base, invariant: draft.invariant === 'straight' ? 'explained-detour' : draft.invariant }
  }

  // Record final route facts after ALL geometry has settled (straightening,
  // tightening, and fixed-point retries).
  for (const { edge, cert: draft } of drafts) {
    const cert = finalizeCertificate(edge, draft)
    edge.routeCertificate = cert
    certificates.push(cert)
  }

  return certificates
}

/**
 * Re-issue a certificate for an edge a post-freeze repair has re-routed. A pass
 * that mutates final route geometry must hand the completeness contract on —
 * an uncertified edge is exactly what the certificate system exists to forbid
 * (issue #83: the shared-trunk label lane shipped one). The route class and
 * direct-lane analysis are inherited from the pre-repair certificate (they
 * describe the source→target relationship, not the polyline); the bend count
 * and port contacts are re-measured from the repaired geometry; and a repaired
 * route only claims 'straight' when it measurably is one now — never a
 * straightening, which belongs to the certifying straightener alone.
 */
export function recertifyReroutedEdge(edge: PositionedEdge, saved: RouteCertificate | undefined, sourceNode?: PositionedNode, targetNode?: PositionedNode): void {
  if (!saved) {
    edge.routeCertificate = undefined
    return
  }
  const base = {
    edgeIndex: saved.edgeIndex,
    routeClass: saved.routeClass,
    bendCount: bendCount(edge.points),
    directLaneClear: saved.directLaneClear,
    directLaneBlockedBy: saved.directLaneBlockedBy,
    sourcePort: sourceNode && edge.points.length > 0 ? portAt(sourceNode, edge.points[0]!) : saved.sourcePort,
    targetPort: targetNode && edge.points.length > 0 ? portAt(targetNode, edge.points[edge.points.length - 1]!) : saved.targetPort,
    sourcePortAssignment: saved.sourcePortAssignment,
    targetPortAssignment: saved.targetPortAssignment,
    ...(saved.loopSide !== undefined ? { loopSide: saved.loopSide } : {}),
  }
  if (edge.points.length === 2 && bendCount(edge.points) === 0) {
    edge.routeCertificate = { ...base, invariant: 'straight' }
    return
  }
  edge.routeCertificate = {
    ...base,
    invariant: saved.invariant === 'straight' || (saved.invariant === 'bundle' && !hasConstructedBundleRoute(edge)) ? 'explained-detour' : saved.invariant,
  }
}

// =====================================================================// Validation (consumed by verifyMermaid as ROUTE_HITCH)
// =====================================================================
export interface RouteHitch {
  edge: string
  deviationPx: number
}

/**
 * Re-prove the straight-lane invariant over FINAL geometry. A hitch is a
 * primary-forward or feedback edge that still bends although a clear
 * candidate lane exists for it. The layout pass straightens these itself, so
 * any hit here means final route-contract closure failed to reconcile a late
 * edge or label repair — the tripwire issue #25 acceptance criterion 3 asks for.
 */
export function findRouteHitches(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle = resolveRenderStyle({})): RouteHitch[] {
  return scanRouteHitches(positioned, graph, style, false)
}

/** Run the final hitch proof over settled geometry. In closing mode, mutate
 * only edges for which that exact proof succeeds. Every successful mutation
 * removes one bent edge and never bends a straight edge, so repeated scans
 * terminate after at most `edges.length` rounds without relying on geometry
 * equality or an empirical retry count. */
function scanRouteHitches(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle, close: boolean): RouteHitch[] {
  // Reuse the producer's priority and occupancy rules with the final certified
  // classes. In particular, bundle-owned routes must not become audit-only
  // diamond-side competitors.
  const classes: RouteClass[] = []
  for (const e of positioned.edges) {
    if (e.edgeIndex !== undefined && e.routeCertificate) classes[e.edgeIndex] = e.routeCertificate.routeClass
  }
  const { axis, ctx } = buildRouteLaneContext(
    positioned,
    graph,
    style,
    classes,
    hasBundleRouteExemption,
    true,
  )
  const nodeMap = indexRouteNodes(positioned.nodes)
  const sideUse = ctx.sideUse!
  const hitches: RouteHitch[] = []
  const closedEdges = new Set<PositionedEdge>()

  for (const edge of positioned.edges) {
    const cert = edge.routeCertificate
    if (!cert || hasBundleRouteExemption(edge)) continue
    if (cert.routeClass !== 'primary-forward' && cert.routeClass !== 'feedback') continue
    const edgeAxis: Axis = cert.routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
    const points = simplifyPolyline(edge.points)
    if (points.length <= 2) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!isStraightenable(source)) continue
    if (!isStraightenable(target)) continue
    if (cert.routeClass !== 'feedback' && !isMonotoneStaircase(points, edgeAxis)) continue
    const portConstraint = diamondSpreadTargetPortConstraint(edge, source, target, ctx, edgeAxis)
    if (portConstraint && satisfiesDiamondSpreadTargetPortConstraint(edge, source, target, portConstraint)) continue
    // Vertex-emit edges (single-line diamond side) bend deliberately when no
    // straight vertex lane exists; their probe is restricted to that lane.
    const srcSideUse = sideUse.get(`${edge.source}:${facingSide(edgeAxis, 1)}`) ?? 1
    const emitFromVertex = cert.routeClass === 'primary-forward' && hasFacetAttachments(source) && srcSideUse === 1 && portSharpness(source) >= portSharpness(target)
    const vertexLane = emitFromVertex ? source[edgeAxis.cross] + (edgeAxis.cross === 'y' ? source.height : source.width) / 2 : undefined
    // Validation probes a copy; final closure applies the same proof to the
    // actual edge. Because the context owns the live edge array, later edges
    // see every earlier closure and cannot be admitted against stale routes.
    const probe: PositionedEdge = close ? edge : { ...edge, points: points.map(p => ({ ...p })) }
    const attempt = tryStraighten(probe, source, target, ctx, edgeAxis, vertexLane, edge)
    if (attempt.applied) {
      hitches.push({ edge: edgeId(edge), deviationPx: Math.round(crossDeviation(points, edgeAxis) * 10) / 10 })
      if (close) closedEdges.add(edge)
    }
  }

  if (closedEdges.size > 0) {
    const finalPortPlan = allocateRoutePorts(positioned, graph, classes)
    for (const edge of closedEdges) {
      const saved = edge.routeCertificate
      if (!saved || edge.points.length !== 2 || bendCount(edge.points) !== 0) continue
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      const assignments = finalPortPlan.byEdge.get(edge)
      edge.routeCertificate = {
        edgeIndex: saved.edgeIndex,
        routeClass: saved.routeClass,
        invariant: 'straight',
        bendCount: 0,
        directLaneClear: true,
        sourcePort: source ? portAt(source, edge.points[0]!) : undefined,
        targetPort: target ? portAt(target, edge.points[1]!) : undefined,
        sourcePortAssignment: assignments?.source,
        targetPortAssignment: assignments?.target,
        straightened: true,
      }
    }
  }
  return hitches
}

/**
 * Container edges must run border to border (spec §11.5). Under SEPARATE
 * hierarchy mode (subgraph direction overrides) ELK can leave a
 * container-to-container edge floating in the diagram margin, attached to
 * neither box. When the two end rects are cleanly separated along one axis,
 * collapse the route onto a proven straight lane between the facing borders
 * — the same machinery as node straightening, with the container rect
 * standing in as a rectangle. Return the eligible separated geometry.
 */
function containerRepairGeometry(
  edge: PositionedEdge,
  groupMap: Map<string, PositionedGroup>,
  nodeMap: Map<string, PositionedNode>,
): { source: PositionedNode; target: PositionedNode; axis: Axis } | null {
  const rectFor = (id: string): PositionedNode | null => {
    const group = groupMap.get(id)
    if (group) return { id, label: '', shape: 'rectangle', x: group.x, y: group.y, width: group.width, height: group.height }
    const node = nodeMap.get(id)
    if (node && isStraightenable(node)) return node
    return null
  }
  const src = rectFor(edge.source)
  const tgt = rectFor(edge.target)
  if (!src || !tgt) return null

  // Already a straight border-to-border lane: nothing to repair.
  const simplified = simplifyPolyline(edge.points)
  if (simplified.length === 2 &&
    onRectPerimeter(simplified[0]!, src.x, src.y, src.width, src.height, 1) &&
    onRectPerimeter(simplified[1]!, tgt.x, tgt.y, tgt.width, tgt.height, 1)) {
    return null
  }

  // The lane axis comes from how the rects are separated, not the graph
  // direction — a direction-override parent can stack siblings either way.
  const gaps: Array<{ gap: number; axis: Axis }> = [
    { gap: tgt.y - (src.y + src.height), axis: { main: 'y', cross: 'x', sign: 1 } },
    { gap: src.y - (tgt.y + tgt.height), axis: { main: 'y', cross: 'x', sign: -1 } },
    { gap: tgt.x - (src.x + src.width), axis: { main: 'x', cross: 'y', sign: 1 } },
    { gap: src.x - (tgt.x + tgt.width), axis: { main: 'x', cross: 'y', sign: -1 } },
  ]
  const best = gaps.filter(g => g.gap > EPS).sort((a, b) => b.gap - a.gap)[0]
  if (!best) return null

  return { source: src, target: tgt, axis: best.axis }
}

// =====================================================================// Route audit — the remaining issue #25 Phase 1 warning codes. Each check is
// a tripwire: the pipeline upholds these invariants itself, so any finding
// means a later pass broke geometry after certification. All definitions are
// chosen to be zero-noise on the corpus.
// =====================================================================
export type RouteAuditFinding =
  | { code: 'ROUTE_UNEXPLAINED_BEND'; edge: string }
  | { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: string; sharedWith: string }
  | { code: 'ROUTE_SELF_LOOP_OCCUPANCY'; edge: string; conflictWith?: string; kind: 'allocation' | 'side' | 'boundary' | 'route-route' | 'label-label' | 'label-route' }
  | { code: 'ROUTE_CONTAINER_MISANCHOR'; edge: string; container: string }
  | { code: 'ROUTE_SHAPE_MISANCHOR'; edge: string; node: string }
  | { code: 'ROUTE_STALE_AFTER_NODE_MOVE'; edge: string; node: string }

/** Within `tol` of the rectangle's perimeter (on an edge line, inside its range). */
function onRectPerimeter(p: Point, x: number, y: number, w: number, h: number, tol: number): boolean {
  const onVertical = (Math.abs(p.x - x) <= tol || Math.abs(p.x - (x + w)) <= tol) && p.y >= y - tol && p.y <= y + h + tol
  const onHorizontal = (Math.abs(p.y - y) <= tol || Math.abs(p.y - (y + h)) <= tol) && p.x >= x - tol && p.x <= x + w + tol
  return onVertical || onHorizontal
}

function flattenGroups(groups: PositionedGroup[], out: Map<string, PositionedGroup> = new Map()): Map<string, PositionedGroup> {
  for (const g of groups) {
    out.set(g.id, g)
    flattenGroups(g.children, out)
  }
  return out
}

/** Label repairs share the same stable longest-segment and center-out order. */
const LABEL_SEAT_SORT_DENIED = Symbol('label-seat-sort-denied')
function orderedLabelSegments(edge: PositionedEdge): Array<{ a: Point; b: Point; vertical: boolean; len: number; i: number }>
function orderedLabelSegments(edge: PositionedEdge, pay: (units: number) => boolean): Array<{ a: Point; b: Point; vertical: boolean; len: number; i: number }> | undefined
function orderedLabelSegments(edge: PositionedEdge, pay?: (units: number) => boolean): Array<{ a: Point; b: Point; vertical: boolean; len: number; i: number }> | undefined {
  if (pay && !pay(1)) return undefined
  const segs: Array<{ a: Point; b: Point; vertical: boolean; len: number; i: number }> = []
  for (let i = 1; i < edge.points.length; i++) {
    if (pay && !pay(2)) return undefined
    const a = edge.points[i - 1]!, b = edge.points[i]!
    const vertical = Math.abs(a.x - b.x) < EPS
    if (vertical || Math.abs(a.y - b.y) < EPS) {
      if (pay && !pay(12)) return undefined
      segs.push({ a, b, vertical, len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), i })
    }
  }
  if (pay && !pay(segs.length * 2 + 1)) return undefined
  const denied = LABEL_SEAT_SORT_DENIED
  try { segs.sort((p, q) => { if (pay && !pay(4)) throw denied; return q.len - p.len || p.i - q.i }) }
  catch (error) { if (error === denied) return undefined; throw error }
  return segs
}

export function centerOutLabelSamples(tMargin: number, work?: () => void): number[] {
  work?.()
  const ts: number[] = []
  const N = 11
  for (let k = 0; k < N; k++) { work?.(); ts.push(tMargin + (1 - 2 * tMargin) * (k / (N - 1))) }
  return ts.sort((a, b) => { work?.(); return Math.abs(a - 0.5) - Math.abs(b - 0.5) })
}

/** Reuse the fitting interval and interpolation without changing each pass's
 * candidate order, offsets, overhang policy or rescue work charge. */
function* labelSegmentSamples(segments: ReturnType<typeof orderedLabelSegments>, width: number, height: number, offset = 0, overhang = false, fixedOrder = false, pay?: (units: number) => boolean): Generator<Point> {
  if (!segments) return
  for (const segment of segments) {
    const half = (segment.vertical ? height : width) / 2
    if (!overhang && segment.len <= 2 * half) continue
    const margin = overhang ? 0 : half / segment.len
    if (pay && !pay(160)) return
    const samples = fixedOrder ? [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10].map(k => margin + (1 - 2 * margin) * (k / 10)) : centerOutLabelSamples(margin)
    for (const t of samples) yield {
      x: segment.a.x + (segment.b.x - segment.a.x) * t + (segment.vertical ? offset : 0),
      y: segment.a.y + (segment.b.y - segment.a.y) * t + (segment.vertical ? 0 : offset),
    }
  }
}

type LabelPaintRect = { x: number; y: number; w: number; h: number }

/** Match renderEdgeLabel's opaque halo, including thick-edge paint. */
function labelHaloPadding(edge: PositionedEdge, style: LabelMetricsStyle): number {
  return labelHaloExtension(edge, style.lineWidth ?? 1)
}

/** Owned label-only passes leave routes fixed. Reentrant host measurement
 * can replace peer geometry, so only the owned path reuses marker footprints. */
export function labelPaintClearance(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, style: LabelMetricsStyle, work?: () => void) {
  work?.()
  let markers: ReturnType<typeof graphEdgeMarkerPaintRegions> | undefined
  const overlapsHeader = (pill: LabelPaintRect, groups: readonly PositionedGroup[]): boolean => groups.some(group => {
    work?.()
    // Production retains the measured strip. An unmeasured group cannot
    // establish a clear interior slot; keep its full extent conservative.
    const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
    return height > 0 && pill.x < group.x + group.width && pill.x + pill.w > group.x
      && pill.y < group.y + height && pill.y + pill.h > group.y || overlapsHeader(pill, group.children)
  })
  const overlapsMarker = (pill: LabelPaintRect): boolean => {
    const current = customTextMeasurementActive()
      ? positioned.edges.flatMap(edge => { work?.(); return graphEdgeMarkerPaintRegions(edge, style) })
      : markers ??= positioned.edges.flatMap(edge => { work?.(); return graphEdgeMarkerPaintRegions(edge, style) })
    for (const marker of current) {
      work?.()
      const box = marker.bounds
      if (box && pill.x < box.x1 && pill.x + pill.w > box.x0 && pill.y < box.y1 && pill.y + pill.h > box.y0) return true
    }
    return false
  }
  const clearPaintRect = (inner: LabelPaintRect, halo: number, edge: PositionedEdge): LabelPaintRect | undefined => {
    work?.()
    const pill = { x: inner.x - halo, y: inner.y - halo, w: inner.w + 2 * halo, h: inner.h + 2 * halo }
    // Own endpoint cards are obstacles too: a repair must not exchange a
    // route-label ambiguity for hidden authored text or terminal symbols.
    // Beside them the halo also leaves that end's marker and some line.
    const lineWidth = style.lineWidth ?? 1
    const sourceGap = labelEndpointClearance(edge, lineWidth, 'start') - halo, targetGap = labelEndpointClearance(edge, lineWidth, 'end') - halo
    if (positioned.nodes.some(node => {
      work?.()
      const gap = Math.max(0, node.id === edge.source ? sourceGap : 0, node.id === edge.target ? targetGap : 0)
      return pill.x < node.x + node.width + gap && pill.x + pill.w + gap > node.x && pill.y < node.y + node.height + gap && pill.y + pill.h + gap > node.y
    }) || overlapsHeader(pill, positioned.groups) || overlapsMarker(pill)) return undefined
    return pill
  }
  return { overlapsMarker, clearPaintRect }
}

/**
 * Post-freeze label repair for ROUTE_LABEL_ON_SHARED_TRUNK. A labeled edge whose
 * pill sits on a trunk shared with another edge is illegible — the reader cannot
 * tell which edge the label names. An earlier pass can place such a label on a
 * congested segment (e.g. a labeled edge running alongside its fan-out siblings),
 * and applyRouteContracts only re-slots labels on edges it re-routes, so these
 * survive to the output. Here we re-run the clearance-aware findLabelSlot over
 * the edge's own axis-aligned segments (longest first — most room) and move ONLY
 * the label to the first position clear of every node and foreign segment.
 *
 * Prefer a geometry-preserving label seat. A fully shared run can instead
 * require a private channel; that bounded proposal retains both endpoint
 * normals and proves the route and its pill together before committing.
 */
export function repairLabelsOnSharedTrunks(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  graph: MermaidGraph,
  style: LabelMetricsStyle,
): void {
  // Clear the shared-trunk ambiguity without covering a card or endpoint
  // marker. Perpendicular shaft crossings retain their established policy.
  let clearance: ReturnType<typeof labelPaintClearance> | undefined
  const channels: Array<{ edge: PositionedEdge; width: number }> = []
  for (const edge of positioned.edges) {
    if (!edge.label || !edge.labelPosition || edge.points.length < 2) continue
    if (!sharedTrunkConflict(edge, positioned.edges, style)) continue
    const paint = clearance ??= labelPaintClearance(positioned, style)
    const halo = labelHaloPadding(edge, style)
    const m = (edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style))
    const pw = m.width + 2 * LABEL_PILL_PADDING, ph = m.height + 2 * LABEL_PILL_PADDING

    const segs = orderedLabelSegments(edge)

    const saved = edge.labelPosition
    let fixed = false
    // A narrow private segment beside a shared trunk can have no centered
    // slot. Keep the shaft inside its pill while trying either side, within
    // the existing on-route allowance; the route itself remains frozen.
    const shift = Math.min(pw, ph) / 2 - 1
    for (const offset of [0, shift, -shift]) {
      if (fixed) break
      for (const point of labelSegmentSamples(segs, pw, ph, offset, false, true)) {
        edge.labelPosition = point
        if (paint.clearPaintRect(pillRect(point.x, point.y, m), halo, edge) && !sharedTrunkConflict(edge, positioned.edges, style)) { fixed = true; break }
      }
    }

    if (!fixed) { edge.labelPosition = saved; channels.push({ edge, width: m.width }) }
  }
  // Seat short captions before wide ones reserve the outer channels. Label-
  // only repairs retain their original order and geometry-preserving priority.
  channels.sort((a, b) => a.width - b.width)
  for (const { edge } of channels) {
    if (!sharedTrunkConflict(edge, positioned.edges, style)) continue
    if (!repairSharedLabelChannel(edge, positioned, graph, style, clearance!)) {
      for (let attempt = 0; attempt < positioned.edges.length; attempt++) {
        const other = sharedTrunkConflict(edge, positioned.edges, style)
        if (!other || !repairSharedLabelChannel(other, positioned, graph, style, clearance!, edge)) break
      }
    }
  }
}

/** A fully shared label-bearing run has no label-only solution. Keep both
 * owned endpoint normals and propose a private orthogonal channel; admit the
 * complete route and pill together before publishing either. */
function repairSharedLabelChannel(edge: PositionedEdge, positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle, paint: ReturnType<typeof labelPaintClearance>, owner = edge): boolean {
  if (!withinLayoutPreferenceBudget(graph) || customTextMeasurementActive() || edge.source === edge.target || positioned.groups.length || edge.curve || (style.edgeBendRadius ?? 0) > 0 || (style.lineWidth ?? 1) > 2 || edge.inlineStyle?.['stroke-width']) return false
  const points = edge.points, start = points[0]!, end = points.at(-1)!, next = points[1]!, previous = points.at(-2)!
  const axis = start.y === next.y ? 'x' : 'y', cross = axis === 'x' ? 'y' : 'x'
  if (start[cross] !== next[cross] || end[cross] !== previous[cross]) return false
  const from = Math.sign(next[axis] - start[axis]), to = Math.sign(previous[axis] - end[axis])
  if (!from || !to) return false
  const same = from === to, fixed = same ? axis : cross, main = same ? cross : axis
  const m = (edge.label ? edge : owner).labelBlock ?? graphEdgeTextBlock(resolveLabelContent((edge.label ? edge : owner).label!, (edge.label ? edge : owner).labelContent), style)
  const half = (fixed === 'x' ? m.width : m.height) / 2 + LABEL_PILL_PADDING + 8
  const preferred = (edge.labelPosition ?? owner.labelPosition)![fixed]
  const boundaries = (coordinate: 'x' | 'y', padding: number, includeRoutes: boolean): number[] => {
    const values: number[] = []
    for (const node of positioned.nodes) values.push(node[coordinate] - padding - CLEARANCE, node[coordinate] + (coordinate === 'x' ? node.width : node.height) + padding + CLEARANCE)
    for (const other of positioned.edges) {
      if (includeRoutes) for (const point of other.points) values.push(point[coordinate] - padding - CLEARANCE, point[coordinate] + padding + CLEARANCE)
      const r = other === edge && !includeRoutes ? null : labelRect(other, style)
      if (r) values.push((coordinate === 'x' ? r.x : r.y) - padding - 8 - EPS, (coordinate === 'x' ? r.x + r.w : r.y + r.h) + padding + 8 + EPS)
    }
    return values
  }
  const lanes = [preferred - half - CLEARANCE, preferred + half + CLEARANCE, ...boundaries(fixed, half, true)]
  lanes.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)
  const ctx = laneContextFor(positioned.nodes, positioned.edges, graph.direction, style, positioned.groups).ctx
  ctx.fixedLabels = true; ctx.finalLabelClearance = true
  const nodes = indexRouteNodes(positioned.nodes), source = nodes.get(edge.source), target = nodes.get(edge.target)
  if (!source || !target) return false
  const hook = terminalHookLength(style, edge)
  const stemAxis = same ? cross : axis
  const stems = [next[stemAxis], previous[stemAxis], ...boundaries(stemAxis, 0, false)]
  const markers: NonNullable<ReturnType<typeof routeMarkerPaintRegions>> = []
  for (const other of positioned.edges) {
    if (other === edge) continue
    const regions = routeMarkerPaintRegions(other, style)
    if (!regions) return false
    markers.push(...regions)
  }
  const shaftHalf = (style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1) / 2 + EPS
  const segmentClear = (p: Point, q: Point): boolean => {
    const vertical = p.x === q.x, main = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y'
    let lo = Math.min(p[main], q[main]), hi = Math.max(p[main], q[main])
    // Exact retained end-runs introduce no ink. Trim them before proving a
    // new extension, including tight original bends beside another card.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!
      if (a[cross] !== p[cross] || b[cross] !== p[cross]) continue
      const oldLo = Math.min(a[main], b[main]), oldHi = Math.max(a[main], b[main])
      if (oldLo <= lo && oldHi >= lo) lo = Math.min(hi, oldHi)
      if (oldLo <= hi && oldHi >= hi) hi = Math.max(lo, oldLo)
    }
    if (lo >= hi) return true
    const left = vertical ? p.x : lo, right = vertical ? p.x : hi, top = vertical ? lo : p.y, bottom = vertical ? hi : p.y
    // Endpoint-pose admission alone cannot protect a peer glyph from a new
    // middle shaft. Complete written supports cover hollow/stroked glyphs too.
    if (markers.some(marker => {
      const b = marker.bounds!
      return left - shaftHalf <= b.x1 && right + shaftHalf >= b.x0 && top - shaftHalf <= b.y1 && bottom + shaftHalf >= b.y0
    })) return false
    return !hasDirectLaneBlocker({ ...edge, label: undefined }, p[cross], lo, hi, ctx, { main, cross, sign: p[main] > q[main] ? 1 : -1 })
  }
  const spurs = (port: Point, old: Point, sign: number, lane: number): Point[][] => {
    let lead = hook
    for (const marker of markers) {
      const b = marker.bounds!
      if (port.x < b.x0 - shaftHalf || port.x > b.x1 + shaftHalf || port.y < b.y0 - shaftHalf || port.y > b.y1 + shaftHalf) continue
      const far = axis === 'x' ? sign > 0 ? b.x1 : b.x0 : sign > 0 ? b.y1 : b.y0
      lead = Math.max(lead, sign * (far - port[axis]) + shaftHalf + EPS)
    }
    const minimum = Math.min(lead, Math.abs(old[axis] - port[axis]))
    const normal = { ...port, [axis]: port[axis] + sign * minimum }
    const choices = [...new Set([same ? port[cross] : normal[axis], ...stems])].filter(value => same || sign * (value - port[axis]) >= minimum)
      .sort((a, b) => Math.abs(a - port[stemAxis]) - Math.abs(b - port[stemAxis]) || a - b)
    const clear: Point[][] = []
    for (const value of choices) {
      const stub = { ...(same ? normal : port), [stemAxis]: value }, corner = { ...stub, [fixed]: lane }
      const spur = simplifyPolyline(same ? [port, normal, stub, corner] : [port, stub, corner])
      if (positioned.nodes.some(node => routeEntersNodeBox(node.id === edge.source || node.id === edge.target ? spur.slice(1) : spur, node))) continue
      if (spur.slice(1).some((p, i) => !segmentClear(p, spur[i]!))) continue
      clear.push(spur)
      if (clear.length === 8) break
    }
    return clear
  }
  const beforeCrossings = countRouteCrossings(points, edge, ctx)
  const peers = positioned.edges.filter(other => other !== edge && other.style !== 'invisible')
  const crossingsBefore = peers.map(other => countPointPairCrossings(points, other.points))
  let best: { points: Point[]; label?: Point; crossings: number } | undefined
  channels: for (const lane of [...new Set(lanes)].slice(0, 128)) {
    if (same && (from * (lane - start[axis]) < hook || to * (lane - end[axis]) < hook)) continue
    const heads = spurs(start, next, from, lane), tails = spurs(end, previous, to, lane)
    for (const head of heads) for (const tail of tails) {
      const a = head.at(-1)!, b = tail.at(-1)!
      const route = simplifyPolyline([...head, ...tail.toReversed()])
      if (!simpleOrthogonal(route) || route[1]![cross] !== start[cross] || route.at(-2)![cross] !== end[cross] || Math.abs(a[main] - b[main]) <= EPS || invalidEndpointApproaches({ ...edge, points: route }, source, target)) continue
      if (positioned.nodes.some(node => routeEntersNodeBox(node.id === edge.source ? route.slice(1) : node.id === edge.target ? route.slice(0, -1) : route, node))) continue
      if (route.slice(1).some((p, i) => !segmentClear(p, route[i]!)) || !routeCandidateMarkersClear(edge, route, positioned.edges, style)) continue
      // Escaping a parallel corridor may cross a peer once on each side. Keep
      // that bounded per peer and prefer the candidate with fewest crossings.
      let crossings = 0
      if (peers.some((other, i) => {
        const count = countPointPairCrossings(route, other.points)
        crossings += count
        return count > crossingsBefore[i]! + 2
      }) || best && crossings >= best.crossings) continue
      const candidate = { ...edge, points: route }
      let label: Point | undefined
      if (edge.label) for (const segment of orderedLabelSegments(candidate)) {
        const slot = findLabelSlot(candidate, segment.a, segment.b, ctx)
        if (slot && paint.clearPaintRect(pillRect(slot.x, slot.y, m), labelHaloPadding(edge, style), edge) && !sharedTrunkConflict(candidate, positioned.edges, style, slot)) { label = slot; break }
      }
      if (edge.label && !label) continue
      if (owner !== edge && sharedTrunkConflict(owner, [owner, candidate], style)) continue
      best = { points: route, label, crossings }
      if (crossings <= beforeCrossings) break channels
    }
  }
  if (best) {
    const saved = edge.routeCertificate
    edge.points = best.points
    if (edge.label) edge.labelPosition = best.label
    recertifyReroutedEdge(edge, saved, source, target)
    return true
  }
  return false
}

/**
 * Post-freeze label repair for labels left OFF their own route. ELK can place an
 * edge label with a perpendicular offset from the line; applyRouteContracts
 * re-slots labels only on edges it RE-ROUTES, so a label on an edge that came out
 * of ELK ALREADY straight (and is not a shared-trunk conflict, so the pass above
 * skips it too) keeps ELK's offset placement — which the rubric flags as
 * labelOffRoute once the offset exceeds half the pill height. Seen on a
 * high-degree mixed-label fan-in, where a straight diamond→hub spoke's label sat
 * a pill-height above its own line. Re-slot ONLY such labels onto their own
 * axis-aligned segments (longest first, center-out — the midpoint reads best),
 * taking the first slot that sits ON the route and clear of every node and
 * foreign trunk. If none exists, leave the label as placed (a rare off-route
 * label is a lesser evil than a pill drawn over a node).
 *
 * Self-loops are EXCLUDED: their label legitimately sits beside ELK's small loop
 * stub (a pill-width from it), which is correct, not off-route. Geometry-
 * preserving (labels only) so it is freeze-safe; deterministic (fixed segment
 * order + fixed center-out sample). A no-op on the HARD-clean corpus, whose
 * labels are already on their routes.
 */
export function repairLabelsOffOwnRoute(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle): void {
  const distToSeg = (p: Point, a: Point, b: Point): number => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
  let clearance: ReturnType<typeof labelPaintClearance> | undefined
  for (const edge of positioned.edges) {
    if (!edge.label || !edge.labelPosition || edge.points.length < 2) continue
    if (edge.source === edge.target) continue // self-loop label sits beside the stub — correct, not off-route
    const m = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style)
    const pw = m.width + 2 * LABEL_PILL_PADDING,
      ph = m.height + 2 * LABEL_PILL_PADDING
    const allow = ph / 2 + 4 // exactly the rubric's labelOffRoute allowance
    const routeDist = (p: Point): number => {
      let d = Infinity
      for (let i = 1; i < edge.points.length; i++) d = Math.min(d, distToSeg(p, edge.points[i - 1]!, edge.points[i]!))
      return d
    }
    if (routeDist(edge.labelPosition) <= allow) continue // already on its own route — no-op (the corpus case)
    const paint = clearance ??= labelPaintClearance(positioned, style)
    const halo = labelHaloPadding(edge, style)
    const clearAt = (x: number, y: number): boolean => routeDist({ x, y }) <= allow &&
      !!paint.clearPaintRect(pillRect(x, y, m), halo, edge) &&
      !sharedTrunkConflict(edge, positioned.edges, style, { x, y })

    const segs = orderedLabelSegments(edge)

    // (1) Prefer a slot ON the route: sample each segment center-out (midpoint
    // reads best) and take the first clear one.
    let placed = false
    for (const point of labelSegmentSamples(segs, pw, ph)) {
      if (clearAt(point.x, point.y)) { edge.labelPosition = point; placed = true; break }
    }
    // (2) No on-route slot (the route's approach is a shared/congested trunk, so
    // every on-route position collides). Pull the label PERPENDICULARLY toward
    // the route — from wherever ELK parked it — to just inside the allowance
    // (allow - 1), which still clears the trunk by ~half the remaining gap. Keep
    // ELK's side first; fall back to the mirror side. This turns an off-route
    // label into a within-tolerance one without forcing it onto a busy trunk.
    if (!placed) {
      let foot = edge.points[0]!,
        fd = Infinity
      for (const s of segs.length ? segs : []) {
        const dx = s.b.x - s.a.x,
          dy = s.b.y - s.a.y,
          l2 = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((edge.labelPosition.x - s.a.x) * dx + (edge.labelPosition.y - s.a.y) * dy) / l2))
        const fx = s.a.x + t * dx,
          fy = s.a.y + t * dy,
          d = Math.hypot(edge.labelPosition.x - fx, edge.labelPosition.y - fy)
        if (d < fd) {
          fd = d
          foot = { x: fx, y: fy }
        }
      }
      const ux = fd > EPS ? (edge.labelPosition.x - foot.x) / fd : 0
      const uy = fd > EPS ? (edge.labelPosition.y - foot.y) / fd : -1 // default: lift above
      const off = allow - 1
      for (const side of [1, -1]) {
        const cx = foot.x + ux * off * side,
          cy = foot.y + uy * off * side
        if (clearAt(cx, cy)) {
          edge.labelPosition = { x: cx, y: cy }
          break
        }
      }
    }
  }
}

function segmentHitsLoopLabel(a: Point, b: Point, rect: LabelPaintRect): boolean {
  if (Math.abs(a.x - b.x) <= EPS) {
    return a.x > rect.x + EPS && a.x < rect.x + rect.w - EPS && Math.min(Math.max(a.y, b.y), rect.y + rect.h) - Math.max(Math.min(a.y, b.y), rect.y) > EPS
  }
  if (Math.abs(a.y - b.y) <= EPS) {
    return a.y > rect.y + EPS && a.y < rect.y + rect.h - EPS && Math.min(Math.max(a.x, b.x), rect.x + rect.w) - Math.max(Math.min(a.x, b.x), rect.x) > EPS
  }
  return false
}

/**
 * Post-freeze label repair for pill-vs-pill collisions ACROSS edges. The
 * shared-trunk repair separates labels whose ROUTES share a trunk; parallel
 * edges that were split into adjacent lanes have distinct routes, but every
 * label still sits at its own route midpoint — the midpoints are one lane gap
 * apart while a pill is ~3 gaps tall, so the pills stack (the 2026-07 overlap
 * audit: 70% of fuzzed state diagrams, plus curated corpus state/flowchart
 * cases — reciprocal `start`/`cancel` pairs, feedback `pass`/`fail` pairs).
 * Resolution slides the LATER edge's label along its OWN route (labelOffRoute
 * stays satisfied by construction) to the nearest slot whose pill clears every
 * other pill and every node; if the later edge has no clear slot, the earlier
 * edge tries; when neither clears, both stay (honest residual, surfaced by
 * eval/overlap-audit). Also repairs initial halos covering endpoint markers.
 * Fires only on measured pill or marker intersection, so clear layouts are
 * byte-identical.
 */
export function separateEdgeLabelPills(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  graph: MermaidGraph,
  style: LabelMetricsStyle = resolveRenderStyle({}),
  options?: { preserveRouteClearance?: boolean },
): void {
  let routeWork = 1_000_000
  const labeled = positioned.edges.filter(e => e.label && e.labelPosition && e.points.length >= 2)
  if (labeled.length === 0) return
  const rectOf = (e: PositionedEdge): { x: number; y: number; w: number; h: number } | null => {
    const r = labelRect(e, style)
    const halo = labelHaloPadding(e, style)
    return r && { x: r.x - halo, y: r.y - halo, w: r.w + 2 * halo, h: r.h + 2 * halo }
  }
  const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5

  const { overlapsMarker, clearPaintRect } = labelPaintClearance(positioned, style)

  const slots = function* (edge: PositionedEdge, others: PositionedEdge[], overhang = false, rescue?: { clear: (point: Point) => boolean; pay: (n: number) => boolean }, masking = true): Generator<Point> {
    if (rescue && !rescue.pay(16)) return
    const m = (edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label!, edge.labelContent), style))
    const pw = m.width + 2 * LABEL_PILL_PADDING, ph = m.height + 2 * LABEL_PILL_PADDING
    const halo = labelHaloPadding(edge, style)
    const clearAt = (x: number, y: number, maskFree: boolean): boolean => {
      if (rescue) return rescue.pay(3) && rescue.clear({ x, y })
      if (options?.preserveRouteClearance && routeWork <= 0) return false
      const pill = clearPaintRect(pillRect(x, y, m), halo, edge)
      if (!pill) return false
      for (const o of others) {
        const r = rectOf(o)
        if (r && intersects(pill, r)) return false
      }
      // Separating opaque label halos must not move a label onto a shared
      // route and undo the earlier ownership repair.
      if (sharedTrunkConflict(edge, positioned.edges, style, { x, y })) return false
      // The opaque pill may not mask another edge's line. The legacy ELK
      // ladder allows it as a last resort (parallel siblings closer than two
      // pills have no other seat), after every offset that masks nothing.
      if (options?.preserveRouteClearance || maskFree) for (const other of positioned.edges) {
        if (other === edge || other.style === 'invisible') continue
        for (let index = 1; index < other.points.length; index++) {
          if (options?.preserveRouteClearance && --routeWork < 0) return false
          if (segmentEntersLabelRect(other.points[index - 1]!, other.points[index]!, pill)) return false
        }
      }
      return true
    }
    const segs = rescue ? orderedLabelSegments(edge, rescue.pay) : orderedLabelSegments(edge)
    if (!segs) return
    // Offset ladder: on-route first, then perpendicular offsets up to the
    // rubric's labelOffRoute allowance (ph/2 + 4, the same formula
    // repairLabelsOffOwnRoute enforces) — a labeled reciprocal pair whose
    // lanes sit closer than two pill widths has NO on-route solution, but
    // ±(allow-1) of lateral headroom per label is enough to part them while
    // labelOffRoute stays satisfied by construction.
    const allow = ph / 2 + 4
    const offsets = [allow - 1, -(allow - 1), (allow - 1) / 2, -(allow - 1) / 2]
    for (const [d, maskFree] of [[0, false], ...offsets.map(d => [d, true]), ...(masking ? offsets.map(d => [d, false]) : [])] as Array<[number, boolean]>) {
      for (const point of labelSegmentSamples(segs, pw, ph, d, overhang, false, rescue?.pay)) {
        if (options?.preserveRouteClearance && routeWork <= 0) return
        if (clearAt(point.x, point.y, maskFree)) yield point
      }
    }
  }
  const trySlide = (edge: PositionedEdge, others: PositionedEdge[], masking = true): boolean => {
    for (const point of slots(edge, others, false, undefined, masking)) {
      edge.labelPosition = point
      return true
    }
    return false
  }
  const tryPair = (a: PositionedEdge, b: PositionedEdge): boolean => {
    const others = labeled.filter(edge => edge !== a && edge !== b)
    // Search only after neither label can move alone. Each label still clears
    // every node and foreign pill; joint candidates also clear each other.
    // A final fallback may span an interior bend while its center stays on
    // its own route. This admits long pills on almost-collinear short runs.
    for (const overhang of [false, true]) {
      const candidates = (edge: PositionedEdge): Point[] => {
        const result: Point[] = []
        for (const point of slots(edge, others, overhang)) {
          result.push(point)
          if (result.length === 64) break
        }
        return result
      }
      const first = candidates(a),
        second = candidates(b)
      for (const p of first)
        for (const q of second) {
          const ra = rectOf({ ...a, labelPosition: p })!,
            rb = rectOf({ ...b, labelPosition: q })!
          if (intersects(ra, rb)) continue
          a.labelPosition = p
          b.labelPosition = q
          return true
        }
    }
    return false
  }

  // Settle legacy seats first, then use the existing overhang/joint family
  // for unresolved marker or foreign-shaft occlusion under full paint proof.
  // No new solver, sweep, candidate cap, fresh work counter or route write.
  const rescuePaintSeats = (): void => {
    if (customTextMeasurementActive()) return
    const pay = (units: number): boolean => {
      if (units > routeWork) { routeWork = 0; return false }
      routeWork -= units
      return true
    }
    if (!pay(8)) return
    const foreignRouteIntersects = (subject: PositionedEdge, rect: LabelPaintRect): boolean => {
      for (const other of positioned.edges) {
        if (!pay(1)) return false
        if (other === subject || other.style === 'invisible') continue
        for (let index = 1; index < other.points.length; index++) {
          if (!pay(1)) return false
          if (segmentEntersLabelRect(other.points[index - 1]!, other.points[index]!, rect)) return true
        }
      }
      return false
    }
    let paint: ReturnType<typeof labelSeatPaintContext>
    for (const edge of labeled) {
      // The legacy marker cache is already populated; this fresh rescue-only
      // query still visits up to two endpoint resources per live edge.
      if (!pay(64 + (edge.label?.length ?? 0) * 12 + 2 * positioned.edges.length)) return
      const rect = rectOf(edge)
      if (!rect || !overlapsMarker(rect) && !foreignRouteIntersects(edge, rect)) continue
      if (!pay(edge.points.length + 2)) return
      if (edge.curve || (style.edgeBendRadius ?? 0) !== 0 || edge.points.some((p, i) => i > 0 && p.x !== edge.points[i - 1]!.x && p.y !== edge.points[i - 1]!.y)) continue
      paint ??= labelSeatPaintContext(positioned.nodes, positioned.edges, positioned.groups, style, pay)
      if (!paint || !pay(8)) return
      const blockers = new Set<PositionedEdge>(), single = new Map<PositionedEdge, Point>()
      const seat = paint
      const candidates = (subject: PositionedEdge, overhang: boolean, ignored: PositionedEdge | ReadonlySet<PositionedEdge> | undefined, blocked?: Set<PositionedEdge>): Point[] | undefined => {
        if (!pay(8)) return undefined
        const result: Point[] = [], staged = new Map<PositionedEdge, Point>()
        // The other member is excluded ONLY while proposing; final transaction
        // validation below sees BOTH staged seats against ALL live paint.
        const clear = (point: Point): boolean => {
          if (subject.source === subject.target) {
            if (!pay(subject.points.length + 8)) return false
            const rect = labelRect({ ...subject, labelPosition: point }, style)
            if (!rect || subject.points.some((p, index) => index > 0 && segmentHitsLoopLabel(subject.points[index - 1]!, p, rect))) return false
          }
          return seat.clear(subject, point, staged, blocked, ignored)
        }
        for (const point of slots(subject, [], overhang, { clear, pay })) {
          if (!pay(1)) return undefined
          result.push(point)
          if (result.length === 64) break
        }
        return routeWork > 0 ? result : undefined
      }
      let accepted = false
      const singles = candidates(edge, true, undefined, blockers)
      if (!singles) return
      for (const point of singles) {
        if (!pay(3)) return
        single.set(edge, point)
        if (paint.clear(edge, point, single)) { edge.labelPosition = point; accepted = true; break }
      }
      if (accepted) continue
      const movable = labeled.filter(peer => blockers.has(peer) && !peer.curve && !peer.points.some((p, i) => i > 0 && p.x !== peer.points[i - 1]!.x && p.y !== peer.points[i - 1]!.y))
      for (const peer of labeled) {
        if (!pay(1)) return
        if (!movable.includes(peer)) continue
        if (!pay(peer.points.length + 6)) return
        for (const overhang of [false, true]) {
          const first = candidates(edge, overhang, peer), second = candidates(peer, overhang, edge)
          if (!first || !second) return
          transaction: for (const a of first) for (const b of second) {
            if (!pay(16)) return // outer/two inner tuple arrays plus map header/entries
            const positions = new Map<PositionedEdge, Point>([[edge, a], [peer, b]])
            if (!paint.clear(edge, a, positions) || !paint.clear(peer, b, positions)) continue
            edge.labelPosition = a; peer.labelPosition = b; accepted = true; break transaction
          }
          if (accepted) break
        }
        if (accepted) break
      }
      if (accepted || movable.length < 2) continue
      // Several captions can block every seat together, so that moving any
      // one of them frees nothing. Propose this seat ignoring all of them,
      // re-seat each in turn against the staged moves, then validate the
      // whole transaction against all live paint before writing any seat.
      const group = new Set(movable)
      for (const overhang of [false, true]) {
        const first = candidates(edge, overhang, group)
        if (!first) return
        transaction: for (const a of first) {
          if (!pay(8 + 4 * movable.length)) return
          const positions = new Map<PositionedEdge, Point>([[edge, a]])
          for (const peer of movable) {
            const options = candidates(peer, overhang, edge)
            if (!options) return
            const spot = options.find(b => seat.clear(peer, b, new Map(positions).set(peer, b)))
            if (!spot) continue transaction
            positions.set(peer, spot)
          }
          if (![...positions].every(([member, point]) => seat.clear(member, point, positions))) continue
          for (const [member, point] of positions) member.labelPosition = point
          accepted = true
          break transaction
        }
        if (accepted) break
      }
    }
  }

  // Up to three sweeps: resolving one pair can expose (or clear) another; the
  // slide target is always a fully-clear slot, so sweeps strictly reduce the
  // conflict set and the cap is a defensive bound, not an expected exit.
  for (let sweep = 0; sweep < 3; sweep++) {
    if (options?.preserveRouteClearance && routeWork <= 0) return
    let conflicts = 0
    // Initial ELK labels can hide terminal symbols without touching another
    // pill. Repair those with the same route slots and painted clearances,
    // but never by masking another edge's line instead: that hides ink too.
    for (const edge of labeled) {
      const halo = rectOf(edge)
      if (!halo || !overlapsMarker(halo)) continue
      conflicts++
      trySlide(
        edge,
        labeled.filter(other => other !== edge),
        false,
      )
    }
    for (let i = 0; i < labeled.length; i++) {
      for (let j = i + 1; j < labeled.length; j++) {
        const a = labeled[i]!,
          b = labeled[j]!
        const ra = rectOf(a),
          rb = rectOf(b)
        if (!ra || !rb || !intersects(ra, rb)) continue
        conflicts++
        if (
          !trySlide(
            b,
            labeled.filter(e => e !== b),
          ) &&
          !trySlide(
            a,
            labeled.filter(e => e !== a),
          )
        )
          tryPair(a, b)
      }
    }
    if (conflicts === 0) { rescuePaintSeats(); break }
    if (sweep === 2) rescuePaintSeats()
  }
}

/** Remove a sub-pixel terminal run along an open rectangle face. The preceding
 * point is already on that face with an outward normal shaft: removing the
 * endpoint adds no line, crosses no obstacle and moves contact by less than
 * one pixel, but prevents that tiny run rotating the whole marker sideways. */
function collapseTinyEndpointSegments(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], style: LabelMetricsStyle): void {
  const nodeMap = indexRouteNodes(nodes)
  for (const edge of edges) {
    const saved = edge.routeCertificate
    let changed = false
    let candidate = edge.points
    for (const source of [true, false]) {
      const points = source ? [...candidate].reverse() : candidate
      const [a, b, c] = points.slice(-3)
      const node = nodeMap.get(source ? edge.source : edge.target)
      if (!node || node.shape !== 'rectangle' || (node.semanticShape !== undefined && node.semanticShape !== 'rect') || !a || !b || !c || Math.hypot(c.x - b.x, c.y - b.y) >= 1) continue
      const vertical = (Math.abs(b.x - node.x) < EPS || Math.abs(b.x - node.x - node.width) < EPS) && Math.abs(c.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && b.y > node.y && b.y < node.y + node.height && c.y > node.y && c.y < node.y + node.height && (a.x - b.x) * (b.x - node.x - node.width / 2) > 0
      const horizontal = (Math.abs(b.y - node.y) < EPS || Math.abs(b.y - node.y - node.height) < EPS) && Math.abs(c.y - b.y) < EPS && Math.abs(a.x - b.x) < EPS && b.x > node.x && b.x < node.x + node.width && c.x > node.x && c.x < node.x + node.width && (a.y - b.y) * (b.y - node.y - node.height / 2) > 0
      if (!vertical && !horizontal) continue
      candidate = source ? candidate.slice(1) : candidate.slice(0, -1)
      changed = true
    }
    if (changed && routeCandidateMarkersClear(edge, candidate, edges, style)) {
      edge.points = candidate
      recertifyReroutedEdge(edge, saved, nodeMap.get(edge.source), nodeMap.get(edge.target))
    }
  }
}

/** Close the route contract over settled label geometry. Each scan changes
 * only routes accepted by the final hitch proof, so the closer and auditor
 * cannot disagree about lane occupancy. A successful change removes one bent
 * edge and never introduces a bend; at most `edges.length` scans are needed.
 * Then remove proven sub-pixel rectangle-face tails and recertify contacts. */
export function closeRouteContracts(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle): RouteCertificate[] {
  for (let round = 0; round < positioned.edges.length; round++) {
    if (scanRouteHitches(positioned, graph, style, true).length === 0) break
  }
  collapseTinyEndpointSegments(positioned.nodes, positioned.edges, style)
  return positioned.edges.flatMap(edge => (edge.routeCertificate ? [edge.routeCertificate] : []))
}

export function auditRouteContracts(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] }, graph: MermaidGraph, style: LabelMetricsStyle = resolveRenderStyle({})): RouteAuditFinding[] {
  const findings: RouteAuditFinding[] = []
  const nodeMap = indexRouteNodes(positioned.nodes)
  const groupMap = flattenGroups(positioned.groups)
  const TOL = 1

  for (const edge of positioned.edges) {
    if (edge.points.length < 2) continue
    const cert = edge.routeCertificate
    const id = edgeId(edge)

    // ROUTE_UNEXPLAINED_BEND: orthogonal routing produced a diagonal segment —
    // a bend that neither the prover nor a blocker list can account for.
    if (cert && (cert.routeClass === 'primary-forward' || cert.routeClass === 'feedback')) {
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!,
          b = edge.points[i]!
        if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
          findings.push({ code: 'ROUTE_UNEXPLAINED_BEND', edge: id })
          break
        }
      }
    }

    // ROUTE_CONTAINER_MISANCHOR: a container edge must terminate on the
    // container's border, not on a phantom node or a child (spec §11.5).
    if (cert?.routeClass === 'container' && cert.edgeIndex >= 0) {
      const graphEdge = graph.edges[cert.edgeIndex]
      if (graphEdge) {
        for (const [endId, point] of [
          [graphEdge.source, edge.points[0]!],
          [graphEdge.target, edge.points[edge.points.length - 1]!],
        ] as const) {
          const group = groupMap.get(endId)
          if (group && !onRectPerimeter(point, group.x, group.y, group.width, group.height, TOL)) {
            findings.push({ code: 'ROUTE_CONTAINER_MISANCHOR', edge: id, container: endId })
          }
        }
      }
    }

    // ROUTE_SHAPE_MISANCHOR / ROUTE_STALE_AFTER_NODE_MOVE: endpoints must sit
    // on the rendered boundary of the shapes we have anchor contracts for
    // (spec §11.6), and may never detach from their node entirely.
    if (cert && cert.routeClass !== 'container') {
      for (const [nodeId, point] of [
        [edge.source, edge.points[0]!],
        [edge.target, edge.points[edge.points.length - 1]!],
      ] as const) {
        const node = nodeMap.get(nodeId)
        if (!node) continue
        const inflated = point.x >= node.x - 2 && point.x <= node.x + node.width + 2 && point.y >= node.y - 2 && point.y <= node.y + node.height + 2
        if (!inflated) {
          findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: nodeId })
          continue
        }
        const contact = renderedEndpointContact(node, point, TOL)
        if (contact.policy !== 'none' && !contact.onBoundary) {
          findings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: id, node: nodeId })
        }
      }
    }

    // ROUTE_STALE_AFTER_NODE_MOVE also catches the other stale-corridor
    // signature: a non-incident node moved onto an already-certified route.
    // Endpoint detachment above catches moved endpoints; this catches moved
    // obstacles in the middle of a route.
    for (const node of positioned.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      if (routeEntersNodeBox(edge.points, node)) findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: node.id })
    }

    // ROUTE_LABEL_ON_SHARED_TRUNK: a label pill sitting on a piece of line
    // that another edge's collinear segment shares (spec §11.4) — the reader
    // cannot tell which edge the label belongs to.
    if (edge.label && edge.labelPosition) {
      const other = sharedTrunkConflict(edge, positioned.edges, style)
      if (other) findings.push({ code: 'ROUTE_LABEL_ON_SHARED_TRUNK', edge: id, sharedWith: edgeId(other) })
    }
  }

  const loops = positioned.edges.filter(edge => edge.source === edge.target)

  for (let i = 0; i < loops.length; i++) {
    const edge = loops[i]!
    const cert = edge.routeCertificate
    const id = edgeId(edge)
    const node = nodeMap.get(edge.source)
    if (!cert || cert.invariant !== 'self-loop' || !cert.loopSide) {
      findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'allocation' })
      continue
    }
    if (node && RECT_LIKE.has(node.shape)) {
      const first = edge.points[0]!
      const last = edge.points[edge.points.length - 1]!
      const onSide = (point: Point): boolean => (cert.loopSide === 'N' ? Math.abs(point.y - node.y) <= TOL : cert.loopSide === 'S' ? Math.abs(point.y - (node.y + node.height)) <= TOL : cert.loopSide === 'W' ? Math.abs(point.x - node.x) <= TOL : Math.abs(point.x - (node.x + node.width)) <= TOL)
      if (!onSide(first) || !onSide(last) || Math.hypot(first.x - last.x, first.y - last.y) < 8) {
        findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'side' })
      }
      for (let segment = 1; segment < edge.points.length; segment++) {
        const a = edge.points[segment - 1]!,
          b = edge.points[segment]!
        const alongHorizontal = Math.abs(a.y - b.y) <= EPS && (Math.abs(a.y - node.y) <= TOL || Math.abs(a.y - (node.y + node.height)) <= TOL) && Math.min(Math.max(a.x, b.x), node.x + node.width) - Math.max(Math.min(a.x, b.x), node.x) > EPS
        const alongVertical = Math.abs(a.x - b.x) <= EPS && (Math.abs(a.x - node.x) <= TOL || Math.abs(a.x - (node.x + node.width)) <= TOL) && Math.min(Math.max(a.y, b.y), node.y + node.height) - Math.max(Math.min(a.y, b.y), node.y) > EPS
        if (alongHorizontal || alongVertical) {
          findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'boundary' })
          break
        }
      }
    }
    for (let j = i + 1; j < loops.length; j++) {
      const other = loops[j]!
      if (routesCrossOrOverlap(edge.points, other.points)) findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, conflictWith: edgeId(other), kind: 'route-route' })
      const edgeLabel = labelRect(edge, style)
      const otherLabel = labelRect(other, style)
      if (edgeLabel && otherLabel && edgeLabel.x < otherLabel.x + otherLabel.w && edgeLabel.x + edgeLabel.w > otherLabel.x && edgeLabel.y < otherLabel.y + otherLabel.h && edgeLabel.y + edgeLabel.h > otherLabel.y) {
        findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, conflictWith: edgeId(other), kind: 'label-label' })
      }
    }
    const ownLabel = labelRect(edge, style)
    if (ownLabel) {
      const labelHitsRoute = loops.some(route => route.points.some((point, index) => index > 0 && segmentHitsLoopLabel(route.points[index - 1]!, point, ownLabel)))
      if (labelHitsRoute) findings.push({ code: 'ROUTE_SELF_LOOP_OCCUPANCY', edge: id, kind: 'label-route' })
    }
  }
  return findings
}
