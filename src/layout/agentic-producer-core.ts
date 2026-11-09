import { prepareMeasuredGraphCandidate } from './measured-graph-producer.ts'
import { finalizeFlatMeasuredMarkers } from './compound-boundary-routes.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { LayoutCertificationCandidate } from './certification.ts'
import { GraphLayoutUnsupportedError, LayoutCertificationError } from './backend.ts'
import type { MermaidGraph, PositionedGraph } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { MAX_EXPANDED_VERTICES, layoutLayeredGraph as layoutRawGraph } from './agentic-layered-core.ts'
import { shortenMeasuredRoutes } from './shorten-measured-routes.ts'
import { fitMeasuredLayout } from './fit-measured-layout.ts'
import { layoutOptimization } from './optimization-context.ts'
export { improveArchitectureSiblingSlots } from './architecture-sibling-slots.ts'

// Keep cache storage inside the optional solver chunk: importing shared
// request helpers here creates extra requests for families selecting ELK.
class NativeResults<T> {
  readonly #entries = new Map<string, { value: T; weight: number }>()
  #weight = 0
  readonly #maxWeight: number
  constructor(maxWeight: number) { this.#maxWeight = maxWeight }
  get(key: string): T | undefined {
    const found = this.#entries.get(key)
    if (!found) return undefined
    this.#entries.delete(key); this.#entries.set(key, found)
    return found.value
  }
  set(key: string, value: T, weight: number): void {
    if (weight > this.#maxWeight) return
    const prior = this.#entries.get(key)
    if (prior) { this.#entries.delete(key); this.#weight -= prior.weight }
    this.#entries.set(key, { value, weight }); this.#weight += weight
    while (this.#entries.size > 64 || this.#weight > this.#maxWeight) {
      const oldest = this.#entries.keys().next().value!
      this.#weight -= this.#entries.get(oldest)!.weight; this.#entries.delete(oldest)
    }
  }
}

const nativeHost = globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_ELK_CACHE?: unknown }
const NATIVE_CACHE_ENABLED = (nativeHost.process?.env?.AGENTIC_MERMAID_ELK_CACHE ?? nativeHost.AGENTIC_MERMAID_ELK_CACHE) !== '0'

function geometryInputKey(input: unknown): string {
  return JSON.stringify(input, (_key, value: unknown) => {
    if (value === undefined) return '\u0000undefined'
    if (typeof value === 'number' && !Number.isFinite(value)) return `\u0000${value}`
    if (typeof value === 'string' && value.startsWith('\u0000')) return `\u0000${value}`
    if (value instanceof Map) return { mapEntries: [...value] }
    if (value instanceof Set) return { setValues: [...value] }
    return value
  })
}

type NativeOrder = 'primary' | 'authored' | 'compact' | 'ports'
const orderChoices = new WeakMap<AgenticGraphBindings, NativeResults<NativeOrder>>()
// Private preparation-to-solver handoff: never part of measured JSON or a
// caller-supplied cache key, and never exposed by layoutAgenticGraph.
const preparedGraphWork = new WeakMap<MeasuredGraph, ChannelWork>()

/** Reuse measured geometry across source edits without retaining authored text,
 * prepared-text evidence or receipts. Every caller owns its returned arrays. */
export function createMeasuredLayoutCache(compute: (input: MeasuredGraph) => AgenticLayout): (input: MeasuredGraph) => AgenticLayout {
  const results = new NativeResults<AgenticLayout>(8 * 1024 * 1024)
  return input => {
    // The legacy startup switch controls both engines and both native caches.
    if (!NATIVE_CACHE_ENABLED) return compute(input)
    const key = geometryInputKey(input)
    if (key.length > 1024 * 1024) return compute(input)
    const found = results.get(key)
    if (found) return structuredClone(found)
    const result = compute(input)
    const weight = key.length * 2 + JSON.stringify(result).length * 4 + 512
    // Oversized results remain uncached; the shared LRU also bounds entry count.
    if (weight <= 8 * 1024 * 1024) results.set(key, structuredClone(result), weight)
    return result
  }
}

export function layoutLayeredGraph(input: MeasuredGraph, forest: (input: MeasuredGraph) => AgenticLayout | undefined, unsupported: (reason: string) => never, routingWork?: ChannelWork): AgenticLayout {
  const explicit = routingWork
  const prepared = preparedGraphWork.get(input)
  try {
    if (prepared && routingWork && routingWork !== prepared) {
      // Keep the private plain ledger authoritative even for a hostile explicit
      // work object. A stricter live owner can only lower its remaining quota.
      prepared.pairs -= 24
      const pairs = routingWork.pairs, arcs = routingWork.arcs, swaps = routingWork.swaps
      prepared.pairs = Math.min(prepared.pairs, pairs - (1_000_000 - prepared.pairs))
      prepared.arcs = Math.min(prepared.arcs, arcs - (65536 - prepared.arcs))
      prepared.swaps = Math.min(prepared.swaps, swaps - (1_000_000 - prepared.swaps))
      if (!Number.isFinite(prepared.pairs) || !Number.isFinite(prepared.arcs) || !Number.isFinite(prepared.swaps) || prepared.pairs < 0 || prepared.arcs < 0 || prepared.swaps < 0) unsupported('agentic marker preparation work limit')
    }
    routingWork = preparedGraphWork.get(input) ?? routingWork ?? { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
    const shortening = { attempts: 512, comparisons: 8_000_000 }
    let completed = false
    const sizedInput = (candidate: AgenticLayout): MeasuredGraph => {
      if (!candidate.nodes.some(node => node.width !== undefined || node.height !== undefined)) return input
      return { ...input, nodes: input.nodes.map((node, index) => {
        const actual = candidate.nodes[index]!
        if (actual.width === undefined && actual.height === undefined) return node
        if (node.sizePolicy !== 'minimum' || !Number.isFinite(actual.width) || !Number.isFinite(actual.height)
          || actual.width! < node.width || actual.height! < node.height) throw new TypeError('Native capacity violated body size policy')
        return { ...node, width: actual.width!, height: actual.height! }
      }) }
    }
    const finish = (candidate: AgenticLayout, fail: (reason: string) => never, work: ChannelWork): AgenticLayout => {
      const measured = sizedInput(candidate)
      const final = finalizeFlatMeasuredMarkers(measured, candidate, work, MAX_EXPANDED_VERTICES, fail)
      const result = fitMeasuredLayout(measured, shortenMeasuredRoutes(measured, final, shortening))
      completed = true
      return result
    }
    const placed = layoutRawGraph(input, forest, unsupported, routingWork, undefined, input.placementOnly ? undefined : finish)
    if (completed || input.placementOnly) return placed
    const measured = sizedInput(placed)
    const final = finalizeFlatMeasuredMarkers(measured, placed, routingWork, MAX_EXPANDED_VERTICES, unsupported)
    return shortenMeasuredRoutes(measured, final, shortening)
  } finally {
    if (prepared && explicit && explicit !== prepared) {
      explicit.pairs = prepared.pairs; explicit.arcs = prepared.arcs; explicit.swaps = prepared.swaps
    }
  }
}

/** Native controls wrap the shared measured producer.
 * Cache, search flags, prepared work and legacy completion stay private. */
function placeNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout,
  bindings: AgenticGraphBindings,
  placementOnly = false,
  order: NativeOrder = 'primary',
): PositionedGraph {
  const prepared = prepareMeasuredGraphCandidate(graph, options, style, bindings, placementOnly ? 'legacy-placement' : 'legacy-routed')
  const measured: MeasuredGraph = prepared.measured
  if (order === 'authored') measured.authoredCycleOrder = true
  else if (order === 'compact') measured.compactPrivateRanks = true
  else if (order === 'ports') measured.portAwarePlacement = true
  if (placementOnly) measured.placementOnly = true
  preparedGraphWork.set(measured, prepared.routingWork)
  let geometry: AgenticLayout
  try { layoutOptimization()?.recordLayoutProducer(); geometry = bindings.measureRenderStage('agentic', () => layoutAgenticGraph(measured)) }
  finally { preparedGraphWork.delete(measured) }
  return prepared.project(geometry, { mergeEdges: geometry.topology === 'forest', sharedEdges: geometry.sharedEdges })
}

/** Compare bounded alternatives after shared cleanup, so early routing
 * scores cannot conceal final label conflicts or lost terminal clearance. */
function selectNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout, bindings: AgenticGraphBindings,
): PositionedGraph {
  const eligible = options.compareRoutePreferences !== false && !options.stateVisual && !graph.subgraphs.length && graph.nodes.size <= 20 && graph.edges.length <= 64
  // Retain only the chosen strategy, never prepared text, geometry or proof.
  // Replayed production still passes the caller's mandatory final certifier.
  let key: string | undefined, choices: NativeResults<NativeOrder> | undefined
  if (eligible && NATIVE_CACHE_ENABLED && !bindings.customTextMeasurementActive()) {
    const serialized = geometryInputKey([graph, options, style,
      Object.keys(nativeHost.process?.env ?? {}).filter(name => name.startsWith('APL_')).map(name => [name, nativeHost.process!.env![name]]).sort()])
    if (serialized.length <= 65536) {
      key = serialized
      choices = orderChoices.get(bindings)
      if (!choices) { choices = new NativeResults(1024 * 1024); orderChoices.set(bindings, choices) }
      const chosen = choices.get(key)
      if (chosen) return placeNativeGraphCandidate(graph, options, style,
        layoutAgenticGraph, bindings, false, chosen)
    }
  }
  const first = placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
  if (!eligible) return first
  const candidates = [{ strategy: 'agentic-authored-order',
    produce: () => placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings, false, 'authored') }]
  if (graph.edges.some(edge => !edge.label)) candidates.push({ strategy: 'agentic-compact-ranks',
    produce: () => placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings, false, 'compact') })
  const selected = refineOwnedLayoutCandidate(graph, style, first, candidates, bindings)
  const chosen = selected === first ? 'primary' : selected.certification?.strategy === 'agentic-authored-order' ? 'authored'
    : selected.certification?.strategy === 'agentic-compact-ranks' ? 'compact' : undefined
  if (key && choices && chosen) choices.set(key, chosen, key.length * 2 + 128)
  return selected
}

