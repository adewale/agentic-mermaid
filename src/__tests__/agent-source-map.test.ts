import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'

describe('flowchart SourceMap', () => {
  test('maps nodes, edges, groups, and labels to source locations', () => {
    const source = `flowchart LR
  subgraph Auth[Auth Layer]
    A[Login]
    B{MFA?}
  end
  A -->|yes| B
  B -- no --> A
`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // SourceMap locations are over canonical normalized Mermaid source (the
    // current parser trims body indentation before structured parsing).
    expect(parsed.value.source.nodes.get('A')).toEqual({ line: 3, col: 1 })
    expect(parsed.value.source.nodes.get('B')).toEqual({ line: 4, col: 1 })
    expect(parsed.value.source.groups.get('Auth')).toEqual({ line: 2, col: 10 })
    expect(parsed.value.source.labels.get('node:A')).toEqual({ line: 3, col: 3 })
    expect(parsed.value.source.labels.get('group:Auth')).toEqual({ line: 2, col: 15 })
    expect(parsed.value.source.edges.get('edge#0:A->B')).toEqual({ line: 6, col: 1 })
    expect(parsed.value.source.labels.get('edge#0:A->B')).toEqual({ line: 6, col: 7 })
    expect(parsed.value.source.edges.get('edge#1:B->A')).toEqual({ line: 7, col: 1 })
  })

  test('maps edge and node labels after the id/operator when text repeats endpoint ids', () => {
    const parsed = parseMermaid(`flowchart LR
  A[A] -->|A| B
`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.source.labels.get('node:A')).toEqual({ line: 2, col: 3 })
    expect(parsed.value.source.labels.get('edge#0:A->B')).toEqual({ line: 2, col: 10 })
  })

  test('class/ER/chart/Gantt traceability maps members, attrs, cardinalities, marks, and tasks', () => {
    const cls = parseMermaid(`classDiagram
  class Animal {
    +String name
  }
  Animal "1" --> "*" Dog : owns
`)
    expect(cls.ok).toBe(true)
    if (!cls.ok) return
    expect(cls.value.source.labels.get('class:Animal:member#0')).toEqual({ line: 3, col: 1 })
    expect(cls.value.source.labels.get('rel#0:Animal->Dog:fromCardinality')).toEqual({ line: 5, col: 9 })
    expect(cls.value.source.labels.get('rel#0:Animal->Dog:toCardinality')).toEqual({ line: 5, col: 17 })

    const er = parseMermaid(`erDiagram
  CUSTOMER {
    string email PK
  }
  CUSTOMER ||--o{ ORDER : places
`)
    expect(er.ok).toBe(true)
    if (!er.ok) return
    expect(er.value.source.labels.get('er:CUSTOMER:attr#0')).toEqual({ line: 3, col: 1 })
    expect(er.value.source.labels.get('rel#0:CUSTOMER->ORDER:leftCardinality')).toEqual({ line: 5, col: 10 })
    expect(er.value.source.labels.get('rel#0:CUSTOMER->ORDER:rightCardinality')).toEqual({ line: 5, col: 14 })

    const chart = parseMermaid(`xychart-beta
  x-axis [Jan, Feb]
  bar Sales [3, 7]
`)
    expect(chart.ok).toBe(true)
    if (!chart.ok) return
    expect(chart.value.source.labels.get('xychart:series-0:name')).toEqual({ line: 3, col: 5 })
    expect(chart.value.source.labels.get('xychart:series-0:point#1')).toEqual({ line: 3, col: 15 })

    const gantt = parseMermaid(`gantt
  section Build
    Core engine :core, 2024-01-01, 2d
`)
    expect(gantt.ok).toBe(true)
    if (!gantt.ok) return
    expect(gantt.value.source.groups.get('section-0')).toEqual({ line: 2, col: 9 })
    expect(gantt.value.source.nodes.get('core')).toEqual({ line: 3, col: 1 })
    expect(gantt.value.source.labels.get('gantt:task:core')).toEqual({ line: 3, col: 1 })
  })
})
