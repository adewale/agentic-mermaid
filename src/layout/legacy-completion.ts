import type { ElkNode } from 'elkjs'
import type { MermaidGraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, PositionedStateNote } from '../types.ts'
import { ARROW_HEAD, type ResolvedRenderStyle } from '../styles.ts'
import { graphTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { clipEdgeToShape } from '../shape-clipping.ts'
import { measureRubricMetrics } from '../layout-rubric.ts'
import { applyRouteContracts, closeRouteContracts, repairMarkerTerminals, labelRect, repairLabelsOffOwnRoute, repairLabelsOnSharedTrunks, separateEdgeLabelPills, trimBoundaryEndpointRuns } from '../route-contracts.ts'
import { bundleRouteBeforeRewrite, retainBundleRouteAfterRewrite } from './bundle-routes.ts'
import { runPipeline, type LayoutPass, type PassContextBase, type PassMetrics, type RubricMetric } from './pass.ts'
import { flattenGroupBounds, type MarginInfo } from './geometry.ts'
import { retainGraphText } from './graph-measurement.ts'
import { translateGeometryToNonNegativeOrigin, extractEdgesRecursively, alignLayerNodes, equalizePeerNodeDimensions, reanchorOffOutlineEndpoints, rerouteEdgesThroughNodes, repairInwardEndpointApproaches, repairResidualDiagonals, alignForkRejoinPeerCenters, alignPortLanes, alignLabeledSourcePort, centerPeerBarycenters, honorLinkRankDistance, bundleEdgePaths, markCorankFanInBundles, applySymmetricFanoutEmissions, applySymmetricParallelEdgeLanes, applyParallelDuplicateLanes, collapseTinyBundledHitches, reassignBundledSiblingLabels } from './passes/index.ts'

/** The mutable bag the post-ELK geometry passes thread through (see ./layout/pass.ts). */
export interface LayoutPassContext extends PassContextBase {
  readonly ownedMarkerPeers?: boolean
  readonly elkResult?: ElkNode
  readonly graph: MermaidGraph
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  groups: PositionedGroup[]
  /** State-diagram note boxes, populated by placeStateNotes (empty otherwise). */
  notes: PositionedStateNote[]
  readonly margins: MarginInfo | undefined
  bundled: Set<PositionedEdge>
  /** Whether the generic trunk builder owned any edges, before symmetry passes. */
  genericBundled: boolean
  readonly mergeEdges: boolean
  readonly style: ResolvedRenderStyle
  readonly layoutPadding: number
  readonly stateNoteMargin: number
  frozen: boolean
  /** Routes rebuilt around a reserved title band, retained for placement selection. */
  titleBandRepairs?: number
}

/** Necessary precondition for lane splitters. Avoid measuring their crossing
 * budgets when the diagram has no directed parallel pair to separate. */
export function hasParallelPair(edges: readonly Pick<PositionedEdge, 'source' | 'target' | 'label'>[], labeledOnly = false): boolean {
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.source === edge.target || (labeledOnly && !edge.label)) continue
    const pair = JSON.stringify([edge.source, edge.target])
    if (seen.has(pair)) return true
    seen.add(pair)
  }
  return false
}

/** A cosmetic centering proposal owns only coordinates, routes and label anchors.
 * Capture those channels on its first actual move; authored data, prepared text,
 * groups and certificates are neither copied nor replaced. */
function checkpointCentering(context: LayoutPassContext): () => void {
  const nodes = context.nodes.map(node => ({ node, x: node.x, y: node.y }))
  const edges = context.edges.map(edge => ({ edge,
    points: edge.points.map(point => ({ ...point })),
    labelPosition: edge.labelPosition ? { ...edge.labelPosition } : undefined,
  }))
  return () => {
    for (const { node, x, y } of nodes) { node.x = x; node.y = y }
    for (const { edge, points, labelPosition } of edges) { edge.points = points; edge.labelPosition = labelPosition }
  }
}

