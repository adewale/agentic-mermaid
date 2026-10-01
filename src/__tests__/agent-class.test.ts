// Phase C: structured class diagram support.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, asClass, mutate, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { classCommentRejections, parseClassDiagram } from '../class/parser.ts'
import { classUnsupportedSyntaxWarnings } from '../agent/class-body.ts'

const parse = (s: string) => {
  const r = parseMermaid(s)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('class — parse', () => {
  test('deeply nested namespaces retain the class and source identity without exhausting the call stack', () => {
    const depth = 15000
    const lines = [...Array<string>(depth).fill('namespace N {'), 'class A', ...Array<string>(depth).fill('}')]
    const source = `classDiagram\n${lines.join('\n')}`
    const diagram = parse(source)
    if (diagram.body.kind !== 'class') throw new Error('expected editable nested Class body')
    expect(diagram.body.namespaces).toHaveLength(depth)
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([
      { id: 'A', namespace: `${'N.'.repeat(depth - 1)}N` },
    ])
    expect(diagram.source.nodes.get('A')).toEqual({ line: depth + 2, col: 7 })
    expect(parseClassDiagram(['classDiagram', ...lines]).classes.map(node => node.id)).toEqual(['A'])
    expect(classCommentRejections(lines)).toEqual([])
    expect(classUnsupportedSyntaxWarnings(source)).toEqual([])
  })

  test.each([
    'class A\nfuture statement',
    'class A {\n+String name',
    'namespace Domain {\nclass A',
    'class A\n}',
    'class A\nclass A,bad-id hot',
    'note "A &#10; B"',
    'note for A "A &#13; B"',
  ])('preserves source rather than exposing a partial editable model: %s', body => {
    const source = `classDiagram\n${body}`
    const diagram = parse(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram).trimEnd()).toBe(source)
    expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX' }))
  })

  test('compact namespaces keep quoted semicolons through editing and reload', () => {
    const diagram = parse('classDiagram\nnamespace Domain { class A["Before; after"]; class B }')
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    expect(typed.body.classes.map(node => ({ id: node.id, label: node.label, namespace: node.namespace }))).toEqual([
      { id: 'A', label: 'Before; after', namespace: 'Domain' },
      { id: 'B', label: undefined, namespace: 'Domain' },
    ])
    const changed = mutate(typed, { kind: 'add_member', class: 'A', text: '+String name' })
    if (!changed.ok) throw new Error(JSON.stringify(changed.error))
    const reloaded = asClass(parse(serializeMermaid(changed.value)))
    expect(reloaded?.body.classes).toEqual([
      expect.objectContaining({ id: 'A', label: 'Before; after', namespace: 'Domain', members: ['+String name'] }),
      expect.objectContaining({ id: 'B', namespace: 'Domain', members: [] }),
    ])
  })

  test('quoted notes create their target and survive escaping on reload', () => {
    const diagram = parse(String.raw`classDiagram
note for A "A \"quote\" and \\ path"`)
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    expect(typed.body.classes.map(node => node.id)).toEqual(['A'])
    expect(typed.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
    expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'class_escaped_note_quotes', line: 2,
    }))
    expect(asClass(parse(serializeMermaid(diagram)))?.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
  })

  test('declaration shorthand stays editable and its member source belongs to the declared class', () => {
    const diagram = parse('classDiagram\nclass A:::hot\nclass B:::cold {\n+int count\n}\nclassDef hot fill:red\nclassDef cold fill:blue')
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    const expected = [
      { id: 'A', className: 'hot', members: [] }, { id: 'B', className: 'cold', members: ['+int count'] },
    ]
    const facts = (body: typeof typed.body) => body.classes.map(node => ({ id: node.id, className: node.className, members: node.members }))
    expect(facts(typed.body)).toEqual(expected)
    expect(diagram.source.labels.get('class:B:member#0')).toEqual({ line: 4, col: 1 })
    const reloaded = asClass(parse(serializeMermaid(diagram)))
    if (!reloaded) throw new Error('reload lost the editable Class body')
    expect(facts(reloaded.body)).toEqual(expected)
  })

  test('basic class with members', () => {
    const d = parse('classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }')
    expect(d.body.kind).toBe('class')
    if (d.body.kind !== 'class') throw new Error('expected editable Class body')
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
  test.each(['\n', '\r', '\r\n'])('refuses an unsupported multiline note without changing the diagram: %j', lineBreak => {
    const original = parse('classDiagram\nclass A')
    const typed = asClass(original)
    if (!typed) throw new Error('expected editable Class body')
    const result = mutate(typed, { kind: 'add_note', for: 'A', text: `Before${lineBreak}after` })
    expect(result).toEqual({ ok: false, error: {
      code: 'INVALID_OP', message: 'Class note text must be a single line; use <br/> for displayed line breaks',
    } })
    expect(typed.body.notes).toEqual([])
    expect(serializeMermaid(typed)).toBe('classDiagram\n  class A\n')
  })

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
    const reloaded = parse(out1)
    const typed = asClass(reloaded)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('round-trip lost the editable Class model')
    expect(typed.body.classes.map(node => ({ id: node.id, members: node.members }))).toEqual([
      { id: 'Animal', members: ['+String name', '+eat()'] }, { id: 'Dog', members: [] },
    ])
    expect(typed.body.relations).toEqual([{ from: 'Animal', to: 'Dog', kind: 'inheritance', markerAt: 'from' }])
    const out2 = serializeMermaid(reloaded)
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
    // The parser upserts both endpoints and remove_class cascades, so neither
    // can produce an orphan: doctor the body to drop class B but keep A <|-- B.
    const c = asClass(parse('classDiagram\n  class A\n  class B\n  A <|-- B'))!
    const orphaned = { ...c, body: { ...c.body, classes: c.body.classes.filter(k => k.id !== 'B') } }
    const v = verifyMermaid(orphaned)
    expect(v.warnings).toContainEqual({ code: 'EDGE_MISANCHORED', edge: 'rel#0:A->B', from: 'A' })
    expect(v.ok).toBe(false)
  })
})
