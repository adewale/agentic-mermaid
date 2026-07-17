// Post-ELK geometry passes, relocated from layout-engine.ts
// (docs/design/system/layout-pass-pipeline.md §4 step 2).
//
// One-directional dependency: imports from ./geometry, ../route-contracts, ../shape-clipping,
// ../styles, ../text-metrics, ../color-resolver, ../types — NEVER from ../layout-engine.ts.
// layout-engine.ts imports these passes for the LAYOUT_PIPELINE manifest.
import type { ElkNode } from 'elkjs'
import type {
  DiamondFacet,
  Direction,
  MermaidGraph,
  MermaidSubgraph,
  Point,
  PositionedEdge,
  PositionedGroup,
  PositionedNode,
} from '../../types.ts'
import { ARROW_HEAD, FLOWCHART_DOTTED_DASH } from '../../styles.ts'
import type { ResolvedRenderStyle } from '../../styles.ts'
import { measureMultilineText } from '../../text-metrics.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { onShapeOutline, segmentThroughShape } from '../../layout-rubric.ts'
import { classifyRoutes, diamondFacetPorts, labelRect, laneContextFor, PORT_EXACT, recertifyReroutedEdge, shapePorts, simplifyPolyline, straightLaneFor } from '../../route-contracts.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { resolveEdgeInlineStyle } from '../../color-resolver.ts'
import {
  DEFAULTS,
  calculatePathMidpoint,
  findSubgraph,
  flattenGroupBounds,
  layoutDebug,
  layoutEnvFlag,
  layoutFlow,
  nodeCrossCenter,
  nodeCrossSize,
  nodeCrossStart,
  nodeMainCenter,
  nodeMainSize,
  nodeMainStart,
  pointAtPathDistance,
  polylineLength,
  positionedNodeCenter,
  rectsOverlap,
} from '../geometry.ts'
import type { MarginInfo } from '../geometry.ts'

export { translateGeometryToNonNegativeOrigin } from './translation.ts'

/**
 * Edge segment extracted from ELK result.
 * Used to combine external and internal segments of hierarchical edges.
 */
interface EdgeSegment {
  edgeIndex: number
  isInternal: boolean  // true for port-to-node segments (e.g., "e3_internal")
  points: Point[]
  labelPosition?: Point
}
function positionedEdgeForwardish(edge: PositionedEdge, nodeMap: Map<string, PositionedNode>, direction: Direction): boolean {
  if (edge.source === edge.target) return false
  const source = nodeMap.get(edge.source)
  const target = nodeMap.get(edge.target)
  if (!source || !target) return false
  const f = layoutFlow(direction)
  const s = positionedNodeCenter(source)
  const t = positionedNodeCenter(target)
  return ((f.isHorizontal ? t.x - s.x : t.y - s.y) * f.sign) > 8
}
function sameFlowLayer(group: PositionedNode[], direction: Direction, tolerance = 18): boolean {
  if (group.length < 2) return false
  const values = group.map(n => nodeMainStart(n, direction))
  return Math.max(...values) - Math.min(...values) <= tolerance
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
function packFlowLayerCrossAxis(nodes: PositionedNode[], direction: Direction): void {
  const f = layoutFlow(direction)
  const layers: PositionedNode[][] = []
  const tolerance = 18
  const ordered = [...nodes].sort((a, b) => nodeMainStart(a, direction) - nodeMainStart(b, direction) || nodeCrossStart(a, direction) - nodeCrossStart(b, direction))
  for (const node of ordered) {
    const main = nodeMainStart(node, direction)
    let layer = layers.find(existing => Math.abs(nodeMainStart(existing[0]!, direction) - main) <= tolerance)
    if (!layer) { layer = []; layers.push(layer) }
    layer.push(node)
  }

  const gap = 24
  for (const layer of layers) {
    const byCross = [...layer].sort((a, b) => nodeCrossStart(a, direction) - nodeCrossStart(b, direction))
    let cursor = nodeCrossStart(byCross[0]!, direction)
    for (const node of byCross) {
      const start = nodeCrossStart(node, direction)
      if (start < cursor) {
        const delta = cursor - start
        if (f.isHorizontal) node.y += delta
        else node.x += delta
      }
      cursor = nodeCrossStart(node, direction) + nodeCrossSize(node, direction) + gap
    }
  }
}
function nodeInsideGroups(node: PositionedNode, groups: PositionedGroup[]): boolean {
  const visit = (items: PositionedGroup[]): boolean => items.some(group =>
    (node.x >= group.x - 0.5 && node.y >= group.y - 0.5 &&
      node.x + node.width <= group.x + group.width + 0.5 &&
      node.y + node.height <= group.y + group.height + 0.5) || visit(group.children))
  return visit(groups)
}
function flattenPositionedGroups(groups: PositionedGroup[], out: PositionedGroup[] = []): PositionedGroup[] {
  for (const group of groups) {
    out.push(group)
    flattenPositionedGroups(group.children, out)
  }
  return out
}
function rectInsideGroup(rect: { x: number; y: number; width: number; height: number }, group: PositionedGroup): boolean {
  return rect.x >= group.x - 0.5 &&
    rect.y >= group.y - 0.5 &&
    rect.x + rect.width <= group.x + group.width + 0.5 &&
    rect.y + rect.height <= group.y + group.height + 0.5
}
function expandGroupsForMainShift(
  groups: PositionedGroup[],
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  direction: Direction,
  delta: number,
): void {
  if (delta <= 0) return
  const f = layoutFlow(direction)
  const expanded = new Set<PositionedGroup>()
  for (const group of flattenPositionedGroups(groups)) {
    if (expanded.has(group) || !rects.some(rect => rectInsideGroup(rect, group))) continue
    expanded.add(group)
    if (f.isHorizontal) {
      if (f.sign > 0) group.width += delta
      else {
        group.x -= delta
        group.width += delta
      }
    } else if (f.sign > 0) group.height += delta
    else {
      group.y -= delta
      group.height += delta
    }
  }
}
export function equalizePeerNodeDimensions(nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[], graph: MermaidGraph): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const incoming = new Map<string, PositionedEdge[]>()
  const outgoing = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
    if (!incoming.has(edge.target)) incoming.set(edge.target, [])
    incoming.get(edge.target)!.push(edge)
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, [])
    outgoing.get(edge.source)!.push(edge)
  }

  const peerGroups: PositionedNode[][] = []
  const addGroup = (group: PositionedNode[]) => {
    if (group.length < 2 || group.length > 5) return
    if (!group.every(n => n.shape === 'rectangle')) return
    if (group.some(n => nodeInsideGroups(n, groups))) return
    if (!sameFlowLayer(group, graph.direction)) return
    const key = group.map(n => n.id).sort().join('\0')
    if (peerGroups.some(g => g.map(n => n.id).sort().join('\0') === key)) return
    peerGroups.push(group)
  }

  for (const candidate of incoming.values()) {
    const targetId = candidate[0]?.target
    const sources = candidate.map(e => nodeMap.get(e.source)!).filter(Boolean)
    if (!targetId || !sources.every(source => edges.every(e => e.source !== source.id || e.target === targetId))) continue
    addGroup(sources)
  }

  for (const candidate of outgoing.values()) {
    const sourceId = candidate[0]?.source
    const targets = candidate.map(e => nodeMap.get(e.target)!).filter(Boolean)
    if (!sourceId || !targets.every(target => edges.every(e => e.target !== target.id || e.source === sourceId) && edges.every(e => e.source !== target.id))) continue
    let peer = true
    for (let i = 0; i < targets.length; i++) for (let j = 0; j < targets.length; j++) {
      if (i !== j && logicalGraphReaches(graph, targets[i]!.id, targets[j]!.id)) peer = false
    }
    if (peer) addGroup(targets)
  }

  let changed = false
  const f = layoutFlow(graph.direction)
  for (const group of peerGroups) {
    const maxWidth = Math.max(...group.map(n => n.width))
    const maxHeight = Math.max(...group.map(n => n.height))
    if (group.every(n => Math.abs(n.width - maxWidth) < 0.5 && Math.abs(n.height - maxHeight) < 0.5)) continue
    const ordered = [...group].sort((a, b) => nodeCrossStart(a, graph.direction) - nodeCrossStart(b, graph.direction))
    let cursor = Math.min(...ordered.map(n => nodeCrossStart(n, graph.direction)))
    const mainStart = Math.min(...ordered.map(n => nodeMainStart(n, graph.direction)))
    const proposed: Array<{ node: PositionedNode; x: number; y: number }> = []
    for (const node of ordered) {
      proposed.push({ node, x: f.isHorizontal ? mainStart : cursor, y: f.isHorizontal ? cursor : mainStart })
      cursor += (f.isHorizontal ? maxHeight : maxWidth) + 24
    }
    // Equalizing grows each peer to the shared max on the MAIN axis. In a reversed
    // flow (RL/BT) that growth reaches back into the peer's own upstream node —
    // and packFlowLayerCrossAxis (cross-axis only) cannot pull the two apart,
    // leaving a nodeOverlaps/offOutlineEndpoints HARD. Rather than drop the
    // equalization, slide the colliding upstream node (and its whole ancestor
    // cone, so their relative layout is preserved) further along +main into the
    // empty region beyond the fan-in, opening room for the wider peer. A peer's
    // ORIGINAL main span is used to decide "newly over" — a same-layer sibling it
    // already overlapped on the main axis (a pure cross collision) is LEFT to the
    // pack, exactly as before, so a clean corpus fan-in triggers nothing here and
    // byte-exact equivalence holds.
    const ids = new Set(group.map(n => n.id))
    const iv = (aLo: number, aHi: number, bLo: number, bHi: number) => aLo < bHi - 0.01 && bLo < aHi - 0.01
    const mainIv = (n: { x: number; y: number; width: number; height: number }): [number, number] => {
      const lo = f.isHorizontal ? n.x : n.y
      return [lo, lo + (f.isHorizontal ? n.width : n.height)]
    }
    const crossIv = (n: { x: number; y: number; width: number; height: number }): [number, number] => {
      const lo = f.isHorizontal ? n.y : n.x
      return [lo, lo + (f.isHorizontal ? n.height : n.width)]
    }
    // The widened peers, as rectangles (proposed position + shared max size).
    const widened = proposed.map(({ node, x, y }) => ({ id: node.id, x, y, width: maxWidth, height: maxHeight, orig: mainIv(node) }))
    // Non-peer nodes the widening newly extends a peer's main span over while
    // cross-aligned (the pack-unresolvable collisions), + the +main shift to clear.
    let shift = 0
    const colliders = new Set<string>()
    for (const w of widened) {
      const [pLo, pHi] = mainIv(w), [pcLo, pcHi] = crossIv(w), [woLo, woHi] = w.orig
      for (const o of nodes) {
        if (ids.has(o.id)) continue
        const [qLo, qHi] = mainIv(o), [qcLo, qcHi] = crossIv(o)
        if (iv(pLo, pHi, qLo, qHi) && !iv(woLo, woHi, qLo, qHi) && iv(pcLo, pcHi, qcLo, qcHi)) {
          colliders.add(o.id)
          shift = Math.max(shift, pHi + 24 - qLo)
        }
      }
    }
    // Move the colliders plus their upstream cone (ancestors via forward edges).
    const moveIds = new Set<string>()
    const visit = (id: string) => { if (moveIds.has(id) || ids.has(id)) return; moveIds.add(id); for (const e of incoming.get(id) ?? []) visit(e.source) }
    for (const id of colliders) visit(id)
    const movers = nodes.filter(n => moveIds.has(n.id))
    const origMain = new Map(movers.map(n => [n.id, mainIv(n)] as const))
    const snap = [...group, ...movers].map(n => ({ n, x: n.x, y: n.y, w: n.width, h: n.height }))
    if (shift > 0) for (const n of movers) n[f.main] += shift
    for (const { node, x, y } of proposed) { node.x = x; node.y = y; node.width = maxWidth; node.height = maxHeight }
    // Verify: no moved node (widened peer or shifted upstream) NEWLY overlaps a
    // node we did not move on the main axis while cross-aligned. If the reposition
    // could not clear it (or pushed a mover into something else), revert this group
    // entirely and leave it un-equalized — correctness over symmetry.
    const moved = new Set<string>([...ids, ...moveIds])
    const clash = [...group, ...movers].some(m => {
      const [mLo, mHi] = mainIv(m), [mcLo, mcHi] = crossIv(m)
      const [woLo, woHi] = origMain.get(m.id) ?? widened.find(w => w.id === m.id)!.orig
      return nodes.some(o => {
        if (moved.has(o.id)) return false
        const [qLo, qHi] = mainIv(o), [qcLo, qcHi] = crossIv(o)
        return iv(mLo, mHi, qLo, qHi) && !iv(woLo, woHi, qLo, qHi) && iv(mcLo, mcHi, qcLo, qcHi)
      })
    })
    if (clash) { for (const s of snap) { s.n.x = s.x; s.n.y = s.y; s.n.width = s.w; s.n.height = s.h }; continue }
    changed = true
  }
  if (changed) packFlowLayerCrossAxis(nodes, graph.direction)
}
export function centerPeerBarycenters(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  // Co-ranking a mixed-label fan-in pre-ELK is the default (see layout-engine
  // corankFanInBalancingLabels; disable with APL_NO_CORANK_FANIN). Once the
  // fan-in sources share a rank, the labeled-edge exclusion below is what
  // otherwise stops the centering — drop it for the fan-in (source-peer) side
  // so the hub can square up on the now-co-ranked peers. The sameFlowLayer
  // guard still rejects any fan-in the balancing failed to co-rank, and the
  // fan-out side stays strict.
  const corankFanin = !layoutEnvFlag('APL_NO_CORANK_FANIN')
  const candidatePeers = (candidateEdges: PositionedEdge[], peerEnd: 'source' | 'target', allowLabels = false): PositionedNode[] | undefined => {
    if (candidateEdges.length < 2 || candidateEdges.length > 6) return undefined
    const firstStyle = candidateEdges[0]!.style
    if (candidateEdges.some(edge => edge.style !== firstStyle)) return undefined
    if (!allowLabels && candidateEdges.some(edge => edge.label)) return undefined
    const ids = candidateEdges.map(edge => edge[peerEnd])
    if (new Set(ids).size !== ids.length) return undefined
    const peers = ids.map(id => nodeMap.get(id)).filter((node): node is PositionedNode => !!node)
    if (peers.length !== ids.length) return undefined
    // Peer-shape gate depends on the side. FAN-IN peers (peerEnd 'source') may be
    // any PORT_EXACT shape: no downstream pass re-spreads fan-in sources, so a
    // diamond/round/stadium source is exactly the case that otherwise reverts to
    // ELK's off-centre placement — centering the hub over their (exact-port)
    // barycenter is pure win. FAN-OUT peers (peerEnd 'target') stay rectangle-only:
    // applySymmetricFanoutEmissions OWNS fan-out symmetry and re-spreads rect (or
    // diamond-source) fan-outs EVENLY; for non-rect fan-out peers it bails, so
    // centering the hub on their raw, unevenly-spaced ELK barycenter would trade a
    // clean straight-to-middle-child emit for a worse off-centre one. The hub itself
    // may still be a diamond (moveHub guard) — its fan-out is re-spread by that pass.
    const peerShapeOk = peerEnd === 'source'
      ? (node: PositionedNode) => PORT_EXACT.has(node.shape)
      : (node: PositionedNode) => node.shape === 'rectangle'
    if (!peers.every(node => peerShapeOk(node) && !nodeInsideGroups(node, groups))) return undefined
    if (!sameFlowLayer(peers, graph.direction, 28)) return undefined
    for (let i = 0; i < peers.length; i++) for (let j = 0; j < peers.length; j++) {
      if (i !== j && logicalGraphReaches(graph, peers[i]!.id, peers[j]!.id)) return undefined
    }
    return peers
  }

  for (let pass = 0; pass < 3; pass++) {
    const bySource = new Map<string, PositionedEdge[]>()
    const byTarget = new Map<string, PositionedEdge[]>()
    for (const edge of edges) {
      if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
      if (!bySource.has(edge.source)) bySource.set(edge.source, [])
      bySource.get(edge.source)!.push(edge)
      if (!byTarget.has(edge.target)) byTarget.set(edge.target, [])
      byTarget.get(edge.target)!.push(edge)
    }

    let moved = false
    const peerBarycenter = (peers: PositionedNode[]): number =>
      peers.reduce((sum, peer) => sum + nodeCrossCenter(peer, graph.direction), 0) / peers.length

    // A small terminal fan-out (2–3) is re-spread symmetrically around the hub by
    // applySymmetricFanoutEmissions LATER in the pipeline, so that side follows
    // wherever the hub lands — its barycenter is "free" and must not pull the hub
    // here, or we fight a downstream pass and leave the anchored side off.
    const isTerminalFanout = (hubId: string, peers: PositionedNode[]): boolean =>
      peers.every(peer => edges.every(edge => edge.source !== peer.id && (edge.target !== peer.id || edge.source === hubId)))
    const smallTerminalFanout = (hubId: string, peers: PositionedNode[]): boolean =>
      peers.length >= 2 && peers.length <= 3 && isTerminalFanout(hubId, peers)

    // A hub may be a pure fan-out (eligible outgoing peer group only), a pure
    // fan-in (incoming only), or a MIXED fan-in/fan-out hub with both. Centering
    // optimizes over every ANCHORED peer-barycenter constraint at once rather
    // than letting whichever pass writes last win:
    //   - one anchored constraint  -> sit exactly on it
    //   - two that disagree        -> sit at their midpoint, the minimax-optimal
    //     one-node placement (halves the worst offset, deterministic regardless
    //     of peer counts or direction)
    // A free (downstream-re-spread) small fan-out is dropped from the set.
    //
    // SPECIAL CASE (issue #61) — a MIXED hub whose incoming and outgoing
    // barycenters disagree by more than the midpoint can absorb, with a LARGE
    // (4–6) terminal fan-out: the midpoint would leave both sides ~half the gap
    // off, and re-emitting the fan-out per edge would trade its clean shared trunk
    // for cramped stubs. Instead, rigidly shift the terminal out-group onto the
    // incoming barycenter (preserving its even spacing and shared trunk) and sit
    // the hub there too, so both sides are centered with the trunk intact. Falls
    // back to the midpoint below when shifting the out-group is unsafe.
    const MIXED_LARGE_GAP = 1.5
    const moveHub = (
      hub: PositionedNode | undefined,
      outPeers: PositionedNode[] | undefined,
      inPeers: PositionedNode[] | undefined,
    ): void => {
      // PORT_EXACT hubs (diamond/round/stadium/…) centre exactly like a rectangle:
      // the hub only translates on the cross axis and re-anchors through its exact
      // forward port, so a DECISION diamond fan-in/fan-out/mixed hub now squares up
      // on its peer barycenter instead of reverting to ELK's off-centre placement.
      // Composes with the passes that already touch diamonds: alignForkRejoinPeerCenters
      // (runs earlier; a diamond fork→3 rect peers→rejoin) leaves the hub ON its
      // barycenter, so this pass finds delta≈0 and no-ops there; applySymmetricFanoutEmissions
      // (runs later) re-spreads a small diamond fan-out around wherever the hub lands,
      // and a free small fan-out is dropped from the anchored set below so it doesn't
      // fight that pass.
      if (!hub || !PORT_EXACT.has(hub.shape) || nodeInsideGroups(hub, groups)) return
      const inBary = inPeers ? peerBarycenter(inPeers) : undefined
      const outBary = outPeers ? peerBarycenter(outPeers) : undefined

      if (inBary !== undefined && outBary !== undefined && outPeers!.length >= 4
        && isTerminalFanout(hub.id, outPeers!) && Math.abs(inBary - outBary) > MIXED_LARGE_GAP) {
        const outIds = new Set(outPeers!.map(p => p.id))
        const hubIds = new Set([hub.id])
        const outDelta = inBary - outBary
        const hubDelta = inBary - nodeCrossCenter(hub, graph.direction)
        if (crossShiftSafe(outIds, nodes, edges, graph.direction, outDelta, style)
          && crossShiftSafe(hubIds, nodes, edges, graph.direction, hubDelta, style)) {
          shiftNodeSetCross(outIds, nodes, edges, graph.direction, outDelta)
          if (Math.abs(hubDelta) > 0.5) shiftNodeSetCross(hubIds, nodes, edges, graph.direction, hubDelta)
          layoutDebug('[peer-barycenter] trunk-shift', hub.id, 'outs by', outDelta.toFixed(1))
          moved = true
          return
        }
        // Unsafe to shift the out-group: fall through to the midpoint below.
      }

      const anchored: number[] = []
      // Incoming source peers have no symmetric re-spread pass: always anchored.
      if (inBary !== undefined) anchored.push(inBary)
      if (outBary !== undefined && !(outPeers && smallTerminalFanout(hub.id, outPeers))) anchored.push(outBary)
      // No anchored side (only a free fan-out): fall back to centering on it.
      if (anchored.length === 0 && outBary !== undefined) anchored.push(outBary)
      if (anchored.length === 0) return
      const target = anchored.length === 1
        ? anchored[0]!
        : (Math.min(...anchored) + Math.max(...anchored)) / 2
      const delta = target - nodeCrossCenter(hub, graph.direction)
      if (Math.abs(delta) <= 0.5) return
      const movedIds = new Set([hub.id])
      if (!crossShiftSafe(movedIds, nodes, edges, graph.direction, delta, style)) return
      layoutDebug('[peer-barycenter] center', hub.id, 'by', delta.toFixed(1), anchored.length === 2 ? '(mixed)' : '')
      shiftNodeSetCross(movedIds, nodes, edges, graph.direction, delta)
      moved = true
    }

    // Process every hub once with all of its eligible constraints together, in
    // a deterministic id order, so a mixed hub is centered with both sides in
    // view rather than by whichever pass writes last.
    const hubIds = [...new Set([...bySource.keys(), ...byTarget.keys()])].sort()
    for (const hubId of hubIds) {
      const outgoing = bySource.get(hubId)
      const incoming = byTarget.get(hubId)
      const outPeers = outgoing ? candidatePeers(outgoing, 'target') : undefined
      const inPeers = incoming ? candidatePeers(incoming, 'source', corankFanin) : undefined
      moveHub(nodeMap.get(hubId), outPeers, inPeers)
    }
    if (!moved) break
  }
}

