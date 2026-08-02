# Research: Flint (microsoft/flint-chart) deep dive — lessons for Agentic Mermaid

Research date: 2026-08-02. Flint version examined: v0.4.0 (2026-07-24).

> Follow-up: four of the lessons below (edit-cost metric, MCP
> resources/prompts, readability floor, MCP App editor view) are specified in
> [`docs/project/flint-derived-improvements-plan.md`](../docs/project/flint-derived-improvements-plan.md).

## Summary

[Flint](https://microsoft.github.io/flint-chart/) is Microsoft Research + Renmin
University's "visualization language for the AI era": a semantics-driven
intermediate language where an agent writes a compact chart spec (data +
semantic field types + chart type + encodings) and a deterministic compiler
derives every fragile low-level decision — parsing, scales, formatting, color
class, density, canvas size — then emits native specs for five backends
(Vega-Lite, ECharts, Chart.js, Plotly, Excel). It is the statistical-chart
sibling of this repo's thesis, built independently and published with a paper
([arXiv:2607.20775](https://arxiv.org/html/2607.20775v1)). Its problem
statement is nearly word-for-word ours: agents forced to manage "complex,
low-level specification details" produce "fragile code … difficult for people
to inspect, repair, or reuse". Three things transfer directly: (1) their
**paired outcome evaluation** (Flint-agent vs direct-Vega-Lite agent, VLM
judge, win/tie/loss with significance, across model tiers — the advantage
*grows as model capability decreases*), which we should replicate as
typed-workflow vs raw-regeneration; (2) their **stretch model** contract —
named elasticity/floor/ceiling knobs, three explicit regimes
(sparse/elastic/overflow), and warned truncation instead of silent
unreadability; (3) their **MCP packaging** — a five-tool server that also
ships its authoring skill as an MCP *resource* and *prompt*, so guidance
travels with the server (our MCP currently ships tools only). Their thin win
margins on frontier models (41% vs 38%, p=0.05) are also evidence *for* our
keep-the-Mermaid-corpus bet rather than a new language.

## What Flint is

- **Who/when**: Microsoft Research + IDEAS Lab (Renmin University of China);
  first public releases July 2026; MIT licensed; npm `flint-chart`, MCP server
  `flint-chart-mcp`; paper "Flint: A Semantics-Driven Data Visualization
  Intermediate Language"; deployed into
  [Data Formulator](https://github.com/microsoft/data-formulator)'s pipeline.
- **Shape of a spec** (`ChartAssemblyInput`): `data` + optional
  `semantic_types` per field + `chart_spec` (`chartType`, `encodings`,
  `baseSize`, optional `canvasSize`) + layout `options`. One shape for every
  backend: `assembleVegaLite(input)`, `assembleECharts(input)`, etc.
- **Scale**: ~40 chart types (38 in the ECharts backend, 18 native Excel
  templates), 46 leaf semantic types, five backends, all from one compilation
  context.
- **Scope boundary that matters to us**: Flint covers *statistical charts*
  (bars, scatters, heatmaps, treemaps, pies …). It has no node-link/topology
  layout — no flowcharts, sequence, ER, state. The hard problem this repo owns
  (graph layout, ports, crossings, `src/layout-engine.ts`, ELK) is entirely
  outside Flint's scope. Overlap exists only at our data-ish families
  (xychart, pie, quadrant, radar, gantt-as-timeline).

## Findings

1. **Independent validation of the AGENT_NATIVE.md thesis.** The paper's core
   diagnosis — "simple high-level specifications that fully rely on system
   'smart default' low-level configurations often yield poor designs, whereas
   detailed specifications … become verbose, brittle, and difficult to modify
   because of complex parameter dependencies", and "even small edits require
   full regeneration — which increases both latency and cost" — is the same
   clash [`AGENT_NATIVE.md`](../AGENT_NATIVE.md) names (regenerate-whole-source
   or read pixels). Two teams, same diagnosis, two remedies: Flint moves the
   burden into a *new language + compiler*; we keep the Mermaid grammar (the
   corpus moat) and move the burden into *typed mutation + verify + a
   quality-owning renderer*. The diagnosis is now citable to MSR, not just to
   our own docs.

2. **A hierarchical semantic type registry with graceful degradation.** Types
   are organized T0 (6 families: Temporal, Measure, Discrete, Geographic,
   Categorical, Identifier) → T1 (17 categories) → T2 (46 specific types, e.g.
   `Revenue`, `Month`, `Rank`, `Sentiment`). Each registry entry fixes five
   orthogonal dimensions: encoding candidates, aggregation role, domain shape
   (`open`/`bounded`/`fixed`/`cyclic`), diverging class, format class. Two
   properties are the transferable craft: **resolution walks T2 → T1 → T0 and
   an imprecise annotation "backs off along the type hierarchy to the most
   specific compatible ancestor"** (unknown strings land on a conservative
   `UNKNOWN_ENTRY`), and **progressive disclosure** — humans write intuitive
   T0/T1 names, agents use the full T2 registry. Note: marketing says "70+
   semantic types", the paper says 44/15/6, the current
   [design-semantics doc](https://github.com/microsoft/flint-chart/blob/main/docs/design-semantics.md)
   says 46/17/6 — the registry is growing release to release.

3. **The compiler treats data as part of the program.** "When the input data
   changes, Flint triggers a synchronous recompilation pass to adaptively
   recompute the visual layout." A dense heatmap gets compact cells, fewer
   ticks, abbreviated labels; a sparse one gets larger cells and richer
   annotations. Everything is a pure function of (data, spec, options) — i.e.
   adaptive *and* deterministic are compatible, matching our own determinism
   posture (`AGENT_NATIVE.md` §1).

4. **A published, closed-form layout "stretch model" with named knobs.**
   ([design-stretch-model.md](https://github.com/microsoft/flint-chart/blob/main/docs/design-stretch-model.md))
   Discrete axes use a spring-equilibrium model (each band has natural length
   ℓ₀ ≈ 20px, solid length ℓ_min = 6px); continuous axes use a gas-pressure
   model (density, not slots). Everything reduces to
   `pressure = demand / supply`, `stretch = min(β, pressure^α)`, with
   per-context elasticity α (0.5 discrete, 0.3 continuous, 0.3 facets) and
   stretch cap β (1.5 axes, 2.0 radial/area). Three explicit regimes: sparse
   (bands grow to fill), elastic (axis stretches while bands compress), and
   **overflow — items are truncated by a documented priority cascade and the
   result carries `_warnings`**. Aspect ratio blends Cleveland-style banking
   to 45° with the pressure model (50/50 geometric mean in log space), gated
   on ≥20% domain coverage. The contract language is excellent:
   "**baseSize is what the chart aims for; canvasSize is what it may never
   exceed.**" All of α/β/ℓ_min surface as small orthogonal `options`
   (`elasticity`, `maxStretch`, `minStep`, `minSubplotSize` …) instead of
   backend-native soup.

5. **Semantics-driven color policy.** ([color-decisions.md](https://github.com/microsoft/flint-chart/blob/main/docs/color-decisions.md))
   Per-channel rules, in order: explicit override wins; else the semantic type
   decides the *scheme class* (diverging with a semantic midpoint — e.g.
   `Correlation` diverges at 0; sequential; `Rank` on a continuous ramp even
   though it's discrete; temporal-on-color forced sequential "avoid discrete
   dates as categories"); cardinality then sizes the palette (cat10 vs cat20).
   Core deliberately does **not** pick a concrete palette on the automatic
   path — backends do, from their registries. Class-by-semantics /
   palette-by-backend is a clean split our `src/color-resolver.ts` +
   `src/palette-catalog.ts` pair can borrow for data-ish families.

6. **LLVM-shaped three-stage compiler.** Frontend resolves *encoding
   properties* (parsing, scale type, stacking, sort, color semantics) into a
   shared compilation context; an optimizer adds *layout properties* (the
   stretch model, facet wrapping, aspect ratio); codegen instantiates
   per-backend **dynamic chart templates** that consume the context and emit
   native specs (Vega-Lite gets `width: {step}` + scale padding; ECharts gets
   `barCategoryGap`/`barWidth` — same intent, different vocabulary).
   Templates are enumerable at runtime (`vlGetTemplateDef('Scatter Plot')`,
   `vlGetTemplateChannels(…)`) — the same move as our `FamilyDescriptor` →
   `describeOps(family)` / `am capabilities --json` registry, which is
   reassuring convergence.

7. **A deliberately minimal MCP surface — plus resources and prompts.** Five
   tools: `render_chart`, `compile_chart`, `validate_chart` (returns validity,
   warnings/errors, *and computed dimensions*), `list_chart_types`, and
   `create_chart_view` (an interactive MCP App with live SVG preview —
   v0.3.0's "dynamic chart widgets"). Their stated rationale: one unified
   schema across ~40 chart types means five general tools instead of 26+.
   The recommended agent workflow is *load the bundled skill resource
   (`flint://agent-skill`) or run the `author_flint_chart` prompt → author →
   `validate_chart` → render*. Deployment gating flags
   (`--disable-file-reference`, `FLINT_MCP_BACKENDS`) and "all rendering is
   local and in-process — data never leaves the host" mirror our hosted
   host-policy hardening. They also ship an `agent-skills/` fallback for
   clients without MCP — same pattern as our `skills/` directory.

8. **The evaluation is the headline export.** Method: three-agent pipeline
   (question generator from dataset summaries → chart agent → VLM grader),
   VisEval protocol (Relevance / Chart Errors / Clarity / Design Quality, 20
   points), on TidyTuesday 2025 data (median 952 rows vs VisEval's median 4 —
   deliberately realistic), 315 questions, 10 chart types, **paired
   comparison** of a Flint-spec agent vs a direct-Vega-Lite agent with the
   same backend. Results: Flint wins 41% / ties 21% / loses 38% with GPT-5.1
   (p=0.05); 45%/21%/34% with GPT-5-mini (p=0.001); 43%/23%/34% with GPT-4.1
   (p=0.004). Two quotable findings: "**the advantage grows as model
   capability decreases**", and specs were "**on average 85% shorter than
   native backend code**". Also honest about losses: simple charts needing
   minimal semantic reasoning tie or favor the baseline.

9. **Docs and repo craft.** Extension guides as first-class docs
   (`adding-a-chart-template.md`, `adding-a-backend.md`,
   `adding-a-semantic-type.md` — we have the analogous
   [`docs/contributing/adding-diagram-types.md`](../docs/contributing/adding-diagram-types.md)),
   **auto-generated per-backend chart catalogs** (`reference-vegalite.md`,
   `reference-echarts.md`, …), a `test_plan.md`, zh-CN localized docs, and a
   weekly-cadence changelog through v0.2.x → v0.4.0 (validation and
   backend-consistency improvements shipped *before* new backends).

10. **Distribution playbook.** Paper + MSR blog + npm + MCP server + demo
    site + integration into a flagship first-party tool (Data Formulator) +
    an Excel backend that meets users inside the tool they already use. Our
    structural equivalent of "Excel" is that GitHub/GitLab/Obsidian/Notion
    render Mermaid natively — the corpus moat — but the "ship inside a
    flagship agent product" step is one we have not made.

## Flint ↔ Agentic Mermaid mapping

| Flint | Agentic Mermaid counterpart | State |
|---|---|---|
| `ChartAssemblyInput` spec (new language) | Mermaid grammar + `ValidDiagram` IR + typed ops | Different bet: they trade the corpus for a clean language; we keep the corpus |
| Semantic type registry (T0/T1/T2, 5 dimensions, ancestor fallback) | `FamilyDescriptor` registry, capability states, semantic role styling | Registry pattern converges; we have no per-*field/node* semantic layer |
| Stretch model (α/β/ℓ_min, three regimes, warned truncation) | ELK layout + `fitTo` output scaling + `src/layout-rubric.ts` measurement | They *generate* density from a model; we *measure* quality post-hoc. No canvas-negotiation contract on our side |
| `validate_chart` → validity + warnings + computed dims | `verifyMermaid` → `{ ok, warnings, layout }` | Parity (ours is richer: tiered warnings, layout JSON) |
| `_warnings` + documented truncation priority cascade | Tiered verify warnings | Parity on warnings; we lack a documented "what gets dropped under pressure" policy |
| 5-tool MCP + skill-as-resource + `author_flint_chart` prompt + MCP App view | Code-Mode-first MCP + `mutate`/`build` declarative tools + repo `skills/` | Their weak-model rationale = our [`docs/mcp-code-mode-rationale.md`](../docs/mcp-code-mode-rationale.md) rationale for `mutate`/`build`. **Gap: our servers expose tools only — no MCP resources/prompts, no App view** |
| Paired eval vs DirectVL, VLM judge, significance, model tiers | `eval/agent-usage` (affordance steering, trace linter), `eval/llm-judge`, benchmarks, rubric | We test *path-taking*; they test *outcomes vs baseline*. Gap |
| "85% shorter than native code" | No published tokens-per-edit / spec-compactness metric | Gap |
| Per-backend auto-generated catalogs | Generated capability reports (`am capabilities --json`, section A/B reports) | Parity in mechanism; per-family rendered galleries would complete it |
| Extension guides | `docs/contributing/adding-diagram-types.md` | Parity |

## Lessons for Agentic Mermaid

Ordered by expected value.

1. **Replicate the paired outcome eval — it is the single most valuable
   import.** Build on `eval/agent-usage` + `eval/llm-judge`: same task set,
   two agents — (a) typed workflow (parse → narrow → mutate → verify →
   serialize, MCP or SDK) vs (b) raw-Mermaid regeneration with a stock
   renderer — graded pairwise by a VLM judge *plus* our deterministic rubric
   (an oracle Flint doesn't have), win/tie/loss with a significance test,
   across at least three model tiers. Flint's "advantage grows as model
   capability decreases" is a testable prediction for our surface; if it
   holds, it is the strongest possible README/comparison claim, and it
   directly validates the `mutate`/`build` weak-model rationale.

2. **Publish a compactness/efficiency number.** Their "specs 85% shorter than
   native backend code" is the most-quoted line in every writeup. Ours would
   be "tokens per edit": median typed-op payload vs regenerating the whole
   source for the same edit across a corpus (we already have
   `eval/mermaid-docs-corpus`). Cheap to compute, durable marketing.

3. **Ship the skill through the MCP server as a resource + prompt.**
   `flint://agent-skill` and the `author_flint_chart` prompt mean any MCP
   client gets the authoring workflow without the repo checkout. We have the
   content (`skills/agentic-mermaid-diagram-workflow/SKILL.md`,
   `Instructions_for_agents.md`) but `src/mcp/` registers tools only. Add
   MCP resources (skill, capability report, style catalog) and an
   `author_mermaid_diagram` prompt to both local and hosted servers. Low
   effort, closes a real discovery gap.

4. **Adopt a canvas-negotiation contract.** Today `fitTo` scales output
   geometry uniformly — text shrinks with it, silently. Flint's contract is
   better: *base size* (aim), *canvas size* (never exceed), *readability
   floor* (ℓ_min analog: minimum label px), *bounded stretch* (β), and an
   explicit overflow regime that **warns** when the floor forces truncation.
   Concretely: a `fitTo` + minimum-font-size check in `verifyMermaid` (new
   warning code, e.g. `BELOW_READABLE_SIZE`) is the cheap first step; ELK
   spacing modulation under a pressure-style model is the deeper follow-on.
   Any adaptation must remain a pure function of input — Flint's is, so the
   determinism posture survives intact.

5. **Document our layout model the way they document theirs.**
   `design-stretch-model.md` (formulas, named parameters, defaults, regimes)
   makes their layout *legible to agents and reviewers*. We have
   `docs/layout-characterization/` and the rubric provenance; a
   `docs/design/` note that names our spacing/aspect decisions and their
   defaults — and states the truncation/downgrade policy for ASCII/Unicode
   projections explicitly — would do for us what the stretch doc does for
   them.

6. **Add a small semantic layer to the data-ish families.** For xychart, pie,
   quadrant, radar, gantt: an optional per-series/axis semantic annotation
   (frontmatter-carried, e.g. `Price`, `Percentage`, `YearMonth`, `Rank`)
   driving (a) tick/label formatting ("+$2.1K", "%Y-%m"), (b) axis direction
   (`Rank` → 1 at top), (c) palette *class* selection
   (diverging-at-midpoint / sequential / categorical, sized by cardinality)
   in `color-resolver.ts`. Follow their two structural rules: ancestor
   fallback so imprecise annotations degrade gracefully instead of erroring,
   and semantics-pick-the-class / palette-catalog-picks-the-colors.

7. **Borrow "nearest compatible ancestor" as a repair idiom.** Where we
   currently warn-and-default (`UNKNOWN_SHAPE`) or reject (unknown mutation
   op), resolve to the nearest registered ancestor/closest registry entry and
   say so in the structured result. Same graceful-degradation contract, less
   agent retry traffic.

8. **Consider an MCP App view.** `create_chart_view` (live preview +
   controls inside the chat client) is their bridge between agent loop and
   human review. We already run a live editor at agentic-mermaid.dev; an
   `open_editor_view` MCP App on the hosted server is the analog. Verify
   MCP-Apps client support before investing.

9. **Update `docs/comparison.md` with Flint as the chart-side sibling.**
   Complementary scope (statistical charts vs graph/topology + Markdown-native
   corpus); honest hand-off guidance (data-heavy chart asks are better served
   by a chart language than by xychart); and cite their frontier-model margin
   (41% vs 38%, p=0.05) as independent evidence that a *new* language buys
   only thin gains when models are strong — the quantitative case for our
   keep-the-corpus bet.

## Counter-lessons (what not to copy)

- **Do not invent a replacement language.** Flint's own numbers show the
  new-language premium is modest on frontier models and concentrated on
  weaker ones; our typed-ops-over-existing-grammar approach targets the same
  failure mode without abandoning the corpus that makes Mermaid render
  natively across GitHub/GitLab/Obsidian/Notion.
- **Do not transplant the physics formulas.** Spring/gas models fit
  homogeneous statistical marks in bands and fields. Graph layout is
  constraint routing (ports, crossings, group containment) — ELK's territory,
  guarded by `layout-rubric.ts`. Import the *contract* (named knobs, regimes,
  floors, warned truncation), not the equations.
- **Do not add semantics as a required surface.** Flint's semantic layer works
  because it is optional with graceful fallback; a mandatory annotation layer
  on Mermaid source would break corpus compatibility, our reason to exist.

## Sources

- Kept: [microsoft.github.io/flint-chart](https://microsoft.github.io/flint-chart/) — project site (SPA; content thin when fetched, used for orientation).
- Kept: [microsoft/flint-chart README](https://github.com/microsoft/flint-chart/blob/main/README.md) — packages, backends, versions, repo layout.
- Kept: [arXiv:2607.20775](https://arxiv.org/html/2607.20775v1) — problem framing, three-stage compiler, type hierarchy, evaluation protocol and numbers.
- Kept: [MSR blog: Flint, a visualization language for the AI era](https://www.microsoft.com/en-us/research/blog/flint-a-visualization-language-for-the-ai-era/) — design story, GPT-5.1 judge scores (16.27 vs 15.91).
- Kept: [docs/api-reference.md](https://github.com/microsoft/flint-chart/blob/main/docs/api-reference.md) — `ChartAssemblyInput`, assembler functions, options/defaults, warnings.
- Kept: [docs/design-stretch-model.md](https://github.com/microsoft/flint-chart/blob/main/docs/design-stretch-model.md) — spring/gas models, formulas, regimes, defaults.
- Kept: [docs/design-semantics.md](https://github.com/microsoft/flint-chart/blob/main/docs/design-semantics.md) — T0/T1/T2 registry, entry dimensions, fallback resolution.
- Kept: [docs/color-decisions.md](https://github.com/microsoft/flint-chart/blob/main/docs/color-decisions.md) — per-channel scheme-class rules.
- Kept: [packages/flint-mcp README](https://github.com/microsoft/flint-chart/blob/main/packages/flint-mcp/README.md) — five tools, skill resource, prompt, gating flags.
- Dropped: trendshift/news aggregator coverage (SourceFeed, ChinaTechNews) — secondary, no technical content beyond the primary sources.
