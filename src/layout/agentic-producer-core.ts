import { VISIBLE_SHAFT } from '../shared/edge-label-geometry.ts'
import { finalizeFlatMeasuredMarkers } from './compound-boundary-routes.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { LayoutCertificationCandidate } from './certification.ts'
import { GraphLayoutUnsupportedError, LayoutCertificationError } from './backend.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { MAX_EXPANDED_VERTICES, layoutLayeredGraph as layoutRawGraph } from './agentic-layered-core.ts'
import { shortenMeasuredRoutes } from './shorten-measured-routes.ts'
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
    const placed = layoutRawGraph(input, forest, unsupported, routingWork)
    const final = input.placementOnly ? placed : finalizeFlatMeasuredMarkers(input, placed, routingWork, MAX_EXPANDED_VERTICES, unsupported)
    return input.placementOnly ? final : shortenMeasuredRoutes(input, final)
  } finally {
    if (prepared && explicit && explicit !== prepared) {
      explicit.pairs = prepared.pairs; explicit.arcs = prepared.arcs; explicit.swaps = prepared.swaps
    }
  }
}

/** Native-only preparation and projection are fetched with the selected solver.
 * Shared sizing and final certification remain owned by the graph pipeline. */
function placeNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout,
  bindings: AgenticGraphBindings,
  placementOnly = false,
  order: NativeOrder = 'primary',
): PositionedGraph {
  const { edgeSelectorIndices, graphEdgeMarkerPaintRegions, DEFAULTS, LABEL_PILL_PADDING, measureRenderStage, graphTextBlock, resolveLabelContent, groupTitleWidth, groupHeaderHeight, estimateNodeSize, resolveNodeInlineStyle, resolveEdgeInlineStyle, resolveClassInlineStyle, containsNonFiniteNumber, finishGraphGeometry } = bindings
  if (options.preserveSubgraphChildOrder) bindings.unsupported('family-specific graph geometry')
  const opts = { ...DEFAULTS, ...options }
  const groupSources: MermaidSubgraph[] = []
  const routingWork: ChannelWork = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
  routingWork.arcs -= 2 // ledger record and its private preparation closure
  const pay = (pairs: number, slots = 0): void => {
    routingWork.pairs -= pairs; routingWork.arcs -= slots
    if (routingWork.pairs < 0 || routingWork.arcs < 0) bindings.unsupported('agentic marker preparation work limit')
  }
  const measured = measureRenderStage('graph-preparation', () => {
    const groups: NonNullable<MeasuredGraph['groups']>[number][] = []
    const groupIndices = new Map<string, number>()
    const membership = new Map<string, { parent: number; direction: Direction }>()
    const visit = (source: MermaidSubgraph, parent: number | undefined, inherited: Direction): void => {
      const index = groups.length, direction = source.direction ?? inherited
      const header = groupHeaderHeight(source, style)
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
    let lead = 0, doubleDepth = 0, maximumStroke = 0
    pay(0, 3 * nodes.length + 5)
    const portSpans = new Float64Array(nodes.length), incoming = new Uint32Array(nodes.length), outgoing = new Uint32Array(nodes.length)
    type MarkerRoom = { start: number; end: number; span: number; boundaryInset: number; boundaryHeight: number; boundaryCount: number }
    const footprints = new Map<string, MarkerRoom>()
    const numericWidth = (value: string | number): number | undefined => {
      pay(4 + (typeof value === 'string' ? value.length : 0), 1)
      if (typeof value === 'string' && !/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(value)) return undefined
      const width = typeof value === 'number' ? value : Number.parseFloat(value)
      return Number.isFinite(width) && width > 0 ? width : undefined
    }
    const edges = graph.edges.map((edge, index) => {
      const source = indices.get(edge.source), target = indices.get(edge.target)
      if (source === undefined || target === undefined) bindings.unsupported('unknown endpoint')
      const block = edge.label ? graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') : undefined
      const boundaryEnd = ancestorEnd?.(source, target)
      let boundaryMarker: { inset: number; height: number } | undefined
      const inline = resolveEdgeInlineStyle(index, graph)
      const marked = !placementOnly && edge.style !== 'invisible' && (edge.hasArrowStart || edge.hasArrowEnd)
      const shaft = numericWidth(inline?.['stroke-width'] ?? style.lineWidth * (edge.style === 'thick' ? 2 : 1))
      if (edge.style !== 'invisible' && shaft !== undefined) maximumStroke = Math.max(maximumStroke, shaft)
      let footprint: MarkerRoom | undefined
      if ((marked || boundaryEnd) && shaft !== undefined) {
        // The existing ancestor projection is retained verbatim; ordinary
        // reservations use the same actual resource factory on a cardinal ray.
        pay(12, 15)
        const emptyStroke = (inline?.stroke ?? style.edgeStrokeColor) === 'none'
        const fixed = Boolean(inline?.['stroke-width'])
        // Paint-only colors cannot enlarge geometry. Reserve the opaque
        // builtin support for every tint; none retains its earlier support.
        const key = JSON.stringify([boundaryEnd ?? null, edge.style, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker, edge.endMarker, emptyStroke, fixed])
        footprint = footprints.get(key)
        if (!footprint) {
          // No tint set: at most12 builtin/fixed descriptors (resource pool
          // <400 field/reference slots), connector/region/JSON scratch <624.
          pay(emptyStroke ? 4096 : 2048, emptyStroke ? 2048 : 1024)
          const points = boundaryEnd === 'end' ? [{ x: 1, y: 0 }, { x: 0, y: 0 }] : [{ x: 0, y: 0 }, { x: 1, y: 0 }]
          const markers = graphEdgeMarkerPaintRegions({ ...edge, id: 'marker-room', source: '', target: '', points,
            inlineStyle: fixed ? { 'stroke-width': '1' } : undefined },
          { lineWidth: style.lineWidth, ...(emptyStroke ? { edgeStrokeColor: 'none' } : {}) })
          let start = 0, end = 0, span = 0, boundaryInset = 0, boundaryHeight = 0, boundaryCount = 0
          for (const marker of markers) {
            pay(18)
            const box = marker.bounds
            if (!box || !Number.isFinite(box.x0) || !Number.isFinite(box.x1) || !Number.isFinite(box.y0) || !Number.isFinite(box.y1) || box.x0 > box.x1 || box.y0 > box.y1) bindings.unsupported('agentic marker paint bounds')
            const depth = marker.position === 'start' ? (boundaryEnd === 'end' ? 1 - box.x0 : box.x1) : (boundaryEnd === 'end' ? box.x1 : 1 - box.x0)
            if (marker.position === 'start') start = Math.max(start, depth)
            else if (marker.position === 'end') end = Math.max(end, depth)
            span = Math.max(span, box.y1 - box.y0)
            if (marker.position === boundaryEnd) {
              boundaryCount++
              boundaryInset = Math.max(boundaryInset, box.x1)
              boundaryHeight = Math.max(boundaryHeight, 2 * Math.max(Math.abs(box.y0), Math.abs(box.y1)))
            }
          }
          pay(0, 7)
          footprint = { start, end, span, boundaryInset, boundaryHeight, boundaryCount }
          footprints.set(key, footprint)
        }
        const { start: startDepth, end: endDepth, span } = footprint
        if (marked) {
          lead = Math.max(lead, startDepth + VISIBLE_SHAFT + style.edgeBendRadius, endDepth + VISIBLE_SHAFT + style.edgeBendRadius, span)
          doubleDepth = Math.max(doubleDepth, startDepth + endDepth)
          if (edge.hasArrowStart && source < nodes.length) portSpans[source] = Math.max(portSpans[source]!, span)
          if (edge.hasArrowEnd && target < nodes.length) portSpans[target] = Math.max(portSpans[target]!, span)
        }
      }
      if (edge.style !== 'invisible') {
        pay(2)
        if (source < nodes.length) outgoing[source] = outgoing[source]! + 1
        if (target < nodes.length) incoming[target] = incoming[target]! + 1
      }
      if (boundaryEnd) {
        const boundaryMarked = edge.style !== 'invisible' && (boundaryEnd === 'start' ? edge.hasArrowStart : edge.hasArrowEnd)
        if (boundaryMarked && (!footprint || !footprint.boundaryCount)) bindings.unsupported('ancestor marker paint bounds')
        boundaryMarker = { inset: boundaryMarked ? footprint!.boundaryInset : 0, height: boundaryMarked ? footprint!.boundaryHeight : 0 }
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
    let border = Math.max(style.nodeLineWidth, style.groupLineWidth) / 2
    for (const [id] of graph.nodes) {
      const width = numericWidth(resolveNodeInlineStyle(id, graph)?.['stroke-width'] ?? style.nodeLineWidth)
      pay(3)
      if (width !== undefined) border = Math.max(border, width / 2)
    }
    for (const source of groupSources) if (source.stateComposite) {
      const width = numericWidth(resolveClassInlineStyle(source.id, graph)?.['stroke-width'] ?? style.groupLineWidth)
      if (width !== undefined) border = Math.max(border, width / 2)
    }
    const margin = border + maximumStroke / 2
    const edgeSpacing = Math.max(6, style.lineWidth + 4)
    const minimumTerminalLead = lead + margin > Math.max(12, edgeSpacing) ? lead + margin : undefined
    for (let index = 0; index < nodes.length; index++) {
      pay(6)
      const node = nodes[index]!, authored = graph.nodes.get(node.id)!, degree = Math.max(incoming[index]!, outgoing[index]!)
      const pitch = portSpans[index]! + maximumStroke
      if (degree < 2 || portSpans[index]! <= 8 || authored.shape !== 'rectangle' || authored.semanticShape || options.nodeSizes?.has(node.id)) continue
      const horizontal = (membership.get(node.id)?.direction ?? graph.direction) === 'LR' || (membership.get(node.id)?.direction ?? graph.direction) === 'RL'
      const size = (degree - 1) * pitch, minimum = size <= 32 ? size * 1.5 : size + 16
      if (!Number.isFinite(minimum)) bindings.unsupported('agentic marker spacing range')
      if (horizontal) node.height = Math.max(node.height, minimum)
      else node.width = Math.max(node.width, minimum)
      node.minimumPortSpacing = pitch
    }
    if (!Number.isFinite(doubleDepth + margin) || !Number.isFinite(minimumTerminalLead ?? 0) || !Number.isFinite(2 * (doubleDepth + margin))) bindings.unsupported('agentic marker spacing range')
    return { nodes, groups, edges, shareCompleteFans, direction: graph.direction, padding: opts.padding, nodeSpacing: opts.nodeSpacing,
      layerSpacing: Math.max(opts.layerSpacing, 2 * (doubleDepth + margin)), edgeSpacing,
      ...(minimumTerminalLead !== undefined ? { minimumTerminalLead } : {}),
      ...(order === 'authored' ? { authoredCycleOrder: true as const } : order === 'compact' ? { compactPrivateRanks: true } : {}),
      ...(placementOnly ? { placementOnly: true as const } : {}) }

  })
  pay(0, 2)
  preparedGraphWork.set(measured, routingWork)
  let geometry: AgenticLayout
  try { geometry = measureRenderStage('agentic', () => layoutAgenticGraph(measured)) }
  finally { preparedGraphWork.delete(measured) }
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
      ...(source.headerMinHeight === undefined ? {} : { headerMinHeight: source.headerMinHeight }),
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
