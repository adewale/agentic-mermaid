// Determinism policy for the property suites (docs/testing-strategy.md):
// every fast-check suite runs at one pinned seed, so a red CI run is a real,
// reproducible counterexample — never a seed lottery (2026-07 audit: three
// suites flaked on rolled seeds; the policy is now structural, not per-file).
//
//   bun test src/__tests__/                    # pinned default seed
//   AM_FC_SEED=12345 bun test <file>           # reproduce a specific roll
//   AM_FC_SEED=random bun test src/__tests__/  # finder mode: roll fresh seeds
//   AM_FC_NUM_RUNS=300 ...                     # minimum cases per property
//
// Loaded via bunfig.toml [test].preload, so it applies to every current and
// future *.test.ts without per-file wiring. Suites that preserve a seed which
// exposed a real bug use per-call `seed:` options through fcParameters. Those
// pins apply in gates; explicit AM_FC_SEED controls take precedence in finders
// and replay runs. See helpers/fc-parameters.ts.
import fc from 'fast-check'

// Built-in Scene cross-checks (src/scene/assertions.ts) run in every unit
// test, and in the processes those tests spawn, so a lowering bug fails here
// rather than only in verify. It must be set before src/ is imported.
process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS = '1'

export const DEFAULT_FC_SEED = 20260702

const raw = process.env.AM_FC_SEED
if (raw !== 'random') {
  const seed = raw === undefined ? DEFAULT_FC_SEED : Number(raw)
  if ((raw !== undefined && !/^-?\d+$/.test(raw)) || !Number.isSafeInteger(seed)) {
    throw new Error(`AM_FC_SEED must be an integer or 'random', got: ${JSON.stringify(raw)}`)
  }
  fc.configureGlobal({ ...fc.readConfigureGlobal(), seed })
}

const rawRuns = process.env.AM_FC_NUM_RUNS
if (rawRuns !== undefined) {
  const numRuns = Number(rawRuns)
  if (!/^\d+$/.test(rawRuns) || !Number.isSafeInteger(numRuns) || numRuns < 1) {
    throw new Error(`AM_FC_NUM_RUNS must be a positive integer, got: ${JSON.stringify(rawRuns)}`)
  }
  fc.configureGlobal({ ...fc.readConfigureGlobal(), numRuns })
}
