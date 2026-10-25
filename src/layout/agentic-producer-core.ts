import type { LayoutCertificationCandidate } from './certification.ts'
import { GraphLayoutUnsupportedError, LayoutCertificationError } from './backend.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { layoutLayeredGraph as layoutRawGraph } from './agentic-layered-core.ts'
import { shortenMeasuredRoutes } from './shorten-measured-routes.ts'
import { edgeSelectorIndices } from '../shared/edge-selectors.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
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

type NativeOrder = 'primary' | 'authored' | 'compact'
const orderChoices = new WeakMap<AgenticGraphBindings, NativeResults<NativeOrder>>()

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

export function layoutLayeredGraph(input: MeasuredGraph, forest: (input: MeasuredGraph) => AgenticLayout | undefined, unsupported: (reason: string) => never): AgenticLayout {
  const placed = layoutRawGraph(input, forest, unsupported)
  return input.placementOnly ? placed : shortenMeasuredRoutes(input, placed)
}

/** Native-only preparation and projection are fetched with the selected solver.
 * Shared sizing and final certification remain owned by the graph pipeline. */
function placeNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout,
  bindings: AgenticGraphBindings,
  placementOnly = false,
): PositionedGraph {
  const { DEFAULTS, LABEL_PILL_PADDING, measureRenderStage, graphTextBlock, resolveLabelContent, groupTitleWidth, estimateNodeSize, resolveNodeInlineStyle, resolveEdgeInlineStyle, resolveClassInlineStyle, containsNonFiniteNumber, finishGraphGeometry } = bindings
  if (options.preserveSubgraphChildOrder) bindings.unsupported('family-specific graph geometry')
  const opts = { ...DEFAULTS, ...options }
  const groupSources: MermaidSubgraph[] = []
  const measured = measureRenderStage('graph-preparation', () => {
    const groups: NonNullable<MeasuredGraph['groups']>[number][] = []
    const groupIndices = new Map<string, number>()
    const membership = new Map<string, { parent: number; direction: Direction }>()
    const visit = (source: MermaidSubgraph, parent: number | undefined, inherited: Direction): void => {
      const index = groups.length, direction = source.direction ?? inherited
      const block = graphTextBlock(resolveLabelContent(source.label, source.labelContent), style, 'group')
      const header = source.concurrencyRegion ? 0 : style.groupHeaderFontSize + 16 + block.height - block.lineHeight
      const divider = source.concurrencyRegion ? (options.stateVisual?.dividerMargin ?? 0) : 0
      groupIndices.set(source.id, index); groupSources.push(source)
      groups.push({ id: source.id, parent, direction, minWidth: groupTitleWidth(source, style), headerHeight: header, padding: {
        top: header + style.groupPaddingY + divider, bottom: style.groupPaddingY + divider,
        left: style.groupPaddingX + divider, right: style.groupPaddingX + divider,
      } })
      for (const id of source.nodeIds) membership.set(id, { parent: index, direction })
      source.children.forEach(child => visit(child, index, direction))
    }
    graph.subgraphs.forEach(group => visit(group, undefined, graph.direction))
    const nodes: MeasuredGraph['nodes'][number][] = [...graph.nodes].map(([id, node]) => {
      if (groupIndices.has(id)) bindings.unsupported('overlapping node and frame identities')
      const owner = membership.get(id)
      return { id, ...(owner ? { parent: owner.parent } : {}), ...(options.nodeSizes?.get(id) ?? estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, owner?.direction ?? graph.direction, options.stateVisual, node.labelBlock)) }
    })
    const indices = new Map(nodes.map((node, index) => [node.id, index]))
    for (const [id, index] of groupIndices) indices.set(id, nodes.length + index)
    const rankedParents = new Set<number>()
    for (const [id, partition] of Object.entries(options.layoutHints?.ranks ?? {})) {
      const index = indices.get(id)
      if (index === undefined || !graph.nodes.has(id)) throw new Error(`LAYOUT_HINT_INVALID: unknown node "${id}"`)
      if (!Number.isSafeInteger(partition) || partition < 0 || partition > 10000) throw new Error(`LAYOUT_HINT_INVALID: rank for "${id}" must be an integer in [0,10000]`)
      const node = nodes[index]!
      node.partition = partition
      rankedParents.add(node.parent ?? -1)
    }
    for (const node of nodes) if (rankedParents.has(node.parent ?? -1) && node.partition === undefined) node.partition = 0
    for (const group of groups) if (rankedParents.has(group.parent ?? -1)) group.partition = 0
    if (options.layoutHints?.adjacent?.length) {
      const siblings = new Map<number, number[]>()
      const subjects = [...nodes, ...groups]
      subjects.forEach((subject, index) => {
        const parent = subject.parent ?? -1, children = siblings.get(parent) ?? []
        children.push(index); siblings.set(parent, children)
      })
      const positions = new Map<number, number>()
      for (const children of siblings.values()) children.forEach((subject, position) => positions.set(subject, position))
      const grouped = new Set<number>(), blocks = new Map<number, Map<number, number[]>>()
      for (const ids of options.layoutHints.adjacent) {
        if (ids.length < 2) throw new Error('LAYOUT_HINT_INVALID: adjacent needs two or more nodes')
        const members = ids.map(id => {
          const index = indices.get(id)
          if (index === undefined || !graph.nodes.has(id)) throw new Error(`LAYOUT_HINT_INVALID: unknown node "${id}"`)
          return index
        })
        const parent = nodes[members[0]!]!.parent ?? -1
        if (members.some(index => (nodes[index]!.parent ?? -1) !== parent)) throw new Error('LAYOUT_HINT_INVALID: adjacent nodes need the same container')
        for (const index of members) {
          if (grouped.has(index)) throw new Error('LAYOUT_HINT_INVALID: a node cannot repeat in adjacency groups')
          grouped.add(index)
        }
        const local = blocks.get(parent) ?? new Map<number, number[]>()
        local.set(Math.min(...members.map(index => positions.get(index)!)), members)
        blocks.set(parent, local)
      }
      for (const [parent, local] of blocks) {
        let order = 0
        siblings.get(parent)!.forEach((index, position) => {
          const block = local.get(position)
          if (block) for (const member of block) subjects[member]!.modelOrder = order++
          else if (!grouped.has(index)) subjects[index]!.modelOrder = order++
        })
      }
    }
    let preferred: Set<number> | undefined
    if (options.layoutHints?.shortEdges?.length) {
      preferred = new Set<number>()
      const selectors = edgeSelectorIndices(graph.edges)
      for (const id of options.layoutHints.shortEdges) {
        const index = selectors.get(id)
        if (index === undefined) throw new Error(`LAYOUT_HINT_INVALID: unknown edge "${id}"`)
        preferred.add(index)
      }
    }
    const ancestorEnd = groups.length ? (source: number, target: number): 'start' | 'end' | undefined => {
      const encloses = (group: number, subject: number): boolean => {
        for (let parent = subject < nodes.length ? nodes[subject]!.parent : groups[subject - nodes.length]!.parent; parent !== undefined; parent = groups[parent]!.parent) {
          if (parent === group) return true
        }
        return false
      }
      if (source >= nodes.length && encloses(source - nodes.length, target)) return 'start'
      if (target >= nodes.length && encloses(target - nodes.length, source)) return 'end'
      return undefined
    } : undefined
    const edges = graph.edges.map((edge, index) => {
      const source = indices.get(edge.source), target = indices.get(edge.target)
      if (source === undefined || target === undefined) bindings.unsupported('unknown endpoint')
      const block = edge.label ? graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') : undefined
      const boundaryEnd = ancestorEnd?.(source, target)
      let boundaryMarker: { inset: number; height: number } | undefined
      if (boundaryEnd) {
        const points = boundaryEnd === 'start' ? [{ x: 0, y: 0 }, { x: 1, y: 0 }] : [{ x: 1, y: 0 }, { x: 0, y: 0 }]
        const markers = graphEdgeMarkerPaintRegions({ ...edge, points, inlineStyle: resolveEdgeInlineStyle(index, graph) }, style).filter(marker => marker.position === boundaryEnd)
        const marked = edge.style !== 'invisible' && (boundaryEnd === 'start' ? edge.hasArrowStart : edge.hasArrowEnd)
        if (marked && !markers.length || markers.some(marker => !marker.bounds || ![marker.bounds.x0, marker.bounds.x1, marker.bounds.y0, marker.bounds.y1].every(Number.isFinite) || marker.bounds.x0 > marker.bounds.x1 || marker.bounds.y0 > marker.bounds.y1)) bindings.unsupported('ancestor marker paint bounds')
        boundaryMarker = { inset: 0, height: 0 }
        for (const marker of markers) {
          boundaryMarker.inset = Math.max(boundaryMarker.inset, marker.bounds!.x1)
          boundaryMarker.height = Math.max(boundaryMarker.height, 2 * Math.max(Math.abs(marker.bounds!.y0), Math.abs(marker.bounds!.y1)))
        }
        if (![boundaryMarker.inset, boundaryMarker.height].every(Number.isFinite)) bindings.unsupported('ancestor marker paint bounds')
      }
      // Match renderEdgeLabel's actual opaque halo only for the newly reserved
      // ancestor corridor. Existing measured geometry keeps its prior sizes.
      const halo = boundaryEnd && block ? Math.max(4, style.lineWidth * (edge.style === 'thick' ? 2 : 1) * 2) : 0
      return { source, target, minSpan: edge.length ?? 1, ...(preferred?.has(index) ? { short: true as const } : {}), ...(boundaryMarker ? { boundaryMarker } : {}), ...(edge.style === 'invisible' ? { visible: false } : {}), ...(block ? { label: { width: block.width + 2 * LABEL_PILL_PADDING + 2 * halo, height: block.height + 2 * LABEL_PILL_PADDING + 2 * halo } } : {}) }
    })
    const shareCompleteFans = !options.stateVisual && !groups.length && [...graph.nodes.values()].every(node => node.shape === 'rectangle' && !node.semanticShape)
      && graph.edges.every((edge, index) => {
        if (edge.label || edge.style !== 'solid' || edge.hasArrowStart || !edge.hasArrowEnd || (edge.endMarker && edge.endMarker !== 'arrow')) return false
        const inline = resolveEdgeInlineStyle(index, graph)
        return !inline || Object.keys(inline).length === 0
      })
    return { nodes, groups, edges, shareCompleteFans, direction: graph.direction, padding: opts.padding, nodeSpacing: opts.nodeSpacing, layerSpacing: opts.layerSpacing, edgeSpacing: Math.max(6, style.lineWidth + 4), ...(placementOnly ? { placementOnly: true as const } : {}) }
  })
  const geometry = measureRenderStage('agentic', () => layoutAgenticGraph(measured))
  // Missing subjects or non-finite geometry are engine defects, not an
  // eligibility refusal that can be concealed by running another producer.
  if (geometry.nodes.length !== measured.nodes.length || (geometry.groups?.length ?? 0) !== measured.groups.length || geometry.edges.length !== graph.edges.length || containsNonFiniteNumber(geometry)
    || geometry.sharedEdges?.some(index => !Number.isInteger(index) || index < 0 || index >= graph.edges.length)
    || !placementOnly && geometry.edges.some((edge, index) => edge.points.length < 2 || (measured.edges[index]!.label && !edge.labelPosition))) {
    throw new TypeError('Agentic graph producer returned malformed geometry')
  }
  const nodes = measured.nodes.map((node, index): PositionedNode => {
    const authored = graph.nodes.get(node.id)!
    const assigned = graph.classAssignments.get(node.id)
    return { ...authored, id: node.id, width: node.width, height: node.height, ...geometry.nodes[index]!, inlineStyle: resolveNodeInlineStyle(node.id, graph), classNames: assigned?.split(/\s+/).filter(Boolean) }
  })
  const edges = placementOnly ? [] : graph.edges.map((edge, index): PositionedEdge => ({
    ...edge, ...geometry.edges[index]!, edgeIndex: index, inlineStyle: resolveEdgeInlineStyle(index, graph),
    ...(edge.id && graph.classAssignments.has(edge.id) ? { classNames: graph.classAssignments.get(edge.id)!.split(/\s+/).filter(Boolean) } : {}),
  }))
  const frames = groupSources.map((source, index): PositionedGroup => {
    const frame: PositionedGroup = {
      id: source.id, label: source.label, ...(source.labelContent ? { labelContent: source.labelContent } : {}),
      ...geometry.groups![index]!, children: [], ...(source.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
      ...(source.stateComposite ? { inlineStyle: resolveClassInlineStyle(source.id, graph) } : {}),
    }
    // Family rendering consumes the measured strip without generic cleanup.
    if (placementOnly) frame.headerHeight = measured.groups[index]!.headerHeight
    return frame
  })
  const groups: PositionedGroup[] = []
  frames.forEach((frame, index) => {
    const parent = measured.groups[index]!.parent
    if (parent === undefined) groups.push(frame)
    else frames[parent]!.children.push(frame)
  })
  // A family placement is deliberately unfinished graph geometry: it has no
  // reusable routes or graph certificate. Architecture owns the final routes,
  // labels, actual ring contacts and independent family/paint certification.
  if (placementOnly) return { width: geometry.width, height: geometry.height, nodes, edges: [], groups }
  // Forest fans use shared trunks. Layered placement reserves private label
  // corridors; generic bundling can move foreign routes into those corridors.
  const positioned = finishGraphGeometry({ width: geometry.width, height: geometry.height, nodes, edges, groups }, graph, geometry.topology === 'forest', opts.padding, style, options.stateVisual?.noteMargin ?? 18, undefined, geometry.sharedEdges).positioned
  if (containsNonFiniteNumber(positioned)) throw new TypeError('Agentic graph pipeline returned non-finite geometry')
  return positioned
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
        chosen === 'primary' ? layoutAgenticGraph : input => layoutAgenticGraph({ ...input, ...(chosen === 'authored' ? { authoredCycleOrder: true } : { compactPrivateRanks: true }) }), bindings)
    }
  }
  const first = placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
  if (!eligible) return first
  const candidates = [{ strategy: 'agentic-authored-order',
    produce: () => placeNativeGraphCandidate(graph, options, style, input => layoutAgenticGraph({ ...input, authoredCycleOrder: true }), bindings) }]
  if (graph.edges.some(edge => !edge.label)) candidates.push({ strategy: 'agentic-compact-ranks',
    produce: () => placeNativeGraphCandidate(graph, options, style, input => layoutAgenticGraph({ ...input, compactPrivateRanks: true }), bindings) })
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
  return certifyOwnedLayoutCandidate(graph, style, { strategy: 'agentic-layered', produce: () => candidate }, bindings)
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
