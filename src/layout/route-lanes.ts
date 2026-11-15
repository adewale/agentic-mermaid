import { routeChannelMayBlock } from '../shared/route-channel-geometry.ts'
import { nodeLaneIndexForQuery, nodeLaneCell } from '../shared/node-lane-index.ts'
import { customTextMeasurementActive } from '../text-measurement-profile.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import type { DiamondFacet, Direction, Point, PortSide, PositionedEdge, PositionedGroup, PositionedNode, RouteBlocker } from '../types.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { shapeRoutingProfile } from '../shape-outline.ts'
import { countPointPairCrossings } from '../shared/edge-crossing-pair.ts'
import { countOpposingRouteOverlaps } from '../shared/edge-overlaps.ts'
import { edgesMayShareTerminal, routeCandidateMarkerBlocker, routeCandidateMarkersClear } from './route-marker-clearance.ts'
import { LABEL_PILL_PADDING, labelEndpointClearance, labelRect, pillRect } from '../shared/edge-label-geometry.ts'
import {
  EPS,
  CLEARANCE,
  LABEL_CLEARANCE,
  PORT_TOLERANCE,
  PAIR_SEPARATION,
  shapePorts,
  diamondFacetPorts,
  portAt,
  isStraightenable,
  hasFacetAttachments,
  type LabelMetricsStyle,
  type Axis,
  axisFor,
  axisPoint,
  simplifyPolyline,
  isMonotoneStaircase,
  type CrossSpan,
  attachSpan,
  anchorMain,
  type LaneContext,
  setRoutePoints,
  indexRouteNodes,
  facingSide,
} from './route-geometry.ts'

/** Port-ranking sharpness: a diamond's vertex is the strongest anchor. */
export function portSharpness(node: PositionedNode): number {
  return hasFacetAttachments(node) ? 2 : 1
}

export function portPoint(node: PositionedNode, side: PortSide | DiamondFacet): Point {
  if (hasFacetAttachments(node) && (side === 'NE' || side === 'SE' || side === 'SW' || side === 'NW')) {
    return diamondFacetPorts(node)[side]
  }
  return shapePorts(node)[side as PortSide]
}

export function repairRectLikeEndpointOverflow(edge: PositionedEdge, node: PositionedNode, isStart: boolean, ctx: LaneContext): void {
  const boundary = shapeRoutingProfile(node).boundary
  if (boundary.kind !== 'rect' || edge.points.length < 2) return
  const idx = isStart ? 0 : edge.points.length - 1
  const p = edge.points[idx]!
  const x0 = boundary.x
  const x1 = boundary.x + boundary.width
  const y0 = boundary.y
  const y1 = boundary.y + boundary.height
  const near = (a: number, b: number) => Math.abs(a - b) <= PORT_TOLERANCE
  const pushStub = (outline: Point, stub: Point) => {
    const points = [...edge.points]
    points[idx] = outline
    if (Math.abs(outline.x - stub.x) > EPS || Math.abs(outline.y - stub.y) > EPS) {
      if (isStart) {
        const next = points[1]
        if (!next || Math.abs(next.x - stub.x) > EPS || Math.abs(next.y - stub.y) > EPS) points.splice(1, 0, stub)
      } else {
        const prev = points[points.length - 2]
        if (!prev || Math.abs(prev.x - stub.x) > EPS || Math.abs(prev.y - stub.y) > EPS) points.splice(points.length - 1, 0, stub)
      }
    }
    if (routeCandidateMarkersClear(edge, points, ctx.edges, ctx.style)) setRoutePoints(ctx, edge, points)
  }

  if (near(p.x, x0) || near(p.x, x1)) {
    const x = near(p.x, x0) ? x0 : x1
    if (p.y < y0 - PORT_TOLERANCE) pushStub({ x, y: y0 }, { x, y: p.y })
    else if (p.y > y1 + PORT_TOLERANCE) pushStub({ x, y: y1 }, { x, y: p.y })
    return
  }
  if (near(p.y, y0) || near(p.y, y1)) {
    const y = near(p.y, y0) ? y0 : y1
    if (p.x < x0 - PORT_TOLERANCE) pushStub({ x: x0, y }, { x: p.x, y })
    else if (p.x > x1 + PORT_TOLERANCE) pushStub({ x: x1, y }, { x: p.x, y })
  }
}

export function diamondSpreadPortSet(axis: Axis, count: number): Array<PortSide | DiamondFacet> | null {
  if (count !== 2 && count !== 3) return null
  const side = facingSide(axis, 1)
  const first = side === 'E' ? 'NE' : side === 'S' ? 'SW' : 'NW'
  const last = side === 'W' ? 'SW' : side === 'N' ? 'NE' : 'SE'
  return count === 2 ? [first, last] : [first, side, last]
}

export interface DiamondSpreadAssignment {
  sourcePort: PortSide | DiamondFacet
  sourceLane: number
  targetsShareRank: boolean
}

