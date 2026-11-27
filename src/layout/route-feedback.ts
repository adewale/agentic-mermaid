import type { Point, PortSide, PositionedEdge, PositionedGroup, PositionedNode, RouteClass, RouteInvariant } from '../types.ts'
import { shapeRoutingProfile } from '../shape-outline.ts'
import { labelRect } from '../shared/edge-label-geometry.ts'
import { EPS, CLEARANCE, shapePorts, invalidEndpointApproaches, isStraightenable, type Axis, axisPoint, simplifyPolyline, attachSpan, anchorMain, type LaneContext, setRoutePoints, facingSide } from './route-geometry.ts'
import { directLaneBlockers, findLabelSlot, countRouteCrossings, hasDirectLaneBlocker, routeAddsCrossings, routeEntersNodeBox, routePairContact, sharedTrunkConflict } from './route-lanes.ts'
import { routeCandidateMarkersClear } from './route-marker-clearance.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { STROKE_WIDTHS } from '../styles.ts'
import { ARRIVAL_SLOT_PITCH, MIN_ARRIVAL_SLOT_PITCH } from './terminal-assignment.ts'
import { measureRouteContacts } from '../shared/edge-crossings.ts'
import { countPointPairCrossings } from '../shared/edge-crossing-pair.ts'
import { clearanceBoxes, routeClearanceFindings } from '../layout-rubric.ts'

/**
 * ELK's feedbackEdges routing can wrap a loop around the source's forward
 * side before reaching its outer channel — an excursion that parks the
 * loop's drop column in the corridor a forward sibling must cross. When
 * the source's facet can reach the channel directly (a single proven
 * perpendicular hop, or an on-boundary anchor when the source spans the
 * channel), cut the excursion: the loop exits toward its channel
 * immediately. Only existing channel geometry is reused, so every kept
 * segment was already proven by ELK; the one NEW segment is lane-proved.
 */
