# Project Backlog

`TODO.md` is the only active backlog. No other root doc may carry unchecked
project TODOs. Docs map: `FEATURES.md` = current capabilities;
`DIVERGENCES.md` = implementation history; `LESSONS_LEARNED.md` = process
lessons; `AGENT_NATIVE.md` = architecture/spec rationale;
`Instructions_for_agents.md` = runtime guide; `CHANGELOG.md` = user-facing
release notes; `docs/issue-derived-test-cases.md` = evidence inventory, not backlog;
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

- [ ] **BUILD-7 — MCP reachability: streamable-HTTP/SSE transport + file/URL
  outputs** (`todo`). The MCP server is local stdio only; competitors with
  adoption (`hustcc/mcp-mermaid`, the official hosted
  <https://mcp.mermaid.ai/mcp>) offer streamable-HTTP/SSE transports and
  remote-friendly outputs. Add an opt-in HTTP transport and file/URL output
  options for `render_png`, keeping local Code Mode the flagship. Blocks
  DEC-1 (consumer acquisition) and is a prerequisite for BUILD-4.
- [ ] **BUILD-2 — `process --mode validate|canonicalize` triage** (`todo`).
  Current verbs are `verify` and `format`; decide whether a single `process`
  wrapper improves agent ergonomics enough to justify another command.
  Independent of other items.
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
- [x] **BUILD-13 — Layout before/after comparison harness** (`done`).
  Prerequisite for all visual/layout work (BUILD-10, BUILD-9, BUILD-12,
  BUILD-1): render the corpus + targeted fixtures on two git states and emit
  a side-by-side HTML report with perceptual-metric deltas. Shipped as
  `eval/layout-compare/run.ts` (snapshot/report subcommands, regression
  exit code), fixtures in `eval/layout-compare/fixtures/`, tests in
  `src/__tests__/layout-compare.test.ts`.
- [ ] **BUILD-10 — Fan-out trunk sharing / connector alignment** (`todo`,
  after BUILD-13; partially done). Upstream issue:
  <https://github.com/lukilabs/beautiful-mermaid/issues/111>
  (sibling edges from one source don't share a trunk; related connector
  displacement is issue #112, upstream fix PR is #113).
  Done: the #112 box-start displacement is fixed (connector anchored on the
  node border via `getNodeAttachmentPoint`, gap filled;
  `src/__tests__/ascii-box-start.test.ts`). Remaining: the #111-class TB
  fan-out detour (a sibling edge takes an L-shaped wander with its label on
  the horizontal run; see the upstream repro with `left*`/`center*`/`right*`
  labels). A naive preferred-direction A* tweak destabilizes the existing
  trunk post-processing — this needs upstream PR #113's coordinated set
  (FIFO heap tie-breaking + branch-point re-routing + label placement),
  ported against our diverged pathfinder, measured with BUILD-13.
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
- [ ] **BUILD-14 — ASCII: edges to a subgraph id create a phantom node**
  (`todo`). `Start --> Pipeline` where `Pipeline` is a subgraph renders a
  duplicate floating node box labeled `Pipeline` instead of attaching the
  edge to the container (the SVG/ELK path handles this correctly via
  hierarchical ports; verify is layout-path based so it reports `ok` while
  the ASCII output is wrong). Needs container-border edge attachment in the
  ASCII grid/pathfinder. Discovered while testing BUILD-12; repro:
  `eval/layout-compare/fixtures/subgraph-direction.mmd` with an edge to
  `Pipeline`.
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops. Measure with BUILD-13; fixing BUILD-14
  first avoids collapsing onto the phantom-node bug.
- [ ] **BUILD-8 — Tier 3 lint catalogue** (`todo`). The lint tier is
  reserved and `FamilyPlugin.verify` hooks are wired, but zero built-in lint
  codes exist, so every doc carries a "no catalogue yet" caveat. Ship a
  small starter set (e.g. `UNREACHABLE_NODE`, `DUPLICATE_EDGE`,
  label-style consistency), extend `WARNING_TIER` (the doc-sync test
  currently only admits `structural|geometric`), and sync
  capabilities/CLI/MCP/docs. Draw candidate codes from EVAL-2's captured
  real-agent failure corpus, so the catalogue targets observed mistakes
  rather than invented ones.
- [ ] **BUILD-4 — Cloudflare Worker Code Mode web app** (`todo`, after
  BUILD-7). Offer a hosted Agentic Mermaid experience using Cloudflare
  Workers and `@cloudflare/codemode`/CodeMode-style isolation only after
  scoping the security boundary, auth/rate limits, persistence model, and
  parity with the current local CLI/MCP/library contract.

## 2. Agent-usage verification backlog

- [ ] **EVAL-1 — Capture API-backed release-model transcripts** (`todo`). A
  committed pi-subagent transcript set now replays cleanly, and
  `bun run eval:agent-live` can capture Anthropic/OpenAI-compatible runs, but
  the selected release model still needs an API-key-backed transcript set.
- [ ] **EVAL-2 — Expand captured real-agent failure corpus** (`todo`). The
  deterministic linter/eval now covers stored decoys and executable docs;
  still capture live failures such as string concatenation, whole-source
  regeneration, CLI misuse, and stale copied examples from real model runs.
  Feeds BUILD-8 (lint codes from observed failures).

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
- Do not treat historical `DIVERGENCES.md` or process notes as backlog unless
  an item is promoted here with an ID.
