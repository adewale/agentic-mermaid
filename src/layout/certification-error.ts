export interface LayoutCertificationAttempt {
  strategy: string
  violations: string[]
}

/** Shared by graph certification and the family-neutral final geometry veto. */
export class LayoutCertificationError extends Error {
  readonly code = 'LAYOUT_CERTIFICATION_FAILED'
  constructor(readonly attempts: readonly LayoutCertificationAttempt[]) {
    super(`No certified layout after ${attempts.length} bounded attempts: ${attempts.map(attempt => `${attempt.strategy}: ${attempt.violations.join('; ')}`).join(' | ')}`)
    this.name = 'LayoutCertificationError'
  }
}
