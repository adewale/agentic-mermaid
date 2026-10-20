import type { Direction, MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { layoutLayeredGraph as layoutRawGraph } from './agentic-layered-core.ts'
import { shortenMeasuredRoutes } from './shorten-measured-routes.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'

/** Reuse measured geometry across source edits without retaining authored text,
 * prepared-text evidence or receipts. Every caller owns its returned arrays. */
export function createMeasuredLayoutCache(compute: (input: MeasuredGraph) => AgenticLayout): (input: MeasuredGraph) => AgenticLayout {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_ELK_CACHE?: unknown }
  // The legacy switch controls both engines, including cache-off comparisons.
  const enabled = (host.process?.env?.AGENTIC_MERMAID_ELK_CACHE ?? host.AGENTIC_MERMAID_ELK_CACHE) !== '0'
  const results = new WeightedLru<string, AgenticLayout>(64, 8 * 1024 * 1024)
  return input => {
    if (!enabled) return compute(input)
    const key = JSON.stringify(input, (_key, value: unknown) => {
      if (value === undefined) return '\u0000undefined'
      if (typeof value === 'number' && !Number.isFinite(value)) return `\u0000${value}`
      if (typeof value === 'string' && value.startsWith('\u0000')) return `\u0000${value}`
      return value
    })
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
  return shortenMeasuredRoutes(input, layoutRawGraph(input, forest, unsupported))
}

/** Native-only preparation and projection are fetched with the selected solver.
 * Shared sizing and final certification remain owned by the graph pipeline. */
function placeNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout,
  bindings: AgenticGraphBindings,
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
      if (!source.nodeIds.length && !source.children.length) bindings.unsupported('empty compound frames')
      const index = groups.length, direction = source.direction ?? inherited
      const block = graphTextBlock(resolveLabelContent(source.label, source.labelContent), style, 'group')
      const header = source.concurrencyRegion ? 0 : style.groupHeaderFontSize + 16 + block.height - block.lineHeight
      const divider = source.concurrencyRegion ? (options.stateVisual?.dividerMargin ?? 0) : 0
      groupIndices.set(source.id, index); groupSources.push(source)
      groups.push({ id: source.id, parent, direction, minWidth: groupTitleWidth(source, style), padding: {
        top: header + style.groupPaddingY + divider, bottom: style.groupPaddingY + divider,
        left: style.groupPaddingX + divider, right: style.groupPaddingX + divider,
      } })
      for (const id of source.nodeIds) membership.set(id, { parent: index, direction })
      source.children.forEach(child => visit(child, index, direction))
    }
    graph.subgraphs.forEach(group => visit(group, undefined, graph.direction))
    const nodes = [...graph.nodes].map(([id, node]) => {
      if (groupIndices.has(id)) bindings.unsupported('overlapping node and frame identities')
      const owner = membership.get(id)
      return { id, ...(owner ? { parent: owner.parent } : {}), ...estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, owner?.direction ?? graph.direction, options.stateVisual, node.labelBlock) }
    })
    const indices = new Map(nodes.map((node, index) => [node.id, index]))
    for (const [id, index] of groupIndices) indices.set(id, nodes.length + index)
    const edges = graph.edges.map(edge => {
      const source = indices.get(edge.source), target = indices.get(edge.target)
      if (source === undefined || target === undefined) bindings.unsupported('unknown endpoint')
      const block = edge.label ? graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') : undefined
      return { source, target, minSpan: edge.length ?? 1, ...(edge.style === 'invisible' ? { visible: false } : {}), ...(block ? { label: { width: block.width + 2 * LABEL_PILL_PADDING, height: block.height + 2 * LABEL_PILL_PADDING } } : {}) }
    })
    const shareCompleteFans = !options.stateVisual && !groups.length && [...graph.nodes.values()].every(node => node.shape === 'rectangle' && !node.semanticShape)
      && graph.edges.every((edge, index) => {
        if (edge.label || edge.style !== 'solid' || edge.hasArrowStart || !edge.hasArrowEnd || (edge.endMarker && edge.endMarker !== 'arrow')) return false
        const inline = resolveEdgeInlineStyle(index, graph)
        return !inline || Object.keys(inline).length === 0
      })
    return { nodes, groups, edges, shareCompleteFans, direction: graph.direction, padding: opts.padding, nodeSpacing: opts.nodeSpacing, layerSpacing: opts.layerSpacing, edgeSpacing: Math.max(6, style.lineWidth + 4) }
  })
  const geometry = measureRenderStage('agentic', () => layoutAgenticGraph(measured))
  // Missing subjects or non-finite geometry are engine defects, not an
  // eligibility refusal that can be concealed by running another producer.
  if (geometry.nodes.length !== measured.nodes.length || (geometry.groups?.length ?? 0) !== measured.groups.length || geometry.edges.length !== graph.edges.length || containsNonFiniteNumber(geometry)
    || geometry.sharedEdges?.some(index => !Number.isInteger(index) || index < 0 || index >= graph.edges.length)
    || geometry.edges.some((edge, index) => edge.points.length < 2 || (measured.edges[index]!.label && !edge.labelPosition))) {
    throw new TypeError('Agentic graph producer returned malformed geometry')
  }
  const nodes = measured.nodes.map((node, index): PositionedNode => {
    const authored = graph.nodes.get(node.id)!
    const assigned = graph.classAssignments.get(node.id)
    return { ...authored, id: node.id, width: node.width, height: node.height, ...geometry.nodes[index]!, inlineStyle: resolveNodeInlineStyle(node.id, graph), classNames: assigned?.split(/\s+/).filter(Boolean) }
  })
  const edges = graph.edges.map((edge, index): PositionedEdge => ({
    ...edge, ...geometry.edges[index]!, edgeIndex: index, inlineStyle: resolveEdgeInlineStyle(index, graph),
    ...(edge.id && graph.classAssignments.has(edge.id) ? { classNames: graph.classAssignments.get(edge.id)!.split(/\s+/).filter(Boolean) } : {}),
  }))
  const frames = groupSources.map((source, index): PositionedGroup => ({
    id: source.id, label: source.label, ...(source.labelContent ? { labelContent: source.labelContent } : {}),
    ...geometry.groups![index]!, children: [], ...(source.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
    ...(source.stateComposite ? { inlineStyle: resolveClassInlineStyle(source.id, graph) } : {}),
  }))
  const groups: PositionedGroup[] = []
  frames.forEach((frame, index) => {
    const parent = measured.groups[index]!.parent
    if (parent === undefined) groups.push(frame)
    else frames[parent]!.children.push(frame)
  })
  // Forest fans use shared trunks. Layered placement reserves private label
  // corridors; generic bundling can move foreign routes into those corridors.
  const positioned = finishGraphGeometry({ width: geometry.width, height: geometry.height, nodes, edges, groups }, graph, geometry.topology === 'forest', opts.padding, style, options.stateVisual?.noteMargin ?? 18, undefined, geometry.sharedEdges).positioned
  if (containsNonFiniteNumber(positioned)) throw new TypeError('Agentic graph pipeline returned non-finite geometry')
  return positioned
}

/** Compare bounded alternatives after shared cleanup, so early routing
 * scores cannot conceal final label conflicts or lost terminal clearance. */
export function layoutNativeGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  layoutAgenticGraph: (input: MeasuredGraph) => AgenticLayout, bindings: AgenticGraphBindings,
): PositionedGraph {
  const first = placeNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
  if (options.compareRoutePreferences === false || options.stateVisual || graph.subgraphs.length || graph.nodes.size > 20 || graph.edges.length > 64) return first
  const candidates = [{ strategy: 'agentic-authored-order',
    produce: () => placeNativeGraphCandidate(graph, options, style, input => layoutAgenticGraph({ ...input, authoredCycleOrder: true }), bindings) }]
  if (graph.edges.some(edge => !edge.label)) candidates.push({ strategy: 'agentic-compact-ranks',
    produce: () => placeNativeGraphCandidate(graph, options, style, input => layoutAgenticGraph({ ...input, compactPrivateRanks: true }), bindings) })
  return bindings.refineOwnedLayoutCandidate(graph, style, first, candidates)
}
