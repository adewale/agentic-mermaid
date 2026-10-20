// Phase C: structured class diagram support.

import { describe, expect, test } from 'bun:test'
import { classUnsupportedSyntaxWarnings } from '../agent/class-body.ts'
import { applyOps, asClass, mutate, mutateChecked, parseRegisteredMermaid as parseMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { ClassMutationOp } from '../agent/types.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const parse = (s: string) => {
  const r = parseMermaid(s)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('class — parse', () => {
  test('deep namespaces retain editable source identity while native work obeys the host limit', () => {
    const depth = 15000
    const lines = [...Array<string>(depth).fill('namespace N {'), 'class A', ...Array<string>(depth).fill('}')]
    const source = `classDiagram\n${lines.join('\n')}`
    const diagram = parse(source)
    if (diagram.body.kind !== 'class') throw new Error('expected editable nested Class body')
    expect(diagram.body.namespaces).toHaveLength(depth)
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'A', namespace: `${'N.'.repeat(depth - 1)}N` }])
    expect(diagram.source.nodes.get('A')).toEqual({ line: depth + 2, col: 7 })
    expect(() => parseClassDiagram(['classDiagram', ...lines])).toThrow(/DIAGRAM_WORK_LIMIT/)
    expect(classUnsupportedSyntaxWarnings(source)).toEqual([])
  })

  test.each(['class A\nfuture statement', 'class A {\n+String name', 'namespace Domain {\nclass A', 'class A\n}', 'class A\nclass A,bad-id hot', 'note "A &#10; B"', 'note for A "A &#13; B"'])('preserves source rather than exposing a partial editable model: %s', body => {
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
    expect(reloaded?.body.classes).toEqual([expect.objectContaining({ id: 'A', label: 'Before; after', namespace: 'Domain', members: ['+String name'] }), expect.objectContaining({ id: 'B', namespace: 'Domain', members: [] })])
  })

  test('quoted notes create their target and survive escaping on reload', () => {
    const diagram = parse(String.raw`classDiagram
note for A "A \"quote\" and \\ path"`)
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    expect(typed.body.classes.map(node => node.id)).toEqual(['A'])
    expect(typed.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
    expect(verifyMermaid(diagram).warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'class_escaped_note_quotes',
        line: 2,
      }),
    )
    expect(asClass(parse(serializeMermaid(diagram)))?.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
  })

  test('declaration shorthand stays editable and its member source belongs to the declared class', () => {
    const diagram = parse('classDiagram\nclass A:::hot\nclass B:::cold {\n+int count\n}\nclassDef hot fill:red\nclassDef cold fill:blue')
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    const expected = [
      { id: 'A', className: 'hot', members: [] },
      { id: 'B', className: 'cold', members: ['+int count'] },
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
      from: 'Customer',
      to: 'Ticket',
      kind: 'association',
      markerAt: 'to',
      label: 'buys',
      fromCardinality: '1',
      toCardinality: '*',
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
  test.each(['\n', '\r', '\r\n', '&#10;', '&#13;', '&#13;&#10;'])('refuses multiline members through either authoring op without changing the diagram: %j', lineBreak => {
    const original = asClass(parse('classDiagram\nclass A'))!
    const text = `+foo()${lineBreak}+bar()`
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', members: ['+valid()', text] },
    ] satisfies ClassMutationOp[]) {
      for (const apply of [mutate, mutateChecked]) {
        expect(apply(original, op)).toEqual({
          ok: false,
          error: {
            code: 'INVALID_OP',
            message: 'Class members must be single lines; add each member separately',
          },
        })
        expect(original.body.classes).toEqual([{ id: 'A', label: undefined, generic: undefined, members: [] }])
        expect(serializeMermaid(original)).toBe('classDiagram\n  class A\n')
      }
      expect(applyOps({ source: 'classDiagram\nclass A', ops: [op] })).toMatchObject({
        ok: false,
        opIndex: 0,
        error: { code: 'INVALID_OP', message: 'Class members must be single lines; add each member separately' },
      })
    }
  })

  test.each([
    ...['%% comment', ' \t%% comment', '%%{init: {"theme":"dark"}}%%', '&#37;&#37; comment', ' \t'].map(text => ({
      text,
      message: 'Class members must contain text, not blank lines, comments or init directives',
    })),
    ...['accTitle: lost', ' \tACCTITLE lost', 'accDescr: lost', 'accDescr { lost }', 'accDescr {}', 'accDescr { lost } +kept()', '&#97;ccDescr&#123;lost&#125;', 'accDescr {'].map(text => ({
      text,
      message: 'Class members cannot be accessibility directives',
    })),
    // Mermaid removes a directive wherever it stands, before it reads a member.
    ...['+literal(%%{init: {}}%%)', '+x %%{wrap}%%'].map(text => ({
      text, message: 'Class members cannot hold a %%{…}%% directive, which Mermaid removes from the source',
    })),
  ])('refuses member text that source preprocessing would remove: $text', ({ text, message }) => {
    const source = 'classDiagram\nclass A'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const error = { code: 'INVALID_OP', message } as const
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', namespace: 'New.Nested', members: ['+valid()', text] },
    ] satisfies ClassMutationOp[]) {
      const supplied = JSON.stringify(op)
      for (const apply of [mutate, mutateChecked]) {
        expect(apply(original, op)).toEqual({ ok: false, error })
        expect(JSON.stringify(original)).toBe(before)
        expect(JSON.stringify(op)).toBe(supplied)
      }
      expect(applyOps({ source, ops: [op] })).toEqual({ ok: false, family: 'class', opIndex: 0, error })
      expect(JSON.stringify(op)).toBe(supplied)
    }
  })

  test.each([String.raw`+foo()\n +bar()`, '+foo();+bar()', '+value: 50%%', '+literal(%%{ }%%)', String.raw`\%% literal`, '+accTitle: String', '+accDescr { kept }', 'accTitle() lost', 'accTitle:'])('keeps single-line member text through either authoring op and reload: %j', text => {
    const original = asClass(parse('classDiagram\nclass A'))!
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', members: [text] },
    ] satisfies ClassMutationOp[]) {
      for (const apply of [mutate, mutateChecked]) {
        const edited = apply(original, op)
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const reloaded = asClass(parse(serializeMermaid(edited.value)))!
        expect(reloaded.body.classes.at(-1)!.members).toEqual([text])
        expect(verifyMermaid(edited.value).warnings).toEqual([])
      }
      const declarative = applyOps({ source: 'classDiagram\nclass A', ops: [op] })
      if (!declarative.ok) throw new Error(JSON.stringify(declarative.error))
      expect(asClass(parse(declarative.source))!.body.classes.at(-1)!.members).toEqual([text])
    }
  })

  test('added classes own their member arrays across direct, checked and declarative edits', () => {
    const source = 'classDiagram\nclass A'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const expected = 'classDiagram\n  class A\n  class B {\n    +original()\n  }\n'
    for (const apply of [mutate, mutateChecked]) {
      const members = ['+original()']
      const op = { kind: 'add_class', id: 'B', members } as const
      const edited = apply(original, op)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      const added = asClass(edited.value)!
      expect(members).toEqual(['+original()'])
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(verifyMermaid(edited.value).warnings).toEqual([])
      const rendered = renderMermaidSVG(edited.value)
      members[0] = '+replaced()'
      members.push('+later()')
      expect(added.body.classes.at(-1)!.members).toEqual(['+original()'])
      expect(edited.value.canonicalSource).toBe(expected)
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(renderMermaidSVG(edited.value)).toBe(rendered)
      expect(asClass(parse(expected))!.body.classes).toEqual(added.body.classes)
      expect(JSON.stringify(original)).toBe(before)
    }
    const members = ['+original()']
    const edited = applyOps({ source, ops: [{ kind: 'add_class', id: 'B', members }] })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    expect(members).toEqual(['+original()'])
    members.push('+later()')
    expect(edited.source).toBe(expected)
    expect(asClass(parse(edited.source))!.body.classes.at(-1)!.members).toEqual(['+original()'])
  })

  test.each(['\n', '\r', '\r\n'])('refuses an unsupported multiline note without changing the diagram: %j', lineBreak => {
    const original = parse('classDiagram\nclass A')
    const typed = asClass(original)
    if (!typed) throw new Error('expected editable Class body')
    const result = mutate(typed, { kind: 'add_note', for: 'A', text: `Before${lineBreak}after` })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_OP',
        message: 'Class note text must be a single line; use <br/> for displayed line breaks',
      },
    })
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

  test.each([
    { relKind: 'association', markerAt: 'from', arrow: '<--' },
    { relKind: 'aggregation', markerAt: 'both', fromKind: 'aggregation', toKind: 'composition', lineStyle: 'dashed', arrow: 'o..*' },
    { relKind: 'lollipop', markerAt: 'both', fromKind: 'lollipop', toKind: 'lollipop', lineStyle: 'dashed', arrow: '()..()' },
    { relKind: 'lollipop', markerAt: 'both', toKind: 'association', arrow: '()-->' },
  ] as const)('authors relation metadata without changing its meaning: $arrow', ({ arrow, ...metadata }) => {
    const source = 'classDiagram\nclass A\nclass B'
    const original = asClass(parse(source))!
    const op = { kind: 'add_relation', from: 'A', to: 'B', label: 'uses', ...metadata } as const
    const expected = `classDiagram\n  class A\n  class B\n  A ${arrow} B : uses\n`
    for (const apply of [mutate, mutateChecked]) {
      const edited = apply(original, op)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      expect(asClass(edited.value)!.body.relations[0]).toMatchObject({ kind: metadata.relKind, markerAt: metadata.markerAt })
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(serializeMermaid(parse(expected))).toBe(expected)
      expect(original.body.relations).toEqual([])
    }
    const declarative = applyOps({ source, ops: [op] })
    if (!declarative.ok) throw new Error(JSON.stringify(declarative.error))
    expect(declarative.source).toBe(expected)
  })

  test.each([
    { relKind: 'inheritance', lineStyle: 'dashed' },
    { relKind: 'dependency', lineStyle: 'solid' },
    { relKind: 'inheritance', markerAt: 'none' },
    { relKind: 'association', markerAt: 'to', fromKind: 'composition' },
    { relKind: 'association', markerAt: 'both', fromKind: 'link-solid' },
    { relKind: 'lollipop', markerAt: 'both', fromKind: 'aggregation', toKind: 'lollipop' },
  ] as const)('refuses relation metadata whose arrow would change or ignore meaning: %j', metadata => {
    const source = 'classDiagram\nclass A\nclass B'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const op = { kind: 'add_relation', from: 'A', to: 'B', ...metadata } as const
    const supplied = JSON.stringify(op)
    for (const apply of [mutate, mutateChecked]) {
      expect(apply(original, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
      expect(JSON.stringify(original)).toBe(before)
      expect(JSON.stringify(op)).toBe(supplied)
    }
    expect(applyOps({ source, ops: [op] })).toMatchObject({ ok: false, opIndex: 0, error: { code: 'INVALID_OP' } })
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
  test.each([
    { arrow: '()..*', lineBreak: '<br>' },
    { arrow: '()..()', lineBreak: '<br/>' },
    { arrow: '-->', lineBreak: '<br />' },
  ])('keeps $lineBreak relation text and entities portable through edits of $arrow', async ({ arrow, lineBreak }) => {
    const source = `classDiagram\nA "&amp;amp;${lineBreak}one" ${arrow} "&amp;quot;${lineBreak}two" B : top & middle${lineBreak}bottom`
    const original = asClass(parse(source))!
    expect(original.body.relations).toEqual([
      expect.objectContaining({
        label: 'top & middle\nbottom',
        fromCardinality: '&amp;amp;\none',
        toCardinality: '&amp;quot;\ntwo',
      }),
    ])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      for (const apply of [mutate, mutateChecked]) {
        const edited = apply(original, { kind: 'add_member', class: 'B', text: '+active()' })
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const exported = serializeMermaid(edited.value)
        expect(exported).toContain(`A "&amp;amp;<br/>one" ${arrow} "&amp;quot;<br/>two" B : top & middle<br/>bottom`)
        expect(await upstream.accepts(exported)).toBe(true)
        expect(asClass(parse(exported))?.body.relations).toEqual(original.body.relations)
        expect(verifyMermaid(edited.value).warnings).toEqual([])
        for (const input of [edited.value, exported]) {
          const svg = renderMermaidSVG(input)
          expect(svg).toContain('data-from-cardinality="&amp;amp;&#10;one"')
          expect(svg).toContain('data-to-cardinality="&amp;quot;&#10;two"')
        }
      }
    } finally {
      await upstream.close()
    }
  })

  test('keeps directive targets valid when their class names need relation quoting', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const id of ['title', 'accTitle', 'accDescr', 'class', 'classDiagram']) {
        const style = ['title', 'accTitle', 'accDescr'].includes(id) ? `\nstyle ${id} stroke:blue` : ''
        const source = `classDiagram\nclass ${id}\nclass ${id} chosen\nclassDef chosen fill:red${style}`
        expect(await upstream.accepts(source)).toBe(true)
        const original = asClass(parse(source))!
        const edited = mutate(original, { kind: 'add_member', class: id, text: '+active()' })
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const exported = serializeMermaid(edited.value)
        expect(await upstream.accepts(exported)).toBe(true)
        const reloaded = asClass(parse(exported))!
        expect(reloaded.body.classes).toEqual(edited.value.body.classes)
        expect(reloaded.body.classDefs).toEqual(original.body.classDefs)
      }
    } finally {
      await upstream.close()
    }
  })

  test.each(['o', 'class', 'namespace', 'style', 'classDef', '$A', 'title', 'TITLE', 'accTitle', 'ACCDESCR', 'classDiagram'])('keeps required quoting for endpoint %s through edits and rendering', async id => {
    const forward = `\`${id}\` ()..* B`
    const reverse = `B -- \`${id}\` : linked`
    const source = `classDiagram\n${forward}\n${reverse}\nnote for \`${id}\` "attached"\nclick \`${id}\` href "https://example.com"`
    const original = asClass(parse(source))!
    expect(original.body.relations).toEqual([
      { from: id, to: 'B', kind: 'lollipop', markerAt: 'both', fromKind: 'lollipop', toKind: 'composition', lineStyle: 'dashed' },
      { from: 'B', to: id, kind: 'link-solid', markerAt: 'none', label: 'linked' },
    ])
    const edited = mutate(original, { kind: 'add_member', class: 'B', text: '+active()' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const exported = serializeMermaid(edited.value)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(exported)).toBe(true)
    } finally {
      await upstream.close()
    }
    expect(exported).toContain(`class \`${id}\``)
    expect(exported).toContain(forward)
    expect(exported).toContain(reverse)
    const reloaded = asClass(parse(exported))!
    expect(reloaded.body.classes.map(node => node.id)).toEqual([id, 'B'])
    expect(reloaded.body.classes.find(node => node.id === id)?.href).toBe('https://example.com')
    expect(reloaded.body.relations).toEqual(original.body.relations)
    expect(reloaded.body.notes).toEqual([{ for: id, text: 'attached' }])
    expect(verifyMermaid(edited.value).warnings).toEqual([])
    for (const input of [edited.value, exported]) {
      const relations = renderMermaidSVG(input).match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
      expect(relations).toHaveLength(2)
      expect(relations[0]).toContain(`data-from="${id}" data-to="B"`)
      expect(relations[0]).toContain('marker-start="url(#cls-lollipop)"')
      expect(relations[0]).toContain('marker-end="url(#cls-composition)"')
      expect(relations[0]).toContain('stroke-dasharray=')
      expect(relations[1]).toContain(`data-from="B" data-to="${id}"`)
      expect(relations[1]).not.toContain('marker-start=')
      expect(relations[1]).not.toContain('marker-end=')
    }
  })

  test.each([
    { arrow: '<|--', kind: 'inheritance', markerAt: 'from', start: 'cls-inherit', end: '' },
    { arrow: '--|>', kind: 'inheritance', markerAt: 'to', start: '', end: 'cls-inherit' },
    { arrow: '*--', kind: 'composition', markerAt: 'from', start: 'cls-composition', end: '' },
    { arrow: '--*', kind: 'composition', markerAt: 'to', start: '', end: 'cls-composition' },
    { arrow: 'o--', kind: 'aggregation', markerAt: 'from', start: 'cls-aggregation', end: '' },
    { arrow: '--o', kind: 'aggregation', markerAt: 'to', start: '', end: 'cls-aggregation' },
    { arrow: '<--', kind: 'association', markerAt: 'from', start: 'cls-arrow', end: '' },
    { arrow: '-->', kind: 'association', markerAt: 'to', start: '', end: 'cls-arrow' },
    { arrow: '<..', kind: 'dependency', markerAt: 'from', start: 'cls-arrow', end: '' },
    { arrow: '..>', kind: 'dependency', markerAt: 'to', start: '', end: 'cls-arrow' },
    { arrow: '<|..', kind: 'realization', markerAt: 'from', start: 'cls-inherit', end: '' },
    { arrow: '..|>', kind: 'realization', markerAt: 'to', start: '', end: 'cls-inherit' },
    { arrow: '()--', kind: 'lollipop', markerAt: 'from', start: 'cls-lollipop', end: '' },
    { arrow: '--()', kind: 'lollipop', markerAt: 'to', start: '', end: 'cls-lollipop' },
    { arrow: '--', kind: 'link-solid', markerAt: 'none', start: '', end: '' },
    { arrow: '..', kind: 'link-dashed', markerAt: 'none', start: '', end: '' },
    { arrow: '<-->', kind: 'association', markerAt: 'both', start: 'cls-arrow', end: 'cls-arrow' },
    { arrow: 'o--*', kind: 'aggregation', markerAt: 'both', start: 'cls-aggregation', end: 'cls-composition' },
  ])('keeps $arrow marker ownership after an unrelated edit, export and reload', ({ arrow, kind, markerAt, start, end }) => {
    const relationSource = kind === 'lollipop' ? `Person ${arrow} Animal : related` : `Person "one" ${arrow} "many" Animal : related`
    const source = `classDiagram\n${relationSource}`
    const original = asClass(parse(source))!
    const from = kind === 'lollipop' && markerAt === 'from' ? 'interface0' : 'Person'
    const to = kind === 'lollipop' && markerAt === 'to' ? 'interface0' : 'Animal'
    const expected = { from, to, kind, markerAt, label: 'related', ...(kind === 'lollipop' ? {} : { fromCardinality: 'one', toCardinality: 'many' }) }
    expect(original.body.relations).toEqual([expect.objectContaining(expected)])
    const edited = mutate(original, { kind: 'add_member', class: from === 'interface0' ? 'Animal' : 'Person', text: '+name: String' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const exported = serializeMermaid(edited.value)
    expect(exported).toContain(relationSource)
    const reloaded = asClass(parse(exported))!
    expect(edited.value.body.relations).toEqual([expect.objectContaining(expected)])
    expect(reloaded.body.relations).toEqual(edited.value.body.relations)
    expect(verifyMermaid(edited.value).warnings).toEqual([])
    for (const input of [edited.value, exported]) {
      const svg = renderMermaidSVG(input)
      const relation = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/)?.[0]
      expect(relation).toBeDefined()
      expect(relation).toContain(`data-from="${from}" data-to="${to}"`)
      expect(relation!.match(/marker-start="url\(#([^)]*)\)"/)?.[1] ?? '').toBe(start)
      expect(relation!.match(/marker-end="url\(#([^)]*)\)"/)?.[1] ?? '').toBe(end)
    }
  })

  test('serialize → parse → serialize is stable', () => {
    const src = `classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog\n  Animal <|-- Dog`
    const d = parse(src)
    const out1 = serializeMermaid(d)
    const reloaded = parse(out1)
    const typed = asClass(reloaded)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('round-trip lost the editable Class model')
    expect(typed.body.classes.map(node => ({ id: node.id, members: node.members }))).toEqual([
      { id: 'Animal', members: ['+String name', '+eat()'] },
      { id: 'Dog', members: [] },
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
