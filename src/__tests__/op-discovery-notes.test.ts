import { describeSdkPayload } from '../mcp/sdk-discovery.ts'
// Discovery completion: op field-shapes now carry constraint/default NOTES the
// mutator enforces (journey score 1..5, quadrant x/y 0..1, pie value > 0,
// flowchart shape/edge defaults, xychart kind2 footgun), and the read-only
// discovery helpers describeOps/opSignatures are reachable from Code Mode so a
// script can look up an op's exact shape instead of guessing.

import { describe, test, expect } from 'bun:test'
import { describeOps } from '../agent/op-schema.ts'
import { buildChecked } from '../agent/apply.ts'
import { buildCapabilities } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

describe('op field notes (mutator-enforced constraints + omit-defaults)', () => {
  const noteOf = (family: Parameters<typeof describeOps>[0], op: string, field: string): string | undefined =>
    describeOps(family)[op]?.find(f => f.name === field)?.note

  test('journey score is annotated 1..5', () => {
    expect(noteOf('journey', 'add_task', 'score')).toBe('finite number 1..5')
    expect(noteOf('journey', 'set_task_score', 'score')).toBe('finite number 1..5')
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
    expect(noteOf('flowchart', 'add_node', 'shape')).toContain('default: rectangle')
    expect(noteOf('flowchart', 'add_edge', 'style')).toBe('default: solid')
  })
  test('xychart kind2 names the field footgun', () => {
    expect(noteOf('xychart', 'add_series', 'kind2')).toContain('kind2, not kind')
  })
  test('gantt task end/start grammar is annotated', () => {
    expect(noteOf('gantt', 'add_task', 'end')).toContain('duration')
    expect(noteOf('gantt', 'add_task', 'start')).toContain('after')
  })

  // The header's claim: the noted constraints are ENFORCED, not just documented.
  // Each row is a value just inside and just outside its note.
  test('the mutator enforces each noted numeric constraint', () => {
    const rows: Array<[Parameters<typeof buildChecked>[0], (value: number) => unknown[], number, number, RegExp]> = [
      ['journey', score => [{ kind: 'add_section', label: 'S' }, { kind: 'add_task', sectionIndex: 0, text: 'T', score }], 5, 6, /Journey score must be a finite number 1\.\.5/],
      ['quadrant', x => [{ kind: 'add_point', label: 'P', x, y: 0.5 }], 1, 1.5, /Quadrant point x must be a number in \[0, 1\]/],
      ['pie', value => [{ kind: 'add_slice', label: 'A', value }], 2, 0, /Pie slice value must be a positive finite number/],
    ]
    for (const [family, ops, inside, outside, diagnostic] of rows) {
      expect({ family, ok: buildChecked(family, ops(inside) as never).ok }).toEqual({ family, ok: true })
      const rejected = buildChecked(family, ops(outside) as never)
      expect({ family, ok: rejected.ok, message: rejected.ok ? '' : rejected.error.message })
        .toEqual({ family, ok: false, message: expect.stringMatching(diagnostic) })
    }
  })

  test('notes propagate into am capabilities opFields', () => {
    const cap = buildCapabilities()
    const journey = cap.families.find(f => f.id === 'journey')!
    const score = (journey.opFields?.add_task ?? []).find(f => f.name === 'score')
    expect(score?.note).toBe('finite number 1..5')
  })
})

describe('Code Mode can self-discover op shapes', () => {
  test('mermaid.opSignatures + mermaid.describeOps are reachable and carry notes', async () => {
    const r = await executeInSandbox(
      'return { sig: mermaid.opSignatures("quadrant").find(sig => sig.startsWith("add_point(")), xNote: mermaid.describeOps("quadrant").add_point.find(field => field.name === "x").note }',
      {},
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = r.value as { sig: string; xNote: string }
    expect(v.sig).toBe('add_point(label, x, y)')
    expect(v.xNote).toBe('0..1')
  })

  test('a non-string family argument is rejected in the sandbox', async () => {
    const r = await executeInSandbox('return mermaid.describeOps(123)', {})
    expect(r.ok).toBe(false)
  })

  test('unknown family names get a prescriptive discovery error', async () => {
    for (const helper of ['describeOps', 'opSignatures']) {
      const r = await executeInSandbox(`return mermaid.${helper}("nope")`, {})
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.error).toContain('family must be one of:')
      expect(r.error).toContain('flowchart')
    }
  })
})


test('resolved-scene discovery names the executable API, limits and canonical primitive fields', () => {
  const summary = buildCapabilities().resolvedScene
  expect(summary).toMatchObject({ api: 'renderResolvedScene', version: 2, synchronous: true, coordinates: 'primitive-local', matrix: 'local-to-root-user-space' })
  const detail = describeSdkPayload(summary.discovery.arguments)
  expect(detail).toMatchObject({ ok: true, capability: 'resolved-scene', codeMode: { defaultMaxResultBytes: 2 * 1024 * 1024 } })
  expect(describeSdkPayload({ capability: 'resolved-scene', detail: 'signatures' })).toMatchObject({ ok: true, signatures: [expect.stringContaining('renderResolvedScene')] })
  expect(detail.declaration).toContain('interface ResolvedPaint')
  expect(detail.declaration).toContain('strokeWidth: number')
  expect(detail.declaration).toContain('node: unknown')
  expect(JSON.stringify(detail).length).toBeLessThan(12_000)
  expect(() => describeSdkPayload({ capability: 'resolved-scene', family: 'flowchart' })).toThrow()
})
