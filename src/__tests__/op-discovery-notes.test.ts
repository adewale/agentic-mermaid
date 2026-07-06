// Discovery completion: op field-shapes now carry constraint/default NOTES the
// mutator enforces (journey score 1..5, quadrant x/y 0..1, pie value > 0,
// flowchart shape/edge defaults, xychart kind2 footgun), and the read-only
// discovery helpers describeOps/opSignatures are reachable from Code Mode so a
// script can look up an op's exact shape instead of guessing.

import { describe, test, expect } from 'bun:test'
import { describeOps, opSignatures } from '../agent/op-schema.ts'
import { buildCapabilities } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

describe('op field notes (mutator-enforced constraints + omit-defaults)', () => {
  const noteOf = (family: Parameters<typeof describeOps>[0], op: string, field: string): string | undefined =>
    describeOps(family)[op]?.find(f => f.name === field)?.note

  test('journey score is annotated 1..5', () => {
    expect(noteOf('journey', 'add_task', 'score')).toBe('integer 1..5')
    expect(noteOf('journey', 'set_task_score', 'score')).toBe('integer 1..5')
  })
  test('quadrant point coordinates are annotated 0..1', () => {
    expect(noteOf('quadrant', 'add_point', 'x')).toBe('0..1')
    expect(noteOf('quadrant', 'add_point', 'y')).toBe('0..1')
    expect(noteOf('quadrant', 'move_point', 'x')).toBe('0..1')
  })
  test('pie value is annotated positive', () => {
    expect(noteOf('pie', 'add_slice', 'value')).toBe('> 0, finite')
    expect(noteOf('pie', 'set_slice_value', 'value')).toBe('> 0, finite')
  })
  test('flowchart shape/edge carry their omit-defaults', () => {
    expect(noteOf('flowchart', 'add_node', 'shape')).toBe('default: rectangle')
    expect(noteOf('flowchart', 'add_edge', 'style')).toBe('default: solid')
  })
  test('xychart kind2 names the field footgun', () => {
    expect(noteOf('xychart', 'add_series', 'kind2')).toContain('kind2, not kind')
  })
  test('gantt task end/start grammar is annotated', () => {
    expect(noteOf('gantt', 'add_task', 'end')).toContain('duration')
    expect(noteOf('gantt', 'add_task', 'start')).toContain('after')
  })

  test('notes propagate into am capabilities opFields', () => {
    const cap = buildCapabilities()
    const journey = cap.families.find(f => f.id === 'journey')!
    const score = (journey.opFields?.add_task ?? []).find(f => f.name === 'score')
    expect(score?.note).toBe('integer 1..5')
  })
})

describe('Code Mode can self-discover op shapes', () => {
  test('mermaid.opSignatures + mermaid.describeOps are reachable and carry notes', async () => {
    const r = await executeInSandbox(
      'return { sig: mermaid.opSignatures("quadrant")[3], xNote: mermaid.describeOps("quadrant").add_point[1].note }',
      {},
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.value as { sig: string; xNote: string }
    expect(v.sig).toBe(opSignatures('quadrant')[3]!)
    expect(v.xNote).toBe('0..1')
  })

  test('a non-string family argument is rejected in the sandbox', async () => {
    const r = await executeInSandbox('return mermaid.describeOps(123)', {})
    expect(r.ok).toBe(false)
  })
})
