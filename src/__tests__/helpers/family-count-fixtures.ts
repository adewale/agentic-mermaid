// Shared per-family count fixtures (Move 5).
//
// The exact {nodes, edges, groups} a known source projects to was encoded in
// three places (structural-count.test.ts cases, the metamorphic registry's
// implicit deltas, and the corpus oracle's expectations). This is the single
// source of truth: a canonical source per family with its expected count. Both
// structural-count.test.ts and the metamorphic citizenship test consume it, so
// a change to the counter's projection is asserted in exactly one place.

import type { DiagramKind } from '../../agent/types.ts'
import type { StructuralCount } from '../../agent/structural-count.ts'

export interface FamilyCountFixture {
  family: DiagramKind
  source: string
  count: StructuralCount
}

export const FAMILY_COUNT_FIXTURES: FamilyCountFixture[] = [
  { family: 'flowchart', source: 'flowchart TD\n  A-->B\n  B-->C', count: { nodes: 3, edges: 2, groups: 0 } },
  { family: 'flowchart', source: 'flowchart TD\n  subgraph G\n    A-->B\n  end\n  B-->C', count: { nodes: 3, edges: 2, groups: 1 } },
  { family: 'flowchart', source: 'flowchart TD\n  subgraph Outer\n    subgraph Inner\n      A-->B\n    end\n    B-->C\n  end', count: { nodes: 3, edges: 2, groups: 2 } },
  { family: 'sequence', source: 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: m', count: { nodes: 2, edges: 1, groups: 0 } },
  { family: 'state', source: 'stateDiagram-v2\n  s0-->s1\n  s1-->s2', count: { nodes: 3, edges: 2, groups: 0 } },
  // Doubly-nested composite: pins the recursive `edges += inner.edges` accumulation
  // (a nested transition must propagate up). Kills the AssignmentOperator mutant.
  { family: 'state', source: 'stateDiagram-v2\n  [*] --> Outer\n  state Outer {\n    state Mid {\n      a --> b\n    }\n  }', count: { nodes: 4, edges: 2, groups: 0 } },
  { family: 'class', source: 'classDiagram\n  class A\n  class B\n  A-->B', count: { nodes: 2, edges: 1, groups: 0 } },
  { family: 'er', source: 'erDiagram\n  A ||--o{ B : r\n  B ||--o{ C : r', count: { nodes: 3, edges: 2, groups: 0 } },
  { family: 'pie', source: 'pie title P\n  "X" : 1\n  "Y" : 2\n  "Z" : 3', count: { nodes: 3, edges: 0, groups: 0 } },
  { family: 'quadrant', source: 'quadrantChart\n  x-axis Low --> High\n  y-axis Bad --> Good\n  A: [0.3, 0.6]\n  B: [0.7, 0.2]', count: { nodes: 2, edges: 0, groups: 0 } },
  { family: 'journey', source: 'journey\n  title J\n  section S\n    T0: 5: Me\n    T1: 3: Me', count: { nodes: 2, edges: 0, groups: 1 } },
  { family: 'timeline', source: 'timeline\n  title T\n  2020 : E0\n  2021 : E1', count: { nodes: 4, edges: 0, groups: 1 } },
  { family: 'gantt', source: 'gantt\n  title G\n  dateFormat YYYY-MM-DD\n  section S\n  T0 : a, 2020-01-01, 1d\n  T1 : b, 2020-01-02, 1d', count: { nodes: 2, edges: 0, groups: 1 } },
  { family: 'xychart', source: 'xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  bar [1, 2, 3]\n  line [3, 2, 1]', count: { nodes: 2, edges: 0, groups: 0 } },
  { family: 'architecture', source: 'architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g\n  service b(disk)[B] in g\n  a:R -- L:b', count: { nodes: 2, edges: 1, groups: 1 } },
  // A junction makes nodes = services + junctions discriminating (1 + 1 = 2):
  // kills the ArithmeticOperator mutant that flips `+` to `-` (1 - 1 = 0).
  { family: 'architecture', source: 'architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g\n  junction jx in g\n  a:R -- L:jx', count: { nodes: 2, edges: 1, groups: 1 } },
]
