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
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, mutate, asClass, describeMermaidFacts, renderMermaidSVG, renderMermaidASCII, verifyMermaid } from '../agent/index.ts'
import type { ClassValidDiagram, ClassMutationOp } from '../agent/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

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

test('note edits write valid Mermaid while keeping literal quotes, backslashes and entity text', async () => {
  const text = 'A "quote", \\ path, and literal &quot;'
  const edited = apply(classDiagram('classDiagram\nclass A'), { kind: 'add_note', for: 'A', text })
  const source = serializeMermaid(edited)
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
  } finally {
    await upstream.close()
  }
  expect(classDiagram(source).body.notes).toEqual([{ for: 'A', text }])
  expect(renderParse(source).notes).toEqual([{ for: 'A', text }])
})

test('Class entity text stays literal in labels, namespace titles, relations, cards and notes after an edit', async () => {
  const source = `classDiagram
namespace N["#lt;u#gt;group#lt;/u#gt;"] {
class A["#lt;b#gt;box#lt;/b#gt;"]
class B
}
A "#lt;i#gt;one#lt;/i#gt;" --> "#quot;many#quot;" B : #lt;s#gt;edge#lt;/s#gt;
note for A "#lt;b#gt;note#lt;/b#gt;"`
  const diagram = classDiagram(source)
  expect(diagram.body.classes[0]?.label).toBe('<b>box</b>')
  expect(diagram.body.namespaces?.[0]?.label).toBe('<u>group</u>')
  expect(diagram.body.relations[0]).toMatchObject({ label: '<s>edge</s>', fromCardinality: '<i>one</i>', toCardinality: '"many"' })
  expect(diagram.body.notes[0]?.text).toBe('<b>note</b>')
  const edited = apply(diagram, { kind: 'add_member', class: 'B', text: '+value' })
  const serialized = serializeMermaid(edited)
  const reparsed = classDiagram(serialized)
  expect(reparsed.body).toEqual(edited.body)
  expect(serializeMermaid(reparsed)).toBe(serialized)
  for (const current of [diagram, reparsed]) {
    const svg = renderMermaidSVG(current)
    const terminal = renderMermaidASCII(current)
    for (const text of ['<b>box</b>', '<u>group</u>', '<s>edge</s>', '<i>one</i>', '<b>note</b>']) {
      expect(svg).toContain(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      expect(terminal).toContain(text)
    }
  }
  const upstream = startUpstreamMermaid()
  try { expect(await upstream.accepts(serialized)).toBe(true) } finally { await upstream.close() }
})

test('Class typed labels and relationship text escape literal entity-looking text and quotes', async () => {
  let diagram = classDiagram('classDiagram\nclass A')
  diagram = apply(diagram, { kind: 'add_class', id: 'B', label: 'say "hi" and literal #quot;' })
  diagram = apply(diagram, { kind: 'add_relation', from: 'A', to: 'B', relKind: 'association', label: 'literal #quot;: end;' })
  diagram = apply(diagram, { kind: 'add_note', for: 'A', text: 'literal #quot; and "quote"' })
  const source = serializeMermaid(diagram)
  const reparsed = classDiagram(source)
  expect(reparsed.body.classes.find(node => node.id === 'B')?.label).toBe('say "hi" and literal #quot;')
  expect(reparsed.body.relations[0]?.label).toBe('literal #quot;: end;')
  expect(reparsed.body.notes[0]?.text).toBe('literal #quot; and "quote"')
  expect(describeMermaidFacts(reparsed)).toEqual(describeMermaidFacts(diagram))
  const upstream = startUpstreamMermaid()
  try { expect(await upstream.accepts(source)).toBe(true) } finally { await upstream.close() }
})

test('Class labels preserve real formatting beside literal entity-produced markup and measure the visible text', () => {
  const source = 'classDiagram\nclass A["**real** #42;literal#42; #lt;b#gt;tag#lt;/b#gt;"]'
  const diagram = classDiagram(source)
  const edited = apply(diagram, { kind: 'add_member', class: 'A', text: '+value' })
  const written = serializeMermaid(edited)
  expect(classDiagram(written).body.classes[0]?.label).toBe('**real** *literal* <b>tag</b>')
  expect(renderMermaidASCII(written)).toContain('real *literal* <b>tag</b>')
  expect(renderMermaidSVG(written)).toContain('&lt;b&gt;tag&lt;/b&gt;')
  expect(verifyMermaid(edited, { labelCharCap: 20 }).warnings.some(warning => warning.code === 'LABEL_OVERFLOW' && warning.target === 'A')).toBe(true)
})

test.each([
  ['#9829; #35; #amp;', '♥ # &'],
  ['literal #92;n', 'literal \\n'],
  ['a#quot;b', 'a"b'],
  ['literal #35;quot#59;', 'literal #quot;'],
])('Class display entities keep %s through edit and reload', async (authored, expected) => {
  const diagram = classDiagram(`classDiagram\nclass A["${authored}"]\nA --> B : ${authored}\nnote for A "${authored}"`)
  const edited = apply(diagram, { kind: 'add_member', class: 'B', text: '+value' })
  const source = serializeMermaid(edited)
  const reparsed = classDiagram(source)
  expect(reparsed.body.classes[0]?.label).toBe(expected)
  expect(reparsed.body.relations[0]?.label).toBe(expected)
  expect(reparsed.body.notes[0]?.text).toBe(expected)
  expect(describeMermaidFacts(reparsed)).toEqual(describeMermaidFacts(edited))
  expect(renderMermaidASCII(source)).toContain(expected)
  const upstream = startUpstreamMermaid()
  try { expect(await upstream.accepts(source)).toBe(true) } finally { await upstream.close() }
})

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
  test('keeps first-seen namespace order when a labeled parent has direct classes', () => {
    const diagram = classDiagram('classDiagram\nnamespace Parent.Child {\nclass B\n}\nnamespace Parent["Keep"] {\nclass A\n}')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toBe('classDiagram\n  namespace Parent.Child {\n    class B\n  }\n  namespace Parent["Keep"] {\n    class A\n  }\n')
    expect(classDiagram(serialized).body.classes).toEqual(diagram.body.classes)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other2' },
  ] as const)('preserves child-before-parent namespaces and trailing siblings after $kind', async op => {
    const diagram = classDiagram('classDiagram\nnamespace Parent.Child {\nclass B\n}\nnamespace Parent["Keep label"] {\nclass A\n}\nnamespace Other1 {\nclass D\n}\nnamespace Other2 {\nclass E\n}')
    const edited = apply(diagram, op)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    const byId = (nodes: typeof edited.body.classes) => [...nodes].sort((a, b) => a.id.localeCompare(b.id))
    const byName = (namespaces: NonNullable<typeof edited.body.namespaces>) => [...namespaces].sort((a, b) => a.name.localeCompare(b.name))
    expect(byId(reparsed.body.classes)).toEqual(byId(edited.body.classes))
    expect(byName(reparsed.body.namespaces!)).toEqual(byName(edited.body.namespaces!))
    expect(source.match(/class B\b/g)).toHaveLength(1)
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { parent: 'Parent', sibling: true },
    { parent: 'Parent.Middle', sibling: true },
    { parent: 'Parent', sibling: false },
  ])('writes a later labeled ancestor $parent with sibling=$sibling', async ({ parent, sibling }) => {
    const source = `classDiagram\nnamespace ${parent}.Child {\nclass B\n}\nnamespace ${parent}["Keep label"] {\nnamespace Other {\nclass A\n}\n}${sibling ? '\nnamespace Sibling {\nclass C\n}' : ''}`
    const diagram = classDiagram(source)
    const serialized = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(serialized)
    expect(reparsed.body.classes).toEqual(diagram.body.classes)
    const labeled = renderParse(serialized).namespaces[0]!
    expect(parent === 'Parent' ? labeled.label : labeled.children[0]?.label).toBe('Keep label')
    expect(serialized.match(/class B\b/g)).toHaveLength(1)
    expect(serializeMermaid(reparsed)).toBe(serialized)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
  ] as const)('keeps a labeled parent with surviving descendants valid after $kind', async op => {
    const diagram = classDiagram('classDiagram\nnamespace Parent["Keep this label"] {\nclass A\nnamespace Child {\nclass B\n}\n}\nclass C')
    const edited = apply(diagram, op)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    const byId = (nodes: typeof edited.body.classes) => [...nodes].sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(reparsed.body.classes)).toEqual(byId(edited.body.classes))
    expect(reparsed.body.namespaces).toEqual(edited.body.namespaces)
    expect(renderParse(source).namespaces[0]?.label).toBe('Keep this label')
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other' },
  ] as const)('prunes empty unlabeled namespaces after $kind and exports valid Mermaid', async op => {
    const diagram = classDiagram('classDiagram\nnamespace N {\nclass A\n}\nclass B')
    const edited = apply(diagram, op)
    expect(edited.body.namespaces?.some(namespace => namespace.name === 'N') ?? false).toBe(false)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    expect(reparsed.body.classes).toEqual(edited.body.classes)
    expect(reparsed.body.classes.find(node => node.id === 'B')).toEqual({ id: 'B', members: [] })
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other' },
  ] as const)('refuses $kind when it would discard an explicit namespace label', op => {
    const diagram = classDiagram('classDiagram\nnamespace N["Meaningful group"] {\nclass A\n}\nclass B')
    const before = serializeMermaid(diagram)
    const result = mutate(diagram, op)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('N') })
    expect(serializeMermaid(diagram)).toBe(before)
  })

  test.each(['namespace N {\n}', 'namespace N["Meaningful group"] {\n}'])('preserves directly authored empty namespaces as opaque source: %s', namespace => {
    const source = `classDiagram\n${namespace}\nclass B`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(asClass(parsed.value)).toBeNull()
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
  })

  test('repeated declarations across namespaces preserve authored source and every rendered group', async () => {
    const source = `classDiagram
namespace First { class Shared }
namespace Second { class Shared
}
namespace Third {
class Shared {
+String name
}
class Other
}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    const native = renderParse(source)
    expect(native.classes.map(node => node.id)).toEqual(['Shared', 'Other'])
    expect([...membershipByPath(native.namespaces)]).toEqual([['First', ['Shared']], ['Second', []], ['Third', ['Other']]])
    expect(native.classes[0]!.attributes.map(member => member.name)).toEqual(['name'])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test('repeated declarations within the same namespace remain editable', () => {
    const diagram = classDiagram('classDiagram\nnamespace First { class Shared }\nnamespace First { class Shared }')
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'Shared', namespace: 'First' }])
  })

  test.each([
    ['class Shared', 'class Shared hot'],
    ['class Shared hot', 'class Shared'],
  ])('a style/declaration claim across namespaces stays source-preserved in either order: %s then %s', async (first, second) => {
    const source = `classDiagram\nnamespace First { ${first} }\nnamespace Second { ${second} }\nclassDef hot fill:red`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    const native = renderParse(source)
    expect([...membershipByPath(native.namespaces)]).toEqual([['First', ['Shared']], ['Second', []]])
    expect(native.classes.map(node => ({ id: node.id, className: node.className }))).toEqual([{ id: 'Shared', className: 'hot' }])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test.each([' class Free', 'class Free', '; class Free', ';class Free', '\nclass Free'])('a statement after a compact namespace retains meaning and diagnoses nonportable separation: %j', async suffix => {
    const source = `classDiagram\nnamespace Outer { class First }${suffix}`
    const diagram = classDiagram(source)
    const expected = [{ id: 'First', namespace: 'Outer' }, { id: 'Free', namespace: undefined }]
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(expected)
    const svg = renderMermaidSVG(source)
    expect(svg).toMatch(/<text\b[^>]*>First<\/text>/)
    expect(svg).toMatch(/<text\b[^>]*>Free<\/text>/)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual(
      suffix.startsWith('\n') ? [] : [expect.objectContaining({ syntax: 'class_statement_after_namespace_close', line: 2 })],
    )
    const serialized = serializeMermaid(diagram)
    expect(classDiagram(serialized).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(expected)
    expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(suffix.startsWith('\n'))
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test.each([
    { body: 'class First; class Second', ids: ['First', 'Second'], unsupported: true },
    { body: 'class First;', ids: ['First'], unsupported: true },
    { body: '; class First', ids: ['First'], unsupported: true },
    { body: ';; class First', ids: ['First'], unsupported: true },
    { body: 'class First["before; after"]', ids: ['First'], unsupported: false },
    { body: 'class First', ids: ['First'], unsupported: false },
  ])('compact namespace semicolons are diagnosed as syntax, not quoted data: $body', async ({ body, ids, unsupported }) => {
    const source = `classDiagram\nnamespace Outer { ${body} }`
    const diagram = classDiagram(source)
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(ids.map(id => ({ id, namespace: 'Outer' })))
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual(
      unsupported ? [expect.objectContaining({ syntax: 'class_compact_semicolon_statement_extension', line: 2 })] : [],
    )
    const serialized = serializeMermaid(diagram)
    expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(!unsupported)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test('an empty separator inside a namespace is diagnosed even without an adjacent statement', async () => {
    const source = 'classDiagram\nnamespace Outer { ; }'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'class_compact_semicolon_statement_extension', line: 2,
    }))
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
    } finally {
      await upstream.close()
    }
    // Empty namespaces stay source-preserved rather than becoming editable
    // bodies whose canonical export would be rejected by Mermaid.
  })

  test('a trailing comment after a compact namespace is diagnosed for portability', async () => {
    const source = 'classDiagram\nnamespace Outer { class First } %% tail'
    expect(classDiagram(source).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'First', namespace: 'Outer' }])
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'class_trailing_comment', line: 2,
    }))
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
      const serialized = serializeMermaid(classDiagram(source))
      expect(await upstream.accepts(serialized)).toBe(true)
      expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    } finally {
      await upstream.close()
    }
  })

  test.each([
    {
      name: 'a quoted name is one namespace atom, not a hierarchy',
      source: 'classDiagram\nnamespace `A::B` {\nclass `IPC::Sender`\n}',
      classes: [{ id: 'IPC::Sender', namespace: 'A::B' }],
      membership: [['A::B', ['IPC::Sender']]],
    },
    {
      name: 'a statement may follow its namespace opener on the same physical line',
      source: 'classDiagram\nnamespace Domain { class First\nclass Second\n}\nclass Free',
      classes: [{ id: 'First', namespace: 'Domain' }, { id: 'Second', namespace: 'Domain' }, { id: 'Free', namespace: undefined }],
      membership: [['Domain', ['First', 'Second']]],
    },
    {
      name: 'a nested quoted atom remains a child namespace after serialization',
      source: 'classDiagram\nnamespace Outer {\nnamespace `A::B` { class `IPC::Sender`\n}\n}',
      classes: [{ id: 'IPC::Sender', namespace: 'Outer.A::B' }],
      membership: [['Outer', []], ['Outer.A::B', ['IPC::Sender']]],
    },
  ])('$name', async ({ source, classes, membership }) => {
    const diagram = classDiagram(source)
    const expectedMembership: Array<[string, string[]]> = membership.map(([path, ids]) => [path, [...ids]])
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([...classes])
    expect([...membershipByPath(renderParse(source).namespaces)]).toEqual(expectedMembership)
    const edited = apply(diagram, { kind: 'add_member', class: classes[0]!.id, text: '+String name' })
    const serialized = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
    expect([...membershipByPath(renderParse(serialized).namespaces)]).toEqual(expectedMembership)
    expect(classDiagram(serialized).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([...classes])
    expect(classDiagram(serialized).body.classes[0]!.members).toEqual(['+String name'])
  })

  test('a literal dot in a quoted namespace remains source-preserved when the typed path cannot represent it', () => {
    const source = 'classDiagram\nnamespace `A.B` {\nclass First\n}'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(renderParse(source).namespaces).toEqual([{ name: 'A.B', classIds: ['First'], children: [] }])
  })

  test.each([
    'namespace `A.B` { class First }\nnamespace A.B { class Second }',
    'namespace A.B { class Second }\nnamespace `A.B` { class First }',
  ])('rejects a quoted-name/hierarchy collision rather than placing a class in the wrong namespace: %s', body => {
    const source = `classDiagram\n${body}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(() => renderParse(source)).toThrow('Class namespace path collision "A.B"')
  })

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
