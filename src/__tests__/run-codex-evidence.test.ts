import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stableDigest } from '../../scripts/eval/prepare-skill-evidence.ts'
import { assertDeclaredRunnerVersion, assertExplicitCodexConfig, assertRunnerVersion, preparedTaskFileDigest, validateCodexRunResults } from '../../scripts/eval/run-codex-evidence.ts'

test('execution provenance requires explicit model and reasoning selections', () => {
  expect(() => assertExplicitCodexConfig('codex exec --json -', 'gpt-test', 'low')).toThrow('declared --model')
  expect(() => assertExplicitCodexConfig('codex exec --model gpt-test --json -', 'gpt-test', 'low')).toThrow('declared --reasoning-effort')
  expect(() => assertExplicitCodexConfig('codex exec --model gpt-test -c model_reasoning_effort=low --json -', 'gpt-test', 'low')).not.toThrow()
})

test('execution provenance binds the exact prepared task list', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-run-receipt-'))
  try {
    const path = join(root, 'tasks.jsonl')
    const tasks = [
      { case_id: 'a', variant: 'with_skill' },
      { case_id: 'a', variant: 'without_skill' },
    ]
    writeFileSync(path, `${tasks.map(task => JSON.stringify(task)).join('\n')}\n`)
    expect(preparedTaskFileDigest(path)).toBe(stableDigest(tasks))
    writeFileSync(path, `${JSON.stringify(tasks[0])}\n`)
    expect(preparedTaskFileDigest(path)).not.toBe(stableDigest(tasks))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('execution provenance verifies the declared harness package version', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-runner-version-'))
  try {
    const runner = join(root, 'skill-benchmark')
    expect(() => assertDeclaredRunnerVersion('0.6.0', '0.4.0')).toThrow('does not match runner package')
    expect(() => assertDeclaredRunnerVersion('0.6.0', '0.6.0')).not.toThrow()
    writeFileSync(runner, '#!/usr/bin/env python3\n')
    expect(() => assertRunnerVersion(runner, '0.6.0')).toThrow('unsupported interpreter command')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('execution provenance rejects provider failures hidden behind runner exit zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-run-results-'))
  try {
    const successful = join(root, 'case/with_skill/run-1')
    const failed = join(root, 'case/without_skill/run-1')
    mkdirSync(successful, { recursive: true })
    mkdirSync(failed, { recursive: true })
    const completeMetrics = {
      returncode: 0,
      observation_complete: true,
      process_observation_complete: true,
      trace_observation_complete: true,
      provider_response_complete: true,
      operation_observation_complete: true,
    }
    writeFileSync(join(successful, 'metrics.json'), JSON.stringify(completeMetrics))
    writeFileSync(join(successful, 'trace.jsonl'), `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } })}\n`)
    writeFileSync(join(successful, 'output.md'), 'answer')
    writeFileSync(join(failed, 'metrics.json'), JSON.stringify({ ...completeMetrics, returncode: 1, provider_response_complete: false }))
    writeFileSync(join(failed, 'trace.jsonl'), `${JSON.stringify({ type: 'turn.failed' })}\n`)
    writeFileSync(join(failed, 'output.md'), '[CODEX FAILURE]')

    const validation = validateCodexRunResults([
      { run_dir: 'case/with_skill/run-1' },
      { run_dir: 'case/without_skill/run-1' },
    ], root)
    expect(validation).toMatchObject({ expectedCount: 2, completeCount: 1 })
    expect(validation.failures).toEqual([
      {
        runDir: 'case/without_skill/run-1',
        problems: expect.arrayContaining([
          'provider returncode is 1',
          'provider_response_complete is not true',
          'trace has no completed agent_message',
        ]),
      },
    ])
    expect(() => validateCodexRunResults([{ run_dir: '../escape' }], root)).not.toThrow()
    expect(validateCodexRunResults([{ run_dir: '../escape' }], root).failures[0]!.problems).toContain('run_dir escapes or aliases the runs root')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
