import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeComparison } from '../../scripts/eval/summarize-skill-evidence.ts'

test('comparison summary enforces run counts and reports cached-token cost', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-evidence-summary-'))
  try {
    const makeRow = (label: string, variant: 'with_skill' | 'without_skill', passRate: number, timeout = false) => {
      const runBase = join(root, label, variant)
      mkdirSync(runBase, { recursive: true })
      writeFileSync(join(runBase, 'trace.jsonl'), `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } })}\n`)
      return { case_id: 'case', variant, run_number: 1, kind: 'positive', domain: 'mcp', difficulty: 'core', trigger_type: 'explicit', objective_pass_rate: passRate, missing_output: false, run_base: runBase, metadata: { elapsed_ms: 100, timeout } }
    }
    const cohort = {
      comparison: { baseline: 'a', candidate: 'b' },
      behavior: { cases: ['case'], minimumRunsPerVariant: 1 },
      executor: { runner: 'skill-eval-harness', runnerVersion: '0.4.0', model: 'snapshot' },
      pricingUsdPerMillionTokens: { input: 0.75, cachedInput: 0.075, output: 4.5, source: 'official', checkedAt: '2026-07-28' },
    }
    const summary = summarizeComparison(
      { results: [makeRow('before', 'with_skill', 0.5), makeRow('before', 'without_skill', 0.25)] },
      { results: [makeRow('after', 'with_skill', 1), makeRow('after', 'without_skill', 0.5)] },
      cohort,
      { baseline: 'sha256:before', candidate: 'sha256:after' },
    ) as any
    expect(summary.expectedRunsPerCommit).toBe(2)
    expect(summary.objectivePassRateDelta).toEqual({ with_skill: 0.5, without_skill: 0.25 })
    expect(summary.candidate.treatmentGain).toEqual({ absolute: 0.5, normalized: 1 })
    expect(summary.treatmentGainDelta.absolute).toBe(0.25)
    expect(summary.treatmentGainDelta.normalized).toBeCloseTo(2 / 3)
    expect(summary.manifestDigests).toEqual({ baseline: 'sha256:before', candidate: 'sha256:after' })
    expect(summary.candidate.slices.case_id.case.with_skill.runs).toBe(1)
    expect(summary.candidate.variants.with_skill.tokens).toEqual({ input: 100, cachedInput: 40, uncachedInput: 60, output: 10 })
    expect(summary.candidate.variants.with_skill.estimatedCostUsd).toBeCloseTo(0.000093)
    expect(summary.baseline.falseNegatives).toHaveLength(1)
    expect(() => summarizeComparison(
      { results: [makeRow('timeout-before', 'with_skill', 1, true), makeRow('timeout-before', 'without_skill', 0)] },
      { results: [makeRow('timeout-after', 'with_skill', 1), makeRow('timeout-after', 'without_skill', 0)] },
      cohort,
    )).toThrow('cohort contains timeouts')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
