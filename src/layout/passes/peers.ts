import type { MermaidGraph, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { onShapeOutline } from '../../layout-rubric.ts'
import { labelRect, PORT_EXACT, shapePorts } from '../../route-contracts.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { graphEdgeMarkerPaintRegions } from '../../graph-connectors.ts'
import { isOutwardShapeApproach, trimOccludedShapeEndpoint } from '../../shape-clipping.ts'
import type { ResolvedRenderStyle } from '../../styles.ts'
import type { AxisAlignedBox } from '../../shared/transformed-bounds.ts'
import { graphReachability, layoutDebug, layoutEnvFlag, layoutFlow, nodeCrossCenter, nodeCrossStart, nodeMainStart } from '../geometry.ts'
import { positionedEdgeForwardish, sameFlowLayer, packFlowLayerCrossAxis, nodeInsideGroups, symmetricOffsets, doglegBetween, routeClearOfNodes, shiftNodeSetCross, crossShiftSafe } from './shared.ts'
import { assignBundledFanoutLabels } from './bundled-labels.ts'
import { retainConstructedBundleRoutes } from '../bundle-routes.ts'
import { reanchorOffOutlineEndpoints } from './obstacle-routing.ts'

/** Preserve existing paint witnesses; resizing is not a new label-placement pass. */
function peerPaintRemainsClear(before: PositionedNode[], nodes: PositionedNode[], edges: PositionedEdge[], graph: MermaidGraph, style: ResolvedRenderStyle): boolean {
  const intersects = (a: AxisAlignedBox, b: AxisAlignedBox): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-6
  const nodeBox = (node: PositionedNode): AxisAlignedBox => ({ x0: node.x, y0: node.y, x1: node.x + node.width, y1: node.y + node.height })
  const beforeMap = new Map(before.map(node => [node.id, node]))
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const labels = edges.flatMap(edge => {
    const pill = labelRect(edge, style)
    if (!pill) return []
    const halo = Math.max(4, style.lineWidth * (edge.style === 'thick' ? 2 : 1) * 2)
    return [{ x0: pill.x - halo, y0: pill.y - halo, x1: pill.x + pill.w + halo, y1: pill.y + pill.h + halo }]
  })
  for (const label of labels) {
    if (nodes.some((node, index) => intersects(label, nodeBox(node)) && !intersects(label, nodeBox(before[index]!)))) return false
  }

  for (const edge of edges) {
    const markers = graphEdgeMarkerPaintRegions(edge, style)
    if (markers.length === 0) continue
    // The endpoint repair removes the prefix now hidden by an enlarged box.
    // Project that same existing subpath before measuring its painted marker;
    // measuring the stale endpoint would reserve space inside the new node.
    let points = edge.points
    const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target)
    if (source) points = trimOccludedShapeEndpoint(points, source, true)
    if (target) points = trimOccludedShapeEndpoint(points, target, false)
    // A packed node can move off the retained shaft entirely. Use the same
    // bounded constructor as the existing late endpoint repair, on a private
    // copy; a stale marker is not evidence that the new contact has space.
    const projection = { ...edge, points }
    reanchorOffOutlineEndpoints(nodes, [projection], graph, style)
    points = projection.points
    for (const start of [true, false]) {
      if (!(start ? edge.hasArrowStart : edge.hasArrowEnd)) continue
      const id = start ? edge.source : edge.target
      const oldNode = beforeMap.get(id), node = nodeMap.get(id)
      const oldPoints = start ? edge.points : [...edge.points].reverse()
      const newPoints = start ? points : [...points].reverse()
      const oldEnd = oldPoints[0], end = newPoints[0]
      const oldNext = oldEnd && oldPoints.find(point => point.x !== oldEnd.x || point.y !== oldEnd.y)
      const next = end && newPoints.find(point => point.x !== end.x || point.y !== end.y)
      if (oldNode && oldEnd && oldNext && isOutwardShapeApproach(oldNode, oldEnd, oldNext) === true &&
        (!node || !end || !next || isOutwardShapeApproach(node, end, next) !== true)) return false
    }
    const projected = graphEdgeMarkerPaintRegions(projection, style)
    for (let index = 0; index < markers.length; index++) {
      const old = markers[index]!, marker = projected[index]
      if (!old.bounds) continue
      if (!marker?.bounds) return false
      const owner = marker.position === 'start' ? edge.source : edge.target
      // A tip may touch its own endpoint; its tail must still clear the other
      // endpoint and every foreign card. Labels paint after all markers.
      if (nodes.some((node, nodeIndex) => node.id !== owner && intersects(marker.bounds!, nodeBox(node)) &&
        !intersects(old.bounds!, nodeBox(before[nodeIndex]!)))) return false
      if (labels.some(label => intersects(label, marker.bounds!) && !intersects(label, old.bounds!))) return false
    }
  }
  return true
}

export function equalizePeerNodeDimensions(nodes: PositionedNode[], edges: PositionedEdge[], groups: PositionedGroup[], graph: MermaidGraph, style: ResolvedRenderStyle): void {
  const reaches = graphReachability(graph.edges)
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
      if (i !== j && reaches(targets[i]!.id, targets[j]!.id)) peer = false
    }
    if (peer) addGroup(targets)
  }

  let changed = false
  let before: PositionedNode[] | undefined
  const f = layoutFlow(graph.direction)
  for (const group of peerGroups) {
    const maxWidth = Math.max(...group.map(n => n.width))
    const maxHeight = Math.max(...group.map(n => n.height))
    if (group.every(n => Math.abs(n.width - maxWidth) < 0.5 && Math.abs(n.height - maxHeight) < 0.5)) continue
    before ??= nodes.map(node => ({ ...node }))
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
  if (changed) {
    packFlowLayerCrossAxis(nodes, graph.direction)
    // Packing and every peer resize form one proposal: checking each group
    // before the final pack would miss paint occluded by a later cross slide.
    if (!peerPaintRemainsClear(before!, nodes, edges, graph, style)) {
      nodes.forEach((node, index) => {
        const old = before![index]!
        node.x = old.x; node.y = old.y; node.width = old.width; node.height = old.height
      })
    }
  }
}

export function centerPeerBarycenters(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  style: LabelMetricsStyle,
  beforeMove?: () => void,
): void {
  const reaches = graphReachability(graph.edges)
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
      if (i !== j && reaches(peers[i]!.id, peers[j]!.id)) return undefined
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
          beforeMove?.()
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
      beforeMove?.()
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
  const reaches = graphReachability(graph.edges)
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
        if (i !== j && reaches(sources[i]!.id, sources[j]!.id)) { peers = false; break }
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
    }
    retainConstructedBundleRoutes(proposed.map(proposal => proposal.edge), bundled)
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
  const reaches = graphReachability(graph.edges)
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
      if (i !== j && reaches(targets[i]!.id, targets[j]!.id)) peer = false
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
