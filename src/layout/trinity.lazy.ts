import type { trinityMeasuredAdapter as adapter } from './trinity.ts'
import { DeferredDependencyError } from './certification-error.ts'

let implementation: typeof adapter | undefined
let pending: Promise<void> | undefined

export function loadTrinityKernel(): Promise<void> {
  return pending ??= import('./trinity.ts').then(module => { implementation = module.trinityMeasuredAdapter })
    .catch((error: unknown) => { pending = undefined; throw error })
}

/** Build-only facade; source and Node entries remain synchronous. */
export const trinityMeasuredAdapter: typeof adapter = work => ({ solve(request) {
  if (!implementation) throw new DeferredDependencyError('Trinity layout', loadTrinityKernel)
  return implementation(work).solve(request)
} })
