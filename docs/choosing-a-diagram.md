# Choosing a diagram family

Start from the task the reader must perform. A diagram family is the result of
that decision, not the starting point: the same deployment can be drawn as a
flowchart, an architecture diagram, or a sequence diagram, and only the
reader's question tells you which one is right. This page routes from task to
family. Syntax and per-family caveats live in
[`diagram-families.md`](./diagram-families.md); the authoritative list of what
renders and what mutates is `am capabilities --json`, not this page.

## Start from the reader's task

<!-- complete: family-ids -->
| The reader must | First choice | Reach for instead when |
|---|---|---|
| Follow steps and decisions to an outcome | Flowchart | The subject reacts to events rather than proceeding through steps: state |
| See how a system moves between modes | State | The path is a linear procedure: flowchart |
| Read who sends what to whom, in order | Sequence | Only dependency matters, not order: flowchart |
| Read how protocol fields occupy bit addresses and word rows | Packet | Message order between actors matters: sequence |
| Compare dated work with durations and dependencies | Gantt | There are no dates, only eras: timeline |
| Track work by workflow stage, assignee, ticket, and priority | Kanban | Dates, durations, and dependencies matter: gantt |
| Scan periods and what happened in each | Timeline | The story is one person's scored experience: journey; the history is commits and branches: gitGraph |
| Judge how a process felt to the person in it | Journey | No actors or sentiment scores exist: timeline |
| Trace where quantities go from stage to stage | Sankey | The amounts don't need to balance: flowchart with labeled edges |
| Judge parts of one whole at one moment | Pie | Slices are many or nearly equal, or values change over time: xychart |
| Compare value proportions within a hierarchy | Treemap | There is no hierarchy: pie; precise comparisons matter more than area: xychart |
| Compare measured values across categories or time | XY chart | The values are shares of a single whole: pie |
| Place options on two independent axes | Quadrant | Each option is scored on three or more criteria: radar |
| Compare profiles across three or more shared criteria | Radar | There are exactly two criteria: quadrant |
| See stored data and how records relate | ER | Behavior and methods matter, not storage: class |
| See code structure, types, and inheritance | Class | Only the persistence shape matters: er |
| Trace requirements to supporting elements and verification evidence | Requirement | The subject is software types and inheritance: class |
| See services, their grouping, and physical links | Architecture | The flow is logical rather than deployed: flowchart |
| Read a deliberately arranged grid of components and nested groups | Block | Connectivity should choose placement: flowchart; infrastructure ports matter: architecture |
| Explain people, software responsibilities and nested system or deployment boundaries | C4 | The reader needs infrastructure ports and physical links: architecture; protocol timing: sequence |
| Follow commits, branches, and merges | GitGraph | — |
| Explore ideas radiating from one center | Mindmap | Branches share children (the structure is a graph, not a tree): flowchart |
| Investigate contributing causes of one effect | Ishikawa | The branches are ideas without a cause-and-effect claim: mindmap |

## Check the source shape first

Some families make source order carry meaning, and a few enforce arithmetic.
Know which constraints apply before you author:

- **Order is the timeline.** Sequence messages, timeline periods, journey
  tasks, and gantt tasks mean something by their position; a gantt task with no
  explicit start chains from the task above it. Reordering is a first-class
  edit in these families (`move_message`, `move_period`, `move_task`), not a
  cut-and-paste.
- **Sankey flows are an account.** An intermediate node that receives 100 and
  emits 80 renders as if it carried 100, hiding the missing 20. Verification
  names the unaccounted amount (`FLOW_IMBALANCE`); balance the links or add an
  explicit remainder sink.
- **Bar length is the value.** XY chart bars grow from zero, so an authored
  `y-axis` range that excludes zero makes lengths lie; verification names the
  baseline the bars start from (`BAR_RANGE_EXCLUDES_ZERO`), and a range that
  leaves values outside it names them (`VALUES_OUTSIDE_RANGE`). Many long category
  names do not all fit under a vertical chart; verification lists the ones the
  axis does not draw (`LABELS_HIDDEN`), and a horizontal chart lists them down
  the side.
- **Values have domains.** Journey scores are finite numbers 1–5, quadrant
  coordinates live in `[0, 1]`, pie values are positive, radar curves carry
  one value per axis. Out-of-domain input falls back to a lossless opaque body
  instead of a wrong render.
