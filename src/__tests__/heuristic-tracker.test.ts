// Promote the heuristic-tracker from a manual script to a per-PR gate.
//
// eval/heuristic-tracker scores every tracked layout example. This test gates
// the PORTABLE part — HARD rubric violations must stay 0 (structural routing
// correctness: no edge-through-node, no floating endpoint, etc.) and the tracker
// must score every example without error.
//
// The SOFT-metric baseline comparison (bends/crossings/straight counts) is NOT
// gated here: those exact integers depend on floating-point ELK geometry that is
// not byte-identical across runtimes/machines, so a committed baseline captured
// on one host flags spurious "regressions" on another (it did, on this PR's
// first CI run). It remains a LOCAL tool: `bun run eval/heuristic-tracker/run.ts`
// shows soft-metric deltas vs baseline for human review when tuning routing.

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

  test('baseline covers the tracked examples (it is not empty/stale)', () => {
    const baselineKeys = Object.keys(baseline).length
    expect(baselineKeys).toBeGreaterThan(0)
    expect(baselineKeys).toBe(Object.keys(current).length)
  })
})
