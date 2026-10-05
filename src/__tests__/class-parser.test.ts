/**
 * Tests for the class diagram parser.
 *
 * Covers: class blocks, attributes, methods, visibility, annotations,
 * relationships (all 6 types), cardinality, labels, inline attributes.
 */
import { describe, it, expect } from 'bun:test'
import { parseClassDiagram } from '../class/parser.ts'
import { asClass, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid } from '../agent/index.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseClassDiagram(lines)
}

// ============================================================================
// Class definitions
// ============================================================================

describe('parseClassDiagram – class definitions', () => {
  it('compact namespace URL percent pairs retain meaning with near-linear parse cost', () => {
    for (const manyLinks of [false, true]) {
      expectNearLinearGrowth(manyLinks ? 'many compact links' : 'one long compact link', size => {
        const href = `https://example.com/${manyLinks ? '%%%%' : '%%'.repeat(size)}`
        const links = Array<string>(manyLinks ? Math.max(1, Math.floor(size / 16)) : 1).fill(`link A ${href}`).join('; ')
        const parsed = parseRegisteredMermaid(`classDiagram\nnamespace N { class A; ${links} }`)
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
        expect(asClass(parsed.value)?.body.classes).toEqual([
          { id: 'A', namespace: 'N', members: [], href },
        ])
      }, 16_000, 16)
    }
  })

  it('keeps semicolons inside quoted labels in compact namespaces', () => {
    const diagram = parse('classDiagram\nnamespace Domain { class A["Before; after"]; class B }')
    expect(diagram.classes.map(node => ({ id: node.id, label: node.label }))).toEqual([
      { id: 'A', label: 'Before; after' }, { id: 'B', label: 'B' },
    ])
    expect(diagram.namespaces[0]!.classIds).toEqual(['A', 'B'])
  })

  it('declaration shorthand styles the declared identity and its members', () => {
    const diagram = parse('classDiagram\nclass A:::hot\nclass B:::cold {\n+int count\n}\nclassDef hot fill:red\nclassDef cold fill:blue')
    expect(diagram.classes.map(node => ({ id: node.id, className: node.className, attributes: node.attributes.map(member => member.sourceText) }))).toEqual([
      { id: 'A', className: 'hot', attributes: [] }, { id: 'B', className: 'cold', attributes: ['+int count'] },
    ])
  })

  it.each([
    ['unknown authored statement', 'class A\nfuture statement', 'Unrecognized class statement "future statement"'],
    ['unterminated class body', 'class A {\n+String name', 'Unclosed class block'],
    ['unterminated namespace', 'namespace Domain {\nclass A', 'Unclosed namespace block'],
    ['extra close', 'class A\n}', 'Unexpected closing brace'],
    ['partially invalid class assignment', 'class A\nclass A,bad-id hot', 'Unrecognized class statement'],
  ])('refuses a partial drawing for %s', (_name, source, reason) => {
    expect(() => parse(`classDiagram\n${source}`)).toThrow(reason)
  })

  it('nested members keep literal percent pairs, source ownership, and meaning after an edit', () => {
    const source = 'classDiagram\nnamespace Outer {\n  class A {\n    %% explanation\n    +String name %% literal\n  }\n}\nclass B'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = asClass(parsed.value)
    if (!diagram) throw new Error('expected editable Class body')
    expect(diagram.body.classes.map(({ id, namespace, members }) => ({ id, namespace, members }))).toEqual([
      { id: 'A', namespace: 'Outer', members: ['+String name %% literal'] },
      { id: 'B', namespace: undefined, members: [] },
    ])
    // Legacy locations address canonical text (standalone comments removed);
    // exact spans address the authored document instead.
    expect(diagram.source.labels.get('class:A:member#0')).toEqual({ line: 4, col: 1 })
    const member = diagram.source.spans?.labels.get('class:A:member#0')
    expect(member).toBeDefined()
    expect(member!.start.line).toBe(5)
    expect(source.slice(member!.start.offset, member!.end.offset)).toBe('+String name %% literal')
    const edited = mutate(diagram, { kind: 'add_member', class: 'A', text: '+int count' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const serialized = serializeMermaid(edited.value)
    const reloaded = parseRegisteredMermaid(serialized)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(asClass(reloaded.value)?.body.classes.map(({ id, namespace, members }) => ({ id, namespace, members }))).toEqual([
      { id: 'A', namespace: 'Outer', members: ['+String name %% literal', '+int count'] },
      { id: 'B', namespace: undefined, members: [] },
    ])
    for (const renderedSource of [source, serialized]) {
      const svg = renderMermaidSVG(renderedSource)
      expect(svg).toMatch(/<tspan\b[^>]*>String name %% literal<\/tspan>/)
      expect(svg).not.toContain('explanation')
    }
  })

  it('parses a class block with attributes and methods', () => {
    const d = parse(`classDiagram
      class Animal {
        +String name
        +int age
        +eat() void
        +sleep()
      }`)
    expect(d.classes).toHaveLength(1)
    expect(d.classes[0]!.id).toBe('Animal')
    expect(d.classes[0]!.attributes.map(member => ({ name: member.name, type: member.type, visibility: member.visibility }))).toEqual([
      { name: 'name', type: 'String', visibility: '+' }, { name: 'age', type: 'int', visibility: '+' },
    ])
    expect(d.classes[0]!.methods.map(member => ({ name: member.name, type: member.type, visibility: member.visibility }))).toEqual([
      { name: 'eat', type: 'void', visibility: '+' }, { name: 'sleep', type: undefined, visibility: '+' },
    ])
  })

  it('parses attribute visibility (+ - # ~)', () => {
    const d = parse(`classDiagram
      class MyClass {
        +String publicField
        -int privateField
        #double protectedField
        ~bool packageField
      }`)
    expect(d.classes[0]!.attributes[0]!.visibility).toBe('+')
    expect(d.classes[0]!.attributes[1]!.visibility).toBe('-')
    expect(d.classes[0]!.attributes[2]!.visibility).toBe('#')
    expect(d.classes[0]!.attributes[3]!.visibility).toBe('~')
  })

  it('parses method with return type', () => {
    const d = parse(`classDiagram
      class Calc {
        +add(a, b) int
      }`)
    expect(d.classes[0]!.methods[0]!.name).toBe('add')
    expect(d.classes[0]!.methods[0]!.type).toBe('int')
  })

  it('parses annotation <<interface>>', () => {
    const d = parse(`classDiagram
      class Flyable {
        <<interface>>
        +fly() void
      }`)
    expect(d.classes[0]!.annotation).toBe('interface')
    expect(d.classes[0]!.methods).toHaveLength(1)
  })

  it('parses inline annotation syntax', () => {
    const d = parse(`classDiagram
      class Shape { <<abstract>> }`)
    expect(d.classes[0]!.annotation).toBe('abstract')
  })

  it('parses standalone class declaration', () => {
    const d = parse(`classDiagram
      class EmptyClass`)
    expect(d.classes).toHaveLength(1)
    expect(d.classes[0]!.id).toBe('EmptyClass')
  })

  it('consumes ::: styling shorthand without creating a phantom member', () => {
    const d = parse(`classDiagram
      class Account
      Account:::highlight
      class Registry$
      Registry$:::highlight
      class \`Display Name\`
      \`Display Name\`:::highlight`)
    expect(d.classes.map(cls => cls.id)).toEqual(['Account', 'Registry$', 'Display Name'])
    for (const cls of d.classes) {
      expect(cls.attributes).toEqual([])
      expect(cls.methods).toEqual([])
    }
    expect(d.classes[0]!.label).toBe('Account')
  })

  it('auto-creates classes from relationships', () => {
    const d = parse(`classDiagram
      Animal <|-- Dog`)
    expect(d.classes).toHaveLength(2)
    expect(d.classes.find(c => c.id === 'Animal')).toBeDefined()
    expect(d.classes.find(c => c.id === 'Dog')).toBeDefined()
  })
})

// ============================================================================
// Inline attributes
// ============================================================================

describe('parseClassDiagram – inline attributes', () => {
  it('parses inline attribute: ClassName : +Type name', () => {
    const d = parse(`classDiagram
      class Animal
      Animal : +String name
      Animal : +int age`)
    const cls = d.classes.find(c => c.id === 'Animal')!
    expect(cls.attributes).toHaveLength(2)
    expect(cls.attributes[0]!.name).toBe('name')
  })
})

// ============================================================================
// Relationships
// ============================================================================

describe('parseClassDiagram – relationships', () => {
  it('parses inheritance: <|-- (marker at from)', () => {
    const d = parse(`classDiagram
      Animal <|-- Dog`)
    expect(d.relationships).toHaveLength(1)
    expect(d.relationships[0]!.type).toBe('inheritance')
    expect(d.relationships[0]!.from).toBe('Animal')
    expect(d.relationships[0]!.to).toBe('Dog')
    expect(d.relationships[0]!.markerAt).toBe('from')
  })

  it('parses composition: *-- (marker at from)', () => {
    const d = parse(`classDiagram
      Car *-- Engine`)
    expect(d.relationships[0]!.type).toBe('composition')
    expect(d.relationships[0]!.markerAt).toBe('from')
  })

  it('parses aggregation: o-- (marker at from)', () => {
    const d = parse(`classDiagram
      University o-- Department`)
    expect(d.relationships[0]!.type).toBe('aggregation')
    expect(d.relationships[0]!.markerAt).toBe('from')
  })

  it('parses association: --> (marker at to)', () => {
    const d = parse(`classDiagram
      Customer --> Order`)
    expect(d.relationships[0]!.type).toBe('association')
    expect(d.relationships[0]!.markerAt).toBe('to')
  })

  it('parses dependency: ..> (marker at to)', () => {
    const d = parse(`classDiagram
      Service ..> Repository`)
    expect(d.relationships[0]!.type).toBe('dependency')
    expect(d.relationships[0]!.markerAt).toBe('to')
  })

  it('parses realization: ..|> (marker at to)', () => {
    const d = parse(`classDiagram
      Bird ..|> Flyable`)
    expect(d.relationships[0]!.type).toBe('realization')
    expect(d.relationships[0]!.markerAt).toBe('to')
  })

  // --- Reversed arrow variants ---

  it('parses reversed realization: <|.. (marker at from)', () => {
    const d = parse(`classDiagram
      Flyable <|.. Bird`)
    expect(d.relationships[0]!.type).toBe('realization')
    expect(d.relationships[0]!.from).toBe('Flyable')
    expect(d.relationships[0]!.to).toBe('Bird')
    expect(d.relationships[0]!.markerAt).toBe('from')
  })

  it('parses reversed composition: --* (marker at to)', () => {
    const d = parse(`classDiagram
      Engine --* Car`)
    expect(d.relationships[0]!.type).toBe('composition')
    expect(d.relationships[0]!.from).toBe('Engine')
    expect(d.relationships[0]!.to).toBe('Car')
    expect(d.relationships[0]!.markerAt).toBe('to')
  })

  it('parses reversed aggregation: --o (marker at to)', () => {
    const d = parse(`classDiagram
      Department --o University`)
    expect(d.relationships[0]!.type).toBe('aggregation')
    expect(d.relationships[0]!.from).toBe('Department')
    expect(d.relationships[0]!.to).toBe('University')
    expect(d.relationships[0]!.markerAt).toBe('to')
  })

  it('parses relationship with label', () => {
    const d = parse(`classDiagram
      Customer --> Order : places`)
    expect(d.relationships[0]!.label).toBe('places')
  })

  it('parses relationship with cardinality', () => {
    const d = parse(`classDiagram
      Customer "1" --> "*" Order : places`)
    expect(d.relationships[0]!.fromCardinality).toBe('1')
    expect(d.relationships[0]!.toCardinality).toBe('*')
  })

  it('handles multiple relationships', () => {
    const d = parse(`classDiagram
      Animal <|-- Dog
      Animal <|-- Cat
      Dog *-- Leg`)
    expect(d.relationships).toHaveLength(3)
  })
})

// ============================================================================
// Full diagram
// ============================================================================

describe('parseClassDiagram – full diagram', () => {
  it('parses a complete class hierarchy', () => {
    const d = parse(`classDiagram
      class Animal {
        <<abstract>>
        +String name
        +eat() void
        +sleep() void
      }
      class Dog {
        +String breed
        +bark() void
      }
      class Cat {
        +bool isIndoor
        +meow() void
      }
      Animal <|-- Dog
      Animal <|-- Cat`)

    expect(d.classes).toHaveLength(3)
    expect(d.relationships).toHaveLength(2)
    const animal = d.classes.find(c => c.id === 'Animal')!
    expect(animal.annotation).toBe('abstract')
    expect(animal.attributes).toHaveLength(1)
    expect(animal.methods).toHaveLength(2)
  })
})
