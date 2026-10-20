import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError, DeferredDependencyError } from './backend.ts'

let implementation: typeof import('./agentic-producer-core.ts') | undefined
let pending: Promise<void> | undefined

async function load(): Promise<void> {
  await (pending ??= import('./agentic-producer-core.ts').then(module => {
    implementation = module
  }).catch((error: unknown) => { pending = undefined; throw error }))
}

/** Build-only twin: selecting ELK should not download the native solver. */
export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  if (!implementation) throw new DeferredDependencyError('Agentic layout', load)
  return implementation.layoutLayeredGraph(input, layoutMeasuredForest, reason => { throw new GraphLayoutUnsupportedError(reason) })
}

export const layoutAgenticCandidate: typeof import('./agentic-layered.ts').layoutAgenticCandidate = (graph, options, style, bindings) => {
  if (!implementation) throw new DeferredDependencyError('Agentic layout', load)
  return implementation.layoutNativeGraphCandidate(graph, options, style, layoutAgenticGraph, bindings)
}
