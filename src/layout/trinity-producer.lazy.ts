import type { layoutTrinityCandidate as producer, layoutTrinityPlacement as placement } from './trinity-producer.ts'
import { loadTrinityKernel } from './trinity.lazy.ts'
import { DeferredDependencyError } from './certification-error.ts'

let implementation: typeof producer | undefined
let placementImplementation: typeof placement | undefined
let pending: Promise<void> | undefined

function load(): Promise<void> {
  return pending ??= Promise.all([import('./trinity-producer.ts'), loadTrinityKernel()]).then(([module]) => { implementation = module.layoutTrinityCandidate; placementImplementation = module.layoutTrinityPlacement })
    .catch((error: unknown) => { pending = undefined; throw error })
}

export const layoutTrinityCandidate: typeof producer = (...args) => {
  if (!implementation) throw new DeferredDependencyError('Trinity graph', load)
  return implementation(...args)
}

export const layoutTrinityPlacement: typeof placement = (...args) => {
  if (!placementImplementation) throw new DeferredDependencyError('Trinity graph', load)
  return placementImplementation(...args)
}
