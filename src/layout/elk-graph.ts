// ELK graph preparation: authored order, measured nodes, hierarchy and port constraints.
import { applyLayoutHints } from './layout-hints.ts'
import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { graphTextBlock } from '../graph-text.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs'
import type { MermaidGraph, MermaidSubgraph, MermaidEdge, MermaidNode, Direction, RenderOptions, RouteClass } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { ResolvedStateVisualConfig } from '../state/config.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { classifyRoutes, PORT_EXACT } from '../route-contracts.ts'
import { terminalHookLength } from './route-geometry.ts'
import { resolveEdgeInlineStyle } from '../color-resolver.ts'
import { DEFAULTS, layoutFlow, layoutEnvFlag } from './geometry.ts'
import { directionToElk } from './backend.ts'
import type { ElkHierarchySegment } from './passes/elk-edges.ts'
import { extractEdgesRecursively, alignPortLanes, centerPeerBarycenters, markCorankFanInBundles, applyParallelDuplicateLanes } from './passes/index.ts'

type MarkerPortDemand = { count: number; span: number }
type ElkConversionOptions = Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>> &
  Pick<RenderOptions, 'layoutHints'> & { preserveSubgraphChildOrder?: boolean; separateHierarchy?: boolean; disableCorankFanIn?: boolean; nodeSizes?: ReadonlyMap<string, { width: number; height: number }>; preferModelOrder?: boolean } & { stateVisual?: ResolvedStateVisualConfig; markerPortExtents?: ReadonlyMap<string, MarkerPortDemand> }

