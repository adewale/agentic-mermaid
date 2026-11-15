import { createInterMetrics, coversInterMetrics } from './inter-metrics-kernel.ts'
import { measureMonospaceTextWidth, measureTextWidth } from './text-metrics.ts'
import { registerInterMetrics } from './inter-metrics-host.ts'
export const BUNDLED_INTER_TEXT_MEASUREMENT = registerInterMetrics(createInterMetrics({ monospace: measureMonospaceTextWidth, estimate: measureTextWidth }), coversInterMetrics)
