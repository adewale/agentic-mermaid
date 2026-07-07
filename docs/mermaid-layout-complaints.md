# Mermaid layout complaints: catalog, root causes, and coverage

This document maps what users actually complain about in Mermaid's layout →
why those failures happen → which Agentic Mermaid work addresses each one
(landed, specced, or deliberately out of scope). It is the durable version of
a June 2026 research pass and should be updated when complaint-relevant work
lands.

Companions:

- [`issue-derived-test-cases.md`](./issue-derived-test-cases.md) — fixture-level
  coverage map for specific upstream issues.
- [`quality.md`](./quality.md) — the project's definition of "good looking" and
  its metric gates.
- [Issue #25](https://github.com/adewale/agentic-mermaid/issues/25) and
  [issue #26](https://github.com/adewale/agentic-mermaid/issues/26) — the
  principled routing/contract specs that several entries below point into.
- [PR #24](https://github.com/adewale/agentic-mermaid/pull/24) — the Gantt
  spec and implementation, the model for chart-family layout contracts.
- [Issue #41](https://github.com/adewale/agentic-mermaid/issues/41) — the
  diagram-family citizenship matrix that now keeps supported families honest
  about parser, serializer, renderer, verifier, and test obligations.

Method: complaint evidence was gathered in June 2026 from the
`mermaid-js/mermaid` tracker (reaction counts "R" are as of that date), Hacker
News, Reddit, comparison blogs, and Mermaid's own documentation. Root-cause
evidence comes from the graph-drawing literature, competing products'
documentation, diagram interchange standards, and the recorded history of the
three codebases this project descends from (Mermaid, `mermaid-ascii`,
`beautiful-mermaid`).

Status legend used below:

| Status | Meaning |
|---|---|
| **landed** | shipped in this repo with tests |
| **partial** | some of the complaint class is covered, the rest is not |
| **specced** | designed in #25/#26/PR #24 with acceptance criteria, not implemented |
| **out of scope** | deliberately not addressed; the reason is stated |

---

## Part 1 — The complaint catalog

Thirteen recurring complaint classes, ordered roughly by loudness. Each entry
names its root causes (`R1`–`R5`, defined in Part 2) and its fixture/test
coverage in this repo.

### C1. No manual positioning

Mermaid is auto-layout only: no coordinates, no pinning, no post-hoc nudge.
When the engine makes a bad call, the sanctioned workaround is invisible
`~~~` links — Mermaid's own docs describe them as the way "to alter the
default positioning of a node," and GitLab maintains a handbook page of such
tricks. This is the loudest and oldest theme.

- Evidence: [mermaid#270](https://github.com/mermaid-js/mermaid/issues/270)
  (11R, open since 2016),
  [mermaid#2483](https://github.com/mermaid-js/mermaid/issues/2483) (12R),
  [mermaid#5420 "Add positioning for elk layout renderer"](https://github.com/mermaid-js/mermaid/issues/5420)
  (47R, zero comments — pure demand). HN: "if you don't like the way the
  diagram is visually laid out there's not really an easy way to change it"
  ([41262756](https://news.ycombinator.com/item?id=41262756)).
- Root cause: R3 (missing control surface).
- Status here: **out of scope, by policy.** Issue #25 (open question 2)
  recommends against route/position hints: "Keep route intent inferred from
  semantics and author order unless Mermaid core standardizes hints," and
  syntax invention is a stated non-goal. The substitute is actuation through
  the agent loop: deterministic layout (`measureQuality`, `checkQuality`,
  `eval/layout-compare/`) makes bad layout *detectable*, typed mutation makes
  source restructuring cheap, and #25's route certificates would make
  detours *explained* — so a program can iterate where a human would drag a
  node. This substitutes for manual positioning; it does not provide it.

### C2. Layout collapses at scale

Past roughly 20–50 nodes: whitespace oceans, extreme aspect ratios, nodes
unreadably small once the diagram is fit to screen.

- Evidence: [mermaid#1984 "Massive whitespace"](https://github.com/mermaid-js/mermaid/issues/1984)
  (39R, open since 2021),
  [mermaid#3262](https://github.com/mermaid-js/mermaid/issues/3262),
  [mermaid#2807 "ER graphs tend to get REALLY wide"](https://github.com/mermaid-js/mermaid/issues/2807)
  (19R). HN: "more and more acres of white space"
  ([30781954](https://news.ycombinator.com/item?id=30781954)).
- Root cause: R1 (layered-algorithm sprawl), aggravated in Mermaid by R4
  (dagre, fixed spacing constants).
- Fixture/test: `whitespaceBalance` (5–55% band) and `aspectRatio` (0.2–5.0
  band) in `src/agent/quality.ts` flag both failure directions;
  `eval/layout-compare/` reports deltas corpus-wide. Generated 20/50/100-node
  flowchart corpora now assert finite aspect ratios and non-degenerate
  whitespace in `src/__tests__/agent-quality.test.ts`.
- Status here: **partial — detection only.** Nothing in the backlog improves
  large-graph compaction, and the source-order priority can *worsen* width:
  `docs/quality.md` documents the Auth Flow trade, and
  `src/__tests__/agent-auth-flow.test.ts` pins quality with a widened aspect
  band (`[0.2, 7]`) for exactly that reason. One candidate mitigation that
  needs no syntax invention: the standards-era answer to oversized charts
  was never better compaction but **decomposition** — ANSI X3.5/ISO 5807
  prescribe named on-page/off-page connectors to split a chart when it
  outgrows a page or lines would cross. The agent-loop analogue: when
  `checkQuality` flags an oversized diagram, propose or perform splitting
  into multiple linked diagrams through the existing mutation API. Mermaid
  has no continuation concept (users fake it with duplicated nodes), so
  this would be a differentiator rather than a compatibility surface.

### C3. Subgraphs: direction ignored, titles overlapped, clusters colliding

The most-reacted pure layout bug in Mermaid's tracker. `direction` inside a
subgraph is silently ignored the moment any inner node links outside —
documented as a limitation, unfixed since 2021. Titles get covered by nodes;
sibling clusters overlap.

- Evidence: [mermaid#2509](https://github.com/mermaid-js/mermaid/issues/2509)
  (189R, 50 comments),
  [mermaid#3806 title overlap](https://github.com/mermaid-js/mermaid/issues/3806)
  (54R), [mermaid#4990 cluster overlap](https://github.com/mermaid-js/mermaid/issues/4990)
  (32R), [mermaid#287](https://github.com/mermaid-js/mermaid/issues/287) (29R).
- Root cause: R1 (compound layout is genuinely hard), R4 (dagre's cluster
  support is weak; title boxes not reserved during layout).
- Fixture/test: `src/__tests__/subgraph-direction.test.ts` pins SVG geometry
  for `direction TB` inside an LR flowchart *with an external link to an
  inner node* — the exact mermaid#2509 case — plus ASCII one-row inner LR
  layout, and container edges attaching to the subgraph border without
  phantom node boxes (BUILD-14), in both Unicode and 7-bit ASCII, nested,
  labeled/styled, and multi-edge variants. Group titles reserve layout space
  via the header-aware `elk.padding` in `src/layout-engine.ts`; breaches are
  a Tier 1 `GROUP_BREACH` warning.
- Status here: **landed** (PRs #17, #21, #22). Residual: cross-hierarchy and
  container-edge *route classes* — making the SVG router treat boundary
  edges semantically rather than via representative children — are specced
  (#25 §8.3, #26 workstream 2).

### C4. Erratic edge routing: avoidable crossings, overlaps, doglegs

Edges cross when they obviously need not, overlap each other or pass through
nodes, and acquire small unexplained doglegs ("hitches"). Users untangle by
trial-and-error reordering of source lines.

- Evidence: [mermaid#6476 "Unnecessary crossing"](https://github.com/mermaid-js/mermaid/issues/6476),
  [mermaid#5601 planar graphs rendered non-planar](https://github.com/mermaid-js/mermaid/issues/5601),
  [mermaid#1006](https://github.com/mermaid-js/mermaid/issues/1006) ("it often
  really handles edges in an erradic way" — closed *Wont Fix*),
  [mermaid#5060](https://github.com/mermaid-js/mermaid/issues/5060),
  [mermaid#2792 edges overlap boxes](https://github.com/mermaid-js/mermaid/issues/2792).
- Root cause: R1 (crossing minimization is NP-hard, solved per-layer by
  heuristic; routing is a late phase that cannot revisit placement), R4
  (dagre routes splines without obstacle avoidance), R5 (post-layout passes
  move geometry without rerouting).
- Fixture/test: the worked example is issue #25's login/MFA flow. Rendered
  with the current engine (June 2026, ASCII):

  ```
  | User |---->| Login Page |<No->| Valid Credentials? |-Yes>| MFA Enabled? |----No-->| Create Session |  Yes-+--| Code Valid? |
  ...                                                               |                         +-----No-------+         |
  ...                                                               +------Yes------>| Enter MFA Code |----------------+
  ```

  `F --> G` (`Code Valid?` → `Create Session`) runs backwards; the `No`
  feedback loops read ambiguously inline. Yet `verifyMermaid` returns
  `ok: true` with zero warnings, and every perceptual metric passes except
  aspect ratio (6.23 vs the 5.0 band): `edgeCrossings: 0`,
  `labelLegibility: 1`. That is the measured gap between today's generic
  metrics and the visible failure — the gap #25/#26 exist to close.
  Current coverage: `edgeCrossings` gate (≤5% of edge pairs),
  `ROUTE_SELF_CROSS` Tier 2 warning, edge-vs-node collision heuristics in
  `src/__tests__/layout-quality-heuristics.test.ts`, deterministic FIFO A*
  tie-breaking in the ASCII pathfinder
  (`src/__tests__/ascii-pathfinder-determinism.test.ts`).
- Status here: **partial today, with the route-contract core landed and the
  broader program still specced.** #25 defines route classes
  (`primary-forward`/`feedback`/fan trunks/…), the straight-primary and
  hitch invariants (§11.1–11.2), the certifying simplifier (§12), and the
  hard rule "no node-coordinate mutation after route extraction unless all
  incident routes are rerouted or recertified" (§9). The current tests now
  include route-certificate geometry and property coverage across dotted,
  thick, bidirectional, marker, and labeled edge forms. Remaining work lives
  in the still-open route/port issues (#32, #35, #38 and the #26 umbrella),
  plus cross-renderer adoption.

### C5. Edge labels overlap edges, nodes, and each other

Mermaid places labels at edge midpoints with no collision handling: labels
sit on other edges, get struck through by their own line, or detach from the
edge they describe.

- Evidence: [mermaid#490](https://github.com/mermaid-js/mermaid/issues/490)
  (2017 — labels struck through by their own edge, asking for "integrated
  logic which tries to avoid lines going over the texts": literally the
  integrated-labeling concept yFiles ships, see R3),
  [mermaid#2131 mis-aligned state labels](https://github.com/mermaid-js/mermaid/issues/2131),
  [mermaid#2525 "messages appear with line through them"](https://github.com/mermaid-js/mermaid/issues/2525),
  [mermaid#7492 C4 label/text/arrow chaos](https://github.com/mermaid-js/mermaid/issues/7492),
  [mermaid#1233](https://github.com/mermaid-js/mermaid/issues/1233).
- Root cause: R1 (label placement is NP-hard and classically solved *after*
  layout; dagre models labels as mid-edge dummy nodes), R4/R5 (renderers do
  not collision-check label boxes afterwards).
- Fixture/test: this engine passes edge labels into layout as first-class
  inline ELK labels (`elk.edgeLabels.inline: 'true'`,
  `src/layout-engine.ts`), so they reserve space instead of being overlaid;
  `labelEdgeProximity` (≥4px to any non-attached node, other edge-label
  box, or other edge path) gates regressions in the graph families, and the
  2026-07 overlap audit added a cross-family occlusion gate
  (`eval/overlap-audit` + `label-overlap-gate.test.ts`: curated corpus at
  zero label/box overlap findings, per-family fuzz ratchets) after finding
  label collisions the proximity metric alone had missed in five families.
  ASCII branch labels are pinned to sibling branch segments, not shared
  trunks: `src/__tests__/ascii-fanout-trunk-labeled.test.ts`,
  `ascii-pathfinder-trunk.test.ts`, plus exact goldens under
  `src/__tests__/testdata/{ascii,unicode}/`.
- Status here: **partial.** Landed: label-aware layout + proximity gate +
  ASCII branch-label placement. Specced: the label invariant (#25 §11.4 —
  labels are obstacles *and* capacity constraints; trunks may not host
  per-sibling labels) and label-capacity checks before straightening (§12).

### C6. No rank/order control; tiny edits reshuffle the diagram

Users cannot say "these two nodes at the same level" or "keep my declared
order," and adding one edge can scramble a previously good layout — which
also makes diagrams churn across edits.

- Evidence: [mermaid#3723 same-rank request](https://github.com/mermaid-js/mermaid/issues/3723)
  (86R — the most-upvoted open layout-control ask),
  [mermaid#815 "Maintain the order of the nodes"](https://github.com/mermaid-js/mermaid/issues/815)
  (45R), [mermaid#2834](https://github.com/mermaid-js/mermaid/issues/2834),
  [mermaid#6527 "flowchart-elk … reshuffled every time you add a node"](https://github.com/mermaid-js/mermaid/issues/6527).
- Root cause: R3 (no constraint surface) over R1 (layered layouts are
  input-order sensitive unless order is made an explicit objective).
- Fixture/test: source order *is* the constraint surface here:
  `elk.layered.considerModelOrder.strategy: NODES_AND_EDGES`,
  `cycleBreaking.strategy: MODEL_ORDER`, and
  `crossingMinimization.forceNodeModelOrder: true`
  (`src/layout-engine.ts`) make author order the layout's primary input.
  `src/__tests__/agent-auth-flow.test.ts` asserts the primary LR chain stays
  in source order (`A < B < … < H` by x-center) and feedback edges route
  backwards — the mermaid#5227 "backwards arrows" class. Edit stability is
  the determinism guarantee plus typed mutation: a one-op change re-lays-out
  as a pure function of the new source
  (`src/__tests__/agent-determinism.test.ts`). The same file now pins
  edit-stability for small source mutations: label edits, inserted nodes,
  appended leaves, style-only changes, and feedback-edge additions must
  preserve the left-to-right order of the unchanged primary chain.
- Status here: **partial.** Landed: deterministic source-order layout (the
  practical answer to #815/#6527). Not offered: an explicit same-rank
  constraint (#3723's literal ask) — that is C1's policy decision again.
  Graphviz has had `rank=same` since the 1990s (see R3); if Mermaid core
  ever standardizes an equivalent, this fork's policy is to follow, not
  invent.

### C7. "It's just ugly": dated default aesthetics

An aesthetic judgment independent of geometric correctness: default colors,
shapes, curves, and contrast read as dated next to D2 or hand-drawn
diagrams; some embeddings are unreadable (dark-theme contrast).

- Evidence: HN "why does it have to be so ugly"
  ([30339032](https://news.ycombinator.com/item?id=30339032)); "Both PlantUML
  and Mermaid mostly produce (Mermaid more) ugly-looking diagrams"
  ([33704875](https://news.ycombinator.com/item?id=33704875));
  [Cursor forum on unreadable contrast](https://forum.cursor.com/t/mermaid-diagrams-are-hard-to-read-poor-contrast/153850).
- Root cause: R5 (renderer/theming defaults, not the layout algorithm).
  Mermaid's v11 `handDrawn`/`neo` "looks" are its own remediation.
- Fixture/test: inherited from upstream Beautiful Mermaid: two-color theme
  derivation, 21 built-in themes, Shiki/VS Code theme compatibility. Fork
  additions: semantic role styling (`style.node/edge/group/text`),
  Tufte/Salmon theme families (PR #10), auto-contrast on custom fills
  (upstream #115 class) pinned by
  `src/__tests__/renderer-contrast.test.ts`.
- Status here: **landed** (largely upstream's credit; see
  [`comparison.md`](./comparison.md)).

### C8. Text clipped, overflowing, or hand-wrapped

Node boxes don't reliably fit their text. In Mermaid the classic causes are
HTML labels in `foreignObject` (SVG exports drop them), browser font metrics
at layout time, and no width budget for CJK/long words.

- Evidence: [mermaid#58](https://github.com/mermaid-js/mermaid/issues/58)
  ("Generated SVG works poorly outside web browsers" — opened December
  2014, six weeks after Mermaid's first release, still open),
  [mermaid#2688 foreignObject](https://github.com/mermaid-js/mermaid/issues/2688)
  (24R), [mermaid#790](https://github.com/mermaid-js/mermaid/issues/790),
  [mermaid#4918](https://github.com/mermaid-js/mermaid/issues/4918),
  [mermaid#7359 Korean clipped on export](https://github.com/mermaid-js/mermaid/issues/7359);
  GitLab converted diagrams to tables rather than fight it
  ([gitlab#583608](https://gitlab.com/gitlab-org/gitlab/-/issues/583608)).
- Root cause: R5 (browser-first text pipeline), R2 for the ASCII lineage
  (`string.length` width assumptions on fullwidth text).
- Fixture/test: structurally avoided here — text is plain SVG `<text>`
  measured by deterministic metrics (`src/text-metrics.ts`), never
  `foreignObject`; PNG embeds pinned fonts (DejaVu default plus the built-in style faces) so rasterization cannot
  font-substitute. Guards: Tier 1 `LABEL_OVERFLOW`, `labelLegibility` ≥85%
  gate, CJK fullwidth handling
  (`src/__tests__/ascii-cjk-width.test.ts`, upstream #119 class), ER/class
  label truncation fixes with exact goldens (upstream #121 class,
  `er-integration.test.ts`, `class-integration.test.ts`).
- Status here: **landed**, with an honest gap: the 7px/char SVG heuristic is
  approximate (`docs/quality.md`), and the shared text-measurement contract
  that would unify SVG/ASCII/quality measurement (CJK, emoji, ambiguous
  width) is specced as #26 workstream 8. Regression coverage now includes
  emoji-presentation selectors and East Asian ambiguous-width symbols, so
  common Unicode labels cannot silently drift between SVG metrics and
  terminal-width assumptions.

### C9. Stuck on dagre; ELK bolted on as an escape hatch

The meta-complaint: Mermaid's default engine is dagre — widely described as
abandoned — and the community's fix (ELK) is opt-in, a separate package,
unavailable in GitHub's native rendering, and not itself a cure-all.

- Evidence: "Dagre is pretty good but I think ELK is better and Dagre has
  been abandoned"
  ([r/programming](https://www.reddit.com/r/programming/comments/z1qoxc/d2_is_now_open_source_a_new_modern_language_that/ixlwqce/));
  Mermaid docs: "The elk renderer is better for larger and/or more complex
  diagrams" ([flowchart docs](https://mermaid.js.org/syntax/flowchart.html));
  HN: "the layout renderer is pretty bad … the layout algorithm is so bad"
  ([41277795](https://news.ycombinator.com/item?id=41277795)).
- Root cause: R4.
- Status here: **landed structurally.** ELK layered is this engine's only
  graph layout (synchronous bundled `elkjs`, `src/elk-instance.ts`), with
  pinned options (`src/layout-engine.ts`) and #25 §10 as the documented
  option policy — node placement is Brandes–Köpf, the same default
  Mermaid's own ELK package exposes via `nodePlacementStrategy`, so
  opting into `flowchart-elk` in Mermaid lands on the placement family this
  engine uses by default. Two honest caveats: (1) ELK is not a panacea — upstream
  #83 (TD flowcharts flipping horizontal) was *ELK cycle-breaking* behavior,
  countered here by model-order options; (2) none of this changes what
  GitHub/GitLab render natively (see Part 4).

### C10. Self-loops and back-edges render awkwardly

A node linking to itself draws a kinked doubled-back path; loops in flows
take long unexplained detours.

- Evidence: [mermaid#6336](https://github.com/mermaid-js/mermaid/issues/6336)
  (31R; the issue contrasts Graphviz doing it "So much more natural"),
  [mermaid#6049](https://github.com/mermaid-js/mermaid/issues/6049) (11R —
  also a version regression: "pretty" in 11.0.2, "Ugly since 11.1.1").
- Root cause: R1/R4 (layered frameworks have no native self-loop concept;
  the route is synthesized late).
- Fixture/test: ASCII self-loops currently render compactly (verified June
  2026: `B --> B` draws a tight two-cell side loop). `ROUTE_SELF_CROSS`
  (Tier 2) and self-loop clearance heuristics
  (`layout-quality-heuristics.test.ts`) guard regressions. SVG self-loop
  port policy (N/S side by clearance) is #25 §8.1; mermaid#6049 is listed as
  a future fixture in [`issue-derived-test-cases.md`](./issue-derived-test-cases.md).
- Status here: **partial** (ASCII decent + guarded; SVG semantics specced).

### C11. Unstable output across versions and renderers

The same source renders differently in the live editor, CLI, GitHub, and
Obsidian, and upgrades silently regress committed diagrams.

- Evidence: [mermaid#5813 v11 regression](https://github.com/mermaid-js/mermaid/issues/5813)
  (28R), [mermaid#1485 live editor vs CLI](https://github.com/mermaid-js/mermaid/issues/1485),
  [mermaid#5969 editor silently uses ELK](https://github.com/mermaid-js/mermaid/issues/5969),
  [gitlab#583608](https://gitlab.com/gitlab-org/gitlab/-/issues/583608),
  [Obsidian forum "Mermaid arrows are a mess"](https://forum.obsidian.md/t/mermaid-arrows-are-a-mess/104633).
- Root cause: R5 (browser/CSS/version-coupled rendering) plus R1 (layout
  sensitivity amplifies small engine changes into big visual diffs).
- Fixture/test: this is the fork's categorical answer rather than a
  mitigation. Byte-identical output across runs, processes, and runtimes is
  CI-gated (`agent-determinism.test.ts`); ASCII output is hash-stable across
  the full 271-entry docs corpus (`ascii-determinism.test.ts`); PNG bytes
  are pinned via exact-version resvg + bundled fonts
  (`agent-png-determinism.test.ts`). Intentional layout changes must pass
  the before/after comparison harness (`eval/layout-compare/`,
  regressions-first verdicts) and update exact goldens — so every visual
  change is deliberate, evidenced, and reviewed.
- Status here: **landed.** No Mermaid-syntax renderer we know of makes this
  guarantee.

### C12. Sequence-diagram alignment and overlap

Sequence diagrams (bespoke layouter in Mermaid, not dagre) have their own
class: uncontrollable/overlapping activations, off-center `alt`/`loop`
titles, notes colliding with lifelines.

- Evidence: [mermaid#1765 activations](https://github.com/mermaid-js/mermaid/issues/1765)
  (28R), [mermaid#3216](https://github.com/mermaid-js/mermaid/issues/3216),
  [mermaid#7651](https://github.com/mermaid-js/mermaid/issues/7651),
  [mermaid#7682](https://github.com/mermaid-js/mermaid/issues/7682).
- Root cause: R5 (hand-rolled per-family geometry, no shared invariants) +
  R3 (no spacing overrides).
- Fixture/test: layout geometry tests exist
  (`src/__tests__/sequence-layout.test.ts`, `ascii-sequence-blocks.test.ts`)
  and the sequence `RenderedLayout` adapter feeds the generic metrics.
  Sequence property coverage now checks activation spans, note stacking and
  bounds, and block/divider containment/non-overlap geometry over generated
  activation/note/block combinations. The broader productized verifier set
  — lifeline x-order, message y-order, activation span containment, and
  note/block containment as user-facing warnings — remains #25 §14.2 and
  #26 workstream 11.
- Status here: **partial, with first family-specific properties landed.**

### C13. Chart families: hard-coded geometry breaks on real data

Gantt axis dates overlap on long ranges, pie titles/labels clip, radar axis
labels compress, C4 is widely considered the worst-layouted type. These are
not dagre problems — each chart type has bespoke geometry with no collision
handling.

- Evidence: [mermaid#1301 gantt axis overlap](https://github.com/mermaid-js/mermaid/issues/1301)
  (23R), [mermaid#6232 pie title cut off](https://github.com/mermaid-js/mermaid/issues/6232),
  [mermaid#7683 radar labels clipped](https://github.com/mermaid-js/mermaid/issues/7683),
  [mermaid#7492 C4](https://github.com/mermaid-js/mermaid/issues/7492).
- Root cause: R5 (per-family renderer-first geometry; semantics inferred at
  draw time — the exact anti-pattern #26's guiding principle names).
- Fixture/test: pie and quadrant landed source-level with geometry tests
  (PR #22; quadrant point placement verified against the upstream Mermaid
  reference). Gantt is now implemented from PR #24's principled model — a
  pure, clock-free schedule resolver *before* layout, family validators
  (deterministic task intervals, milestone zero-width markers,
  non-overlapping compact rows) designed against precisely the mermaid#1301
  class. C4, radar, and mindmap are not supported at all.
- Status here: **partial** (pie/quadrant/gantt landed; C4/radar/mindmap
  absent — see [`comparison.md`](./comparison.md) for the current
  family-coverage trade).

---

## Part 2 — Root causes

Five root causes explain the catalog. R1–R3 apply to every auto-layout
text-to-diagram tool, including this one; R4–R5 are specific lineages.

### R1. The layered framework solves NP-hard problems in irreversible phases

Every engine in this story — dagre, ELK, dot — descends from the layered
method of
[Sugiyama, Tagawa & Toda 1981](https://doi.org/10.1109/TSMC.1981.4308636)
(IEEE Trans. SMC-11(2)), extended since into the standard pipeline: break a
directed graph drawing into sequential phases (cycle removal → layer
assignment → crossing minimization → coordinate assignment → edge
routing). The framework is powerful and is the right baseline for flow-like
diagrams, but it has three structural consequences users experience
directly:

1. **The subproblems are intractable, so every phase is heuristic.**
   Crossing number is NP-complete
   ([Garey & Johnson 1983](https://dl.acm.org/doi/10.1137/0604033), SIAM
   J. Alg. Disc. Meth. 4(3)); crossing minimization stays NP-complete even
   for two layers with one layer's order already fixed
   ([Eades & Wormald 1994](https://link.springer.com/article/10.1007/BF01187020),
   Algorithmica 11(4)) — the exact subproblem inside every layered engine;
   label placement is NP-complete even in simple variants
   ([Marks & Shieber 1991](https://dash.harvard.edu/entities/publication/73120379-247a-6bd4-e053-0100007fdf3b),
   Harvard TR-05-91), and edge-label placement specifically is NP-hard
   ([Kakoulis & Tollis 2001](https://www.sciencedirect.com/science/article/pii/S0925772100000250),
   Comput. Geom. 18(1)). No engine "chooses" the avoidable crossing in
   C4 — it fails to find the better optimum it cannot afford to search for.
2. **Phases cannot revisit earlier decisions.** Layering fixes ranks before
   crossing minimization sees them; coordinates are assigned before routing.
   A route that needs a node nudged one lane over cannot get it. This is
   the literature's own characterization of the framework's failure mode —
   "decisions made at previous steps influence later steps and yet cannot
   be undone"
   ([Healy & Nikolov, *Handbook of Graph Drawing and Visualization* ch. 13](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf));
   "since layer assignment and crossing reduction are realized as
   independent steps, the resulting drawing might have many unnecessary
   crossings caused by an unfortunate layer assignment"
   ([Chimani, Gutwenger, Mutzel & Wong, JGAA 15(1), 2011](https://jgaa.info/index.php/jgaa/article/view/paper220/2748)).
   It is why locally-reasonable pipelines emit globally wrong results — the
   "hitch" of issue #25 is a phase-boundary artifact, and #25 §2 names it a
   *contract failure*: nothing in the pipeline encodes "this edge should be
   straight when its lane is clear" as an invariant any phase must preserve.
3. **Labels and shapes are afterthoughts in the classic formulation.**
   Labels enter as dummy nodes or post-hoc annotations (C5); non-rectangular
   shapes are approximated by their bounding boxes until a final clipping
   pass (#25 principle 6).

Empirical work confirms users are right to care:
[Purchase 1997](https://link.springer.com/chapter/10.1007/3-540-63938-1_67)
(Graph Drawing, LNCS 1353) found reducing edge crossings "by far the most
important" aesthetic for human comprehension, with bend minimization also
significant — exactly the two artifacts the phase structure produces.
Compound (subgraph) layout multiplies the difficulty: nested clusters with
cross-cluster edges constrain layering and crossing minimization
simultaneously
([Sander 1996](https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf),
TR A/03/96, Universität des Saarlandes), which is why C3 is hard for
everyone — and weak cluster handling is dagre's most visible gap (open for
years in its own tracker:
[dagre#125](https://github.com/dagrejs/dagre/issues/125),
[dagre#238](https://github.com/dagrejs/dagre/issues/238)).

### R2. Greedy per-edge grid routing in the ASCII lineage

[`mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii)
(Alexander Grooff, Go) works in three stages — parse, map components onto a
character grid, route each edge independently by pathfinding — and this
repo's ASCII engine is a TypeScript port of it
(`src/ascii/edge-routing.ts` is "ported from
AlexanderGrooff/mermaid-ascii cmd/direction.go + cmd/mapping_edge.go").
Per-edge greedy routing with no shared intent produces the ASCII-specific
complaint classes visible in both trackers: in the original,
single-edge-per-node-pair limits, floating arrowheads on labeled
back-edges, and East Asian width breakage
([mermaid-ascii#56](https://github.com/AlexanderGrooff/mermaid-ascii/issues/56),
[#63](https://github.com/AlexanderGrooff/mermaid-ascii/issues/63),
[#59](https://github.com/AlexanderGrooff/mermaid-ascii/issues/59)); in
this lineage, equal-cost path nondeterminism, labels landing on shared
detours instead of their own branch (upstream #111/#112), fan-in groups
merging into ambiguous trunks (#68/#69), connectors floating off node
borders, phantom boxes for subgraph-id endpoints, and fullwidth/CJK text
breaking column math (#119, #121) — inherited and then fixed here
case-by-case. The durable fix is the same as for R1: route intent shared
across edges before geometry (#25 §13 — ASCII consumes route classes;
trunks, reserved feedback channels, label capacity).

### R3. Layout is authored content everywhere except text-to-diagram tools

The standards world treats positions as part of the artifact:
[OMG Diagram Definition](https://www.omg.org/spec/DD/) distinguishes
"graphical information … users have control over, such as position of
nodes and line routing points," which is "captured for interchange between
tools," from styling fixed by the notation — and its predecessor UML DI
spec states the failure mode plainly: without diagram interchange, "all
diagram information is lost" when a model moves between tools. BPMN DI is a
normative part of BPMN 2.0
([ISO/IEC 19510](https://www.iso.org/standard/62652.html)): "the
interchange of laid out shapes and edges," carrying shape bounds and edge
waypoints. UML 2.5 normatively defines notation but is silent on layout,
delegating persistence to the DD-based UML DI annex. Even drafting
conventions were standardized:
[ANSI X3.5-1970 §4.4.1](https://www.bitsavers.org/pdf/ansi/X3/X3.005-1970_Flowchart_Symbols_and_Their_Usage_in_Information_Processing.pdf)
is normative that "normal direction of flow is from left to right and top
to bottom," with arrowheads *required* only on reverse-direction lines —
and its successor [ISO 5807:1985](https://www.iso.org/standard/11955.html)
keeps the conditional-arrowhead rule (§9.3.1: "solid or open arrowheads
shall be added to indicate direction of flow where necessary (see
10.2.1.2)"; clause 10 "Conventions" carries the direction rules). Issue
#25's primary-forward/feedback route classes are that half-century-old
convention, restated as a checkable invariant — and the same convention
family yields further validator candidates (unlabeled decision branches;
single-entry/labeled-exit analysis), tracked in
[`issue-derived-test-cases.md`](./issue-derived-test-cases.md).

Mature tools likewise expose constraint surfaces. Graphviz dot has had
[`rank=same`/`min`/`max`](https://graphviz.org/docs/attrs/rank/),
[compass-point ports](https://graphviz.org/docs/attr-types/portPos/)
(`a:port:nw -> b`), per-edge
[`constraint`](https://graphviz.org/docs/attrs/constraint/)/[`weight`](https://graphviz.org/docs/attrs/weight/)
knobs, and obstacle-avoiding spline routing
([`splines=true`: "edges are drawn as splines routed around nodes"](https://graphviz.org/docs/attrs/splines/))
since the 1990s. D2 ships [`near`](https://d2lang.com/tour/positions/)
(anchor a shape near a named other shape),
[grid diagrams](https://d2lang.com/tour/grid-diagrams/) for exact
row/column placement, and the architecture-tuned
[TALA engine](https://d2lang.com/tour/tala/) — "first-class consideration
for containers," position locking via `top`/`left`, per-container
direction, dynamic label positioning (and, honestly documented, its own
instability: a small label change "can cascade into an entirely different
layout"). yFiles distinguishes post-hoc "generic" labeling from
[*integrated* labeling computed during layout](https://docs.yworks.com/yfiles-html/dguide/layout/label_placement.html),
which "prevent[s] label overlaps completely."

Text-to-diagram tools deliberately drop that half of the artifact: source
in, geometry recomputed every render, nothing persisted, no constraints.
That is the actual root of C1 and C6 — not dagre. It is also a real trade
(zero-friction authoring, diffable sources, no stale coordinates), which is
why this project keeps the contract but changes who absorbs the cost: the
layout is a *deterministic function* of source (C6, C11), its quality is
*measurable* (`checkQuality`), and its decisions are to become
*explainable* (#25 certificates) — so an editing program gets back the
agency a human loses by not being able to drag nodes.

### R4. dagre: a partial dot port, frozen

Mermaid (2014, Knut Sveidqvist) was built browser-first on d3 + dagre-d3;
layout was delegated wholesale to dagre, Chris Pettitt's JavaScript
implementation of the Sugiyama/dot pipeline — a delegation Mermaid's
maintainer named himself when opening
[mermaid#867 "Support multiple layout algorithms"](https://github.com/mermaid-js/mermaid/issues/867)
in 2019: "Currently the layout mechanism mermaid is using is a dagre
algorithm."

What dagre ports — and what it omits — maps directly onto the catalog. The
dot paper
([Gansner, Koutsofios, North & Vo 1993](https://www.graphviz.org/documentation/TSE93.pdf),
IEEE TSE 19(3)) is a *four*-pass algorithm: ranking, ordering, coordinates,
then a spline-routing pass that computes piecewise-Bézier edges inside a
feasible region so they avoid node obstacles — the paper explicitly calls
out tools that "make no attempt to avoid situations where line segments
overlap unrelated nodes." dot also guarantees that edge labels, modeled as
virtual nodes, "never overlap other nodes, edges or labels," and exposes
rank constraints. dagre implements the first three passes (its coordinate
assignment is
[Brandes & Köpf 2001](https://link.springer.com/chapter/10.1007/3-540-45848-4_3),
in `lib/position/bk.js`) and then stops: there is no routing phase at all —
edges are interpolated through dummy-node points.
[dagre-d3#291](https://github.com/dagrejs/dagre-d3/issues/291) is the
user-visible result, and C4/C5 are the Mermaid-visible results. Cluster
support follows Sander/Forster on paper (per
[dagre's wiki](https://github.com/dagrejs/dagre/wiki)) but fails on nesting
and compound edges in practice
([dagre#125](https://github.com/dagrejs/dagre/issues/125),
[dagre#238](https://github.com/dagrejs/dagre/issues/238)) — C3. dot-style
rank constraints existed in early dagre, were dropped in the 0.7 rewrite,
and the restoration request —
[dagre#159 "Add back support for rank constraints"](https://github.com/dagrejs/dagre/issues/159)
— has been open since November 2014.

The "abandoned" framing needs one nuance. D2's engine-comparison page
states ["Unmaintained. Development stopped in 2018"](https://d2lang.com/tour/dagre/)
("battle tested (thanks to MermaidJS, which exclusively uses Dagre for its
flowcharts)"; cons include "makes some inexplicable edge routing decisions
occasionally"), and that was accurate for the era it described — but the
`@dagrejs` org resumed releases in 2023 (1.0.0 May 2023; 3.0.0 March 2026).
What has *not* changed is the feature picture: no routing phase, no ports,
rank constraints still unrestored after a decade, and Mermaid ships the
dormant `dagre-d3` line via the `dagre-d3-es` fork.

Mermaid's own remediations concede the diagnosis. The migration ask —
[mermaid#1969 "Migrate flowchart from dagre to elkjs"](https://github.com/mermaid-js/mermaid/issues/1969)
(2021: dagre draws "edges … through other blocks instead of around them")
— was answered by the maintainer himself with the experimental
`flowchart-elk` renderer in v9.4.0 (February 2023), then v11.0.0 (August
2024) made layout pluggable with ELK as the opt-in
[`@mermaid-js/layout-elk`](https://www.npmjs.com/package/@mermaid-js/layout-elk)
package ("better for larger and/or more complex diagrams," per its own
docs) — selected via frontmatter `config.layout`, and per the
[syntax reference](https://mermaid.js.org/intro/syntax-reference.html)
"currently … supported for flowcharts and state diagrams" only. The
edge-overlap ask
[mermaid#1006](https://github.com/mermaid-js/mermaid/issues/1006) was
closed *Wont Fix*. GitHub's native rendering still runs the dagre default —
so most readers see the unfixed engine (C2, C3, C4, C9), and even opted-in
users get the better engine for two of ~25 families. PlantUML made the
opposite bet decades earlier: it
[delegates class/state/component/usecase layout to Graphviz dot](https://plantuml.com/graphviz-dot),
inheriting dot's router and rank constraints along with its weaknesses.

This engine's answer is architectural: ELK layered
([Schulze, Spönemann & von Hanxleden 2014](https://www.sciencedirect.com/science/article/abs/pii/S1045926X13000943),
JVLC 25(2) — the port-constraint extension of Sugiyama) as the only graph
engine, bundled synchronously, with model-order options pinned so source
order drives cycle breaking and crossing minimization
([`considerModelOrder`](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html):
"preserves the order of nodes and edges in the model file if this does not
lead to additional edge crossings"; the backing paper is Domrös &
von Hanxleden, IVAPP 2022). ELK brings the port constraints
(`FIXED_SIDE`/`FIXED_ORDER`/`FIXED_POS`) that #25 §8 builds on and dagre
never had, plus compound layout and an optional libavoid-based
obstacle-avoiding router. It is not sufficient by itself: upstream #83
showed ELK's default cycle breaking flipping TD diagrams horizontal until
model order was enforced; ELK's own docs restrict what composes with
`INCLUDE_CHILDREN` hierarchy handling (which is why
`src/layout-engine.ts` falls back to `SEPARATE` when a subgraph overrides
direction); and ELK still knows nothing about *semantic* edge roles, which
is exactly the intent layer #25 adds.

### R5. Renderer-first semantics, in three generations

The recurring design flaw across all three codebases is the one #26's
guiding principle names: *the renderer is the first place semantics are
guessed.*

- **Mermaid (November 2014–):** born, per its own 0.1.0 README, to "avoid
  heavy tools like Visio" with "a simple markdown-like script language" —
  the design optimized authoring friction, not layout quality. Per-family
  Jison grammars feed per-family bespoke renderers (the sequence renderer
  uses no layout engine at all — hand-maintained vertical-position
  bookkeeping, hence C12); text is measured via the browser DOM with HTML
  labels in `foreignObject` — the C8 export-clipping family, first reported
  six weeks after the first release
  ([mermaid#58](https://github.com/mermaid-js/mermaid/issues/58), December
  2014, still open) — styling is coupled to page CSS, chart geometry is
  hard-coded per type with no collision handling (C13), and there is no IR
  contract between parse and render, so every embedder/version pair renders
  differently (C11).
- **`mermaid-ascii`:** grid geometry computed during drawing; labels and
  containers handled by local painter logic (R2).
- **`beautiful-mermaid` (Craft/Luki Labs, January 2026):** re-implemented
  rendering as synchronous zero-DOM TypeScript with bundled elkjs (run
  synchronously via a worker bypass, `src/elk-instance.ts`) — fixing C8 and
  the browser half of C11 — but kept lenient line-by-line regex parsers
  (the ER cardinality parser silently dropped valid relationships — upstream
  #124, fixed here in PR #17) and accumulated post-ELK geometry passes:
  layer alignment introduced in upstream v1.0.1 ("Layout quality
  improvements and layer alignment"), edge-point orthogonalization, and
  post-routing shape clipping. Each pass is locally reasonable; together
  they move geometry after routes are extracted, which is #25's diagnosed
  source of hitches and stale bends (§2, §9).

This fork's trajectory is the inversion of that flaw: parse to a typed
model, derive layout intent, compute geometry, certify, then render —
with renderers as projections of shared intent rather than the place where
intent is invented.

### Root causes → issue #26 workstreams

| Root cause | #26 workstream(s) |
|---|---|
| R1 phase separation, no invariants | WS1 layout-intent/certificates; WS4 certifying simplifier |
| R1 labels as afterthoughts | WS8 text-measurement contract; #25 §11.4 label invariant |
| R1 compound difficulty | WS2 route classes (`cross-hierarchy`, `container-edge`) |
| R2 greedy grid routing | WS6 ASCII/Unicode as first-class projections of route intent |
| R3 no control surface | WS14 analysis outputs (explain, don't invent syntax); #25 certificates |
| R4 rectangular/port-less model | WS3 semantic ports and shape-aware anchors |
| R5 renderer-first semantics | WS5 Gantt resolver model (landed); WS7 class/ER contracts; WS10 region tree; WS13 preservation ladder |
| Unreviewable visual change (meta) | WS12 reproducible before/after evidence |
| Generic metrics miss failures (meta, C4 worked example) | WS11 family-specific validators |

---

## Part 3 — Coverage scorecard

| # | Complaint | Loudest evidence | Status here | Key references |
|---|---|---|---|---|
| C1 | Manual positioning | mermaid#5420 (47R), #270 (2016–) | **out of scope** by policy | #25 OQ2; agent loop as substitute |
| C2 | Scale collapse | mermaid#1984 (39R) | **partial** (detection only) | `quality.ts` bands; `eval/layout-compare/` |
| C3 | Subgraphs | mermaid#2509 (189R) | **landed** | `subgraph-direction.test.ts`; PRs #17/#21/#22 |
| C4 | Erratic routing | mermaid#6476, #5601 | **partial**; fix **specced** | #25 §11–12; MFA worked example above |
| C5 | Edge-label overlap | mermaid#2131, #7492 | **partial** | inline ELK labels; `labelEdgeProximity`; #25 §11.4 |
| C6 | Order control / edit stability | mermaid#3723 (86R), #815 (45R) | **partial** | model-order ELK opts; `agent-auth-flow.test.ts`; edit-stability tests |
| C7 | Default aesthetics | HN 30339032 | **landed** (upstream + fork) | theming; role styles; contrast tests |
| C8 | Text clipping | mermaid#2688 (24R) | **landed** | zero-DOM text; `LABEL_OVERFLOW`; CJK tests; WS8 specced |
| C9 | dagre stagnation | Mermaid docs' own ELK advice | **landed** structurally | `layout-engine.ts`; `elk-instance.ts`; #25 §10 |
| C10 | Self-loops | mermaid#6336 (31R) | **partial** | clearance heuristics; #25 §8.1 specced |
| C11 | Version/renderer instability | mermaid#5813 (28R) | **landed** | determinism suite; `eval/layout-compare/`; goldens |
| C12 | Sequence alignment | mermaid#1765 (28R) | **partial**; first properties landed | #25 §14.2; #26 WS11; `sequence-layout.test.ts` |
| C13 | Chart-family geometry | mermaid#1301 (23R) | **partial** | PR #24 (gantt); pie/quadrant/gantt geometry tests |

---

## Part 4 — What this project deliberately does not address

Stated plainly so the scorecard cannot oversell:

1. **Manual positioning (C1).** The loudest single ask is answered with a
   substitute (deterministic + measurable + explainable auto-layout for
   editing programs), not a solution. If Mermaid core standardizes layout
   hints, this fork follows; it will not invent them (#25 non-goals).
2. **Large-diagram compaction (C2).** Detection exists; no compaction work
   is scheduled. Source-order priority can make wide diagrams wider — the
   Auth Flow aspect band in `agent-auth-flow.test.ts` is widened to 7
   because of it. The only candidate direction on record is the
   decomposition idea noted in C2, which sidesteps compaction rather than
   solving it.
3. **Reach.** Most complainers experience Mermaid through GitHub/GitLab/
   Notion native rendering, which no fork renderer can change. Work here
   applies to diagrams rendered through this stack (agent pipelines, CI,
   terminals, the editor) plus whatever is upstreamed per the
   [upstreaming strategy](./fork-differences.md#upstreaming-strategy).
4. **Family coverage.** 12 families vs Mermaid's ~25. Gantt is now rendered
   and characterized in this fork; C4/radar/mindmap and many other Mermaid
   families remain outside the current engine.
5. **Metric honesty.** Today's perceptual metrics pass diagrams whose
   routing is visibly wrong (C4 worked example). Until #25 certificates and
   #26 family validators land, `verify.ok` + `checkQuality` must not be
   read as "looks right" — `docs/quality.md` already says this; the MFA
   fixture proves it.

---

## Sources

Complaint evidence (June 2026): the `mermaid-js/mermaid` issues linked
inline above; Mermaid flowchart docs
(<https://mermaid.js.org/syntax/flowchart.html>); Hacker News items linked
inline; the GitLab handbook Mermaid-layout page
(<https://handbook.gitlab.com/handbook/tools-and-tips/mermaid/>);
diagrams.so's diagram-as-code comparison
(<https://diagrams.so/learn/diagram-as-code-comparison>).

Literature (all verified June 2026; venue/page details via dblp or
publisher pages):

- Sugiyama, Tagawa & Toda, "Methods for Visual Understanding of
  Hierarchical System Structures," IEEE Trans. SMC-11(2), 1981.
  <https://doi.org/10.1109/TSMC.1981.4308636>
- Garey & Johnson, "Crossing Number is NP-Complete," SIAM J. Algebraic
  Discrete Methods 4(3), 1983. <https://dl.acm.org/doi/10.1137/0604033>
- Eades & Wormald, "Edge crossings in drawings of bipartite graphs,"
  Algorithmica 11(4), 1994.
  <https://link.springer.com/article/10.1007/BF01187020>
- Marks & Shieber, "The Computational Complexity of Cartographic Label
  Placement," Harvard TR-05-91, 1991.
  <https://dash.harvard.edu/entities/publication/73120379-247a-6bd4-e053-0100007fdf3b>
- Kakoulis & Tollis, "On the complexity of the Edge Label Placement
  problem," Comput. Geom. 18(1), 2001.
  <https://www.sciencedirect.com/science/article/pii/S0925772100000250>
- Gansner, Koutsofios, North & Vo, "A Technique for Drawing Directed
  Graphs," IEEE TSE 19(3), 1993.
  <https://www.graphviz.org/documentation/TSE93.pdf>
- Brandes & Köpf, "Fast and Simple Horizontal Coordinate Assignment,"
  GD 2001, LNCS 2265.
  <https://link.springer.com/chapter/10.1007/3-540-45848-4_3> (authors'
  2020 erratum: <https://arxiv.org/abs/2008.01252>)
- Schulze, Spönemann & von Hanxleden, "Drawing layered graphs with port
  constraints," JVLC 25(2), 2014.
  <https://www.sciencedirect.com/science/article/abs/pii/S1045926X13000943>
- Domrös & von Hanxleden, "Preserving Order during Crossing Minimization
  in Sugiyama Layouts," IVAPP 2022.
  <https://www.scitepress.org/Papers/2022/108338/108338.pdf>
- Purchase, "Which aesthetic has the greatest effect on human
  understanding?", GD 1997, LNCS 1353.
  <https://link.springer.com/chapter/10.1007/3-540-63938-1_67>
- Sander, "Layout of Compound Directed Graphs," TR A/03/96, Universität
  des Saarlandes, 1996.
  <https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf>
- Wybrow, Marriott & Stuckey, "Orthogonal Connector Routing," GD 2009
  (libavoid). <https://users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf>

Products: Graphviz attribute docs (`rank`, `portPos`, `splines`,
`constraint`, `weight`, linked inline); D2/Terrastruct docs (TALA, `near`,
grid diagrams, dagre/ELK engine pages, linked inline); yFiles automatic
label placement
(<https://docs.yworks.com/yfiles-html/dguide/layout/label_placement.html>);
PlantUML–Graphviz delegation (<https://plantuml.com/graphviz-dot>);
Mermaid v11.0.0 release
(<https://github.com/mermaid-js/mermaid/releases/tag/v11.0.0>) and
`@mermaid-js/layout-elk`
(<https://www.npmjs.com/package/@mermaid-js/layout-elk>); ELK option
reference (<https://eclipse.dev/elk/reference.html>) and the ELK overview
paper (<https://arxiv.org/abs/2311.00533>).

Standards: OMG Diagram Definition v1.1 (<https://www.omg.org/spec/DD/>);
BPMN 2.0.2 (<https://www.omg.org/spec/BPMN/2.0.2/>) / ISO/IEC 19510:2013
(<https://www.iso.org/standard/62652.html>); UML 2.5.1
(<https://www.omg.org/spec/UML/2.5.1/About-UML>); ISO 5807:1985
(<https://www.iso.org/standard/11955.html>); ANSI X3.5-1970 (scan:
<https://www.bitsavers.org/pdf/ansi/X3/X3.005-1970_Flowchart_Symbols_and_Their_Usage_in_Information_Processing.pdf>).

Origins: Mermaid 0.1.0 (November 2014, Knut Sveidqvist;
<https://github.com/mermaid-js/mermaid/releases/tag/0.1.0> — the 0.1.0
README credits d3 and dagre-d3 and states the Visio-avoidance motive);
dagre (Chris Pettitt; wiki reading list
<https://github.com/dagrejs/dagre/wiki>; rank-constraint regression
dagre#159; `@dagrejs` revival releases 2023–2026); `mermaid-ascii`
(Alexander Grooff, <https://github.com/AlexanderGrooff/mermaid-ascii>;
Show HN October 2024 <https://news.ycombinator.com/item?id=41847407>);
`beautiful-mermaid` (Luki Labs/Craft, npm January 2026; HN thread
<https://news.ycombinator.com/item?id=46804828>; upstream v1.0.1
layout/layer-alignment commit; upstream issues
#63/#68/#69/#83/#89/#98/#111/#112/#113/#115/#119/#121/#124).