export function tightenOuterFeedback(edge: PositionedEdge, ctx: LaneContext, nodeMap: ReadonlyMap<string, PositionedNode>): boolean {
    const points = simplifyPolyline(edge.points)
    if (points.length < 4) return false
    const graphAxis = ctx.axis
    const crossOf = (pt: Point) => pt[graphAxis.cross]
    const mainOf = (pt: Point) => pt[graphAxis.main]
    // A laterally displaced target can be farther from the source than the
    // return channel. Its short terminal stub is not the feedback run: choose
    // the longest existing segment against the declared flow, retaining the
    // first on a tie. Head/tail shortcuts still prove their new hops below.
    let runStart = -1
    let reverseLength = EPS
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(crossOf(points[i - 1]!) - crossOf(points[i]!)) >= EPS) continue
      const length = (mainOf(points[i - 1]!) - mainOf(points[i]!)) * graphAxis.sign
      if (length > reverseLength) { reverseLength = length; runStart = i - 1 }
    }
    if (runStart < 1) return false // no excursion before the channel run
    const extreme = crossOf(points[runStart]!)
    const run = [points[runStart]!, points[runStart + 1]!]
    const runDir = Math.sign(mainOf(run[1]!) - mainOf(run[0]!))
    const p0 = points[0]!
    const source = ctx.nodes.find(n => n.id === edge.source)
    const inRunRange = (m: number) => runDir > 0
      ? m >= mainOf(run[0]!) - EPS && m < mainOf(run[1]!) - EPS
      : m <= mainOf(run[0]!) + EPS && m > mainOf(run[1]!) + EPS

    const hopClear = (mainCoord: number, fromCross: number): boolean => {
      if (Math.abs(fromCross - extreme) < EPS) return true
      const hopAxis: Axis = graphAxis.main === 'x'
        ? { main: 'y', cross: 'x', sign: fromCross < extreme ? 1 : -1 }
        : { main: 'x', cross: 'y', sign: fromCross < extreme ? 1 : -1 }
      // The label rides the channel run, not the hop — strip it so the
      // own-label capacity check doesn't demand the pill fit on a short hop.
      const probe: PositionedEdge = { ...edge, points: [], label: undefined }
      return directLaneBlockers(probe, mainCoord,
        Math.min(fromCross, extreme), Math.max(fromCross, extreme), ctx, hopAxis).length === 0
    }
    const buildRoute = (mainCoord: number, fromCross: number, startOnBoundary: Point): Point[] => {
      const hopPoint: Point = axisPoint(graphAxis, mainCoord, extreme)
      return Math.abs(fromCross - extreme) < EPS
        ? [hopPoint, ...points.slice(runStart + 1)]
        : [startOnBoundary, hopPoint, ...points.slice(runStart + 1)]
    }

    let tightened: Point[] | null = null
    // Variant 1 — exit via the source's channel-facing PORT: the decision
    // diamond's exact South/North vertex (a rectangle's side midpoint). One
    // short hop from the port to the channel is proven; the run truncation
    // reuses existing, already-proven channel geometry.
    if (source && isStraightenable(source)) {
      const srcCrossLo = source[graphAxis.cross]
      // The exact channel-facing port from shapePorts: the bbox side midpoint
      // for the symmetric shapes, the slant midpoint / flag point for the
      // slanted family — never a bare bbox coordinate off the outline.
      const side: PortSide = graphAxis.cross === 'y'
        ? (extreme > srcCrossLo ? 'S' : 'N')
        : (extreme > srcCrossLo ? 'E' : 'W')
      const port = shapePorts(source)[side]
      const portCross = port[graphAxis.cross]
      const portMain = port[graphAxis.main]
      if (inRunRange(portMain) && hopClear(portMain, portCross)) {
        tightened = buildRoute(portMain, portCross, port)
      }
    }
    // Variant 1b — the shape spans the channel itself: exit straight off the
    // channel-facing facet AT the channel height (no hop at all).
    if (!tightened && source) {
      const facingRun: 1 | -1 = runDir === graphAxis.sign ? 1 : -1
      const span = attachSpan(source, graphAxis, facingRun)
      const attachment = shapeRoutingProfile(source).sides[facingSide(graphAxis, facingRun)]
      if (attachment.kind === 'dynamic' && span && extreme >= span.lo - EPS && extreme <= span.hi + EPS) {
        const anchorM = anchorMain(source, extreme, graphAxis, facingRun)
        if (anchorM !== null && inRunRange(anchorM) && hopClear(anchorM, extreme)) {
          const boundary: Point = axisPoint(graphAxis, anchorM, extreme)
          tightened = buildRoute(anchorM, extreme, boundary)
        }
      }
    }
    // Variant 2 — hop perpendicular from ELK's exit point to the channel.
    if (!tightened && inRunRange(mainOf(p0)) && hopClear(mainOf(p0), crossOf(p0))) {
      tightened = buildRoute(mainOf(p0), crossOf(p0), p0)
    }
    // A label or self-loop may block the immediate exit while a long escape
    // stub hides a forward sibling's label. Shorten that stub at a proved
    // clear hop, retaining both endpoints and the existing outer channel.
    // Siblings retry together: an inner return can vacate the outer return's
    // hop without adding a crossing or another bend.
    if (!tightened && runStart === 2 && Math.abs(crossOf(points[1]!) - crossOf(p0)) < EPS &&
      ctx.edges.some(other => other.source === edge.source && other !== edge && sharedTrunkConflict(other, ctx.edges, ctx.style))) {
      const outward = Math.sign(mainOf(points[1]!) - mainOf(p0))
      const candidates = [mainOf(p0) + outward * 12]
      for (const other of ctx.edges) {
        if (other === edge) continue
        for (const point of other.points) candidates.push(mainOf(point) + outward * 12)
        const pill = labelRect(other, ctx.style)
        if (pill) candidates.push((graphAxis.main === 'x' ? pill.x + (outward > 0 ? pill.w : 0) : pill.y + (outward > 0 ? pill.h : 0)) + outward * (CLEARANCE + EPS))
      }
      candidates.sort((a, b) => (a - b) * outward)
      for (const coordinate of candidates) {
        if ((coordinate - mainOf(p0)) * outward < 12 - EPS ||
          (mainOf(points[1]!) - coordinate) * outward <= EPS || !inRunRange(coordinate)) continue
        if (!hopClear(coordinate, crossOf(p0))) continue
        const stub = graphAxis.main === 'x' ? { x: coordinate, y: crossOf(p0) } : { x: crossOf(p0), y: coordinate }
        const hop = graphAxis.main === 'x' ? { x: coordinate, y: extreme } : { x: extreme, y: coordinate }
        const candidate = [p0, stub, hop, ...points.slice(runStart + 1)]
        if (countRouteCrossings(candidate, edge, ctx) > countRouteCrossings(points, edge, ctx)) continue
        tightened = candidate
        break
      }
    }
    // Tail tightening — symmetric: enter the target via its channel-facing
    // PORT (the South/North side midpoint), truncating the run at the
    // target's center and hopping up from the channel.
    const base = tightened ?? points
    let tailApplied = false
    {
      let rs = -1
      for (let i = 1; i < base.length; i++) {
        if (Math.abs(crossOf(base[i - 1]!) - extreme) < EPS && Math.abs(crossOf(base[i]!) - extreme) < EPS) {
          rs = i - 1
          break
        }
      }
      const target = ctx.nodes.find(n => n.id === edge.target)
      if (rs >= 0 && rs + 1 < base.length - 1 && target && isStraightenable(target)) {
        const tCrossLo = target[graphAxis.cross]
        // Exact channel-facing port via shapePorts (see the head variant).
        const side: PortSide = graphAxis.cross === 'y'
          ? (extreme > tCrossLo ? 'S' : 'N')
          : (extreme > tCrossLo ? 'E' : 'W')
        const port = shapePorts(target)[side]
        const portCross = port[graphAxis.cross]
        const portMain = port[graphAxis.main]
        const runA = base[rs]!, runB = base[rs + 1]!
        const dir = Math.sign(mainOf(runB) - mainOf(runA))
        const within = dir > 0
          ? portMain > mainOf(runA) + EPS && portMain <= mainOf(runB) + EPS
          : portMain < mainOf(runA) - EPS && portMain >= mainOf(runB) - EPS
        if (within && hopClear(portMain, portCross)) {
          const runEndAtPort: Point = axisPoint(graphAxis, portMain, extreme)
          tightened = [...base.slice(0, rs + 1), runEndAtPort, port]
          tailApplied = true
        }
      }
    }
    if (!tightened) return false
    // A shorter hop from an existing port coordinate can turn its valid
    // normal stub into a tangent (for example vertically off a capsule's E
    // point). Keep the proven exterior excursion unless both new shafts are
    // usable contacts; a coordinate alone is not a port proof.
    const normalized = simplifyPolyline(tightened)
    const target = nodeMap.get(edge.target)
    if (invalidEndpointApproaches({ ...edge, points: normalized }, source, target) > 0) return false
    // Lane queries exempt both endpoint nodes to admit real contacts. That
    // exemption cannot cover a new hop through the opposite endpoint, nor a
    // nonterminal run along its painted border. Check the complete proposal,
    // omitting only each node's own contact leg. The same guard covers head,
    // stub and tail variants; unknown stroke support keeps the original route.
    const edgeWidth = edge.inlineStyle?.['stroke-width'] ?? String((ctx.style.lineWidth ?? STROKE_WIDTHS.connector) * (edge.style === 'thick' ? 2 : 1))
    const shaftExtent = paintedStrokeExtent({ stroke: 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', edgeWidth) }, true)
    if (!source || !target || shaftExtent === undefined) return false
    const clearanceBox = (node: PositionedNode): PositionedNode | undefined => {
      const width = node.inlineStyle?.['stroke-width'] ?? String(ctx.style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)
      const outlineExtent = paintedStrokeExtent({ stroke: 'black', strokeWidth: formatSvgNumericAttribute('stroke-width', width) }, true)
      if (outlineExtent === undefined) return undefined
      const padding = Math.max(CLEARANCE, outlineExtent + shaftExtent) + EPS
      const x = node.x - padding, y = node.y - padding
      const w = node.width + 2 * padding, h = node.height + 2 * padding
      if (![x, y, w, h].every(Number.isFinite)) return undefined
      // This is a conservative paint envelope, not a new cylinder/facet.
      return { ...node, shape: 'rectangle', semanticShape: undefined, x, y, width: w, height: h }
    }
    const sourceBox = clearanceBox(source), targetBox = clearanceBox(target)
    if (!sourceBox || !targetBox || routeEntersNodeBox(normalized.slice(1), sourceBox)
      || routeEntersNodeBox(normalized.slice(0, -1), targetBox)) return false
    // Same rule as straightening: tightening may never increase crossings.
    if (routeAddsCrossings(normalized, edge, ctx)) return false
    if (!routeCandidateMarkersClear(edge, normalized, ctx.edges, ctx.style)) return false
    const before = edge.points
    setRoutePoints(ctx, edge, normalized)
    // Re-place the label if its pill sat on a removed segment.
    if (edge.label && edge.labelPosition) {
      const lp = edge.labelPosition
      const onRoute = edge.points.some((pt, i) => {
        if (i === 0) return false
        const a = edge.points[i - 1]!, b = pt
        const xLo = Math.min(a.x, b.x) - 1, xHi = Math.max(a.x, b.x) + 1
        const yLo = Math.min(a.y, b.y) - 1, yHi = Math.max(a.y, b.y) + 1
        return lp.x >= xLo && lp.x <= xHi && lp.y >= yLo && lp.y <= yHi
      })
      if (!onRoute) {
        // The channel run survives tightening: find it on the new route.
        let slot: Point | null = null
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!, b = edge.points[i]!
          if (Math.abs(crossOf(a) - extreme) < EPS && Math.abs(crossOf(b) - extreme) < EPS) {
            slot = findLabelSlot(edge, a, b, ctx)
            break
          }
        }
        if (slot) {
          edge.labelPosition = slot
        } else {
          setRoutePoints(ctx, edge, before) // no honest label slot on the tightened loop: keep ELK's
          return false
        }
      }
    }
    return JSON.stringify(edge.points) !== JSON.stringify(before)
  }

