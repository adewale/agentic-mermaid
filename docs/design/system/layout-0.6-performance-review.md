# Performance review at the integrated PR602 checkpoint

Source: `99ed1d23853661966448ee9ee47c560cab910e63`, after integrating main
`f9ec8c115de14020d3c182d5d7f2e7e70bfcdefb`. This is a report before any performance
rewrite. The private-point sealing repair was a reproduced correctness fix.

## Measurement scope

The existing Node24.19.0 collector ran six fresh processes: Class128 TB with
Native/ELK and cache 0/1, plus the enrolled nonlinear forest with both backends
and cache 0. Each process performed one complete unprofiled warmup, then two
profiled repeats and a caption/text edit: **six warmups and 18 profiled calls**.
Every call returned with passed certification. Repeats matched the warmup's whole
SVG and entire receipt; edits changed the product. This does not qualify Sparse32.

Timed calls consume the complete SVG and receipt. Imports, artifact writes,
compression and explicit GC are outside those windows. Warmup/import/cold latency
was not timed by this collector. These are instrumented source-runtime samples,
not package-consumer benchmarks; inspector, observers and JIT/GC affect them.

## Five largest sampled Native source spots

The ranking below uses six Class128 Native calls, spanning both cache settings.
Self is sampled leaf presence; inclusive includes descendant stack presence and
overlaps other rows. Values are **elapsed sample-delta weights per call, not
exclusive CPU durations or removable time**. The existing analyzer selects active
`consume` intervals and reports 1/2/5ms sensitivity; these are diagnostics, not
acceptance gates. All five retain their order across those views. Fifth place
nearly ties marker-polygon preparation at 5ms (8.867 vs 8.866ms).

| Spot and source location | Self / inclusive ms per call | Matching case and next causal question | Expected speedup |
| --- | ---: | --- | --- |
| `visit`, `src/scene/scene-data-snapshot.ts:98` | 147.9 / 170.8 | None/data-oriented: reflective capture, alias/cycle handling, limits and publication. Investigate whether the producer can provide already-owned immutable admission data. The earlier descriptor-Map attribution remains withdrawn. | Unmeasured; no sufficient subtraction demonstrated. |
| `validateNode`, `src/scene/scene-validation-core.ts:724` | 23.3 / 85.1 | None/data-oriented: semantic admission reads identities, ownership, resources and diagnostics. First establish a redundant traversal of the same owned data before changing the representation. | Unmeasured; the validation obligations remain necessary. |
| `certifyNativePaint`, `src/scene/paint-certification.ts:1432` | 16.3 / 86.5 | None/data-oriented: the broad frame already contains spatial indexes and immutable batches. Identify the expensive primitive/interaction before proposing SoA or subtracting geometry work. | Unmeasured; this frame does not isolate an avoidable numeric loop. |
| Marker `include`, `src/scene/bounds.ts:358` (encoding at 373) | 12.6 / 18.6 | None/data-oriented: resource data is serialized with each occurrence's pose. A narrow candidate is producer-owned resource encoding while keeping pose, transform and live-caller behavior per occurrence. | Unmeasured; test the encoding's contribution first. |
| `boundedUtf8ByteLength`, `src/shared/utf8.ts:4` | 8.9 / 8.9 | None/data-oriented: length rejection and an ASCII fast path already exist. Establish whether the same authoritative bytes are rescanned before considering producer byte accounting. Preserve ceilings and surrogate semantics. | Unmeasured; no duplicate scan has been established. |

There is no measured hot hash lookup that justifies replacing the alias/descriptor
tables with flat arrays, no demonstrated one-field pass that justifies SoA, and no
independent sequential awaits in these synchronous rendering frames. A Map inside
a hot function does not identify which work consumed the time. Packed indices
would need their own bounded-domain evidence. No cache is added by this review.

## Existing caches and what they can hide

This inventory covers the reviewed rendering paths, not every hosted service,
transport, font loader or PNG surface.

