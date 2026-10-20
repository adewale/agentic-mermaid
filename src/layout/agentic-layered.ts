import { layoutLayeredGraph, type AgenticLayout, type MeasuredGraph } from './agentic-layered-core.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError } from './backend.ts'

export type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'

function declineAgenticGraph(reason: string): never {
  throw new GraphLayoutUnsupportedError(reason)
}

export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  return layoutLayeredGraph(input, layoutMeasuredForest, declineAgenticGraph)
}
