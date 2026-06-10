# Project Backlog

`TODO.md` is the only active backlog. No other root doc may carry unchecked
project TODOs. Docs map: `docs/features.md` = current capabilities;
`docs/project/divergences.md` = implementation history;
`docs/project/lessons-learned.md` = process lessons; `AGENT_NATIVE.md` =
architecture/spec rationale; `Instructions_for_agents.md` = runtime guide;
`CHANGELOG.md` = user-facing release notes; `docs/README.md` = documentation
index; `docs/issue-derived-test-cases.md` = evidence inventory, not backlog;
`docs/mcp-code-mode-rationale.md` = MCP surface rationale, not backlog;
`docs/agent-workflow-examples.md` = runnable example index, not backlog;
`docs/pr11-reviewer-guide.md` = merged PR #11 review/audit map, not backlog.

Status legend: `todo` | `blocked` | `owner-decision` | `parked` | `done`
(checked items record recently completed backlog with their evidence; prune
them once the next release ships).

Items within each section are sorted by dependencies: prerequisites first,
dependents after. IDs are stable names, not an ordering.

## 0. Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo. Unblocked
  substantially by BUILD-7 (remote MCP reachability).

## 1. Ready build backlog

- [x] **BUILD-7 — MCP reachability: streamable-HTTP/SSE transport + file/URL
  outputs** (`done`). Added opt-in HTTP/SSE transport with loopback-default
  binding, `--transport http`, direct `/rpc` test endpoint, SSE `/sse` +
  `/message` session flow, `/health`, JSON content-type/Origin gates,
  remote-bind bearer token requirement, capped request/sandbox sizes, and
  managed `/artifacts/<name>` serving. `render_png` now supports
  `output: "base64"|"file"|"url"`; file/URL artifacts are generated under a
  managed store with safe tracked names, MIME type, byte count, SHA-256, size
  limit, and TTL checks. Tests cover file output, URL fetch-back, auth/body
  gates, tracked artifact serving, and SSE session lifecycle.
- [ ] **BUILD-2 — `process --mode validate|canonicalize` triage** (`todo`).
  Current verbs are `verify` and `format`; do not add another command until it
  proves agent value. Needed: inventory overlap with `verify`, `format`,
  `parse`, `serialize`, `mutate`, and `batch`; write the exact JSON/exit-code
  contract for `validate` and `canonicalize`; test whether it reduces agent
  routing errors in docs/evals; then either implement as a thin, schema-tested
  wrapper or explicitly park/decline it. Independent of other items.
- [x] **BUILD-3 — Family-plugin consolidation** (`done`). parse/serialize/
  mutate for sequence, timeline, class, ER, and journey now dispatch through
  `FamilyPlugin` hooks registered in `src/agent/families-builtin.ts`; each
  family lives in one body module (`sequence-body.ts`, `timeline-body.ts`,
  `class-body.ts`, `er-body.ts`, `journey-body.ts`). Flowchart/state remain
  registered via `flowchartFamilyHooks` (two plugins, one implementation,
  header bound per kind) after the contract gained canonicalSource/
  multi-error parse and a buildSourceMap hook — no in-tree exception
  remains. Mutation rebuilds `canonicalSource` uniformly. Unblocks
  BUILD-5/BUILD-6/BUILD-11 and the mutation roadmap.
