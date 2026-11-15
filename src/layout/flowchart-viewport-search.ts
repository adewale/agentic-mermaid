import type { MermaidGraph, RenderOptions, PositionedGraph } from '../types.ts'
import type { GraphLayoutDecision } from './backend.ts'
import { nonRegressingAlternative } from './non-regressing-alternative.ts'
import { canExploreLayout, optionalLayout, selectedLayoutOptimization, layoutOptimizationSelections, restoreLayoutOptimizationSelections } from './optimization-budget.ts'

export interface ViewportSearchBindings {
  place(graph: MermaidGraph, options: RenderOptions, decisions: GraphLayoutDecision[]): PositionedGraph
  wrap(graph: MermaidGraph, options: RenderOptions): void
  recoverable(error: unknown): boolean
  emit(decision: GraphLayoutDecision): void
}
/** Pure optional search. Core geometry and diagnostics stay with their owners;
 * acquiring search never partitions their shared browser modules. */
export function searchFlowchartViewport(graph: MermaidGraph, options: RenderOptions, bindings: ViewportSearchBindings): PositionedGraph {
  const viewport = options.graphLayout!.viewport!
  const initialSelections = layoutOptimizationSelections()
  const produce = (source: MermaidGraph, selected: RenderOptions) => {
    const decisions: GraphLayoutDecision[] = []
    const checkpoint = layoutOptimizationSelections()
    try {
      const positioned = bindings.place(source, selected, decisions)
      return { positioned, decisions, selections: layoutOptimizationSelections().slice(checkpoint.length) }
    } finally { restoreLayoutOptimizationSelections(checkpoint) }
  }
  let best = produce(graph, options)
  const scale = (positioned: PositionedGraph) => Math.min(1, viewport.width / positioned.width, viewport.height / positioned.height)
  let bestScale = scale(best.positioned), chosenWidth: number | undefined
  const widest = best.positioned.nodes.reduce((width, node) => Math.max(width, node.labelBlock?.width ?? 0), 0)
  if (bestScale < 1 && widest > 60) {
    const firstWidth = Math.max(60, widest * Math.min(0.8, viewport.width / best.positioned.width))
    const widths = [...new Set([firstWidth, Math.max(60, firstWidth * 0.7)].map(width => Math.round(width)))]
    for (const width of widths) {
      if (!canExploreLayout() || bestScale >= 1) break
      if (!best.positioned.nodes.some(node => (node.labelBlock?.width ?? 0) > width && /\s/u.test(node.label))) continue
      // The only changed input is retained label preparation. Node identities,
      // authored text, edges and parent references retain the original values.
      const alternative: MermaidGraph = { ...graph, nodes: new Map([...graph.nodes].map(([id, node]) => [id, { ...node }])) }
      const wrapped = { ...options, wrappingWidth: width }
      bindings.wrap(alternative, wrapped)
      // A narrower reservation must not introduce discretionary word breaks.
      if ([...alternative.nodes].some(([id, node]) => (node.labelBlock?.breaks.filter(value => value.kind === 'hyphen').length ?? 0)
        > (graph.nodes.get(id)?.labelBlock?.breaks.filter(value => value.kind === 'hyphen').length ?? 0))) continue
      let candidate: ReturnType<typeof produce> | undefined
      try { candidate = optionalLayout(() => produce(alternative, wrapped)) } catch (error) {
        if (!bindings.recoverable(error)) throw error
        continue
      }
      if (!candidate) continue
      if (!nonRegressingAlternative(best.positioned, candidate.positioned)) continue
      const fit = scale(candidate.positioned)
      if (fit > bestScale + 1e-4) { best = candidate; bestScale = fit; chosenWidth = width }
    }
  }
  restoreLayoutOptimizationSelections([...initialSelections, ...best.selections])
  if (chosenWidth !== undefined) selectedLayoutOptimization(`viewport-wrap:${chosenWidth}px`)
  // Only the selected producer's backend decision becomes public evidence.
  // Work on rejected candidates is accounted by the separate shared ledger.
  best.decisions.forEach(bindings.emit)
  return best.positioned
}
