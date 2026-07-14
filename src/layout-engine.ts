/**
 * Layout engine for Agentic Mermaid (ELK.js based).
 *
 * Converts MermaidGraph to ELK's JSON format, runs layout, and converts
 * the result back to PositionedGraph. This is the core layout engine used
 * by all graph-based diagram types (flowcharts, state, ER, class).
 *
 * ELK (Eclipse Layout Kernel) features:
 *   - Native orthogonal edge routing (no post-processing needed)
 *   - Proper handling of compound nodes (subgraphs)
 *   - Support for disconnected graphs
 *   - Direction overrides per subgraph
 *   - Sophisticated algorithms for complex graphs
 *
 * Uses elk.bundled.js (pure synchronous JS, no WASM/Workers).
 * Safe for Electron, Node, and browser environments.
 */

import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs'
import type {
  MermaidGraph,
  MermaidSubgraph,
  MermaidEdge,
  MermaidNode,
  Direction,
  PositionedGraph,
  PositionedNode,
  PositionedEdge,
  PositionedGroup,
  PositionedStateNote,
  Point,
  RenderOptions,
  NodeShape,
  DiamondFacet,
  RouteClass,
} from './types.ts'
import { ARROW_HEAD, FLOWCHART_DOTTED_DASH, applyTextTransform, resolveRenderStyle } from './styles.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import type { InternalStyleFace } from './scene/style-registry.ts'
import { resolvedStateVisualOf, type ResolvedStateVisualConfig } from './state/config.ts'
import { measureMultilineText } from './text-metrics.ts'
import { elkLayoutSync } from './elk-instance.ts'
import { clipEdgeToShape } from './shape-clipping.ts'
import { onShapeOutline, assessLayout, hardViolations } from './layout-rubric.ts'
import { applyRouteContracts, classifyRoutes, diamondFacetPorts, labelRect, PORT_EXACT, repairLabelsOffOwnRoute, repairLabelsOnSharedTrunks, separateEdgeLabelPills, shapePorts, simplifyPolyline } from './route-contracts.ts'
import type { LabelMetricsStyle } from './route-contracts.ts'
import { resolveEdgeInlineStyle, resolveNodeInlineStyle } from './color-resolver.ts'
import { runPipeline } from './layout/pass.ts'
import type { LayoutPass, PassContextBase } from './layout/pass.ts'
import {
  DEFAULTS,
  flattenGroupBounds,
  polylineLength,
  pointAtPathDistance,
  calculatePathMidpoint,
  layoutFlow,
  positionedNodeCenter,
  nodeMainStart,
  nodeCrossStart,
  nodeCrossSize,
  nodeMainSize,
  nodeCrossCenter,
  nodeMainCenter,
  rectsOverlap,
  findSubgraph,
  layoutEnvFlag,
} from './layout/geometry.ts'
import type { MarginInfo } from './layout/geometry.ts'
import {
  translateGeometryToNonNegativeOrigin,
  extractEdgesRecursively,
  alignLayerNodes,
  equalizePeerNodeDimensions,
  reanchorOffOutlineEndpoints,
  rerouteEdgesThroughNodes,
  alignForkRejoinPeerCenters,
  alignPortLanes,
  alignLabeledSourcePort,
  centerPeerBarycenters,
  honorLinkRankDistance,
  bundleEdgePaths,
  markCorankFanInBundles,
  applySymmetricFanoutEmissions,
  applySymmetricParallelEdgeLanes,
  applyParallelDuplicateLanes,
  collapseTinyBundledHitches,
  reassignBundledSiblingLabels,
} from './layout/passes/index.ts'
// Re-export the two passes that were part of the public surface before relocation.
export { alignLayerNodes, orthogonalizeEdgePoints } from './layout/passes/index.ts'

interface LayoutEngineOptions extends RenderOptions {
  /** @internal Preserve direct child order in compound nodes for projected families. */
  preserveSubgraphChildOrder?: boolean
  /** @internal Precomputed built-in style face for projected family layout. */
  styleFace?: InternalStyleFace
  /** @internal Boundary-projected State metrics; never a public raw option. */
  stateVisual?: ResolvedStateVisualConfig
}

type ElkConversionOptions = Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>> &
  Pick<LayoutEngineOptions, 'preserveSubgraphChildOrder'> & { stateVisual?: ResolvedStateVisualConfig }

// ============================================================================
// Layout options
// ============================================================================

/** Default render options (layout-only) */
/** Convert Mermaid direction to ELK direction. Exported so the class/ER
 *  layouts wire their `direction` statements through the SAME mapping the
 *  flowchart engine uses (no parallel copy to drift). */
export function directionToElk(dir: MermaidGraph['direction']): string {
  switch (dir) {
    case 'LR': return 'RIGHT'
    case 'RL': return 'LEFT'
    case 'BT': return 'UP'
    case 'TD':
    case 'TB':
    default: return 'DOWN'
  }
}

/**
 * ELK's model-order options are useful for keeping feedback-loop diagrams
 * readable, but raw Mermaid node insertion order is target-biased: `A --> C`
 * creates `C` before a later `B --> C`, which can make the `B --> C` edge run
 * backwards. Build a source-aware, cycle-tolerant model order from edges:
 * add each source-before-target constraint unless it would create a cycle, then
 * topologically sort with original order as the tie-breaker.
 */
function sourceAwareNodeOrder(nodeIds: string[], edges: Array<Pick<MermaidEdge, 'source' | 'target'>>): string[] {
  const ids = new Set(nodeIds)
  const original = new Map(nodeIds.map((id, i) => [id, i]))
  const outgoing = new Map(nodeIds.map(id => [id, new Set<string>()]))
  const indegree = new Map(nodeIds.map(id => [id, 0]))

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

  for (const edge of edges) {
    if (edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target)) continue
    const from = edge.source
    const to = edge.target
    const set = outgoing.get(from)!
    if (set.has(to)) continue
    if (reaches(to, from)) continue // feedback edge; preserve it as a back edge
    set.add(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  const orderByOriginal = (a: string, b: string): number => (original.get(a) ?? 0) - (original.get(b) ?? 0)
  const ready = nodeIds.filter(id => (indegree.get(id) ?? 0) === 0).sort(orderByOriginal)
  const out: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    out.push(id)
    for (const next of Array.from(outgoing.get(id) ?? []).sort(orderByOriginal)) {
      const nextDegree = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextDegree)
      if (nextDegree === 0) {
        ready.push(next)
        ready.sort(orderByOriginal)
      }
    }
  }

  if (out.length < nodeIds.length) {
    const emitted = new Set(out)
    out.push(...nodeIds.filter(id => !emitted.has(id)).sort(orderByOriginal))
  }
  return out
}

// ============================================================================
// Node sizing (same logic as Dagre adapter)
// ============================================================================

function estimateNodeSize(id: string, label: string, shape: string, style: ResolvedRenderStyle, direction: Direction = 'TB', stateVisual?: ResolvedStateVisualConfig): { width: number; height: number } {
  void id
  const metrics = measureMultilineText(applyTextTransform(label, style.nodeTextTransform), style.nodeLabelFontSize, style.nodeLabelFontWeight)

  // State pseudostates (plan §State 2): fork/join bars run PERPENDICULAR to
  // the flow (wide+thin in vertical flows, tall+thin in horizontal flows);
  // choice is a small unlabeled diamond; history is a small (H) circle.
  if (shape === 'state-fork' || shape === 'state-join') {
    const horizontalFlow = direction === 'LR' || direction === 'RL'
    const length = stateVisual?.forkWidth ?? 70
    const thickness = stateVisual?.forkHeight ?? 10
    return horizontalFlow ? { width: thickness, height: length } : { width: length, height: thickness }
  }
  if (shape === 'state-choice') {
    return { width: 36, height: 36 }
  }
  if (shape === 'state-history') {
    return { width: 32, height: 32 }
  }

  let width = metrics.width + style.nodePaddingX * 2
  let height = metrics.height + style.nodePaddingY * 2

  if (shape === 'service') {
    width = Math.max(width + 34, 120)
    height = Math.max(height + 6, 48)
  }

  if (shape === 'diamond') {
    const side = Math.max(width, height) + style.diamondExtraPadding
    width = side
    height = side
  }

  if (shape === 'circle' || shape === 'doublecircle') {
    const diameter = Math.ceil(Math.sqrt(width * width + height * height)) + 8
    width = shape === 'doublecircle' ? diameter + 12 : diameter
    height = width
  }

  if (shape === 'hexagon') {
    width += style.nodePaddingX
  }

  if (shape === 'trapezoid' || shape === 'trapezoid-alt' || shape === 'lean-r' || shape === 'lean-l') {
    width += style.nodePaddingX
  }

  if (shape === 'asymmetric') {
    width += 12
  }

  if (shape === 'cylinder') {
    height += 14
  }

  if (shape === 'state-start' || shape === 'state-end') {
    return { width: 28, height: 28 }
  }

  width = Math.max(width, 60)
  height = Math.max(height, 36)

  return { width, height }
}

