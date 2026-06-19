// Move 4: promote the heuristic-tracker from a manual script to a per-PR gate.
//
// eval/heuristic-tracker scores every tracked layout example against the
// committed baseline.json (HARD rubric violations, bends, crossings,
// off-cardinal endpoints, straight-edge count, fan-in symmetry). It already
// computed improvement/regression deltas — it just never ran in CI, so a
// routing regression on a tracked example only surfaced when someone ran the
// script by hand. This test makes it a ratchet:
//   1. HARD violations must stay 0 (non-negotiable, same as the CLI exit code).
//   2. No tracked example may regress on a soft metric without the author
//      updating baseline.json in the same change (so a regression is a
//      deliberate, reviewed line in the diff, not a silent drift).
//
// To intentionally move the baseline: `bun run eval/heuristic-tracker/run.ts --update`.

import { describe, test, expect } from 'bun:test'
import { scoreAll, loadBaseline, compareToBaseline } from '../../eval/heuristic-tracker/run.ts'

describe('heuristic-tracker ratchet', () => {
  const current = scoreAll()
  const baseline = loadBaseline()
  const report = compareToBaseline(current, baseline)

  test('the tracker scores every example without a layout/parse error', () => {
    expect(report.errors).toEqual([])
  })

  test('no HARD rubric violations on any tracked example', () => {
    expect({ totalHard: report.totalHard }).toEqual({ totalHard: 0 })
  })

  test('no soft-metric regression vs committed baseline', () => {
    // If this fails, either the change regressed routing on a tracked example,
    // or it is a deliberate trade-off that must be recorded by re-running
    // `eval/heuristic-tracker/run.ts --update` and committing baseline.json.
    expect(report.regressionDetails).toEqual([])
  })

  test('baseline covers the tracked examples (it is not empty/stale)', () => {
    const baselineKeys = Object.keys(baseline).length
    expect(baselineKeys).toBeGreaterThan(0)
    expect(baselineKeys).toBe(Object.keys(current).length)
  })
})
