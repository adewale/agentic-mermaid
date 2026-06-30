/**
 * Deterministic layout-quality rubric (docs/design/system/layout-rubric.md).
 *
 * Computes the empirically validated graph-drawing aesthetics (Purchase 1997,
 * 2002: crossings and bends are the strongest comprehension factors), the
 * orthogonal-drawing tradition's bend/orthogonality criteria (Tamassia), the
 * Kakoulis–Tollis edge-label criteria (a label must associate unambiguously
 * with its own edge), and this project's route/port contracts — all from
 * final geometry, with no human judgment. Hard metrics must be zero; soft
 * metrics are reported for thresholds set per fixture class.
 *
 * The outline oracle is independent of the layout/clipping code paths: it
 * reimplements each shape's rendered outline equation from the renderer's
 * geometry, so a port or clipping regression cannot hide itself.
 */

import type { MermaidGraph, Point, PositionedGraph, PositionedGroup, PositionedNode } from './types.ts'
import { diamondFacetPorts, findRouteHitches, shapePorts } from './route-contracts.ts'
import { measureMultilineText } from './text-metrics.ts'
import { resolveRenderStyle } from './styles.ts'

/**
 * Evidence-based impact rank for a violation, mirroring the QualityBounds
 * provenance (src/agent/quality.ts BOUND_PROVENANCE, grounded in Purchase
 * 1997/2002): readability-destroying defects (edges through nodes, overlaps,
 * crossings) rank above routing-shape defects (bends, diagonals, hitches),
 * which rank above endpoint/label-placement cosmetics. Reports sort by this so
 * the most-impactful violation is read first, not buried in declaration order.
 *
 * JUSTIFIED / SYMMETRIC BEND (not a defect): a bend that is part of a SYMMETRIC
 * convergence — a fan-out/fan-in bundle, or a co-ranked mixed-label fan-in's
 * converging dogleg — is "as good as" a straight line and is NOT penalized. The
 * bend is structurally necessary to converge, and the symmetry it buys offsets
 * the small bend cost; every reference layered drawer routes a fan that way, and
 * our own fan-out emitter (applySymmetricFanoutEmissions) does too. So
 * bundle-certified bends are excluded from totalBends/maxBendsPerEdge below — the
 * SAME edges findRouteHitches treats as non-hitches, keeping the bend penalty and
 * the HARD hitch-invariant in agreement. Only UNJUSTIFIED / lone bends still cost
 * (an off-lane jog with a clear straight lane is a `hitches` HARD violation; a
 * bend on a 'straight'-certified edge is an `unexplainedBends` HARD violation).
 */
export type RubricSeverity = 'primary' | 'secondary' | 'cosmetic'

const RUBRIC_SEVERITY: Record<string, RubricSeverity> = {
  edgeThroughNode: 'primary',
  nodeOverlaps: 'primary',
  diagonalSegments: 'secondary',
  unexplainedBends: 'secondary',
  hitches: 'secondary',
  offOutlineEndpoints: 'cosmetic',
  labelOffRoute: 'cosmetic',
}

const RUBRIC_SEVERITY_ORDER: Record<RubricSeverity, number> = { primary: 0, secondary: 1, cosmetic: 2 }

export function rubricSeverity(metric: string): RubricSeverity {
  return RUBRIC_SEVERITY[metric] ?? 'secondary'
}

export interface RubricViolation {
  metric: string
  detail: string
  /** Evidence-based impact rank; reports are sorted by it. */
  severity: RubricSeverity
}

