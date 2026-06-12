/**
 * Route contracts — principled routing without hitches (docs/design/route-contracts.md).
 *
 * ELK's FREE port placement spreads edge endpoints along node sides, so a
 * forward edge between two nodes that share a centerline often gets a short
 * perpendicular jog ("hitch") even though nothing blocks the direct lane.
 * This module classifies every edge by semantic role, then collapses a
 * primary-forward route to a straight lane only when it can prove the lane
 * is clear; every other route gets a certificate explaining its bends.
 *
 * Runs at the very end of elkToPositioned(): nothing may move nodes or edit
 * edge geometry after this pass without recertifying.
 */

import type {
  Direction,
  MermaidGraph,
  Point,
  PositionedEdge,
  PositionedGroup,
  PositionedNode,
  RouteBlocker,
  RouteCertificate,
  RouteClass,
} from './types.ts'
import { measureMultilineText } from './text-metrics.ts'
import { resolveRenderStyle } from './styles.ts'

/** Two coordinates within this distance are the same point. */
const EPS = 0.01
/** Straightened endpoints keep this inset from rectangle side ends. */
const SPAN_MARGIN = 4
/** Obstacle bounding boxes are inflated by this much when proving a lane clear. */
const CLEARANCE = 4
/** Required free space around a label hosted on a straightened lane. */
const LABEL_CLEARANCE = 8
/** The renderer draws labels as pills with this padding around the measured text. */
const LABEL_PILL_PADDING = 8

/** Shapes whose forward-facing side is a straight axis-aligned segment. */
const RECT_LIKE = new Set(['rectangle', 'service', 'rounded', 'subroutine'])

interface LabelMetricsStyle {
  edgeLabelFontSize: number
  edgeLabelFontWeight: number
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Classify every edge of the graph by author-order semantics. Mirrors the
 * cycle-tolerant reachability used by sourceAwareNodeOrder() so the route
 * class always agrees with the model order ELK laid out.
 */
export function classifyRoutes(graph: MermaidGraph): RouteClass[] {
  const subgraphIds = new Set<string>()
  const scopeOf = new Map<string, string>()
  const visitScope = (sgs: MermaidGraph['subgraphs'], parent: string) => {
    for (const sg of sgs) {
      subgraphIds.add(sg.id)
      for (const nodeId of sg.nodeIds) scopeOf.set(nodeId, sg.id)
      visitScope(sg.children, sg.id)
    }
  }
  visitScope(graph.subgraphs, '')

  const outgoing = new Map<string, Set<string>>()
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const next of outgoing.get(id) ?? []) stack.push(next)
    }
    return false
  }

  return graph.edges.map(edge => {
    if (edge.source === edge.target) return 'self-loop'
    if (subgraphIds.has(edge.source) || subgraphIds.has(edge.target)) return 'container'
    const cls: RouteClass = reaches(edge.target, edge.source)
      ? 'feedback'
      : (scopeOf.get(edge.source) ?? '') !== (scopeOf.get(edge.target) ?? '')
        ? 'cross-hierarchy'
        : 'primary-forward'
    if (cls !== 'feedback') {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, new Set())
      outgoing.get(edge.source)!.add(edge.target)
    }
    return cls
  })
}

// ============================================================================
// Geometry helpers
// ============================================================================

interface Axis {
  main: 'x' | 'y'
  cross: 'x' | 'y'
  /** +1 when forward flow increases the main coordinate. */
  sign: 1 | -1
}

function axisFor(direction: Direction): Axis {
  switch (direction) {
    case 'LR': return { main: 'x', cross: 'y', sign: 1 }
    case 'RL': return { main: 'x', cross: 'y', sign: -1 }
    case 'BT': return { main: 'y', cross: 'x', sign: -1 }
    default: return { main: 'y', cross: 'x', sign: 1 } // TD / TB
  }
}

/** Remove consecutive duplicates and collinear midpoints. Preserves drawn geometry exactly. */
export function simplifyPolyline(points: Point[]): Point[] {
  if (points.length < 3) return points
  const out: Point[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.abs(p.x - prev.x) < EPS && Math.abs(p.y - prev.y) < EPS) continue
    out.push(p)
  }
  if (out.length < 3) return out
  const result: Point[] = [out[0]!]
  for (let i = 1; i < out.length - 1; i++) {
    const a = result[result.length - 1]!, b = out[i]!, c = out[i + 1]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) < EPS) continue // collinear midpoint
    result.push(b)
  }
  result.push(out[out.length - 1]!)
  return result
}

