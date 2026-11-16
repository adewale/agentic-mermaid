// Source-preserving typed edits of structured bodies (applyOps mode
// 'source-preserving'). The contract, checked at the library boundary every
// channel shares:
//   1. every authored line the op does not touch is byte-identical, in order —
//      the case names the lines it may touch, from the input alone;
//   2. the edited source parses to the same diagram as the canonical edit
//      (mutateChecked): the same facts and the same canonical statements;
//   3. upstream Mermaid 12.2.0 accepts it and reads it as the hand-written
//      reference edit (DB getters compared whole);
//   4. new and rewritten lines are spelled and indented as in the reference
//      edit (lines compared as a multiset: placement is checked by 1).
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

// The sequence writer writes fragment bodies at the opener's depth, so only
// the authored lines say how deep a fragment's body is.
const FRAGMENT_SEQUENCE = `sequenceDiagram
  participant A
  participant B
  %% retries
  loop every minute
      A->>B: ping
  end
`

// Fragments with untouched messages spelled with spaces, an empty branch and
// an empty loop.
const BRANCHED_SEQUENCE = `sequenceDiagram
  participant A
  participant B
  alt ok
      A ->> B : yes
  else no
  end
  loop forever
  end
`

// Fragments nested two and three deep, indented with tabs and their messages
// spelled with spaces.
const NESTED_SEQUENCE = `sequenceDiagram
\tparticipant A
\tparticipant B
\tA ->> B: one
\trect rgb(200, 220, 255)
\t\talt ok
\t\t\tB ->> A: two
\t\t\tloop retry
\t\t\t\tA ->> B: three
\t\t\tend
\t\telse no
\t\t\tA ->> B: four
\t\tend
\tend
`

// A comment, activations and a box of declarations kept verbatim in the
// branches of a typed fragment.
const PRESERVED_BRANCH_SEQUENCE = `sequenceDiagram
	participant A
	participant B
	A ->> B: one
	alt ok
		%% why this branch
		activate B
		B ->> A: two
		deactivate B
	else no
		box Aqua Group
			participant C as Cee
		end
		A ->> C: three
	end
`

// Branches whose only authored lines are kept lines: a new statement is
// indented like them, not like the fragment's opener.
const KEPT_ONLY_SEQUENCE = `sequenceDiagram
    participant A
    participant B
    alt ok
        activate A
    else no
        A->>B: go
        loop retry
            %% only a comment
        end
    end
`

// Values written over several physical lines: one statement, edited, kept or
// removed as a whole.
const SPLIT_FLOWCHART = `flowchart LR
  %% split values
  A["Load the
     config"] --> B
    B --> C
  C -->
      D[Done]
`

const SPLIT_CLASS = `classDiagram
    %% notes over lines
    class Order
    note for Order "Paid orders
        ship next day"
      class Invoice
`

const SPLIT_STATE = `stateDiagram-v2
  %% label over lines
  state "Waiting for
      payment" as Wait
    [*] --> Wait
  Wait --> Done
`

// Mermaid reads a relation label over lines, but not an alias (it is edited
// away here, so the result is Mermaid's to read).
const SPLIT_ER = `erDiagram
    CUSTOMER ||--o{ ORDER : "places
        online"
    ORDER {
        int id
    }
`
const SPLIT_ER_ALIAS = `${SPLIT_ER}    LINE_ITEM["Line
        item"]
`

// Statements declared or labelled on several lines: the parser merges them,
// and the canonical writer writes one statement for all of them.
const REDECLARED_FLOWCHART = `flowchart TD
    %% labels given twice
    A[First] --> B
  B --> A[Second]
    B --> C
`

const REDECLARED_SEQUENCE = `sequenceDiagram
    participant A as Alice
  participant B as Bob
    A ->> B: hi
  %% renamed later
  participant A as Alicia
`

const REDECLARED_CLASS = `classDiagram
    %% members given one per line
    Animal <|-- Duck
    Animal : +int age
  Animal : +isMammal()
    class Duck {
        +swim()
    }
`

const REDECLARED_STATE = `stateDiagram-v2
  %% described twice
  [*] --> Wait
    Wait: Waiting
  Wait --> Busy
  Wait: for payment
  Busy: Working
    state Busy {
      Load --> Save
    }
  state "Ready" as Ship
  Ship --> [*]
  state "to go" as Ship
`

const REDECLARED_ER = `erDiagram
    %% entity opened twice
    CUSTOMER {
        string name
    }
  CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        string email
    }
`

// Subgraph members declared by edges: `a2` is first mentioned outside the
// subgraph, and `a1-->a2` inside it makes both members.
const EDGE_MEMBERS = `flowchart TB
    %% members declared by edges
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
      b1-->b2
    end
`

// One line carrying two edges and a class.
const AMPERSAND_CLASSES = `flowchart TD
  %% keep
  A:::hot & B --> C
  classDef hot fill:#f96
`

// A node declared on its own line, whose label the writer moves onto the
// first edge that mentions it.
const DECLARED_FIRST = `flowchart TD
  %% keep
  n0[Zero]
  n1{One}
  n2 --> n1
`

