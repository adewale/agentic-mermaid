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
import { parseMermaid, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'

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
    test('faithfulness: participant/message counts survive round-trip (count-oracle)', () => {
      // Unifies the three differential gates on one faithfulness check: a
      // structured sequence body must not silently drop a participant or
      // message on serialize → re-parse, even when the bytes round-trip.
      const drops: string[] = []
      for (const row of rows) {
        const p1 = parseMermaid(row.expected)
        if (!p1.ok) continue
        const before = countStructuralElements(p1.value)
        if (!before) continue  // opaque fallback — byte round-trip gate owns it
        const p2 = parseMermaid(serializeMermaid(p1.value))
        const after = p2.ok ? countStructuralElements(p2.value) : null
        if (!after || after.nodes !== before.nodes || after.edges !== before.edges) drops.push(row.title)
      }
      expect(drops).toEqual([])
    })
    test('segment-preserving structured parse engaged for the real-world syntax (Note/alt/activate)', () => {
      // BUILD-18: the dataset's expected outputs use Note/alt/loop/activate/
      // autonumber, which used to force the WHOLE body opaque. They now parse
      // structured-with-segments (asSequence non-null) while the opaque-block
      // segments keep the unmodeled lines verbatim — round-trip fidelity is
      // identical, but the structured ops are no longer lost.
      expect(c.opaque + c.structured).toBe(c.parseOk)
      expect(c.structured).toBeGreaterThan(0)
      // Whatever doesn't cleanly segment still falls back to lossless opaque.
      expect(c.structured + c.opaque).toBe(c.total)
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
