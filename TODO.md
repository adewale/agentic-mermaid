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

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

## 0. Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo.

## 1. Ready build backlog

- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Large, but a real
  readability win for agent-generated architecture diagrams.
- [ ] **BUILD-2 — `process --mode validate|canonicalize` triage** (`todo`).
  Current verbs are `verify` and `format`; decide whether a single `process`
  wrapper improves agent ergonomics enough to justify another command.
- [ ] **BUILD-3 — Family-plugin consolidation** (`todo`). Evaluate whether
  parse/serialize/mutate dispatch should move fully into `FamilyPlugin` now
  that timeline/class/ER mutation exists.
- [ ] **BUILD-4 — Cloudflare Worker Code Mode web app** (`todo`). Offer a
  hosted Agentic Mermaid experience using Cloudflare Workers and
  `@cloudflare/codemode`/CodeMode-style isolation only after scoping the
  security boundary, auth/rate limits, persistence model, and parity with the
  current local CLI/MCP/library contract.
- [ ] **BUILD-5 — Common-README family coverage: pie, gantt, mindmap,
  gitgraph, quadrant** (`todo`). These families are common in real-world
  READMEs/docs and already have authoring syntax references in
  `skills/agentic-mermaid-diagram-workflow/references/upstream/`, but the
  renderer does not accept them. No public usage statistics exist, so first
  gather evidence (count fenced ` ```mermaid ` header families across a
  GitHub README corpus), then implement in evidence order. Pie is the likely
  cheapest first target. Each addition follows `ADDING_DIAGRAM_TYPES.md` and
  ships parse/verify/render/round-trip (source-level body is acceptable;
  structured mutation only where the IR can preserve semantics).
- [ ] **BUILD-6 — New upstream Mermaid families (11.4–11.15)** (`todo`).
  Mermaid added kanban (11.4), radar (11.6), treemap (~11.9), Venn (beta,
  11.13), Ishikawa/fishbone (beta, 11.13), Wardley Maps (beta, 11.14),
  TreeView (11.14), and Event Modeling (11.15). Upstream syntax references
  for these already ship in the skill bundle. Prioritize TreeView first: it
  is hierarchical, ASCII-friendly, and requested against the upstream fork
  network (lukilabs/beautiful-mermaid#114). Treat beta-grammar families
  (Venn, Ishikawa, Wardley) as watch-and-wait until upstream syntax
  stabilizes.

## 2. Agent-usage verification backlog

- [ ] **EVAL-1 — Capture API-backed release-model transcripts** (`todo`). A
  committed pi-subagent transcript set now replays cleanly, and
  `bun run eval:agent-live` can capture Anthropic/OpenAI-compatible runs, but
  the selected release model still needs an API-key-backed transcript set.
- [ ] **EVAL-2 — Expand captured real-agent failure corpus** (`todo`). The
  deterministic linter/eval now covers stored decoys and executable docs;
  still capture live failures such as string concatenation, whole-source
  regeneration, CLI misuse, and stale copied examples from real model runs.

## 3. Blocked / external resource needed

_No active blocked items._

## 4. Parked / evidence-required ideas

- [ ] **PARK-1 — #69 fan-in grouping** (`parked`). Aesthetics improvement,
  but risks determinism snapshots; revisit only with concrete diagrams.
- [ ] **PARK-2 — `.well-known/skills` discovery** (`parked`). Watch the
  ecosystem; do not implement until a standard settles.
- [ ] **PARK-3 — Fork feature ports** (`parked`). QuadrantChart, Vercel
  themes, browser/package export tweaks, C4, ArchiMate, and animation remain
  fork-audit ideas. Promote one only with a focused issue and owner.

## 5. Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown
  viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas
  that still apply to the current ELK/layout-engine architecture.
- Do not treat historical `DIVERGENCES.md` or process notes as backlog unless
  an item is promoted here with an ID.
