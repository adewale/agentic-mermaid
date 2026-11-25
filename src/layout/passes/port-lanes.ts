import type { DiamondFacet, Direction, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { setLabelAxis, shiftRoute, shiftTerminalRun } from '../route-values.ts'
import { countEdgeCrossings, portEndpointRate, segmentThroughShape } from '../../layout-rubric.ts'
import { diamondFacetPorts, invalidEndpointApproaches, labelRect, PORT_EXACT, shapePorts, simplifyPolyline } from '../../route-contracts.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { DEFAULTS, graphReachability, layoutDebug, layoutEnvFlag } from '../geometry.ts'
import { reanchorOffOutlineEndpoints } from './obstacle-routing.ts'
import { positionedEdgeForwardish } from './shared.ts'
import { symmetricFanout } from './fanout.ts'
import { arrivalsMayMerge, misleadingSharedArrivals, ownsLayoutRouteInputs } from '../route-marker-clearance.ts'
import { shapeOutline } from '../../shape-outline.ts'
import { geometryBounds, nodePaintBounds, paintedStrokeExtent, unionSceneBounds } from '../../scene/bounds.ts'
import type { AxisAlignedBox } from '../../shared/transformed-bounds.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../../shared/svg-number.ts'
import { MAX_PREFERENCE_EDGES, MAX_PREFERENCE_NODES } from '../route-geometry.ts'
import { STROKE_WIDTHS } from '../../styles.ts'

import { writtenGeometry, finiteBox, boxesMeet, edgeInk, type GraphPaintStyle as PortLaneStyle } from '../graph-paint-support.ts'

export function withinPortLaneBudget(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], groups: readonly PositionedGroup[]): boolean {
  if (nodes.length > MAX_PREFERENCE_NODES || edges.length > MAX_PREFERENCE_EDGES) return false
  let remaining = MAX_PREFERENCE_NODES - nodes.length
  const fits = (groups: readonly PositionedGroup[]): boolean => groups.every(group => --remaining >= 0 && fits(group.children))
  return fits(groups)
}

const routeChanged = (edge: PositionedEdge, previous: PositionedEdge): boolean => edge.points.length !== previous.points.length
  || edge.points.some((point, index) => point.x !== previous.points[index]!.x || point.y !== previous.points[index]!.y)


export function portLaneInkWork(): { remaining: number } {
  return { remaining: MAX_PREFERENCE_NODES * MAX_PREFERENCE_EDGES }
}

export function portLaneInkClear(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], beforeNodes: readonly PositionedNode[], beforeEdges: readonly PositionedEdge[], groups: readonly PositionedGroup[], style: PortLaneStyle, budget = portLaneInkWork()): boolean {
  const changedNodes = nodes.map((node, index) => node.x !== beforeNodes[index]!.x || node.y !== beforeNodes[index]!.y)
  const changedEdges = edges.map((edge, index) => routeChanged(edge, beforeEdges[index]!))
  if (!changedNodes.some(Boolean) && !changedEdges.some(Boolean)) return true
  // The existing bounded quality-exploration scope also bounds this optional
  // publication proof. Oversized routes/pairs cannot consume unlimited work.
  const work = (): boolean => --budget.remaining >= 0
  const supports = new Map<PositionedEdge, ReturnType<typeof edgeInk>>()
  const ink = (edge: PositionedEdge): ReturnType<typeof edgeInk> => {
    if (!supports.has(edge)) supports.set(edge, edgeInk(edge, style, work))
    return supports.get(edge)
  }
  const cards = new Map<PositionedNode, AxisAlignedBox | undefined>()
  const card = (node: PositionedNode): AxisAlignedBox | undefined => {
    if (!cards.has(node)) {
      const piece = shapeOutline(node, { fill: node.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)',
        stroke: node.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)',
        strokeWidth: formatSvgNumericAttribute('stroke-width', node.inlineStyle?.['stroke-width'] ?? String(style.nodeLineWidth ?? STROKE_WIDTHS.innerBox)) }, style.cornerRadius)
      cards.set(node, nodePaintBounds({ kind: 'shape', id: node.id, role: 'node', geometry: writtenGeometry(piece.geometry), paint: piece.paint, ...(piece.childPaints ? { childPaints: piece.childPaints } : {}) }))
    }
    return cards.get(node)
  }
  try {
    // Retain incoming admission of moved-card borders against every other
    // live card, independently of route ownership.
    for (let index = 0; index < nodes.length; index++) {
      if (!changedNodes[index]) continue
      const box = card(nodes[index]!)
      if (!finiteBox(box)) return false
      for (let peerIndex = 0; peerIndex < nodes.length; peerIndex++) {
        if (peerIndex === index || changedNodes[peerIndex] && peerIndex < index) continue
        if (!work()) return false
        const peer = card(nodes[peerIndex]!)
        if (!finiteBox(peer) || boxesMeet(box, peer)) return false
      }
    }
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex]!
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
        const edge = edges[edgeIndex]!
        if ((!changedNodes[nodeIndex] && !changedEdges[edgeIndex]) || edge.style === 'invisible') continue
        if (!work()) return false
        // A canonical contact still has to face outward. Prove each endpoint
        // separately so improving one cannot hide a new inward shaft at the other.
        if (edge.source === node.id && invalidEndpointApproaches(edge, node) > invalidEndpointApproaches(beforeEdges[edgeIndex]!, beforeNodes[nodeIndex]!)) return false
        if (edge.target === node.id && invalidEndpointApproaches(edge, undefined, node) > invalidEndpointApproaches(beforeEdges[edgeIndex]!, undefined, beforeNodes[nodeIndex]!)) return false
        const route = ink(edge)
        if (!route) return false
        const box = card(node)
        if (!finiteBox(box)) return false
        if (edge.source !== node.id && edge.target !== node.id) for (const support of route.shafts) if (!work() || boxesMeet(box, support)) return false
        for (const marker of route.markers) {
          const owner = marker.position === 'start' ? edge.source : edge.target
          if (owner !== node.id && (!work() || !finiteBox(marker.bounds) || boxesMeet(box, marker.bounds))) return false
        }
        if (route.label && (!work() || boxesMeet(box, route.label))) return false
      }
    }
    return portLaneHeadersClear(nodes, edges, beforeNodes, beforeEdges, groups, ink, card, work)
  } catch {
    // Invalid/unsupported artwork is handled by the mandatory final gate.
    // This optional cosmetic pass must not publish an unproved replacement.
    return false
  }
}

