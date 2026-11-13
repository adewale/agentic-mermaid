// Loop 9 M12: describeMermaid — one-line summary per family.
// Asserts every key entity (node id / participant id / class / entity / period)
// surfaces in the description string.

import { describe, test, expect } from 'bun:test'
import { describeMermaidSource, describeMermaid, describeMermaidTree } from '../agent/describe.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeMermaidFacts } from '../agent/facts.ts'

describe('describeMermaid', () => {
  test('flowchart: every node id appears in description', () => {
    const out = describeMermaidSource('flowchart LR\n  Start[Start] --> Decide{Decide}\n  Decide --> A\n  Decide --> B\n  A --> End\n  B --> End')
    for (const id of ['Start', 'Decide', 'A', 'B', 'End']) expect(out).toContain(id)
    expect(out.length).toBeGreaterThan(20)
    expect(out.length).toBeLessThan(500)
  })

  test('sequence: every participant id appears', () => {
    const out = describeMermaidSource('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello\n  Alice->>Carol: Forward')
    for (const id of ['Alice', 'Bob', 'Carol']) expect(out).toContain(id)
  })

  test('timeline: every period label appears', () => {
    const out = describeMermaidSource('timeline\n  title Test\n  2020 : COVID\n  2021 : Recovery\n  2022 : Growth')
    for (const period of ['2020', '2021', '2022']) expect(out).toContain(period)
  })

  test('timeline: summary, tree and facts agree on the title and sections; periods before the first section are unsectioned', () => {
    const parsed = parseMermaid('timeline\n  title History\n  2000 : Pre-section event\n  section Early\n    2001 : A\n  section Late\n    2020 : B')
    if (!parsed.ok) throw new Error('parse')
    expect(describeMermaid(parsed.value)).toBe('A timeline titled "History" with 2 sections and 3 periods. Unsectioned periods: 2000. Sections: Early [2001]; Late [2020].')
    const tree = describeMermaidTree(parsed.value)
    const label = (id: string | undefined) => tree.nodes.find(node => node.id === id)?.label
    expect(tree.title).toBe('History')
    expect(tree.nodes.map(node => [node.label, label(node.parentId)])).toEqual([['2000', undefined], ['Early', undefined], ['2001', 'Early'], ['Late', undefined], ['2020', 'Late']])
    const facts = describeMermaidFacts(parsed.value)
    expect(facts.filter(fact => /^(?:title|section|period \S+ section) /.test(fact))).toEqual(['period 2001 section Early', 'period 2020 section Late', 'section Early', 'section Late', 'title History'])
  })

  test('class: every class name appears', () => {
    const out = describeMermaidSource('classDiagram\n  class Animal\n  class Dog\n  class Cat\n  Animal <|-- Dog\n  Animal <|-- Cat')
    for (const name of ['Animal', 'Dog', 'Cat']) expect(out).toContain(name)
  })

  test('ER: every entity id appears', () => {
    const out = describeMermaidSource('erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains')
    for (const id of ['CUSTOMER', 'ORDER', 'ITEM']) expect(out).toContain(id)
  })

  test('journey: every task appears', () => {
    const out = describeMermaidSource('journey\n  title Test\n  section Buy\n    Browse: 5: Me\n    Checkout: 4: Me')
    for (const text of ['Browse', 'Checkout']) expect(out).toContain(text)
    expect(out.toLowerCase()).toContain('journey')
  })

  test('xychart: every series label appears', () => {
    const out = describeMermaidSource('xychart\n  title Sales\n  x-axis [Jan, Feb]\n  bar Revenue [1, 2]\n  line Forecast [2, 3]')
    for (const text of ['Sales', 'Revenue', 'Forecast']) expect(out).toContain(text)
    expect(out.toLowerCase()).toContain('xy chart')
  })

  // Family-driven: iterate the canonical family set (not a hardcoded subset) so a
  // new or overlooked family can't silently fall through describe. This guards the
  // bug where pie/quadrant returned "…structured editing not yet supported." in
  // prose and an empty node list in the AX tree.
  test('every family: prose is family-specific and the AX tree has nodes (no silent fallback)', () => {
    for (const fam of BUILTIN_FAMILY_METADATA) {
      const p = parseMermaid(fam.example)
      expect({ family: fam.id, parsed: p.ok }).toEqual({ family: fam.id, parsed: true })
      if (!p.ok) continue
      const prose = describeMermaid(p.value)
      expect({ family: fam.id, notSupported: /not (?:yet )?supported/i.test(prose) })
        .toEqual({ family: fam.id, notSupported: false })
      expect({ family: fam.id, bareFallback: prose === `A ${p.value.kind} diagram.` })
        .toEqual({ family: fam.id, bareFallback: false })
      const tree = describeMermaidTree(p.value)
      expect({ family: fam.id, hasNodes: tree.nodes.length > 0 })
        .toEqual({ family: fam.id, hasNodes: true })
    }
  })

  // Counts agree with their nouns: a single item is never "1 edges" or "1 item(s)".
  test.each([
    ['flowchart TD\n  A --> B', 'A 2-node flowchart with 1 edge.'],
    ['stateDiagram-v2\n  [*] --> A', 'A state diagram with 1 state and 1 transition.'],
    ['classDiagram\n  class A', 'A class diagram with 1 class.'],
    ['erDiagram\n  A {\n    string id\n  }', 'An ER diagram with 1 entity.'],
    ['timeline\n  section S\n    2020 : a', 'A timeline with 1 section and 1 period.'],
    ['journey\n  section S\n    Go: 5: Me', 'with 1 section and 1 task.'],
    ['gitGraph\n  commit', 'A GitGraph with 1 commit across 1 branch, including 0 merges and 0 cherry-picks.'],
    ['mindmap\n  root\n    leaf', 'with 1 leaf.'],
    ['pie\n  "a" : 1', 'with 1 slice.'],
    ['xychart-beta\n  x-axis [a]\n  bar [1]', 'with 1 series.'],
    ['architecture-beta\n  group g(cloud)[G]\n  service s(server)[S] in g\n  service t(server)[T] in g\n  s:R --> L:t', 'with 1 group, 2 services, and 1 connection.'],
    ['sankey-beta\n  a,b,1', 'across 1 link between 2 nodes.'],
    ['radar-beta\n  axis a\n  curve c{1}', 'comparing 1 curve (c) across 1 axis (a).'],
  ])('summary counts agree with their nouns: %j', (source, phrase) => {
    expect(describeMermaidSource(source)).toContain(phrase)
  })

  test('an unregistered source returns a non-empty preservation description', () => {
    const out = describeMermaidSource('not a diagram')
    expect(out.length).toBeGreaterThan(0)
    expect(out.toLowerCase()).toMatch(/unregistered|preserved/)
  })
})
