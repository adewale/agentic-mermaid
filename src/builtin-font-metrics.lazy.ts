import { measureMonospaceTextWidth, measureTextWidth } from './text-metrics.ts'
import { registerInterMetrics } from './inter-metrics-host.ts'
import type { TextMeasurementProfile } from './text-measurement-profile.ts'
import { DeferredDependencyError } from './layout/certification-error.ts'
let profile: TextMeasurementProfile | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('./inter-metrics-kernel.ts').then(module => { profile = registerInterMetrics(module.createInterMetrics({ monospace: measureMonospaceTextWidth, estimate: measureTextWidth }), module.coversInterMetrics) }).catch(error => { pending = undefined; throw error })
}
export function bundledInterMetrics(): TextMeasurementProfile {
  if (!profile) throw new DeferredDependencyError('Bundled Inter metrics', load)
  return profile
}
