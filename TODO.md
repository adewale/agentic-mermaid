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
- [ ] **BUILD-3 — Family-plugin consolidation** (`todo`). Evaluate whether
  parse/serialize/mutate dispatch should move fully into `FamilyPlugin` now
  that timeline/class/ER mutation exists. Do before adding new families
  (BUILD-5, BUILD-6, BUILD-11) so each addition lands on the consolidated
  dispatch instead of widening the old one.
- [ ] **BUILD-5 — Common-README family coverage: pie, gantt, mindmap,
  gitgraph** (`todo`, after BUILD-3). These families are common in
  real-world READMEs/docs and already have authoring syntax references in
  `skills/agentic-mermaid-diagram-workflow/references/upstream/`, but the
  renderer does not accept them. No public usage statistics exist, so first
  gather evidence (count fenced ` ```mermaid ` header families across a
  GitHub README corpus), then implement in evidence order. Pie is the likely
  cheapest first target. Each addition follows `ADDING_DIAGRAM_TYPES.md` and
  ships parse/verify/render/round-trip (source-level body is acceptable;
  structured mutation only where the IR can preserve semantics). The corpus
  count also feeds BUILD-11.
- [ ] **BUILD-11 — QuadrantChart family** (`todo`, after BUILD-3). Promoted
  from the PARK-3 fork-audit list. Quadrant charts are missing across the
  entire beautiful-mermaid fork network (no port exists upstream or in any
  fork), so this is cheap differentiation. Axis/quadrant layout is closer to
  xychart than to graph families; expect a source-level body first.
- [ ] **BUILD-6 — New upstream Mermaid families (11.4–11.15)** (`todo`,
  after BUILD-3). Mermaid added kanban (11.4), radar (11.6), treemap
  (~11.9), Venn (beta, 11.13), Ishikawa/fishbone (beta, 11.13), Wardley Maps
  (beta, 11.14), TreeView (11.14), and Event Modeling (11.15). Upstream
  syntax references for these already ship in the skill bundle. Prioritize
  TreeView first: it is hierarchical, ASCII-friendly, and requested against
  the upstream fork network (lukilabs/beautiful-mermaid#114). Treat
  beta-grammar families (Venn, Ishikawa, Wardley) as watch-and-wait until
  upstream syntax stabilizes.
- [ ] **BUILD-15 — Journey structured mutation (pilot)** (`todo`, after
  BUILD-3). Journey is the cheapest source-level family to promote to
  structured mutation: sections/tasks/scores are structurally a timeline
  sibling. Ship the full per-family checklist and treat it as the template
  for BUILD-16/17: typed `JourneyBody`, serializer reproducing the modeled
  grammar, ~10 ops (`add_section`, `add_task`, `set_score`,
  `rename_actor`, …), `asJourney` narrower, verify integration, property
  tests (round-trip identity on canonical input; lossless opaque fallback
  for unmodeled syntax), and sync across all runtime surfaces (capabilities
  JSON, MCP SDK declaration, `Instructions_for_agents.md`, llms.txt, skill
  — doc-sync tests enforce).
- [ ] **BUILD-16 — XY chart structured mutation** (`todo`, after BUILD-15).
  Title/axes/series data are fully modelable: `set_title`, `set_axis`,
  `add_series`, `remove_series`, `update_data`. Same checklist as BUILD-15.
- [ ] **BUILD-17 — Architecture structured mutation** (`todo`, after
  BUILD-15). The most agent-valuable promotion (groups/services/edges are
  the diagrams agents edit most): `add_service`, `add_group`,
  `move_service`, `add_edge`, `rename`, … Same checklist as BUILD-15.
- [ ] **BUILD-18 — Segment-preserving structured body** (`todo`, after
  BUILD-15 validates the per-family checklist). The general fix for the
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
- [x] **BUILD-13 — Layout before/after comparison harness** (`done`).
  Prerequisite for all visual/layout work (BUILD-10, BUILD-9, BUILD-12,
  BUILD-1): render the corpus + targeted fixtures on two git states and emit
  a side-by-side HTML report with perceptual-metric deltas. Shipped as
  `eval/layout-compare/run.ts` (snapshot/report subcommands, regression
  exit code), fixtures in `eval/layout-compare/fixtures/`, tests in
  `src/__tests__/layout-compare.test.ts`.
- [x] **BUILD-10 — Fan-out trunk sharing / connector alignment** (`done`).
  Upstream issue: <https://github.com/lukilabs/beautiful-mermaid/issues/111>
  (plus connector displacement #112 / upstream PR #113). The ASCII pathfinder
  now uses deterministic preferred-direction exploration, labeled sibling
  fan-outs share the first branch trunk via post-routing branch-point
  re-routing, collinear waypoints no longer overwrite corners, explicit trunk
  junctions are drawn, and one-way branch labels stay on their vertical branch
  instead of being shifted into the horizontal trunk. Tests:
  `src/__tests__/ascii-pathfinder-trunk.test.ts`,
  `src/__tests__/ascii-box-start.test.ts`,
  `src/__tests__/ascii-determinism.test.ts`, plus exact ASCII/Unicode
  golden files in `src/__tests__/testdata/{ascii,unicode}/`.
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
  (`done`). `Start --> Pipeline` where `Pipeline` is a subgraph now routes
  through stable inner anchors for placement/pathfinding but draws to the
  subgraph container border, so ASCII no longer emits a duplicate floating
  `Pipeline` node box. The outgoing container edge also aligns from the
  subgraph anchor instead of jumping sideways. Regression coverage lives in
  `src/__tests__/subgraph-direction.test.ts` and exact ASCII/Unicode golden
  files under `src/__tests__/testdata/{ascii,unicode}/`, including nested,
  styled/labeled, and multi-edge container cases.
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops. Measure with BUILD-13; BUILD-14 is now
  fixed, so collapsed-subgraph work no longer inherits the phantom-node bug.
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
