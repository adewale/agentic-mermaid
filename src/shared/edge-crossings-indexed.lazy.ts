import { DeferredDependencyError } from '../layout/certification-error.ts'

// The lazy browser build's stand-in for ./edge-crossings-indexed.ts. Counts
// below the indexed threshold never reach it, so graph families download the
// index as its own chunk only when a render first counts a dense route set;
// the async entry then replays the render with the same exact counter as Node.
type Indexed = typeof import('./edge-crossings-indexed.ts')
let implementation: Indexed | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('./edge-crossings-indexed.ts').then(module => { implementation = module }).catch(error => { pending = undefined; throw error })
}

export const countIndexedCrossings: Indexed['countIndexedCrossings'] = (...input) => {
  if (!implementation) throw new DeferredDependencyError('Indexed crossings', load)
  return implementation.countIndexedCrossings(...input)
}

export const prepareIndexedCrossings: Indexed['prepareIndexedCrossings'] = () => {
  if (!implementation) throw new DeferredDependencyError('Indexed crossings', load)
}