/** Interior vertex count of a polyline. */
function bendCount(points: Point[]): number {
  return Math.max(0, simplifyPolyline(points).length - 2)
}

/** Max perpendicular deviation of a route from its flow axis. */
function crossDeviation(points: Point[], axis: Axis): number {
  let lo = Infinity, hi = -Infinity
  for (const p of points) {
    lo = Math.min(lo, p[axis.cross])
    hi = Math.max(hi, p[axis.cross])
  }
  return hi - lo
}

/**
 * A route is a monotone staircase when every segment is axis-aligned and all
 * flow-axis displacement runs forward. Only these are straightening candidates.
 */
function isMonotoneStaircase(points: Point[], axis: Axis): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const dMain = (b[axis.main] - a[axis.main]) * axis.sign
    const dCross = Math.abs(b[axis.cross] - a[axis.cross])
    if (dMain > EPS && dCross > EPS) return false // diagonal segment
    if (dMain < -EPS) return false // moves against the flow
  }
  return true
}

// ============================================================================
// Attachment spans and anchors
// ============================================================================

interface CrossSpan { lo: number; hi: number }

/** Cross-axis range where a straightened lane may attach to this node. */
function attachSpan(node: PositionedNode, axis: Axis): CrossSpan | null {
  const lo = node[axis.cross]
  const size = axis.cross === 'y' ? node.height : node.width
  if (node.shape === 'diamond') {
    // Central 50% only — edges must never attach next to a vertex.
    const center = lo + size / 2
    return { lo: center - size / 4, hi: center + size / 4 }
  }
  if (RECT_LIKE.has(node.shape)) {
    if (size <= SPAN_MARGIN * 2) return null
    return { lo: lo + SPAN_MARGIN, hi: lo + size - SPAN_MARGIN }
  }
  return null // shape's outline may not contain a bbox-side anchor; skip
}

/**
 * Main-axis coordinate where a straight lane at cross-coordinate `c` meets the
 * node's rendered boundary. `facing` is +1 for the side facing forward flow
 * (source side), -1 for the side facing backward (target side).
 */
function anchorMain(node: PositionedNode, c: number, axis: Axis, facing: 1 | -1): number {
  const mainLo = node[axis.main]
  const mainSize = axis.main === 'x' ? node.width : node.height
  if (node.shape === 'diamond') {
    const crossLo = node[axis.cross]
    const crossSize = axis.cross === 'y' ? node.height : node.width
    const centerMain = mainLo + mainSize / 2
    const centerCross = crossLo + crossSize / 2
    const slope = 1 - Math.abs(c - centerCross) / (crossSize / 2)
    return centerMain + facing * axis.sign * (mainSize / 2) * slope
  }
  return facing * axis.sign > 0 ? mainLo + mainSize : mainLo
}

// ============================================================================
// Direct-lane proof
// ============================================================================

interface LaneContext {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  axis: Axis
  style: LabelMetricsStyle
  /** Route classes by edgeIndex — lets proofs apply the primary-over-feedback priority. */
  classes?: RouteClass[]
}

/**
 * Primary edges own the straight lane (spec §5): when proving a primary
 * lane, the reciprocal feedback partner's label is movable decoration —
 * the partner re-places it when it straightens, or keeps it on its detour —
 * so it must not veto the primary's lane.
 */
function isMovableReciprocalLabel(edge: PositionedEdge, other: PositionedEdge, ctx: LaneContext): boolean {
  if (!ctx.classes || edge.edgeIndex === undefined || other.edgeIndex === undefined) return false
  return ctx.classes[edge.edgeIndex] === 'primary-forward' &&
    ctx.classes[other.edgeIndex] === 'feedback' &&
    other.source === edge.target && other.target === edge.source
}

function edgeId(e: { source: string; target: string }): string {
  return `${e.source}->${e.target}`
}

