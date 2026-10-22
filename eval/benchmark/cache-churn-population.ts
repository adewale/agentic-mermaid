import type { BenchInput } from './release-bench-types.ts'

/** Exact historical96 generator; larger sizes are separately labelled probes. */
export function cacheChurnPopulation(count: number): BenchInput[] {
  if (![96, 129, 256].includes(count)) throw new Error('Cache churn population must be 96,129 or256')
  return Array.from({ length: count }, (_, index) => ({ id: `cache-churn:${index}`, family: 'flowchart',
    source: `flowchart TD\nA["Gateway ${'x'.repeat(index + 12)}"] -->|requests| B[Store]\nB --> C[Log]\nA --> D[Cache]`,
    expectedSvgLabels: ['Store', 'Log', 'Cache', 'requests'] }))
}
