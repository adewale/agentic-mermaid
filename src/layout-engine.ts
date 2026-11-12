/** Graph backend selection and post-layout geometry/certification.
 * ELK input preparation lives in layout/elk-graph.ts; family adapters retain
 * their own projection contracts. Pass order and final certification stay here. */
import { estimateNodeSize, corankFanInBalancingLabels, mermaidToElk, usesSeparateHierarchy, groupTitleWidth, groupHeaderHeight } from './layout/elk-graph.ts'
export { estimateNodeSize, buildRoutePortHints } from './layout/elk-graph.ts'
import { withRouteMarkerCache } from './layout/route-marker-clearance.ts'
import { layoutOptimization } from './layout/optimization-context.ts'
import { measureLabelConflicts } from './layout/label-conflicts.ts'
import { resolveLabelContent } from './shared/display-text.ts'
import { preparePixelText } from './shared/prepared-text.ts'
import { iconFallbackToken } from './shared/icon-fallback.ts'
import { resolveMindmapIcon } from './mindmap/icons.ts'
import { graphTextBlock } from './graph-text.ts'
import { LABEL_PILL_PADDING } from './shared/edge-label-geometry.ts'
import { performanceExperimentEnabled } from './experimental-performance.ts'
import { indexedForestLayout, isIndexedForestGraph } from './experimental/indexed-forest.ts'
import { observeFallback } from './performance-observations.ts'
import { assertMermaidGraphWork, DiagramWorkLimitError } from './shared/diagram-limits.ts'
import type { ElkNode } from 'elkjs'
import type { MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, PositionedStateNote, RenderOptions } from './types.ts'
import { ARROW_HEAD, resolveRenderStyle, diagramTitleBand, positionDiagramTitle, titleOnlyCanvas } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import type { InternalStyleFace } from './scene/style-registry.ts'
import type { ResolvedStateVisualConfig, StateRenderOptions } from './state/config.ts'
import { elkLayoutSync } from './elk-instance.ts'
import { layoutAgenticCandidate, layoutAgenticPlacement } from './layout/agentic-layered.ts'
import { customTextMeasurementActive } from './text-measurement-profile.ts'
import { edgeSelectorIndices } from './shared/edge-selectors.ts'
import { graphEdgeMarkerPaintRegions } from './graph-connectors.ts'
import { DeferredDependencyError, runMeasuredGraphBackend, GraphLayoutUnsupportedError } from './layout/backend.ts'
import { measureRenderStage } from './render-stages.ts'
import { clipEdgeToShape } from './shape-clipping.ts'
import { measureRubricMetrics, countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps } from './layout-rubric.ts'
import { applyRouteContracts, closeRouteContracts, repairMarkerTerminals, labelRect, repairLabelsOffOwnRoute, repairLabelsOnSharedTrunks, separateEdgeLabelPills, trimBoundaryEndpointRuns } from './route-contracts.ts'
import { bundleRouteBeforeRewrite, retainBundleRouteAfterRewrite } from './layout/bundle-routes.ts'
import { resolveClassInlineStyle, resolveEdgeInlineStyle, resolveNodeInlineStyle } from './color-resolver.ts'
import { runPipeline } from './layout/pass.ts'
import type { LayoutPass, PassContextBase } from './layout/pass.ts'
import type { PassMetrics, RubricMetric } from './layout/pass.ts'
import { certifyCandidate, retainSelection, certifyLayoutWithRouteAlternative, certifyLayoutPlacementCandidates, positionedGeometryFindings, withinLayoutPreferenceBudget, LayoutCertificationError, type LayoutCertificationCandidate } from './layout/certification.ts'
import { mergeUncertifiedLayout } from './layout/uncertified-layout.ts'
import { DEFAULTS, flattenGroupBounds, findSubgraph, layoutEnvFlag } from './layout/geometry.ts'
import type { MarginInfo } from './layout/geometry.ts'
import { translateGeometryToNonNegativeOrigin, extractEdgesRecursively, alignLayerNodes, equalizePeerNodeDimensions, reanchorOffOutlineEndpoints, rerouteEdgesThroughNodes, repairInwardEndpointApproaches, repairResidualDiagonals, alignForkRejoinPeerCenters, alignPortLanes, alignLabeledSourcePort, centerPeerBarycenters, honorLinkRankDistance, bundleEdgePaths, markCorankFanInBundles, applySymmetricFanoutEmissions, applySymmetricParallelEdgeLanes, applyParallelDuplicateLanes, collapseTinyBundledHitches, reassignBundledSiblingLabels } from './layout/passes/index.ts'

