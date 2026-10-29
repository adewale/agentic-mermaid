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

## Contract and cost follow-up (2026-10-20)

The first candidate (`21aeeb12`) had native support, but an audit found gaps in
shared Style consumption, Block containment and parallel-edge clearance, and
early host work admission. Those are implementation defects rather than
intentional Mermaid divergences. The follow-up uses the existing authorities:

| Contract | Implementation and owning evidence |
|---|---|
| Bounded work before measurement | The shared 5,000-object/5,000-edge and 64-container-depth limits cover the new source parsers and programmatic layout inputs. Expanded Block spaces count before allocation; Packet row expansion counts before preparing its title. `diagram-work-limits.test.ts` exercises both graphical and terminal refusals. Source configuration cannot raise these limits. |
| Styles describe real paint and geometry | Node/group padding, typography, corners, borders and ink reach their owned marks. Requirement relationships refine edge styling; Block and Requirement use the shared rounded-path projection. Treemap bar category bindings use the existing role authority. Authored styles retain precedence. Native family tests inspect actual text blocks, owned shapes and measured allocations. |
| Authored identity and containment | Block composite Scene groups contain their children and expose parent identities. Parallel and reciprocal links share an unordered endpoint-pair allocation, retain distinct routes and clear complete labels. `block-native.test.ts` checks actual Scene nesting, route/label geometry and public paint certification. |
| Quantitative meaning | Packet padding changes text allocation and row height without changing bit intervals or widths. Treemap header bands and padding consume content space without changing the outer quantitative partition or sibling value ratios. Independent conservation properties remain the geometry oracle. |
| Accessibility, security and output correspondence | The universal source envelope, output security policy, retained text, stable SVG identities and family descriptor contracts remain shared. Their existing all-family tests exercise the new families; family-specific terminal projections retain their explicit limitations above. |
| Determinism and request isolation | Child, row, relation and obstacle indexes retain authored iteration order. Number formatters and resolved fill-ink values are reused only within one request; no cache survives into a differently styled diagram. Parser observation can select mutations before snapshotting, while ordinary full observation retains its lossless model snapshots. |

The performance comparison uses both the original candidate and a separate
merge-only baseline (`2199c535`) so improvements already on main are not
attributed to the native-family optimizations. Stage measurements use the
existing Node microbenchmark with matched inputs and alternating rounds;
complete SVG, allocation, heap and RSS measurements use the existing release
benchmark with separate fresh processes. Download cost is assessed separately
through actual lazy module graphs and the complete shipped browser bundle.
Generated samples, images and reports are review artifacts, not new committed
baselines. Small timing differences on a shared runner are not treated as
proof of an end-to-end speedup.

These checks establish the stated contracts for the exercised inputs. They do
not establish every possible dense layout, every external font, or an
unmodified run of Mermaid's entire browser suite. The pinned portable tests,
their explicit exclusion ledgers, semantic comparisons and render acceptance
scores continue to have separate denominators.

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

The verified 23-entry lazy build adds seven or eight requests and 2,148–2,481
gzip bytes (0.31–1.35%) to established family graphs. Initial load is 5,170 gzip
bytes. New graph gzip totals are Packet 181,048, Kanban 183,640, Requirement
632,491, Treemap 187,268, Ishikawa 181,111 and Block 229,975 bytes; each includes
shared dependencies that browsers reuse. The five new non-ELK families exclude
ELK, while Requirement joins the existing single shared ELK chunk. All renderers
load lazily. Measure again with `bun run check:browser-lazy`; request counts
also affect network latency.

The six build-time gallery examples bring the examples payload to 481,905 raw,
80,386 gzip and 63,351 Brotli bytes. Its explicit ceilings include 5% headroom
for this deliberate expansion. The demo loads 36 requests and stays within its
existing byte budgets. CLI discovery includes the six real schemas and stays
bounded below 96 KiB. MCP keeps family schemas in progressive
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

