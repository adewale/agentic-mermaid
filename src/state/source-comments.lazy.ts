import { DeferredDependencyError } from '../layout/certification-error.ts'

// The lazy browser build's stand-in for ./source-comments.ts, with the same
// exports. The State family chunk carries the scanner: a State render loads
// that chunk before normalizing, so the first normalization's demand resolves
// without another request and the render replays.
type StateFamily = typeof import('../browser-lazy/families/state.ts')
let implementation: StateFamily | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('../browser-lazy/families/state.ts').then(module => { implementation = module }).catch(error => { pending = undefined; throw error })
}

export const scanStateComments: StateFamily['scanStateComments'] = lines => {
  if (!implementation) throw new DeferredDependencyError('State comments', load)
  return implementation.scanStateComments(lines)
}
