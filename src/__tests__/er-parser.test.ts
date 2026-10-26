/**
 * Tests for the ER diagram parser.
 *
 * Covers: entity definitions, attribute parsing (types, names, keys, comments),
 * relationships with all cardinality types, identifying/non-identifying lines.
 */
import { describe, it, expect } from 'bun:test'
import { parseErDiagram } from '../er/parser.ts'
import type { ErDiagram } from '../er/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { asEr, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'

/** Helper to parse — preprocesses text the same way index.ts does */
function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseErDiagram(lines)
}

// ============================================================================
// Entity definitions
// ============================================================================

describe('parseErDiagram – entity definitions', () => {
  it('bare entity declarations produce visible logical entities', () => {
    const diagram = parse('erDiagram\n  A\n  B')
    expect(diagram.entities.map(entity => entity.id)).toEqual(['A', 'B'])
    expect(diagram.relationships).toEqual([])
  })
  it('parses an entity with attributes', () => {
    const d = parse(`erDiagram
      CUSTOMER {
        string name
        int age
        string email
      }`)
    expect(d.entities).toHaveLength(1)
    expect(d.entities[0]!.id).toBe('CUSTOMER')
    expect(d.entities[0]!.attributes).toHaveLength(3)
    expect(d.entities[0]!.attributes[0]!.type).toBe('string')
    expect(d.entities[0]!.attributes[0]!.name).toBe('name')
  })

  it('parses attributes with PK key', () => {
    const d = parse(`erDiagram
      USER {
        int id PK
        string name
      }`)
    expect(d.entities[0]!.attributes[0]!.keys).toContain('PK')
  })

  it('parses attributes with FK key', () => {
    const d = parse(`erDiagram
      ORDER {
        int id PK
        int customer_id FK
      }`)
    expect(d.entities[0]!.attributes[1]!.keys).toContain('FK')
  })

  it('parses attributes with UK key', () => {
    const d = parse(`erDiagram
      USER {
        string email UK
      }`)
    expect(d.entities[0]!.attributes[0]!.keys).toContain('UK')
  })

  it('parses comma-separated composite keys without dropping the first key', () => {
    const d = parse(`erDiagram
      USER {
        int account_id PK, FK "shared key"
      }`)
    expect(d.entities[0]!.attributes[0]!.keys).toEqual(['PK', 'FK'])
    expect(d.entities[0]!.attributes[0]!.comment).toBe('shared key')
  })

  it('parses attributes with comment', () => {
    const d = parse(`erDiagram
      USER {
        string email UK "user email address"
      }`)
    expect(d.entities[0]!.attributes[0]!.comment).toBe('user email address')
  })

  it('parses multiple entities', () => {
    const d = parse(`erDiagram
      CUSTOMER {
        int id PK
        string name
      }
      ORDER {
        int id PK
        date created
      }`)
    expect(d.entities).toHaveLength(2)
  })

  it('accepts quoted and unquoted aliases on declarations with attributes', () => {
    const d = parse(`erDiagram
      p[Person] {
        string name
      }
      a["Customer Account"] {
        string email
      }`)
    expect(d.entities.map(entity => ({ id: entity.id, label: entity.label, attributes: entity.attributes.length }))).toEqual([
      { id: 'p', label: 'Person', attributes: 1 },
      { id: 'a', label: 'Customer Account', attributes: 1 },
    ])
  })

  it('normalizes aliased declarations and relationship endpoints to one stable entity identity', () => {
    const d = parse(`erDiagram
      CUSTOMER["Customer Account"] ||--o{ ORDER["Purchase Order"] : places`)
    expect(d.entities.map(entity => ({ id: entity.id, label: entity.label }))).toEqual([
      { id: 'CUSTOMER', label: 'Customer Account' },
      { id: 'ORDER', label: 'Purchase Order' },
    ])
    expect(d.relationships.map(relation => `${relation.entity1}->${relation.entity2}`)).toEqual(['CUSTOMER->ORDER'])
  })

  it('strips ::: styling suffixes from semantic identity instead of minting phantom entities', () => {
    const d = parse(`erDiagram
      PERSON:::source ||--o{ CAR:::target : owns`)
    expect(d.entities.map(entity => entity.id)).toEqual(['PERSON', 'CAR'])
    expect(d.relationships.map(relation => `${relation.entity1}->${relation.entity2}`)).toEqual(['PERSON->CAR'])
  })

  it('auto-creates entities from relationships', () => {
    const d = parse(`erDiagram
      CUSTOMER ||--o{ ORDER : places`)
    expect(d.entities).toHaveLength(2)
    expect(d.entities.find(e => e.id === 'CUSTOMER')).toBeDefined()
    expect(d.entities.find(e => e.id === 'ORDER')).toBeDefined()
  })
})

