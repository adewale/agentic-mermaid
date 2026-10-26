import { describe, expect, test } from 'bun:test'
import { comparisonRowsFromCommittedBrowserRounds, isQualificationRepairObservation, mergeRows, validateFrozenCommunityInputs } from '../unified/reconcile-community.mjs'

const row = (changes: Record<string, unknown> = {}) => ({
  suite: 'community-browser',
  surface: 'browser:public-api',
  runtime: 'chromium',
  family: 'flowchart',
  caseId: 'core:flow5',
  operation: 'render',
  format: 'svg',
  mode: 'core-api-repeat',
  status: 'passed',
  samplesMs: [3],
  metrics: { implementation: 'fixture/engine', round: 1 },
  ...changes,
})

describe('strict qualification partition reconciliation', () => {
  test('input-file provenance paths may differ but literal sources, labels and reference cannot', () => {
    const base = { source: '/original/frozen.json', workloads: [{ id: 'case', family: 'flowchart', source: 'flowchart LR\nA[Start]', expectedLabels: ['Start'], features: ['authored'] }], reference: { version: '12.2.0' }, policy: 'frozen' }
    const repair = { ...base, source: '/replay/frozen.json' }
    expect(validateFrozenCommunityInputs(base, repair)).toMatchObject({ originalSourcePath: base.source, repairSourcePath: repair.source })
    expect(() => validateFrozenCommunityInputs(base, { ...repair, workloads: [{ ...base.workloads[0], source: 'flowchart LR\nB[Changed]' }] })).toThrow('input changed')
    expect(() => validateFrozenCommunityInputs(base, { ...repair, workloads: [{ ...base.workloads[0], expectedLabels: ['Changed'] }] })).toThrow('input changed')
    expect(() => validateFrozenCommunityInputs(base, { ...repair, reference: { version: 'different' } })).toThrow('input changed')
  })

  test('refreshesSVG andIR plusSVG delivery/heap while preserving untouchedPNG/terminal/parser/source objects', () => {
    const svg = row(),
      ir = row({ suite: 'community', format: 'react-flow', operation: 'convert' }),
      delivery = row({ family: '*', caseId: 'observed-request-closure', operation: 'delivery', format: 'js-wasm-fonts', samplesMs: undefined, metrics: { implementation: 'fixture/engine', round: 1, renderedOutput: 'svg' } }),
      heap = row({ family: '*', caseId: 'heap', operation: 'memory', samplesMs: undefined })
    const untouched = ['png', 'terminal', 'parse', 'source'].map(format => row({ format, detail: 'original timestamp2026-10-24T00:00:00Z' }))
    const old = [svg, ir, delivery, heap, ...untouched],
      fresh = [svg, ir, delivery, heap].map(value => ({ ...value, status: 'failed', detail: 'stronger admission' }))
    const result = mergeRows(old, fresh, new Set(['core:flow5']))
    expect(result.preserved).toBe(4)
    expect(result.observations.slice(0, 4)).toEqual(untouched)
    result.observations.slice(0, 4).forEach((value: unknown, index: number) => expect(value).toBe(untouched[index]))
    expect(isQualificationRepairObservation(row({ format: 'png:js-wasm-fonts', metrics: { renderedOutput: 'png' } }))).toBe(false)
    expect(result.observations.filter(isQualificationRepairObservation).every((value: any) => value.status === 'failed')).toBe(true)
  })
  test('feature-once comparison tolerates outcome-dependent legacy mode without altering either raw mode', () => {
    const old = row({ caseId: 'feature:flow', mode: 'feature-corpus-attempt', status: 'failed', samplesMs: undefined })
    const fresh = { ...old, mode: 'feature-corpus-qualification', status: 'passed' }
    const result = mergeRows([old], [fresh], new Set(['feature:flow']))
    expect(result.observations).toEqual([fresh])
    expect(old.mode).toBe('feature-corpus-attempt')
    expect(() => mergeRows([old], [{ ...fresh, samplesMs: [1] }], new Set(['feature:flow']))).toThrow('repeated or calibrated')
  })
  test('rejects missing/duplicate/runtime-mismatched selected work and any timed unaffected lane', () => {
    const original = row()
    expect(() => mergeRows([original], [], new Set(['core:flow5']))).toThrow('Missing or extra')
    expect(() => mergeRows([original], [original, original], new Set(['core:flow5']))).toThrow('Duplicate')
    expect(() => mergeRows([original], [row({ runtime: 'different' })], new Set(['core:flow5']))).toThrow('Missing or extra')
    expect(() => mergeRows([original], [original, row({ format: 'terminal' })], new Set(['core:flow5']))).toThrow('timed unaffected')
  })
  test('recovers actual failure-only round associations from raw sidecars without modifying original rows', () => {
    const missing = row({ status: 'blocked', samplesMs: undefined, metrics: { implementation: 'fixture/engine' } }),
      original = [missing, { ...missing, metrics: { ...missing.metrics } }]
    const records = [1, 2].map(round => ({ id: 'fixture/engine', round, samples: [missing] }))
    const result = comparisonRowsFromCommittedBrowserRounds(original, records, new Set(['core:flow5']))
    expect(result.rows.map((value: any) => value.metrics.round)).toEqual([1, 2])
    expect(result.associations).toHaveLength(1)
    expect(result.associations[0]!.association).toContain('ambiguous-failure-set')
    expect(result.associations[0]!.candidates.map((value: any) => value.recordIndex)).toEqual([0, 1])
    expect(result.associations[0]!.recoveredRound).toBeUndefined()
    expect(original.every(value => !('round' in value.metrics))).toBe(true)
    expect(() => comparisonRowsFromCommittedBrowserRounds(original, records.slice(1), new Set(['core:flow5']))).toThrow('no exact committed')
    const success = row({ metrics: { implementation: 'fixture/engine' } })
    expect(() => comparisonRowsFromCommittedBrowserRounds([success], [{ id: 'fixture/engine', round: 1, samples: [success] }], new Set(['core:flow5']))).toThrow('cannot invent successful/timed')
  })
})
