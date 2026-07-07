// The untyped edit boundary (MCP / CLI JSON) restores the shape guarantee the
// compiler gives typed callers: an op with a wrong/missing/mistyped field is
// rejected BEFORE the mutator with a prescriptive INVALID_OP error, instead of
// silently producing a mangled diagram (e.g. `add_class {name}` → `class
// undefined`). Every untyped path funnels through ONE checked core
// (mutateChecked), so a given bad op is rejected identically no matter which
// path reaches it. These tests fail if validateOp is removed from that core.

import { describe, test, expect } from 'bun:test'
import { applyOps, mutateChecked, validateOp, opMenu, hasOpSchema } from '../agent/core.ts'
import { parseMermaid } from '../agent/parse.ts'
import { createMermaid } from '../agent/create.ts'
import { mutateSource } from '../cli/index.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import type { AnyMutationOp, MutableValidDiagram } from '../agent/types.ts'

const errMsg = (e: unknown): string => (e as { message?: string })?.message ?? ''

describe('op-schema shape validation (§1–3, §5)', () => {
  test('unknown field names the offending field and suggests the right one', () => {
    const r = applyOps({ family: 'class', ops: [{ kind: 'add_class', name: 'Duck' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((r.error as { reason?: string }).reason).toBe('unknown_field')
    expect((r.error as { field?: string }).field).toBe('name')
    // `name` is not an edit-distance typo of `id`, so instead of a (false)
    // suggestion the caller gets the full menu of valid fields to correct from.
    expect(errMsg(r.error)).toContain('Valid fields: id, label, members')
    // The bug it replaces: never the silent-mangle string.
    expect(errMsg(r.error)).not.toContain('undefined')
  })

  test('missing required field is reported prescriptively', () => {
    const r = applyOps({ family: 'architecture', ops: [
      { kind: 'add_service', id: 'api' }, { kind: 'add_service', id: 'db' },
      { kind: 'add_edge', from: 'api', to: 'db' }, // missing fromSide/toSide
    ] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((r.error as { reason?: string }).reason).toBe('missing_field')
    expect(errMsg(r.error)).toContain('fromSide')
  })

  test('unknown op kind names valid ops and suggests the nearest', () => {
    const r = applyOps({ family: 'architecture', ops: [{ kind: 'add_serivce', id: 'x' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(errMsg(r.error)).toContain('valid ops:')
    expect(errMsg(r.error)).toContain('Did you mean "add_service"')
  })

  test('wrong primitive type is rejected with the expected type', () => {
    const r = applyOps({ family: 'class', ops: [
      { kind: 'add_class', id: 'A' }, { kind: 'add_member', class: 'A', text: '+f()' },
      { kind: 'remove_member', class: 'A', index: '0' }, // index must be number
    ] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((r.error as { reason?: string }).reason).toBe('wrong_type')
    expect(errMsg(r.error)).toContain('must be number')
    expect(r.opIndex).toBe(2)
  })

  test('enum checks that overlap a mutator are caught by validateOp first (one phrasing on untyped paths)', () => {
    // The per-family mutators keep their own enum backstops (e.g. architecture
    // validSide, xychart kind2). On an untyped path validateOp must fire first,
    // so the caller always sees ONE consistent enum error, never the mutator's
    // differently-worded one. Guards the choke point against a bypass reappearing.
    const side = applyOps({ family: 'architecture', ops: [
      { kind: 'add_service', id: 'api' }, { kind: 'add_service', id: 'db' },
      { kind: 'add_edge', from: 'api', to: 'db', fromSide: 'X', toSide: 'R' },
    ] })
    expect(side.ok).toBe(false)
    if (!side.ok) {
      expect((side.error as { reason?: string }).reason).toBe('wrong_type')
      expect(errMsg(side.error)).toContain('must be one of "L", "R", "T", "B"')
    }
    const series = applyOps({ family: 'xychart', ops: [{ kind: 'add_series', kind2: 'pie', values: [1] }] })
    expect(series.ok).toBe(false)
    if (!series.ok) expect((series.error as { reason?: string }).reason).toBe('wrong_type')
  })

  test('a semantic (not shape) error still flows through from the mutator', () => {
    // Shape is valid; the class does not exist → the mutator, not the validator,
    // rejects it. Proves the two layers compose (shape first, semantics second).
    const r = applyOps({ family: 'class', ops: [{ kind: 'add_member', class: 'Ghost', text: '+x()' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((r.error as { code: string }).code).toBe('CLASS_NOT_FOUND')
  })
})

describe('one shared choke point — byte-identical rejection (§6)', () => {
  const src = 'classDiagram\n  class Animal'
  const badOp = { kind: 'add_class', name: 'Duck' }

  test('Code Mode mutateChecked and declarative applyOps(edit) reject identically', () => {
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const codeMode = mutateChecked(parsed.value as MutableValidDiagram, badOp)
    const declarative = applyOps({ source: src, ops: [badOp] })
    expect(codeMode.ok).toBe(false)
    expect(declarative.ok).toBe(false)
    if (codeMode.ok || declarative.ok) return
    expect(errMsg(codeMode.error)).toBe(errMsg(declarative.error))
  })

  test('the CLI --op/--ops path shares the choke point (no silent mangle)', () => {
    // mutateSource backs `am mutate`; its ops arrive as untyped JSON. It must
    // reject the same bad op the same way, not build `class undefined`.
    const r = mutateSource('classDiagram\n  class Animal', [{ kind: 'add_class', name: 'Duck' } as unknown as AnyMutationOp])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toContain('Unknown field "name"')
    expect(JSON.stringify(r)).not.toContain('class undefined')
  })

  test('validateOp is the single source of the rejection (removing it lets the bad op through)', () => {
    // Guards the choke point: mutateChecked must go through validateOp. If a
    // future edit routes an untyped op straight to mutate(), this bad op would
    // reach the mutator and this assertion (reason==='unknown_field') breaks.
    const d = createMermaid('class') as MutableValidDiagram
    const r = mutateChecked(d, badOp)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect((r.error as { reason?: string }).reason).toBe('unknown_field')
    // And validateOp alone, called directly, agrees — same message.
    expect(validateOp('class', badOp)?.message).toBe(errMsg(r.error))
  })
})

describe('canonical output envelope (§7)', () => {
  test('success and failure share the { ok, … } shape', () => {
    const good = applyOps({ family: 'class', ops: [{ kind: 'add_class', id: 'Duck' }] })
    const bad = applyOps({ family: 'class', ops: [{ kind: 'add_class', name: 'Duck' }] })
    expect(good).toHaveProperty('ok')
    expect(bad).toHaveProperty('ok')
    expect(good.ok).toBe(true)
    expect(bad.ok).toBe(false)
  })

  test('the envelope is pure JSON — a full round-trip is lossless (no Map/proxy leak)', () => {
    const env = applyOps({ family: 'class', ops: [
      { kind: 'add_class', id: 'Duck' },
      { kind: 'add_member', class: 'Duck', text: '+quack()' },
    ] })
    expect(env.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(env))).toEqual(env)
    if (!env.ok) return
    expect(typeof env.source).toBe('string')
    expect(env.verify).toHaveProperty('ok')
    expect(Array.isArray(env.verify.warnings)).toBe(true)
  })

  test('editing existing source returns the mutated canonical source', () => {
    const env = applyOps({ source: 'classDiagram\n  class Animal', ops: [{ kind: 'add_class', id: 'Dog' }] })
    expect(env.ok).toBe(true)
    if (!env.ok) return
    expect(env.source).toContain('class Animal')
    expect(env.source).toContain('class Dog')
  })
})

describe('schema covers every mutable family (§11)', () => {
  // A representative op per family that must pass shape validation and build.
  const REPRESENTATIVE: Record<string, Record<string, unknown>> = {
    flowchart: { kind: 'add_node', id: 'a', label: 'A' },
    state: { kind: 'add_state', id: 's' },
    sequence: { kind: 'add_participant', id: 'A' },
    timeline: { kind: 'add_section', label: 'S' },
    class: { kind: 'add_class', id: 'C' },
    er: { kind: 'add_entity', id: 'E' },
    journey: { kind: 'add_section', label: 'S' },
    architecture: { kind: 'add_service', id: 'x' },
    xychart: { kind: 'add_series', kind2: 'bar', values: [1, 2] },
    pie: { kind: 'add_slice', label: 'A', value: 1 },
    quadrant: { kind: 'add_point', label: 'P', x: 0.1, y: 0.2 },
    gantt: { kind: 'add_section', label: 'S' },
  }

  test('every family in MUTATION_OPS_BY_FAMILY has a schema and builds a valid op', () => {
    for (const family of Object.keys(MUTATION_OPS_BY_FAMILY)) {
      expect({ family, hasSchema: hasOpSchema(family) }).toEqual({ family, hasSchema: true })
      const op = REPRESENTATIVE[family]
      expect({ family, hasRep: Boolean(op) }).toEqual({ family, hasRep: true })
      const r = applyOps({ family, ops: [op!] })
      expect({ family, ok: r.ok }).toEqual({ family, ok: true })
    }
  })

  test('opMenu lists every op kind for a family, marking optional fields', () => {
    const menu = opMenu('class')
    expect(Object.keys(menu).sort()).toEqual([...MUTATION_OPS_BY_FAMILY.class].sort())
    expect(menu.add_class).toEqual(['id', 'label?', 'members?'])
  })
})