export interface RubricMetrics {
  edges: number
  /** HARD (0): edge endpoints must lie on the rendered shape outline. */
  offOutlineEndpoints: number
  /** HARD (0): orthogonal routing must not emit diagonal segments. */
  diagonalSegments: number
  /** HARD (0): an edge certified 'straight' may not have bends. */
  unexplainedBends: number
  /** HARD (0): no edge may bend while a clear direct lane exists for it. */
  hitches: number
  /** HARD (0): node bounding boxes may not overlap. */
  nodeOverlaps: number
  /** HARD (0): a label pill must sit on its own route (Kakoulis–Tollis). */
  labelOffRoute: number
  /** HARD (0): edge segments through a non-incident node's interior. */
  edgeThroughNode: number
  /** Purchase's strongest validated aesthetic — minimize. */
  edgeCrossings: number
  /** Purchase-validated — minimize. Excludes justified symmetric-convergence
   *  bends (bundle-certified fan-out/fan-in spokes): those are "as good as
   *  straight", the same edges findRouteHitches treats as non-hitches. */
  totalBends: number
  /** As totalBends, also excluding justified symmetric-convergence bends. */
  maxBendsPerEdge: number
  /** Fraction of edge ends sitting exactly on a canonical port. */
  portEndpointRate: number
  /** Fraction of edges with at least one end on a canonical port. */
  portAnchoredEdgeRate: number
  /** Largest cross-axis offset between a peer hub and its peer barycenter. */
  peerBarycenterDelta: number
}

export interface RubricResult {
  metrics: RubricMetrics
  violations: RubricViolation[]
}

/**
 * Whether a point lies on the rendered outline of a shape, within `tol` px.
 * Shapes without an exact oracle yet fall back to the bbox perimeter, which
 * is exact at the four ports and approximate elsewhere.
 */
function onDesignatedPort(node: PositionedNode, p: Point): boolean {
  const near = (q: Point) => Math.abs(q.x - p.x) <= 0.5 && Math.abs(q.y - p.y) <= 0.5
  if ((Object.values(shapePorts(node)) as Point[]).some(near)) return true
  if (node.shape === 'diamond' && (Object.values(diamondFacetPorts(node)) as Point[]).some(near)) return true
  return false
}

export function onShapeOutline(node: PositionedNode, p: Point, tol = 1.5): boolean {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const hw = node.width / 2
  const hh = node.height / 2
  const dx = p.x - cx
  const dy = p.y - cy

  const onBboxPerimeter = (): boolean => {
    const onV = Math.abs(Math.abs(dx) - hw) < tol && Math.abs(dy) <= hh + tol
    const onH = Math.abs(Math.abs(dy) - hh) < tol && Math.abs(dx) <= hw + tol
    return onV || onH
  }

  switch (node.shape) {
    case 'diamond':
      return Math.abs(Math.abs(dx) / hw + Math.abs(dy) / hh - 1) * Math.min(hw, hh) < tol
    case 'circle':
    case 'doublecircle':
    case 'state-start':
    case 'state-end':
      return Math.abs(Math.hypot(dx / hw, dy / hh) - 1) * Math.min(hw, hh) < tol
    case 'stadium': {
      const r = hh
      if (Math.abs(dx) <= hw - r) return Math.abs(Math.abs(dy) - hh) < tol
      const ax = Math.abs(dx) - (hw - r)
      return Math.abs(Math.hypot(ax, dy) - r) < tol
    }
    case 'hexagon': {
      // Flat top/bottom between the corner insets, slanted tips (renderer:
      // inset = h/4, E/W vertices at mid-height).
      const inset = node.height / 4
      if (Math.abs(dx) <= hw - inset) return Math.abs(Math.abs(dy) - hh) < tol
      // Slanted edge from (hw - inset, ±hh) to (hw, 0):
      const t = (Math.abs(dx) - (hw - inset)) / inset // 0 at corner, 1 at tip
      if (t < -tol || t > 1 + tol) return false
      return Math.abs(Math.abs(dy) - hh * (1 - t)) < tol * 2
    }
    case 'cylinder': {
      const ry = 7 // renderer's cap radius
      // Vertical walls between the caps:
      if (p.y >= node.y + ry - tol && p.y <= node.y + node.height - ry + tol &&
        Math.abs(Math.abs(dx) - hw) < tol) return true
      // Top/bottom elliptical caps:
      const capY = p.y < cy ? node.y + ry : node.y + node.height - ry
      const ey = (p.y - capY) / ry
      const ex = dx / hw
      return Math.abs(Math.hypot(ex, ey) - 1) * Math.min(hw, ry) < tol * 2
    }
    case 'trapezoid':
    case 'trapezoid-alt':
    case 'lean-r':
    case 'lean-l':
    case 'asymmetric': {
      // Exact polygon oracle: min point-to-segment distance over the
      // rendered polygon's edges (renderer geometry, reimplemented here so a
      // clipping regression cannot certify itself healthy).
      const verts = slantedPolygonVertices(node)
      let best = Infinity
      for (let i = 0; i < verts.length; i++) {
        best = Math.min(best, pointToSegmentDistance(p, verts[i]!, verts[(i + 1) % verts.length]!))
      }
      return best <= tol
    }
    default:
      return onBboxPerimeter()
  }
}

