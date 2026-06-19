// The heuristic-tracker baseline silently rotted once (drifted to 51 entries
// while the catalog generated 70, unnoticed because the tracker was manual-only).
// This gate compares the committed baseline's keyset to what the catalog
// produces today, so that drift fails CI. (The upstream ratchet/manifest are
// already checked by mermaid-upstream-suite-bench.test.ts; not duplicated here.)
//
// Regenerate with: bun run eval/heuristic-tracker/run.ts --update

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'

describe('baseline freshness', () => {
  test('heuristic-tracker/baseline.json keyset matches the current catalog', () => {
    const baseline = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'eval', 'heuristic-tracker', 'baseline.json'), 'utf8'))
    const expectedKeys = trackedExamples().map(e => `${e.group}/${e.name}`).sort()
    expect(Object.keys(baseline).sort()).toEqual(expectedKeys)
  })
})