// ============================================================================
// Layout options
// ============================================================================

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
  // Keep the existing authored-order cycle decisions; only replace repeated
  // ready-list sorting with a heap using the same original-order tie breaker.
  const addReady = (id: string): void => {
    let index = ready.length
    ready.push(id)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (orderByOriginal(ready[parent]!, id) <= 0) break
      ready[index] = ready[parent]!
      index = parent
    }
    ready[index] = id
  }
  const out: string[] = []
  while (ready.length > 0) {
    const id = ready[0]!
    const last = ready.pop()!
    if (ready.length) {
      let index = 0
      while (index * 2 + 1 < ready.length) {
        let child = index * 2 + 1
        if (child + 1 < ready.length && orderByOriginal(ready[child + 1]!, ready[child]!) < 0) child++
        if (orderByOriginal(last, ready[child]!) <= 0) break
        ready[index] = ready[child]!
        index = child
      }
      ready[index] = last
    }
    out.push(id)
    for (const next of Array.from(outgoing.get(id) ?? []).sort(orderByOriginal)) {
      const nextDegree = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextDegree)
      if (nextDegree === 0) {
        addReady(next)
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

export function estimateNodeSize(id: string, label: DisplayTextInput, shape: string, style: ResolvedRenderStyle, direction: Direction = 'TB', stateVisual?: ResolvedStateVisualConfig, labelBlock?: PixelTextBlock): { width: number; height: number } {
  void id
  const metrics = labelBlock ?? graphTextBlock(label, style, 'node')

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

  if (shape === 'ellipse') {
    // Enclose the padded label rectangle inside the curved boundary.
    width = Math.ceil(width * Math.SQRT2)
    height = Math.ceil(height * Math.SQRT2)
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

interface HierarchyPort {
  id: string
  direction: 'in' | 'out'
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
export function corankFanInBalancingLabels(
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
      const metrics = graphTextBlock(resolveLabelContent(graph.edges[i]!.label!, graph.edges[i]!.labelContent), style, 'edge')
      const label = metrics.text
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

/** Reserve the measured cross footprint before implicit ELK ports are placed.
 * The old zero-size ports could fit their centerlines while scaled endpoint
 * resources overlapped. Actual returned dimensions remain the render authority;
 * this sizing proposal is not a replacement for final paint admission. */
function elkMarkerPortExtents(graph: MermaidGraph, style: ResolvedRenderStyle): ReadonlyMap<string, MarkerPortDemand> {
  const incoming = new Map<string, { count: number; span: number; known: boolean }>()
  for (let index = 0; index < graph.edges.length; index++) {
    const edge = graph.edges[index]!, node = graph.nodes.get(edge.target)
    if (!node || node.shape !== 'rectangle' || node.semanticShape || edge.style === 'invisible' || edge.source === edge.target) continue
    const pressure = incoming.get(node.id) ?? { count: 0, span: 0, known: true }
    pressure.count++
    // This is a canonical normal-facing resource measurement, not a proposed
    // rounded/cubic route. Retain the real resource and written width while
    // avoiding the orientation-unknown radial veto used for actual curves.
    const multiple = edge.style === 'thick' ? 2 : 1
    const width = style.lineWidth * multiple
    const regions = Number.isFinite(width) && width > 0 ? graphEdgeMarkerPaintRegions({ ...edge, curve: undefined, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], inlineStyle: resolveEdgeInlineStyle(index, graph) }, { ...style, lineWidth: Number(formatSvgNumber(width)) / multiple, edgeBendRadius: 0 }) : undefined
    const marker = regions?.find(region => region.position === 'end')
    if (edge.hasArrowEnd && (!marker?.bounds || !Object.values(marker.bounds).every(Number.isFinite))) pressure.known = false
    else if (marker?.bounds) pressure.span = Math.max(pressure.span, marker.bounds.y1 - marker.bounds.y0)
    incoming.set(node.id, pressure)
  }
  const minimums = new Map<string, MarkerPortDemand>()
  for (const [id, pressure] of incoming) {
    if (pressure.count < 2 || !pressure.known || pressure.span <= 0) continue
    minimums.set(id, { count: pressure.count, span: pressure.span })
  }
  return minimums
}

/**
 * Convert a MermaidGraph to ELK's nested JSON input format.
 *
 * Uses SEPARATE hierarchy handling for proper subgraph direction override support.
 * Cross-hierarchy edges use hierarchical ports to connect external and internal sections.
 */
/** ELK's in-layer edge/node gap sets the height of outer feedback channels,
 * whose returns end in a hook of that length. Keep ELK's default unless the
 * style's painted marker and corner need a longer hook and a cycle (a
 * self-loop included) gives the graph such a channel at all. */
function outerChannelSpacing(graph: MermaidGraph, hook: number): Record<string, string> {
  return hook > terminalHookLength({}) && hasDirectedCycle(graph.edges) ? { 'elk.spacing.edgeNode': String(hook) } : {}
}

export function graphTerminalDemands(style: ResolvedRenderStyle, graph: MermaidGraph): { hook: number; corridor: number } {
  let hook = terminalHookLength(style)
  let corridor = 0
  for (const [index, edge] of graph.edges.entries()) {
    if (edge.style === 'invisible') continue
    const painted = { ...edge, inlineStyle: resolveEdgeInlineStyle(index, graph) }
    const start = terminalHookLength(style, painted, 'start'), end = terminalHookLength(style, painted, 'end')
    hook = Math.max(hook, start, end)
    // Straight routes have no edge/node elbow to reserve their marker space.
    // Both endpoint heads must fit even when ELK aligns the cards directly.
    corridor = Math.max(corridor, (edge.hasArrowStart ? start - (style.edgeBendRadius ?? 0) : 0) + (edge.hasArrowEnd ? end - (style.edgeBendRadius ?? 0) : 0))
  }
  return { hook, corridor }
}

function hasDirectedCycle(edges: readonly Pick<MermaidEdge, 'source' | 'target'>[]): boolean {
  const indegree = new Map<string, number>(), outgoing = new Map<string, string[]>()
  for (const { source, target } of edges) {
    if (source === target) return true
    indegree.set(source, indegree.get(source) ?? 0)
    indegree.set(target, (indegree.get(target) ?? 0) + 1)
    outgoing.set(source, [...outgoing.get(source) ?? [], target])
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  let removed = 0
  for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
    removed++
    for (const next of outgoing.get(id) ?? []) {
      const count = indegree.get(next)! - 1
      indegree.set(next, count)
      if (count === 0) ready.push(next)
    }
  }
  return removed < indegree.size
}

export function mermaidToElk(
  graph: MermaidGraph,
  opts: ElkConversionOptions,
  style: ResolvedRenderStyle,
): ElkGraphNode {
  const { hook, corridor } = graphTerminalDemands(style, graph)
  // Projected families replace these temporary graph connectors with their
  // own measured glyphs/routes; their placement contracts retain their sizes.
  opts = { ...opts, layerSpacing: Math.max(opts.layerSpacing ?? DEFAULTS.layerSpacing, corridor), markerPortExtents: opts.preserveSubgraphChildOrder || opts.stateVisual ? undefined : elkMarkerPortExtents(graph, style) }
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
  const balancingLabels = opts.disableCorankFanIn ? new Map<number, BalancingLabel>() : corankFanInBalancingLabels(graph, style)

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
  const separateHierarchy = usesSeparateHierarchy(graph, opts)
  const routePortHints = buildRoutePortHints(graph, subgraphIds)
  const subgraphPorts = new Map<string, HierarchyPort[]>()
  const crossEdgesByHost = new Map<string | null, ElkExtendedEdge[]>()
  let reservedIds: Set<string> | undefined
  const allocateId = (preferred: string): string => {
    reservedIds ??= new Set([...graph.nodes.keys(), ...subgraphIds,
      ...[...routePortHints.byEndpoint.values()].map(port => port.portId)])
    let id = preferred
    while (reservedIds.has(id)) id += '_'
    reservedIds.add(id)
    return id
  }
  const boundaryPort = (group: string, index: number, direction: 'in' | 'out'): string => {
    const id = allocateId(`${group}_${direction}_${index}`)
    const ports = subgraphPorts.get(group) ?? []
    ports.push({ id, direction })
    subgraphPorts.set(group, ports)
    return id
  }
  const addHierarchyEdge = (edge: MermaidEdge, index: number): void => {
    // A group connected to its own descendant is an endpoint on this scope's
    // boundary, not a reference to the parent node from a different layout.
    const sourceIsAncestor = subgraphIds.has(edge.source) && endpointAncestors(edge.target).includes(edge.source)
    const targetIsAncestor = subgraphIds.has(edge.target) && endpointAncestors(edge.source).includes(edge.target)
    const sourceScopes = sourceIsAncestor ? subgraphAncestors.get(edge.source)! : endpointAncestors(edge.source)
    const targetScopes = targetIsAncestor ? subgraphAncestors.get(edge.target)! : endpointAncestors(edge.target)
    const host = deepestCommonAncestor(sourceScopes, targetScopes)
    const commonDepth = host ? sourceScopes.indexOf(host) + 1 : 0
    let source = sourceIsAncestor ? boundaryPort(edge.source, index, 'in')
      : routePortHints.byEndpoint.get(endpointKey(index, 'source'))?.portId ?? edge.source
    const target = targetIsAncestor ? boundaryPort(edge.target, index, 'out')
      : routePortHints.byEndpoint.get(endpointKey(index, 'target'))?.portId ?? edge.target
    let order = 0
    const segment = (scope: string | undefined, from: string, to: string, central = false): void => {
      const base = central ? crossHierarchyElkEdge(index, edge, from, to, style, balancingLabels)
        : { id: `e${index}_internal_${order}`, sources: [from], targets: [to] }
      const elkEdge: ElkHierarchySegment = { ...base, id: allocateId(base.id), hierarchySegment: { edgeIndex: index, order: order++ } }
      const edges = crossEdgesByHost.get(scope ?? null) ?? []
      edges.push(elkEdge)
      crossEdgesByHost.set(scope ?? null, edges)
    }
    for (const scope of sourceScopes.slice(commonDepth).reverse()) {
      const port = boundaryPort(scope, index, 'out')
      segment(scope, source, port)
      source = port
    }
    const targetChain = targetScopes.slice(commonDepth).map(scope => ({ scope, port: boundaryPort(scope, index, 'in') }))
    segment(host, source, targetChain[0]?.port ?? target, true)
    for (let i = 0; i < targetChain.length; i++) {
      const entry = targetChain[i]!
      segment(entry.scope, entry.port, targetChain[i + 1]?.port ?? target)
    }
  }

  // Classify edges into three categories:
  // 1. Internal edges (both endpoints in same subgraph)
  // 2. Root-level edges (neither endpoint in a subgraph)
  // 3. Cross-hierarchy edges (endpoints in different levels)
  const edgesBySubgraph = new Map<string | null, Array<{ index: number; edge: typeof graph.edges[0] }>>()
  edgesBySubgraph.set(null, []) // Root-level edges

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
    } else if (!separateHierarchy) {
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
      // Every traversed scope owns a port-to-child segment. This also keeps
      // edges to an ancestor's boundary inside that ancestor's own layout.
      addHierarchyEdge(edge, i)
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
      // Channel segments keep a stroke-scaled marker and rounded corner clear.
      'elk.layered.spacing.edgeNodeBetweenLayers': String(hook),
      ...outerChannelSpacing(graph, hook),
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
      'elk.layered.crossingMinimization.forceNodeModelOrder': opts.preferModelOrder ? 'false' : 'true',
      'elk.layered.wrapping.strategy': 'OFF',
      // Use SEPARATE when subgraphs have direction overrides (enables proper direction handling)
      // Use INCLUDE_CHILDREN otherwise (simpler cross-hierarchy edge routing)
      'elk.hierarchyHandling': separateHierarchy ? 'SEPARATE' : 'INCLUDE_CHILDREN',
    },
    children: [],
    edges: [],
  }

  // Projected families such as architecture may rely on parser child order
  // inside compounds for stable boundary routing; root-level group-vs-node
  // siblings still use source-before-target constraints.
  const useSourceAwareChildOrder = !opts.preserveSubgraphChildOrder

  const topLevelSubgraphs = new Map(graph.subgraphs.map(sg => [sg.id, sg]))
  const rootOrder = rootChildOrder(graph, subgraphNodeIds, subgraphIds, nodeToRootSubgraph, Boolean(opts.preserveSubgraphChildOrder))
  for (const id of rootOrder) {
    const sg = topLevelSubgraphs.get(id)
    if (sg) {
      elkGraph.children!.push(subgraphToElk(sg, graph, opts, style, hook, edgesBySubgraph, subgraphPorts, crossEdgesByHost, routePortHints, useSourceAwareChildOrder, balancingLabels, separateHierarchy, graph.direction))
      continue
    }
    const node = graph.nodes.get(id)
    if (node && !subgraphNodeIds.has(id) && !subgraphIds.has(id)) {
      elkGraph.children!.push(nodeToElkLeaf(id, node, style, routePortHints, graph.direction, opts.stateVisual, opts.nodeSizes?.get(id), opts.markerPortExtents?.get(id)))
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
      const metrics = graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
      const label = metrics.text
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
  for (const edge of crossEdgesByHost.get(null) ?? []) {
    elkGraph.edges!.push(edge)
  }

  applyLayoutHints(elkGraph, graph, opts.layoutHints)
  if (separateHierarchy && subgraphPorts.size > 0) preserveHierarchyPortConstraints(elkGraph, subgraphPorts)
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

function nodeToElkLeaf(id: string, node: MermaidNode, style: ResolvedRenderStyle, hints: RoutePortHints, direction: Direction = 'TB', stateVisual?: ResolvedStateVisualConfig, placementSize?: { width: number; height: number }, markerPortDemand?: MarkerPortDemand): ElkGraphNode {
  const size = placementSize ?? estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, direction, stateVisual, node.labelBlock)
  const horizontal = direction === 'LR' || direction === 'RL'
  let crossSize = horizontal ? size.height : size.width
  if (!placementSize && markerPortDemand) {
    const separation = Math.max(markerPortDemand.span, Math.min(style.cornerRadius ?? 0, (horizontal ? size.width : size.height) / 2))
    // Already-separated nominal seats retain their exact measured dimensions.
    // Only a crowded face receives a strict one-pixel separator proposal.
    if (!(crossSize / (markerPortDemand.count + 1) > separation)) {
      const extent = (markerPortDemand.count + 1) * (separation + 1)
      if (Number.isFinite(extent) && extent > crossSize) crossSize = extent
    }
  }
  const elkNode: ElkGraphNode = {
    id,
    width: horizontal ? size.width : crossSize,
    height: horizontal ? crossSize : size.height,
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
  index: number,
  edge: MermaidEdge,
  source: string,
  target: string,
  style: ResolvedRenderStyle,
  balancingLabels?: Map<number, BalancingLabel>,
): ElkExtendedEdge {
  const elkEdge: ElkExtendedEdge = {
    id: `e${index}`,
    sources: [source],
    targets: [target],
  }
  if (edge.label && !layoutEnvFlag('APL_DECOUPLE_LABELS')) {
    const metrics = graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
    const label = metrics.text
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

/** SEPARATE hierarchy handling, used when any subgraph overrides its
 * direction, or when a group's title needs a width INCLUDE_CHILDREN would not
 * give it; otherwise INCLUDE_CHILDREN. */
export function usesSeparateHierarchy(graph: MermaidGraph, opts: Pick<ElkConversionOptions, 'separateHierarchy'>): boolean {
  const hasOverride = (sg: MermaidSubgraph): boolean => sg.direction !== undefined || sg.children.some(hasOverride)
  return opts.separateHierarchy === true || graph.subgraphs.some(hasOverride)
}

/** A separate child exports fixed boundary ports before its parent is laid out.
 * ELK's forced model-order heuristic skips the constraint resolver that keeps
 * non-flow port dummies on their declared side. Preserve the model-order
 * preference, but let those port constraints resolve before exporting routes. */
function preserveHierarchyPortConstraints(root: ElkNode, syntheticPorts: ReadonlyMap<string, readonly HierarchyPort[]>): void {
  const horizontal = (direction: string | undefined): boolean => direction === 'RIGHT' || direction === 'LEFT'
  const visit = (scope: ElkNode): void => {
    const scopeHorizontal = horizontal(scope.layoutOptions?.['elk.direction'])
    let needsPortConstraints = false
    for (const child of scope.children ?? []) {
      if (child.children === undefined) continue
      if (!needsPortConstraints && syntheticPorts.has(child.id)) {
        // An unspecified side follows the child's flow before child export;
        // a different parent axis therefore makes it a non-flow fixed port.
        needsPortConstraints = horizontal(child.layoutOptions?.['elk.direction']) !== scopeHorizontal
          || (child.ports ?? []).some(port => {
            const side = port.layoutOptions?.['elk.port.side']
            return scopeHorizontal ? side === 'NORTH' || side === 'SOUTH' : side === 'EAST' || side === 'WEST'
          })
      }
      visit(child)
    }
    if (needsPortConstraints && scope.layoutOptions?.['elk.layered.crossingMinimization.forceNodeModelOrder'] === 'true') {
      scope.layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'false'
      // Adjacency hints may enable forcing in a nested scope. Its requested
      // child sequence remains an ELK preference while port constraints win.
      scope.layoutOptions['elk.layered.considerModelOrder.strategy'] ??= 'NODES_AND_EDGES'
    }
  }
  visit(root)
}

/** The width a titled group needs so its header title stays inside the frame.
 * A group with nothing in it is laid out without one: it has no frame to hold
 * the title, which is drawn from where the group sits. An explicit family
 * minimum additionally reserves that empty group's actual title footprint. */
export function groupTitleWidth(sg: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'titleOffset' | 'nodeIds' | 'children' | 'headerMinHeight'>, style: ResolvedRenderStyle): number {
  if (!sg.label || sg.concurrencyRegion || (sg.headerMinHeight === undefined && sg.nodeIds.length === 0 && sg.children.length === 0)) return 0
  const width = graphTextBlock(resolveLabelContent(sg.label, sg.labelContent), style, 'group').width
  return Math.ceil((sg.titleOffset ?? style.groupLabelPaddingX) + width + style.groupLabelPaddingX)
}

/** One measured strip is shared by both placement producers and retention. */
export function groupHeaderHeight(
  group: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'headerMinHeight'>,
  style: ResolvedRenderStyle,
  block = graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group'),
): number {
  if (group.concurrencyRegion) return 0
  const measured = style.groupHeaderFontSize + 16 + block.height - block.lineHeight
  if (group.headerMinHeight === undefined) return measured
  if (!Number.isFinite(group.headerMinHeight) || group.headerMinHeight <= 0) throw new RangeError('Invalid internal group header minimum')
  return Math.max(measured, group.headerMinHeight)
}

/** Placement body of an empty group; a colon cannot occur in an authored id. */
const EMPTY_GROUP_BODY_PREFIX = 'empty-group:'
const EMPTY_GROUP_BODY = { width: 24, height: 16 }

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
  hook: number,
  edgesBySubgraph: Map<string | null, Array<{ index: number; edge: MermaidEdge }>>,
  subgraphPorts: Map<string, HierarchyPort[]>,
  crossEdgesByHost: Map<string | null, ElkExtendedEdge[]>,
  routePortHints: RoutePortHints,
  useSourceAwareOrder: boolean,
  balancingLabels: Map<number, BalancingLabel>,
  separateHierarchy: boolean,
  inheritedDirection: Direction = 'TB',
): ElkGraphNode {
  // Concurrency regions draw no header band of their own, so they reserve
  // only the plain padding at the top (plan §State 2c).
  const measuredHeaderHeight = groupHeaderHeight(sg, style)
  const dividerMargin = sg.concurrencyRegion ? (opts.stateVisual?.dividerMargin ?? 0) : 0
  // Effective direction of THIS scope — drives direction-dependent node
  // sizing (fork/join bars) for direct children.
  const effectiveDirection = sg.direction ?? inheritedDirection
  const layoutOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.padding': `[top=${measuredHeaderHeight + style.groupPaddingY + dividerMargin},left=${style.groupPaddingX + dividerMargin},bottom=${style.groupPaddingY + dividerMargin},right=${style.groupPaddingX + dividerMargin}]`,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.contentAlignment': 'H_CENTER V_CENTER',
    'elk.spacing.edgeEdge': '12',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
    'elk.layered.spacing.edgeNodeBetweenLayers': String(hook),
    ...outerChannelSpacing(graph, hook),
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
    'elk.spacing.nodeNode': String(opts.nodeSpacing),
  }

  // SEPARATE scopes are independent ELK runs; direction is not inherited.
  if (sg.direction || separateHierarchy) {
    layoutOptions['elk.direction'] = directionToElk(effectiveDirection)
  }

  // The header title is drawn from the group's left edge, so a group narrower
  // than its title would push the title past the frame (and off the canvas).
  // ELK centers the content in a compound node held to this minimum width, but
  // only SEPARATE hierarchy handling honors it (see layoutUntitledGraph).
  // INCLUDE_CHILDREN ignores the width and instead grows a small group by a
  // title line's height, so the constraint is set for SEPARATE layouts alone.
  const titleWidth = groupTitleWidth(sg, style)
  if (titleWidth > 0 && separateHierarchy) {
    layoutOptions['elk.nodeSize.constraints'] = 'MINIMUM_SIZE'
    layoutOptions['elk.nodeSize.minimum'] = `(${titleWidth}, 0)`
  }

  const elkNode: ElkGraphNode = {
    id: sg.id,
    layoutOptions,
    labels: sg.label ? [{ text: sg.label }] : undefined,
    children: [],
    edges: [],
    ...(sg.headerMinHeight !== undefined && sg.nodeIds.length === 0 && sg.children.length === 0 ? {
      width: Math.max(titleWidth, 2 * style.groupPaddingX),
      height: measuredHeaderHeight + 2 * style.groupPaddingY,
    } : {}),
  }

  // Add hierarchical ports for cross-hierarchy edges (when using SEPARATE)
  const ports = subgraphPorts.get(sg.id) ?? []
  if (ports.length > 0) {
    // Every hierarchical port continues inside its scope, even when the edge
    // traverses only one boundary. Keep that interior section off the title-
    // bearing north face. An authored group endpoint uses the group itself,
    // so its legitimate exterior north-face contact is unaffected.
    const avoidHeader = measuredHeaderHeight > 0
    const flow = layoutFlow(graph.direction)
    elkNode.ports = ports.map(port => {
      const preferred = port.direction === 'in' ? flow.targetSide : flow.sourceSide
      const side = preferred === 'N' ? (port.direction === 'in' ? 'W' : 'E') : preferred
      // FIXED_SIDE with no side on an unsized UP compound falls back to
      // NORTH in ELK's importer. Declare the already-safe preference there.
      return { id: port.id, ...(avoidHeader && (preferred === 'N' || effectiveDirection === 'BT') ? { layoutOptions: { 'elk.port.side': elkPortSide(side) } } : {}) }
    })
    if (avoidHeader) elkNode.layoutOptions!['elk.portConstraints'] = 'FIXED_SIDE'
  }

  // Add direct child nodes using the same source-aware ordering within the group
  // for flowchart-like graphs; architecture keeps parser order for stable
  // group-boundary routing.
  const childNodeOrder = useSourceAwareOrder ? sourceAwareNodeOrder(sg.nodeIds, graph.edges) : sg.nodeIds
  for (const nodeId of childNodeOrder) {
    const node = graph.nodes.get(nodeId)
    if (node) {
      elkNode.children!.push(nodeToElkLeaf(nodeId, node, style, routePortHints, effectiveDirection, opts.stateVisual, opts.nodeSizes?.get(nodeId), opts.markerPortExtents?.get(nodeId)))
    }
  }

  // An empty group would collapse to a 0x0 frame. An unpainted placement
  // body (never a positioned node: it has no authored entry) reserves a
  // frame under the title band, at least as wide as the title.
  if (!sg.concurrencyRegion && sg.headerMinHeight === undefined && elkNode.children!.length === 0 && sg.children.length === 0) {
    const title = sg.label ? Math.ceil((sg.titleOffset ?? style.groupLabelPaddingX) + graphTextBlock(resolveLabelContent(sg.label, sg.labelContent), style, 'group').width + style.groupLabelPaddingX) : 0
    elkNode.children!.push({ id: `${EMPTY_GROUP_BODY_PREFIX}${sg.id}`, width: Math.max(title - 2 * style.groupPaddingX, EMPTY_GROUP_BODY.width), height: EMPTY_GROUP_BODY.height })
  }

  // Add nested subgraphs recursively
  for (const child of sg.children) {
    elkNode.children!.push(subgraphToElk(child, graph, opts, style, hook, edgesBySubgraph, subgraphPorts, crossEdgesByHost, routePortHints, useSourceAwareOrder, balancingLabels, separateHierarchy, effectiveDirection))
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
      const metrics = graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
      const label = metrics.text
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

  // Each retained segment references direct children or this compound's own
  // boundary ports, without skipping an enclosing layout scope.
  for (const edge of crossEdgesByHost.get(sg.id) ?? []) {
    elkNode.edges!.push(edge)
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
