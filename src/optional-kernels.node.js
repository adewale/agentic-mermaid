// Shipped verbatim: unbundled Node uses createRequire; a consumer's bundler
// sees literal require edges and includes the kernels in portable bundles.
import { createRequire } from 'node:module'
export function interMetricsKernel() {
  return typeof require === 'function' ? require('./inter-metrics-kernel.cjs') : createRequire(import.meta.url)('./inter-metrics-kernel.cjs')
}
export function layoutOptimizationKernel() {
  return typeof require === 'function' ? require('./layout-optimization.cjs') : createRequire(import.meta.url)('./layout-optimization.cjs')
}
