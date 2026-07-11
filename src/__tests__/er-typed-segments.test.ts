import { describe, expect, test } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asEr, type ErMutationOp, type ErValidDiagram } from '../agent/types.ts'
import { parseErDiagram } from '../er/parser.ts'
import { renderMermaidSVG } from '../index.ts'

function er(source: string): ErValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asEr(parsed.value)
  if (!narrowed) throw new Error(`expected structured ER body, got ${parsed.value.body.kind}`)
  return narrowed
}

function apply(diagram: ErValidDiagram, op: ErMutationOp): ErValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('typed ER styling and ordered opaque segments (B09)', () => {
  test('models classDef, class, style, and endpoint shorthand and renders their paint', () => {
    let diagram = er(`erDiagram
      CUSTOMER:::hot ||--o{ ORDER : places
      classDef hot fill:#ff0000,stroke:#220000,color:#ffffff
      class ORDER hot
      style ORDER stroke-width:4px`)
    expect(diagram.body.classDefs?.hot?.fill).toBe('#ff0000')
    expect(diagram.body.entities.find(item => item.id === 'CUSTOMER')?.className).toBe('hot')
    expect(diagram.body.entities.find(item => item.id === 'ORDER')?.style?.['stroke-width']).toBe('4px')
    const svg = renderMermaidSVG(serializeMermaid(diagram))
    expect(svg).toContain('class="entity hot"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('stroke-width="4"')

    diagram = apply(diagram, { kind: 'define_class', name: 'cool', style: 'fill:#abcdef,stroke:#123456' })
    diagram = apply(diagram, { kind: 'set_entity_class', entity: 'ORDER', className: 'cool' })
    diagram = apply(diagram, { kind: 'set_entity_style', entity: 'ORDER', style: 'color:#010203' })
    const reparsed = er(serializeMermaid(diagram))
    expect(reparsed.body.classDefs?.cool?.fill).toBe('#abcdef')
    expect(reparsed.body.entities.find(item => item.id === 'ORDER')).toEqual(expect.objectContaining({ className: 'cool', style: { color: '#010203' } }))
  })

  test('paint mutations reject line breaks that would create entities', () => {
    const diagram = er('erDiagram\n  A')
    for (const operation of [
      { kind: 'define_class', name: 'hot', style: 'fill:#f00\nInjected' },
      { kind: 'set_entity_style', entity: 'A', style: 'fill:#f00\rInjected' },
    ] as ErMutationOp[]) {
      const result = mutate(diagram, operation)
      expect(result.ok, operation.kind).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('single-line') })
    }
    expect(er(serializeMermaid(diagram)).body).toEqual(diagram.body)
  })

  test('keeps tolerated subgraph boundaries ordered while inner ER statements stay typed', () => {
    let diagram = er(`erDiagram
      subgraph Domain
        direction RL
        CUSTOMER {
          string id PK
        }
        CUSTOMER ||--o{ ORDER : places
      end`)
    expect(diagram.body.statements?.map(statement => statement.kind)).toEqual([
      'opaque', 'opaque', 'entity', 'relation', 'opaque',
    ])
    expect(diagram.body.entities.map(item => item.id)).toEqual(['CUSTOMER', 'ORDER'])

    diagram = apply(diagram, { kind: 'add_attribute', entity: 'ORDER', text: 'string number UK' })
    const serialized = serializeMermaid(diagram)
    expect(serialized.indexOf('subgraph Domain')).toBeLessThan(serialized.indexOf('CUSTOMER {'))
    expect(serialized.indexOf('CUSTOMER {')).toBeLessThan(serialized.indexOf('CUSTOMER ||--o{ ORDER'))
    expect(serialized.indexOf('CUSTOMER ||--o{ ORDER')).toBeLessThan(serialized.indexOf('end'))
    expect(serialized).toContain('ORDER {\n    string number UK\n  }')
    expect(parseErDiagram(serialized.split('\n').map(line => line.trim()).filter(Boolean)).entities.map(item => item.id)).toEqual(['CUSTOMER', 'ORDER'])
  })

  test('rejects identity edits that would stale an opaque segment reference', () => {
    const diagram = er(`erDiagram
      subgraph Domain
        CUSTOMER
        unsupported CUSTOMER annotation
      end`)
    const result = mutate(diagram, { kind: 'rename_entity', from: 'CUSTOMER', to: 'CLIENT' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('opaque preserved ER segment references it')
    expect(serializeMermaid(diagram)).toContain('unsupported CUSTOMER annotation')
  })

  test('models root direction and exposes a typed direction mutation', () => {
    let diagram = er('erDiagram\n  direction TB\n  A ||--|| B : owns')
    expect(diagram.body.direction).toBe('TB')
    diagram = apply(diagram, { kind: 'set_direction', direction: 'RL' })
    expect(serializeMermaid(diagram)).toContain('direction RL')
  })
})
