# Trinity: measured layout contract and replacement design

Status: bounded Trinity rectangular Flowchart/State, fixed State start/end circles, flat Class cards and Requirement rendering is publicly selectable with
`graphLayout: { backend: 'trinity' }`. Source/Node, layout, PNG and lazy browser
entry points share the real adapter and decision evidence. Routed admission is
64nodes/128edges with measured rectangular or fixed singleton-circle contacts; unsupported shapes, groups,
route paint, State notes/other pseudostates and other families decline unless ELK fallback was requested. The
private placement-only forest slice reuses the existing body producer up to
existing4096node/16384edge limits. Compound/family migration and adoption remain
unfinished. Defaults, limits and package versions are
unchanged. [Execution plan](layout-0.6-qualification.md) owns the work order;
[TODO](../../../TODO.md#owned-graph-backend-qualification-owner-request-pr-449)
owns the backlog. Original design observations bind to
`f55a8f8ecdecf2727a2e623749854f0abe52088e`; the work log records implementation.

## Objective and scope

Build a small deterministic solver for the measured constraints used by this
product. The owner's objective remains matching or beating ELK on correctness,
performance, memory and shipped bytes. This is an engineering objective, not an
achieved result or a promise of superiority for every graph. Keep quality tradeoffs
visible; a runtime or area win cannot compensate for lost meaning or hidden ink.

Trinity targets the graph-layout portion of Flowchart, State, Class, ER,
Requirement and Architecture. Family adapters retain syntax, text measurement,
shape interpretation, specialized relationship geometry and rendering. Sequence,
charts, terminal-cell geometry, arbitrary ELK algorithms/options, Mermaid themes
and foreign renderer internals are outside this kernel. Existing product support
and all enrolled failures remain visible while Trinity coverage grows.

Actual graph requirements include all four directions; unequal measured boxes;
DAGs, cycles and self-loops; parallel/reciprocal links; labelled long edges;
disconnected components; nested groups, headers, group endpoints and boundary
crossings; author order/partitions and mixed scope directions where the caller uses
them. These cannot be dropped to make a benchmark look better. Start with an
explicit experimental flat-graph slice, including crowded ports and cycles; decline
unimplemented compound/family constraints instead of flattening or ignoring them.

Pele 1.13 demonstrates a dependency-free product with its own visual policy,
conditional rank expansion and integrated endpoint/coordinate work. Its source
review is useful evidence, not an executed equivalent-work speed or correctness
ranking. See the [Astra review](https://github.com/adewale/agentic-mermaid/blob/016ae47e00b495b8256c0f7f49b01e59896ee543/astra-pele-replacement-f55-20261108/REPORT.md).

## One common boundary, three adapters

The existing `layout/backend.ts` selects two callbacks; `measured-backend.ts` is a
re-export, not a common geometry protocol. `MeasuredGraph` and `AgenticLayout` in
`agentic-layered-core.ts` are the starting data model. Extract their neutral part
into a leaf module (proposed `layout/measured-graph.ts`) used by ELK, Native and
Trinity. Keep the public Native spelling `agentic`; `trinity` is proposed only.
Layout backend, SVG/style backend and native drawing producer are different roles.

```text
capture source/options/style/font context
  -> family measures and normalizes one owned request
  -> select backend and admit its capabilities
  -> placement or routed solve
  -> family completion if required
  -> completed geometry
  -> emit actual bytes and occurrence evidence
  -> certify that write and publish the product
```

The common request carries stable authored identity/order and integer endpoint /
parent references; finite dimensions with explicit fixed-size versus permitted
minimum-size growth; shape contact domains; measured node/frame
stroke and corners; label painted bodies/halos and their route associations;
endpoint marker footprints, port spans and terminal leads; scope/header/padding
constraints; direction, spacing and ordering intent; requested output role; and
existing work ledgers. IDs remain externally meaningful, including Unicode names
and names resembling generated IDs. Index conversion happens once per owned input.
No DOM, text-measurer callback, CSS getter or ELK property bag enters the kernel.
Unknown shape/contact domains are explicit, never treated as exact rectangles.

Remove Native search switches (`compactPrivateRanks`, `cycleOriented`,
`authoredCycleOrder`, `portAwarePlacement`) from the neutral request. They remain
private adapter/kernel decisions. Represent required physical spacing and endpoint
intent rather than exposing rank-doubling or ordering implementation details.
The solve is synchronous and deterministic. Resolve fonts/dependencies before it;
stable authored-order/index tie breaks and operation budgets govern search, not
wall-clock deadlines, randomness or async callback arrival order.

The following is a contract sketch, not an implemented API or serialization format:

```ts
type LayoutRole = 'placement' | 'routed'
type SolveResult =
  | { kind: 'placed'; placement: Placement; work: Work; selection: Selection }
  | { kind: 'routed'; geometry: CompletedGeometry; work: Work; selection: Selection }
  | { kind: 'declined'; capability: string; reason: string; work: Work }

interface LayoutAdapter {
  solve(request: OwnedMeasuredRequest, context: ExistingWorkContext): SolveResult
}
```

A placement request permits only placed/declined results; a routed request permits
only routed/declined results. Enforce that relation in implementation types and at
the adapter boundary, along with cardinalities, index ranges and finite geometry.
Placement records include actual dimensions, group extents and contact/port
assignments; routed records also include ordered points, label anchors and final
extent. Size growth is valid only when the family permits it and its renderer
uses those returned dimensions. A fixed measured box cannot be enlarged silently.
Preserve current typed errors and decline behavior. A backend's declared local
capability/size limit is distinct from exhausting a shared hard work ledger.
Existing typed local declines may permit the caller's explicit fallback; shared
hard exhaustion, deferred dependency, invalid input and producer defects must not
be caught and relabelled unsupported. Paint-proof exhaustion retains its current
unverified/refusal policy, separate from solver admission. Never reset a cumulative
ledger merely by retrying another candidate/backend.
A supported request must not silently omit constraints or authored subjects.

Selection/fallback stays in `layout/backend.ts`, outside solvers. Preserve explicit
no-fallback comparisons and requested/selected/primary/companion evidence. Extend
existing typed fallback rules deliberately when Trinity is registered; never catch
all exceptions and call ELK. Backend attempts and internal placement/routing
candidate attempts have distinct meanings and retain their actual history.

ELK translates neutral constraints into its existing layered options inside its
adapter. Native translates to existing private flags and limits. Trinity consumes
neutral constraints directly. Initially delegate to existing family producers so
boundary extraction preserves outputs; do not force a simultaneous solver rewrite.
Wrapped namespace sizing/retry and other family rules remain explicit adapter work.
If such a retry changes dimensions, produce a new owned measured request for the
affected scope; never reuse completion evidence from the previous dimensions.

## Geometry ownership and Trinity's kernel

Each constraint has one producer. Family measurement owns label/shape/marker paint
interpretation. The solver owns placement and generic route reservations. Class,
ER and Architecture keep their specialized completion where required. A routed
result becomes completed only after every required family repair; a placement
result carries no claim that its routes are usable. Do not discard ER/Architecture
placement-only paths by manufacturing temporary generic routes.
An existing backend may internally compute more than the requested placement;
record that cost honestly. Avoid redundant routing in our adapters, rather than
claiming that a placement-only return makes ELK's internal routing disappear.

Trinity's ordered work is component/scope decomposition, private cycle orientation,
ranking, ordering, endpoint-capacity planning, coordinate placement, routing/label
seating, and final extent calculation. Preserve authored endpoints while privately
reversing constraints. Endpoint and label demand must influence placement, not be
compressed into whatever space remains afterward. Rank expansion must preserve
physical spacing; dummy boundaries must not multiply real-terminal clearance.
Use the existing forest path where its contract applies, and bounded layered work
elsewhere. Long-edge/dummy expansion is charged to existing limits; no unverified
straight-route escape or new sparse representation without a measured witness.

For each selected face/order, reserve actual marker supports, terminal leads and
required separation before committing coordinates. If demand does not fit, revise
allocation/placement/routing within budget or explicitly decline. Proportional port
compression is not a valid fallback. Labels occupy their actual painted body and
belong to their authored route; foreign routes must respect that body. Shared fan
routing requires explicit compatible ownership, not merely coincident points.

Post-placement shortening must preserve the same endpoint, marker, label, frame
and foreign-route constraints. Candidate feasibility precedes preference scoring;
selecting a lower-crossing candidate cannot expose an infeasible compact face.
Report area, wire, bends, crossings, aspect ratio and edit displacement separately.
Keep selection priorities explicit and consistent for the contract being compared;
no weighted score is an independent correctness proof.

A completed Trinity result bypasses ELK-specific normalization/heuristic repairs.
Unconditional translation and actual written-number handling retain their explicit
contracts. Any later geometry change must go through the existing route mutation /
completion owners, invalidate affected derived geometry/proof, and re-establish
completion before publication. The writer and final ink checker still inspect the
actual output. Do not let a solver certificate stand in for an emitted-SVG proof.

Use dense integer references and compact adjacency. Use numeric arrays for hot
rank/order/coordinate fields when their passes benefit; retain structured authored
metadata at the adapter. Native/Pele already use indexed structures, so SoA is a
profiled choice, not a promised breakthrough. Keep scratch storage call-local,
release losing candidates, and materialize retained output once. No new global
cache, per-node phase wrapper, runtime plugin registry or packed-bit identity scheme
is required. Preserving mutable-input/getter/alias isolation remains mandatory.

## State machines and invariants at their existing owners

Reuse current state checks and private ownership evidence. Introduce a type/union
only where a concrete consumer otherwise permits an illegal combination; do not
build a general typestate framework or add wrappers to every point/pass.

| Machine / present owner | Required transition or invariant | Refactoring scope |
| --- | --- | --- |
| Source/options/font/style admission — `render-contract.ts`, `shared-render-options.ts`, `text-measurement-profile.ts` | Live caller data -> captured context; later getter/CSS/host mutation cannot alter this request. | Shared; feed one captured measurement context to all adapters. |
| External Scene admission — `scene-data-snapshot.ts`, `scene-admission-state.ts` | External/mutable -> owned snapshot -> semantically admitted under its recorded mode/checks. Frozen caller objects are not trusted ownership evidence. | Shared; retain existing admission. A first mutable-input snapshot is necessary work, not a duplicate. |
| Backend admission/fallback — `layout/backend.ts`, `decision-evidence.ts`, family selectors | Requested -> attempted -> selected or typed decline/rejection; record every permitted fallback. Local capability bounds differ from shared hard exhaustion; preserve existing error/decline behavior. | Shared selector; adapter-local capability checks. Keep loader failure/deferred execution separate. |
| Private cycle/scope expansion — `cycle-layout-search.ts`, `agentic-compound-core.ts`, `measured-forest.ts` | Authored -> private oriented/local projection -> restored authored geometry; cumulative work and complete/scope contexts survive recursion. | Native stays private; Trinity owns its corresponding algorithm state. No extra public flags. |
| Candidate search — `agentic-producer-core.ts`, `certification.ts` | Produced -> completed -> feasible -> compared -> selected/discarded; preserve winner provenance and release losers. | Native/Trinity-specific search; common decision vocabulary. Do not broaden the zero-crossing gate before fixing coupled feasibility. |
| Geometry mutation/freeze — `layout-engine.ts` `LAYOUT_PIPELINE`, `layout/pass.ts`, `route-geometry.ts` | Mutable placement -> completed routes; moving boxes/points/labels invalidates affected indexes, ports, channels and certificates together. | Extract legacy completion into its owner; use existing mutation boundaries, not another global epoch/cache. Existing production pass checks remain. |
| Family completion — `class/layout.ts`, `er/layout.ts`, `architecture/layout.ts`, `requirement/layout.ts` | Placed/routed input -> family-correct endpoints, headers, labels and extent. Final fitting cannot leave stale anchors/bounds. | Shared across solvers where semantics match; family-specific geometry stays local. |
| XML capture/write — `scene/serialization.ts`, `scene/svg-writer.ts`, `written-geometry.ts` | Collecting -> prepared -> emitting -> finished, or abort; finish uses the same proof/work ledger and the actual complete write. Balanced XML, definitions, CSS/viewport scope and UTF16 remain checked. | Shared; subtract producer-owned repeated construction only after a sufficient-work causal probe. Never move ambient lookups casually into emission. |
| Drawing/proof publication — `scene/positioned.ts`, `positioning.ts` | Captured drawing -> certified retained artifact; a replaced producer/newer reentrant publication cannot receive an older completion. | Shared; preserve existing identity checks and captured/certified union. Receipt availability and visible correctness stay separate. |
| Cache lifetime — `elk-instance.ts`, `agentic-producer-core.ts`, `experimental/position-cache.ts` | Miss -> owned retained result -> isolated hit -> eviction; request/implementation/measurement identity must match, mutable consumers cannot alter retained state. | Retain present bounded caches, no additions. Measure miss/hit/retention independently; proof evidence is not interchangeable with layout cache entries. |
| Worker/execution/dependency lifetime — `browser-preview-client.ts`, `browser-preview-worker.ts`, `browser-preview-runtime.ts`, `scene/emission-context.ts` | Queued/in-flight/stale/cancelled/settled work publishes only its current result; captured execution contexts restore on exit; dependency loading remains outside a synchronous solve. | Keep existing queue/restart/loading owners. Integrate one new backend loader without moving transport into the kernel. |

Enforce finite coordinates; nonnegative extents; exact subject/edge correspondence;
valid parents/endpoints; authored orientation/order; real shape attachment; enough
marker/label/header room; no unintended shared shafts or through-node routes; and
bounds that contain actual emitted ink. Where exact paint cannot be established,
retain unknown/unverified status instead of claiming compliance. Preserve all
existing node/edge/expansion/search/geometry/XML/proof and cache limits.

## Refactoring map and expected value

Paths below are current owners; proposed files are named explicitly. These are
changes to investigate/implement in the short execution plan, not completed work.

| Change / owners | Benefit and who receives it | Evidence that would stop or narrow it |
| --- | --- | --- |
| Extract neutral request/result from `agentic-layered-core.ts`; extend `backend.ts`, `measured-backend.ts`, `decision-evidence.ts`; proposed `measured-graph.ts` and small ELK/Native adapters. | One family-to-solver contract; avoids three input builders and solver-dependent call sites. All backends. | Mapping loses a used constraint, changes read order/admission, or requires an opaque backend-options bag. Keep that feature in its existing adapter until represented explicitly. |
| Split measurement, dispatch and legacy completion out of `layout-engine.ts`; move current `finishGraphGeometry`/manifest/context together into a leaf completion owner. Preserve public entry re-exports. | ELK keeps necessary repairs; Native keeps its guarded path; Trinity can return completed geometry without importing ELK normalization. Fewer import cycles/accidental closures. | A proposed leaf still imports orchestration/ELK/Scene transitively, or changes output because pass ordering/guards were lost. No claimed byte win until the built request graph shrinks. |
| Migrate family callbacks in Class, ER, Requirement and Architecture to that boundary, one owner at a time. General graph path covers Flowchart/State. | Reuses one authoritative family measurement and specialized finalization; avoids generating routes that a family discards. All backends. | The supposed common measurement omits namespace wrapping, header constraints, cardinalities or side-specific semantics. Keep required retries explicit. |
| Implement Trinity's capacity-aware kernel; keep its private completion/search separate from `AgenticGraphBindings`. | Fixes the demonstrated face/shortening interaction at its first stage; smaller independent kernel. Trinity-specific; reusable proven primitives may later help Native. | Crowded-port repair introduces any retained adverse contact or merely changes proof status; quality/runtime/memory costs exceed what the actual workload gains. Do not repeat blanket enlargement or clearance-only veto. |
| Consolidate completion/certification lifetime at existing mutation/publication owners; first investigate cyclic callback double fitting and selected-candidate re-certification. | Potentially removes bounded copies/visits; honest candidate traces. Native first, shared consumers only where proved. | Geometry really changed, alias ownership requires copying, or complete-product measurements do not improve. Ordinary fitting already occurs once; no wholesale-check removal. |
| Optimize XML event/escaped-literal construction in `svg-writer.ts`, `serialization.ts`, `native-paint-emission.ts` only after sufficient subtraction is demonstrated. | Shared proof completion and memory benefits, including ELK. Sparse32 remains a distinct work item. | Complete work still exceeds 400,000 operations, or getter timing/definitions/ownership changes. Streaming-only, name-token-only and own-paint replay proposals are stopped. |
| Extend `types.ts`, `render-option-contract.ts`, `browser-lazy.ts`, existing lazy entry/loaders, CLI/editor/MCP consumers and `tsup.config.ts` when registering Trinity. | Explicit selection and standalone kernel/family closures; prevents Native/ELK eager imports in Trinity use. | Backend spelling is silently dropped, fallback contaminates comparisons, or the actual chosen entry still fetches other solvers. Public backend options remain unchanged until implementation. |

## Metrics and comparison contract

Trinity now has bounded public Requirement, Flowchart/State and Class delivery.
The frozen 30-case comparison returns 16 SVGs with passed certification through
Trinity, versus 28 through Native/ELK; Trinity retains 12 unsupported cases and
the same two input errors. Authored meaning, actual written ink, receipt proof
and layout quality remain separate. Newly supported State circles and Class
cards do not establish compound, notes, interface or cardinality support.

The existing collector has measured 120 complete Flowchart/Requirement SVG+receipt
calls at `bbab8283d`, with cold/cache/edit and memory kept separate. Two cases
and two replicas establish no general ratio or memory superiority. Actual
three-family lazy delivery is smaller for Trinity than ELK; the full editor
still exceeds its original gzip budget. Class complete-product costs follow
its own current qualification. Exact measurements and adverse cells belong
in the work log, PR and recoverable evidence, not a new scoring framework.

Freeze workload enrollment/options and requested
capabilities before outcomes; keep unsupported/declined/refused/unknown cells in
the report. Do not redefine the domain after losing. Use existing Trident and
owning conformance/ink tools, not a new qualification framework or composite score.
The optimization directions are fewer correctness failures/unknowns without lost
delivery, lower complete-product latency and memory, and fewer required shipped
bytes. Measure all four; improvement in one does not establish the other three.
No percentage speedup, byte budget or new pass threshold is invented here.

| Key metric | Measure / boundary | Current evidence and interpretation |
| --- | --- | --- |
| Delivery and authored correctness | Returned, refused, unsupported and erroneous products; retained identities, parents, endpoints, direction, labels and required family features on the same inputs. | Trident: 30 fidelity cases per backend, 28 SVGs returned each. Unsupported top-level fontSize and the warned offline image placeholder are shared scope gaps; Trinity must not silently change those policies. |
| Actual visible correctness | Independently observed missing/overlapping/clipped ink, node/marker/label attachment and route ownership on finalSVG. Keep unknowns separate. | Named Native contacts 152/372/201/241 remain. Planned Trident: 613 criteria each; Native 576 passed / 28 blocked / 3 failed / 6 unsupported; ELK 575 / 29 / 3 / 6. These are criterion counts, not an overall correctness percentage. |
| Execution cost | Backend-only solve on identical measured input **and** complete public SVG+receipt consumption. Separate import/first use, uncached repeat, cache hit, authored edit and churn. | Portable: 27 enrolled cases; 25 positive completed pairs favor Native uncached; cached repeats 14 lower / 11 higher. Exploratory, not a global ratio. Focused Class128 medians 233.80 / 225.45 ms still do not establish a fixed 11% penalty. SVG-only timing does not measure receipt work. |
| Memory | Peak worker RSS, API-return/after-GC heap, allocation and retention after the same released/retained workload. Record baseline, expanded vertices, points, scratch and copies separately when profiling. | Flowchart128, cache off: RSS 125.43 MiB Native / 185.85 MiB ELK. Peak includes import/driver/qualification. Both 1,000-call diagnostics grow; no settled-memory/leak conclusion. |
| Download and delivery | Actual requested kernel/family/entry union, raw/gzip9/Brotli11 bytes and request count; include binding, host, worker and fallback demands separately. | Six-family fetched product union Native 476,485 gzip / 407,052 Brotli bytes versus ELK 851,989 / 682,687; 39 versus 37 requests including binding. Server sent raw files; compressed sizes are computed from exact fetched bytes, not compressed wire transfer. |
| Output size | Final SVG/receipt raw and compressed bytes, plus retained emitted/prepared data. | Report per input. A smaller solver can still create a larger SVG; module size is not package/standalone/output size. |
| Quality and edit stability | Area, wire, bends, crossings, aspect ratio, label conflicts, symmetry and displacement separately; actual viewport/task remains relevant. | Forest wire 397.71 versus 396.47 with Native area −6.43%; Class2 area 65,400 versus 61,400; crossing276: 6 versus 4; Sparse256 implemented historical +5.04%. No single score erases losses. |
| Proof availability and bounded work | Passed/unverified/failed proof, exhaustion stage and actual operations, distinct from delivery/observed correctness. | Fixed 874 inputs per backend: Native 740 passed / 134 unverified, ELK 696 / 178; not independent ink parity. ER256 now returns in 4/4 directions per backend within 400,000 operations; Sparse32 remains unverified at that cap. |

Use pinned Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038` and captured artifact /
dependency identities. The [broad report](https://github.com/adewale/agentic-mermaid/blob/e4e94f685271e330c1e9c998e33c011a48f89f02/trident-native-elk-df133-20261108/README.md)
and [focused supplement](https://github.com/adewale/agentic-mermaid/blob/f88d839dbe2577524ea2ec641d0814728913a0c6/trident-class128-cache-445-20261108/README.md)
retain all data, definitions and limitations. Calibration belongs to the existing
protocol and confidence of each result, not a new assistant-created acceptance
threshold. Per-lane A/A controls do not by themselves estimate a backend effect;
p95 of adaptive batch means is not individual-call p95. No unequal-work speed ratio.

A backend-specific improvement and a shared renderer improvement are different
claims. XML/capture work, option isolation and Scene ownership can benefit ELK too.
Report before/after and ELK/Native/Trinity separately on the combined revision.
Adding a third backend can increase the complete package even when its selected
lazy closure is smaller. Report both, including mixed sessions that actually load
fallback ELK; do not present a Trinity-only closure as the whole product payload.
Keep all adverse costs and unavailable historical comparisons. Replacement24 stays
sealed. No result from this design promotes a backend or declares the PR ready.

## Conformance without another framework

Extend owning tests when implementing each contract, rather than creating a
second suite that tests whether the first suite exists:

- `graph-layout-selection.test.ts` and existing family backend owners: explicit
  requested/selected backend, typed fallback/error propagation, role mismatch,
  subject correspondence and supported constraints. Compare geometry obligations,
  not identical coordinates from different solvers.
- `agentic-layered.test.ts`, `layout-certification.test.ts` and existing route /
  family owners: physical capacity, restored endpoint direction, label/marker /
  header clearances and candidate-change interactions, including adverse controls.
- `scene-svg-writer.test.ts`, `positioned-artifact-convergence.test.ts` and existing
  admission/ownership owners: same-write proof, abort/reentrancy, mutable/getter/
  alias isolation, UTF16, definitions, CSS/viewport and original work limits.
- Existing Trident authored-meaning/final-ink observers and public browser/package
  consumers: actual output and actual selected dependency closure. Unknown observer
  coverage remains unknown; an interface helper pass is not visible correctness.

Use exact product preservation for the initial extraction; require the owning
failure to disappear and inspect affected final ink for a behavior change. Do not
replay an unchanged broad comparison and count it as Trinity progress.
