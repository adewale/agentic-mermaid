// Move G: keep docs/testing-strategy.md's proof-gate map honest against the
// actual workflow files. Testing-tools learning #2: the strategy doc claimed
// browser/screenshot e2e was NOT gated per-PR when the e2e job in ci.yml runs
// it on every PR. A doc that can drift from reality is worse than no doc. Each
// assertion below cross-checks a doc claim against ci.yml / the nightly
// workflow, so the two cannot disagree without failing CI.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const ci = read('.github/workflows/ci.yml')
const nightly = read('.github/workflows/nightly-route-mutation.yml')
const doc = read('docs/testing-strategy.md')

describe('proof-gate map ↔ workflow reality', () => {
  test('browser/screenshot e2e runs per-PR (doc + ci.yml agree)', () => {
    // Reality: the e2e job runs on the same pull_request trigger and executes
    // browser.test.ts.
    expect(ci).toContain('browser.test.ts')
    expect(ci).toMatch(/e2e:\s*\n\s*runs-on/)
    // Doc: the map marks it ✅ per-PR via the e2e job, NOT as manual-only.
    expect(doc).toMatch(/Browser\/screenshot e2e[^\n]*✅[^\n]*e2e/)
  })

  test('coverage runs per-PR but is framed as a finder, not a target', () => {
    expect(ci).toContain('--coverage')
    expect(ci.toLowerCase()).toContain('finder')
    expect(doc).toMatch(/coverage[^\n]*finder/i)
  })

  test('mutation testing is nightly-only, never on the PR gate', () => {
    // ci.yml must NOT run stryker/mutation; the nightly workflow must.
    expect(ci.toLowerCase()).not.toContain('stryker')
    expect(ci).not.toContain('mutation-test')
    expect(nightly).toContain('mutation-test')
    // Doc places mutation in the nightly column.
    expect(doc).toMatch(/Mutation lanes \(Stryker\)[^\n]*✅/)
  })

  test('the heuristic-tracker ratchet runs per-PR (it is a src test)', () => {
    // Anything in src/__tests__/ is in the `bun test … src/__tests__/` gate.
    expect(read('src/__tests__/heuristic-tracker.test.ts').length).toBeGreaterThan(0)
    expect(doc).toMatch(/heuristic-tracker ratchet[^\n]*✅/)
  })

  test('the per-PR jobs the doc names actually exist in ci.yml', () => {
    // Spot-check the structural/golden gates the doc lists as per-PR.
    expect(ci).toContain('hero:check')
    expect(ci).toContain('tsc --noEmit')
    expect(ci).toContain('testdata/')  // golden drift gate
  })
})
