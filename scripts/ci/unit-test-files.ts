import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const patterns = [
  'src/__tests__/**/*.test.ts',
  'eval/family-usage/count.test.ts',
  'eval/endpoint-marker/architecture-metrics.test.ts',
]

/** Canonical collection, shared by the unit runner and order diagnostics. */
export function unitTestFiles(): string[] {
  return [...new Set(patterns.flatMap(pattern => [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })]))].sort()
}
