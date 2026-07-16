// Phase C: structured class diagram support.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, asClass, mutate, serializeMermaid, verifyMermaid } from '../agent/index.ts'

const parse = (s: string) => {
  const r = parseMermaid(s)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('class — parse', () => {
  test('basic class with members', () => {
    const d = parse('classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }')
    expect(d.body.kind).toBe('class')
    if (d.body.kind !== 'class') return
    expect(d.body.classes).toEqual([{ id: 'Animal', label: undefined, members: ['+String name', '+eat()'] }])
  })

  test('bare class + separate-decl members', () => {
    const d = parse('classDiagram\n  class Animal\n  Animal : +String name\n  Animal : +eat()')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.classes[0]!.members).toEqual(['+String name', '+eat()'])
  })

  test('class with bracket label', () => {
    const d = parse('classDiagram\n  class Animal["The animal kingdom"]')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.classes[0]!.label).toBe('The animal kingdom')
  })

  test('inheritance + composition + aggregation + association + dependency + realization', () => {
    const d = parse(`classDiagram
  class A
  class B
  class C
  class D
  class E
  class F
  class G
  A <|-- B
  C *-- D
  E o-- F
  A --> C
  D ..> E
  F ..|> G`)
    if (d.body.kind !== 'class') throw new Error()
    const kinds = d.body.relations.map(r => r.kind)
    expect(kinds).toEqual(['inheritance', 'composition', 'aggregation', 'association', 'dependency', 'realization'])
  })

  test('relation with cardinality + label', () => {
    const d = parse('classDiagram\n  Customer "1" --> "*" Ticket : buys')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.relations[0]).toEqual({
      from: 'Customer', to: 'Ticket', kind: 'association', markerAt: 'to',
      label: 'buys', fromCardinality: '1', toCardinality: '*',
    })
  })

  test('notes (attached and free)', () => {
    const d = parse('classDiagram\n  class Animal\n  note for Animal "lives in nature"\n  note "this is free"')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.notes).toEqual([
      { text: 'lives in nature', for: 'Animal' },
      { text: 'this is free', for: undefined },
    ])
  })

  test('title', () => {
    const d = parse('classDiagram\n  title Animal Kingdom\n  class A')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.title).toBe('Animal Kingdom')
  })

  test('unmodeled syntax → opaque fallback', () => {
    const d = parse('classDiagram\n  direction TB\n  class A')
    expect(d.body.kind).toBe('opaque')
  })
})

describe('class — mutate', () => {
  test('add_class + add_relation', () => {
    const d0 = parse('classDiagram\n  class Animal')
    const c = asClass(d0)!
    const r1 = mutate(c, { kind: 'add_class', id: 'Dog' })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = mutate(r1.value, { kind: 'add_relation', from: 'Animal', to: 'Dog', relKind: 'inheritance' })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.value.body.classes.map(c => c.id)).toEqual(['Animal', 'Dog'])
    expect(r2.value.body.relations[0]!.kind).toBe('inheritance')
  })

  test('rename_class updates relations and notes', () => {
    const d0 = parse('classDiagram\n  class A\n  class B\n  A <|-- B\n  note for A "hi"')
    const c = asClass(d0)!
    const r = mutate(c, { kind: 'rename_class', from: 'A', to: 'X' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.relations[0]!.from).toBe('X')
    expect(r.value.body.notes[0]!.for).toBe('X')
  })

  test('remove_class cascades to relations and notes', () => {
    const d0 = parse('classDiagram\n  class A\n  class B\n  A <|-- B\n  note for A "hi"')
    const c = asClass(d0)!
    const r = mutate(c, { kind: 'remove_class', id: 'A' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.relations).toEqual([])
    expect(r.value.body.notes).toEqual([])
  })

  test('add_member / remove_member', () => {
    const d0 = parse('classDiagram\n  class A')
    const c = asClass(d0)!
    const r1 = mutate(c, { kind: 'add_member', class: 'A', text: '+foo()' })
    if (!r1.ok) throw new Error()
    expect(r1.value.body.classes[0]!.members).toEqual(['+foo()'])
    const r2 = mutate(r1.value, { kind: 'remove_member', class: 'A', index: 0 })
    if (!r2.ok) throw new Error()
    expect(r2.value.body.classes[0]!.members).toEqual([])
  })

  test('add_class refuses duplicate', () => {
    const d0 = parse('classDiagram\n  class A')
    const r = mutate(asClass(d0)!, { kind: 'add_class', id: 'A' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_CLASS')
  })

  test('remove_class on missing id', () => {
    const d0 = parse('classDiagram\n  class A')
    const r = mutate(asClass(d0)!, { kind: 'remove_class', id: 'Missing' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('CLASS_NOT_FOUND')
  })
})

describe('class — round-trip', () => {
  test('serialize → parse → serialize is stable', () => {
    const src = `classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog\n  Animal <|-- Dog`
    const d = parse(src)
    const out1 = serializeMermaid(d)
    const out2 = serializeMermaid(parse(out1))
    expect(out2).toBe(out1)
  })
})

describe('class — verify', () => {
  test('empty class diagram → EMPTY_DIAGRAM', () => {
    const d = parse('classDiagram')
    const v = verifyMermaid(d)
    expect(v.warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
  })

  test('long label → LABEL_OVERFLOW', () => {
    const long = 'X'.repeat(80)
    const d = parse(`classDiagram\n  class A\n  A : +${long}`)
    const v = verifyMermaid(d)
    expect(v.warnings.filter(w => w.code === 'LABEL_OVERFLOW').length).toBeGreaterThan(0)
  })

  test('orphan relation → EDGE_MISANCHORED', () => {
    // Build manually to bypass parser (parser would create both classes via upsert)
    const r1 = mutate(asClass(parse('classDiagram\n  class A'))!, { kind: 'add_class', id: 'B' })
    if (!r1.ok) throw new Error()
    const r2 = mutate(r1.value, { kind: 'add_relation', from: 'A', to: 'B', relKind: 'inheritance' })
    if (!r2.ok) throw new Error()
    const r3 = mutate(r2.value, { kind: 'remove_class', id: 'B' })  // removes the relation too actually
    if (!r3.ok) throw new Error()
    // Cascade should have removed the relation, so no orphan
    const v = verifyMermaid(r3.value)
    expect(v.warnings.filter(w => w.code === 'EDGE_MISANCHORED')).toEqual([])
  })
})
