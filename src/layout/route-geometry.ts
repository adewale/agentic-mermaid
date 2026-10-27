import type { AnyPort, DiamondFacet, Direction, MermaidGraph, Point, PortSemanticRole, PortSide, PositionedEdge, PositionedNode, RouteClass, RoutePortAssignment } from '../types.ts'
import { isOutwardShapeApproach } from '../shape-clipping.ts'
import { pointOnShapeSide, shapeCardinalPorts, shapeRoutingProfile } from '../shape-outline.ts'
import { renderedEndpointContact } from '../rendered-endpoint-diagnostics.ts'

/** Two coordinates within this distance are the same point. */
export const EPS = 0.01
/** Obstacle bounding boxes are inflated by this much when proving a lane clear. */
export const CLEARANCE = 4
/** Required free space around a label hosted on a straightened lane. */
export const LABEL_CLEARANCE = 8

/** Shapes whose forward-facing side is a straight axis-aligned segment.
 *  Fork/join bars are plain (rounded) rectangles geometrically, which is what
 *  lets incoming/outgoing lanes attach anywhere along the bar — "the bar
 *  spans its lanes" by construction. */
export const RECT_LIKE = new Set(['rectangle', 'service', 'rounded', 'subroutine', 'state-fork', 'state-join'])

/**
 * Shapes whose four canonical ports (bbox side midpoints — see PortSide) lie
 * exactly on the rendered outline: symmetric shapes inscribed in their bbox.
 * Rect-likes additionally accept attachment anywhere on a side (dynamic
 * glue); diamonds anywhere on a facet; the rest are port-only.
 */
export const PORT_EXACT = new Set([
  ...RECT_LIKE,
  'diamond',
  'circle',
  'ellipse',
  'doublecircle',
  'stadium',
  'hexagon',
  'cylinder',
  'state-start',
  'state-end',
  // State pseudostates: choice is an inscribed diamond, history an inscribed
  // circle — their bbox side midpoints lie exactly on the outline.
  'state-choice',
  'state-history',
  // The slanted family: their N/S ports sit on flat bbox-edge regions and
  // their E/W ports move inward onto the slant midpoints (see shapePorts).
  'trapezoid',
  'trapezoid-alt',
  'asymmetric',
  'lean-r',
  'lean-l',
])

/** Tolerance for recognizing an endpoint as sitting on a port. */
export const PORT_TOLERANCE = 0.5

/** Cross-axis distance between the two lines of a reciprocal pair. */
export const PAIR_SEPARATION = 12

/** Minimum length of a vertex hook's entry stub (the perpendicular segment
 *  into the target's facing port) — shorter reads as a hitch, not an entry. */
export const HOOK_STUB_MIN = 8

/** The four canonical connection points. Their cross coordinate stays on the
 * node centerline, while their main coordinate comes from the same production
 * outline authority used by paint and clipping. */
export function shapePorts(node: PositionedNode): Record<PortSide, Point> {
  return shapeCardinalPorts(node)
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
export function portAt(node: PositionedNode, pt: Point): AnyPort | undefined {
  const profile = shapeRoutingProfile(node)
  if (profile.boundary.kind === 'envelope' || profile.boundary.kind === 'none') return undefined
  const ports = shapePorts(node)
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    if (Math.abs(ports[side].x - pt.x) <= PORT_TOLERANCE && Math.abs(ports[side].y - pt.y) <= PORT_TOLERANCE) return side
  }
  if (hasFacetAttachments(node)) {
    const facets = diamondFacetPorts(node)
    for (const f of ['NE', 'SE', 'SW', 'NW'] as const) {
      if (Math.abs(facets[f].x - pt.x) <= PORT_TOLERANCE && Math.abs(facets[f].y - pt.y) <= PORT_TOLERANCE) return f
    }
  }
  return undefined
}

/** Count terminal shafts that approach an exact outline from inside or along
 * its boundary. Position alone cannot prove a usable attachment: a horizontal
 * shaft ending at a rectangle's north port is tangent to its painted border.
 * Conservative envelopes have no exact approach proof and are excluded. */
export function invalidEndpointApproaches(edge: PositionedEdge, source?: PositionedNode, target?: PositionedNode): number {
  let invalid = 0
  for (const [node, start] of [
    [source, true],
    [target, false],
  ] as const) {
    if (!node) continue
    const profile = shapeRoutingProfile(node)
    if (profile.boundary.kind === 'envelope' || profile.boundary.kind === 'none') continue
    const points = start ? edge.points : [...edge.points].reverse()
    const end = points[0]
    const adjacent = end && points.find(point => Math.hypot(point.x - end.x, point.y - end.y) > EPS)
    if (!end || !adjacent) {
      invalid++
      continue
    }
    const dx = adjacent.x - end.x,
      dy = adjacent.y - end.y
    if (Math.abs(dx) > EPS && Math.abs(dy) > EPS) continue // the diagonal metric owns this case
    if (!isOutwardShapeApproach(node, end, adjacent, PORT_TOLERANCE)) invalid++
  }
  return invalid
}

