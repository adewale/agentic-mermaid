import { layoutLayeredGraph, layoutNativeGraphCandidate } from './agentic-producer-core.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError } from './backend.ts'
import type { MermaidGraph, PositionedGraph } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphOptions, AgenticGraphBindings } from '../layout-engine.ts'

export type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'

function declineAgenticGraph(reason: string): never {
  throw new GraphLayoutUnsupportedError(reason)
}

export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  return layoutLayeredGraph(input, layoutMeasuredForest, declineAgenticGraph)
}

export function layoutAgenticCandidate(graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle, bindings: AgenticGraphBindings): PositionedGraph {
  return layoutNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
}
