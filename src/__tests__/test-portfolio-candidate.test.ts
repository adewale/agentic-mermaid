import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContactSheetPlan, buildMixedFormatConformancePlan, buildRenderConformancePlan } from './helpers/render-conformance-plan.ts'
import { verifyCoreConformancePlan, verifyMixedFormatConformancePlan } from './helpers/render-conformance-verifier.ts'

const ROOT = join(import.meta.dir, '..', '..')
const candidate = JSON.parse(readFileSync(join(ROOT, 'eval', 'test-portfolio', 'candidate.json'), 'utf8'))

describe('TEST-3 measured candidate report', () => {
  test('derives row and obligation counts from the executable plans', () => {
    const core = buildRenderConformancePlan()
    const mixed = buildMixedFormatConformancePlan()
    const coreCoverage = verifyCoreConformancePlan(core)
    const mixedCoverage = verifyMixedFormatConformancePlan(mixed)
    expect(candidate.portfolio.coreRows).toBe(core.length)
    expect(candidate.portfolio.mixedFormatRows).toBe(mixed.length)
    expect(candidate.portfolio.coreRequiredObligations).toBe(coreCoverage.required)
    expect(candidate.portfolio.coreCoveredObligations).toBe(coreCoverage.covered)
    expect(candidate.portfolio.mixedRequiredObligations).toBe(mixedCoverage.required)
    expect(candidate.portfolio.mixedCoveredObligations).toBe(mixedCoverage.covered)
    expect([...coreCoverage.missing, ...mixedCoverage.missing]).toEqual(candidate.portfolio.missingObligations)
    expect(candidate.portfolio.citizenshipContactSheetRows).toBe(buildContactSheetPlan('citizenship').length)
    expect(candidate.portfolio.interactionContactSheetRows).toBe(buildContactSheetPlan('interaction').length)
    expect(candidate.portfolio.outlierContactSheetRows).toBe(buildContactSheetPlan('outlier').length)
  })

  // A lint of the frozen July 19 measurement: no product code runs, so it can
  // only fail when candidate.json is edited. Current gallery receipt freshness
  // is proved by each gallery's own check; coupling this historical row to live
  // receipt sizes made unrelated source additions rewrite history.
  test('data lint: the frozen before/after and receipt-reduction arithmetic is internally consistent', () => {
    const observations = candidate.observations
    const subtotal = ['renderConformance', 'docsShowcase', 'styledOutput', 'sectionBVisualEvidence', 'paletteAndRoleGates']
      .reduce((sum, key) => sum + observations[key].wallSeconds, 0)
    expect(Number(subtotal.toFixed(2))).toBe(candidate.beforeAfter.visibleStylePaletteWallSecondsAfter)
    expect(Number((candidate.beforeAfter.visibleStylePaletteWallSecondsBefore - subtotal).toFixed(2)))
      .toBe(candidate.beforeAfter.wallSecondsSaved)
    expect(candidate.beforeAfter.percentReduction).toBeCloseTo(
      candidate.beforeAfter.wallSecondsSaved / candidate.beforeAfter.visibleStylePaletteWallSecondsBefore * 100,
      2,
    )
    expect(candidate.beforeAfter.docsCartesianRendersAfter).toBe(0)
    expect(candidate.beforeAfter.duplicateStyledRendersAfter).toBe(0)
    expect(Number((candidate.beforeAfter.fullCoveredSuiteWallSecondsBefore - candidate.beforeAfter.fullCoveredSuiteWallSecondsAfter).toFixed(2)))
      .toBe(candidate.beforeAfter.fullCoveredSuiteWallSecondsSaved)
    expect(candidate.observations.fullCoveredUnitSuite.failed).toBe(0)

    for (const [key, measurement] of Object.entries(candidate.receiptDependencyReduction)) {
      if (key === 'visualOutputBytesChanged') continue
      const { beforeInputs, afterInputs, percentReduction } = measurement as {
        beforeInputs: number
        afterInputs: number
        percentReduction: number
      }
      expect(afterInputs, key).toBeLessThan(beforeInputs)
      expect(percentReduction, key).toBeCloseTo((beforeInputs - afterInputs) / beforeInputs * 100, 1)
    }
    expect(candidate.receiptDependencyReduction.visualOutputBytesChanged).toBe(0)
  })

  test('does not confuse model sanity, configured release rows, or future observation with completed evidence', () => {
    // The candidate's contact-sheet claims must agree with the live review
    // record they cite (whose manifest binding test-portfolio-contact-sheet checks).
    const review = JSON.parse(readFileSync(join(ROOT, candidate.contactSheet.review), 'utf8'))
    expect({ claimed: candidate.contactSheet.humanReviewStatus, recorded: review.status })
      .toEqual({ claimed: 'pending-independent-human-review', recorded: 'pending-independent-human-review' })
    expect({ modelSanityIsHumanApproval: candidate.contactSheet.modelSanityIsHumanApproval, reviewer: review.reviewer })
      .toEqual({ modelSanityIsHumanApproval: false, reviewer: null })
    expect(candidate.contactSheet.releaseGate).toBe('configured-fail-closed')
    expect(candidate.validity.rebuttal).toContain('has not run')
    expect(new Set(Object.values(candidate.futureObservation))).toContain('pending')
  })
})
