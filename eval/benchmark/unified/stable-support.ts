import { readFileSync } from 'node:fs'
import type { BenchmarkObservation, BenchmarkStatus } from './types.ts'

export type FamilyMaturity = 'stable' | 'beta' | 'experimental'
export interface StableSupportPolicy {
  pin: { version: string; commit: string }
  families: { id: string; maturity: FamilyMaturity }[]
}
/** An explicit review of the pinned upstream evidence, separate from product
 * support metadata. A legacy -beta alias alone is not a maturity assessment.
 * Missing or unresolved reviews prevent a complete upstream-coverage claim.
 */
export interface FamilyMaturityReview {
  family: string
  maturity: FamilyMaturity | 'requires-review'
  evidence: readonly string[]
  /** Conservatively retain an ambiguous exclusion until its maturity is resolved. */
  requiredPendingReview?: boolean
  note?: string
}
export interface FamilyMaturityAudit {
  pin: StableSupportPolicy['pin']
  /** Explicit review of the pinned policy; no implicit default certificate. */
  evidence: readonly string[]
  exceptions: readonly FamilyMaturityReview[]
  note?: string
}
export interface StableSupportRequirement {
  id: string
  surface: string
  operation: string
  format: string
  requireNativeSemantic?: boolean
  requirePaintedSemantic?: boolean
}
/** Adapt actual owning-suite observations at the caller. Neither a descriptor's
 * agenticStatus nor a native-case metadata flag establishes these observations.
 * Semantic flags describe the executed declared criteria, not full fidelity.
 */
export interface StableSupportObservation extends Pick<BenchmarkObservation, 'family' | 'caseId' | 'surface' | 'operation' | 'format' | 'status'> {
  expectedAccepted: boolean
  runtimeExecuted: boolean
  nativeSemantic?: boolean
  paintedSemantic?: boolean
  detail?: string
}
type CellStatus = 'passed' | 'failed' | 'unsupported' | 'blocked' | 'missing' | 'incomplete'
const maturities = new Set<string>(['stable', 'beta', 'experimental'])
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function validatePolicy(value: unknown): asserts value is StableSupportPolicy {
  const policy = value as StableSupportPolicy
  if (!policy || !text(policy.pin?.version) || !text(policy.pin?.commit) || !Array.isArray(policy.families) || !policy.families.length) throw Error('A nonempty pinned upstream family policy is required')
  if (policy.families.some(family => !text(family?.id) || !maturities.has(family.maturity)) || new Set(policy.families.map(family => family.id)).size !== policy.families.length) throw Error('Upstream family IDs must be unique and every maturity must be explicit')
}
export function readStableSupportPolicy(path: string): StableSupportPolicy {
  const policy: unknown = JSON.parse(readFileSync(path, 'utf8'))
  validatePolicy(policy)
  return policy
}
function checkedStatus(status: BenchmarkStatus): CellStatus {
  return status === 'failed' || status === 'unsupported' ? status : 'blocked'
}
function assessCell(family: string, requirement: StableSupportRequirement, observations: readonly StableSupportObservation[]) {
  const matching = observations.filter(row => row.family === family && row.surface === requirement.surface && row.operation === requirement.operation && row.format === requirement.format)
  const positive = matching.filter(row => row.expectedAccepted === true)
  const negative = matching.filter(row => row.expectedAccepted === false)
  const findings: string[] = []
  const statuses: CellStatus[] = positive.map(row => {
    if (row.runtimeExecuted !== true) {
      findings.push(`${row.caseId}: no executed runtime evidence`)
      return 'missing'
    }
    if (row.status !== 'passed') {
      findings.push(`${row.caseId}: ${row.status}${row.detail ? ': ' + row.detail : ''}`)
      return checkedStatus(row.status)
    }
    const absent = [requirement.requireNativeSemantic && row.nativeSemantic !== true ? 'native semantic criteria' : null, requirement.requirePaintedSemantic && row.paintedSemantic !== true ? 'painted semantic criteria' : null].filter(Boolean)
    if (absent.length) {
      findings.push(`${row.caseId}: missing passing ${absent.join(' and ')}`)
      return 'incomplete'
    }
    return 'passed'
  })
  for (const row of negative) {
    if (row.runtimeExecuted !== true) {
      findings.push(`${row.caseId}: negative control has no executed runtime evidence`)
      statuses.push('missing')
    } else if (row.status !== 'passed') {
      findings.push(`${row.caseId}: negative control ${row.status}${row.detail ? ': ' + row.detail : ''}`)
      statuses.push(checkedStatus(row.status))
    }
  }
  if (!positive.length) findings.push('No matching positive runtime observation; negative controls and other interfaces/operations cannot establish support')
  if (!positive.length) statuses.push('missing')
  const priority: CellStatus[] = ['failed', 'unsupported', 'blocked', 'incomplete', 'missing']
  const status: CellStatus = priority.find(candidate => statuses.includes(candidate)) ?? 'passed'
  return { requirement: requirement.id, status, positiveObservations: positive.length, negativeObservationsExcluded: negative.length, findings, observations: positive, negativeControls: negative }
}

