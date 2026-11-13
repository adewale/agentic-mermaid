import { resolveLabelContent } from '../../shared/display-text.ts'
import type { Direction, Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { ARROW_HEAD, FLOWCHART_DOTTED_DASH } from '../../styles.ts'
import { graphEdgeTextBlock } from '../../graph-text.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { calculatePathMidpoint, layoutFlow, polylineLength, rectsOverlap } from '../geometry.ts'

export function labelBoxAt(edge: PositionedEdge, center: Point, style: LabelMetricsStyle): { x: number; y: number; width: number; height: number } {
  const metrics = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label!, edge.labelContent), style)
  return {
    x: center.x - (metrics.width + 16) / 2,
    y: center.y - (metrics.height + 16) / 2,
    width: metrics.width + 16,
    height: metrics.height + 16,
  }
}

export function longestSegmentMidpoint(points: Point[]): Point {
  let best: [Point, Point] = [points[0]!, points[points.length - 1]!]
  let bestLength = -1
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > bestLength) { bestLength = length; best = [a, b] }
  }
  return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 }
}

export interface BundledLabelCandidate {
  point: Point
  box: { x: number; y: number; width: number; height: number }
  rank: number
  pathDistance: number
  routeMidpointDistance: number
  segmentMidpointDistance: number
  straightRunPenalty: number
  terminalSegmentPenalty: number
}

export function readableLabelGap(style: LabelMetricsStyle): number {
  return Math.max(8, style.edgeLabelFontSize * 0.75)
}

export function labelPortStubGap(style: LabelMetricsStyle): number {
  return Math.max(12, style.edgeLabelFontSize)
}

export function terminalMarkerGap(style: LabelMetricsStyle, edge: PositionedEdge): number {
  const lineWidth = (style as LabelMetricsStyle & { lineWidth?: number }).lineWidth ?? 1
  const strokeWidth = edge.style === 'thick' ? lineWidth * 2 : lineWidth
  return Math.max(18, style.edgeLabelFontSize + ARROW_HEAD.width + strokeWidth * 2)
}

export function maxTerminalMarkerGap(style: LabelMetricsStyle): number {
  const lineWidth = (style as LabelMetricsStyle & { lineWidth?: number }).lineWidth ?? 1
  const maxStrokeWidth = lineWidth * 2
  return Math.max(18, style.edgeLabelFontSize + ARROW_HEAD.width + maxStrokeWidth * 2)
}

export function maxEdgeStyleWitnessGap(): number {
  return FLOWCHART_DOTTED_DASH.dash * 3 + FLOWCHART_DOTTED_DASH.gap * 2
}

export function terminalReadableGap(style: LabelMetricsStyle): number {
  return maxTerminalMarkerGap(style) + maxEdgeStyleWitnessGap()
}

export function labelHalfExtentAlongSegment(
  box: { width: number; height: number },
  a: Point,
  b: Point,
): number {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? box.width / 2 : box.height / 2
}

export function clearsTerminalMarkers(
  edge: PositionedEdge,
  points: Point[],
  segmentIndex: number,
  point: Point,
  box: { width: number; height: number },
  style: LabelMetricsStyle,
): boolean {
  const clearance = terminalMarkerGap(style, edge)
  if (edge.hasArrowStart && segmentIndex === 1) {
    const start = points[0]!
    const halfExtent = labelHalfExtentAlongSegment(box, start, points[1]!)
    if (Math.hypot(point.x - start.x, point.y - start.y) < halfExtent + clearance) return false
  }
  if (edge.hasArrowEnd && segmentIndex === points.length - 1) {
    const end = points[points.length - 1]!
    const halfExtent = labelHalfExtentAlongSegment(box, points[points.length - 2]!, end)
    if (Math.hypot(point.x - end.x, point.y - end.y) < halfExtent + clearance) return false
  }
  return true
}

export function labelEndpointGaps(edge: PositionedEdge, points: Point[], segmentIndex: number, style: LabelMetricsStyle): { start: number; end: number } {
  return {
    start: edge.hasArrowStart && segmentIndex === 1 ? maxTerminalMarkerGap(style) : labelPortStubGap(style),
    end: edge.hasArrowEnd && segmentIndex === points.length - 1 ? terminalReadableGap(style) : labelPortStubGap(style),
  }
}

