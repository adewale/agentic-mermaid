# Mermaid renderers and Agentic Mermaid

## Pele comparison — checked 18 October 2026

[Pele](https://github.com/obsidianmd/pele) is an independently maintained,
browserless SVG renderer. Its inspected main is
[`458322a5b8abb1ae57ddf127c32017ab9fb14a92`](https://github.com/obsidianmd/pele/tree/458322a5b8abb1ae57ddf127c32017ab9fb14a92)
(17 October 2026). Published **1.6.0**, released 17 October, has npm provenance
pointing to `659c3593ce43794dce7ec7ab45d424ad2de182a5`; the intervening main
changes do not change library code. Public source and installed-package APIs
were exercised separately. The fetched documentation at <https://pele.run/api>
describes that API; fetching documentation does not establish deployment bytes.

Pele targets Mermaid **12.1.0**, whereas Agentic's writing contract remains
**11.16.1**. Its source/package registry renders 33 family examples; Agentic's
current source registers 17 native families including C4. Those are breadth
observations, not construct-fidelity scores. Agentic npm and the live
capabilities endpoint still report **0.4.1** at this check: native C4 in this
branch is not available merely by installing that release.

| Dimension | Pele 1.6.0 / inspected source | Agentic current source |
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

### Fresh performance observations

Measured 18 October on shared Linux x86_64 (AMD EPYC 9V74, 5 vCPU),
Node 24.19.0, with sequential public API calls. Comparators were Beautiful npm
1.1.3 (`65f4e0ab8c289e9691a9e5bc4f9eac7108cf449b`), Zombie npm 5.7.1
(`3e688e4e5e00ec9f92444af4757e0ec7c449e84b`), and Pele npm 1.6.0.
Zombie current source `3610098ca328947cd252ebc6ee36934850cacbb1` was
spot-checked separately; its source-bundle timings are not package startup data.
Agentic is this PR's 0.4.2 source build, not the published 0.4.1 package. The
principal matrix precedes the final configuration/metadata refinements; the
isolated three-case comparison below includes the final SVG fast-path guard.

The six matched inputs contain 5 nodes/6 edges, 50- and 100-node ternary trees,
a seeded 50-node/69-edge mesh with 20 labels, a 20-message sequence, and a
3-element/2-interaction C4. Tree/mesh generators follow
[Pele's existing benchmark](https://github.com/obsidianmd/pele/blob/458322a5b8abb1ae57ddf127c32017ab9fb14a92/scripts/bench.mjs),
with explicit labels for coverage checks. Five warmups precede 15–120 timed
calls (400ms target, minimum 15); each consumes UTF-8 bytes and SHA-256 of the
returned output. Receipt paths and Pele's object result serialize the entire
returned object. Successful timings retain all expected labels; this does not
establish arbitrary topology or aesthetic quality.

| Warm Node median, milliseconds | Agentic SVG text | Agentic complete SVG receipt | Beautiful SVG | Zombie SVG | Pele complete result |
| --- | ---: | ---: | ---: | ---: | ---: |
| Five-node flow | 18.31 | 18.95 | 5.14 | 3.90 | 0.30 |
| Tree, 50 nodes | 78.48 | 86.30 | 21.09 | 19.19 | 0.74 |
| Mesh, 50 nodes | 1044.46 | 817.38 | 42.12 | 37.08 | 1.78 |
| Sequence, 20 messages | 24.53 | 20.73 | 0.09 | 0.25 | 0.15 |
| Simple C4 | 12.46 | 9.85 | Unsupported | 0.19 | 0.08 |
| Tree, 100 nodes | 196.42 | 184.76 | 64.73 | 58.80 | 1.55 |

Each column runs in its own process/JIT/GC state. The text/receipt differences
do not imply that consuming extra data makes execution faster; SVG text already
constructs its receipt. Agentic remains substantially slower on these samples.
Its additional contracts explain some cost, while profiling identifies material
avoidable work. Richer semantics do not excuse the measured speed gap.

The shared Scene-admission and SVG-postpass changes were isolated in a paired
A/B using identical source/dependencies and build mode: 20 warmups, seven
alternating rounds of 20 calls. Complete SVG and receipt bytes matched. Median
time fell 17.395→13.675ms for the five-node flow, 31.604→20.951ms for the
sequence and 13.612→10.451ms for C4 (21.4%, 33.7%, 23.2%). The CDATA overlap
guard preserves the prior behavior for nested lexical ranges; common disjoint
outputs retain byte parity. The final paired run includes that guard and
complete output/receipt parity. These are three bounded improvements, not a
cross-product speed claim. Complete terminal receipts changed only by
noise-sized variation; no terminal speedup is claimed from these changes.

| Warm terminal median, milliseconds | Agentic text | Agentic complete receipt | Beautiful text | Zombie text |
| --- | ---: | ---: | ---: | ---: |
| Five-node flow | 4.30 | 24.17 | 0.51 | 0.85 |
| Tree, 50 nodes | 42.25 | 131.80 | 151.78 | 12.41 |
| Mesh, 50 nodes | 53.57 | 844.76 | Excluded: 12 labels absent | 28.55 |
| Sequence, 20 messages | 4.01 | 25.55 | 0.12 | 0.31 |
| Simple C4 | 4.31 | 11.03 | Unsupported | 0.26 |
| Tree, 100 nodes | 167.08 | 359.20 | 739.88 | 44.06 |

Pele and Mermaid have no native terminal API. Beautiful's mesh output loses
expected labels, so it is excluded from successful timings. Agentic terminal
receipts deliberately consume additional pixel/connector evidence; comparing a
text-only result with a fully consumed receipt hides substantial work.

Five fresh Node processes per engine, alternating order with warm filesystem
caches, measured spawn through successful five-node SVG output and exit:
Agentic 525ms, Beautiful 242ms, Zombie 262ms, Pele 73ms. Main-entry import alone
was 282/72/35/25ms respectively. Median peak process RSS was
109.2/77.8/76.3/36.7 MiB; this includes the runtime and layout dependencies,
and is not a retained-memory or leak measurement.

In the same Chromium 154 browser, five-node public SVG calls took medians of
20.0ms for Agentic lazy, 0.4ms for Pele lazy and 32.7ms for Mermaid 11.16.1.
This consumes output bytes, not painting/rasterization. Mermaid's C4 median was
5.5ms. Browser and Node rows must not be combined into one ratio.

Actual browser JS requests, gzip level 9 per fetched file:

| Lazy entry | Initial requests / bytes | Cumulative first-flow requests / bytes |
| --- | ---: | ---: |
| Agentic | 4 / 4,483 | 28 / 679,769 |
| Pele | 5 / 14,803 | 16 / 54,020 |
| Mermaid | 17 / 170,567 | 27 / 223,952 |

Agentic's small loader does not make its usable flow renderer smaller. These
JS-only transfer estimates exclude fonts/HTML/maps and do not measure network
latency. Browser distributions for Beautiful/Zombie were not invented for this
table. Historical benchmark tables elsewhere retain their original environments,
versions and populations.

The next performance priority is to profile dense routing separately while
retaining connectivity, obstacle clearance, labels and certification. Narrow
Node startup entries and smaller usable browser closures are separate work.
Reuse validated immutable evidence and structural passes; do not remove security
or receipt work merely to improve a text-only benchmark.

The three-project comparison below retains its original dated evidence.

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
| MCP / agent surface | Official hosted MCP (validation, PNG, Mermaid Chart integration) | — | Local Code Mode MCP (<!-- BEGIN GENERATED: local-mcp-tools -->`execute`, `describe_sdk`, `render_png`, and `describe`<!-- END GENERATED: local-mcp-tools -->) plus hosted `/mcp` (`execute`, progressive schema discovery, render/verify/describe, `mutate`/`build`), `llms.txt`, agent skill |
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