/** A hard eligibility gate, not a weighted score. The required family set is
 * the union of policy-stable and independently reviewed upstream-stable types:
 * a review can add a missing type but cannot silently remove a policy-stable
 * requirement. All matching positive cases stay in each requirement's scope.
 */
export function assessStableFamilySupport(policy: StableSupportPolicy, observations: readonly StableSupportObservation[], requirements: readonly StableSupportRequirement[], maturityAudit?: FamilyMaturityAudit) {
  validatePolicy(policy)
  if (!requirements.length || requirements.some(requirement => ![requirement.id, requirement.surface, requirement.operation, requirement.format].every(text)) || new Set(requirements.map(requirement => requirement.id)).size !== requirements.length)
    throw Error('Nonempty uniquely named public-interface requirements are required')
  const known = new Set(policy.families.map(family => family.id))
  const maturityReviews = maturityAudit?.exceptions ?? []
  if (maturityAudit && (maturityAudit.pin.version !== policy.pin.version || maturityAudit.pin.commit !== policy.pin.commit || !Array.isArray(maturityAudit.evidence) || !maturityAudit.evidence.length || maturityAudit.evidence.some(item => !text(item))))
    throw Error('Maturity audit must explicitly review the same pinned policy with evidence')
  if (new Set(maturityReviews.map(review => review.family)).size !== maturityReviews.length || maturityReviews.some(review => !known.has(review.family) || (!maturities.has(review.maturity) && review.maturity !== 'requires-review') || !Array.isArray(review.evidence) || review.evidence.some(item => !text(item))))
    throw Error('Maturity reviews must identify unique known families and explicit evidence')
  if (maturityReviews.some(review => review.requiredPendingReview && (review.maturity !== 'requires-review' || !review.evidence.length || !text(review.note)))) throw Error('A pending required family needs unresolved maturity, evidence and an explicit reason')
  const families = policy.families.map(family => {
    const review = maturityReviews.find(row => row.family === family.id)
    const requiresMaturityReview = !maturityAudit || (!!review && (review.maturity === 'requires-review' || !review.evidence.length))
    const cells = requirements.map(requirement => assessCell(family.id, requirement, observations))
    return {
      family: family.id,
      policyMaturity: family.maturity,
      upstreamReview: review ?? null,
      requiresMaturityReview,
      policyDisagreement: !!review && review.maturity !== 'requires-review' && review.maturity !== family.maturity,
      requiredForComparison: family.maturity === 'stable' || review?.maturity === 'stable' || review?.requiredPendingReview === true,
      requirementReason: review?.requiredPendingReview ? 'required-until-classification-reviewed' : family.maturity === 'stable' ? 'policy-stable minimum' : review?.maturity === 'stable' ? 'reviewed upstream-stable' : 'beta/experimental supplement',
      runtimeRequirementsPassed: cells.every(cell => cell.status === 'passed'),
      cells,
    }
  })
  const required = families.filter(family => family.requiredForComparison)
  const policyStable = families.filter(family => family.policyMaturity === 'stable')
  const policyStableCoverageComplete = policyStable.length > 0 && policyStable.every(family => family.runtimeRequirementsPassed)
  const requiredCoverageComplete = required.length > 0 && required.every(family => family.runtimeRequirementsPassed)
  const maturityReviewComplete = families.every(family => !family.requiresMaturityReview)
  const unmappedObservationFamilies = [...new Set(observations.filter(row => row.expectedAccepted === true && !known.has(row.family)).map(row => row.family))]
  const completeLibraryEligible = requiredCoverageComplete && maturityReviewComplete && !unmappedObservationFamilies.length
  const gaps = [
    ...(!required.length ? ['No required stable family has been established'] : []),
    ...required.flatMap(family => family.cells.filter(cell => cell.status !== 'passed').map(cell => `${family.family}/${cell.requirement}: ${cell.status}`)),
    ...families.filter(family => family.requiresMaturityReview).map(family => `${family.family}: pinned upstream maturity requires review; policy alone cannot certify complete upstream stable coverage`),
    ...unmappedObservationFamilies.map(family => `${family}: runtime family is absent from the reviewed maturity policy`),
  ]
  return {
    protocol: 'stable-family-runtime-support-v1',
    pin: policy.pin,
    maturityAudit: maturityAudit ?? null,
    scope:
      'Admission to this declared family/interface/operation workload only, covering policy-stable, reviewed upstream-stable and conservatively pending-review families. This required set is not a certificate that all its members are upstream-stable. Passing these declared semantic checks is not exhaustive functionality or perceptual fidelity.',
    requirements,
    completeLibraryEligible,
    policyStableCoverageComplete,
    requiredCoverageComplete,
    maturityReviewComplete,
    requiredFamilies: required.map(family => family.family),
    optionalFamilies: families.filter(family => !family.requiredForComparison).map(family => family.family),
    families,
    unmappedObservationFamilies,
    gaps,
  }
}