export function diamondSpreadAssignment(
  edge: PositionedEdge,
  source: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): DiamondSpreadAssignment | null {
  if (!hasFacetAttachments(source) || edge.edgeIndex === undefined || ctx.classes?.[edge.edgeIndex] !== 'primary-forward') {
    return null
  }
  const nodeMap = indexRouteNodes(ctx.nodes)
  const siblings = ctx.edges
    .filter(candidate => candidate.source === edge.source &&
      candidate.edgeIndex !== undefined &&
      ctx.classes?.[candidate.edgeIndex] === 'primary-forward' &&
      nodeMap.has(candidate.target))
    .sort((a, b) => {
      const aTarget = nodeMap.get(a.target)!
      const bTarget = nodeMap.get(b.target)!
      const aCross = aTarget[axis.cross] + (axis.cross === 'y' ? aTarget.height : aTarget.width) / 2
      const bCross = bTarget[axis.cross] + (axis.cross === 'y' ? bTarget.height : bTarget.width) / 2
      return aCross - bCross || (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0)
    })
  const ports = diamondSpreadPortSet(axis, siblings.length)
  if (!ports) return null
  const index = siblings.indexOf(edge)
  if (index < 0) return null
  const sourcePort = ports[index]!
  const targetMains = siblings.map(candidate => {
    const target = nodeMap.get(candidate.target)!
    return target[axis.main] + (axis.main === 'x' ? target.width : target.height) / 2
  })
  return { sourcePort, sourceLane: portPoint(source, sourcePort)[axis.cross], targetsShareRank: Math.max(...targetMains) - Math.min(...targetMains) <= 1 }
}

export function diamondSpreadLane(edge: PositionedEdge, source: PositionedNode, ctx: LaneContext, axis: Axis): number | undefined {
  return diamondSpreadAssignment(edge, source, ctx, axis)?.sourceLane
}



export interface DiamondSpreadTargetPortConstraint {
  sourcePort: PortSide | DiamondFacet
  sourceLane: number
  targetPort: PortSide
  targetLane: number
}

export function diamondSpreadTargetPortConstraint(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): DiamondSpreadTargetPortConstraint | null {
  const spread = diamondSpreadAssignment(edge, source, ctx, axis)
  if (!spread || !spread.targetsShareRank) return null
  const targetPort = facingSide(axis, -1)
  const targetLane = shapePorts(target)[targetPort][axis.cross]
  if (Math.abs(spread.sourceLane - targetLane) <= PORT_TOLERANCE) return null
  return { sourcePort: spread.sourcePort, sourceLane: spread.sourceLane, targetPort, targetLane }
}

export function satisfiesDiamondSpreadTargetPortConstraint(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, constraint: DiamondSpreadTargetPortConstraint): boolean {
  if (edge.points.length <= 2) return false
  const start = edge.points[0]!
  const end = edge.points[edge.points.length - 1]!
  const sourcePort = portPoint(source, constraint.sourcePort)
  const targetPort = shapePorts(target)[constraint.targetPort]
  return Math.abs(start.x - sourcePort.x) <= PORT_TOLERANCE && Math.abs(start.y - sourcePort.y) <= PORT_TOLERANCE && Math.abs(end.x - targetPort.x) <= PORT_TOLERANCE && Math.abs(end.y - targetPort.y) <= PORT_TOLERANCE
}

/**
 * Primary edges own the straight lane (spec §5): when proving a primary
 * lane, the reciprocal feedback partner's label is movable decoration —
 * the partner re-places it when it straightens, or keeps it on its detour —
 * so it must not veto the primary's lane.
 */
export function isMovableReciprocalLabel(edge: PositionedEdge, other: PositionedEdge, ctx: LaneContext): boolean {
  // Final closure cannot depend on a later label repair.
  if (ctx.fixedLabels || ctx.finalLabelClearance) return false
  if (!ctx.classes || edge.edgeIndex === undefined || other.edgeIndex === undefined) return false
  return ctx.classes[edge.edgeIndex] === 'primary-forward' && ctx.classes[other.edgeIndex] === 'feedback' && other.source === edge.target && other.target === edge.source
}

export function edgeId(e: { source: string; target: string }): string {
  return `${e.source}->${e.target}`
}

/**
 * Prove a straight lane at cross-coordinate `c`, spanning [mainLo, mainHi] on
 * the flow axis, clear for `edge`. Returns the blockers ([] = proof succeeded).
 */
export function directLaneBlockers(
  edge: PositionedEdge,
  c: number,
  mainLo: number,
  mainHi: number,
  ctx: LaneContext,
  axis: Axis = ctx.axis,
): RouteBlocker[] {
  return collectLaneBlockers(edge, c, mainLo, mainHi, ctx, axis, false)
}

/** Repair candidates only need an existence proof. Stop at the first blocker;
 * certificate-producing callers still collect the complete ordered evidence. */
export function hasDirectLaneBlocker(
  edge: PositionedEdge, c: number, mainLo: number, mainHi: number, ctx: LaneContext, axis: Axis,
): boolean {
  return collectLaneBlockers(edge, c, mainLo, mainHi, ctx, axis, true)
}

