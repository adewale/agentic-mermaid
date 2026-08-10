# TanStack Charts v0: learnings for Agentic Mermaid

**Status.** External-survey research note, written 2026-08-10 against
[tanstack.com/charts/v0](https://tanstack.com/charts/v0) (docs reported version
0.9.0, self-described "pre-alpha and its API may change between releases").
Facts and quotes come from the pages listed under [Sources](#sources); TanStack
Charts moves quickly, so treat specifics as dated. This note records what an
adjacent, independently designed "for humans and agents" library validates,
what is worth adopting, and where this project deliberately diverges. It is
analysis, not backlog: any follow-up promoted from here gets its own `TODO.md`
entry first.

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
- `defineChart()` compiles a declaration into a renderer-neutral `ChartScene`;
  the "SVG renderer, DOM and framework hosts, static exporter, and custom
  renderers" all consume that one scene object.
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
   equally important authors" is the thesis of [`AGENT_NATIVE.md`](../../AGENT_NATIVE.md)
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
   [system architecture](../design/system/README.md) and the
   [SVG semantic contract](../svg-semantic-contract.md)); the same shape as
   lesson 8 in [`lessons-learned.md`](./lessons-learned.md) — final pixels and
   public projections must agree because they come from one scene.
4. **Headless core, thin adapters.** Their optional framework adapters over a
   framework-free core match [`react.md`](../react.md)'s `useMemo` wrapper and
   [`browser.md`](../browser.md)'s adapters over the synchronous renderer.
5. **Accessible, browserless SVG as a default, not a mode.** Their
   accessible-SVG-by-default posture matches the zero-DOM renderer plus
   `accTitle`/`accDescr` and the accessibility section of the SVG semantic
   contract.
6. **A compiler-gated example corpus.** "All examples compile under strict
   TypeScript" makes the docs a tested artifact. The analogue here is the
   [dogfooded docs pipeline](./dogfooding-docs-strategy.md) and the website
   examples corpus rendered by our own renderer; the stated contract worth
   keeping sharp is "every published example parses, renders, and verifies."
7. **Agent-built, human-reviewed development works at production scale.** Their
   stated process (agents implement under supervision; humans review and
   accept) is this fork's process. Useful as external evidence when the
   process itself is questioned.

## Worth adopting

1. **State the retention promise as a promise.** "You don't have to outgrow"
   names the adopter's real fear — hitting a wall and rewriting. Our mechanism
   is arguably stronger (never-lossy structured-or-opaque parsing and the
   [source-preservation ladder](../design/system/source-preservation-ladder.md))
   but is documented mechanically. A one-line framing — *you don't outgrow the
   parser: syntax we don't model is preserved verbatim, never dropped* — belongs
   in README/comparison copy.
2. **A task-first example catalog.** Their catalog is organized by user intent,
   not by API unit. Our examples corpus is organized by family and Style.
   An intent-oriented index ("show a decision", "compare timelines", "explain a
   schema"), plus a machine-readable catalog entry for agents alongside
   `llms.txt` and `am capabilities --json`, would serve the agent that knows its
   task but not Mermaid's family names.
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
   on ([`AGENT_NATIVE.md`](../../AGENT_NATIVE.md)). Both projects answer the
   same question — what happens when the model doesn't fit — with opposite
   mechanisms: they let authors drop to composable primitives; we preserve the
   unmodeled source losslessly and verify what we do model. Composition stays
   consciously deferred here: agents paste and edit, and the evidence has not
   yet demanded more.
2. **Interaction and motion layers.** First-class grammar layers for them;
   a non-goal here. Our artifacts are static and reviewable — SVG/PNG in docs
   and PRs, ASCII in terminals — and [`comparison.md`](../comparison.md)
   already says interactivity is not a focus. Unchanged.
3. **The xychart boundary.** For genuine in-app data visualization, a chart
   grammar (TanStack Charts, Observable Plot) serves an agent better than
   Mermaid's small enumerated `xychart-beta` model. Our
   [xychart](../design/families/xychart.md) exists for Mermaid-corpus
   compatibility, not charting ambition. Saying so in `comparison.md`'s
   choosing guidance fits `PRODUCT.md`'s honest-constraints principle.

## The gap that stays ours

Their guarantees end at the type checker. A spec that compiles says nothing
about the rendered artifact — occlusion, contrast, label fit, crossings — and
the pages reviewed make no determinism, verification, or round-trip claims.
The differentiators here — `verifyMermaid`'s three warning tiers, the
[deterministic layout rubric](../design/system/layout-rubric.md), CI-gated
byte-identical output, and the round-trip contracts — are the *feedback* half
of agent-native: an agent needs to know what the render actually did, not only
that the spec typechecked. If "designed for humans and agents" becomes table
stakes for authoring surfaces — TanStack adopting the framing suggests it
will — artifact verification is the axis competitors have not claimed. Keep
investing there.

## Sources

Reviewed 2026-08-10:

- <https://tanstack.com/charts/v0> — landing page (tagline, feature summary,
  catalog scope, packages).
- <https://tanstack.com/charts/v0/docs/overview> and
  <https://tanstack.com/charts/latest/docs/overview> — pitch, dual-audience
  statement, accessibility posture, version/pre-alpha caveat.
- <https://tanstack.com/charts/v0/docs/concepts/grammar-of-graphics> — grammar
  layers, `ChartScene`, lineage.
- <https://tanstack.com/charts/v0/docs/reference/index> — module organization,
  subpath exports, naming conventions.
- <https://github.com/TanStack/charts> — repository description and the
  project's statement on AI-agent implementation (surfaced via web search).
