import type { MermaidGraph, RenderOptions, PositionedGraph } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { applyFlowchartLabelWrapping } from '../flowchart-config.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { LayoutCertificationError, GraphLayoutUnsupportedError, emitGraphLayoutDecision, withGraphLayoutDecisionObserver } from './backend.ts'
import { withinLayoutPreferenceBudget } from './route-geometry.ts'
import { layoutOptimization } from './optimization-context.ts'

export function layoutFlowchartViewport(graph: MermaidGraph, options: RenderOptions, styleFace?: Readonly<InternalStyleFace>, diagramTitle?: string): PositionedGraph {
  const place = (source: MermaidGraph, selected: RenderOptions) => layoutGraphSync(source, {
    ...selected, ...(styleFace ? { styleFace } : {}), ...(diagramTitle ? { diagramTitle } : {}),
  })
  const optimization = layoutOptimization()
  if (!options.graphLayout?.viewport || !optimization?.layoutOptimizationEnabled('wrap') || options.wrappingWidth !== undefined || !withinLayoutPreferenceBudget(graph)) return place(graph, options)
  return optimization.searchFlowchartViewport(graph, options, {
    place: (source, selected, decisions) => withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => place(source, selected)),
    wrap: (source, selected) => applyFlowchartLabelWrapping(source, selected, styleFace),
    recoverable: error => error instanceof LayoutCertificationError || error instanceof GraphLayoutUnsupportedError,
    emit: emitGraphLayoutDecision,
  })
}
