// The trace sink records op OUTCOMES, not just calls: a failed mutate/checked-op
// writes `{verb:"mutate",ok:false}`, a successful one `{verb:"mutate",ok:true}`.
// This is the observable signal the agent-usage eval reads to measure a run's
// op-error rate directly, instead of inferring retries from excess call counts.

import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate, mutateChecked } from '../agent/mutate.ts'
import type { AnyMutationOp, MutableValidDiagram } from '../agent/types.ts'

const SRC = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start'

function parseState(): MutableValidDiagram {
  const p = parseMermaid(SRC)
  if (!p.ok) throw new Error('fixture failed to parse')
  return p.value as MutableValidDiagram
}

function withTraceLog(fn: (log: string) => void): Array<{ verb: string; ok?: boolean }> {
  const dir = mkdtempSync(join(tmpdir(), 'am-trace-'))
  const log = join(dir, 'trace.jsonl')
  const prev = process.env.AM_TRACE_LOG
  process.env.AM_TRACE_LOG = log
  try {
    fn(log)
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  } finally {
    if (prev === undefined) delete process.env.AM_TRACE_LOG
    else process.env.AM_TRACE_LOG = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('trace sink observes op outcomes', () => {
  test('a successful mutate logs {ok:true}; a failed one logs {ok:false}', () => {
    const d = parseState()
    const lines = withTraceLog(() => {
      // success
      mutate(d, { kind: 'add_transition', from: 'Processing', to: '[*]', label: 'done' } as AnyMutationOp)
      // semantic failure: remove a transition index that doesn't exist
      mutate(d, { kind: 'remove_transition', index: 99 } as AnyMutationOp)
    })
    const mut = lines.filter(l => l.verb === 'mutate')
    expect(mut.length).toBe(2)
    expect(mut[0]!.ok).toBe(true)
    expect(mut[1]!.ok).toBe(false)
  })

  test('the checked-path op-array slip is counted as a failed attempt', () => {
    const d = parseState()
    const lines = withTraceLog(() => {
      const r = mutateChecked(d, [{ kind: 'add_transition', from: 'Processing', to: '[*]', label: 'done' }])
      expect(r.ok).toBe(false)
    })
    // validateOp short-circuits before mutate, yet the failure is still observed
    expect(lines.filter(l => l.verb === 'mutate' && l.ok === false).length).toBe(1)
  })

  test('op-error rate = count of {ok:false} lines across a run', () => {
    const d = parseState()
    const lines = withTraceLog(() => {
      mutate(d, { kind: 'add_transition', from: 'A', to: 'B', label: 'x' } as AnyMutationOp) // ok
      mutate(d, { kind: 'remove_state', id: 'Nope' } as AnyMutationOp)                        // fail
      mutateChecked(d, [{ kind: 'add_state', id: 'C' }])                                       // fail (array)
    })
    const errors = lines.filter(l => l.ok === false).length
    expect(errors).toBe(2)
  })
})