function portLaneCandidate(nodes: PositionedNode[], edges: PositionedEdge[]): { nodes: PositionedNode[]; edges: PositionedEdge[] } {
  return { nodes: nodes.map(node => ({ ...node })), edges: edges.map(edge => ({ ...edge, points: edge.points.map(point => ({ ...point })), ...(edge.labelPosition ? { labelPosition: { ...edge.labelPosition } } : {}) })) }
}

function publishPortLaneCandidate(nodes: PositionedNode[], edges: PositionedEdge[], candidateNodes: PositionedNode[], candidateEdges: PositionedEdge[]): void {
  nodes.forEach((node, index) => {
    if (node.x !== candidateNodes[index]!.x) node.x = candidateNodes[index]!.x
    if (node.y !== candidateNodes[index]!.y) node.y = candidateNodes[index]!.y
  })
  edges.forEach((edge, index) => {
    const candidate = candidateEdges[index]!
    if (routeChanged(candidate, edge)) edge.points = candidate.points
    if (candidate.labelPosition?.x !== edge.labelPosition?.x || candidate.labelPosition?.y !== edge.labelPosition?.y) edge.labelPosition = candidate.labelPosition
    if (candidate.routeCertificate !== edge.routeCertificate) edge.routeCertificate = candidate.routeCertificate
  })
}

/** Final candidate admission for this node mover. Groups stay live and are
 * never flattened into a stale obstacle cache. An absent retained header uses
 * the whole frame conservatively, as in the shared lane predictor. Unchanged
 * pre-existing defects remain for the final gate; every changed subject must
 * clear the band, including old contacts of a route that the move rewrites. */
function portLaneHeadersClear(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], beforeNodes: readonly PositionedNode[], beforeEdges: readonly PositionedEdge[], groups: readonly PositionedGroup[], ink: (edge: PositionedEdge) => ReturnType<typeof edgeInk>, card: (node: PositionedNode) => AxisAlignedBox | undefined, work: () => boolean): boolean {
  const changedNodes = nodes.filter((node, index) => node.x !== beforeNodes[index]!.x || node.y !== beforeNodes[index]!.y)
  const changedEdges = edges.filter((edge, ordinal) => edge.style !== 'invisible' && routeChanged(edge, beforeEdges[ordinal]!))
  const clear = (group: PositionedGroup): boolean => {
    if (!work()) return false
    if (!group.concurrencyRegion && group.width !== 0) {
      const height = group.headerHeight ?? group.height
      if (!Number.isFinite(group.width) || group.width < 0 || !Number.isFinite(height) || height < 0) return false
      if (height > 0 && group.width > 0) {
        // The semantic reservation stays live. Include its written rectangle
        // as well, so decimal emission cannot shrink the clearance proof.
        const band = unionSceneBounds({ x0: group.x, y0: group.y, x1: group.x + group.width, y1: group.y + height },
          geometryBounds(writtenGeometry({ kind: 'rect', x: group.x, y: group.y, width: group.width, height })))
        if (!finiteBox(band)) return false
        for (const node of changedNodes) {
          if (!work()) return false
          const painted = card(node)
          if (!finiteBox(painted)) return false
          const footprint = unionSceneBounds(painted, { x0: node.x, y0: node.y, x1: node.x + node.width, y1: node.y + node.height })!
          if (!finiteBox(footprint) || boxesMeet(footprint, band)) return false
        }
        for (const edge of changedEdges) {
          const supports = ink(edge)
          if (!supports) return false
          for (const support of supports.shafts) if (!work() || boxesMeet(support, band)) return false
          for (const marker of supports.markers) if (!work() || !finiteBox(marker.bounds) || boxesMeet(marker.bounds, band)) return false
        }
      }
    }
    return group.children.every(clear)
  }
  return groups.every(clear)
}

/**
 * Port-lane alignment, the placement repair for "straight but off-port":
 * a 2-point flow-axis edge whose endpoints' midpoint ports sit on different
 * cross lanes is floating through the overlap sliver of two side spans —
 * ELK's BALANCED node placement averages competing pulls and aligns such a
 * node with neither neighbor. Sliding ONE endpoint node by the lane
 * difference makes the edge midpoint-to-midpoint: port-exact AND straight,
 * the combination no routing-side repair can reach (port-aware coordinate
 * assignment in the Brandes–Köpf tradition, Rüegg et al. GD'15).
 *
 * Every move is proof-gated, mirroring alignLayerNodes' occlusion doctrine:
 * - only rect-like endpoints (their flow-side boundary is flat, so the
 *   edge's main-axis anchors survive a cross slide);
 * - the slid node's OTHER edges must be bent with a perpendicular segment
 *   to absorb the shift (their terminal run translates); a second straight
 *   edge or a group membership vetoes the move;
 * - the new bbox must keep clear of nodes, foreign edge corridors, and
 *   label pills.
 * The target node is tried first (often alone in its layer, the freest),
 * then the source.
 */
export function alignPortLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  direction: Direction,
  style: PortLaneStyle,
): void {
  if (!withinPortLaneBudget(nodes, edges, groups)) return
  const { nodes: candidateNodes, edges: candidateEdges } = portLaneCandidate(nodes, edges)
  alignPortLaneCandidate(candidateNodes, candidateEdges, groups, direction, style)
  // Admit the actual transformed geometry, including every incident run and
  // stretched hop. A node-only lane proof cannot see a reserved header band.
  const budget = portLaneInkWork()
  if (!portLaneInkClear(candidateNodes, candidateEdges, nodes, edges, groups, style, budget)) {
    if (budget.remaining < 0) return
    // Peer sizing can leave incident endpoints stale before this pass. Repair
    // only changed private routes, then admit the geometry we actually publish.
    const changedEdges = candidateEdges.filter((edge, index) => routeChanged(edge, edges[index]!))
    reanchorOffOutlineEndpoints(candidateNodes, changedEdges, { direction }, style)
    if (!portLaneInkClear(candidateNodes, candidateEdges, nodes, edges, groups, style, budget)) return
  }
  // Centering is preparatory, but may not silently break more canonical
  // contacts than it establishes. Keep the prior layout when it does.
  if (portEndpointRate({ nodes: candidateNodes, edges: candidateEdges }, true) + 1e-6 < portEndpointRate({ nodes, edges }, true)) return
  if (ownsLayoutRouteInputs(edges, style)) {
    let moved: Set<number> | undefined
    candidateEdges.forEach((edge, index) => {
      if (edge.style !== 'invisible' && routeChanged(edge, edges[index]!)) (moved ??= new Set()).add(index)
    })
    if (moved) {
      const after = countEdgeCrossings(candidateEdges, moved)
      if (after > 0 && after > countEdgeCrossings(edges, moved)) return
    }
  }
  // Rebuilt port-to-port runs can land different relationships on one
  // arrowhead that cannot stand for both (mixed strokes, two captions). No
  // later pass separates those; repeated occurrences have their own owner.
  const strict = { duplicates: false }
  if (misleadingSharedArrivals(candidateEdges, strict) > misleadingSharedArrivals(edges, strict)) return
  publishPortLaneCandidate(nodes, edges, candidateNodes, candidateEdges)
}

