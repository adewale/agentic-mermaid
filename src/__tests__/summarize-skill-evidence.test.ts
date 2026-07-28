import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeCodexOutputs } from '../../scripts/eval/materialize-codex-output.ts'
import type { ExecutionReceipt } from '../../scripts/eval/run-codex-evidence.ts'
import { summarizeComparison } from '../../scripts/eval/summarize-skill-evidence.ts'

type Variant = 'with_skill' | 'without_skill'

const pricing = { input: 0.75, cachedInput: 0.075, output: 4.5, source: 'official', checkedAt: '2026-07-28' }

function makeRow(root: string, label: string, variant: Variant, passRate: number, runNumber = 1, timeout = false) {
  const runBase = join(root, label, 'case', variant, `run-${runNumber}`)
  mkdirSync(runBase, { recursive: true })
  const trace = [
    { type: 'item.completed', item: { type: 'agent_message', text: 'complete output' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } },
  ]
    .map(value => JSON.stringify(value))
    .join('\n')
  writeFileSync(join(runBase, 'trace.jsonl'), `${trace}\n`)
  writeFileSync(join(runBase, 'output.md'), 'complete output')
  return {
    case_id: 'case',
    variant,
    run_number: runNumber,
    kind: 'positive',
    domain: 'mcp',
    difficulty: 'core',
    trigger_type: 'explicit',
    objective_pass_rate: passRate,
    missing_output: false,
    run_base: runBase,
    deferred_judge_tasks: 1,
    metadata: { elapsed_ms: 100, timeout },
  }
}

function cohort(runs = 1) {
  return {
    comparison: { baseline: 'a', candidate: 'b' },
    behavior: { cases: ['case'], minimumRunsPerVariant: runs, releaseRunsPerVariant: 5 },
    executor: { runner: 'skill-eval-harness', runnerVersion: '0.6.0', model: 'snapshot', reasoningEffort: 'low' },
    pricingUsdPerMillionTokens: pricing,
  }
}

function executionReceipt(runsRoot: string): ExecutionReceipt {
  return {
    schemaVersion: 1,
    runner: 'skill-eval-harness',
    runnerVersion: '0.6.0',
    runnerBinary: '/runner',
    runnerBinaryDigest: `sha256:${'1'.repeat(64)}`,
    model: 'snapshot',
    reasoningEffort: 'low',
    codexCommand: 'codex --model snapshot --reasoning low',
    command: ['wrapper'],
    runnerCommands: [['runner']],
    concurrency: 1,
    tasksPath: '/tasks.jsonl',
    tasksDigest: `sha256:${'2'.repeat(64)}`,
    runsRoot,
    startedAt: '2026-07-28T00:00:00.000Z',
    completedAt: '2026-07-28T00:01:00.000Z',
    exitCode: 0,
  }
}