/**
 * Rendered polygon outlines of the slanted shapes, restated from the
 * renderer's geometry (shear = w * 0.15 for the trapezoid/parallelogram
 * family; the asymmetric flag indents its left point by 12px).
 */
function slantedPolygonVertices(node: PositionedNode): Point[] {
  const { x, y, width: w, height: h } = node
  const inset = w * 0.15
  switch (node.shape) {
    case 'trapezoid': // wider bottom
      return [{ x: x + inset, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x, y: y + h }]
    case 'trapezoid-alt': // wider top
      return [{ x, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x: x + inset, y: y + h }]
    case 'lean-r': // parallelogram leaning right
      return [{ x: x + inset, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x, y: y + h }]
    case 'lean-l': // parallelogram leaning left
      return [{ x, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x: x + inset, y: y + h }]
    default: // asymmetric: flag with a pointed left edge
      return [{ x: x + 12, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x: x + 12, y: y + h }, { x, y: y + h / 2 }]
  }
}

/**
 * Whether an axis-aligned segment passes through a node's rendered footprint
 * (not merely its bbox — a route grazing the empty corner outside a circle's
 * disk or a diamond's facet is legal). Half-pixel tolerance throughout.
 */
function segmentThroughShape(a: Point, b: Point, node: PositionedNode): boolean {
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const hw = node.width / 2
  const hh = node.height / 2
  const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
  const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
  const inBbox = xHi > node.x + 0.5 && xLo < node.x + node.width - 0.5 &&
    yHi > node.y + 0.5 && yLo < node.y + node.height - 0.5
  if (!inBbox) return false

  // For curved/pointed shapes, occlusion means penetrating DEEPER than the
  // stroke width (2px): a route that grazes a diamond tip or a circle's rim
  // by a hairline is not a legible defect, and dense corridors sometimes
  // provably admit nothing better. Rectangles stay strict: any interior
  // incursion is visible against a straight side.
  const GRAZE = 2.5
  switch (node.shape) {
    case 'circle':
    case 'doublecircle':
    case 'state-start':
    case 'state-end': {
      // Scale to a unit circle so ellipses work too, then test segment distance.
      const sa = { x: (a.x - cx) / hw, y: (a.y - cy) / hh }
      const sb = { x: (b.x - cx) / hw, y: (b.y - cy) / hh }
      return pointToSegmentDistance({ x: 0, y: 0 }, sa, sb) < 1 - GRAZE / Math.min(hw, hh)
    }
    case 'stadium': {
      const r = hh
      const coreA = { x: cx - (hw - r), y: cy }
      const coreB = { x: cx + (hw - r), y: cy }
      return segmentToSegmentDistance(a, b, coreA, coreB) < r - GRAZE
    }
    case 'diamond':
    case 'hexagon':
    case 'trapezoid':
    case 'trapezoid-alt':
    case 'lean-r':
    case 'lean-l':
    case 'asymmetric': {
      const raw = node.shape === 'diamond'
        ? [
          { x: cx, y: node.y }, { x: node.x + node.width, y: cy },
          { x: cx, y: node.y + node.height }, { x: node.x, y: cy },
        ]
        : node.shape === 'hexagon'
          ? (() => {
            const inset = node.height / 4
            return [
              { x: node.x + inset, y: node.y }, { x: node.x + node.width - inset, y: node.y },
              { x: node.x + node.width, y: cy }, { x: node.x + node.width - inset, y: node.y + node.height },
              { x: node.x + inset, y: node.y + node.height }, { x: node.x, y: cy },
            ]
          })()
          : slantedPolygonVertices(node)
      const shrink = Math.max(0, 1 - GRAZE / Math.min(hw, hh))
      const verts = raw.map(v => ({ x: cx + (v.x - cx) * shrink, y: cy + (v.y - cy) * shrink }))
      return segmentThroughConvexPolygon(a, b, verts)
    }
    default:
      return true // rect-like (and cylinder, whose footprint is its bbox)
  }
}

