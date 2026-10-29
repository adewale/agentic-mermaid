# Mermaid renderers and Agentic Mermaid

The [Modern Mermaid application benchmark](./comparisons/modern-mermaid.md)
(23 October 2026) covers its editor, themes, exports, sharing and dependency
engine. Modern Mermaid wraps upstream Mermaid; it is recorded in the community
inventory as an application, outside the browserless renderer peer ranking.
The [community discovery and categories](../eval/fork-graph/README.md#community-discovery-and-categories)
include editors and integrations independently of renderer benchmark eligibility.

The [22 October owned-layout community comparison](design/system/layout-community-comparison.md)
compares the six-family native backend with ELK and the community approaches,
using a separately versioned, fully consumed public-SVG experiment. The older
measurements below retain their original renderer revisions and protocols.

## Pele comparison — checked 18 October 2026

[Pele](https://github.com/obsidianmd/pele) is an independently maintained,
browserless SVG renderer. Its inspected main is
[`458322a5b8abb1ae57ddf127c32017ab9fb14a92`](https://github.com/obsidianmd/pele/tree/458322a5b8abb1ae57ddf127c32017ab9fb14a92)
(17 October 2026). Published **1.6.0**, released 17 October, has npm provenance
pointing to `659c3593ce43794dce7ec7ab45d424ad2de182a5`; the intervening main
changes do not change library code. Public source and installed-package APIs
were exercised separately. The fetched documentation at <https://pele.run/api>
describes that API; fetching documentation does not establish deployment bytes.

At this initial comparison snapshot, Pele targeted Mermaid **12.1.0** and
Agentic's writing contract was **11.16.1**. The subsequent rebase updated
Agentic's pin to **12.2.0** without relabeling this historical snapshot.
Pele's source/package registry rendered 33 family examples; Agentic's
source registered 17 native families including C4. Those are breadth
observations, not construct-fidelity scores. Agentic npm and the live
capabilities endpoint still report **0.4.1** at this check: native C4 in this
branch is not available merely by installing that release.

| Dimension | Pele 1.6.0 / inspected source | Agentic at the initial snapshot |
| --- | --- | --- |
| Primary workflow | Render SVG; browser `mount`, refresh, zoom and error display | Parse, edit, verify, serialize and render through library, CLI and MCP |
| Syntax breadth | All 33 registered families, targeting Mermaid 12.1.0 | 17 native families; unsupported source preservation has an explicit disposition |
| Output | SVG and dimensions; host can rasterize it separately | SVG, offline PNG, connected ASCII/Unicode, layout, facts, action metadata and receipts |
| Model and edits | Public parsed models; render authority is associated with the original model, so a JSON-rehydrated model is rejected; no public mutation/serialization API found | Typed edits and serialization closure; unknown syntax stays verbatim and prevents unsafe edits |
| C4 interactions | Measured repeated-pair witness overwrites the first interaction; explicit RelIndex 99 is displayed as an ordinal | Each occurrence, explicit index and source order remain distinct; Back/BiRel semantics survive both projections and edits |
| C4 presentation | Explicit shape overrides, formatted labels and responsive reflow | Explicit bounded shape overrides, literal label policy, recursive boundaries, independently measured cell geometry and diagnosed projection losses |
| Browser usability | Font-aware `mount`, ResizeObserver-driven width adaptation, zoom, CSS variables and host sanitizer callback | Lazy family loading, editor/export flows, composable looks and palettes; no equivalent public automatic mount/reflow API |
| Accessibility | Default SVG document role and C4 description; authored accessibility directives | C4 root name/role, authored directives, structured semantic tree, facts and owned actions; no screen-reader usability study claimed |
| Security | Escaping, filtered links/styles, bounded source/output; supplied icon SVG is trusted host content | Shared immutable Scene admission, final output security, safe paint/URL admission; safe actions remain inert metadata until host activation |
| Extension model | Register/load supported detector families; registering an arbitrary new type does not add a detector | Public family/backend extension contracts with declared roles, primitives, capabilities and validation |
| Runtime/package | Node >=20, no runtime dependencies; monolithic, core, lazy and per-family entries | Node >=22 or Bun >=1.4; native raster dependency for Node PNG; separate browser lazy entry and measured request graphs |
| Resource bounds | Default 50,000-character source and 4,000,000-character SVG limits; bounded collision work and host-terminable workers for hard deadlines | Immutable Scene/data and final SVG byte bounds; existing execution sandbox, explicit terminal-width refusal and forward lexer progress; no standalone lexer cancellation API |
| Licensing and reuse | MIT library with separately attributed Mermaid grammar/spec fixtures | MIT fork with inherited notices; this C4 work adds no dependency or copied Pele implementation |
| Quality evidence | Mermaid parser specs, differential fuzzing and its own layout tests | Source/edit properties, upstream accepted syntax, Scene fidelity, emitted geometry, actual terminal ink, transports and packaged/browser contracts |

The repeated-interaction observation was reproduced through both Pele source
and its published package. For `Rel(a,b,"First")`, `Rel(a,b,"Second")`,
`RelIndex(99,b,a,"Back")`, Pele emits two interactions and loses First and the
displayed 99. Agentic emits three. This is a semantic usability difference,
not a request for pixel parity. Conversely, Pele's four-system C4 fixture
reflows from 1180px to 232px with `maxWidth:320`; deterministic Agentic geometry
does not offer that browser width-adaptation contract.

This review adopted explicit shape selection using existing Agentic motifs,
fixed person/label collisions under zero padding and retained outlines in
hatched styles. It also enriches C4's accessible semantic tree. It rejects
pair deduplication, treating source order as an explicit dynamic index, inferring
shape from arbitrary sprite/tag names, and silently claiming an unsupported
shape effect. `rounded` and `component` shape overrides remain preserved and
diagnosed instead of being collapsed into a box without warning.

Pele's open [C4 spacing PR #2](https://github.com/obsidianmd/pele/pull/2),
head `08b7d6772bee7f6591714ce18f6f16162f865577`, explicitly leaves compact
width/high-font cases unresolved. Its [compound crossing PR #4](https://github.com/obsidianmd/pele/pull/4),
head `57913413aa1f553650b03e2ddaa5100a142c94dd`, remains a proposal; its
author's timing claims were not adopted as current measurements. Useful next
work is opt-in browser mount/reflow and better compact/dense layouts, measured
separately from preserving their meaning. Broader native families require their
own parser, editing, output and metadata contracts; a smoke-render total cannot
substitute for those boundaries.

Shared Mermaid syntax and MIT-licensed grammar/spec fixtures establish language
and test lineage. They do not establish Pele as a Beautiful/Agentic fork.
Agentic and Zombie do descend from Beautiful; the related terminal projects and
C4 proposals below supply behavioral examples with their own ancestry.

### Performance evidence

Current methods, fixed source/package identities, scoped findings and remaining
measurement gaps live in [benchmark evidence](https://github.com/adewale/trident/blob/main/RESULTS.md).
The 18 October Node/browser/startup/payload tables and bounded C4 A/B runs are
[immutable historical observations](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/docs/comparison.md#fresh-performance-observations),
not measurements of the frozen 0.5 candidate. Their exact versions, environments
and exclusions remain there instead of becoming competing current scorecards.

Agentic still has substantial warm-render, startup and usable-browser-payload
gaps against the faster peers. Additional editing, verification and trust
contracts explain different work; they do not excuse avoidable cost or prove
competitive speed. Pele has no native terminal API. Beautiful 1.1.3 rejects C4,
and its tested terminal mesh loses expected labels: neither is a successful
fast render. Returned SVG text and parseable labels do not prove arbitrary
connectivity, visual quality or semantic fidelity. Browser return latency is
separate from paint, real-network transfer and PNG throughput.

Use this page to decide which of the three projects fits your task. The
table maps the three primary projects; the related Zombie/C4 comparison below
distinguishes implemented outputs from preserved source and proposals.

- **[Mermaid](https://github.com/mermaid-js/mermaid)** (`mermaid`) is the
  original. It defines the grammar that both other projects implement,
  supports a broader diagram catalogue, and is rendered natively by GitHub,
  GitLab, Notion, and Obsidian — which is why most diagrams-as-text you will
  encounter are written in its language.
- **[Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid)**
  (`beautiful-mermaid`, by Craft) re-implements Mermaid rendering as a
  synchronous TypeScript library: it computes layout itself and emits SVG
  strings, so it runs in Node, Bun, or an edge function with no browser and
  no Puppeteer. Its theming derives a full palette from two colors and
  accepts Shiki/VS Code themes directly, and it renders to ASCII/Unicode for
  terminals. It is the foundation this fork is built on.
- **Agentic Mermaid** (`agentic-mermaid`, this repo) extends Beautiful
  Mermaid for programs that edit diagrams — AI agents foremost. It adds a
  typed parse → mutate → verify → serialize loop, byte-identical output
  across runs, structured verification, and CLI/MCP surfaces. The trade is explicit: the checked registry covers a focused subset of Mermaid's
  broader catalogue in exchange for the guarantee that parsing and re-serializing
  a diagram never drops syntax.

## Comparison scope — checked 2026-10-17

This dated comparison used a Mermaid 11.16 syntax/fixture baseline. The current
writing/reference target is Mermaid 12.2.0 (source commit
`1fb7869866dd619168d840291c9c54b4f129758b`), recorded in the
[upstream policy](./project/upstream-mermaid-policy.json); imported fixtures and
comparison renders retain their recorded provenance. The Beautiful package comparator
is **1.1.3**, not every unmerged contribution. Its inspected main is
[`2ac8bbbb`](https://github.com/lukilabs/beautiful-mermaid/tree/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488).
Agentic claims here refer to source
[`3ef2fb8`](https://github.com/adewale/agentic-mermaid/tree/3ef2fb8beff21359fb6e3b798e025a3d69311539)
(declares **0.4.2**); npm and the public deployment still report **0.4.1** at
this check. Installing that release is not equivalent to using current source.

A merged main commit, an npm version, an open PR and a historical benchmark are
different evidence. The [release issue](https://github.com/adewale/agentic-mermaid/issues/378)
tracks delivery; compare peer changelogs and the exact version you install rather
than treating this dated page as a continuously verified scorecard.

## At a glance

| | Mermaid | Beautiful Mermaid | Agentic Mermaid |
|---|---|---|---|
| Primary job | Define and render the diagram language everywhere | Fast, beautiful, browserless rendering | Agent-safe diagram *editing* plus rendering |
| Runtime | Browser DOM (Node via Puppeteer/`mermaid-cli`) | Browserless TypeScript renderer | Browserless SVG/terminal; native resvg for Node PNG; lazy browser ESM entry |
| Diagram types | Broad Mermaid catalogue, including newer experimental families | Flowchart, state, sequence, class, ER, and XY chart | Registry-backed subset listed by `am capabilities --json` |
| Output formats | SVG (PNG/PDF via CLI tooling) | SVG, ASCII/Unicode | SVG, PNG (offline resvg), ASCII/Unicode, JSON layout |
| Theming | Theme config + CSS | Two-color foundation, 15+ named themes, Shiki/VS Code compatibility, live CSS-variable switching | Style + Palette stacks: named looks, palette-only styles, custom JSON records, and deterministic seeds |
| Parse to a typed AST for editing | — (internal parser, not an editing API) | — (render-only API) | ✅ `parseRegisteredMermaid` → typed `ValidDiagram` |
| Typed mutation | — | — | Registered families expose modeled edits; opaque/source-preserved bodies refuse typed mutation |
| Structural verification | — | — | ✅ 3 warning tiers + perceptual quality metrics, all families |
| Deterministic output | Depends on renderer, configuration and host | No Agentic cross-runtime guarantee claimed for this comparator | Byte equality tested for the supported runtime/version matrix, not arbitrary machines or dependencies |
| Round-trip guarantee (parse → serialize keeps your source) | — | — | ✅ verbatim for unmodeled syntax, canonical for structured bodies |
| CLI | `mermaid-cli` (`mmdc`, Puppeteer-based) | — | `am` (render/verify/mutate/batch/preview/…, single-binary build) |
| MCP / agent surface | Official hosted MCP (validation, PNG, Mermaid Chart integration) | — | Local Code Mode MCP (<!-- BEGIN GENERATED: local-mcp-tools -->`execute`, `describe_sdk`, `render_png`, `describe`, `mutate`, and `build`<!-- END GENERATED: local-mcp-tools -->) plus hosted `/mcp` (`execute`, progressive schema discovery, render/verify/describe, `mutate`/`build`), `llms.txt`, agent skill |
| Interactivity (click handlers, animations) | Host and security-policy dependent | Partial (tooltips) | Typed action metadata; host activation and strict output policy remain separate |
| Ecosystem & docs | Vast — the de-facto standard, GitHub/GitLab/Notion render it natively | Growing, popular for terminal/AI use | Small; this repo |

## What each does that the others don't

**Only Mermaid:** the full diagram-type catalogue, including families neither
other project renders (requirement, block, packet, kanban, treemap,
ZenUML, and newer additions like venn, wardley, treeview, event modeling —
see `am capabilities --json` for what Agentic Mermaid registers); native
rendering inside GitHub, GitLab, Notion, Obsidian, and hundreds of tools;
the grammar itself — both other projects implement *Mermaid's* language,
and valid Mermaid is the writing contract. That does not require matching its
layout or reproducing its quirks.

**Only Beautiful Mermaid (vs Mermaid):** synchronous, dependency-light
rendering with no browser; a deliberate two-color theming foundation with
enriched palettes and Shiki theme compatibility; ASCII/Unicode terminal
output. Agentic Mermaid inherits all of this — it is upstream's work, and
credit belongs there.

**Only Agentic Mermaid:** the typed editing loop. `parseRegisteredMermaid` returns a
sealed IR; family narrowers (`asFlowchart` … `asXyChart`) expose typed
mutation ops; `verifyMermaid` returns structured warnings instead of asking
an agent to eyeball pixels; `serializeMermaid` round-trips losslessly
(structured-or-opaque: anything the parser doesn't model is preserved
verbatim, never silently dropped). Plus offline PNG, JSON layout, an `am`
CLI built for agents (exit codes, JSONL batch, `capabilities --json`
self-discovery), a local Code Mode MCP server, a bounded hosted MCP endpoint
for zero-install render/verify/describe and structured edits, and tested
byte-identical determinism within the tested environment. These are additional
workflow contracts, not a claim that other renderers cannot be used by agents.

## C4 follow-up, 18 October 2026

The refreshed comparison at Agentic `6724062c5da0e13401ab63744b3e7c11efc2684f`
found two counterexamples missed by the earlier finite audits: a child→ancestor
arrow entirely covered by its label and dense relationship labels obscuring one
another. Production candidate `cb7994341c309e4da1ebb54fa5045548bacc63b4`
reserves ancestor clearance, places measured halos and detects final occlusion
after authored offsets. The ancestor and parallel/self witnesses now verify
cleanly. The seven-node/21-interaction witness remains a limitation: nine label
overlap pairs become seven, and sixteen visibility errors now prevent clean
verification. Neither retained strings nor path counts prove readability.

The candidate adds opt-in measured C4 width reflow, compact pixel/cell spacing,
optional automatic type legends, palette/style-consistent legend marks and
editor boundary navigation. Full source and canonical graphical exports retain
all context and explicit indices. The linked performance records remain
historical; they must not be relabeled with this newer candidate.

Peer pins refreshed in this pass include Zombie main
`631b1b4cbeaa25a5951ba4c889e9bc511a553e07` (18 October), npm5.7.1 at
`3e688e4e5e00ec9f92444af4757e0ec7c449e84b` (16 October), Mermaid12.2.0 at
`1fb7869866dd619168d840291c9c54b4f129758b` (13 October publication), and Pele
main `458322a5b8abb1ae57ddf127c32017ab9fb14a92` with npm1.6.0 (17 October).
Zombie source/npm matched59 tested output pairs; Pele matched15. These establish
only those outputs. Mermaid12.2 can render the tested boundary relationship
that11.16.1 rejects, although its shaft crosses child text.

Historical correction: Beautiful PR34 at
`b8bea07b2649bf375c8b089acfd1991c80f01000` exposes C4 through public-root
`renderMermaidAscii`; it is not merely an inaccessible helper. PR71 at
`45b6ce784ff24cd7665140e4381f8aaca31eddba` has public async SVG but rejects
terminal C4. Both remain unmerged. Additional executed native C4 peers include
Mermansi0.1.6, Figurehead0.4.3, Merman0.9.0/current source, Mermaider0.15.1,
rusty-mermaid, Sebastian0.8.0 and mermaid-rs-renderer0.3.1. Their recognition,
visible relationships, indices, terminal output and editing must be assessed
separately. No universal Agentic rendering or performance superiority follows.

The successive C4 performance/payload measurements, including the rebases,
remain in the [18 October record](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/docs/comparison.md#c4-follow-up-18-october-2026).
They establish bounded warm-path observations, not current package startup,
whole-product or competitor claims. Source diagnostics still require
`verifyMermaid`: a successful render/receipt alone does not expose every
`INEFFECTIVE_CONFIG` warning. The [C4 design](./design/families/c4.md) owns the
current native feature and readability limits.

## Zombie Mermaid and C4 bloodlines

[Zombie Mermaid](https://github.com/dfadler/zombie-mermaid) is an independently
maintained Beautiful Mermaid fork, not an upstream PR branch. This comparison
inspected its source at
[`9a4a667d`](https://github.com/dfadler/zombie-mermaid/tree/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400).
Its published **5.7.1** tag points to
[`3e688e4e`](https://github.com/dfadler/zombie-mermaid/tree/3e688e4e5e00ec9f92444af4757e0ec7c449e84b),
which predates that main head; do not call every inspected main change released.

At those historical source points Agentic had **16 native SVG/terminal families** and
Zombie has **nine when State is counted separately** (its registry groups
Flowchart/State into one of eight type categories). These are family-level
counts, not construct-fidelity scores. Agentic is broader, but **not a strict
superset**: Zombie rendered C4, while that Agentic baseline only preserved its source envelope.
The [Agentic descriptors](https://github.com/adewale/agentic-mermaid/blob/3ef2fb8beff21359fb6e3b798e025a3d69311539/src/agent/families.ts)
and Zombie's [SVG](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/svg-renderer/src/registry.ts)
and [terminal](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/ascii-renderer/src/registry.ts)
registries are the capability evidence; this page is not a second full roster.

| C4 implementation / evidence | SVG | Terminal | Meaning of “support” |
|---|---|---|---|
| [Mermaid's pinned C4 syntax](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/docs/syntax/c4.md) | Native C4 renderer | No native text renderer | Five legacy variants; renderer support is not universal construct/layout parity. |
| [Beautiful main dispatch](https://github.com/lukilabs/beautiful-mermaid/blob/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488/src/index.ts) | No native C4 | No native C4 | PRs [#34](https://github.com/lukilabs/beautiful-mermaid/pull/34) and [#71](https://github.com/lukilabs/beautiful-mermaid/pull/71) remain proposals, not merged support. |
| [Zombie C4 SVG](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/svg-renderer/src/c4/renderer.ts) and [terminal renderer](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/ascii-renderer/src/c4-diagram.ts) | Native renderer | Dedicated boundary/element layout and routed relations | Not merely captured gallery SVG or a relationship list. Terminal orientation and unsupported constructs still have limits; native does not mean complete parity. |
| [pgavlin terminal renderer](https://github.com/pgavlin/mermaid-ascii/blob/ab8074a98bef86a951c3443910363a8d1415135b/pkg/c4/renderer.go) | Not established by this text renderer | Stacked boxes plus textual relationship list | Useful text output, but not relationships routed between C4 elements. Do not equate it with Zombie's terminal geometry. |
| Agentic source at the checked baseline | Unsupported family | Unsupported family | Recognized C4 headers/source envelopes can round-trip through the open preservation API; no native C4 layout or typed edits. [#387](https://github.com/adewale/agentic-mermaid/issues/387) is a proposal, not a shipped capability. |

The current working source adds native C4, including all five legacy dialects,
typed edits, nested boundaries, distinct repeated interactions and connected
terminal output. The [C4 design](./design/families/c4.md) records current
dispositions and refreshed peer pins. This is a source change, not evidence of
an npm release or live deployment; the dated comparison above remains historical.

Native C4 support must be established at its own parser, layout, output and
editing boundaries. Recognizing a header, preserving source, drawing a screenshot
in a gallery and rendering the family natively are not interchangeable claims.

### Historical peer observations

The color comparisons in [#303](https://github.com/adewale/agentic-mermaid/issues/303)
used **Zombie 2.2.6**. They remain evidence about that version, not the October
source or a promise that every original gap remains. Zombie's
[later color fix](https://github.com/dfadler/zombie-mermaid/commit/3861e50dfc8bd7de17a00b8b9939c257482aead1)
changes invalid style-color handling for Flowchart, State and Class. Its current
Class/ER support must likewise be read from the pinned source/changelog, not
inferred from that old matrix. These notes do not silently rewrite the original
measurements or claim a fresh cross-product benchmark.

## Mindmap/GitGraph and the terminal ecosystem

The checked fixtures follow the official [Mindmap](https://mermaid.ai/open-source/syntax/mindmap.html) and [GitGraph](https://mermaid.ai/open-source/syntax/gitgraph.html) syntax pages and render from the same authored source in Mermaid 11.16.0 and Agentic Mermaid. See the captioned [Mindmap comparison](./design/families/mindmap.md#visual-evidence) and [GitGraph comparison](./design/families/gitgraph.md#visual-evidence). Compare semantic structure—labels, shapes, hierarchy, lanes, commits, parentage, tags, and bounds—not pixels, because the layout/style engines differ.

The recorded fixture comparison used
[AlexanderGrooff/mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii)
**1.4.0**, which exited 1 for both families:

```text
unsupported graph type 'mindmap'. Supported types: graph TD, graph TB, graph LR, flowchart TD, flowchart TB, flowchart LR
unsupported graph type 'gitGraph'. Supported types: graph TD, graph TB, graph LR, flowchart TD, flowchart TB, flowchart LR
```

This is a historical, version-pinned observation, not a replay against the latest
release or a claim about all related forks. Its [coverage issue #74](https://github.com/AlexanderGrooff/mermaid-ascii/issues/74)
is context, not current execution evidence. An unsupported render is not a
visually worse render.

## Choosing

- Rendering inside a web app, or you need a family absent from `am capabilities --json` → **Mermaid**.
- Fast, beautiful SVG/ASCII rendering of the core families in
  Node/Bun/terminal, render-only → **Beautiful Mermaid**.
- An AI agent (or any program) needs to *edit* diagrams safely, verify them
  structurally, or guarantee reproducible output in CI → **Agentic Mermaid**.

## Compatibility notes

Mermaid is our input language, not a pixel or bug-for-bug specification. Write
valid Mermaid 12.2.0; read unambiguous intent generously with diagnostics, and
reject input whose meaning cannot be determined. Display/layout choices remain
ours. Preserving source does not imply native rendering or structural
verification: unsupported families receive an explicit diagnostic, and opaque
bodies do not gain typed editing merely because their bytes survive. See the
[preservation contract](./project/divergences.md#structured-or-opaque-is-load-bearing).
Upstream-relevant fixes are extracted into small PRs back to
`lukilabs/beautiful-mermaid` per the
[upstreaming strategy](./fork-differences.md#upstreaming-strategy).
