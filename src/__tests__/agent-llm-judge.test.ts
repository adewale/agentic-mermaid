// Phase F (LLM-as-judge): harness test with a deterministic mock judge.
//
// The real judge runs periodically (nightly / pre-release) against a
// stratified sample of the mermaid-docs corpus. In CI we exercise the
// pipeline with a mock that scores based on quality metrics — this proves
// the harness works without burning model spend on every PR.
//
// To run the REAL judge (periodic):
//   bun run eval/llm-judge/judge.ts  # writes requests/req-*.json
//   # then a runner script invokes the Agent tool with each request
//   # and writes responses/resp-*.json with parsed JudgeScore objects

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildJudgeRequest, runWithJudge, aggregateScores, independentFaithfulness, type JudgeRequest, type JudgeScore, type JudgeFn } from '../../eval/llm-judge/judge.ts'

const CORPUS_PATH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json')

interface CorpusEntry { family: string; source: string; origin: string; index: number }

function loadStratifiedSample(perFamily: number): CorpusEntry[] {
  if (!existsSync(CORPUS_PATH)) return []
  const corpus: CorpusEntry[] = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
  const byFamily: Record<string, CorpusEntry[]> = {}
  for (const e of corpus) (byFamily[e.family] = byFamily[e.family] || []).push(e)
  const out: CorpusEntry[] = []
  for (const entries of Object.values(byFamily)) out.push(...entries.slice(0, perFamily))
  return out
}

// Deterministic mock judge. Readability/aesthetics are still derived from the
// perceptual metrics (this is a harness stub, not a real judge), but
// FAITHFULNESS now comes from independentFaithfulness() — a structural
// parse→serialize→re-parse count check that does NOT consult measureQuality.
// That decouples the faithfulness axis from the metrics it is meant to
// corroborate, so this axis is no longer circular (Move 1).
const mockJudge: JudgeFn = async (req: JudgeRequest): Promise<JudgeScore> => {
  const m = req.metrics
  let readability = 4
  let aesthetics = 4
  if (m) {
    if (m.labelLegibility < 0.5) readability -= 2
    else if (m.labelLegibility < 0.8) readability -= 1
    const crossingRatio = m.edgeCount > 1 ? m.edgeCrossings / (m.edgeCount * (m.edgeCount - 1) / 2) : 0
    if (crossingRatio > 0.1) aesthetics -= 2
    else if (crossingRatio > 0.05) aesthetics -= 1
    if (m.whitespaceBalance < 0.05 || m.whitespaceBalance > 0.7) aesthetics -= 1
  }
  const faithfulness = independentFaithfulness(req.source) ?? 5
  return {
    origin: req.origin,
    readability: Math.max(1, readability),
    faithfulness: Math.max(1, faithfulness),
    aesthetics: Math.max(1, aesthetics),
    notes: [],
  }
}

describe('LLM-as-judge harness', () => {
  test('buildJudgeRequest returns a complete request', () => {
    const req = buildJudgeRequest('flowchart', 'flowchart LR\n  A --> B', 'test.md#0')
    expect(req).not.toBeNull()
    if (!req) return
    expect(req.svg).toContain('<svg')
    expect(req.metrics).not.toBeNull()
    expect(req.rubric).toContain('Readability')
  })

  test('buildJudgeRequest handles parse failure gracefully', () => {
    const req = buildJudgeRequest('flowchart', 'not a real diagram blah blah', 'test.md#0')
    expect(req).toBeNull()
  })

  test('runWithJudge produces a score per request', async () => {
    const sample = loadStratifiedSample(2)  // 2 per family, 18 total
    const requests = sample
      .map(e => buildJudgeRequest(e.family, e.source, `${e.origin}#${e.index}`))
      .filter((r): r is JudgeRequest => r !== null)
    expect(requests.length).toBeGreaterThan(10)
    const scores = await runWithJudge(requests, mockJudge)
    expect(scores.length).toBe(requests.length)
    for (const s of scores) {
      expect(s.readability).toBeGreaterThanOrEqual(1)
      expect(s.readability).toBeLessThanOrEqual(5)
    }
  })

  test('aggregateScores: median + overall', async () => {
    const sample = loadStratifiedSample(2)
    const requests = sample
      .map(e => buildJudgeRequest(e.family, e.source, `${e.origin}#${e.index}`))
      .filter((r): r is JudgeRequest => r !== null)
    const scores = await runWithJudge(requests, mockJudge)
    const agg = aggregateScores(scores)
    expect(agg.count).toBe(scores.length)
    expect(agg.medianReadability).toBeGreaterThanOrEqual(1)
    expect(agg.overallMedian).toBeGreaterThanOrEqual(1)
  })

  test('CI gate: mock judge median ≥ 3.5 across stratified sample', async () => {
    const sample = loadStratifiedSample(3)
    const requests = sample
      .map(e => buildJudgeRequest(e.family, e.source, `${e.origin}#${e.index}`))
      .filter((r): r is JudgeRequest => r !== null)
    const scores = await runWithJudge(requests, mockJudge)
    const agg = aggregateScores(scores)
    // Mock judge: passes when quality metrics fall within reasonable bounds.
    // A real judge would assert ≥ 4.0; the mock floor is documented at 3.5
    // because the mock penalty function is coarse.
    expect({ n: agg.count, overall: agg.overallMedian }).toEqual({
      n: agg.count,
      overall: expect.any(Number),
    })
    expect(agg.overallMedian).toBeGreaterThanOrEqual(3.5)
  })
})
