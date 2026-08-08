import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { loadResearchHarvest, RESEARCH_HARVEST_PATH } from '../../eval/mermaid-intent-compatibility/harvest.ts'
import {
  INTENT_COMPATIBILITY_REPORT_PATH,
  renderIntentCompatibilityReport,
} from '../../eval/mermaid-intent-compatibility/report.ts'
import {
  MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS,
  demandTraceabilityScore,
  familyIntentScores,
} from '../../eval/mermaid-intent-compatibility/rubric.ts'
import {
  classifyResearchText,
  emptyReactionCounts,
  RESEARCH_MAX_AGE_DAYS,
  scoreResearchItem,
  validateResearchHarvest,
} from '../../eval/mermaid-intent-compatibility/research.ts'

const ROOT = resolve(import.meta.dir, '../..')

describe('Mermaid intent-compatibility rubric', () => {
  test('accounts for every built-in family exactly once', () => {
    const expected = BUILTIN_FAMILY_METADATA.map(item => item.id).sort()
    const actual = MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS.map(item => item.id).sort()
    expect(actual).toEqual(expected)
    expect(new Set(actual).size).toBe(actual.length)
  })

  test('makes semantic preservation primary and bounds executable evidence', () => {
    for (const assessment of MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS) {
      expect(assessment.contract.length, assessment.id).toBeGreaterThan(40)
      expect(assessment.preservedFacts.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.presentationFreedom.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.knownRisks.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.actions.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.evidence.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.researchFamilies.length, assessment.id).toBeGreaterThan(0)
      expect(assessment.researchCategories.length, assessment.id).toBeGreaterThan(0)
      expect(Object.keys(assessment.scores).sort()).toEqual([
        'communicativeEquivalence',
        'noSilentLoss',
        'semanticPreservation',
        'syntaxAcceptance',
      ])
      for (const score of Object.values(assessment.scores)) {
        expect(Number.isInteger(score), assessment.id).toBe(true)
        expect(score, assessment.id).toBeGreaterThanOrEqual(0)
        expect(score, assessment.id).toBeLessThanOrEqual(4)
      }
      for (const path of assessment.evidence) expect(existsSync(resolve(ROOT, path)), `${assessment.id}: ${path}`).toBe(true)
    }
  })

  test('classifies family and intent without making visual similarity a category', () => {
    const result = classifyResearchText(
      'subgraphs are not rendered properly',
      'The flowchart duplicates a subgraph and edges connect to phantom nodes. Labels overflow.',
      [],
    )
    expect(result.families).toContain('flowchart')
    expect(result.categories).toContain('semantic-correctness')
    expect(result.categories).toContain('layout-relationships')
    expect(result.categories).toContain('text-labels')
    expect(result.categories).not.toContain('visual-fidelity' as never)

    const genericUseCase = classifyResearchText(
      'Flowchart labels overlap',
      'This use case occurs in a large graph and should not become a Use Case diagram request.',
      [],
    )
    expect(genericUseCase.families).toContain('flowchart')
    expect(genericUseCase.families).not.toContain('usecase')
    expect(classifyResearchText('Add a Use Case diagram', '', []).families).toContain('usecase')
  })

  test('weights popularity and recent activity monotonically while discounting bots and PR supply', () => {
    const reactions = { ...emptyReactionCounts(), thumbsUp: 20, heart: 4 }
    const base = {
      kind: 'issue' as const,
      merged: false,
      authorIsBot: false,
      comments: 10,
      participants: 8,
      reviews: 0,
      reactions,
      referenceDate: '2026-08-01T00:00:00.000Z',
    }
    const recent = scoreResearchItem({ ...base, updatedAt: '2026-07-31T00:00:00.000Z' })
    const old = scoreResearchItem({ ...base, updatedAt: '2020-01-01T00:00:00.000Z' })
    const bot = scoreResearchItem({ ...base, authorIsBot: true, updatedAt: '2026-07-31T00:00:00.000Z' })
    const pr = scoreResearchItem({ ...base, kind: 'pull-request', updatedAt: '2026-07-31T00:00:00.000Z' })
    const unpopular = scoreResearchItem({ ...base, comments: 0, participants: 1, reactions: emptyReactionCounts(), updatedAt: '2026-07-31T00:00:00.000Z' })
    expect(recent.score).toBeGreaterThan(old.score)
    expect(recent.score).toBeGreaterThan(bot.score)
    expect(recent.score).toBeGreaterThan(pr.score)
    expect(recent.score).toBeGreaterThan(unpopular.score)
    expect(old.recency).toBeGreaterThanOrEqual(0.2)
  })

  test('derives demand maturity rather than assigning it', () => {
    const stub = (repository: 'mermaid-js/mermaid' | 'lukilabs/beautiful-mermaid', kind: 'issue' | 'pull-request') => ({ repository, kind })
    expect(demandTraceabilityScore([])).toBe(0)
    expect(demandTraceabilityScore([stub('mermaid-js/mermaid', 'issue')] as never)).toBe(1)
    expect(demandTraceabilityScore(Array.from({ length: 5 }, () => stub('mermaid-js/mermaid', 'issue')) as never)).toBe(2)
    const tokenCrossSource = Array.from({ length: 12 }, (_, index) => stub(
      index === 0 ? 'lukilabs/beautiful-mermaid' : 'mermaid-js/mermaid',
      index === 1 ? 'pull-request' : 'issue',
    ))
    expect(demandTraceabilityScore(tokenCrossSource as never)).toBe(2)
    const complete = Array.from({ length: 12 }, (_, index) => stub(
      index % 2 === 0 ? 'mermaid-js/mermaid' : 'lukilabs/beautiful-mermaid',
      index % 3 === 0 ? 'pull-request' : 'issue',
    ))
    expect(demandTraceabilityScore(complete as never)).toBe(3)
  })

  test('validates the frozen crawl and generated report', () => {
    expect(existsSync(RESEARCH_HARVEST_PATH)).toBe(true)
    const harvest = loadResearchHarvest()
    validateResearchHarvest(harvest)
    for (const assessment of MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS) {
      const scores = familyIntentScores(assessment, harvest)
      expect(scores.overall).toBeGreaterThanOrEqual(0)
      expect(scores.overall).toBeLessThanOrEqual(100)
    }
    expect(readFileSync(INTENT_COMPATIBILITY_REPORT_PATH, 'utf8')).toBe(renderIntentCompatibilityReport(harvest))

    const changedWeighting = structuredClone(harvest)
    changedWeighting.weighting.activityHalfLifeDays++
    expect(() => validateResearchHarvest(changedWeighting)).toThrow('Research weighting policy changed')

    const tampered = structuredClone(harvest)
    tampered.items[0]!.title += ' tampered'
    expect(() => validateResearchHarvest(tampered)).toThrow('Research harvest content digest does not match')

    const staleDate = new Date(Date.parse(harvest.capturedAt) + (RESEARCH_MAX_AGE_DAYS + 1) * 86_400_000)
    expect(() => validateResearchHarvest(harvest, staleDate)).toThrow('Research harvest is stale')
  })
})