export function segmentAlignedWithFlow(a: Point, b: Point, direction: Direction): boolean {
  return layoutFlow(direction).isHorizontal
    ? Math.abs(a.y - b.y) < 0.01
    : Math.abs(a.x - b.x) < 0.01
}

export function labelFitsInsideSegment(
  box: { width: number; height: number },
  point: Point,
  a: Point,
  b: Point,
  gaps: { start: number; end: number },
): boolean {
  const halfExtent = labelHalfExtentAlongSegment(box, a, b)
  return Math.hypot(point.x - a.x, point.y - a.y) >= halfExtent + gaps.start &&
    Math.hypot(point.x - b.x, point.y - b.y) >= halfExtent + gaps.end
}

export function feasibleLabelSlots(box: { width: number; height: number }, a: Point, b: Point, gaps: { start: number; end: number }): number[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length === 0) return []
  const halfExtent = labelHalfExtentAlongSegment(box, a, b)
  const start = (halfExtent + gaps.start) / length
  const end = 1 - (halfExtent + gaps.end) / length
  if (start > end) return []
  return [(start + end) / 2]
}

export function terminalLabelRunLength(
  edge: PositionedEdge,
  direction: Direction,
  style: LabelMetricsStyle,
  sourceBoundary: number,
  targetBoundary: number,
): number {
  if (!edge.label) return 0
  const f = layoutFlow(direction)
  const box = labelBoxAt(edge, { x: 0, y: 0 }, style)
  const labelExtent = f.isHorizontal ? box.width : box.height
  const visibleGap = Math.max(
    labelPortStubGap(style),
    edge.hasArrowEnd ? terminalReadableGap(style) : labelPortStubGap(style),
  )
  // When there is room, balance the outside-source corridor into three equal
  // visible runs: source boundary to bend, bend to label, and label to target.
  const corridor = (targetBoundary - sourceBoundary) * f.sign
  const balancedGap = (corridor - labelExtent) / 3
  if (balancedGap >= visibleGap - 0.001) return labelExtent + balancedGap * 2
  return labelExtent + labelPortStubGap(style) + visibleGap + 2
}

export function terminalLabelCorridorLength(edge: PositionedEdge, direction: Direction, style: LabelMetricsStyle): number {
  if (!edge.label) return 0
  const box = labelBoxAt(edge, { x: 0, y: 0 }, style)
  const labelExtent = layoutFlow(direction).isHorizontal ? box.width : box.height
  const visibleGap = Math.max(
    labelPortStubGap(style),
    edge.hasArrowEnd ? terminalReadableGap(style) : labelPortStubGap(style),
  )
  return labelExtent + visibleGap * 3
}

