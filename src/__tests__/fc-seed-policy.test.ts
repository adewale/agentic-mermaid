// Gates the fast-check determinism policy itself: the preload
// (fc-seed.preload.ts via bunfig.toml [test].preload) must have pinned the
// global seed before any suite runs. If someone deletes the preload file or
// the bunfig wiring, this fails — the policy cannot silently un-land.
// AM_FC_SEED=random (finder mode) and AM_FC_SEED=<int> (repro mode) are the
// two sanctioned escapes and are asserted to behave, not skipped.
import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import fc from 'fast-check'
import { DEFAULT_FC_SEED } from './fc-seed.preload.ts'

function testFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return testFilesUnder(path)
    return entry.name.endsWith('.test.ts') ? [path] : []
  })
}

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

  test('the policy test restores its deliberate process-global probe', () => {
    const saved = fc.readConfigureGlobal()
    fc.configureGlobal({ ...saved, seed: 424242 })
    expect(fc.readConfigureGlobal()?.seed).toBe(424242)
    fc.configureGlobal(saved)
    expect(fc.readConfigureGlobal()?.seed).toBe(saved?.seed)
  })

  test('suite-specific regression seeds use per-assert options', () => {
    // Shards are separate processes, so a cross-file epilogue cannot detect a
    // global reset in another shard. Keep process-global configuration owned
    // by the preload and this explicit save/restore probe; every regression
    // seed elsewhere must be supplied to fc.assert instead.
    const offenders = testFilesUnder(import.meta.dir)
      .filter(path => path !== import.meta.filename)
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return [...source.matchAll(/fc\.(?:configureGlobal|resetConfigureGlobal)\s*\(/g)]
          .map(match => `${relative(import.meta.dir, path)}:${source.slice(0, match.index).split('\n').length}`)
      })

    expect(offenders).toEqual([])
  })
})
