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
import { parseRegisteredMermaid as parseMermaid } from '../../src/agent/parse.ts'
import { renderMermaidSVG, serializeMermaid } from '../../src/agent/index.ts'
import { measureQuality, type QualityMetrics } from '../../src/agent/quality.ts'
import { layoutMermaid } from '../../src/agent/index.ts'
import { runBatchedOperations } from '../../src/shared/batched.ts'
import { countStructuralElements, countsEqual } from '../shared/structural-count.ts'

/** A blessed reference render to anchor the judge (reference-guided judging,
 *  Zheng et al. 2023 — reduces judge variance vs. scoring in a vacuum). */
export interface JudgeReference {
  svg: string
  note?: string
}

export interface JudgeRequest {
  origin: string
  family: string
  source: string
  svg: string
  metrics: QualityMetrics | null
  rubric: string
  /** Optional golden anchor for reference-guided scoring. */
  reference?: JudgeReference
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

export function buildJudgeRequest(
  family: string, source: string, origin: string, reference?: JudgeReference,
): JudgeRequest | null {
  const p = parseMermaid(source)
  if (!p.ok) return null
  let svg: string
  try { svg = renderMermaidSVG(p.value) } catch { return null }
  let metrics: QualityMetrics | null = null
  if (p.value.body.kind === 'flowchart') {
    try { metrics = measureQuality(layoutMermaid(p.value)) } catch { /* ignore */ }
  }
  return { origin, family, source, svg, metrics, rubric: RUBRIC, ...(reference ? { reference } : {}) }
}

// ============================================================================
// Protocol hardening (Move 1) — the gaps the original harness left open.
//
// The CI judge is a deterministic mock derived from measureQuality (see the
// test), so it cannot independently validate the perceptual metrics — it is
// wiring, not judgment. The primitives below make the REAL (periodic) judge
// trustworthy by implementing the documented LLM-judge mitigations from
// Zheng et al., "Judging LLM-as-a-Judge" (NeurIPS 2023):
//   • position bias  → judgePairwiseDebiased scores both orders and only
//                       trusts a verdict the two orders agree on.
//   • self-enhancement→ assertJudgeIndependence refuses a judge from the same
//                       model family that authored the diagram.
//   • scoring variance→ JudgeReference threads a golden anchor (above).
// And independentFaithfulness gives faithfulness an oracle that does NOT come
// from measureQuality, breaking the metric↔judge circularity for that axis.
// ============================================================================

/** Decide which of two renders is better. Used for the de-biasing wrapper. */
export type PairwiseJudgeFn = (left: JudgeRequest, right: JudgeRequest) => Promise<'left' | 'right' | 'tie'>

export interface DebiasedVerdict {
  /** 'a'/'b' when both orders agree; 'inconsistent' when the judge flipped. */
  winner: 'a' | 'b' | 'tie' | 'inconsistent'
  raw: { ab: 'left' | 'right' | 'tie'; ba: 'left' | 'right' | 'tie' }
}

/**
 * Run a pairwise judge in BOTH orders and only trust a verdict the two orders
 * agree on. A position-biased judge (always picks the first/left option) flips
 * its answer when the inputs swap, so this returns 'inconsistent' rather than a
 * biased winner.
 */
export async function judgePairwiseDebiased(
  a: JudgeRequest, b: JudgeRequest, judge: PairwiseJudgeFn,
): Promise<DebiasedVerdict> {
  const ab = await judge(a, b)   // a on the left
  const ba = await judge(b, a)   // a on the right
  const firstSaysA = ab === 'left' ? 'a' : ab === 'right' ? 'b' : 'tie'
  const secondSaysA = ba === 'left' ? 'b' : ba === 'right' ? 'a' : 'tie'
  if (firstSaysA === secondSaysA) return { winner: firstSaysA, raw: { ab, ba } }
  return { winner: 'inconsistent', raw: { ab, ba } }
}

/** Coarse model-family bucket: 'claude-opus-4-8' → 'claude', 'gpt-4o' → 'gpt'. */
export function modelFamily(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude') || m.includes('anthropic')) return 'claude'
  if (m.startsWith('gpt') || m.includes('openai') || m.startsWith('o1') || m.startsWith('o3')) return 'gpt'
  if (m.includes('gemini') || m.includes('google')) return 'gemini'
  if (m.includes('llama')) return 'llama'
  return m.split(/[-_/ ]/)[0] ?? m
}

/**
 * Guard against self-enhancement bias: a judge from the same model family that
 * authored the diagram favors its own output by 10–25% (Zheng et al.). Throw so
 * a periodic run cannot silently grade itself.
 */
export function assertJudgeIndependence(authorModel: string, judgeModel: string): void {
  if (modelFamily(authorModel) === modelFamily(judgeModel)) {
    throw new Error(
      `judge independence violation: judge '${judgeModel}' shares model family ` +
      `'${modelFamily(judgeModel)}' with the author '${authorModel}'. Use a different family.`,
    )
  }
}

/**
 * Faithfulness oracle that is INDEPENDENT of measureQuality (and of the LLM):
 * 5 when a parse → serialize → re-parse cycle preserves the structured
 * {nodes, edges, groups} tally, lower when content is dropped. This is the
 * "every node and edge from the source is present" axis of the rubric grounded
 * in a structural check rather than in the perceptual metrics it is meant to
 * corroborate. Returns null for sources that don't parse or are opaque.
 */
export function independentFaithfulness(source: string): number | null {
  const p1 = parseMermaid(source)
  if (!p1.ok) return null
  const before = countStructuralElements(p1.value)
  if (!before) return null
  try {
    const p2 = parseMermaid(serializeMermaid(p1.value))
    if (!p2.ok) return 1
    const after = countStructuralElements(p2.value)
    if (!after) return 1
    if (countsEqual(before, after)) return 5
    // Partial loss scales the penalty by how much of the content survived.
    const total = before.nodes + before.edges + before.groups
    const kept = Math.min(after.nodes, before.nodes) + Math.min(after.edges, before.edges) + Math.min(after.groups, before.groups)
    const frac = total > 0 ? kept / total : 1
    return Math.max(1, Math.round(1 + frac * 4))
  } catch {
    return 1
  }
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
  // Loop 9 M8: delegate to the shared runBatchedOperations scaffold. The
  // judge's per-request fallback (minimum scores + judge error note) is
  // restored from the failure entry on the way out.
  const results = await runBatchedOperations(requests, judge, { errorCode: 'JUDGE_ERROR' })
  return results.map((entry, i) => {
    if (entry.ok) return entry.value
    return {
      origin: requests[i]!.origin,
      readability: 1, faithfulness: 1, aesthetics: 1,
      notes: [`judge error: ${entry.error.message}`],
    }
  })
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
