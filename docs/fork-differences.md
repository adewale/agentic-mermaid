# What is different about this fork?

This document describes **Agentic Mermaid**, the `adewale/agentic-mermaid` fork, relative to upstream `lukilabs/beautiful-mermaid`. It is intentionally product/documentation focused; upstreamable changes should still be split into small PRs.

Scope checked on **2026-10-17**: Agentic source at
[`3ef2fb8`](https://github.com/adewale/agentic-mermaid/tree/3ef2fb8beff21359fb6e3b798e025a3d69311539),
Beautiful main at
[`2ac8bbbb`](https://github.com/lukilabs/beautiful-mermaid/tree/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488)
and the package comparator `beautiful-mermaid@1.1.3`. Source capability is not
deployment evidence: Agentic source declares 0.4.2, while npm and the public
site/MCP still serve 0.4.1 at this check. See [#378](https://github.com/adewale/agentic-mermaid/issues/378).
Open PRs are proposals, not upstream releases; the related Zombie/C4 comparison
and historical-version qualifications are in [`comparison.md`](./comparison.md#zombie-mermaid-and-c4-bloodlines).

## Live site

The canonical live site is **[agentic-mermaid.dev](https://agentic-mermaid.dev/)** — a Cloudflare Workers Static Assets deployment built from [`website/`](../website):

- Home & docs: <https://agentic-mermaid.dev/>
- Live editor: <https://agentic-mermaid.dev/editor>
- Family comparisons (Mermaid vs Beautiful Mermaid vs Agentic Mermaid): <https://agentic-mermaid.dev/comparisons/>

<!-- complete: hosted-mcp-tools -->
Alongside the static surface (the public website, machine-readable manifests, schemas, recipes, and skill files), the Cloudflare Worker serves a stateless hosted MCP endpoint at `/mcp` (`https://agentic-mermaid.dev/mcp`) — registry-checked tools: Code Mode `execute` in per-request Dynamic Worker isolates, `describe_sdk` for one family's mutation schema on demand, the `render_svg`/`render_ascii`/`render_png`/`verify`/`describe` pure tools, and the declarative `mutate`/`build` structured-edit tools. There is still no REST render API: `/mcp` speaks MCP JSON-RPC only.

GitHub Pages is no longer a deployed surface; its samples-gallery generator has been retired. The live editor is served at [agentic-mermaid.dev/editor](https://agentic-mermaid.dev/editor) and built by `scripts/site/editor.ts` (also used by `website/build.ts`), and is exercised in a real browser by `e2e/browser.test.ts`.

## Agent-native workflow (largest fork-vs-upstream gap)

Agentic Mermaid is published as `agentic-mermaid` and adds a typed editing surface for AI agents under the `agentic-mermaid/agent` subpath export, plus an `am` CLI and an `agentic-mermaid-mcp` Code Mode MCP server (stdio plus opt-in HTTP/SSE transport with managed render artifacts). A render-only library forces an agent to regenerate the whole diagram to change one node; here, new diagrams are authored as source then parsed/verified/rendered, while existing structured diagrams go parse → narrow → mutate → verify → serialize.

Every registered family is structured when narrowed; segment-preserving families retain unsupported statements in source order, and any whole-body fallback round-trips losslessly. Layout is deterministic and verified byte-identical across processes, and `verifyMermaid` returns structured structural, geometric, and lint warnings plus perceptual quality metrics covering every family. See [`AGENT_NATIVE.md`](../AGENT_NATIVE.md) and [`Instructions_for_agents.md`](../Instructions_for_agents.md). Upstream has no equivalent; for a three-way functionality view including Mermaid itself, see [`comparison.md`](./comparison.md).

## New and expanded diagram support

The checked source renders a wider set of Mermaid families in both the gallery and editor:

<!-- complete: family-ids -->
- Flowcharts and state diagrams
- Architecture diagrams (`architecture-beta`, or `architecture`)
- Sequence diagrams
- Class diagrams
- ER diagrams
- Timeline diagrams (`timeline`)
- User Journey diagrams (`journey`)
- XY charts (`xychart` and `xychart-beta`)
- Pie charts (`pie`, with `showData`)
- Quadrant charts (`quadrantChart`)
- Gantt charts (`gantt`) with date axes, sections, dependencies, milestones, exclusions, and vertical markers
- Mindmaps (`mindmap`) with indentation-sensitive hierarchy, shapes, icons, and classes
- Git graphs (`gitGraph`) with deterministic replayed commits, branches, merges, and cherry-picks
- Radar charts (`radar-beta`) — spider/star charts plotting multivariate profiles across equi-angular axes from a shared center
- Sankey diagrams (`sankey`, `sankey-beta`) — CSV-style flows whose ribbon widths are conserved across stages (`FLOW_IMBALANCE` flags an unbalanced node)

The source editor has registry-backed example coverage for every built-in family
(`src/__tests__/editor-examples.test.ts`). Browser E2E still spot-checks several
fork-added rendering paths: architecture, timeline, journey, and xychart.

## Style + Palette SVG rendering

The fork adds a consistent Style + Palette API across diagram families:

```ts
renderMermaidSVG(source, {
  style: ['publication-figure', 'github-light'],
  seed: 2,
})
```

A style chooses the renderer treatment — for example `hand-drawn`, `watercolor`, `publication-figure`, or `ops-schematic`. A palette-only style chooses colors — for example `github-light`, `dracula`, or a custom JSON record with `colors`. Stacks merge left to right, so agents can keep visual requests out of Mermaid source while preserving deterministic geometry.

## Migrating from upstream: every export this fork does not have

Upstream Beautiful Mermaid's entry point exports 16 names. Ten are still
exported here with the same meaning: `renderMermaidSVG`, `renderMermaidASCII`,
`renderMermaidSVGAsync`, `fromShikiTheme`, `DEFAULTS`, and the `RenderOptions`,
`AsciiRenderOptions`, `DiagramColors`, `MermaidGraph`, and `PositionedGraph`
types.

These six are not, and each fails differently. `THEMES` is the one that bites
hardest, because destructuring it yields `undefined` rather than an import
error, so the failure lands later and elsewhere.

| Upstream | Replacement | Notes |
|---|---|---|
| `THEMES` | `{ style: 'name' }` | Theme **names** survive as style names; the map does not. `THEMES['zinc-dark']` → `{ style: 'zinc-dark' }`. |
| `ThemeName` | `string`, validated by `knownStyles()` | Style names are open — custom styles register at runtime — so there is no closed union to import. |
| `parseMermaid` | `parseRegisteredMermaid` | **Different shape.** Upstream returns a `MermaidGraph` directly; this returns a result: `{ ok: true, value }` or `{ ok: false, error }`. Check `ok` instead of catching. |
| `renderMermaid` | `renderMermaidSVGAsync` | Upstream alias for the async SVG renderer. |
| `renderMermaidSync` | `renderMermaidSVG` | Upstream alias; `renderMermaidSVG` is already synchronous here. |
| `renderMermaidAscii` | `renderMermaidASCII` | Casing-only alias upstream. This fork exports the capitalised spelling only. |

So a `THEMES` port fails at runtime with `TypeError: Cannot read properties of
undefined (reading 'zinc-dark')`, while `parseMermaid` fails at import — and the
three aliases fail at import too, which is the easy case.

`zinc-light`, `zinc-dark`, `dracula`, `nord`, `tokyo-night`, and the rest of the
upstream theme names are all valid style names; `knownStyles()` lists every
registered one.

The table above provides migration guidance. Installed package consumer tests
check the shipped runtime exports and TypeScript declarations, including refusal
of removed aliases.

## Mermaid config and source wrappers

This fork supports Mermaid-style source wrappers before diagram headers, including:

- YAML frontmatter
- `%%{init: ...}%%` directives
- `%%{initialize: ...}%%` directives
- Mermaid comments before the header

These are merged with `options.mermaidConfig` where supported. XY chart and architecture rendering use this to honor Mermaid-compatible theme/config fields.

Frontmatter is read as Mermaid reads it, with js-yaml's `JSON_SCHEMA` rules, and frontmatter that is not valid YAML rejects the diagram, as in Mermaid. `%%{init}%%` directives keep their lenient reader, because Mermaid reads them with `JSON.parse` rather than YAML.

## Showcase and editor discovery

Users can discover fork features through:

1. The [examples page](https://agentic-mermaid.dev/examples/), including supported families, Style + Palette combinations, and the richer shared examples corpus.
2. The [live editor](https://agentic-mermaid.dev/editor), which starts with examples for every supported diagram family.
3. [`README.md`](../README.md) quick starts and docs routing.
4. [`CHANGELOG.md`](../CHANGELOG.md) for user-facing change history.

## Layout and quality work

- A layout before/after comparison harness (`eval/layout-compare/`) and per-family `RenderedLayout` adapters so perceptual metrics gate layout changes with evidence. Debug JSON can also expose opt-in graph route certificates, family edge-route certificates, region-containment certificates, and region/action sidecars for tooling; default JSON stays compact.
- The version-pinned Beautiful Mermaid 1.1.3 comparison records different decision-branch routing and subgraph-container attachment. Agentic uses facet-mid diamond ports and honors container direction overrides. Inspect the same-source [comparison page](https://agentic-mermaid.dev/comparisons/) for the deployed examples; selected similar or different renders do not establish general parity, merged ancestry or the status of an upstream issue.
- Implemented here, with upstream proposals still open as of 2026-10-17:
  fan-in grouping ([Beautiful Mermaid PR #69](https://github.com/lukilabs/beautiful-mermaid/pull/69))
  and labeled fan-out trunk sharing with box-start connector placement
  ([PR #113](https://github.com/lukilabs/beautiful-mermaid/pull/113)). Open proposals
  are not evidence of upstream release inclusion or identical rendering.
- ER cardinality parsing matches Mermaid's lexer exactly; malformed relationship lines error loudly instead of being silently dropped.

## Parser semantics and migration boundaries

**Membership has two stages: collect candidates, then resolve ownership.**
Flowchart and ER use the shared **first-subgraph-to-close** rule for competing
candidates: at each `end`, keep candidates not already owned by an earlier-closed
subgraph, once each. An inner subgraph closes before its enclosing subgraph.
Creation and membership are separate decisions:

- Flowchart node statements and edge endpoints collect their identities in the
  current subgraph, even when already known. A `style` statement that creates a
  node does not collect it. References to a declared subgraph collect its group
  identity, independently of whether its declaration precedes the reference.
  Group references resolve after declarations close; the result is a tree, so
  a reference cannot make a group contain itself or one of its ancestors.
- ER collects entity declarations and entity endpoints of relations, even for
  entities already named at top level. A prior top-level mention does not prevent
  a later ER subgraph from keeping that entity. A style directive alone does not
  collect an entity; a relation endpoint naming an already-opened group refers
  to its boundary. A reference before that group's declaration creates an entity.

For example:

  ```mermaid
  flowchart TB
      c1-->a2
      subgraph one
      a1-->a2
      end
      subgraph two
      b1-->b2
      end
      subgraph three
      c1-->c2
      end
  ```

Here `one` keeps `a1` and `a2`, and `three` keeps `c1` and `c2`. The earlier edge
created `c1` and `a2` without assigning a group. When two subgraphs collect the
same candidate, the one that closes first keeps it. A later cross-group link
does not move an identity out of an already-closed owner. Serialization emits
this resolved membership before links so the same rule applies on re-reading.

The [Flowchart candidate collector](https://github.com/adewale/agentic-mermaid/blob/3ef2fb8beff21359fb6e3b798e025a3d69311539/src/parser.ts#L1276-L1321),
[shared membership authority](https://github.com/adewale/agentic-mermaid/blob/3ef2fb8beff21359fb6e3b798e025a3d69311539/src/shared/subgraph-membership.ts)
and [ER public-boundary regressions](https://github.com/adewale/agentic-mermaid/blob/3ef2fb8beff21359fb6e3b798e025a3d69311539/src/__tests__/er-subgraph-membership.test.ts)
record this rule. Agreement on this grammar decision is not a promise of
Mermaid pixel/layout parity. Current deliberate reader extensions and source
preservation limits live in [`project/divergences.md`](./project/divergences.md).

State resolves authored identities and scopes before building either the
editable body or the render graph. A reference inside a composite can establish
the scope of a later definition; a root reference alone establishes no parent.
Each identity belongs to one scope, and a composite retains its first placement
when reopened. Initial and final `[*]` endpoints each name one pseudostate per
scope, with independent identities in concurrent regions. Generated region and
endpoint names cannot alias authored names.
The writer checks its emitted ownership against the typed body using that same
resolver. An edit that cannot retain the requested scope returns an error;
for example, moving a state to root while a transition inside its former
composite would claim it again. Move or remove the conflicting transition first.

Named floating notes (`note "text" as N`) retain their text and scope in
`StateBody.floatingNotes`. Their identities are independent of state identities,
so a state and a note may both be named `N`. The State operations
`add_floating_note`, `set_floating_note_text` and `remove_floating_note` edit
these annotations. Scope rename, removal and dissolution carry the annotations
with their scope; serialization, SVG and terminal rendering preserve them.

### ER parent endpoints

ER's left endpoint can use `u` for the parent marker, independently of the four
crow's-foot cardinalities. The native and typed models retain `parent`; SVG
draws a hollow diamond and terminal output draws `◇` (`o` in plain ASCII). The
writer and `add_relation` admit this marker only before the connector, where
pinned Mermaid's lexer accepts it.

### Sequence text controls

Sequence `wrap:` and `nowrap:` are source controls, separated from text before
entity decoding. Messages, notes, participant aliases, box titles and fragment
captions retain the control; explicit controls override the diagram default.
SVG measures wrapped text with a pixel budget; terminal output uses its own cell
budget. An explicit `nowrap:` still preserves authored line breaks. Typed text
edits retain the control, and typed strings beginning with control-like text are
encoded as literal text. `set_message_wrap` and `set_fragment_message_wrap` accept
`true`, `false`, or `null` to restore inheritance.

## What is intentionally not in this fork

- No committed `dist/` artifacts.
- No large bundled upstream PR: upstream contributions should remain focused and independently reviewable.

## Upstreaming strategy

The fork should continue extracting small upstreamable PRs from broad fork work. This file is not the backlog: parked fork-port ideas live only under `PARK-3` in `TODO.md` until one is promoted to a focused issue.

## Original upstream assertion runs

The [original assertion runner](../eval/mermaid-upstream-assertions/README.md)
executes pinned source test bodies rather than harvested input samples. Its
family breakdown distinguishes native refusals, assertion mismatches, unmapped
APIs, reference-control failures, skips and collection errors.