function segmentThroughConvexPolygon(a: Point, b: Point, verts: Point[]): boolean {
  const inside = (p: Point): boolean => {
    for (let i = 0; i < verts.length; i++) {
      const v1 = verts[i]!, v2 = verts[(i + 1) % verts.length]!
      if ((v2.x - v1.x) * (p.y - v1.y) - (v2.y - v1.y) * (p.x - v1.x) < -0.5) return false
    }
    return true
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (inside(a) || inside(b) || inside(mid)) return true
  for (let i = 0; i < verts.length; i++) {
    if (segmentsIntersect(a, b, verts[i]!, verts[(i + 1) % verts.length]!)) return true
  }
  return false
}

function segmentToSegmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b),
  )
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
  if (Math.abs(det) < 1e-9) return false
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function nodeCrossCenter(node: PositionedNode, direction: MermaidGraph['direction']): number {
  return direction === 'LR' || direction === 'RL'
    ? node.y + node.height / 2
    : node.x + node.width / 2
}

function nodeMainStart(node: PositionedNode, direction: MermaidGraph['direction']): number {
  return direction === 'LR' || direction === 'RL' ? node.x : node.y
}

function nodeMainEnd(node: PositionedNode, direction: MermaidGraph['direction']): number {
  return direction === 'LR' || direction === 'RL'
    ? node.x + node.width
    : node.y + node.height
}

function forwardish(source: PositionedNode, target: PositionedNode, direction: MermaidGraph['direction']): boolean {
  if (direction === 'LR') return nodeMainStart(target, direction) > nodeMainEnd(source, direction)
  if (direction === 'RL') return nodeMainEnd(target, direction) < nodeMainStart(source, direction)
  if (direction === 'BT') return nodeMainEnd(target, direction) < nodeMainStart(source, direction)
  return nodeMainStart(target, direction) > nodeMainEnd(source, direction)
}

function samePeerLayer(nodes: PositionedNode[], direction: MermaidGraph['direction'], tolerance = 1): boolean {
  if (nodes.length < 2) return false
  const starts = nodes.map(node => nodeMainStart(node, direction))
  return Math.max(...starts) - Math.min(...starts) <= tolerance
}

function nodeInsideGroups(node: PositionedNode, groups: PositionedGroup[]): boolean {
  const visit = (items: PositionedGroup[]): boolean => items.some(group =>
    (node.x >= group.x - 0.5 && node.y >= group.y - 0.5 &&
      node.x + node.width <= group.x + group.width + 0.5 &&
      node.y + node.height <= group.y + group.height + 0.5) || visit(group.children))
  return visit(groups)
}

function logicalGraphReaches(graph: MermaidGraph, from: string, to: string): boolean {
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    outgoing.get(edge.source)!.push(edge.target)
  }
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

