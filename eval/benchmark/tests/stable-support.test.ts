import { expect, test } from 'bun:test'
import { assessStableFamilySupport, type FamilyMaturityAudit, type StableSupportObservation, type StableSupportPolicy, type StableSupportRequirement } from '../unified/stable-support.ts'

const policy: StableSupportPolicy = {
  pin: { version: 'fixture-version', commit: 'fixture-pin' },
  families: [
    { id: 'authored', maturity: 'stable' },
    { id: 'preview', maturity: 'beta' },
    { id: 'uncertain', maturity: 'experimental' },
  ],
}
const requirements: StableSupportRequirement[] = [{ id: 'public-svg', surface: 'node:public-svg', operation: 'render', format: 'svg', requireNativeSemantic: true, requirePaintedSemantic: true }]
const audit: FamilyMaturityAudit = { pin: policy.pin, evidence: ['Independently reviewed fixture policy and upstream maturity evidence'], exceptions: [] }
const render = (overrides: Partial<StableSupportObservation> = {}): StableSupportObservation => ({
  family: 'authored',
  caseId: 'authored-positive',
  surface: 'node:public-svg',
  operation: 'render',
  format: 'svg',
  status: 'passed',
  expectedAccepted: true,
  runtimeExecuted: true,
  nativeSemantic: true,
  paintedSemantic: true,
  ...overrides,
})
const assess = (rows: StableSupportObservation[], reviewed = audit) => assessStableFamilySupport(policy, rows, requirements, reviewed)

test('stable support requires executed positive evidence for the exact public work and declared criteria', () => {
  const missing = assess([])
  expect(missing.completeLibraryEligible).toBe(false)
  expect(missing.families[0]!.cells[0]!.status).toBe('missing')
  for (const row of [render({ expectedAccepted: false }), render({ runtimeExecuted: false }), render({ surface: 'node:private-svg' }), render({ operation: 'native-case' }), render({ format: 'ascii' })]) expect(assess([row]).completeLibraryEligible).toBe(false)
  expect(assess([render({ paintedSemantic: undefined })]).families[0]!.cells[0]!.status).toBe('incomplete')
  expect(assess([render({ nativeSemantic: undefined })]).completeLibraryEligible).toBe(false)
  expect(assess([render()]).completeLibraryEligible).toBe(true)
})

test('a passing case cannot hide another failed, blocked or unsupported positive on the same interface', () => {
  for (const status of ['failed', 'blocked', 'unsupported'] as const) {
    const result = assess([render(), render({ caseId: 'other-authored-case', status })])
    expect(result.completeLibraryEligible).toBe(false)
    expect(result.families[0]!.cells[0]!.status).toBe(status)
    expect(result.families[0]!.cells[0]!.positiveObservations).toBe(2)
  }
  const negative = assess([render(), render({ caseId: 'negative-control', expectedAccepted: false, status: 'failed' })])
  expect(negative.families[0]!.cells[0]!.positiveObservations).toBe(1)
  expect(negative.families[0]!.cells[0]!.negativeObservationsExcluded).toBe(1)
  expect(negative.completeLibraryEligible).toBe(false)
  expect(negative.families[0]!.cells[0]!.negativeControls[0]!.caseId).toBe('negative-control')
})

test('native functionality does not stand in for rendering, and separate partial cases cannot manufacture complete criteria', () => {
  const native: StableSupportRequirement = { id: 'native-edit', surface: 'node:public-agent', operation: 'mutateChecked', format: 'typed', requireNativeSemantic: true }
  const nativeRow = render({ surface: native.surface, operation: native.operation, format: native.format, paintedSemantic: undefined })
  const result = assessStableFamilySupport(policy, [nativeRow], [native, ...requirements], audit)
  expect(result.completeLibraryEligible).toBe(false)
  expect(result.families[0]!.cells.map(cell => cell.status)).toEqual(['passed', 'missing'])
  expect(assess([render({ caseId: 'native-only', paintedSemantic: undefined }), render({ caseId: 'paint-only', nativeSemantic: undefined })]).completeLibraryEligible).toBe(false)
})

test('optional beta and experimental families remain visible without excusing missing stable support', () => {
  const result = assess([render()])
  expect(result.completeLibraryEligible).toBe(true)
  expect(result.requiredFamilies).toEqual(['authored'])
  expect(result.optionalFamilies).toEqual(['preview', 'uncertain'])
  expect(result.families.slice(1).map(family => family.cells[0]!.status)).toEqual(['missing', 'missing'])
  expect(assess([render({ family: 'preview' })]).completeLibraryEligible).toBe(false)
})

test('ambiguous excluded families are required until reviewed and cannot turn a policy-only result into a certificate', () => {
  const pending: FamilyMaturityAudit = { ...audit, exceptions: [{ family: 'uncertain', maturity: 'requires-review', requiredPendingReview: true, evidence: ['Pinned detector accepts an unqualified header; documentation gives no experimental warning'], note: 'required-until-classification-reviewed' }] }
  const missing = assess([render()], pending)
  expect(missing.requiredFamilies).toEqual(['authored', 'uncertain'])
  expect(missing.policyStableCoverageComplete).toBe(true)
  expect(missing.requiredCoverageComplete).toBe(false)
  expect(missing.completeLibraryEligible).toBe(false)
  const observed = assess([render(), render({ family: 'uncertain', caseId: 'uncertain-positive' })], pending)
  expect(observed.requiredCoverageComplete).toBe(true)
  expect(observed.maturityReviewComplete).toBe(false)
  expect(observed.completeLibraryEligible).toBe(false)
  expect(observed.families[2]!.requirementReason).toBe('required-until-classification-reviewed')
  expect(assessStableFamilySupport(policy, [render()], requirements).completeLibraryEligible).toBe(false)
})

test('reviewed upstream stability may add a requirement, but a policy-stable requirement cannot be removed by relabeling', () => {
  const revised: FamilyMaturityAudit = {
    ...audit,
    exceptions: [
      { family: 'uncertain', maturity: 'stable', evidence: ['Explicit reviewed upstream stability evidence'] },
      { family: 'authored', maturity: 'experimental', evidence: ['Explicit experimental warning'] },
    ],
  }
  const result = assess([render({ family: 'uncertain' })], revised)
  expect(result.requiredFamilies).toEqual(['authored', 'uncertain'])
  expect(result.completeLibraryEligible).toBe(false)
  expect(result.families[0]!.policyDisagreement).toBe(true)
})

test('maturity input uncertainty and unknown positive runtime families prevent a complete-library claim', () => {
  expect(() => assess([render()], { ...audit, pin: { ...audit.pin, commit: 'different-pin' } })).toThrow('same pinned policy')
  expect(() => assessStableFamilySupport({ ...policy, families: [...policy.families, policy.families[0]!] }, [], requirements, audit)).toThrow('unique')
  const result = assess([render(), render({ family: 'new-upstream-type' })])
  expect(result.completeLibraryEligible).toBe(false)
  expect(result.unmappedObservationFamilies).toEqual(['new-upstream-type'])
})
