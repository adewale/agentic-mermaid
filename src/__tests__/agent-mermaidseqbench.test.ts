// Sequence parse/verify/serialize over real-world input: the IBM
// MermaidSeqBench dataset (132 human-verified sequence diagrams) must parse,
// verify, and round-trip losslessly without dropping participants or messages.

import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadDataset, runBench } from '../../eval/mermaidseqbench/runner.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements, isDrop } from '../agent/structural-count.ts'

const DATA = join(import.meta.dir, '..', '..', 'eval', 'mermaidseqbench', 'data.csv')

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
      // Shared verdict (Move 3): same drop semantics as the corpus + upstream gates.
      if (isDrop(before, after)) drops.push(row.title)
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
