# TanStack Charts v0: learnings for Agentic Mermaid

**Status.** External-survey research note, written 2026-08-10 against TanStack
Charts commit
[`c17d6772ba20f0edc32a5da80130871d7398a2a6`](https://github.com/TanStack/charts/commit/c17d6772ba20f0edc32a5da80130871d7398a2a6),
whose `@tanstack/charts` package reported version 0.9.0 and whose docs described
the API as pre-alpha. Facts and quotes come from the immutable sources listed
under [Sources](#sources). This note records what an adjacent, independently
designed "for humans and agents" library validates, what is worth adopting, and
where this project deliberately diverges. It is analysis, not backlog: any
follow-up promoted from here gets its own `TODO.md` entry first.

## What TanStack Charts is

- A "typed, tree-shakable chart grammar for SVG and Canvas" with the tagline
  **"A chart grammar you don't have to outgrow."** It sits in the
  grammar-of-graphics lineage (Leland Wilkinson, ggplot2, Vega-Lite, Observable
  Plot), closest to Observable Plot but with an independent runtime.
- **"All mark, no chart."** There are no chart types. Authors compose marks
  (`lineY`, `areaX`, `barY`, `dot`, `ruleY`, `text`, …), channels, scales,
  transforms (group, bin, normalize, stack), interactions (typed focus and
  selection callbacks, tooltips), and interruptible motion — via compact
  primitives or D3-compatible inputs. "A chart is not a special-purpose
  component with a fixed series model"; there is "no required `{ series: [...] }`
  wrapper."
- `defineChart()` produces a static or responsive chart definition;
  `createChartScene()` or `ChartRuntime.render()` resolves that definition at a
  concrete size into a renderer-neutral `ChartScene`. The SVG renderer, DOM and
  framework hosts, static exporter, and custom renderers consume that scene.
- Headless core with thin, optional framework adapters (React first). Granular
  subpath exports "keep optional capabilities and individual marks independently
  tree-shakeable."
- It "renders accessible SVG by default, with Canvas available as an opt-in
  surface."
- The dual audience is explicit: "The library is designed for two equally
  important authors: People should get polished, responsive charts from a short
  declaration. AI should be able to compose, inspect, and modify charts without
  learning an application-specific series model or guessing at hidden behavior."
- The project states that almost all of the implementation was produced with AI
  coding agents under direct supervision, then reviewed and accepted.
- The docs lead with a catalog of 100+ examples grouped by task (comparison,
  composition, distribution, hierarchy, polar, geographic, …), and claim "all
  examples compile under strict TypeScript."

## What it validates (independent convergence)

Each item pairs their move with the surface where this repository already made
the same bet. Convergence from an unrelated team is evidence the bet is sound,
not something to change.

1. **Dual-audience authorship is becoming the mainstream framing.** Their "two
   equally important authors" is the thesis of [`AGENT_NATIVE.md`](../AGENT_NATIVE.md)
   arriving from the charts side. A flagship OSS brand now designs declarative
   visual surfaces for agent authors by default; comparison and positioning
   docs can cite that convergence instead of arguing the premise.
2. **A typed declarative spec is the agent interface.** Their pitch that
   fields, datum types, and callbacks stay type-connected to source data is the
   same instinct as the overloaded `mutate`, family narrowers, and `Result`
   returns: make the machine-checkable surface the contract so an agent never
   guesses at hidden behavior. Even their mark naming (`lineY`/`barX` encode the
   bound channel in the name) parallels `kind`-discriminated ops — names an
   agent can emit without reverse-engineering semantics.
3. **A renderer-neutral scene IR is the load-bearing architecture.** Their
   `ChartScene` consumed identically by SVG, DOM hosts, static export, and
   custom renderers is this repo's typed Scene and positioned layout JSON
   consumed by SVG/PNG/ASCII/Unicode (the
   [system architecture](../docs/design/system/README.md) and the
   [SVG semantic contract](../docs/svg-semantic-contract.md)); the same shape as
   lesson 8 in
   [`lessons-learned.md`](../docs/project/lessons-learned.md) — final pixels
   and public projections must agree because they come from one scene.
4. **Headless core, thin adapters.** Their optional framework adapters over a
   framework-free core match [`react.md`](../docs/react.md)'s `useMemo` wrapper
   and [`browser.md`](../docs/browser.md)'s adapters over the synchronous
   renderer.
5. **Accessible, browserless SVG as a default, not a mode.** Their
   accessible-SVG-by-default posture matches the zero-DOM renderer plus
   `accTitle`/`accDescr` and the accessibility section of the SVG semantic
   contract.
6. **A compiler-gated example corpus.** "All examples compile under strict
   TypeScript" makes the docs a tested artifact. The analogue here is the
   [dogfooded docs pipeline](../docs/project/dogfooding-docs-strategy.md) and
   the website examples corpus rendered by our own renderer; the stated
   contract worth keeping sharp is "every published example parses, renders,
   and verifies."
7. **Agent-built, human-reviewed development can sustain a substantial OSS
   codebase.** Their stated process (agents implement under supervision; humans
   review and accept) is this fork's process. The project was pre-alpha at the
   reviewed revision, so this is evidence of scale and disciplined practice,
   not evidence of production maturity.

## Worth adopting

1. **State the retention promise as a promise.** "You don't have to outgrow"
   names the adopter's real fear — hitting a wall and rewriting. Our mechanism
   is arguably stronger (never-lossy structured-or-opaque parsing and the
   [source-preservation ladder](../docs/design/system/source-preservation-ladder.md))
   but is documented mechanically. A one-line framing — *you don't outgrow the
   parser: syntax we don't model is preserved verbatim, never dropped* — belongs
   in README/comparison copy.
2. **A task-first example catalog.** Their catalog is organized by user intent,
   not by API unit. Our examples corpus is organized by family and Style.
   An intent-oriented index ("show a decision", "compare timelines", "explain a
   schema"), plus a machine-readable catalog entry for agents alongside
   `llms.txt` and `am capabilities --json`, would serve the agent that knows its
   task but not Mermaid's family names. The routing half now exists as
   [`choosing-a-diagram.md`](../docs/choosing-a-diagram.md), surfaced in the
   diagram workflow skill; the machine-readable catalog entry remains a
   candidate.
3. **Granularity as measured need, not default.** Their per-mark subpaths solve
   a real app-bundle problem. Our consumers are CLIs, agents, and workers, and
   we already split `agentic-mermaid/agent` from `agent/core`. Measure
   workerd/browser bundle cost before considering per-family entrypoints;
   registry citizenship (lesson 12) argues against splitting without evidence.

## Where we deliberately diverge

1. **Grammar versus enumerated families — the core contrast.** TanStack Charts
   escapes the chart-type treadmill by refusing to have chart types. Mermaid
   *is* the enumerated-type treadmill, and its corpus plus native host
   rendering (GitHub, GitLab, Notion, Obsidian) is the moat this fork is built
   on ([`AGENT_NATIVE.md`](../AGENT_NATIVE.md)). Both projects answer the
   same question — what happens when the model doesn't fit — with opposite
   mechanisms: they let authors drop to composable primitives; we preserve the
   unmodeled source losslessly and verify what we do model. Composition stays
   consciously deferred here: agents paste and edit, and the evidence has not
   yet demanded more.
2. **Interaction and motion layers.** First-class grammar layers for them;
   a non-goal here. Our artifacts are static and reviewable — SVG/PNG in docs
   and PRs, ASCII in terminals — and [`comparison.md`](../docs/comparison.md)
   already says interactivity is not a focus. Unchanged.
3. **The xychart boundary.** For genuine in-app data visualization, a chart
   grammar (TanStack Charts, Observable Plot) serves an agent better than
   Mermaid's small enumerated `xychart-beta` model. Our
   [xychart](../docs/design/families/xychart.md) exists for Mermaid-corpus
   compatibility, not charting ambition. Saying so in `comparison.md`'s
   choosing guidance fits `PRODUCT.md`'s honest-constraints principle.

## The gap that stays ours

Their guarantees end at the type checker. A spec that compiles says nothing
about the rendered artifact — occlusion, contrast, label fit, crossings. The
one determinism promise in their docs is scoped to hydration: the SSR guide
renders "deterministic chart markup on the server" so the browser can adopt
it, which is determinism in service of framework plumbing, not a CI-gated
byte-identity guarantee on artifacts. Nothing on the reviewed pages verifies
the rendered result or claims a round-trip.
The differentiators here — `verifyMermaid`'s three warning tiers, the
[deterministic layout rubric](../docs/design/system/layout-rubric.md), CI-gated
byte-identical output, and the round-trip contracts — are the *feedback* half
of agent-native: an agent needs to know what the render actually did, not only
that the spec typechecked. If "designed for humans and agents" becomes table
stakes for authoring surfaces — TanStack adopting the framing suggests it
will — artifact verification is the axis competitors have not claimed. Keep
investing there.

## Implementation notes (repository, 2026-08-10)

The pinned `TanStack/charts` revision
[`c17d6772`](https://github.com/TanStack/charts/tree/c17d6772ba20f0edc32a5da80130871d7398a2a6)
shows how the "for humans and agents" posture was run day to day on 2026-08-10.
Five practices stand out.

1. **The friction log is the engine.** `API-FRICTION.md` (~7,700 lines) is
   "the durable feedback loop for building the API with itself." Every entry
   records the concrete task where the difficulty appeared, expected versus
   actual authoring experience, a decision, and the verification that closed
   it; the repo `AGENTS.md` requires agents to read it before touching the
   public API and to log friction from actual tasks — "Do not add speculative
   wishlist items." A triage table assigns each finding to API, Documentation,
   Skill, Application, or Tooling, with the rule "Do not hide API problems in
   a skill." Our dated
   [contributor lessons](../docs/contributing/lessons-learned.md) capture
   retrospectives; we have no per-task log of agent-observed API friction with
   owners and closing verification. That log is the most adoptable single
   artifact in the repository.
2. **Chart choice belongs to the skill layer — their words.** The triage table
   routes a difficulty to Skill "when the difficulty is data analysis, chart
   choice, or multi-step authoring," and their
   `docs/guides/choosing-a-chart.md` opens with the doctrine "A chart type is
   the result of that decision, not the starting point," then runs a
   reader-task table, a data-shape checklist, a smallest-complete-composition
   ladder, a misleading-defaults list, and a readiness checklist.
   [`choosing-a-diagram.md`](../docs/choosing-a-diagram.md) adopts that skeleton
   for our families, and the diagram-workflow skill now carries the routing
   doctrine. The inverse rule is worth keeping too: when routing guidance
   exists to paper over a confusing operation, fix the operation.
3. **Docs are single-owner and `llms.txt` is generated.** Their `llms.txt`
   opens "Each concept is documented once; guides and examples link back to
   its owner page," and `AGENTS.md` forbids editing the generated copies
   (`pnpm docs:sync` owns them). Same shape as our registry-derived docs and
   `am llms-txt`; convergence, not a gap.
4. **Comparisons are measured against exact pins.** Their `docs/comparison.md`
   distinguishes measured libraries from documentation-reviewed ones, pins
   competitor versions exactly ("not latest versions inferred at page render
   time"), and refuses "turning untested behavior into a checkmark"; a
   `competitor-profiles/` directory keeps the raw evidence and states where
   the competitor wins today. Our
   [`comparison.md`](../docs/comparison.md) already pins versions; the
   measured-versus-documented split is the discipline worth copying at the next
   refresh.
5. **Portability had to be designed; ours is inherited.** Because their chart
   definitions hold live functions, `PORTABLE-CHART-SPEC.md` sketches a JSON
   `$call` format resolved through a function registry just to make a chart
   serializable. Our portable format is the Mermaid source itself — the corpus
   moat restated at the wire level, with nothing to build or version.

Two smaller observations. Accessibility is a required input, not an option:
every DOM host demands `ariaLabel`, and the SVG renderer emits the image role,
a chart roledescription, and a `<desc>`; a Tier 3 lint nudging a missing
`accTitle` on large diagrams would be our equivalent (candidate only). And the
core package carries 85 colocated test files across 174 sources plus
per-adapter SSR test configs — the same per-surface gating instinct as our
family-citizenship checks, pointed at frameworks instead of output surfaces.

## Sources

Reviewed 2026-08-10 at commit
[`c17d6772ba20f0edc32a5da80130871d7398a2a6`](https://github.com/TanStack/charts/commit/c17d6772ba20f0edc32a5da80130871d7398a2a6):

- [`README.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/README.md)
  — tagline, feature summary, catalog scope, and the statement on AI-agent
  implementation.
- [`docs/overview.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/overview.md)
  — pitch, dual-audience statement, accessibility posture, and pre-alpha caveat.
- [`docs/concepts/grammar-of-graphics.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/concepts/grammar-of-graphics.md),
  [`docs/reference/chart-definitions.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/reference/chart-definitions.md),
  [`docs/reference/runtime-and-scene.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/reference/runtime-and-scene.md),
  and [`docs/reference/index.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/reference/index.md)
  — grammar layers, definition/scene compilation, module organization, subpath
  exports, and naming conventions.
- Repository implementation evidence:
  [`AGENTS.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/AGENTS.md),
  [`API-FRICTION.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/API-FRICTION.md),
  [`docs/guides/choosing-a-chart.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/guides/choosing-a-chart.md),
  [`docs/comparison.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/comparison.md),
  [`docs/guides/accessibility.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/guides/accessibility.md),
  [`docs/guides/ssr-and-hydration.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/docs/guides/ssr-and-hydration.md),
  [`PORTABLE-CHART-SPEC.md`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/PORTABLE-CHART-SPEC.md),
  [`competitor-profiles/`](https://github.com/TanStack/charts/tree/c17d6772ba20f0edc32a5da80130871d7398a2a6/competitor-profiles),
  [`llms.txt`](https://github.com/TanStack/charts/blob/c17d6772ba20f0edc32a5da80130871d7398a2a6/llms.txt),
  and the [`packages/charts-core` source tree](https://github.com/TanStack/charts/tree/c17d6772ba20f0edc32a5da80130871d7398a2a6/packages/charts-core/src).