// The sym metric: largest cross-axis offset between a rectangle peer hub and
// its peer barycenter — directly the fan-in/fan-out symmetry the centering
// optimizes. LABELED spokes are INCLUDED (a mixed-label fan-in is exactly the
// case the co-rank default squares up; excluding its labeled spoke hid the win,
// so the metric measured nothing there). The peer-layer test is relaxed to the
// SAME 28px tolerance centerPeerBarycenters uses to decide a fan-in's sources
// are same-rank peers, so the metric and the centering pass agree on which
// fan-ins count: a co-ranked mixed-label fan-in is now seen and reads ≈0 when
// the hub is centered, instead of being invisible. The shape gates (rect hub +
// rect ungrouped peers, distinct, mutually-unreachable) are unchanged.
const SYM_PEER_LAYER_TOL = 28
function peerBarycenterDelta(positioned: PositionedGraph, graph: MermaidGraph): number {
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedNode[]>()
  const byTarget = new Map<string, PositionedNode[]>()
  for (const edge of positioned.edges) {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target || !forwardish(source, target, graph.direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(target)
    if (!byTarget.has(edge.target)) byTarget.set(edge.target, [])
    byTarget.get(edge.target)!.push(source)
  }
  let worst = 0
  const update = (hub: PositionedNode | undefined, peers: PositionedNode[]) => {
    if (!hub || peers.length < 2 || peers.length > 6 || !samePeerLayer(peers, graph.direction, SYM_PEER_LAYER_TOL)) return
    if (hub.shape !== 'rectangle' || nodeInsideGroups(hub, positioned.groups)) return
    if (!peers.every(peer => peer.shape === 'rectangle' && !nodeInsideGroups(peer, positioned.groups))) return
    if (new Set(peers.map(peer => peer.id)).size !== peers.length) return
    for (let i = 0; i < peers.length; i++) for (let j = 0; j < peers.length; j++) {
      if (i !== j && logicalGraphReaches(graph, peers[i]!.id, peers[j]!.id)) return
    }
    const barycenter = peers.reduce((sum, peer) => sum + nodeCrossCenter(peer, graph.direction), 0) / peers.length
    worst = Math.max(worst, Math.abs(nodeCrossCenter(hub, graph.direction) - barycenter))
  }
  for (const [source, targets] of bySource) update(nodeMap.get(source), targets)
  for (const [target, sources] of byTarget) update(nodeMap.get(target), sources)
  return worst
}

/**
 * Score a positioned layout against the rubric. Pure and deterministic:
 * identical input produces identical metrics.
 */
export function assessLayout(graph: MermaidGraph, positioned: PositionedGraph): RubricResult {
  const style = resolveRenderStyle({})
  // Built without severity, then enriched + sorted by impact at the return.
  const violations: Array<Omit<RubricViolation, 'severity'>> = []
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))

  let offOutline = 0
  let diagonal = 0
  let unexplainedBends = 0
  let labelOffRoute = 0
  let totalBends = 0
  let maxBends = 0
  let portEnds = 0
  let portAnchoredEdges = 0
  let measuredEnds = 0

  for (const e of positioned.edges) {
    const id = `${e.source}->${e.target}`
    const bends = Math.max(0, e.points.length - 2)
    // Justified-bend exemption: a bend that is part of a SYMMETRIC convergence
    // (a fan-out/fan-in bundle, or a co-ranked mixed-label fan-in's dogleg) is
    // "as good as straight" — the bend is structurally necessary to converge and
    // the symmetry it buys offsets the cost, the same idiom every reference
    // layered drawer (and our own fan-out emitter) uses. So it does not count
    // toward totalBends/maxBendsPerEdge. We key off the SAME 'bundle' certificate
    // findRouteHitches uses to skip these edges (route-contracts.ts), so the bend
    // penalty and the HARD hitch-invariant AGREE on what is justified. This does
    // NOT touch unexplainedBends (which fires only on 'straight'-certified edges,
    // and a bundle edge is never 'straight') or hitches (HARD, unchanged).
    const justifiedConvergenceBend = e.routeCertificate?.invariant === 'bundle'
    if (!justifiedConvergenceBend) {
      totalBends += bends
      maxBends = Math.max(maxBends, bends)
    }

    if (bends > 0 && e.routeCertificate?.invariant === 'straight') {
      unexplainedBends += bends
      violations.push({ metric: 'unexplainedBends', detail: `${id} certified straight with ${bends} bends` })
    }

    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!, b = e.points[i]!
      if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) {
        diagonal++
        violations.push({ metric: 'diagonalSegments', detail: `${id} segment ${i}` })
      }
    }

    for (const [nodeId, pt, label] of [
      [e.source, e.points[0]!, 'source'],
      [e.target, e.points[e.points.length - 1]!, 'target'],
    ] as const) {
      const node = nodeMap.get(nodeId)
      if (!node) continue
      measuredEnds++
      if (!onShapeOutline(node, pt)) {
        offOutline++
        violations.push({ metric: 'offOutlineEndpoints', detail: `${id} ${label} on ${nodeId}(${node.shape}) at (${pt.x.toFixed(1)},${pt.y.toFixed(1)})` })
      }
      if (onDesignatedPort(node, pt)) portEnds++
    }
    const srcNode = nodeMap.get(e.source)
    const tgtNode = nodeMap.get(e.target)
    const onPort = (node: PositionedNode | undefined, pt: Point) => node ? onDesignatedPort(node, pt) : false
    if (onPort(srcNode, e.points[0]!) || onPort(tgtNode, e.points[e.points.length - 1]!)) portAnchoredEdges++

    if (e.label && e.labelPosition && e.points.length >= 2) {
      const m = measureMultilineText(e.label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      const allow = (m.height + 16) / 2 + 4
      let best = Infinity
      for (let i = 1; i < e.points.length; i++) {
        best = Math.min(best, pointToSegmentDistance(e.labelPosition, e.points[i - 1]!, e.points[i]!))
      }
      if (best > allow) {
        labelOffRoute++
        violations.push({ metric: 'labelOffRoute', detail: `${id} label ${best.toFixed(1)}px from its route (allowed ${allow.toFixed(1)})` })
      }
    }
  }

  let edgeThroughNode = 0
  for (const e of positioned.edges) {
    for (const node of positioned.nodes) {
      if (node.id === e.source || node.id === e.target) continue
      for (let i = 1; i < e.points.length; i++) {
        if (segmentThroughShape(e.points[i - 1]!, e.points[i]!, node)) {
          edgeThroughNode++
          violations.push({ metric: 'edgeThroughNode', detail: `${e.source}->${e.target} segment ${i} through ${node.id}` })
          break
        }
      }
    }
  }

  let crossings = 0
  for (let i = 0; i < positioned.edges.length; i++) {
    for (let j = i + 1; j < positioned.edges.length; j++) {
      const e1 = positioned.edges[i]!, e2 = positioned.edges[j]!
      for (let s = 1; s < e1.points.length; s++) {
        for (let q = 1; q < e2.points.length; q++) {
          if (segmentsIntersect(e1.points[s - 1]!, e1.points[s]!, e2.points[q - 1]!, e2.points[q]!)) crossings++
        }
      }
    }
  }

  let nodeOverlaps = 0
  for (let i = 0; i < positioned.nodes.length; i++) {
    for (let j = i + 1; j < positioned.nodes.length; j++) {
      const a = positioned.nodes[i]!, b = positioned.nodes[j]!
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (ox > 0.5 && oy > 0.5) {
        nodeOverlaps++
        violations.push({ metric: 'nodeOverlaps', detail: `${a.id} overlaps ${b.id}` })
      }
    }
  }

  const hitchList = findRouteHitches(positioned, graph)
  for (const h of hitchList) violations.push({ metric: 'hitches', detail: `${h.edge} deviates ${h.deviationPx}px with a clear lane` })

  return {
    metrics: {
      edges: positioned.edges.length,
      offOutlineEndpoints: offOutline,
      diagonalSegments: diagonal,
      unexplainedBends,
      hitches: hitchList.length,
      nodeOverlaps,
      labelOffRoute,
      edgeThroughNode,
      edgeCrossings: crossings,
      totalBends,
      maxBendsPerEdge: maxBends,
      portEndpointRate: measuredEnds === 0 ? 1 : portEnds / measuredEnds,
      portAnchoredEdgeRate: positioned.edges.length === 0 ? 1 : portAnchoredEdges / positioned.edges.length,
      peerBarycenterDelta: peerBarycenterDelta(positioned, graph),
    },
    violations: violations
      .map(v => ({ ...v, severity: rubricSeverity(v.metric) }))
      .sort((a, b) => RUBRIC_SEVERITY_ORDER[a.severity] - RUBRIC_SEVERITY_ORDER[b.severity]),
  }
}

/** The hard rubric metrics — must be zero for every diagram, always. */
export const HARD_METRICS = [
  'offOutlineEndpoints', 'diagonalSegments', 'unexplainedBends',
  'hitches', 'nodeOverlaps', 'labelOffRoute', 'edgeThroughNode',
] as const

export function hardViolations(result: RubricResult): RubricViolation[] {
  const hard = new Set<string>(HARD_METRICS)
  return result.violations.filter(v => hard.has(v.metric))
}
