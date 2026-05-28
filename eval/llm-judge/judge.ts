// LLM-as-judge harness for diagram quality.
//
// PERIODIC, NOT PER-PR. Runs on a fixed sample corpus, generates SVGs,
// asks a subagent to score readability 1-5 against a rubric. Aggregate
// score gates a periodic eval run (nightly / pre-release).
//
// This script writes a request file the harness picks up. In CI the
// scoring is mocked deterministically (see agent-llm-judge.test.ts). In
// production it would invoke a subagent — see runWithJudge() below.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseMermaid } from '../../src/agent/parse.ts'
import { renderMermaidSVG } from '../../src/agent/index.ts'
import { measureQuality, type QualityMetrics } from '../../src/agent/quality.ts'
import { layoutMermaid } from '../../src/agent/index.ts'

export interface JudgeRequest {
  origin: string
  family: string
  source: string
  svg: string
  metrics: QualityMetrics | null
  rubric: string
}

export interface JudgeScore {
  origin: string
  readability: number       // 1..5
  faithfulness: number      // 1..5 — does the diagram match the source semantics?
  aesthetics: number        // 1..5
  notes: string[]
}

export const RUBRIC = `
Rate the rendered Mermaid diagram on three axes, 1 (poor) to 5 (excellent).

1. **Readability** — Are all labels legible? Do labels overlap nodes or
   edges? Are edges easy to follow? Are arrows pointing the right way?

2. **Faithfulness** — Does the rendered diagram represent every node and
   edge in the source? Any silently dropped content?

3. **Aesthetics** — Is the layout balanced? Are nodes evenly spaced?
   Are crossings minimized? Is the overall feel professional?

Output strict JSON: { "readability": N, "faithfulness": N, "aesthetics": N, "notes": ["..."] }
`.trim()

export function buildJudgeRequest(family: string, source: string, origin: string): JudgeRequest | null {
  const p = parseMermaid(source)
  if (!p.ok) return null
  let svg: string
  try { svg = renderMermaidSVG(p.value) } catch { return null }
  let metrics: QualityMetrics | null = null
  if (p.value.body.kind === 'flowchart') {
    try { metrics = measureQuality(layoutMermaid(p.value)) } catch { /* ignore */ }
  }
  return { origin, family, source, svg, metrics, rubric: RUBRIC }
}

export function aggregateScores(scores: JudgeScore[]): {
  count: number
  medianReadability: number
  medianFaithfulness: number
  medianAesthetics: number
  overallMedian: number
} {
  if (scores.length === 0) return { count: 0, medianReadability: 0, medianFaithfulness: 0, medianAesthetics: 0, overallMedian: 0 }
  const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.5)]!
  const r = scores.map(s => s.readability)
  const f = scores.map(s => s.faithfulness)
  const a = scores.map(s => s.aesthetics)
  return {
    count: scores.length,
    medianReadability: med(r),
    medianFaithfulness: med(f),
    medianAesthetics: med(a),
    overallMedian: med(scores.map(s => (s.readability + s.faithfulness + s.aesthetics) / 3)),
  }
}

// ---- subagent interface --------------------------------------------------
//
// In CI we mock the judge. In a real periodic run, you would invoke the
// Agent tool with a prompt like:
//
//   Score this Mermaid diagram render against the rubric.
//   Source: <source>
//   SVG: <svg>
//   Rubric: <rubric>
//   Return strict JSON.
//
// And parse the response.

export type JudgeFn = (req: JudgeRequest) => Promise<JudgeScore>

export async function runWithJudge(requests: JudgeRequest[], judge: JudgeFn): Promise<JudgeScore[]> {
  const scores: JudgeScore[] = []
  for (const req of requests) {
    try { scores.push(await judge(req)) } catch (e) {
      scores.push({ origin: req.origin, readability: 1, faithfulness: 1, aesthetics: 1, notes: [`judge error: ${String(e)}`] })
    }
  }
  return scores
}

// ---- CLI entry: write requests to disk for a separate runner -------------

if (import.meta.main) {
  const corpusPath = process.argv[2] ?? join(import.meta.dir, '..', 'mermaid-docs-corpus', 'corpus.json')
  const outDir = process.argv[3] ?? join(import.meta.dir, 'requests')
  if (!existsSync(corpusPath)) { console.error(`corpus missing at ${corpusPath}`); process.exit(1) }
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
  // Stratified sample: up to 5 per family (small for periodic budgets)
  const byFamily: Record<string, any[]> = {}
  for (const e of corpus) (byFamily[e.family] = byFamily[e.family] || []).push(e)
  const samples: any[] = []
  for (const [family, entries] of Object.entries(byFamily)) {
    samples.push(...entries.slice(0, 5))
  }
  mkdirSync(outDir, { recursive: true })
  let n = 0
  for (const e of samples) {
    const req = buildJudgeRequest(e.family, e.source, `${e.origin}#${e.index}`)
    if (req) { writeFileSync(join(outDir, `req-${n}.json`), JSON.stringify(req, null, 2)); n++ }
  }
  console.log(`Wrote ${n} judge requests to ${outDir}`)
}