// The post-ELK geometry pipeline, reified (docs/design/system/route-contracts.md).
// The array IS the execution path; each `run` delegates to the existing pass function
// with unchanged arguments. Symmetry repairs retain their current order: duplicate
// lanes depend on symmetric parallel lanes, and fanout commutativity is unproved.
export const LAYOUT_PIPELINE: ReadonlyArray<LayoutPass<LayoutPassContext>> = [
  {
    id: 'extractEdgesRecursively', doc: 'flatten ELK edges to absolute coords (+orthogonalize cross-hierarchy)',
    after: [], mutates: ['extract'],
    run: c => {
      if (c.elkResult) extractEdgesRecursively(c.elkResult, c.graph, c.edges, 0, 0, c.margins)
      retainGraphText(c, c.style)
    },
  },
  {
    id: 'alignLayerNodes', doc: 'snap same-layer nodes onto a shared flow-axis line',
    after: ['extractEdgesRecursively'], mutates: ['positions', 'edges'],
    // Native layered placement owns rank alignment, ports and label channels.
    // ELK repairs and the shared forest fan preparation retain their passes.
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    mayChangeMetrics: { bends: 'improve-only', straight: 'improve-only' },
    run: c => { alignLayerNodes(c.nodes, c.edges, c.graph.direction, c.groups) },
  },
  {
    id: 'equalizePeerNodeDimensions', doc: 'equalize peer box sizes + pack layers so symmetry is visible downstream',
    after: ['alignLayerNodes'], mutates: ['positions', 'dimensions'],
    // Native forests already own measured boxes and their contact capacity.
    // Keep ELK's peer-size preparation without enlarging those owned boxes.
    enabled: c => Boolean(c.elkResult),
    run: c => { equalizePeerNodeDimensions(c.nodes, c.edges, c.groups, c.graph, c.style) },
  },
  {
    id: 'alignForkRejoinPeerCenters', doc: 'center fork/rejoin hubs on their peer barycenter',
    after: ['equalizePeerNodeDimensions'], mutates: ['positions', 'edges'],
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => { alignForkRejoinPeerCenters(c.nodes, c.edges, c.groups, c.graph, c.style) },
  },
  {
    id: 'alignPortLanes', doc: 'slide one endpoint node so a floating-straight edge becomes port-exact (Ruegg GD15)',
    after: ['alignForkRejoinPeerCenters'], mutates: ['positions', 'edges'],
    // Moving a native node would invalidate its reserved label channels.
    enabled: c => Boolean(c.elkResult),
    mayChangeMetrics: { straight: 'improve-only', portRate: 'improve-only', bends: 'improve-only' },
    run: c => { alignPortLanes(c.nodes, c.edges, c.groups, c.graph.direction, c.style) },
  },
  {
    id: 'centerPeerBarycenters', proposal: true, doc: 'center peer fan-in/fan-out trunks over peer barycenters (#57/#61)',
    after: ['alignPortLanes'], mutates: ['positions', 'edges'],
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => {
      let rollback: (() => void) | undefined
      centerPeerBarycenters(c.nodes, c.edges, c.groups, c.graph, c.style, () => { rollback ??= checkpointCentering(c) })
      return rollback
    },
  },
  {
    id: 'honorLinkRankDistance', doc: 'shove target sub-DAG to honor variable-length link rank distance; push ahead anything the shove lands on and rebuild blocked reconnect routes through free channels (#81)',
    after: ['centerPeerBarycenters'], mutates: ['positions', 'edges'],
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => { honorLinkRankDistance(c.nodes, c.edges, c.groups, c.graph) },
  },
  {
    // Runs after centering/rank-distance repair, before fanout may move peer
    // targets again. Its lane predictor preserves the later straightener's
    // intended source port.
    id: 'alignLabeledSourcePort', doc: 'slide a single-outgoing labelled source onto the predicted straightener lane so the exit stays mid-port',
    after: ['honorLinkRankDistance'], mutates: ['positions', 'edges'],
    mayChangeMetrics: { portRate: 'improve-only' },
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => { alignLabeledSourcePort(c.nodes, c.edges, c.groups, c.graph, c.graph.direction, c.style) },
  },
  {
    id: 'bundleEdgePaths', doc: 'bundle fan-out/fan-in edges into shared trunks (when mergeEdges)',
    after: ['alignLabeledSourcePort'], mutates: ['edges'],
    enabled: c => c.mergeEdges,
    run: c => {
      c.bundled = bundleEdgePaths(c.edges, c.nodes, c.groups, c.graph.direction, c.style)
      c.genericBundled = c.bundled.size > 0
    },
  },
  {
    // Re-route the co-ranked mixed-label fan-in spokes as symmetric converging
    // doglegs and mark them bundle-owned, so applyRouteContracts certifies them
    // 'bundle' — the justified-bend marker findRouteHitches and the layout-rubric
    // both key off. Independent of mergeEdges: the fan-in converges via centering
    // whether or not the plain bundler ran, so the marker must too.
    id: 'markCorankFanInBundles', doc: 're-route + mark co-ranked mixed-label fan-in spokes bundle-owned (justified symmetric-convergence bend)',
    after: ['bundleEdgePaths'], mutates: ['edges'],
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => { markCorankFanInBundles(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
  },
  {
    id: 'clipEdgeToShape', doc: 'clip edge endpoints to real (non-rect) shape outlines',
    after: ['markCorankFanInBundles'], mutates: ['edges'],
    mayChangeMetrics: { portRate: { worsenBy: 1, whenImproves: 'endpointApproaches' }, endpointApproaches: 'improve-only' },
    run: c => {
      const nodeMap = new Map(c.nodes.map(n => [n.id, n]))
      for (const edge of c.edges) {
        const bundle = c.bundled.has(edge) ? bundleRouteBeforeRewrite(edge) : undefined
        // Remove zero-length shafts, but preserve every nonzero approach vector.
        edge.points = edge.points.filter((point, index, points) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        trimBoundaryEndpointRuns(edge, sourceNode, targetNode)
        if (sourceNode) edge.points = clipEdgeToShape(edge.points, sourceNode, true)
        if (targetNode) edge.points = clipEdgeToShape(edge.points, targetNode, false)
        retainBundleRouteAfterRewrite(edge, bundle)
      }
    },
  },
  {
    id: 'applySymmetricFanoutEmissions', doc: 're-route small equivalent fan-outs symmetrically; mark bundle-owned',
    after: ['clipEdgeToShape'], mutates: ['positions', 'dimensions', 'edges'],
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
    run: c => { applySymmetricFanoutEmissions(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style, !c.elkResult) },
  },
  {
    id: 'applySymmetricParallelEdgeLanes', doc: 'separate parallel edges into symmetric non-crossing lanes',
    after: ['applySymmetricFanoutEmissions'], mutates: ['edges'],
    enabled: context => (Boolean(context.elkResult) || context.mergeEdges) && hasParallelPair(context.edges, true),
    mayChangeMetrics: { symErr: 'improve-only', crossings: 'improve-only' },
    run: c => { applySymmetricParallelEdgeLanes(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
  },
  {
    id: 'applyParallelDuplicateLanes', doc: 'split exact duplicate edges into separated lanes',
    after: ['applySymmetricParallelEdgeLanes'], mutates: ['edges'],
    enabled: context => (Boolean(context.elkResult) || context.mergeEdges) && hasParallelPair(context.edges),
    // Separating genuinely shared duplicate ink preserves authored multiplicity.
    // A local lane proposal may spend at most one crossing per repaired pair.
    mayChangeMetrics: { crossings: { worsenBy: 1, whenImproves: 'parallelOverlaps', perImprovement: true }, parallelOverlaps: 'improve-only' },
    run: c => { applyParallelDuplicateLanes(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style, c.elkResult ? undefined : c.style) },
  },
  {
    id: 'collapseTinyBundledHitches', doc: 'remove sub-perceptual hitches introduced by bundling',
    after: ['applySymmetricFanoutEmissions', 'applySymmetricParallelEdgeLanes', 'applyParallelDuplicateLanes'],
    mutates: ['edges'], mayChangeMetrics: { bends: 'improve-only' },
    run: c => { collapseTinyBundledHitches(c.nodes, c.edges, c.bundled) },
  },
  {
    id: 'reassignBundledSiblingLabels', doc: 're-home labels onto the correct bundled sibling segment',
    after: ['collapseTinyBundledHitches'], mutates: ['labels'],
    run: c => { reassignBundledSiblingLabels(c.nodes, c.edges, c.bundled, c.graph.direction, c.style, c.groups) },
  },
  {
    id: 'applyRouteContracts', doc: 'classify -> simplify -> straighten (fixed-point) -> certify; FREEZES node geometry',
    after: ['reassignBundledSiblingLabels'], mutates: ['edges'], freezesNodes: true,
    // An uncertified two-point route can still be diagonal or cross a node.
    // Hard/terminal repairs and fewer crossings may cost up to four bends
    // per removed defect. Mere preferred-port or symmetry changes may not.
    mayChangeMetrics: {
      straight: { worsenBy: 1, whenImproves: ['hard', 'crossings', 'endpointApproaches'], perImprovement: true },
      bends: { worsenBy: 4, whenImproves: ['hard', 'crossings', 'endpointApproaches'], perImprovement: true },
      portRate: { worsenBy: 1, whenImproves: ['hard', 'crossings', 'bends', 'endpointApproaches', 'opposingOverlaps'] },
    },
    run: c => { applyRouteContracts({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.bundled, c.style, c.elkResult ? undefined : { preserveSelfLoops: true, preserveLabels: true, preserveEndpointSeats: true, ownedMarkerPeers: c.ownedMarkerPeers }) },
  },
  {
    id: 'reanchorOffOutlineEndpoints', doc: 're-route an edge whose endpoint dangles off a moved node onto that node\'s flow port (edge-only, freeze-safe)',
    after: ['applyRouteContracts'], mutates: ['edges'],
    run: c => { reanchorOffOutlineEndpoints(c.nodes, c.edges, c.graph, c.style) },
  },
  {
    id: 'rerouteEdgesThroughNodes', doc: 're-route an edge left running through a node by a node-mover (honorLinkRankDistance/alignPortLanes) around the obstacle and restore protected marker leads before label placement (edge-only, freeze-safe)',
    after: ['reanchorOffOutlineEndpoints'], mutates: ['edges'],
    run: c => {
      const rerouted = rerouteEdgesThroughNodes(c.nodes, c.edges, c.graph, undefined, c.groups, c.style)
      c.titleBandRepairs = rerouted.titleBandRepairs
      repairInwardEndpointApproaches(c.nodes, c.edges, c.groups, edge => c.bundled.has(edge))
      repairMarkerTerminals({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style)
      repairInwardEndpointApproaches(c.nodes, c.edges, c.groups, edge => c.bundled.has(edge), true)
    },
  },
  {
    id: 'repairLabelsOnSharedTrunks', doc: 'give a shared-trunk label a clear seat or a proved private channel (edge-only, freeze-safe)',
    after: ['rerouteEdgesThroughNodes'], mutates: ['edges'],
    run: c => { repairLabelsOnSharedTrunks({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'repairLabelsOffOwnRoute', doc: 're-slot a labeled edge whose pill sits off its OWN route onto it — ELK offset placement on an already-straight edge (label-only, freeze-safe)',
    after: ['repairLabelsOnSharedTrunks'], mutates: ['labels'],
    run: c => { repairLabelsOffOwnRoute({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'separateEdgeLabelPills', doc: 'slide colliding edge-label pills along their own routes into clear slots — parallel/reciprocal lane labels stack at midpoints (label-only, freeze-safe)',
    after: ['repairLabelsOffOwnRoute'], mutates: ['labels'],
    run: c => { separateEdgeLabelPills({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style, c.elkResult ? undefined : { preserveRouteClearance: true }) },
  },
  {
    id: 'closeRouteContracts', doc: 're-prove settled final routes and re-certify only auditor-proven hitches; each scan monotonically removes bends (edge-only)',
    after: ['separateEdgeLabelPills'], mutates: ['edges'],
    mayChangeMetrics: { straight: 'improve-only', bends: 'improve-only' },
    run: c => { closeRouteContracts({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'repairResidualDiagonals', doc: 're-route a residual diagonal while preserving both endpoint approaches (edge-only, freeze-safe)',
    after: ['closeRouteContracts'], mutates: ['edges'],
    run: c => { repairResidualDiagonals(c.nodes, c.edges, c.groups, edge => c.bundled.has(edge)) },
  },
  {
    id: 'translateGeometryToNonNegativeOrigin', doc: 'shift whole graph to a non-negative origin (allowed after freeze)',
    after: ['closeRouteContracts'], mutates: ['translate'],
    run: c => { translateGeometryToNonNegativeOrigin(c.nodes, c.edges, c.groups, c.layoutPadding, c.style) },
  },
  {
    // State diagrams only (plan §State 1, repo #118): place each note box on
    // the DECLARED side of its target, pushed outward past any node/group/
    // route obstacle — the anchoring invariant upstream #3782 breaks. A note
    // landing at negative coords shifts the whole graph uniformly (translate,
    // freeze-safe).
    id: 'placeStateNotes', doc: 'place state-diagram note boxes on their declared side, clear of nodes/groups/routes (state diagrams only; translate-only)',
    after: ['translateGeometryToNonNegativeOrigin'], mutates: ['translate'],
    enabled: c => Boolean(c.graph.stateNotes?.length),
    run: c => { c.notes = placeStateNotes(c.nodes, c.edges, c.groups, c.graph, c.style, c.layoutPadding, c.stateNoteMargin) },
  },
]

/** Measure the pass's current geometry. Bundle ownership justifies bends
 * immediately, rather than waiting for a later certificate to change a score. */
function measureLayoutPass(context: LayoutPassContext, requested: readonly RubricMetric[]): PassMetrics {
  const positioned = { nodes: context.nodes, edges: context.edges, groups: context.groups, width: 0, height: 0 }
  return measureRubricMetrics(context.graph, positioned, requested, context.style, context.bundled)
}

// ============================================================================
// State-diagram note placement (plan §State 1)
// ============================================================================

const NOTE_CLEARANCE = 6
const NOTE_PADDING_X = 10
const NOTE_PADDING_Y = 8

interface NoteObstacle { x: number; y: number; w: number; h: number }

/**
 * Place every `note left|right of X` box beside its target's FINAL geometry.
 * Correct by construction: the x-band starts adjacent to the target on the
 * declared side and only ever moves OUTWARD (away from the target), stepping
 * past any node box, group box, edge segment, edge-label pill, or previously
 * placed note it would overlap — so "sits on the declared side" and "overlaps
 * nothing" hold simultaneously and deterministically. Runs after the freeze
 * as a translate-only pass: when a note lands at negative coordinates the
 * whole graph (notes included) shifts uniformly.
 */
function placeStateNotes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  graph: MermaidGraph,
  style: ResolvedRenderStyle,
  layoutPadding: number,
  noteGap: number,
): PositionedStateNote[] {
  const specs = graph.stateNotes ?? []
  if (specs.length === 0) return []

  const flatGroups: PositionedGroup[] = []
  const flatten = (gs: PositionedGroup[]): void => {
    for (const g of gs) { flatGroups.push(g); flatten(g.children) }
  }
  flatten(groups)

  // Fixed-order obstacle set: nodes, groups, edge segments (inflated), edge
  // label pills. Placed notes are appended as they land.
  const obstacles: NoteObstacle[] = []
  for (const n of nodes) obstacles.push({ x: n.x, y: n.y, w: n.width, h: n.height })
  for (const g of flatGroups) obstacles.push({ x: g.x, y: g.y, w: g.width, h: g.height })
  for (const e of edges) {
    if (e.style === 'invisible') continue
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!, b = e.points[i]!
      obstacles.push({
        x: Math.min(a.x, b.x) - 2, y: Math.min(a.y, b.y) - 2,
        w: Math.abs(a.x - b.x) + 4, h: Math.abs(a.y - b.y) + 4,
      })
    }
    const pill = e.label ? labelRect(e, style) : null
    if (pill) obstacles.push(pill)
  }

  const intersects = (a: NoteObstacle, b: NoteObstacle): boolean =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  const placed: PositionedStateNote[] = []
  for (const spec of specs) {
    // Anchor box: a leaf node, or the group box for a composite target.
    const node = nodes.find(n => n.id === spec.target)
    const group = node ? undefined : flatGroups.find(g => g.id === spec.target)
    const anchor = node ?? group
    if (!anchor) continue

    const metrics = graphTextBlock(resolveLabelContent(spec.text, spec.textContent), style, 'note')
    const w = metrics.width + NOTE_PADDING_X * 2
    const h = metrics.height + NOTE_PADDING_Y * 2
    const y = anchor.y + (anchor.height - h) / 2
    let x = spec.side === 'left' ? anchor.x - noteGap - w : anchor.x + anchor.width + noteGap

    // Push outward past obstacles (monotone, hence terminating). The anchor's
    // own box lies behind the starting position by construction (noteGap >
    // NOTE_CLEARANCE), so it never registers as a hit.
    for (let guard = 0; guard < obstacles.length + placed.length + 4; guard++) {
      const box: NoteObstacle = { x: x - NOTE_CLEARANCE, y: y - NOTE_CLEARANCE, w: w + NOTE_CLEARANCE * 2, h: h + NOTE_CLEARANCE * 2 }
      const hit = obstacles.find(o => intersects(box, o))
        ?? placed.map(p => ({ x: p.x, y: p.y, w: p.width, h: p.height })).find(o => intersects(box, o))
      if (!hit) break
      x = spec.side === 'left' ? hit.x - NOTE_CLEARANCE - w : hit.x + hit.w + NOTE_CLEARANCE
    }

    placed.push({ id: spec.id, target: spec.target, side: spec.side, text: spec.text, ...(spec.textContent ? { textContent: spec.textContent } : {}), textBlock: metrics, x, y, width: w, height: h })
  }

  // Uniform shift when any note went negative (left-side notes beside the
  // leftmost node). Translate-only: nodes, groups, edges, labels, notes all
  // move together, so certified routes stay valid.
  let minX = 0
  let minY = 0
  for (const p of placed) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y) }
  if (minX < 0 || minY < 0) {
    const dx = minX < 0 ? -minX + layoutPadding : 0
    const dy = minY < 0 ? -minY + layoutPadding : 0
    const moveGroup = (g: PositionedGroup): void => { g.x += dx; g.y += dy; g.children.forEach(moveGroup) }
    for (const n of nodes) { n.x += dx; n.y += dy }
    for (const g of groups) moveGroup(g)
    for (const e of edges) {
      for (const p of e.points) { p.x += dx; p.y += dy }
      if (e.labelPosition) { e.labelPosition.x += dx; e.labelPosition.y += dy }
    }
    for (const p of placed) { p.x += dx; p.y += dy }
  }
  return placed
}

export interface LayoutRouteProposal {
  positioned: PositionedGraph
  genericBundled: boolean
}

/** Both producers enter the same route, text and geometry contracts. Direct
 * producers already own edges; only the ELK adapter needs edge extraction. */
export function finishGraphGeometry(
  initial: PositionedGraph,
  graph: MermaidGraph,
  mergeEdges: boolean,
  layoutPadding: number,
  style: ResolvedRenderStyle,
  stateNoteMargin: number,
  elkResult?: ElkNode,
  sharedEdges?: readonly number[],
  ownedMarkerPeers = false,
): LayoutRouteProposal {
  const { nodes, edges, groups } = initial

  // Compute margin positions for cross-hierarchy edge routing.
  // Margins sit outside all group bounding boxes so edges don't cross through subgraphs.
  const allBounds = flattenGroupBounds(groups)
  const margins: MarginInfo | undefined = allBounds.length > 0
    ? {
        leftX: Math.min(...allBounds.map(b => b.x)) - 20,
        rightX: Math.max(...allBounds.map(b => b.right)) + 20,
      }
    : undefined

  // Post-ELK geometry pipeline (docs/design/system/route-contracts.md §8): the
  // LAYOUT_PIPELINE manifest is the execution path. extractNodesAndGroups + margins
  // (above) are the producer setup; the bounds computation (below) is the epilogue.
  const ctx: LayoutPassContext = {
    ownedMarkerPeers,
    elkResult,
    graph,
    nodes,
    edges,
    groups,
    notes: [],
    margins,
    bundled: new Set<PositionedEdge>(),
    genericBundled: false,
    mergeEdges,
    style,
    layoutPadding,
    stateNoteMargin,
    frozen: false,
  }
  if (sharedEdges) for (const index of sharedEdges) ctx.bundled.add(edges[index]!)
  retainGraphText(ctx, style)
  runPipeline(ctx, LAYOUT_PIPELINE, { measureMetrics: measureLayoutPass })

  // Calculate final bounds including all edge points
  // ELK should include edges in its dimensions, but we verify and expand if needed
  let width = initial.width
  let height = initial.height
  const arrowMargin = ARROW_HEAD.width
  const padding = layoutPadding

  for (const node of nodes) {
    width = Math.max(width, node.x + node.width + padding)
    height = Math.max(height, node.y + node.height + padding)
  }
  for (const bound of flattenGroupBounds(groups)) {
    width = Math.max(width, bound.right + padding)
    height = Math.max(height, bound.bottom + padding)
  }
  for (const edge of edges) {
    for (const p of edge.points) {
      width = Math.max(width, p.x + arrowMargin + padding)
      height = Math.max(height, p.y + arrowMargin + padding)
    }
    const pill = edge.labelBlock ? labelRect(edge, style) : null
    if (pill) {
      // Retain the established minimum label-area clearance while expanding
      // it for the actual prepared footprint of larger/styled labels.
      width = Math.max(width, edge.labelPosition!.x + 60 + padding, pill.x + pill.w + padding)
      height = Math.max(height, edge.labelPosition!.y + 20 + padding, pill.y + pill.h + padding)
    }
  }
  for (const note of ctx.notes) {
    width = Math.max(width, note.x + note.width + padding)
    height = Math.max(height, note.y + note.height + padding)
  }

  const positioned: PositionedGraph = {
    width, height, nodes, edges, groups,
    ...(ctx.notes.length > 0 ? { notes: ctx.notes } : {}),
  }
  if (ctx.titleBandRepairs) TITLE_BAND_DETOURS.add(positioned)
  return { genericBundled: ctx.genericBundled, positioned }
}

// Placement-only callers discard the generic routes, and therefore query only
// title widths. Rendered candidates also retain Main's title-detour preference.
const TITLE_BAND_DETOURS = new WeakSet<PositionedGraph>()
export function hasTitleBandDetour(positioned: PositionedGraph): boolean { return TITLE_BAND_DETOURS.has(positioned) }


