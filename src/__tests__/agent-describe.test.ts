// Loop 9 M12: describeMermaid — one-line summary per family.
// Asserts every key entity (node id / participant id / class / entity / period)
// surfaces in the description string.

import { describe, test, expect } from 'bun:test'
import { describeMermaidSource } from '../agent/describe.ts'

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

  test('unparseable source returns a non-empty error description (not a throw)', () => {
    const out = describeMermaidSource('not a diagram')
    expect(out.length).toBeGreaterThan(0)
    expect(out.toLowerCase()).toMatch(/unparseable|error/)
  })
})
