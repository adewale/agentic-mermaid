import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finalCodexMessage, materializeCodexOutputs, materializeRunOutput } from '../../scripts/eval/materialize-codex-output.ts'
import type { ExecutionReceipt } from '../../scripts/eval/run-codex-evidence.ts'

function trace(...messages: string[]): string {
  return `${messages
    .map((text, index) =>
      JSON.stringify({
        type: 'item.completed',
        item: { id: `item_${index}`, type: 'agent_message', text },
      }),
    )
    .join('\n')}\n`
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

test('extracts the last full Codex agent message', () => {
  expect(finalCodexMessage(trace('progress', 'final answer'))).toBe('final answer')
})

test('materializes only exact-prefix truncation and preserves the harness artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-output-materialization-'))
  try {
    const run = join(root, 'case/with_skill/run-1')
    mkdirSync(run, { recursive: true })
    const final = `Explanation\n\n\`\`\`json\n{"tool":"verify","arguments":{"source":"flowchart TD\\nA-->B"}}\n\`\`\``
    writeFileSync(join(run, 'trace.jsonl'), trace('progress', final))
    writeFileSync(join(run, 'output.md'), final.slice(0, 50))
    const result = materializeRunOutput(run)
    expect(result.changed).toBe(true)
    expect(readFileSync(join(run, 'output.harness.md'), 'utf8')).toBe(final.slice(0, 50))
    expect(readFileSync(join(run, 'output.md'), 'utf8')).toBe(final)
    const rerun = materializeCodexOutputs(root, executionReceipt(root))
    expect(rerun.receipt).toMatchObject({ schemaVersion: 2, traceCount: 1, materializedCount: 1, alreadyCompleteCount: 0 })
    expect(rerun.receipt.runs[0]).toMatchObject({ runDir: 'case/with_skill/run-1', materialized: true })
    expect(rerun.receipt.runs[0]!.harnessOutputDigest).not.toBe(rerun.receipt.runs[0]!.outputDigest)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a reused run directory instead of pairing a new trace with a stale backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-output-reuse-'))
  try {
    const first = 'First complete answer'
    writeFileSync(join(root, 'trace.jsonl'), trace(first))
    writeFileSync(join(root, 'output.md'), first.slice(0, 8))
    materializeRunOutput(root)
    const second = 'Second complete answer'
    writeFileSync(join(root, 'trace.jsonl'), trace(second))
    writeFileSync(join(root, 'output.md'), second.slice(0, 8))
    expect(() => materializeRunOutput(root)).toThrow('refusing reused run directory with an existing harness backup')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses to replace output that is not a trace-message prefix', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-output-mismatch-'))
  try {
    writeFileSync(join(root, 'trace.jsonl'), trace('real final'))
    writeFileSync(join(root, 'output.md'), 'different output')
    expect(() => materializeRunOutput(root)).toThrow('refusing non-prefix output rewrite')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