/**
 * Identify the spokes of every co-ranked mixed-label fan-in (the default
 * behavior, disabled by APL_NO_CORANK_FANIN; see layout-engine
 * corankFanInBalancingLabels).
 *
 * A fan-in hub fed by both a labeled and an unlabeled edge is co-ranked
 * pre-ELK so its sources share a rank; centerPeerBarycenters then squares up
 * the hub and the spokes converge as symmetric doglegs. Those bends are
 * JUSTIFIED — the convergence is structurally necessary and buys the symmetry —
 * so the spokes must be treated exactly like the fan-out bundle: skipped by the
 * hitch oracle and exempt from the bend penalty. This is the single predicate
 * both consumers (markCorankFanInBundles, alignLabeledSourcePort) share, so the
 * bend exemption, the hitch HARD-invariant, and the labeled-source-port pass all
 * AGREE on which spokes are part of a symmetric convergence.
 *
 * The gate mirrors corankFanInBalancingLabels (mixed labeled/unlabeled, rect hub
 * + rect ungrouped sources) AND additionally requires the sources to now sit on
 * the SAME flow layer (proving the co-rank succeeded) and be mutually
 * unreachable peers with one shared edge style — i.e. it only fires on a fan-in
 * the centering could actually square up. Returns hubId -> its incoming spoke
 * edges. Empty when disabled or no such fan-in exists. Pure/deterministic.
 */
export function corankFanInSpokes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
): Map<string, PositionedEdge[]> {
  const result = new Map<string, PositionedEdge[]>()
  if (layoutEnvFlag('APL_NO_CORANK_FANIN')) return result
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  // The HUB may be any PORT_EXACT shape (a diamond/round/stadium mixed-label
  // fan-in co-ranks and centres just like a rectangle one, so its converging
  // spokes are the same justified symmetric convergence). markCorankFanInBundles
  // keeps every rebuilt endpoint on-outline (it verifies the spread hub entries
  // and collapses to the exact port for non-straight-sided hubs), so admitting a
  // non-rect hub never risks the offOutlineEndpoints HARD invariant.
  const isPortExactUngroupedHub = (n: PositionedNode | undefined): boolean =>
    !!n && PORT_EXACT.has(n.shape) && !nodeInsideGroups(n, groups)
  // The SOURCES stay rectangle-only, mirroring corankFanInBalancingLabels: a
  // non-rect (diamond/…) SOURCE emitting a single labelled line has its own
  // exact-vertex exit contract that a converging-bundle re-route would override
  // (issue #26 WS3 / alignPortLanes). Squaring up the hub never re-emits sources.
  const isRectUngrouped = (n: PositionedNode | undefined): boolean =>
    !!n && n.shape === 'rectangle' && !nodeInsideGroups(n, groups)

  const incoming = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
    if (!incoming.has(edge.target)) incoming.set(edge.target, [])
    incoming.get(edge.target)!.push(edge)
  }

  for (const [hubId, group] of incoming) {
    if (group.length < 2 || group.length > 6) continue
    const hub = nodeMap.get(hubId)
    if (!isPortExactUngroupedHub(hub)) continue
    // MIXED hub only: some labeled, some not. A uniform fan-in already co-ranks
    // (and an all-unlabeled one is the plain bundler's job).
    const labeled = group.filter(e => !!e.label)
    if (labeled.length === 0 || labeled.length === group.length) continue
    // One shared edge style, mirroring the centering/bundling gate.
    const firstStyle = group[0]!.style
    if (group.some(e => e.style !== firstStyle)) continue
    // Every source must be a distinct, rectangle, ungrouped peer.
    const sources = group.map(e => nodeMap.get(e.source)).filter((n): n is PositionedNode => !!n)
    if (sources.length !== group.length) continue
    if (new Set(sources.map(s => s.id)).size !== sources.length) continue
    if (!sources.every(isRectUngrouped)) continue
    // The co-rank must actually have landed: the sources sit on one flow layer.
    if (!sameFlowLayer(sources, graph.direction, 28)) continue
    // Mutually-unreachable peers (the shape gate centerPeerBarycenters applies).
    let peers = true
    for (let i = 0; i < sources.length && peers; i++)
      for (let j = 0; j < sources.length; j++)
        if (i !== j && logicalGraphReaches(graph, sources[i]!.id, sources[j]!.id)) { peers = false; break }
    if (!peers) continue
    result.set(hubId, group)
  }
  return result
}

/**
 * Re-route every co-ranked mixed-label fan-in's spokes as clean, symmetric
 * converging doglegs and mark them bundle-owned — exactly as
 * applySymmetricFanoutEmissions does for the fan-out (re-route THEN mark).
 *
 * Runs after bundleEdgePaths (so it extends the same `bundled` set) and before
 * applyRouteContracts, which reads the set to stamp cert.invariant = 'bundle'.
 * That single marker makes findRouteHitches skip the spoke (no false HARD hitch)
 * AND the layout-rubric exempt its bend — the bend penalty and the HARD
 * hitch-invariant agree on what counts as a justified symmetric-convergence bend.
 *
 * Why re-route, not just mark: the plain bundler (bundleEdgePaths) skips any
 * group with a labeled edge, so a mixed fan-in keeps ELK's raw spoke geometry —
 * whose source endpoint can float off the node's port when a wide label reserves
 * a cell (a 'bundle' edge is not clipped/straightened downstream, so that float
 * would surface as an offOutlineEndpoints HARD violation). Rebuilding each spoke
 * from its source's forward PORT to a hub entry point spread symmetrically about
 * the hub's entry-side midpoint, sharing one elbow, gives a port-exact, mirror
 * dogleg — the same shape the unlabeled bundler produces.
 *
 * Conservative: a hub's spokes are only re-routed+marked when every rebuilt path
 * is clear of other nodes (mirroring bundleEdgePaths's clearance gate). If any
 * path is blocked, that hub is left entirely untouched — its spokes keep their
 * ELK route and the normal route-contract pass clips/certifies them, so the
 * hard-invariant is never put at risk. Deterministic: geometry derives only from
 * the frozen node positions and a fixed source ordering.
 */
export function markCorankFanInBundles(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  for (const [hubId, spokes] of corankFanInSpokes(nodes, edges, groups, graph)) {
    const hub = nodeMap.get(hubId)!
    // Order spokes by source cross position so the rebuilt doglegs nest without
    // crossing (topmost source -> topmost hub entry, etc.). Deterministic.
    const ordered = [...spokes].sort((a, b) =>
      nodeCrossCenter(nodeMap.get(a.source)!, graph.direction) - nodeCrossCenter(nodeMap.get(b.source)!, graph.direction))
    const sources = ordered.map(e => nodeMap.get(e.source)!)

    // Hub entry points: spread symmetrically about the hub entry-side midpoint,
    // kept inside the side (spacing clamped so the outermost entry stays within
    // ~80% of the half-side). The entry side is the flow target side.
    const entryMid = shapePorts(hub)[f.targetSide]
    const hubCrossHalf = (f.isHorizontal ? hub.height : hub.width) / 2
    const maxSpan = hubCrossHalf * 1.6
    const spacing = Math.min(28, ordered.length > 1 ? maxSpan / (ordered.length - 1) : 0)
    let offsets = symmetricOffsets(ordered.length, spacing)
    // A spread entry is only ON the outline for a straight-sided (rect-like) hub.
    // On a diamond/round/stadium/… the flow side is a single vertex or a curve
    // tip, so an offset entry floats OFF the outline — and a bundle edge is not
    // clipped downstream, which would surface as an offOutlineEndpoints HARD. When
    // any spread entry misses the hub outline, collapse every spoke onto the exact
    // cardinal port (offset 0): the spokes still converge symmetrically through one
    // shared elbow to a single on-outline port (exactly what an unlabeled diamond
    // fan-in does) and the labels are still re-centred below.
    const entryAt = (offset: number): Point => f.isHorizontal
      ? { x: entryMid.x, y: entryMid.y + offset }
      : { x: entryMid.x + offset, y: entryMid.y }
    if (!offsets.every(o => onShapeOutline(hub, entryAt(o)))) offsets = offsets.map(() => 0)

    // Shared elbow on the main axis, midway between the rank of the (co-ranked)
    // sources' forward edge and the hub's entry edge — the converging junction.
    const sourceExitMain = f.isHorizontal
      ? (f.sourceSide === 'E' ? Math.max(...sources.map(s => s.x + s.width)) : Math.min(...sources.map(s => s.x)))
      : (f.sourceSide === 'S' ? Math.max(...sources.map(s => s.y + s.height)) : Math.min(...sources.map(s => s.y)))
    const hubEntryMain = f.isHorizontal ? entryMid.x : entryMid.y
    const elbow = sourceExitMain + (hubEntryMain - sourceExitMain) / 2

    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    let clear = true
    for (let i = 0; i < ordered.length; i++) {
      const edge = ordered[i]!
      const src = sources[i]!
      const exit = shapePorts(src)[f.sourceSide]
      const entry = entryAt(offsets[i]!)
      const points = doglegBetween(exit, entry, graph.direction, elbow)
      if (!routeClearOfNodes(points, nodes, new Set([edge.source, edge.target]))) { clear = false; break }
      proposed.push({ edge, points })
    }
    if (!clear) continue // leave this hub's spokes to the normal route-contract path

    for (const { edge, points } of proposed) {
      edge.points = points
      edge.routeCertificate = undefined
      bundled.add(edge)
    }
    // Re-home the labeled spokes' pills onto their rebuilt routes (the same
    // helper bundleEdgePaths-fed labeled fan-outs use), THEN re-centre them onto
    // the route's main-axis midpoint: the co-rank dogleg otherwise leaves the
    // single labeled spoke hugging the source (the regression this fixes).
    assignBundledFanoutLabels(proposed, nodes, graph.direction, style, /* recenter */ true)
  }
}

