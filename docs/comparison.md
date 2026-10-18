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

At this initial comparison snapshot, Pele targeted Mermaid **12.1.0** and
Agentic's writing contract was **11.16.1**. The rebased candidate below updates
Agentic's pin to **12.2.0** without relabeling these historical measurements.
Pele's source/package registry rendered 33 family examples; Agentic's
source registered 17 native families including C4. Those are breadth
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
principal matrix precedes the final configuration/metadata refinements. The
isolated three-case comparison below binds production commit
`6895af7c2aac29e9c7b1f6db1173e1b95f364be7`; subsequent commit
`315f8619961181545b9ce48cfd7e60e36debbfb1` changes only a test and payload budget.

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
time fell 18.833→14.958ms for the five-node flow, 33.992→22.347ms for the
sequence and 13.790→10.390ms for C4 (20.6%, 34.3%, 24.7%). The CDATA overlap
guard preserves the prior behavior for nested lexical ranges; common disjoint
outputs retain byte parity. The final paired run includes that guard and
complete output/receipt parity. The before build replaces only the three
performance files with their `4239b17554a78658ef46483617870ac9c7fe152a`
versions; C4 configuration, accessibility and other production code are held
constant. These are three bounded improvements, not a
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

The final CI website capture at `d6f00407007eb67876af22d70113ee3035cb9bce`
also measured the empty editor: two requests, 3,590,858 raw / 1,089,260 gzip /
859,297 Brotli bytes. This is the existing synchronous all-family editor
adapter, including native graphical/terminal receipts and verification, rather
than the lazy library entry above. C4's additional native code is an intentional
cost; a browser-first async editor would need a separate loading contract. The
examples route grew to 418,997 raw bytes because its new C4 card contains
build-time HTML/SVG; it does not load a C4 runtime. Tight route ceilings were
reviewed against these measurements, while request/admission rules remain.

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
all context and explicit indices. Existing performance tables above remain
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

The following `cb799434` performance and payload observations predate the
Mermaid 12.2.0 rebase and remain historical evidence.

The final three-file performance A/B binds production
`cb7994341c309e4da1ebb54fa5045548bacc63b4`, Node 24.19.0 and Bun 1.4.2,
on the same AMD EPYC 9V74 five-vCPU host. Identical committed C4 source,
dependencies and Node-target ESM build differ only in render-contract.ts,
svg-structure.ts and output-security.ts. Forty warmups precede 120 samples
per implementation/path in six alternating-order batches. JSON serialization
and UTF-8 byte consumption include complete receipts.

| Small C4 public path | Node median before→after, ms | Bun median before→after, ms |
| --- | ---: | ---: |
| SVG text | 12.054→9.365 | 14.974→13.083 |
| SVG plus complete receipt | 10.922→8.513 | 13.249→12.065 |
| Terminal text | 4.376→3.661 | 8.326→7.408 |
| Terminal plus complete receipt | 11.131→9.493 | 16.594→15.479 |

All four outputs/receipts match exactly in both runtime pairs. The broader
parity check matches 42 fully consumed artifacts, nine terminal metadata
artifacts and 1,088 security cases. Node medians improve 14.7–22.3%; Bun
improves 6.7–12.6%. Bun terminal p95s slightly worsen, so this is no tail-latency
guarantee. The one three-node/two-interaction input establishes neither dense
layout speed nor startup, memory, download or competitor performance.

Fresh browser requests after the follow-up measure the all-family editor at
3,603,397 raw / 1,093,679 gzip / 862,600 Brotli bytes. Examples measure 419,327
raw / 72,546 gzip / 57,465 Brotli bytes. The examples gzip ceiling increases
72,500→72,600 for its prepared C4 legend/swatch content; other absolute caps,
request/resource restrictions and the separate PR growth gate remain intact.

### Rebased candidate, 18 October 2026 at 09:11 UTC

These measurements precede the merge of performance PR #412 and remain
historical. The incremental comparison against that newer main follows below.

The performance comparison was repeated at
`56e463243e2361b2eb742c256a38eb8c8f9f54fe`, rebased onto main
`5442a3cce1e847953e2e5fcbc79a01662f96ecb7`. Both sides use that committed
source, the same frozen dependencies (including Mermaid **12.2.0**, source pin
`1fb7869866dd619168d840291c9c54b4f129758b`, and `yaml` **2.9.0**), and
the same Node-target ESM build. Only `render-contract.ts`, `svg-structure.ts`
and `output-security.ts` revert to their pre-optimization versions from
`6724062c5da0e13401ab63744b3e7c11efc2684f` in the before build. This isolates
the three bounded optimizations; it does not measure the dependency upgrade.

The same three-node/two-interaction C4 input ran on Node **24.19.0** and Bun
**1.4.2**, on the AMD EPYC 9V74 five-vCPU host during a coordinated quiet
window. Each implementation/path received 40 warmups and 120 samples in six
alternating-order batches. Timed receipt paths include full JSON serialization;
every returned string is consumed as UTF-8 bytes.