/** The rendered pill rect for a label of this size centered at (cx, cy). */
function pillRect(cx: number, cy: number, m: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const w = m.width + 2 * LABEL_PILL_PADDING
  const h = m.height + 2 * LABEL_PILL_PADDING
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

function labelRect(e: PositionedEdge, style: LabelMetricsStyle): { x: number; y: number; w: number; h: number } | null {
  if (!e.label || !e.labelPosition) return null
  const m = measureMultilineText(e.label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
  return pillRect(e.labelPosition.x, e.labelPosition.y, m)
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
): RouteBlocker[] {
  const blockers: RouteBlocker[] = []
  const { axis } = ctx
  const overlaps = (lo: number, hi: number, lo2: number, hi2: number) =>
    Math.min(hi, hi2) - Math.max(lo, lo2) > EPS

  for (const node of ctx.nodes) {
    if (node.id === edge.source || node.id === edge.target) continue
    const nMainLo = node[axis.main] - CLEARANCE
    const nMainHi = node[axis.main] + (axis.main === 'x' ? node.width : node.height) + CLEARANCE
    const nCrossLo = node[axis.cross] - CLEARANCE
    const nCrossHi = node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) + CLEARANCE
    if (c > nCrossLo && c < nCrossHi && overlaps(mainLo, mainHi, nMainLo, nMainHi)) {
      blockers.push({ kind: 'node', id: node.id })
    }
  }

  for (const other of ctx.edges) {
    // Compare by edgeIndex as well as identity: validation proves lanes on a
    // copy of the edge, and the original must not block its own lane.
    if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
    const rect = isMovableReciprocalLabel(edge, other, ctx) ? null : labelRect(other, ctx.style)
    if (rect) {
      const rMainLo = (axis.main === 'x' ? rect.x : rect.y) - CLEARANCE
      const rMainHi = rMainLo + (axis.main === 'x' ? rect.w : rect.h) + 2 * CLEARANCE
      const rCrossLo = (axis.cross === 'y' ? rect.y : rect.x) - CLEARANCE
      const rCrossHi = rCrossLo + (axis.cross === 'y' ? rect.h : rect.w) + 2 * CLEARANCE
      if (c > rCrossLo && c < rCrossHi && overlaps(mainLo, mainHi, rMainLo, rMainHi)) {
        blockers.push({ kind: 'label', id: edgeId(other) })
      }
    }
    // Collinear overlap with another edge's flow-axis segment would merge the
    // two lines visually ("channel" conflict). Perpendicular crossings are fine.
    for (let i = 1; i < other.points.length; i++) {
      const a = other.points[i - 1]!, b = other.points[i]!
      if (Math.abs(a[axis.cross] - b[axis.cross]) > EPS) continue
      if (Math.abs(a[axis.cross] - c) >= CLEARANCE) continue
      const sLo = Math.min(a[axis.main], b[axis.main])
      const sHi = Math.max(a[axis.main], b[axis.main])
      if (overlaps(mainLo, mainHi, sLo, sHi)) {
        blockers.push({ kind: 'channel', id: edgeId(other) })
        break
      }
    }
  }

  if (edge.label) {
    const m = measureMultilineText(edge.label, ctx.style.edgeLabelFontSize, ctx.style.edgeLabelFontWeight)
    const span = (axis.main === 'x' ? m.width : m.height) + 2 * LABEL_PILL_PADDING
    if (mainHi - mainLo < span + LABEL_CLEARANCE) {
      blockers.push({ kind: 'label', id: edgeId(edge) })
    }
  }

  return dedupeBlockers(blockers)
}

/**
 * Find a position on the straight lane where this edge's label can sit
 * without overlapping nodes, other edges' labels, or other edges' segments
 * (spec §11.4: labels are obstacles for each other). Tries the midpoint,
 * then 1/3 and 2/3 — reciprocal labeled pairs end up straight with staggered
 * labels. Returns null when no slot is clear.
 */
function findLabelSlot(
  edge: PositionedEdge,
  start: Point,
  end: Point,
  ctx: LaneContext,
): Point | null {
  if (!edge.label) return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const m = measureMultilineText(edge.label, ctx.style.edgeLabelFontSize, ctx.style.edgeLabelFontWeight)
  const PAD = 2
  const rectsOverlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
    ax < bx + bw + PAD && ax + aw + PAD > bx && ay < by + bh + PAD && ay + ah + PAD > by

  for (const t of [0.5, 1 / 3, 2 / 3]) {
    const cx = start.x + (end.x - start.x) * t
    const cy = start.y + (end.y - start.y) * t
    const pill = pillRect(cx, cy, m)
    let clear = true

    for (const node of ctx.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      if (rectsOverlap(pill.x, pill.y, pill.w, pill.h, node.x, node.y, node.width, node.height)) { clear = false; break }
    }
    if (clear) for (const other of ctx.edges) {
      if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
      const rect = isMovableReciprocalLabel(edge, other, ctx) ? null : labelRect(other, ctx.style)
      if (rect && rectsOverlap(pill.x, pill.y, pill.w, pill.h, rect.x, rect.y, rect.w, rect.h)) { clear = false; break }
      for (let i = 1; i < other.points.length; i++) {
        const a = other.points[i - 1]!, b = other.points[i]!
        const sxLo = Math.min(a.x, b.x), sxHi = Math.max(a.x, b.x)
        const syLo = Math.min(a.y, b.y), syHi = Math.max(a.y, b.y)
        if (rectsOverlap(pill.x, pill.y, pill.w, pill.h, sxLo, syLo, sxHi - sxLo, syHi - syLo)) { clear = false; break }
      }
      if (!clear) break
    }
    if (clear) return { x: cx, y: cy }
  }
  return null
}

function dedupeBlockers(blockers: RouteBlocker[]): RouteBlocker[] {
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

interface StraightenAttempt {
  applied: boolean
  blockers: RouteBlocker[]
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
function tryStraighten(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  ctx: LaneContext,
  axis: Axis = ctx.axis,
): StraightenAttempt {
  const srcSpan = attachSpan(source, axis)
  const tgtSpan = attachSpan(target, axis)
  if (!srcSpan || !tgtSpan) return { applied: false, blockers: [] }

  const overlapLo = Math.max(srcSpan.lo, tgtSpan.lo)
  const overlapHi = Math.min(srcSpan.hi, tgtSpan.hi)
  if (overlapLo > overlapHi) {
    return { applied: false, blockers: [{ kind: 'span', id: edgeId(edge) }] }
  }

  const candidates: number[] = []
  const push = (c: number) => {
    if (candidates.every(prev => Math.abs(prev - c) > 0.5)) candidates.push(c)
  }
  push(edge.points[edge.points.length - 1]![axis.cross])
  push(edge.points[0]![axis.cross])
  const crossValues = edge.points.map(p => p[axis.cross])
  push(Math.min(...crossValues))
  push(Math.max(...crossValues))
  push((overlapLo + overlapHi) / 2)

  const blockers: RouteBlocker[] = []
  for (const c of candidates) {
    if (c < overlapLo - EPS || c > overlapHi + EPS) {
      blockers.push({ kind: 'span', id: edgeId(edge) })
      continue
    }
    const srcMain = anchorMain(source, c, axis, 1)
    const tgtMain = anchorMain(target, c, axis, -1)
    if ((tgtMain - srcMain) * axis.sign <= EPS) {
      blockers.push({ kind: 'span', id: edgeId(edge) })
      continue
    }
    const mainLo = Math.min(srcMain, tgtMain)
    const mainHi = Math.max(srcMain, tgtMain)
    const found = directLaneBlockers(edge, c, mainLo, mainHi, ctx)
    if (found.length > 0) {
      blockers.push(...found)
      continue
    }
    const start: Point = axis.main === 'x' ? { x: srcMain, y: c } : { x: c, y: srcMain }
    const end: Point = axis.main === 'x' ? { x: tgtMain, y: c } : { x: c, y: tgtMain }
    const slot = findLabelSlot(edge, start, end, ctx)
    if (slot === null) {
      blockers.push({ kind: 'label', id: edgeId(edge) })
      continue
    }
    edge.points = [start, end]
    if (edge.label) edge.labelPosition = slot
    return { applied: true, blockers: [] }
  }
  return { applied: false, blockers: dedupeBlockers(blockers) }
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
): RouteCertificate[] {
  const classes = classifyRoutes(graph)
  const axis = axisFor(graph.direction)
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style, classes }
  const certificates: RouteCertificate[] = []

  // Attempt one proof-carrying straightening; updates geometry + certificate.
  // Returns true when the route was collapsed.
  const attemptStraighten = (edge: PositionedEdge, cert: RouteCertificate): boolean => {
    const edgeAxis: Axis = cert.routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    const eligible = source && target &&
      (RECT_LIKE.has(source.shape) || source.shape === 'diamond') &&
      (RECT_LIKE.has(target.shape) || target.shape === 'diamond') &&
      isMonotoneStaircase(edge.points, edgeAxis)
    if (!eligible) {
      cert.invariant = cert.routeClass === 'feedback' ? 'feedback-detour' : 'unverified-shape'
      return false
    }
    const attempt = tryStraighten(edge, source!, target!, ctx, edgeAxis)
    if (attempt.applied) {
      cert.invariant = 'straight'
      cert.bendCount = 0
      cert.directLaneClear = true
      cert.straightened = true
      cert.directLaneBlockedBy = undefined
      return true
    }
    cert.invariant = cert.routeClass === 'feedback' ? 'feedback-detour' : 'explained-detour'
    cert.directLaneClear = false
    cert.directLaneBlockedBy = attempt.blockers
    return false
  }

  const retry: Array<{ edge: PositionedEdge; cert: RouteCertificate }> = []
  for (const edge of positioned.edges) {
    edge.points = simplifyPolyline(edge.points)

    const edgeIndex = edge.edgeIndex ?? -1
    const routeClass: RouteClass = classes[edgeIndex] ?? 'primary-forward'
    const cert: RouteCertificate = {
      edgeIndex,
      routeClass,
      bendCount: bendCount(edge.points),
      invariant: 'straight',
    }

    if (bundled.has(edge)) {
      cert.invariant = 'bundle'
    } else if (routeClass === 'self-loop') {
      cert.invariant = 'self-loop'
    } else if (routeClass === 'container') {
      cert.invariant = 'container-attach'
    } else if ((routeClass === 'primary-forward' || routeClass === 'feedback') && cert.bendCount > 0) {
      if (!attemptStraighten(edge, cert)) retry.push({ edge, cert })
    }

    edge.routeCertificate = cert
    certificates.push(cert)
  }

  // Fixed point: each round only re-proves edges that failed, and only keeps
  // iterating while some edge straightened (which strictly shrinks the retry
  // list), so this terminates in at most |edges| rounds; 4 covers practice.
  for (let round = 0; round < 4 && retry.length > 0; round++) {
    const still: typeof retry = []
    let changed = false
    for (const item of retry) {
      if (item.cert.invariant === 'unverified-shape') continue
      if (attemptStraighten(item.edge, item.cert)) changed = true
      else still.push(item)
    }
    if (!changed) break
    retry.length = 0
    retry.push(...still)
  }

  return certificates
}

// ============================================================================
// Validation (consumed by verifyMermaid as ROUTE_HITCH)
// ============================================================================

export interface RouteHitch {
  edge: string
  deviationPx: number
}

/**
 * Re-prove the straight-lane invariant over FINAL geometry. A hitch is a
 * primary-forward or feedback edge that still bends although a clear
 * candidate lane exists for it. The layout pass straightens these itself, so
 * any hit here means a later pass mutated geometry after certification — the
 * tripwire issue #25 acceptance criterion 3 asks for.
 */
export function findRouteHitches(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  graph: MermaidGraph,
  style: LabelMetricsStyle = resolveRenderStyle({}),
): RouteHitch[] {
  const axis = axisFor(graph.direction)
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  // Mirror the layout pass's priority rules using the certified classes.
  const classes: RouteClass[] = []
  for (const e of positioned.edges) {
    if (e.edgeIndex !== undefined && e.routeCertificate) classes[e.edgeIndex] = e.routeCertificate.routeClass
  }
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style, classes }
  const hitches: RouteHitch[] = []

  for (const edge of positioned.edges) {
    const cert = edge.routeCertificate
    if (!cert || cert.invariant === 'bundle') continue
    if (cert.routeClass !== 'primary-forward' && cert.routeClass !== 'feedback') continue
    const edgeAxis: Axis = cert.routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
    const points = simplifyPolyline(edge.points)
    if (points.length <= 2) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!(RECT_LIKE.has(source.shape) || source.shape === 'diamond')) continue
    if (!(RECT_LIKE.has(target.shape) || target.shape === 'diamond')) continue
    if (!isMonotoneStaircase(points, edgeAxis)) continue
    // Probe on a copy so validation never mutates the layout.
    const probe: PositionedEdge = { ...edge, points: points.map(p => ({ ...p })) }
    const attempt = tryStraighten(probe, source, target, ctx, edgeAxis)
    if (attempt.applied) {
      hitches.push({ edge: edgeId(edge), deviationPx: Math.round(crossDeviation(points, edgeAxis) * 10) / 10 })
    }
  }
  return hitches
}
