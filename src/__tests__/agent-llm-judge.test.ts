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

  test('aggregateScores: per-axis medians and the median of per-diagram means', () => {
    const score = (origin: string, readability: number, faithfulness: number, aesthetics: number): JudgeScore =>
      ({ origin, readability, faithfulness, aesthetics, notes: [] })
    // Per-diagram means: 4, 2, 4, 3, 3 → median 3.
    const scores = [score('a', 5, 4, 3), score('b', 1, 2, 3), score('c', 4, 4, 4), score('d', 2, 5, 2), score('e', 3, 1, 5)]
    expect(aggregateScores(scores)).toEqual({ count: 5, medianReadability: 3, medianFaithfulness: 4, medianAesthetics: 3, overallMedian: 3 })
    expect(aggregateScores([])).toEqual({ count: 0, medianReadability: 0, medianFaithfulness: 0, medianAesthetics: 0, overallMedian: 0 })
  })

  // Harness wiring, not a quality gate: the scores come from this file's mock
  // judge, so this proves the sample → request → judge → aggregate pipeline runs
  // end to end and that the mock's floor holds.
  test('harness wiring: mock-judged stratified sample aggregates to a median ≥ 3.5', async () => {
    const sample = loadStratifiedSample(3)
    const requests = sample
      .map(e => buildJudgeRequest(e.family, e.source, `${e.origin}#${e.index}`))
      .filter((r): r is JudgeRequest => r !== null)
    const scores = await runWithJudge(requests, mockJudge)
    const agg = aggregateScores(scores)
    // A real judge would assert ≥ 4.0; the mock floor is documented at 3.5
    // because the mock penalty function is coarse.
    expect(agg.count).toBe(requests.length)
    expect(agg.count).toBeGreaterThan(0)
    expect(agg.overallMedian).toBeGreaterThanOrEqual(3.5)
  })
})
