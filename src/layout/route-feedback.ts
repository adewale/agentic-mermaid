import type { Point, PortSide, PositionedEdge, PositionedNode, RouteClass, RouteInvariant } from '../types.ts'
import { shapeRoutingProfile } from '../shape-outline.ts'
import { labelRect } from '../shared/edge-label-geometry.ts'
import { EPS, CLEARANCE, shapePorts, invalidEndpointApproaches, isStraightenable, type Axis, axisPoint, simplifyPolyline, attachSpan, anchorMain, type LaneContext, setRoutePoints, facingSide } from './route-geometry.ts'
import { directLaneBlockers, findLabelSlot, countRouteCrossings, routeAddsCrossings, routeEntersNodeBox, sharedTrunkConflict } from './route-lanes.ts'
import { routeCandidateMarkersClear } from './route-marker-clearance.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { STROKE_WIDTHS } from '../styles.ts'

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
