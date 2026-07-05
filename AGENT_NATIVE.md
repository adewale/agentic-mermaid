# Agentic Mermaid — agent-native architecture

**Status.** Architecture/spec rationale for the merged agent-native surface on `main`. Current capabilities live in [`docs/features.md`](./docs/features.md); active work lives only in [`TODO.md`](./TODO.md). Not intended for upstream.

**System architecture overview.** For the how-the-engine-works entry point — the rendered three-stacks diagram and the routing/layout design docs — start at [`docs/design/system/README.md`](./docs/design/system/README.md).

**Thesis.** Agents authoring Mermaid diagrams today regenerate the whole source on every edit, or render to PNG and read it back with vision. The Beautiful Mermaid renderer foundation already fixed the worst of the rendering side (sync + DOM-free + ASCII). Agentic Mermaid adds the editing surface — structured verification, typed mutation, round-trippable IR — so an agent can edit one node and trust the result without ever opening an image.

---

## Why fork Beautiful Mermaid

The stack is three layers, each contributing something the others can't:

| Layer | Contribution |
|---|---|
| **Mermaid (grammar)** | 20+ diagram families. Rendered inline by GitHub, GitLab, Obsidian, Notion. Frontmatter + init + runtime config plane. `accTitle`/`accDescr` directives. **The corpus moat.** |
| **Beautiful Mermaid (renderer foundation)** | Synchronous, zero DOM, pure TypeScript. ASCII output. Two-color theming. Semantic role styling. Multi-family layout/render coverage. Property + mutation + e2e test scaffold already in place. **The AI-era renderer Craft built for Craft Agents.** |
| **Agentic Mermaid (this product/workflow)** | `ValidDiagram` IR. Deterministic layout. `verify()`. `mutate()` + round-trip `serializeMermaid`. Agent-agnostic skills, CLI, `--agent-instructions`. **The editing surface.** |

D2 has a better language than Mermaid. The Beautiful Mermaid renderer foundation has a better fit than D2 for agent contexts. Mermaid has a corpus neither of them has. The bet: stacking the three wins.

---

## The three properties

