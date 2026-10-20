// Passing an op ARRAY where one op is expected is the most common shape slip
// across every model tier in the agent-usage eval (mutate() applies ONE op, but
// "apply these ops" reads as a list). The error must name the rule AND the batch
// alternatives so the caller's next action is in the message — not a dumped
// array they have to reverse-engineer. Covers both entry paths: the raw mutator
// and the checked path (validateOp), which share unknownOpMessage, and the Code
// Mode surface, where the advice must name only calls that exist there.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { validateOp } from '../agent/op-schema.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import type { AnyMutationOp, MutableValidDiagram } from '../agent/types.ts'

const STATE_SRC = 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start'
const ARRAY_OP = [{ kind: 'add_transition', from: 'Processing', to: '[*]', label: 'done' }]

describe('op-array slip is prescriptive, not a dumped array', () => {
  test('raw mutate(d, [op]) names the rule and the batch entrypoints', () => {
    const p = parseMermaid(STATE_SRC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const r = mutate(p.value as MutableValidDiagram, ARRAY_OP as unknown as AnyMutationOp)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const msg = r.error.message
    // The sharpened message: states the one-op rule, counts the array, and hands
    // over the per-op loop (to edit) and buildMermaid (to author).
    expect(msg).toContain('got an array of 1')
    expect(msg).toContain('one at a time')
    expect(msg).toContain('mutate(d, op)')
    expect(msg).toContain('buildMermaid(kind, ops)')
    expect(msg).toContain('valid state ops:')
    // Guard against the old behavior, which dumped the JSON array under the
    // generic "Unknown state op […]" catch-all with no corrective guidance.
    expect(msg.startsWith('Unknown')).toBe(false)
  })

  test('checked path: validateOp flags an array with a dedicated reason', () => {
    const err = validateOp('state', ARRAY_OP)
    expect(err).not.toBeNull()
    expect(err?.reason).toBe('expected_single_op')
    expect(err?.message).toContain('got an array of 1')
    expect(err?.message).toContain('buildMermaid(kind, ops)')
  })

  // Issue #275: the message pointed Code Mode callers at applyOps, which the
  // Code Mode global does not expose. Follow the advice where agents read it.
  test('in Code Mode, every call the message names exists and its loop applies the ops', async () => {
    const r = await executeInSandbox(`
      const d = mermaid.parseRegisteredMermaid('graph TB\\n  A --> B\\n').value
      const ops = [{ kind: 'remove_edge', id: 'A->B' }, { kind: 'add_node', id: 'C', label: 'New' }]
      const slip = mermaid.mutate(d, ops)
      const named = Array.from(slip.error.message.matchAll(/\\b(\\w+)\\(/g), m => m[1])
      let current = d
      for (const op of ops) {
        const step = mermaid.mutate(current, op)
        if (!step.ok) return { failed: step.error.message }
        current = step.value
      }
      return { named, missing: named.filter(name => typeof mermaid[name] !== 'function'), source: mermaid.serializeMermaid(current) }
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({
      named: ['mutate', 'buildMermaid'],
      missing: [],
      source: 'flowchart TB\n  A[A]\n  B[B]\n  C[New]\n',
    })
  })

  test('the sharpened array message differs per family (names the family ops)', () => {
    const state = validateOp('state', ARRAY_OP)!.message
    const pie = validateOp('pie', ARRAY_OP)!.message
    expect(state).toContain('valid state ops:')
    expect(pie).toContain('valid pie ops:')
    expect(state).not.toBe(pie)
  })
})
