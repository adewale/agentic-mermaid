import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContactSheetPlan, buildMixedFormatConformancePlan, buildRenderConformancePlan } from './helpers/render-conformance-plan.ts'
import { verifyCoreConformancePlan, verifyMixedFormatConformancePlan } from './helpers/render-conformance-verifier.ts'
import { hashFileTree, sha256File } from '../../scripts/pr-assets/artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const baseline = JSON.parse(readFileSync(join(ROOT, 'eval', 'test-portfolio', 'baseline.json'), 'utf8'))
const candidate = JSON.parse(readFileSync(join(ROOT, 'eval', 'test-portfolio', 'candidate.json'), 'utf8'))

describe('TEST-3 measured candidate report', () => {
  test('binds the candidate to its declared input bytes', () => {
    expect(candidate.schemaVersion).toBe(baseline.schemaVersion)
    expect(candidate.kind).toBe('complexity-aware-test-portfolio-candidate')
    expect(candidate.provenance.sourceState).toBe('content-addressed-candidate')
    const paths = candidate.provenance.inputs.map((entry: { path: string; sha256: string }) => {
      const path = join(ROOT, entry.path)
      expect(sha256File(path), entry.path).toBe(entry.sha256)
      return path
    })
    expect(hashFileTree(ROOT, paths)).toBe(candidate.provenance.inputTreeSha256)
  })

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

  test('keeps measured before/after arithmetic honest without making timing a gate', () => {
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
  })

  test('records precise receipt reductions and unchanged visual output claims against current receipts', () => {
    const receipts = [
      ['mermaidDocs', 'eval/mermaid-doc-showcase/gallery-receipt.json'],
      ['mindmapGitgraph', 'eval/mindmap-gitgraph-content-corpus/gallery-receipt.json'],
      ['pieHighlight', 'eval/pie-highlightslice/evidence-receipt.json'],
      ['sectionB', 'eval/section-b-brand-evidence/evidence-receipt.json'],
    ] as const
    for (const [key, path] of receipts) {
      const receipt = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
      const count = Array.isArray(receipt.inputs) ? receipt.inputs.length : receipt.inputs?.count ?? receipt.inputCount
      expect(candidate.receiptDependencyReduction[key].afterInputs, path).toBe(count)
      expect(candidate.receiptDependencyReduction[key].afterInputs).toBeLessThan(candidate.receiptDependencyReduction[key].beforeInputs)
    }
    expect(candidate.receiptDependencyReduction.visualOutputBytesChanged).toBe(0)
  })

  test('does not confuse model sanity, configured release rows, or future observation with completed evidence', () => {
    expect(candidate.contactSheet.humanReviewStatus).toBe('pending-independent-human-review')
    expect(candidate.contactSheet.modelSanityIsHumanApproval).toBe(false)
    expect(candidate.contactSheet.releaseGate).toBe('configured-fail-closed')
    expect(candidate.validity.rebuttal).toContain('has not run')
    expect(new Set(Object.values(candidate.futureObservation))).toContain('pending')
    const reviewBytes = readFileSync(join(ROOT, candidate.contactSheet.review))
    expect(createHash('sha256').update(reviewBytes).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
  })
})
