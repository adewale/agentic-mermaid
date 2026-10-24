# PR449: what to simplify, repair, measure, and keep out of scope

22 October 2026. Research and diagnostic profiling at PR head `9ffd5369`; renderer
still frozen at `e9db0dbe`, `agentic-layered@22`. Five parallel investigations
covered academic methods, community feedback, scope/subtraction, profiling, and
stability/certification. This report adds evidence and an experiment backlog;
it does not change renderer behavior or claim the proposed fixes have worked.

The subsequent [executed experiments](layout-experiment-results.md) implement
and measure selected proposals as `agentic-layered@23`, including the ER label
fix. The investigation and recommendations below remain the runtime22 record;
their historical ER conflict and cost figures are not updated in place.

## Recommendation

The later [runtime24 guidance results](layout-guidance-results.md) test the
Architecture placement boundary, lane indexing, immediate proof reuse and
browser prose subtraction, and add rank-span/private-expansion diagnostics.
Rejected candidates and remaining trade-offs are retained explicitly.

Keep ELK as the default and native selection explicit. Repair ownership boundaries
before adding optimization passes: preserve ER label reservations, score
Architecture's final port-constrained routes, and stop repeatedly rebuilding
crossing-test geometry where profiles show substantial allocation. For warm
rendering, investigate the shared drawing/request/SVG pipeline before expanding
the graph solver to more families.

Do not reflexively reduce to Flowchart-only: it retains every identified cyclic
cost outlier. State+Requirement is the cleanest observed small pilot; a
Flowchart+State+Requirement policy preserves all measured crossing/label/span
gains but retains the Flowchart cost tails. Keep the six-family opt-in capability
while evaluating these policies; no evidence yet justifies a default switch,
universal ELK replacement, or expansion to unrelated diagram grammars.

## What this exploration achieved

| Work completed | Evidence/result | What remains unproven |
| --- | --- | --- |
| Five independent research/source investigations | Detailed notes linked below; primary papers, pinned implementations, issue bodies/comments and PR timelines | Research transfers are hypotheses until implemented and qualified |
| Family and scope analysis | All 246 source occurrences partitioned by family; nine scope portfolios; actual emitted lazy closures | A rebuilt reduced-scope product, mixed-session timings and real user-family traffic |
| Actual packaged CPU and allocation profiles | 20 serial fresh workers, including four repeats; 1,530 measured fully consumed calls; all workers successful, zero changed SVGs within each worker | Short sampled windows are diagnostic, not paired latency or exact allocation results |
| Causal prioritization from profile stacks | Cyclic18 crossing counter subtree accounts for about 39% of estimated sampled allocations in both runs, predominantly route-contract repair | Savings from replacement, caching, indexing or pass deletion |
| Paint-uncertainty census | Saved fresh 64-case cohort: no budget exhaustion; marker/fill uncertainty dominates | Which uncertain pairs are actually disjoint; a passing final proof for all generated cases |
| Corrected two explanations in prior reports | Final receipt is lazy; 96-source churn can be masked by the 128-entry outer position cache | Sustained eviction behavior at every layer and fully attributed receipt preparation cost |

The [qualification](layout-qualification.md) remains the authority for quality,
cost and delivery gates. The [community comparison](layout-community-comparison.md)
remains the authority for the consumed peer SVG experiment. Green required CI is
not evidence that all advisory quality/cost goals have passed.

## Issues, outside evidence, and the experiment each suggests

Every action below is proposed. Preserve authored endpoints, directions, labels,
membership, active hints and port sides; keep explicit declines/fallback and final
security/proof obligations. Separate geometric quality from proof status.