- **Labels select typed edits in the data families.** Pie slices, quadrant
  points, and radar axes and curves use labels as mutation selectors; typed
  add/rename operations reject collisions. Existing source can still contain
  duplicate labels, so make those identities unique before a label-addressed
  edit. Sankey node labels are intentionally shared across links and identify
  the same flow node.
- **Terminal delivery is real delivery.** Every registered family renders
  ASCII. A width the diagram cannot honestly meet throws `AsciiWidthError`
  with the required width instead of squeezing the layout.
- **C4 interactions have occurrence identity.** Repeated endpoint pairs are
  separate interactions. Dynamic order and explicit indices survive, while
  generated interaction selectors can change after structural edits; read the
  successful result before the next edit. See [C4](https://github.com/adewale/agentic-mermaid/blob/0f05d39858d0061b79a0c99ef03a5c10d537ddaa/docs/design/families/c4.md).
- **Bit addresses and grid cells carry meaning.** Packet ranges are inclusive;
  descending bit numbering mirrors the display without changing field addresses.
  Block source order, columns, spans, and spaces determine placement; connectors
  do not rearrange that grid.
- **Membership is authored data.** Kanban indentation places cards in columns;
  Ishikawa starts with the effect and uses indentation for contributing causes;
  Treemap parentage and numeric leaf values determine containment and area.
  Use the family's typed movement operations to change membership deliberately.
- **Requirement relations are typed traceability.** Containment, satisfaction,
  verification, and the other relation kinds retain their own meaning and
  endpoint orientation. Discover the family schema instead of borrowing
  flowchart edge syntax.

## Prefer the smallest structure that carries the meaning

1. Start with the family's base statements: nodes and edges, states and
   transitions, messages, tasks.
2. Label what the reader would otherwise guess. Every exit of a multi-exit
   decision carries its condition; verification cites the standards that
   require it (`DECISION_BRANCH_UNLABELED`, from ISO 5807 and ANSI X3.5).
3. Group only around real ownership: subgraphs, composite states, sections,
   architecture groups. A box that answers "who owns this?" earns its border.
4. Adjust direction after grouping, per subgraph where supported.
5. Add classes and styles last. Brand color, typography, and texture belong to
   the Style + Palette render options, not to the source.

If the construct you want is not modeled, check whether another family owns
that metaphor before bending this one. Source preservation does not establish
render support: C4 refuses a partial drawing when a retained statement has no
native interpretation. Check the family's documented disposition.

## Defaults that mislead

- A pie of six nearly equal slices asks the reader to compare angles, which
  eyes do badly. Rank the values as xychart bars.
- A flowchart standing in for a protocol misleads because arrows read as
  causality, not time. Message order is what sequence diagrams encode.
- A gantt without real dates is a timeline wearing a scheduler. The gantt
  scheduler resolves calendars and dependencies; if nothing depends on
  duration, timeline says the same thing with less machinery.
- A mindmap can only draw a tree. The moment two branches need the same
  child, move to a flowchart.
- A timeline that smuggles in durations ("Q1–Q3: migration") usually wants to
  be a gantt, where `after` and `until` make the dependency checkable.
- A radar comparison is honest only when every curve shares the axes and the
  scale; set `max`/`min` explicitly rather than letting one outlier stretch
  the grid.
- Today markers in gantt render only when the caller passes `ganttToday`;
  relying on the wall clock would make the render non-reproducible, so there
  is no implicit "today."

## Verify what the family promised

Choosing well is checkable. After authoring or editing, run `verifyMermaid`
(or `am verify`):

- **Tier 1 — structural:** <!-- BEGIN GENERATED: warning-codes:structural -->`EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW`, `UNRESOLVABLE_SCHEDULE`, `RENDER_FAILED`, `INTERNAL_ERROR`<!-- END GENERATED: warning-codes:structural -->
  must be empty before committing; they mean the source or render contract is
  broken, not merely ugly.
- **Tier 2 — geometric:** `NODE_OVERLAP` and route warnings flag layouts
  worth a look; suppress them only when the geometry is intentional.
- **Tier 3 — lint:** the codes cited above name the family-specific mistakes
  this page warns about. Each code's page under
  <https://agentic-mermaid.dev/warnings/> says what triggers it and how to
  clear it.

Two checks no lint sees: give the diagram a title or `accTitle` that states
the reader's question, and read the ASCII render in a terminal once, because
reviewers will.

The reader's task picks the family; `verify` checks what the family promised.