// ============================================================================
// Graph conversion: MermaidGraph → ELK JSON
// ============================================================================

interface ElkGraphNode extends ElkNode {
  children?: ElkGraphNode[]
  edges?: ElkExtendedEdge[]
}

/**
 * Tracks port-to-edge mappings for hierarchical port edges.
 * Used to combine external and internal edge sections during extraction.
 */
interface HierarchicalEdgeInfo {
  originalIndex: number
  externalEdgeId: string
  internalEdgeId: string
  subgraphId: string
  direction: 'incoming' | 'outgoing'
}

interface CrossHierarchyEdgeInfo {
  index: number
  edge: MermaidEdge
  sourceSubgraph: string | undefined
  targetSubgraph: string | undefined
  /** Lowest common compound that should host the external segment; undefined means root. */
  hostSubgraph?: string
}

interface RoutePortHint {
  nodeId: string
  portId: string
  side: 'N' | 'E' | 'S' | 'W'
  edgeIndex: number
  sourceId: string
  targetId: string
  endpoint: 'source' | 'target'
  slotIndex: number
  routeClass: RouteClass
  labeled: boolean
  constraint: 'FIXED_SIDE' | 'FIXED_ORDER'
  orderReason?: 'primary-duplicate-face'
}

interface RoutePortRelaxation {
  edgeIndex: number
  routeClass: RouteClass
  reason: 'self-loop' | 'missing-node' | 'subgraph-endpoint' | 'direction-override-node' | 'unsupported-route-class' | 'unsupported-shape' | 'unsafe-non-primary-incident' | 'labeled-reciprocal-primary'
}

interface RoutePortHints {
  byEndpoint: Map<string, RoutePortHint>
  byNode: Map<string, RoutePortHint[]>
  relaxations: RoutePortRelaxation[]
}

/** Dimensions of the layout-only ELK label injected to balance a fan-in rank. */
interface BalancingLabel {
  width: number
  height: number
}

/**
 * Co-rank mixed-label fan-ins (default ON; disable with APL_NO_CORANK_FANIN).
 *
 * A fan-in hub fed by both a LABELED edge and an UNLABELED edge is asymmetric:
 * ELK reserves an inline-label dummy rank for the labeled edge only, so that
 * edge's source lands one rank EARLIER than the unlabeled sibling's source
 * (e.g. `A -->|x| B` with `B2 --> B` puts A one layer before B2). The
 * peer-barycenter centering can't square up a fan-in whose sources sit on
 * different ranks.
 *
 * The fix balances the rank span: every unlabeled incident edge of a mixed
 * hub gets a layout-only ELK label (one non-empty space, sized to the WIDEST
 * labeled sibling so the reserved cell matches) — ELK then allocates the same
 * dummy rank for it and all the hub's sources co-rank. The label is never
 * rendered: edge readback keys off the Mermaid edge's own `label`, which stays
 * undefined for these edges (see extractEdgesRecursively), so this only moves
 * ranks, never pixels of text. With the sources co-ranked, centerPeerBarycenters
 * squares up the hub and the spokes converge as symmetric doglegs; that bend is
 * justified (the convergence is structurally necessary) so the spokes are marked
 * bundle-owned downstream — see markCorankFanInBundles, findRouteHitches's
 * 'bundle' skip, and the layout-rubric justified-bend exemption.
 *
 * Returns a map from edge index -> the balancing label's dimensions, empty when
 * disabled (APL_NO_CORANK_FANIN) or no mixed fan-in exists. Deterministic:
 * dimensions derive only from the sibling labels' measured text.
 */
function corankFanInBalancingLabels(
  graph: MermaidGraph,
  style: ResolvedRenderStyle,
): Map<number, BalancingLabel> {
  const balancing = new Map<number, BalancingLabel>()
  if (layoutEnvFlag('APL_NO_CORANK_FANIN')) return balancing

  // Group edge indices by target node (the potential fan-in hub). Self-loops
  // never co-rank a hub and are skipped.
  const incomingByTarget = new Map<string, number[]>()
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    if (edge.source === edge.target) continue
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, [])
    incomingByTarget.get(edge.target)!.push(i)
  }

  for (const [hubId, indices] of incomingByTarget) {
    if (indices.length < 2) continue
    const labeled = indices.filter(i => !!graph.edges[i]!.label)
    const unlabeled = indices.filter(i => !graph.edges[i]!.label)
    // Only a MIXED hub (some labeled, some not) is desynced; a uniformly
    // labeled or uniformly unlabeled fan-in already co-ranks.
    if (labeled.length === 0 || unlabeled.length === 0) continue
    // The HUB may be any PORT_EXACT shape (a DECISION diamond, round, stadium, …):
    // co-ranking its mixed-label sources pre-ELK is what lets centerPeerBarycenters
    // centre such a hub and markCorankFanInBundles converge + centre the labels. The
    // UNLABELED-only alignPortLanes fan-in centering never fires on a MIXED-label
    // fan-in, so this does not fight it.
    // The SOURCES stay rectangle-only, though: a diamond (or other sharp/curved)
    // SOURCE emitting a single labelled line has its own exact-vertex exit contract
    // (issue #26 WS3 / alignPortLanes) that a co-rank bundle re-route would override.
    // Squaring up the hub never requires re-emitting the sources, so leave them.
    const hubShape = graph.nodes.get(hubId)?.shape
    if (hubShape === undefined || !PORT_EXACT.has(hubShape)) continue
    const isRect = (id: string): boolean => graph.nodes.get(id)?.shape === 'rectangle'
    if (!indices.every(i => isRect(graph.edges[i]!.source))) continue

    // Size the balancing cell to the WIDEST labeled sibling so every unlabeled
    // edge reserves at least as much rank space as the labeled ones — matching
    // the existing inline-label dimensions (measured width + 8, height + 6).
    let width = 0
    let height = 0
    for (const i of labeled) {
      const label = applyTextTransform(graph.edges[i]!.label!, style.edgeTextTransform)
      const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      width = Math.max(width, metrics.width + 8)
      height = Math.max(height, metrics.height + 6)
    }
    for (const i of unlabeled) balancing.set(i, { width, height })
  }

  return balancing
}

/** Build the layout-only inline label ELK uses to reserve a balancing rank. */
function balancingElkLabel(dims: BalancingLabel): NonNullable<ElkExtendedEdge['labels']>[number] {
  // A single space is non-empty text, so ELK allocates a label dummy (an empty
  // string is treated as no label and reserves nothing). Inline + CENTER mirror
  // the real edge-label placement so the reserved rank lines up.
  return {
    text: ' ',
    width: dims.width,
    height: dims.height,
    layoutOptions: {
      'elk.edgeLabels.inline': 'true',
      'elk.edgeLabels.placement': 'CENTER',
    },
  }
}

/**
 * Convert a MermaidGraph to ELK's nested JSON input format.
 *
 * Uses SEPARATE hierarchy handling for proper subgraph direction override support.
 * Cross-hierarchy edges use hierarchical ports to connect external and internal sections.
 */