| Cache group | Existing caches / owning files | Evidence and flag |
| --- | --- | --- |
| Layout and completed products | Positioned layouts and Native drawings (`experimental/position-cache.ts`); Native measured solver and strategy choices (`layout/agentic-producer-core.ts`); ELK results (`elk-instance.ts`); positioned Scene/native drawing/certificate associations (`scene/positioned.ts`). | Class cache-1 repeats hit the positioned-layout cache in both backends, hiding layout production from those repeat samples. That does not prove the miss path has a slow design. Completed-drawing/solver/strategy caches can mask their miss work; no full-drawing hit occurred in these Class calls. |
| Text and numeric derivations | Display plans (`shared/display-text.ts`), pixel blocks (`shared/prepared-text.ts`), host measurements (`text-measurement-profile.ts`), label blocks (`scene/bounds.ts`), Native text copy plans (`scene/native-paint-emission.ts`), numeric/attribute spellings (`shared/svg-number.ts`). | Derived-data reuse; no measured cache defect or justified replacement follows from the five frames. |
| Appearance and route derivations | Resolved palettes (`theme.ts`), fill ink (`color-resolver.ts`), routing profiles (`shape-outline.ts`), deferred terminal projections (`scene/deferred-terminal-projection.ts`). | No causal slow-design finding in this run. |
| Admission, writing and inspection | Capability decisions (`render-contract.ts`, `scene/backend.ts`), SVG inspections (`svg-inspection-cache.ts`), immutable serialization (`scene/serialization.ts`), XML validation/projected facts (`scene/svg-writer.ts`), resolved SVG styles (`scene/resolve-svg.ts`). | Preserve ownership and mutable-input isolation. Scene paint certification missed in all Class phases, so its measured work was not hidden by a certificate hit. |

Call-local alias maps, spatial indexes and provenance WeakMaps also exist. They
are not interchangeable with cross-request render-result caches. The observed
positioned-layout hits skip production work; the snapshot/validation/certification
spots above remain active. A redesign needs an uncached causal comparison.

## Fully consumed observations and adverse costs

Each triplet is repeat 1 / repeat 2 / edit. Process CPU includes all process threads
and may exceed wall time. These single samples support no performance ratio.

| Workload / backend / cache | Wall ms | Process CPU ms | Peak RSS KiB |
| --- | --- | --- | ---: |
| Class128 / Native / 0 | 807 / 573 / 660 | 1,368 / 1,033 / 1,337 | 308,180 |
| Class128 / Native / 1 | 612 / 596 / **2,393** | 961 / 1,001 / **3,871** | 307,632 |
| Class128 / ELK / 0 | 854 / 909 / 1,039 | 1,506 / 2,191 / 1,786 | 330,060 |
| Class128 / ELK / 1 | 516 / 570 / 796 | 830 / 851 / 1,338 | 325,584 |
| Forest / Native / 0 | 80 / 97 / 85 | 119 / 150 / 120 | 201,472 |
| Forest / ELK / 0 | 120 / 95 / 161 | 172 / 161 / 214 | 222,820 |

The adverse Native cache-1 edit has 1,477.80ms in long active-sample gaps excluded
by the 2ms view, including a 623.38ms gap. Those intervals cannot be assigned to a
Map, cache, wait or source frame from this evidence. Raw heap counters are retained
per phase; that edit's heapUsed was 64,137,424→90,982,216 bytes. Retained products,
source maps and profiler data make this an unsuitable leak experiment.

Offline compression uses Node24 `node:zlib`, gzip level 9 and Brotli quality 11:

| Original-source SVG | Raw / gzip9 / Brotli11 bytes |
| --- | ---: |
| Class128 Native and ELK | 189,921 / 13,063 / 7,555 |
| Forest Native | 8,027 / 1,462 / 1,233 |
| Forest ELK | 8,069 / 1,482 / 1,229 |

These are SVG payloads. The integrated shipped JS/module payloads and cold/cache/
edit costs without profiling still need separate qualification. CI already reports
real bundle/website budget failures; existing ceilings are unchanged.

Both fresh forest SVGs are byte-identical to their retained reference products,
binding the existing meaning/ink observations after integration. Native area
165,355.6575 and wire 463.4375 remain versus ELK 176,727.21 and 396.469666666:
area −6.43%, wire +16.89%, both eight bends. This is validation, not a new gain.

Evidence is retained under `performance-review-main-integration` in the campaign
week directory and the resumed GitHub evidence checkpoint. No performance rewrite
was applied in this dated review. The next causal work remains forest placement/terminal seating;
the profile's narrow resource-encoding hypothesis can be tested separately.

## Current Class128 probe — 7 November

Measured source `c9dabb20c67aa18587063ea0268fa4e5ebdf7c40`, followed by the narrow
bounds-only original-marker query below. The recovered existing Node24 collector
consumes the complete SVG and entire receipt after an untimed warmup, then records
two repeats and one caption edit with layout cache0. Its original run failed before
rendering on extensionless RoughJS imports; only the collector's recovery loader
was adjusted. Source maps, errors and products remain in `current-execution-c9`.

