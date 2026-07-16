// Runs last in Bun's alphabetical order within its process and catches runtime
// seed drift there. The source-level policy in fc-seed-policy.test.ts forbids
// suite-global overrides everywhere else, including files assigned to other
// CI shards, so this epilogue no longer carries a cross-process guarantee it
// cannot enforce.
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
