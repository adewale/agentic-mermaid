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

/** Internal control flow for an async entry's not-yet-loaded provider.
 * Synchronous entries retain their bundled provider and never throw this. */
export class DeferredDependencyError extends Error {
  constructor(readonly dependency: string, readonly load: () => Promise<void>) {
    super(`${dependency} has not loaded`)
  }
}

/** Layout adapters retain causes; an async host must find the original load
 * request without turning internal suspension into an author-facing warning. */
export function deferredDependency(error: unknown): DeferredDependencyError | undefined {
  const seen = new Set<Error>()
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof DeferredDependencyError) return error
    seen.add(error)
    error = error.cause
  }
  return undefined
}