The initial three-call profile, before editing code, ranks these sampled source
frames at the analyzer's existing2ms sensitivity. Self is leaf presence; inclusive
includes descendants and overlaps other rows. These are elapsed sample-delta
weights per call, not exclusive CPU durations or removable time.

| Source spot | Self / inclusive ms | Matching case and decision | Expected speedup |
| --- | ---: | --- | --- |
| Snapshot `visit`, `scene-data-snapshot.ts:98` |100.5 /114.6|None/data-oriented. This is the first admission of mutable Class Scene data. Alias reuse and already-admitted bypass already exist; no safe traversal subtraction was found.|Unmeasured; do not skip admission.|
| `validateNode`, `scene-validation-core.ts:724` |13.8 /45.7|None/data-oriented. Identity, ownership, resource and diagnostic checks remain required; no redundant pass demonstrated.|Unmeasured.|
| `certifyNativePaint`, `paint-certification.ts:1432` |11.3 /67.1|None/data-oriented. Narrow only a demonstrated unused projection; retain all proof obligations.|Unmeasured.|
| Marker `include`, `bounds.ts:358` |10.0 /17.1|None/data-oriented. The original-pose query's consumers read only bounds, so omit its unused hull; retain the served-pose hull and resource/pose encoding.|No established end-to-end speedup.|
| Final-security callback, `output-security.ts:705` |8.6 /23.6|None/data-oriented. Actual SVG security remains a separate obligation; no duplicate authoritative scan established.|Unmeasured.|

Class's Native-labelled request uses its Scene adapter and first Scene admission;
the label does not imply the snapshot traversal is redundant. Existing caches in
the inventory above remain, including derived text data after warmup. No cache is
added, no hot hash-table primitive is isolated, no one-field pass justifies SoA,
and no independent awaits occur in these synchronous frames. Marker JSON cannot
be replaced by a resource ID/SVG string without changing its equality domain and
raw observation behavior; that broader hypothesis remains unimplemented.

The consumer change at `paint-certification.ts:1943` requests `includeHull=false`
only for original poses.
Every original-region consumer uses bounds; served regions retain their full hull.
Explicit work charges and caps remain unchanged. Issued write occurrences own
this path; ordinary raw callers do not gain an admission shortcut. Nearby tests
exercise mutable/prototype/CSS/marker/resource interactions; no general claim about
preserving every ambient callback count follows from removing dead computation.

An ordered, sequential before/candidate pair retains byte-exact warmup, repeat1,
repeat2 and edit SVGs and entire receipts. Repeats use388,607/400,000 proof operations;
edit389,269, all127markers and passed proof, unchanged. Marker-region sample weights
are7.697/12.499→6.964/11.241ms self/inclusive in this pair. Unchanged code also moves
in these samples, so this does not establish a causal runtime ratio. Instrumented
wall observations are448/440/419→387/343/379ms; CPU782/768/837→716/597/829ms.
Earlier candidate profiles overlapped tests and are retained as confounded evidence.
Cold/import latency, cache1 and uninstrumented throughput were not measured here.

Owning paint/transform/curved suites:740passed, known Sparse32 failed, and one child
stdin permission failure occurred before rendering. That child owner passes on its
permitted retry (392assertions). Core typing and changed-file lint pass. These are
regression guards for a behavior-preserving subtraction, not a bug-fix RED claim.
Sparse32 and ER256 remain distinct losses; no proof ceiling changed.

Rebuilt ESM/declarations succeed. The same Bun transfer reporter on actual emitted
bytes adds10 raw bytes per complete family closure; Class gzip+3 and Flowchart+14.
Initial gzip5,854→5,852, Brotli5,226→5,227. Other compressed deltas are retained in
`lazy-delivery-delta.json`; no lazy budget pass follows. Complete standalone HTML
for this latest source still requires measurement; the earlier dictionary sizes
remain measurements of their own revision. Raw per-phase RSS/heap counters are
retained; this single instrumented pair is not a memory/leak comparison.


## Circle contact work: 7 November

Before intervention at `6aa0ee45d9b6052addcb77036c1f7ba4c13b2cb4`, the existing
Node24 source profiler consumes full SVGs and entire receipts for cases372/230.
Each has one unprofiled warmup, two repeats and an authored-label edit, with ELK
cache 0. These are new targeted profiles, not replays counted as renderer progress.

