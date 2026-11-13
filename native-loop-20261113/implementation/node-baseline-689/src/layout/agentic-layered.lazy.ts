import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'
import { loadForest, readyForest } from './forest-loader.lazy.ts'
import { GraphLayoutUnsupportedError, DeferredDependencyError } from './backend.ts'

let implementation: {
  candidate: typeof import('./agentic-producer-core.ts').layoutNativeGraphCandidate
  placement: typeof import('./agentic-producer-core.ts').layoutNativeGraphPlacement
  architectureSlots: typeof import('./agentic-producer-core.ts').improveArchitectureSiblingSlots
  graph: (input: MeasuredGraph) => AgenticLayout
} | undefined
let pending: Promise<void> | undefined

async function load(): Promise<void> {
  await (pending ??= Promise.all([import('./agentic-producer-core.ts'), loadForest()]).then(([module]) => {
    const forest = readyForest()
    implementation = {
      candidate: module.layoutNativeGraphCandidate,
      placement: module.layoutNativeGraphPlacement,
      architectureSlots: module.improveArchitectureSiblingSlots,
      graph: module.createMeasuredLayoutCache(input => module.layoutLayeredGraph(input, forest.layoutMeasuredForest, reason => { throw new GraphLayoutUnsupportedError(reason) })),
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

export const layoutAgenticPlacement: typeof import('./agentic-layered.ts').layoutAgenticPlacement = (graph, options, style, bindings) => ready().placement(graph, options, style, layoutAgenticGraph, bindings)

export const improveArchitectureSiblingSlots: typeof import('./architecture-sibling-slots.ts').improveArchitectureSiblingSlots = (...args) => ready().architectureSlots(...args)
