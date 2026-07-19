import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PALETTE_PROVENANCE_AUTHORITY,
  verifyPaletteSourceProvenance,
  verifyTimingEvidence,
} from '../../eval/palette-performance/run.ts'

const ROOT = join(import.meta.dir, '..', '..')
const REPORT = join(ROOT, 'eval', 'palette-performance', 'report.json')
const SAMPLES = join(ROOT, 'eval', 'palette-performance', 'samples.json')

describe('palette performance evidence integrity', () => {
  test('uses exact input content as durable authority across squash merges', () => {
    const inputs = [{ path: 'src/example.ts', sha256: 'a'.repeat(64) }]
    const provenance = {
      authority: PALETTE_PROVENANCE_AUTHORITY,
      sourceCommit: 'b'.repeat(40),
      sourceTreeSha256: 'c'.repeat(64),
      dirty: false,
      inputs,
    }
    expect(() => verifyPaletteSourceProvenance(provenance, 'c'.repeat(64), inputs)).not.toThrow()
    expect(() => verifyPaletteSourceProvenance({ ...provenance, authority: 'commit-ancestry' }, 'c'.repeat(64), inputs))
      .toThrow('provenance authority')
    expect(() => verifyPaletteSourceProvenance(provenance, 'd'.repeat(64), inputs))
      .toThrow('inputs are stale')
  })

  test('recomputes aggregates from the committed raw samples', () => {
    const report = JSON.parse(readFileSync(REPORT, 'utf8'))
    const samples = JSON.parse(readFileSync(SAMPLES, 'utf8'))
    expect(() => verifyTimingEvidence(report, samples)).not.toThrow()

    const falsified = structuredClone(report)
    falsified.results.overall.p50 += 1
    expect(() => verifyTimingEvidence(falsified, samples))
      .toThrow('timing aggregates do not match the committed raw samples')
  })
})
