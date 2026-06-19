// Move B + 3: baseline-freshness as a registry.
//
// Committed baselines silently rot when their generator changes but nobody
// re-runs the updater (testing-tools learning #3: the heuristic-tracker
// baseline drifted to 51 entries while the catalog generated 70, unnoticed
// because the tracker was manual-only). Rather than a hand-written test per
// baseline, every committed baseline registers ONE descriptor here: its name,
// how to regenerate it, and a freshness predicate comparing the committed file
// to what its generator produces TODAY. A new baseline is covered the moment it
// is added to BASELINE_REGISTRY — and CI fails if any drifts.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'
import { DEFAULT_CASES } from '../../eval/agent-usage/run.ts'

const ROOT = join(import.meta.dir, '..', '..')
const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

interface FreshnessCheck {
  /** What a passing check proves; becomes the assertion subject. */
  expected: unknown
  /** The same shape computed from the committed baseline. */
  actual: unknown
}

interface BaselineDescriptor {
  name: string
  /** Human note: the exact command that regenerates this baseline. */
  updater: string
  check: () => FreshnessCheck
}

export const BASELINE_REGISTRY: BaselineDescriptor[] = [
  {
    name: 'heuristic-tracker/baseline.json',
    updater: 'bun run eval/heuristic-tracker/run.ts --update',
    check: () => {
      const baseline = readJson('eval/heuristic-tracker/baseline.json')
      const expectedKeys = trackedExamples().map(e => `${e.group}/${e.name}`).sort()
      return { expected: expectedKeys, actual: Object.keys(baseline).sort() }
    },
  },
  {
    name: 'agent-usage/baseline.json',
    updater: 'edit eval/agent-usage/baseline.json `total` to match DEFAULT_CASES',
    check: () => {
      const baseline = readJson('eval/agent-usage/baseline.json')
      return { expected: DEFAULT_CASES.length, actual: baseline.total }
    },
  },
  {
    name: 'mermaid-upstream-suite-bench/ratchet.json (observed)',
    updater: 'MERMAID_UPSTREAM_DIR=… bun run harvest:upstream',
    check: () => {
      const ratchet = readJson('eval/mermaid-upstream-suite-bench/ratchet.json')
      const cases = readJson('eval/mermaid-upstream-suite-bench/cases.json') as Array<{ upstream: { blocks: unknown[] } }>
      const expected = {
        importedCases: cases.length + 68,
        importedBlocks: cases.reduce((s, c) => s + c.upstream.blocks.length, 0) + 68,
      }
      return { expected, actual: { importedCases: ratchet.observed.importedCases, importedBlocks: ratchet.observed.importedBlocks } }
    },
  },
  {
    name: 'mermaid-upstream-suite-bench/manifest.json (family rows)',
    updater: 'MERMAID_UPSTREAM_DIR=… bun run harvest:upstream',
    check: () => {
      const manifest = readJson('eval/mermaid-upstream-suite-bench/manifest.json')
      const cases = readJson('eval/mermaid-upstream-suite-bench/cases.json') as Array<{ family: string }>
      const byFamily = new Map<string, number>()
      for (const c of cases) byFamily.set(c.family, (byFamily.get(c.family) ?? 0) + 1)
      // Gantt's executable detail lives in the dedicated gantt bench, so its
      // manifest row carries a summarized count; compare the others exactly.
      const rows = (manifest.families as Array<{ family: string; importedCases: number }>).filter(r => r.family !== 'gantt')
      const expected = rows.map(r => ({ family: r.family, n: byFamily.get(r.family) ?? 0 }))
      const actual = rows.map(r => ({ family: r.family, n: r.importedCases }))
      return { expected, actual }
    },
  },
]

describe('baseline freshness (registry)', () => {
  test('the registry is non-empty (the guard itself is wired in)', () => {
    expect(BASELINE_REGISTRY.length).toBeGreaterThan(0)
  })

  for (const b of BASELINE_REGISTRY) {
    test(`${b.name} matches its generator  (updater: ${b.updater})`, () => {
      const { expected, actual } = b.check()
      expect(actual).toEqual(expected)
    })
  }
})