// Namespaces the writer flattens (`namespace Platform.Auth`), and a block
// written on one line.
const NESTED_NAMESPACES = `classDiagram
    namespace Platform {
        namespace Auth {
            class UserService {
                +login()
            }
        }
        class Gateway {
            +route()
        }
    }
    Gateway --> UserService : delegates
`

const INLINE_ANNOTATION = `classDiagram
  %% keep
  class Shape <<interface>>
`

// Notes written after their state's first mention, which the edit removes:
// a note left first would declare its state where it stands.
const NOTED_STATE = `stateDiagram-v2
  %% keep
  [*] --> S
  note right of S
    noted
  end note
  S --> T
`

const NOTED_NEIGHBOUR = `stateDiagram-v2
    X --> S
    note left of S
      waiting
      here
    end note
  A --> B
    S --> T
`

const NOTED_BEFORE_COMPOSITE = `stateDiagram-v2
  [*] --> S
  note right of S : noted
  state C {
    S --> T
  }
`

// Statements Mermaid applies only to an entity that exists where they stand,
// written after its first mention, which the edit removes: left in place,
// Mermaid would ignore them (our reader would not), so they move past the
// next line naming their entity.
const CLASSED_NODE = `flowchart TD
  A --> B
  class B hot
  B --> C
  classDef hot fill:#f96
`

const LINKED_NODE = `flowchart TD
  A --> B
  click B "https://example.com"
  B --> C
`

// `class B,C` already stands before C's first mention, which Mermaid ignores.
const CLASSED_AND_LINKED = `flowchart LR
    A --> B
  class B,C hot
    click B href "https://example.com"
  B --> C
  classDef hot fill:#f96
`

const STYLED_CLASS = `classDiagram
  A <|-- B
  style B fill:#f96
  cssClass "B" hot
  B --> C
  classDef hot stroke:#333
`

const LINKED_CLASS = `classDiagram
  A <|-- B
  link B "https://example.com" "tip"
  B --> C
`

// New statements whose canonical neighbour stands before what they need: a
// classDef written above the node or class they style. Mermaid would ignore
// them there, so they follow what they need, or the kept classDef follows
// the new statement that gives a class its style class.
const CLASSDEF_ABOVE_NODES = `flowchart LR
  classDef hot fill:#f96
  A --> B
  B --> C
  C --> D
`

const CLASSDEF_ABOVE_SUBGRAPH = 'flowchart TD\n\tclassDef hot fill:#f96\n\tsubgraph S\n\t\tA --> D\n\tend\n\tD --> E\n'

const CLASSDEF_ABOVE_CLASS = `classDiagram
  classDef hot fill:#f96
  class B {
    +int x
  }
  B --> C
`

// B is declared between two classDefs: a new cssClass can stand after B and
// before the classDef it uses.
const CLASSDEFS_AROUND_CLASS = `classDiagram
  classDef cool fill:#0f0
  class B
  classDef hot fill:#f96
  class C
`

const STYLE_CLASS_BEFORE_DEF = `classDiagram
  classDef cool fill:#0f0
  class B
  cssClass "B" hot
`

const CLASSDEF_ABOVE_RELATION = `classDiagram
  classDef hot fill:#f96
  A <|-- B
`