Case230 repeat means are elapsed sample-delta weights in milliseconds:

| Frame | Self / inclusive | Requested case / justified intervention | Expected speedup |
| --- | --- | --- | --- |
| `layoutLayeredGraph`, `layout/agentic-layered-core.ts:99` |14.514 /57.993|None/data-oriented; broad placement frame does not isolate a hot hash primitive.|Unmeasured|
| `copyInner`, `scene/native-paint-emission.ts:105` |11.797 /15.757|None/data-oriented; mutable/getter/ownership copying remains required.|Unmeasured|
| `countPolylineCrossings`, `shared/edge-crossings.ts:131` |8.579 /15.014|None/data-oriented; no measured flat-index or SoA benefit.|Unmeasured|
| `collectLaneBlockers`, `layout/route-lanes.ts:215` |8.070 /10.975|None/data-oriented; collection frame alone does not justify repacking.|Unmeasured|
| Marker `include`, `scene/bounds.ts:358` |7.205 /12.617|None/data-oriented; the previously unused hull was already removed.|Unmeasured|

The contact pass is only about 2.059 ms inclusive per case 372 call. The existing
circle Map and shaft WeakMaps in `graph-paint-support.ts:85` are call-local; fresh
`[a,b]` input arrays repeatedly miss the shaft memo. A staged-input probe reduces
case 230's selected support constructions 111→68 but leaves its SVG/proof exact.
The first clear whole-band proposals fail caption separation with 4,724 units
remaining, before the later exhaustion. Stop this resource-work hypothesis as a
repair; no cache is added and no helper-only optimization is retained.

The separate correctness intervention reuses existing local terminal proposals
after the first geometry-clear band fails ink admission, before further global
lanes; a successful first band stays preferred. It changes output/proof work,
so before/after timing would not establish an equivalent-work performance ratio.
Raw profiles, source maps, RSS/heap and stopped drafts remain in `contact-producer-6aa`.
Case230 repeat walls 311.4/260.6 ms, edit 406.1 ms; case 372 239.5/243.4/231.4 ms.
Large elapsed gaps and three windows per case preclude a CPU speedup claim.
The earlier full cache inventory still applies; no async/SoA/packed-index change
is supported by these observations.

## Finite invariant cleanup: rejected flat storage trial — 7 November

At `b9502e98793c34c82cc397409e935550eefa4e0b`, a fresh cache0 SHA201 profile
preceded an external flat-column crossing candidate. Aggregate crossing self /
inclusive elapsed sample weights across two repeats and one edit changed
35.406/48.078→29.441/39.617ms; these are not exclusive CPU durations. All four
profiled SVGs/entire receipts remain exact. Fully consumed, sampling-disabled
ABBA processes then gave repeat medians179/322ms for controls versus440/484ms
for candidates; edit medians203/248 versus287/343ms. Process peak RSS overlaps
without a consistent win. Retain no flat-storage rewrite and claim no speedup.
Raw profiles, equal products and adverse costs remain in `invariant-plan-62d`.


## ER snapshot and glyph-query reuse — 7 November

Profile before implementation at a19526203, Node24.19.0, strict Native ER256 BT,
layout cache0: one refusal warmup, two repeated refusals and one caption edit.
The existing collector consumes complete public products when returned; here all
three calls refuse before delivery. Imports, compression and explicit GC are
outside the measured windows. Sample weights below are per call across those
three windows; self is leaf weight and inclusive is overlapping stack presence,
not exclusive CPU time or independently removable time.

| Source spot | Self / inclusive ms | Matching case and decision |
| --- | ---: | --- |
| `build`, `shared/ink-index.ts:23` |8.767 /13.105|Data-oriented reuse: retain the existing call-local index while geometry is unchanged; avoid querying it once per glyph piece.|
| `finishErGeometry`, `er/layout.ts:1324` |7.687 /63.648|Data-oriented subtraction: reuse exact glyphs, shafts and bounds; invalidate after face/frame/caption route repair.|
| `qualify`, `shared/immutable-parts.ts:12` |7.652 /7.757|No sufficient removable work demonstrated; preserve ownership/admission.|
| `tryParseCssColor`, `shared/color-math.ts:160` |7.535 /7.535|No causal intervention demonstrated; add no cache.|
| `resolveRoleStyle`, `scene/roles.ts:238` |5.700 /7.129|No causal intervention demonstrated; preserve role semantics.|

