// Fast, direct unit tests for the faithfulness counter (src/agent/structural-count.ts).
//
// These exercise every branch of countStructuralElements without going through
// layout, so they run in well under a second — which is what lets the
// stryker.incremental.config.json lane mutate this module and gate per-PR
// (Move 7). Each family asserts the exact {nodes, edges, groups} for a known
// source, pinning the projection a mutant would have to change.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/index.ts'
import { countStructuralElements, countsEqual, type StructuralCount } from '../agent/structural-count.ts'

function count(src: string): StructuralCount {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse')
  const c = countStructuralElements(p.value)
  expect(c).not.toBeNull()
  return c!
}

describe('countStructuralElements — exact projection per family', () => {
  const cases: Array<[string, string, StructuralCount]> = [
    ['flowchart', 'flowchart TD\n  A-->B\n  B-->C', { nodes: 3, edges: 2, groups: 0 }],
    ['flowchart+subgraph', 'flowchart TD\n  subgraph G\n    A-->B\n  end\n  B-->C', { nodes: 3, edges: 2, groups: 1 }],
    ['sequence', 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: m', { nodes: 2, edges: 1, groups: 0 }],
    ['state', 'stateDiagram-v2\n  s0-->s1\n  s1-->s2', { nodes: 3, edges: 2, groups: 0 }],
    ['class', 'classDiagram\n  class A\n  class B\n  A-->B', { nodes: 2, edges: 1, groups: 0 }],
    ['er', 'erDiagram\n  A ||--o{ B : r\n  B ||--o{ C : r', { nodes: 3, edges: 2, groups: 0 }],
    ['pie', 'pie title P\n  "X" : 1\n  "Y" : 2\n  "Z" : 3', { nodes: 3, edges: 0, groups: 0 }],
    ['quadrant', 'quadrantChart\n  x-axis Low --> High\n  y-axis Bad --> Good\n  A: [0.3, 0.6]\n  B: [0.7, 0.2]', { nodes: 2, edges: 0, groups: 0 }],
    ['journey', 'journey\n  title J\n  section S\n    T0: 5: Me\n    T1: 3: Me', { nodes: 2, edges: 0, groups: 1 }],
    ['timeline', 'timeline\n  title T\n  2020 : E0\n  2021 : E1', { nodes: 4, edges: 0, groups: 1 }],
    ['gantt', 'gantt\n  title G\n  dateFormat YYYY-MM-DD\n  section S\n  T0 : a, 2020-01-01, 1d\n  T1 : b, 2020-01-02, 1d', { nodes: 2, edges: 0, groups: 1 }],
    ['xychart', 'xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  bar [1, 2, 3]\n  line [3, 2, 1]', { nodes: 2, edges: 0, groups: 0 }],
    ['architecture', 'architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g\n  service b(disk)[B] in g\n  a:R -- L:b', { nodes: 2, edges: 1, groups: 1 }],
  ]
  for (const [name, src, expected] of cases) {
    test(`${name} ⇒ ${JSON.stringify(expected)}`, () => {
      expect(count(src)).toEqual(expected)
    })
  }

  test('composite state counts nested states + transitions recursively', () => {
    const c = count('stateDiagram-v2\n  [*]-->Outer\n  state Outer {\n    a-->b\n  }')
    // Outer + a + b states; the Outer→ nested a→b transition plus the top [*]→Outer.
    expect(c.nodes).toBeGreaterThanOrEqual(3)
    expect(c.edges).toBeGreaterThanOrEqual(2)
  })

  test('opaque bodies return null (no fabricated count)', () => {
    const p = parseMermaid('xychart-beta\n  title "Has a title ⇒ opaque"\n  bar [1,2]')
    expect(p.ok).toBe(true)
    if (p.ok) expect(countStructuralElements(p.value)).toBeNull()
  })

  test('countsEqual compares all three axes', () => {
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 2, groups: 3 })).toBe(true)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 9, edges: 2, groups: 3 })).toBe(false)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 9, groups: 3 })).toBe(false)
    expect(countsEqual({ nodes: 1, edges: 2, groups: 3 }, { nodes: 1, edges: 2, groups: 9 })).toBe(false)
  })
})
