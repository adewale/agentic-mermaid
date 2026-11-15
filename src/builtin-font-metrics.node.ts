import { interMetricsKernel } from './optional-kernels.node.js'
import type { TextMeasurementProfile } from './text-measurement-profile.ts'
import { measureMonospaceTextWidth, measureTextWidth } from './text-metrics.ts'
import { registerInterMetrics } from './inter-metrics-host.ts'
let profile: TextMeasurementProfile | undefined
export function bundledInterMetrics(): TextMeasurementProfile {
  if (!profile) {
    const kernel = interMetricsKernel() as typeof import('./inter-metrics-kernel.ts')
    profile = registerInterMetrics(kernel.createInterMetrics({ monospace: measureMonospaceTextWidth, estimate: measureTextWidth }), kernel.coversInterMetrics)
  }
  return profile
}