/**
 * A feedback route that escapes the cross-axis band of its endpoint nodes
 * is the certified ELK feedbackEdges loop — "feedback uses the feedback
 * side and an outer channel" (issue #25 §11.3). Returns null for
 * non-feedback edges so callers keep their own detour vocabulary.
 */
export function feedbackDetourKind(edge: PositionedEdge, routeClass: RouteClass, source: PositionedNode | undefined, target: PositionedNode | undefined, graphAxis: Axis): RouteInvariant | null {
  if (routeClass !== 'feedback') return null
  if (!source || !target) return 'feedback-detour'
  const crossSize = (n: PositionedNode) => (graphAxis.cross === 'y' ? n.height : n.width)
  const bandLo = Math.min(source[graphAxis.cross], target[graphAxis.cross]) - 2
  const bandHi = Math.max(source[graphAxis.cross] + crossSize(source), target[graphAxis.cross] + crossSize(target)) + 2
  const escapes = edge.points.some(pt => pt[graphAxis.cross] < bandLo || pt[graphAxis.cross] > bandHi)
  return escapes ? 'outer-feedback' : 'feedback-detour'
}

/** A rounded card's corner radius: its side is straight inside it. */
const ROUNDED_CORNER = 6
/** Least distance from a node or frame to a side lane: a terminal hook. */
const SIDE_LANE_GAP = 12
/** A side lane replaces a feedback route only when it is at most this
 * fraction of the produced length, so near-equal routes keep ELK's. */