| Issue today | Useful external evidence | Action, including subtraction | Keep only if / remaining ELK comparison |
| --- | --- | --- | --- |
| ER40 introduces 16 label/foreign-shaft conflicts, versus ELK zero | [Label-aware orthogonal compaction](https://www.mdpi.com/1999-4893/9/2/22); [Mermaid #8368](https://github.com/mermaid-js/mermaid/issues/8368) reports straightening damaging reserved label lanes | **One label owner:** carry the solver's reservation through adapter translations; invalidate it after route changes; include foreign shafts in final feasibility. Open bounded space only when valid reservations/intervals cannot fit | Remove the 16 conflicts without new node/header/marker/label conflicts. Merely copying old anchors can be wrong after repairs. Not matched yet |
| Architecture0/5 have more crossings; family length/area also worsen | [Port-aware layered layout](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf); [Pele compound ordering](https://github.com/obsidianmd/pele/pull/4); [Mermaid #6166](https://github.com/mermaid-js/mermaid/issues/6166) | Trace placement versus final route crossings; tiny offline legal-order/channel oracle. Test global boundary ordering and feasibility diagnostics. **Subtract temporary generic routing** through a placement-only contract if it is discarded | Both extra-crossing witnesses fixed, sides/endpoints preserved, bounded work. Pele contributor's roughly doubled affected-corpus cost warns against indiscriminate rerenders. Not matched yet |
| 25 source / 268 generated bend regressions; 34 source / 191 generated area regressions | Port-constraint literature reports crossing/bend tradeoffs; [Pele's explicit objective order](https://github.com/obsidianmd/pele/blob/1dd58b7ebb0ec654fa7dc4304d50cf8fd3a65d7b/src/layout/layered.ts) | Record the first objective responsible for each candidate acceptance. Compare the same candidates under a Pareto guard and family bend/area budgets. Try safe detour removal before another candidate | Publish the frontier, including lost crossing wins; a weighted score must not conceal regressions. No all-metric domination established |
| Two uncached cyclic cases exceed 1.5× time; six allocate 1.485–2.096× ELK | New profiles below; [sparse Sugiyama representation](https://jgaa.info/index.php/jgaa/article/view/paper111); [one-bend visibility routing](https://users.monash.edu/~mwybrow/papers/marriott-diagrams-2014.pdf) | First reduce repeated exact crossing-test construction and route-blocker scans. Attribute candidates, expanded ranks and route states. Choose sparse long edges or visibility graphs only when the measured representation warrants it | Both time tails below declared ceiling, all six allocation tails improved, no quality/support/work-cap regressions; use new paired A/A and holdouts |
| Warm full-consumption time approximately tied; peers are much faster on some shared families | [Mermaid PR4697](https://github.com/mermaid-js/mermaid/pull/4697) removes repeated parsing; [Merman lifecycle ADR](https://github.com/Latias94/merman/blob/71da4cf6fbbf4fcf27fb0465cc9169f6fd6ebd8b/docs/adr/0074-browser-runtime-and-benchmark-ownership.md) | **Subtract repeated derivation:** profile request snapshots, native drawing/inspection and full-string SVG passes; fuse compatible scans or skip demonstrated no-ops. Native already bypasses full SceneDoc | Same secured SVG/proof/error semantics; improved uninstrumented warm and edit measurements. Removing certification creates a different API, not a comparable win |
| Cache evidence cannot distinguish all layers; hits still clone/project/assess | Bounded ownership, immutable snapshots and explicit cache-factorial experiments; source audit of 128-entry outer/64-entry inner caches | Outer-only removal arm; source-only inner-off/outer-on cell; 32/64/65/96/128/129/256 actual keys with hit/miss/eviction/weight counters. Consider **one cache owner**, not another cache | Same mutation isolation and complete font/style/config identity; lower total work/retention across repeat/edit/churn. Current 96-source evidence does not prove sustained inner churn |
| All shared generated paint results remain unverified | [CGAL filtered predicates](https://doc.cgal.org/latest/Kernel_23/structCGAL_1_1Filtered__kernel.html), exact predicates versus inexact constructions | Census primitive/transform/owner/curve witnesses; retain authoritative geometry through drawing/proof. Add the smallest sound marker/fill or stroke/card predicate. **Do not raise budgets** for non-exhaustion | Independently checked disjoint pairs become provable, planted intersections still fail, near-degenerate uncertainty remains honest. Not matched to an all-clear guarantee by either engine |
| Four aligned-motion losses; backend eligibility causes discontinuities | [Mermaid #815 branch reversal](https://github.com/mermaid-js/mermaid/issues/815#issuecomment-1717860019); [yFiles incremental layout](https://docs.yworks.com/yfiles-html/dguide/layout-incremental_layout/); [ELK semi-interactive ordering](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-semiInteractive.html) | Intent-classified edit cohorts, branch sign/port order, segmentation-invariant route distance. Test explicit session-owned previous-layout hints and **backend stickiness**; preserve stateless history independence | Lower local-edit p95 motion/order changes under hard validity and quality limits; compare configured incremental ELK, not only stateless ELK. No consistent stability win yet |
| Active hints / ancestor-container endpoints still decline | [Model-order guidance](https://arxiv.org/abs/2406.11393v1); [Mermaid #2509](https://github.com/mermaid-js/mermaid/issues/2509); [ELK #1174](https://github.com/eclipse-elk/elk/issues/1174) | Admit one explicit constraint class at a time, beginning with feasible flat same-rank constraints; retain boundary identity as a terminal. **Narrow admission** rather than silently ignoring constraints | Contradiction diagnostics, unchanged endpoint meaning, add/remove/undo determinism, negative tests. ELK fallback remains necessary |
| Public preferred-port/symmetry comparison and human readability evidence missing | [Symmetry perception](https://arxiv.org/abs/1808.01031); [UML task-specific preferences](https://jgaa.info/index.php/jgaa/article/view/paper54) | Separate authored-port correctness, contact/tangent geometry and soft preferred ports; publish selective symmetry denominators. Blinded relationship/cardinality/port/edit tasks on wins and losses | Semantic-admitted outputs, randomized labels/order, errors/time separate from preference. Internal barycenter scores and a gallery do not establish universal readability |
| Fragile payload headroom: Architecture ELK Brotli only 7 bytes below cap; standalone raw 2,749 bytes below | [Merman selectable families](https://github.com/Latias94/merman/pull/149), Pele entries, Ondine compile/mount separation, Zombie ASCII/SVG split | **Product subtraction:** capability entries and precompiled secured SVG for static sites; compare actual fetched file unions and first useful render. Add reserve targets and byte-delta explanations | Runtime editor still has needed capability, safe mounting, source/config-bound exports, cap preserved. A mount runtime or native executable is not our full browser renderer |
| Maintenance complexity and comparison blind spots | [ELK decomposition discussion](https://github.com/eclipse-elk/elk/issues/1174); [community primary evidence](layout-exploration/community-feedback.md) | One owner each for final geometry, labels, candidate choice, proof and session lifetime. Remove passes only after ablation retains their unique counterexamples. Build semantic/geometry adapters before peer quality rankings | No hidden support reductions. Existing peer SVG/text acceptance is not six-family geometric, semantic or readability parity |
| Prior combined parallel CI stall remains unexplained despite successful serial-isolation runs | Industrial incident practice: preserve adverse runs, reproduce the concurrency boundary, distinguish CPU progress, deadlock and process-lifetime leaks | Record per-shard start/end and last completed case, worker/child lifecycle, event-loop delay, resource pressure and an on-timeout stack/profile. Compare isolated versus combined execution under the same resource limits | Identify a reproducible cause before removing isolation. A green serial run or larger timeout does not establish a root-cause fix; do not mix contended CI profiles with isolated latency qualification |

Literature theorems apply to their stated models: fixed rectangular obstacles,
restricted compaction, or particular layered constraints. They do not establish
optimality for our compounds, painted curves, labels and movable nodes. Fenwick
crossing counting, flat native drawing, bounded caches and several exact
separation predicates already exist here; proposing them again would add no work.

## Fewer or more diagram families?

These are counterfactual dispatch policies using saved paired source observations,
not rebuilt artifacts or new mixed-policy benchmarks. Denominator: 246 source
occurrences, 231 distinct strings; this is not the distribution of user traffic.
Excluded families would still render through ELK. Generated stress is entirely
Flowchart, so it cannot certify the other five families.

| Native policy | Native source occurrences | What is gained or given up | Assessment |
| --- | ---: | --- | --- |
| None | 0/246 | Removes owned-solver maintenance; gives up its crossing/span, uncached and dependency advantages | Retain as the subtraction baseline |
| Flat trees/DAGs only | Not yet classified | Could avoid cyclic/compound work; existing forest shortcut already handles some of this | Define semantic feature eligibility before holdout; a new edge can cause a disruptive backend switch |
| State + Requirement | 26/246 | No observed crossing/label/bend/length regressions; three area regressions; bends 126→44 | Cleanest observed small pilot; Requirement has only four sources |
| Flowchart only | 139/246 | All measured crossing/label/span gains; 14 more-bend and 16 larger source cases | Retains all six cyclic allocation outliers and both time failures |
| Flowchart + State + Requirement | 165/246 | All crossing/label/span gains; no selected source crossing/label regressions; 14 more-bend, 19 larger cases | Strong visual-quality candidate; cost tails unresolved |
| Current six minus ER/Architecture | 207/246 | Quarantines known label/crossing losses; adds Class's mixed bend/area outcomes | Useful arm; repair ER's duplicated label ownership before choosing removal |
| Current six | 246/246 | Broadest demonstrated native source support; all improvements and all regressions | Keep opt-in; Architecture is the clearest candidate for an experimental designation |
| More families | Unestablished | New semantics/qualification obligations; no demonstrated ELK dependency to retire in the other families | Defer until a real workload or profile motivates reuse |

This separates **solver admission** from **distribution selection**. The native
increment is about 20.7–22.0k gzip in the measured lazy closures; the static
pipeline is about 90–93% of each native closure. The same solver core serves six
families. Removing a family does not remove that core when another uses it.
Narrowing can even fetch both engines in a mixed session. Measure cold eligible,
cold excluded, native→excluded, excluded→native and actual fallback request unions.

The [full scope note](layout-exploration/scope-subtraction.md) includes nine
portfolios, family quality/cost denominators and all six closure decompositions.

## What the new profiles actually show

`layout-attribution@1`: actual packaged `dist/index.js`, Node 24.19.0 / V8
13.6.233.17, Linux x64; serial fresh workers, five warmup calls, nominal 1.8s CPU
or 1.2s heap windows, complete UTF-8/SHA-256 SVG consumption per call. Explicit
receipt arms also materialize/stringify/hash the whole receipt. CPU and heap
sampling run separately. Four selected repeats are independent workers.

Cache-on diagnostics set `ELK_CACHE=1` and experiments
`text-spans,position-cache`; cache-off sets `0` and `text-spans`, before import.
These are exact diagnostic configurations: they omit `indexed-layout` and must
not be labelled an unmodified production-default configuration. CPU uses recorded
sample time deltas. Heap sampling uses 32,768-byte intervals and includes objects
collected by both major and minor GC, with no fallback to survivor-only sampling.

| Profile | Observed attribution | Next experiment |
| --- | --- | --- |
| Uncached cyclic18, two CPU + two heap workers | `countPolylineCrossings` subtree 12.5–13.1% sampled CPU, 39.2–39.3% estimated sampled allocation. About 25% of total sampled allocation runs through route contracts→straighten→Z-route→crossing count. Cycle-search score accounts for only about 4% | Retain an exact immutable segment index per unchanged route set; update only changed-route candidates or test an equivalent bounded pairwise counter. Preserve endpoint/tangency/subdivision/dedup semantics |
| Same cyclic18 workers | `collectLaneBlockers` about 10% CPU but below 0.5% allocation; mostly existence-only scans in route candidates | Index obstacle/label/channel intervals; retain early-exit behavior. This is a CPU target, not the dominant allocation target |
| Uncached cyclic15 | Crossing counting 6.1–8.8% inclusive CPU; core layered work 31.6–36.8%; chain ordering and blockers also material | Count candidate/rank/helper/score work before choosing sparse normalization or fewer candidates; do not assume cyclic18's breakdown generalizes |
| Cached Flowchart5, repeated CPU | Native drawing subtree 30.0–30.7% CPU; positioning 7.6–8.6%; draw path dominates the subtree, not the WeakMap lookup | Attribute mark construction, flattening, inspection and validation; reuse one immutable geometry witness where safe |
| Cached ER40 | Drawing subtree 39.8% CPU / 45.0% sampled allocation; positioning about 4.5% CPU | Address shared downstream work as well as ER layout; a faster solver cannot remove this work |
| Sequence20 control, cached SVG | Drawing about 37% CPU; SVG scanning/security, validation and cloning prominent although this family does not use the new solver | Shared pipeline experiment with unchanged family control; expanding solver admission will not repair this path |
| Plain SVG versus explicit receipt arms | Final receipt/digest is lazy, but request resolution still prepares immutable inputs/snapshots for deferred digest work | Separate input preparation, first final-receipt getter, repeat getter and stringify. Do not assign plain SVG overhead to final receipt materialization |

CPU percentages include profiling boundary time, harness consumption, GC and other
work. Inspector `post` has a large initial delta; it is not a renderer hotspot.
Inclusive percentages overlap and cannot be added. Short-window throughput and
GC vary markedly across repeats; no ratios of these calls/windows are speed
claims. Heap estimates are neither exact bytes nor peak/retained memory. Full
stacks, per-worker counts/checksums, source-mapped frames and artifact identities
are preserved in [profile results](layout-exploration/profile-results.json).

The existing browser profiler is useful precedent, but currently selects
default ELK/Bezel, has no explicit CPU warmup, and exposes overlapping end-only
stage durations. Most SVG postpasses are unscoped. Next add source-only nested
span IDs/parents and cheap work/cache counters, then measure without instrumentation.
Do not sum overlapping stage medians into an imagined end-to-end time.

For cache factorials, hold `text-spans,indexed-layout` fixed when that is the
target configuration. Outer-off/inner-on is publicly selectable; inner-off with
outer-on needs a source-only hook because the legacy off switch disables both.
Record actual keys/weights/hits/evictions, not just source count.

## Does this match or beat ELK?

**No, across all aspects.** On the current evidence we improve aggregate source
crossings (879→533), label conflicts (40→16), route length and area; eliminate the
measured parallel/opposing shared spans; lower uncached aggregate costs and peak
heap/RSS; and avoid the ELK download on eligible native-only lazy paths. These are
scoped achievements, not per-case domination.

We still lose individual Architecture crossings, ER labels, bends, area, edit
stability and cyclic cost cases; warm full-consumption time is approximately tied.
Hints/ancestor endpoints still need fallback. Generated paint certainty,
comprehensive port/symmetry scores and human-readability superiority are not
established. Community engines also have limitations, but their limitations do
not close ours. Five of ten peer A/A controls were unhealthy, and the peer gallery
does not constitute a common geometry/readability benchmark.

## Order of work and decision gates

1. **Repair ER and diagnose Architecture**, each with one authoritative final
   geometry/label contract. Keep all retained loss witnesses. Add tiny legal-order
   oracles and reservation invalidation checks before broader search.
2. **Prototype crossing-score reuse and blocker indexing separately.** Measure
   affected callers, allocations and actual candidate benefit. Retain an exact
   crossing reference and adversarial topology cases; do not weaken the metric.
3. **Run shared-pipeline subtraction arms**, first native drawing/inspection,
   request snapshots and no-op SVG scans; then the cache factorial. A private
   skipped-proof arm is only an upper bound, never an equivalent production win.
4. **Compare the declared scope portfolios** using real dispatch and emitted
   builds, not retrospectively choosing the better engine per fixture. Report
   native admission, actual fallback, quality and mixed-session first-use cost.
5. **Improve proof and edit measurement**, then targeted predicates and explicit
   incremental sessions. Extend one hint/ancestor contract at a time. Publish
   port/symmetry denominators and run blinded family tasks before readability claims.

Use the existing source/generated cases as development data. Declare fresh seeds,
adversarial cases and a holdout before tuning. For each change run semantic/hard
geometry/proof/security checks, consumed output equivalence where promised,
quality distributions, complete off/normal-cache time/memory with independent A/A,
and actual lazy/standalone closures. Ship only improvements under the chosen
contract; retain failed ablations and tradeoffs. Do not raise caps, deadlines or
proof budgets merely to change the result.

## Detailed investigations and reproducibility

- [Academic methods and falsifiable transfers](layout-exploration/layout-literature.md)
- [Community feedback and primary links](layout-exploration/community-feedback.md)
  and [saved issue/comment/timeline evidence](layout-exploration/community-primary-evidence.json)
- [Family portfolios and subtraction](layout-exploration/scope-subtraction.md)
- [Profiling boundaries, factorials and experimental controls](layout-exploration/profiling-strategy.md)
- [Paint, stability, ports, readability and distribution](layout-exploration/stability-certification.md)
- [New compact profile evidence](layout-exploration/profile-results.json)
- [Independent review of the profiling method and raw stacks](layout-exploration/profile-review.md)

Local full evidence is `/workspace/pr449-exploration`: `profile-worker.mjs`,
`run-profiles.py`, `repeat-profiles.py`, `summarize-profiles.mjs`, immutable source
inputs, raw `.cpuprofile`/`.heapprofile` files, all job/result JSON, manifest and
full source-mapped summary. `profiles.tar.gz` preserves these diagnostics. The
scripts record the exact local entry/output paths; port those paths when replaying
elsewhere. Run workers serially, with no concurrent builds/tests. The compact
checked-in report preserves inputs and artifact/profile hashes; the local archive
is additional evidence, not a remotely published CI artifact.
Archive SHA-256: `cf1007255084869e664a17e954bc0c6223f3dce77616fdbbd2dbd8303e369e76`.
