// Source-preserving typed edits of structured bodies (applyOps mode
// 'source-preserving'). The contract, checked at the library boundary every
// channel shares:
//   1. every authored line the op does not touch is byte-identical, in order —
//      the case names the lines it may touch, from the input alone;
//   2. the edited source parses to the same diagram as the canonical edit
//      (mutateChecked): the same facts and the same canonical statements;
//   3. upstream Mermaid 12.2.0 accepts it and reads it as the hand-written
//      reference edit (DB getters compared whole).
import { afterAll, describe, expect, test } from 'bun:test'
import { applyOps, describeMermaidFacts, mutateChecked, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import type { ParsedDiagram } from '../agent/types.ts'
import { startUpstreamMermaid, type UpstreamDiagram } from './helpers/upstream-mermaid.ts'

const FLOWCHART = `---
title: Messy flow
---
%% leading comment
graph TD
    %% entry
    A["Start <here>"] --> B{Decide?}
  B -->|yes| C(Do it):::hot
      B -- no --> D[Skip]

  subgraph "Layer 4 — Intelligence"
    E[Think] --> F[Act]
  end
  subgraph grp [Group two]
     G[Gee]
  end
  classDef hot fill:#f96;
  style A fill:#eee
  linkStyle 0 stroke:blue
`

const SEQUENCE = `sequenceDiagram
\tautonumber
\tparticipant K as Kubernetes
\tparticipant C as Controller
\t%% the loop
\tK ->> C: event
\talt reconcile
\t\tC ->> K: patch
\t\tK -->> C: ok
\telse skip
\t\tC ->> C: sleep
\tend
\tNote over K,C: done
`

const CLASS = `---
title: Classes
---
classDiagram
    %% core types
    class Animal {
        +String name
        +eat() void
    }
    class Dog
    Animal <|-- Dog : extends
    %% notes
    note for Dog "Good boy"
    class Cat:::pet
    classDef pet fill:#f9f
`

const STATE = `stateDiagram-v2
    %% lifecycle
    [*] --> Idle
    Idle --> Running: start
    state Running {
      Fast --> Slow
    }

    Running --> Done: stop
    Idle: Waiting here
    Done --> [*]
`

const ER = `erDiagram
    %% customers
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        string name
        string email PK
    }

    ORDER {
        int id
    }
    LINE_ITEM["Line item"]
`

const GANTT = `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    %% phases
    section Build
    Design      :des, 2024-01-01, 5d
    Implement   :impl, after des, 10d

    section Ship
    Release     :milestone, rel, 2024-01-20, 0d
`

interface Case {
  name: string
  source: string
  op: Record<string, unknown>
  /** Input lines the op may change or remove; every other line must survive. */
  touched?: string[]
  /** The reference edit as exact find/replace patches on the input. */
  reference: Array<[find: string, replace: string]>
}

const CASES: Case[] = [
  { name: 'flowchart add_node into a quoted-title group\'s sibling', source: FLOWCHART, op: { kind: 'add_node', id: 'H', label: 'In group', parent: 'grp' }, reference: [['     G[Gee]\n', '     G[Gee]\n     H[In group]\n']] },
  { name: 'flowchart remove_node', source: FLOWCHART, op: { kind: 'remove_node', id: 'D' }, touched: ['      B -- no --> D[Skip]'], reference: [['      B -- no --> D[Skip]\n', '']] },
  { name: 'flowchart rename_node inside a quoted-title subgraph', source: FLOWCHART, op: { kind: 'rename_node', from: 'E', to: 'Ex' }, touched: ['    E[Think] --> F[Act]'], reference: [['E[Think]', 'Ex[Think]']] },
  { name: 'flowchart set_label on a :::class node', source: FLOWCHART, op: { kind: 'set_label', target: 'C', label: 'Do it now' }, touched: ['  B -->|yes| C(Do it):::hot'], reference: [['C(Do it)', 'C(Do it now)']] },
  { name: 'flowchart set_label on an entity-spelled quoted label', source: FLOWCHART, op: { kind: 'set_label', target: 'A', label: 'Begin' }, touched: ['    A["Start <here>"] --> B{Decide?}'], reference: [['"Start <here>"', '"Begin"']] },
  { name: 'flowchart add_edge with a label', source: FLOWCHART, op: { kind: 'add_edge', from: 'F', to: 'G', label: 'next' }, reference: [['     G[Gee]\n  end\n', '     G[Gee]\n  end\n    F -->|next| G\n']] },
  { name: 'flowchart remove_edge keeps the endpoint declaration', source: FLOWCHART, op: { kind: 'remove_edge', id: 'B->D' }, touched: ['      B -- no --> D[Skip]'], reference: [['B -- no --> D[Skip]', 'D[Skip]']] },
  { name: 'flowchart set_node_class', source: FLOWCHART, op: { kind: 'set_node_class', id: 'D', className: 'hot' }, reference: [['  classDef hot fill:#f96;\n', '  classDef hot fill:#f96;\n  class D hot\n']] },
  { name: 'flowchart set_node_style', source: FLOWCHART, op: { kind: 'set_node_style', id: 'D', style: 'fill:#0f0' }, reference: [['  style A fill:#eee\n', '  style A fill:#eee\n  style D fill:#0f0\n']] },
  { name: 'flowchart define_class', source: FLOWCHART, op: { kind: 'define_class', name: 'cool', style: 'fill:#00f' }, reference: [['  classDef hot fill:#f96;\n', '  classDef hot fill:#f96;\n  classDef cool fill:#00f\n']] },
  { name: 'flowchart move_node into a group', source: FLOWCHART, op: { kind: 'move_node', id: 'D', subgraph: 'grp' }, touched: ['      B -- no --> D[Skip]'], reference: [['B -- no --> D[Skip]', 'B -- no --> D'], ['     G[Gee]\n', '     G[Gee]\n     D[Skip]\n']] },
  { name: 'flowchart set_shape', source: FLOWCHART, op: { kind: 'set_shape', id: 'D', shape: 'stadium' }, touched: ['      B -- no --> D[Skip]'], reference: [['D[Skip]', 'D([Skip])']] },
  { name: 'flowchart set_direction keeps the graph keyword', source: FLOWCHART, op: { kind: 'set_direction', direction: 'LR' }, touched: ['graph TD'], reference: [['graph TD', 'graph LR']] },
  { name: 'sequence add_message', source: SEQUENCE, op: { kind: 'add_message', from: 'C', to: 'K', text: 'done' }, reference: [['\tNote over K,C: done\n', '\tNote over K,C: done\n\tC->>K: done\n']] },
  { name: 'sequence add_fragment_message inside a verbatim alt branch', source: SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 0, from: 'C', to: 'K', text: 'extra' }, reference: [['\t\tK -->> C: ok\n', '\t\tK -->> C: ok\n\t\tC->>K: extra\n']] },
  { name: 'sequence set_message_text', source: SEQUENCE, op: { kind: 'set_message_text', index: 0, text: 'changed event' }, touched: ['\tK ->> C: event'], reference: [['C: event', 'C: changed event']] },
  { name: 'sequence set_participant_label', source: SEQUENCE, op: { kind: 'set_participant_label', id: 'C', label: 'Ctrl' }, touched: ['\tparticipant C as Controller'], reference: [['as Controller', 'as Ctrl']] },
  { name: 'sequence add_participant', source: SEQUENCE, op: { kind: 'add_participant', id: 'D', label: 'Database' }, reference: [['\tparticipant C as Controller\n', '\tparticipant C as Controller\n\tparticipant D as Database\n']] },
  { name: 'class add_class', source: CLASS, op: { kind: 'add_class', id: 'Bird' }, reference: [['    %% notes\n', '    %% notes\n    class Bird\n']] },
  { name: 'class add_member to a block', source: CLASS, op: { kind: 'add_member', class: 'Animal', text: '+int age' }, reference: [['        +eat() void\n', '        +eat() void\n        +int age\n']] },
  { name: 'class add_member to a bare class opens a block', source: CLASS, op: { kind: 'add_member', class: 'Dog', text: '+bark() void' }, touched: ['    class Dog'], reference: [['    class Dog\n', '    class Dog {\n        +bark() void\n    }\n']] },
  { name: 'class add_relation', source: CLASS, op: { kind: 'add_relation', from: 'Animal', to: 'Cat', relKind: 'inheritance' }, reference: [['    Animal <|-- Dog : extends\n', '    Animal <|-- Dog : extends\n    Animal <|-- Cat\n']] },
  { name: 'class rename_class', source: CLASS, op: { kind: 'rename_class', from: 'Dog', to: 'Hound' }, touched: ['    class Dog', '    Animal <|-- Dog : extends', '    note for Dog "Good boy"'], reference: [['class Dog\n', 'class Hound\n'], ['<|-- Dog', '<|-- Hound'], ['note for Dog', 'note for Hound']] },
  { name: 'class add_note', source: CLASS, op: { kind: 'add_note', for: 'Cat', text: 'Independent' }, reference: [['    note for Dog "Good boy"\n', '    note for Dog "Good boy"\n    note for Cat "Independent"\n']] },
  { name: 'class set_title rewrites only the frontmatter title', source: CLASS, op: { kind: 'set_title', title: 'Zoo' }, touched: ['title: Classes'], reference: [['title: Classes', 'title: Zoo']] },
  { name: 'state add_state into a composite', source: STATE, op: { kind: 'add_state', id: 'Medium', parent: 'Running' }, reference: [['      Fast --> Slow\n', '      Fast --> Slow\n      Medium\n']] },
  { name: 'state add_transition', source: STATE, op: { kind: 'add_transition', from: 'Running', to: 'Idle', label: 'pause' }, reference: [['    Done --> [*]\n', '    Done --> [*]\n    Running --> Idle : pause\n']] },
  { name: 'state set_state_label edits a description in place', source: STATE, op: { kind: 'set_state_label', id: 'Idle', label: 'Idle now' }, touched: ['    Idle: Waiting here'], reference: [['Idle: Waiting here', 'Idle: Idle now']] },
  { name: 'state set_transition_label', source: STATE, op: { kind: 'set_transition_label', from: 'Idle', to: 'Running', label: 'go' }, touched: ['    Idle --> Running: start'], reference: [['Running: start', 'Running: go']] },
  { name: 'state remove_transition', source: STATE, op: { kind: 'remove_transition', from: 'Running', to: 'Done' }, touched: ['    Running --> Done: stop'], reference: [['    Running --> Done: stop\n', '']] },
  { name: 'state rename_state inside a composite', source: STATE, op: { kind: 'rename_state', from: 'Fast', to: 'Quick' }, touched: ['      Fast --> Slow'], reference: [['Fast --> Slow', 'Quick --> Slow']] },
  { name: 'er add_entity', source: ER, op: { kind: 'add_entity', id: 'PRODUCT' }, reference: [['    LINE_ITEM["Line item"]\n', '    LINE_ITEM["Line item"]\n    PRODUCT\n']] },
  { name: 'er add_attribute', source: ER, op: { kind: 'add_attribute', entity: 'ORDER', text: 'date placed' }, reference: [['        int id\n', '        int id\n        date placed\n']] },
  { name: 'er add_relation', source: ER, op: { kind: 'add_relation', from: 'ORDER', to: 'LINE_ITEM', leftCard: 'one-only', rightCard: 'one-or-many', label: 'contains' }, reference: [['    CUSTOMER ||--o{ ORDER : places\n', '    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n']] },
  { name: 'er set_entity_label', source: ER, op: { kind: 'set_entity_label', entity: 'ORDER', label: 'Order' }, touched: ['    ORDER {'], reference: [['    ORDER {', '    ORDER["Order"] {']] },
  { name: 'gantt add_task', source: GANTT, op: { kind: 'add_task', sectionIndex: 0, label: 'Test', taskId: 'test', start: 'after impl', end: '3d' }, reference: [['    Implement   :impl, after des, 10d\n', '    Implement   :impl, after des, 10d\n    Test :test, after impl, 3d\n']] },
  { name: 'gantt rename_task', source: GANTT, op: { kind: 'rename_task', sectionIndex: 0, taskIndex: 0, label: 'Design work' }, touched: ['    Design      :des, 2024-01-01, 5d'], reference: [['Design      :', 'Design work      :']] },
  { name: 'gantt set_task_dates', source: GANTT, op: { kind: 'set_task_dates', sectionIndex: 0, taskIndex: 0, start: '2024-01-02', end: '6d' }, touched: ['    Design      :des, 2024-01-01, 5d'], reference: [['2024-01-01, 5d', '2024-01-02, 6d']] },
  { name: 'gantt add_section', source: GANTT, op: { kind: 'add_section', label: 'Support' }, reference: [['    Release     :milestone, rel, 2024-01-20, 0d\n', '    Release     :milestone, rel, 2024-01-20, 0d\n    section Support\n']] },
]