/** A bounded owned refinement preserves the feasible primary result. Producer
 * defects, meaning changes, deferred dependencies and global limits propagate. */
export function refineOwnedLayoutCandidate(
  graph: MermaidGraph, style: ResolvedRenderStyle, first: PositionedGraph,
  alternatives: (() => PositionedGraph) | readonly Pick<LayoutCertificationCandidate, 'strategy' | 'produce'>[],
  bindings: Pick<AgenticGraphBindings, 'certifyCandidate' | 'retainSelection' | 'countEdgeCrossings' | 'countOpposingRouteOverlaps' | 'countParallelRouteOverlaps' | 'measureLabelConflicts'>,
): PositionedGraph {
  const { countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps, measureLabelConflicts } = bindings
  const points = (placed: PositionedGraph) => placed.edges.reduce((sum, edge) => sum + edge.points.length, 0)
  if (graph.subgraphs.length || graph.nodes.size > 20 || graph.edges.length > 64
    || graph.edges.reduce((sum, edge) => sum + (edge.length ?? 1), 0) > 128 || points(first) > 2048
    || countEdgeCrossings(first.edges) === 0) return first
  certifyOwnedLayoutCandidate(graph, style, { strategy: 'agentic-layered', produce: () => first }, bindings)
  const score = (placed: PositionedGraph) => [
    measureLabelConflicts(placed, style).total, countOpposingRouteOverlaps(placed.edges), countParallelRouteOverlaps(placed.edges),
    countEdgeCrossings(placed.edges), placed.edges.reduce((sum, edge) => sum + (edge.style === 'invisible' ? 0 : Math.max(0, edge.points.length - 2)), 0),
    placed.width * placed.height,
  ]
  let best = first, before = score(first)
  const candidates = typeof alternatives === 'function' ? [{ strategy: 'agentic-authored-order', produce: alternatives }] : alternatives
  for (const candidate of candidates.slice(0, 2)) {
    let other: PositionedGraph
    try {
      other = certifyOwnedLayoutCandidate(graph, style, candidate, bindings)
    } catch (error) {
      if (!(error instanceof GraphLayoutUnsupportedError) && !(error instanceof LayoutCertificationError)) throw error
      continue
    }
    if (points(other) > 2048) continue
    const after = score(other)
    for (let index = 0; index < before.length; index++) {
      if (after[index]! < before[index]!) { best = other; before = after; break }
      if (after[index]! > before[index]!) break
    }
    if (before[3] === 0) break
  }
  return best
}