export function alignForkRejoinPeerCenters(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(edge)
  }
  const forwardIndegree = (id: string): number => edges.filter(edge =>
    edge.target === id && positionedEdgeForwardish(edge, nodeMap, graph.direction)).length
  const forwardOutgoing = (id: string): PositionedEdge[] => edges.filter(edge =>
    edge.source === id && edge.target !== id && positionedEdgeForwardish(edge, nodeMap, graph.direction))
  const ownedForwardClosure = (root: PositionedNode, initial: ReadonlySet<string>): PositionedNode[] => {
    const out: PositionedNode[] = []
    const seen = new Set(initial)
    const queue = [root]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (seen.has(node.id)) continue
      seen.add(node.id)
      out.push(node)
      for (const edge of forwardOutgoing(node.id)) {
        const next = nodeMap.get(edge.target)
        if (!next || seen.has(next.id)) continue
        if (forwardIndegree(next.id) === 1) queue.push(next)
      }
    }
    return out
  }

  for (const [sourceId, outgoing] of bySource) {
    if (outgoing.length !== 3) continue
    const source = nodeMap.get(sourceId)
    if (!source || source.shape !== 'diamond' || nodeInsideGroups(source, groups)) continue
    const sorted = [...outgoing].sort((a, b) => nodeCrossCenter(nodeMap.get(a.target)!, graph.direction) - nodeCrossCenter(nodeMap.get(b.target)!, graph.direction))
    const targets = sorted.map(edge => nodeMap.get(edge.target)).filter((node): node is PositionedNode => !!node)
    if (targets.length !== sorted.length) continue
    if (!targets.every(target => target.shape === 'rectangle' && !nodeInsideGroups(target, groups))) continue
    if (!sameFlowLayer(targets, graph.direction, 28)) continue
    let peer = true
    for (let i = 0; i < targets.length; i++) for (let j = 0; j < targets.length; j++) {
      if (i !== j && logicalGraphReaches(graph, targets[i]!.id, targets[j]!.id)) peer = false
    }
    if (!peer) continue

    const childOut = targets.map(target => forwardOutgoing(target.id))
    if (!childOut.every(list => list.length === 1)) continue
    const rejoinId = childOut[0]![0]!.target
    if (!childOut.every(list => list[0]!.target === rejoinId)) continue
    const rejoin = nodeMap.get(rejoinId)
    if (!rejoin || nodeInsideGroups(rejoin, groups)) continue

    const movedIds = new Set(targets.map(target => target.id))
    for (const node of ownedForwardClosure(rejoin, movedIds)) movedIds.add(node.id)
    if ([...movedIds].some(id => {
      const node = nodeMap.get(id)
      return !node || nodeInsideGroups(node, groups)
    })) continue

    const rowCenter = (nodeCrossCenter(targets[0]!, graph.direction) + nodeCrossCenter(targets[targets.length - 1]!, graph.direction)) / 2
    const delta = nodeCrossCenter(source, graph.direction) - rowCenter
    if (Math.abs(delta) <= 0.5) continue
    if (!crossShiftSafe(movedIds, nodes, edges, graph.direction, delta, style)) continue
    layoutDebug('[fork-rejoin] center', source.id, 'peer island by', delta.toFixed(1))
    shiftNodeSetCross(movedIds, nodes, edges, graph.direction, delta)
  }
}
function connectionPort(node: PositionedNode, side: 'N' | 'E' | 'S' | 'W' | DiamondFacet): Point {
  if (node.shape === 'diamond' && (side === 'NE' || side === 'SE' || side === 'SW' || side === 'NW')) return diamondFacetPorts(node)[side]
  return shapePorts(node)[side as 'N' | 'E' | 'S' | 'W']
}
function sourceEmissionPort(source: PositionedNode, direction: Direction, index: number, count: number): Point {
  if (source.shape === 'diamond') {
    const portSets: Partial<Record<Direction, Array<'N' | 'E' | 'S' | 'W' | DiamondFacet>>> = count === 2
      ? { LR: ['NE', 'SE'], RL: ['NW', 'SW'], BT: ['NW', 'NE'], TD: ['SW', 'SE'], TB: ['SW', 'SE'] }
      : count === 3
        ? { LR: ['NE', 'E', 'SE'], RL: ['NW', 'W', 'SW'], BT: ['NW', 'N', 'NE'], TD: ['SW', 'S', 'SE'], TB: ['SW', 'S', 'SE'] }
        : {}
    const port = portSets[direction]?.[index]
    if (port) return connectionPort(source, port)
  }
  const f = layoutFlow(direction)
  const t = (index + 1) / (count + 1)
  if (f.isHorizontal) return { x: f.sourceSide === 'E' ? source.x + source.width : source.x, y: source.y + source.height * t }
  return { x: source.x + source.width * t, y: f.sourceSide === 'S' ? source.y + source.height : source.y }
}
function targetFlowPort(target: PositionedNode, direction: Direction): Point {
  return shapePorts(target)[layoutFlow(direction).targetSide]
}
function symmetricOffsets(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing)
}
function doglegBetween(source: Point, target: Point, direction: Direction, elbow: number): Point[] {
  const f = layoutFlow(direction)
  return f.isHorizontal
    ? simplifyPolyline([source, { x: elbow, y: source.y }, { x: elbow, y: target.y }, target])
    : simplifyPolyline([source, { x: source.x, y: elbow }, { x: target.x, y: elbow }, target])
}
function segmentClearOfNodes(a: Point, b: Point, nodes: PositionedNode[], exclude: ReadonlySet<string>, clearance = 1): boolean {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y)
  for (const node of nodes) {
    if (exclude.has(node.id)) continue
    const nx1 = node.x - clearance, nx2 = node.x + node.width + clearance
    const ny1 = node.y - clearance, ny2 = node.y + node.height + clearance
    if (Math.abs(a.x - b.x) < 0.01) {
      if (a.x >= nx1 && a.x <= nx2 && y1 < ny2 && y2 > ny1) return false
    } else if (Math.abs(a.y - b.y) < 0.01) {
      if (a.y >= ny1 && a.y <= ny2 && x1 < nx2 && x2 > nx1) return false
    }
  }
  return true
}
function routeClearOfNodes(points: Point[], nodes: PositionedNode[], exclude: ReadonlySet<string>): boolean {
  for (let i = 1; i < points.length; i++) {
    if (!segmentClearOfNodes(points[i - 1]!, points[i]!, nodes, exclude)) return false
  }
  return true
}
export function honorLinkRankDistance(nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[], graph: MermaidGraph): void {
  if (!graph.edges.some(e => (e.length ?? 1) > 1)) return
  const classes = classifyRoutes(graph)
  const f = layoutFlow(graph.direction)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const groupMap = new Map<string, PositionedGroup>()
  const flattenGroups = (gs: PositionedGroup[]): void => { for (const g of gs) { groupMap.set(g.id, g); flattenGroups(g.children) } }
  flattenGroups(groups)

  // A subgraph endpoint (`container` edge) expands to every node it encloses, so
  // shoving the unit moves the whole box. `cross-hierarchy` and `container` links
  // set rank distance just like `primary-forward`. A feedback edge constrains the
  // same two ranks in their geometric (forward) order: reverse its endpoints for
  // spacing, while leaving its authored direction and feedback route untouched.
  const collectMembers = (sg: MermaidSubgraph, acc: string[]): void => {
    for (const id of sg.nodeIds) acc.push(id)
    for (const child of sg.children) collectMembers(child, acc)
  }
  const unitNodes = (id: string): string[] => {
    if (nodeMap.has(id)) return [id]
    const sg = findSubgraph(graph.subgraphs, id)
    if (!sg) return []
    const acc: string[] = []
    collectMembers(sg, acc)
    return acc
  }

  // Subgraph membership path (outermost → innermost) for every node id.
  const scopeChainOf = new Map<string, string[]>()
  const walkScopes = (sgs: MermaidSubgraph[], ancestors: string[]): void => {
    for (const sg of sgs) {
      const chain = [...ancestors, sg.id]
      for (const id of sg.nodeIds) scopeChainOf.set(id, chain)
      walkScopes(sg.children, chain)
    }
  }
  walkScopes(graph.subgraphs, [])

  // The rigid unit a lengthened link moves: an individual node when the link
  // stays within the endpoints' shared scope, but the whole enclosing subgraph
  // when the link crosses into it — a subgraph (especially one with its own
  // direction override) is laid out as a unit, so shoving one inner node along
  // the outer axis would shear its internal arrangement.
  const movableUnit = (src: string, tgt: string): string[] => {
    if (groupMap.has(tgt)) return unitNodes(tgt)
    const tgtChain = scopeChainOf.get(tgt) ?? []
    const srcScopes = new Set(scopeChainOf.get(src) ?? [])
    if (groupMap.has(src)) srcScopes.add(src)
    for (const sgId of tgtChain) if (!srcScopes.has(sgId)) return unitNodes(sgId)
    return [tgt]
  }
  type RankConstraint = { source: string; target: string }
  // mutation-scope:feedback-link-rank-distance:start
  const rankConstraint = (i: number): RankConstraint => {
    const edge = graph.edges[i]!
    if (classes[i] === 'feedback') return { source: edge.target, target: edge.source }
    return { source: edge.source, target: edge.target }
  }
  // mutation-scope:feedback-link-rank-distance:end

  // Main-axis entry/exit of an endpoint that may be a node OR a subgraph box.
  const mainSpan = (id: string): { start: number; size: number } | null => {
    const n = nodeMap.get(id)
    if (n) return { start: n[f.main], size: nodeMainSize(n, graph.direction) }
    const g = groupMap.get(id)
    if (g) return { start: g[f.main], size: f.main === 'x' ? g.width : g.height }
    return null
  }
  const endpointEntry = (id: string): number | null => { const s = mainSpan(id); return s ? (f.sign === 1 ? s.start : s.start + s.size) : null }
  const endpointExit = (id: string): number | null => { const s = mainSpan(id); return s ? (f.sign === 1 ? s.start + s.size : s.start) : null }
  const isForwardish = (src: string, tgt: string): boolean => {
    const ex = endpointExit(src), en = endpointEntry(tgt)
    return ex !== null && en !== null && (en - ex) * f.sign > 0
  }

  // Forward adjacency over node ids, with subgraph endpoints expanded to members.
  const outgoing = new Map<string, string[]>()
  for (let i = 0; i < graph.edges.length; i++) {
    const constraint = rankConstraint(i)
    if (!isForwardish(constraint.source, constraint.target)) continue
    for (const u of unitNodes(constraint.source)) for (const v of unitNodes(constraint.target)) {
      if (!outgoing.has(u)) outgoing.set(u, [])
      outgoing.get(u)!.push(v)
    }
  }

  const mainDelta = new Map<string, number>() // net main-axis shift applied per node
  const moveSet = (starts: string[], delta: number): void => {
    if (Math.abs(delta) < 0.5) return
    const seen = new Set<string>()
    const stack = [...starts]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const n = nodeMap.get(id)
      if (n) {
        n[f.main] += delta
        mainDelta.set(id, (mainDelta.get(id) ?? 0) + delta)
      }
      for (const next of outgoing.get(id) ?? []) stack.push(next)
    }
  }

  // Capture each container's per-side insets (ELK's padding + label allowance)
  // before any node moves, so we can rebuild the box around the shifted members
  // afterwards without guessing the padding. Bottom-up so a parent box always
  // sees its children's rebuilt boxes.
  interface BoxBounds { x: number; y: number; r: number; b: number }
  interface Inset { l: number; t: number; r: number; b: number }
  const insetByGroup = new Map<string, Inset>()
  const groupMemberBounds = (group: PositionedGroup): BoxBounds | null => {
    let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity
    const sg = findSubgraph(graph.subgraphs, group.id)
    for (const id of sg?.nodeIds ?? []) {
      const n = nodeMap.get(id)
      if (!n) continue
      x = Math.min(x, n.x); y = Math.min(y, n.y)
      r = Math.max(r, n.x + n.width); b = Math.max(b, n.y + n.height)
    }
    for (const child of group.children) {
      x = Math.min(x, child.x); y = Math.min(y, child.y)
      r = Math.max(r, child.x + child.width); b = Math.max(b, child.y + child.height)
    }
    return Number.isFinite(x) ? { x, y, r, b } : null
  }
  const recordGroupInsets = (group: PositionedGroup): void => {
    for (const child of group.children) recordGroupInsets(child)
    const bb = groupMemberBounds(group)
    if (bb) insetByGroup.set(group.id, { l: bb.x - group.x, t: bb.y - group.y, r: group.x + group.width - bb.r, b: group.y + group.height - bb.b })
  }
  const regrowGroup = (group: PositionedGroup): void => {
    for (const child of group.children) regrowGroup(child) // rebuild children first
    const bb = groupMemberBounds(group)
    const ins = insetByGroup.get(group.id)
    if (!bb || !ins) return
    group.x = bb.x - ins.l
    group.y = bb.y - ins.t
    group.width = bb.r + ins.r - group.x
    group.height = bb.b + ins.b - group.y
  }
  for (const group of groups) recordGroupInsets(group)

  // ELK hands us non-overlapping boxes; the shove must hand them on. A moved
  // node can land on (or sweep past) a node outside its downstream closure —
  // the boxes then overlap and everything near them degenerates (nodeOverlaps,
  // then edgeThroughNode; issue #81). Snapshot the overlapping pairs (the
  // rubric's >0.5px box predicate) before any move so the repair below can be
  // scoped to exactly the pairs this pass introduces.
  const boxesOverlap = (a: PositionedNode, b: PositionedNode): boolean => {
    const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return ox > 0.5 && oy > 0.5
  }
  const pairKey = (a: PositionedNode, b: PositionedNode): string => (a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`)
  const overlappingPairs = (): Array<[PositionedNode, PositionedNode]> => {
    const pairs: Array<[PositionedNode, PositionedNode]> = []
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (boxesOverlap(nodes[i]!, nodes[j]!)) pairs.push([nodes[i]!, nodes[j]!])
      }
    }
    return pairs
  }
  const preShovePairs = new Set(overlappingPairs().map(([a, b]) => pairKey(a, b)))

  for (let i = 0; i < graph.edges.length; i++) {
    const spec = graph.edges[i]!
    const constraint = rankConstraint(i)
    const length = spec.length ?? 1
    if (length <= 1) continue
    if (!isForwardish(constraint.source, constraint.target)) continue
    const exitS = endpointExit(constraint.source), entryT = endpointEntry(constraint.target)
    if (exitS === null || entryT === null) continue
    const currentGap = (entryT - exitS) * f.sign
    const minGap = DEFAULTS.layerSpacing + (length - 1) * (DEFAULTS.layerSpacing + 40)
    if (currentGap < minGap) moveSet(movableUnit(constraint.source, constraint.target), (minGap - currentGap) * f.sign)
  }

  // Treat the shove as physical: whatever it lands on is pushed ahead, never
  // sat on. The ahead node of each shove-introduced overlap moves further
  // forward (never backward — a backward move could re-compress a gap the loop
  // above just honoured), as a unit with its outermost subgraph that excludes
  // the other node. Forward-only motion cannot cycle, so the fixpoint
  // terminates; the round cap is a defensive bound, not an expected exit.
  const separationUnit = (id: string, other: string): string[] => {
    const otherScopes = new Set(scopeChainOf.get(other) ?? [])
    for (const sgId of scopeChainOf.get(id) ?? []) if (!otherScopes.has(sgId)) return unitNodes(sgId)
    return [id]
  }
  for (let round = 0; round < nodes.length * 4; round++) {
    const created = overlappingPairs().filter(([a, b]) => !preShovePairs.has(pairKey(a, b)))
    if (created.length === 0) break
    created.sort((p, q) => (pairKey(p[0], p[1]) < pairKey(q[0], q[1]) ? -1 : 1))
    const [a, b] = created[0]!
    const flowGap = (nodeMainCenter(a, graph.direction) - nodeMainCenter(b, graph.direction)) * f.sign
    const [behind, ahead] = (flowGap !== 0 ? flowGap > 0 : a.id > b.id) ? [b, a] : [a, b]
    const delta = f.sign === 1
      ? behind[f.main] + nodeMainSize(behind, graph.direction) + DEFAULTS.nodeSpacing - ahead[f.main]
      : ahead[f.main] + nodeMainSize(ahead, graph.direction) + DEFAULTS.nodeSpacing - behind[f.main]
    // mutation-scope:link-rank-packing-closure:start
    moveSet(separationUnit(ahead.id, behind.id), f.sign === 1 ? delta : -delta)
    // mutation-scope:link-rank-packing-closure:end
  }

  // Grow/translate every container so it still encloses its (possibly moved) members.
  for (const group of groups) regrowGroup(group)

  // Feedback edges escape to a lane just outside the node band on the
  // max-cross side (matching ELK's deterministic feedbackEdges placement). The
  // lane must clear every node so the back edge never grazes an intermediate
  // box after the gap widens.
  const FEEDBACK_LANE_GAP = 10
  const crossMaxEdge = (n: PositionedNode): number => nodeCrossCenter(n, graph.direction) + nodeCrossSize(n, graph.direction) / 2
  const crossMinEdge = (n: PositionedNode): number => nodeCrossCenter(n, graph.direction) - nodeCrossSize(n, graph.direction) / 2
  const laneCross = Math.max(...nodes.map(crossMaxEdge)) + FEEDBACK_LANE_GAP
  const laneCrossMin = Math.min(...nodes.map(crossMinEdge)) - FEEDBACK_LANE_GAP
  const point = (mainV: number, crossV: number): Point =>
    f.main === 'x' ? { x: mainV, y: crossV } : { x: crossV, y: mainV }

  // Attach point on the flow side of an endpoint that may be a node or a box.
  const flowPort = (id: string, side: 'N' | 'E' | 'S' | 'W'): Point | null => {
    const n = nodeMap.get(id)
    if (n) return shapePorts(n)[side]
    const g = groupMap.get(id)
    if (!g) return null
    const cx = g.x + g.width / 2, cy = g.y + g.height / 2
    switch (side) {
      case 'E': return { x: g.x + g.width, y: cy }
      case 'W': return { x: g.x, y: cy }
      case 'S': return { x: cx, y: g.y + g.height }
      default: return { x: cx, y: g.y }
    }
  }

  // Free-channel centers: midpoints of the gaps between sorted box boundaries
  // along an axis — deterministic, obstacle-derived homes for detour segments
  // when a canonical route below is blocked. Intervals an orthogonal segment
  // cannot actually fit through (≤2px, given the 1px route clearance) are
  // skipped; blocked candidates are weeded out by routeClearOfNodes anyway.
  const channelCenters = (axis: 'x' | 'y'): number[] => {
    const stops = new Set<number>()
    for (const n of nodes) { stops.add(n[axis]); stops.add(n[axis] + (axis === 'x' ? n.width : n.height)) }
    const sorted = [...stops].sort((a, b) => a - b)
    const centers: number[] = []
    for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! > 2) centers.push((sorted[i]! + sorted[i - 1]!) / 2)
    return centers
  }
  const crossAxis: 'x' | 'y' = f.main === 'x' ? 'y' : 'x'
  const byProximity = (values: number[], anchor: number): number[] =>
    [...values].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b).slice(0, 16)

  // Reconnect every edge after the rank-distance move so no endpoint is left
  // pointing at a node's pre-move position (which would trip the route-staleness
  // certifier). Primary-forward / cross-hierarchy / container links get a forward
  // dogleg between their (node or box) ports; feedback (back) edges re-loop
  // through the outer lane; self-loops ride along with their moved node.
  // applyRouteContracts certifies the final geometry.
  for (const edge of edges) {
    const cls = edge.edgeIndex !== undefined ? (classes[edge.edgeIndex] ?? 'primary-forward') : 'primary-forward'
    if (cls === 'self-loop') {
      const delta = mainDelta.get(edge.source) ?? 0
      if (delta !== 0) for (const p of edge.points) p[f.main] += delta
      if (delta !== 0 && edge.labelPosition) edge.labelPosition[f.main] += delta
      continue
    }
    if (cls === 'feedback') {
      const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
      if (!source || !target) continue
      // Feedback U-detour: drop to the outer lane at the source, run back along
      // it, and rise into the target — both anchored at the max-cross side. A
      // riser can cross a bystander sitting between the node and the lane
      // (issue #81's no-overlap residual). When — and only when — the max-side
      // U is blocked, fall back deterministically: the min-side lane, then a
      // rung variant per lane that leaves the lane at a free channel and
      // approaches the blocked endpoint through a clear column (the center
      // anchors stay on-outline for every shape, unlike sliding a riser
      // off-center). If everything is blocked, keep the canonical max-side
      // route for the post-freeze net to repair.
      const mSrc = nodeMainCenter(source, graph.direction), mTgt = nodeMainCenter(target, graph.direction)
      const uDetour = (lane: number, edgeCross: (n: PositionedNode) => number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, lane), point(mTgt, lane), point(mTgt, edgeCross(target)),
      ]
      const rungTarget = (lane: number, edgeCross: (n: PositionedNode) => number, mRung: number, col: number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, lane), point(mRung, lane), point(mRung, col), point(mTgt, col), point(mTgt, edgeCross(target)),
      ]
      const rungSource = (lane: number, edgeCross: (n: PositionedNode) => number, mRung: number, col: number): Point[] => [
        point(mSrc, edgeCross(source)), point(mSrc, col), point(mRung, col), point(mRung, lane), point(mTgt, lane), point(mTgt, edgeCross(target)),
      ]
      const ends = new Set([edge.source, edge.target])
      const clear = (pts: Point[]): boolean => routeClearOfNodes(simplifyPolyline(pts), nodes, ends)
      const lanes: Array<[number, (n: PositionedNode) => number]> = [[laneCross, crossMaxEdge], [laneCrossMin, crossMinEdge]]
      let route: Point[] | undefined
      for (const [lane, edgeCross] of lanes) {
        const candidate = uDetour(lane, edgeCross)
        if (clear(candidate)) { route = candidate; break }
      }
      if (!route) {
        const rungMains = byProximity(channelCenters(f.main === 'x' ? 'x' : 'y'), mTgt)
        search: for (const [lane, edgeCross] of lanes) {
          const cols = byProximity(channelCenters(crossAxis), edgeCross(target))
          for (const build of [rungTarget, rungSource]) {
            for (const mRung of rungMains) {
              for (const col of cols) {
                const candidate = build(lane, edgeCross, mRung, col)
                if (clear(candidate)) { route = simplifyPolyline(candidate); break search }
              }
            }
          }
        }
      }
      edge.points = route ?? uDetour(laneCross, crossMaxEdge)
      if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
      continue
    }
    const start = flowPort(edge.source, f.sourceSide)
    const end = flowPort(edge.target, f.targetSide)
    if (!start || !end) continue
    // A midpoint elbow can put the dogleg's cross run or its entry riser
    // through a bystander box. When — and only when — the midpoint dogleg is
    // blocked, fall back deterministically: single elbows at free-channel
    // centers between the ports (nearest the midpoint first), then a
    // double-elbow staircase whose cross run rides a free column (the rep2
    // shape in eval/degenerate-etn: a bystander sitting over the target's
    // entry port, threadable only through the channel beside it). If every
    // variant is blocked, keep the midpoint for the post-freeze net to repair.
    const ends = new Set([edge.source, edge.target])
    const clear = (pts: Point[]): boolean => routeClearOfNodes(pts, nodes, ends)
    const lo = Math.min(start[f.main], end[f.main]), hi = Math.max(start[f.main], end[f.main])
    let route = doglegBetween(start, end, graph.direction, (lo + hi) / 2)
    if (!clear(route)) {
      let found: Point[] | undefined
      const mains = byProximity(channelCenters(f.main === 'x' ? 'x' : 'y').filter(m => m > lo && m < hi), (lo + hi) / 2)
      for (const m of mains) {
        const candidate = doglegBetween(start, end, graph.direction, m)
        if (clear(candidate)) { found = candidate; break }
      }
      if (!found) {
        const cS = start[crossAxis], cE = end[crossAxis]
        const cols = byProximity(channelCenters(crossAxis), (cS + cE) / 2)
        staircase: for (const col of cols) {
          for (const m1 of mains) {
            for (const m2 of byProximity(mains.filter(m => (m - m1) * f.sign > 0), end[f.main])) {
              const candidate = simplifyPolyline([start, point(m1, cS), point(m1, col), point(m2, col), point(m2, cE), end])
              if (clear(candidate)) { found = candidate; break staircase }
            }
          }
        }
      }
      if (found) route = found
    }
    edge.points = route
    if (edge.label) edge.labelPosition = calculatePathMidpoint(edge.points)
  }
}
/**
 * Post-freeze safety net for STALE edge endpoints. A pass that MOVES a node is
 * responsible for re-anchoring the edges incident to it (honorLinkRankDistance,
 * above, rebuilds its own); but equalizePeerNodeDimensions repositions a fan-in
 * peer without touching a cone edge INTO it (an upstream `U --> S` where S also
 * fans into a hub), so that edge is left pointing at S's pre-move position and
 * its endpoint dangles OFF the moved outline — offOutlineEndpoints (or, if it
 * grazes a neighbour, edgeThroughNode). applyRouteContracts certifies the stale
 * route rather than re-anchoring it. After the freeze, re-route any edge whose
 * endpoint sits off its node's outline as an orthogonal dogleg between the two
 * nodes' flow-side ports, landing the endpoint back on the outline.
 *
 * Fires ONLY on an already-off-outline endpoint — which the HARD-clean corpus
 * never has — so it is a strict no-op there and byte-exact equivalence holds. A
 * rebuilt route is adopted only when it clears every other node (an on-outline
 * endpoint is not worth trading for an edgeThroughNode); self-loops are skipped
 * (their stub is the renderer's). Deterministic; label re-centred on the new route.
 */
export function reanchorOffOutlineEndpoints(nodes: PositionedNode[], edges: PositionedEdge[], graph: MermaidGraph): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  for (const edge of edges) {
    if (edge.source === edge.target || edge.points.length < 2) continue
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (!source || !target) continue
    const srcOff = !onShapeOutline(source, edge.points[0]!)
    const tgtOff = !onShapeOutline(target, edge.points[edge.points.length - 1]!)
    if (!srcOff && !tgtOff) continue
    const start = shapePorts(source)[f.sourceSide]
    const end = shapePorts(target)[f.targetSide]
    const route = doglegBetween(start, end, graph.direction, (start[f.main] + end[f.main]) / 2)
    if (!routeClearOfNodes(route, nodes, new Set([edge.source, edge.target]))) continue
    const savedCert = edge.routeCertificate
    edge.points = route
    recertifyReroutedEdge(edge, savedCert, source, target)
    if (edge.label) edge.labelPosition = calculatePathMidpoint(route)
  }
}
/**
 * Post-freeze safety net for the NODE-MOVE -> edgeThroughNode class — the
 * on-outline-endpoint sibling of reanchorOffOutlineEndpoints (above). A pass that
 * MOVES a node must keep the edges incident to it clear of every OTHER node, but
 * honorLinkRankDistance rebuilds a lengthened skip link, and alignPortLanes
 * straightens a feedback edge, as a plain dogleg WITHOUT a clearance check
 * (unlike applySymmetricFanoutEmissions): a link that skips a collinear node
 * (`A ===> C` over B) or a feedback whose return lane a peer moved into
 * (`T1 --> S1` past S2) is left running straight THROUGH that node.
 * applyRouteContracts cannot always repair it — its Z has no in-span escape lane
 * when the obstacle is as tall as the endpoints, and its escape detour's exit stub
 * is rejected as a channel conflict when a sibling shares the source lane — so the
 * through-node route is certified as-is. Its endpoints stay port-exact (ON the
 * outline), which is why reanchorOffOutlineEndpoints, keyed on OFF-outline
 * endpoints, never sees it.
 *
 * After the freeze, re-route any edge whose polyline passes through a non-endpoint
 * node (the rubric's exact edgeThroughNode predicate). The endpoints are kept —
 * they are correct ports — and only the interior is detoured around the obstacle:
 * first by sliding a blocked INTERIOR segment sideways to the nearest parallel lane
 * that clears every node (fixes a feedback U-route a peer intruded on, preserving
 * its shape), else by BRACKETING the route over/under the obstacle band between its
 * two ports (fixes a straight skip link through a collinear node). A detour is
 * adopted ONLY when it clears every node and both endpoints stay on their outlines;
 * otherwise the edge is left untouched (never traded for a worse route).
 *
 * Fires ONLY on an edge the rubric already flags edgeThroughNode — which the
 * HARD-clean corpus never has — so it is a strict no-op there and byte-exact
 * equivalence holds. Edge-only, deterministic (fixed candidate order); label
 * re-centred on the new route. Self-loops are skipped.
 */
export function rerouteEdgesThroughNodes(nodes: PositionedNode[], edges: PositionedEdge[], graph: MermaidGraph): void {
  const f = layoutFlow(graph.direction)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const THROUGH_LANE_GAP = 10
  const throughNode = (pts: Point[], skip: ReadonlySet<string>): boolean => {
    for (const n of nodes) {
      if (skip.has(n.id)) continue
      for (let i = 1; i < pts.length; i++) if (segmentThroughShape(pts[i - 1]!, pts[i]!, n)) return true
    }
    return false
  }
  // Slide a blocked INTERIOR (non-terminal) axis-aligned segment sideways to the
  // nearest parallel lane clear of every node, keeping the polyline's endpoints
  // and orthogonal shape. Only shifts when both neighbours are perpendicular to
  // the segment (so the slide cannot bend a neighbour into a diagonal).
  const shiftInteriorSegment = (pts: Point[], skip: ReadonlySet<string>): Point[] | null => {
    for (let k = 1; k <= pts.length - 3; k++) {
      const a = pts[k]!, b = pts[k + 1]!, before = pts[k - 1]!, after = pts[k + 2]!
      const vertical = Math.abs(a.x - b.x) < 0.5, horizontal = Math.abs(a.y - b.y) < 0.5
      if (vertical === horizontal) continue // diagonal or degenerate — leave it
      if (!throughNode([a, b], skip)) continue // not the offending segment
      const ax: 'x' | 'y' = vertical ? 'x' : 'y'
      const perp: 'x' | 'y' = vertical ? 'y' : 'x'
      if (Math.abs(before[perp] - a[perp]) > 0.5 || Math.abs(after[perp] - b[perp]) > 0.5) continue
      const c = a[ax]
      const cands: number[] = []
      for (const n of nodes) {
        if (skip.has(n.id)) continue
        cands.push(n[ax] - THROUGH_LANE_GAP, n[ax] + (ax === 'x' ? n.width : n.height) + THROUGH_LANE_GAP)
      }
      cands.sort((p, q) => Math.abs(p - c) - Math.abs(q - c))
      for (const cp of cands) {
        const trial = pts.map(p => ({ ...p }))
        trial[k]![ax] = cp; trial[k + 1]![ax] = cp
        if (!throughNode(trial, skip) && routeClearOfNodes(trial, nodes, skip)) return simplifyPolyline(trial)
      }
    }
    return null
  }
  // Bracket a route over/under an obstacle, exiting the source and entering the
  // target along the flow axis: a short stub off each port, a jog to a clear
  // cross-lane, and the corridor run between. Keeps both ports. Candidate lanes
  // are just past EACH corridor obstacle's cross-edges (so a lane in the gap
  // between two obstacles is reachable, e.g. a feedback that must pass between the
  // target and an unrelated node beside it) plus the whole-band edges as a
  // fallback — nearest the ports first. This handles both the forward skip link
  // and the feedback U-route whose return segment cut a node beside the target.
  const bracketOverBand = (pts: Point[], skip: ReadonlySet<string>): Point[] | null => {
    const start = pts[0]!, end = pts[pts.length - 1]!
    const mLo = Math.min(start[f.main], end[f.main]), mHi = Math.max(start[f.main], end[f.main])
    let bandLo = Infinity, bandHi = -Infinity
    const laneSet: number[] = []
    for (const n of nodes) {
      if (skip.has(n.id)) continue
      const ns = n[f.main], ne = n[f.main] + (f.main === 'x' ? n.width : n.height)
      if (ne <= mLo || ns >= mHi) continue // outside the corridor
      const cs = nodeCrossStart(n, graph.direction), ce = cs + nodeCrossSize(n, graph.direction)
      bandLo = Math.min(bandLo, cs); bandHi = Math.max(bandHi, ce)
      laneSet.push(cs - THROUGH_LANE_GAP, ce + THROUGH_LANE_GAP) // just past this obstacle's edges
    }
    if (!Number.isFinite(bandLo)) return null
    laneSet.push(bandLo - THROUGH_LANE_GAP, bandHi + THROUGH_LANE_GAP) // whole-band fallback
    const pt = (mainV: number, crossV: number): Point => (f.main === 'x' ? { x: mainV, y: crossV } : { x: crossV, y: mainV })
    const dir = Math.sign(end[f.main] - start[f.main]) || 1
    const stub = Math.min(12, Math.abs(end[f.main] - start[f.main]) / 3)
    const m1 = start[f.main] + dir * stub, m2 = end[f.main] - dir * stub
    const mean = (start[f.cross] + end[f.cross]) / 2
    const lanes = [...new Set(laneSet)].sort((p, q) => Math.abs(p - mean) - Math.abs(q - mean))
    for (const lane of lanes) {
      const route = simplifyPolyline([start, pt(m1, start[f.cross]), pt(m1, lane), pt(m2, lane), pt(m2, end[f.cross]), end])
      if (!throughNode(route, skip) && routeClearOfNodes(route, nodes, skip)) return route
    }
    return null
  }
  for (const edge of edges) {
    if (edge.source === edge.target || edge.points.length < 2) continue
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (!source || !target) continue
    const skip = new Set([edge.source, edge.target])
    if (!throughNode(edge.points, skip)) continue // no-op gate: only fires on edgeThroughNode
    // Off-outline endpoints are reanchorOffOutlineEndpoints' job; this pass only
    // relocates the interior of an otherwise port-exact route.
    if (!onShapeOutline(source, edge.points[0]!) || !onShapeOutline(target, edge.points[edge.points.length - 1]!)) continue
    const route = shiftInteriorSegment(edge.points, skip) ?? bracketOverBand(edge.points, skip)
    if (!route) continue // never-worse: no clean detour found, leave as-is
    const savedCert = edge.routeCertificate
    edge.points = route
    recertifyReroutedEdge(edge, savedCert, source, target)
    if (edge.label) edge.labelPosition = calculatePathMidpoint(route)
  }
}
function shiftTerminalRunCross(edge: PositionedEdge, direction: Direction, fromEnd: boolean, delta: number): void {
  if (edge.points.length === 0) return
  const f = layoutFlow(direction)
  const idx = fromEnd ? edge.points.length - 1 : 0
  const step = fromEnd ? -1 : 1
  const ref = edge.points[idx]![f.cross]
  let mainLo = Infinity
  let mainHi = -Infinity
  for (let i = idx; i >= 0 && i < edge.points.length; i += step) {
    if (Math.abs(edge.points[i]![f.cross] - ref) > 0.5) break
    mainLo = Math.min(mainLo, edge.points[i]![f.main])
    mainHi = Math.max(mainHi, edge.points[i]![f.main])
    edge.points[i]![f.cross] += delta
  }
  if (edge.labelPosition &&
    Math.abs(edge.labelPosition[f.cross] - ref) <= 12 &&
    edge.labelPosition[f.main] >= mainLo - 0.5 &&
    edge.labelPosition[f.main] <= mainHi + 0.5) {
    edge.labelPosition[f.cross] += delta
  }
}
function shiftNodeSetCross(
  movedIds: ReadonlySet<string>,
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  delta: number,
): void {
  const f = layoutFlow(direction)
  for (const node of nodes) {
    if (!movedIds.has(node.id)) continue
    node[f.cross] += delta
  }
  for (const edge of edges) {
    const srcMoved = movedIds.has(edge.source)
    const tgtMoved = movedIds.has(edge.target)
    if (srcMoved && tgtMoved) {
      for (const point of edge.points) point[f.cross] += delta
      if (edge.labelPosition) edge.labelPosition[f.cross] += delta
    } else if (tgtMoved) {
      shiftTerminalRunCross(edge, direction, true, delta)
    } else if (srcMoved) {
      shiftTerminalRunCross(edge, direction, false, delta)
    }
  }
}
function crossShiftSafe(
  movedIds: ReadonlySet<string>,
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  delta: number,
  style: LabelMetricsStyle,
): boolean {
  const f = layoutFlow(direction)
  const moved = nodes.filter(node => movedIds.has(node.id))
  const shifted = new Map(moved.map(node => [node.id, {
    x: f.isHorizontal ? node.x : node.x + delta,
    y: f.isHorizontal ? node.y + delta : node.y,
    width: node.width,
    height: node.height,
  }]))
  for (const box of shifted.values()) {
    if (box.x < 0 || box.y < 0) return false
  }
  for (let i = 0; i < moved.length; i++) {
    const a = shifted.get(moved[i]!.id)!
    for (let j = i + 1; j < moved.length; j++) {
      if (rectsOverlap(a, shifted.get(moved[j]!.id)!, 8)) return false
    }
    for (const other of nodes) {
      if (movedIds.has(other.id)) continue
      if (rectsOverlap(a, other, 8)) return false
    }
  }
  for (const node of moved) {
    const box = shifted.get(node.id)!
    for (const edge of edges) {
      if (movedIds.has(edge.source) || movedIds.has(edge.target)) continue
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        if (Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.width - 0.5 &&
          Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.height - 0.5) return false
      }
      const rect = labelRect(edge, style)
      if (rect && rectsOverlap(box, { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, 8)) return false
    }
  }
  return true
}
export function collapseTinyBundledHitches(nodes: PositionedNode[], edges: PositionedEdge[], bundled: Set<PositionedEdge>): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const edge of edges) {
    if (!bundled.has(edge) || edge.label || edge.points.length !== 4) continue
    const [a, b, c, d] = edge.points
    if (!a || !b || !c || !d) continue
    const target = nodeMap.get(edge.target)
    if (!target || target.shape !== 'rectangle') continue
    const exclude = new Set([edge.source, edge.target])
    if (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.x - c.x) < 0.01 && Math.abs(c.y - d.y) < 0.01 && Math.abs(b.y - c.y) <= 6) {
      const end = { x: d.x, y: a.y }
      const onTargetSide = Math.abs(d.x - target.x) < 0.01 || Math.abs(d.x - (target.x + target.width)) < 0.01
      if (onTargetSide && end.y >= target.y - 0.5 && end.y <= target.y + target.height + 0.5 && routeClearOfNodes([a, end], nodes, exclude)) {
        edge.points = [a, end]
        edge.routeCertificate = undefined
      }
      continue
    }
    if (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.y - c.y) < 0.01 && Math.abs(c.x - d.x) < 0.01 && Math.abs(b.x - c.x) <= 6) {
      const end = { x: a.x, y: d.y }
      const onTargetSide = Math.abs(d.y - target.y) < 0.01 || Math.abs(d.y - (target.y + target.height)) < 0.01
      if (onTargetSide && end.x >= target.x - 0.5 && end.x <= target.x + target.width + 0.5 && routeClearOfNodes([a, end], nodes, exclude)) {
        edge.points = [a, end]
        edge.routeCertificate = undefined
      }
    }
  }
}
function labelBoxAt(label: string, center: Point, style: LabelMetricsStyle): { x: number; y: number; width: number; height: number } {
  const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
  return {
    x: center.x - (metrics.width + 16) / 2,
    y: center.y - (metrics.height + 16) / 2,
    width: metrics.width + 16,
    height: metrics.height + 16,
  }
}
function longestSegmentMidpoint(points: Point[]): Point {
  let best: [Point, Point] = [points[0]!, points[points.length - 1]!]
  let bestLength = -1
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > bestLength) { bestLength = length; best = [a, b] }
  }
  return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 }
}
interface BundledLabelCandidate {
  point: Point
  box: { x: number; y: number; width: number; height: number }
  rank: number
  pathDistance: number
  routeMidpointDistance: number
  segmentMidpointDistance: number
  straightRunPenalty: number
  terminalSegmentPenalty: number
}
function readableLabelGap(style: LabelMetricsStyle): number {
  return Math.max(8, style.edgeLabelFontSize * 0.75)
}
function labelPortStubGap(style: LabelMetricsStyle): number {
  return Math.max(12, style.edgeLabelFontSize)
}
function terminalMarkerGap(style: LabelMetricsStyle, edge: PositionedEdge): number {
  const lineWidth = (style as LabelMetricsStyle & { lineWidth?: number }).lineWidth ?? 1
  const strokeWidth = edge.style === 'thick' ? lineWidth * 2 : lineWidth
  return Math.max(18, style.edgeLabelFontSize + ARROW_HEAD.width + strokeWidth * 2)
}
function maxTerminalMarkerGap(style: LabelMetricsStyle): number {
  const lineWidth = (style as LabelMetricsStyle & { lineWidth?: number }).lineWidth ?? 1
  const maxStrokeWidth = lineWidth * 2
  return Math.max(18, style.edgeLabelFontSize + ARROW_HEAD.width + maxStrokeWidth * 2)
}
function maxEdgeStyleWitnessGap(): number {
  return FLOWCHART_DOTTED_DASH.dash * 3 + FLOWCHART_DOTTED_DASH.gap * 2
}
function terminalReadableGap(style: LabelMetricsStyle): number {
  return maxTerminalMarkerGap(style) + maxEdgeStyleWitnessGap()
}
function labelHalfExtentAlongSegment(
  box: { width: number; height: number },
  a: Point,
  b: Point,
): number {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? box.width / 2 : box.height / 2
}
function clearsTerminalMarkers(
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
function labelEndpointGaps(edge: PositionedEdge, points: Point[], segmentIndex: number, style: LabelMetricsStyle): { start: number; end: number } {
  return {
    start: edge.hasArrowStart && segmentIndex === 1 ? maxTerminalMarkerGap(style) : labelPortStubGap(style),
    end: edge.hasArrowEnd && segmentIndex === points.length - 1 ? terminalReadableGap(style) : labelPortStubGap(style),
  }
}
function segmentAlignedWithFlow(a: Point, b: Point, direction: Direction): boolean {
  return layoutFlow(direction).isHorizontal
    ? Math.abs(a.y - b.y) < 0.01
    : Math.abs(a.x - b.x) < 0.01
}
function labelFitsInsideSegment(
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
function feasibleLabelSlots(box: { width: number; height: number }, a: Point, b: Point, gaps: { start: number; end: number }): number[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length === 0) return []
  const halfExtent = labelHalfExtentAlongSegment(box, a, b)
  const start = (halfExtent + gaps.start) / length
  const end = 1 - (halfExtent + gaps.end) / length
  if (start > end) return []
  return [(start + end) / 2]
}
function terminalLabelRunLength(
  edge: PositionedEdge,
  direction: Direction,
  style: LabelMetricsStyle,
  sourceBoundary: number,
  targetBoundary: number,
): number {
  if (!edge.label) return 0
  const f = layoutFlow(direction)
  const box = labelBoxAt(edge.label, { x: 0, y: 0 }, style)
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
function terminalLabelCorridorLength(edge: PositionedEdge, direction: Direction, style: LabelMetricsStyle): number {
  if (!edge.label) return 0
  const box = labelBoxAt(edge.label, { x: 0, y: 0 }, style)
  const labelExtent = layoutFlow(direction).isHorizontal ? box.width : box.height
  const visibleGap = Math.max(
    labelPortStubGap(style),
    edge.hasArrowEnd ? terminalReadableGap(style) : labelPortStubGap(style),
  )
  return labelExtent + visibleGap * 3
}
function bundledLabelCandidates(edge: PositionedEdge, points: Point[], nodes: PositionedNode[], direction: Direction, style: LabelMetricsStyle): BundledLabelCandidate[] {
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
    const baseBox = labelBoxAt(edge.label, { x: 0, y: 0 }, style)
    const gaps = labelEndpointGaps(edge, points, i, style)
    const segmentSlots = [...slots, ...feasibleLabelSlots(baseBox, a, b, gaps)]
      .filter((slot, index, all) => slot >= 0 && slot <= 1 && all.findIndex(other => Math.abs(other - slot) < 0.001) === index)
    for (let order = 0; order < segmentSlots.length; order++) {
      const t = segmentSlots[order]!
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const box = labelBoxAt(edge.label, point, style)
      if (nodes.some(node => rectsOverlap(box, node, 2))) continue
      if (!clearsTerminalMarkers(edge, points, i, point, box, style)) continue
      const fitsInsideSegment = labelFitsInsideSegment(box, point, a, b, gaps)
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
function bestBundledLabelPosition(edge: PositionedEdge, points: Point[], nodes: PositionedNode[], direction: Direction, style: LabelMetricsStyle): Point {
  return bundledLabelCandidates(edge, points, nodes, direction, style)[0]?.point ?? calculatePathMidpoint(points)
}
function bundledLabelAssignmentCost(chosen: BundledLabelCandidate[], direction: Direction): number {
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
  const box = labelBoxAt(edge.label, target, style)
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
function assignBundledFanoutLabels(
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
): void {
  const labeled = proposed.filter(({ edge }) => edge.label)
  if (labeled.length === 0) return
  if (labeled.length === 1) {
    const only = labeled[0]!
    only.edge.labelPosition = bestBundledLabelPosition(only.edge, only.points, nodes, direction, style)
  } else {
    const candidateSets = labeled.map(({ edge, points }) => bundledLabelCandidates(edge, points, nodes, direction, style))
    if (candidateSets.some(candidates => candidates.length === 0)) {
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
  if (!recenter) return
  const siblingBoxes: Array<{ x: number; y: number; width: number; height: number }> = []
  const gap = readableLabelGap(style)
  for (const { edge } of labeled) {
    if (edge.labelPosition) siblingBoxes.push(labelBoxAt(edge.label!, edge.labelPosition, style))
  }
  for (let i = 0; i < labeled.length; i++) {
    const { edge, points } = labeled[i]!
    const before = edge.labelPosition
    const others = siblingBoxes.filter((_, j) => j !== i)
    recenterBundledLabelOnMainAxis(edge, points, nodes, direction, style, others, gap)
    // Keep the sibling-box list current so a later edge sees this one's new spot.
    if (edge.labelPosition && edge.labelPosition !== before) siblingBoxes[i] = labelBoxAt(edge.label!, edge.labelPosition, style)
  }
}
export function reassignBundledSiblingLabels(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  bundled: ReadonlySet<PositionedEdge>,
  direction: Direction,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!bundled.has(edge) || !edge.label || !positionedEdgeForwardish(edge, nodeMap, direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(edge)
  }
  for (const group of bySource.values()) {
    if (group.length < 2 || group.length > 3) continue
    if (new Set(group.map(edge => edge.target)).size < group.length) continue
    const sorted = [...group].sort((a, b) => {
      const aTarget = nodeMap.get(a.target)
      const bTarget = nodeMap.get(b.target)
      if (!aTarget || !bTarget) return (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0)
      return nodeCrossCenter(aTarget, direction) - nodeCrossCenter(bTarget, direction)
    })
    assignBundledFanoutLabels(sorted.map(edge => ({ edge, points: edge.points })), nodes, direction, style)
  }
}
export function applySymmetricFanoutEmissions(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const bySource = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (!positionedEdgeForwardish(edge, nodeMap, graph.direction)) continue
    if (!bySource.has(edge.source)) bySource.set(edge.source, [])
    bySource.get(edge.source)!.push(edge)
  }
  const f = layoutFlow(graph.direction)
  for (const [sourceId, raw] of bySource) {
    if (raw.length < 2 || raw.length > 3) continue
    const source = nodeMap.get(sourceId)
    if (!source || (source.shape !== 'rectangle' && source.shape !== 'diamond')) continue
    const sourceInGroup = nodeInsideGroups(source, groups)
    if (source.shape !== 'diamond' && sourceInGroup) continue
    const sorted = [...raw].sort((a, b) => nodeCrossCenter(nodeMap.get(a.target)!, graph.direction) - nodeCrossCenter(nodeMap.get(b.target)!, graph.direction))
    const targets = sorted.map(e => nodeMap.get(e.target)!).filter(Boolean)
    if (targets.length !== sorted.length) continue
    if (!targets.every(t => t.shape === 'rectangle' && (source.shape === 'diamond' || !nodeInsideGroups(t, groups)))) continue
    // Same-rank gate. Fan-out targets drift apart on the main axis when their
    // label widths differ ("warnings" 97px vs "ok" 60px → ~32px apart), so the
    // tolerance must clear that width-driven drift to see them as peers — while
    // staying below layerSpacing (48) so genuinely different ranks are still
    // rejected. The peer confirmation just below is the real safety net, so
    // loosening this gate cannot equalize non-peers. (Equalizing such peers is
    // exactly the symmetry the diamond/"warnings"/"ok" fan-out wants; verified
    // byte-identical on the corpus, which has no fan-out in the 28–40px band.)
    if (!sameFlowLayer(targets, graph.direction, 40)) continue
    if (!targets.every(t => edges.every(e => e.source !== t.id && (e.target !== t.id || e.source === source.id)))) continue
    let peer = true
    for (let i = 0; i < targets.length; i++) for (let j = 0; j < targets.length; j++) {
      if (i !== j && logicalGraphReaches(graph, targets[i]!.id, targets[j]!.id)) peer = false
    }
    if (!peer) continue

    const oldTargets = targets.map(t => ({ t, x: t.x, y: t.y, width: t.width, height: t.height }))
    const oldGroups = flattenPositionedGroups(groups).map(group => ({ group, x: group.x, y: group.y, width: group.width, height: group.height }))
    const restoreGeometry = () => {
      for (const old of oldTargets) { old.t.x = old.x; old.t.y = old.y; old.t.width = old.width; old.t.height = old.height }
      for (const old of oldGroups) { old.group.x = old.x; old.group.y = old.y; old.group.width = old.width; old.group.height = old.height }
    }
    const maxWidth = Math.max(...targets.map(t => t.width))
    const maxHeight = Math.max(...targets.map(t => t.height))
    const axis = nodeCrossCenter(source, graph.direction)
    const rank = Math.min(...targets.map(t => nodeMainStart(t, graph.direction)))
    const spacing = (f.isHorizontal ? maxHeight : maxWidth) + 28
    const offsets = symmetricOffsets(targets.length, spacing)
    const sourceAlignedCross = source.shape === 'diamond'
      ? sorted.map((_, i) => sourceEmissionPort(source, graph.direction, i, sorted.length)[f.cross])
      : undefined
    const placeTargets = (crossCenters: number[]) => {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        target.width = maxWidth
        target.height = maxHeight
        if (f.isHorizontal) {
          target.x = rank
          target.y = crossCenters[i]! - maxHeight / 2
        } else {
          target.x = crossCenters[i]! - maxWidth / 2
          target.y = rank
        }
      }
    }
    placeTargets(sourceAlignedCross ?? offsets.map(offset => axis + offset))
    const targetIds = new Set(targets.map(t => t.id))
    const placementClear = (): boolean => {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!
        if (target.x < 0 || target.y < 0) return false
        for (let j = i + 1; j < targets.length; j++) {
          if (rectsOverlap(target, targets[j]!, 8)) return false
        }
      }
      for (const target of targets) {
        for (const other of nodes) {
          if (targetIds.has(other.id)) continue
          if (rectsOverlap(target, other, 8)) return false
        }
      }
      return true
    }
    let clear = placementClear()
    if (!clear && sourceAlignedCross) {
      placeTargets(offsets.map(offset => axis + offset))
      clear = placementClear()
    }
    if (!clear) {
      restoreGeometry()
      continue
    }

    const sourceEdge = f.isHorizontal
      ? (f.sourceSide === 'E' ? source.x + source.width : source.x)
      : (f.sourceSide === 'S' ? source.y + source.height : source.y)
    let targetEdge = f.isHorizontal
      ? (f.sign > 0 ? Math.min(...targets.map(t => t.x)) : Math.max(...targets.map(t => t.x + t.width)))
      : (f.sign > 0 ? Math.min(...targets.map(t => t.y)) : Math.max(...targets.map(t => t.y + t.height)))
    const requiredCorridor = Math.max(0, ...sorted.map(edge => terminalLabelCorridorLength(edge, graph.direction, style)))
    const currentCorridor = (targetEdge - sourceEdge) * f.sign
    if (requiredCorridor > currentCorridor + 0.001) {
      const delta = requiredCorridor - currentCorridor
      const targetRectsBeforeShift = targets.map(t => ({ x: t.x, y: t.y, width: t.width, height: t.height }))
      for (const target of targets) {
        if (f.isHorizontal) target.x += delta * f.sign
        else target.y += delta * f.sign
      }
      expandGroupsForMainShift(groups, targetRectsBeforeShift, graph.direction, delta)
      clear = placementClear()
      if (!clear) {
        restoreGeometry()
        continue
      }
      targetEdge = f.isHorizontal
        ? (f.sign > 0 ? Math.min(...targets.map(t => t.x)) : Math.max(...targets.map(t => t.x + t.width)))
        : (f.sign > 0 ? Math.min(...targets.map(t => t.y)) : Math.max(...targets.map(t => t.y + t.height)))
    }
    const requiredTerminalRun = Math.max(0, ...sorted.map(edge => terminalLabelRunLength(edge, graph.direction, style, sourceEdge, targetEdge)))
    const midpointElbow = sourceEdge + (targetEdge - sourceEdge) * 0.5
    const capacityElbow = targetEdge - f.sign * requiredTerminalRun
    const elbow = ((capacityElbow - midpointElbow) * f.sign < 0) ? capacityElbow : midpointElbow
    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    for (let i = 0; i < sorted.length; i++) {
      const edge = sorted[i]!
      const target = nodeMap.get(edge.target)!
      const points = doglegBetween(sourceEmissionPort(source, graph.direction, i, sorted.length), targetFlowPort(target, graph.direction), graph.direction, elbow)
      if (!routeClearOfNodes(points, nodes, new Set([edge.source, edge.target]))) { clear = false; break }
      proposed.push({ edge, points })
    }
    if (!clear) {
      restoreGeometry()
      continue
    }
    for (const { edge, points } of proposed) {
      edge.points = points
      edge.routeCertificate = undefined
      bundled.add(edge)
    }
    assignBundledFanoutLabels(proposed, nodes, graph.direction, style)
  }
}
function segmentIntersectsLabelBox(a: Point, b: Point, box: { x: number; y: number; w: number; h: number }, pad = 2): boolean {
  const x1 = box.x - pad, x2 = box.x + box.w + pad, y1 = box.y - pad, y2 = box.y + box.h + pad
  if (Math.abs(a.x - b.x) < 0.01) {
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y)
    return a.x >= x1 && a.x <= x2 && hi >= y1 && lo <= y2
  }
  if (Math.abs(a.y - b.y) < 0.01) {
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x)
    return a.y >= y1 && a.y <= y2 && hi >= x1 && lo <= x2
  }
  return false
}
function labelTouchesNeighborRoute(edge: PositionedEdge, labelBox: { x: number; y: number; w: number; h: number }, edges: PositionedEdge[]): boolean {
  for (const other of edges) {
    if (other === edge) continue
    for (let i = 1; i < other.points.length; i++) {
      if (segmentIntersectsLabelBox(other.points[i - 1]!, other.points[i]!, labelBox)) return true
    }
  }
  return false
}
function symmetricParallelOuterLanePoints(source: PositionedNode, target: PositionedNode, direction: Direction, lane: number, index: number, count: number): Point[] {
  const f = layoutFlow(direction)
  const t = (index + 1) / (count + 1)
  if (f.isHorizontal) {
    const p: Point = { x: f.sourceSide === 'E' ? source.x + source.width : source.x, y: source.y + source.height * t }
    const q: Point = { x: f.targetSide === 'W' ? target.x : target.x + target.width, y: target.y + target.height * t }
    const gap = Math.min(28, Math.max(14, Math.abs(q.x - p.x) * 0.18))
    const x1 = p.x + f.sign * gap
    const x2 = q.x - f.sign * gap
    return simplifyPolyline([p, { x: x1, y: p.y }, { x: x1, y: lane }, { x: x2, y: lane }, { x: x2, y: q.y }, q])
  }
  const p: Point = { x: source.x + source.width * t, y: f.sourceSide === 'S' ? source.y + source.height : source.y }
  const q: Point = { x: target.x + target.width * t, y: f.targetSide === 'N' ? target.y : target.y + target.height }
  const gap = Math.min(28, Math.max(14, Math.abs(q.y - p.y) * 0.18))
  const y1 = p.y + f.sign * gap
  const y2 = q.y - f.sign * gap
  return simplifyPolyline([p, { x: p.x, y: y1 }, { x: lane, y: y1 }, { x: lane, y: y2 }, { x: q.x, y: y2 }, q])
}
export function applySymmetricParallelEdgeLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
  style: LabelMetricsStyle,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  const byPair = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target || !edge.label) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target || source.shape !== 'rectangle' || target.shape !== 'rectangle') continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    const key = `${edge.source}\0${edge.target}`
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key)!.push(edge)
  }
  for (const group of byPair.values()) {
    group.sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
    if (group.length !== 2) continue
    const source = nodeMap.get(group[0]!.source)!
    const target = nodeMap.get(group[0]!.target)!
    const labelWidths = group.map(e => measureMultilineText(e.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight).width + 16)
    const labelHeights = group.map(e => measureMultilineText(e.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight).height + 16)
    const lanePadding = (f.isHorizontal ? Math.max(...labelHeights) : Math.max(...labelWidths)) / 2 + 18
    const attempts = [lanePadding, lanePadding + 16, lanePadding + 32, lanePadding + 52]
    for (const gap of attempts) {
      const lanes = f.isHorizontal
        ? [Math.min(source.y, target.y) - gap, Math.max(source.y + source.height, target.y + target.height) + gap]
        : [Math.min(source.x, target.x) - gap, Math.max(source.x + source.width, target.x + target.width) + gap]
      const proposed: Array<{ edge: PositionedEdge; points: Point[]; label: Point }> = []
      let ok = true
      for (let i = 0; i < group.length; i++) {
        const edge = group[i]!
        const points = symmetricParallelOuterLanePoints(source, target, graph.direction, lanes[i]!, i, group.length)
        if (!routeClearOfNodes(points, nodes, new Set([source.id, target.id]))) { ok = false; break }
        proposed.push({ edge, points, label: longestSegmentMidpoint(points) })
      }
      if (!ok) continue
      for (const p of proposed) {
        const metrics = measureMultilineText(p.edge.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight)
        const box = { x: p.label.x - (metrics.width + 16) / 2, y: p.label.y - (metrics.height + 16) / 2, w: metrics.width + 16, h: metrics.height + 16 }
        if (labelTouchesNeighborRoute(p.edge, box, edges)) ok = false
      }
      if (!ok) continue
      for (const { edge, points, label } of proposed) {
        edge.points = points
        edge.labelPosition = label
        edge.routeCertificate = undefined
        bundled.add(edge)
      }
      break
    }
  }
}

/**
 * Parallel-lane contract for duplicate same-direction edges (a multigraph:
 * `A --> B` written two or more times). ELK + the port allocator fan the
 * endpoints across a node side, but only a few pixels apart, and the
 * per-edge bends stack at the same column — a cramped near-overlapping
 * double line. The graph-drawing convention (yFiles ParallelEdgeRouter; OGDF's
 * Kandinsky "center straight, neighbours offset" model) is to route the group
 * as EVENLY-SEPARATED parallel orthogonal lanes. We do exactly that here:
 *
 *  - spread both endpoints across distinct, evenly-spaced slots on the shared
 *    flow sides (separation clamped to fit the shorter side, so endpoints stay
 *    on the outline — verified with the same `onShapeOutline` oracle the tests
 *    use), and
 *  - when the nodes are offset on the cross axis, give each edge its own jog
 *    column (staggered by the lane separation) so the vertical segments run
 *    parallel instead of overlapping.
 *
 * Scoped to the rare duplicate-pair case: only UNLABELED, forward, side-to-side
 * pairs between PORT_EXACT shapes outside any group. Labeled parallel pairs are
 * owned by `applySymmetricParallelEdgeLanes` (they need outer lanes for their
 * labels); everything else is left to the certifying route contracts.
 */
export function applyParallelDuplicateLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  bundled: Set<PositionedEdge>,
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const f = layoutFlow(graph.direction)
  const TARGET_SEP = 14
  const MARGIN = 5
  const BASE_GAP = 16
  const mainSize = (n: PositionedNode) => (f.isHorizontal ? n.width : n.height)
  const crossSize = (n: PositionedNode) => (f.isHorizontal ? n.height : n.width)
  const mk = (mainVal: number, crossVal: number): Point =>
    f.isHorizontal ? { x: mainVal, y: crossVal } : { x: crossVal, y: mainVal }

  // Target-centric fan-in distribution. We bucket every side-to-side, unlabeled
  // edge by the hub it enters — not just by directed pair — because a duplicate
  // band is only readable if the OTHER edges sharing that hub's entry face are
  // spread with it. Distributing the whole bucket fixes three defects the old
  // pair-only pass left behind:
  //   - crowding/crossing: a third distinct feeder (e.g. N4->N3 in issue #62)
  //     used to land inside a separated duplicate band, crossing through it;
  //   - silent collapse: when a hub had other feeders the pair-only pass often
  //     bailed, leaving ELK's overlap so the duplicates rendered as one line;
  //   - tight feedback pairs: a duplicate BACK-edge entered the hub's flow-exit
  //     face at ~6px because neither lane pass owned it.
  // Forward edges enter the hub's flow-facing side; feedback (back) edges enter
  // the opposite, flow-exit side. We handle the two faces as independent buckets
  // with mirrored exit/entry sides and jog direction. Gated on a genuine
  // duplicate (same source >= 2) per face, so pure distinct-peer fan-in is left
  // to the merge-centering pass (issue #26 WS3).
  const highSide = (n: PositionedNode) => n[f.main] + mainSize(n)
  const lowSide = (n: PositionedNode) => n[f.main]
  const sourceOnHigh = f.sourceSide === 'E' || f.sourceSide === 'S'
  const targetOnLow = f.targetSide === 'W' || f.targetSide === 'N'
  // Forward uses the flow sides; feedback uses their opposites.
  const exitSide = (n: PositionedNode, back: boolean) => (sourceOnHigh !== back ? highSide(n) : lowSide(n))
  const entrySide = (n: PositionedNode, back: boolean) => (targetOnLow !== back ? lowSide(n) : highSide(n))
  const preSeparated = new Set<PositionedEdge>()
  const routesShareCollinearRun = (a: PositionedEdge, b: PositionedEdge): boolean => {
    for (let i = 1; i < a.points.length; i++) {
      const a0 = a.points[i - 1]!, a1 = a.points[i]!
      const aVertical = Math.abs(a0.x - a1.x) < 0.5
      const aHorizontal = Math.abs(a0.y - a1.y) < 0.5
      if (!aVertical && !aHorizontal) continue
      for (let j = 1; j < b.points.length; j++) {
        const b0 = b.points[j - 1]!, b1 = b.points[j]!
        if (aVertical) {
          if (Math.abs(b0.x - b1.x) >= 0.5 || Math.abs(a0.x - b0.x) >= 1) continue
          const overlap = Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) -
            Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y))
          if (overlap > 1) return true
        } else if (aHorizontal) {
          if (Math.abs(b0.y - b1.y) >= 0.5 || Math.abs(a0.y - b0.y) >= 1) continue
          const overlap = Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) -
            Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x))
          if (overlap > 1) return true
        }
      }
    }
    return false
  }

  // Mixed labeled+unlabeled duplicates used to fall through every pre-freeze
  // lane splitter: the labeled member was not eligible for duplicate lanes,
  // and the lone unlabeled member was not a duplicate by itself. The
  // post-freeze shared-trunk label repair then had to reroute geometry. Own the
  // exact-pair case here instead, before route certificates are issued.
  const byDirectedPair = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!PORT_EXACT.has(source.shape) || !PORT_EXACT.has(target.shape)) continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    const forwardGap = (entrySide(target, false) - exitSide(source, false)) * f.sign
    const feedbackGap = (exitSide(source, true) - entrySide(target, true)) * f.sign
    if (forwardGap <= BASE_GAP && feedbackGap <= BASE_GAP) continue
    const key = `${edge.source}\0${edge.target}`
    if (!byDirectedPair.has(key)) byDirectedPair.set(key, [])
    byDirectedPair.get(key)!.push(edge)
  }

  const separateMixedPair = (bucket: PositionedEdge[], back: boolean): boolean => {
    if (bucket.length < 2) return false
    if (!bucket.some(edge => edge.label) || !bucket.some(edge => !edge.label)) return false
    if (!bucket.some(edge => edge.label && bucket.some(other => !other.label && routesShareCollinearRun(edge, other)))) return false
    bucket.sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
    const source = nodeMap.get(bucket[0]!.source)!
    const target = nodeMap.get(bucket[0]!.target)!
    const exitMain = exitSide(source, back)
    const entryMain = entrySide(target, back)
    const k = bucket.length
    const sep = Math.min(TARGET_SEP, (Math.min(crossSize(source), crossSize(target)) - 2 * MARGIN) / (k - 1))
    if (sep < 4) return false
    const sourceCenter = source[f.cross] + crossSize(source) / 2
    const targetCenter = target[f.cross] + crossSize(target) / 2

    const lanes: Array<{ edge: PositionedEdge; sCross: number; tCross: number }> = []
    const col: number[] = []
    for (let i = 0; i < k; i++) {
      const sCross = sourceCenter + (i - (k - 1) / 2) * sep
      const tCross = targetCenter + (i - (k - 1) / 2) * sep
      let jog = exitMain + (back ? -1 : 1) * f.sign * (BASE_GAP + i * sep)
      const lo = Math.min(exitMain, entryMain), hi = Math.max(exitMain, entryMain)
      if (jog <= lo + 4 || jog >= hi - 4) jog = (exitMain + entryMain) / 2
      lanes.push({ edge: bucket[i]!, sCross, tCross })
      col.push(jog)
    }
    if (lanes[0]!.tCross - lanes[0]!.sCross > 0) col.reverse()

    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    for (let i = 0; i < k; i++) {
      const { edge, sCross, tCross } = lanes[i]!
      const jog = col[i]!
      const raw = Math.abs(sCross - tCross) <= 0.5
        ? [mk(exitMain, sCross), mk(entryMain, tCross)]
        : [mk(exitMain, sCross), mk(jog, sCross), mk(jog, tCross), mk(entryMain, tCross)]
      const clipped = simplifyPolyline(
        clipEdgeToShape(
          clipEdgeToShape(raw, source, true),
          target,
          false,
        ),
      )
      if (clipped.length < 2 ||
        !onShapeOutline(source, clipped[0]!) ||
        !onShapeOutline(target, clipped[clipped.length - 1]!) ||
        !routeClearOfNodes(clipped, nodes, new Set([source.id, target.id]))) {
        return false
      }
      proposed.push({ edge, points: clipped })
    }
    for (const { edge, points } of proposed) {
      edge.points = points
      edge.labelPosition = edge.label ? longestSegmentMidpoint(points) : undefined
      edge.routeCertificate = undefined
      bundled.add(edge)
      preSeparated.add(edge)
    }
    return true
  }

  for (const bucket of byDirectedPair.values()) {
    const source = nodeMap.get(bucket[0]!.source)
    const target = nodeMap.get(bucket[0]!.target)
    if (!source || !target) continue
    const back = !((entrySide(target, false) - exitSide(source, false)) * f.sign > BASE_GAP)
    separateMixedPair(bucket, back)
  }

  const fwdByTarget = new Map<string, PositionedEdge[]>()
  const backByTarget = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (preSeparated.has(edge)) continue
    if (edge.source === edge.target || edge.label) continue
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (!PORT_EXACT.has(source.shape) || !PORT_EXACT.has(target.shape)) continue
    if (nodeInsideGroups(source, groups) || nodeInsideGroups(target, groups)) continue
    // Forward: target sits ahead on the source's flow side, side-to-side with
    // room for a lane. Feedback: target sits behind, so the edge enters the
    // hub's flow-exit face. Anything else stays with its route contract.
    const push = (m: Map<string, PositionedEdge[]>) => {
      if (!m.has(edge.target)) m.set(edge.target, [])
      m.get(edge.target)!.push(edge)
    }
    if ((entrySide(target, false) - exitSide(source, false)) * f.sign > BASE_GAP) push(fwdByTarget)
    else if ((exitSide(source, true) - entrySide(target, true)) * f.sign > BASE_GAP) push(backByTarget)
  }

  const distribute = (bucket: PositionedEdge[], back: boolean): void => {
    if (bucket.length < 2) return
    // Gate: act only when a real duplicate shares this face. Without one this is
    // ordinary distinct fan-in, which merge-centering renders as a clean merge.
    const srcCounts = new Map<string, number>()
    for (const edge of bucket) srcCounts.set(edge.source, (srcCounts.get(edge.source) ?? 0) + 1)
    if (![...srcCounts.values()].some(count => count >= 2)) return

    const target = nodeMap.get(bucket[0]!.target)!
    const entryMain = entrySide(target, back)
    const tCenter = target[f.cross] + crossSize(target) / 2

    // Order by source cross-position (duplicates from one source kept adjacent
    // and stable by edgeIndex) so the assigned lanes never cross.
    const srcCenter = (edge: PositionedEdge) => {
      const s = nodeMap.get(edge.source)!
      return s[f.cross] + crossSize(s) / 2
    }
    bucket.sort((a, b) => srcCenter(a) - srcCenter(b) || (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))

    const k = bucket.length
    const sep = Math.min(TARGET_SEP, (crossSize(target) - 2 * MARGIN) / (k - 1))
    if (sep < 4) return // too tight to separate meaningfully — leave as-is

    // Duplicates from the same source also need distinct exit lanes on their
    // shared source side, else their source endpoints would overlap.
    const bySource = new Map<string, PositionedEdge[]>()
    for (const edge of bucket) {
      if (!bySource.has(edge.source)) bySource.set(edge.source, [])
      bySource.get(edge.source)!.push(edge)
    }

    // Lay out each lane (source exit slot, target entry slot, riser column),
    // then order the riser columns so duplicate lanes NEST instead of crossing.
    const lanes: Array<{ edge: PositionedEdge; source: PositionedNode; exitMain: number; sCross: number; tCross: number }> = []
    const col: number[] = []
    for (let i = 0; i < k; i++) {
      const edge = bucket[i]!
      const source = nodeMap.get(edge.source)!
      const exitMain = exitSide(source, back)
      const tCross = tCenter + (i - (k - 1) / 2) * sep

      const sibs = bySource.get(edge.source)!
      const sSep = sibs.length > 1
        ? Math.min(sep, (crossSize(source) - 2 * MARGIN) / (sibs.length - 1))
        : 0
      const sCross = source[f.cross] + crossSize(source) / 2 + (sibs.indexOf(edge) - (sibs.length - 1) / 2) * sSep

      // Each edge jogs at its own column, staggered by the lane separation, so
      // the cross-axis segments stay parallel rather than overlapping. Feedback
      // edges run against the flow, so their jog steps the other way.
      let jog = exitMain + (back ? -1 : 1) * f.sign * (BASE_GAP + i * sep)
      const lo = Math.min(exitMain, entryMain), hi = Math.max(exitMain, entryMain)
      if (jog <= lo + 4 || jog >= hi - 4) jog = (exitMain + entryMain) / 2
      lanes.push({ edge, source, exitMain, sCross, tCross })
      col.push(jog)
    }

    // Nest riser columns within each run of duplicate lanes (same source, hence
    // same directed pair in this target bucket). When the pair bends across the
    // flow, the UPPER lane's riser must sit farther out so the lower lane's exit
    // run does not cut across it (an upward bend is the mirror, handled by the
    // reversal below). Endpoints are untouched, so separation/order is preserved.
    for (let a = 0; a < k;) {
      let b = a
      while (b + 1 < k && bucket[b + 1]!.source === bucket[a]!.source) b++
      if (b > a && lanes[a]!.tCross - lanes[a]!.sCross > 0) {
        const slice = col.slice(a, b + 1).reverse()
        for (let r = a; r <= b; r++) col[r] = slice[r - a]!
      }
      a = b + 1
    }

    const proposed: Array<{ edge: PositionedEdge; points: Point[] }> = []
    let ok = true
    for (let i = 0; i < k; i++) {
      const { edge, source, exitMain, sCross, tCross } = lanes[i]!
      const jog = col[i]!
      let pts: Point[]
      if (Math.abs(sCross - tCross) <= 0.5) {
        pts = [mk(exitMain, sCross), mk(entryMain, tCross)]
      } else {
        pts = [mk(exitMain, sCross), mk(jog, sCross), mk(jog, tCross), mk(entryMain, tCross)]
      }
      pts = clipEdgeToShape(pts, source, true)
      pts = clipEdgeToShape(pts, target, false)
      pts = simplifyPolyline(pts)
      if (pts.length < 2 ||
        !onShapeOutline(source, pts[0]!) ||
        !onShapeOutline(target, pts[pts.length - 1]!) ||
        !routeClearOfNodes(pts, nodes, new Set([source.id, target.id]))) {
        ok = false
        break
      }
      proposed.push({ edge, points: pts })
    }
    if (!ok) return
    for (const { edge, points } of proposed) {
      edge.points = points
      edge.labelPosition = undefined
      edge.routeCertificate = undefined
      bundled.add(edge)
    }
  }

  for (const bucket of fwdByTarget.values()) distribute(bucket, false)
  for (const bucket of backByTarget.values()) distribute(bucket, true)
}

/**
 * Recursively extract edges from ELK result including those inside subgraphs.
 * Edges are distributed to subgraphs for direction override to work,
 * so we need to collect them from all levels with proper coordinate offsets.
 *
 * For hierarchical edges (cross-hierarchy with ports), combines external and
 * internal segments into a single continuous edge path.
 */
export function extractEdgesRecursively(
  elkNode: ElkNode,
  graph: MermaidGraph,
  edges: PositionedEdge[],
  offsetX: number,
  offsetY: number,
  margins?: MarginInfo
): void {
  // First pass: collect all edge segments
  const segments = new Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>()
  collectEdgeSegments(elkNode, segments, 0, 0)

  // Track margin-routed edge count for spacing offsets
  let marginEdgeIndex = 0

  // Second pass: combine segments and create positioned edges
  for (const [edgeIndex, seg] of segments) {
    const originalEdge = graph.edges[edgeIndex]
    if (!originalEdge) continue

    // Combine points from all segments in correct order:
    // - For incoming cross-hierarchy (external → subgraph): external then incoming
    // - For outgoing cross-hierarchy (subgraph → external): outgoing then external
    // - For both (subgraph A → subgraph B): outgoing → external → incoming
    const allPoints: Point[] = []

    // First: outgoing internal segment (source node → exit port)
    if (seg.outgoing && seg.outgoing.points.length > 0) {
      allPoints.push(...seg.outgoing.points)
    }

    // Second: external segment (exit port → entry port, or source → entry port, or exit port → target)
    if (seg.external && seg.external.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at outgoing port
        allPoints.push(...seg.external.points.slice(1))
      } else {
        allPoints.push(...seg.external.points)
      }
    }

    // Third: incoming internal segment (entry port → target node)
    if (seg.incoming && seg.incoming.points.length > 0) {
      if (allPoints.length > 0) {
        // Skip first point to avoid duplicate at incoming port
        allPoints.push(...seg.incoming.points.slice(1))
      } else {
        allPoints.push(...seg.incoming.points)
      }
    }

    // Label position: use ELK's inline label position (on-edge with collision avoidance)
    // Fall back to midpoint for hierarchical edges or when ELK position unavailable
    let labelPosition: Point | undefined
    if (originalEdge.label && allPoints.length >= 2) {
      const elkLabelPos = seg.external?.labelPosition
      labelPosition = elkLabelPos ?? calculatePathMidpoint(allPoints)
    }

    // Ensure all edge segments are orthogonal (horizontal or vertical only).
    // In SEPARATE hierarchy mode, ELK may produce diagonal segments for
    // cross-hierarchy edges where it only returns start/end points without
    // proper orthogonal bend points.
    // When margins are available, route through the diagram margins instead
    // of Z-paths through the middle (which cross through subgraphs).
    const orthogonalPoints = orthogonalizeEdgePoints(allPoints, margins, marginEdgeIndex)
    if (orthogonalPoints !== allPoints) {
      marginEdgeIndex++
    }

    // Recalculate label position for margin-routed edges
    if (originalEdge.label && orthogonalPoints !== allPoints && orthogonalPoints.length >= 2) {
      labelPosition = calculatePathMidpoint(orthogonalPoints)
    }

    edges.push({
      source: originalEdge.source,
      target: originalEdge.target,
      // Authored v11.6 edge ID: carried through layout so the SVG can emit
      // it as the edge's data-id (stable identity contract).
      ...(originalEdge.id !== undefined ? { id: originalEdge.id } : {}),
      label: originalEdge.label,
      style: originalEdge.style,
      hasArrowStart: originalEdge.hasArrowStart,
      hasArrowEnd: originalEdge.hasArrowEnd,
      startMarker: originalEdge.startMarker,
      endMarker: originalEdge.endMarker,
      ...(originalEdge.curve ? { curve: originalEdge.curve } : {}),
      ...(originalEdge.animate ? { animate: true as const } : {}),
      ...(originalEdge.animation ? { animation: originalEdge.animation } : {}),
      points: orthogonalPoints,
      labelPosition,
      inlineStyle: resolveEdgeInlineStyle(edgeIndex, graph),
      edgeIndex,
    })
  }
}

/**
 * Post-process edge points to ensure all segments are purely orthogonal.
 *
 * When ELK uses SEPARATE hierarchy handling (required for subgraph direction
 * overrides), cross-hierarchy edges may only get start/end coordinates without
 * intermediate bend points, producing diagonal lines.
 *
 * When margins are provided, routes diagonal segments through the left or right
 * margin of the diagram (outside all subgraphs). Alternates sides and adds
 * spacing offsets to prevent overlapping parallel edges.
 *
 * Without margins, falls back to Z-path through the vertical midpoint.
 *
 * Returns the original array reference (identity) if no changes were needed,
 * so callers can detect whether routing was applied.
 */
export function orthogonalizeEdgePoints(
  points: Point[],
  margins?: MarginInfo,
  edgeIndex: number = 0
): Point[] {
  if (points.length < 2) return points

  // Check if any segment needs orthogonalization
  let needsWork = false
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i]!.x - points[i - 1]!.x)
    const dy = Math.abs(points[i]!.y - points[i - 1]!.y)
    if (dx > 1 && dy > 1) { needsWork = true; break }
  }
  if (!needsWork) return points

  const EDGE_SPACING = 12
  const result: Point[] = [points[0]!]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!
    const curr = points[i]!
    const dx = Math.abs(curr.x - prev.x)
    const dy = Math.abs(curr.y - prev.y)

    if (dx > 1 && dy > 1) {
      if (margins) {
        // Margin routing: exit horizontally → travel vertically along margin → enter horizontally
        // Alternate left/right margins and offset for parallel edge spacing
        const useRight = edgeIndex % 2 === 0
        const offset = Math.floor(edgeIndex / 2) * EDGE_SPACING
        const marginX = useRight
          ? margins.rightX + offset
          : margins.leftX - offset

        result.push({ x: marginX, y: prev.y })
        result.push({ x: marginX, y: curr.y })
      } else {
        // Fallback: Z-path through vertical midpoint
        const midY = (prev.y + curr.y) / 2
        result.push({ x: prev.x, y: midY })
        result.push({ x: curr.x, y: midY })
      }
    }

    result.push(curr)
  }

  return result
}

/**
 * Recursively collect edge segments from ELK result.
 */
function collectEdgeSegments(
  elkNode: ElkNode,
  segments: Map<number, { external?: EdgeSegment; incoming?: EdgeSegment; outgoing?: EdgeSegment }>,
  offsetX: number,
  offsetY: number
): void {
  if (elkNode.edges) {
    for (const elkEdge of elkNode.edges) {
      // Parse edge ID: "e{index}" or "e{index}_internal"
      const isInternal = elkEdge.id.endsWith('_internal')
      const edgeIndex = parseInt(elkEdge.id.substring(1), 10)
      if (isNaN(edgeIndex)) continue

      // Extract points
      const points: Point[] = []
      if (elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0]!
        points.push({
          x: section.startPoint.x + offsetX,
          y: section.startPoint.y + offsetY,
        })
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            points.push({ x: bp.x + offsetX, y: bp.y + offsetY })
          }
        }
        points.push({
          x: section.endPoint.x + offsetX,
          y: section.endPoint.y + offsetY,
        })
      }

      // Extract label position
      let labelPosition: Point | undefined
      if (elkEdge.labels && elkEdge.labels.length > 0) {
        const label = elkEdge.labels[0]!
        if (label.x != null && label.y != null) {
          labelPosition = {
            x: label.x + (label.width ?? 0) / 2 + offsetX,
            y: label.y + (label.height ?? 0) / 2 + offsetY,
          }
        }
      }

      // Store segment
      if (!segments.has(edgeIndex)) {
        segments.set(edgeIndex, {})
      }
      const seg = segments.get(edgeIndex)!

      if (isInternal) {
        // Determine if this is an incoming or outgoing internal segment
        // by checking if source is a port (incoming) or target is a port (outgoing)
        const source = elkEdge.sources?.[0] ?? ''
        const target = elkEdge.targets?.[0] ?? ''
        const sourceIsPort = source.includes('_in_') || source.includes('_out_')
        const targetIsPort = target.includes('_in_') || target.includes('_out_')

        if (sourceIsPort) {
          // Port → node: incoming internal segment
          seg.incoming = { edgeIndex, isInternal, points, labelPosition }
        } else if (targetIsPort) {
          // Node → port: outgoing internal segment
          seg.outgoing = { edgeIndex, isInternal, points, labelPosition }
        }
      } else {
        seg.external = { edgeIndex, isInternal, points, labelPosition }
      }
    }
  }

  // Recurse into children with accumulated offset
  if (elkNode.children) {
    for (const child of elkNode.children) {
      collectEdgeSegments(child, segments, offsetX + (child.x ?? 0), offsetY + (child.y ?? 0))
    }
  }
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
/**
 * Restore the source mid-port for a labelled edge that ELK pushed off it.
 *
 * When a labelled edge is handed to ELK it reserves a cell for the inline label
 * dummy, and that cell displaces the edge's lane off the source node's mid-port:
 * the edge stays straight but exits the source off-centre (the "warnings →
 * warnings line not using the mid-point port" defect). alignPortLanes would
 * slide the node to fix exactly this, but every one of its slide loops EXCLUDES
 * labelled edges (`if (e.label) continue`), so the labelled case is never
 * repaired — which is what made global label-decoupling look necessary.
 *
 * The source's exit is whatever cross-LANE the certifying straightener
 * (applyRouteContracts) finally settles the edge onto — and that lane is chosen
 * downstream: it depends on the target's span, the label pill's fit, and any
 * fan-in. Aligning the source's mid to the TARGET's mid (the previous fix) only
 * works when the straightener happens to pick the shared mid lane; with a wide
 * label the pill cannot sit on the centred lane (so the straightener drops to an
 * off-centre lane), and with a fan-in skew the mids are too far apart for any
 * single lane to be port-exact at both ends. Both leave the source off-port.
 *
 * The general fix is to move the source onto the lane the straightener WILL use,
 * BEFORE the freeze, so the exit lands on the moved source's mid-port. We ask
 * the straightener's own read-only predictor (`straightLaneFor`) which lane it
 * will pick, iterating to a fixed point because moving the source shifts its
 * attach span (which can change the feasible lane). Then we slide the source by
 * that delta and re-anchor its exit endpoint exactly onto the mid-port. The
 * source may carry incoming edges (degree >= 2): their terminal run translates
 * with the node (anchored at the far end, the same machinery alignPortLanes
 * uses), so no edge is dragged off its other endpoint. Gated on the slid box
 * clearing every other node and foreign edge corridor (the occlusion doctrine
 * the other slides enforce); the independent hard-invariant gate is the backstop.
 */
export function alignLabeledSourcePort(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  direction: Direction,
  style: LabelMetricsStyle,
): void {
  if (layoutEnvFlag('APL_NO_LABELED_SOURCE_PORT')) return
  // A labeled source feeding a co-ranked, symmetrized mixed-label fan-in hub
  // must YIELD: its spoke is now part of a symmetric convergence (the hub is
  // centered on its sources' barycenter and the spokes are mirror doglegs).
  // Re-straightening it onto the source mid-port would pull the spoke off the
  // converged shape and de-center the hub — the older "labeled source exits
  // straight at mid-port" contract is, for a fan-in, superseded by the
  // symmetric-convergence principle (the spoke still EXITS at the mid-port, it
  // just bends to converge). A labeled source whose target is single-input (no
  // fan-in) is unaffected and still straightened below. We skip the hub's whole
  // incoming spoke set via the shared corankFanInSpokes predicate, so this pass,
  // the bend exemption, and the hitch oracle all agree on the same spokes.
  const corankFanInTargets = new Set<string>()
  for (const [hubId] of corankFanInSpokes(nodes, edges, groups, graph)) corankFanInTargets.add(hubId)
  const isHorizontal = direction === 'LR' || direction === 'RL'
  const cross = isHorizontal ? ('y' as const) : ('x' as const)
  const main = isHorizontal ? ('x' as const) : ('y' as const)
  const exitSide: 'N' | 'E' | 'S' | 'W' = isHorizontal
    ? (direction === 'LR' ? 'E' : 'W')
    : (direction === 'BT' ? 'N' : 'S')
  const crossSize = (n: PositionedNode) => (isHorizontal ? n.height : n.width)
  const portCross = (n: PositionedNode) => n[cross] + crossSize(n) / 2
  // Clear actual overlap only (the slide moves a node to meet its own edge; a
  // tight gap to an unrelated node is acceptable, and the independent
  // hard-invariant gate is the real backstop against any overlap regression).
  const GAP = 2

  const flat: PositionedGroup[] = []
  const collect = (gs: PositionedGroup[]) => { for (const g of gs) { flat.push(g); collect(g.children) } }
  collect(groups)
  const inGroup = (n: PositionedNode) => flat.some(g =>
    n.x >= g.x - 0.5 && n.y >= g.y - 0.5 &&
    n.x + n.width <= g.x + g.width + 0.5 && n.y + n.height <= g.y + g.height + 0.5)

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  // The exit-side main coordinate of S's forward port (right edge for LR, etc).
  const exitMain = (n: PositionedNode) => (main === 'x'
    ? (exitSide === 'E' ? n.x + n.width : n.x)
    : (exitSide === 'S' ? n.y + n.height : n.y))

  // Gather S plus every upstream predecessor that must travel WITH it so its
  // own incoming edge keeps its mid-port: each single-out, PORT_EXACT and
  // ungrouped. Returns null if the chain is fed by a fan-out hub or an
  // unmovable single-out source — we then leave S put rather than knock another
  // source off its port (the degree-2 defect the narrow slide used to create).
  const gatherMovableChain = (root: PositionedNode, labelled: PositionedEdge): Set<string> | null => {
    const set = new Set<string>([root.id])
    const stack = [root.id]
    while (stack.length) {
      const nId = stack.pop()!
      for (const o of edges) {
        if (o.target !== nId || o === labelled) continue // incoming edges only
        const P = nodeMap.get(o.source)
        if (!P || set.has(P.id)) continue
        if (edges.filter(x => x.source === P.id).length !== 1) return null // fan-out hub upstream
        if (!PORT_EXACT.has(P.shape) || inGroup(P)) return null            // unmovable source
        set.add(P.id); stack.push(P.id)
      }
    }
    return set
  }

  for (const e of edges) {
    if (!e.label || e.points.length < 2 || e.source === e.target) continue
    // Yield to a symmetric mixed-label fan-in: never re-straighten a spoke that
    // converges into a co-ranked, centered hub (see the note at the top).
    if (corankFanInTargets.has(e.target)) continue
    const S = nodeMap.get(e.source)
    if (!S || !PORT_EXACT.has(S.shape) || inGroup(S)) continue
    // S must emit exactly this one forward edge — its lane is then S's sole
    // claim on the exit side, so re-centring it onto that lane is unambiguous.
    // (S MAY have incoming edges; their nodes translate with the slide.)
    if (edges.some(o => o !== e && o.source === S.id && o.target !== S.id)) continue
    // The edge must actually leave S from its forward exit side, so sliding S
    // along the cross axis re-centres a genuine side-exit (not a corner stub).
    if (Math.abs(e.points[0]![main] - exitMain(S)) > 1) continue
    const T = nodeMap.get(e.target)
    if (!T || !PORT_EXACT.has(T.shape) || inGroup(T)) continue

    // Find the lane the straightener will settle e onto, then the delta to put
    // S's mid there. Moving S shifts its attach span, which can change the
    // feasible lane, so iterate to a fixed point (converges in 1-2 rounds; the
    // candidate set is discrete). Probe on a CLONE of S so the search never
    // mutates committed geometry; commit only the converged delta.
    const { ctx, axis } = laneContextFor(nodes, edges, direction, style)
    let delta = 0
    let converged = false
    const probe = { ...S }
    for (let iter = 0; iter < 4; iter++) {
      const lane = straightLaneFor(e, probe, T, ctx, axis)
      if (lane === null) break
      const step = lane - portCross(probe)
      delta += step
      probe[cross] += step
      if (Math.abs(step) <= 0.5) { converged = true; break }
    }
    if (!converged || Math.abs(delta) <= 1) continue

    // S's slide must carry its whole upstream chain, so no incoming source is
    // left off its mid-port. Gather it; abort the slide if it can't move cleanly.
    const chain = gatherMovableChain(S, e)
    if (!chain) continue
    const chainNodes = [...chain].map(id => nodeMap.get(id)).filter(Boolean) as PositionedNode[]
    const movedRect = (n: PositionedNode) => ({
      x: isHorizontal ? n.x : n.x + delta,
      y: isHorizontal ? n.y + delta : n.y,
      width: n.width, height: n.height,
    })
    // Every moved box must clear every UNMOVED node (with margin) and not cut a
    // foreign edge corridor — never create a node overlap or edge-through-node.
    const hitsNode = nodes.some(o => !chain.has(o.id) && chainNodes.some(n => {
      const m = movedRect(n)
      return m.x - GAP < o.x + o.width && m.x + m.width + GAP > o.x &&
        m.y - GAP < o.y + o.height && m.y + m.height + GAP > o.y
    }))
    if (hitsNode) continue
    // Intra-chain edges move WITH their nodes, so they are exempt from the
    // foreign-corridor cut test; only edges incident to no moved node count.
    const cutsEdge = edges.some(o => !chain.has(o.source) && !chain.has(o.target) &&
      chainNodes.some(n => {
        const m = movedRect(n)
        return o.points.some((p, i) => {
          if (i === 0) return false
          const q = o.points[i - 1]!
          return Math.max(p.x, q.x) > m.x + 0.5 && Math.min(p.x, q.x) < m.x + m.width - 0.5 &&
            Math.max(p.y, q.y) > m.y + 0.5 && Math.min(p.y, q.y) < m.y + m.height - 0.5
        })
      }))
    if (cutsEdge) continue

    // Commit: translate every chain node, and every intra-chain edge, rigidly by
    // delta — so each incoming edge stays straight and exits its source at mid.
    for (const n of chainNodes) { if (isHorizontal) n.y += delta; else n.x += delta }
    for (const o of edges) {
      if (chain.has(o.source) && chain.has(o.target)) for (const p of o.points) p[cross] += delta
    }
    e.points[0] = shapePorts(S)[exitSide]
  }
}

export function alignPortLanes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  direction: Direction,
  style: LabelMetricsStyle,
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

  const moveSafe = (node: PositionedNode, delta: number, aligned: PositionedEdge): boolean => {
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
  const shiftRun = (e: PositionedEdge, fromEnd: boolean, delta: number, anchorFar = false): void => {
    const pts = e.points
    const idx = fromEnd ? pts.length - 1 : 0
    const step = fromEnd ? -1 : 1
    const farIdx = fromEnd ? 0 : pts.length - 1
    const ref = pts[idx]![cross]
    let mainLo = Infinity
    let mainHi = -Infinity
    for (let i = idx; i >= 0 && i < pts.length; i += step) {
      if (Math.abs(pts[i]![cross] - ref) > 0.5) break
      if (anchorFar && i === farIdx) break
      mainLo = Math.min(mainLo, pts[i]![main])
      mainHi = Math.max(mainHi, pts[i]![main])
      pts[i]![cross] += delta
    }
    // A label pill riding the shifted run must follow its lane.
    if (e.labelPosition &&
      Math.abs(e.labelPosition[cross] - ref) <= 12 &&
      e.labelPosition[main] >= mainLo - 0.5 && e.labelPosition[main] <= mainHi + 0.5) {
      e.labelPosition[cross] += delta
    }
  }

  const apply = (node: PositionedNode, delta: number, aligned: PositionedEdge): void => {
    if (isHorizontal) node.y += delta
    else node.x += delta
    for (const e of edges) {
      if (e === aligned || e.points.length === 0) continue
      const srcTouch = e.source === node.id
      const tgtTouch = e.target === node.id
      if (srcTouch && tgtTouch) {
        for (const p of e.points) p[cross] += delta
        if (e.labelPosition) e.labelPosition[cross] += delta
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
      if (aligned.labelPosition) aligned.labelPosition[cross] = portCross(nodeMap.get(aligned.source)!)
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
    return true
  }
  const moveChain = (chain: PositionedNode[], delta: number): void => {
    const ids = new Set(chain.map(n => n.id))
    for (const node of chain) {
      if (isHorizontal) node.y += delta
      else node.x += delta
    }
    for (const e of edges) {
      const srcTouch = ids.has(e.source)
      const tgtTouch = ids.has(e.target)
      if (srcTouch && tgtTouch) {
        for (const p of e.points) p[cross] += delta
        if (e.labelPosition) e.labelPosition[cross] += delta
      } else if (tgtTouch) {
        shiftRun(e, true, delta, /* anchorFar */ true)
      } else if (srcTouch) {
        shiftRun(e, false, delta, /* anchorFar */ true)
      }
    }
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
    moveChain(chain, delta)
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
        return Math.abs(delta) <= 0.5 || moveSafe(t, delta, l.edge)
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
            if (sT && tT) { for (const p of o.points) p[cross] += delta; if (o.labelPosition) o.labelPosition[cross] += delta }
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
        if (e.labelPosition) e.labelPosition[cross] = l.cross
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
      if (Math.abs(delta) > 0.5 && !moveSafe(src, delta, e)) continue
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
          if (sT && tT) { for (const p of o.points) p[cross] += delta; if (o.labelPosition) o.labelPosition[cross] += delta }
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
    const moved = moveSafe(tgt, d, e) ? tgt : moveSafe(src, -d, e) ? src : null
    if (moved) {
      layoutDebug('[apl] slide', moved.id, 'by', (moved === tgt ? d : -d).toFixed(1), 'for', e.source, '->', e.target)
      apply(moved, moved === tgt ? d : -d, e)
      frozen.add(e.source)
      frozen.add(e.target)
    }
  }
}

/**
 * ELK's orthogonal edge routing staggers nodes within the same layer to create
 * space for edge bends. This post-processing step groups nodes into layers and
 * snaps them to the same flow-axis coordinate (Y for TD/TB, X for LR/RL).
 *
 * Grouping uses proximity along the flow axis: within a layer, ELK's stagger
 * is always less than layerSpacing (bounded by edge routing channels), while
 * adjacent layers are separated by at least layerSpacing + nodeHeight.
 * A threshold of 0.75 * layerSpacing cleanly separates these cases.
 *
 * Directly connected nodes (sharing an edge) are never merged into the same
 * layer group as an additional safety check.
 *
 * Edge endpoints connected to shifted nodes are adjusted proportionally.
 * Intermediate bend points are left unchanged — edge bundling or clipping
 * will recalculate them afterwards.
 */
export function alignLayerNodes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction
): void {
  if (nodes.length === 0) return

  const isHorizontal = direction === 'LR' || direction === 'RL'

  // Build set of directly-connected node pairs.
  // Nodes connected by an edge must not be merged into the same layer.
  const connectedPairs = new Set<string>()
  for (const edge of edges) {
    connectedPairs.add(`${edge.source}:${edge.target}`)
    connectedPairs.add(`${edge.target}:${edge.source}`)
  }

  // ELK's stagger creates small gaps between adjacent nodes in the same layer
  // (typically edgeEdge spacing = 12px per routing channel). Adjacent layers
  // are separated by at least layerSpacing (48px). We use single-linkage
  // clustering: a node joins the current layer if the gap from the previous
  // node (in sorted order) is within threshold, AND it has no direct edge to
  // any node already in the layer.
  const THRESHOLD = DEFAULTS.layerSpacing * 0.6

  // Sort nodes by flow-axis position
  const sorted = [...nodes].sort((a, b) =>
    isHorizontal ? a.x - b.x : a.y - b.y
  )

  const layers: PositionedNode[][] = []
  let currentLayer: PositionedNode[] = [sorted[0]!]

  for (let i = 1; i < sorted.length; i++) {
    const pos = isHorizontal ? sorted[i]!.x : sorted[i]!.y
    const prevPos = isHorizontal ? sorted[i - 1]!.x : sorted[i - 1]!.y
    // Single-linkage: compare with previous node, not layer start
    const gap = pos - prevPos
    // Check if this node is connected to any node already in the current layer
    const hasEdgeToLayer = currentLayer.some(n =>
      connectedPairs.has(`${n.id}:${sorted[i]!.id}`)
    )
    if (gap <= THRESHOLD && !hasEdgeToLayer) {
      currentLayer.push(sorted[i]!)
    } else {
      layers.push(currentLayer)
      currentLayer = [sorted[i]!]
    }
  }
  layers.push(currentLayer)

  // Snap each layer's nodes to the layer's center position
  const deltas = new Map<string, number>() // nodeId → shift amount

  // A snapped node must not land on an already-routed corridor: edges were
  // routed against the PRE-snap positions, and a node moved onto a foreign
  // edge's path would occlude it (issue #25 rule 9 — no node movement after
  // routing without rerouting). Alignment is cosmetic; occlusion is a hard
  // defect, so a layer whose snap would cause one keeps ELK's stagger.
  const snapOccludes = (node: PositionedNode, newPos: number): boolean => {
    const nx = isHorizontal ? newPos : node.x
    const ny = isHorizontal ? node.y : newPos
    for (const edge of edges) {
      if (edge.source === node.id || edge.target === node.id) continue
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
        const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
        if (xHi > nx + 0.5 && xLo < nx + node.width - 0.5 &&
          yHi > ny + 0.5 && yLo < ny + node.height - 0.5) {
          return true
        }
      }
    }
    return false
  }

  for (const layer of layers) {
    if (layer.length <= 1) continue

    const positions = layer.map(n => isHorizontal ? n.x : n.y)
    const min = Math.min(...positions)
    const max = Math.max(...positions)
    if (max - min <= 1) continue // Already aligned

    // Use the center of the range as the snap target
    const target = (min + max) / 2

    if (layer.some(node => {
      const oldPos = isHorizontal ? node.x : node.y
      return Math.abs(target - oldPos) > 0.5 && snapOccludes(node, target)
    })) continue

    for (const node of layer) {
      const oldPos = isHorizontal ? node.x : node.y
      const delta = target - oldPos
      if (Math.abs(delta) > 0.5) {
        if (isHorizontal) {
          node.x = target
        } else {
          node.y = target
        }
        deltas.set(node.id, delta)
      }
    }
  }

  if (deltas.size === 0) return

  // Build node lookup for edge adjustment
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Adjust edge endpoints to match shifted node positions
  for (const edge of edges) {
    if (edge.points.length < 2) continue

    const srcDelta = deltas.get(edge.source)
    const tgtDelta = deltas.get(edge.target)

    if (srcDelta != null) {
      // Shift first point and any subsequent points in the initial vertical/horizontal run
      const first = edge.points[0]!
      if (isHorizontal) {
        first.x += srcDelta
        // Shift second point if it's part of a straight vertical exit
        if (edge.points.length > 1 && edge.points[1]!.x === first.x - srcDelta) {
          edge.points[1]!.x += srcDelta
        }
      } else {
        first.y += srcDelta
        if (edge.points.length > 1 && edge.points[1]!.y === first.y - srcDelta) {
          edge.points[1]!.y += srcDelta
        }
      }
    }

    if (tgtDelta != null) {
      const last = edge.points[edge.points.length - 1]!
      if (isHorizontal) {
        last.x += tgtDelta
        if (edge.points.length > 1) {
          const prev = edge.points[edge.points.length - 2]!
          if (prev.x === last.x - tgtDelta) prev.x += tgtDelta
        }
      } else {
        last.y += tgtDelta
        if (edge.points.length > 1) {
          const prev = edge.points[edge.points.length - 2]!
          if (prev.y === last.y - tgtDelta) prev.y += tgtDelta
        }
      }
    }
  }
}

/**
 * Find all groups (outermost first) that geometrically contain the given point.
 */
function findGroupsContainingPoint(
  x: number, y: number,
  groups: PositionedGroup[]
): PositionedGroup[] {
  const result: PositionedGroup[] = []
  for (const g of groups) {
    if (x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height) {
      result.push(g)
      result.push(...findGroupsContainingPoint(x, y, g.children))
    }
  }
  return result
}

/**
 * Bundle contract (docs/design/system/route-contracts.md): a rebuilt trunk/branch
 * path may not pass through any node other than the edge's own endpoints.
 * The half-pixel tolerance lets a path graze a border without counting.
 */
function bundlePathClear(
  points: Point[],
  nodes: PositionedNode[],
  sourceId: string,
  targetId: string,
): boolean {
  for (const n of nodes) {
    if (n.id === sourceId || n.id === targetId) continue
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!
      const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
      const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
      if (xHi > n.x + 0.5 && xLo < n.x + n.width - 0.5 && yHi > n.y + 0.5 && yLo < n.y + n.height - 0.5) {
        return false
      }
    }
  }
  return true
}

/**
 * If `junction` falls inside a group that doesn't contain the reference node,
 * move it just outside the outermost such group boundary.
 */
function adjustJunctionForGroups(
  junctionMain: number,  // the junction coordinate along the flow axis (Y for TD, X for LR)
  refX: number,          // reference node center X (for finding its groups)
  refY: number,          // reference node center Y
  groups: PositionedGroup[],
  direction: Direction
): number {
  const GAP = 12
  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL

  // Groups containing the reference node
  const refGroupIds = new Set(findGroupsContainingPoint(refX, refY, groups).map(g => g.id))

  // Check where the junction point would be along the trunk
  const probeX = isHorizontal ? junctionMain : refX
  const probeY = isHorizontal ? refY : junctionMain
  const junctionGroups = findGroupsContainingPoint(probeX, probeY, groups)

  // Find outermost group containing the junction but NOT the reference node
  const crossingGroup = junctionGroups.find(g => !refGroupIds.has(g.id))
  if (!crossingGroup) return junctionMain

  // Move junction just outside this group
  if (isLR) return crossingGroup.x - GAP
  if (isRL) return crossingGroup.x + crossingGroup.width + GAP
  if (isBT) return crossingGroup.y + crossingGroup.height + GAP
  return crossingGroup.y - GAP // TD
}

/**
 * Bundle fan-out and fan-in edge paths so they share a common trunk segment.
 *
 * For fan-out (one source → N targets), all edges exit the source at the same
 * point, travel along a shared trunk, then branch to their individual targets.
 * The overlapping trunk segments render as a single visible line.
 *
 * Junction points are placed outside subgraph boundaries so branches split
 * before entering a group, not inside it.
 *
 * Constraints: edges in a bundle must share the same style and have no labels.
 * Self-loops and backward edges (against the graph direction) are excluded.
 *
 * Returns the set of edges whose paths the bundler owns, so the route-contract
 * pass never straightens a trunk-shared path.
 */
export function bundleEdgePaths(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  direction: Direction
): Set<PositionedEdge> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const processed = new Set<PositionedEdge>()

  const isLR = direction === 'LR'
  const isRL = direction === 'RL'
  const isBT = direction === 'BT'
  const isHorizontal = isLR || isRL

  // --- Fan-out: group edges by shared source ---
  const fanOutGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!fanOutGroups.has(edge.source)) fanOutGroups.set(edge.source, [])
    fanOutGroups.get(edge.source)!.push(edge)
  }

  for (const [sourceId, group] of fanOutGroups) {
    if (group.length < 2) continue

    const style = group[0]!.style
    if (group.some(e => e.label || e.style !== style)) continue

    const source = nodeMap.get(sourceId)
    if (!source) continue

    // Only bundle edges going in the forward direction
    const forward = group.filter(e => {
      const t = nodeMap.get(e.target)
      if (!t) return false
      if (isLR) return t.x > source.x + source.width
      if (isRL) return t.x + t.width < source.x
      if (isBT) return t.y + t.height < source.y
      return t.y > source.y + source.height // TD/TB
    })
    if (forward.length < 2) continue
    // A fan needs >= 2 distinct targets: duplicate edges to one target would
    // bundle onto byte-identical overlapping paths, hiding one of them.
    if (new Set(forward.map(e => e.target)).size < 2) continue

    const srcCX = source.x + source.width / 2
    const srcCY = source.y + source.height / 2

    // Bundle contract: rebuild candidate paths, drop any member whose path
    // would pass through a node (it keeps its ELK route and the route-contract
    // pass certifies it), and re-derive the junction from the members that
    // remain — until the bundle is clear or too small to exist.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.target)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const exitX = isLR ? source.x + source.width : source.x
        const exitY = srcCY

        const nearestX = isLR
          ? Math.min(...members.map(t => t.node.x))
          : Math.max(...members.map(t => t.node.x + t.node.width))
        let junctionX = exitX + (nearestX - exitX) / 2
        junctionX = adjustJunctionForGroups(junctionX, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = isLR ? target.x : target.x + target.width
          const entryY = target.y + target.height / 2
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const exitX = srcCX
        const exitY = isBT ? source.y : source.y + source.height

        const nearestY = isBT
          ? Math.max(...members.map(t => t.node.y + t.node.height))
          : Math.min(...members.map(t => t.node.y))
        let junctionY = exitY + (nearestY - exitY) / 2
        junctionY = adjustJunctionForGroups(junctionY, srcCX, srcCY, groups, direction)

        for (const { edge, node: target } of members) {
          const entryX = target.x + target.width / 2
          const entryY = isBT ? target.y + target.height : target.y
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      const clear = members.filter(m => bundlePathClear(candidates.get(m.edge)!, nodes, m.edge.source, m.edge.target))
      if (clear.length === members.length) {
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
          processed.add(edge)
        }
        break
      }
      members = clear
      if (new Set(members.map(m => m.edge.target)).size < 2) break
    }
  }

  // --- Fan-in: group edges by shared target (skip already-bundled edges) ---
  const fanInGroups = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    if (processed.has(edge) || edge.source === edge.target) continue
    if (!fanInGroups.has(edge.target)) fanInGroups.set(edge.target, [])
    fanInGroups.get(edge.target)!.push(edge)
  }

  for (const [targetId, group] of fanInGroups) {
    if (group.length < 2) continue

    const style = group[0]!.style
    if (group.some(e => e.label || e.style !== style)) continue

    const target = nodeMap.get(targetId)
    if (!target) continue

    const forward = group.filter(e => {
      const s = nodeMap.get(e.source)
      if (!s) return false
      if (isLR) return s.x + s.width < target.x
      if (isRL) return s.x > target.x + target.width
      if (isBT) return s.y > target.y + target.height
      return s.y + s.height < target.y // TD/TB
    })
    if (forward.length < 2) continue
    // Same distinctness rule as fan-out, for duplicate edges from one source.
    if (new Set(forward.map(e => e.source)).size < 2) continue

    const tgtCX = target.x + target.width / 2
    const tgtCY = target.y + target.height / 2

    // Same bundle contract as fan-out: shrink the bundle until every rebuilt
    // path proves clear of other nodes.
    let members = forward.map(e => ({ edge: e, node: nodeMap.get(e.source)! }))
    while (members.length >= 2) {
      const candidates = new Map<PositionedEdge, Point[]>()
      if (isHorizontal) {
        const entryX = isLR ? target.x : target.x + target.width
        const entryY = tgtCY

        const farthestX = isLR
          ? Math.max(...members.map(s => s.node.x + s.node.width))
          : Math.min(...members.map(s => s.node.x))
        let junctionX = farthestX + (entryX - farthestX) / 2
        junctionX = adjustJunctionForGroups(junctionX, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = isLR ? src.x + src.width : src.x
          const exitY = src.y + src.height / 2
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: junctionX, y: exitY },
            { x: junctionX, y: entryY },
            { x: entryX, y: entryY },
          ])
        }
      } else {
        const entryX = tgtCX
        const entryY = isBT ? target.y + target.height : target.y

        const farthestY = isBT
          ? Math.min(...members.map(s => s.node.y))
          : Math.max(...members.map(s => s.node.y + s.node.height))
        let junctionY = farthestY + (entryY - farthestY) / 2
        junctionY = adjustJunctionForGroups(junctionY, tgtCX, tgtCY, groups, direction)

        for (const { edge, node: src } of members) {
          const exitX = src.x + src.width / 2
          const exitY = isBT ? src.y : src.y + src.height
          candidates.set(edge, [
            { x: exitX, y: exitY },
            { x: exitX, y: junctionY },
            { x: entryX, y: junctionY },
            { x: entryX, y: entryY },
          ])
        }
      }

      const clear = members.filter(m => bundlePathClear(candidates.get(m.edge)!, nodes, m.edge.source, m.edge.target))
      if (clear.length === members.length) {
        for (const { edge } of members) {
          edge.points = candidates.get(edge)!
          processed.add(edge)
        }
        break
      }
      members = clear
      if (new Set(members.map(m => m.edge.source)).size < 2) break
    }
  }

  return processed
}
