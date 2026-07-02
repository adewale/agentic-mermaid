// Determinism policy for the property suites (docs/testing-strategy.md):
// every fast-check suite runs at one pinned seed, so a red CI run is a real,
// reproducible counterexample — never a seed lottery (2026-07 audit: three
// suites flaked on rolled seeds; the policy is now structural, not per-file).
//
//   bun test src/__tests__/                    # pinned default seed
//   AM_FC_SEED=12345 bun test <file>           # reproduce a specific roll
//   AM_FC_SEED=random bun test src/__tests__/  # finder mode: roll fresh seeds
//
// Loaded via bunfig.toml [test].preload, so it applies to every current and
// future *.test.ts without per-file wiring. Suites that pin their own seed
// (a seed that exposed a real bug) still override this via a save/restore
// beforeAll/afterAll — see route-contracts.test.ts — and per-call `seed:`
// options always win over the global. fc-seed-policy.test.ts gates this file
// against being unwired.
import fc from 'fast-check'

export const DEFAULT_FC_SEED = 20260702

const raw = process.env.AM_FC_SEED
if (raw !== 'random') {
  const seed = raw === undefined ? DEFAULT_FC_SEED : Number.parseInt(raw, 10)
  if (!Number.isInteger(seed)) {
    throw new Error(`AM_FC_SEED must be an integer or 'random', got: ${JSON.stringify(raw)}`)
  }
  fc.configureGlobal({ ...fc.readConfigureGlobal(), seed })
}
