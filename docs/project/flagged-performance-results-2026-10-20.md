# Flagged performance experiments and the Mermaid community — 20 October 2026

**Versioned historical study.** These numbers bind 5392/c517 only. The later [d467/694f integration confirmation](flagged-performance-integration-2026-10-20.md) preserves its own results; the completed [65e65/d709 full study](flagged-performance-final-2026-10-20.md) records the final selection separately. No previous package identity or measurement is a claim for that final source.

Study source: **5392c3b414aebb85a45037ad5f61147944b4d908**.
Production baseline: **c517a1611290c7aa463512dc8b8d5156a3424a98**, after [PR #432](https://github.com/adewale/agentic-mermaid/pull/432).
All twelve experimental runtime paths remain **disabled by default**.

**Use TF (`text-spans,indexed-layout`) as a conditional eligible-forest profile.** Its tree effect repeats across both runtimes and complete-receipt cases, but broad matrix uplift is unresolved against A/A and the packed matched-corpus median is 1.015× baseline. The eligible solver reaches 22/546 trim-distinct corpus sources (4.03%). TF + position-cache is useful to investigate for exact repeated requests: mesh is 0.163× baseline at its median, while pie loses and settled heap grows about 4.17 MiB. The all-twelve arm does not support a general recommendation; reverse ordering and several complete public/terminal paths regress.

The pinned Dart wrapper takes less measured common-corpus render time, lower sampled JS allocation and lower warmed/released JS heap than AM; its complete bundle is smaller. AM's lazy first-flow delivery is smaller than the complete Dart wrapper in gzip; those API/delivery scopes differ. Runtime flags retain optional code and the ordinary flags-off path has disclosed cost. The tested profiles establish no single winner across latency, allocation, residency, payload and coverage.

All 15 benchmark commands finished with exit 0 at **03:45:38 UTC**. The completeness/population validator and reported-score/memory arithmetic validator both record **zero errors and zero pending items**, with the named peer exclusions and scope warnings retained. Weighted CPU attribution is separately **withheld** because all three Inspector profiles have negative time deltas; valid wall-stage diagnostics remain below. Correctness, SVG acceptance, observed-label checks and speed are separate forms of evidence.

The completed 31c24a06/1b1ba848 fifteen-step study is historical in `../rebased-study`; the earlier 07ab2f3f/31878241 study is covered by the [19 October archive](flagged-performance-results-2026-10-19.md). Neither supplies a current 5392/c517 result. The c517 integration includes broad grammar, authored-meaning, source-map, normalization and State/XY rendering changes; identical feature patches under range-diff do not establish identical runtime bytes, interpretation, activation, acceptance or performance.

## Method and decision criteria

The completed Node/Bun confirmation compares true baseline A/A, current-source flags-off, text-spans + indexed-layout (TF, profile ID text-forest), and the eight-flag core in adjacent fresh-process pairs. The recorded roster and startup flags were independently verified. Core comprises graph-index, scene-arena, svg-passes, text-spans, indexed-layout, paint-bvh, gantt-intervals and sankey-csr. Configure flags before import, or before browser library loading; they are not public per-render options.

Both completed cold-layout confirmations record counterbalanced adjacent pairing, three process rounds, twelve samples, at least five warm calls and 1,000 ms warm-up per case; independent reviews verified actual completed populations. Natural-GC timing is separate from checkpoint allocation/settled-heap diagnostics. ELK cache-off does not disable prepared-text caches: this is repeated warmed source with uncached layout, not cold-process or unique-source performance.

The closed normal-cache comparison includes A/A, current-source off, TF-only and TF + position-cache, each with its own adjacent baseline reference. The driver paused after cold holdouts; the source-bound TF selection receipt authorized the remaining canonical collection. Ratios between independently referenced aggregates do not isolate the marginal cache effect. Show per-case results, controls, all three ratios for headline claims, and any repeatable regression before recommending a scenario-specific profile.

Prefer a small active profile with a meaningful, repeated public-workflow benefit and preserved correctness/coverage. A narrowly large eligible-case gain can justify an opt-in profile even when broad averages remain unresolved. Neither A/A normalization, a tiny aggregate difference nor a favorable micro alone establishes a winner. Separate latency, allocation, settled residency, native/RSS memory, download size and output fidelity; no scalar score silently weights them.

Earlier single-flag, leave-one-out and selected-combination screens belong to their recorded older source. The fresh confirmation and canonical suites below do not retrospectively rerun every screen. There are 4,096 binary flag subsets before runtime/cache/workload choices; no exhaustive or universal optimum is claimed.

The completed study is rooted at `bench-report/experiments/parser-main-study`. `execution-driver.sh`, `study.json`, gate receipts, configuration files, consumer lockfiles and the full exit ledger preserve the exact sequence. Both revisions were freshly built/packed; source/harness/package remained fixed during collection. The artifact gate released timing at **01:22:05 UTC**; collection ended 03:45:38 UTC. A workspace reconnection occurred while the already running driver continued, with its saved process/log/results intact; no replacement observations or concurrent test/build campaign were introduced.

Recorded environment: **Intel Xeon Platinum 8573C**, five visible logical CPUs, Linux x64 kernel 6.18.55; the release manifest records CPU quota `400000 100000` and memory limit 16 GiB. This is a managed shared environment, not a dedicated bare-metal stability claim. Actual Node workers are **24.19.0**, Bun orchestration **1.4.0**, Chromium **154.0.8037.57**. Bun's compatibility `process.versions.node` field 26.3.0 in orchestrator manifests is not another measured Node engine. CI functional witnesses use Bun 1.4.2 and are not timing observations.

## Timing and consumption boundaries

The c517 baseline already includes PR #437 compact terminal cells, deferred terminal projection and production allocation changes, plus PR #432 grammar/normalization/meaning work. Those changes belong to the baseline. Flags must preserve its registered-getter identity, conservative resource reservation, exact materialization fallback and public receipt contracts.

| Surface | Timed work | What it does not establish |
|---|---|---|
| Public-call matrix | Render return plus output byte-length check; receipt case includes JSON serialization; complete-output hashing is outside timing | Physical encoding/traversal of every output byte, DOM insertion or paint |
| Browser corpus | Public render through SVG return; inspection/cleanup/paint excluded | Equivalent meaning or quality merely because SVG was returned |
| Ordinary SVG/terminal micros | Owning public text-return or stage call, with setup outside timing | Full deferred receipt consumption unless the case explicitly does it |
| New consumed micros from PR #437 | Public WithReceipt call, **TextEncoder.encode(output)** and **JSON.stringify(result.receipt)** inside the timed call | A free deferred terminal projection or free receipt hashing |
| Pipeline observation | Render return with stage clocks and CPU sampling; output Buffer.byteLength is afterward; ELK is nested inside layout | The matrix timing boundary, profile-selection score or any peer engine's internal phases |
| Memory diagnostics | Named sampling/checkpoint scope with consumer/profiler work included | Exact intra-render peaks, native/WASM memory or whole-process memory unless explicitly measured |

Fresh canonical micros include render:svg-consumed-flow5/tree50/mesh50/seq20/c4/class80/er40/state80 and render:ascii-consumed-seq20/class80. They also include added text-return ASCII class80/er40/state80 cases. These pay complete receipt/encoding work and must remain visible alongside text-only improvements. The consumed cases validate nonempty encoded output and a serialized requestDigest; semantic/geometry/security contracts are separate.

Stage comparisons with different retained inputs must withhold ratios. A retained-Scene micro is not fresh lowering of a public diagram. Setup metadata may JSON-serialize enumerable deferred Scene getters before timing; verify current prepared-input/consumption records rather than claiming untouched first-access costs. Direct lexical pass micros outside an active render-local inspection cache cannot alone demonstrate cross-rewrite token reuse.

## Paired cold-layout confirmation

### Closed Node and Bun observations

Both independently reviewed current-source holdouts are complete: **27 workers × 27 cases = 729 successful rows per runtime**, with correct source/base identities, complete ordered rosters and positive finite twelve-sample populations. Node is **24.19.0** and Bun **1.4.0**. Each measurement uses its own adjacent fresh baseline reference; order reverses in round two. Profile ID **`text-forest` means TF = text-spans,indexed-layout**. Current-source witnesses/ratios are not imported from either historical study.

All workers record ELK cache off, natural GC and uncollected checkpoints; at least five calls and 1,000 ms warm each case. Prepared text can remain reusable: cold-layout is not cold-process or unique-source performance. No allocation probe was recorded, and natural heap observations are not settled retained-heap measurements.

Ratios are candidate / adjacent-baseline latency, lower better, without A/A normalization. The casewise aggregate is the geometric mean of the per-case medians of three paired ratios. Per-round geometric means are shown separately and do not commute with taking medians. Neither statistic is pooled traffic/runtime or a confidence interval.

| Profile | Node SVG | Node all 27 | Bun SVG | Bun all 27 |
|---|---:|---:|---:|---:|
| True baseline A/A | 0.955048 | 0.938951 | 0.904180 | 0.934853 |
| Current source, flags off | 1.028643 | 1.000716 | 1.017165 | 1.040574 |
| TF (`text-forest`) | 0.941010 | 0.948942 | 0.897830 | 0.924030 |
| Core | 0.945828 | 0.933504 | 0.988553 | 1.009094 |

| Profile | Node SVG round geomeans, 1/2/3 | Node all-output round geomeans, 1/2/3 |
|---|---|---|
| True baseline A/A | 0.738307, 1.013923, 0.984005 | 0.765314, 1.010645, 0.967435 |
| Current source, flags off | 1.139518, 1.020134, 1.027833 | 1.089367, 0.960132, 0.999376 |
| TF (`text-forest`) | 0.811548, 1.490006, 0.963314 | 0.858898, 1.319731, 0.939477 |
| Core | 0.881128, 0.905380, 1.036817 | 0.897773, 0.911998, 0.973953 |

| Profile | Bun SVG round geomeans, 1/2/3 | Bun all-output round geomeans, 1/2/3 |
|---|---|---|
| True baseline A/A | 0.827990, 1.055327, 0.885848 | 0.931124, 1.027864, 0.921546 |
| Current source, flags off | 0.910172, 1.092546, 1.074075 | 0.952085, 1.073206, 1.131914 |
| TF (`text-forest`) | 0.915296, 0.913956, 0.883264 | 0.933406, 0.927084, 0.940353 |
| Core | 0.839536, 0.909230, 1.125380 | 0.896861, 0.958363, 1.087405 |

TF's Node SVG rounds are **0.811548, 1.490006, 0.963314**; all-output rounds are **0.858898, 1.319731, 0.939477**. Its large adverse second round remains part of the evidence. Bun TF's SVG/all-output round means are lower in all three rounds, but its SVG aggregate **0.897830** is close to Bun A/A **0.904180**. Node A/A and the other controls also move substantially. No host cause or causal feature penalty was established. **Broad uplift remains unresolved in both runtimes**; small TF/core/A/A aggregate differences establish neither a broad winner nor equality.

The complete current per-case TF/A/A roster:

| Case | TF Node | Node A/A | TF Bun | Bun A/A |
|---|---:|---:|---:|---:|
| flow5 | 0.960638 | 1.155443 | 1.018194 | 0.692985 |
| tree50 | 0.532559 | 0.998334 | 0.413628 | 0.645972 |
| mesh50 | 1.028645 | 1.010803 | 1.044349 | 0.718500 |
| seq20 | 0.924332 | 1.168387 | 0.996079 | 0.968561 |
| c4 | 0.961128 | 1.078129 | 0.857448 | 0.669578 |
| class80 | 1.154175 | 0.978857 | 0.905414 | 0.891316 |
| er40 | 1.206478 | 1.067331 | 0.992677 | 0.975992 |
| state80 | 1.665227 | 1.025431 | 0.982728 | 0.920927 |
| gantt:150-tasks | 1.109895 | 0.948881 | 0.867954 | 1.047272 |
| gitgraph:200-commits | 1.107085 | 0.999585 | 0.945015 | 1.080638 |
| mindmap:200-nodes | 0.845759 | 1.103117 | 0.905175 | 0.974237 |
| timeline:100-events | 0.985005 | 1.011274 | 0.928833 | 0.958284 |
| sankey:120-links | 0.921142 | 0.986017 | 0.830999 | 0.922309 |
| journey:120-tasks | 0.895879 | 1.036673 | 0.946216 | 1.010834 |
| architecture:40-services | 0.714304 | 0.775316 | 0.970445 | 1.061075 |
| xychart:12-series-80-points | 0.834129 | 0.814213 | 0.644779 | 0.969931 |
| pie:80-slices | 0.825736 | 0.830021 | 0.968841 | 0.788474 |
| quadrant:150-points | 0.848604 | 0.703701 | 1.058173 | 1.001421 |
| radar:12-series-24-axes | 0.830334 | 0.781379 | 0.993554 | 1.040760 |
| gantt:weekly-dependency-routing | 0.933635 | 0.812874 | 1.010241 | 0.958093 |
| terminal:flow5 | 0.945865 | 0.810141 | 1.092575 | 1.073487 |
| terminal:tree50 | 0.972960 | 0.796116 | 0.983427 | 1.026169 |
| terminal:mesh50 | 0.919036 | 0.811006 | 0.946916 | 0.983906 |
| terminal:seq20 | 1.061833 | 1.103029 | 0.933456 | 0.955261 |
| agent:edit-loop | 0.960822 | 0.841248 | 0.938669 | 1.008854 |
| receipt:flow5 | 1.094638 | 1.021040 | 1.004991 | 1.108500 |
| png:flow5 | 0.867674 | 0.924146 | 1.141224 | 1.050288 |

| tree50 arm | Node rounds 1/2/3 | Node median | Bun rounds 1/2/3 | Bun median |
|---|---|---:|---|---:|
| True baseline A/A | 0.889364, 0.998334, 1.197112 | 0.998334 | 0.623450, 1.066241, 0.645972 | 0.645972 |
| Current source, flags off | 1.121191, 1.070063, 1.100197 | 1.100197 | 1.116084, 1.042553, 1.387625 | 1.116084 |
| TF (`text-forest`) | 0.521516, 0.532559, 0.555919 | 0.532559 | 0.265420, 0.413628, 0.434179 | 0.413628 |
| Core | 0.480697, 1.114752, 0.723843 | 0.723843 | 0.425800, 0.419417, 0.725790 | 0.425800 |

TF tree50 is lower in all six Node/Bun pairs: Node **0.521516, 0.532559, 0.555919**, median **0.532559**; Bun **0.265420, 0.413628, 0.434179**, median **0.413628**. This supports a narrow eligible cold-layout observation. Core tree has an adverse Node second pair despite three lower Bun pairs. Current-source off tree is slower in all six pairs. Do not normalize another arm by the off result or assign the whole candidate-off movement to an individual mechanism.

| Closed Node arm / case | Ratios, rounds 1/2/3 | Median | Observation |
|---|---|---:|---|
| Core / flow5 | 1.008366, 1.131116, 1.416300 | 1.131116 | Slower in every pair |
| Core / c4 | 1.123030, 1.514973, 1.042784 | 1.123030 | Slower in every pair |
| Current source, flags off / mesh50 | 1.053328, 1.053161, 1.067306 | 1.053328 | Slower in every pair |
| TF (`text-forest`) / class80 | 0.653165, 1.247419, 1.154175 | 1.154175 | Adverse median; mixed rounds |
| TF (`text-forest`) / er40 | 0.692205, 2.872374, 1.206478 | 1.206478 | Adverse median; large round-two movement |
| TF (`text-forest`) / state80 | 0.819892, 1.895766, 1.665227 | 1.665227 | Adverse median; mixed rounds |
| TF (`text-forest`) / gantt:150-tasks | 0.752142, 5.366582, 1.109895 | 1.109895 | Adverse median; large round-two movement |
| TF (`text-forest`) / receipt:flow5 | 1.120286, 0.943336, 1.094638 | 1.094638 | Adverse median; mixed rounds |
| TF (`text-forest`) / terminal:seq20 | 1.061833, 0.923986, 1.070532 | 1.061833 | Adverse median; mixed rounds |

| Closed Bun arm / case | Ratios, rounds 1/2/3 | Median | Observation |
|---|---|---:|---|
| TF (`text-forest`) / mesh50 | 1.492356, 1.044349, 1.026296 | 1.044349 | Slower in every pair |
| TF (`text-forest`) / png:flow5 | 1.141224, 1.075409, 1.337660 | 1.141224 | Slower in every pair |
| Core / flow5 | 1.716298, 1.146691, 2.281598 | 1.716298 | Slower in every pair |
| Core / mesh50 | 1.068780, 1.108489, 1.322895 | 1.108489 | Slower in every pair |
| Core / seq20 | 1.019964, 1.243927, 1.141206 | 1.141206 | Slower in every pair |
| Core / c4 | 1.106589, 1.090276, 2.069617 | 1.106589 | Slower in every pair |
| Core / terminal:flow5 | 1.054405, 1.479916, 1.058017 | 1.058017 | Slower in every pair |
| Core / terminal:tree50 | 1.109239, 1.215584, 1.144621 | 1.144621 | Slower in every pair |
| Current source, flags off / pie:80-slices | 1.152236, 1.024730, 1.224329 | 1.152236 | Slower in every pair |
| Current source, flags off / gantt:weekly-dependency-routing | 1.089335, 1.021181, 1.162230 | 1.089335 | Slower in every pair |
| Current source, flags off / terminal:tree50 | 1.083325, 1.076316, 1.221216 | 1.083325 | Slower in every pair |
| Current source, flags off / agent:edit-loop | 1.322337, 1.142140, 2.041844 | 1.322337 | Slower in every pair |

TF Bun mesh and PNG are slower in all three pairs; Core flow5/C4 are slower in all three pairs in **both** runtimes. Core's extra mechanisms do not show a consistent cross-runtime marginal advantage from these independently referenced arms. TF's other Bun adverse medians include flow5/quadrant/weekly Gantt/terminal flow5/receipt flow5 with mixed round directions; the full roster above retains them. Narrow forest success does not establish every-family/output benefit.

A/A/off complete-output witnesses match baseline in every measured pair. TF/core differ only on tree50, where eligible geometry intentionally changes. This is finite-fixture byte evidence, not corpus-wide fidelity or a replacement for authored-meaning/geometry/security contracts. Both reviews independently verify per-case arithmetic, medians, aggregates, identities and completeness. The following sections retain normal-cache, consumed-output, canonical micro, checkpoint-memory, peer, release, browser, payload and pipeline observations; the complete study validators passed.

### Completed conditional study-profile decision

The source/base-bound confirmed-selection.json receipt at **02:19:32 UTC** carries **TF only into the remaining canonical study as a narrow eligible-forest/cold-layout profile**. Tree repeats across both runtimes; the larger core has repeatable public-workflow regressions and no demonstrated consistent cross-runtime advantage here. This is not a production-default change, overall benchmark winner, exhaustive subset optimum or claim about normal-cache, memory, payload, community parity or fully consumed artifact cost. All twelve defaults remain off. Later evidence can qualify or contradict the scenario-specific recommendation.

### Default-off risk: P2, disclosed and not causally isolated

Current-source off tree is slower in every Node/Bun pair; Node off mesh and the Bun off cases above also have repeatable adverse observations. The independent source-only review classifies ordinary-path overhead as a **P2, nonblocking performance risk for the authorized investigative feature set**. It found the expensive feature algorithms correctly gated, but default-off is **not** code-path identity or zero-cost isolation. This risk blocks a zero-overhead/universal-default-improvement claim; promoting a production default or requiring regression-free ordinary rendering needs resolution or stronger controlled evidence.

The source review identifies hypotheses worth isolating, **not measured causal shares or proven physical allocations**:

| Default-path source change | Plausible cost and scope |
|---|---|
| Ordinary paint BVH now traversed through visitor/leaf callbacks | Additional indirection and potential query-specific closures across native text/connector/marker proof targets; packed construction remains gated. |
| Route-index dispatch scaffolding | Repeated flag lookups, optional index selection and query-helper scaffolding in lane/label proofs; no off-path graph maps/BVH construction or new graph-wide index scan. |
| Prepared-text dispatch and fits wrapper | Flag checks and a wrapped exact predicate for actually wrapped lines; typography copy, key hashing/cache lookup and ASCII typed arrays are gated. Short labels can bypass the wrapping predicate. |
| CSS replacement disjointness computed before flag test | A genuine unnecessary traversal of replacement ranges while off; few style ranges do not by themselves explain the tree result. |
| Scene inspection helper/dispatch | Potential unused helper closure plus per-primitive flag selections; owner Map/retained-inspection reuse are gated. |
| Fixed positioning checks/import-time state | Environment/undefined branches and small empty containers/retained code; costly JSON key, clone and cache retention are gated. Startup/module evaluation is separate from warmed samples. |

No causal ablation establishes which change, VM behavior or host variation caused the measured whole-arm differences. Source callback counts cannot be translated into percentages. One unconditional correctness repair also makes inline connector-label inspection respect enclosing group opacity; it is not an accidental enabled algorithm, and global c517 byte identity is not claimed for inputs exercising that correction. No production change is made during this frozen study to remove unfavorable observations. Any later cleanup/isolated variant needs its own measured comparison and unchanged proof-order, resource, security and authored-meaning contracts.

## Normal-cache and memory control

The closed current Node normal-cache timing pass has **27 workers × 27 cases = 729 successful rows**, three rounds/twelve samples, at least five warm calls and 1,000 ms warm-up, natural GC and ELK cache on. A/A, off, TF-only (`selected-cache`) and TF + position-cache (`repeat`) each use their own adjacent fresh baseline reference. This policy enables the established layout cache on both sides; it is not the cold-layout/Dave score.

| Normal-cache profile | SVG ratio | All 27 ratio |
|---|---:|---:|
| Baseline A/A | 0.831866 | 0.868057 |
| Current source off | 0.985216 | 1.013516 |
| TF-only | 0.987071 | 0.977508 |
| TF + position-cache | 0.823738 | 0.843558 |

The TF + position-cache aggregate looks favorable, but baseline A/A also moves substantially below 1. **No broad causal normal-cache win is established by these aggregates.** The two feature profiles have different adjacent references; dividing their aggregate scores does not estimate marginal position-cache benefit. TF-only's SVG round means are **1.681294, 0.956536, 0.832822**; repeat's are **0.800446, 0.785300, 0.928168**, while repeat's all-output round means are **0.819011, 0.788326, 1.006317**.

The repeat profile nevertheless has large, consistent workload-specific observations; its unfavorable cases remain visible:

| Profile / case | Ratios, rounds 1/2/3 | Median | Observation |
|---|---|---:|---|
| aa / mesh50 | 0.903468, 0.861414, 0.941235 | 0.903468 | A/A itself is lower in every pair |
| selected-cache / tree50 | 1.125991, 0.953764, 0.641904 | 0.953764 | Mixed; established cache changes the forest opportunity |
| repeat / flow5 | 0.436118, 0.546011, 0.793290 | 0.546011 | Lower in every pair |
| repeat / tree50 | 0.559706, 0.484787, 0.665241 | 0.559706 | Lower in every pair |
| repeat / mesh50 | 0.157123, 0.163271, 0.194636 | 0.163271 | Lower in every pair |
| repeat / class80 | 0.868130, 0.820969, 0.977783 | 0.868130 | Lower in every pair |
| repeat / state80 | 0.544670, 0.623007, 0.493655 | 0.544670 | Lower in every pair |
| repeat / pie:80-slices | 1.177817, 1.179453, 1.245301 | 1.179453 | Slower in every pair |
| selected-cache / png:flow5 | 1.032015, 1.212949, 1.125919 | 1.125919 | Slower in every pair |
| off / agent:edit-loop | 1.151094, 2.126625, 1.401956 | 1.401956 | Slower in every pair |

Repeat also has all-three slowdowns on mindmap, timeline and journey; the complete paired roster remains in the raw report. These measurements support conditional exact-repeat investigation, not enabling position-cache for every family or request distribution. Complete-request keys and private clones still cost work even for small charts.

The separate checkpoint diagnostic also completed **27 workers × 27 cases**. It uses one warm call, one timed call, no timed warm-up and forced GC; a separate extra allocation call per case records an **estimated V8 allocation**. The allocation table sums those probes over the **20 SVG cases** in each worker, then divides by that worker's own paired reference. Final settled-heap deltas instead compare `finalMemory.heapUsed` after **all 27 cases, including PNG**. These are different populations and are not CDP sampled allocation, exact physical peaks or native/RSS memory.

| Checkpoint arm | SVG allocation ratios, rounds 1/2/3 | Median ratio | Final paired heap deltas, MiB, rounds 1/2/3 | Median MiB |
|---|---|---:|---|---:|
| A/A | 0.998224, 0.994754, 1.002450 | 0.998224 | +0.010910, -0.016960, -0.025551 | -0.016960 |
| Current off | 1.007919, 1.006175, 1.000859 | 1.006175 | +0.045799, +0.051460, -0.000229 | +0.045799 |
| TF-only | 0.969250, 0.963639, 0.966043 | 0.966043 | +0.289757, +0.403152, +0.389999 | +0.389999 |
| TF + position-cache | 0.765375, 0.767596, 0.764773 | 0.765375 | +4.170990, +4.193291, +4.151733 | +4.170990 |

Thus the repeat profile reduces this allocation sum by about **23.5%** while settling about **4.17 MiB higher**; TF-only is about **3.4% lower allocation** and **0.39 MiB higher**. These are measured tradeoffs on this workload, not physical cache-cap guarantees or a memory winner. The position budget is one global estimated-weight **16 MiB/128-entry LRU**; text caches have estimated **4 MiB + 8 MiB** budgets. Hits still construct complete keys, clone private geometry, transfer evidence and recertify. Complete appearance/options may change the key; this is exact-request reuse, not arbitrary theme-only restyling. The independent closed arithmetic proof is c517-repeat-memory-proof.json; the complete whole-study validation also passed.

## Canonical micros and adverse cases

All three closed canonical micro reports cover the same **70 cases**, without a filter: TF on Node, TF on Bun and all twelve flags on Node. Each records three alternating-order baseline/candidate process rounds and cache off. The preserved configuration requests 250 ms warm-up, up to twelve samples targeting 25 ms and an 8,000 ms case budget. The retained summaries contain each side's three round medians, not every underlying sample/iteration count; the requested sample budget can be reduced by the case budget. Ratios below are the **median of three paired round ratios**, not the ratio of two independently selected median times. All 70 rows on each arm have positive finite round medians, no reported errors and `inputsDiffer: false`; all 210 ratios were independently recomputed from the recorded three-round medians. The saved reports omit per-worker flag values, raw samples/iterations and staged input strings: flag settings come from the preserved driver, and input equality is the runner's recorded diagnostic rather than independently replayable retained input bytes. No claim of twelve actual samples follows from the requested budget. Final whole-study validation remains a separate gate.

The staged-input equality check supports these comparisons, not a first-access claim. Stage setup may serialize enumerable deferred getters before timing. Lower/admit cases create a fresh wrapper around **retained positioned geometry**; paint cases reuse an admitted Scene. Their boundary differs from a fresh complete public render. Micro cache-off also disables position-cache even in the all-twelve arm. Movement under TF cannot be attributed to the ten flags it does not enable, and combined-all results do not isolate individual mechanisms.

| Mechanism or stage case | TF Node | TF Bun | All twelve Node |
|---|---:|---:|---:|
| Formatted preparation | 0.070245 | 0.032301 | 0.062868 |
| Measure text width | 0.980279 | 0.928150 | 1.008075 |
| ASCII wrapping, repeat | 0.000656 | 0.000180 | 0.000608 |
| ASCII wrapping, churn | 0.159308 | 0.241024 | 0.183795 |
| Graph layout, tree50 | 0.273875 | 0.300118 | 0.250330 |
| Graph layout, mesh50 | 1.008272 | 1.022528 | 0.981287 |
| Layout rubric, mesh50 | 0.974255 | 0.975044 | 1.075205 |
| Route audit, mesh50 | 1.194726 | 1.034246 | 0.999927 |
| Forward ordering, 128 | 0.422619 | 0.261620 | 0.318961 |
| Reverse ordering, 128 | 0.468183 | 0.201745 | 0.848555 |
| Forward ordering, 1024 | 1.664752 | 1.580589 | 1.605739 |
| Reverse ordering, 1024 | 1.390815 | 1.332897 | 4.934631 |
| Long weekly calendar | 1.004238 | 0.357465 | 0.005883 |
| New lower/admit wrapper, retained sequence geometry | 1.063516 | 1.024766 | 1.004280 |
| New lower/admit wrapper, retained class geometry | 1.168713 | 0.982167 | 1.018816 |
| Retained sequence Scene paint proof | 0.909186 | 1.276306 | 0.323694 |
| Retained class Scene paint proof | 1.022920 | 1.062556 | 0.445154 |
| Direct inline-colors pass, class80 | 1.081646 | 1.040532 | 1.075913 |
| Direct style-scope pass, class80 | 1.014338 | 1.017824 | 1.038512 |
| Direct text-fit pass, class80 | 1.096598 | 1.006292 | 0.873715 |
| Direct SVG security pass, class80 | 1.059214 | 1.128099 | 1.041435 |
| Direct SVG scan, class80 | 1.007858 | 1.221779 | 1.135152 |
| Complete agent edit-loop | 1.102710 | 0.985079 | 1.117458 |

The large ASCII repeat/preparation gains use reusable cache keys. Churn is a rotating-key distribution beyond cache capacities, not a measured production hit rate. Node estimated allocation for ASCII repeat is about **3.38 KiB versus 8.59 MiB per call**, while churn remains about **1.58 MiB versus 8.59 MiB**; these are estimated V8 allocations, not settled memory. The all-twelve long-calendar ratios are **0.007293, 0.005883, 0.005079**, with estimated allocation **155,037 versus 3,403,696 bytes/call**. That enabled calendar branch does not describe ordinary short-duration Gantt or TF's unrelated movement.

Reverse-order scaling is adverse: all-twelve reverse1024 takes **5.618698, 4.934631, 4.600902×** baseline time, median **4.934631×**, with estimated allocation **133,049,296 versus 12,873,101 bytes/call** (about **10.34×**). TF itself is slower on reverse1024 in all three rounds in both runtimes, so the combined-all score is not an isolated incremental-order estimate. The source's full-rank rewrite provides an algorithmic reason to investigate a better dynamic-order structure; it does not turn these aggregate observations into causal attribution. The retained-Scene paint reductions under all flags mix packed-BVH and admitted-inspection reuse; new lower/admit and complete public work show much smaller or adverse effects. Direct lexical pass cases sit outside the active render-local inspection-cache boundary and cannot by themselves prove cross-rewrite token reuse.

Complete public SVG costs retain every text-return and fully consumed case. Each consumed call includes the public WithReceipt render, **TextEncoder.encode(output)** and **JSON.stringify(full receipt)** inside timing:

| SVG fixture | TF Node text | TF Node consumed | TF Bun text | TF Bun consumed | All Node text | All Node consumed |
|---|---:|---:|---:|---:|---:|---:|
| flow5 | 0.998333 | 0.959893 | 1.000753 | 0.893087 | 1.032788 | 1.051725 |
| tree50 | 0.544739 | 0.528783 | 0.505233 | 0.433141 | 0.497585 | 0.570506 |
| mesh50 | 1.161355 | 1.234026 | 1.134761 | 0.791023 | 1.039886 | 0.994610 |
| seq20 | 1.066248 | 1.123697 | 1.058583 | 0.855543 | 1.032813 | 1.052031 |
| c4 | 0.902690 | 1.069599 | 0.880886 | 0.823420 | 1.123008 | 1.097009 |
| class80 | 0.984192 | 1.137555 | 1.033770 | 0.897983 | 1.053159 | 0.959490 |
| er40 | 1.001857 | 1.059138 | 0.863306 | 0.902017 | 0.959965 | 0.940937 |
| state80 | 1.040009 | 1.102048 | 0.984246 | 0.888898 | 0.962925 | 1.010124 |

TF consumed tree improves in all six Node/Bun pairs: Node **0.569396, 0.485046, 0.528783**, Bun **0.433141, 0.439862, 0.413476**. Node consumed mesh/class/ER/state are slower in all three pairs; Node text-return mesh/state are also slower in every pair. Bun text-return mesh is slower in every pair even though its separate consumed case is lower. These cases are timed independently, so their scores cannot be subtracted to recover marginal receipt cost. All-twelve consumed tree has one adverse pair (**0.420758, 1.033569, 0.570506**), unlike TF's consistent result.

| ASCII case | TF Node | TF Bun | All twelve Node |
|---|---:|---:|---:|
| flow5 text | 1.019861 | 0.857953 | 1.167725 |
| mesh50 text | 1.134869 | 0.955378 | 1.038660 |
| seq20 text | 1.127350 | 0.946003 | 1.022405 |
| class80 text | 1.087927 | 0.959781 | 1.167400 |
| er40 text | 1.073671 | 1.022764 | 1.060253 |
| state80 text | 1.090337 | 0.907236 | 1.078440 |
| seq20 consumed | 1.125463 | 1.060399 | 0.956409 |
| class80 consumed | 1.145603 | 0.952661 | 1.040822 |

Both TF Node fully consumed ASCII cases are slower in every pair: sequence **1.125463, 1.064368, 1.147457** and class **1.197508, 1.145603, 1.073262**. All-twelve terminal text flow/mesh/class/ER/state also regress in all three pairs; terminal tiles are not a demonstrated broad terminal win here. The all-twelve edit-loop is **1.117458×** with estimated allocation **8,076,804 versus 8,324,552 bytes/call**; avoiding a few clones does not eliminate complete serialization/reparse/render work. Keep complete artifacts and adverse cases beside favorable retained stages; no text-only gain proves that deferred receipt work disappeared.

## Pipeline and community comparison

All three current pipeline reports validate **eight identical workload sources × three rounds × five public calls = 120/120 successful calls per profile**. Source/base, Node 24.19.0, cache/assertion policy, positive output bytes and raw-to-report stage arithmetic agree. Off and TF use ELK cache off; repeat uses TF + position-cache with normal cache on. Flags come from the preserved driver rather than individual sample receipts. The `scene` hook clocks `lowerPositionedFamilyScene` (lowering/admission); `backend` clocks the final `backend.render` call. The worker stops total timing at render return, then checks output Buffer.byteLength outside it, unlike the matrix. These independently clocked stage means include instrumentation overhead: they are diagnostics, not the uninstrumented profile-selection score, paired causal speedups or a production traffic mix. **ELK is nested inside layout**; “other layout” below is layout minus ELK, so it is counted exactly once.

| Profile | Workload | Total ms | ELK % | Other layout % | Scene % | Paint proof % | SVG security % | Backend % | Request + other % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| off | flow5 | 21.470 | 43.32 | 18.98 | 11.82 | 4.06 | 4.99 | 0.21 | 16.62 |
| off | tree50 | 117.752 | 45.17 | 27.31 | 11.62 | 4.45 | 5.86 | 0.21 | 5.38 |
| off | mesh50 | 767.514 | 51.20 | 42.36 | 2.64 | 1.12 | 1.47 | 0.04 | 1.17 |
| off | seq20 | 32.148 | 0.00 | 9.44 | 47.23 | 10.00 | 13.30 | 0.92 | 19.11 |
| off | c4 | 16.395 | 0.00 | 15.59 | 19.75 | 6.97 | 9.73 | 0.27 | 47.69 |
| off | class80 | 177.154 | 20.93 | 9.45 | 31.66 | 10.34 | 16.13 | 0.80 | 10.69 |
| off | er40 | 111.716 | 23.08 | 11.14 | 28.60 | 8.60 | 16.28 | 0.59 | 11.71 |
| off | state80 | 239.084 | 43.36 | 23.75 | 13.71 | 4.76 | 7.76 | 0.41 | 6.23 |
| selected | flow5 | 16.274 | 45.69 | 15.91 | 12.91 | 6.11 | 5.22 | 0.28 | 13.88 |
| selected | tree50 | 44.018 | 0.00 | 44.25 | 22.37 | 8.88 | 12.60 | 0.35 | 11.54 |
| selected | mesh50 | 584.488 | 48.95 | 43.73 | 3.01 | 1.08 | 1.97 | 0.05 | 1.21 |
| selected | seq20 | 14.847 | 0.00 | 7.14 | 43.81 | 7.90 | 16.41 | 0.64 | 24.10 |
| selected | c4 | 12.632 | 0.00 | 13.58 | 31.96 | 5.59 | 8.28 | 0.33 | 40.26 |
| selected | class80 | 139.821 | 22.03 | 7.50 | 31.82 | 13.52 | 13.63 | 0.81 | 10.70 |
| selected | er40 | 89.213 | 25.12 | 4.90 | 29.04 | 10.88 | 16.84 | 0.57 | 12.66 |
| selected | state80 | 219.097 | 49.55 | 21.94 | 12.14 | 4.88 | 6.17 | 0.27 | 5.04 |
| repeat | flow5 | 8.712 | 0.00 | 9.69 | 33.25 | 12.23 | 11.56 | 0.88 | 32.39 |
| repeat | tree50 | 37.954 | 0.00 | 18.71 | 31.47 | 16.09 | 16.58 | 0.74 | 16.41 |
| repeat | mesh50 | 45.899 | 0.00 | 7.96 | 40.49 | 15.66 | 18.41 | 0.57 | 16.91 |
| repeat | seq20 | 20.791 | 0.00 | 7.52 | 45.10 | 7.35 | 12.84 | 0.59 | 26.60 |
| repeat | c4 | 11.974 | 0.00 | 21.61 | 19.71 | 7.65 | 6.96 | 0.28 | 43.79 |
| repeat | class80 | 115.257 | 0.00 | 7.37 | 44.29 | 13.84 | 19.03 | 0.90 | 14.57 |
| repeat | er40 | 71.150 | 0.00 | 6.06 | 38.49 | 13.11 | 23.51 | 0.94 | 17.89 |
| repeat | state80 | 67.376 | 0.00 | 9.10 | 38.78 | 12.76 | 22.21 | 1.02 | 16.13 |

The current off path spends **62.3% of flow**, **72.5% of tree**, **93.6% of mesh** and **67.1% of State** in layout including ELK. This makes a broader indexed layout/conversion/route design more relevant than extrapolating the narrow forest solver to labelled/compound graphs. Sequence has no ELK; **47.2%** is Scene work. Class/ER spend **31.7%/28.6%** in the Scene lowering/admission hook and **16.1%/16.3%** in SVG security; the final `backend.render` hook is under 1%. This does not put all SVG string creation or writer work under 1%: earlier planning/admission and later rewrites/security are separately charged. A compact shared Scene/text representation and reduced duplicate safe-byte traversals are broader opportunities than the limited owner-interning flag. The table does not isolate object allocation or permit removing resource, paint or security checks.

TF tree records no ELK time and moves the remaining cost into other layout/Scene/proof/security. In the repeat mesh diagnostic, ELK is also absent while Scene, paint and security remain; cache hits do not make final artifact production free. Peer totals in the next section show the end-to-end gap, but **no peer stage costs are inferred** from AM's phase shares. `pipeline-comparison.png`, `.svg` and `.data.json` in the evidence root show the same-source off/TF exclusive-stage comparison; the new PNG was visually inspected. Full three-profile arithmetic is retained in `review/c517-pipeline-wall-table.json`.

**Weighted CPU attribution is withheld.** The strict helper rejected all three Inspector profiles because recorded `timeDeltas` contain negative entries, implying locally nonmonotone reconstructed sample times. Off has 3 negatives (minimum−566 µs), TF has 1 (−1 µs) and repeat has 1 (−131 µs). Their cause is unknown; no clock-jitter explanation is claimed. Original profiles and the failed proof are retained unchanged; no clipping, normalization or repair was used. Sample/node IDs, frame trees, sample/delta lengths, call rosters and separately clocked wall stages validate, but neither weighted self/inclusive percentages nor unweighted stack counts are published as elapsed shares, hardware cycles or family-specific attribution. Anonymous/evaluated ELK frames may lack recognizable URLs; untagged is not “non-ELK”. The strict failure and structural disposition are preserved in `review/c517-pipeline-cpu-analysis.json` and `review/c517-pipeline-structure-wall-proof.json`; earlier studies' CPU percentages are not substituted.

### Closed community peer comparison

The current peer pass records **33 fresh processes / 216 workload observations** across three alternating-order rounds. AM uses the freshly built local dist at source 5392 with TF enabled. Node workers are **24.19.0**; Bun **1.4.0** orchestrates. It explicitly sets ELK cache off and optional Scene assertions off; mandatory public resource/paint/security/output gates remain. Each peer imports/initializes once and does a first-render label check. The nominal policy requests five warm calls/250 ms, then up to twelve samples targeting 25 ms with a 5,000 ms case budget and minimum three samples. The case budget can stop warm-up early: the independently checked raw rows record **1–7,281 warm calls**, including AM mesh **3, 4, 2** by round; Rust tree reaches only two and Rust mesh one. Actual sample counts are **3–12**: **198/210** successful observations reach twelve, and twelve are budget-truncated. The generated peers.md caption's unconditional “≥5 warm calls” is therefore too strong; this authored report uses the actual raw counts. These totals are public-call comparisons, not equal output semantics or peer phase attribution.

Pins and timed surfaces are **Beautiful 1.1.3**, **Zombie 5.7.1**, **Pele 1.6.0** (`render(source).svg`), **Merman 0.9.1** (`renderSvgSync` and separately queued async `renderSvg` after engine creation), **mermaid-wasm-renderer 0.3.1** (`renderSvg`), and **Termaid 0.9.1 / Python 3.12.14** (terminal). AM/Beautiful/Zombie SVG use `renderMermaidSVG`; their terminal adapters request Unicode with no color. Official Mermaid requires a browser DOM and is compared in the separate browser suite; Merman/Pele/Rust terminal APIs are unavailable in these pinned adapter surfaces.

Warm SVG median ms/call across the three rounds:

| Workload | AM TF | Beautiful | Zombie | Pele | Merman sync | Merman async | Rust/WASM |
|---|---:|---:|---:|---:|---:|---:|---:|
| flow5 | 23 | 7.66 | 5.39 | 0.15 | 1.96 | 2.47 | 47 |
| tree50 | 30.3 | 29.1 | 27.8 | 0.734 | 5.38 | 6.02 | 741 |
| mesh50 | 409 | 70.7 | 57.6 | 2.52 | 12.3 | 14 | 1.5e+03 |
| seq20 | 12.4 | 0.0924 | 0.322 | 0.108 | 2.11 | 2.55 | 6.9 |
| c4 | 9.53 | unsupported | 0.141 | 0.0253 | 1.29 | 1.35 | 0.123 |
| class80 | 109 | 25.2 | 37.2 | 1.28 | 19 | 20.2 | 132 |
| er40 | 68.7 | 18.6 | 20.8 | 0.942 | 22.6 | 23.2 | 84.3 |
| state80 | 155 | 98.1 | 56 | 1.61 | 11.1 | 11.7 | 232 |

Warm terminal median ms/call:

| Workload | AM TF | Beautiful | Zombie | Termaid |
|---|---:|---:|---:|---:|
| flow5 | 5.34 | 0.521 | 0.902 | 1.04 |
| tree50 | 53.3 | 160 | 15.3 | 41.4 |
| mesh50 | 60.8 | lost 20 labels | 36.1 | 304 |
| seq20 | 5.31 | 0.201 | 0.393 | 0.965 |

All **216 observations** are accounted for, with **210 successes, six named exclusions and zero process restarts**. There are exactly six non-success observations: **Beautiful C4 is unsupported in all three SVG rounds**, and **Beautiful terminal mesh loses 20 expected labels in all three rounds**. Those cells contribute no successful latency median; fast rejection/label loss is not a rendering win. AM passes all eight SVG and four terminal first-output checks, but a returned SVG/retained-label check does not establish equivalent full semantics, geometry, paint or visual quality. Every accepted cell's noise and individual rounds remain in the raw report; rounded totals above are not confidence intervals.

AM's representative estimated V8 allocations are **26.7 MiB/tree**, **202.1 MiB/mesh**, **5.8 MiB/sequence** and **57.6 MiB/class** per SVG call. These expose much larger JS allocation than several peers, but V8 estimates omit Merman native heaps and Rust/WASM linear memory and cannot rank total memory across them. In this particular fresh-process sequence, AM SVG final RSS is about **487.9 MiB**, compared with Beautiful **289.0**, Zombie **271.9**, Pele **146.7**, Merman sync/async **77.0/86.3** and Rust/WASM **163.6 MiB**. RSS is resident memory after the last workload, without a forced-GC checkpoint; it is not peak or a per-input allocation total. The terminal RSS order differs (Beautiful about **637.7 MiB**, AM **279.6 MiB**), reinforcing the need to name the workload/output scope. Full browser Dart memory and packed payloads are reported separately below.

### Closed sample smoke

Both off and TF sample commands completed **128 SVG + 128 ASCII calls**. The independent roster proof checks rows1–128, equal titles/categories/order, nonnegative output times, all18 printed category totals, and no ERR/N/A/caught-error sections. The smoke's single-pass times are not a paired performance ranking, full semantics oracle or determinism proof. The normal `bench` entry runs samples then the Dave browser wrapper; this study's same-policy direct packed browser run adds baseline, Dart and separate memory diagnostics, so repeating the rebuild wrapper is unnecessary. This covers every current canonical `package.json` benchmark type, not every specialist eval script or exhaustive quality phase.

## Packed release, full browser corpus and memory

### Packed release and scaling

The independent release proof accounts for **126 timing workers** (21 groups ×two engines ×three rounds) and **42 separate memory workers** (one per engine/group). All **557 inputs** complete measurement in all rounds; that does not mean every input renders successfully. Enrollment is **537 distinct official examples plus 19 scaling inputs and one edit workflow**. Release excludes 18 `examples.md` occurrences outside its reviewed page/family mapping; the full browser retains them, explaining why its inventory has 546 trim-distinct sources. There are **365 shared successful SVG/ASCII inputs: 345 corpus +20 extras**, **192 shared unsuccessful corpus inputs**, **zero new successes and zero lost successes**. Existing unsupported/invalid cases remain in the failure ledger rather than becoming timing wins. All17 release checks pass, including finite determinism/expected-label/resvg/no-loss checks and their stated slowdown/memory thresholds; those gates are not proofs of complete authored meaning or a universal speedup.

Each compared input records five timing repetitions per round. The corpus ratio uses the same 345 matched successful inputs in each round: corresponding repetition totals are aggregated across inputs and then the median of five corpus passes is taken, rather than summing independently selected per-input medians. Scaling/agent groups remain separate workloads. Ratios are candidate TF / baseline, paired per round then medianed:

| Release group | Ratios, rounds1/2/3 | Median |
|---|---|---:|
| corpus | 1.113946, 0.690789, 1.015458 | 1.015458 |
| flowchart:tree-300 | 0.259828, 0.242693, 0.230622 | 0.242693 |
| flowchart:mesh-120-labelled-40 | 0.993750, 1.071441, 0.985720 | 0.993750 |
| flowchart:subgraphs-12x8 | 0.968018, 0.787182, 0.877749 | 0.877749 |
| sequence:20-participants-300-messages | 0.562858, 1.018946, 1.308268 | 1.018946 |
| class:80-classes | 1.123546, 0.941666, 0.965962 | 0.965962 |
| state:80-states | 1.553620, 0.701104, 1.043449 | 1.043449 |
| er:40-entities | 0.840495, 0.730119, 0.906579 | 0.840495 |
| gantt:150-tasks | 1.097718, 1.122572, 1.348080 | 1.122572 |
| gitgraph:200-commits | 1.044145, 0.546660, 0.901412 | 0.901412 |
| mindmap:200-nodes | 0.498851, 0.775334, 0.927971 | 0.775334 |
| timeline:100-events | 0.929822, 0.818289, 0.927358 | 0.927358 |
| sankey:120-links | 0.791854, 0.981246, 1.492607 | 0.981246 |
| journey:120-tasks | 0.860247, 0.917664, 0.832294 | 0.860247 |
| architecture:40-services | 1.036236, 0.916496, 1.134846 | 1.036236 |
| xychart:12-series-80-points | 0.657034, 1.012864, 0.613901 | 0.657034 |
| pie:80-slices | 1.129252, 0.838637, 0.703867 | 0.838637 |
| quadrant:150-points | 0.829447, 0.591224, 1.038844 | 0.829447 |
| radar:12-series-24-axes | 0.902462, 1.265005, 1.107174 | 1.107174 |
| c4:40-services | 1.212977, 1.075907, 0.884703 | 1.075907 |
| agent:edit-flowchart | 1.073567, 1.205614, 0.867055 | 1.073567 |

**No broad release uplift is established:** the matched corpus is **1.113946,0.690789,1.015458**, with an adverse1.015458 median and two adverse rounds. Tree300 is the clear scaling gain, lower in every pair; Gantt150 is slower in every pair. TF does not enable Gantt calendar/interval optimization, so neither result isolates that mechanism. The matched corpus latency distributions each contain5,175 observations (345×three×five): baseline p50/p95/max are **7.275/28.129/138.426 ms**, candidate **6.491/22.775/342.637 ms**. These pooled tails are a different statistic from the paired total ratio; candidate's larger maximum stays visible.

Release memory is **one fresh worker per engine/group**, not three memory replications. After a loading pass and separate per-input probes, a settled whole-corpus pass measures estimated V8 allocation, an observed start/end/pre-GC heap high-water and forced-GC retained growth. `peakRssBytes` is the OS high-water for the whole worker lifecycle, including its earlier passes; it is not attributable only to the measured pass. Whole-pass allocation is **not the sum of separately probed per-input allocations**.

|345-input corpus memory | Baseline MiB | Candidate TF MiB |
|---|---:|---:|
| Estimated V8 allocation /whole pass | 1241.237 | 1186.509 |
| Observed GC-boundary heap high-water | 146.645 | 149.306 |
| Settled heap growth /whole pass | 4.331 | 4.251 |
| Whole-worker peak RSS | 303.965 | 317.500 |

Thus allocation is lower while observed heap high-water and whole-worker RSS are higher in this single diagnostic pair. The separate tree300 pass allocates **383,475,192 versus 1,137,604,264 estimated bytes**, but its settled growth is **587,416 versus 238,376 bytes**; allocation reduction does not imply lower residency. None of these GC-boundary measurements is an exact continuous intra-render heap peak or a native-memory attribution. Full raw worker/population/check arithmetic is retained in `review/c517-release-proof.json` and `release/report.json`.

### Full Dave-style browser corpus

The independent browser matrix validates **16,425 records: five engines × three rounds × 1,095 occurrences**, with complete ordered rosters and exact saved arithmetic. The source inventory has **546 ECMAScript-trim-distinct sources**; duplicate fences remain intentionally represented in occurrence totals. The Chromium 154.0.8037.57 run uses 30 selected-corpus warm-up attempts before each engine/round, reverses engine order on alternate rounds and starts a fresh document per engine pass. ELK cache is disabled before library loading; startup flags are TF only for candidate. Timing covers the entire public render call through SVG return. Harness inspection/cleanup and host insertion/paint after return are outside the timer; any engine-internal work, including asset handling, remains timed. Remote assets are blocked and asset failures remain environment outcomes. SVG return is acceptance, not equivalent meaning, geometry or visual quality.

| Engine | All-round accepted /1,095 | Shared occurrences with AM | AM / comparator ratios, rounds1/2/3 | Median paired ratio |
|---|---:|---:|---|---:|
| Candidate TF | 710 | 710 | 1 /1 /1 | 1 |
| Baseline | 710 | 710 | 1.028924, 0.849342, 0.834925 | 0.849342 |
| Pele1.6.0 | 1063 | 710 | 16.253685, 28.828947, 19.014555 | 19.014555 |
| Official Mermaid12.2.0 | 1061 | 708 | 0.225321, 0.213645, 0.207198 | 0.213645 |
| Pinned Dart wrapper | 897 | 668 | 6.634364, 1.276564, 10.022688 | 6.634364 |

Each pair has a different shared population. The AM/baseline pair is adverse in round 1 despite the lower median; Dart and Pele have lower total public-call time than AM in every round of their own pairwise populations, while official Mermaid has higher time in all three. Dart's large round 2 variation remains visible; no confidence interval, language-only cause or visual-equivalence conclusion follows. The full status/environment ledger remains in `dave-browser/browser-report.json`; failures/unsupported examples are not silently removed from coverage or treated as fast successful renders. The same failure ID sets recur in all three rounds. Regex categories on first-round error strings count AM/baseline 379 “unsupported” +6 `render_error`, Pele 32 “unsupported”, official Mermaid 32 “unsupported” +2 asset errors and Dart 198 `render_error`. These are heuristic labels, not independent proof that every case is unsupported syntax or that 198 Dart bugs exist. Dart round 2 retains successful outliers at `docs/syntax/requirementDiagram.md:496` (**2,764.4 ms**), `docs/syntax/sankey.md:20` (**1,123.3 ms**) and `docs/syntax/sequenceDiagram.md:1061` (**806.6 ms**); no trimming or cause attribution was used.

For one uniform comparator table, the all-five-common population is **666 occurrences /333 exact raw strings /332 trim-distinct sources**. Exact raw-string identity is used by the memory deduplicator; trim identity is used by the census. The C4 raw-variant ledger preserves the source distinction. Every engine/round below uses exactly the same ordered occurrence IDs, not its own pairwise population:

| Engine | Uniform total ms, rounds1/2/3 | Comparator / AM, rounds1/2/3 | Median comparator / AM | Median AM / comparator |
|---|---|---|---:|---:|
| candidate | 6837.900 / 6351.200 / 6311.700 | 1.000000 / 1.000000 / 1.000000 | 1.000000 | 1.000000 |
| baseline | 6637.200 / 7495.100 / 7543.700 | 0.970649 / 1.180108 / 1.195193 | 1.180108 | 0.847380 |
| pele | 423.700 / 220.400 / 325.700 | 0.061963 / 0.034702 / 0.051603 | 0.051603 | 19.378876 |
| mermaid | 29463.200 / 29321.800 / 30016.700 | 4.308808 / 4.616734 / 4.755723 | 4.616734 | 0.216603 |
| dart | 1031.600 / 4979.600 / 630.000 | 0.150865 / 0.784041 / 0.099815 | 0.150865 | 6.628441 |

Ratios are computed from paired per-round totals and then medianed; independently chosen median totals are not divided. On this uniform set, AM is **6.628× Dart's measured time** at the paired median and Dart is lower in all three rounds. AM is about 0.217× official Mermaid's time, while Pele is faster than both in this adapter/run. Returning different amounts of geometry/markup and supporting different meaning can affect work; these observations do not explain competitors' internal phase costs.

### Fresh forest census joined to browser acceptance

The source-consistent native census and independent browser join retain both occurrence and trim-distinct denominators:

| Population | Total | Graph parsed | Structurally eligible | Native indexed forest selected | Errors |
|---|---:|---:|---:|---:|---:|
| Occurrences |1,095 |288 |44 |44 |0 |
| Trim-distinct sources |546 |144 |22 |22 |0 |

The eligible set is **4.03% of distinct corpus sources** and **4.02% of occurrences**, all Flowchart in this corpus. Native positioning selects indexed forest for every eligible distinct source. Candidate, baseline, Pele and official Mermaid return SVG on **all 44 occurrences /22 eligible sources in every browser round**. Dart accepts **34 occurrences /17 eligible sources** in every round. For each engine these counts agree whether “any” or “every” occurrence of a source must succeed. A source gate can also admit some icon-free Architecture forests outside this inventory; corpus counts are not traffic frequencies. Native strategy selection plus browser SVG acceptance does not prove every browser call chose the strategy or passed independent semantic/visual-quality oracles. Exact joins and raw variants are retained in `review/c517-browser-common-forest.json`.

### Browser sampled allocation and settled JS heap

The separate browser diagnostic validates **15 fresh processes**, three per engine. Every process uses the same **333 exact raw source strings**, deduplicated from666 all-five-common occurrences; there are332 trim-equivalent groups. One unsampled warm pass has 333 calls, followed by333 discarded-output calls and 333 retaining-output calls: **666 sampled calls /999 total calls per process**. Each call consumes output UTF-8 and observer/profiler/checkpoint work is included. The allocation metric is the heap-profile tree's **sum of node `selfSize`**; the sample-array size sum is a different recorded quantity and is not substituted. `consumedUtf8Bytes` includes the warm pass and is not the allocation denominator.

The table gives medians across the three fresh processes. Heap checkpoints are forced-GC `usedSize` minus that process's blank checkpoint; backing storage is separately scoped:

| Engine | Sampled bytes /sampled call | Loaded heap MiB | Warmed MiB | Discarded MiB | Retaining MiB | Released MiB | Released backing MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| candidate | 1,978,481.7 | 2.72291 | 24.64831 | 26.02196 | 27.00596 | 26.98845 | 3.41464 |
| baseline | 2,068,000.5 | 2.70655 | 24.10129 | 25.68184 | 26.42632 | 26.40881 | 3.39539 |
| pele | 66,792.9 | 0.94942 | 5.48781 | 6.20173 | 7.52414 | 6.35059 | 0.67530 |
| mermaid | 7,711,917.7 | 2.63635 | 28.36387 | 29.97164 | 30.79066 | 30.77265 | 5.26019 |
| dart | 259,350.3 | 3.32806 | 9.24798 | 9.65262 | 10.94535 | 9.82587 | 2.22141 |

Dart has lower sampled JS allocation and lower warmed/released used heap than AM in all three processes on this exact common set. Its loaded-only checkpoint is **higher** (3.328 versus 2.723 MiB), so even this diagnostic does not establish lower memory at every phase. Candidate's sampled allocation is modestly lower than baseline while its released used heap is higher. These results concern the pinned dart2js wrapper, not native Flutter, the full demo app or all Mermaid syntax.

`retainedOutputs:333` is the retaining-stage peak count, **not** a post-release reachability count. Released backing storage is a separate scope and must not be added to `usedSize` as a total-memory number. JS sampling/checkpoints do not establish exact allocation, continuous peak, whole-process/native/WASM/DOM-painted memory or a leak's presence/absence. The whole 15-profile arithmetic and actual source identity are retained in `review/c517-browser-memory-proof.json`; no previous study's memory populations or ratios are reused.

### Shipped and first-diagram delivery size

The independent byte audit passes **69 observations across 61 actual files**, checking SHA-256, raw lengths and **Bun 1.4.0 `node:zlib` gzip level 9** over the actual TGZ members, focused consumer outputs and pinned peer bundles. Lazy delivery sums each fetched module's compression rather than gzip-compressing a concatenation; requests include the loader and every dependency through the first successful flowchart.

| Delivery /API scope | Baseline raw bytes | Candidate raw bytes | Baseline gzip bytes | Candidate gzip bytes | Requests |
|---|---:|---:|---:|---:|---:|
| Full IIFE | 3,512,257 | 3,532,440 | 1,094,951 | 1,101,427 | 1 |
| Focused SVG consumer bundle | 2,932,499 | 2,949,940 | 896,778 | 902,935 | consumer build |
| Lazy initial loader/dependencies | 13,722 | 13,722 | 5,465 | 5,468 | 4 |
| Lazy through first flowchart | 2,247,384 | 2,263,405 | 697,290 | 703,266 | 27 |

| Other measured complete wrapper | Raw bytes | Gzip bytes | Requests |
|---|---:|---:|---:|
| Pinned Dart SVG wrapper | 2,263,286 | 818,979 | 1 |
| Pele global | 682,005 | 252,800 | 1 |
| Official Mermaid global | 5,494,801 | 1,570,966 | 1 |

The candidate adds **6,476 gzip bytes** to the complete IIFE, **6,157** to the focused consumer and **5,976** through lazy first flow; the lazy initial total grows by 3 compressed bytes while raw length is unchanged. A runtime flag does not remove already shipped optional code: all flag settings use the same measured candidate artifact. Build/import scopes can tree-shake or defer different APIs, which is a separate comparison.

Dart is smaller than AM's complete IIFE and this focused SVG consumer in both raw and gzip bytes. AM's lazy first-flow delivery is smaller in gzip than the complete Dart wrapper (**703,266 versus 818,979 bytes**), but it uses 27 requests and has a different delivery/API scope; the 5,468-byte loader alone is not the renderer's download cost. The focused SVG consumer excludes optional sketch backends, terminal output and typed editing; it is a consumer build rather than another shipped complete IIFE. These are offline per-file compressed JS budgets, not complete HTTP wire bytes, app assets, network loading time, npm archive sizes, native Flutter binaries or the full demo app. Optional features do not demonstrate a bundle-size uplift; they retain a measured delivery cost. Exact file-level proof is `review/c517-payload-proof.json`.

## Practical priority of all twelve implementations

This continuation order weighs **repeatable public-workflow impact, reachable cost and frequency in the benchmark inventory**. It is a judgment across scenarios, not a causal singleton ranking, exhaustive subset optimum or traffic model. TF/all-twelve effects are labelled as combined arms; historical singleton/ablation screens retain their old source identities. Runtime, cache policy and complete-output consumption can change the order.

| Rank | Flag / data structure | Reach and how often the opportunity appears | Current-source evidence / constraint |
|---:|---|---|---|
| 1 | **indexed-layout:** numeric ordered forest producer, O(V+E) | Narrow flat/unlabelled rectangular forests in the shared graphical producer. Census: 22/546 trim-distinct sources (4.03%), 44/1,095 occurrences; all eligible examples here are Flowchart. This is corpus reach, not traffic frequency; icon-free Architecture can also qualify by source rules. | TF tree latency is lower in all six cold Node/Bun pairs and all six complete-receipt micro pairs. Node/Bun cold medians .533/.414; consumed micros .529/.433. This is the strongest repeated public-workflow observation, though TF couples it with text-spans. Groups, labels, fan-in, cycles, shapes and State visuals keep the ELK fallback. Producer complexity does not bound the entire certified render. |
| 2 | **text-spans:** bounded immutable text-preparation LRU + eligible ASCII prefix advances | Broadest potential shared reach across native graphical/terminal/edit paths, but repeated exact keys and eligible text determine hits. ASCII-prefix acceleration falls back for Unicode/custom/styled/tracked/monospace/irregular lanes; immutable preparation caching has separate eligibility and can still cover formatted/Unicode text. Bench repeats/churn are synthetic key distributions, not production frequencies. | TF formatted prep .070 Node/.032 Bun; ASCII repeat .000656/.000180 and churn .159/.241. Complete public costs remain mixed/adverse outside tree; no broad winner versus A/A. Estimated 4+8 MiB cache weights are not physical heap caps. The measurements do not isolate cache reuse from prefix arithmetic or a singleton contribution to TF. |
| 3, conditional | **position-cache:** complete-key, private-copy positioned LRU | Exact repeat requests with normal caching enabled; Gantt, custom/external data and uncloneable C4 snapshots bypass. Key includes full appearance/config/environment; cross-theme restyling is not supported. Real hit rates are unknown. | TF+position mesh .157/.163/.195 and tree .560/.485/.665, but pie 1.178/1.179/1.245 and other families lose. Broad SVG .824 is close to A/A .832; it is not a broad causal winner. Estimated SVG extra-call allocation median .765, final settled heap +4.171 MiB. Global budget of estimated 16 MiB and 128 entries; hits still construct complete keys and clone artifacts. Final certification retains input-dependent, potentially quadratic checks. |
| 4, specialist | **gantt-intervals:** open interval union + weekly arithmetic | Gantt only. Long weekly durations and enabled dependency routing present the opportunity; ordinary input with 150 tasks has short durations and no dependency-arrow stress. Explicit-date exceptions/all-excluded calendars keep walking. | All-twelve longcalendar median .005883 with all 3 lower and estimated allocation of 155,037 versus 3,403,696 bytes/call. This is combined-arm evidence aligned with the enabled weekly branch, not all-Gantt speed. TF does not enable this flag. Keep the limit of 10,000 steps and exact tails; union construction is O(B log B), membership O(log B). |
| 5 | **paint-bvh:** typed bounded-quickselect BVH | Native graphical paint certification, depending on number/overlap of solid interiors. Every family can reach proof, but overlap can force linear candidate visits and proof budgets still bind. Existing baseline already has a BVH. | All-twelve retained sequence/class paint .324/.445, but this mixes packed tree and admitted-inspection reuse. New lower/admit and full public/consumed work do not establish a broad benefit. Expected build O(S log S), sorting fallback worst O(S log² S). Distinguish fresh work, same-Scene reuse and shared callback overhead when off. |
| 6 | **graph-index:** pass-owned ID/adjacency maps + thresholded stable-bounds BVH | Shared Flowchart/State/Architecture routing and C4 route consumers; Class/ER use separate converters. Numeric bounds indexing starts at 32 stable nodes/edges; mutable edge proofs retain live arrays. Broad-phase selectivity and build frequency matter. | Fresh all-twelve graph-mesh .981, route-audit .9999, rubric 1.075 do not show a substantial end-to-end gain. No current singleton isolation. Source potential remains for repeated ID lookup and selective queries; building indexes/sorting authored candidates can outweigh savings. |
| 7 | **svg-passes:** retained lexical ranges + disjoint replacements | Applicable SVG rewrite/style paths across graphical families; only safe lexical edits preserve cache ranges. Mandatory final security remains. | Current direct class passes do not establish general improvement; direct micros run outside active render-local inspection reuse. All-twelve fit .874 but scan 1.135, inline 1.076, scope 1.039, security 1.041. Do not read those as isolated flag costs or a complete one-pass pipeline. |
| 8 | **terminal-tiles:** adaptive dense rows with 32-cell tiles | TerminalDocument rows across supported native families. Conversion requires at least 64 occupied cells and span≤4× occupancy; sparse/wide rows stay Maps. Expected lookup remains O(1). | No demonstrated broad terminal win: all-twelve text flow/mesh/class/ER/state are slower all 3; consumed sequence .956 and class 1.041 are mixed. Main already compacted cells/deferred projection. A dedicated dense-row locality/allocation workload could expose the intended benefit; conversion/history/wide-grapheme semantics remain. |
| 9 | **sankey-csr:** two-pass compressed preliminary adjacency | Sankey only, especially high-degree layer construction; d3 layout/ribbons/text/Scene remain unchanged. The 120-link total reaches it but is not an isolated layer stress. | Removes copy-on-append O(sum degree²) construction in favor of O(V+E); no dedicated fresh canonical layer-only micro or singleton proof. Small public Sankey movement under TF cannot be assigned to this disabled flag. |
| 10 | **scene-arena, limited:** owner/ancestry interning + admitted-inspection/recount memo | All native graphical families may reach these consumers; repeat internal immutable-Scene inspection and exact recount are conditional. This is not a contiguous geometry/text/style arena. | Fresh lower/admit all-twelve sequence 1.004/class 1.019; retained-paint wins mix multiple flags. Main already changed deferred projection/resource counting. A fuller Scene/text IR remains a different, potentially larger design. |
| 11 | **persistent-mutations, limited:** private flowchart Map overlays | Safe flowchart operations only; other families/rename/group operations fall back. Every edit still serializes/reparses/rebuilds maps/spans/facts. | All-twelve edit-loop 1.117 with estimated 8,076,804 versus 8,324,552 bytes/call; no end-to-end speed benefit demonstrated. Avoiding some upfront clones is bounded by complete linear serialization/parsing; no rope/incremental parser/batching is delivered. |
| 12 | **incremental-order:** numeric ranks + bounded DFS/heap Kahn | Applicable graph conversion is rebuilt per call, not persisted between edits. Forward/backward author order determines cost. | Accepted backward insertions still copy/relabel all ranks, allowing O(V²). All-twelve reverse1024 is 5.619/4.935/4.601× time and about 10.34× estimated allocation. TF reverse1024 also loses all 3, so this is not a singleton causal estimate. Do not promote this prototype as a generally efficient dynamic algorithm. |

The strongest measured production-path observation is the restricted forest profile, while text preparation has broader potential reach. Exact-repeat services can move position-cache up, and long-calendar planners can move Gantt up. Current off-path cost, allocation/residency tradeoffs and retained bundle bytes stay part of the decision; all flags remain off. The twelve experimental variants do not constitute full implementations of the more ambitious designs below.

### Larger data structures and algorithms to investigate next

The new pipeline supports two broad priorities: layout/conversion/repair dominates graph-heavy inputs (mesh 93.6% including ELK), while Scene work remains large for sequence/Class/ER (47.2%/31.7%/28.6%) and SVG security adds material shared byte-walk cost. These four are **future extensions, not delivered features**. Their order is a research priority from measured reachable cost and missing mechanisms, not a promised speedup.

| Initial investigation order | Design and reachable work | Complexity opportunity and required contracts |
|---:|---|---|
| 1 | **General indexed compound layered layout/rank/network simplex.** Flowchart/State/Architecture shared producers and separate Class/ER ELK converters; labelled/grouped/cyclic graphs remain outside the forest solver. | Dense numeric node/edge/port IDs, CSR adjacency and typed working lanes can remove repeated object conversion/scans and support broader rank/route producers. Layered layout is not generally O(V+E): crossing heuristics, rank pivots, compounds/ports/labels and repairs retain data-dependent costs. Preserve authored IDs/parents/endpoints, directions, port sides, labels, state notes/namespaces, deterministic tie order and hard certification/ELK fallback; evaluate actual cyclic/grouped meshes and Class/ER/State composites. |
| 2 | **Compact Scene and text IR with shared immutable backing.** Every native graphical family and complete receipt consumer, with terminal/shared text opportunities. | Typed geometry, interned integer owner/style/text IDs and indexed parent chains could reduce allocations, duplicate traversals and O(PD) materialized ancestry storage for P primitives at depth D. Public object views/receipt JSON/output still require O(P+bytes) materialization when consumed. Retain identity-admitted private evidence, clone isolation, source/grapheme/marker provenance, transform/opacity order, conservative accounting/exact fallback, proof budgets and final secured-byte digest binding. Measure first render and complete UTF-8/receipt consumption, Unicode/deep groups and release residency. |
| 3 | **Incremental parse/edit representation with dependency-aware updates.** Repeated agent/editor edits, rather than only clone avoidance. | Rope/piece-table text edits can target O(log N+Δ); persistent maps/trees can path-copy local typed updates. Incremental lexer/parser/spans target changed regions plus dependency closure, with unavoidable O(N) cases for quote/group/wrapper changes. Full canonical serialization remains O(N); batching/local views are needed to avoid that floor. Preserve new multiline/directive/comment/source-slice semantics, accessibility, duplicate identity, opaque fallback, caller immutability and serializer read-after-write correspondence. Dirty layout/proof reuse needs exact invalidation. |
| 4 | **Proper dynamic topological order maintenance.** Reverse-authored conversion and persistent editing graph updates. | Order-maintenance/balanced-sequence storage plus affected-interval searches can avoid mandatory O(V) relabelling per accepted backward edge. Select a published algorithm and state its exact amortized bounds; cycle/reachability still costs affected vertices/edges, not universal O(log V). Keep author-order cycle rejection, duplicate/unknown/self-edge behavior, final deterministic Kahn order, bounds and overflow behavior; test forward/reverse/alternating/cyclic/duplicate scaling and graph-version invalidation. |

Two narrower follow-ons are explicit graph-mutation-boundary spatial-index invalidation/rebuilds and certified reuse across a restricted geometry-preserving paint-only change contract. Neither is delivered by static pass-owned bounds snapshots or the complete-request position key. Overlap/output size still limits spatial asymptotics, and restyling must invalidate changed fonts, labels, spacing and shapes.

## Stable lessons from Mermaid Dart

The measured Dart benchmark artifact is pinned to [mermaid-v0.3.1,f53b343b8fa5c30859223d623acde2da2f175a00](https://github.com/orestesgaolin/mermaid/tree/f53b343b8fa5c30859223d623acde2da2f175a00), whose preserved build recipe uses Dart SDK 3.13.5, dart2js -O2 into an ApproximateTextMeasurer/renderSceneToSvg wrapper. The actual wrapper SHA-256 is `2cb2f0d74f5171717fdb3d8fc6579903c67c2656f9f5494f328c9581bea1975b`, independently reverified in this study. This is not native Flutter or the full web app, and a speed difference does not isolate a language advantage.

- **Index working state and preserve deterministic fallbacks.** Dart's [indexed Dagre](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/vendor/dagre/src/indexed_layout.dart) and [network simplex](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/vendor/dagre/src/rank/network_simplex_indexed.dart) use indexed/array working data. AM's forest and order prototypes are different, narrower implementations.
- **Separate permitted paint changes from geometry.** [Issues 16](https://github.com/orestesgaolin/mermaid/issues/16)/[17](https://github.com/orestesgaolin/mermaid/issues/17) and [paint overrides](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/diagrams/flowchart/flow_restyle.dart) expose a restricted restyle contract. AM's complete-key cache does not yet provide arbitrary cross-theme reuse.
- **Bound storage and align measured/painted typography.** The [SVG writer](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/render/svg_renderer.dart) bounds its spare buffer at 1 MiB and attribute cache at 64 entries. [Issue 81](https://github.com/orestesgaolin/mermaid/issues/81)/[PR 80](https://github.com/orestesgaolin/mermaid/pull/80) led to the state-weight [e50489c fix](https://github.com/orestesgaolin/mermaid/commit/e50489c6036ecd98a4f7c22988398744f85c2baf), after the measured pin. Closed-without-merge metadata alone does not determine shipped behavior.
- **Turn integration faults into semantic/geometry/package fixtures.** Archived [HTML 79](https://github.com/orestesgaolin/mermaid/issues/79), [overlap 82](https://github.com/orestesgaolin/mermaid/issues/82), [config 44](https://github.com/orestesgaolin/mermaid/issues/44), [UP-port PR 7](https://github.com/orestesgaolin/mermaid/pull/7), [clearance 76](https://github.com/orestesgaolin/mermaid/issues/76) and [dependency PR 6](https://github.com/orestesgaolin/mermaid/pull/6) motivate meaningful combinations and clean packed consumers; they are not independently reproduced AM defects.

The archived 19 October snapshot examined 76 issues, six PRs and three returned public forks. [yringler](https://github.com/yringler/mermaid-flutter) supplied state paint; [parlough](https://github.com/parlough/mermaid) supplied merged dependency/UP-port fixes; [definev](https://github.com/definev/mermaid) had no ahead commits on its returned branch. No additional unlanded performance implementation was identified in that bounded snapshot. No claim covers private/deleted/later forks.

## Reproduction and generated evidence

Evidence paths in this report are relative to `bench-report/experiments/parser-main-study`, unless a repository file or working public CI/PR link is named. Raw measurements, generated plots/screenshots/profiles and actual TGZs remain uncommitted. The preserved `execution-driver.sh` is the complete 15-step recipe, including fresh base/candidate builds, independently installed pinned consumers, locks, startup gates and all command settings. `study.json`, `holdout-configs.json`, `repeat-configs.json`, `lifecycle.tsv`, `exit-status.tsv`, `validation.json`, `arithmetic-validation.json` and `review/c517-*` proofs retain identities, configuration, populations and failed CPU-attribution evidence. Historical sibling evidence roots retain their original source/base IDs.

Use a separate clean checkout at **5392c3b414aebb85a45037ad5f61147944b4d908**, the preserved dependencies/locks and the measured artifacts/configs; write new results into a new directory. The exact packed hashes are listed below. The commands assume the evidence has been unpacked at the study path, its pinned baseline consumer installed as recorded by the driver, and the pinned Dart wrapper present at the supplied path. Replace only those local locations for another workspace, preserving bytes/hashes and protocol. These focused commands supplement the complete driver:

```bash
AM_BASE=c517a1611290c7aa463512dc8b8d5156a3424a98
AM_STUDY=bench-report/experiments/parser-main-study
AM_OUT=bench-report/replay-5392
AM_FLAGS=text-spans,indexed-layout
AM_ALL=graph-index,scene-arena,svg-passes,text-spans,indexed-layout,position-cache,paint-bvh,incremental-order,terminal-tiles,persistent-mutations,gantt-intervals,sankey-csr
AM_BASE_TGZ="$AM_STUDY/artifacts/baseline/agentic-mermaid-0.4.2.tgz"
AM_CAND_TGZ="$AM_STUDY/artifacts/candidate/agentic-mermaid-0.4.2.tgz"
AM_BASE_SHA=94f0c4a86f483c3a5ef25a54fead424f732322cf978f825eb5fe8437ff05e0c6
AM_CAND_SHA=adde7b2f2df08d21bfef82a070d185da015972a89d6ac02274f70d209ca94ece
AM_DART_BUNDLE=/workspace/mermaid-benchmark/web/dart.js
AM_DART_SHA=2cb2f0d74f5171717fdb3d8fc6579903c67c2656f9f5494f328c9581bea1975b
AGENTIC_MERMAID_EXPERIMENTS= bun run bench --rounds 3 --executable /usr/bin/chromium --out "$AM_OUT/normal"
for AM_RUNTIME in node bun; do
  AGENTIC_MERMAID_EXPERIMENTS= bun run bench:experiments --baseline-ref "$AM_BASE" --configs "$AM_STUDY/holdout-configs.json" --paired 1 --runtime "$AM_RUNTIME" --rounds 3 --samples 12 --warmup 5 --warmup-ms 1000 --broad 1 --png 1 --gc natural --cache off --out "$AM_OUT/holdout-$AM_RUNTIME"
  AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:micro --baseline "$AM_BASE" --runtime "$AM_RUNTIME" --rounds 3 --samples 12 --warmup-ms 250 --min-sample-ms 25 --max-case-ms 8000 --json "$AM_OUT/micro-$AM_RUNTIME.json"
done
AGENTIC_MERMAID_EXPERIMENTS= bun run bench:experiments --baseline-ref "$AM_BASE" --configs "$AM_STUDY/repeat-configs.json" --paired 1 --runtime node --rounds 3 --samples 12 --warmup 5 --warmup-ms 1000 --broad 1 --png 1 --gc natural --cache on --out "$AM_OUT/repeat"
AGENTIC_MERMAID_EXPERIMENTS= bun run bench:experiments --baseline-ref "$AM_BASE" --configs "$AM_STUDY/repeat-configs.json" --paired 1 --runtime node --rounds 3 --samples 1 --warmup 1 --warmup-ms 0 --broad 1 --allocation 1 --png 1 --gc checkpoint --cache on --out "$AM_OUT/repeat-memory"
AGENTIC_MERMAID_EXPERIMENTS="$AM_ALL" bun run bench:micro --baseline "$AM_BASE" --runtime node --rounds 3 --samples 12 --warmup-ms 250 --min-sample-ms 25 --max-case-ms 8000 --json "$AM_OUT/micro-all.json"
AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:peers --peers agentic,beautiful,zombie,pele,merman,merman-async,mermaid-rs,termaid --rounds 3 --json "$AM_OUT/peers.json"
AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" AGENTIC_MERMAID_ELK_CACHE=0 bun run bench:samples
AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:release --baseline "$AM_STUDY/baseline-consumer/node_modules/agentic-mermaid" --candidate-tarball "$AM_CAND_TGZ" --candidate-sha256 "$AM_CAND_SHA" --rounds 3 --reps 5 --out "$AM_OUT/release"
AGENTIC_MERMAID_EXPERIMENTS= bun run bench:release:browser --candidate-tarball "$AM_CAND_TGZ" --candidate-sha256 "$AM_CAND_SHA" --baseline-tarball "$AM_BASE_TGZ" --baseline-sha256 "$AM_BASE_SHA" --dart-bundle "$AM_DART_BUNDLE" --dart-sha256 "$AM_DART_SHA" --dart-revision mermaid-v0.3.1@f53b343b8fa5c30859223d623acde2da2f175a00 --features "$AM_FLAGS" --rounds 3 --warmup 30 --memory-passes 1 --executable /usr/bin/chromium --out "$AM_OUT/browser"
AGENTIC_MERMAID_EXPERIMENTS= bun run bench:pipeline --rounds 3 --reps 5 --cache off --out "$AM_OUT/pipeline-off"
AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:pipeline --rounds 3 --reps 5 --cache off --out "$AM_OUT/pipeline-selected"
AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS,position-cache" bun run bench:pipeline --rounds 3 --reps 5 --cache on --out "$AM_OUT/pipeline-repeat"
```

Do not run benchmarks concurrently with tests/builds or heavy evidence processing. Configure browser globals before loading the IIFE/lazy entry. Default `bench` rebuilds/packs and runs samples plus full Dave-style AM/Pele/official comparison; the direct browser command is used here for pinned baseline/Dart/memory options that its wrapper does not forward. Every canonical benchmark type is represented, while specialist eval scripts and a semantic/visual quality census are separate work.

## Current-source integration, inherited findings and final gates

The independent algorithm integration review binds **5392/c517**, rather than carrying forward a 31/1b result. It found no blocking algorithm/integration issue in its bounded scope. The unchanged independent probe passed **17 native families, 27 named probes and 431 assertions**, covering exact-repeat bytes/full receipts for the eleven parity flags, private positioned-copy isolation, new ER/Class/State/Pie/Flowchart authored facts/source spans, flowchart mutation overlays/fallback and a separately certified all-twelve forest with independently specified identities/endpoints. Eligible forest geometry was not forced to match baseline pixels.

Selected algorithm/PR #437 owning contracts passed **45 tests / 24,637 assertions**. Incoming grammar/source-map contracts ultimately passed **272 unique tests**, making **317 unique owning tests** with that set. The initial incoming run had three upstream-helper IPC setup failures (`EPERM`), followed by an affected-file retry with the permitted IPC/network sandbox setting and no source/test/timeout changes; all three passed. Repeated retry observations are not additional unique coverage. These are correctness observations, not throughput, memory, payload or all-subset proof. See `review/c517-algorithm-integration-results.md`.

The closed independent semantic integration review records **200 owning tests / 1,993 assertions / zero failures** across five disjoint files, plus **18/18 supported fixture/profile checks** (six fixtures under off, TF and all) and passed private positioned-cache isolation. These supported witnesses preserve independently authored meaning, State body/header paint, exact-repeat secured SVG, digest-bound passed native certificates, deferred connector state and clone isolation. Its cache-on policy disables optional Scene assertions while immutable/resource/output gates remain active. The review found no introduced flag integration blocker in its bounded scope. It separately preserves the two failed inherited authored contracts below; supported positive fixtures do not turn those failures into passes. See `review/c517-semantic-integration-results.md` and its summary/receipts.

### Two reproduced inherited authored-meaning defects

The separate c517-inherited-meaning-summary.json records **six actual fresh base/candidate processes**: off, TF and all at each exact revision. All six exited zero, reproduced both discrepancies, and produced identical base/candidate/profile behavior. The summary explicitly records **authoredContractsPassed: false**. A successful reproduction script is evidence of the defects, not passing authored expectations.

| Inherited case | Independently expected authored meaning | Actual behavior in all six base/candidate/profile runs |
|---|---|---|
| Physical percent line inside a quoted multiline Flowchart label | Keep `alpha\naccTitle: literal label title\n%% literal percent line\nomega` as label content; keep the real outside accessibility directive separate. | The `%% literal percent line` is dropped from parsed label content and SVG; the other label lines remain. |
| Nested State note serializer round trip | Preserve exactly root S and nested A/B with parent S. | Serialization emits `note right of B` outside S; reparsing adds a second root B alongside nested B. |

These are demonstrated baseline/candidate defects in the tested cases, not introduced flag regressions, nor proof of general semantic equivalence. They must remain visible alongside parity/label checks. No performance result, corpus-success inference or waiver of authored-meaning correctness follows from identical behavior. Their owning files are unchanged between base and candidate. The performance PR records the original failing authored expectations and six-process reproductions in `review/c517-inherited-meaning-summary.json` and its repro sources/receipts; it does not add unrelated baseline parser/serializer fixes or represent those contracts as passed.

### Final review and artifact identity

The closed artifact preflight gate passed and was released at **2026-10-20 01:22:05 UTC**, after local tests/builds/probes stopped and before fresh timing began. Its receipt binds source **5392** / base **c517** and recomputed packed hashes:

- Baseline SHA-256: `94f0c4a86f483c3a5ef25a54fead424f732322cf978f825eb5fe8437ff05e0c6`.
- Candidate SHA-256: `adde7b2f2df08d21bfef82a070d185da015972a89d6ac02274f70d209ca94ece`.

The **full-IIFE startup witness passed every recorded check** on the seven-node/six-edge forest: baseline and candidate-off have equal SVG/geometry; candidate TF matches the actual CI flagged SVG, geometry and layout projection; enabled/off geometry and SVG differ; displayed labels agree. This proves that the packed startup flags activate the intended path on this fixture, without a performance claim.

The separately closed **native lazy first-family witness passed 24/24 combinations**: six fixtures × baseline/off, candidate/off, candidate/TF and candidate/all. Each used a fresh browser context, native HTTP-served emitted ESM/chunks and flags set before import. All retained independently expected authored facts, accessibility, paint and passed digest-bound certificates; every module request returned HTTP 200, with no page errors or remote requests. Baseline and candidate-off SVG bytes agree for all six fixtures. Chromium was **154.0.8037.57**, with Bun **1.4.0** orchestration. The probe confirms statementEnds/first-family integration and actual TF geometry activation. It reports no throughput, allocation, heap, request-size or gzip result; the two inherited defects remain unfixed. See `browser-lazy-activation/review.md` and `browser-lazy-activation/receipt.json`.

Typecheck and changed-source lint (**47 files**) passed. The actual study-source [CI run 39351828369](https://github.com/adewale/agentic-mermaid/actions/runs/39351828369) completed **successfully** at head 5392. Its [visual artifact 12233124707](https://github.com/adewale/agentic-mermaid/actions/runs/39351828369/artifacts/12233124707) records base c517 / head 5392, **TF startup flags and Bun 1.4.2**. Both downloaded before/after forest PNGs were visually inspected during preflight. This is the current-source visual/CI witness, not a timing comparison or final documentation-head audit.

The generated evidence retains these exact-source algorithm/semantic reports, root type/lint checks, source-CI and visual receipts, both startup witnesses, artifact gate, census and all raw study/independent proofs. Earlier source reviews remain attached to their original revisions. The two independent owning-test sets overlap some checks; their counts must not be added into one artificial unique-test total.

**Final documentation-head gates are recorded on [PR #436](https://github.com/adewale/agentic-mermaid/pull/436).** After the report commit, the exact PR head requires independent final-diff/claim reviews, required CI, its actual selected-profile visual artifact and a fresh rebuild/pack comparison to the measured artifact. Those results and the eventual PR-head hash belong in the PR/generated records, avoiding a self-referential hash in this committed report. Only a demonstrated identical runtime package can carry 5392 measurements to a later documentation-only head; no byte proof from either historical study establishes that identity.

The measured result supports scenario-specific opt-in profiles and further work on broader layout and compact Scene/text structures. It does not support a universal/default promotion, exhaustive optimum or full implementation claim for the limited prototypes. Latency, sampled/estimated allocation, settled heap, whole-worker RSS, coverage and complete/lazy download cost show different tradeoffs; the P2 flags-off cost and two inherited authored-meaning defects remain explicit alongside the wins.
