// Agentic's benchmark entry points run inside Trident's source workspace, where
// eval/benchmark is Trident. There, Trident's own policy refuses CI runs and
// requires the pinned Mermaid oracle; anywhere else the entry point refuses.

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export function assertTridentBenchmarkAllowed(suite: string): void {
  const policy = fileURLToPath(new URL('../benchmark/ci-policy.ts', import.meta.url))
  if (!existsSync(policy)) throw new Error(`Run this benchmark through Trident: bun run bench --suites ${suite}`)
  const { assertBenchmarkExecutionAllowed } = createRequire(import.meta.url)(policy) as { assertBenchmarkExecutionAllowed(): void }
  assertBenchmarkExecutionAllowed()
}