export function alignPortLaneCandidate(
  nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[], direction: Direction, style: LabelMetricsStyle,
): void {
  const isHorizontal = direction === 'LR' || direction === 'RL'
  const cross = isHorizontal ? ('y' as const) : ('x' as const)
  const main = isHorizontal ? ('x' as const) : ('y' as const)
  const sign = direction === 'LR' || direction === 'TD' ? 1 : -1

  // A node that took part in an applied alignment is FROZEN: sliding it for
  // a later candidate would re-break the proven port-aligned relation.
  const frozen = new Set<string>()
  const MARGIN = 8
  const crossSize = (n: PositionedNode) => (isHorizontal ? n.height : n.width)
  const portCross = (n: PositionedNode) => n[cross] + crossSize(n) / 2
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const flatGroups: PositionedGroup[] = []
  const collect = (gs: PositionedGroup[]) => {
    for (const g of gs) {
      flatGroups.push(g)
      collect(g.children)
    }
  }
  collect(groups)
  const inGroup = (n: PositionedNode) => flatGroups.some(g =>
    n.x >= g.x - 0.5 && n.y >= g.y - 0.5 &&
    n.x + n.width <= g.x + g.width + 0.5 && n.y + n.height <= g.y + g.height + 0.5)

  const overlaps = (ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by

  const mainSize = (n: PositionedNode) => (isHorizontal ? n.width : n.height)
  /** A lane at `crossVal` over [lo, hi] on the main axis must keep CLEARANCE
   *  from every node not in `exclude` — the same obstacle rule the
   *  certifying straightener proves with, applied BEFORE the slide. */
  const laneBlocked = (crossVal: number, lo: number, hi: number, exclude: ReadonlySet<string>): boolean =>
    nodes.some(n => !exclude.has(n.id) &&
      crossVal > n[cross] - 4 && crossVal < n[cross] + crossSize(n) + 4 &&
      hi > n[main] - 4 && lo < n[main] + mainSize(n) + 4)

  /** A lane along the CROSS axis at fixed main coordinate (a hop/stub). */
  const hopBlocked = (mainVal: number, lo: number, hi: number, exclude: ReadonlySet<string>): boolean =>
    nodes.some(n => !exclude.has(n.id) &&
      mainVal > n[main] - 4 && mainVal < n[main] + mainSize(n) + 4 &&
      hi > n[cross] - 4 && lo < n[cross] + crossSize(n) + 4)

  /** The perpendicular segment adjoining the terminal run: when the run
   *  translates by delta, this segment STRETCHES across the swept corridor
   *  [ref+delta, its far cross] — which must be proved clear like any lane.
   *  Returns null when the run consumes the whole polyline (no hop). */
  const hopAfterRun = (pts: Point[], fromEnd: boolean): { mainPos: number; far: number; orthogonal: boolean } | null => {
    const idx = fromEnd ? pts.length - 1 : 0
    const step = fromEnd ? -1 : 1
    const ref = pts[idx]![cross]
    let i = idx
    while (i >= 0 && i < pts.length && Math.abs(pts[i]![cross] - ref) <= 0.5) i += step
    if (i < 0 || i >= pts.length) return null
    const beyond = pts[i]!
    const edgeOfRun = pts[i - step]!
    return { mainPos: beyond[main], far: beyond[cross], orthogonal: Math.abs(beyond[main] - edgeOfRun[main]) <= 0.5 }
  }

  /** The terminal run a slide would translate: its lane and main extent. */
  const runExtent = (pts: Point[], fromEnd: boolean): { ref: number; lo: number; hi: number } => {
    const idx = fromEnd ? pts.length - 1 : 0
    const step = fromEnd ? -1 : 1
    const ref = pts[idx]![cross]
    let lo = Infinity
    let hi = -Infinity
    for (let i = idx; i >= 0 && i < pts.length; i += step) {
      if (Math.abs(pts[i]![cross] - ref) > 0.5) break
      lo = Math.min(lo, pts[i]![main])
      hi = Math.max(hi, pts[i]![main])
    }
    return { ref, lo, hi }
  }

  // The opposite endpoint stays fixed when a terminal run translates. It is
  // exempt at its own contact, but not where the translated run or adjoining
  // hop would enter its body. Match shiftRun's affected points exactly.
  const runCrossesFixedEndpoint = (edge: PositionedEdge, fromEnd: boolean, delta: number, fixed: PositionedNode, anchorFar = false): boolean => {
    const pts = edge.points, end = fromEnd ? pts.length - 1 : 0, step = fromEnd ? -1 : 1
    const far = fromEnd ? 0 : pts.length - 1, ref = pts[end]![cross]
    let first = Infinity, last = -Infinity
    for (let i = end; i >= 0 && i < pts.length && Math.abs(pts[i]![cross] - ref) <= 0.5; i += step) {
      if (anchorFar && i === far) break
      first = Math.min(first, i); last = Math.max(last, i)
    }
    if (last < first) return false
    const translated = (i: number): Point => i >= first && i <= last ? { ...pts[i]!, [cross]: pts[i]![cross] + delta } : pts[i]!
    for (let i = Math.max(1, first); i <= Math.min(pts.length - 1, last + 1); i++) {
      if (segmentThroughShape(translated(i - 1), translated(i), fixed)) return true
    }
    return false
  }

  const moveSafe = (node: PositionedNode, delta: number, aligned: PositionedEdge, alignedPathReplaced = false): boolean => {
    if (frozen.has(node.id) || inGroup(node)) return false
    // The slide only helps if the resulting shared port lane is provably
    // clear of intermediate nodes — otherwise the straightener cannot
    // collapse onto it and the translated run may cut THROUGH a node (the
    // hard defect this pipeline exists to prevent).
    const srcN = nodeMap.get(aligned.source)!
    const tgtN = nodeMap.get(aligned.target)!
    const lane = portCross(node.id === aligned.source ? tgtN : srcN)
    const laneLo = Math.min(srcN[main] + mainSize(srcN) / 2, tgtN[main] + mainSize(tgtN) / 2)
    const laneHi = Math.max(srcN[main] + mainSize(srcN) / 2, tgtN[main] + mainSize(tgtN) / 2)
    if (laneBlocked(lane, laneLo, laneHi, new Set([aligned.source, aligned.target]))) return false
    for (const e of edges) {
      const srcTouch = e.source === node.id
      const tgtTouch = e.target === node.id
      if (!srcTouch && !tgtTouch) continue
      const isAligned = e === aligned
      if (isAligned && e.points.length === 2 &&
        Math.abs(e.points[0]![cross] - e.points[1]![cross]) <= 0.5) continue // re-anchored exactly
      if (!isAligned) {
        if (e.points.length < 3) return false // a straight sibling cannot absorb the slide
        // The terminal run translates; a perpendicular segment must exist to
        // stretch, or the shift would drag the far endpoint off its node.
        const anchor = tgtTouch ? e.points[e.points.length - 1]! : e.points[0]!
        if (!e.points.some(p => Math.abs(p[cross] - anchor[cross]) > 0.5)) return false
      }
      const exclude = new Set([e.source, e.target])
      // The translated run must not land on a node...
      const run = runExtent(e.points, tgtTouch)
      if (laneBlocked(run.ref + delta, run.lo, run.hi, exclude)) return false
      // ...and the adjoining perpendicular segment stretches across the
      // swept corridor, which must also be node-free (the property oracle
      // caught a 123px slide sweeping a sibling's hop through a circle).
      const hop = hopAfterRun(e.points, tgtTouch)
      if (hop) {
        if (!hop.orthogonal) return false
        const lo = Math.min(run.ref + delta, hop.far)
        const hi = Math.max(run.ref + delta, hop.far)
        if (hopBlocked(hop.mainPos, lo, hi, exclude)) return false
      }
      const fixed = nodeMap.get(tgtTouch ? e.source : e.target)
      if (fixed && fixed !== node && !(isAligned && alignedPathReplaced) && runCrossesFixedEndpoint(e, tgtTouch, delta, fixed)) return false
    }
    const nx = isHorizontal ? node.x : node.x + delta
    const ny = isHorizontal ? node.y + delta : node.y
    for (const other of nodes) {
      if (other === node) continue
      if (overlaps(nx - MARGIN, ny - MARGIN, node.width + 2 * MARGIN, node.height + 2 * MARGIN,
        other.x, other.y, other.width, other.height)) return false
    }
    for (const e of edges) {
      if (e.source === node.id || e.target === node.id) continue
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]!, b = e.points[i]!
        if (Math.max(a.x, b.x) > nx + 0.5 && Math.min(a.x, b.x) < nx + node.width - 0.5 &&
          Math.max(a.y, b.y) > ny + 0.5 && Math.min(a.y, b.y) < ny + node.height - 0.5) return false
      }
    }
    for (const e of edges) {
      if (e === aligned) continue
      const rect = labelRect(e, style)
      if (rect && overlaps(nx - MARGIN, ny - MARGIN, node.width + 2 * MARGIN, node.height + 2 * MARGIN,
        rect.x, rect.y, rect.w, rect.h)) return false
    }
    return true
  }

  // `anchorFar` keeps the endpoint OPPOSITE the shifted run pinned. A straight
  // 2-point edge is a single run spanning the whole polyline, so an unguarded
  // shift drags its far endpoint off a node that is NOT moving (issue #62: the
  // hub slide rigidly translated the straight duplicate edges feeding the hub,
  // pulling their source endpoints off the source node's side). Anchoring the
  // far end leaves a diagonal stub that applyRouteContracts re-anchors onto the
  // merged port lane. Staircase runs never reach the far endpoint, so the flag
  // is a no-op for them.
  // A label pill riding the shifted run follows its lane.
  const shiftRun = (e: PositionedEdge, fromEnd: boolean, delta: number, anchorFar = false): void => shiftTerminalRun(e, fromEnd, cross, delta, anchorFar)

  const apply = (node: PositionedNode, delta: number, aligned: PositionedEdge): void => {
    if (isHorizontal) node.y += delta
    else node.x += delta
    for (const e of edges) {
      if (e === aligned || e.points.length === 0) continue
      const srcTouch = e.source === node.id
      const tgtTouch = e.target === node.id
      if (srcTouch && tgtTouch) {
        shiftRoute(e, cross, delta)
        continue
      }
      if (tgtTouch) shiftRun(e, true, delta)
      if (srcTouch) shiftRun(e, false, delta)
    }
    const first = aligned.points[0]!
    const last = aligned.points[aligned.points.length - 1]!
    if (aligned.points.length === 2 && Math.abs(first[cross] - last[cross]) <= 0.5) {
      // Already a straight lane: re-anchor both ends onto the EXACT ports
      // via shapePorts — correct for every PORT_EXACT shape (a diamond's
      // sloped facet and a circle's curve change the main anchor with the
      // cross slide; bbox side midpoints are exact for all of them, and the
      // downstream shape clipper preserves port-exact endpoints).
      const exitSide = isHorizontal ? (sign > 0 ? 'E' : 'W') : (sign > 0 ? 'S' : 'N')
      const entrySide = isHorizontal ? (sign > 0 ? 'W' : 'E') : (sign > 0 ? 'N' : 'S')
      aligned.points = [
        shapePorts(nodeMap.get(aligned.source)!)[exitSide as 'N' | 'E' | 'S' | 'W'],
        shapePorts(nodeMap.get(aligned.target)!)[entrySide as 'N' | 'E' | 'S' | 'W'],
      ]
      setLabelAxis(aligned, cross, portCross(nodeMap.get(aligned.source)!))
    } else {
      // A staircase: translate the moved end's terminal run and let the
      // certifying straightener collapse it onto the (now shared) port lane
      // with a proof — or keep it if the lane turns out blocked.
      shiftRun(aligned, aligned.target === node.id, delta)
    }
  }

  // Forward edges run monotone along the flow axis; feedback loops and
  // container routes double back. Only forward edges occupy flow-side
  // facets, so only they count against a vertex's capacity.
  const isForwardMonotone = (e: PositionedEdge): boolean => {
    if (e.points.length < 2 || e.source === e.target) return false
    const pts = simplifyPolyline(e.points)
    for (let i = 1; i < pts.length; i++) {
      if ((pts[i]![main] - pts[i - 1]![main]) * sign < -0.5) return false
    }
    return true
  }
  // ---- Active fan-in centering (vertical mirror symmetry) --------------
  // A hub T fed by N unlabeled, equal-rank, forward sources should sit on
  // the EXACT cross-axis barycenter of those sources so the merge renders
  // mirror-symmetric. ELK's BALANCED placement leaves T ~20px off-barycenter
  // and the per-edge slide below amplifies it; centering T once, up front,
  // removes both errors and lets applyRouteContracts merge the now-symmetric
  // incoming edges. Proof-gated by moveSafe against ONE representative
  // incoming edge (every incoming edge shares T's port lane, so clearing the
  // barycenter for one clears it for all). Hubs handled here are skipped by
  // the slide loop (their incoming edges are frozen).
  // The hub's translated bbox must keep clear of every other node, of every
  // FOREIGN edge corridor (an edge not incident to the hub), and of every
  // label pill — the same occlusion doctrine moveSafe enforces, restated for
  // a node whose ALL incident edges move with it (so incident edges impose no
  // run/hop constraints; only the new footprint does). Incoming-edge sources
  // stay put and their lanes are re-merged by applyRouteContracts.
  const hubMoveSafe = (node: PositionedNode, delta: number, incidentIds: ReadonlySet<string>): boolean => {
    const nx = isHorizontal ? node.x : node.x + delta
    const ny = isHorizontal ? node.y + delta : node.y
    for (const other of nodes) {
      if (other === node) continue
      if (overlaps(nx - MARGIN, ny - MARGIN, node.width + 2 * MARGIN, node.height + 2 * MARGIN,
        other.x, other.y, other.width, other.height)) return false
    }
    for (const e of edges) {
      if (incidentIds.has(`${e.source}->${e.target}`)) continue
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]!, b = e.points[i]!
        if (Math.max(a.x, b.x) > nx + 0.5 && Math.min(a.x, b.x) < nx + node.width - 0.5 &&
          Math.max(a.y, b.y) > ny + 0.5 && Math.min(a.y, b.y) < ny + node.height - 0.5) return false
      }
    }
    for (const e of edges) {
      if (incidentIds.has(`${e.source}->${e.target}`)) continue
      const rect = labelRect(e, style)
      if (rect && overlaps(nx - MARGIN, ny - MARGIN, node.width + 2 * MARGIN, node.height + 2 * MARGIN,
        rect.x, rect.y, rect.w, rect.h)) return false
    }
    return true
  }

  const centeredHubs = new Set<string>()
  const forwardEdgesFrom = (id: string): PositionedEdge[] => edges.filter(e => e.source === id && isForwardMonotone(e))
  const forwardIndegree = (id: string): number => edges.filter(e => e.target === id && isForwardMonotone(e)).length
  const ownedForwardClosure = (root: PositionedNode): PositionedNode[] => {
    const out: PositionedNode[] = []
    const seen = new Set<string>()
    const queue = [root]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (seen.has(node.id)) continue
      seen.add(node.id)
      out.push(node)
      for (const edge of forwardEdgesFrom(node.id)) {
        const next = nodeMap.get(edge.target)
        if (!next || seen.has(next.id)) continue
        if (forwardIndegree(next.id) === 1) queue.push(next)
      }
    }
    return out
  }
  const written = (value: number): number => Number(formatSvgNumber(value))
  const straightFlowRun = (edge: PositionedEdge): boolean => edge.points.length === 2 &&
    written(edge.points[0]![cross]) === written(edge.points[1]![cross]) && written(edge.points[0]![main]) !== written(edge.points[1]![main])
  // This is the same current default-port authority as apply() above, not a
  // claim that every off-center outline contact is stale. A certified route
  // keeps its allocation. Otherwise only a genuinely straight current-port
  // proposal can absorb the move without adding bends.
  const straightChainPorts = (edge: PositionedEdge, ids: ReadonlySet<string>, delta: number): Point[] | undefined => {
    if (edge.routeCertificate) return undefined
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (!source || !target) return undefined
    const stagedSource = ids.has(source.id) ? { ...source, [cross]: source[cross] + delta } : source
    const stagedTarget = ids.has(target.id) ? { ...target, [cross]: target[cross] + delta } : target
    const exit = isHorizontal ? (sign > 0 ? 'E' : 'W') : (sign > 0 ? 'S' : 'N')
    const entry = isHorizontal ? (sign > 0 ? 'W' : 'E') : (sign > 0 ? 'N' : 'S')
    const a = shapePorts(stagedSource)[exit], b = shapePorts(stagedTarget)[entry]
    if (![a.x,a.y,b.x,b.y].every(Number.isFinite) || written(a[cross]) !== written(b[cross])) return undefined
    if (sign > 0 ? written(a[main]) >= written(b[main]) : written(a[main]) <= written(b[main])) return undefined
    return [a,b]
  }
  const chainMoveSafe = (chain: PositionedNode[], delta: number): boolean => {
    const ids = new Set(chain.map(n => n.id))
    for (const node of chain) {
      const nx = isHorizontal ? node.x : node.x + delta
      const ny = isHorizontal ? node.y + delta : node.y
      for (const other of nodes) {
        if (ids.has(other.id)) continue
        if (overlaps(nx - MARGIN, ny - MARGIN, node.width + 2 * MARGIN, node.height + 2 * MARGIN,
          other.x, other.y, other.width, other.height)) return false
      }
    }
    for (const edge of edges) {
      const sourceMoves = ids.has(edge.source), targetMoves = ids.has(edge.target)
      if (sourceMoves === targetMoves || edge.points.length === 0) continue
      if (straightFlowRun(edge) && !straightChainPorts(edge, ids, delta)) return false
      const fixed = nodeMap.get(targetMoves ? edge.source : edge.target)
      if (fixed && runCrossesFixedEndpoint(edge, targetMoves, delta, fixed, true)) return false
    }
    return true
  }
  const moveChain = (chain: PositionedNode[], delta: number): boolean => {
    const ids = new Set(chain.map(n => n.id))
    // Stage the exact arrays that will be published, before changing frames.
    const straight = new Map<PositionedEdge, Point[]>()
    for (const edge of edges) if (ids.has(edge.source) !== ids.has(edge.target) && straightFlowRun(edge)) {
      const points = straightChainPorts(edge, ids, delta)
      if (!points) return false
      straight.set(edge, points)
    }
    for (const node of chain) {
      if (isHorizontal) node.y += delta
      else node.x += delta
    }
    for (const e of edges) {
      const srcTouch = ids.has(e.source)
      const tgtTouch = ids.has(e.target)
      if (srcTouch && tgtTouch) {
        shiftRoute(e, cross, delta)
      } else if (straight.has(e)) {
        e.points = straight.get(e)!
        setLabelAxis(e, cross, e.points[0]![cross])
      } else if (tgtTouch) {
        shiftRun(e, true, delta, /* anchorFar */ true)
      } else if (srcTouch) {
        shiftRun(e, false, delta, /* anchorFar */ true)
      }
    }
    return true
  }
  for (const t of (layoutEnvFlag('APL_NO_CENTER') ? [] : nodes)) {
    if (frozen.has(t.id) || inGroup(t) || !PORT_EXACT.has(t.shape)) continue
    const incoming = edges.filter(e =>
      e.target === t.id && e.source !== t.id && e.points.length >= 2)
    // ≥2 DISTINCT sources, all unlabeled, all forward-monotone.
    const sources = new Map<string, PositionedNode>()
    let ok = incoming.length >= 2
    for (const e of incoming) {
      if (e.label || !isForwardMonotone(e)) { ok = false; break }
      const s = nodeMap.get(e.source)
      if (!s || !PORT_EXACT.has(s.shape)) { ok = false; break }
      sources.set(s.id, s)
    }
    if (!ok || sources.size < 2) continue
    // Hubs may own a single forward continuation: moving the hub improves the
    // merge symmetry, and the later port-lane pass can keep that continuation
    // straight. Multiple forward branches would make the centering ambiguous.
    if (edges.filter(o => o.source === t.id && o.target !== t.id && isForwardMonotone(o)).length > 1) continue
    // Equal rank: all sources stacked in ONE column — same main-axis band.
    const srcList = [...sources.values()]
    const mainCenters = srcList.map(s => s[main] + mainSize(s) / 2)
    const mainSpan = Math.max(...mainCenters) - Math.min(...mainCenters)
    const maxMainSize = Math.max(...srcList.map(mainSize))
    if (mainSpan > maxMainSize + DEFAULTS.layerSpacing * 0.6) continue
    // Barycenter of source port-cross-coords; the delta to move T onto it.
    const bary = srcList.reduce((a, s) => a + portCross(s), 0) / srcList.length
    const delta = bary - portCross(t)
    if (Math.abs(delta) <= 0.5) { centeredHubs.add(t.id); continue }
    const chain = ownedForwardClosure(t)
    const incidentIds = new Set(edges
      .filter(e => e.source === t.id || e.target === t.id)
      .map(e => `${e.source}->${e.target}`))
    if (!hubMoveSafe(t, delta, incidentIds) || !chainMoveSafe(chain, delta)) continue
    layoutDebug('[apl] center hub', t.id, 'by', delta.toFixed(1), 'over', srcList.length, 'sources')
    // Move the hub and any exclusively-owned forward continuation together.
    // That preserves straight owned chains such as CCC→DDDD while still
    // refusing to drag shared downstream merges like A/B→C.
    if (!moveChain(chain, delta)) continue
    for (const node of chain) {
      centeredHubs.add(node.id)
      frozen.add(node.id)
    }
    for (const e of incoming) frozen.add(e.source)
  }

  // ---- Diamond facet-mid alignment (E / F) -----------------------------
  // A diamond that emits exactly TWO forward edges on its single flow-side
  // facet attaches them at the facet MIDPOINTS (NE/SE for an E exit; rotated
  // per direction) and snaps each target onto that facet-mid's cross lane, so
  // both edges become port-to-port STRAIGHT instead of floating at arbitrary
  // facet positions. This is the natural extension of the cardinal port-lane
  // slide to facet-mid lanes: the source's two designated facet points pair
  // with the targets' facing cardinal ports. Proof-gated by moveSafe.
  const facetAligned = new Set<PositionedEdge>()
  if (!layoutEnvFlag('APL_NO_FACET')) {
    // The facet pair adjoining the flow-exit side, ordered (upper, lower) by
    // cross coordinate. cross='y' for LR/RL (E/W exit → NE/SE or NW/SW);
    // cross='x' for TD/BT (S/N exit → SW/SE or NW/NE).
    const facetPair = (): [DiamondFacet, DiamondFacet] => {
      if (isHorizontal) return sign > 0 ? ['NE', 'SE'] : ['NW', 'SW']
      return sign > 0 ? ['SW', 'SE'] : ['NW', 'NE'] // upper=smaller x first
    }
    for (const src of nodes) {
      if (src.shape !== 'diamond' || frozen.has(src.id) || inGroup(src)) continue
      // Exactly two forward edges, both leaving src for distinct PORT_EXACT
      // targets, none labeled-feedback, and src emits nothing else forward.
      const out = edges.filter(e => e.source === src.id && e.target !== src.id &&
        e.points.length >= 2 && isForwardMonotone(e))
      if (out.length !== 2) continue
      if (out.some(e => { const t = nodeMap.get(e.target); return !t || !PORT_EXACT.has(t.shape) })) continue
      if (out.some(e => frozen.has(e.target) || centeredHubs.has(e.target) || inGroup(nodeMap.get(e.target)!))) continue
      // Order the two edges by their target's current cross position: the
      // upper edge takes the upper facet, the lower takes the lower facet.
      const ordered = [...out].sort((a, b) =>
        portCross(nodeMap.get(a.target)!) - portCross(nodeMap.get(b.target)!))
      const [upperFacet, lowerFacet] = facetPair()
      const facets = diamondFacetPorts(src)
      const assignment: Array<[PositionedEdge, DiamondFacet]> = [
        [ordered[0]!, upperFacet], [ordered[1]!, lowerFacet],
      ]
      // A `lane` is the per-edge SOURCE attachment point (the facet-mid by
      // default) and the cross coordinate the target column snaps onto. A lane
      // set is committed only if BOTH gates pass: every target slides onto its
      // lane safely (moveSafe — proves each slide independently), AND the two
      // FINAL target boxes clear each other (the targets move toward each other
      // in vertical flow as the facet-mids collapse their columns, so moveSafe
      // alone can't see the pairwise collision). The cardinal-vertex fallback
      // below only swaps the source points; everything downstream is
      // lane-driven, so both gates run uniformly over whichever set we pick.
      const srcPorts = shapePorts(src)
      type Lane = { edge: PositionedEdge; src: Point; cross: number }
      const facetLanes: Lane[] = assignment.map(([e, facet]) => (
        { edge: e, src: { x: facets[facet].x, y: facets[facet].y }, cross: facets[facet][cross] }))
      // For a VERTICAL-flow (TD/BT) diamond the South/North facet-mids are only
      // w/2 apart, so HORIZONTALLY-stacked targets wider than that overlap when
      // snapped together (E bails for this reason). The diamond's E and W
      // cardinal VERTICES are the full width w apart — much wider — so the same
      // targets fit. Route the upper-cross edge out W, the lower out E (the
      // upper target snaps to x=W.x, the lower to x=E.x), keeping both edges
      // port-to-port straight (sourcePort W/E, targetPort N for TD). Mirrored
      // for BT by the entrySide = N/S choice. Horizontal flow keeps the facets.
      const cardinalLanes: Lane[] | null = (!isHorizontal && assignment[0] && assignment[1])
        ? [
          { edge: assignment[0]![0], src: { x: srcPorts.W.x, y: srcPorts.W.y }, cross: srcPorts.W[cross] },
          { edge: assignment[1]![0], src: { x: srcPorts.E.x, y: srcPorts.E.y }, cross: srcPorts.E[cross] },
        ]
        : null

      // Targets snapped onto a lane set must not collide with each other.
      const pairOverlaps = (lanes: Lane[]): boolean => {
        const boxes = lanes.map(l => {
          const t = nodeMap.get(l.edge.target)!
          const delta = l.cross - portCross(t)
          return {
            x: isHorizontal ? t.x : t.x + delta, y: isHorizontal ? t.y + delta : t.y,
            w: t.width, h: t.height,
          }
        })
        const [a, b] = boxes
        return !!(a && b && overlaps(a.x - MARGIN, a.y - MARGIN, a.w + 2 * MARGIN, a.h + 2 * MARGIN, b.x, b.y, b.w, b.h))
      }
      // Each target must slide onto its lane's cross coordinate (moveSafe) and
      // the resulting lane must clear — recheck for whichever lane set we use.
      const slidesSafe = (lanes: Lane[]): boolean => lanes.every(l => {
        const t = nodeMap.get(l.edge.target)!
        const delta = l.cross - portCross(t)
        return Math.abs(delta) <= 0.5 || moveSafe(t, delta, l.edge, true)
      })

      // Prefer the facet-mids; for vertical flow fall back to the wider E/W
      // cardinal vertices when the facets would collapse the targets into a
      // collision (or fail to slide). If neither set is usable, leave src alone.
      const usable = (lanes: Lane[] | null): boolean =>
        !!lanes && slidesSafe(lanes) && !pairOverlaps(lanes)
      let lanes: Lane[]
      if (usable(facetLanes)) lanes = facetLanes
      else if (usable(cardinalLanes)) lanes = cardinalLanes!
      else continue
      const entrySide = isHorizontal ? (sign > 0 ? 'W' : 'E') : (sign > 0 ? 'N' : 'S')
      for (const l of lanes) {
        const e = l.edge
        const tgt = nodeMap.get(e.target)!
        const delta = l.cross - portCross(tgt)
        if (Math.abs(delta) > 0.5) {
          if (isHorizontal) tgt.y += delta; else tgt.x += delta
          for (const o of edges) {
            if (o === e) continue
            const sT = o.source === tgt.id, tT = o.target === tgt.id
            if (sT && tT) shiftRoute(o, cross, delta)
            else if (tT) shiftRun(o, true, delta)
            else if (sT) shiftRun(o, false, delta)
          }
        }
        // Re-anchor: source on its facet-mid OR cardinal vertex (now collinear
        // with the target's facing cardinal port), target on that cardinal port.
        e.points = [
          { x: l.src.x, y: l.src.y },
          shapePorts(tgt)[entrySide as 'N' | 'E' | 'S' | 'W'],
        ]
        setLabelAxis(e, cross, l.cross)
        facetAligned.add(e)
        frozen.add(e.target)
      }
      frozen.add(src.id)
    }
  }

  // ---- Diamond side-input → perpendicular vertex (K) -------------------
  // A single forward edge whose source sits fully to one CROSS side of a
  // diamond target — below it for LR — when the target's facing cardinal port
  // (W for LR) is already taken by the labelled main branch, routes into the
  // diamond's perpendicular vertex (the S vertex when the source is below)
  // instead of floating on the facet. Proof-gated: the source slides onto the
  // vertex's cross lane (moveSafe) and the resulting straight lane must clear.
  if (!layoutEnvFlag('APL_NO_SVERTEX')) {
    for (const e of edges) {
      if (facetAligned.has(e) || e.points.length < 2 || e.source === e.target) continue
      const src = nodeMap.get(e.source)
      const tgt = nodeMap.get(e.target)
      if (!src || !tgt || tgt.shape !== 'diamond') continue
      if (frozen.has(src.id) || frozen.has(tgt.id) || inGroup(src) || inGroup(tgt)) continue
      if (!isForwardMonotone(e) || e.label) continue
      // The facing cardinal entry port must be CLAIMED by another forward edge
      // (the labelled main branch lands there), forcing this side input onto
      // a different designated point.
      // Another forward edge into this diamond owns the facing cardinal port:
      // its source sits roughly ON the diamond's flow-axis centerline (so it
      // claims the W/E/N/S midpoint), unlike this off-cross side input. The
      // re-anchor onto that exact port happens later in the pipeline; here we
      // detect the contention by the source's cross alignment.
      const tgtCross0 = tgt[cross] + crossSize(tgt) / 2
      const entryTaken = edges.some(o => {
        if (o === e || o.target !== tgt.id || !isForwardMonotone(o) || o.points.length < 2) return false
        const os = nodeMap.get(o.source)
        if (!os) return false
        return Math.abs(os[cross] + crossSize(os) / 2 - tgtCross0) <= crossSize(tgt) / 2
      })
      if (!entryTaken) continue
      // Source must sit on ONE cross side of the diamond and below/above its
      // body: its center is beyond the diamond's center on the cross axis, and
      // it clears the diamond's cross extent enough to face the vertex.
      const tgtCenterCross = tgt[cross] + crossSize(tgt) / 2
      const srcCenterCross = src[cross] + crossSize(src) / 2
      const below = srcCenterCross > tgtCenterCross
      // The perpendicular vertex toward the source (S for LR-below, N above).
      const vertexSide = isHorizontal ? (below ? 'S' : 'N') : (below ? 'E' : 'W')
      const vertex = shapePorts(tgt)[vertexSide as 'N' | 'E' | 'S' | 'W']
      // The source must be far enough onto that side that a straight lane at
      // the vertex's cross level approaches it from the flow direction — i.e.
      // the source center is past the diamond's facing-entry cross extent.
      const facingHalf = crossSize(tgt) / 2
      if (Math.abs(srcCenterCross - tgtCenterCross) < facingHalf * 0.5) continue
      const delta = vertex[cross] - portCross(src)
      if (Math.abs(delta) > 0.5 && !moveSafe(src, delta, e, true)) continue
      // The straight lane from the source's facing port to the vertex must be
      // clear and run forward.
      const srcExit = isHorizontal ? (sign > 0 ? 'E' : 'W') : (sign > 0 ? 'S' : 'N')
      const exitPort = shapePorts(src)[srcExit as 'N' | 'E' | 'S' | 'W']
      const laneLo = Math.min(exitPort[main], vertex[main])
      const laneHi = Math.max(exitPort[main], vertex[main])
      if ((vertex[main] - exitPort[main]) * sign <= 0.5) continue
      if (laneBlocked(vertex[cross], laneLo, laneHi, new Set([src.id, tgt.id]))) continue
      layoutDebug('[apl] svertex', e.source, '->', e.target, 'into', vertexSide, 'vertex')
      if (Math.abs(delta) > 0.5) {
        if (isHorizontal) src.y += delta; else src.x += delta
        for (const o of edges) {
          if (o === e) continue
          const sT = o.source === src.id, tT = o.target === src.id
          if (sT && tT) shiftRoute(o, cross, delta)
          else if (tT) shiftRun(o, true, delta)
          else if (sT) shiftRun(o, false, delta)
        }
      }
      e.points = [
        { x: shapePorts(src)[srcExit as 'N' | 'E' | 'S' | 'W'].x, y: shapePorts(src)[srcExit as 'N' | 'E' | 'S' | 'W'].y },
        { x: vertex.x, y: vertex.y },
      ]
      facetAligned.add(e)
      frozen.add(src.id)
      frozen.add(tgt.id)
    }
  }

  let reaches: ((from: string, to: string) => boolean) | undefined
  const emitterOwnsFanout = (src: PositionedNode): boolean =>
    symmetricFanout(src, edges.filter(o => o.source === src.id && positionedEdgeForwardish(o, nodeMap, direction)), edges, nodeMap, groups, direction, reaches ??= graphReachability(edges)) !== undefined

  for (const e of edges) {
    if (facetAligned.has(e)) continue
    if (e.points.length < 2 || e.source === e.target) continue
    const src = nodeMap.get(e.source)
    const tgt = nodeMap.get(e.target)
    if (!src || !tgt) continue
    if (!PORT_EXACT.has(src.shape) || !PORT_EXACT.has(tgt.shape)) continue
    // A centered fan-in hub is symmetric by construction; the slide would
    // re-break it by pulling the hub onto a single source's lane.
    if (centeredHubs.has(tgt.id)) continue
    // A diamond's vertex has capacity 1 (the yFiles port-candidate cost
    // model): a source diamond with a FORWARD fan-out must SPREAD its lines
    // on the facet, so aligning one target onto the vertex lane is wrong
    // there. A feedback sibling does not count: it leaves via the outer
    // channel and never occupies the flow-side facet.
    if (src.shape === 'diamond' &&
      edges.some(o => o !== e && o.source === e.source && isForwardMonotone(o))) continue
    const d = portCross(src) - portCross(tgt)
    if (Math.abs(d) <= 0.5) continue
    // Primary-forward shape: a monotone staircase along the flow axis (a
    // feedback loop or container route must not be retargeted at a port).
    if (!isForwardMonotone(e) || simplifyPolyline(e.points).length > 4) continue
    // A straight edge is re-anchored onto the target's entry port. When an
    // arrival that may not share its arrowhead (a twin, another stroke, a
    // second caption) already ends there, the slide would merge them.
    const entry = shapePorts(tgt)[isHorizontal ? (sign > 0 ? 'W' : 'E') : (sign > 0 ? 'N' : 'S')]
    if (e.points.length === 2 && Math.abs(e.points[0]![cross] - e.points[1]![cross]) <= 0.5 && e.hasArrowEnd && edges.some(o => o !== e && o.target === e.target
      && o.hasArrowEnd && o.points.length >= 2 && Math.hypot(o.points.at(-1)!.x - entry.x, o.points.at(-1)!.y - entry.y) <= 0.5 && !arrivalsMayMerge(e, o))) continue
    // A fan-out the symmetric emitter owns stays where it is: sliding its
    // source over one child leaves the other branch carrying the whole
    // offset, so only the child may move onto the source's lane.
    const moved = moveSafe(tgt, d, e) ? tgt : !emitterOwnsFanout(src) && moveSafe(src, -d, e) ? src : null
    if (moved) {
      layoutDebug('[apl] slide', moved.id, 'by', (moved === tgt ? d : -d).toFixed(1), 'for', e.source, '->', e.target)
      apply(moved, moved === tgt ? d : -d, e)
      frozen.add(e.source)
      frozen.add(e.target)
    }
  }
}
