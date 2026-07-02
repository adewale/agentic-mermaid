// Gates the fast-check determinism policy itself: the preload
// (fc-seed.preload.ts via bunfig.toml [test].preload) must have pinned the
// global seed before any suite runs. If someone deletes the preload file or
// the bunfig wiring, this fails — the policy cannot silently un-land.
// AM_FC_SEED=random (finder mode) and AM_FC_SEED=<int> (repro mode) are the
// two sanctioned escapes and are asserted to behave, not skipped.
import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { DEFAULT_FC_SEED } from './fc-seed.preload.ts'

describe('fast-check seed policy (preload)', () => {
  test('the global seed matches the AM_FC_SEED contract', () => {
    const raw = process.env.AM_FC_SEED
    const globalSeed = fc.readConfigureGlobal()?.seed
    if (raw === 'random') {
      expect(globalSeed).toBeUndefined()
    } else if (raw !== undefined) {
      expect(globalSeed).toBe(Number.parseInt(raw, 10))
    } else {
      expect(globalSeed).toBe(DEFAULT_FC_SEED)
    }
  })

  test('a suite-scoped override must restore, not reset, the global config', () => {
    // The pattern route-contracts.test.ts and
    // property-mermaid-source-and-parser.test.ts use: save the config in
    // beforeAll, restore the saved object in afterAll. A bare
    // fc.resetConfigureGlobal() would wipe the policy for every file that
    // runs later in the same process.
    const saved = fc.readConfigureGlobal()
    fc.configureGlobal({ ...saved, seed: 424242 })
    expect(fc.readConfigureGlobal()?.seed).toBe(424242)
    if (saved) fc.configureGlobal(saved)
    else fc.resetConfigureGlobal()
    expect(fc.readConfigureGlobal()?.seed).toBe(saved?.seed)
  })
})