/** Remove a shaft that runs along its own node border before leaving it.
 * Keeping the last boundary point preserves the outward segment, while a
 * second clip of the tangent run can reverse it through the node instead. */
export function trimBoundaryEndpointRuns(edge: PositionedEdge, source?: PositionedNode, target?: PositionedNode): void {
  for (const [node, start] of [
    [source, true],
    [target, false],
  ] as const) {
    if (!node) continue
    const profile = shapeRoutingProfile(node)
    if (profile.boundary.kind === 'envelope' || profile.boundary.kind === 'none') continue
    while (edge.points.length > 2) {
      const points = start ? edge.points : [...edge.points].reverse()
      const [end, next] = points
      const middle = { x: (end!.x + next!.x) / 2, y: (end!.y + next!.y) / 2 }
      if (![end!, next!, middle].every(point => renderedEndpointContact(node, point, EPS).onBoundary)) break
      const candidate = { ...edge, points: start ? edge.points.slice(1) : edge.points.slice(0, -1) }
      if (invalidEndpointApproaches(candidate, start ? node : undefined, start ? undefined : node) !== 0) break
      edge.points = candidate.points
    }
  }
}

/** Straightenable: rect-likes and diamonds anywhere on a side/facet; other
 *  PORT_EXACT shapes only through their exact ports. */
export function isStraightenable(node: PositionedNode): boolean {
  const boundary = shapeRoutingProfile(node).boundary
  return boundary.kind !== 'envelope' && boundary.kind !== 'none'
}

export function hasFacetAttachments(node: PositionedNode): boolean {
  const profile = shapeRoutingProfile(node)
  return profile.boundary.kind === 'polygon' && (['N', 'E', 'S', 'W'] as const).every(side => profile.sides[side].kind === 'dynamic')
}