function parse(source: string): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function patch(source: string, patches: Case['reference']): string {
  return patches.reduce((text, [find, replace]) => {
    expect(text.split(find).length, `reference patch ${JSON.stringify(find)} occurs once`).toBe(2)
    return text.replace(find, () => replace)
  }, source)
}

/** Whether `kept` appears in `lines` in order (a subsequence). */
function inOrder(kept: readonly string[], lines: readonly string[]): string[] {
  let at = 0
  const missing: string[] = []
  for (const line of kept) {
    const found = lines.indexOf(line, at)
    if (found < 0) missing.push(line)
    else at = found + 1
  }
  return missing
}

/** Statements of the canonical serialization, without comments or spacing,
 * as a multiset: the typed model in a form independent of authored layout. */
const statements = (d: ParsedDiagram) => serializeMermaid(d).split('\n').filter(line => line.trim() && !line.trim().startsWith('%%')).map(line => line.replace(/\s+/g, '')).sort()

/** Every argument-free getter of the upstream diagram DB, as plain JSON. */
const snapshot = (diagram: UpstreamDiagram) => {
  const plain = (value: unknown, depth = 0): unknown => {
    if (depth > 8 || typeof value === 'function') return undefined
    if (value instanceof Map) return [...value].map(([key, entry]) => [key, plain(entry, depth + 1)])
    if (value instanceof Set) return [...value].map(entry => plain(entry, depth + 1))
    if (Array.isArray(value)) return value.map(entry => plain(entry, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'domId').map(([key, entry]) => [key, plain(entry, depth + 1)]))
    return value
  }
  const db = diagram.db, out: Record<string, unknown> = {}
  const names = new Set([...Object.keys(db), ...Object.getOwnPropertyNames(Object.getPrototypeOf(db))])
  for (const name of [...names].sort()) {
    if (!/^get[A-Z]/.test(name) || typeof db[name] !== 'function' || db[name].length !== 0) continue
    try { out[name] = JSON.parse(JSON.stringify(plain(db[name].call(db)))) } catch { /* not a data getter */ }
  }
  return out
}

describe('source-preserving typed edits of structured bodies', () => {
  const upstream = startUpstreamMermaid()
  afterAll(() => upstream.close())

  test.each(CASES)('$name', async ({ source, op, touched = [], reference }) => {
    const before = parse(source)
    expect(before.body.kind).not.toBe('opaque')
    const result = applyOps({ source, ops: [op], mode: 'source-preserving' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.preservation).toEqual({ method: 'local' })

    const output = result.source.split('\n')
    const untouched = source.split('\n').filter(line => !touched.includes(line))
    expect(inOrder(untouched, output)).toEqual([])

    const canonical = mutateChecked(before, op)
    if (!canonical.ok) throw new Error(canonical.error.message)
    const edited = parse(result.source)
    expect(describeMermaidFacts(edited).sort()).toEqual(describeMermaidFacts(canonical.value).sort())
    expect(statements(edited)).toEqual(statements(canonical.value))

    const [read, expected] = await upstream.projectEach([result.source, patch(source, reference)], snapshot)
    expect(read).toEqual(expected!)
    expect(read!.ok).toBe(true)
  }, 20_000)
})
