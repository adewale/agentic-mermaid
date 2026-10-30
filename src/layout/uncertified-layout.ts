/** One final-geometry check a drawn but uncertified layout fails. `kind` is
 * the check: a hard rubric metric (`endpointApproaches`, `nodeOverlaps`, …),
 * `groupHeaderBand`, `groupBreaches` or `groupOverlaps`. `targets` are the
 * authored ids involved, edges as `source->target`; for `groupBreaches` they
 * are the group, then the escaping member. */
export interface LayoutCertificationViolation {
  readonly kind: string
  readonly targets: readonly string[]
  readonly detail: string
}

/** Report-mode evidence that the drawn geometry did not pass certification.
 * No bounded candidate certified; `strategy` names the candidate drawn,
 * chosen by fewest misleading violations, then fewest violations, then
 * candidate order (src/layout/certification.ts). Strict layout safety refuses
 * instead. */
export interface UncertifiedLayoutReceipt {
  readonly status: 'uncertified'
  readonly strategy: string
  readonly attempts: number
  readonly violations: readonly LayoutCertificationViolation[]
}

/** Merge final-seam findings into an earlier uncertified receipt, keeping the
 * earlier strategy and dropping repeated findings. */
export function mergeUncertifiedLayout(earlier: UncertifiedLayoutReceipt | undefined, strategy: string, violations: readonly LayoutCertificationViolation[], attempts = 1): UncertifiedLayoutReceipt | undefined {
  if (!earlier && violations.length === 0) return undefined
  const merged = [...earlier?.violations ?? []]
  const seen = new Set(merged.map(violation => `${violation.kind}\n${violation.detail}`))
  for (const violation of violations) {
    const key = `${violation.kind}\n${violation.detail}`
    if (!seen.has(key)) { seen.add(key); merged.push(violation) }
  }
  return { status: 'uncertified', strategy: earlier?.strategy ?? strategy, attempts: earlier?.attempts ?? attempts, violations: merged }
}