1. **Deterministic layout** — same input → structurally identical layout JSON across runs with the same ELK version. (Not "byte-identical SVG across versions" — that's a stronger claim that needs a forked ELK to actually deliver.)
2. **Verifiable rendering** — structured "did this render cleanly?" check. Structural warnings (anchors, bounds, emptiness, group containment) are reliable; metric warnings (label fit, overlap) are best-effort because they depend on font-measurement parity with ELK.
3. **Round-trippable** — `parseMermaid` produces a `ValidDiagram` that carries source needed to re-emit the diagram. For flowchart/state, sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, and gantt, `mutate` operates on structured bodies; for opaque-fallback bodies, preserved source is the round-trip mechanism.

(Composition — `@include`, templates, layered scenarios — was the fourth in earlier drafts and is deferred. Agents do not currently reach for composition; they paste and edit. Add when evidence demands.)

(1) is a prerequisite for (2) and (3). Skip it and the others check moving targets.

## Honest scope

What the current Agentic Mermaid surface delivers and what it doesn't:

| Family | Parse / verify / render / round-trip | Structured mutation |
|---|---|---|
| Flowchart | Full | ✅ 6 ops |
| State | Structured round-trip for the modeled subset (simple states/transitions/`[*]`/composites/direction); `<<fork>>`/`<<choice>>`/notes/`--`/`classDef` fall back to opaque losslessly | 8 ops via `asState` (BUILD-19) |
| Sequence | Structured-with-segments (BUILD-18): participant/message ops stay live while Note/alt/loop/par/activate/autonumber/title ride along verbatim as opaque-block segments; only un-segmentable input (unbalanced `end`) falls back to whole-body opaque | ✅ 5 ops when structured |
| Timeline | Full | ✅ 10 ops |
| Class | Full | ✅ 10 ops |
| ER | Full | ✅ 7 ops |
| Journey | Full structured round-trip (title/sections/tasks) | 10 ops via `asJourney` (BUILD-15 pilot) |
| Architecture | Structured round-trip for the modeled subset (groups/services/junctions/edges); `{group}` boundary edges + accTitle/accDescr fall back to opaque losslessly | 10 ops via `asArchitecture` (BUILD-17) |
| XY chart | Structured round-trip for the modeled subset (title/axes/series); quoted text, `;` lines, accTitle/accDescr fall back to opaque losslessly | 8 ops via `asXyChart` (BUILD-16) |
| Pie | Structured round-trip (title/showData/slices); accTitle/accDescr + malformed entries fall back to opaque losslessly | 7 ops via `asPie` |
| Quadrant | Structured round-trip (title/axes/quadrant labels/points); styling + out-of-range coords fall back to opaque losslessly | 7 ops via `asQuadrant` |
| Gantt | Structured-with-segments from day one ([`docs/design/families/gantt.md`](./docs/design/families/gantt.md)): title/section/task ops stay live while calendar directives, click lines, and comments ride along verbatim as opaque-block segments; duplicate task ids / unclosed accDescr fall back to whole-body opaque losslessly. Rendering is deterministic — the today marker needs a caller-supplied clock (`ganttToday`), never the wall clock | 9 ops via `asGantt` |

The implication: for any opaque fallback, the agent's tool surface is *parse → verify → render → serialize*, not *parse → mutate → verify → serialize*. Cross-cutting edits on those bodies happen at the preserved source level (`body.source` for opaque bodies), not at the typed mutation layer. Code Mode opportunity #1 covers this for the cases where it matters.

---

## (1) Deterministic layout — structural, not seeded

**Empirically established (v4):** ELK output in this configuration is already deterministic, byte-identical across separate processes. The determinism comes from ELK's `considerModelOrder.strategy: NODES_AND_EDGES` setting plus the absence of any `randomSeed` option — layout order is a pure function of model order, not of randomness. Verified by a cross-process test (three separate `bun` invocations on the same source produce identical layout JSON) and a determinism grid.

This is the honest, stronger position. Earlier drafts wrapped ELK in a `withSeededRandom(rng, fn)` helper and exposed a `LayoutContext.rng` seed, claiming the seed "drove" layout. **It did not.** Seed 1 and seed 999999 produced byte-identical output because ELK never consults `Math.random` on this path. That apparatus was theater and is removed. There is no layout seed because none is needed; determinism is a property of the engine configuration, guarded by test. (The render option `seed` that exists today is a *style* seed — it re-rolls the ink of styled looks and never touches layout.)

Enforcement that determinism stays true:
- A **grep-based lint test** (runs under `bun test`, not aspirational ESLint) fails if `Math.random`, `Date.now`, or `performance.now` appear in `src/agent/**`, `src/gantt/**` (the Gantt scheduler must never read the wall clock), or `src/layout-engine.ts`. Introducing ambient nondeterminism breaks the build.
- A **cross-process determinism test** spawns child processes and asserts byte-identical layout.
- A **drift sentinel** pins canonical layout JSON for a hand-picked corpus; any change requires conscious re-baseline.

The canonical artifact is the **layout JSON**, not the SVG:

```json
{
  "version": 1,
  "kind": "flowchart",
  "nodes":  [{ "id": "A", "x": 12, "y": 36, "w": 80, "h": 40, "shape": "rect" }, ...],
  "edges":  [{ "id": "A->B", "from": "A", "to": "B", "path": [[..],[..]], "label": {...} }, ...],
  "groups": [{ "id": "g1", "x": 0, "y": 0, "w": 200, "h": 120, "members": ["A","B"] }, ...],
  "bounds": { "w": 320, "h": 180 }
}
```

There is no `seed` field (it was always `0` — a placeholder masquerading as state). SVG is the visual projection. Two render results are equal iff their layout JSON is structurally equal.

---

## (2) Verifiable rendering

```ts
verifyMermaid(source: string | ValidDiagram, opts?: VerifyOptions): VerifyResult

interface VerifyOptions {
  suppress?: WarningCode[]      // codes to omit, e.g. ['UNKNOWN_SHAPE']
  labelCharCap?: number         // default cap 40
}

interface VerifyResult {
  ok: boolean
  warnings: LayoutWarning[]
  layout: RenderedLayout
}
```

Warnings split into three tiers by how reliable/actionable the underlying check is:

### Tier 1 — Source-and-structure (reliable)

Derived from parsed structure or character-level source properties. Deterministic, no font measurement dependency.

| Code | Severity | Description |
|---|---|---|
| `EMPTY_DIAGRAM`    | error   | Diagram contains no renderable elements |
| `EDGE_MISANCHORED` | error   | Edge endpoint does not attach to a real node / participant |
| `OFF_CANVAS`       | error   | Node or edge segment lies outside the canvas |
| `GROUP_BREACH`     | error   | Member node lies outside its group's bounds |
| `UNKNOWN_SHAPE`    | warning | Shape name unrecognized; default used |
| `LABEL_OVERFLOW`   | warning | Label character count exceeds the configurable limit (default 40 chars). Payload includes `charCount` and `limit`. Source-based, no font-table dependency. |
| `UNRESOLVABLE_SCHEDULE` | error | The diagram parses and round-trips but its semantics cannot resolve, so rendering will fail loudly. Emitted for structured gantt bodies whose scheduler raises a named `GANTT_*` error (bad calendar date, dependency cycle, everything-excluded calendar); the payload's `reason` carries that error. |
| `RENDER_FAILED`    | error   | Any family: the source verifies structurally but the strict render parser throws on its canonical source, so rendering would fail. Generalizes `UNRESOLVABLE_SCHEDULE`'s seam-closing — a clean verify proves the diagram actually renders; the payload's `reason` carries the renderer error. |

### Tier 2 — Geometric (advisory)

Correctly detect what they claim to detect, but the occurrence may be intentional. Suppress when intent is clear; do not gate CI on them alone.

| Code | Severity | Description |
|---|---|---|
| `NODE_OVERLAP`     | warning | Two laid-out node bounding boxes intersect |
| `ROUTE_SELF_CROSS` | warning | An edge route crosses itself |
| `ROUTE_HITCH` | warning | An edge bends although a direct lane for it is provably clear (route-contract tripwire) |
| `ROUTE_UNEXPLAINED_BEND` | warning | An edge contains a diagonal segment under orthogonal routing (route-contract tripwire) |
| `ROUTE_LABEL_ON_SHARED_TRUNK` | warning | A label pill sits on a line segment another edge shares (route-contract tripwire) |
| `ROUTE_CONTAINER_MISANCHOR` | warning | A container edge does not terminate on the container border (route-contract tripwire) |
| `ROUTE_SHAPE_MISANCHOR` | warning | An endpoint is off the rendered shape boundary (route-contract tripwire) |
| `ROUTE_STALE_AFTER_NODE_MOVE` | warning | An endpoint detached from its node entirely (route-contract tripwire) |

Codes are the contract surface agents reason about. Emitting an undocumented code fails CI; documenting an unemitted one also fails CI. Agents omit known-irrelevant codes via `VerifyOptions.suppress`.

### Tier 3 — Lint (advisory)

Tier 3 warnings are family-specific quality hints for "common LLM mistakes" that parse and render but are probably not what the agent intended. They never flip `verify.ok`; callers decide whether to fail a style/quality gate.

| Code | Severity | Description |
|---|---|---|
| `DUPLICATE_EDGE` | warning | Flowchart/state contains an exact repeated edge with the same endpoints, label, style, and markers. Usually accidental regeneration or duplicate mutation. |
| `UNREACHABLE_NODE` | warning | Flowchart/state contains a node not reachable from any entry root when the graph has roots. Usually a stranded branch after an edit. |
| `DECISION_BRANCH_UNLABELED` | warning | A decision diamond has two or more exits and this branch carries no condition label. ISO 5807 (10.3.1.2) and ANSI X3.5 (4.10.2) require every exit of a multi-exit decision to be labeled with its condition value. |
| `COMMENT_DROPPED` | warning | The source contains in-body `%%` comments that this diagram's structured serialization does not preserve (reported with `count` and `lines`). The leading wrapper — frontmatter, `%%{init}%%` directives, comments before the header — always round-trips byte-verbatim; in-body comments survive only in opaque bodies or preserved opaque segments. Re-home load-bearing comments into the wrapper, or accept the loss as canonicalization. |
| `UNSUPPORTED_SYNTAX` | warning | The source uses Mermaid syntax that is preserved losslessly but not fully modeled by local structured mutation/render semantics (for example flowchart edge IDs, edge metadata, click/href directives, or markdown strings). Payload includes `syntax`, optional `line`, and `message`. |
| `CONTENT_DROPPED_ON_ROUNDTRIP` | warning | The structured `{nodes, edges, groups}` tally changed across a parse → serialize → re-parse cycle, so canonical serialization is silently dropping or duplicating content even though the bytes may re-parse (payload carries `before`/`after` counts). The faithfulness analogue of `COMMENT_DROPPED` — "100% parse success is not faithfulness". Runs on every verify, for every family; opaque bodies (byte-verbatim) are exempt. |

`FamilyPlugin.verify` hooks are wired and run today; built-ins use them for Tier 1 structural warnings for class/ER and the central flowchart verifier emits the initial Tier 3 lint catalogue. Future lint codes should be added deliberately to `WARNING_TIER`, documented here, and covered by doc-sync tests.

**Branded coordinate types** (`Finite`) prevent NaN / Infinity from reaching the renderer. `toFinite()` is the only constructor; it throws on invalid input.

**Model-gap property test**: for every generated `D` that parses successfully, `verify(D).warnings` filtered to Tier-1 `error` codes must be empty. Counterexamples are renderer bugs. Tier-2 warnings are excluded from this property because a `NODE_OVERLAP` or `ROUTE_SELF_CROSS` can be a legitimate property of a valid diagram, not a bug. Tier-3 lint warnings are excluded because they are maintainability hints, not render failures.

---

## (3) Round-trippable

A sealed `ValidDiagram` that preserves everything the source had — and carries the canonical source verbatim as the round-trip pillar:

```ts
interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: {
    frontmatter?: Frontmatter
    initDirectives: InitDirective[]
    comments: Comment[]
    accessibility: { title?: string, descr?: string }
  }
  readonly body: DiagramBody
  readonly source: SourceMap
  /**
   * The canonical preprocessed source — frontmatter, init directives, and
   * comments stripped; line breaks normalized. Structured renderers use this as
   * input. Opaque/source-level fidelity relies on `body.source`, not this field.
   */
  readonly canonicalSource: string
}

type DiagramBody =
  | { kind: 'flowchart'; graph: MermaidGraph }
  | StateBody | SequenceBody | TimelineBody | ClassBody | ErBody
  | JourneyBody | ArchitectureBody | XyChartBody | PieBody | QuadrantBody | GanttBody
  | { kind: 'opaque'; family: DiagramKind; source: string }

type MutableValidDiagram =
  | FlowchartValidDiagram | StateValidDiagram | SequenceValidDiagram
  | TimelineValidDiagram | ClassValidDiagram | ErValidDiagram
  | JourneyValidDiagram | ArchitectureValidDiagram | XyChartValidDiagram
  | PieValidDiagram | QuadrantValidDiagram | GanttValidDiagram
```

```ts
parseMermaid(source: string):                                Result<ValidDiagram, ParseError[]>
serializeMermaid(d: ValidDiagram):                           string
synthesizeFromGraph(payload):                                Result<ValidDiagram, ParseError[]>
createMermaid(kind, opts?):                                  MutableValidDiagram   // empty structured diagram; overloads narrow per kind
buildMermaid(kind, ops, opts?):                              Result<MutableValidDiagram, MutationError & { opIndex: number }>
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp):   Result<FlowchartValidDiagram, MutationError>
mutate(d: StateValidDiagram,     op: StateMutationOp):       Result<StateValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):    Result<SequenceValidDiagram, MutationError>
mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):    Result<TimelineValidDiagram, MutationError>
mutate(d: ClassValidDiagram,     op: ClassMutationOp):       Result<ClassValidDiagram, MutationError>
mutate(d: ErValidDiagram,        op: ErMutationOp):          Result<ErValidDiagram, MutationError>
mutate(d: JourneyValidDiagram,   op: JourneyMutationOp):     Result<JourneyValidDiagram, MutationError>
mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, MutationError>
mutate(d: XyChartValidDiagram,   op: XyChartMutationOp):     Result<XyChartValidDiagram, MutationError>
mutate(d: PieValidDiagram,       op: PieMutationOp):         Result<PieValidDiagram, MutationError>
mutate(d: QuadrantValidDiagram,  op: QuadrantMutationOp):    Result<QuadrantValidDiagram, MutationError>
mutate(d: GanttValidDiagram,     op: GanttMutationOp):       Result<GanttValidDiagram, MutationError>
asFlowchart/asState/asSequence/asTimeline/asClass/asEr/asJourney/asArchitecture/asXyChart/asPie/asQuadrant/asGantt(d): narrowed diagram | null
```

**`mutate` is overloaded by family.** Flowchart/state, simple sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, and gantt diagrams have first-class structured editing. Opaque-fallback diagrams are not typed for mutation, so agents get a compile-time/null-narrower stop rather than a lossy edit path.

Two contracts:

- `serializeMermaid(parseMermaid(s)) ≡ normalize(s)` for canonical input. For structured families this emits a fresh canonical form; for opaque families it emits preserved source with `meta` re-attached.
- `parseMermaid(serializeMermaid(d)) ≡ d` for every `d` produced by `parseMermaid` or `mutate`.

**Flowchart MutationOp kinds** (6):

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_node`    | `id`, `label`     | `shape`, `parent` | `remove_node(id)` |
| `remove_node` | `id`              | —                 | `add_node(id, label, shape, parent)` |
| `rename_node` | `from`, `to`      | —                 | `rename_node(to, from)` |
| `set_label`   | `target`, `label` | —                 | `set_label(target, prev_label)` |
| `add_edge`    | `from`, `to`      | `label`, `style`  | `remove_edge(id)` |
| `remove_edge` | `id`              | —                 | `add_edge(from, to, label, style)` |

**State MutationOp kinds** (8, BUILD-19 — promoting state from a "parses AS flowchart" projection to a dedicated `StateBody` IR with state-shaped ops and a real `asState` narrower). Modeled grammar: simple states (`state "Label" as id`, `id : Label`), transitions `from --> to [: label]` where `from`/`to` may be the reserved pseudostate `[*]` (source = start, target = end, scoped per composite level), composite blocks `state X { … }` (nestable), and `direction`. Anything else (`<<fork>>`/`<<choice>>`/`<<join>>`, history states, concurrency `--`, notes, `classDef`/`class`/`:::` styling, bare `stateId` lines, hyphenated composite ids) keeps the whole body opaque and round-trips verbatim. `[*]` is contextual, not a state node:

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_state`            | `id`              | `label`, `parent` (composite) | `remove_state(id)` |
| `remove_state`         | `id` (refused on a non-empty composite — remove children first) | — | `add_state(...)` |
| `rename_state`         | `from`, `to`      | — (rewrites transitions) | `rename_state(to, from)` |
| `set_state_label`      | `id`, `label \| null` | —             | `set_state_label(id, prev_label)` |
| `add_transition`       | `from`, `to` (`[*]` allowed) | `label`, `parent` | `remove_transition(from->to)` |
| `remove_transition`    | `index` or `from`/`to` pair | `parent` | `add_transition(...)` |
| `set_transition_label` | `label \| null` + (`index` or `from`/`to`) | `parent` | `set_transition_label(..., prev_label)` |
| `make_composite`       | `id`, `members: string[]` | `label`  | (move members out, remove composite) |

**Sequence MutationOp kinds** (5):

| Kind | Required | Optional | Inverse |
|---|---|---|---|
| `add_participant`    | `id`                  | `label` | `remove_participant(id)` |
| `remove_participant` | `id`                  | —       | `add_participant(id, label)` |
| `add_message`        | `from`, `to`, `text`  | `style` (sync/async) | `remove_message(index)` |
| `remove_message`     | `index`               | —       | `add_message(...)` |
| `set_message_text`   | `index`, `text`       | —       | `set_message_text(index, prev_text)` |

**Timeline MutationOp kinds** (10):

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                           | `set_title(prev_title)` |
| `add_section`        | `label`                                                   | `remove_section(index)` |
| `remove_section`     | `index`                                                   | `add_section(label)` |
| `set_section_label`  | `index`, `label`                                          | `set_section_label(index, prev_label)` |
| `add_period`         | `sectionIndex`, `label` (+ optional `events: string[]`)   | `remove_period(sectionIndex, periodIndex)` |
| `remove_period`      | `sectionIndex`, `periodIndex`                             | `add_period(...)` |
| `set_period_label`   | `sectionIndex`, `periodIndex`, `label`                    | `set_period_label(... prev_label)` |
| `add_event`          | `sectionIndex`, `periodIndex`, `text`                     | `remove_event(... eventIndex)` |
| `remove_event`       | `sectionIndex`, `periodIndex`, `eventIndex`               | `add_event(...)` |
| `set_event_text`     | `sectionIndex`, `periodIndex`, `eventIndex`, `text`       | `set_event_text(... prev_text)` |

**Class MutationOp kinds** (10):

| Kind | Required | Inverse |
|---|---|---|
| `set_title`         | `title \| null`                                      | `set_title(prev_title)` |
| `add_class`         | `id` (+ optional `label`, `members: string[]`)        | `remove_class(id)` |
| `remove_class`      | `id`                                                  | `add_class(id, label, members)` |
| `rename_class`      | `from`, `to`                                          | `rename_class(to, from)` |
| `add_member`        | `class`, `text`                                       | `remove_member(class, index)` |
| `remove_member`     | `class`, `index`                                      | `add_member(class, text)` |
| `add_relation`      | `from`, `to`, `relKind` (+ optional `label`)          | `remove_relation(index)` |
| `remove_relation`   | `index`                                               | `add_relation(...)` |
| `add_note`          | `text` (+ optional `for: class`)                       | `remove_note(index)` |
| `remove_note`       | `index`                                               | `add_note(text, for)` |

**ER MutationOp kinds** (7):

| Kind | Required | Inverse |
|---|---|---|
| `add_entity`        | `id` (+ optional `attributes: string[]`)             | `remove_entity(id)` |
| `remove_entity`     | `id`                                                  | `add_entity(id, attributes)` |
| `rename_entity`     | `from`, `to`                                          | `rename_entity(to, from)` |
| `add_attribute`     | `entity`, `text`                                      | `remove_attribute(entity, index)` |
| `remove_attribute`  | `entity`, `index`                                     | `add_attribute(entity, text)` |
| `add_relation`      | `from`, `to`, `leftCard`, `rightCard` (+ `dashed`, `label`) | `remove_relation(index)` |
| `remove_relation`   | `index`                                               | `add_relation(...)` |

**Journey MutationOp kinds** (10, BUILD-15 — the pilot promotion from opaque-only fallback semantics to structured mutation via the FamilyPlugin registry):

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                          | `set_title(prev_title)` |
| `add_section`        | `label`                                                   | `remove_section(index)` |
| `remove_section`     | `index`                                                   | `add_section(label)` |
| `set_section_label`  | `index`, `label`                                          | `set_section_label(index, prev_label)` |
| `add_task`           | `sectionIndex`, `text`, `score` (+ optional `actors`)     | `remove_task(sectionIndex, taskIndex)` |
| `remove_task`        | `sectionIndex`, `taskIndex`                               | `add_task(...)` |
| `set_task_text`      | `sectionIndex`, `taskIndex`, `text`                       | `set_task_text(... prev_text)` |
| `set_task_score`     | `sectionIndex`, `taskIndex`, `score` (integer 1..5)       | `set_task_score(... prev_score)` |
| `set_task_actors`    | `sectionIndex`, `taskIndex`, `actors: string[]`           | `set_task_actors(... prev_actors)` |
| `rename_actor`       | `from`, `to`                                              | `rename_actor(to, from)` |

**Architecture MutationOp kinds** (10, BUILD-17 — promoting the architecture-beta family to structured mutation via the FamilyPlugin registry, following the BUILD-15 journey pilot):

| Kind | Required | Inverse |
|---|---|---|
| `add_service`        | `id` (+ optional `label`, `icon`, `group`)               | `remove_service(id)` |
| `remove_service`     | `id` (cascades its edges)                                | `add_service(...)` + re-add edges |
| `rename_service`     | `from`, `to` (updates edges)                             | `rename_service(to, from)` |
| `set_service_label`  | `id`, `label`                                            | `set_service_label(id, prev_label)` |
| `set_service_icon`   | `id`, `icon: string \| null`                             | `set_service_icon(id, prev_icon)` |
| `move_service`       | `id`, `group: string \| null`                            | `move_service(id, prev_group)` |
| `add_group`          | `id` (+ optional `label`, `icon`, `parent`)              | `remove_group(id)` |
| `remove_group`       | `id` (refused if non-empty — move members first)         | `add_group(...)` |
| `add_edge`           | `from`, `to`, `fromSide`, `toSide` (+ optional `label`, `hasArrowStart`, `hasArrowEnd`) | `remove_edge(id)` |
| `remove_edge`        | `index` or `id` (`from->to`)                             | `add_edge(...)` |

**XY chart MutationOp kinds** (8, BUILD-16 — promoting the xychart family to structured mutation via the FamilyPlugin registry, following the BUILD-15 journey and BUILD-17 architecture pilots). Canonical number format is `String(n)` (shortest round-tripping decimal); all values must be finite. Modeled grammar covers bare (unquoted) titles/axis-names/series-names/categories; quoted text, multi-statement `;` lines, accTitle/accDescr, and any other unmodeled syntax fall back to opaque:

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                          | `set_title(prev_title)` |
| `set_x_axis`         | `axis: { name?, categories?, range? } \| null` (categories XOR range) | `set_x_axis(prev_axis)` |
| `set_y_axis`         | `axis: { name?, range? } \| null` (y-axis is never categorical) | `set_y_axis(prev_axis)` |
| `add_series`         | `kind2: 'bar' \| 'line'`, `values: number[]` (+ optional `name`) | `remove_series(index)` |
| `remove_series`      | `index`                                                   | `add_series(...)` |
| `set_series_values`  | `index`, `values: number[]`                              | `set_series_values(index, prev_values)` |
| `set_series_name`    | `index`, `name: string \| null`                          | `set_series_name(index, prev_name)` |
| `reorder_series`     | `from`, `to`                                             | `reorder_series(to, from)` |

**Pie MutationOp kinds** (7 — promoting the pie family to structured mutation via the FamilyPlugin registry, following the journey/architecture/xychart pilots). Slices are addressed by their (unique) label; values must be positive finite numbers. The header's `showData` flag and an optional `title` are modeled; any unmodeled line (accTitle/accDescr, malformed entry) falls back to opaque losslessly:

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                          | `set_title(prev_title)` |
| `set_show_data`      | `showData: boolean`                                      | `set_show_data(prev_flag)` |
| `add_slice`          | `label`, `value` (> 0)                                   | `remove_slice(label)` |
| `remove_slice`       | `label`                                                  | `add_slice(...)` |
| `rename_slice`       | `from`, `to`                                             | `rename_slice(to, from)` |
| `set_slice_value`    | `label`, `value` (> 0)                                   | `set_slice_value(label, prev_value)` |
| `reorder_slice`      | `from`, `to`                                             | `reorder_slice(to, from)` |

**Quadrant MutationOp kinds** (7 — promoting the quadrantChart family to structured mutation via the FamilyPlugin registry). Points are addressed by their (unique) label; coordinates must be in `[0, 1]`. Quadrant numbering follows Mermaid core (1=top-right, 2=top-left, 3=bottom-left, 4=bottom-right). Styling (`classDef`, `:::`), out-of-range coordinates, and any unmodeled line fall back to opaque losslessly:

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                          | `set_title(prev_title)` |
| `set_axis_labels`    | `axis: 'x' \| 'y'`, `near: string \| null` (+ optional `far`) | `set_axis_labels(axis, prev_near, prev_far)` |
| `set_quadrant_label` | `quadrant: 1..4`, `label: string \| null`                | `set_quadrant_label(quadrant, prev_label)` |
| `add_point`          | `label`, `x`, `y` (in `[0,1]`)                           | `remove_point(label)` |
| `remove_point`       | `label`                                                  | `add_point(...)` |
| `move_point`         | `label`, `x`, `y` (in `[0,1]`)                           | `move_point(label, prev_x, prev_y)` |
| `rename_point`       | `from`, `to`                                             | `rename_point(to, from)` |

**Gantt MutationOp kinds** (9 — segment-preserving from day one per [`docs/design/families/gantt.md`](./docs/design/families/gantt.md)). Sections and tasks are addressed by index (`sectionIndex`, `taskIndex`); `taskId` is the Mermaid id used by `after`/`until`/`click`. Calendar directives (`dateFormat`, `excludes`, `includes`, `weekend`, `weekday`, `todayMarker`, `tickInterval`, `inclusiveEndDates`, `topAxis`), `click` lines, accTitle/accDescr, and comments ride along VERBATIM as opaque-block segments — preserved, source-level-editable, never typed-editable in v1. Every value an op writes is validated by rendering its canonical line and re-parsing it (correctness by construction), so labels with `:` or values with `,` are rejected rather than corrupting the source:

| Kind | Required | Inverse |
|---|---|---|
| `set_title`          | `title \| null`                                          | `set_title(prev_title)` |
| `add_section`        | `label`                                                   | `remove_section(index)` |
| `rename_section`     | `index`, `label`                                          | `rename_section(index, prev_label)` |
| `remove_section`     | `index` (drops its tasks too)                             | `add_section(...)` + `add_task(...)` |
| `add_task`           | `sectionIndex`, `label`, `end` (+ optional `taskId`, `tags`, `start`) | `remove_task(sectionIndex, taskIndex)` |
| `remove_task`        | `sectionIndex`, `taskIndex`                               | `add_task(...)` |
| `rename_task`        | `sectionIndex`, `taskIndex`, `label`                      | `rename_task(..., prev_label)` |
| `set_task_status`    | `sectionIndex`, `taskIndex`, `status: 'active' \| 'done' \| 'crit' \| null` (milestone/vert tags are never disturbed) | `set_task_status(..., prev_status)` |
| `set_task_dates`     | `sectionIndex`, `taskIndex`, `start?: string \| null`, `end?: string` | `set_task_dates(..., prev_start, prev_end)` |

**Structured-or-opaque rule (v4): never lossy.** The parser only produces a structured body when it fully understands every non-blank, non-comment line for most structured families. If the source contains *any* construct the parser doesn't model — `direction TB` in class, `accTitle` or out-of-range scores in journey, the `{group}` boundary modifier in architecture, quoted text or `curve basis` in xychart, a malformed entry in pie, or out-of-range coordinates in quadrant, etc. — parsing **falls back to an opaque body**. The diagram still parses, renders, verifies (structurally), and round-trips losslessly via preserved `body.source`; it simply isn't offered for structured mutation (structured-family narrowers return `null` on opaque fallbacks). This guarantees the parser never silently drops information. Earlier drafts dropped unrecognized lines on the floor; v4 does not.

**Segment-preserving bodies (BUILD-18) — sequence ends the all-or-nothing cliff.** Sequence is the first family that does *not* go whole-body opaque on the first unmodeled line. Its body carries an ordered `statements: SequenceStatement[]` list (`participant` / `message` refs into the existing `participants`/`messages` arrays, plus `opaque-block` segments holding unmodeled lines VERBATIM). Block constructs (`alt|opt|loop|par|critical|break|rect … end`, nesting-tracked) become one opaque-block segment; `Note`/`activate`/`deactivate`/`autonumber`/`title` lines each join an adjacent segment. The participant/message ops stay live and address the top-level `messages` array exactly as before — **messages inside an opaque block are invisible to ops and are never touched.** Only an un-segmentable body (a stray `end`, an unclosed block) still falls back to whole-body opaque. Either way the round-trip is verbatim-lossless. Gantt adopts the same pattern from its first release: typed ops on title/sections/tasks, opaque-block segments for calendar directives/click/comments, whole-opaque only for duplicate ids or unclosed accDescr blocks. Class/ER/timeline segment-preservation is follow-up work.

For any opaque fallback, cross-cutting edits are source-level only: operate against preserved source intentionally, then re-parse and verify before returning. Every renderable family now ships structured mutation; a new family follows the same pattern as its definition of done: narrowed type + body parser + serializer + per-family ops + verify hook + round-trip property tests + doc sync (most recently gantt). See `docs/contributing/adding-diagram-types.md`.

Convention bans constructing `ValidDiagram` outside `parseMermaid`, `mutate`, `synthesizeFromGraph`, and `createMermaid`/`buildMermaid`.

---

## Public API

```ts
parseMermaid(source: string):                              Result<ValidDiagram, ParseError[]>
layoutMermaid(d: ValidDiagram):                            RenderedLayout
renderMermaidASCII(input: ValidDiagram | string, opts?):   string
renderMermaidPNG(input: ValidDiagram | string, opts?):     Uint8Array
renderMermaidSVG(input: ValidDiagram | string, opts?):     string
verifyMermaid(input: ValidDiagram | string, opts?: VerifyOptions): VerifyResult
serializeMermaid(d: ValidDiagram):                         string

// Mutation is overloaded by family. Opaque/source-only families don't typecheck.
mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mutate(d: StateValidDiagram,     op: StateMutationOp):     Result<StateValidDiagram, MutationError>
mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):  Result<TimelineValidDiagram, MutationError>
mutate(d: ClassValidDiagram,     op: ClassMutationOp):     Result<ClassValidDiagram, MutationError>
mutate(d: ErValidDiagram,        op: ErMutationOp):        Result<ErValidDiagram, MutationError>
mutate(d: JourneyValidDiagram,   op: JourneyMutationOp):   Result<JourneyValidDiagram, MutationError>
mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, MutationError>
mutate(d: XyChartValidDiagram,   op: XyChartMutationOp):   Result<XyChartValidDiagram, MutationError>
mutate(d: PieValidDiagram,       op: PieMutationOp):       Result<PieValidDiagram, MutationError>
mutate(d: QuadrantValidDiagram,  op: QuadrantMutationOp):  Result<QuadrantValidDiagram, MutationError>
mutate(d: GanttValidDiagram,     op: GanttMutationOp):     Result<GanttValidDiagram, MutationError>

// Narrowing helpers; null when the diagram isn't of that family or is opaque/source-level.
asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
asState(d: ValidDiagram):     StateValidDiagram | null
asSequence(d: ValidDiagram):  SequenceValidDiagram | null
asTimeline(d: ValidDiagram):  TimelineValidDiagram | null
asClass(d: ValidDiagram):     ClassValidDiagram | null
asEr(d: ValidDiagram):        ErValidDiagram | null
asJourney(d: ValidDiagram):   JourneyValidDiagram | null
asArchitecture(d: ValidDiagram): ArchitectureValidDiagram | null
asXyChart(d: ValidDiagram):   XyChartValidDiagram | null
asPie(d: ValidDiagram):       PieValidDiagram | null
asQuadrant(d: ValidDiagram):  QuadrantValidDiagram | null
asGantt(d: ValidDiagram):     GanttValidDiagram | null

// Build a ValidDiagram from a JSON-safe graph payload without re-parsing
// source. Used by `am parse | am serialize` shell pipelines.
synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]>

// Blank-slate authoring on the typed path: an empty structured diagram for
// any built-in family (overloads narrow the return per kind), and a fold of
// typed ops over that empty diagram. Errors carry the failing op's index.
createMermaid(kind: DiagramKind, opts?: { direction?: Direction }): MutableValidDiagram
buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts?: { direction?: Direction }): Result<MutableValidDiagram, MutationError & { opIndex: number }>

// VerifyOptions carries the only real knob: the label character cap.
interface VerifyOptions { suppress?: WarningCode[]; labelCharCap?: number }  // default cap 40
```

There is no `LayoutContext`, no `SeededRNG`, no `Clock`, no font-metric table in the public surface. Those existed to support a seed apparatus that did nothing (see § (1)). The only verification knob is `labelCharCap`.

**CLI** (`am <verb>`) with JSON where useful: `render`, `preview`, `verify`, `parse`, `serialize`, `mutate`, `format`, `describe`, `capabilities`, `batch`, `render-markdown`, `llms-txt`. `am capabilities --json` reports each family's `editPolicy` (`structured-when-narrowed` vs `source-level-only`) plus `mutationOps`, so agents can route without trial-and-error. Plus `am --agent-instructions` printing the canonical agent-use guide embedded in the binary at build time — agents read the doc that ships with the tool, not whatever their training set indexed. The CLI's role is one-shot operations, shell-only contexts (CI, Bash-tool agents), and human inspection; multi-step editing belongs in the library or Code Mode, not in shell pipelines.

---

## Compatibility choices from the Beautiful Mermaid foundation

- **Agent surface exposed via the `./agent` subpath export** on the `agentic-mermaid` package. Agentic Mermaid is the product/docs name and npm identity; the repository path currently remains `adewale/beautiful-mermaid`. The subpath export keeps renderer and agent surfaces side by side.
- **Deterministic layout, verified.** Layout JSON is byte-identical across processes because ELK is configured for model-order layout with no random seed (see § (1)). No seed parameter is exposed because none affects output. Cross-machine byte equality across different CPU float behavior is not claimed; structural determinism within an ELK version is guaranteed and tested cross-process.
- **IDs are content-hashed and stable** across runs (within an ELK version).
- **`MermaidGraph` is kept** as an exported type — `ValidDiagram` wraps it in `body.graph` for flowchart, rather than replacing it. The original spec called for removal; the implementation showed it would break 61 test files and the Craft Agents consumer. The wrapping shape costs nothing.
- **`renderMermaidSVGAsync` is kept**. Removing it was a v1-aspiration that turned out to break consumers for no win at the agent surface.
- **`mermaidConfig` precedence** (frontmatter < init < render options) is enforced by tests via a single merge function — unchanged from the existing pipeline.

---

## Distribution

Five artifacts, all derived from this doc:

- **npm package** `agentic-mermaid` with the `agentic-mermaid/agent` subpath. The full TypeScript API, including ASCII, PNG, and SVG output helpers. Agents with shell access import the library directly and compose verbs in their own JS/TS runtime; no MCP wrapper required.
- **`skills/agentic-mermaid-diagram-workflow/`** agent-agnostic skill bundle. Master `SKILL.md` routes by *both* diagram family and composition channel: it picks Code Mode when the MCP is connected, library import when the agent can run JS/TS with imports, the CLI for shell-only contexts. Per-family references (`flowchart.md`, `sequence.md`, etc.) describe syntax. Two channel references — `code-mode.md` (the canonical multi-step pattern) and `cli.md` (shell-only) — describe composition. Progressive disclosure means the LLM loads only what it needs. Family references sync from upstream Mermaid docs weekly via the shipped GitHub Action at `.github/workflows/sync-mermaid-docs.yml`, alongside our additions (LayoutWarning codes, MutationOp taxonomy).
- **Substrate grep-lint** runs under `bun test` (not an uninstalled ESLint): `src/__tests__/agent-substrate-lint.test.ts` fails the build if `Math.random`, `Date.now`, or `performance.now` appear in `src/agent/**` or `src/layout-engine.ts`. This is real enforcement, executed in CI, not an aspirational config file.
- **`agentic-mermaid-mcp`** Code Mode-style MCP server. The primary tool is `execute(code: string)`: the model writes JavaScript against the typed `mermaid.*` SDK declaration embedded in the system prompt; the server runs the code in a local `node:vm` sandbox with the library exposed as `mermaid` and the code's return value captured as the structured result. The server also exposes narrow `render_png` and `describe` helpers for binary output and summaries. The verify-before-commit loop becomes one round-trip rather than N. Hosting: local stdio launched by the MCP client (Claude Desktop, Claude Code, Cursor) — same deployment shape as filesystem-MCP, git-MCP, sqlite-MCP. No infrastructure on our side or the user's. The current MCP is not Cloudflare Codemode, not a Worker, not backed by `@cloudflare/codemode`, and not a drop-in Cloudflare integration. The `website/` Worker is a static Workers Static Assets deployment only; hosted MCP transport or a Cloudflare executor remain future options, not shipped artifacts.
- **`Instructions_for_agents.md`** at repo root, hard-capped under 100 lines. `am --agent-instructions` prints the same content at runtime; a doc-sync test asserts the two are byte-identical.

No HTTP endpoint or editor WebSocket watch in v1. The skill teaches Code Mode for both paths: agents-with-shell write JS/TS against the imported library; agents-without-shell write JavaScript against the MCP's `mermaid.*` SDK. Same surface in both cases.

---

## Agent-contract verbs (CLI)

Agent-contract CLI verbs for explicit self-discovery, summaries, and batch operation:

- `am capabilities [--json]` — emit `{ sdkVersion, families: [{ id, editPolicy, hasParse, hasSerialize, hasMutate, hasVerify, hasExtractLabels, mutationOps }], warningCodes: [{ code, tier, severity }], outputFormats: ["svg","ascii","unicode","png","json"] }`. Sourced from the public dispatch surface, family-plugin registry, and `WARNING_SEVERITY` / `WARNING_TIER` tables — so the contract is self-describing, not hand-maintained. A JSON Schema is committed at `src/__tests__/__fixtures__/capabilities.schema.json`; any shape drift fails the test loudly.
- `am batch --jsonl` — read JSONL from stdin, dispatch per-line to render/verify/parse/serialize/mutate handlers, emit one JSON envelope per result. Malformed lines surface `{ ok: false, error: { code: 'INVALID_JSON' } }` and do **not** abort the stream.
- `am preview <file|-> [--output file.html] [--open] [--json] [--security strict]` — write a standalone strict-mode HTML preview for human inspection without hand-building wrapper files.
- `am mutate <file|-> (--op '<json>' | --ops '<json array|file>') [--json]` — apply typed mutations, verify once at the commit point, and omit source on verify failure.
- `am describe <file|-> [--format text|json] [--json]` — emit a prose summary or structured AX tree (`{kind,nodes,edges,entryPoints,sinks}`) for screen readers, doc generation, and agent context compaction.
- **Exit codes** are widened to 4: `EXIT_OK=0`, `EXIT_ARG_ERROR=2`, `EXIT_VERIFY_FAILED=3`, `EXIT_INTERNAL=4` (in `src/cli/exit-codes.ts`). The CLI was previously `0` or `2` only. `EXIT_VERIFY_FAILED=3` is the new code for "valid args, but the diagram failed verify" — important for agents wrapping `am verify` in batch.

**Counter-example, documented.** manuareraa PR #42 on `lukilabs/beautiful-mermaid` ships an MCP server with 4 render-only tools (`render_svg` / `render_ascii` / `list_themes` / `parse`). We rejected this design: a render-tool-per-format MCP forces the agent to chain calls and loses ValidDiagram context. Our Code Mode design keeps one primary `execute()` surface for multi-step edits; `render_png` and `describe` are narrow helpers, not a render-tool-per-format API. PR #42 is preserved here as the documented counter-example so future contributors understand why we chose Code Mode.

---

## Agent workflow

The canonical runtime guide lives in `Instructions_for_agents.md` and is emitted byte-for-byte by `am --agent-instructions`; this spec intentionally does not duplicate the full snippet. The stable contract is:

1. For new diagrams, `buildMermaid(kind, ops)` — or `createMermaid(kind)` then typed mutations — then `verifyMermaid` / render or return it. Author Mermaid source directly only for syntax the typed ops do not model.
2. For existing diagrams, `parseMermaid(source)` → `ValidDiagram`.
3. Narrow with `asFlowchart` / `asState` / `asSequence` / `asTimeline` / `asClass` / `asEr` / `asJourney` / `asArchitecture` / `asXyChart` / `asPie` / `asQuadrant` / `asGantt`; `null` means no structured mutation for that body.
4. Apply typed `mutate` ops only to narrowed mutable bodies; Code Mode SDK-returned diagrams are read-only to block direct IR edits.
5. Run `verifyMermaid(d)` at every commit point and inspect `ok` / `warnings` / `layout`.
6. Only then `serializeMermaid(d)`.

Anti-patterns: whole-source regeneration of an existing parsed diagram, string concatenation to edit an existing structured diagram where a typed op exists, serializing before inspecting verify, and calling `mutate` on opaque/source-only bodies.

---

## Release discipline

This section records the design discipline for the branch, not an active roadmap. Active work lives only in `TODO.md`.

| Principle | Meaning |
|---|---|
| **Ship** | Keep the minimum lethal surface together: substrate + `verify` + `mutate` + `serialize` + typed MutationOps + CLI + skill + Code Mode MCP + `Instructions_for_agents.md`. |
| **Learn** | Use MermaidSeqBench, stored Code Mode evals, live model transcripts, and real consumers to decide what is missing. |
| **Expand by evidence** | Promote more MutationOps, composition primitives, HTTP/SSE MCP transport, or additional structured families only when evidence justifies them. |

---

## Measurement

| What | How | Target |
|---|---|---|
| Layout JSON byte-equality across runs | Determinism grid (4 directions × node-counts 2..12 × {sparse, dense, star}) | 100% within one ELK version on one machine |
| Drift sentinel | 8 hand-picked canonical layout JSONs as snapshots; any change without explicit acknowledgment fails CI | — |
| Cross-process determinism | Test spawns child `bun` processes; layout JSON byte-identical across them | 100% |
| Grep-lint substrate | Test fails if `Math.random`/`Date.now`/`performance.now` appear in `src/agent/**` or `src/layout-engine.ts` | 0 hits |
| Tier-1 verifier recall on broken-fixture cases | Inline tests per Tier-1 code | high |
| Round-trip identity | Golden corpus + property test | 100% on canonical input |
| Round-trip property | Property test (fast-check) | 100% on parseable input |
| Sequence fidelity | Property test (BUILD-18): any sequence source is segments-or-opaque and always lossless — interleaved structured + opaque lines round-trip in order; `remove_message` never touches opaque-block bytes | 100% lossless |
| Sad-path coverage | CLI mutate on opaque family; malformed JSON-RPC; broken Code Mode script; N-round format idempotence | explicit tests |
| Fault-injection (poor-man's mutation testing) | Inject a known bug into each core function, confirm a test catches it, revert | every core fn covered |
| Code Mode sandbox isolation | Tests assert `execute()` cannot reach `process`, `require`, `fetch`, `eval`, `Function`, or host-constructor escape paths; dynamic code generation is disabled | explicit tests |

Cross-cutting:

- **Doc-sync** (both directions): every `LayoutWarning` code and `MutationOp` kind must appear in this spec. `am --agent-instructions` output must equal `Instructions_for_agents.md` byte-for-byte.
- **Test honesty:** no tautological assertions (`expect(typeof x).toBe('boolean')` is banned by review). Every test must be able to fail for the regression it names. Verified by the fault-injection pass.

MermaidSeqBench is wired as an external corpus signal; live model transcript evaluation remains periodic / pre-release rather than PR CI.

---

## Risks (honest, v4)

- **Determinism is empirical, not proven.** It's established by cross-process test over a corpus + the drift sentinel, plus reading ELK's config (`considerModelOrder: NODES_AND_EDGES`, no `randomSeed`). An ELK upgrade could in principle change this; the cross-process test and sentinel would catch it. There is no layout seed to fall back on because seeding never affected geometry. (The render option `seed` is a *style* seed: it re-rolls the ink wobble of styled looks and never moves layout.)
- **Determinism claim, precisely.** Layout JSON is byte-identical (after structural parse) across processes AND across JS runtimes (bun, node) on the same machine and same ELK version; this is verified on same-machine x86_64 and ARM64 when Node + built `dist/` are present. Direct cross-architecture byte equality (x86_64 output compared to ARM64 output) is still not a separate claim.
- **Sequence structured coverage is segment-preserving (BUILD-18).** Participant declarations + simple messages are the mutable structured surface; Note/alt/loop/par/activate/autonumber/title now ride along as verbatim opaque-block *segments* in the same body, so the structured ops survive instead of going whole-body opaque. Messages inside opaque blocks are deliberately not modeled (invisible to ops). Only un-segmentable input (unbalanced `end`, unclosed block) falls back to whole-body opaque. The honest tradeoff is unchanged — never lossy — it just no longer sacrifices the structured ops at the first unmodeled line. (Class/ER/timeline segment work is a follow-up.)
- **All twelve renderable families ship structured mutation; opaque fallbacks stay source-level only.** Pie and quadrant completed the promotion (7 ops each, via `asPie`/`asQuadrant`) and gantt ships segment-preserving structured mutation from its first release (9 ops via `asGantt`), so a narrower exists for every family kind; only opaque-fallback bodies (unmodeled syntax) remain deliberate, lossless source-level paths. (Journey was promoted by BUILD-15; architecture by BUILD-17; xychart by BUILD-16.)
- **Live-model agent-usage eval is periodic, not PR CI.** Stored Code Mode scripts, sandbox traces, task oracles, and the committed pi-subagent transcript replay run in CI; API-backed release-model transcripts remain in `TODO.md` because they need model access and selected release tasks.
- **Bloat in agent-facing docs.** `Instructions_for_agents.md` is hard-capped under 100 lines; doc-sync test enforces.

## What v4 delivers (vs. earlier drafts)

- **Determinism is structural and verified cross-process** — not a seed apparatus. The seed/RNG/clock machinery and the font-metric table are *removed* (they did nothing).
- **Mutation for all twelve renderable families** (flowchart/state, sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, gantt), family-narrowed overloads, compile-time rejection of opaque/source-only fallback bodies.
- **Sequence parsing is lossless** — segment-preserving structured body (BUILD-18): Note/alt/loop/etc. ride along verbatim as opaque-block segments while the structured ops stay live; only un-segmentable input falls back to whole-body opaque; never silently drops constructs.
- **Substrate enforcement is a real grep test** that runs under `bun test`, not an ESLint config that was never installed.
- **`synthesizeFromGraph`** lets `am parse | am serialize` round-trip without `canonicalSource` on the wire.
- **`LABEL_OVERFLOW` is a rendered-line char-count check** (Tier 1, reliable), not a font-metric heuristic: the cap applies to the longest displayed line (XML entities decode, `<br>` splits lines, formatting tags strip), not raw source chars.
- **`Finite` branded type** enforced at every coordinate emission.
- **Deliverable completeness:** CHANGELOG entry, README section, an `examples/` script, per-verb CLI `--help`, and a [`docs/fork-differences.md`](./docs/fork-differences.md) mention all ship with the code.
- **Test honesty:** the tautological seed-variance test is gone; a fault-injection pass proves the suite has teeth.

---

## What Code Mode unlocks

The Code Mode MCP raises the ceiling on what an agent can do with the library in one call. We initially framed the agent surface as a fixed set of verbs (parse, verify, mutate, serialize) where each verb is one round-trip. Code Mode reframes the surface as a typed library that the agent composes against — and the only thing we ship is the small set of primitives plus a sandbox. The agent supplies the algorithm.

Concrete consequences, in roughly descending impact:

1. **Composition without shipping composition.** `@include`, `@template`, vars/`${}` are deferred indefinitely. An agent can implement its own splice or template flavor in JavaScript over source strings and SDK-returned parsed diagrams — parse trusted inputs, use supported `mutate` operations, verify, serialize — in one round-trip. Code Mode does not bless hand-fabricated `ValidDiagram` clones; structured edits stay on SDK lineage.
2. **Multi-diagram repo operations.** "Rename `AuthService` across every architecture diagram in this repo, verify each, and report which now have warnings." With verb-per-tool MCP that's `N × 3` round-trips. With Code Mode: host/agent code supplies the file list and source strings, and one `execute()` can process them together. The sandbox itself does not expose filesystem access.
3. **Auto-fix loops in one round-trip.** `verify` → identify mechanically fixable warnings → apply fixes → `verify` again, as a `while (!result.ok)` block. The agent only sees the final state plus a structured audit trail.
4. **Diagram-as-tests / CI gate.** A repo installs `agentic-mermaid`, runs the `agentic-mermaid-mcp` binary, and writes a Code Mode snippet that verifies every `.mmd` on push. Diagrams become test artifacts that fail CI when they break.
5. **No need to ship `diffDiagrams` or `explainDiagram`.** Already cut. Code Mode confirms the cut: an agent that wants structural diff writes it from `parse` + `ValidDiagram` inspection in JavaScript. Every "would be nice to have a verb for" becomes "write the code for it in `execute()`."
6. **Library as the cross-tool agent interface for diagrams.** A Mermaid linter, a `mermaid → d2` converter, a `graphviz → mermaid` importer can each expose the same Code Mode shape. Any agent then writes one JavaScript snippet that composes across libraries. We've effectively defined the agent interface for diagrams in this language.
7. **Benchmark eval at speed.** MermaidSeqBench (and any future eval) runs as one `execute()` per case rather than N round-trips. Internal velocity multiplier.
8. **Potential future hosted-Worker path.** Cloudflare-hosted Agentic Mermaid is tracked as `TODO.md` BUILD-4. The repo now ships a static Workers Static Assets website under `website/`, but a hosted MCP/Code Mode wrapper remains separate. That wrapper could use `@cloudflare/codemode` + `DynamicWorkerExecutor` only after the security boundary, auth/rate limits, persistence, and CLI/MCP/library parity are scoped. The current repo does not ship that dependency or runtime; JavaScript snippets plus a TypeScript-shaped SDK declaration are the reusable design idea, not a current hosted execution deployment.
9. **The skill becomes runnable, not just descriptive.** `references/code-mode.md` ships canonical executable JavaScript snippets the agent copy-pastes into `execute()`. Skill stops being prose; starts being a library of executable patterns.
10. **A future diagram REPL would be a thin transport.** An `am repl` could become an interactive Code Mode shell — paste JavaScript, get structured results, iterate. Same sandbox, different transport. It is not shipped and would need promotion to `TODO.md` before implementation.

The biggest single consequence is #1: it gives us permission to never grow the spec for composition, queries, diffing, explaining, or any "we should probably have a verb for that" feature. **The verb set is intentionally small; Code Mode makes it sufficient.**

### Counter-example: why we did not ship a `render-tool-per-format` MCP

Upstream [manuareraa PR #42](https://github.com/lukilabs/beautiful-mermaid/pull/42) takes the opposite design: an MCP server with one tool per output format (`render_svg`, `render_ascii`, `render_png`, etc.), each pinned to a specific renderer call. We considered cloning that surface and decided against it for two reasons. First, the verb explosion is unbounded — every new output format means a new tool, every option flag means a new tool variant, and every cross-cutting workflow (parse → verify → render → write back) requires the agent to glue tools together via the host's tool-call protocol, multiplying round-trips. Second, the per-tool typing pushes structure into the tool schema where the agent can only see what the schema declares; it can't introspect `ValidDiagram`, can't compose `mutate` with `verify`, and can't write the algorithm that uses the answer. Code Mode inverts both: one `execute` tool with a typed `mermaid.*` SDK declaration in scope. Read-only inspection, cross-diagram lookups, and custom transforms are ordinary JavaScript inside that execution context rather than additional MCP tools. Anything PR #42's surface could do — render-to-format with options — is one line of JavaScript inside `execute`; anything our surface can do that PR #42's can't includes every multi-step workflow that touches more than one verb. The asymmetry justifies the cut.

---

## Why totality matters

Each property alone leaves a gap. Determinism alone — agents can diff outputs but can't edit without regenerating. Round-trip alone — every edit shuffles the layout, drowning the signal. Verify alone — outputs aren't reproducible across runs, so a warning fixed in one run silently returns in the next.

Together they close a loop:

1. Parse the source into `ValidDiagram`.
2. `mutate` one node — the IR guarantees the edit produces valid Mermaid.
3. `verify` — structured warnings tell the agent whether anything broke.
4. If broken, back up to the previous `ValidDiagram` and try a different op.
5. `serializeMermaid` only after verify passes.

That loop is the agent-native claim. Replacing several rounds of vision-on-PNG with one structured verification pass is what makes a coding agent reach for this fork before any other Mermaid library.

The API makes the loop possible. `Instructions_for_agents.md` and `am --agent-instructions` make it a habit. Both ship together.
