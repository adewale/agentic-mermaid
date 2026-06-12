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
}

function edgeId(e: { source: string; target: string }): string {
  return `${e.source}->${e.target}`
}

function labelRect(e: PositionedEdge, style: LabelMetricsStyle): { x: number; y: number; w: number; h: number } | null {
  if (!e.label || !e.labelPosition) return null
  const m = measureMultilineText(e.label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
  return { x: e.labelPosition.x - m.width / 2, y: e.labelPosition.y - m.height / 2, w: m.width, h: m.height }
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
    const rect = labelRect(other, ctx.style)
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
    const span = axis.main === 'x' ? m.width : m.height
    if (mainHi - mainLo < span + LABEL_CLEARANCE) {
      blockers.push({ kind: 'label', id: edgeId(edge) })
    }
  }

  return dedupeBlockers(blockers)
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
    edge.points = [start, end]
    if (edge.label) {
      edge.labelPosition = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    }
    return { applied: true, blockers: [] }
  }
  return { applied: false, blockers: dedupeBlockers(blockers) }
}

/**
 * The route-contract pass: simplify every polyline (proof-free), straighten
 * primary-forward staircases whose direct lane proves clear (proof-carrying),
 * and certify every edge. Mutates edge geometry in author order so each proof
 * sees the results of earlier straightenings; attaches the certificate to the
 * edge and returns all certificates.
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
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style }
  const certificates: RouteCertificate[] = []

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
      // Feedback edges flow against the graph axis: same lane proof, flipped sign.
      const edgeAxis: Axis = routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
      const detour = routeClass === 'feedback' ? 'feedback-detour' : 'explained-detour'
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      const eligible = source && target &&
        (RECT_LIKE.has(source.shape) || source.shape === 'diamond') &&
        (RECT_LIKE.has(target.shape) || target.shape === 'diamond') &&
        isMonotoneStaircase(edge.points, edgeAxis)
      if (!eligible) {
        cert.invariant = routeClass === 'feedback' ? 'feedback-detour' : 'unverified-shape'
      } else {
        const attempt = tryStraighten(edge, source, target, ctx, edgeAxis)
        if (attempt.applied) {
          cert.invariant = 'straight'
          cert.bendCount = 0
          cert.directLaneClear = true
          cert.straightened = true
        } else {
          cert.invariant = detour
          cert.directLaneClear = false
          cert.directLaneBlockedBy = attempt.blockers
        }
      }
    }

    edge.routeCertificate = cert
    certificates.push(cert)
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
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style }
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
