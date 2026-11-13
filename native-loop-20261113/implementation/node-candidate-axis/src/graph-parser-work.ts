import type { MermaidGraph } from './types.ts'
import { assertDiagramWorkLimit } from './shared/diagram-limits.ts'

const graphContainerCounts = new WeakMap<MermaidGraph, number>()
export function assertGraphNodeInsertion(graph: MermaidGraph): void {
  assertDiagramWorkLimit('nodes', graph.nodes.size + (graphContainerCounts.get(graph) ?? 0) + 1)
}

export function retainGraphContainerCount(graph: MermaidGraph, count: number): void { graphContainerCounts.set(graph, count) }

