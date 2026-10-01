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
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, mutate, asClass, describeMermaidFacts, renderMermaidSVG, verifyMermaid } from '../agent/index.ts'
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
    expect(classDiagram(source).body.namespaces).toEqual([{ name: 'Outer' }])
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'class_compact_semicolon_statement_extension', line: 2,
    }))
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
    } finally {
      await upstream.close()
    }
    // Empty namespace serialization has an existing portability limitation;
    // this case protects the separator diagnostic, not a portable writer claim.
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
