import { expect, test } from 'bun:test'
import { compareFidelityCriteria, completeCriterionLedger, planFidelityCriteria, type FidelityCriterionPlan } from '../fidelity/ledger.ts'
import type { AuthoredFidelityCase } from '../fidelity/meaning.ts'
import type { BenchmarkObservation } from '../unified/types.ts'

const baseline = 'mermaid-js/mermaid', peer = 'peer/renderer'
const planned: FidelityCriterionPlan[] = [
  { caseId: 'authored-edge', family: 'flowchart', required: true, surface: 'native-public-api', criterion: 'native-admission' },
  { caseId: 'authored-edge', family: 'flowchart', required: true, surface: 'browser-public-api', criterion: 'public-svg-admission' },
  { caseId: 'authored-edge', family: 'flowchart', required: true, surface: 'browser-owned-ink', criterion: 'painted-endpoints' },
]
const row = (project: string, item: FidelityCriterionPlan, status: BenchmarkObservation['status']): BenchmarkObservation => ({ suite: 'mermaid-fidelity', surface: item.surface, family: item.family, runtime: 'fixture', caseId: item.caseId + ':' + item.criterion, operation: item.criterion, format: 'svg', mode: 'independent-authored-criteria', status, metrics: { implementation: project, authoredCase: item.caseId, criterion: item.criterion } })

test('a reference render failure keeps planned ink evidence in the denominator and prevents a complete case claim', () => {
  const reference = completeCriterionLedger(planned, [row(baseline, planned[0]!, 'passed'), row(baseline, planned[1]!, 'failed')], baseline)
  const candidate = completeCriterionLedger(planned, planned.map(item => row(peer, item, 'passed')), peer)
  expect(reference[2]).toMatchObject({ status: 'blocked', metrics: { missingEvidence: true, evidenceRecorded: false } })
  const comparison = compareFidelityCriteria([...reference, ...candidate], [baseline, peer])
  expect(comparison.rawPopulation).toBe(3)
  expect(comparison.calibratedPopulation).toBe(1)
  expect(comparison.reviewRequired).toHaveLength(2)
  expect(comparison.results[1]!.cases[0]).toMatchObject({ rawPassedCriteria: 3, completeRawPass: true, calibratedCriteria: 1, allDeclaredCriteriaCalibrated: false, completeCalibratedPass: false })
})

test('an omitted peer criterion cannot disappear from a common baseline-qualified comparison', () => {
  const reference = completeCriterionLedger(planned, planned.map(item => row(baseline, item, 'passed')), baseline)
  const candidate = completeCriterionLedger(planned, [row(peer, planned[0]!, 'passed'), row(peer, planned[1]!, 'passed')], peer)
  const comparison = compareFidelityCriteria([...reference, ...candidate], [baseline, peer])
  expect(comparison.results[1]).toMatchObject({ calibratedPopulation: 3, passed: 2, unavailable: 1 })
  expect(comparison.results[1]!.cases[0]!.completeCalibratedPass).toBe(false)
  expect(() => completeCriterionLedger(planned, [row(peer, planned[0]!, 'passed'), row(peer, planned[0]!, 'passed')], peer)).toThrow('Duplicate observed')
})

test('failed workflow setup withholds qualified postcondition credit while preserving the observed fact', () => {
  const steps = [...planned, { ...planned[0]!, criterion: 'prelude-0' }]
  const reference = completeCriterionLedger(steps, steps.map(item => row(baseline, item, 'passed')), baseline)
  const candidate = completeCriterionLedger(steps, steps.map(item => row(peer, item, item.criterion === 'prelude-0' ? 'failed' : 'passed')), peer)
  const comparison = compareFidelityCriteria([...reference, ...candidate], [baseline, peer])
  expect(candidate[0]!.status).toBe('passed')
  expect(comparison.results[1]!.comparisons.find(item => item.criterion === 'native-admission')).toMatchObject({ status: 'blocked', rawStatus: 'passed' })
  expect(comparison.results[1]!.failed).toBe(1)
  const brokenReference = completeCriterionLedger(steps, steps.map(item => row(baseline, item, item.criterion === 'prelude-0' ? 'failed' : 'passed')), baseline)
  const unqualified = compareFidelityCriteria([...brokenReference, ...candidate], [baseline, peer])
  expect(unqualified.reviewRequired.some(item => item.criterion === 'native-public-api:native-admission' && item.reason.includes('workflow setup'))).toBe(true)
})

test('capability-specific serializers remain visible without creating a fictitious Mermaid API denominator', () => {
  const reference = completeCriterionLedger(planned, planned.map(item => row(baseline, item, 'passed')), baseline)
  const serializer = { ...planned[0]!, criterion: 'serialized-pinned-reference-readback' }
  const candidate = completeCriterionLedger(planned, [...planned.map(item => row(peer, item, 'passed')), row(peer, serializer, 'passed')], peer)
  const result = compareFidelityCriteria([...reference, ...candidate], [baseline, peer])
  expect(result.calibratedPopulation).toBe(3)
  expect(result.results[1]!.unrankedCapabilityChecks).toBe(1)
  const noReference = compareFidelityCriteria(candidate, [peer])
  expect(noReference.baselineAvailable).toBe(false)
  expect(noReference.calibratedPopulation).toBe(0)
  expect(noReference.results[0]!.cases[0]!.completeCalibratedPass).toBe(false)
})

test('authored nodes, relationships and font configuration declare checks before observation', () => {
  const authored: AuthoredFidelityCase = { id: 'declared', family: 'flowchart', required: true, source: 'flowchart LR\nA[Alpha]-->B[Beta]', features: ['endpoints', 'font'], provenance: 'Independent literal', expected: { labels: ['Alpha', 'Beta'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }], edges: [{ source: 'A', target: 'B', directed: true }] }, paint: { fontSize: 14 } }
  const plan = planFidelityCriteria([authored])
  expect(plan.some(item => item.surface === 'native-public-api' && item.criterion === 'relationships')).toBe(true)
  expect(plan.some(item => item.surface === 'browser-owned-ink' && item.criterion === 'computed-authored-font-size')).toBe(true)
  expect(completeCriterionLedger(plan, [], peer).every(item => item.status === 'blocked')).toBe(true)
})
