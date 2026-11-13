import { describe, expect, test } from 'bun:test'

import { parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { asClass, type ClassMutationOp, type ClassValidDiagram } from '../agent/types.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, mutate, verifyMermaid } from '../agent/index.ts'

function legacy(source: string) {
  return parseClassDiagram(source.split('\n').map(line => line.trim()).filter(Boolean))
}

function structured(source: string): ClassValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asClass(parsed.value)
  if (!narrowed) throw new Error(`expected structured class body, got ${parsed.value.body.kind}`)
  return narrowed
}

function apply(diagram: ClassValidDiagram, op: ClassMutationOp): ClassValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('class generic type parameters (#118)', () => {
  test('legacy parser gives generic-bearing declarations and relation endpoints one stable bare identity', () => {
    const diagram = legacy('classDiagram\n  class Box~T~\n  Box~T~ <|-- IntBox')
    expect(diagram.classes.map(c => ({ id: c.id, generic: c.generic, label: c.label }))).toEqual([
      { id: 'Box', generic: 'T', label: 'Box<T>' },
      { id: 'IntBox', generic: undefined, label: 'IntBox' },
    ])
    expect(diagram.relationships[0]).toMatchObject({ from: 'Box', to: 'IntBox' })
  })

  test('relation-only generic syntax becomes structured, renders, and round-trips canonically', () => {
    const source = 'classDiagram\n  Box~T~ <|-- IntBox\n'
    const diagram = structured(source)
    expect(diagram.body.classes).toContainEqual(expect.objectContaining({ id: 'Box', generic: 'T' }))
    expect(diagram.body.relations[0]).toMatchObject({ from: 'Box', to: 'IntBox' })

    const canonical = serializeMermaid(diagram)
    expect(canonical).toContain('class Box~T~')
    expect(canonical).toContain('Box <|-- IntBox')
    expect(structured(canonical).body).toEqual(diagram.body)
    expect(verifyMermaid(diagram).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'class_opaque' }))

    const svg = renderMermaidSVG(source)
    expect(svg).toContain('Box&lt;T&gt;')
    expect(svg).toContain('data-from="Box"')
  })

  test('generic declarations remain structured inside namespaces with members', () => {
    const diagram = structured(`classDiagram
  namespace Data {
    class Box~T~ {
      +items List~T~
    }
  }
`)
    expect(diagram.body.classes[0]).toMatchObject({ id: 'Box', generic: 'T', namespace: 'Data' })
    expect(diagram.body.classes[0]!.members).toEqual(['+items List~T~'])
    expect(serializeMermaid(diagram)).toContain('class Box~T~ {')
  })

  test('typed mutation can add, update, and remove a generic parameter', () => {
    let diagram = apply(structured('classDiagram\n  class Root\n'), {
      kind: 'add_class', id: 'Box', generic: 'T', members: ['+value T'],
    })
    expect(diagram.body.classes.find(c => c.id === 'Box')).toMatchObject({ generic: 'T' })
    expect(diagram.canonicalSource).toContain('class Box~T~ {')

    diagram = apply(diagram, { kind: 'set_class_generic', class: 'Box', generic: 'Key, Value' })
    expect(diagram.body.classes.find(c => c.id === 'Box')!.generic).toBe('Key, Value')
    diagram = apply(diagram, { kind: 'set_class_generic', class: 'Box', generic: null })
    expect(diagram.body.classes.find(c => c.id === 'Box')!.generic).toBeUndefined()
  })

  test('rejects invalid or missing generic mutation targets', () => {
    const diagram = structured('classDiagram\n  class Box\n')
    expect(mutate(diagram, { kind: 'set_class_generic', class: 'Missing', generic: 'T' })).toMatchObject({
      ok: false, error: { code: 'CLASS_NOT_FOUND' },
    })
    expect(mutate(diagram, { kind: 'set_class_generic', class: 'Box', generic: 'bad~type' })).toMatchObject({
      ok: false, error: { code: 'INVALID_OP' },
    })
  })
})