- [ ] **BUILD-5 — Common-README family coverage: pie, gantt, mindmap,
  gitgraph** (`in-progress`). These families are common in
  real-world READMEs/docs and already have authoring syntax references in
  `skills/agentic-mermaid-diagram-workflow/references/upstream/`, but the
  renderer does not accept them. No public usage statistics exist, so first
  gather evidence (count fenced ` ```mermaid ` header families across a
  GitHub README corpus), then implement in evidence order. Each addition
  follows `docs/contributing/adding-diagram-types.md` and ships
  parse/verify/render/round-trip (source-level body is acceptable; structured
  mutation only where the IR can preserve semantics). The corpus count also
  feeds BUILD-11.
  - [x] Evidence step: `eval/family-usage/` counts fenced ` ```mermaid `
    header families over a directory of markdown. Golden-fixture tested; smoke
    run over the in-repo corpus recorded in `eval/family-usage/RESULTS.md`
    with an explicit caveat that the decision-grade README corpus run needs
    network (see `eval/family-usage/README.md`).
  - [x] Pie family (cheapest target): `src/pie/` (types/parser/layout/SVG +
    `src/ascii/pie.ts`), routing, agent surface (detect + extractLabels,
    source-level), showcase samples, docs, and goldens.
  - [ ] gantt, mindmap, gitgraph: still to implement. Order the remaining
    three by the real README corpus run (network required) per the evidence
    step above — `eval/family-usage/RESULTS.md` does not assert that ordering.
- [ ] **BUILD-11 — QuadrantChart family** (`todo`). Promoted
  from the PARK-3 fork-audit list. Quadrant charts are missing across the
  entire beautiful-mermaid fork network (no port exists upstream or in any
  fork), so this is cheap differentiation. Axis/quadrant layout is closer to
  xychart than to graph families; expect a source-level body first.
- [ ] **BUILD-6 — New upstream Mermaid families (11.4–11.15)** (`todo`). Mermaid added kanban (11.4), radar (11.6), treemap
  (~11.9), Venn (beta, 11.13), Ishikawa/fishbone (beta, 11.13), Wardley Maps
  (beta, 11.14), TreeView (11.14), and Event Modeling (11.15). Upstream
  syntax references for these already ship in the skill bundle. Prioritize
  TreeView first: it is hierarchical, ASCII-friendly, and requested against
  the upstream fork network (lukilabs/beautiful-mermaid#114). Treat
  beta-grammar families (Venn, Ishikawa, Wardley) as watch-and-wait until
  upstream syntax stabilizes.
- [x] **BUILD-15 — Journey structured mutation (pilot)** (`done`). Typed
  `JourneyBody` (title/sections/tasks with 1..5 scores and actors), 10 ops,
  `asJourney` narrower, verify hook, lossless opaque fallback for unmodeled
  syntax, round-trip property tests (`agent-journey.test.ts`), and sync
  across CLI capabilities, MCP SDK declaration, `Instructions_for_agents.md`,
  llms.txt, the skill, and the spec. The per-family checklist it validated
  is the template for BUILD-16/BUILD-17.
- [ ] **BUILD-16 — XY chart structured mutation** (`todo`; BUILD-15 checklist applies).
  Title/axes/series data are fully modelable: `set_title`, `set_axis`,
  `add_series`, `remove_series`, `update_data`. Same checklist as BUILD-15.
- [x] **BUILD-17 — Architecture structured mutation** (`done`). Typed
  `ArchitectureBody` (groups/services/junctions + anchored `id:SIDE arrow SIDE:id`
  edges), 10 ops (`add_service`, `remove_service` [cascades edges],
  `rename_service` [updates edges], `set_service_label`, `set_service_icon`,
  `move_service`, `add_group`, `remove_group` [refuses non-empty], `add_edge`,
  `remove_edge` [by index or `from->to` id]), `asArchitecture` narrower, verify
  hook (EMPTY_DIAGRAM + LABEL_OVERFLOW), lossless opaque fallback for the
  `{group}` boundary modifier and accTitle/accDescr, round-trip + fast-check
  property tests (`agent-architecture.test.ts`), and sync across CLI
  capabilities, MCP SDK declaration, `Instructions_for_agents.md`, llms.txt, the
  skill, and the spec. Followed the BUILD-15 journey checklist verbatim.
- [ ] **BUILD-18 — Segment-preserving structured body** (`todo`). The general fix for the
  structured-or-opaque cliff: today one unmodeled construct (e.g. a
  sequence `alt` block) forces the whole diagram opaque and disables every
  op. Design a body that interleaves structured statements with verbatim
  opaque segments preserved positionally, so participant/message ops stay
  available while the `alt` block rides along untouched. Needs a
  segment-aware parser, order-preserving serializer, ops that respect
  segment boundaries, and property tests that fallback fidelity still
  holds. Apply to sequence first (largest opaque-fallback population:
  notes/alt/loop/par), then class/ER/timeline unmodeled-syntax fallbacks.
  This is the path to "typed mutation for all diagrams" without ever
  violating the no-loss guarantee.
- [ ] **BUILD-19 — Dedicated `StateBody` IR for state diagrams** (`todo`,
  evidence-gated). State diagrams currently parse AS flowcharts (shared
  `MermaidGraph` body; `[*]` pseudo-states encoded as node shapes), so
  agents edit them with flowchart vocabulary. A dedicated structured-or-
  opaque `StateBody` (states, transitions, composites, forks/choices,
  notes, concurrency) would give state-shaped ops (`add_state`,
  `add_transition`, `make_composite`, …), a real `asState` narrower, and
  lossless opaque fallback for composite syntax the flowchart projection
  flattens. Full BUILD-15-style checklist plus a renderer-projection
  decision. Promote when a consumer actually hits the limits of flowchart
  vocabulary on state diagrams.
- [x] **BUILD-13 — Layout before/after comparison harness** (`done`).
  Prerequisite for all visual/layout work (BUILD-10, BUILD-9, BUILD-12,
  BUILD-1): render the corpus + targeted fixtures on two git states and emit
  a side-by-side HTML report with perceptual-metric deltas. Shipped as
  `eval/layout-compare/run.ts` (snapshot/report subcommands, regression
  exit code), fixtures in `eval/layout-compare/fixtures/`, tests in
  `src/__tests__/layout-compare.test.ts`.
- [x] **BUILD-10 — Fan-out trunk sharing / connector alignment** (`done`).
  Upstream issue <https://github.com/lukilabs/beautiful-mermaid/issues/111>
  (sibling edges from one source don't share a trunk; related connector
  displacement is issue #112, upstream fix PR is #113).
  The #112 box-start displacement was already fixed (connector anchored on the
  node border via `getNodeAttachmentPoint`; `ascii-box-start.test.ts`). The
  #111-class TB fan-out detour (a labelled sibling edge took an L-shaped wander
  with its label on the horizontal run) is now fixed. Evidence: golden
  `src/__tests__/testdata/unicode/td_fanout_labeled.txt` matches the upstream
  shape exactly; charset-independent invariants in
  `src/__tests__/ascii-fanout-trunk-labeled.test.ts` (single trunk with ┬ tees,
  each label on its own vertical drop, no `─label─`, no stray `+`/`◢`).
  Port outcome (the Loop 17 lesson, confirmed again): of upstream PR #113's four
  parts, only TWO were load-bearing in this fork and only those shipped —
  (1a) deterministic FIFO tie-breaking in the pathfinder MinHeap
  (`src/ascii/pathfinder.ts`), and (3b) label placement preferring the
  per-sibling vertical drop in TD (`determineLabelLine` in
  `src/ascii/edge-routing.ts`). The other two — (1b) `preferredDir` A* neighbour
  reordering and (2) explicit branch-point re-routing — DESTABILISED trunk
  rendering here (stray `+`, `◢` arrowheads, regressed the LR box-start repro),
  because this fork already has the trunk machinery upstream lacked
  (edge-bundling for unlabelled siblings) plus FIFO determinism, so the reorder
  fought the existing routing. `preferredDir` is kept as an unused pathfinder
  capability (covered by `ascii-pathfinder-determinism.test.ts`); the re-routing
  was dropped. Part (4) collinear-corner-skip in `drawCorners` shipped as a
  defensive guard. Corpus delta (BUILD-13): 0 SVG / 0 ASCII / 0 metric changes
  across 251 samples (the labelled-fan-out pattern isn't in the corpus). Sabotage
  check: reversing the FIFO tie-break re-introduces the `─center*─` detour.
- [x] **BUILD-9 — Fan-in grouping** (`done`). Promoted from PARK-1; upstream
  PR <https://github.com/lukilabs/beautiful-mermaid/pull/69>. Implemented in
  `src/ascii/grid.ts` `createMapping`: roots grouped contiguously by first
  downstream target, fan-in targets aligned under their root group, with
  self-loops and 2-cycle toggles excluded from the in-degree (a blanket
  in-degree check regressed state-machine corpora — caught by BUILD-13).
  Corpus impact: 1 sample improved, 0 regressed. Tests:
  `src/__tests__/ascii-fan-in-grouping.test.ts`.
- [x] **BUILD-12 — Subgraph `direction` support** (`done` — it was already
  implemented; now pinned). Mermaid ignores `direction` inside a subgraph
  when an inner node links outward
  (<https://github.com/mermaid-js/mermaid/issues/2509>,
  <https://github.com/mermaid-js/mermaid/issues/6438>); our ELK SEPARATE
  hierarchy handling and the ASCII grid layout both honor it, including the
  #2509 external-link case. Geometry tests pin the differentiator:
  `src/__tests__/subgraph-direction.test.ts`.
- [x] **BUILD-14 — ASCII: edges to a subgraph id create a phantom node**
  (`done`). `Start --> Pipeline` where `Pipeline` is a subgraph used to render
  a duplicate floating node box labeled `Pipeline` instead of attaching the
  edge to the container. Fixed in the ASCII converter + draw layer: the
  converter (`src/ascii/converter.ts` `resolveSubgraphEdges`) detects phantom
  subgraph-id nodes, drops them, and retargets each touching edge onto a
  representative container member for routing; the draw layer
  (`src/ascii/draw.ts` `drawContainerEdge`) clips the visible polyline to the
  container's border rectangle and draws the arrowhead on the border, so the
  edge attaches to the container — matching the SVG/ELK hierarchical-port
  behavior. Edge semantics are preserved (visible terminal is the container
  border, never an arbitrary member node). Evidence: red→green repro suite
  `src/__tests__/ascii-subgraph-edge.test.ts` (5 tests, incl. the mermaid#2509
  case and an id-collision sad path), golden
  `src/__tests__/testdata/unicode/subgraph_edge_to_container.txt`, and the
  BUILD-13 layout-compare harness shows 4 ASCII-only changed corpus/fixture
  samples (flowchart/96, flowchart/97, flowchart/98, subgraph-direction.mmd)
  with 0 regressions / 0 faithfulness deltas. Repro:
  `eval/layout-compare/fixtures/subgraph-direction.mmd`.
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops. Measure with BUILD-13. (BUILD-14, the
  ASCII phantom-node bug that would have interfered with collapsed-subgraph
  edge attachment, is now fixed.)
- [x] **BUILD-8 — Tier 3 lint catalogue** (`done`). Added advisory
  flowchart/state lint warnings for `DUPLICATE_EDGE` and `UNREACHABLE_NODE`,
  exposed them through `WarningCode`, `WARNING_TIER`, `am capabilities`,
  `llms.txt`, MCP SDK declarations, tests, and agent-facing docs. Candidates
  came from EVAL-2's captured/curated real-agent failure corpus.
- [ ] **BUILD-4 — Cloudflare Worker Code Mode web app** (`todo`, after
  BUILD-7). Offer a hosted Agentic Mermaid experience using Cloudflare
  Workers and `@cloudflare/codemode`/CodeMode-style isolation only after
  scoping the security boundary, auth/rate limits, persistence model, and
  parity with the current local CLI/MCP/library contract.

## 2. Agent-usage verification backlog

- [x] **EVAL-1 — Capture subagent-backed release-model transcripts** (`done`).
  `eval/agent-usage/transcripts/pi-subagent-release-2026-06-10/` captures a
  fresh subagent-backed release-model pass across the six default cases. The
  committed transcript replay test gates every pi-subagent transcript directory
  through the deterministic sandbox, task oracle, and trace linter. Direct
  API-backed Anthropic/OpenAI-compatible captures remain available on demand via
  `bun run eval:agent-live` when credentials are present.
- [x] **EVAL-2 — Expand captured real-agent failure corpus** (`done`). Added
  `eval/agent-usage/failure-corpus/` with captured pi-subagent failures and
  curated executable regressions for markdown-only answers, whole-source
  regeneration, CLI misuse, serialize-without-verify, ignored verify results,
  and opaque mutation attempts. `agent-usage.test.ts` now classifies/replays
  the corpus so known-bad paths stay failing. Fed BUILD-8 lint-code selection.

## 3. Blocked / external resource needed

_No active blocked items._

## 4. Parked / evidence-required ideas

- [ ] **PARK-2 — `.well-known/skills` discovery** (`parked`). Watch the
  ecosystem; do not implement until a standard settles.
- [ ] **PARK-3 — Fork feature ports** (`parked`). Vercel themes,
  browser/package export tweaks, C4, ArchiMate (upstream PR #34), and
  animation remain fork-audit ideas. Promote one only with a focused issue
  and owner. (QuadrantChart was promoted to BUILD-11; fan-in grouping was
  PARK-1, promoted to BUILD-9.)

## 5. Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown
  viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas
  that still apply to the current ELK/layout-engine architecture.
- Do not treat historical `docs/project/divergences.md` or process notes as
  backlog unless an item is promoted here with an ID.