| Small C4 public path | Node median before→after, ms | Node p95 before→after, ms | Bun median before→after, ms | Bun p95 before→after, ms |
| --- | ---: | ---: | ---: | ---: |
| SVG text | 11.150→8.690 | 14.771→11.780 | 15.713→12.489 | 22.654→16.433 |
| SVG plus complete receipt | 10.497→8.290 | 12.822→11.457 | 12.566→11.145 | 16.267→14.416 |
| Terminal text | 4.194→3.630 | 6.829→6.233 | 7.315→6.396 | 17.752→10.847 |
| Terminal plus complete receipt | 10.212→9.107 | 13.978→12.688 | 15.286→14.396 | 20.379→19.354 |

All four outputs/receipts match exactly within both runtime pairs. The repeated
broader check matches 42 full output/receipt artifacts (772,864 bytes), nine
terminal metadata artifacts and 1,088 security cases. Within each path's A/B,
Node median reductions range from 10.8–22.1% and Bun reductions from 5.8–20.5%.
All sampled p95s improve in this run; the earlier Bun p95 regressions remain
reported above. These bounded warm measurements
establish no general tail-latency, dense-layout, startup, memory, download or
competitor performance claim. Earlier tables retain their original provenance.

The changed YAML semantics also pass the existing 63-test contract/security
selection with 3,276 assertions, including the installed Mermaid 12.2.0 oracle.
Additional public C4 probes preserve plain `1_0`, `0b1_0` and `1e999` titles
through SVG, terminal output and serialization. Invalid explicit numeric tags
are rejected. Invalid numeric configuration strings use default geometry and
produce `INEFFECTIVE_CONFIG` through `verifyMermaid`; that source warning is
not included in the SVG receipt. Callers requiring source diagnostics must
consume verification as well as rendering. The rebase introduces no observed
failure in these checks; it is not a new full-browser or all-family audit.

### Incremental XML fast paths after PR #412, 18 October 2026 at 09:22–09:23 UTC

Candidate `1465fafb77d540af2d884fc2d4afec9b646984ca` is rebased onto
`26a481284b80371ccd0d7d104cd5ab20006d3cac`. Main now supplies the Scene
snapshot reuse, SVG assembly, schema cache, route-label cache and text-metric
optimizations. Those implementations are identical in both sides of this new
A/B. The before build replaces only `svg-structure.ts` and
`output-security.ts` with that main commit's versions. The remaining branch
changes replace per-character XML name regexes with equivalent code-unit
checks and skip entity decoding for values containing no ampersand.

The method remains the same small C4 input, Node **24.19.0**, Bun **1.4.2**,
Node-target ESM builds, Mermaid **12.2.0**, `yaml` **2.9.0**, and AMD EPYC 9V74
five-vCPU host. A coordinated quiet window contains 40 warmups and 120 samples
per side/path in six alternating-order batches. Complete receipts are JSON
serialized within timed work, and every returned string is consumed as UTF-8
bytes. This compares the remaining two-file change against current main's
implementation with C4 and all other candidate source held constant.

| Small C4 public path | Node median before→after, ms | Node p95 before→after, ms | Bun median before→after, ms | Bun p95 before→after, ms |
| --- | ---: | ---: | ---: | ---: |
| SVG text | 10.554→8.965 | 13.345→10.878 | 13.381→13.237 | 19.768→19.161 |
| SVG plus complete receipt | 10.279→8.093 | 13.454→10.381 | 13.775→12.811 | 20.983→16.844 |
| Terminal text | 3.577→3.622 | 6.412→6.588 | 6.631→6.899 | 11.001→10.434 |
| Terminal plus complete receipt | 9.590→8.987 | 13.217→13.089 | 15.325→15.087 | 21.288→21.047 |

Within-path median reductions are 15.1%/21.3% for Node SVG text/receipt and
1.1%/7.0% for Bun SVG text/receipt. Terminal-receipt medians fall 6.3% on Node
and 1.6% on Bun. Plain terminal medians instead increase 1.3% and 4.0%, and
Node terminal p95 also increases. No plain-terminal speedup is claimed.
The roughly 1–2% changes are sensitive to timing noise. Plain terminal output
uses safe-paint admission; complete terminal receipts additionally materialize
pixel Scene evidence, so their timings describe different executed work.
This single bounded run establishes no general tail-latency or cross-runtime,
cross-path, dense-layout, startup, memory, download or competitor advantage.

All timed output/receipt bytes match within each runtime pair. The repeated
parity checks also match 42 complete output/receipt artifacts (772,864 bytes),
nine terminal metadata artifacts and 1,088 XML/security cases. Updated Scene
fidelity, schema, security and post-pass tests pass: 53 tests and 2,137
assertions. Four additional public Scene admission tests pass 27 assertions
covering proxy snapshots, late-swapping data and inherited properties.
The adapted mode test confirms that family admission under internal rules
cannot satisfy the backend's inferred external rules; family role declarations
remain checked. No production admission changes were added by this rebase.

The combined C4/shared closure measures XyChart at 189,685 gzip bytes,
185 above its former ceiling. Its gzip cap changes 189,500→189,700; request,
raw and Brotli ceilings remain unchanged. The inspected graph still excludes
ELK from XyChart and all 12 non-ELK families, and initial lazy gzip remains
4,460 bytes. This records a measured integration cost, not a download saving.

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
