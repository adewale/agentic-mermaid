import type { TextMeasurementProfile } from './text-measurement-profile.ts'
import { DeferredDependencyError } from './layout/certification-error.ts'
let profile: TextMeasurementProfile | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('./inter-metrics.ts').then(module => { profile = module.BUNDLED_INTER_TEXT_MEASUREMENT }).catch(error => { pending = undefined; throw error })
}
export function bundledInterMetrics(): TextMeasurementProfile {
  if (!profile) throw new DeferredDependencyError('Bundled Inter metrics', load)
  return profile
}