function collectLaneBlockers(edge: PositionedEdge, c: number, mainLo: number, mainHi: number, ctx: LaneContext, axis: Axis, firstOnly: true): boolean
function collectLaneBlockers(edge: PositionedEdge, c: number, mainLo: number, mainHi: number, ctx: LaneContext, axis: Axis, firstOnly: false): RouteBlocker[]
function collectLaneBlockers(
  edge: PositionedEdge, c: number, mainLo: number, mainHi: number, ctx: LaneContext, axis: Axis, firstOnly: boolean,
): RouteBlocker[] | boolean {
  const blockers: RouteBlocker[] | undefined = firstOnly ? undefined : []

  const indexes = ctx.nodeLaneIndexes
  const index = nodeLaneIndexForQuery(indexes, ctx.nodes, axis.cross, CLEARANCE)
  const cell = index ? nodeLaneCell(index, c) : null
  const indexed = index && cell !== null
  const from = indexed ? index.offsets[cell] ?? 0 : 0
  const to = indexed ? index.offsets[cell + 1] ?? 0 : ctx.nodes.length
  for (let candidate = from; candidate < to; candidate++) {
    const node = ctx.nodes[indexed ? index.ordinals[candidate]! : candidate]!
    if (node.id === edge.source || node.id === edge.target) continue
    const nCrossLo = (axis.cross === 'x' ? node.x : node.y) - CLEARANCE
    const nCrossHi = (axis.cross === 'x' ? node.x : node.y) + (axis.cross === 'y' ? node.height : node.width) + CLEARANCE
    if (c > nCrossLo && c < nCrossHi) {
      const nMainLo = (axis.main === 'x' ? node.x : node.y) - CLEARANCE
      const nMainHi = (axis.main === 'x' ? node.x : node.y) + (axis.main === 'x' ? node.width : node.height) + CLEARANCE
      if (Math.min(mainHi, nMainHi) - Math.max(mainLo, nMainLo) > EPS) {
        if (firstOnly) return true
        blockers!.push({ kind: 'node', id: node.id })
      }
    }
  }

  if (ctx.groups?.length && edge.style !== 'invisible') {
    const headerBlocks = (group: PositionedGroup): boolean => {
      // No text measurement or cached group geometry in a lane proof. If the
      // retained band is absent, the whole frame remains a conservative block.
      const height = group.concurrencyRegion ? 0 : group.headerHeight ?? group.height
      const invalid = !Number.isFinite(height) || height < 0
      const crossLo = axis.cross === 'x' ? group.x : group.y
      const crossHi = crossLo + (axis.cross === 'x' ? group.width : height)
      const headerLo = axis.main === 'x' ? group.x : group.y
      const headerHi = headerLo + (axis.main === 'x' ? group.width : height)
      if (invalid || height > 0 && group.width > 0 && c > crossLo && c < crossHi
        && Math.min(mainHi, headerHi) > Math.max(mainLo, headerLo)) {
        if (firstOnly) return true
        blockers!.push({ kind: 'group-header', id: group.id })
      }
      for (const child of group.children) if (headerBlocks(child)) return true
      return false
    }
    for (const group of ctx.groups) if (headerBlocks(group)) return true
  }

  const channels = ctx.routeChannelGeometry
  for (let edgeIndex = 0; edgeIndex < ctx.edges.length; edgeIndex++) {
    const other = ctx.edges[edgeIndex]!
    // Compare by edgeIndex as well as identity: validation proves lanes on a
    // copy of the edge, and the original must not block its own lane.
    if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
    const block = !isMovableReciprocalLabel(edge, other, ctx) && other.label && other.labelPosition
      ? other.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(other.label, other.labelContent), ctx.style) : undefined
    if (block) {
      const width = block.width + 2 * LABEL_PILL_PADDING, height = block.height + 2 * LABEL_PILL_PADDING
      const x = other.labelPosition!.x - width / 2, y = other.labelPosition!.y - height / 2
      const rMainLo = (axis.main === 'x' ? x : y) - CLEARANCE
      const rMainHi = rMainLo + (axis.main === 'x' ? width : height) + 2 * CLEARANCE
      const rCrossLo = (axis.cross === 'y' ? y : x) - CLEARANCE
      const rCrossHi = rCrossLo + (axis.cross === 'y' ? height : width) + 2 * CLEARANCE
      if (c > rCrossLo && c < rCrossHi && Math.min(mainHi, rMainHi) - Math.max(mainLo, rMainLo) > EPS) {
        if (firstOnly) return true
        blockers!.push({ kind: 'label', id: edgeId(other) })
      }
    }
    // Collinear overlap with another edge's flow-axis segment would merge the
    // two lines visually ("channel" conflict). Perpendicular crossings are
    // fine. Exception: two edges into the SAME target may converge exactly
    // collinearly at the shared target port — the classic flowchart fan-in
    // merge, where the final approaches draw as one line into one arrowhead —
    // when that shared ink can stand for both relationships.
    if (channels && !routeChannelMayBlock(channels, other, axis.cross, c, mainLo, mainHi, CLEARANCE, EPS)) continue
    for (let i = 1; i < other.points.length; i++) {
      const a = other.points[i - 1]!, b = other.points[i]!
      if (Math.abs((axis.cross === 'x' ? a.x : a.y) - (axis.cross === 'x' ? b.x : b.y)) > EPS) continue
      if (Math.abs((axis.cross === 'x' ? a.x : a.y) - c) >= CLEARANCE) continue
      const sLo = Math.min((axis.main === 'x' ? a.x : a.y), (axis.main === 'x' ? b.x : b.y))
      const sHi = Math.max((axis.main === 'x' ? a.x : a.y), (axis.main === 'x' ? b.x : b.y))
      if (Math.min(mainHi, sHi) - Math.max(mainLo, sLo) > EPS) {
        if (other.target === edge.target && other.source !== edge.source && edgesMayShareTerminal(edge, other) &&
          Math.abs((axis.cross === 'x' ? a.x : a.y) - c) < EPS && i === other.points.length - 1) {
          continue
        }
        if (firstOnly) return true
        blockers!.push({ kind: 'channel', id: edgeId(other) })
        break
      }
    }
  }

  if (edge.label) {
    const m = (edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), ctx.style))
    const span = (axis.main === 'x' ? m.width : m.height) + 2 * LABEL_PILL_PADDING
    if (mainHi - mainLo < span + LABEL_CLEARANCE) {
      if (firstOnly) return true
      blockers!.push({ kind: 'label', id: edgeId(edge) })
    }
  }

  return firstOnly ? false : dedupeBlockers(blockers!)
}

