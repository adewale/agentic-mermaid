import type { BenchInput } from './release-bench-types.ts'

export const cacheChurnGenerator = (count: number) => count === 96 ? 'historical96@1' : 'monotonic-measured-width@1'

/** Historical96 is unchanged. Larger probes deliberately vary measured width. */
export function cacheChurnPopulation(count: number): BenchInput[] {
  if (![96, 129, 256].includes(count)) throw new Error('Cache churn population must be 96,129 or256')
  return Array.from({ length: count }, (_, index) => ({ id: `cache-churn:${index}`, family: 'flowchart',
    source: `flowchart TD\nA["${count === 96 ? `Gateway ${'x'.repeat(index + 12)}` : `Measured width ${'W'.repeat(64 + index * 2)}`}"] -->|requests| B[Store]\nB --> C[Log]\nA --> D[Cache]`,
    expectedSvgLabels: ['Store', 'Log', 'Cache', 'requests'] }))
}