// Mermaid's ER lexer treats a line break as one more separator between
// statements, and as plain space inside an attribute block (erDiagram.jison),
// so braces, attributes and declarations may share a line, and an attribute
// may run across lines. Each entity reads as `id[alias]:::class {attributes}`
// and each attribute as `type name keys "comment"`.
describe('parseErDiagram – statements sharing or spanning lines', () => {
  const readingOf = (diagram: ErDiagram) => [
    ...diagram.entities.map(entity => `${entity.id}${entity.label !== entity.id ? `[${entity.label}]` : ''}${entity.className ? `:::${entity.className}` : ''} {${
      entity.attributes.map(a => [a.type, a.name, ...a.keys, ...(a.comment !== undefined ? [`"${a.comment}"`] : [])].join(' ')).join('; ')}}`),
    ...diagram.relationships.map(relation => `${relation.entity1}->${relation.entity2} ${relation.label}`),
  ]

  it.each([
    ['CUSTOMER ||--o{ ORDER : places\nZ { string id }', ['CUSTOMER {}', 'ORDER {}', 'Z {string id}', 'CUSTOMER->ORDER places']],
    ['Z { }', ['Z {}']],
    ['Z { string id PK "comment" }', ['Z {string id PK "comment"}']],
    ['Z { string `geo.accuracy` PK "the comment" }', ['Z {string geo.accuracy PK "the comment"}']],
    ['Z { `my.type` address }', ['Z {my.type address}']],
    ['Z { `my.type`? `geo.accuracy` UK "literal `ticks`" }', ['Z {my.type? geo.accuracy UK "literal `ticks`"}']],
    ['Z { string na`me }', ['Z {string na`me}']],
    ['Z { string na`me "literal `ticks` }"\n int next }', ['Z {string na`me "literal `ticks` }"; int next}']],
    ['Z { string `name "literal `ticks` }" }', ['Z {string `name "literal `ticks` }"}']],
    ['Z { `my}type`? `geo{accuracy` UK "literal `ticks` }" int next PK } Y', ['Z {my}type? geo{accuracy UK "literal `ticks` }"; int next PK}', 'Y {}']],
    ['Z { string id int age }', ['Z {string id; int age}']],
    ['Z{string id PK, FK "a } b" int age UK}', ['Z {string id PK FK "a } b"; int age UK}']],
    ['Z { string id\n  int age\n}', ['Z {string id; int age}']],
    ['Z {\n  string id\n  int age }', ['Z {string id; int age}']],
    // Mermaid reads one type from the first `~` to the last on the line.
    ['Z["Zed"]:::hot { List~int~ ids List~string~ tags } Y', ['Z[Zed]:::hot {List~int~ ids; List~string~ tags}', 'Y {}']],
    // An attribute's name, keys and comment may each start a new line.
    ['Z { string\n  id }', ['Z {string id}']],
    ['Z {\n  string id\n  PK "c"\n  int\n  age\n}', ['Z {string id PK "c"; int age}']],
    // A generic type may hold spaces and nest.
    ['Z {\n  Map~string, int~ counts\n  Map~string, List~int~~ m PK\n}', ['Z {Map~string, int~ counts; Map~string, List~int~~ m PK}']],
    // A comment runs on to its closing quote, past a `}`; a blank line inside it is dropped.
    ['Z {\n  int id "line1\n  line2"\n}', ['Z {int id "line1\nline2"}']],
    ['Z { int id PK "a }\n  b" } Y', ['Z {int id PK "a }\nb"}', 'Y {}']],
    ['Z {\n  int id "x\n\n  y"\n  string name\n}', ['Z {int id "x\ny"; string name}']],
    // Declarations follow one another without a line break.
    ['A["x"] B:::c C', ['A[x] {}', 'B:::c {}', 'C {}']],
    ['A B ||--o{ C : x', ['A {}', 'B {}', 'C {}', 'B->C x']],
    ['A B { int x } C', ['A {}', 'B {int x}', 'C {}']],
    // A quoted relationship label ends at its closing quote; declarations follow.
    ['A ||--o{ B : "x" y', ['A {}', 'B {}', 'y {}', 'A->B x']],
    ['C A ||--o{ B : "x"y z { int id }', ['C {}', 'A {}', 'B {}', 'y {}', 'z {int id}', 'A->B x']],
  ])('%j is read alike by the renderer, the typed body and its output', (body, expected) => {
    const source = `erDiagram\n  ${body}`
    expect(readingOf(parse(source))).toEqual(expected)
    const parsed = parseRegisteredMermaid(source)
    const typed = parsed.ok ? asEr(parsed.value) : null
    expect(typed).not.toBeNull()
    expect(readingOf(parse(serializeMermaid(typed!)))).toEqual(expected)
  })
})