/** Owned producers may decline geometry, but cannot disguise meaning changes
 * or unexpected checker/producer exceptions as an ordinary fallback. */
export function certifyOwnedLayoutCandidate(graph: MermaidGraph, style: ResolvedRenderStyle, candidate: LayoutCertificationCandidate, bindings: Pick<AgenticGraphBindings, 'certifyCandidate' | 'retainSelection'>): PositionedGraph {
  const result = bindings.certifyCandidate(graph, style, candidate, true)
  if (!result.certified) throw new LayoutCertificationError([result.attempt])
  return bindings.retainSelection(graph, {
    selected: result.certified, reason: 'first-certified', attempts: 1,
    compared: [{ strategy: result.certified.strategy, score: result.certified.score }],
  })
}

export function layoutNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout, bindings: AgenticGraphBindings,
): PositionedGraph {
  const candidate = selectNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
  const first = certifyOwnedLayoutCandidate(graph, style, { strategy: 'agentic-layered', produce: () => candidate }, bindings)
  const optimization = layoutOptimization()
  if (options.graphLayout?.quality !== 'balanced' || !optimization?.layoutOptimizationEnabled('ports') || !optimization.canExploreLayout()
    || graph.nodes.size > 64 || graph.edges.length > 128 || graph.subgraphs.length || first.certification!.preference.selectedScore.totalBends === 0) return first
  let other: PositionedGraph | undefined
  try {
    other = optimization.optionalLayout(() => certifyOwnedLayoutCandidate(graph, style, { strategy: 'port-aware-placement',
      produce: () => placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings, false, 'ports'),
    }, bindings))
  } catch (error) {
    if (!(error instanceof GraphLayoutUnsupportedError) && !(error instanceof LayoutCertificationError)) throw error
    return first
  }
  if (!other || !optimization.nonRegressingAlternative(first, other)) return first
  optimization.selectedLayoutOptimization('port-aware-placement')
  return other
}

/** Internal family placement: all authored edges still constrain ranks/order.
 * Do not route this unfinished artifact through generic graph certification. */
export function layoutNativeGraphPlacement(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout, bindings: AgenticGraphBindings,
): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  const placed = placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings, true)
  return { width: placed.width, height: placed.height, nodes: placed.nodes, groups: placed.groups }
}
