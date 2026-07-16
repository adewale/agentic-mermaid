// Loop 9 M12: describeMermaid — one-line summary per family.
// Asserts every key entity (node id / participant id / class / entity / period)
// surfaces in the description string.

import { describe, test, expect } from 'bun:test'
import { describeMermaidSource, describeMermaid, describeMermaidTree } from '../agent/describe.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

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

  test('an unregistered source returns a non-empty preservation description', () => {
    const out = describeMermaidSource('not a diagram')
    expect(out.length).toBeGreaterThan(0)
    expect(out.toLowerCase()).toMatch(/unregistered|preserved/)
  })
})
