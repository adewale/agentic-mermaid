/**
 * Route contracts — principled routing without hitches (docs/design/system/route-contracts.md).
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
  AnyPort,
  DiamondFacet,
  Direction,
  MermaidGraph,
  Point,
  PortSemanticRole,
  PortSide,
  PositionedEdge,
  PositionedGroup,
  PositionedNode,
  RouteBlocker,
  RouteCertificate,
  RouteClass,
  RouteInvariant,
  RoutePortAssignment,
} from './types.ts'
import { measureMultilineText } from './text-metrics.ts'
import { resolveRenderStyle } from './styles.ts'

type DraftRouteCertificate = Omit<RouteCertificate, 'invariant' | 'straightened'> & {
  invariant: RouteInvariant
  /** Internal draft bit; finalized public certificates only keep this for straight routes. */
  straightened?: true
}

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

/**
 * Shapes whose four canonical ports (bbox side midpoints — see PortSide) lie
 * exactly on the rendered outline: symmetric shapes inscribed in their bbox.
 * Rect-likes additionally accept attachment anywhere on a side (dynamic
 * glue); diamonds anywhere on a facet; the rest are port-only.
 */
export const PORT_EXACT = new Set([
  ...RECT_LIKE, 'diamond',
  'circle', 'doublecircle', 'stadium', 'hexagon', 'cylinder', 'state-start', 'state-end',
  // The slanted family: their N/S ports sit on flat bbox-edge regions and
  // their E/W ports move inward onto the slant midpoints (see shapePorts).
  'trapezoid', 'trapezoid-alt', 'asymmetric', 'lean-r', 'lean-l',
])

/** Shapes whose E/W sides are slants sheared in by width * SLANT_INSET_RATIO
 *  (renderer geometry): the E/W port main coordinate moves onto the slant
 *  midpoint, all other port coordinates stay at the bbox side midpoints. */
const SLANTED = new Set(['trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l'])
const SLANT_INSET_RATIO = 0.15

/** Tolerance for recognizing an endpoint as sitting on a port. */
const PORT_TOLERANCE = 0.5

/** Cross-axis distance between the two lines of a reciprocal pair. */
const PAIR_SEPARATION = 12

/** Minimum length of a vertex hook's entry stub (the perpendicular segment
 *  into the target's facing port) — shorter reads as a hitch, not an entry. */
const HOOK_STUB_MIN = 8

/** The four canonical connection points. Every port keeps its CROSS
 *  coordinate at the bbox center (cy for E/W, cx for N/S) — the whole engine
 *  assumes port lanes run through node centers. Only the MAIN coordinate
 *  moves onto the rendered outline:
 *   - symmetric shapes (rect-likes, diamond, circle, stadium, hexagon,
 *     cylinder, pseudostates): bbox side midpoints — diamond vertices,
 *     circle extremes, hexagon E/W vertices and cylinder cap centers
 *     coincide with them.
 *   - the slanted family (trapezoid, trapezoid-alt, lean-r, lean-l): E/W
 *     move inward to the slant midpoints at mid-height (x + i/2 and
 *     x + w - i/2 with i = w * 0.15 — identical for all four by symmetry);
 *     N/S stay at (cx, y)/(cx, y+h), which lie on the flats since i < w/2.
 *   - asymmetric: W is the flag point (x, cy); E/N/S are bbox midpoints
 *     (cx lies on both flats whenever w > 24 — nodes are always wider). */
export function shapePorts(node: PositionedNode): Record<PortSide, Point> {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  let east = node.x + node.width
  let west = node.x
  if (SLANTED.has(node.shape)) {
    const inset = node.width * SLANT_INSET_RATIO
    east = node.x + node.width - inset / 2
    west = node.x + inset / 2
  }
  return {
    N: { x: cx, y: node.y },
    E: { x: east, y: cy },
    S: { x: cx, y: node.y + node.height },
    W: { x: west, y: cy },
  }
}

/**
 * The four facet-midpoints of a diamond — the points halfway along each
 * slanted edge. For a diamond at (x,y,w,h) with cx=x+w/2, cy=y+h/2 these are
 * the averages of the adjacent vertices: NE/SE/SW/NW at (x±w/4 offset from cx,
 * y±h/4 offset from cy). All four lie exactly on the rendered outline
 * (|dx|/hw + |dy|/hh = 1). Diamond-only: every other shape keeps its four
 * cardinal ports via shapePorts(); this is a strictly additive attachment set.
 */
export function diamondFacetPorts(node: PositionedNode): Record<DiamondFacet, Point> {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const qw = node.width / 4
  const qh = node.height / 4
  return {
    NE: { x: cx + qw, y: cy - qh },
    SE: { x: cx + qw, y: cy + qh },
    SW: { x: cx - qw, y: cy + qh },
    NW: { x: cx - qw, y: cy - qh },
  }
}

/**
 * The port (if any) an endpoint sits on, within PORT_TOLERANCE. The four
 * cardinal side-midpoints are checked first for EVERY shape (byte-identical to
 * the legacy four-cardinal probe), so non-diamonds and diamond cardinal
 * attachments are unchanged. A diamond endpoint that misses all four cardinals
 * is additionally tested against the facet-midpoints, returning NE/SE/SW/NW.
 */
function portAt(node: PositionedNode, pt: Point): AnyPort | undefined {
  const ports = shapePorts(node)
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    if (Math.abs(ports[side].x - pt.x) <= PORT_TOLERANCE && Math.abs(ports[side].y - pt.y) <= PORT_TOLERANCE) return side
  }
  if (node.shape === 'diamond') {
    const facets = diamondFacetPorts(node)
    for (const f of ['NE', 'SE', 'SW', 'NW'] as const) {
      if (Math.abs(facets[f].x - pt.x) <= PORT_TOLERANCE && Math.abs(facets[f].y - pt.y) <= PORT_TOLERANCE) return f
    }
  }
  return undefined
}

/** Straightenable: rect-likes and diamonds anywhere on a side/facet; other
 *  PORT_EXACT shapes only through their exact ports. */
function isStraightenable(shape: PositionedNode['shape']): boolean {
  return PORT_EXACT.has(shape)
}

export interface LabelMetricsStyle {
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

/**
 * Remove consecutive duplicates and collinear midpoints. Preserves drawn
 * geometry exactly. Iterates to a fixed point: ELK can emit degenerate
 * zero-net spikes (out-and-back excursions) whose midpoints only become
 * collinear after their neighbors are removed — a single pass would leave a
 * phantom collinear point behind.
 */
export function simplifyPolyline(points: Point[]): Point[] {
  let current = points
  for (let iterations = 0; iterations < 8; iterations++) {
    if (current.length < 3) return current
    const out: Point[] = [current[0]!]
    for (let i = 1; i < current.length; i++) {
      const p = current[i]!
      const prev = out[out.length - 1]!
      if (Math.abs(p.x - prev.x) < EPS && Math.abs(p.y - prev.y) < EPS) continue
      out.push(p)
    }
    const result: Point[] = out.length < 3 ? out : [out[0]!]
    if (out.length >= 3) {
      for (let i = 1; i < out.length - 1; i++) {
        const a = result[result.length - 1]!, b = out[i]!, c = out[i + 1]!
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if (Math.abs(cross) < EPS) continue // collinear midpoint (or spike apex)
        result.push(b)
      }
      result.push(out[out.length - 1]!)
    }
    if (result.length === current.length) return result
    current = result
  }
  return current
}

/**
 * Replace any diagonal segment with an axis-aligned elbow. ELK's orthogonal
 * router emits diagonals in rare feedback-port joins; downstream contracts
 * (and the renderer's orthogonality guarantee) assume axis-aligned segments.
 * The elbow continues the PREVIOUS segment's axis for visual continuity.
 */
function orthogonalizeResidualDiagonals(points: Point[]): Point[] {
  let needsWork = false
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) { needsWork = true; break }
  }
  if (!needsWork) return points
  const out: Point[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!, b = points[i]!
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      const prev = out.length >= 2 ? out[out.length - 2]! : undefined
      const prevHorizontal = prev ? Math.abs(prev.y - a.y) < EPS : true
      out.push(prevHorizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y })
    }
    out.push(b)
  }
  return out
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