function mermaidToElk(
  graph: MermaidGraph,
  opts: ElkConversionOptions,
  style: ResolvedRenderStyle,
): ElkGraphNode {
  // Collect all node IDs that belong to subgraphs
  const subgraphNodeIds = new Set<string>()
  const subgraphIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    subgraphIds.add(sg.id)
    collectSubgraphNodeIds(sg, subgraphNodeIds, subgraphIds)
  }

  // ELK does not reserve the label footprint of many parallel self-loops.
  // Give dense loop hubs enough rank clearance for the post-layout allocator's
  // outer arcs and pills; ordinary diagrams (<=4 loops per node) remain byte-
  // identical. This prevents north/south loop labels from covering adjacent
  // primary-chain nodes and their arrowheads.
  const selfLoopsByNode = new Map<string, number>()
  for (const edge of graph.edges) {
    if (edge.source !== edge.target) continue
    selfLoopsByNode.set(edge.source, (selfLoopsByNode.get(edge.source) ?? 0) + 1)
  }
  const maxSelfLoops = Math.max(0, ...selfLoopsByNode.values())
  if (maxSelfLoops > 4) {
    opts = { ...opts, layerSpacing: Math.max(opts.layerSpacing, opts.layerSpacing + (maxSelfLoops - 4) * 16) }
  }

  // Layout-only balancing labels that co-rank mixed-label fan-ins (default ON;
  // empty when APL_NO_CORANK_FANIN is set). Applied at every label-injection
  // site below so the rank balance holds wherever the edge is hosted (root,
  // subgraph-internal, cross-hierarchy).
  const balancingLabels = corankFanInBalancingLabels(graph, style)

  // Build node-to-subgraph mapping for edge distribution
  const nodeToSubgraph = buildNodeToSubgraphMap(graph.subgraphs)
  const nodeToRootSubgraph = buildNodeToRootSubgraphMap(graph.subgraphs)
  const nodeToSubgraphAncestors = buildNodeSubgraphAncestorsMap(graph.subgraphs)
  const subgraphToParent = buildSubgraphParentMap(graph.subgraphs)
  const subgraphAncestors = buildSubgraphAncestorsMap(graph.subgraphs)
  const endpointSubgraph = (id: string) => nodeToSubgraph.get(id) ?? subgraphToParent.get(id)
  // For a subgraph-id endpoint, use the containing ancestry (excluding the
  // subgraph itself): an edge to `Pipeline` targets the container box, not a
  // node inside Pipeline.
  const endpointAncestors = (id: string) =>
    nodeToSubgraphAncestors.get(id) ?? subgraphAncestors.get(id)?.slice(0, -1) ?? []

  // Determine if we need SEPARATE hierarchy handling
  // We use SEPARATE when any subgraph has a direction override
  const hasDirectionOverride = graph.subgraphs.some(sg => sg.direction !== undefined)

  // Classify edges into three categories:
  // 1. Internal edges (both endpoints in same subgraph)
  // 2. Root-level edges (neither endpoint in a subgraph)
  // 3. Cross-hierarchy edges (endpoints in different levels)
  const edgesBySubgraph = new Map<string | null, Array<{ index: number; edge: typeof graph.edges[0] }>>()
  edgesBySubgraph.set(null, []) // Root-level edges

  // Track cross-hierarchy edges for hierarchical port creation
  const crossHierarchyEdges: CrossHierarchyEdgeInfo[] = []

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    const sourceSubgraph = endpointSubgraph(edge.source)
    const targetSubgraph = endpointSubgraph(edge.target)

    if (sourceSubgraph && sourceSubgraph === targetSubgraph) {
      // Internal edge: both endpoints in same subgraph
      if (!edgesBySubgraph.has(sourceSubgraph)) {
        edgesBySubgraph.set(sourceSubgraph, [])
      }
      edgesBySubgraph.get(sourceSubgraph)!.push({ index: i, edge })
    } else if (!sourceSubgraph && !targetSubgraph) {
      // Root-level edge: neither endpoint in a subgraph
      edgesBySubgraph.get(null)!.push({ index: i, edge })
    } else if (!hasDirectionOverride) {
      // INCLUDE_CHILDREN can route direct descendant edges without ports, but
      // ELK reports an edge's section in the coordinate space of its lowest
      // common compound. Store such edges on that compound so recursive
      // extraction adds the correct absolute offset (outer A -> inner B).
      const lca = deepestCommonAncestor(
        endpointAncestors(edge.source),
        endpointAncestors(edge.target),
      )
      if (lca) {
        if (!edgesBySubgraph.has(lca)) edgesBySubgraph.set(lca, [])
        edgesBySubgraph.get(lca)!.push({ index: i, edge })
      } else {
        edgesBySubgraph.get(null)!.push({ index: i, edge })
      }
    } else {
      // Cross-hierarchy edge: need hierarchical ports. When both endpoints
      // live under one compound, host the external port-to-port segment on
      // that lowest common compound so extraction receives the right offset.
      const hostSubgraph = deepestCommonAncestor(
        endpointAncestors(edge.source),
        endpointAncestors(edge.target),
      )
      crossHierarchyEdges.push({ index: i, edge, sourceSubgraph, targetSubgraph, hostSubgraph })
    }
  }

  // Build the root ELK graph
  const elkGraph: ElkGraphNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionToElk(graph.direction),
      'elk.spacing.nodeNode': String(opts.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
      'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '12',
      'elk.padding': `[top=${opts.padding},left=${opts.padding},bottom=${opts.padding},right=${opts.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.contentAlignment': 'H_CENTER V_CENTER',
      'elk.layered.thoroughness': String(DEFAULTS.thoroughness),
      'elk.layered.highDegreeNodes.treatment': 'true',
      'elk.layered.highDegreeNodes.threshold': '8',
      'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING',
      // Mermaid source order is author intent for small flowcharts with feedback
      // loops. ELK's default greedy cycle breaker can rank a decision before the
      // login step in A->B->C plus C->B graphs; model-order cycle breaking keeps
      // the primary LR path readable and sends the feedback edge backwards.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      // Feedback edges route AROUND the nodes through outer channels (issue #25
      // §10), instead of competing with the forward edge for the same facing
      // side — which squeezed both lanes and the label into a corridor capped
      // by the node height. With this on, the forward lane of a reciprocal
      // pair is straight directly out of ELK, and the inline label dummy gets
      // reserved space ON the loop (dot's virtual-node doctrine; Gansner et
      // al. TSE 1993). The route-contract pass still collapses an unlabeled
      // loop onto a parallel back-lane when one proves clear.
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.layered.wrapping.strategy': 'OFF',
      // Use SEPARATE when subgraphs have direction overrides (enables proper direction handling)
      // Use INCLUDE_CHILDREN otherwise (simpler cross-hierarchy edge routing)
      'elk.hierarchyHandling': hasDirectionOverride ? 'SEPARATE' : 'INCLUDE_CHILDREN',
    },
    children: [],
    edges: [],
  }

  // Track hierarchical ports per subgraph for cross-hierarchy edges
  const subgraphPorts = new Map<string, Array<{
    portId: string
    edgeIndex: number
    direction: 'incoming' | 'outgoing'
    internalNodeId: string
  }>>()
  const crossEdgesByHost = new Map<string | null, CrossHierarchyEdgeInfo[]>()
  crossEdgesByHost.set(null, [])

  // Process cross-hierarchy edges to create port entries and host maps.
  if (hasDirectionOverride) {
    for (const info of crossHierarchyEdges) {
      const { index, edge, sourceSubgraph, targetSubgraph, hostSubgraph } = info
      const hostKey = hostSubgraph ?? null
      if (!crossEdgesByHost.has(hostKey)) crossEdgesByHost.set(hostKey, [])
      crossEdgesByHost.get(hostKey)!.push(info)

      // Handle outgoing edges from nested source subgraphs. If the source's
      // own subgraph hosts the external segment, the node can be referenced
      // directly and no boundary port is needed.
      if (sourceSubgraph && sourceSubgraph !== hostSubgraph) {
        const portId = `${sourceSubgraph}_out_${index}`
        if (!subgraphPorts.has(sourceSubgraph)) {
          subgraphPorts.set(sourceSubgraph, [])
        }
        subgraphPorts.get(sourceSubgraph)!.push({
          portId,
          edgeIndex: index,
          direction: 'outgoing',
          internalNodeId: edge.source,
        })
      }

      // Handle incoming edges to nested target subgraphs. If the target's own
      // subgraph hosts the external segment, target the node directly.
      if (targetSubgraph && targetSubgraph !== hostSubgraph) {
        const portId = `${targetSubgraph}_in_${index}`
        if (!subgraphPorts.has(targetSubgraph)) {
          subgraphPorts.set(targetSubgraph, [])
        }
        subgraphPorts.get(targetSubgraph)!.push({
          portId,
          edgeIndex: index,
          direction: 'incoming',
          internalNodeId: edge.target,
        })
      }
    }
  }

  // Pre-layout route intent: expose the same semantic source/target sides used
  // by the certifying route-port allocator to ELK as fixed-side node ports.
  // This is deliberately a hint layer (ELK still chooses coordinates/order);
  // final certificates are still derived after clipping and route repair.
  const routePortHints = buildRoutePortHints(graph, subgraphIds)

  // Projected families such as architecture may rely on parser child order
  // inside compounds for stable boundary routing; root-level group-vs-node
  // siblings still use source-before-target constraints.
  const useSourceAwareChildOrder = !opts.preserveSubgraphChildOrder

  const topLevelSubgraphs = new Map(graph.subgraphs.map(sg => [sg.id, sg]))
  const rootOrder = rootChildOrder(graph, subgraphNodeIds, subgraphIds, nodeToRootSubgraph, Boolean(opts.preserveSubgraphChildOrder))
  for (const id of rootOrder) {
    const sg = topLevelSubgraphs.get(id)
    if (sg) {
      elkGraph.children!.push(subgraphToElk(sg, graph, opts, style, edgesBySubgraph, subgraphPorts, crossEdgesByHost, routePortHints, useSourceAwareChildOrder, balancingLabels, graph.direction))
      continue
    }
    const node = graph.nodes.get(id)
    if (node && !subgraphNodeIds.has(id) && !subgraphIds.has(id)) {
      elkGraph.children!.push(nodeToElkLeaf(id, node, style, routePortHints, graph.direction, opts.stateVisual))
    }
  }

  // Add root-level edges
  for (const { index, edge } of edgesBySubgraph.get(null)!) {
    const elkEdge: ElkExtendedEdge = {
      id: `e${index}`,
      sources: [routePortHints.byEndpoint.get(endpointKey(index, 'source'))?.portId ?? edge.source],
      targets: [routePortHints.byEndpoint.get(endpointKey(index, 'target'))?.portId ?? edge.target],
    }
    if (edge.label && !layoutEnvFlag('APL_DECOUPLE_LABELS')) {
      const label = applyTextTransform(edge.label, style.edgeTextTransform)
      const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      elkEdge.labels = [{
        text: label,
        width: metrics.width + 8,
        height: metrics.height + 6,
        layoutOptions: {
          'elk.edgeLabels.inline': 'true',
          'elk.edgeLabels.placement': 'CENTER',
        },
      }]
    } else if (!edge.label && balancingLabels.has(index)) {
      elkEdge.labels = [balancingElkLabel(balancingLabels.get(index)!)]
    }
    elkGraph.edges!.push(elkEdge)
  }

  // Add root-hosted cross-hierarchy edges (using ports when SEPARATE, direct when INCLUDE_CHILDREN)
  for (const info of crossEdgesByHost.get(null) ?? []) {
    elkGraph.edges!.push(crossHierarchyElkEdge(info, style, balancingLabels))
  }

  return elkGraph
}

function endpointKey(edgeIndex: number, endpoint: 'source' | 'target'): string {
  return `${edgeIndex}:${endpoint}`
}

function directedSubgraphNodeIds(subgraphs: MermaidSubgraph[]): Set<string> {
  const out = new Set<string>()
  const visit = (sg: MermaidSubgraph, inheritedDirected: boolean) => {
    const directed = inheritedDirected || sg.direction !== undefined
    if (directed) for (const id of sg.nodeIds) out.add(id)
    for (const child of sg.children) visit(child, directed)
  }
  for (const sg of subgraphs) visit(sg, false)
  return out
}

function axisSides(direction: Direction): { source: 'N' | 'E' | 'S' | 'W'; target: 'N' | 'E' | 'S' | 'W' } {
  switch (direction) {
    case 'RL': return { source: 'W', target: 'E' }
    case 'BT': return { source: 'N', target: 'S' }
    case 'TD':
    case 'TB': return { source: 'S', target: 'N' }
    case 'LR':
    default: return { source: 'E', target: 'W' }
  }
}

function routeHintSides(direction: Direction, routeClass: ReturnType<typeof classifyRoutes>[number]): { source: 'N' | 'E' | 'S' | 'W'; target: 'N' | 'E' | 'S' | 'W' } {
  const sides = axisSides(direction)
  if (routeClass === 'feedback') return { source: sides.target, target: sides.source }
  return sides
}

function supportsPreLayoutFeedbackPorts(node: MermaidNode | undefined): boolean {
  return node?.shape === 'rectangle' || node?.shape === 'diamond'
}

function supportsPreLayoutFixedOrderPorts(node: MermaidNode | undefined): boolean {
  return node?.shape === 'rectangle'
}

function certifiesPrimaryDuplicateFaceOrder(entries: RoutePortHint[]): boolean {
  if (entries.length < 2) return false
  if (!entries.every(entry => entry.routeClass === 'primary-forward' && !entry.labeled)) return false
  const side = entries[0]!.side
  if (!entries.every(entry => entry.side === side)) return false

  const pairCounts = new Map<string, number>()
  for (const entry of entries) {
    const pairKey = `${entry.sourceId}\0${entry.targetId}`
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1)
  }
  const hasDuplicatePair = [...pairCounts.values()].some(count => count >= 2)
  if (!hasDuplicatePair) return false

  // Target-side fan-in with a duplicate pair is exactly the face owned by
  // applyParallelDuplicateLanes. Source-side ordering is safe only when every
  // source-side port belongs to a duplicated directed pair; otherwise an
  // unrelated fan-out would be ordered before the lane planner owns it.
  if (entries.every(entry => entry.endpoint === 'target')) return true
  if (entries.every(entry => entry.endpoint === 'source')) {
    return entries.every(entry => (pairCounts.get(`${entry.sourceId}\0${entry.targetId}`) ?? 0) >= 2)
  }
  return false
}

export function buildRoutePortHints(graph: MermaidGraph, subgraphIds: Set<string>): RoutePortHints {
  const classes = classifyRoutes(graph)
  // Fixed-side ports are useful pre-layout hints when the route class has a
  // stable semantic side. Primary-forward edges use the flow sides; feedback
  // uses the flipped sides. Container, cross-hierarchy and self-loop routes are
  // still relaxed to the final certifying repair pass because their attachment
  // side depends on compound/family geometry rather than node-local flow.
  const nonPrimaryIncident = new Set<string>()
  const unsafeIncident = new Set<string>()
  const directionOverrideNodes = directedSubgraphNodeIds(graph.subgraphs)
  const labeledPrimaryPairs = new Set<string>()
  for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) {
    const edge = graph.edges[edgeIndex]!
    const routeClass = classes[edgeIndex] ?? 'primary-forward'
    if (routeClass === 'primary-forward' && edge.label) labeledPrimaryPairs.add(`${edge.source}\u0000${edge.target}`)
    if (routeClass !== 'primary-forward') {
      nonPrimaryIncident.add(edge.source)
      nonPrimaryIncident.add(edge.target)
    }
    if (routeClass !== 'primary-forward' && routeClass !== 'feedback') {
      unsafeIncident.add(edge.source)
      unsafeIncident.add(edge.target)
    }
  }
  const drafts: RoutePortHint[] = []
  const relaxations: RoutePortRelaxation[] = []
  const safeId = (id: string) => id.replace(/[^A-Za-z0-9_\-]/g, '_')
  const relax = (edgeIndex: number, routeClass: RouteClass, reason: RoutePortRelaxation['reason']): void => {
    relaxations.push({ edgeIndex, routeClass, reason })
  }
  for (let edgeIndex = 0; edgeIndex < graph.edges.length; edgeIndex++) {
    const edge = graph.edges[edgeIndex]!
    const routeClass = classes[edgeIndex] ?? 'primary-forward'
    if (edge.source === edge.target) { relax(edgeIndex, routeClass, 'self-loop'); continue }
    if (subgraphIds.has(edge.source) || subgraphIds.has(edge.target)) { relax(edgeIndex, routeClass, 'subgraph-endpoint'); continue }
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) { relax(edgeIndex, routeClass, 'missing-node'); continue }
    if (routeClass !== 'primary-forward' && routeClass !== 'feedback') { relax(edgeIndex, routeClass, 'unsupported-route-class'); continue }
    if (routeClass === 'primary-forward' && (nonPrimaryIncident.has(edge.source) || nonPrimaryIncident.has(edge.target))) {
      relax(edgeIndex, routeClass, 'unsafe-non-primary-incident')
      continue
    }
    if (routeClass === 'feedback' && edge.label) { relax(edgeIndex, routeClass, 'unsupported-route-class'); continue }
    if (routeClass === 'feedback' && labeledPrimaryPairs.has(`${edge.target}\u0000${edge.source}`)) {
      relax(edgeIndex, routeClass, 'labeled-reciprocal-primary')
      continue
    }
    if (routeClass === 'feedback' &&
      (!supportsPreLayoutFeedbackPorts(graph.nodes.get(edge.source)) || !supportsPreLayoutFeedbackPorts(graph.nodes.get(edge.target)))) {
      relax(edgeIndex, routeClass, 'unsupported-shape')
      continue
    }
    if (unsafeIncident.has(edge.source) || unsafeIncident.has(edge.target)) { relax(edgeIndex, routeClass, 'unsafe-non-primary-incident'); continue }
    if (directionOverrideNodes.has(edge.source) || directionOverrideNodes.has(edge.target)) { relax(edgeIndex, routeClass, 'direction-override-node'); continue }
    const sides = routeHintSides(graph.direction, routeClass)
    drafts.push({
      nodeId: edge.source,
      portId: `rp_${safeId(edge.source)}_${edgeIndex}_s`,
      side: sides.source,
      edgeIndex,
      sourceId: edge.source,
      targetId: edge.target,
      endpoint: 'source',
      slotIndex: 0,
      routeClass,
      labeled: Boolean(edge.label),
      constraint: 'FIXED_SIDE',
    })
    drafts.push({
      nodeId: edge.target,
      portId: `rp_${safeId(edge.target)}_${edgeIndex}_t`,
      side: sides.target,
      edgeIndex,
      sourceId: edge.source,
      targetId: edge.target,
      endpoint: 'target',
      slotIndex: 0,
      routeClass,
      labeled: Boolean(edge.label),
      constraint: 'FIXED_SIDE',
    })
  }

  const byNode = new Map<string, RoutePortHint[]>()
  for (const draft of drafts) {
    const entries = byNode.get(draft.nodeId) ?? []
    entries.push(draft)
    byNode.set(draft.nodeId, entries)
  }
  for (const entries of byNode.values()) {
    entries.sort((a, b) => sideSort(a.side) - sideSort(b.side) || a.edgeIndex - b.edgeIndex || endpointSort(a.endpoint) - endpointSort(b.endpoint))
    const perSide = new Map<string, number>()
    for (const entry of entries) {
      const next = perSide.get(entry.side) ?? 0
      entry.slotIndex = next
      perSide.set(entry.side, next + 1)
    }
    const ordered = supportsPreLayoutFixedOrderPorts(graph.nodes.get(entries[0]!.nodeId)) &&
      certifiesPrimaryDuplicateFaceOrder(entries)
    for (const entry of entries) {
      if (ordered) {
        entry.constraint = 'FIXED_ORDER'
        entry.orderReason = 'primary-duplicate-face'
      } else {
        entry.constraint = 'FIXED_SIDE'
        entry.orderReason = undefined
      }
    }
  }

  const byEndpoint = new Map<string, RoutePortHint>()
  for (const draft of drafts) byEndpoint.set(endpointKey(draft.edgeIndex, draft.endpoint), draft)
  return { byEndpoint, byNode, relaxations }
}

function sideSort(side: 'N' | 'E' | 'S' | 'W'): number {
  return { N: 0, E: 1, S: 2, W: 3 }[side]
}

function endpointSort(endpoint: 'source' | 'target'): number {
  return endpoint === 'source' ? 0 : 1
}

function elkPortSide(side: 'N' | 'E' | 'S' | 'W'): 'NORTH' | 'EAST' | 'SOUTH' | 'WEST' {
  switch (side) {
    case 'N': return 'NORTH'
    case 'E': return 'EAST'
    case 'S': return 'SOUTH'
    case 'W': return 'WEST'
  }
}

function nodeToElkLeaf(id: string, node: MermaidNode, style: ResolvedRenderStyle, hints: RoutePortHints, direction: Direction = 'TB', stateVisual?: ResolvedStateVisualConfig): ElkGraphNode {
  const size = estimateNodeSize(id, node.label, node.shape, style, direction, stateVisual)
  const elkNode: ElkGraphNode = {
    id,
    width: size.width,
    height: size.height,
    labels: [{ text: node.label }],
  }
  const ports = hints.byNode.get(id)
  if (ports && ports.length > 0) {
    const constraint = ports.some(p => p.constraint === 'FIXED_ORDER') ? 'FIXED_ORDER' : 'FIXED_SIDE'
    elkNode.layoutOptions = { ...(elkNode.layoutOptions ?? {}), 'elk.portConstraints': constraint }
    ;(elkNode as unknown as Record<string, unknown>).ports = ports.map(p => ({
      id: p.portId,
      width: 0,
      height: 0,
      layoutOptions: {
        'elk.port.side': elkPortSide(p.side),
        'elk.port.index': String(p.slotIndex),
      },
    }))
  }
  return elkNode
}

function crossHierarchyElkEdge(
  info: CrossHierarchyEdgeInfo,
  style: ResolvedRenderStyle,
  balancingLabels?: Map<number, BalancingLabel>,
): ElkExtendedEdge {
  const { index, edge, sourceSubgraph, targetSubgraph, hostSubgraph } = info
  const elkEdge: ElkExtendedEdge = {
    id: `e${index}`,
    sources: sourceSubgraph && sourceSubgraph !== hostSubgraph ? [`${sourceSubgraph}_out_${index}`] : [edge.source],
    targets: targetSubgraph && targetSubgraph !== hostSubgraph ? [`${targetSubgraph}_in_${index}`] : [edge.target],
  }
  if (edge.label && !layoutEnvFlag('APL_DECOUPLE_LABELS')) {
    const label = applyTextTransform(edge.label, style.edgeTextTransform)
    const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
    elkEdge.labels = [{
      text: label,
      width: metrics.width + 8,
      height: metrics.height + 6,
      layoutOptions: {
        'elk.edgeLabels.inline': 'true',
        'elk.edgeLabels.placement': 'CENTER',
      },
    }]
  } else if (!edge.label && balancingLabels?.has(index)) {
    elkEdge.labels = [balancingElkLabel(balancingLabels.get(index)!)]
  }
  return elkEdge
}

/**
 * Convert a MermaidSubgraph to an ELK compound node.
 * Includes internal edges (edges where both endpoints are in this subgraph)
 * so that the subgraph's direction override is respected by ELK.
 *
 * When using SEPARATE hierarchy handling (for direction override support),
 * also adds hierarchical ports for cross-hierarchy edges.
 */
function subgraphToElk(
  sg: MermaidSubgraph,
  graph: MermaidGraph,
  opts: ElkConversionOptions,
  style: ResolvedRenderStyle,
  edgesBySubgraph: Map<string | null, Array<{ index: number; edge: MermaidEdge }>>,
  subgraphPorts: Map<string, Array<{
    portId: string
    edgeIndex: number
    direction: 'incoming' | 'outgoing'
    internalNodeId: string
  }>>,
  crossEdgesByHost: Map<string | null, CrossHierarchyEdgeInfo[]>,
  routePortHints: RoutePortHints,
  useSourceAwareOrder: boolean,
  balancingLabels: Map<number, BalancingLabel>,
  inheritedDirection: Direction = 'TB',
): ElkGraphNode {
  // Concurrency regions draw no header band of their own, so they reserve
  // only the plain padding at the top (plan §State 2c).
  const groupHeaderHeight = sg.concurrencyRegion ? 0 : style.groupHeaderFontSize + 16
  const dividerMargin = sg.concurrencyRegion ? (opts.stateVisual?.dividerMargin ?? 0) : 0
  // Effective direction of THIS scope — drives direction-dependent node
  // sizing (fork/join bars) for direct children.
  const effectiveDirection = sg.direction ?? inheritedDirection
  const layoutOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.padding': `[top=${groupHeaderHeight + style.groupPaddingY + dividerMargin},left=${style.groupPaddingX + dividerMargin},bottom=${style.groupPaddingY + dividerMargin},right=${style.groupPaddingX + dividerMargin}]`,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.contentAlignment': 'H_CENTER V_CENTER',
    'elk.spacing.edgeEdge': '12',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
    'elk.layered.spacing.edgeNodeBetweenLayers': '12',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
    'elk.spacing.nodeNode': String(opts.nodeSpacing),
  }

  // Apply direction override if specified
  if (sg.direction) {
    layoutOptions['elk.direction'] = directionToElk(sg.direction)
  }

  const elkNode: ElkGraphNode = {
    id: sg.id,
    layoutOptions,
    labels: sg.label ? [{ text: sg.label }] : undefined,
    children: [],
    edges: [],
  }

  // Add hierarchical ports for cross-hierarchy edges (when using SEPARATE)
  const ports = subgraphPorts.get(sg.id) ?? []
  if (ports.length > 0) {
    // ELK supports ports but types don't include it
    (elkNode as unknown as Record<string, unknown>).ports = ports.map(p => ({
      id: p.portId,
      // Port side is determined by ELK based on edge direction
    }))
  }

  // Add direct child nodes using the same source-aware ordering within the group
  // for flowchart-like graphs; architecture keeps parser order for stable
  // group-boundary routing.
  const childNodeOrder = useSourceAwareOrder ? sourceAwareNodeOrder(sg.nodeIds, graph.edges) : sg.nodeIds
  for (const nodeId of childNodeOrder) {
    const node = graph.nodes.get(nodeId)
    if (node) {
      elkNode.children!.push(nodeToElkLeaf(nodeId, node, style, routePortHints, effectiveDirection, opts.stateVisual))
    }
  }

  // Add nested subgraphs recursively
  for (const child of sg.children) {
    elkNode.children!.push(subgraphToElk(child, graph, opts, style, edgesBySubgraph, subgraphPorts, crossEdgesByHost, routePortHints, useSourceAwareOrder, balancingLabels, effectiveDirection))
  }

  // Add internal edges (edges where both endpoints are in this subgraph)
  const internalEdges = edgesBySubgraph.get(sg.id) ?? []
  for (const { index, edge } of internalEdges) {
    const elkEdge: ElkExtendedEdge = {
      id: `e${index}`,
      sources: [routePortHints.byEndpoint.get(endpointKey(index, 'source'))?.portId ?? edge.source],
      targets: [routePortHints.byEndpoint.get(endpointKey(index, 'target'))?.portId ?? edge.target],
    }
    if (edge.label && !layoutEnvFlag('APL_DECOUPLE_LABELS')) {
      const label = applyTextTransform(edge.label, style.edgeTextTransform)
      const metrics = measureMultilineText(label, style.edgeLabelFontSize, style.edgeLabelFontWeight)
      elkEdge.labels = [{
        text: label,
        width: metrics.width + 8,
        height: metrics.height + 6,
        layoutOptions: {
          'elk.edgeLabels.inline': 'true',
          'elk.edgeLabels.placement': 'CENTER',
        },
      }]
    } else if (!edge.label && balancingLabels.has(index)) {
      elkEdge.labels = [balancingElkLabel(balancingLabels.get(index)!)]
    }
    elkNode.edges!.push(elkEdge)
  }

  // Add cross-hierarchy external segments hosted by this compound. Ports are
  // only used for endpoints that live in a nested child compound; direct
  // children of this host are referenced by node id.
  for (const info of crossEdgesByHost.get(sg.id) ?? []) {
    elkNode.edges!.push(crossHierarchyElkEdge(info, style))
  }

  // Add internal edge segments for hierarchical ports (port → node or node → port)
  // These connect the boundary ports to actual internal nodes
  for (const port of ports) {
    const internalEdgeId = `e${port.edgeIndex}_internal`
    const elkEdge: ElkExtendedEdge = port.direction === 'incoming'
      ? { id: internalEdgeId, sources: [port.portId], targets: [port.internalNodeId] }
      : { id: internalEdgeId, sources: [port.internalNodeId], targets: [port.portId] }
    elkNode.edges!.push(elkEdge)
  }

  return elkNode
}

/** Recursively collect all node IDs that belong to any subgraph */
function collectSubgraphNodeIds(sg: MermaidSubgraph, nodeIds: Set<string>, subgraphIds: Set<string>): void {
  for (const id of sg.nodeIds) {
    nodeIds.add(id)
  }
  for (const child of sg.children) {
    subgraphIds.add(child.id)
    collectSubgraphNodeIds(child, nodeIds, subgraphIds)
  }
}

/**
 * Build a mapping from node ID to its containing subgraph ID.
 * For nested subgraphs, maps to the innermost containing subgraph.
 * Nodes not in any subgraph are not included in the map.
 */
function buildNodeToSubgraphMap(subgraphs: MermaidSubgraph[]): Map<string, string> {
  const map = new Map<string, string>()

  function traverse(sg: MermaidSubgraph): void {
    // Map all direct child nodes to this subgraph
    for (const nodeId of sg.nodeIds) {
      map.set(nodeId, sg.id)
    }
    // Recursively process nested subgraphs (they override parent mapping)
    for (const child of sg.children) {
      traverse(child)
    }
  }

  for (const sg of subgraphs) {
    traverse(sg)
  }

  return map
}

function buildNodeToRootSubgraphMap(subgraphs: MermaidSubgraph[]): Map<string, string> {
  const map = new Map<string, string>()
  function traverse(sg: MermaidSubgraph, rootId: string): void {
    for (const nodeId of sg.nodeIds) map.set(nodeId, rootId)
    for (const child of sg.children) traverse(child, rootId)
  }
  for (const sg of subgraphs) traverse(sg, sg.id)
  return map
}

function buildNodeSubgraphAncestorsMap(subgraphs: MermaidSubgraph[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  function traverse(sg: MermaidSubgraph, ancestors: string[]): void {
    const next = [...ancestors, sg.id]
    for (const nodeId of sg.nodeIds) map.set(nodeId, next)
    for (const child of sg.children) traverse(child, next)
  }
  for (const sg of subgraphs) traverse(sg, [])
  return map
}

function buildSubgraphParentMap(subgraphs: MermaidSubgraph[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>()
  function traverse(sg: MermaidSubgraph, parent: string | undefined): void {
    map.set(sg.id, parent)
    for (const child of sg.children) traverse(child, sg.id)
  }
  for (const sg of subgraphs) traverse(sg, undefined)
  return map
}

function buildSubgraphAncestorsMap(subgraphs: MermaidSubgraph[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  function traverse(sg: MermaidSubgraph, ancestors: string[]): void {
    const next = [...ancestors, sg.id]
    map.set(sg.id, next)
    for (const child of sg.children) traverse(child, next)
  }
  for (const sg of subgraphs) traverse(sg, [])
  return map
}

function deepestCommonAncestor(a: string[], b: string[]): string | undefined {
  let common: string | undefined
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) break
    common = a[i]
  }
  return common
}

function rootChildOrder(
  graph: MermaidGraph,
  subgraphNodeIds: Set<string>,
  subgraphIds: Set<string>,
  nodeToRootSubgraph: Map<string, string>,
  seedSubgraphsFirst: boolean,
): string[] {
  const rootIds: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    rootIds.push(id)
  }

  const addNodeDerivedRootIds = () => {
    for (const id of graph.nodes.keys()) {
      const root = nodeToRootSubgraph.get(id)
      if (root) add(root)
      else if (!subgraphNodeIds.has(id) && !subgraphIds.has(id)) add(id)
    }
  }
  const addDeclaredSubgraphIds = () => {
    for (const sg of graph.subgraphs) add(sg.id)
  }

  // Flowchart-like graphs should keep root nodes and top-level subgraphs in
  // source-derived order. Projected families such as architecture can request
  // top-level group declaration order because their parser has group entries
  // that are not represented in graph.nodes until a service/junction appears.
  if (seedSubgraphsFirst) {
    addDeclaredSubgraphIds()
    addNodeDerivedRootIds()
  } else {
    addNodeDerivedRootIds()
    addDeclaredSubgraphIds()
  }

  const rootEdges = graph.edges.map(edge => ({
    source: nodeToRootSubgraph.get(edge.source) ?? edge.source,
    target: nodeToRootSubgraph.get(edge.target) ?? edge.target,
  }))
  return sourceAwareNodeOrder(rootIds, rootEdges)
}

// ============================================================================
// Result conversion: ELK output → PositionedGraph
// ============================================================================

/**
 * Convert ELK layout result to our PositionedGraph format.
 */
/** The mutable bag the post-ELK geometry passes thread through (see ./layout/pass.ts). */
export interface LayoutPassContext extends PassContextBase {
  readonly elkResult: ElkNode
  readonly graph: MermaidGraph
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  groups: PositionedGroup[]
  /** State-diagram note boxes, populated by placeStateNotes (empty otherwise). */
  notes: PositionedStateNote[]
  readonly margins: MarginInfo | undefined
  bundled: Set<PositionedEdge>
  readonly mergeEdges: boolean
  readonly style: ResolvedRenderStyle
  readonly layoutPadding: number
  readonly stateNoteMargin: number
  frozen: boolean
}

// The post-ELK geometry pipeline, reified (docs/design/system/layout-pass-pipeline.md).
// The array IS the execution path; each `run` delegates to the existing pass function
// with byte-identical arguments. The three symmetric passes carry no `after` among each
// other — their order is empirically free (spec §8 R1, verified by a permutation experiment).
export const LAYOUT_PIPELINE: ReadonlyArray<LayoutPass<LayoutPassContext>> = [
  {
    id: 'extractEdgesRecursively', doc: 'flatten ELK edges to absolute coords (+orthogonalize cross-hierarchy)',
    after: [], mutates: ['extract'], determinism: 'pure-order',
    run: c => { extractEdgesRecursively(c.elkResult, c.graph, c.edges, 0, 0, c.margins) },
  },
  {
    id: 'alignLayerNodes', doc: 'snap same-layer nodes onto a shared flow-axis line',
    after: ['extractEdgesRecursively'], mutates: ['positions', 'edges'], determinism: 'in-place',
    mayChangeMetrics: { bends: 'improve-only', straight: 'improve-only' },
    run: c => { alignLayerNodes(c.nodes, c.edges, c.graph.direction) },
  },
  {
    id: 'equalizePeerNodeDimensions', doc: 'equalize peer box sizes + pack layers so symmetry is visible downstream',
    after: ['alignLayerNodes'], mutates: ['positions', 'dimensions'], determinism: 'in-place',
    mayChangeMetrics: { symErr: 'improve-only' },
    run: c => { equalizePeerNodeDimensions(c.nodes, c.edges, c.groups, c.graph) },
  },
  {
    id: 'alignForkRejoinPeerCenters', doc: 'center fork/rejoin hubs on their peer barycenter',
    after: ['equalizePeerNodeDimensions'], mutates: ['positions'], determinism: 'in-place',
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    run: c => { alignForkRejoinPeerCenters(c.nodes, c.edges, c.groups, c.graph, c.style) },
  },
  {
    id: 'alignPortLanes', doc: 'slide one endpoint node so a floating-straight edge becomes port-exact (Ruegg GD15)',
    after: ['alignForkRejoinPeerCenters'], mutates: ['positions', 'edges'], determinism: 'in-place',
    mayChangeMetrics: { straight: 'improve-only', portRate: 'improve-only', bends: 'improve-only' },
    run: c => { alignPortLanes(c.nodes, c.edges, c.groups, c.graph.direction, c.style) },
  },
  {
    id: 'centerPeerBarycenters', doc: 'center peer fan-in/fan-out trunks over peer barycenters (#57/#61)',
    after: ['alignPortLanes'], mutates: ['positions'], determinism: 'in-place',
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    run: c => { centerPeerBarycenters(c.nodes, c.edges, c.groups, c.graph, c.style) },
  },
  {
    id: 'honorLinkRankDistance', doc: 'shove target sub-DAG to honor variable-length link rank distance; push ahead anything the shove lands on and rebuild blocked reconnect routes through free channels (#81)',
    after: ['centerPeerBarycenters'], mutates: ['positions'], determinism: 'in-place',
    run: c => { honorLinkRankDistance(c.nodes, c.edges, c.groups, c.graph) },
  },
  {
    // Runs LAST among the node-movers (after centering/rank-shoving settle the
    // target's entry lane) but before the freeze, so it aligns the labelled
    // source onto the target's FINAL lane.
    id: 'alignLabeledSourcePort', doc: 'slide a single-outgoing labelled source onto the lane the straightener will use so the exit stays mid-port (alignPortLanes excludes labelled edges)',
    after: ['honorLinkRankDistance'], mutates: ['positions', 'edges'], determinism: 'in-place',
    mayChangeMetrics: { portRate: 'improve-only' },
    run: c => { alignLabeledSourcePort(c.nodes, c.edges, c.groups, c.graph, c.graph.direction, c.style) },
  },
  {
    id: 'bundleEdgePaths', doc: 'bundle fan-out/fan-in edges into shared trunks (when mergeEdges)',
    after: ['alignLabeledSourcePort'], mutates: ['edges'], determinism: 'pure-order',
    enabled: c => c.mergeEdges,
    run: c => { c.bundled = bundleEdgePaths(c.edges, c.nodes, c.groups, c.graph.direction) },
  },
  {
    // Re-route the co-ranked mixed-label fan-in spokes as symmetric converging
    // doglegs and mark them bundle-owned, so applyRouteContracts certifies them
    // 'bundle' — the justified-bend marker findRouteHitches and the layout-rubric
    // both key off. Independent of mergeEdges: the fan-in converges via centering
    // whether or not the plain bundler ran, so the marker must too.
    id: 'markCorankFanInBundles', doc: 're-route + mark co-ranked mixed-label fan-in spokes bundle-owned (justified symmetric-convergence bend)',
    after: ['bundleEdgePaths'], mutates: ['edges'], determinism: 'in-place',
    run: c => { markCorankFanInBundles(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
  },
  {
    id: 'clipEdgeToShape', doc: 'clip edge endpoints to real (non-rect) shape outlines',
    after: ['bundleEdgePaths'], mutates: ['edges'], determinism: 'in-place',
    mayChangeMetrics: { portRate: 'improve-only' },
    run: c => {
      const nodeMap = new Map(c.nodes.map(n => [n.id, n]))
      for (const edge of c.edges) {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        if (sourceNode) edge.points = clipEdgeToShape(edge.points, sourceNode, true)
        if (targetNode) edge.points = clipEdgeToShape(edge.points, targetNode, false)
      }
    },
  },
  {
    id: 'applySymmetricFanoutEmissions', doc: 're-route small equivalent fan-outs symmetrically; mark bundle-owned',
    after: ['clipEdgeToShape'], mutates: ['edges'], determinism: 'in-place',
    mayChangeMetrics: { symErr: 'improve-only', bends: { worsenBy: 2 } },
    run: c => { applySymmetricFanoutEmissions(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
  },
  {
    id: 'applySymmetricParallelEdgeLanes', doc: 'separate parallel edges into symmetric non-crossing lanes',
    after: ['clipEdgeToShape'], mutates: ['edges'], determinism: 'in-place',
    mayChangeMetrics: { symErr: 'improve-only', crossings: 'improve-only' },
    run: c => { applySymmetricParallelEdgeLanes(c.nodes, c.edges, c.groups, c.graph, c.bundled, c.style) },
  },
  {
    id: 'applyParallelDuplicateLanes', doc: 'split exact duplicate edges into separated lanes',
    after: ['clipEdgeToShape'], mutates: ['edges'], determinism: 'in-place',
    mayChangeMetrics: { crossings: 'improve-only' },
    run: c => { applyParallelDuplicateLanes(c.nodes, c.edges, c.groups, c.graph, c.bundled) },
  },
  {
    id: 'collapseTinyBundledHitches', doc: 'remove sub-perceptual hitches introduced by bundling',
    after: ['applySymmetricFanoutEmissions', 'applySymmetricParallelEdgeLanes', 'applyParallelDuplicateLanes'],
    mutates: ['edges'], determinism: 'in-place', mayChangeMetrics: { bends: 'improve-only' },
    run: c => { collapseTinyBundledHitches(c.nodes, c.edges, c.bundled) },
  },
  {
    id: 'reassignBundledSiblingLabels', doc: 're-home labels onto the correct bundled sibling segment',
    after: ['collapseTinyBundledHitches'], mutates: ['edges'], determinism: 'in-place',
    run: c => { reassignBundledSiblingLabels(c.nodes, c.edges, c.bundled, c.graph.direction, c.style) },
  },
  {
    id: 'applyRouteContracts', doc: 'classify -> simplify -> straighten (fixed-point) -> certify; FREEZES node geometry',
    after: ['reassignBundledSiblingLabels'], mutates: ['edges'], determinism: 'fixed-point', freezesNodes: true,
    mayChangeMetrics: { straight: 'improve-only', bends: 'improve-only', portRate: 'improve-only' },
    run: c => { applyRouteContracts({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.bundled, c.style) },
  },
  {
    id: 'reanchorOffOutlineEndpoints', doc: 're-route an edge whose endpoint dangles off a moved node onto that node\'s flow port (edge-only, freeze-safe)',
    after: ['applyRouteContracts'], mutates: ['edges'], determinism: 'in-place',
    run: c => { reanchorOffOutlineEndpoints(c.nodes, c.edges, c.graph) },
  },
  {
    id: 'rerouteEdgesThroughNodes', doc: 're-route an edge left running through a node by a node-mover (honorLinkRankDistance/alignPortLanes) around the obstacle (edge-only, freeze-safe)',
    after: ['reanchorOffOutlineEndpoints'], mutates: ['edges'], determinism: 'in-place',
    run: c => { rerouteEdgesThroughNodes(c.nodes, c.edges, c.graph) },
  },
  {
    id: 'repairLabelsOnSharedTrunks', doc: 're-slot a labeled edge whose pill sits on a trunk shared with another edge (label-only, freeze-safe)',
    after: ['rerouteEdgesThroughNodes'], mutates: ['edges'], determinism: 'in-place',
    run: c => { repairLabelsOnSharedTrunks({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'repairLabelsOffOwnRoute', doc: 're-slot a labeled edge whose pill sits off its OWN route onto it — ELK offset placement on an already-straight edge (label-only, freeze-safe)',
    after: ['repairLabelsOnSharedTrunks'], mutates: ['edges'], determinism: 'in-place',
    run: c => { repairLabelsOffOwnRoute({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'separateEdgeLabelPills', doc: 'slide colliding edge-label pills along their own routes into clear slots — parallel/reciprocal lane labels stack at midpoints (label-only, freeze-safe)',
    after: ['repairLabelsOffOwnRoute'], mutates: ['edges'], determinism: 'in-place',
    run: c => { separateEdgeLabelPills({ nodes: c.nodes, edges: c.edges, groups: c.groups }, c.graph, c.style) },
  },
  {
    id: 'translateGeometryToNonNegativeOrigin', doc: 'shift whole graph to a non-negative origin (allowed after freeze)',
    after: ['repairLabelsOffOwnRoute'], mutates: ['translate'], determinism: 'in-place',
    run: c => { translateGeometryToNonNegativeOrigin(c.nodes, c.edges, c.groups, c.layoutPadding) },
  },
  {
    // State diagrams only (plan §State 1, repo #118): place each note box on
    // the DECLARED side of its target, pushed outward past any node/group/
    // route obstacle — the anchoring invariant upstream #3782 breaks. A note
    // landing at negative coords shifts the whole graph uniformly (translate,
    // freeze-safe).
    id: 'placeStateNotes', doc: 'place state-diagram note boxes on their declared side, clear of nodes/groups/routes (state diagrams only; translate-only)',
    after: ['translateGeometryToNonNegativeOrigin'], mutates: ['translate'], determinism: 'in-place',
    enabled: c => Boolean(c.graph.stateNotes?.length),
    run: c => { c.notes = placeStateNotes(c.nodes, c.edges, c.groups, c.graph, c.style, c.layoutPadding, c.stateNoteMargin) },
  },
]

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

    const metrics = measureMultilineText(spec.text, style.edgeLabelFontSize, style.edgeLabelFontWeight)
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

    placed.push({ id: spec.id, target: spec.target, side: spec.side, text: spec.text, x, y, width: w, height: h })
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

function elkToPositioned(
  elkResult: ElkNode,
  graph: MermaidGraph,
  mergeEdges: boolean = false,
  layoutPadding: number = DEFAULTS.padding,
  style: ResolvedRenderStyle = resolveRenderStyle({}),
  stateNoteMargin: number = 18,
): PositionedGraph {
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

  // Compute margin positions for cross-hierarchy edge routing.
  // Margins sit outside all group bounding boxes so edges don't cross through subgraphs.
  const allBounds = flattenGroupBounds(groups)
  const margins: MarginInfo | undefined = allBounds.length > 0
    ? {
        leftX: Math.min(...allBounds.map(b => b.x)) - 20,
        rightX: Math.max(...allBounds.map(b => b.right)) + 20,
      }
    : undefined

  // Post-ELK geometry pipeline (docs/design/system/layout-pass-pipeline.md): the
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
    mergeEdges,
    style,
    layoutPadding,
    stateNoteMargin,
    frozen: false,
  }
  runPipeline(ctx, LAYOUT_PIPELINE)

  // Calculate final bounds including all edge points
  // ELK should include edges in its dimensions, but we verify and expand if needed
  let width = elkResult.width ?? 800
  let height = elkResult.height ?? 600
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
    if (edge.labelPosition) {
      width = Math.max(width, edge.labelPosition.x + 60 + padding)
      height = Math.max(height, edge.labelPosition.y + 20 + padding)
    }
  }
  for (const note of ctx.notes) {
    width = Math.max(width, note.x + note.width + padding)
    height = Math.max(height, note.y + note.height + padding)
  }

  return {
    width,
    height,
    nodes,
    edges,
    groups,
    ...(ctx.notes.length > 0 ? { notes: ctx.notes } : {}),
  }
}


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
      groups.push({
        id: child.id,
        label: mermaidSg?.label ?? '',
        x,
        y,
        width,
        height,
        children: childGroups,
        ...(mermaidSg?.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
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
          shape: mNode.shape,
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

/**
 * Lay out a parsed MermaidGraph using ELK.js (synchronous).
 * Returns a fully positioned graph ready for rendering.
 */
export function layoutGraphSync(
  graph: MermaidGraph,
  options: LayoutEngineOptions = {}
): PositionedGraph {
  const stateVisual = resolvedStateVisualOf(options)
  const opts = { ...DEFAULTS, ...options, ...(stateVisual ? { stateVisual } : {}) }
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults, options.styleFace)
  const elkGraph = mermaidToElk(graph, opts, style)
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
  for (const overrides of degradations) {
    const attempt = Object.keys(overrides).length === 0 ? elkGraph : mermaidToElk(graph, opts, style)
    if (Object.keys(overrides).length > 0) {
      attempt.layoutOptions = { ...attempt.layoutOptions, ...overrides }
    }
    try {
      const candidate = elkLayoutSync(attempt)
      // ELK can occasionally return a nominally successful graph containing
      // NaN geometry (notably a disconnected node beside a self-loop). Treat
      // that exactly like an ELK exception so the existing deterministic
      // degradation ladder gets a chance to produce usable geometry.
      if (containsNonFiniteNumber(candidate)) {
        lastError = new Error('ELK returned non-finite layout geometry')
        continue
      }
      result = candidate
      break
    } catch (err) {
      lastError = err
    }
  }
  if (!result) throw lastError
  const positioned = elkToPositioned(result, graph, DEFAULTS.mergeEdges, opts.padding, style, stateVisual?.noteMargin ?? 18)

  // Co-rank certify-or-fallback (the robustness-doc doctrine). The co-rank
  // balancing labels re-rank a mixed-label fan-in's sources; on rare graphs
  // (observed in RL/reverse-flow when a co-ranked source also carries an
  // upstream neighbor) that re-rank, after peer-dimension equalization, can push
  // a source box into an UNRELATED node — a HARD node-overlap the co-rank
  // introduced. We never ship a HARD violation: if the co-rank layout has any
  // hard violation AND the disabled layout is clean, fall back to the disabled
  // (base) layout, which is byte-equal to APL_NO_CORANK_FANIN. Only runs the
  // extra assessment when the graph actually used co-rank (the balancing map is
  // non-empty), so the common path pays nothing. Deterministic: layout is fully
  // synchronous, so the env toggle is saved/restored within this call with no
  // interleaving, and the fallback is a pure re-derivation of the same input.
  if (!layoutEnvFlag('APL_NO_CORANK_FANIN') &&
      corankFanInBalancingLabels(graph, style).size > 0 &&
      hardViolations(assessLayout(graph, positioned)).length > 0) {
    const saved = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
    const prev = saved?.APL_NO_CORANK_FANIN
    if (saved) saved.APL_NO_CORANK_FANIN = '1'
    try {
      const fallback = layoutGraphSync(graph, options)
      if (hardViolations(assessLayout(graph, fallback)).length === 0) return fallback
      // Disabled layout is itself not clean (not a co-rank regression): keep the
      // original rather than mask an unrelated pre-existing hard violation.
    } finally {
      if (saved) { if (prev === undefined) delete saved.APL_NO_CORANK_FANIN; else saved.APL_NO_CORANK_FANIN = prev }
    }
  }
  return positioned
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
  const stateVisual = resolvedStateVisualOf(options)
  const opts = { ...DEFAULTS, ...options, ...(stateVisual ? { stateVisual } : {}) }
  const style = resolveRenderStyle(options, stateVisual?.styleDefaults, options.styleFace)
  return mermaidToElk(graph, opts, style)
}