// Enough messages that moving the first one last changes a canonical line
// difference larger than the table the diff uses for small edits.
const MANY_MESSAGES = `sequenceDiagram\n  participant A\n  participant B\n  A ->> B: first\n${Array.from({ length: 2100 }, (_, i) => `  B->>A: m${i}\n`).join('')}`

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
  { name: 'sequence add_fragment_message appended to a single-branch fragment takes its body indentation', source: FRAGMENT_SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 0, from: 'B', to: 'A', text: 'pong' }, reference: [['      A->>B: ping\n', '      A->>B: ping\n      B->>A: pong\n']] },
  { name: 'sequence add_fragment_message keeps untouched messages spelled with spaces', source: BRANCHED_SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 0, from: 'A', to: 'B', text: 'more' }, reference: [['      A ->> B : yes\n', '      A ->> B : yes\n      A->>B: more\n']] },
  { name: 'sequence add_fragment_message into an empty branch takes the body indentation', source: BRANCHED_SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 0, branchIndex: 1, from: 'B', to: 'A', text: 'nope' }, reference: [['  else no\n', '  else no\n      B->>A: nope\n']] },
  { name: 'sequence add_fragment_message into an empty loop takes the body indentation', source: BRANCHED_SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 1, from: 'A', to: 'B', text: 'tick' }, reference: [['  loop forever\n', '  loop forever\n      A->>B: tick\n']] },
  { name: 'sequence add_fragment_branch takes its sibling branch line indentation', source: SEQUENCE, op: { kind: 'add_fragment_branch', fragmentIndex: 0, label: 'retry' }, reference: [['\t\tC ->> C: sleep\n', '\t\tC ->> C: sleep\n\telse retry\n']] },
  { name: 'sequence set_message_text', source: SEQUENCE, op: { kind: 'set_message_text', index: 0, text: 'changed event' }, touched: ['\tK ->> C: event'], reference: [['C: event', 'C: changed event']] },
  { name: 'sequence set_participant_label', source: SEQUENCE, op: { kind: 'set_participant_label', id: 'C', label: 'Ctrl' }, touched: ['\tparticipant C as Controller'], reference: [['as Controller', 'as Ctrl']] },
  { name: 'sequence add_participant', source: SEQUENCE, op: { kind: 'add_participant', id: 'D', label: 'Database' }, reference: [['\tparticipant C as Controller\n', '\tparticipant C as Controller\n\tparticipant D as Database\n']] },
  { name: 'sequence add_fragment_message after a destroy in a verbatim alt branch', source: 'sequenceDiagram\n\tA->>B: hi\n\talt done\n\t\tdestroy B\n\t\tA->>B: bye\n\telse retry\n\t\tA->>A: tail\n\tend\n', op: { kind: 'add_fragment_message', fragmentIndex: 0, index: 1, from: 'A', to: 'A', text: 'after' }, reference: [['\t\tA->>B: bye\n', '\t\tA->>B: bye\n\t\tA->>A: after\n']] },
  { name: 'sequence add_fragment_note inside a verbatim alt branch', source: SEQUENCE, op: { kind: 'add_fragment_note', fragmentIndex: 0, position: 'right', actorIds: ['K'], text: 'acked', afterMessage: 1 }, reference: [['\t\tK -->> C: ok\n', '\t\tK -->> C: ok\n\t\tNote right of K: acked\n']] },
  { name: 'sequence add_fragment_message into the branch of a nested alt', source: NESTED_SEQUENCE, op: { kind: 'add_fragment_message', fragmentPath: [{ fragmentIndex: 0, branchIndex: 0 }], fragmentIndex: 0, branchIndex: 1, from: 'B', to: 'A', text: 'deep' }, reference: [['\t\t\tA ->> B: four\n', '\t\t\tA ->> B: four\n\t\t\tB->>A: deep\n']] },
  { name: 'sequence set_fragment_message_text three fragments deep', source: NESTED_SEQUENCE, op: { kind: 'set_fragment_message_text', fragmentPath: [{ fragmentIndex: 0, branchIndex: 0 }, { fragmentIndex: 0, branchIndex: 0 }], fragmentIndex: 0, index: 0, text: 'again' }, touched: ['\t\t\t\tA ->> B: three'], reference: [['B: three', 'B: again']] },
  { name: 'sequence add_fragment into a nested branch is indented like its siblings', source: NESTED_SEQUENCE, op: { kind: 'add_fragment', fragmentPath: [{ fragmentIndex: 0, branchIndex: 0 }, { fragmentIndex: 0, branchIndex: 1 }], fragmentKind: 'opt', label: 'maybe' }, reference: [['\t\t\tA ->> B: four\n', '\t\t\tA ->> B: four\n\t\t\topt maybe\n\t\t\tend\n']] },
  { name: 'sequence remove_fragment two fragments deep', source: NESTED_SEQUENCE, op: { kind: 'remove_fragment', fragmentPath: [{ fragmentIndex: 0, branchIndex: 0 }, { fragmentIndex: 0, branchIndex: 0 }], index: 0 }, touched: ['\t\t\tloop retry', '\t\t\t\tA ->> B: three', '\t\t\tend'], reference: [['\t\t\tloop retry\n\t\t\t\tA ->> B: three\n\t\t\tend\n', '']] },
  { name: 'sequence set_fragment_message_text between an activation and its deactivation', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text: 'again' }, touched: ['\t\tB ->> A: two'], reference: [['A: two', 'A: again']] },
  { name: 'sequence set_participant_label of a boxed declaration in a fragment branch', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'set_participant_label', id: 'C', label: 'Sea' }, touched: ['\t\t\tparticipant C as Cee'], reference: [['as Cee', 'as Sea']] },
  { name: 'sequence add_fragment_message into a branch holding only an activation', source: KEPT_ONLY_SEQUENCE, op: { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'B', text: 'new' }, reference: [['        activate A\n', '        activate A\n        A->>B: new\n']] },
  { name: 'sequence add_fragment_message into a nested branch holding only a comment', source: KEPT_ONLY_SEQUENCE, op: { kind: 'add_fragment_message', fragmentPath: [{ fragmentIndex: 0, branchIndex: 1 }], fragmentIndex: 0, from: 'A', to: 'B', text: 'new' }, reference: [['            %% only a comment\n', '            %% only a comment\n            A->>B: new\n']] },
  { name: 'sequence add_fragment anchored after a top-level message', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'add_fragment', fragmentKind: 'opt', label: 'maybe', afterMessage: 0 }, reference: [['\tA ->> B: one\n', '\tA ->> B: one\n\topt maybe\n\tend\n']] },
  { name: 'sequence move_fragment after a later top-level message', source: `${PRESERVED_BRANCH_SEQUENCE}\tA ->> B: four\n`, op: { kind: 'move_fragment', index: 0, afterMessage: 1 }, touched: ['\talt ok', '\t\t%% why this branch', '\t\tactivate B', '\t\tB ->> A: two', '\t\tdeactivate B', '\telse no', '\t\tbox Aqua Group', '\t\t\tparticipant C as Cee', '\t\tend', '\t\tA ->> C: three', '\tend'], reference: [['\talt ok\n\t\t%% why this branch\n\t\tactivate B\n\t\tB ->> A: two\n\t\tdeactivate B\n\telse no\n\t\tbox Aqua Group\n\t\t\tparticipant C as Cee\n\t\tend\n\t\tA ->> C: three\n\tend\n\tA ->> B: four\n', '\tA ->> B: four\n\talt ok\n\t\t%% why this branch\n\t\tactivate B\n\t\tB ->> A: two\n\t\tdeactivate B\n\telse no\n\t\tbox Aqua Group\n\t\t\tparticipant C as Cee\n\t\tend\n\t\tA ->> C: three\n\tend\n']] },
  { name: 'sequence add_note after a message', source: SEQUENCE, op: { kind: 'add_note', position: 'right', actorIds: ['C'], text: 'queued', afterMessage: 0 }, reference: [['\tK ->> C: event\n', '\tK ->> C: event\n\tNote right of C: queued\n']] },
  { name: 'sequence remove_note', source: SEQUENCE, op: { kind: 'remove_note', index: 0 }, touched: ['\tNote over K,C: done'], reference: [['\tNote over K,C: done\n', '']] },
  { name: 'sequence set_note_text', source: SEQUENCE, op: { kind: 'set_note_text', index: 0, text: 'all done' }, touched: ['\tNote over K,C: done'], reference: [['K,C: done', 'K,C: all done']] },
  { name: 'sequence move_note before a message', source: SEQUENCE, op: { kind: 'move_note', index: 0, beforeMessage: 0 }, touched: ['\tNote over K,C: done'], reference: [['\tNote over K,C: done\n', ''], ['\tK ->> C: event\n', '\tNote over K,C: done\n\tK ->> C: event\n']] },
  { name: 'sequence add_activation after a top-level message', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'add_activation', actorId: 'A', activate: true, afterMessage: 0 }, reference: [['\tA ->> B: one\n', '\tA ->> B: one\n\tactivate A\n']] },
  { name: 'sequence add_activation before a message in a verbatim alt branch', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'add_activation', fragmentIndex: 0, actorId: 'A', activate: true, beforeMessage: 0 }, reference: [['\t\tactivate B\n', '\t\tactivate B\n\t\tactivate A\n']] },
  { name: 'sequence remove_activation in a verbatim alt branch', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'remove_activation', fragmentIndex: 0, index: 1 }, touched: ['\t\tdeactivate B'], reference: [['\t\tdeactivate B\n', '']] },
  { name: 'sequence set_message_activation rewrites only its message', source: PRESERVED_BRANCH_SEQUENCE, op: { kind: 'set_message_activation', fragmentIndex: 0, branchIndex: 1, index: 0, mark: '+' }, touched: ['\t\tA ->> C: three'], reference: [['\t\tA ->> C: three', '\t\tA->>+C: three']] },
  { name: 'class add_class', source: CLASS, op: { kind: 'add_class', id: 'Bird' }, reference: [['    %% notes\n', '    %% notes\n    class Bird\n']] },
  { name: 'class add_member to a block', source: CLASS, op: { kind: 'add_member', class: 'Animal', text: '+int age' }, reference: [['        +eat() void\n', '        +eat() void\n        +int age\n']] },
  { name: 'class add_class with members opens a block indented like its siblings', source: CLASS, op: { kind: 'add_class', id: 'Bird', members: ['+fly() void'] }, reference: [['    %% notes\n', '    %% notes\n    class Bird {\n        +fly() void\n    }\n']] },
  { name: 'class add_member to a bare class opens a block', source: CLASS, op: { kind: 'add_member', class: 'Dog', text: '+bark() void' }, touched: ['    class Dog'], reference: [['    class Dog\n', '    class Dog {\n        +bark() void\n    }\n']] },
  { name: 'class add_relation', source: CLASS, op: { kind: 'add_relation', from: 'Animal', to: 'Cat', relKind: 'inheritance' }, reference: [['    Animal <|-- Dog : extends\n', '    Animal <|-- Dog : extends\n    Animal <|-- Cat\n']] },
  { name: 'class rename_class', source: CLASS, op: { kind: 'rename_class', from: 'Dog', to: 'Hound' }, touched: ['    class Dog', '    Animal <|-- Dog : extends', '    note for Dog "Good boy"'], reference: [['class Dog\n', 'class Hound\n'], ['<|-- Dog', '<|-- Hound'], ['note for Dog', 'note for Hound']] },
  { name: 'class add_note', source: CLASS, op: { kind: 'add_note', for: 'Cat', text: 'Independent' }, reference: [['    note for Dog "Good boy"\n', '    note for Dog "Good boy"\n    note for Cat "Independent"\n']] },
  { name: 'class set_title rewrites only the frontmatter title', source: CLASS, op: { kind: 'set_title', title: 'Zoo' }, touched: ['title: Classes'], reference: [['title: Classes', 'title: "Zoo"']] },
  { name: 'state add_state into a composite', source: STATE, op: { kind: 'add_state', id: 'Medium', parent: 'Running' }, reference: [['      Fast --> Slow\n', '      Fast --> Slow\n      Medium\n']] },
  { name: 'state add_transition', source: STATE, op: { kind: 'add_transition', from: 'Running', to: 'Idle', label: 'pause' }, reference: [['    Done --> [*]\n', '    Done --> [*]\n    Running --> Idle : pause\n']] },
  { name: 'state set_state_label edits a description in place', source: STATE, op: { kind: 'set_state_label', id: 'Idle', label: 'Idle now' }, touched: ['    Idle: Waiting here'], reference: [['Idle: Waiting here', 'Idle: Idle now']] },
  { name: 'state set_transition_label', source: STATE, op: { kind: 'set_transition_label', from: 'Idle', to: 'Running', label: 'go' }, touched: ['    Idle --> Running: start'], reference: [['Running: start', 'Running: go']] },
  { name: 'state remove_transition', source: STATE, op: { kind: 'remove_transition', from: 'Running', to: 'Done' }, touched: ['    Running --> Done: stop'], reference: [['    Running --> Done: stop\n', '']] },
  { name: 'state rename_state inside a composite', source: STATE, op: { kind: 'rename_state', from: 'Fast', to: 'Quick' }, touched: ['      Fast --> Slow'], reference: [['Fast --> Slow', 'Quick --> Slow']] },
  { name: 'er add_entity', source: ER, op: { kind: 'add_entity', id: 'PRODUCT' }, reference: [['    LINE_ITEM["Line item"]\n', '    LINE_ITEM["Line item"]\n    PRODUCT\n']] },
  { name: 'er add_attribute', source: ER, op: { kind: 'add_attribute', entity: 'ORDER', text: 'date placed' }, reference: [['        int id\n', '        int id\n        date placed\n']] },
  { name: 'er add_attribute to an entity named only by a relation opens an indented block', source: `${ER}    ORDER ||--o{ SHIPMENT : ships\n`, op: { kind: 'add_attribute', entity: 'SHIPMENT', text: 'date sent' }, reference: [['    ORDER ||--o{ SHIPMENT : ships\n', '    ORDER ||--o{ SHIPMENT : ships\n    SHIPMENT {\n        date sent\n    }\n']] },
  { name: 'er add_relation', source: ER, op: { kind: 'add_relation', from: 'ORDER', to: 'LINE_ITEM', leftCard: 'one-only', rightCard: 'one-or-many', label: 'contains' }, reference: [['    CUSTOMER ||--o{ ORDER : places\n', '    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n']] },
  { name: 'er set_entity_label', source: ER, op: { kind: 'set_entity_label', entity: 'ORDER', label: 'Order' }, touched: ['    ORDER {'], reference: [['    ORDER {', '    ORDER["Order"] {']] },
  { name: 'er add_attribute after a relation label written over two lines', source: SPLIT_ER, op: { kind: 'add_attribute', entity: 'ORDER', text: 'date placed' }, reference: [['        int id\n', '        int id\n        date placed\n']] },
  { name: 'er remove_relation removes every line of its split label', source: SPLIT_ER, op: { kind: 'remove_relation', index: 0 }, touched: ['    CUSTOMER ||--o{ ORDER : "places', '        online"'], reference: [['    CUSTOMER ||--o{ ORDER : "places\n        online"\n', '    CUSTOMER\n']] },
  { name: 'er set_entity_label on an alias written over two lines', source: SPLIT_ER_ALIAS, op: { kind: 'set_entity_label', entity: 'LINE_ITEM', label: 'Item' }, touched: ['    LINE_ITEM["Line', '        item"]'], reference: [['LINE_ITEM["Line\n        item"]', 'LINE_ITEM["Item"]']] },
  { name: 'gantt add_task', source: GANTT, op: { kind: 'add_task', sectionIndex: 0, label: 'Test', taskId: 'test', start: 'after impl', end: '3d' }, reference: [['    Implement   :impl, after des, 10d\n', '    Implement   :impl, after des, 10d\n    Test :test, after impl, 3d\n']] },
  { name: 'gantt rename_task', source: GANTT, op: { kind: 'rename_task', sectionIndex: 0, taskIndex: 0, label: 'Design work' }, touched: ['    Design      :des, 2024-01-01, 5d'], reference: [['Design      :', 'Design work      :']] },
  { name: 'gantt set_task_dates', source: GANTT, op: { kind: 'set_task_dates', sectionIndex: 0, taskIndex: 0, start: '2024-01-02', end: '6d' }, touched: ['    Design      :des, 2024-01-01, 5d'], reference: [['2024-01-01, 5d', '2024-01-02, 6d']] },
  { name: 'flowchart set_label on a label written over two lines', source: SPLIT_FLOWCHART, op: { kind: 'set_label', target: 'A', label: 'Load' }, touched: ['  A["Load the', '     config"] --> B'], reference: [['A["Load the\n     config"]', 'A["Load"]']] },
  { name: 'flowchart remove_node removes every line of its split label', source: SPLIT_FLOWCHART, op: { kind: 'remove_node', id: 'A' }, touched: ['  A["Load the', '     config"] --> B'], reference: [['  A["Load the\n     config"] --> B\n', '']] },
  { name: 'class remove_note whose text spans lines', source: SPLIT_CLASS, op: { kind: 'remove_note', index: 0 }, touched: ['    note for Order "Paid orders', '        ship next day"'], reference: [['    note for Order "Paid orders\n        ship next day"\n', '']] },
  { name: 'class rename_class named by a note written over lines', source: SPLIT_CLASS, op: { kind: 'rename_class', from: 'Order', to: 'Purchase' }, touched: ['    class Order', '    note for Order "Paid orders'], reference: [['class Order\n', 'class Purchase\n'], ['note for Order', 'note for Purchase']] },
  { name: 'state rename_state whose label spans lines', source: SPLIT_STATE, op: { kind: 'rename_state', from: 'Wait', to: 'Hold' }, touched: ['      payment" as Wait', '    [*] --> Wait', '  Wait --> Done'], reference: [['" as Wait', '" as Hold'], ['--> Wait', '--> Hold'], ['Wait --> Done', 'Hold --> Done']] },
  { name: 'state remove_state removes every line of its split label', source: SPLIT_STATE, op: { kind: 'remove_state', id: 'Wait' }, touched: ['  state "Waiting for', '      payment" as Wait', '    [*] --> Wait', '  Wait --> Done'], reference: [['  state "Waiting for\n      payment" as Wait\n    [*] --> Wait\n  Wait --> Done\n', '  Done\n']] },
  { name: 'flowchart remove_edge whose line gave the node its last label', source: REDECLARED_FLOWCHART, op: { kind: 'remove_edge', id: 'B->A' }, touched: ['    A[First] --> B', '  B --> A[Second]'], reference: [['    A[First] --> B\n  B --> A[Second]\n', '    A[Second] --> B\n']] },
  { name: 'sequence set_participant_label edits the declaration that wins', source: REDECLARED_SEQUENCE, op: { kind: 'set_participant_label', id: 'A', label: 'Al' }, touched: ['  participant A as Alicia'], reference: [['as Alicia', 'as Al']] },
  { name: 'sequence remove_participant removes every declaration', source: REDECLARED_SEQUENCE, op: { kind: 'remove_participant', id: 'A' }, touched: ['    participant A as Alice', '    A ->> B: hi', '  participant A as Alicia'], reference: [['    participant A as Alice\n', ''], ['    A ->> B: hi\n', ''], ['  participant A as Alicia\n', '']] },
  { name: 'class add_member to a class written as member lines', source: REDECLARED_CLASS, op: { kind: 'add_member', class: 'Animal', text: '+mate()' }, reference: [['  Animal : +isMammal()\n', '  Animal : +isMammal()\n  Animal : +mate()\n']] },
  { name: 'class rename_class renames every member line', source: REDECLARED_CLASS, op: { kind: 'rename_class', from: 'Animal', to: 'Beast' }, touched: ['    Animal <|-- Duck', '    Animal : +int age', '  Animal : +isMammal()'], reference: [['Animal <|--', 'Beast <|--'], ['Animal : +int', 'Beast : +int'], ['Animal : +isMammal', 'Beast : +isMammal']] },
  { name: 'class remove_class beside a class written as member lines', source: REDECLARED_CLASS, op: { kind: 'remove_class', id: 'Duck' }, touched: ['    Animal <|-- Duck', '    class Duck {', '        +swim()', '    }'], reference: [['    Animal <|-- Duck\n', ''], ['    class Duck {\n        +swim()\n    }\n', '']] },
  { name: 'class remove_member removes its member line', source: REDECLARED_CLASS, op: { kind: 'remove_member', class: 'Animal', index: 0 }, touched: ['    Animal : +int age'], reference: [['    Animal : +int age\n', '']] },
  { name: 'state set_state_label replaces descriptions given twice', source: REDECLARED_STATE, op: { kind: 'set_state_label', id: 'Wait', label: 'Idle' }, touched: ['    Wait: Waiting', '  Wait: for payment'], reference: [['Wait: Waiting', 'Wait: Idle'], ['  Wait: for payment\n', '']] },
  { name: 'state set_state_label replaces aliases given twice', source: REDECLARED_STATE, op: { kind: 'set_state_label', id: 'Ship', label: 'Shipped' }, touched: ['  state "Ready" as Ship', '  state "to go" as Ship'], reference: [['state "Ready" as Ship', 'state "Shipped" as Ship'], ['  state "to go" as Ship\n', '']] },
  { name: 'state set_state_label on a composite labelled on its own line', source: REDECLARED_STATE, op: { kind: 'set_state_label', id: 'Busy', label: 'Running' }, touched: ['  Busy: Working'], reference: [['Busy: Working', 'Busy: Running']] },
  { name: 'state rename_state renames its label line and its block', source: REDECLARED_STATE, op: { kind: 'rename_state', from: 'Busy', to: 'Active' }, touched: ['  Wait --> Busy', '  Busy: Working', '    state Busy {'], reference: [['--> Busy', '--> Active'], ['Busy: Working', 'Active: Working'], ['state Busy {', 'state Active {']] },
  { name: 'er rename_entity renames both of its blocks', source: REDECLARED_ER, op: { kind: 'rename_entity', from: 'CUSTOMER', to: 'CLIENT' }, touched: ['    CUSTOMER {', '  CUSTOMER ||--o{ ORDER : places'], reference: [['CUSTOMER {\n        string name', 'CLIENT {\n        string name'], ['CUSTOMER ||', 'CLIENT ||'], ['CUSTOMER {\n        string email', 'CLIENT {\n        string email']] },
  { name: 'er remove_entity removes both of its blocks', source: REDECLARED_ER, op: { kind: 'remove_entity', id: 'CUSTOMER' }, touched: ['    CUSTOMER {', '        string name', '    }', '  CUSTOMER ||--o{ ORDER : places', '        string email'], reference: [['    CUSTOMER {\n        string name\n    }\n  CUSTOMER ||--o{ ORDER : places\n    CUSTOMER {\n        string email\n    }\n', '    ORDER\n']] },
  { name: 'sequence set_fragment_message_text keeps the message\'s authored spacing', source: BRANCHED_SEQUENCE, op: { kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text: 'yes please' }, touched: ['      A ->> B : yes'], reference: [['B : yes', 'B : yes please']] },
  { name: 'sequence move_message across a difference larger than the diff table', source: MANY_MESSAGES, op: { kind: 'move_message', from: 0, to: 2100 }, touched: ['  A ->> B: first'], reference: [['  A ->> B: first\n', ''], ['  B->>A: m2099\n', '  B->>A: m2099\n  A ->> B: first\n']] },
  { name: 'flowchart remove_node keeps the subgraph member its edge declared', source: EDGE_MEMBERS, op: { kind: 'remove_node', id: 'a1' }, touched: ['    a1-->a2'], reference: [['    a1-->a2\n', '    a2\n']] },
  { name: 'flowchart add_node after edges inside a subgraph stays outside it', source: EDGE_MEMBERS, op: { kind: 'add_node', id: 'N', label: 'New' }, reference: [['      b1-->b2\n    end\n', '      b1-->b2\n    end\n    N[New]\n']] },
  { name: 'flowchart remove_edge from a line with two edges and a class', source: AMPERSAND_CLASSES, op: { kind: 'remove_edge', id: 'A->C' }, touched: ['  A:::hot & B --> C'], reference: [['  A:::hot & B --> C\n', '  B --> C\n  A[A]\n  class A hot\n']] },
  { name: 'flowchart add_edge from a node declared on its own line keeps its label there', source: DECLARED_FIRST, op: { kind: 'add_edge', from: 'n0', to: 'n1' }, reference: [['  n2 --> n1\n', '  n2 --> n1\n  n0 --> n1\n']] },
  { name: 'class remove_class from a nested namespace', source: NESTED_NAMESPACES, op: { kind: 'remove_class', id: 'UserService' }, touched: ['        namespace Auth {', '            class UserService {', '                +login()', '            }', '        }', '    Gateway --> UserService : delegates'], reference: [['        namespace Auth {\n            class UserService {\n                +login()\n            }\n        }\n', ''], ['    Gateway --> UserService : delegates\n', '']] },
  { name: 'class add_member to a class written with its annotation on one line', source: INLINE_ANNOTATION, op: { kind: 'add_member', class: 'Shape', text: '+int added' }, touched: ['  class Shape <<interface>>'], reference: [['  class Shape <<interface>>\n', '  class Shape {\n    <<interface>>\n    +int added\n  }\n']] },
  { name: 'state remove_transition moves a note past the line that now names its state first', source: NOTED_STATE, op: { kind: 'remove_transition', index: 0 }, touched: ['  [*] --> S', '  note right of S', '    noted', '  end note'], reference: [['  [*] --> S\n  note right of S\n    noted\n  end note\n  S --> T\n', '  S --> T\n  note right of S\n    noted\n  end note\n']] },
  { name: 'state remove_state of a neighbour moves the note on the state it named past a transition between', source: NOTED_NEIGHBOUR, op: { kind: 'remove_state', id: 'X' }, touched: ['    X --> S', '    note left of S', '      waiting', '      here', '    end note'], reference: [['    X --> S\n    note left of S\n      waiting\n      here\n    end note\n', ''], ['    S --> T\n', '    S --> T\n    note left of S\n      waiting\n      here\n    end note\n']] },
  { name: 'state remove_transition moves a note past the composite that now names its state first', source: NOTED_BEFORE_COMPOSITE, op: { kind: 'remove_transition', from: '[*]', to: 'S' }, touched: ['  [*] --> S', '  note right of S : noted'], reference: [['  [*] --> S\n  note right of S : noted\n', ''], ['    S --> T\n  }\n', '    S --> T\n  }\n  note right of S : noted\n']] },
  { name: 'flowchart remove_edge moves a class past the line that now names its node first', source: CLASSED_NODE, op: { kind: 'remove_edge', id: 'A->B' }, touched: ['  A --> B', '  class B hot'], reference: [['  A --> B\n  class B hot\n  B --> C\n', '  B --> C\n  class B hot\n  A[A]\n']] },
  { name: 'flowchart remove_node moves a click, read after the line before it, past the line that now names its node first', source: LINKED_NODE, op: { kind: 'remove_node', id: 'A' }, touched: ['  A --> B', '  click B "https://example.com"'], reference: [['  A --> B\n  click B "https://example.com"\n  B --> C\n', '  B --> C\n  click B "https://example.com"\n']] },
  { name: 'flowchart remove_edge moves a class naming two nodes and a click, in order, past the next line naming the node', source: CLASSED_AND_LINKED, op: { kind: 'remove_edge', id: 'A->B' }, touched: ['    A --> B', '  class B,C hot', '    click B href "https://example.com"'], reference: [['    A --> B\n  class B,C hot\n    click B href "https://example.com"\n  B --> C\n', '  B --> C\n  class B,C hot\n    click B href "https://example.com"\n  A[A]\n']] },
  { name: 'class remove_relation moves a style and cssClass, in order, past the line that now names their class first', source: STYLED_CLASS, op: { kind: 'remove_relation', index: 0 }, touched: ['  A <|-- B', '  style B fill:#f96', '  cssClass "B" hot'], reference: [['  A <|-- B\n  style B fill:#f96\n  cssClass "B" hot\n  B --> C\n', '  class A\n  B --> C\n  style B fill:#f96\n  cssClass "B" hot\n']] },
  { name: 'class remove_class moves a link past the line that now names its class first', source: LINKED_CLASS, op: { kind: 'remove_class', id: 'A' }, touched: ['  A <|-- B', '  link B "https://example.com" "tip"'], reference: [['  A <|-- B\n  link B "https://example.com" "tip"\n  B --> C\n', '  B --> C\n  link B "https://example.com" "tip"\n']] },
  { name: 'flowchart set_node_class beside a classDef above the node is written after the node\'s first mention', source: CLASSDEF_ABOVE_NODES, op: { kind: 'set_node_class', id: 'C', className: 'hot' }, reference: [['  B --> C\n', '  B --> C\n  class C hot\n']] },
  { name: 'flowchart set_node_class of a node first named in a subgraph is written after its end, indented like it', source: CLASSDEF_ABOVE_SUBGRAPH, op: { kind: 'set_node_class', id: 'D', className: 'hot' }, reference: [['\tend\n', '\tend\n\tclass D hot\n']] },
  { name: 'class set_css_class moves the classDef above the class verbatim after the new cssClass', source: CLASSDEF_ABOVE_CLASS, op: { kind: 'set_css_class', class: 'B', className: 'hot' }, touched: ['  classDef hot fill:#f96'], reference: [['  classDef hot fill:#f96\n', ''], ['  B --> C\n', '  B --> C\n  cssClass "B" hot\n  classDef hot fill:#f96\n']] },
  { name: 'class set_css_class is written after its class and before the classDef it uses', source: CLASSDEFS_AROUND_CLASS, op: { kind: 'set_css_class', class: 'B', className: 'hot' }, reference: [['  class B\n', '  class B\n  cssClass "B" hot\n']] },
  { name: 'class define_class is written after the cssClass that gives a class its style class', source: STYLE_CLASS_BEFORE_DEF, op: { kind: 'define_class', name: 'hot', style: 'fill:#f96' }, reference: [['  cssClass "B" hot\n', '  cssClass "B" hot\n  classDef hot fill:#f96\n']] },
  { name: 'class set_class_style beside a classDef above the class is written after the class\'s first mention', source: CLASSDEF_ABOVE_RELATION, op: { kind: 'set_class_style', class: 'B', style: 'fill:#0f0' }, reference: [['  A <|-- B\n', '  A <|-- B\n  style B fill:#0f0\n']] },
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

    expect(result.source.split('\n').sort()).toEqual(patch(source, reference).split('\n').sort())
    const [read, expected] = await upstream.projectEach([result.source, patch(source, reference)], snapshot)
    expect(read).toEqual(expected!)
    expect(read!.ok).toBe(true)
  }, 20_000)

  // A kept classDef that must follow a new cssClass, but would pass a
  // statement Mermaid reads in order with it: another classDef or a `style`
  // the canonical edit writes after it (the later one wins). Moving it would
  // change what Mermaid draws while our reader sees the same diagram, so
  // the edit falls back, naming the line that gives the class its style class.
  test.each([
    ['classDiagram\n  classDef hot fill:#f96\n  classDef cool fill:#0f0\n  class B\n', [{ kind: 'set_css_class', class: 'B', className: 'hot' }], 'B'],
    ['classDiagram\n  classDef hot fill:#f96\n  class C\n  style C fill:#000\n  class B\n', [{ kind: 'set_css_class', class: 'B', className: 'hot' }, { kind: 'set_css_class', class: 'C', className: 'hot' }], 'C'],
  ] as const)('a classDef that cannot follow the new cssClass it needs falls back: %j', (source, ops, name) => {
    const result = applyOps({ source, ops: [...ops], mode: 'source-preserving' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.preservation).toEqual({ method: 'canonical', reason: `no local change to the authored source reads back as the edited diagram: the closest local change leaves "classDef hot fill:#f96" before ${name}'s style-class assignment, where Mermaid 12.2.0 ignores it` })
  })

  // A note that must stay first (it declares T) and one that would have to
  // move past it: no local change keeps the notes in order, and the receipt
  // names the facts the closest candidate reads otherwise.
  test('a state edit that would reorder notes falls back with a named reason', () => {
    const source = 'stateDiagram-v2\n  %% keep\n  [*] --> S\n  note right of S : one\n  note left of T : two\n  S --> T\n'
    const result = applyOps({ source, ops: [{ kind: 'remove_transition', index: 0 }], mode: 'source-preserving' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.preservation).toEqual({ method: 'canonical', reason: 'no local change to the authored source reads back as the edited diagram: the closest local change writes the edited statements, but reads "note#0 left of T : two" and 1 more where the edit has "note#0 right of S : one" and 1 more' })
  })
})
