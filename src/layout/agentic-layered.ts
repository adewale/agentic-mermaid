import { createMeasuredLayoutCache, layoutLayeredGraph, layoutNativeGraphCandidate, layoutNativeGraphPlacement } from './agentic-producer-core.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError } from './backend.ts'
import type { MermaidGraph, PositionedGraph } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphOptions, AgenticGraphBindings } from '../layout-engine.ts'

export type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
export { improveArchitectureSiblingSlots } from './architecture-sibling-slots.ts'

function declineAgenticGraph(reason: string): never {
  throw new GraphLayoutUnsupportedError(reason)
}

export const layoutAgenticGraph = createMeasuredLayoutCache((input: MeasuredGraph): AgenticLayout =>
  layoutLayeredGraph(input, layoutMeasuredForest, declineAgenticGraph))

export function layoutAgenticCandidate(graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle, bindings: AgenticGraphBindings): PositionedGraph {
  return layoutNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
}

export function layoutAgenticPlacement(graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle, bindings: AgenticGraphBindings): Pick<PositionedGraph, 'width' | 'height' | 'nodes' | 'groups'> {
  return layoutNativeGraphPlacement(graph, options, style, layoutAgenticGraph, bindings)
}