export interface LabelMetricsStyle {
  edgeLabelFontSize: number
  edgeLabelFontWeight: number
  edgeTextTransform?: 'uppercase' | 'lowercase' | 'capitalize'
  edgeLetterSpacing?: number
  lineWidth?: number
  edgeStrokeColor?: string
  edgeBendRadius?: number
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
    const cls: RouteClass = reaches(edge.target, edge.source) ? 'feedback' : (scopeOf.get(edge.source) ?? '') !== (scopeOf.get(edge.target) ?? '') ? 'cross-hierarchy' : 'primary-forward'
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

export interface Axis {
  main: 'x' | 'y'
  cross: 'x' | 'y'
  /** +1 when forward flow increases the main coordinate. */
  sign: 1 | -1
}

export function axisFor(direction: Direction): Axis {
  switch (direction) {
    case 'LR':
      return { main: 'x', cross: 'y', sign: 1 }
    case 'RL':
      return { main: 'x', cross: 'y', sign: -1 }
    case 'BT':
      return { main: 'y', cross: 'x', sign: -1 }
    default:
      return { main: 'y', cross: 'x', sign: 1 } // TD / TB
  }
}

function orthogonalTurn(a: Point, b: Point, c: Point): boolean {
  return a.x !== c.x && a.y !== c.y
    && ((a.x === b.x && b.y === c.y) || (a.y === b.y && b.x === c.x))
}

/**
 * Remove duplicate and collinear noise while preserving endpoints and
 * orthogonal turns. Iterates to a fixed point: ELK can emit degenerate
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
      if (Math.abs(p.x - prev.x) < EPS && Math.abs(p.y - prev.y) < EPS) {
        const next = current[i + 1]
        if (next ? !orthogonalTurn(prev, p, next) : p.x === prev.x && p.y === prev.y) continue
      }
      out.push(p)
    }
    const result: Point[] = out.length < 3 ? out : [out[0]!]
    if (out.length >= 3) {
      for (let i = 1; i < out.length - 1; i++) {
        const a = result[result.length - 1]!,
          b = out[i]!,
          c = out[i + 1]!
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if (Math.abs(cross) < EPS && !orthogonalTurn(a, b, c)) continue // collinear midpoint (or spike apex)
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
export function orthogonalizeResidualDiagonals(points: Point[]): Point[] {
  let needsWork = false
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
      needsWork = true
      break
    }
  }
  if (!needsWork) return points
  const out: Point[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!,
      b = points[i]!
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
export function bendCount(points: Point[]): number {
  return Math.max(0, simplifyPolyline(points).length - 2)
}

/** Max perpendicular deviation of a route from its flow axis. */
export function crossDeviation(points: Point[], axis: Axis): number {
  let lo = Infinity,
    hi = -Infinity
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
export function isMonotoneStaircase(points: Point[], axis: Axis): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!
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

export interface CrossSpan {
  lo: number
  hi: number
}

/** Cross-axis range where a straightened lane may attach to this node. */
export function attachSpan(node: PositionedNode, axis: Axis, facing: 1 | -1): CrossSpan | null {
  const attachment = shapeRoutingProfile(node).sides[facingSide(axis, facing)]
  if (attachment.kind === 'dynamic') return { lo: attachment.lo, hi: attachment.hi }
  if (attachment.kind === 'port') {
    const center = attachment.point[axis.cross]
    return { lo: center - PORT_TOLERANCE, hi: center + PORT_TOLERANCE }
  }
  return null
}

/**
 * Main-axis coordinate where a straight lane at cross-coordinate `c` meets the
 * node's rendered boundary. `facing` is +1 for the side facing forward flow
 * (source side), -1 for the side facing backward (target side).
 */
export function anchorMain(node: PositionedNode, c: number, axis: Axis, facing: 1 | -1): number | null {
  const point = pointOnShapeSide(shapeRoutingProfile(node), facingSide(axis, facing), c)
  return point?.[axis.main] ?? null
}

// ============================================================================
// Direct-lane proof
// ============================================================================

export interface LaneContext {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  axis: Axis
  style: LabelMetricsStyle
  /** Route classes by edgeIndex — lets proofs apply the primary-over-feedback priority. */
  classes?: RouteClass[]
  /** Lines per (nodeId:side) — the port-ranking occupancy (see facingSide). */
  sideUse?: Map<string, number>
  /** Final closure proves label slots against rendered 8px halos. */
  finalLabelClearance?: boolean
}

/** The side of a node that faces along `axis` — facing=1 for the side an
 *  edge leaves from, facing=-1 for the side it enters. */
export function facingSide(axis: Axis, facing: 1 | -1): PortSide {
  const forward = facing * axis.sign > 0
  return axis.main === 'x' ? (forward ? 'E' : 'W') : forward ? 'S' : 'N'
}

export function opposite(side: PortSide): PortSide {
  switch (side) {
    case 'N':
      return 'S'
    case 'S':
      return 'N'
    case 'E':
      return 'W'
    case 'W':
      return 'E'
  }
}

export interface RoutePortEndpointDraft {
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

export function facetSides(port: DiamondFacet): [PortSide, PortSide] {
  switch (port) {
    case 'NE':
      return ['N', 'E']
    case 'SE':
      return ['S', 'E']
    case 'SW':
      return ['S', 'W']
    case 'NW':
      return ['N', 'W']
  }
}

export function sideForPort(port: AnyPort | undefined, semanticSide: PortSide): PortSide {
  if (!port) return semanticSide
  if (port === 'N' || port === 'E' || port === 'S' || port === 'W') return port
  const sides = facetSides(port)
  return sides.includes(semanticSide) ? semanticSide : sides[0]
}

export function roleAndSide(routeClass: RouteClass, endpoint: 'source' | 'target', axis: Axis): { role: PortSemanticRole; side: PortSide } {
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

export function sideOrderCoordinate(side: PortSide, node: PositionedNode, point: Point | undefined): number {
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
export function allocateRoutePorts(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[] }, graph: MermaidGraph, classes: RouteClass[] = classifyRoutes(graph)): RoutePortAllocation {
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
  const endpointRank = (endpoint: 'source' | 'target') => (endpoint === 'source' ? 0 : 1)
  for (const group of groups.values()) {
    group.sort((a, b) => a.coord - b.coord || a.edgeIndex - b.edgeIndex || endpointRank(a.endpoint) - endpointRank(b.endpoint))
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

/** Build the proof context shared by route production and final hitch auditing.
 * Bundle-owned routes do not compete for the independent flow-side slots used
 * by the diamond vertex policy, so both callers must remove the same endpoints
 * from the allocator's semantic-side occupancy. */
export function buildRouteLaneContext(positioned: { nodes: PositionedNode[]; edges: PositionedEdge[] }, graph: MermaidGraph, style: LabelMetricsStyle, classes: RouteClass[], isBundleOwned: (edge: PositionedEdge) => boolean, finalLabelClearance = false): { ctx: LaneContext; axis: Axis } {
  const axis = axisFor(graph.direction)
  const sideUse = allocateRoutePorts(positioned, graph, classes).sideUse

  for (const edge of positioned.edges) {
    if (!isBundleOwned(edge) || edge.edgeIndex === undefined) continue
    const routeClass = classes[edge.edgeIndex]
    if (routeClass !== 'primary-forward' && !(routeClass === 'feedback' && !edge.label)) continue

    for (const endpoint of ['source', 'target'] as const) {
      const nodeId = endpoint === 'source' ? edge.source : edge.target
      const { side } = roleAndSide(routeClass, endpoint, axis)
      const key = `${nodeId}:${side}`
      const remaining = (sideUse.get(key) ?? 0) - 1
      if (remaining > 0) sideUse.set(key, remaining)
      else sideUse.delete(key)
    }
  }

  return {
    axis,
    ctx: { nodes: positioned.nodes, edges: positioned.edges, axis, style, classes, sideUse, finalLabelClearance },
  }
}