export { directionToElk } from './layout/backend.ts'
export { alignLayerNodes, orthogonalizeEdgePoints } from './layout/passes/index.ts'
interface LayoutEngineOptions extends RenderOptions {
  /** @internal Family-owned geometry for placement; labels do not size these marks. */
  nodeSizes?: ReadonlyMap<string, { width: number; height: number }>
  /** @internal Preserve direct child order in compound nodes for projected families. */
  preserveSubgraphChildOrder?: boolean
  /** @internal Precomputed built-in style face for projected family layout. */
  styleFace?: InternalStyleFace
  /** @internal Boundary-projected State metrics; never a public raw option. */
  stateVisual?: ResolvedStateVisualConfig
  /** @internal Lay compound nodes out separately, which honors their minimum
   * width; set when a group came back narrower than its title. */
  separateHierarchy?: boolean
  /** Internal optional ELK candidate; explicit adjacency still owns its order. */
  preferModelOrder?: boolean
  /** @internal The diagram's title (frontmatter `title:`), drawn in a band
   * above the graph. */
  diagramTitle?: string
  /** @internal Bounded certification alternative; never changes global process state. */
  disableCorankFanIn?: boolean
  /** @internal Disable cosmetic route comparisons when a family uses this
   * graph only for placement and subsequently replaces its routes. Hard
   * certification and the existing title-readability fallback still apply. */
  compareRoutePreferences?: boolean
}

// ============================================================================
// Result conversion: ELK output → PositionedGraph
// ============================================================================

/**
 * Convert ELK layout result to our PositionedGraph format.
 */
/** The mutable bag the post-ELK geometry passes thread through (see ./layout/pass.ts). */
export interface LayoutPassContext extends PassContextBase {
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
  /** Routes rerouteEdgesThroughNodes had to detour around a reserved title band. */
  titleBandRepairs?: number
}

/** Necessary precondition for lane splitters. Avoid measuring their crossing
 * budgets when the diagram has no directed parallel pair to separate. */
