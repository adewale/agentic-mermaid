import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { complexityEvidence, verifyTimingEvidence } from '../../eval/palette-performance/run.ts'

const ROOT = join(import.meta.dir, '..', '..')
const REPORT = join(ROOT, 'eval', 'palette-performance', 'report.json')
const SAMPLES = join(ROOT, 'eval', 'palette-performance', 'samples.json')

describe('palette performance evidence integrity', () => {
  test('the committed deterministic complexity evidence matches the current palette generator', () => {
    const report = JSON.parse(readFileSync(REPORT, 'utf8'))
    expect(report.complexity.deterministicLargeCountEvidence).toEqual(complexityEvidence())
    expect(report.validity.rebuttal).toBe('Absolute timings are observational, are not portable across machines, and are not a CI threshold.')
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
