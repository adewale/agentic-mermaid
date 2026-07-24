// Shared metamorphic generators for every renderable family (Moves 4 + 5).
//
// Move 4 extracted the inline flowchart/sequence/class/ER builders into one
// reusable place. Move 5 extends them to every registered family and ties the
// set to BUILTIN_FAMILY_METADATA, so a NEW diagram family
// cannot be added without also declaring how to fuzz it — the citizenship test
// in property-layout-metamorphic.test.ts fails until METAMORPHIC_FAMILIES has
// an entry for it.
//
// Each entry produces valid, structured (non-opaque) source whose
// {nodes, edges, groups} tally is predictable, plus the snippets that exercise
// the metamorphic relations:
//   • relabel        — build(k, tagA) vs build(k, tagB): counts + verify.ok equal
//                      (ids/labels carry no structural meaning).
//   • add-primary    — append one primary entity ⇒ nodes += nodeDelta, edges same.
//   • add-relation   — append one relation ⇒ edges += 1, nodes same (edge families).
//
// Deltas were calibrated empirically against the live parser/counter, not
// guessed (e.g. a timeline period line adds a period AND an event ⇒ nodeDelta 2;
// state has no standalone-state syntax that stays structured ⇒ no add-primary).

import type { DiagramKind } from '../../agent/types.ts'

export interface AddPrimary {
  /** Source appended to add primary entities. */
  snippet: (k: number, tag: string) => string
  /** How many `nodes` the append adds (timeline = 2: period + event). */
  nodeDelta: number
}

export interface FamilyMetamorphic {
  family: DiagramKind
  /** Valid structured source with `k` primary entities, ids/labels keyed on `tag`. */
  build: (k: number, tag: string) => string
  /** A `[min, max]` k-range that always yields a structured, verifiable diagram. */
  kRange: [number, number]
  /** Append one primary entity (nodes += nodeDelta, edges unchanged), or null. */
  addPrimary: AddPrimary | null
  /** Append one relation (edges += 1, nodes unchanged), or null for edgeless families. */
  addRelation: ((k: number, tag: string) => string) | null
}

const range = (k: number) => Array.from({ length: k }, (_, i) => i)
const lines = (...xs: string[]) => xs.join('\n')