The cache inventory above remains applicable. This change extends neither a
cross-request cache nor proof authority. Snapshot bounds remain a broad phase;
exact charged piece intersections and incident-terminal exclusions still run.
Snapshot-only and union-only BT trials still refuse. The combination returns all
eight ER256 direction/backend products with passed proof. Native BT/RL use385,344
geometry operations, ELK371,874, against the unchanged400k cap. Native TB/LR work
falls397,206→343,421; ELK384,466→330,681, preserving exact prior SVGs. This is a
work/delivery improvement; refusal and completed delivery are unequal CPU work.

An admitted ER208 BT Native before/final probe retains exact SVGs and entire
receipts for both repeats and the edit. Wall observations672.97/609.19/612.16→
595.73/662.83/585.17ms and CPU1118.31/962.78/919.73→1009.58/1137.23/1056.26ms
are mixed. The final probe overlapped supplemental raster work; peak RSS also
mixes process lifetime and retained profiler products. No causal timing/memory
ratio, cold/cache1 result or p95 estimate follows. Preserve these adverse samples.
A reused small-query heuristic and gap-only union candidates can cost more on
other geometries; all visits and exact checks remain metered. The existing874
inputs/backend retain exact SVGs, route vectors, delivery and proof statuses.

Evidence: `outcome-plan-a195-20261107` on the existing review evidence branch.

## Trinity public Requirement checkpoint, 8 November

Source `01497b98ff72f5e0c30d23e1379adeb09cc2032c`. The existing inspector collector
ran three fresh source processes (ELK, Native, Trinity), each with one complete
unprofiled warmup, two profiled repeats and an edit. All9 profiled SVG+entire
receipt calls returned with passed certification. This profile precedes any new
shared-cost optimization. It is separate from the60 unprofiled calls below.

Raw elapsed sample-delta weights, averaged over9 calls; inclusive rows overlap.
These are sampled source-attribution weights, not exclusive CPU or removable
wall time. The1/2/5ms active-interval sensitivity views reorder the lower spots;
the raw ranking is not a stable universal ranking for other diagram families.

| Raw self-ranked spot | Self / inclusive ms per call | Matching case and proposed action | Expected speedup |
| --- | ---: | --- | --- |
| `copyInner`, `scene/native-paint-emission.ts:105` |9.65 /13.17|Data-oriented ownership capture. Its identity Set protects dynamic alias/cycle semantics; sampled function time does not isolate a hot hash operation. No safe flat-index substitution or redundant traversal established.|Unknown; no rewrite justified.|
| `copy`, `scene/native-paint-emission.ts:243` |3.05 /13.38|Existing call-local text-plan reuse. It avoids repeated reflection while creating fresh receivers required by getters/ownership. No evidence that another cache or sharing those receivers fixes a slow design.|Unknown; preserve custody.|
| `readXmlDataEnd`, `output-security.ts:217` |1.55 /1.82|Data-oriented scalar scan, already indexed by UTF16 offset. Named-reference lookup is not separately shown hot. Preserve surrogate/reference/delimiter validation.|Unknown.|
| `verifyDocumentEnvelope`, `output-security.ts:325` |1.51 /4.59|Data-oriented scan; envelope parsing already includes attribute security. Metered private-projection validation and final public-byte security check different artifacts.|Unknown; do not delete either obligation.|
| `omitUndefinedObjectFields`, `render-contract.ts:501` |1.40 /1.47|Data-oriented admission. Normalization privately freezes/brands its result, so the subsequent immutable snapshot is already a membership return. Receipt composites have separate aggregate budgets; no safe duplicate walk subtraction established.|Unknown.|

The cache inventory above still applies. Trinity adds no geometry cache; the lazy
loader's pending promise is dependency lifecycle. No hot one-field pass or serial
independent awaits were demonstrated in these synchronous frames. Independent
causal review stopped the apparent-duplicate hypotheses; skipping necessary work
would only time absence of an obligation, not establish a valid optimization.