test('comparison summary enforces run counts and reports honest graded-assertion metrics', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-evidence-summary-'))
  try {
    const summary = summarizeComparison({ results: [makeRow(root, 'before', 'with_skill', 0.5), makeRow(root, 'before', 'without_skill', 0.25)] }, { results: [makeRow(root, 'after', 'with_skill', 1), makeRow(root, 'after', 'without_skill', 0.5)] }, cohort(), {
      baseline: 'sha256:before',
      candidate: 'sha256:after',
    }) as any
    expect(summary.expectedRunsPerTreatment).toBe(2)
    expect(summary.evidenceProfile).toBe('iteration')
    expect(summary.objectivePassRateDelta).toEqual({ with_skill: 0.5, without_skill: 0.25 })
    expect(summary.allGradedAssertionsPassRateDelta).toEqual({ with_skill: 1, without_skill: 0 })
    expect(summary.wholeTaskPassRateDelta).toBeUndefined()
    expect(summary.candidate.treatmentGain).toMatchObject({ absolute: 0.5, normalized: 1, allGradedAssertionsAbsolute: 1, allGradedAssertionsNormalized: 1 })
    expect(summary.treatmentGainDelta.absolute).toBe(0.25)
    expect(summary.treatmentGainDelta.normalized).toBeCloseTo(2 / 3)
    expect(summary.manifestDigests).toEqual({ baseline: 'sha256:before', candidate: 'sha256:after' })
    expect(summary.candidate.slices.case_id.case.with_skill.runs).toBe(1)
    expect(summary.candidate.variants.with_skill.tokens).toEqual({ input: 100, cachedInput: 40, uncachedInput: 60, output: 10 })
    expect(summary.candidate.variants.with_skill.estimatedCostUsd).toBeCloseTo(0.000093)
    expect(summary.candidate.variants.with_skill.deferredSemanticJudgeRows).toBe(1)
    expect(summary.baseline.imperfectPositiveRows).toHaveLength(1)
    expect(() => summarizeComparison({ results: [makeRow(root, 'timeout-before', 'with_skill', 1, 1, true), makeRow(root, 'timeout-before', 'without_skill', 0)] }, { results: [makeRow(root, 'timeout-after', 'with_skill', 1), makeRow(root, 'timeout-after', 'without_skill', 0)] }, cohort())).toThrow(
      'cohort contains timeouts',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('causal summary rejects identical treatments, changed stimuli, workspace drift, and task-file drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-causal-summary-'))
  try {
    const report = (label: string) => ({ results: [makeRow(root, label, 'with_skill', 1), makeRow(root, label, 'without_skill', 1)] })
    const causalCohort = {
      ...cohort(),
      comparison: {
        baseline: 'old',
        candidate: 'new',
        design: 'skill-only',
        requireSameWorkspace: true,
        requireSameFixtures: true,
        requireSameStimuli: true,
        requireSameSchedule: true,
        requireSameTreatmentPaths: true,
        requireDifferentTreatments: true,
        requireSameManifest: true,
      },
    }
    const receipt = {
      workspaceRoot: '/neutral',
      workspaceDigest: 'workspace',
      fixtureDigest: 'fixtures',
      treatmentDigest: 'same',
      stimulusDigest: 'stimulus',
      scheduleDigest: 'schedule',
      treatmentPaths: ['skills/workflow'],
      taskCount: 2,
      preparedTasksDigest: 'tasks',
    }
    const manifests = { baseline: 'manifest', candidate: 'manifest' }
    const taskDigests = { baseline: 'tasks', candidate: 'tasks' }
    expect(() => summarizeComparison(report('before'), report('after'), causalCohort, manifests, { baseline: receipt, candidate: receipt }, undefined, taskDigests)).toThrow('causal comparison failed differentTreatments')
    expect(() =>
      summarizeComparison(
        report('before'),
        report('after'),
        causalCohort,
        manifests,
        {
          baseline: { ...receipt, treatmentDigest: 'old' },
          candidate: { ...receipt, treatmentDigest: 'new', stimulusDigest: 'changed' },
        },
        undefined,
        taskDigests,
      ),
    ).toThrow('causal comparison failed sameStimuli')
    expect(() =>
      summarizeComparison(
        report('before'),
        report('after'),
        causalCohort,
        manifests,
        {
          baseline: { ...receipt, treatmentDigest: 'old' },
          candidate: { ...receipt, treatmentDigest: 'new', workspaceDigest: 'changed' },
        },
        undefined,
        taskDigests,
      ),
    ).toThrow('causal comparison failed sameWorkspace')
    expect(() =>
      summarizeComparison(
        report('before'),
        report('after'),
        causalCohort,
        manifests,
        {
          baseline: { ...receipt, treatmentDigest: 'old' },
          candidate: { ...receipt, treatmentDigest: 'new' },
        },
        undefined,
        { baseline: 'tasks', candidate: 'different-tasks' },
      ),
    ).toThrow('candidate preparation receipt does not match prepared tasks')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('output receipts are recomputed and bound to exact report run directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-output-summary-'))
  try {
    const before = { results: [makeRow(root, 'before', 'with_skill', 1), makeRow(root, 'before', 'without_skill', 1)] }
    const after = { results: [makeRow(root, 'after', 'with_skill', 1), makeRow(root, 'after', 'without_skill', 1)] }
    const beforeRoot = join(root, 'before')
    const afterRoot = join(root, 'after')
    const beforeReceipt = materializeCodexOutputs(beforeRoot, executionReceipt(beforeRoot)).receipt
    const afterReceipt = materializeCodexOutputs(afterRoot, executionReceipt(afterRoot)).receipt
    const verified = summarizeComparison(before, after, cohort(), undefined, undefined, {
      baseline: beforeReceipt,
      candidate: afterReceipt,
    }) as any
    expect(verified.outputMaterializationReceipts.baseline.runs).toHaveLength(2)
    const forged = structuredClone(beforeReceipt)
    forged.runs[0]!.traceDigest = `sha256:${'1'.repeat(64)}`
    expect(() =>
      summarizeComparison(before, after, cohort(), undefined, undefined, {
        baseline: forged,
        candidate: afterReceipt,
      }),
    ).toThrow('baseline output receipt traceDigest mismatch')
    const wrongRoot = { ...beforeReceipt, runsRoot: join(root, 'after') }
    expect(() =>
      summarizeComparison(before, after, cohort(), undefined, undefined, {
        baseline: wrongRoot,
        candidate: afterReceipt,
      }),
    ).toThrow('baseline execution receipt runsRoot mismatch')
    const archivedBeforeRoot = join(root, 'archived-before')
    const archivedAfterRoot = join(root, 'archived-after')
    renameSync(beforeRoot, archivedBeforeRoot)
    renameSync(afterRoot, archivedAfterRoot)
    const overrides = { baseline: archivedBeforeRoot, candidate: archivedAfterRoot }
    const relocated = summarizeComparison(before, after, cohort(), undefined, undefined, { baseline: beforeReceipt, candidate: afterReceipt }, undefined, 'iteration', overrides) as any
    expect(relocated.baseline.variants.with_skill.tokens.input).toBe(100)
    const regradedBefore = { results: before.results.map(row => ({ ...row, run_base: row.run_base.replace(beforeRoot, archivedBeforeRoot) })) }
    const regradedAfter = { results: after.results.map(row => ({ ...row, run_base: row.run_base.replace(afterRoot, archivedAfterRoot) })) }
    expect(() => summarizeComparison(regradedBefore, regradedAfter, cohort(), undefined, undefined, { baseline: beforeReceipt, candidate: afterReceipt }, undefined, 'iteration', overrides)).not.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release profile accepts exactly the documented five repetitions per variant', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-release-summary-'))
  try {
    const rows = (label: string, repetitions: number) => ({
      results: (['with_skill', 'without_skill'] as const).flatMap(variant => Array.from({ length: repetitions }, (_, index) => makeRow(root, label, variant, 1, index + 1))),
    })
    expect(() => summarizeComparison(rows('short-before', 3), rows('short-after', 3), cohort(3), undefined, undefined, undefined, undefined, 'release')).toThrow('expected 10 cohort results, found 6')
    const summary = summarizeComparison(rows('before', 5), rows('after', 5), cohort(3), undefined, undefined, undefined, undefined, 'release') as any
    expect(summary).toMatchObject({ evidenceProfile: 'release', runsPerVariant: 5, expectedRunsPerTreatment: 10 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
