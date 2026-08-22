# Choosing a diagram family

Start from the task the reader must perform. A diagram family is the result of
that decision, not the starting point: the same deployment can be drawn as a
flowchart, an architecture diagram, or a sequence diagram, and only the
reader's question tells you which one is right. This page routes from task to
family. Syntax and per-family caveats live in
[`diagram-families.md`](./diagram-families.md); the authoritative list of what
renders and what mutates is `am capabilities --json`, not this page.

## Start from the reader's task

| The reader must | First choice | Reach for instead when |
|---|---|---|
| Follow steps and decisions to an outcome | Flowchart | The subject reacts to events rather than proceeding through steps: state |
| See how a system moves between modes | State | The path is a linear procedure: flowchart |
| Read who sends what to whom, in order | Sequence | Only dependency matters, not order: flowchart |
| Compare dated work with durations and dependencies | Gantt | There are no dates, only eras: timeline |
| Scan periods and what happened in each | Timeline | The story is one person's scored experience: journey; the history is commits and branches: gitGraph |
| Judge how a process felt to the person in it | Journey | No actors or sentiment scores exist: timeline |
| Trace where quantities go from stage to stage | Sankey | The amounts don't need to balance: flowchart with labeled edges |
| Judge parts of one whole at one moment | Pie | Slices are many or nearly equal, or values change over time: xychart |
| Compare measured values across categories or time | XY chart | The values are shares of a single whole: pie |
| Place options on two independent axes | Quadrant | Each option is scored on three or more criteria: radar |
| Compare profiles across three or more shared criteria | Radar | There are exactly two criteria: quadrant |
| See stored data and how records relate | ER | Behavior and methods matter, not storage: class |
| See code structure, types, and inheritance | Class | Only the persistence shape matters: er |
| See services, their grouping, and physical links | Architecture | The flow is logical rather than deployed: flowchart |
| Follow commits, branches, and merges | GitGraph | — |
| Explore ideas radiating from one center | Mindmap | Branches share children (the structure is a graph, not a tree): flowchart |

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
- **Values have domains.** Journey scores are integers 1–5, quadrant
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
that metaphor before bending this one. Unmodeled syntax still parses, renders,
and round-trips as an opaque body; what stops is structured mutation.

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

- **Tier 1 — structural:** `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`,
  `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW`,
  `UNRESOLVABLE_SCHEDULE`, and `RENDER_FAILED` must be empty before committing;
  they mean the source or render contract is broken, not merely ugly.
- **Tier 2 — geometric:** `NODE_OVERLAP` and route warnings flag layouts
  worth a look; suppress them only when the geometry is intentional.
- **Tier 3 — lint:** family-specific mistakes this page warns about include
  `DECISION_BRANCH_UNLABELED`, `FLOW_IMBALANCE`, `UNREACHABLE_NODE`,
  `DUPLICATE_EDGE`, and `LOW_CONTRAST` against the resolved background.

Two checks no lint sees: give the diagram a title or `accTitle` that states
the reader's question, and read the ASCII render in a terminal once, because
reviewers will.

The reader's task picks the family; `verify` checks what the family promised.
