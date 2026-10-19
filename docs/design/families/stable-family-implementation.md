# Completing stable Mermaid families

Decision and research date: 2026-10-19. Syntax target: Mermaid **12.2.0**,
source [`1fb7869866dd619168d840291c9c54b4f129758b`](https://github.com/mermaid-js/mermaid/tree/1fb7869866dd619168d840291c9c54b4f129758b).
Agentic baseline: `3187824137a049e326745e9a2d964bb793fb27b2`.

The six missing stable families were Packet, Kanban, Requirement, Treemap,
Ishikawa and Block. This change implements all six in one PR. Beta and
experimental **families** are excluded. Historical `-beta` header aliases of
these now-stable families remain readable; writers use the stable header.
Flowchart/ELK and Class/v2 header aliases do not represent additional families.
The runtime inventory is generated from the upstream policy and descriptors.

## Implementation stack rank

This is an engineering priority judgment, not a popularity measurement. It
weights reuse, bounded implementation risk, verifiable domain semantics,
distinct user value and fit with Agentic's visual language. All six ship
together; the order describes where investment yields reliable support first.

| Rank | Family | Existing primitives that make it efficient | Domain work and acceptance evidence |
|---|---|---|---|
| 1 | Packet | Prepared text, Scene rectangles/text, terminal cells, request-local config, source envelope and typed operation schemas | Inclusive bit intervals, word splitting and descending bit order need a small dedicated row layout. Test exact bit conservation and mirrored partial words independently of pixels. |
| 2 | Kanban | Group/header/card marks, measured wrapping, metadata YAML parsing, safe inert links, categorical styling, typed parent references | Ordered columns and movable cards have direct agent value. Preserve repeated authored IDs with separate occurrence identities, metadata and indentation. |
| 3 | Requirement | ELK worker boundary, measured compartments, relationship markers, shape-aware ports/routes, agent identities and endpoint validation | Reuse layered graph placement while retaining requirement/element attributes, seven relationship kinds and containment marker direction. |
| 4 | Treemap | Numeric channels, categorical palettes, measured text, hierarchy references, class styles and value formatting | A pure squarified partitioner supplies new area geometry. Area conservation, sibling disjointness, containment and explicit hidden-label diagnostics protect the quantitative meaning. |
| 5 | Ishikawa | Hierarchy references, prepared text, connector/marker resources, Scene ownership and deterministic bounds | A dedicated horizontal cause/effect layout is essential. Keep nested causes, alternating major bones and measured label clearance; a generic tree loses the fishbone hallmark. |
| 6 | Block | Existing shape geometry, marker resources, Scene groups, measured text, shape-aware obstacle routing and terminal graph rendering | Authored cells, spans, spaces and nested composite grids require a dedicated placer. Graph auto-layout cannot preserve manual grid intent. Wrapped-grid routes and nested capacity make this the largest integration risk. |

The new `hierarchy-model` and `scene-document` helpers each have multiple real
consumers. They share semantic references and the SVG document shell, while
family adapters own their graphical and terminal geometry. No universal
diagram DSL or parallel rendering system is introduced.

## Vision and aesthetics

The family descriptor remains the capability authority across the public
agent API, MCP declarations, CLI, synchronous renderer and lazy browser
catalog. Each family has a typed body, narrower, edit schema, verification,
facts, source map, canonical serializer and structured-or-opaque boundary.
Unknown syntax is preserved rather than silently dropped during editing.

Rendering stays synchronous, deterministic and DOM-free. New marks use the
existing Scene, prepared text, bundled font metrics, Style + Palette and
security contracts. Default, hand-drawn, Excalidraw and watercolor styles are
composed through those shared backends. Mermaid is the input/semantic oracle;
its CSS, DOM and pixels are not Agentic's aesthetic specification.

Terminal output declares its representation. Packet retains word/bit geometry;
Kanban retains columns/cards; Requirement and Block retain connected graph/grid
representations. Treemap presents hierarchy and exact values without claiming
terminal-cell area proportionality. Ishikawa presents the cause/effect tree
without claiming an ASCII drawing of the SVG fishbone. Both projections report
that limitation and retain full authored text.

## Community signals translated into implementation

Links below are evidence and design inputs, not promises to merge upstream
proposals. Open branches may change after this research date.

| Family | Community evidence | Local response |
|---|---|---|
| Packet | [#8250](https://github.com/mermaid-js/mermaid/pull/8250) descending row numbering is in the pin; [#7585](https://github.com/mermaid-js/mermaid/issues/7585) requests alternate bit order; [#7070](https://github.com/mermaid-js/mermaid/issues/7070) requests hand-drawn support | Ascending/descending order uses the same inclusive field model in SVG and terminal; partial final words are tested. Existing sketch backends apply to Packet marks. |
| Kanban | Open [#8121](https://github.com/mermaid-js/mermaid/pull/8121), branch `chore/8116_kanban-chevrotain`, pursues parser parity; [#8118](https://github.com/mermaid-js/mermaid/issues/8118), [#8119](https://github.com/mermaid-js/mermaid/issues/8119), [#8120](https://github.com/mermaid-js/mermaid/issues/8120) expose styling, class and accessibility gaps | Independent pinned metadata/indentation cases, retained column/card classes, universal accessibility, visible offline icon names, safe ticket actions and collision-free occurrence IDs. Priority remains readable as text across palettes. |
| Requirement | [#6219](https://github.com/mermaid-js/mermaid/pull/6219) unified rendering, [#6386](https://github.com/mermaid-js/mermaid/pull/6386) containment marker placement and [#7445](https://github.com/mermaid-js/mermaid/pull/7445) label syntax are in the pin | Preserve requirement types/attributes and logical relationship operands independently of layout; test both marker ends, typed edits and pinned reloads. |
| Treemap | [#7247](https://github.com/mermaid-js/mermaid/pull/7247) labels, [#7178](https://github.com/mermaid-js/mermaid/pull/7178) classes and [#7403](https://github.com/mermaid-js/mermaid/pull/7403) dark contrast are in the pin; [#8205](https://github.com/mermaid-js/mermaid/issues/8205)/closed-unmerged [#8206](https://github.com/mermaid-js/mermaid/pull/8206) concern whitespace | Measured text fits independently of area geometry, hidden labels are reported, class colors survive and text uses authored/contrast-aware ink. All checked-in nested examples test public layout certification. |
| Ishikawa | [#7474](https://github.com/mermaid-js/mermaid/pull/7474) indentation fix is in the pin; draft [#7891](https://github.com/mermaid-js/mermaid/pull/7891) explores spacers | The first cause defines its indentation baseline independently of the effect. Measured branch clearance avoids requiring unpinned spacer syntax. |
| Block | [#8181](https://github.com/mermaid-js/mermaid/pull/8181) palette work is in the pin; [#8310](https://github.com/mermaid-js/mermaid/issues/8310) accessibility and [#8279](https://github.com/mermaid-js/mermaid/issues/8279) missing style targets remain open; [#7814](https://github.com/mermaid-js/mermaid/pull/7814) sizing was closed unmerged | Preserve authored grid order/spans and nested composites; retain accessibility through the universal envelope. Route around occupied cells and retain measured labels rather than importing upstream sizing constants. |

Agentic's open [composition foundation #409](https://github.com/adewale/agentic-mermaid/issues/409)
supports investing in shared semantic and rendering primitives. The historical
`feat/family-primitive-contracts` branch was already contained in main at the
inspected baseline, so it supplies no missing implementation shortcut.

## Literature and industrial practice

- Bruls, Huizing and van Wijk, [Squarified Treemaps (2000)](https://www.win.tue.nl/~vanwijk/stm.pdf), motivates minimizing poor aspect ratios while conserving area. The local pure partitioner has independent conservation/disjointness properties. [D3 treemap](https://d3js.org/d3-hierarchy/treemap) is a mature design reference; no D3 DOM renderer is required.
- Shneiderman and Wattenberg, [Ordered Treemap Layouts (2001)](https://doi.org/10.1109/INFVIS.2001.963281), highlights the tradeoff between aspect ratio and stable ordering. Authored order/identity remains separate from value-sorted placement; equal weights use stable ties. Arbitrary value edits do not promise positional stability.
- [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) provides a mature layered algorithm with ports and compound graph support. Requirement reuses the existing integration; Block uses authored placement and shares routing primitives instead.
- The [ASQ fishbone guidance](https://asq.org/quality-resources/fishbone) makes the effect, categories and nested causes the meaningful structure. The model retains that tree before choosing SVG bones or terminal hierarchy geometry.
- [The Kanban Guide](https://kanbanguides.org/the-kanban-guide/) treats an explicit workflow and work items as the core model. Columns/cards, identity, ordering, movement and metadata are first-class operations; no drag-and-drop DOM dependency is needed to serve agents.
- [Pele](https://github.com/obsidianmd/pele/tree/8603bf3313add9143cd417015d4a6bd6c522dada) supplies useful MIT-licensed browserless parser/layout precedents. Adapted code is attributed in third-party notices. Its family coverage is useful peer evidence, not proof of exact-pin semantics, Agentic editing or accessible output.

## What compliance means

All pinned family test blocks are accounted for. Portable input and semantic
assertions run against native adapters, with independently captured Mermaid
reference models and unchanged upstream inputs/expectations. Original DOM/CSS,
generated internal IDs, singleton timing and partial error-recovery AST checks
are explicitly classified beside each bench; they do not become pixel or
internal-representation requirements. Negative tests remain negative tests.

Canonical output must be accepted by the exact pin and retain modeled meaning.
Intentional upstream data-loss quirks are recorded in
[divergences](../../project/divergences.md), with owning tests. Thus "100%" is
an accounted portable semantic contract, not a claim that an independent
DOM-free renderer passes Mermaid's entire unmodified browser/DOM test suite.
The six `eval/mermaid-*-bench/README.md` files give the precise scope and rerun
commands. Existing corpus, editing, metamorphic, runtime and release benchmarks
remain separate checks of Agentic's own contracts.

A further grammar diagnostic run covered these six families with seed 7 and
100 mutations per family. Kanban's 75 raw model differences were canonical
indentation levels (73) and upstream section padding defaults (2), with no
selected semantic or ordered-operation mismatch. Forced-family parser
admissions of corrupted headers are separate from public source admission;
Packet also retains authored double spaces that its pinned title reader
collapses. The run exposed seven real Treemap parent-topology errors in entries
sharing a physical line. Their exact accepted inputs and independent pinned
parent expectations are retained as regressions; the corrected Treemap rerun
has zero model, selected-semantic or ordered-operation drift candidates and no
writer rejection. This bounded diagnostic sample establishes neither universal
grammar parity nor perfect semantics across the broader 400-input rendering
cohort.

## Browser and discovery cost

The 23-entry lazy build factors more shared modules: established family graphs
gain seven or eight requests and about 2.5–2.8 KB gzip in the measured local
build. Their existing raw/gzip/Brotli ceilings remain unchanged; request-count
budgets account for the new shared chunk graph. The five new non-ELK families
exclude ELK, while Requirement joins the existing single shared ELK chunk.
Measure again with `bun run check:browser-lazy`; this observation does not
promise unchanged network latency. CLI discovery includes the six real schemas
and stays bounded below 96 KiB. MCP keeps family schemas in progressive
`describe_sdk` discovery and retains its existing 15 KB execute-description
budget through lossless declaration whitespace compaction.

## Observed community-renderer coverage

The same 55 deduplicated documentation inputs accepted by the exact Mermaid
pin were probed without rewriting their source. This is an advisory syntax/
render-admission comparison, not a pixel, editing, accessibility or performance
ranking of other projects.

| Family | Pinned inputs | This implementation | Pele 1.7.0 | beautiful-mermaid 1.1.3 |
|---|---:|---:|---:|---:|
| Packet | 4 | 4 | 4 | 0 |
| Kanban | 3 | 3 | 3 | 0 |
| Requirement | 9 | 9 | 9 | 0 |
| Treemap | 8 | 8 | 8 | 0 |
| Ishikawa | 1 | 1 | 1 | 0 |
| Block | 30 | 30 | 30 | 0 |

Pele source was fixed at the commit linked above; beautiful-mermaid is the
repository's exact installed development dependency. Its public
`renderMermaidSVG(source)` rejected these inputs with an invalid-header error.
The existing modern compatibility runner reproduces the Agentic/Pele cohort:

```sh
bun run eval:mermaid-modern --mermaid-dir ../mermaid \
  --reference-dir ../mermaid-reference --pele-dir ../pele --fuzz 0 \
  --output /tmp/stable-family-comparison
```

The full documentation cohort increases from 345 to 400 rendered inputs out of
522 upstream-valid inputs at the inspected baseline/candidate. The remaining
population includes excluded beta/experimental families and existing gaps;
that broader denominator is not a claim to implement those families. All 55
new-family sources are structured, verified, deterministic/finite, and their
canonical writes are accepted by the pin. The stronger six-family retained
corpora independently compare 156 accepted sources' semantic models and ordered
parser writes. Each comparison declares its field scope, so admission counts
alone are never presented as complete feature parity.