/**
 * Find a position ON the straight lane where this edge's label can sit
 * without overlapping nodes, other edges' labels, or other edges' segments
 * (spec §11.4: labels are obstacles for each other). Tries the midpoint,
 * then 1/3 and 2/3, so parallel labeled pairs with room stagger their
 * labels. On-lane only: a label must sit on its own route so the
 * label-to-edge association stays unambiguous (Kakoulis–Tollis); an edge
 * whose lane cannot host its label does not straighten — with ELK's
 * feedbackEdges routing it loops through an outer channel instead, where
 * the inline label dummy has reserved space. Returns null when no slot is
 * clear.
 */
export function findLabelSlot(edge: PositionedEdge, start: Point, end: Point, ctx: LaneContext): Point | null {
  if (!edge.label) return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const m = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), ctx.style)
  const PAD = 2
  const rectsOverlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number, gap = PAD) => ax < bx + bw + gap && ax + aw + gap > bx && ay < by + bh + gap && ay + ah + gap > by

  const lineWidth = ctx.style.lineWidth ?? 1
  const sourceClearance = labelEndpointClearance(edge, lineWidth, 'start'), targetClearance = labelEndpointClearance(edge, lineWidth, 'end')
  // The final closure runs after the last label pass, so its candidate must
  // already satisfy the renderer's 8px label halo against every node. Own
  // endpoints keep the halo, their marker and a visible run of line.
  const nodeClearance = (node: PositionedNode): number => Math.max(ctx.finalLabelClearance ? 8 : PAD,
    node.id === edge.source ? sourceClearance : 0, node.id === edge.target ? targetClearance : 0)
  // Production may ignore a reciprocal feedback label because a later label
  // pass can move it. Final closure has no such future pass: both rendered
  // 8px halos must clear now (16px between the inner pills).
  const labelGap = ctx.finalLabelClearance ? 16 : PAD, routeGap = ctx.finalLabelClearance ? 8 : PAD
  const others = ctx.edges.filter(other => other !== edge && !(edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex))
  const otherLabel = (other: PositionedEdge) => !ctx.finalLabelClearance && isMovableReciprocalLabel(edge, other, ctx) ? null : labelRect(other, ctx.style)
  const vertical = Math.abs(start.x - end.x) < EPS, axisAligned = vertical !== (Math.abs(start.y - end.y) < EPS)
  const main = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y', crossEnd = vertical ? 'x1' : 'y1', mainEnd = vertical ? 'y1' : 'x1'
  const half = (vertical ? m.height : m.width) / 2 + LABEL_PILL_PADDING, crossHalf = (vertical ? m.width : m.height) / 2 + LABEL_PILL_PADDING
  // Every seat is tested against the same obstacles: nodes, other pills and
  // other routes' segments, each with its own clearance. Collect them once.
  // Seats on an axis-aligned lane share the pill's cross band and stay within
  // half a pill of the lane, so an obstacle clear of that box blocks none.
  const bandLo = Math.min(start[cross], end[cross]) - crossHalf - 1e-6, bandHi = Math.max(start[cross], end[cross]) + crossHalf + 1e-6
  const reachLo = Math.min(start[main], end[main]) - half - 1e-6, reachHi = Math.max(start[main], end[main]) + half + 1e-6
  type Obstacle = { x: number; y: number; w: number; h: number; x1: number; y1: number; gap: number }
  let obstacleList: Obstacle[] | undefined
  const obstacles = (): Obstacle[] => {
    if (obstacleList) return obstacleList
    const list: Obstacle[] = obstacleList = []
    const add = (x: number, y: number, w: number, h: number, x1: number, y1: number, gap: number): void => {
      if (!axisAligned || (vertical ? x1 : y1) + gap >= bandLo && (vertical ? x : y) - gap <= bandHi
        && (vertical ? y1 : x1) + gap >= reachLo && (vertical ? y : x) - gap <= reachHi) list.push({ x, y, w, h, x1, y1, gap })
    }
    for (const node of ctx.nodes) add(node.x, node.y, node.width, node.height, node.x + node.width, node.y + node.height, nodeClearance(node))
    for (const other of others) {
      const rect = otherLabel(other)
      if (rect) add(rect.x, rect.y, rect.w, rect.h, rect.x + rect.w, rect.y + rect.h, labelGap)
      for (let i = 1; i < other.points.length; i++) {
        const a = other.points[i - 1]!,
          b = other.points[i]!
        const sxLo = Math.min(a.x, b.x),
          sxHi = Math.max(a.x, b.x)
        const syLo = Math.min(a.y, b.y),
          syHi = Math.max(a.y, b.y)
        add(sxLo, syLo, sxHi - sxLo, syHi - syLo, sxHi, syHi, routeGap)
      }
    }
    return list
  }
  const slotClear = (cx: number, cy: number): boolean => {
    const pill = pillRect(cx, cy, m)
    return !obstacles().some(o => rectsOverlap(pill.x, pill.y, pill.w, pill.h, o.x, o.y, o.w, o.h, o.gap))
  }

  // Discrete candidate positions along the lane (Kakoulis–Tollis candidate
  // sets), center-out: the midpoint reads best, the outer slots rescue lanes
  // whose middle band is occupied by a neighboring node or pill.
  for (const t of [0.5, 1 / 3, 2 / 3, 0.25, 0.75, 1 / 6, 5 / 6]) {
    const cx = start.x + (end.x - start.x) * t
    const cy = start.y + (end.y - start.y) * t
    if (slotClear(cx, cy)) return { x: cx, y: cy }
  }
  // A crowded or only just long enough lane can miss every sample while a
  // clear seat remains between its obstacles. Try the seats just beside each
  // obstacle crossing the pill's band, nearest the midpoint first.
  if (!axisAligned) return null
  const lo = Math.min(start[main], end[main]), hi = Math.max(start[main], end[main]), mid = (lo + hi) / 2
  if (hi - lo < 2 * half - 2 * EPS) return null
  const seats = [mid]
  for (const o of obstacles()) {
    if (o[crossEnd] + o.gap <= start[cross] - crossHalf || o[cross] - o.gap >= start[cross] + crossHalf) continue
    seats.push(o[main] - o.gap - half - EPS, o[mainEnd] + o.gap + half + EPS)
  }
  // The whole pill stays on its own lane: a lane ending at a bend has no
  // node there to push a seat back, and a pill over the corner reads as
  // belonging to neither run.
  const ranked = seats.filter(seat => seat >= lo + half - EPS && seat <= hi - half + EPS).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
  for (const seat of ranked.slice(0, 16)) {
    const point = main === 'x' ? { x: seat, y: start.y } : { x: start.x, y: seat }
    if (slotClear(point.x, point.y)) return point
  }
  return null
}

