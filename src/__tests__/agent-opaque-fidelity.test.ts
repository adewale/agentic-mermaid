// Phase A regression: opaque-body parse → serialize must preserve original
// indentation, blank lines, and comments. Without this, an agent that calls
// `parseMermaid → serializeMermaid` on a class / ER / journey / xychart /
// architecture / opaque-sequence diagram silently loses formatting.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'

describe('opaque-body fidelity (indentation + blank lines)', () => {
  const cases: Array<[string, string]> = [
    ['class', `classDiagram
  class Animal {
    +String name
    +int age
    +eat()
  }
  class Dog
  Animal <|-- Dog`],
    ['er', `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    string name
    string email
  }`],
    ['journey', `journey
  title My day
  section Morning
    Wake up: 3: Me
    Coffee: 5: Me`],
    ['xychart', `xychart-beta
  title "Revenue"
  x-axis [jan, feb, mar]
  y-axis "USD" 0 --> 100
  bar [10, 50, 90]`],
    ['architecture', `architecture-beta
  group api(cloud)[API]
  service db(database)[DB] in api
  service web(server)[Web] in api
  web:R --> L:db`],
    ['sequence-opaque (alt/activate/Note)', `sequenceDiagram
  participant A
  participant B
  Note over A: setup
  A->>B: ping
  activate B
  alt success
    B-->>A: ok
  else failure
    B-->>A: nope
  end
  deactivate B`],
  ]

  for (const [name, src] of cases) {
    test(`${name}: serialize(parse(src)) preserves indentation`, () => {
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe('opaque')
      const out = serializeMermaid(p.value).trimEnd()
      expect(out).toBe(src.trimEnd())
    })

    test(`${name}: round-trip stable (parse(serialize(x)) → same serialize)`, () => {
      const p1 = parseMermaid(src)
      expect(p1.ok).toBe(true)
      if (!p1.ok) return
      const s1 = serializeMermaid(p1.value)
      const p2 = parseMermaid(s1)
      expect(p2.ok).toBe(true)
      if (!p2.ok) return
      expect(serializeMermaid(p2.value)).toBe(s1)
    })
  }

  test('frontmatter + indented opaque body: both preserved', () => {
    const src = `---
title: Pet hierarchy
---
classDiagram
  class Animal {
    +String name
  }
  Animal <|-- Dog`
    const p = parseMermaid(src)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const out = serializeMermaid(p.value)
    expect(out).toContain('  class Animal {')
    expect(out).toContain('    +String name')
    expect(out).toContain('title: Pet hierarchy')
  })
})
