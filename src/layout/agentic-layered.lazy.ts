import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError, DeferredDependencyError } from './backend.ts'

let implementation: {
  candidate: typeof import('./agentic-producer-core.ts').layoutNativeGraphCandidate
  graph: (input: MeasuredGraph) => AgenticLayout
} | undefined
let pending: Promise<void> | undefined

async function load(): Promise<void> {
  await (pending ??= import('./agentic-producer-core.ts').then(module => {
    implementation = {
      candidate: module.layoutNativeGraphCandidate,
      graph: module.createMeasuredLayoutCache(input => module.layoutLayeredGraph(input, layoutMeasuredForest, reason => { throw new GraphLayoutUnsupportedError(reason) })),
    }
  }).catch((error: unknown) => { pending = undefined; throw error }))
}

/** Build-only twin: selecting ELK should not download the native solver. */
function ready(): NonNullable<typeof implementation> {
  if (!implementation) throw new DeferredDependencyError('Agentic layout', load)
  return implementation
}

export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  return ready().graph(input)
}

export const layoutAgenticCandidate: typeof import('./agentic-layered.ts').layoutAgenticCandidate = (graph, options, style, bindings) => {
  return ready().candidate(graph, options, style, layoutAgenticGraph, bindings)
}
