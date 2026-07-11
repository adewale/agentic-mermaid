/**
 * Class serializer → RENDERER-parser conformance guard (P3 pattern, scoped to
 * the constructs the namespace elevation added — repo #118's class-namespace
 * half; flowchart-parser-conformance.test.ts / sequence-serializer-conformance
 * are the pattern being extended).
 *
 * The fidelity contract: any form the agent serializer emits after a
 * SUCCEEDING op must re-parse through the renderer's parser
 * (src/class/parser.ts) to the same namespace structure the op promised —
 * membership lives in one grammar consumed by both sides, so the serializer
 * cannot emit a namespace block the renderer would drop.
 */
import { describe, test, expect } from 'bun:test'
import { parseClassDiagram } from '../class/parser.ts'
import type { ClassNamespace } from '../class/types.ts'
import { parseMermaid, serializeMermaid, mutate, asClass, describeMermaidFacts } from '../agent/index.ts'
import type { ClassValidDiagram, ClassMutationOp } from '../agent/types.ts'

function classDiagram(src: string): ClassValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const c = asClass(r.value)
  if (!c) throw new Error('not a structured class body')
  return c
}

function apply(d: ClassValidDiagram, op: ClassMutationOp): ClassValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

/** Re-parse serialized agent output through the RENDERER parser. */
function renderParse(source: string) {
  const lines = source.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseClassDiagram(lines)
}

/** Flatten a namespace tree to { path → classIds } for structural equality. */
function membershipByPath(namespaces: ClassNamespace[], prefix = ''): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const ns of namespaces) {
    const path = prefix ? `${prefix}.${ns.name}` : ns.name
    out.set(path, [...ns.classIds].sort())
    for (const [k, v] of membershipByPath(ns.children, path)) out.set(k, v)
  }
  return out
}

const NAMESPACED = `classDiagram
namespace Shapes {
  class Triangle
  class Square {
    +double side
    +area() double
  }
}
class Free
Triangle --> Free : points at`

describe('class labeled declaration conformance', () => {
  test('serializer labels resolve to one logical renderer class and relations attach to it', () => {
    let d = classDiagram('classDiagram\n  class B')
    d = apply(d, { kind: 'add_class', id: 'A', label: 'Alpha' })
    d = apply(d, { kind: 'add_relation', from: 'A', to: 'B', relKind: 'association' })
    const parsed = renderParse(serializeMermaid(d))
    expect(parsed.classes.map(cls => cls.id).sort()).toEqual(['A', 'B'])
    expect(parsed.classes.find(cls => cls.id === 'A')?.label).toBe('Alpha')
    expect(parsed.relationships[0]).toMatchObject({ from: 'A', to: 'B' })
  })
})

describe('class namespaces — structured agent body (#118)', () => {
  test('namespaced source parses structured, not opaque', () => {
    const d = classDiagram(NAMESPACED)
    expect(d.body.classes.map(c => c.id).sort()).toEqual(['Free', 'Square', 'Triangle'])
    const triangle = d.body.classes.find(c => c.id === 'Triangle')!
    expect(triangle.namespace).toBe('Shapes')
    const square = d.body.classes.find(c => c.id === 'Square')!
    expect(square.namespace).toBe('Shapes')
    expect(square.members).toEqual(['+double side', '+area() double'])
    const free = d.body.classes.find(c => c.id === 'Free')!
    expect(free.namespace).toBeUndefined()
  })

  test('nested namespaces parse to dot paths', () => {
    const d = classDiagram('classDiagram\nnamespace Platform {\n  namespace Auth {\n    class UserService\n  }\n}')
    expect(d.body.classes.find(c => c.id === 'UserService')!.namespace).toBe('Platform.Auth')
  })

  test('serialize → render-parse reproduces namespace membership', () => {
    const d = classDiagram(NAMESPACED)
    const rendered = renderParse(serializeMermaid(d))
    const membership = membershipByPath(rendered.namespaces)
    expect(membership.get('Shapes')).toEqual(['Square', 'Triangle'])
    expect(rendered.classes.map(c => c.id).sort()).toEqual(['Free', 'Square', 'Triangle'])
    // the relationship survives alongside the namespace block
    expect(rendered.relationships).toHaveLength(1)
    // members survive inside the namespace block
    expect(rendered.classes.find(c => c.id === 'Square')!.attributes).toHaveLength(1)
    expect(rendered.classes.find(c => c.id === 'Square')!.methods).toHaveLength(1)
  })

  test('round-trip is byte-stable (serialize∘parse idempotent)', () => {
    const d = classDiagram(NAMESPACED)
    const once = serializeMermaid(d)
    const again = serializeMermaid(classDiagram(once))
    expect(again).toBe(once)
  })

  test('add_class with namespace + set_class_namespace round-trip through the renderer parser', () => {
    let d = classDiagram(NAMESPACED)
    d = apply(d, { kind: 'add_class', id: 'Circle', namespace: 'Shapes', members: ['+double r'] })
    d = apply(d, { kind: 'add_class', id: 'Loose' })
    d = apply(d, { kind: 'set_class_namespace', class: 'Loose', namespace: 'Extras.Bag' })
    d = apply(d, { kind: 'set_class_namespace', class: 'Triangle', namespace: null })
    const rendered = renderParse(serializeMermaid(d))
    const membership = membershipByPath(rendered.namespaces)
    expect(membership.get('Shapes')).toEqual(['Circle', 'Square'])
    expect(membership.get('Extras.Bag')).toEqual(['Loose'])
    // Triangle left its namespace but still renders as a class
    expect(rendered.classes.map(c => c.id).sort()).toEqual(['Circle', 'Free', 'Loose', 'Square', 'Triangle'])
  })

  test('classes inside namespaces stay mutable (add_member on a namespaced class)', () => {
    let d = classDiagram(NAMESPACED)
    d = apply(d, { kind: 'add_member', class: 'Triangle', text: '+rotate()' })
    const rendered = renderParse(serializeMermaid(d))
    const triangle = rendered.classes.find(c => c.id === 'Triangle')!
    expect(triangle.methods.map(m => m.name)).toContain('rotate')
    expect(membershipByPath(rendered.namespaces).get('Shapes')).toContain('Triangle')
  })

  test('set_class_namespace rejects an unknown class', () => {
    const d = classDiagram(NAMESPACED)
    const r = mutate(d, { kind: 'set_class_namespace', class: 'Ghost', namespace: 'Shapes' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CLASS_NOT_FOUND')
  })

  test('namespace labels round-trip through the renderer parser', () => {
    const d = classDiagram('classDiagram\nnamespace Auth["Authentication Service"] {\n  class UserService\n}')
    const rendered = renderParse(serializeMermaid(d))
    const auth = rendered.namespaces.find(n => n.name === 'Auth')
    expect(auth).toBeDefined()
    expect(auth!.label).toBe('Authentication Service')
    expect(auth!.classIds).toEqual(['UserService'])
  })

  test('membership is queryable via facts', () => {
    const d = classDiagram(NAMESPACED)
    const facts = describeMermaidFacts(d)
    expect(facts.some(f => f.includes('namespace Shapes'))).toBe(true)
    expect(facts.some(f => f.includes('Triangle') && f.includes('Shapes'))).toBe(true)
  })
})