The same independent operation/semantic gate also checks the six representative
sources in `eval/stable-families/fixtures/`, both as authored and after canonical
serialization. These combine cross-word fields, board metadata, seven kinds of
traceability relationship, nested conserved budgets, causal subtrees and nested
service grids. The shared [citizenship contract](../../contributing/diagram-family-citizenship.md#representative-examples-are-mandatory)
requires a domain-rich editing/export/rendering witness for every registered
family, beyond the former minimal smoke input. The six reviewed PNG goldens
protect the same representative sources; the CI gallery retains the real
unsupported baseline and current production renders.

That richer review exposed three integration defects: Treemap verification
inspected the lazy artifact wrapper instead of its omitted-label list; Kanban
layout JSON omitted task parent IDs; and diagonal Block input/output contacts
could coincide, with a neighboring label halo subsequently hiding a marker.
The repairs use the existing positioned artifact, column membership and shared
on-route label allocator. Independent parent/contact expectations and strict
paint certification protect the repaired behavior. Narrow Packet fields and
deep Treemap labels use explicit authored canvas/bit-width settings in the
gallery; the renderer preserves their quantitative ratios and full labels.

## Comparative follow-up (historical revision, 2026-10-20)

The follow-up inspected Mermaid `develop` at
[`6d8921f94f9a12b76586eddcf45a566080d4767e`](https://github.com/mermaid-js/mermaid/tree/6d8921f94f9a12b76586eddcf45a566080d4767e)
and PR438 at `6e54b9dad8396d865cce8bbe1344f92ee244e281`; the two bounded
repairs below follow that inspection. The language/reference pin remains 12.2.0.
Open branches are design evidence, not additions to the accepted language.
The table records that inspection's status. The later
“Completing the community follow-up” section describes the implemented
Kanban and Packet work; current measurements belong to the final PR receipts.

Pele already accepts the same 55 six-family documentation inputs in the table
above. Agentic's additional proposition is the connected typed-edit, fact,
source-map, verification, Scene/Style and terminal workflow, rather than unique
coverage of these six names. The separate complete-fence browser comparison
uses Pele 1.6.0: Agentic returns SVG for 819/1,095 inputs, Pele for 1,063 and
Mermaid 12.2.0 for 1,061. Agentic takes 18.146 times Pele's public render-call
time on their 819 shared successes in that advisory run at `6e54b9da`.
That broader comparison and the 55-input Pele 1.7.0 table have different
versions and denominators; neither measures semantic or visual parity.
The existing performance results should not be read as an overall lead over
community renderers.

| Priority | New evidence and user problem | Response within Agentic's contracts |
|---|---|---|
| Implemented: Requirement spacing | [#7932](https://github.com/mermaid-js/mermaid/issues/7932) and merged [#7937](https://github.com/mermaid-js/mermaid/pull/7937), commit `158e26cc9a7bd0965d1afb39fa50ba0f44562ba6`, show family spacing being shadowed by another family's defaults. The pinned Requirement renderer reads `nodeSpacing` and `rankSpacing`. | Source-config spacing now reaches the existing ELK options; explicit host render options retain precedence. [Owning regressions](../../../src/__tests__/requirement-native.test.ts) check actual geometry, precedence and ineffective-config diagnostics without copying Dagre's pixels or defaults. |
| Implemented: hidden Treemap names | [#7165 was reopened](https://github.com/mermaid-js/mermaid/issues/7165#issuecomment-4649349083) after merged #7247: the fix's global `leafNodes.length > 20` threshold misses deep trees with few leaves. The maintainer supplies a complete 12-leaf reproduction. | Per-cell fitting and value-proportional areas remain. Omitted labels retain programmatic SVG names and explicit `LABELS_HIDDEN` warnings. Descendants whose containers exhaust their space remain zero-area semantic cells, without impossible text measurement. [Owning regressions](../../../src/__tests__/treemap-native.test.ts) check names, hierarchy, quantities, diagnostics and preserved rendering. Metadata does not make omitted text visually readable. |
| Follow up: precise Kanban errors | Open [#8121](https://github.com/mermaid-js/mermaid/pull/8121), branch `chore/8116_kanban-chevrotain`, head `05c8f7aaf73601ec953d3c7634d7ca4cdeab600f`, retains 107 token/DB comparison inputs, delimiter-specific errors and metadata key/value spans. Its [follow-up](https://github.com/mermaid-js/mermaid/pull/8121#issuecomment-5405782931) records real identity and flow-sequence span defects. | Reuse the diagnostic cases against our pinned reference; improve positions for unclosed labels and `@{` blocks. Our declaration source maps and metadata model already exist. A parser replacement or importing an unmerged branch as the oracle is unnecessary. |
| Follow up: responsive Kanban | [Pele's column folding](https://github.com/obsidianmd/pele/blob/52b5c9cc8020fd157599eb601bcc930134332331/src/diagrams/kanban/render.ts#L131-L145), inspected at its current head, provides an alternative to shrinking wide boards. [VS Code users](https://github.com/mjbvz/vscode-markdown-mermaid/issues/243) request wrapping or scrolling while retaining readable text; [Pele #32](https://github.com/obsidianmd/pele/issues/32) warns about synchronous resize/redraw loops. | The current representative board is 1,056px wide. Reflow is a deferred enhancement, not an existing general host-width contract. Any host adaptation should preserve column/card order, membership and readable font size, and schedule resize work outside synchronous observer callbacks. |
| Follow up: Packet inspector | Open [#7606](https://github.com/mermaid-js/mermaid/issues/7606) requests accessible field inspection with bit ranges, byte offsets and descriptions. | Existing `data-field-id`, `data-start` and `data-end` attributes enable a host-side inspector without changing proportional geometry or fetching assets. The proposed extra description syntax and automatic field-type colors are outside the pin and remain deferred. |
| Defer pending Block syntax | [#7198](https://github.com/mermaid-js/mermaid/issues/7198) requests varied row heights. Open [#7329](https://github.com/mermaid-js/mermaid/pull/7329), branch `feature/7198_different-rows-heights`, head `3f2a2c628e16bc75aae8c19c98adfb054a845540`, proposes `scale rows:varied` while also changing nested widths. | Preserve authored cells/spans and the current equal plain-row sizing rule. Separate existing-syntax sizing regressions from the unpinned grammar proposal; the branch's unresolved visual changes and manual testing do not justify importing it wholesale. |

Small public-API probes used the unmodified deep Treemap reproduction linked
above and the operational Six-M Ishikawa example from open
[#7689](https://github.com/mermaid-js/mermaid/pull/7689), inspected at
[`ef9844ac910e4f4a909b8b93041be0d9048de3e8`](https://github.com/mermaid-js/mermaid/blob/ef9844ac910e4f4a909b8b93041be0d9048de3e8/packages/mermaid/src/docs/syntax/ishikawa.md).
Both parse and produce SVG/ASCII in default and `publication-figure` styles.
The Treemap retains all 19 positioned cells and owned SVG groups: default
paints all 19 labels and verifies cleanly; `publication-figure` paints eight
and reports 11 omitted labels at the authored default canvas size. All 11 have
SVG title names after the repair. ASCII retains every authored label. The
Ishikawa retains 30 nodes and 29 causal edges and verifies
cleanly in both styles, including its nested KPI and transport causes. These
are bounded output/verification probes, not a new conformance denominator or
a claim about arbitrary density, visual readability or assistive technology.

A separate Chromium 154.0.8037.57 CDP `Accessibility.getFullAXTree` probe checks
two small production-SVG cases: tiny and zero-valued leaves appear as unignored
`graphics-symbol` nodes with their names/values, and an omitted `Inner` section
appears as an unignored `group` directly parenting its `Budget` leaf even after
its visual space is exhausted. This tests actual accessibility-tree presence,
roles and ancestry, consistent with Mermaid's
[accessibility guidance](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/config/accessibility.md#L5-L32).
It does not establish screen-reader usability or equivalent behavior in other
browser engines.

## Completing the community follow-up

The next pass covers measured runtime and delivery cost, semantic drift, and the community's Kanban/Packet workflows. The original 56 parser-getter differences are triage candidates. Independent authored-domain checks distinguish normalization from concrete loss: empty Gantt plans, repeated GitGraph commit labels, State paint assignments that invented nodes, and Class lollipop endpoints that canonical writing turned into ordinary class compartments. The fixes retain the existing language pin and keep beta/experimental families outside implementation scope. Arbitrary raw CSS remains a deliberate strict-security refusal.

A fully consumed official-corpus stage profile locates most work in layout, Scene admission and request resolution; SVG writing contributes under one percent in that diagnostic run. Allocation sampling identifies repeated adjacency-map construction inside peer-layout checks. Each pass and metric now builds one bounded directed index and reuses traversal storage. Request snapshots retain their accessor ordering and immutable admission while avoiding temporary pair arrays. Shared artwork and header-path helpers live with their existing Scene constructors and SVG writer. Packed, alternating measurements remain the authority for claimed speed and memory changes.

Treemap omits duplicate accessible strings: its native SVG title supplies the exact accessible name and tooltip. Zero-area descendants retain hierarchy and quantities while skipping unused paint resolution. Actual Chromium accessibility-tree checks protect names, roles and ancestry; this does not establish human screen-reader usability across engines.

Kanban's opt-in host option `kanban.maxWidth` wraps whole columns, retaining measured font sizes, source order and membership. The Editor's explicit wrap control schedules viewport changes outside ResizeObserver delivery, preserves the selected width in the shared request/export options, and displays wrapped boards at readable zoom. Parser errors identify authored delimiter positions through frontmatter; metadata source spans retain exact key/value tokens, including entity references.

Packet's existing fragment identity and inclusive range attributes gain an escaped semantic field label. The Editor exposes one selection per authored field, keyboard interaction, cross-row highlighting, bit ranges and zero-based byte offsets. Inspection changes the preview only; canonical exports retain their original styles and geometry. The production browser cases capture reviewer images and verify receipt correspondence with terminal output.

The complete 56-candidate getter audit classifies 50 as normalization, three as the documented Flowchart group-ownership policy, and three as actual semantic defects (two Class lollipop cases and one State paint-assignment case). Class interfaces now retain independent occurrence identities, including repeated labels and ordinary classes with the same spelling. State class/style directives preserve undeclared targets without inventing states. Empty Gantt plans and repeated GitGraph commit labels are separate successful-render fixes. Raw CSS remains rejected under strict security; the excluded experimental families and the `info` utility do not become new diagram implementations.

## Applying the shared aesthetic rules

The review follows the current [quality priorities](../../quality.md),
[chart-honesty principles](../system/chart-honesty.md) and shared Scene role
contracts. Meaning, readable ownership and finite geometry precede crossings,
bends, symmetry and compactness. Packet bit widths and Treemap areas remain
quantitative constraints, not space that a style may redistribute.

The audit found that five families assigned their primary surfaces the `chrome`
role. An explicit node/group owner preserves meaning but does not dispatch the
shared sketch backend or enroll that surface in role-specific brand checks.
Packet fields, Kanban cards/columns, Requirement compartments, Block outlines
and the boxed Ishikawa effect/categories now use the existing `node`/`group`
roles. Their enclosing semantic containers keep the authored public identities;
owned shape artwork does not create a second primary DOM identity. The Scene
boundary rejects identity-free artwork outside its matching semantic container.
Treemap already uses `bar` for its quantitative rectangles. Separators, label
knockouts and decorative header fills keep their deliberately quiet roles.
Treemap's explicit node/group/label text colors bypass the family's automatic contrast
re-inking, with authored class ink taking precedence. Block's authored group
fill also takes precedence over a Style's header fill, and automatic header ink
is selected against that final fill. These repairs preserve caller choices
rather than repainting them to improve an aesthetic score.
Where a Style fixes opaque text ink but leaves Treemap fills automatic, the
shared categorical palette evaluates ink contrast, page visibility and peer
separation jointly. Independent per-cell lightness clamping was rejected
because it collapsed distinct peers. A failed fixed-hue seed search consults
the same finite global corpus before rejecting a configuration. Sketch labels
already readable on the selected backend's page-colored halo do not constrain
the quantitative fill below them. This follows the actual graphical backend,
including host overrides; unpainted layout models the nominal Style backend.
The shared sketch backend's existing page-halo readability re-inking remains
in effect for ink that cannot read on its page.
Palette work remains request-local and
bounded to the default plus two role-ink variants; source-class colors do not
multiply palette generation. Unresolved/translucent ink has no invented
contrast guarantee. The hard peer-separation floor applies through 24 categories;
larger palettes retain best-effort linear behavior. If bounded search cannot
satisfy concrete constraints, it reports a prescriptive configuration error
rather than return a known violation. Search failure does not prove mathematical
infeasibility.

The existing review gallery includes all six complex gateway examples in
publication-figure, hand-drawn, Excalidraw, watercolor and hand-drawn/Dracula
compositions at a fixed seed. Same-input before/after SVG, PNG and layout
sidecars accompany each case. Existing raster text checks cover actual contrast,
canvas containment and text preservation across registered styles; domain tests
protect proportions, ancestry, membership and endpoints. These checks and agent
visual review do not establish arbitrary-density readability, human approval,
universal diagnosis of authored low-contrast ink or a periodic LLM-judge result.