const SIDE_LANE_SAVING = 0.75

/**
 * A feedback route that circles the far side of the drawing, or leaves
 * against the flow and doubles back through it, while both endpoints face a
 * free side the same way: leave the source and enter the target through
 * those sides, joined by a lane just clear of every node and frame the run
 * passes (wide enough for the caption). Either side may serve; the shorter
 * clear one wins. Taken only when it is markedly shorter than the produced
 * route and every new segment is lane-proved, and when it adds no crossing,
 * no contact or shared run with another route, no end beside another end,
 * and keeps marker and caption room. A lane never leaves or enters a frame:
 * groups holding one endpoint only keep the produced route.
 */
export function shortenFeedbackRoute(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, ctx: LaneContext): boolean {
  if (edge.points.length < 2 || edge.source === edge.target || !isStraightenable(source) || !isStraightenable(target)) return false
  const { main, cross } = ctx.axis
  const size = (box: { width: number; height: number }, along: 'x' | 'y') => along === 'x' ? box.width : box.height
  const length = (points: readonly Point[]) => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i]!.x) + Math.abs(point.y - points[i]!.y), 0)
  const current = length(edge.points)
  const block = edge.label ? labelRect(edge, ctx.style) : undefined
  const gap = Math.max(SIDE_LANE_GAP, block ? size({ width: block.w, height: block.h }, cross) / 2 + CLEARANCE + 4 : 0)
  const groups = flatGroups(ctx.groups ?? [])
  const contains = (group: PositionedGroup, node: PositionedNode) =>
    node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height
  if (groups.some(group => contains(group, source) !== contains(group, target))) return false
  const holders = groups.filter(group => contains(group, source))
  const others = ctx.edges.filter(other => other !== edge && other.style !== 'invisible' && other.points.length >= 2)
  const related = (other: PositionedEdge) => [other.source, other.target].some(id => id === edge.source || id === edge.target)
  const sharedRun = (points: readonly Point[], other: PositionedEdge) =>
    measureRouteContacts([{ points, ends: ['\0a', '\0b'] }, { points: other.points, ends: ['\0c', '\0d'] }]).overlaps
  const at = (mainValue: number, crossValue: number): Point => main === 'x' ? { x: mainValue, y: crossValue } : { x: crossValue, y: mainValue }
  // Face points: the side's port, then slots a pitch apart along the
  // straight side of a rectangle or rounded card, for when another end holds
  // the port. A short side takes its widest slot.
  const facePoints = (node: PositionedNode, port: PortSide): Point[] => {
    const centre = shapePorts(node)[port]
    const corner = node.shape === 'rounded' ? ROUNDED_CORNER : 0
    if (node.shape !== 'rectangle' && node.shape !== 'rounded' || node.semanticShape !== undefined && node.semanticShape !== 'rect') return [centre]
    const reach = size(node, main) / 2 - MIN_ARRIVAL_SLOT_PITCH - corner, slot = Math.min(ARRIVAL_SLOT_PITCH, reach)
    if (slot < MIN_ARRIVAL_SLOT_PITCH) return [centre]
    return [0, -1, 1, -2, 2].filter(k => Math.abs(k) * slot <= reach + EPS).map(k => ({ ...centre, [main]: centre[main] + k * slot }))
  }
  type Candidate = { points: Point[]; lane: number; lo: number; hi: number; offset: number }
  const candidates: Candidate[] = []
  for (const side of [-1, 1] as const) {
    const port: PortSide = cross === 'x' ? (side < 0 ? 'W' : 'E') : (side < 0 ? 'N' : 'S')
    const sourcePoints = facePoints(source, port), targetPoints = facePoints(target, port)
    const centreFrom = sourcePoints[0]!, centreTo = targetPoints[0]!
    const lo = Math.min(centreFrom[main], centreTo[main]) - gap - 2 * ARRIVAL_SLOT_PITCH, hi = Math.max(centreFrom[main], centreTo[main]) + gap + 2 * ARRIVAL_SLOT_PITCH
    const obstacles = [...ctx.nodes, ...groups.filter(group => !contains(group, source))]
      .filter(box => box[main] < hi && box[main] + size(box, main) > lo)
    let lane = side < 0 ? Math.min(centreFrom[cross], centreTo[cross]) - gap : Math.max(centreFrom[cross], centreTo[cross]) + gap
    for (let moved = true; moved;) {
      moved = false
      for (const box of obstacles) {
        const start = box[cross], end = start + size(box, cross)
        if (lane > start - gap && lane < end + gap) { lane = side < 0 ? start - gap : end + gap; moved = true }
      }
    }
    // Inside every frame that holds both ends, a terminal hook from its border.
    if (holders.some(group => lane < group[cross] + SIDE_LANE_GAP || lane > group[cross] + size(group, cross) - SIDE_LANE_GAP)) continue
    for (const from of sourcePoints) for (const to of targetPoints) {
      const points = [{ ...from }, at(from[main], lane), at(to[main], lane), { ...to }]
      if (length(points) > current * SIDE_LANE_SAVING) continue
      candidates.push({ points, lane, lo: Math.min(from[main], to[main]), hi: Math.max(from[main], to[main]), offset: Math.abs(from[main] - centreFrom[main]) + Math.abs(to[main] - centreTo[main]) })
    }
  }
  // Shortest first; among equals, the ports before offset slots.
  candidates.sort((a, b) => length(a.points) - length(b.points) || a.offset - b.offset)
  const probe: PositionedEdge = { ...edge, points: [], label: undefined }
  let boxes: ReturnType<typeof clearanceBoxes> | undefined
  // An end on a side's port may not leave it for a slot beside the port.
  const onPort = (node: PositionedNode, point: Point) => (Object.values(shapePorts(node)) as Point[]).some(port => Math.abs(port.x - point.x) <= 0.5 && Math.abs(port.y - point.y) <= 0.5)
  const ported = (points: readonly Point[]) => Number(onPort(source, points[0]!)) + Number(onPort(target, points.at(-1)!))
  const portedNow = ported(edge.points)
  for (const { points: candidate, lane, lo, hi } of candidates) {
    const from = candidate[0]!, to = candidate[3]!
    if (ported(candidate) < portedNow) continue
    if (ctx.nodes.some(node => node.id !== edge.source && node.id !== edge.target && routeEntersNodeBox(candidate, node))) continue
    if (routeEntersNodeBox(candidate.slice(1), source) || routeEntersNodeBox(candidate.slice(0, -1), target)) continue
    // Each end's face looks straight at the lane: the other end is not in
    // the strip between them, and every run keeps a hook's distance from it.
    const strip = (node: PositionedNode, other: PositionedNode): boolean => {
      const lo = Math.min(node[cross] + (lane > node[cross] ? size(node, cross) : 0), lane), hi = Math.max(node[cross] + (lane > node[cross] ? size(node, cross) : 0), lane)
      return other[main] < node[main] + size(node, main) && other[main] + size(other, main) > node[main] && other[cross] < hi && other[cross] + size(other, cross) > lo
    }
    if (strip(source, target) || strip(target, source)) continue
    if (boxGap(candidate.slice(0, 3), target) < SIDE_LANE_GAP || boxGap(candidate.slice(1), source) < SIDE_LANE_GAP) continue
    // Nor may it run along a card or frame it did not run along before.
    boxes ??= clearanceBoxes({ nodes: ctx.nodes, groups: [...ctx.groups ?? []] })
    if (routeClearanceFindings([{ ...edge, points: candidate }], boxes).length > routeClearanceFindings([edge], boxes).length) continue
    if (invalidEndpointApproaches({ ...edge, points: candidate }, source, target) > 0) continue
    const hop = (point: Point): boolean => {
      const sign = lane > point[cross] ? 1 : -1
      const hopAxis: Axis = main === 'x' ? { main: 'y', cross: 'x', sign } : { main: 'x', cross: 'y', sign }
      return hasDirectLaneBlocker(probe, point[main], Math.min(point[cross], lane), Math.max(point[cross], lane), ctx, hopAxis, false)
    }
    const runAxis: Axis = { ...ctx.axis, sign: to[main] > from[main] ? 1 : -1 }
    if (hop(from) || hop(to) || hasDirectLaneBlocker(edge, lane, lo, hi, ctx, runAxis)) continue
    if (routeAddsCrossings(candidate, edge, ctx) || !routeCandidateMarkersClear(edge, candidate, ctx.edges, ctx.style)) continue
    const beside = others.some(other => [other.points[0]!, other.points.at(-1)!].some(end =>
      [from, to].some(own => Math.hypot(own.x - end.x, own.y - end.y) < MIN_ARRIVAL_SLOT_PITCH)))
    // A self-loop's span on a face is the loop's own: nothing leaves through it.
    if (others.some(other => other.source === other.target && related(other) && countPointPairCrossings(candidate, other.points) > 0)) continue
    if (beside || others.some(other => related(other)
      ? sharedRun(candidate, other) > sharedRun(edge.points, other)
      : routePairContact(candidate, edge, other) > routePairContact(edge.points, edge, other))) continue
    const before = edge.points
    setRoutePoints(ctx, edge, candidate)
    if (edge.label) {
      const slot = findLabelSlot(edge, candidate[1]!, candidate[2]!, ctx)
      if (!slot) { setRoutePoints(ctx, edge, before); continue }
      edge.labelPosition = slot
    }
    return true
  }
  return false
}

/** Least distance from an orthogonal polyline to a node's box. */
function boxGap(points: readonly Point[], node: PositionedNode): number {
  let gap = Infinity
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const dx = Math.max(0, node.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - node.x - node.width)
    const dy = Math.max(0, node.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - node.y - node.height)
    gap = Math.min(gap, Math.hypot(dx, dy))
  }
  return gap
}

function flatGroups(groups: readonly PositionedGroup[]): PositionedGroup[] {
  return groups.flatMap(group => [group, ...flatGroups(group.children)])
}