export function bundledLabelCandidates(edge: PositionedEdge, points: Point[], nodes: PositionedNode[], direction: Direction, style: LabelMetricsStyle, admit?: (edge: PositionedEdge, point: Point) => boolean): BundledLabelCandidate[] {
  if (!edge.label) return []
  const totalLength = polylineLength(points)
  if (totalLength === 0) return []
  const midpointDistance = totalLength / 2
  const raw: Array<BundledLabelCandidate & { order: number }> = []
  const slots = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 1 / 6, 5 / 6]

  let segmentStartDistance = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    const flowAligned = segmentAlignedWithFlow(a, b, direction)
    const terminalSegment = (edge.hasArrowStart && i === 1) || (edge.hasArrowEnd && i === points.length - 1)
    const baseBox = labelBoxAt(edge, { x: 0, y: 0 }, style)
    const gaps = labelEndpointGaps(edge, points, i, style)
    const segmentSlots = [...slots, ...feasibleLabelSlots(baseBox, a, b, gaps)]
      .filter((slot, index, all) => slot >= 0 && slot <= 1 && all.findIndex(other => Math.abs(other - slot) < 0.001) === index)
    // Nearby lanes may be closer than two opaque pills. A bounded lateral
    // seat keeps the shaft inside its caption while separating sibling halos.
    const vertical = Math.abs(a.x - b.x) < 0.01
    const lateral = Math.min(baseBox.height / 2 + 3, (vertical ? baseBox.width : baseBox.height) / 2 - 1)
    const offsets = admit ? [0, lateral / 4, -lateral / 4, lateral / 2, -lateral / 2, lateral, -lateral] : [0]
    for (let order = 0; order < segmentSlots.length; order++) {
      const t = segmentSlots[order]!
      for (const offset of offsets) {
        const point = { x: a.x + (b.x - a.x) * t + (vertical ? offset : 0), y: a.y + (b.y - a.y) * t + (vertical ? 0 : offset) }
        const box = labelBoxAt(edge, point, style)
        if (nodes.some(node => rectsOverlap(box, node, 2))) continue
        if (!clearsTerminalMarkers(edge, points, i, point, box, style)) continue
        const fitsInsideSegment = labelFitsInsideSegment(box, point, a, b, gaps)
        const contained = vertical ? box.y >= Math.min(a.y, b.y) && box.y + box.height <= Math.max(a.y, b.y)
          : box.x >= Math.min(a.x, b.x) && box.x + box.width <= Math.max(a.x, b.x)
        if (admit && (!fitsInsideSegment || !contained || !admit(edge, point))) continue
        raw.push({
          point,
          box,
          order,
          rank: 0,
          pathDistance: segmentStartDistance + length * t,
          routeMidpointDistance: Math.abs(segmentStartDistance + length * t - midpointDistance),
          segmentMidpointDistance: Math.abs(length * (t - 0.5)),
          straightRunPenalty: flowAligned && fitsInsideSegment ? 0 : flowAligned ? 2 : 10,
          terminalSegmentPenalty: terminalSegment ? 1 : 0,
        })
      }
    }
    segmentStartDistance += length
  }

  raw.sort((a, b) =>
    a.straightRunPenalty - b.straightRunPenalty ||
    a.terminalSegmentPenalty - b.terminalSegmentPenalty ||
    a.segmentMidpointDistance - b.segmentMidpointDistance ||
    a.routeMidpointDistance - b.routeMidpointDistance ||
    a.order - b.order ||
    a.pathDistance - b.pathDistance)
  return raw.map((candidate, rank) => ({ ...candidate, rank }))
}

export function bestBundledLabelPosition(edge: PositionedEdge, points: Point[], nodes: PositionedNode[], direction: Direction, style: LabelMetricsStyle): Point {
  return bundledLabelCandidates(edge, points, nodes, direction, style)[0]?.point ?? calculatePathMidpoint(points)
}

export function bundledLabelAssignmentCost(chosen: BundledLabelCandidate[], direction: Direction): number {
  const f = layoutFlow(direction)
  const mainValues = chosen.map(candidate => candidate.point[f.main])
  const mainSpread = Math.max(...mainValues) - Math.min(...mainValues)
  const totalStraightRunPenalty = chosen.reduce((sum, candidate) => sum + candidate.straightRunPenalty, 0)
  const totalTerminalSegmentPenalty = chosen.reduce((sum, candidate) => sum + candidate.terminalSegmentPenalty, 0)
  const totalSegmentMidpointDistance = chosen.reduce((sum, candidate) => sum + candidate.segmentMidpointDistance, 0)
  const totalRouteMidpointDistance = chosen.reduce((sum, candidate) => sum + candidate.routeMidpointDistance, 0)
  const totalRank = chosen.reduce((sum, candidate) => sum + candidate.rank, 0)
  // Prefer labels on a flow-axis straight run so the route enters and exits through
  // opposite label ports. Among readable straight-run slots, preserve sibling
  // symmetry before endpoint aesthetics; a terminal segment is acceptable once
  // marker clearance has already admitted the candidate.
  return totalStraightRunPenalty * 10000 +
    mainSpread * 100 +
    totalTerminalSegmentPenalty * 1000 +
    totalSegmentMidpointDistance * 4 +
    totalRank * 0.25 +
    totalRouteMidpointDistance * 0.1
}

/** Arc-length position (0..1) of the closest point on `points` to `pt`. The
 *  centring-quality measure: 0.5 is the route's arc-length midpoint. Mirrors the
 *  rubric's projFrac (layout-rubric.ts) so the producer and the oracle agree. */