Existing unprofiled complete-product collector:12 serial fresh processes,
3backends×2layout-cache settings×2replicas, one cold render, two repeats and two
edits each:60/60 returned/passed. Module import is separate; derived caches may
remain warm. On this one TB Requirement, cache-disabled cold medians were
ELK284.6ms, Native165.7ms, Trinity140.1ms; second-repeat medians44.9/29.2/24.9ms.
Cache-enabled second repeats28.5/27.2/25.7ms; second edits29.3/20.8/23.3ms.
Two process replicates, warmup/JIT effects and mixed layout quality do not support
a general speedup ratio. Process peak RSS ranges overlap and include source
imports/harness/artifact compression; negative heap deltas include GC. No memory
superiority is established. Exact values, ranges, whole-product equality,
cache audits and failed/unavailable cells are in `trinity-public-20261108` on
the existing evidence branch; no new cache or performance rewrite is shipped.

## Five-family profile at `fe9113601`, 8 November

The existing collector now profiles five supported cases (Flowchart, Requirement,
Class, ER and single-container Architecture), three backends, two repeats and an
edit:45 complete SVG+entire-receipt calls, all returned/passed. Each fresh process
has an unprofiled warmup; layout-cache flag is off, derived caches remain. Profile
runs are separate from300 unprofiled calls and browser/build observations.
This changes the workload mix; lower weights than the earlier Requirement-only
profile are not a measured implementation improvement. Cold-cost causes remain
unisolated by this steady profile.

Raw elapsed sample-delta weights per call, self/inclusive; inclusive rows overlap
and these are not exclusive CPU or removable wall durations. Original source maps
and1/2/5ms active-interval sensitivity views remain in the evidence.

| Spot and current source location | Self / inclusive ms | Matching case, proposal and limit | Expected speedup |
| --- | ---: | --- | --- |
| `copyInner`, `scene/native-paint-emission.ts:105` |2.162 /2.842|Data-oriented ownership capture. Identity lookup is not isolated as the hot instruction; fixed x/y capture already exists. A flat pointer table would need prior trusted IDs and must retain alias/cycle/getter custody. No further safe subtraction demonstrated.|Unknown; no rewrite shipped.|
| `visit`, `scene/scene-data-snapshot.ts:98` |1.581 /1.749|Data-oriented admission; it reads all descriptors and enforces aggregate object, text, key and array bounds. The existing private admitted-document membership return already skips repeat admission. Call-local alias maps are semantic custody, not a cache hiding an established slow design. The diagnostic-allocation ceiling below is insufficient; stop without deleting the walk.|Unknown; ceiling probe below does not justify implementation.|
| `certifyNativePaint`, `scene/paint-certification.ts:1491` |0.740 /3.531|Data-oriented inspection of the actual emitted artifact. Many fields and mandatory ownership/text/occlusion checks are consumed; no one-field AoS pass or sufficient duplicate validation is demonstrated. Reuse of numeric producer evidence already exists.|Unknown; keep proof obligations.|
| `copy`, `scene/native-paint-emission.ts:243` |0.623 /2.948|Existing call-local text-plan cache. It reuses reflection while producing fresh receivers for mutable/getter semantics. No additional cache or safe cross-capture receiver sharing is justified.|Unknown; retain custody.|
| `omitUndefinedObjectFields`, `render-contract.ts:501` |0.552 /0.604|Data-oriented normalization. Subsequent private immutable membership already avoids another snapshot traversal; receipt aggregates have distinct budgets. No duplicated work proved removable.|Unknown.|

No independent serial awaits occur in these synchronous frames. The cache
inventory above remains applicable; Trinity still adds no geometry cache. Lazy
pending promises are dependency lifetime. Snapshot cost is shared by Class/ER
through all three layout backends, so any valid improvement would help ELK too.
Independent scope/value review is retained in `profile/causal-review.md`.

### Diagnostic-path ceiling: stop before production changes

A deliberately unsafe overlay removes only the two successful-recursion path
concatenations at `scene-data-snapshot.ts:172,221`. It preserves descriptor,
cycle, alias and aggregate accounting, but its nested error paths are wrong: it
is not a production candidate or correctness qualification. Four fresh Class
Native processes per variant, reversed pair order,40 complete calls. Successful
SVGs and entire receipts are byte-exact across variants; all calls returned/P.

Baseline/ceiling repeat2 medians26.76/28.04ms (ceiling worse); edit2 23.65/22.00ms;
repeat1 33.85/33.51ms. Ranges overlap. This does not establish a sufficient,
consistent benefit or a production speedup ratio. Stop the hypothesis here; do
not implement a path-builder rewrite on this evidence. No source optimization
or new cache is shipped. Raw overlays/results remain in `profile/path-ceiling`.
