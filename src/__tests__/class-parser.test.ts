/**
 * Tests for the class diagram parser.
 *
 * Covers: class blocks, attributes, methods, visibility, annotations,
 * relationships (all 6 types), cardinality, labels, inline attributes.
 */
import { describe, it, expect } from 'bun:test'
import { parseClassDiagram } from '../class/parser.ts'
import { asClass, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
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

  it('a member followed by a closing brace leaves later classes in their namespace', () => {
    const source = 'classDiagram\nnamespace N {\nclass A {\n+foo : string\nTriangle }\nclass B {\n+bar : int\n}\n}\nA --> B'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(asClass(parsed.value)?.body.classes).toEqual([
      { id: 'A', namespace: 'N', members: ['+foo : string', 'Triangle'] },
      { id: 'B', namespace: 'N', members: ['+bar : int'] },
    ])
    const diagram = parse(source)
    expect(diagram.classes.map(node => ({ id: node.id, members: node.attributes.map(member => member.sourceText) }))).toEqual([
      { id: 'A', members: ['+foo : string', 'Triangle'] },
      { id: 'B', members: ['+bar : int'] },
    ])
    expect(diagram.namespaces).toEqual([{ name: 'N', classIds: ['A', 'B'], children: [] }])
    expect(diagram.relationships).toEqual([{ from: 'A', to: 'B', type: 'association', markerAt: 'to' }])
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
    ['partially invalid class assignment', 'class A\nclass A,bad/id hot', 'Unrecognized class statement'],
    // Text that cannot hold a line break stays on its line.
    ['backtick name spanning lines', 'class `A\nB`', 'Unrecognized class statement'],
    ['link tooltip spanning lines', 'class A\nclick A href "https://example.com" "first\nsecond"', 'Unrecognized class link statement'],
    // A member runs to a brace: Mermaid rejects a `{` inside a class block.
    ['open brace among the members on a block\'s line', 'namespace N {\nclass A {   lass B{\nint x\n}\n}', 'Unrecognized class statement "class A {   lass B{"'],
    ['open brace before the block closes on its line', 'class A { +x{ }', 'Unrecognized class statement "class A { +x{ }"'],
    // Mermaid's class lexer reads these words as keywords where a class name stands.
    ['a keyword as the class of a member statement', 'class A\nclass: +deposit(amount)', 'Unrecognized class member statement "class: +deposit(amount)"'],
    ['a keyword Mermaid reads inside backticks too', 'class A\n`note` : x', 'Unrecognized class member statement "`note` : x"'],
    ['`call` before a blank where a statement starts', 'class A\ncall : x', 'Unrecognized class member statement "call : x"'],
    ['a keyword as a declared class', 'class href', 'Unrecognized class statement "class href"'],
    ['a link target as a relationship endpoint', 'A --> _self', 'Unrecognized class relationship statement "A --> _self"'],
    ['`call` before a blank as a relationship source', 'call "1" --> A', 'Unrecognized class relationship statement "call "1" --> A"'],
    ['`call` ending a relationship', 'A -- call', 'Unrecognized class relationship statement "A -- call"'],
    ['open brace in a member below the block\'s line', 'namespace N {\nclass A {\nint x\nstrontend {\ncing : foo\n}\nclass B\n}', 'Unrecognized class member "strontend {"'],
    ['a class block opened inside another', 'class C {\nclass A {\n}\n}', 'Unrecognized class member "class A {"'],
  ])('refuses a partial drawing for %s', (_name, source, reason) => {
    expect(() => parse(`classDiagram\n${source}`)).toThrow(reason)
  })

  // Mermaid's string runs on across line breaks to its next quote. Ours reads
  // the break as the label line break `<br>` wherever the text can hold one.
  it.each([
    // Mermaid's class string has no escapes: a backslash before the closing
    // quote is text, and the string ends on its line.
    { body: 'class A["C:\\"]\nB --> C\nclass D["x"]', native: { classes: [{ id: 'A', label: 'C:\\' }, { id: 'B' }, { id: 'C' }, { id: 'D', label: 'x' }], relationships: [{ from: 'B', to: 'C' }] }, typed: { classes: [{ id: 'A', label: 'C:\\' }, { id: 'B' }, { id: 'C' }, { id: 'D', label: 'x' }], relations: [{ from: 'B', to: 'C' }] }, written: 'class A["C:\\"]' },
    { body: 'note for A "C:\\"\nclass B', native: { notes: [{ for: 'A', text: 'C:\\' }], classes: [{ id: 'A' }, { id: 'B' }] }, typed: { notes: [{ for: 'A', text: 'C:\\' }] }, written: 'note for A "C:&#92;"' },
    { body: 'note "a\\\\b"', native: { notes: [{ text: 'a\\\\b' }] }, typed: { notes: [{ text: 'a\\\\b' }] }, written: 'note "a&#92;&#92;b"' },
    { body: 'A "0..*\\" --> B\nB "1" --> C', native: { relationships: [{ from: 'A', fromCardinality: '0..*\\' }, { from: 'B', fromCardinality: '1' }] }, typed: { relations: [{ from: 'A', fromCardinality: '0..*\\' }, { from: 'B', fromCardinality: '1' }] }, written: 'A "0..*\\" --> B' },
    { body: 'note for A "l1\nl2"', native: { notes: [{ for: 'A', text: 'l1\nl2' }] }, typed: { notes: [{ for: 'A', text: 'l1<br>l2' }] }, written: 'note for A "l1<br>l2"' },
    { body: 'note "a\nb"', native: { notes: [{ text: 'a\nb' }] }, typed: { notes: [{ text: 'a<br>b' }] }, written: 'note "a<br>b"' },
    { body: 'A "many\nitems" --> B', native: { relationships: [{ fromCardinality: 'many\nitems' }] }, typed: { relations: [{ fromCardinality: 'many\nitems' }] }, written: 'A "many<br/>items" --> B' },
    { body: 'A "x\ny" --> "one\nor\nmore" B : r', native: { relationships: [{ fromCardinality: 'x\ny', toCardinality: 'one\nor\nmore', label: 'r' }] }, typed: { relations: [{ fromCardinality: 'x\ny', toCardinality: 'one\nor\nmore', label: 'r' }] }, written: 'A "x<br/>y" --> "one<br/>or<br/>more" B : r' },
    { body: 'class A["l1\nl2"] {\n+x\n}', native: { classes: [{ id: 'A', label: 'l1\nl2' }] }, typed: { classes: [{ id: 'A', label: 'l1<br>l2', members: ['+x'] }] }, written: 'class A["l1<br>l2"] {' },
    { body: 'namespace N["l1\nl2"] {\nclass A\nnote "a\nb" }', native: { namespaces: [{ name: 'N', label: 'l1\nl2', classIds: ['A'] }], notes: [{ text: 'a\nb' }] }, typed: { namespaces: [{ name: 'N', label: 'l1<br>l2' }], notes: [{ text: 'a<br>b' }] }, written: 'namespace N["l1<br>l2"] {' },
  ])('reads quoted text, on one line or across lines, to the quote that closes it: $body', ({ body, native, typed, written }) => {
    const source = `classDiagram\n${body}`
    expect(parse(source)).toMatchObject(native)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = asClass(parsed.value)
    expect(diagram?.body).toMatchObject(typed)
    expect(verifyMermaid(parsed.value).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain(written)
    const reloaded = parseRegisteredMermaid(serialized)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(asClass(reloaded.value)?.body).toEqual(diagram!.body)
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