function labelArcFraction(pt: Point, points: Point[]): number {
  let total = 0
  const seglen: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
    seglen.push(d); total += d
  }
  let best = Infinity, bestArc = 0, acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
    let t = l2 ? ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(pt.x - px, pt.y - py)
    if (d < best) { best = d; bestArc = acc + t * seglen[i - 1]! }
    acc += seglen[i - 1]!
  }
  return total ? bestArc / total : 0.5
}

/**
 * The point on a (rectilinear) dogleg at the route's MAIN-AXIS midpoint — dagre's
 * centred edge-label placement. Walks segments for the one straddling the
 * main-axis midpoint, preferring a flow-aligned segment so the label sits on a
 * straight run / across the converging elbow rather than along the cross jog.
 *
 * The midpoint of a symmetric converging dogleg sits AT (or beside) the elbow — an
 * INTERIOR bend, not a node-adjacent endpoint — so no port-stub reservation
 * applies there; the caller's node-overlap and terminal-marker guards are the only
 * clearances that matter, and they are checked in recenterBundledLabelOnMainAxis.
 * Null if no flow-aligned segment spans the midpoint (degenerate route).
 * Pure/deterministic.
 */
function mainAxisMidpointOnRoute(points: Point[], direction: Direction): Point | null {
  const f = layoutFlow(direction)
  const mains = points.map(p => p[f.main])
  const mid = (Math.min(...mains) + Math.max(...mains)) / 2
  let fallback: Point | null = null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const lo = Math.min(a[f.main], b[f.main]), hi = Math.max(a[f.main], b[f.main])
    if (mid < lo - 1e-6 || mid > hi + 1e-6) continue
    const span = b[f.main] - a[f.main]
    if (Math.abs(span) <= 1e-6) continue // cross-aligned segment: not a straight run
    const t = (mid - a[f.main]) / span
    const point = { [f.main]: mid, [f.cross]: a[f.cross] + t * (b[f.cross] - a[f.cross]) } as unknown as Point
    // Prefer a flow-aligned segment (source/target cross coords equal).
    if (Math.abs(a[f.cross] - b[f.cross]) < 0.01) return point
    fallback ??= point
  }
  return fallback
}

/**
 * Re-centre a bundled symmetric-dogleg label onto the route's main-axis midpoint
 * (dagre's centred placement) when that strictly improves centring and stays
 * clean. The candidate placer ranks by per-SEGMENT midpoint, so on a converging
 * dogleg it parks the label at the middle of the longest flow-aligned segment —
 * which is near an endpoint of the whole ROUTE (the symmetric-fan-in/fan-out
 * hugging). This re-homes it to the route's main-axis centre.
 *
 * Label-only, post-route, HARD-safe: the re-centred point lies ON the route by
 * construction (it is a point on a segment), so labelOffRoute stays 0; and we
 * only move the label if the box there clears every node (same 2px margin the
 * candidate generator uses), clears the terminal arrow markers (same check the
 * candidate generator uses), clears the sibling labels, AND is more central than
 * the old spot. If any guard fails the original placement stands — we never push
 * a label off-route, into a collision, or onto an arrow head, and never disturb
 * an already-centred label.
 */
function recenterBundledLabelOnMainAxis(
  edge: PositionedEdge,
  points: Point[],
  nodes: PositionedNode[],
  direction: Direction,
  style: LabelMetricsStyle,
  siblingBoxes: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = [],
  siblingGap = 0,
): void {
  if (!edge.label || !edge.labelPosition) return
  const target = mainAxisMidpointOnRoute(points, direction)
  if (!target) return
  // Only re-centre if it is actually more central than the current placement.
  const currentOffset = Math.abs(labelArcFraction(edge.labelPosition, points) - 0.5)
  const targetOffset = Math.abs(labelArcFraction(target, points) - 0.5)
  if (targetOffset >= currentOffset - 1e-6) return
  const box = labelBoxAt(edge, target, style)
  if (nodes.some(node => rectsOverlap(box, node, 2))) return
  if (siblingBoxes.some(other => rectsOverlap(box, other, siblingGap))) return
  // Terminal-marker clearance on the segment the re-centred point lands on (the
  // same guard the candidate generator applies), so re-centring never parks the
  // label over a start/end arrow head.
  const f = layoutFlow(direction)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const lo = Math.min(a[f.main], b[f.main]), hi = Math.max(a[f.main], b[f.main])
    if (Math.abs(b[f.main] - a[f.main]) <= 1e-6) continue
    if (target[f.main] < lo - 1e-6 || target[f.main] > hi + 1e-6) continue
    if (!clearsTerminalMarkers(edge, points, i, target, box, style)) return
    break
  }
  edge.labelPosition = target
}