function hasParallelPair(edges: readonly Pick<PositionedEdge, 'source' | 'target' | 'label'>[], labeledOnly = false): boolean {
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
    // This preparation pass equalizes dimensions and may move peer centers.
    // The following alignment passes own the final barycenter contract.
    enabled: c => Boolean(c.elkResult) || c.mergeEdges,
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
    run: c => { applySymmetricFanoutEmissions(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
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
    run: c => { applyRouteContracts({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.bundled, c.style, c.elkResult ? undefined : { preserveSelfLoops: true, preserveLabels: true, preserveStraightRoutes: true }) },
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
      const rerouted = rerouteEdgesThroughNodes(c.nodes, c.edges, c.graph, undefined, c.groups)
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
    id: 'repairResidualDiagonals', doc: 're-route a diagonal segment the settled route still has (a node mover shifted part of a collinear run) into an orthogonal step, keeping both endpoints (edge-only, freeze-safe)',
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

/** Prepared text survives all subsequent geometry-only passes. */
export function retainGraphText(positioned: Pick<PositionedGraph, 'nodes' | 'edges' | 'groups'>, style: ResolvedRenderStyle): void {
  for (const node of positioned.nodes) {
    node.labelBlock ??= graphTextBlock(resolveLabelContent(node.label, node.labelContent), style, 'node')
    if (node.icon && !node.iconFallbackBlock && !resolveMindmapIcon(node.icon)) node.iconFallbackBlock = preparePixelText(iconFallbackToken(node.icon), { fontSize: 10, fontWeight: 400 })
  }
  for (const edge of positioned.edges) if (edge.label !== undefined) edge.labelBlock ??= graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
  const group = (value: PositionedGroup): void => {
    value.labelBlock ??= graphTextBlock(resolveLabelContent(value.label, value.labelContent), style, 'group')
    value.headerHeight = groupHeaderHeight(value, style, value.labelBlock)
    value.children.forEach(group)
  }
  positioned.groups.forEach(group)
}

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

interface LayoutRouteProposal {
  positioned: PositionedGraph
  genericBundled: boolean
}

type RememberRouteAlternative = (positioned: PositionedGraph, produce: () => PositionedGraph) => void

function elkToPositioned(
  elkResult: ElkNode,
  graph: MermaidGraph,
  mergeEdges: boolean = false,
  layoutPadding: number = DEFAULTS.padding,
  style: ResolvedRenderStyle = resolveRenderStyle({}),
  stateNoteMargin: number = 18,
): LayoutRouteProposal {
  const nodes: PositionedNode[] = []
  const edges: PositionedEdge[] = []
  const groups: PositionedGroup[] = []

  // Build set of subgraph IDs for distinguishing compound nodes from leaf nodes
  const subgraphIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    collectAllSubgraphIds(sg, subgraphIds)
  }

  // Extract nodes and groups recursively
  extractNodesAndGroups(elkResult, graph, subgraphIds, nodes, groups, 0, 0)

  return finishGraphGeometry({ width: elkResult.width ?? 800, height: elkResult.height ?? 600, nodes, edges, groups }, graph, mergeEdges, layoutPadding, style, stateNoteMargin, elkResult)
}

/** Both producers enter the same route, text and geometry contracts. Direct
 * producers already own edges; only the ELK adapter needs edge extraction. */
function finishGraphGeometry(
  initial: PositionedGraph,
  graph: MermaidGraph,
  mergeEdges: boolean,
  layoutPadding: number,
  style: ResolvedRenderStyle,
  stateNoteMargin: number,
  elkResult?: ElkNode,
  sharedEdges?: readonly number[],
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
    width,
    height,
    nodes,
    edges,
    groups,
    ...(ctx.notes.length > 0 ? { notes: ctx.notes } : {}),
  }
  if (ctx.titleBandRepairs) TITLE_BAND_DETOURS.add(positioned)
  return { genericBundled: ctx.genericBundled, positioned }
}

/** Placements whose routes needed a detour around a group's reserved title
 * band. The detour certifies, but a bounded alternative that needed none (such
 * as the separate-hierarchy placement, built to keep cross-hierarchy routes off
 * title bands) is preferred whenever it also certifies. */
const TITLE_BAND_DETOURS = new WeakSet<PositionedGraph>()


/**
 * Recursively extract positioned nodes and groups from ELK result.
 */
function extractNodesAndGroups(
  elkNode: ElkNode,
  graph: MermaidGraph,
  subgraphIds: Set<string>,
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  offsetX: number,
  offsetY: number
): void {
  if (!elkNode.children) return

  for (const child of elkNode.children) {
    const x = (child.x ?? 0) + offsetX
    const y = (child.y ?? 0) + offsetY
    const width = child.width ?? 0
    const height = child.height ?? 0

    if (subgraphIds.has(child.id)) {
      // This is a subgraph/group
      const childGroups: PositionedGroup[] = []

      // Recursively process children
      extractNodesAndGroups(child, graph, subgraphIds, nodes, childGroups, x, y)

      const mermaidSg = findSubgraph(graph.subgraphs, child.id)
      const paint = mermaidSg?.stateComposite ? resolveClassInlineStyle(child.id, graph) : undefined
      groups.push({
        id: child.id,
        label: mermaidSg?.label ?? '',
        ...(mermaidSg?.labelContent ? { labelContent: mermaidSg.labelContent } : {}),
        x,
        y,
        width,
        height,
        children: childGroups,
        ...(mermaidSg?.headerMinHeight === undefined ? {} : { headerMinHeight: mermaidSg.headerMinHeight }),
        ...(mermaidSg?.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
        ...(paint ? { inlineStyle: paint } : {}),
      })
    } else {
      // This is a leaf node
      const mNode = graph.nodes.get(child.id)
      if (mNode) {
        const inlineStyle = resolveNodeInlineStyle(child.id, graph)
        // User-assigned Mermaid class name(s) for external CSS targeting (#81).
        const assigned = graph.classAssignments.get(child.id)
        const classNames = assigned ? assigned.split(/\s+/).filter(Boolean) : undefined

        nodes.push({
          id: child.id,
          label: mNode.label,
          ...(mNode.labelContent ? { labelContent: mNode.labelContent } : {}),
          ...(mNode.labelBlock ? { labelBlock: mNode.labelBlock } : {}),
          shape: mNode.shape,
          ...(mNode.borders !== undefined ? { borders: mNode.borders } : {}),
          ...(mNode.floatingNoteId !== undefined ? { floatingNoteId: mNode.floatingNoteId } : {}),
          ...(mNode.semanticShape !== undefined ? { semanticShape: mNode.semanticShape } : {}),
          x,
          y,
          width,
          height,
          inlineStyle,
          classNames,
          ...(mNode.icon ? { icon: mNode.icon } : {}),
          ...(mNode.image ? { image: mNode.image } : {}),
          ...(mNode.iconForm ? { iconForm: mNode.iconForm } : {}),
          ...(mNode.href ? { href: mNode.href } : {}),
        })
      }

      // Also check for nested children (shouldn't happen for leaf nodes, but be safe)
      if (child.children && child.children.length > 0) {
        extractNodesAndGroups(child, graph, subgraphIds, nodes, groups, x, y)
      }
    }
  }
}

/** Recursively collect all subgraph IDs */
function collectAllSubgraphIds(sg: MermaidSubgraph, out: Set<string>): void {
  out.add(sg.id)
  for (const child of sg.children) {
    collectAllSubgraphIds(child, out)
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Authored break hints can prepare to no display text. Preserve the caller's
 * graph while omitting such captions before either producer reserves ranks,
 * anchors and painted pills for them. Empty metrics alone are not evidence:
 * a custom font may legitimately measure visible text at zero advance. */
function graphWithDisplayCaptions(graph: MermaidGraph, style: ResolvedRenderStyle): MermaidGraph {
  let display = graph
  for (const [index, edge] of graph.edges.entries()) {
    if (!edge.label || !/[\u00ad\u200b]/.test(edge.label)) continue
    const block = graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
    if (block.lineBlocks.some(line => line.runs.some(run => run.text.length > 0))) continue
    if (display === graph) display = { ...graph, edges: [...graph.edges] }
    display.edges[index] = { ...edge, label: '' }
  }
  return display
}

/**
 * Lay out a parsed MermaidGraph using ELK.js (synchronous).
 * Returns a fully positioned graph ready for rendering.
 */
export function layoutGraphSync(
  graph: MermaidGraph,
  options: LayoutEngineOptions = {}
): PositionedGraph {
  if (graph.linkCurves?.size) graph = {
    ...graph,
    edges: graph.edges.map((edge, index) => ({ ...edge, curve: edge.curve ?? graph.linkCurves!.get(index) ?? graph.linkCurves!.get('default') })),
  }
  const optimization = layoutOptimization(Boolean(options.graphLayout?.quality || options.graphLayout?.viewport))
  return withRouteMarkerCache(() => optimization ? optimization.withLayoutOptimizationBudget(graph, options.graphLayout, () => layoutGraphWithBudget(graph, options)) : layoutGraphWithBudget(graph, options))
}

function layoutGraphWithBudget(graph: MermaidGraph, options: LayoutEngineOptions): PositionedGraph {
  assertMermaidGraphWork(graph)
  const style = resolveRenderStyle(options, (options as StateRenderOptions).stateVisual?.styleDefaults, options.styleFace)
  const positioned = layoutUntitledGraph(graphWithDisplayCaptions(graph, style), options)
  retainGraphText(positioned, style)
  const band = diagramTitleBand(options.diagramTitle, resolveRenderStyle(options, (options as StateRenderOptions).stateVisual?.styleDefaults, options.styleFace))
  if (!band) return positioned
  // The title takes a band above everything the layout placed; the graph
  // moves down beneath it and the canvas widens to a title wider than it.
  const padding = options.padding ?? DEFAULTS.padding
  if (positioned.width === 0 && positioned.height === 0) return Object.assign(positioned, titleOnlyCanvas(band, padding))
  translatePositionedGraph(positioned, band.height)
  positioned.height += band.height
  positioned.width = Math.max(positioned.width, band.width + 2 * padding)
  positioned.title = positionDiagramTitle(band, positioned.width, padding)
  const findings = positionedGeometryFindings(positioned, style)
  if (findings.length === 0) return positioned
  // Report layout safety draws a title band whose only failures are drawable,
  // recording them with the candidate's receipt; strict safety refuses.
  if (options.layoutSafety === 'strict' || findings.some(finding => !finding.drawable)) {
    throw new LayoutCertificationError([{ strategy: 'final-title-projection', violations: findings.map(finding => finding.text) }])
  }
  const prior = positioned.uncertifiedLayout ?? positioned.certification
  positioned.uncertifiedLayout = mergeUncertifiedLayout(positioned.uncertifiedLayout, prior?.strategy ?? 'final-title-projection', findings.map(finding => finding.drawable!), prior?.attempts)
  delete positioned.certification
  return positioned
}

/** @internal ELK family placement keeps all relationship rank/order inputs.
 * Generic routes are temporary and never returned as a family route proof. */
export function layoutElkGraphPlacementSync(
  graph: MermaidGraph, options: Omit<LayoutEngineOptions, 'graphLayout' | 'diagramTitle'> = {},
): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  assertMermaidGraphWork(graph)
  const placed = layoutElkGraph(graph, options, 'placement')
  retainGraphText({ ...placed, edges: [] }, resolveRenderStyle(options, undefined, options.styleFace))
  return placed
}

/** @internal Architecture owns routes and its final family certificate. This
 * result is placement only and must never be exposed as a certified graph. */
export function layoutNativeGraphPlacementSync(
  graph: MermaidGraph, options: LayoutEngineOptions = {},
): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  assertMermaidGraphWork(graph)
  const style = resolveRenderStyle(options, undefined, options.styleFace)
  return layoutAgenticPlacement(graph, options, style, agenticGraphBindings)
}

export function translatePositionedGraph(positioned: PositionedGraph, dy: number): void {
  const moveGroup = (group: PositionedGroup): void => {
    group.y += dy
    for (const child of group.children) moveGroup(child)
  }
  for (const node of positioned.nodes) node.y += dy
  for (const group of positioned.groups) moveGroup(group)
  for (const edge of positioned.edges) {
    for (const point of edge.points) point.y += dy
    if (edge.labelPosition) edge.labelPosition.y += dy
  }
  for (const note of positioned.notes ?? []) note.y += dy
}

function layoutCandidate(
  graph: MermaidGraph,
  options: LayoutEngineOptions,
  rememberAlternative?: RememberRouteAlternative,
  indexed = false,
): PositionedGraph {
  const stateVisual = (options as StateRenderOptions).stateVisual
  const opts = { ...DEFAULTS, ...options, ...(stateVisual ? { stateVisual } : {}) }
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults, options.styleFace)
  const elkGraph = mermaidToElk(graph, opts, style)
  if (indexed && !stateVisual) {
    const result = indexedForestLayout(graph, elkGraph, opts.padding, opts.nodeSpacing, opts.layerSpacing)
    if (!result) throw new Error('Graph is ineligible for indexed forest layout')
    const bundled = elkToPositioned(result, graph, DEFAULTS.mergeEdges, opts.padding, style, 18)
    if (bundled.genericBundled) {
      rememberAlternative?.(bundled.positioned, () => elkToPositioned(result, graph, false, opts.padding, style, 18).positioned)
    }
    return bundled.positioned
  }
  // An unconnected leaf has no ranking, crossing, packing or routing choice.
  // Use the same measured node and padding, then retain the complete geometry
  // pipeline and certification. Compound/state/connected graphs still use ELK.
  if (graph.nodes.size === 1 && graph.edges.length === 0 && graph.subgraphs.length === 0
    && !graph.stateNotes?.length && !stateVisual && elkGraph.children?.length === 1) {
    const child = elkGraph.children[0]!
    const result = {
      ...elkGraph,
      width: child.width! + 2 * opts.padding,
      height: child.height! + 2 * opts.padding,
      children: [{ ...child, x: opts.padding, y: opts.padding }],
    }
    return elkToPositioned(result, graph, DEFAULTS.mergeEdges, opts.padding, style, 18).positioned
  }
  // ELK's bundled (GWT-compiled) code can throw internal exceptions on rare
  // dense multigraphs — observed with feedbackEdges routing, and pre-existing
  // with post-compaction + forced model order. Crash-freedom is part of this
  // renderer's contract, so degrade through progressively plainer option
  // sets; the route-contract pass repairs whatever the survivor produces.
  const degradations: Array<Record<string, string>> = [
    {},
    { 'elk.layered.feedbackEdges': 'false' },
    { 'elk.layered.feedbackEdges': 'false', 'elk.layered.compaction.postCompaction.strategy': 'NONE' },
    {
      'elk.layered.feedbackEdges': 'false',
      'elk.layered.compaction.postCompaction.strategy': 'NONE',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
      'elk.layered.highDegreeNodes.treatment': 'false',
    },
  ]
  let result: ElkNode | undefined
  let lastError: unknown
  let degradationReason = 'exception'
  let attemptNumber = 0
  for (const overrides of degradations) {
    if (++attemptNumber > 1) observeFallback('elk-degradation', degradationReason, attemptNumber)
    const attempt = Object.keys(overrides).length === 0 ? elkGraph : mermaidToElk(graph, opts, style)
    if (Object.keys(overrides).length > 0) {
      attempt.layoutOptions = { ...attempt.layoutOptions, ...overrides }
    }
    layoutOptimization()?.recordLayoutProducer()
    try {
      const candidate = elkLayoutSync(attempt)
      // ELK can occasionally return a nominally successful graph containing
      // NaN geometry (notably a disconnected node beside a self-loop). Treat
      // that exactly like an ELK exception so the existing deterministic
      // degradation ladder gets a chance to produce usable geometry.
      if (containsNonFiniteNumber(candidate)) {
        lastError = new Error('ELK returned non-finite layout geometry')
        degradationReason = 'non-finite-geometry'
        continue
      }
      result = candidate
      break
    } catch (err) {
      if (err instanceof DiagramWorkLimitError || err instanceof DeferredDependencyError) throw err
      lastError = err
      degradationReason = 'exception'
    }
  }
  if (!result) throw lastError
  const elkResult = result
  const noteMargin = stateVisual?.noteMargin ?? 18
  const bundled = elkToPositioned(elkResult, graph, DEFAULTS.mergeEdges, opts.padding, style, noteMargin)
  if (bundled.genericBundled) {
    rememberAlternative?.(bundled.positioned, () => elkToPositioned(elkResult, graph, false, opts.padding, style, noteMargin).positioned)
  }
  return bundled.positioned
}

export type AgenticGraphOptions = LayoutEngineOptions
export type AgenticGraphBindings = {
  edgeSelectorIndices: typeof edgeSelectorIndices
  graphEdgeMarkerPaintRegions: typeof graphEdgeMarkerPaintRegions
  customTextMeasurementActive: typeof customTextMeasurementActive
  certifyCandidate: typeof certifyCandidate
  retainSelection: typeof retainSelection
  countOpposingRouteOverlaps: typeof countOpposingRouteOverlaps
  countParallelRouteOverlaps: typeof countParallelRouteOverlaps
  measureLabelConflicts: typeof measureLabelConflicts
  countEdgeCrossings: typeof countEdgeCrossings
  DEFAULTS: typeof DEFAULTS
  LABEL_PILL_PADDING: typeof LABEL_PILL_PADDING
  measureRenderStage: typeof measureRenderStage
  graphTextBlock: typeof graphTextBlock
  resolveLabelContent: typeof resolveLabelContent
  groupTitleWidth: typeof groupTitleWidth
  groupHeaderHeight: typeof groupHeaderHeight
  estimateNodeSize: typeof estimateNodeSize
  resolveNodeInlineStyle: typeof resolveNodeInlineStyle
  resolveEdgeInlineStyle: typeof resolveEdgeInlineStyle
  resolveClassInlineStyle: typeof resolveClassInlineStyle
  containsNonFiniteNumber: typeof containsNonFiniteNumber
  finishGraphGeometry: typeof finishGraphGeometry
  unsupported: (reason: string) => never
}
const agenticGraphBindings: AgenticGraphBindings = {
  edgeSelectorIndices, graphEdgeMarkerPaintRegions,
  customTextMeasurementActive, certifyCandidate, retainSelection, countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps, measureLabelConflicts,
  DEFAULTS, LABEL_PILL_PADDING, measureRenderStage, graphTextBlock, resolveLabelContent, groupTitleWidth, groupHeaderHeight, estimateNodeSize, resolveNodeInlineStyle, resolveEdgeInlineStyle, resolveClassInlineStyle, containsNonFiniteNumber, finishGraphGeometry,
  unsupported: reason => { throw new GraphLayoutUnsupportedError(reason) },
}

function layoutUntitledGraph(graph: MermaidGraph, options: LayoutEngineOptions): PositionedGraph {
  // Preserve existing bytes, receipts and the explicitly enabled legacy forest
  // experiment when no selector was supplied.
  if (!options.graphLayout) return layoutElkGraph(graph, options)
  return runMeasuredGraphBackend(options, () => {
    const style = resolveRenderStyle(options, options.stateVisual?.styleDefaults, options.styleFace)
    return layoutAgenticCandidate(graph, options, style, agenticGraphBindings)
  }, () => layoutElkGraph(graph, options), true, (positioned, decision) => { positioned.layoutDecision = decision })
}

/** Four deterministic strategy combinations, each with the existing bounded
 * ELK option degradation ladder. No recursive retry or process-env mutation. */
function layoutElkGraph(graph: MermaidGraph, options: LayoutEngineOptions): PositionedGraph
function layoutElkGraph(graph: MermaidGraph, options: LayoutEngineOptions, purpose: 'placement'): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'>
function layoutElkGraph(graph: MermaidGraph, options: LayoutEngineOptions, purpose?: 'placement'): PositionedGraph | Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  const style = resolveRenderStyle(options, options.stateVisual?.styleDefaults, options.styleFace)
  // A placement with a narrow title, or with final routes detoured around a
  // title band, defers to the next bounded candidate and is kept if that one
  // fails. Family placement discards these generic routes, so only titles count.
  const preferReadableTitles = (positioned: PositionedGraph) => groupsNarrowerThanTitles(positioned.groups, graph, style) || (purpose !== 'placement' && TITLE_BAND_DETOURS.has(positioned))
  const compareRoutes = options.compareRoutePreferences !== false
  const routeAlternatives = new WeakMap<PositionedGraph, () => PositionedGraph>()
  // Keep parallel pairs with their specialized route owners: fewer proper
  // crossings can still collapse duplicate endpoint lanes into ambiguous ink.
  const rememberAlternative: RememberRouteAlternative | undefined = compareRoutes && withinLayoutPreferenceBudget(graph) && !hasParallelPair(graph.edges)
    ? (positioned, produce) => { routeAlternatives.set(positioned, produce) }
    : undefined
  const distinctHierarchy = graph.subgraphs.length > 0 && !usesSeparateHierarchy(graph, options)
  const candidates: LayoutCertificationCandidate[] = [{
    strategy: 'default', produce: () => layoutCandidate(graph, options, rememberAlternative),
    preferNext: preferReadableTitles,
  }]
  // One conditional producer before the complete established fallback list.
  // Projected Architecture graphs reserve authored child order and have
  // side-constrained placement of their own; keep their original producer.
  // Tight spacing can remove the forest producer's route channels and break
  // mandatory downstream pass contracts. Preserve ELK for those requests.
  const forestSpacing = (options.nodeSpacing ?? DEFAULTS.nodeSpacing) > 0 && (options.layerSpacing ?? DEFAULTS.layerSpacing) > 0
  const preliminary = options.graphLayout === undefined && performanceExperimentEnabled('indexed-layout') && forestSpacing && !options.stateVisual && !options.preserveSubgraphChildOrder && isIndexedForestGraph(graph)
    ? { strategy: 'indexed-forest', produce: () => layoutCandidate(graph, options, rememberAlternative, true), preferNext: preferReadableTitles }
    : undefined
  if (!options.separateHierarchy) {
    candidates.push({ strategy: 'separate-hierarchy', produce: () => layoutCandidate(graph, { ...options, separateHierarchy: true }, rememberAlternative), preferNext: preferReadableTitles, qualityAlternative: compareRoutes && distinctHierarchy })
  }
  if (!options.disableCorankFanIn && !layoutEnvFlag('APL_NO_CORANK_FANIN')) {
    candidates.push({ strategy: 'without-corank', produce: () => layoutCandidate(graph, { ...options, disableCorankFanIn: true }, rememberAlternative), preferNext: preferReadableTitles, qualityAlternative: compareRoutes && corankFanInBalancingLabels(graph, style).size > 0 })
    if (!options.separateHierarchy) candidates.push({ strategy: 'separate-without-corank', produce: () => layoutCandidate(graph, { ...options, separateHierarchy: true, disableCorankFanIn: true }, rememberAlternative), preferNext: preferReadableTitles, qualityAlternative: compareRoutes && distinctHierarchy })
  }
  // Search placement strategies first, then test one completed route proposal
  // only for the selected placement, reusing its ELK result and certified score.
  // One preliminary forest, at most four ELK placements and one route pipeline;
  // the existing 16-ELK exceptional upper bound is unchanged.
  // Report layout safety still draws a graph no candidate certifies, from its
  // best drawable candidate, with an uncertified receipt; strict refuses.
  const allowUncertified = options.layoutSafety !== 'strict'
  if (purpose === 'placement') return certifyLayoutPlacementCandidates(graph, style, candidates, preliminary, allowUncertified)
  const selected = certifyLayoutWithRouteAlternative(graph, style, candidates, (placed, score) => {
    const makeRoute = routeAlternatives.get(placed)
    if (!makeRoute || (score.edgeCrossings === 0 && score.labelConflicts === 0)) return undefined
    return { strategy: 'without-generic-bundling', produce: makeRoute, preferNext: preferReadableTitles }
  }, preliminary, allowUncertified)
  const certification = selected.certification!, before = certification.preference.selectedScore
  const optimization = layoutOptimization()
  if (options.graphLayout?.quality === 'balanced' && optimization?.layoutOptimizationEnabled('elk-order') && optimization.canExploreLayout()
    && (before.edgeCrossings > 0 || before.labelConflicts > 0) && withinLayoutPreferenceBudget(graph)
    && !options.preserveSubgraphChildOrder && !options.layoutHints?.adjacent?.length && !hasParallelPair(graph.edges)) {
    const result = certifyCandidate(graph, style, { strategy: 'prefer-model-order',
      produce: () => optimization.optionalLayout(() => layoutCandidate(graph, { ...options, preferModelOrder: true }, rememberAlternative)) ?? selected,
      preferNext: preferReadableTitles,
    })
    if (result.certified && optimization.nonRegressingAlternative(selected, result.certified.positioned)) {
      optimization.selectedLayoutOptimization('prefer-model-order')
      return retainSelection(graph, { selected: result.certified, reason: 'non-regressing',
        attempts: certification.attempts + 1,
        compared: [...certification.preference.compared, { strategy: result.certified.strategy, score: result.certified.score }],
      })
    }
  }
  return selected
}

function groupsNarrowerThanTitles(groups: readonly PositionedGroup[], graph: MermaidGraph, style: ResolvedRenderStyle): boolean {
  return groups.some(group => {
    const subgraph = findSubgraph(graph.subgraphs, group.id)
    return (subgraph !== undefined && group.width + 0.5 < groupTitleWidth(subgraph, style))
      || groupsNarrowerThanTitles(group.children, graph, style)
  })
}

function containsNonFiniteNumber(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (value === null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(child => containsNonFiniteNumber(child, seen))
  return Object.values(value as Record<string, unknown>)
    .some(child => containsNonFiniteNumber(child, seen))
}

/**
 * Convert MermaidGraph to ELK format (for benchmarking conversion overhead).
 */
export function convertToElkFormat(
  graph: MermaidGraph,
  options: LayoutEngineOptions = {}
): ElkNode {
  const stateVisual = (options as StateRenderOptions).stateVisual
  const opts = { ...DEFAULTS, ...options, ...(stateVisual ? { stateVisual } : {}) }
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults, options.styleFace)
  return mermaidToElk(graph, opts, style)
}
