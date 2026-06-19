// Move B: baseline-freshness assertions.
//
// Committed baselines silently rot when their generator changes but nobody
// re-runs the updater (testing-tools learning #3: the heuristic-tracker
// baseline had drifted to 51 entries while the catalog generated 70, unnoticed
// because the tracker was manual-only). Every committed baseline here asserts
// its keyset/counts still match what its generator produces TODAY, so drift
// fails CI instead of sitting silently. The fix when one fails is always to
// re-run that baseline's documented updater and commit the result.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'
import { DEFAULT_CASES } from '../../eval/agent-usage/run.ts'

const ROOT = join(import.meta.dir, '..', '..')
const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

describe('baseline freshness', () => {
  test('heuristic-tracker baseline.json keyset matches the current catalog', () => {
    // Generator: eval/heuristic-tracker/catalog.ts → trackedExamples().
    // Updater:   bun run eval/heuristic-tracker/run.ts --update
    const baseline = readJson('eval/heuristic-tracker/baseline.json')
    const expectedKeys = new Set(trackedExamples().map(e => `${e.group}/${e.name}`))
    const baselineKeys = new Set(Object.keys(baseline))
    const missing = [...expectedKeys].filter(k => !baselineKeys.has(k))
    const stale = [...baselineKeys].filter(k => !expectedKeys.has(k))
    expect({ missing, stale }).toEqual({ missing: [], stale: [] })
  })

  test('agent-usage baseline.json total matches DEFAULT_CASES', () => {
    // Generator: eval/agent-usage/run.ts → DEFAULT_CASES.
    const baseline = readJson('eval/agent-usage/baseline.json')
    expect(baseline.total).toBe(DEFAULT_CASES.length)
    expect(baseline.minPassed).toBeLessThanOrEqual(baseline.total)
  })

  test('upstream-suite ratchet.json observed counts match the imported cases', () => {
    // Generator: eval/mermaid-upstream-suite-bench/harvest.ts → cases.json.
    // 68 is the Gantt bench's contribution, accounted separately (see test).
    const ratchet = readJson('eval/mermaid-upstream-suite-bench/ratchet.json')
    const cases = readJson('eval/mermaid-upstream-suite-bench/cases.json') as Array<{ upstream: { blocks: unknown[] } }>
    const importedCases = cases.length + 68
    const importedBlocks = cases.reduce((s, c) => s + c.upstream.blocks.length, 0) + 68
    expect(ratchet.observed.importedCases).toBe(importedCases)
    expect(ratchet.observed.importedBlocks).toBe(importedBlocks)
    // The committed floor may not exceed what we actually observe (a floor above
    // reality would be unmeetable; a stale floor below is caught by the bench).
    expect(ratchet.budgets.importedCaseFloor).toBeLessThanOrEqual(importedCases)
    expect(ratchet.budgets.importedBlockFloor).toBeLessThanOrEqual(importedBlocks)
  })

  test('upstream-suite manifest.json family rows match cases.json', () => {
    const manifest = readJson('eval/mermaid-upstream-suite-bench/manifest.json')
    const cases = readJson('eval/mermaid-upstream-suite-bench/cases.json') as Array<{ family: string }>
    const byFamily = new Map<string, number>()
    for (const c of cases) byFamily.set(c.family, (byFamily.get(c.family) ?? 0) + 1)
    for (const row of manifest.families as Array<{ family: string; importedCases: number }>) {
      // Gantt's executable detail lives in the dedicated gantt bench, so its
      // manifest row may carry a summarized count; assert the others exactly.
      if (row.family === 'gantt') continue
      expect({ family: row.family, n: row.importedCases }).toEqual({ family: row.family, n: byFamily.get(row.family) ?? 0 })
    }
  })
})
