// MermaidSeqBench eval — locks the result into CI.
//
// Loads the IBM MermaidSeqBench dataset (132 human-verified sequence diagrams)
// and asserts: every diagram parses, verifies, and round-trips losslessly.
// Skipped when the dataset isn't present so the suite still runs in
// environments that haven't downloaded it.

import { describe, test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadDataset, runBench, parseCsv } from '../../eval/mermaidseqbench/runner.ts'

const DATA = join(import.meta.dir, '..', '..', 'eval', 'mermaidseqbench', 'data.csv')
const have = existsSync(DATA)

if (have) {
  describe('MermaidSeqBench (132 human-verified samples)', () => {
    const rows = loadDataset(DATA)
    const c = runBench(rows)

    test('every sample parses', () => {
      expect(c.parseOk).toBe(c.total)
      expect(c.total).toBeGreaterThanOrEqual(132)
    })
    test('every sample verifies (no Tier-1 error warnings)', () => {
      expect(c.verifyOk).toBe(c.total)
    })
    test('every sample round-trips losslessly', () => {
      expect(c.roundTripStable).toBe(c.total)
    })
    test('opaque fallback engaged for the real-world syntax (Note/alt/activate)', () => {
      // The dataset's expected outputs all use constructs our structured
      // parser intentionally doesn't model — opaque fallback is what
      // prevents silent information loss. This documents the result.
      expect(c.opaque + c.structured).toBe(c.parseOk)
      expect(c.opaque).toBeGreaterThan(0)
    })
  })
} else {
  describe.skip('MermaidSeqBench (dataset not downloaded; skipping)', () => {
    test('skipped', () => { /* placeholder */ })
  })
}

describe('CSV parser (used by MermaidSeqBench runner)', () => {
  test('handles quoted fields with newlines and "" escapes', () => {
    const csv = 'a,b\n"x\ny","quote\\"d"'.replace('\\"', '""')
    const rows = parseCsv(csv)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[1]![0]).toBe('x\ny')
    expect(rows[1]![1]).toBe('quote"d')
  })
})
