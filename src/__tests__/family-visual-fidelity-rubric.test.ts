import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import {
  MERMAID_FAMILY_FIDELITY_ASSESSMENTS,
  familyFidelityScores,
} from '../../eval/mermaid-family-fidelity/rubric.ts'
import {
  FAMILY_FIDELITY_REPORT_PATH,
  renderFamilyFidelityReport,
} from '../../eval/mermaid-family-fidelity/report.ts'

const ROOT = resolve(import.meta.dir, '../..')

describe('secondary Mermaid visual-familiarity audit', () => {
  test('accounts for every built-in family exactly once', () => {
    const expected = BUILTIN_FAMILY_METADATA.map(item => item.id).sort()
    const actual = MERMAID_FAMILY_FIDELITY_ASSESSMENTS.map(item => item.id).sort()
    expect(actual).toEqual(expected)
    expect(new Set(actual).size).toBe(actual.length)
  })

  test('keeps visual fidelity separate from artifact quality and bounds every score', () => {
    for (const assessment of MERMAID_FAMILY_FIDELITY_ASSESSMENTS) {
      expect(Object.keys(assessment.scores.visual).sort()).toEqual([
        'labelsTypography', 'layoutGeometry', 'paintStyling', 'routingTopology', 'upstreamDifferential',
      ])
      expect(Object.keys(assessment.scores.quality).sort()).toEqual([
        'configurationParity', 'correctnessCoverage', 'determinism', 'robustness', 'semanticsAccessibility',
      ])
      for (const score of [...Object.values(assessment.scores.visual), ...Object.values(assessment.scores.quality)]) {
        expect(Number.isInteger(score), `${assessment.id} score`).toBe(true)
        expect(score, `${assessment.id} score`).toBeGreaterThanOrEqual(0)
        expect(score, `${assessment.id} score`).toBeLessThanOrEqual(4)
      }
      const totals = familyFidelityScores(assessment)
      expect(totals.visual).toBeGreaterThanOrEqual(0)
      expect(totals.visual).toBeLessThanOrEqual(100)
      expect(totals.quality).toBeGreaterThanOrEqual(0)
      expect(totals.quality).toBeLessThanOrEqual(100)
      expect(assessment.strengths.length).toBeGreaterThan(0)
      expect(assessment.gaps.length).toBeGreaterThan(0)
      expect(assessment.actions.length).toBeGreaterThan(0)
    }
  })

  test('pins every upstream engine/library claim to Mermaid 11.16 source-map content', () => {
    for (const assessment of MERMAID_FAMILY_FIDELITY_ASSESSMENTS) {
      expect(assessment.upstreamEvidence.length, assessment.id).toBeGreaterThan(0)
      for (const evidence of assessment.upstreamEvidence) {
        const mapPath = resolve(ROOT, evidence.sourceMap)
        expect(existsSync(mapPath), `${assessment.id}: ${evidence.sourceMap}`).toBe(true)
        const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources: string[]; sourcesContent: Array<string | null> }
        const index = map.sources.findIndex(source => source.endsWith(evidence.source))
        expect(index, `${assessment.id}: ${evidence.source}`).toBeGreaterThanOrEqual(0)
        const source = map.sourcesContent[index] ?? ''
        for (const token of evidence.tokens) {
          expect(source.includes(token), `${assessment.id}: ${evidence.source} missing ${token}`).toBe(true)
        }
      }
      for (const path of assessment.agenticEvidence) {
        expect(existsSync(resolve(ROOT, path)), `${assessment.id}: ${path}`).toBe(true)
      }
    }
  })

  test('keeps the generated audit in sync', () => {
    expect(readFileSync(FAMILY_FIDELITY_REPORT_PATH, 'utf8')).toBe(renderFamilyFidelityReport())
  })
})
