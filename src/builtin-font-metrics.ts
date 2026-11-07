import { createInterMetrics, coversInterMetrics } from './inter-metrics-kernel.ts'
import { measureMonospaceTextWidth, measureTextWidth } from './text-metrics.ts'
import { registerInterMetrics } from './inter-metrics-host.ts'
import type { TextMeasurementProfile } from './text-measurement-profile.ts'
let profile: TextMeasurementProfile | undefined
export function bundledInterMetrics(): TextMeasurementProfile {
  return profile ??= registerInterMetrics(createInterMetrics({ monospace: measureMonospaceTextWidth, estimate: measureTextWidth }), coversInterMetrics)
}