/** Use the same visible proper crossings for proposals and final scoring. */
export function countRouteCrossings(points: Point[], edge: PositionedEdge, ctx: LaneContext, stopAfter = Infinity): number {
  if (edge.style === 'invisible') return 0
  let count = 0
  for (const other of ctx.edges) {
    if (other === edge || other.style === 'invisible' || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
    // The exact pair query includes the allocation-free broad phase; do not
    // traverse both routes once to reject, then again to count crossings.
    count += countPointPairCrossings(points, other.points)
    // Pair counts are already deduplicated and nonnegative. Once the total
    // exceeds the allowed count, later peers cannot change the rejection.
    if (count > stopAfter) return count
  }
  return count
}

/**
 * Conservative check that a route passes through some non-incident node's
 * bbox interior — the signature of a stale path after a later pass moved a
 * node into an already-routed corridor (issue #25 rule 9). Used only to
 * TRIGGER a proof-gated repair; the repair's own checks are shape-exact.
 */
export function routeThroughNodeBBox(edge: PositionedEdge, ctx: LaneContext): boolean {
  for (const node of ctx.nodes) {
    if (node.id === edge.source || node.id === edge.target) continue
    if (routeEntersNodeBox(edge.points, node)) return true
  }
  return false
}

export function dedupeBlockers(blockers: RouteBlocker[]): RouteBlocker[] {
  const seen = new Set<string>()
  return blockers.filter(b => {
    const key = `${b.kind}:${b.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ============================================================================
// Certifying straightener
// ============================================================================

export interface StraightenAttempt {
  applied: boolean
  blockers: RouteBlocker[]
  /** Which candidate lane won (0 = the preferred one). */
  usedCandidateIndex?: number
}

/**
 * Try to collapse one monotone staircase to a straight lane. Candidate lanes
 * are tried in order: the target endpoint's cross-coordinate (moves only the
 * source end), the source endpoint's (moves only the target end), the
 * extremes of the existing route (the channel the router already proved
 * navigable — how a feedback edge wrapping a node collapses onto its outer
 * channel), then the center of the two attachment spans' overlap. The first
 * candidate that lies in both spans and proves clear wins.
 *
 * `axis` carries the edge's own flow direction: the graph axis for
 * primary-forward edges, the sign-flipped axis for feedback edges (their
 * forward-facing side is the graph's backward-facing one).
 */
/** The cross-lane geometry a straightening attempt works within: the two
 *  attachment spans' overlap, the diamond-relaxed overlap that port lanes may
 *  use, the ordered candidate lanes, and the port-lane predicate. Shared by the
 *  mutating straightener (tryStraighten) and the read-only predictor
 *  (straightLaneFor) so both rank lanes identically. `null` when no lane can
 *  attach (a span is missing or the relaxed overlap is empty). */
export interface LaneSearch {
  overlapLo: number
  overlapHi: number
  relaxedLo: number
  relaxedHi: number
  candidates: number[]
  isPortLane: (c: number) => boolean
  emptyRelaxed: boolean
  /** This search ends before accepting a mutation; peer routes stay fixed. */
  priorCrossings?: number
}

export function laneSearch(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, ctx: LaneContext, axis: Axis, restrictToLane?: number): LaneSearch | null {
  const srcSpan = attachSpan(source, axis, 1)
  const tgtSpan = attachSpan(target, axis, -1)
  if (!srcSpan || !tgtSpan) return null

  const overlapLo = Math.max(srcSpan.lo, tgtSpan.lo)
  const overlapHi = Math.min(srcSpan.hi, tgtSpan.hi)
  // Port lanes (through a side-midpoint port) may attach the OTHER endpoint
  // closer to a diamond vertex than the aesthetic margin normally allows:
  // exact connection points outrank the margin (yFiles port-candidate costs).
  const relax = (node: PositionedNode, span: CrossSpan): CrossSpan => {
    if (!hasFacetAttachments(node)) return span
    return { lo: node[axis.cross] + 2, hi: node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) - 2 }
  }
  const relaxedLo = Math.max(relax(source, srcSpan).lo, relax(target, tgtSpan).lo)
  const relaxedHi = Math.min(relax(source, srcSpan).hi, relax(target, tgtSpan).hi)
  const portCross = (node: PositionedNode) => node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) / 2
  const isPortLane = (c: number) => Math.abs(c - portCross(target)) <= PORT_TOLERANCE || Math.abs(c - portCross(source)) <= PORT_TOLERANCE
  if (relaxedLo > relaxedHi) {
    return { overlapLo, overlapHi, relaxedLo, relaxedHi, candidates: [], isPortLane, emptyRelaxed: true }
  }

  const candidates: number[] = []
  const push = (c: number) => {
    if (candidates.every(prev => Math.abs(prev - c) > 0.5)) candidates.push(c)
  }
  // Port lanes first (static glue). Their ORDER is the port ranking: when
  // the source is a diamond whose exit side carries exactly ONE line, its
  // vertex is the cheapest anchor and lines should EMIT from the sharp bit
  // (sharper shape wins; source wins ties). A side carrying several lines
  // spreads instead — no line hogs the point — and fan-ins still prefer the
  // target port, where same-target edges merge. Remaining candidates are
  // dynamic glue: straight, but floating on the side/facet.
  const tgtPortLane = target[axis.cross] + (axis.cross === 'y' ? target.height : target.width) / 2
  const srcPortLane = source[axis.cross] + (axis.cross === 'y' ? source.height : source.width) / 2
  const srcSideUse = ctx.sideUse?.get(`${source.id}:${facingSide(axis, 1)}`) ?? 1
  const emitFromVertex = hasFacetAttachments(source) && srcSideUse === 1 && portSharpness(source) >= portSharpness(target)
  // A reciprocal pair (A->B with an unlabeled B->A partner) renders as TWO
  // EQUAL parallel lines straddling the centerline at center ± SEP/2 —
  // equal deviation gives equal lengths (a diamond's facet width depends on
  // the lane's distance from the vertex), the way dot offsets reciprocal
  // splines symmetrically about the spine. The primary takes the low side,
  // the feedback the high side: deterministic and never colliding.
  const reciprocal = ctx.classes && ctx.edges.some(other => other !== edge && other.source === edge.target && other.target === edge.source && !other.label && !edge.label && other.edgeIndex !== undefined && edge.edgeIndex !== undefined)
  // A reciprocal pair BETWEEN TWO DIAMONDS (G) parts at the NEAREST facet-mids
  // rather than the generic center ± SEP/2: the two parallel lines run between
  // the diamonds' facets (never through a vertex). The primary takes the
  // upper facet (NE source-mid for an LR exit), the feedback the lower (SW);
  // the cross offset is the source diamond's own facet-mid offset (size/4), so
  // its endpoint lands exactly on a facet-mid. The target end anchors on its
  // facing facet at the same lane (on-outline, the partner's nearest mid).
  const recipDiamond = reciprocal && hasFacetAttachments(source) && hasFacetAttachments(target)
  if (restrictToLane !== undefined) {
    candidates.push(restrictToLane)
  } else if (recipDiamond) {
    const own = ctx.classes![edge.edgeIndex!] === 'feedback' ? 1 : -1
    const srcCenter = source[axis.cross] + (axis.cross === 'y' ? source.height : source.width) / 2
    const srcFacetOffset = (axis.cross === 'y' ? source.height : source.width) / 4
    push(srcCenter + own * srcFacetOffset)
    push((overlapLo + overlapHi) / 2 + (own * PAIR_SEPARATION) / 2)
    push(tgtPortLane)
    push(srcPortLane)
  } else if (reciprocal) {
    const pairCenter = (overlapLo + overlapHi) / 2
    const own = ctx.classes![edge.edgeIndex!] === 'feedback' ? 1 : -1
    push(pairCenter + (own * PAIR_SEPARATION) / 2)
    push(tgtPortLane)
    push(srcPortLane)
  } else if (emitFromVertex) {
    push(srcPortLane)
    push(tgtPortLane)
  } else {
    const spreadLane = diamondSpreadLane(edge, source, ctx, axis)
    if (spreadLane !== undefined) push(spreadLane)
    push(tgtPortLane)
    push(srcPortLane)
  }
  if (restrictToLane === undefined) {
    if (edge.points.length > 0) {
      push(edge.points[edge.points.length - 1]![axis.cross])
      push(edge.points[0]![axis.cross])
      const crossValues = edge.points.map(p => p[axis.cross])
      push(Math.min(...crossValues))
      push(Math.max(...crossValues))
    }
    push((overlapLo + overlapHi) / 2)
    // Span quartiles: an unlabeled feedback loop's own cross values all sit
    // on the forward lane or outside the span, so the parallel back-lane
    // that collapses it to the classic two-arrow rendering lies between the
    // span center and a span end.
    push((overlapLo + (overlapLo + overlapHi) / 2) / 2)
    push(((overlapLo + overlapHi) / 2 + overlapHi) / 2)
  }

  return { overlapLo, overlapHi, relaxedLo, relaxedHi, candidates, isPortLane, emptyRelaxed: false }
}

/** Test ONE candidate lane `c` for a straight `source`->`target` route. Returns
 *  the proven straight endpoints when the lane is in span, monotone, obstacle-
 *  clear, crossing-free, and label-hostable; otherwise the blocker(s) that
 *  rejected it. Pure — never mutates the edge — so both the mutating
 *  straightener and the read-only predictor share one lane proof. */
export function proveLane(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  c: number,
  ctx: LaneContext,
  axis: Axis,
  search: LaneSearch,
): { start: Point; end: Point; slot: Point | null } | { blockers: RouteBlocker[] } {
  const lo = search.isPortLane(c) ? search.relaxedLo : search.overlapLo
  const hi = search.isPortLane(c) ? search.relaxedHi : search.overlapHi
  if (c < lo - EPS || c > hi + EPS) return { blockers: [{ kind: 'span', id: edgeId(edge) }] }
  const srcMain = anchorMain(source, c, axis, 1)
  const tgtMain = anchorMain(target, c, axis, -1)
  if (srcMain === null || tgtMain === null) return { blockers: [{ kind: 'span', id: edgeId(edge) }] }
  if ((tgtMain - srcMain) * axis.sign <= EPS) return { blockers: [{ kind: 'span', id: edgeId(edge) }] }
  const mainLo = Math.min(srcMain, tgtMain)
  const mainHi = Math.max(srcMain, tgtMain)
  const found = directLaneBlockers(edge, c, mainLo, mainHi, ctx, axis)
  if (found.length > 0) return { blockers: found }
  const start: Point = axisPoint(axis, srcMain, c)
  const end: Point = axisPoint(axis, tgtMain, c)
  // A repair may never increase edge crossings: a perpendicular crossing is
  // legal when the router chose it, but the straightener must not create
  // one that the original route avoided.
  // The index owner exists only in private frozen-geometry contexts.
  const priorCrossings = ctx.nodeLaneIndexes && !customTextMeasurementActive()
    ? search.priorCrossings ??= countRouteCrossings(edge.points, edge, ctx)
    : countRouteCrossings(edge.points, edge, ctx)
  const nextCrossings = countRouteCrossings([start, end], edge, ctx, priorCrossings)
  if (nextCrossings > priorCrossings) {
    return { blockers: [{ kind: 'crossing', id: edgeId(edge) }] }
  }
  const slot = findLabelSlot(edge, start, end, ctx)
  if (slot === null) return { blockers: [{ kind: 'label', id: edgeId(edge) }] }
  return { start, end, slot }
}

export function tryStraighten(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  ctx: LaneContext,
  axis: Axis = ctx.axis,
  restrictToLane?: number,
  peerOwner: PositionedEdge = edge,
): StraightenAttempt {
  const search = laneSearch(edge, source, target, ctx, axis, restrictToLane)
  if (!search) return { applied: false, blockers: [] }
  if (search.emptyRelaxed) return { applied: false, blockers: [{ kind: 'span', id: edgeId(edge) }] }

  const blockers: RouteBlocker[] = []
  for (let candidateIndex = 0; candidateIndex < search.candidates.length; candidateIndex++) {
    const c = search.candidates[candidateIndex]!
    const proven = proveLane(edge, source, target, c, ctx, axis, search)
    if ('blockers' in proven) {
      blockers.push(...proven.blockers)
      continue
    }
    const markerBlocker = routeCandidateMarkerBlocker(edge, [proven.start, proven.end], ctx.edges, ctx.style, peerOwner)
    if (markerBlocker) { blockers.push(markerBlocker); continue }
    const current = simplifyPolyline(edge.points)
    if (current.length === 2 && Math.abs(current[0]![axis.cross] - current[1]![axis.cross]) <= EPS) {
      const priorContacts = Number(Boolean(portAt(source, current[0]!))) + Number(Boolean(portAt(target, current[1]!)))
      const nextContacts = Number(Boolean(portAt(source, proven.start))) + Number(Boolean(portAt(target, proven.end)))
      const losesContacts = nextContacts < priorContacts
      const reducesOpposingInk = () => {
        const others = ctx.edges.filter(other => other !== edge)
        return countOpposingRouteOverlaps([{ ...edge, points: [proven.start, proven.end] }, ...others]) <
          countOpposingRouteOverlaps([{ ...edge, points: current }, ...others])
      }
      if (losesContacts && countRouteCrossings([proven.start, proven.end], edge, ctx) >= countRouteCrossings(current, edge, ctx) && !reducesOpposingInk()) {
        const lane = current[0]![axis.cross]
        // The aesthetic inset may exclude an existing valid contact near a
        // corner. Re-prove its actual boundary and clear lane, rather than
        // replacing a canonical contact solely to satisfy that inset.
        const priorProof = proveLane(edge, source, target, lane, ctx, axis, {
          ...search,
          overlapLo: Math.min(search.overlapLo, lane), overlapHi: Math.max(search.overlapHi, lane),
          relaxedLo: Math.min(search.relaxedLo, lane), relaxedHi: Math.max(search.relaxedHi, lane),
        })
        // Symmetric reciprocal spacing cannot outrank already-clear canonical
        // contacts. Retain the current lane only when it independently proves.
        if (!('blockers' in priorProof) &&
          Math.hypot(priorProof.start.x - current[0]!.x, priorProof.start.y - current[0]!.y) <= EPS &&
          Math.hypot(priorProof.end.x - current[1]!.x, priorProof.end.y - current[1]!.y) <= EPS) {
          if (edge.label) edge.labelPosition = priorProof.slot ?? undefined
          return { applied: true, blockers: [] }
        }
        // A cosmetic spacing candidate that loses canonical contacts is not a
        // repair. Keep searching; the current route stays available for later
        // label/obstacle repair and receives an honest certificate below.
        if ('blockers' in priorProof) blockers.push(...priorProof.blockers)
        continue
      }
    }
    setRoutePoints(ctx, edge, [proven.start, proven.end])
    if (edge.label) edge.labelPosition = proven.slot ?? undefined
    return { applied: true, blockers: [], usedCandidateIndex: candidateIndex }
  }
  return { applied: false, blockers: dedupeBlockers(blockers) }
}

/**
 * Read-only predictor: the cross-lane `tryStraighten` would settle this edge
 * onto for the current node positions, or `null` when no straight lane proves
 * clear (the edge stays a staircase). Runs the SAME ranked candidate search and
 * per-lane proof as `tryStraighten` but mutates nothing — so a placement pass
 * can move the source onto the lane the straightener will use, BEFORE the
 * freeze, and have the exit land on the moved source's mid-port instead of the
 * straightener pulling it off. Restricted to primary-forward edges (the class
 * the placement passes repair); feedback/diamond-spread ranking is unchanged.
 */
export function straightLaneFor(edge: PositionedEdge, source: PositionedNode, target: PositionedNode, ctx: LaneContext, axis: Axis = ctx.axis): number | null {
  const search = laneSearch(edge, source, target, ctx, axis)
  if (!search || search.emptyRelaxed) return null
  if (!isStraightenable(source) || !isStraightenable(target)) return null
  if (!isMonotoneStaircase(edge.points, axis)) return null
  for (const c of search.candidates) {
    const proven = proveLane(edge, source, target, c, ctx, axis, search)
    if (!('blockers' in proven)) return c
  }
  return null
}

/** A minimal LaneContext for the read-only predictor. Omits the port-ranking
 *  occupancy (sideUse) and route classes the mutating pass derives — the
 *  predictor treats every foreign label as an obstacle (conservative) and never
 *  needs the diamond-vertex emit ranking, which the placement passes don't move
 *  onto. Exported so the placement passes can predict lanes without rebuilding
 *  the route-class/port-allocation machinery. */
export function laneContextFor(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  style: LabelMetricsStyle,
  groups?: readonly PositionedGroup[],
): { ctx: LaneContext; axis: Axis } {
  const axis = axisFor(direction)
  return { ctx: { nodes, edges, groups, axis, style }, axis }
}

/**
 * The other edge whose collinear segment shares this labeled edge's pill trunk
 * (spec §11.4) — the exact condition ROUTE_LABEL_ON_SHARED_TRUNK audits, lifted
 * into a predicate so the audit and the label-repair pass agree by construction:
 * the repair fixes precisely what the audit flags. Returns the conflicting edge,
 * or null when the label is unambiguous.
 */
export function sharedTrunkConflict(edge: PositionedEdge, edges: PositionedEdge[], style: LabelMetricsStyle, labelPosition = edge.labelPosition): PositionedEdge | null {
  if (!edge.label || !labelPosition) return null
  const m = edge.labelBlock ?? graphEdgeTextBlock(resolveLabelContent(edge.label, edge.labelContent), style)
  const pill = pillRect(labelPosition.x, labelPosition.y, m)
  for (const other of edges) {
    if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
    for (let i = 1; i < other.points.length; i++) {
      const a = other.points[i - 1]!,
        b = other.points[i]!
      const vertical = Math.abs(a.x - b.x) < EPS
      const horizontal = Math.abs(a.y - b.y) < EPS
      if (!vertical && !horizontal) continue
      const sxLo = Math.min(a.x, b.x),
        sxHi = Math.max(a.x, b.x)
      const syLo = Math.min(a.y, b.y),
        syHi = Math.max(a.y, b.y)
      const hitsPill = sxHi >= pill.x && sxLo <= pill.x + pill.w && syHi >= pill.y && syLo <= pill.y + pill.h
      if (!hitsPill) continue
      // Shared trunk only when one of THIS edge's segments is collinear with the
      // other's; a plain perpendicular crossing is not.
      for (let j = 1; j < edge.points.length; j++) {
        const c = edge.points[j - 1]!,
          d = edge.points[j]!
        const sameAxis = vertical ? Math.abs(c.x - d.x) < EPS && Math.abs(c.x - a.x) < CLEARANCE : Math.abs(c.y - d.y) < EPS && Math.abs(c.y - a.y) < CLEARANCE
        if (!sameAxis) continue
        const cLo = vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x)
        const cHi = vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x)
        const oLo = vertical ? syLo : sxLo
        const oHi = vertical ? syHi : sxHi
        if (Math.min(cHi, oHi) - Math.max(cLo, oLo) > EPS) return other
      }
    }
  }
  return null
}

export function routeAddsCrossings(points: Point[], edge: PositionedEdge, ctx: LaneContext): boolean {
  const prior = countRouteCrossings(edge.points, edge, ctx)
  return countRouteCrossings(points, edge, ctx, prior) > prior
}

export function routeEntersNodeBox(points: readonly Point[], node: PositionedNode): boolean {
  const boundary = node.shape === 'cylinder' ? shapeRoutingProfile(node).boundary : undefined
  // These canonical decorations add internal lines to a full rectangle; they
  // do not leave an empty contact band around its body. Other symbols keep
  // their existing shape-specific tolerance, even when based on a rectangle.
  const rectangularBody = (node.shape === 'rectangle' || node.shape === 'subroutine')
    && (node.semanticShape === undefined || node.semanticShape === 'rect' || node.semanticShape === 'fr-rect'
      || node.semanticShape === 'lin-rect' || node.semanticShape === 'div-rect' || node.semanticShape === 'win-pane')
  const inset = rectangularBody ? 0 : 0.5
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
    const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
    // The classic cylinder's straight-sided opaque core has no empty rim.
    // Semantic cylinder variants have different boundaries and stay excluded.
    if (boundary?.kind === 'cylinder' && boundary.height > 2 * boundary.capRadiusY
      && xHi > node.x && xLo < node.x + node.width
      && yHi > boundary.y + boundary.capRadiusY && yLo < boundary.y + boundary.height - boundary.capRadiusY) return true
    if (xHi > node.x + inset && xLo < node.x + node.width - inset &&
      yHi > node.y + inset && yLo < node.y + node.height - inset) return true
  }
  return false
}
