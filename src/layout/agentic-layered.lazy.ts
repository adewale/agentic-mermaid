import type { AgenticLayout, MeasuredGraph } from './agentic-layered.ts'
import { layoutMeasuredForest } from './measured-forest.ts'
import { GraphLayoutUnsupportedError, DeferredDependencyError } from './backend.ts'

let implementation: typeof import('./agentic-layered-core.ts').layoutLayeredGraph | undefined
let pending: Promise<void> | undefined

async function load(): Promise<void> {
  await (pending ??= import('./agentic-layered-core.ts').then(module => {
    implementation = module.layoutLayeredGraph
  }).catch((error: unknown) => { pending = undefined; throw error }))
}

/** Build-only twin: selecting ELK should not download the native solver. */
export function layoutAgenticGraph(input: MeasuredGraph): AgenticLayout {
  if (!implementation) throw new DeferredDependencyError('Agentic layout', load)
  return implementation(input, layoutMeasuredForest, reason => { throw new GraphLayoutUnsupportedError(reason) })
}
