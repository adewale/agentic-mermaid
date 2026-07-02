// Runs last in bun's alphabetical file order, after every suite that
// temporarily overrides the fast-check global seed (route-contracts,
// property-mermaid-source-and-parser). If any of them wipes the preload's
// repo-wide pin instead of restoring it (fc.resetConfigureGlobal in an
// afterAll), this catches it — the red→green for that failure mode is in the
// PR that added the preload. If bun's discovery order ever stops being
// alphabetical this can only pass trivially, never fail falsely.
import { test, expect } from 'bun:test'
import fc from 'fast-check'
import { DEFAULT_FC_SEED } from './fc-seed.preload.ts'

test('epilogue: the global fast-check seed survived every suite', () => {
  const raw = process.env.AM_FC_SEED
  const globalSeed = fc.readConfigureGlobal()?.seed
  if (raw === 'random') expect(globalSeed).toBeUndefined()
  else if (raw !== undefined) expect(globalSeed).toBe(Number.parseInt(raw, 10))
  else expect(globalSeed).toBe(DEFAULT_FC_SEED)
})