export const METAMORPHIC_FAMILIES: Record<DiagramKind, FamilyMetamorphic> = {
  flowchart: {
    family: 'flowchart',
    build: (k, t) => lines('flowchart TD', ...range(k).map(i => `  ${t}${i}["N${i}"]`), ...range(k - 1).map(i => `  ${t}${i} --> ${t}${i + 1}`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  ${t}x["X"]`, nodeDelta: 1 },
    addRelation: (_k, t) => `\n  ${t}1 --> ${t}0`,
  },
  state: {
    family: 'state',
    // A standalone `state X` declaration flips the body to opaque, so there is
    // no clean add-primary; relabel + add-relation cover it. The trailing
    // composite block (Move 1) exercises the recursive nested-state/transition
    // count path that flat chains never reach.
    build: (k, t) => lines('stateDiagram-v2', ...range(k - 1).map(i => `  ${t}${i} --> ${t}${i + 1}`), `  state ${t}comp {`, `    ${t}ca --> ${t}cb`, `  }`),
    kRange: [2, 6],
    addPrimary: null,
    addRelation: (_k, t) => `\n  ${t}1 --> ${t}0`,
  },
  sequence: {
    family: 'sequence',
    build: (k, t) => lines('sequenceDiagram', ...range(k).map(i => `  participant ${t}${i}`), ...range(k - 1).map(i => `  ${t}${i}->>${t}${i + 1}: m${i}`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  participant ${t}x`, nodeDelta: 1 },
    addRelation: (_k, t) => `\n  ${t}0->>${t}1: extra`,
  },
  class: {
    family: 'class',
    build: (k, t) => lines('classDiagram', ...range(k).map(i => `  class ${t}${i}`), ...range(k - 1).map(i => `  ${t}${i} --> ${t}${i + 1}`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  class ${t}x`, nodeDelta: 1 },
    addRelation: (_k, t) => `\n  ${t}1 --> ${t}0`,
  },
  er: {
    family: 'er',
    build: (k, t) => lines('erDiagram', ...range(k - 1).map(i => `  ${t}${i} ||--o{ ${t}${i + 1} : rel`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  ${t}x {\n    string id\n  }`, nodeDelta: 1 },
    addRelation: (_k, t) => `\n  ${t}1 ||--o{ ${t}0 : extra`,
  },
  architecture: {
    family: 'architecture',
    // A junction (Move 1) makes nodes = services + junctions discriminating, so
    // the relabel/determinism relations exercise the junction-count path.
    build: (k, t) => lines('architecture-beta', `  group ${t}g(cloud)[G]`, ...range(k).map(i => `  service ${t}s${i}(server)[S${i}] in ${t}g`), `  junction ${t}j in ${t}g`, ...range(k - 1).map(i => `  ${t}s${i}:R -- L:${t}s${i + 1}`)),
    kRange: [2, 5],
    addPrimary: { snippet: (_k, t) => `\n  service ${t}sx(server)[X] in ${t}g`, nodeDelta: 1 },
    addRelation: (_k, t) => `\n  ${t}s1:T -- B:${t}s0`,
  },
  xychart: {
    family: 'xychart',
    // A title or quoted axis name forces opaque; bare axes keep it structured.
    build: (k, t) =>
      lines(
        'xychart-beta',
        `  x-axis [${range(3)
          .map(i => `${t}${i}`)
          .join(', ')}]`,
        '  y-axis 0 --> 100',
        ...range(k).map(i => (i % 2 === 0 ? '  bar [1, 2, 3]' : '  line [3, 2, 1]')),
      ),
    kRange: [1, 4],
    addPrimary: { snippet: () => `\n  line [2, 2, 2]`, nodeDelta: 1 },
    addRelation: null,
  },
  pie: {
    family: 'pie',
    build: (k, t) => lines('pie title P', ...range(k).map(i => `  "${t}${i}" : ${i + 1}`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  "${t}x" : 7`, nodeDelta: 1 },
    addRelation: null,
  },
  quadrant: {
    family: 'quadrant',
    build: (k, t) => lines('quadrantChart', '  x-axis Low --> High', '  y-axis Bad --> Good', ...range(k).map(i => `  ${t}${i}: [0.${(i % 8) + 1}, 0.${((i + 3) % 8) + 1}]`)),
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n  ${t}x: [0.5, 0.5]`, nodeDelta: 1 },
    addRelation: null,
  },
  journey: {
    family: 'journey',
    // Real journey shapes (derived deterministically from k and the tag):
    // multiple tiled sections, the full 1..5 score range (the experience curve
    // must stay monotone per score), and multiple actors (dot rows + legend).
    // The single-section/constant-score generator this replaces starved the
    // metamorphic/fuzz oracles of exactly the geometry PR #136 got wrong.
    build: (k, t) => {
      const sections = 1 + (k % 3)
      const tasks = range(k).map(i => `    ${t}${i}: ${(i % 5) + 1}: A${i % 3}${i % 2 === 0 ? ', Me' : ''}`)
      const perSection = Math.ceil(tasks.length / sections)
      return lines('journey', '  title J', ...range(sections).flatMap(s => [`  section ${t}S${s} ${s === 0 ? 'with a much longer section label' : ''}`.trimEnd(), ...tasks.slice(s * perSection, (s + 1) * perSection)]))
    },
    kRange: [2, 6],
    addPrimary: { snippet: (_k, t) => `\n    ${t}x: 4: Me`, nodeDelta: 1 },
    addRelation: null,
  },
  timeline: {
    family: 'timeline',
    // Each period line carries one event ⇒ 2 nodes per primary unit.
    build: (k, t) => lines('timeline', '  title T', ...range(k).map(i => `  ${t}${i} : E${i}`)),
    kRange: [2, 5],
    addPrimary: { snippet: (_k, t) => `\n  ${t}x : EX`, nodeDelta: 2 },
    addRelation: null,
  },
  gantt: {
    family: 'gantt',
    build: (k, t) => lines('gantt', '  title G', '  dateFormat YYYY-MM-DD', '  section S', ...range(k).map(i => `  ${t}${i} : t${i}, 2020-01-0${i + 1}, 1d`)),
    kRange: [2, 5],
    addPrimary: { snippet: (_k, t) => `\n  ${t}x : tx, 2020-02-01, 1d`, nodeDelta: 1 },
    addRelation: null,
  },
  mindmap: {
    family: 'mindmap',
    build: (k, t) => lines('mindmap', `  ${t}root`, ...range(k).map(i => `    ${t}${i}`)),
    kRange: [2, 6],
    // Tree syntax creates a containment relation with every node, so there is
    // no source append that changes only the primary-node count.
    addPrimary: null,
    addRelation: null,
  },
  gitgraph: {
    family: 'gitgraph',
    build: (k, t) => lines('gitGraph', ...range(k).map(i => `  commit id:"${t}${i}" msg:"M${i}"`)),
    kRange: [1, 6],
    // Every commit after the root necessarily adds a parent relation.
    addPrimary: null,
    addRelation: null,
  },
  radar: {
    family: 'radar',
    // Fixed 3 axes; k curves ⇒ nodes = 3·k (vertices), groups = 3 (axes).
    build: (k, t) => lines('radar-beta', '  axis a, b, c', ...range(k).map(i => `  curve ${t}${i}["C${i}"]{${(i % 5) + 1},${((i + 2) % 5) + 1},${((i + 4) % 5) + 1}}`), '  max 5'),
    kRange: [1, 5],
    addPrimary: { snippet: (_k, t) => `\n  curve ${t}x["Cx"]{1,2,3}`, nodeDelta: 3 },
    addRelation: null,
  },
  sankey: {
    family: 'sankey',
    // k sources fanning into one sink ⇒ nodes = k + 1, edges = k, groups = 0.
    build: (k, t) => lines('sankey-beta', ...range(k).map(i => `  ${t}${i},${t}sink,${i + 1}`)),
    kRange: [1, 6],
    // Every sankey node is implied by a link, so a new node necessarily adds
    // an edge too (the gitgraph situation) ⇒ no pure add-primary snippet.
    addPrimary: null,
    // A parallel duplicate row is legal and adds one edge, zero nodes.
    addRelation: (_k, t) => `\n  ${t}0,${t}sink,7`,
  },
}