export function assignBundledFanoutLabels(
  proposed: Array<{ edge: PositionedEdge; points: Point[] }>,
  nodes: PositionedNode[],
  direction: Direction,
  style: LabelMetricsStyle,
  // Re-centre each placed label onto its route's main-axis midpoint afterward.
  // Opt-IN, used only by the co-rank fan-in (markCorankFanInBundles): its
  // converging dogleg parks the label at a segment midpoint that hugs the route
  // end. The fan-out emitter does NOT opt in — its terminal-segment labels are
  // deliberately corridor-balanced (terminalLabelRunLength / issue #38), a
  // placement re-centring would disturb; leaving that path untouched keeps the
  // change scoped to the new regression.
  recenter = false,
  admit?: (edge: PositionedEdge, point: Point) => boolean,
): boolean {
  const labeled = proposed.filter(({ edge }) => edge.label)
  if (labeled.length === 0) return true
  if (labeled.length === 1) {
    const only = labeled[0]!
    const candidates = bundledLabelCandidates(only.edge, only.points, nodes, direction, style, admit)
    if (admit && candidates.length === 0) return false
    only.edge.labelPosition = candidates[0]?.point ?? calculatePathMidpoint(only.points)
  } else {
    const candidateSets = labeled.map(({ edge, points }) => bundledLabelCandidates(edge, points, nodes, direction, style, admit))
    if (candidateSets.some(candidates => candidates.length === 0)) {
      if (admit) return false
      for (const { edge, points } of labeled) edge.labelPosition = bestBundledLabelPosition(edge, points, nodes, direction, style)
    } else {
      const gap = readableLabelGap(style)
      let best: BundledLabelCandidate[] | undefined
      let bestCost = Number.POSITIVE_INFINITY
      const chosen: BundledLabelCandidate[] = []
      const search = (index: number) => {
        if (index === candidateSets.length) {
          const cost = bundledLabelAssignmentCost(chosen, direction)
          if (cost < bestCost) {
            bestCost = cost
            best = chosen.slice()
          }
          return
        }
        for (const candidate of candidateSets[index]!) {
          if (chosen.some(other => rectsOverlap(candidate.box, other.box, gap))) continue
          chosen.push(candidate)
          search(index + 1)
          chosen.pop()
        }
      }
      search(0)

      if (!best) {
        if (admit) return false
        for (const { edge, points } of labeled) edge.labelPosition = bestBundledLabelPosition(edge, points, nodes, direction, style)
      } else {
        for (let i = 0; i < labeled.length; i++) labeled[i]!.edge.labelPosition = best[i]!.point
      }
    }
  }

  // Opt-in re-centre: snap each placed label to its route's main-axis midpoint
  // (dagre's centred placement) when that is strictly more central and stays
  // clean. The per-segment candidate ranking above parks a label at the middle of
  // the longest flow-aligned segment, which on the co-rank fan-in's converging
  // dogleg hugs the route end. Label-only, post-route, HARD-safe; a re-centre that
  // would collide with a node OR a sibling label already re-centred here is
  // declined, so sibling separation is preserved.
  if (!recenter) return true
  const siblingBoxes: Array<{ x: number; y: number; width: number; height: number }> = []
  const gap = readableLabelGap(style)
  for (const { edge } of labeled) {
    if (edge.labelPosition) siblingBoxes.push(labelBoxAt(edge, edge.labelPosition, style))
  }
  for (let i = 0; i < labeled.length; i++) {
    const { edge, points } = labeled[i]!
    const before = edge.labelPosition
    const others = siblingBoxes.filter((_, j) => j !== i)
    recenterBundledLabelOnMainAxis(edge, points, nodes, direction, style, others, gap)
    // Keep the sibling-box list current so a later edge sees this one's new spot.
    if (edge.labelPosition && edge.labelPosition !== before) siblingBoxes[i] = labelBoxAt(edge, edge.labelPosition, style)
  }
  return true
}