// ============================================================================
// Relationships
// ============================================================================

describe('parseErDiagram – relationships', () => {
  it('parses exactly-one to zero-or-many: ||--o{', () => {
    const d = parse(`erDiagram
      CUSTOMER ||--o{ ORDER : places`)
    expect(d.relationships).toHaveLength(1)
    expect(d.relationships[0]!.entity1).toBe('CUSTOMER')
    expect(d.relationships[0]!.entity2).toBe('ORDER')
    expect(d.relationships[0]!.cardinality1).toBe('one')
    expect(d.relationships[0]!.cardinality2).toBe('zero-many')
    expect(d.relationships[0]!.label).toBe('places')
    expect(d.relationships[0]!.identifying).toBe(true)
  })

  it('parses zero-or-one to one-or-more: |o--|{', () => {
    const d = parse(`erDiagram
      A |o--|{ B : connects`)
    expect(d.relationships[0]!.cardinality1).toBe('zero-one')
    expect(d.relationships[0]!.cardinality2).toBe('many')
  })

  it('parses exactly-one to exactly-one: ||--||', () => {
    const d = parse(`erDiagram
      PERSON ||--|| PASSPORT : has`)
    expect(d.relationships[0]!.cardinality1).toBe('one')
    expect(d.relationships[0]!.cardinality2).toBe('one')
  })

  it('parses non-identifying relationship (dotted): ||..o{', () => {
    const d = parse(`erDiagram
      USER ||..o{ LOG : generates`)
    expect(d.relationships[0]!.identifying).toBe(false)
  })

  it('parses one-or-more to zero-or-many: }|--o{', () => {
    const d = parse(`erDiagram
      PRODUCT }|--o{ TAG : has`)
    expect(d.relationships[0]!.cardinality1).toBe('many')
    expect(d.relationships[0]!.cardinality2).toBe('zero-many')
  })

  it('handles multiple relationships', () => {
    const d = parse(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT ||--o{ LINE_ITEM : appears_in`)
    expect(d.relationships).toHaveLength(3)
  })

  it('label-less relationships parse and render visibly', () => {
    const source = 'erDiagram\n  CUSTOMER ||--o{ ORDER'
    const diagram = parse(source)
    expect(diagram.relationships).toHaveLength(1)
    expect(diagram.relationships[0]).toMatchObject({ entity1: 'CUSTOMER', entity2: 'ORDER', label: '' })
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toMatch(/<polyline[^>]+class="er-relationship"[^>]+data-from="CUSTOMER"[^>]+data-to="ORDER"/)
  })
})

// ============================================================================
// Cardinality token strictness (upstream lukilabs#124 / PR #126+#127 class)
// ============================================================================

describe('parseErDiagram – cardinality token set', () => {
  // }o on the left was silently dropped by the old sort-based normalization,
  // rendering the diagram empty. The mermaid-docs corpus uses `}o..o{`.
  it('parses zero-or-many on the left: }o--||', () => {
    const d = parse(`erDiagram
      ORDER }o--|| CUSTOMER : belongs_to`)
    expect(d.relationships).toHaveLength(1)
    expect(d.relationships[0]!.cardinality1).toBe('zero-many')
    expect(d.relationships[0]!.cardinality2).toBe('one')
    expect(d.entities.map(e => e.id).sort()).toEqual(['CUSTOMER', 'ORDER'])
  })

  it('parses the corpus form }o..o{', () => {
    const d = parse(`erDiagram
      A }o..o{ B : links`)
    expect(d.relationships[0]!.cardinality1).toBe('zero-many')
    expect(d.relationships[0]!.cardinality2).toBe('zero-many')
    expect(d.relationships[0]!.identifying).toBe(false)
  })

  it('accepts every Mermaid lexer token on either side', () => {
    const expected: Record<string, string> = {
      '||': 'one',
      '|o': 'zero-one', 'o|': 'zero-one',
      '}|': 'many', '|{': 'many',
      '}o': 'zero-many', 'o{': 'zero-many',
    }
    for (const [token, cardinality] of Object.entries(expected)) {
      const left = parse(`erDiagram\n  A ${token}--|| B : x`)
      expect({ token, side: 'left', card: left.relationships[0]!.cardinality1 })
        .toEqual({ token, side: 'left', card: cardinality as never })
      const right = parse(`erDiagram\n  A ||--${token} B : x`)
      expect({ token, side: 'right', card: right.relationships[0]!.cardinality2 })
        .toEqual({ token, side: 'right', card: cardinality as never })
    }
  })

  it('throws (never silently drops) on non-Mermaid tokens: {o, o}, |}, {|', () => {
    for (const token of ['{o', 'o}', '|}', '{|']) {
      expect(() => parse(`erDiagram\n  A ${token}--|| B : x`)).toThrow(/Invalid ER cardinality/)
      expect(() => parse(`erDiagram\n  A ||--${token} B : x`)).toThrow(/Invalid ER cardinality/)
    }
  })
})

// ============================================================================
// Full diagram
// ============================================================================

describe('parseErDiagram – full diagram', () => {
  it('parses a complete e-commerce schema', () => {
    const d = parse(`erDiagram
      CUSTOMER {
        int id PK
        string name
        string email UK
      }
      ORDER {
        int id PK
        date created
        int customer_id FK
      }
      LINE_ITEM {
        int id PK
        int quantity
        int order_id FK
        int product_id FK
      }
      PRODUCT {
        int id PK
        string name
        float price
      }
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT ||--o{ LINE_ITEM : includes`)

    expect(d.entities).toHaveLength(4)
    expect(d.relationships).toHaveLength(3)

    const customer = d.entities.find(e => e.id === 'CUSTOMER')!
    expect(customer.attributes).toHaveLength(3)
    expect(customer.attributes[0]!.keys).toContain('PK')
    expect(customer.attributes[2]!.keys).toContain('UK')

    const lineItem = d.entities.find(e => e.id === 'LINE_ITEM')!
    expect(lineItem.attributes.filter(a => a.keys.includes('FK'))).toHaveLength(2)
  })
})