/** A straightened lane keeps this cross-axis distance from a diamond vertex. */
const VERTEX_MARGIN = 10

/** Cross-axis range where a straightened lane may attach to this node. */
function attachSpan(node: PositionedNode, axis: Axis): CrossSpan | null {
  const lo = node[axis.cross]
  const size = axis.cross === 'y' ? node.height : node.width
  if (node.shape === 'diamond') {
    // Anywhere on the facet except a small absolute margin around the
    // vertices — flowchart convention attaches along the whole slanted edge
    // (a proportional restriction needlessly forbade straight lanes whose
    // partner node sits off the diamond's centerline).
    if (size <= VERTEX_MARGIN * 4) {
      const center = lo + size / 2
      return { lo: center - size / 4, hi: center + size / 4 }
    }
    return { lo: lo + VERTEX_MARGIN, hi: lo + size - VERTEX_MARGIN }
  }
  if (RECT_LIKE.has(node.shape)) {
    if (size <= SPAN_MARGIN * 2) return null
    return { lo: lo + SPAN_MARGIN, hi: lo + size - SPAN_MARGIN }
  }
  // Shapes with one FLAT pair of sides accept attachment anywhere on the
  // flat region (it lies exactly on the bbox edge); their curved/pointed
  // pair stays port-only. This is the geometric form of yFiles' overflow
  // port candidates: the side midpoint is the preferred anchor, the rest of
  // the flat side takes the overflow.
  if (node.shape === 'hexagon' && axis.cross === 'x') {
    const inset = node.height / 4
    if (size - 2 * inset <= SPAN_MARGIN) return null
    return { lo: lo + inset + 2, hi: lo + size - inset - 2 } // flat N/S region
  }
  if (node.shape === 'stadium' && axis.cross === 'x') {
    const r = node.height / 2
    if (size - 2 * r <= SPAN_MARGIN) return null
    return { lo: lo + r + 2, hi: lo + size - r - 2 } // flat N/S region
  }
  if (node.shape === 'cylinder' && axis.cross === 'y') {
    const RY = 7
    if (size - 2 * RY <= SPAN_MARGIN) return null
    return { lo: lo + RY + 2, hi: lo + size - RY - 2 } // straight E/W walls
  }
  // The slanted family in vertical flow: attachment anywhere on the
  // INTERSECTION of the two flat sides, so one span works for both N and S
  // (trapezoid: top flat [x+i, x+w-i] ∩ bottom flat [x, x+w]; lean-r/lean-l:
  // [x+i, x+w] ∩ [x, x+w-i] — the same [x+i, x+w-i] for all four). Their
  // slanted E/W sides stay port-only via the PORT_EXACT fallback below.
  if (SLANTED.has(node.shape) && axis.cross === 'x') {
    const inset = node.width * SLANT_INSET_RATIO
    if (size - 2 * inset <= SPAN_MARGIN * 2) return null
    return { lo: lo + inset + SPAN_MARGIN, hi: lo + size - inset - SPAN_MARGIN }
  }
  // Asymmetric in vertical flow: both flats span [x+12, x+w] (the flag point
  // only indents the W side). Its pointed/straight E-W pair is port-only.
  if (node.shape === 'asymmetric' && axis.cross === 'x') {
    const POINT_INDENT = 12
    if (size - POINT_INDENT <= SPAN_MARGIN * 2) return null
    return { lo: lo + POINT_INDENT + SPAN_MARGIN, hi: lo + size - SPAN_MARGIN }
  }
  if (PORT_EXACT.has(node.shape)) {
    // Fully curved or pointed on this axis (circle; stadium ends; hexagon
    // tips; cylinder caps): only the exact side-midpoint port is on the
    // outline at the bbox edge.
    const center = lo + size / 2
    return { lo: center - PORT_TOLERANCE, hi: center + PORT_TOLERANCE }
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
  // The slanted family in horizontal flow is port-only (c ≈ cy), so the
  // boundary main coordinate is the slant midpoint — the shapePorts E/W main
  // (x + w - i/2 forward, x + i/2 backward; identical for all four shapes by
  // symmetry). In vertical flow their flats sit at the bbox edge (y / y+h),
  // so the rect default below applies. Asymmetric needs no case at all: its
  // W point (x, cy) and E side (x+w) ARE the bbox extremes.
  if (SLANTED.has(node.shape) && axis.main === 'x') {
    const inset = node.width * SLANT_INSET_RATIO
    return facing * axis.sign > 0 ? mainLo + mainSize - inset / 2 : mainLo + inset / 2
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
  /** Lines per (nodeId:side) — the port-ranking occupancy (see facingSide). */
  sideUse?: Map<string, number>
}

/** The side of a node that faces along `axis` — facing=1 for the side an
 *  edge leaves from, facing=-1 for the side it enters. */
function facingSide(axis: Axis, facing: 1 | -1): PortSide {
  const forward = facing * axis.sign > 0
  return axis.main === 'x' ? (forward ? 'E' : 'W') : (forward ? 'S' : 'N')
}

interface RoutePortEndpointDraft {
  edge: PositionedEdge
  endpoint: 'source' | 'target'
  nodeId: string
  side: PortSide
  role: PortSemanticRole
  coord: number
  edgeIndex: number
  port?: AnyPort
}

export interface RoutePortAllocation {
  byEdge: Map<PositionedEdge, { source?: RoutePortAssignment; target?: RoutePortAssignment }>
  /** Counts only endpoints that compete for the flow-side ranking rules. */
  sideUse: Map<string, number>
}

function facetSides(port: DiamondFacet): [PortSide, PortSide] {
  switch (port) {
    case 'NE': return ['N', 'E']
    case 'SE': return ['S', 'E']
    case 'SW': return ['S', 'W']
    case 'NW': return ['N', 'W']
  }
}

function sideForPort(port: AnyPort | undefined, semanticSide: PortSide): PortSide {
  if (!port) return semanticSide
  if (port === 'N' || port === 'E' || port === 'S' || port === 'W') return port
  const sides = facetSides(port)
  return sides.includes(semanticSide) ? semanticSide : sides[0]
}

function roleAndSide(routeClass: RouteClass, endpoint: 'source' | 'target', axis: Axis): { role: PortSemanticRole; side: PortSide } {
  const source = endpoint === 'source'
  switch (routeClass) {
    case 'feedback': {
      const flipped: Axis = { ...axis, sign: axis.sign === 1 ? -1 : 1 }
      return {
        role: source ? 'feedback-source' : 'feedback-target',
        side: facingSide(flipped, source ? 1 : -1),
      }
    }
    case 'self-loop':
      return {
        role: source ? 'self-loop-source' : 'self-loop-target',
        side: facingSide(axis, source ? 1 : -1),
      }
    case 'container':
      return {
        role: source ? 'container-source' : 'container-target',
        side: facingSide(axis, source ? 1 : -1),
      }
    case 'cross-hierarchy':
      return {
        role: source ? 'cross-hierarchy-source' : 'cross-hierarchy-target',
        side: facingSide(axis, source ? 1 : -1),
      }
    default:
      return {
        role: source ? 'flow-source' : 'flow-target',
        side: facingSide(axis, source ? 1 : -1),
      }
  }
}

function sideOrderCoordinate(side: PortSide, node: PositionedNode, point: Point | undefined): number {
  if (point) return side === 'N' || side === 'S' ? point.x : point.y
  return side === 'N' || side === 'S' ? node.x + node.width / 2 : node.y + node.height / 2
}

/**
 * Dynamic port allocator: for every node endpoint, record the physical side,
 * deterministic slot order along that side, and semantic role (flow emit,
 * feedback return, container attach, etc.). `sourcePort`/`targetPort` remain
 * the exact V1 port vocabulary; this side/slot/role layer is additive and can
 * be fed into pre-layout placement without reinterpreting those exact ports.
 */
export function allocateRoutePorts(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[] },
  graph: MermaidGraph,
  classes: RouteClass[] = classifyRoutes(graph),
): RoutePortAllocation {
  const axis = axisFor(graph.direction)
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  const drafts: RoutePortEndpointDraft[] = []
  const sideUse = new Map<string, number>()
  const bumpSideUse = (nodeId: string, side: PortSide) => {
    const key = `${nodeId}:${side}`
    sideUse.set(key, (sideUse.get(key) ?? 0) + 1)
  }

  for (const edge of positioned.edges) {
    if (edge.edgeIndex === undefined) continue
    const routeClass = classes[edge.edgeIndex] ?? 'primary-forward'
    for (const endpoint of ['source', 'target'] as const) {
      const nodeId = endpoint === 'source' ? edge.source : edge.target
      const node = nodeMap.get(nodeId)
      if (!node) continue
      const { role, side: semanticSide } = roleAndSide(routeClass, endpoint, axis)
      const point = endpoint === 'source' ? edge.points[0] : edge.points[edge.points.length - 1]
      const port = point ? portAt(node, point) : undefined
      const side = sideForPort(port, semanticSide)
      const competes = routeClass === 'primary-forward' || (routeClass === 'feedback' && !edge.label)
      if (competes) bumpSideUse(nodeId, semanticSide)
      drafts.push({
        edge,
        endpoint,
        nodeId,
        side,
        role,
        coord: sideOrderCoordinate(side, node, point),
        edgeIndex: edge.edgeIndex,
        port,
      })
    }
  }

  const groups = new Map<string, RoutePortEndpointDraft[]>()
  for (const draft of drafts) {
    const key = `${draft.nodeId}:${draft.side}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(draft)
  }

  const byEdge = new Map<PositionedEdge, { source?: RoutePortAssignment; target?: RoutePortAssignment }>()
  const endpointRank = (endpoint: 'source' | 'target') => endpoint === 'source' ? 0 : 1
  for (const group of groups.values()) {
    group.sort((a, b) =>
      a.coord - b.coord || a.edgeIndex - b.edgeIndex || endpointRank(a.endpoint) - endpointRank(b.endpoint))
    const slotCount = group.length
    group.forEach((draft, slotIndex) => {
      const assignment: RoutePortAssignment = {
        side: draft.side,
        slotIndex,
        slotCount,
        role: draft.role,
        ...(draft.port ? { port: draft.port } : {}),
      }
      const entry = byEdge.get(draft.edge) ?? {}
      entry[draft.endpoint] = assignment
      byEdge.set(draft.edge, entry)
    })
  }

  return { byEdge, sideUse }
}

/** Port-ranking sharpness: a diamond's vertex is the strongest anchor. */
function portSharpness(shape: PositionedNode['shape']): number {
  return shape === 'diamond' ? 2 : 1
}

function portPoint(node: PositionedNode, side: PortSide | DiamondFacet): Point {
  if (node.shape === 'diamond' && (side === 'NE' || side === 'SE' || side === 'SW' || side === 'NW')) {
    return diamondFacetPorts(node)[side]
  }
  return shapePorts(node)[side as PortSide]
}

function repairRectLikeEndpointOverflow(edge: PositionedEdge, node: PositionedNode, isStart: boolean): void {
  if (!RECT_LIKE.has(node.shape) || edge.points.length < 2) return
  const idx = isStart ? 0 : edge.points.length - 1
  const p = edge.points[idx]!
  const x0 = node.x
  const x1 = node.x + node.width
  const y0 = node.y
  const y1 = node.y + node.height
  const near = (a: number, b: number) => Math.abs(a - b) <= PORT_TOLERANCE
  const pushStub = (outline: Point, stub: Point) => {
    edge.points[idx] = outline
    if (Math.abs(outline.x - stub.x) <= EPS && Math.abs(outline.y - stub.y) <= EPS) return
    if (isStart) {
      const next = edge.points[1]
      if (!next || Math.abs(next.x - stub.x) > EPS || Math.abs(next.y - stub.y) > EPS) edge.points.splice(1, 0, stub)
    } else {
      const prev = edge.points[edge.points.length - 2]
      if (!prev || Math.abs(prev.x - stub.x) > EPS || Math.abs(prev.y - stub.y) > EPS) edge.points.splice(edge.points.length - 1, 0, stub)
    }
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

function diamondSpreadPortSet(axis: Axis, count: number): Array<PortSide | DiamondFacet> | null {
  if (axis.main === 'x') {
    if (axis.sign > 0) {
      if (count === 2) return ['NE', 'SE']
      if (count === 3) return ['NE', 'E', 'SE']
    } else {
      if (count === 2) return ['NW', 'SW']
      if (count === 3) return ['NW', 'W', 'SW']
    }
  } else if (axis.sign > 0) {
    if (count === 2) return ['SW', 'SE']
    if (count === 3) return ['SW', 'S', 'SE']
  } else {
    if (count === 2) return ['NW', 'NE']
    if (count === 3) return ['NW', 'N', 'NE']
  }
  return null
}

interface DiamondSpreadAssignment {
  sourcePort: PortSide | DiamondFacet
  sourceLane: number
}

function diamondSpreadAssignment(
  edge: PositionedEdge,
  source: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): DiamondSpreadAssignment | null {
  if (source.shape !== 'diamond' || edge.edgeIndex === undefined || ctx.classes?.[edge.edgeIndex] !== 'primary-forward') {
    return null
  }
  const nodeMap = new Map(ctx.nodes.map(node => [node.id, node]))
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
  return { sourcePort, sourceLane: portPoint(source, sourcePort)[axis.cross] }
}

function diamondSpreadLane(
  edge: PositionedEdge,
  source: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): number | undefined {
  return diamondSpreadAssignment(edge, source, ctx, axis)?.sourceLane
}

function diamondSpreadTargetsShareRank(
  edge: PositionedEdge,
  source: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): boolean {
  if (source.shape !== 'diamond' || edge.edgeIndex === undefined || ctx.classes?.[edge.edgeIndex] !== 'primary-forward') {
    return false
  }
  const nodeMap = new Map(ctx.nodes.map(node => [node.id, node]))
  const siblings = ctx.edges.filter(candidate => candidate.source === edge.source &&
    candidate.edgeIndex !== undefined &&
    ctx.classes?.[candidate.edgeIndex] === 'primary-forward' &&
    nodeMap.has(candidate.target))
  if (!diamondSpreadPortSet(axis, siblings.length)) return false
  const targetMains = siblings.map(candidate => {
    const target = nodeMap.get(candidate.target)!
    return target[axis.main] + (axis.main === 'x' ? target.width : target.height) / 2
  })
  return Math.max(...targetMains) - Math.min(...targetMains) <= 1
}

interface DiamondSpreadTargetPortConstraint {
  sourcePort: PortSide | DiamondFacet
  sourceLane: number
  targetPort: PortSide
  targetLane: number
}

function diamondSpreadTargetPortConstraint(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  ctx: LaneContext,
  axis: Axis,
): DiamondSpreadTargetPortConstraint | null {
  const spread = diamondSpreadAssignment(edge, source, ctx, axis)
  if (!spread || !diamondSpreadTargetsShareRank(edge, source, ctx, axis)) return null
  const targetPort = facingSide(axis, -1)
  const targetLane = shapePorts(target)[targetPort][axis.cross]
  if (Math.abs(spread.sourceLane - targetLane) <= PORT_TOLERANCE) return null
  return { ...spread, targetPort, targetLane }
}

function satisfiesDiamondSpreadTargetPortConstraint(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  constraint: DiamondSpreadTargetPortConstraint,
): boolean {
  if (edge.points.length <= 2) return false
  const start = edge.points[0]!
  const end = edge.points[edge.points.length - 1]!
  const sourcePort = portPoint(source, constraint.sourcePort)
  const targetPort = shapePorts(target)[constraint.targetPort]
  return Math.abs(start.x - sourcePort.x) <= PORT_TOLERANCE &&
    Math.abs(start.y - sourcePort.y) <= PORT_TOLERANCE &&
    Math.abs(end.x - targetPort.x) <= PORT_TOLERANCE &&
    Math.abs(end.y - targetPort.y) <= PORT_TOLERANCE
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

export function labelRect(e: PositionedEdge, style: LabelMetricsStyle): { x: number; y: number; w: number; h: number } | null {
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
  axis: Axis = ctx.axis,
): RouteBlocker[] {
  const blockers: RouteBlocker[] = []
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
    // two lines visually ("channel" conflict). Perpendicular crossings are
    // fine. Exception: two edges into the SAME target may converge exactly
    // collinearly at the shared target port — the classic flowchart fan-in
    // merge, where the final approaches draw as one line into one arrowhead.
    for (let i = 1; i < other.points.length; i++) {
      const a = other.points[i - 1]!, b = other.points[i]!
      if (Math.abs(a[axis.cross] - b[axis.cross]) > EPS) continue
      if (Math.abs(a[axis.cross] - c) >= CLEARANCE) continue
      const sLo = Math.min(a[axis.main], b[axis.main])
      const sHi = Math.max(a[axis.main], b[axis.main])
      if (overlaps(mainLo, mainHi, sLo, sHi)) {
        if (other.target === edge.target && other.source !== edge.source &&
          Math.abs(a[axis.cross] - c) < EPS && i === other.points.length - 1) {
          continue
        }
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
export function findLabelSlot(
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

  const slotClear = (cx: number, cy: number): boolean => {
    const pill = pillRect(cx, cy, m)
    for (const node of ctx.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      if (rectsOverlap(pill.x, pill.y, pill.w, pill.h, node.x, node.y, node.width, node.height)) return false
    }
    for (const other of ctx.edges) {
      if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
      const rect = isMovableReciprocalLabel(edge, other, ctx) ? null : labelRect(other, ctx.style)
      if (rect && rectsOverlap(pill.x, pill.y, pill.w, pill.h, rect.x, rect.y, rect.w, rect.h)) return false
      for (let i = 1; i < other.points.length; i++) {
        const a = other.points[i - 1]!, b = other.points[i]!
        const sxLo = Math.min(a.x, b.x), sxHi = Math.max(a.x, b.x)
        const syLo = Math.min(a.y, b.y), syHi = Math.max(a.y, b.y)
        if (rectsOverlap(pill.x, pill.y, pill.w, pill.h, sxLo, syLo, sxHi - sxLo, syHi - syLo)) return false
      }
    }
    return true
  }

  // Discrete candidate positions along the lane (Kakoulis–Tollis candidate
  // sets), center-out: the midpoint reads best, the outer slots rescue lanes
  // whose middle band is occupied by a neighboring node or pill.
  for (const t of [0.5, 1 / 3, 2 / 3, 0.25, 0.75, 1 / 6, 5 / 6]) {
    const cx = start.x + (end.x - start.x) * t
    const cy = start.y + (end.y - start.y) * t
    if (slotClear(cx, cy)) return { x: cx, y: cy }
  }
  return null
}

/** Strict-interior intersection of two segments (touching endpoints don't count). */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
  if (Math.abs(det) < 1e-9) return false
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999
}

/** Crossings between a candidate route and every other edge's segments. */
function countRouteCrossings(points: Point[], edge: PositionedEdge, ctx: LaneContext): number {
  let count = 0
  for (const other of ctx.edges) {
    if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
    for (let i = 1; i < points.length; i++) {
      for (let j = 1; j < other.points.length; j++) {
        if (segmentsIntersect(points[i - 1]!, points[i]!, other.points[j - 1]!, other.points[j]!)) count++
      }
    }
  }
  return count
}

/**
 * Conservative check that a route passes through some non-incident node's
 * bbox interior — the signature of a stale path after a later pass moved a
 * node into an already-routed corridor (issue #25 rule 9). Used only to
 * TRIGGER a proof-gated repair; the repair's own checks are shape-exact.
 */
function routeThroughNodeBBox(edge: PositionedEdge, ctx: LaneContext): boolean {
  for (const node of ctx.nodes) {
    if (node.id === edge.source || node.id === edge.target) continue
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!
      const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
      const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
      if (xHi > node.x + 0.5 && xLo < node.x + node.width - 0.5 &&
        yHi > node.y + 0.5 && yLo < node.y + node.height - 0.5) {
        return true
      }
    }
  }
  return false
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
function tryStraighten(
  edge: PositionedEdge,
  source: PositionedNode,
  target: PositionedNode,
  ctx: LaneContext,
  axis: Axis = ctx.axis,
  restrictToLane?: number,
): StraightenAttempt {
  const srcSpan = attachSpan(source, axis)
  const tgtSpan = attachSpan(target, axis)
  if (!srcSpan || !tgtSpan) return { applied: false, blockers: [] }

  const overlapLo = Math.max(srcSpan.lo, tgtSpan.lo)
  const overlapHi = Math.min(srcSpan.hi, tgtSpan.hi)
  // Port lanes (through a side-midpoint port) may attach the OTHER endpoint
  // closer to a diamond vertex than the aesthetic margin normally allows:
  // exact connection points outrank the margin (yFiles port-candidate costs).
  const relax = (node: PositionedNode, span: CrossSpan): CrossSpan => {
    if (node.shape !== 'diamond') return span
    return { lo: node[axis.cross] + 2, hi: node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) - 2 }
  }
  const relaxedLo = Math.max(relax(source, srcSpan).lo, relax(target, tgtSpan).lo)
  const relaxedHi = Math.min(relax(source, srcSpan).hi, relax(target, tgtSpan).hi)
  const portCross = (node: PositionedNode) => node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) / 2
  const isPortLane = (c: number) =>
    Math.abs(c - portCross(target)) <= PORT_TOLERANCE || Math.abs(c - portCross(source)) <= PORT_TOLERANCE
  if (relaxedLo > relaxedHi) {
    return { applied: false, blockers: [{ kind: 'span', id: edgeId(edge) }] }
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
  const emitFromVertex = source.shape === 'diamond' && srcSideUse === 1 &&
    portSharpness(source.shape) >= portSharpness(target.shape)
  // A reciprocal pair (A->B with an unlabeled B->A partner) renders as TWO
  // EQUAL parallel lines straddling the centerline at center ± SEP/2 —
  // equal deviation gives equal lengths (a diamond's facet width depends on
  // the lane's distance from the vertex), the way dot offsets reciprocal
  // splines symmetrically about the spine. The primary takes the low side,
  // the feedback the high side: deterministic and never colliding.
  const reciprocal = ctx.classes && ctx.edges.some(other =>
    other !== edge && other.source === edge.target && other.target === edge.source &&
    !other.label && !edge.label &&
    other.edgeIndex !== undefined && edge.edgeIndex !== undefined)
  // A reciprocal pair BETWEEN TWO DIAMONDS (G) parts at the NEAREST facet-mids
  // rather than the generic center ± SEP/2: the two parallel lines run between
  // the diamonds' facets (never through a vertex). The primary takes the
  // upper facet (NE source-mid for an LR exit), the feedback the lower (SW);
  // the cross offset is the source diamond's own facet-mid offset (size/4), so
  // its endpoint lands exactly on a facet-mid. The target end anchors on its
  // facing facet at the same lane (on-outline, the partner's nearest mid).
  const recipDiamond = reciprocal && source.shape === 'diamond' && target.shape === 'diamond'
  if (restrictToLane !== undefined) {
    candidates.push(restrictToLane)
  } else if (recipDiamond) {
    const own = ctx.classes![edge.edgeIndex!] === 'feedback' ? 1 : -1
    const srcCenter = source[axis.cross] + (axis.cross === 'y' ? source.height : source.width) / 2
    const srcFacetOffset = (axis.cross === 'y' ? source.height : source.width) / 4
    push(srcCenter + own * srcFacetOffset)
    push((overlapLo + overlapHi) / 2 + own * PAIR_SEPARATION / 2)
    push(tgtPortLane)
    push(srcPortLane)
  } else if (reciprocal) {
    const pairCenter = (overlapLo + overlapHi) / 2
    const own = ctx.classes![edge.edgeIndex!] === 'feedback' ? 1 : -1
    push(pairCenter + own * PAIR_SEPARATION / 2)
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
    push(edge.points[edge.points.length - 1]![axis.cross])
    push(edge.points[0]![axis.cross])
    const crossValues = edge.points.map(p => p[axis.cross])
    push(Math.min(...crossValues))
    push(Math.max(...crossValues))
    push((overlapLo + overlapHi) / 2)
    // Span quartiles: an unlabeled feedback loop's own cross values all sit
    // on the forward lane or outside the span, so the parallel back-lane
    // that collapses it to the classic two-arrow rendering lies between the
    // span center and a span end.
    push((overlapLo + (overlapLo + overlapHi) / 2) / 2)
    push(((overlapLo + overlapHi) / 2 + overlapHi) / 2)
  }

  const blockers: RouteBlocker[] = []
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const c = candidates[candidateIndex]!
    const lo = isPortLane(c) ? relaxedLo : overlapLo
    const hi = isPortLane(c) ? relaxedHi : overlapHi
    if (c < lo - EPS || c > hi + EPS) {
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
    const found = directLaneBlockers(edge, c, mainLo, mainHi, ctx, axis)
    if (found.length > 0) {
      blockers.push(...found)
      continue
    }
    const start: Point = axis.main === 'x' ? { x: srcMain, y: c } : { x: c, y: srcMain }
    const end: Point = axis.main === 'x' ? { x: tgtMain, y: c } : { x: c, y: tgtMain }
    // A repair may never increase edge crossings: a perpendicular crossing is
    // legal when the router chose it, but the straightener must not create
    // one that the original route avoided.
    if (countRouteCrossings([start, end], edge, ctx) > countRouteCrossings(edge.points, edge, ctx)) {
      blockers.push({ kind: 'crossing', id: edgeId(edge) })
      continue
    }
    const slot = findLabelSlot(edge, start, end, ctx)
    if (slot === null) {
      blockers.push({ kind: 'label', id: edgeId(edge) })
      continue
    }
    edge.points = [start, end]
    if (edge.label) edge.labelPosition = slot
    return { applied: true, blockers: [], usedCandidateIndex: candidateIndex }
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
  const groupMap = flattenGroups(positioned.groups)
  // Port-ranking occupancy: how many lines each facing side will carry.
  // Derived by the dynamic port allocator, but intentionally counted on the
  // semantic facing side (primary flow sides; unlabeled feedback flipped
  // sides) so routing behavior stays independent of the current, possibly
  // not-yet-repaired endpoint coordinates.
  const sideUse = allocateRoutePorts(positioned, graph, classes).sideUse
  for (const edge of bundled) {
    if (edge.edgeIndex === undefined) continue
    const cls = classes[edge.edgeIndex]
    if (cls !== 'primary-forward' && !(cls === 'feedback' && !edge.label)) continue
    const sourceSide = cls === 'feedback'
      ? facingSide({ ...axis, sign: axis.sign === 1 ? -1 : 1 }, 1)
      : facingSide(axis, 1)
    const targetSide = cls === 'feedback'
      ? facingSide({ ...axis, sign: axis.sign === 1 ? -1 : 1 }, -1)
      : facingSide(axis, -1)
    for (const [nodeId, side] of [[edge.source, sourceSide], [edge.target, targetSide]] as const) {
      const key = `${nodeId}:${side}`
      const next = (sideUse.get(key) ?? 0) - 1
      if (next > 0) sideUse.set(key, next)
      else sideUse.delete(key)
    }
  }
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style, classes, sideUse }
  const drafts: Array<{ edge: PositionedEdge; cert: DraftRouteCertificate }> = []

  // Attempt one proof-carrying straightening; updates geometry + certificate.
  // `applied` means the route is straight; `mutated` means geometry moved this
  // call; `upgradeable` means a non-preferred lane won, so the edge stays in
  // the fixed-point pool — a later repair may free the preferred lane (e.g.
  // the symmetric lane of a reciprocal pair blocked by its partner's
  // not-yet-repaired geometry).
  const attemptStraighten = (
    edge: PositionedEdge,
    cert: DraftRouteCertificate,
  ): { applied: boolean; mutated: boolean; upgradeable?: boolean } => {
    const edgeAxis: Axis = cert.routeClass === 'feedback' ? { ...axis, sign: axis.sign === 1 ? -1 : 1 } : axis
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    // Feedback loops from ELK's feedbackEdges routing start by moving AWAY
    // from the target (around the nodes), so they are never monotone; the
    // lane proof alone gates whether they may collapse onto a parallel
    // back-lane. Primary edges keep the monotone gate.
    const eligible = source && target &&
      isStraightenable(source.shape) &&
      isStraightenable(target.shape) &&
      (cert.routeClass === 'feedback' || isMonotoneStaircase(edge.points, edgeAxis))
    if (!eligible) {
      cert.invariant = feedbackDetourKind(edge, cert.routeClass, source, target, ctx.axis) ?? 'unverified-shape'
      return { applied: false, mutated: false }
    }
    // Port ranking, hard case: a diamond side carrying exactly ONE line
    // always emits from its vertex (the user-facing convention dot and
    // yFiles follow). If no straight lane through the vertex exists, a
    // 2-bend Z from the vertex into the target's port still outranks a
    // straight lane that floats off the vertex.
    const srcSideUse = ctx.sideUse?.get(`${source!.id}:${facingSide(edgeAxis, 1)}`) ?? 1
    const emitFromVertex = cert.routeClass === 'primary-forward' &&
      source!.shape === 'diamond' && srcSideUse === 1 &&
      portSharpness(source!.shape) >= portSharpness(target!.shape)
    const beforeGeometry = JSON.stringify(edge.points)
    if (emitFromVertex) {
      const vertexLane = source![edgeAxis.cross] + (edgeAxis.cross === 'y' ? source!.height : source!.width) / 2
      const direct = tryStraighten(edge, source!, target!, ctx, edgeAxis, vertexLane)
      if (direct.applied) {
        const mutated = JSON.stringify(edge.points) !== beforeGeometry
        cert.invariant = 'straight'
        cert.bendCount = 0
        cert.directLaneClear = true
        if (mutated) cert.straightened = true
        cert.directLaneBlockedBy = undefined
        return { applied: true, mutated }
      }
      // Next-best after the straight vertex lane: the 1-bend hook into the
      // target's facing cross-side port; the 2-bend Z into the flow-side
      // port only when no hook exists.
      if (tryVertexHook(edge, source!, target!, ctx, edgeAxis) ||
        tryZRoute(edge, source!, target!, ctx, edgeAxis, true)) {
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
    if (portConstraint &&
      tryZRoute(edge, source!, target!, ctx, edgeAxis, false, {
        sourceLane: portConstraint.sourceLane,
        targetLane: portConstraint.targetLane,
        preferSourceJog: true,
      })) {
      cert.invariant = 'explained-detour'
      cert.directLaneClear = false
      cert.directLaneBlockedBy = [{ kind: 'port', id: edgeId(edge) }]
      cert.bendCount = bendCount(edge.points)
      return { applied: false, mutated: JSON.stringify(edge.points) !== beforeGeometry }
    }
    const attempt = tryStraighten(edge, source!, target!, ctx, edgeAxis)
    if (attempt.applied) {
      const mutated = JSON.stringify(edge.points) !== beforeGeometry
      cert.invariant = 'straight'
      cert.bendCount = 0
      cert.directLaneClear = true
      if (mutated) cert.straightened = true
      cert.directLaneBlockedBy = undefined
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
        mutated = tightenOuterFeedback(edge, ctx)
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
    } else if (cert.invariant === 'explained-detour' &&
      (cert.bendCount > 2 || routeThroughNodeBBox(edge, ctx) ||
        !portAt(source!, edge.points[0]!) ||
        !portAt(target!, edge.points[edge.points.length - 1]!))) {
      // Bend minimization (the Tamassia tradition): when the lane is
      // genuinely blocked, a 2-bend Z that terminates on the target's port
      // still beats ELK's multi-bend staircase. The same repair applies when
      // either endpoint has drifted off its rendered outline. Also triggered
      // whenever the kept route passes through a node — the stale-corridor
      // signature of a later pass moving a node into an already-routed channel.
      // Proof-gated like everything else; failure keeps the explained route.
      if (tryZRoute(edge, source!, target!, ctx, edgeAxis)) {
        cert.bendCount = bendCount(edge.points)
        mutated = true
      }
    }
    return { applied: false, mutated }
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
    forcedLanes?: { sourceLane?: number; targetLane?: number; preferSourceJog?: boolean },
  ): boolean {
    if (edge.points.length < 2) return false
    const srcSpan = attachSpan(source, axis)
    const tgtSpan = attachSpan(target, axis)
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
      pushTo(c2s, target[axis.cross] + (axis.cross === 'y' ? target.height : target.width) / 2)
      pushTo(c2s, edge.points[edge.points.length - 1]![axis.cross])
    }

    const relaxDiamond = (node: PositionedNode, span: CrossSpan): CrossSpan =>
      node.shape === 'diamond'
        ? { lo: node[axis.cross] + 2, hi: node[axis.cross] + (axis.cross === 'y' ? node.height : node.width) - 2 }
        : span
    const s1 = relaxDiamond(source, srcSpan)
    const s2 = relaxDiamond(target, tgtSpan)

    for (const c2 of c2s) {
      if (c2 < s2.lo - EPS || c2 > s2.hi + EPS) continue
      const tgtMain = anchorMain(target, c2, axis, -1)
      for (const c1 of c1s) {
        if (c1 < s1.lo - EPS || c1 > s1.hi + EPS) continue
        if (Math.abs(c1 - c2) < CLEARANCE) continue // that would be a hitch, not a Z
        const srcMain = anchorMain(source, c1, axis, 1)
        if ((tgtMain - srcMain) * axis.sign <= EPS) continue
        const jogs = forcedLanes?.preferSourceJog
          ? [srcMain + axis.sign * 12, (srcMain + tgtMain) / 2, tgtMain - axis.sign * 12]
          : [tgtMain - axis.sign * 12, (srcMain + tgtMain) / 2, srcMain + axis.sign * 12]
        for (const jog of jogs) {
          if ((jog - srcMain) * axis.sign <= EPS || (tgtMain - jog) * axis.sign <= EPS) continue
          // The label rides the longest lane only; the other lane and the
          // hop are proved with a label-stripped probe so the own-label
          // capacity check applies exactly once, where the pill will live.
          const longFirst = Math.abs(jog - srcMain) >= Math.abs(tgtMain - jog)
          const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
          const lane1 = directLaneBlockers(longFirst ? edge : unlabeled, c1, Math.min(srcMain, jog), Math.max(srcMain, jog), ctx, axis)
          if (lane1.length > 0) continue
          const hopAxis: Axis = axis.main === 'x'
            ? { main: 'y', cross: 'x', sign: c1 < c2 ? 1 : -1 }
            : { main: 'x', cross: 'y', sign: c1 < c2 ? 1 : -1 }
          if (directLaneBlockers(unlabeled, jog, Math.min(c1, c2), Math.max(c1, c2), ctx, hopAxis).length > 0) continue
          const lane2 = directLaneBlockers(longFirst ? unlabeled : edge, c2, Math.min(jog, tgtMain), Math.max(jog, tgtMain), ctx, axis)
          if (lane2.length > 0) continue
          const pt = (main: number, cross: number): Point =>
            axis.main === 'x' ? { x: main, y: cross } : { x: cross, y: main }
          const route = [pt(srcMain, c1), pt(jog, c1), pt(jog, c2), pt(tgtMain, c2)]
          // Crossings may not increase — unless the current route passes
          // THROUGH a node (a hard defect, e.g. a later pass moved a node
          // into the routed corridor): a legal crossing always beats an
          // occlusion. The Z itself is lane-proved through clear space.
          if (!routeThroughNodeBBox(edge, ctx) &&
            countRouteCrossings(route, edge, ctx) > countRouteCrossings(edge.points, edge, ctx)) continue
          if (edge.label) {
            const slot = longFirst
              ? findLabelSlot(edge, route[0]!, route[1]!, ctx)
              : findLabelSlot(edge, route[2]!, route[3]!, ctx)
            if (!slot) continue
            edge.labelPosition = slot
          }
          edge.points = route
          return true
        }
      }
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
  function tryVertexHook(
    edge: PositionedEdge,
    source: PositionedNode,
    target: PositionedNode,
    ctx: LaneContext,
    axis: Axis,
  ): boolean {
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
    const mergeAvailable = ctx.edges.some(other => other !== edge &&
      other.target === edge.target && other.source !== edge.source &&
      other.points.length > 0 &&
      Math.abs(other.points[other.points.length - 1]!.x - entryPort.x) <= PORT_TOLERANCE &&
      Math.abs(other.points[other.points.length - 1]!.y - entryPort.y) <= PORT_TOLERANCE)
    if (mergeAvailable) return false
    const portMain = target[axis.main] + (axis.main === 'x' ? target.width : target.height) / 2
    const srcMain = anchorMain(source, lane, axis, 1)
    if ((portMain - srcMain) * axis.sign <= EPS) return false
    // The label rides the lane; the entry stub is proved label-stripped
    // (own-label capacity applies exactly once, where the pill lives).
    const unlabeled: PositionedEdge = { ...edge, points: [], label: undefined }
    if (directLaneBlockers(edge, lane, Math.min(srcMain, portMain), Math.max(srcMain, portMain), ctx, axis).length > 0) return false
    const stubAxis: Axis = axis.main === 'x'
      ? { main: 'y', cross: 'x', sign: lane < entryCross ? 1 : -1 }
      : { main: 'x', cross: 'y', sign: lane < entryCross ? 1 : -1 }
    if (directLaneBlockers(unlabeled, portMain, Math.min(lane, entryCross), Math.max(lane, entryCross), ctx, stubAxis).length > 0) return false
    const pt = (main: number, cross: number): Point =>
      axis.main === 'x' ? { x: main, y: cross } : { x: cross, y: main }
    const route = [pt(srcMain, lane), pt(portMain, lane), pt(portMain, entryCross)]
    if (!routeThroughNodeBBox(edge, ctx) &&
      countRouteCrossings(route, edge, ctx) > countRouteCrossings(edge.points, edge, ctx)) return false
    if (edge.label) {
      const slot = findLabelSlot(edge, route[0]!, route[1]!, ctx)
      if (!slot) return false
      edge.labelPosition = slot
    }
    edge.points = route
    return true
  }

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
  function tightenOuterFeedback(edge: PositionedEdge, ctx: LaneContext): boolean {
    const points = simplifyPolyline(edge.points)
    if (points.length < 4) return false
    const graphAxis = ctx.axis
    const crossOf = (pt: Point) => pt[graphAxis.cross]
    const mainOf = (pt: Point) => pt[graphAxis.main]
    // The outer channel is the run at the route's extreme cross value.
    const crossValues = points.map(crossOf)
    const extremeHi = Math.max(...crossValues)
    const extremeLo = Math.min(...crossValues)
    const startCross = crossOf(points[0]!)
    const extreme = Math.abs(extremeHi - startCross) >= Math.abs(extremeLo - startCross) ? extremeHi : extremeLo
    let runStart = -1
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(crossOf(points[i - 1]!) - extreme) < EPS && Math.abs(crossOf(points[i]!) - extreme) < EPS) {
        runStart = i - 1
        break
      }
    }
    if (runStart < 1) return false // no excursion before the channel run
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
      const hopPoint: Point = graphAxis.main === 'x' ? { x: mainCoord, y: extreme } : { x: extreme, y: mainCoord }
      return Math.abs(fromCross - extreme) < EPS
        ? [hopPoint, ...points.slice(runStart + 1)]
        : [startOnBoundary, hopPoint, ...points.slice(runStart + 1)]
    }

    let tightened: Point[] | null = null
    // Variant 1 — exit via the source's channel-facing PORT: the decision
    // diamond's exact South/North vertex (a rectangle's side midpoint). One
    // short hop from the port to the channel is proven; the run truncation
    // reuses existing, already-proven channel geometry.
    if (source && PORT_EXACT.has(source.shape)) {
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
    if (!tightened && source && (RECT_LIKE.has(source.shape) || source.shape === 'diamond')) {
      const srcCrossLo = source[graphAxis.cross]
      const srcCrossHi = srcCrossLo + (graphAxis.cross === 'y' ? source.height : source.width)
      if (extreme > srcCrossLo + EPS && extreme < srcCrossHi - EPS) {
        const facingRun: 1 | -1 = runDir === graphAxis.sign ? 1 : -1
        const anchorM = anchorMain(source, extreme, graphAxis, facingRun)
        if (inRunRange(anchorM) && hopClear(anchorM, extreme)) {
          const boundary: Point = graphAxis.main === 'x' ? { x: anchorM, y: extreme } : { x: extreme, y: anchorM }
          tightened = buildRoute(anchorM, extreme, boundary)
        }
      }
    }
    // Variant 2 — hop perpendicular from ELK's exit point to the channel.
    if (!tightened && inRunRange(mainOf(p0)) && hopClear(mainOf(p0), crossOf(p0))) {
      tightened = buildRoute(mainOf(p0), crossOf(p0), p0)
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
      if (rs >= 0 && rs + 1 < base.length - 1 && target && PORT_EXACT.has(target.shape)) {
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
          const runEndAtPort: Point = graphAxis.main === 'x' ? { x: portMain, y: extreme } : { x: extreme, y: portMain }
          tightened = [...base.slice(0, rs + 1), runEndAtPort, port]
          tailApplied = true
        }
      }
    }
    if (!tightened) return false
    // Same rule as straightening: tightening may never increase crossings.
    if (countRouteCrossings(simplifyPolyline(tightened), edge, ctx) > countRouteCrossings(edge.points, edge, ctx)) return false
    const before = edge.points
    edge.points = simplifyPolyline(tightened)
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
          edge.points = before // no honest label slot on the tightened loop: keep ELK's
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
  function feedbackDetourKind(
    edge: PositionedEdge,
    routeClass: RouteClass,
    source: PositionedNode | undefined,
    target: PositionedNode | undefined,
    graphAxis: Axis,
  ): RouteInvariant | null {
    if (routeClass !== 'feedback') return null
    if (!source || !target) return 'feedback-detour'
    const crossSize = (n: PositionedNode) => graphAxis.cross === 'y' ? n.height : n.width
    const bandLo = Math.min(source[graphAxis.cross], target[graphAxis.cross]) - 2
    const bandHi = Math.max(source[graphAxis.cross] + crossSize(source), target[graphAxis.cross] + crossSize(target)) + 2
    const escapes = edge.points.some(pt => pt[graphAxis.cross] < bandLo || pt[graphAxis.cross] > bandHi)
    return escapes ? 'outer-feedback' : 'feedback-detour'
  }

  const retry: Array<{ edge: PositionedEdge; cert: DraftRouteCertificate }> = []
  for (const edge of positioned.edges) {
    edge.points = simplifyPolyline(orthogonalizeResidualDiagonals(edge.points))

    const edgeIndex = edge.edgeIndex ?? -1
    const routeClass: RouteClass = classes[edgeIndex] ?? 'primary-forward'
    const cert: DraftRouteCertificate = {
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
      if (tryRepairContainerEdge(edge, groupMap, nodeMap, ctx)) {
        cert.bendCount = 0
        cert.directLaneClear = true
        cert.straightened = true
      }
    } else if (routeClass === 'primary-forward' || routeClass === 'feedback') {
      if (cert.bendCount > 0) {
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
        const reciprocal = !edge.label && edge.edgeIndex !== undefined &&
          positioned.edges.some(other => other !== edge &&
            other.source === edge.target && other.target === edge.source &&
            !other.label && other.edgeIndex !== undefined)
        if (sourceNode && targetNode &&
          (!portAt(sourceNode, edge.points[0]!) || !portAt(targetNode, edge.points[edge.points.length - 1]!) ||
            routeThroughNodeBBox(edge, ctx) || reciprocal)) {
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
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (sourceNode) repairRectLikeEndpointOverflow(edge, sourceNode, true)
    if (targetNode) repairRectLikeEndpointOverflow(edge, targetNode, false)
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
  // And mirror the port-ranking occupancy so the prover applies the same
  // vertex-emit policy (a deliberate vertex Z is not a hitch).
  const sideUse = new Map<string, number>()
  const bumpSide = (nodeId: string, side: PortSide) => {
    const key = `${nodeId}:${side}`
    sideUse.set(key, (sideUse.get(key) ?? 0) + 1)
  }
  for (const e of positioned.edges) {
    const cls = e.routeCertificate?.routeClass
    if (cls === 'primary-forward') {
      bumpSide(e.source, facingSide(axis, 1))
      bumpSide(e.target, facingSide(axis, -1))
    } else if (cls === 'feedback' && !e.label) {
      const flipped: Axis = { ...axis, sign: axis.sign === 1 ? -1 : 1 }
      bumpSide(e.source, facingSide(flipped, 1))
      bumpSide(e.target, facingSide(flipped, -1))
    }
  }
  const ctx: LaneContext = { nodes: positioned.nodes, edges: positioned.edges, axis, style, classes, sideUse }
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
    if (!isStraightenable(source.shape)) continue
    if (!isStraightenable(target.shape)) continue
    if (cert.routeClass !== 'feedback' && !isMonotoneStaircase(points, edgeAxis)) continue
    const portConstraint = diamondSpreadTargetPortConstraint(edge, source, target, ctx, edgeAxis)
    if (portConstraint && satisfiesDiamondSpreadTargetPortConstraint(edge, source, target, portConstraint)) continue
    // Vertex-emit edges (single-line diamond side) bend deliberately when no
    // straight vertex lane exists; their probe is restricted to that lane.
    const srcSideUse = sideUse.get(`${edge.source}:${facingSide(edgeAxis, 1)}`) ?? 1
    const emitFromVertex = cert.routeClass === 'primary-forward' &&
      source.shape === 'diamond' && srcSideUse === 1 &&
      portSharpness(source.shape) >= portSharpness(target.shape)
    const vertexLane = emitFromVertex
      ? source[edgeAxis.cross] + (edgeAxis.cross === 'y' ? source.height : source.width) / 2
      : undefined
    // Probe on a copy so validation never mutates the layout.
    const probe: PositionedEdge = { ...edge, points: points.map(p => ({ ...p })) }
    const attempt = tryStraighten(probe, source, target, ctx, edgeAxis, vertexLane)
    if (attempt.applied) {
      hitches.push({ edge: edgeId(edge), deviationPx: Math.round(crossDeviation(points, edgeAxis) * 10) / 10 })
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
 * standing in as a rectangle. Returns true when the route was repaired.
 */
function tryRepairContainerEdge(
  edge: PositionedEdge,
  groupMap: Map<string, PositionedGroup>,
  nodeMap: Map<string, PositionedNode>,
  ctx: LaneContext,
): boolean {
  const rectFor = (id: string): PositionedNode | null => {
    const group = groupMap.get(id)
    if (group) return { id, label: '', shape: 'rectangle', x: group.x, y: group.y, width: group.width, height: group.height }
    const node = nodeMap.get(id)
    if (node && (RECT_LIKE.has(node.shape) || node.shape === 'diamond')) return node
    return null
  }
  const src = rectFor(edge.source)
  const tgt = rectFor(edge.target)
  if (!src || !tgt) return false

  // Already a straight border-to-border lane: nothing to repair.
  const simplified = simplifyPolyline(edge.points)
  if (simplified.length === 2 &&
    onRectPerimeter(simplified[0]!, src.x, src.y, src.width, src.height, 1) &&
    onRectPerimeter(simplified[1]!, tgt.x, tgt.y, tgt.width, tgt.height, 1)) {
    return false
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
  if (!best) return false

  return tryStraighten(edge, src, tgt, ctx, best.axis).applied
}

// ============================================================================
// Route audit — the remaining issue #25 Phase 1 warning codes. Each check is
// a tripwire: the pipeline upholds these invariants itself, so any finding
// means a later pass broke geometry after certification. All definitions are
// chosen to be zero-noise on the corpus.
// ============================================================================

export type RouteAuditFinding =
  | { code: 'ROUTE_UNEXPLAINED_BEND'; edge: string }
  | { code: 'ROUTE_LABEL_ON_SHARED_TRUNK'; edge: string; sharedWith: string }
  | { code: 'ROUTE_CONTAINER_MISANCHOR'; edge: string; container: string }
  | { code: 'ROUTE_SHAPE_MISANCHOR'; edge: string; node: string }
  | { code: 'ROUTE_STALE_AFTER_NODE_MOVE'; edge: string; node: string }

/** Within `tol` of the rectangle's perimeter (on an edge line, inside its range). */
function onRectPerimeter(p: Point, x: number, y: number, w: number, h: number, tol: number): boolean {
  const onVertical = (Math.abs(p.x - x) <= tol || Math.abs(p.x - (x + w)) <= tol) &&
    p.y >= y - tol && p.y <= y + h + tol
  const onHorizontal = (Math.abs(p.y - y) <= tol || Math.abs(p.y - (y + h)) <= tol) &&
    p.x >= x - tol && p.x <= x + w + tol
  return onVertical || onHorizontal
}

function flattenGroups(groups: PositionedGroup[], out: Map<string, PositionedGroup> = new Map()): Map<string, PositionedGroup> {
  for (const g of groups) {
    out.set(g.id, g)
    flattenGroups(g.children, out)
  }
  return out
}

export function auditRouteContracts(
  positioned: { nodes: PositionedNode[]; edges: PositionedEdge[]; groups: PositionedGroup[] },
  graph: MermaidGraph,
  style: LabelMetricsStyle = resolveRenderStyle({}),
): RouteAuditFinding[] {
  const findings: RouteAuditFinding[] = []
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
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
        const a = edge.points[i - 1]!, b = edge.points[i]!
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
        const inflated = point.x >= node.x - 2 && point.x <= node.x + node.width + 2 &&
          point.y >= node.y - 2 && point.y <= node.y + node.height + 2
        if (!inflated) {
          findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: nodeId })
          continue
        }
        if (node.shape === 'diamond') {
          const dx = Math.abs(point.x - (node.x + node.width / 2)) / (node.width / 2)
          const dy = Math.abs(point.y - (node.y + node.height / 2)) / (node.height / 2)
          if (Math.abs(dx + dy - 1) > 0.03) {
            findings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: id, node: nodeId })
          }
        } else if (RECT_LIKE.has(node.shape)) {
          if (!onRectPerimeter(point, node.x, node.y, node.width, node.height, TOL)) {
            findings.push({ code: 'ROUTE_SHAPE_MISANCHOR', edge: id, node: nodeId })
          }
        }
      }
    }

    // ROUTE_STALE_AFTER_NODE_MOVE also catches the other stale-corridor
    // signature: a non-incident node moved onto an already-certified route.
    // Endpoint detachment above catches moved endpoints; this catches moved
    // obstacles in the middle of a route.
    for (const node of positioned.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
        const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
        if (xHi > node.x + 0.5 && xLo < node.x + node.width - 0.5 &&
          yHi > node.y + 0.5 && yLo < node.y + node.height - 0.5) {
          findings.push({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', edge: id, node: node.id })
          break
        }
      }
    }

    // ROUTE_LABEL_ON_SHARED_TRUNK: a label pill sitting on a piece of line
    // that another edge's collinear segment shares (spec §11.4) — the reader
    // cannot tell which edge the label belongs to.
    if (edge.label && edge.labelPosition) {
      const m = measureMultilineText(edge.label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const pill = pillRect(edge.labelPosition.x, edge.labelPosition.y, m)
      outer: for (const other of positioned.edges) {
        if (other === edge || (edge.edgeIndex !== undefined && other.edgeIndex === edge.edgeIndex)) continue
        for (let i = 1; i < other.points.length; i++) {
          const a = other.points[i - 1]!, b = other.points[i]!
          const vertical = Math.abs(a.x - b.x) < EPS
          const horizontal = Math.abs(a.y - b.y) < EPS
          if (!vertical && !horizontal) continue
          const sxLo = Math.min(a.x, b.x), sxHi = Math.max(a.x, b.x)
          const syLo = Math.min(a.y, b.y), syHi = Math.max(a.y, b.y)
          const hitsPill = sxHi >= pill.x && sxLo <= pill.x + pill.w && syHi >= pill.y && syLo <= pill.y + pill.h
          if (!hitsPill) continue
          // Shared trunk only when one of THIS edge's segments is collinear
          // with the other's segment; a plain perpendicular crossing is not.
          for (let j = 1; j < edge.points.length; j++) {
            const c = edge.points[j - 1]!, d = edge.points[j]!
            const sameAxis = vertical
              ? Math.abs(c.x - d.x) < EPS && Math.abs(c.x - a.x) < CLEARANCE
              : Math.abs(c.y - d.y) < EPS && Math.abs(c.y - a.y) < CLEARANCE
            if (!sameAxis) continue
            const cLo = vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x)
            const cHi = vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x)
            const oLo = vertical ? syLo : sxLo
            const oHi = vertical ? syHi : sxHi
            if (Math.min(cHi, oHi) - Math.max(cLo, oLo) > EPS) {
              findings.push({ code: 'ROUTE_LABEL_ON_SHARED_TRUNK', edge: id, sharedWith: edgeId(other) })
              break outer
            }
          }
        }
      }
    }
  }
  return findings
}
