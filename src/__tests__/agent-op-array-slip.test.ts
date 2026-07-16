// Passing an op ARRAY where one op is expected is the most common shape slip
// across every model tier in the agent-usage eval (mutate() applies ONE op, but
// "apply these ops" reads as a list). The error must name the rule AND the batch
// alternatives so the caller's next action is in the message — not a dumped
// array they have to reverse-engineer. Covers both entry paths: the raw mutator
// and the checked path (validateOp), which share unknownOpMessage.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { validateOp } from '../agent/op-schema.ts'
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
    // over BOTH batch verbs (applyOps to edit, buildMermaid to author).
    expect(msg).toContain('got an array of 1')
    expect(msg).toContain('one at a time')
    expect(msg).toContain('applyOps({ source, family, ops })')
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

  test('the sharpened array message differs per family (names the family ops)', () => {
    const state = validateOp('state', ARRAY_OP)!.message
    const pie = validateOp('pie', ARRAY_OP)!.message
    expect(state).toContain('valid state ops:')
    expect(pie).toContain('valid pie ops:')
    expect(state).not.toBe(pie)
  })
})
