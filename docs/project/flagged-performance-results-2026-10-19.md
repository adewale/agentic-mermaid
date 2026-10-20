# Historical performance study — before the production rebases

This report preserves the **07ab/318** study completed before PR #437 changed
production SVG/terminal allocation and deferred receipt work, and before PR
#432's grammar and normalization changes. Its measurements
and review claims apply only to those recorded revisions. For the rebased
candidate, use the [20 October results](flagged-performance-results-2026-10-20.md).
References below to the study's final runs do not describe the final PR head.

Measurement source: **07ab2f3fe50242c656db94c64a847b56413b1dbe**. Production baseline: **3187824137a049e326745e9a2d964bb793fb27b2**, including the typed writer and Scene-admission work from [PR #435](https://github.com/adewale/agentic-mermaid/pull/435). All twelve experiments remain **off by default**.

The conditional downstream candidate is **text-spans,indexed-layout (TF)**. It cut the measured browser shared-corpus time to **0.889× baseline**; all three ratios were **0.924, 0.889, 0.840**. The 300-node forest took **0.240×** at the paired median, about **4.17× faster**, with round ratios **0.240, 0.266, 0.222**. These gains coexist with slower cases, higher retained browser heap and larger bundles. No configuration dominates performance, memory and download size.

With normal ELK caching enabled, TF-only SVG/all-output ratios were **0.979/0.958**, versus A/A **1.038/1.048**. Per-case variation prevents declaring a general default-cache winner. All flags remain off by default.

## Method, populations and limits

The study screened all twelve single flags and leave-one-out ablations, compared selected combinations, then confirmed TF and the eight-flag core against production baseline A/A and current-code-off controls. This is not exhaustive search of all 4,096 subsets. Earlier screens/ablations used source 99d0b6ef, Node/cache off and 16 workloads; paired combinations expanded to 27. Frozen 07ab confirmation used Node and Bun, adjacent fresh references, AB/BA order reversed between rounds, three process rounds, twelve timed samples, at least five warm calls and 1,000 ms warm-up per case.

Timing uses natural GC; forced-GC allocation/settled-heap diagnostics are separate. The matrix times the public render return plus output byte-length check; receipt cases include JSON serialization. Complete-output hashes are outside timing. This is not UTF-8 encoding throughput, DOM insertion or paint. Warm text preparation can remain reusable with ELK caching off: repeated warmed source with cold layout is not a cold process or a unique-source workload.

The study includes samples, matrix, full Node/Bun micro suites, adverse feature-path cases, community peers, packed release examples/scaling/editing, all Dave-style browser occurrences, memory/payload diagnostics and instrumented pipeline attribution. Stage clocks/CPU sampling add overhead and do not supply the profile-selection score. ELK is nested inside layout and must not be added twice. Peer internal stages are not inferred.

Matched successful timings exclude inputs that fail in either engine in required rounds; full coverage/failure ledgers accompany them. Returning SVG proves acceptance, not equivalent meaning or visual quality. Geometry, identities/endpoints, text, terminal ownership, security and paint contracts supply separate evidence. Browser remote assets are blocked.

Memory is precisely the named measure: estimated V8 allocation, GC-boundary JS heap, external/backing storage, or whole-worker RSS. ArrayBuffers are included in external bytes; browser JS profiles omit native/WASM/process and painted-DOM memory. Release has one memory worker per engine/group; browser memory has three fresh processes per engine.

The shared cloud environment and large per-case A/A movements limit small effects. Earlier checkpoint A/A SVG aggregates ranged 0.813–1.750; a separate higher-warm-up natural-GC calibration ranged 0.983–1.084 but changed more than GC policy. Do not infer a cause, normalize by A/A, rank tiny differences, or invent confidence intervals from correlated samples. Node 24.19.0 workers and Bun 1.4.0 workers retain their own policies. Bun 1.4.0 orchestrated the Chromium 154 browser study; its Node compatibility version field is not an additional Node timing runtime. All seventeen final driver steps exited zero. A control-connection interruption during the original driver is preserved in the evidence event record; no observations were dropped or rewritten, but an absence of scheduling effects is not established.

## Conditional profile decision

Keep all flags off in production defaults. TF is the strongest narrow cold-layout candidate: tree50 improves in every paired Node/Bun round, while the broad 2–3% averages remain unresolved and flow5 slows in all six pairs. Core is a promising Bun alternative, not a confirmed broad winner.

Positioned reuse remains a targeted profile. With ordinary ELK caching on in both engines, TF plus position-cache gives mesh50 ratios **0.191, 0.161, 0.177**, but broad SVG ratio 1.149 and material class/XY/pie regressions. Off is also slower broadly at 1.152. Independently referenced aggregates do not isolate the added cache's marginal effect. The later TF-only normal-cache arm checks that profile under normal caching; it does not retrospectively isolate position-cache's marginal effect.

The separate checkpoint pass sums one allocated call across 20 SVG workloads: allocation ratios **0.786, 0.787, 0.786**, while settled final heap increases **4.275, 4.263, 4.239 MiB**. Less allocation and more residency can both be true; those forced-GC timings are not the selection score.

## Normal-cache selected-only confirmation

The supplemental Node control uses the same three-round natural-GC timing policy, with production ELK caching enabled on both sides. It tests TF alone, without position-cache. SVG/all-output ratios are **0.979/0.958**, versus A/A **1.038/1.048**. Tree50 ratios are **0.824, 0.902, 2.393**: the cold-layout tree result does not carry over as a repeatable latency win here. Terminal flow5 and the weekly Gantt stress were slower in all three pairs. These small broad changes and large case variation do not establish a general normal-cache winner.

In the separate forced-GC pass, the sum of one estimated allocated call across 20 SVG workloads has ratios **0.971, 0.973, 0.968**; final settled used-heap deltas against each adjacent reference are **+0.406, +0.402, +0.387 MiB**. These allocation savings coexist with higher residency. They are neither exact peaks nor a reason to rank the memory-pass timings.

## Paired cold-layout confirmation

Ratios below are candidate latency / its adjacent baseline latency; lower is better. Each case uses the median of three paired process ratios. The SVG aggregate is an unweighted geometric mean of those case medians, not a workload-frequency model or an estimate with a 95% confidence interval.

| Profile | Node SVG | Node all 27 | Bun SVG | Bun all 27 |
|---|---:|---:|---:|---:|
| aa | 1.126 | 1.129 | 0.968 | 0.944 |
| off | 1.030 | 1.014 | 0.941 | 0.964 |
| text-forest | 0.978 | 0.976 | 0.972 | 0.974 |
| core | 0.974 | 1.016 | 0.885 | 0.892 |

A/A is the identical production baseline rendered in two fresh processes. Its movement qualifies interpretation; scores are not divided by A/A. Core is the eight-flag alternative named in the study manifest.

| Case | TF Node | Node A/A | TF Bun | Bun A/A |
|---|---:|---:|---:|---:|
| flow5 | 1.098 | 1.408 | 1.338 | 0.846 |
| tree50 | 0.568 | 1.422 | 0.479 | 0.868 |
| mesh50 | 0.913 | 1.089 | 0.986 | 1.015 |
| seq20 | 0.899 | 1.332 | 0.618 | 0.998 |
| c4 | 0.922 | 0.985 | 0.988 | 1.055 |
| class80 | 1.018 | 1.040 | 1.032 | 0.971 |
| er40 | 0.761 | 0.950 | 0.914 | 0.892 |
| state80 | 1.042 | 0.792 | 1.016 | 0.904 |
| gantt:150-tasks | 1.059 | 0.936 | 0.948 | 1.085 |
| gitgraph:200-commits | 1.037 | 1.046 | 0.872 | 0.920 |
| mindmap:200-nodes | 0.996 | 1.047 | 0.918 | 1.003 |
| timeline:100-events | 1.074 | 1.124 | 1.026 | 0.956 |
| sankey:120-links | 1.121 | 1.163 | 1.026 | 0.940 |
| journey:120-tasks | 1.182 | 1.202 | 1.090 | 0.944 |
| architecture:40-services | 1.002 | 1.295 | 1.166 | 0.996 |
| xychart:12-series-80-points | 0.832 | 1.129 | 1.089 | 1.103 |
| pie:80-slices | 0.994 | 1.400 | 1.046 | 0.960 |
| quadrant:150-points | 0.981 | 1.125 | 0.979 | 1.001 |
| radar:12-series-24-axes | 1.162 | 1.118 | 0.983 | 1.034 |
| gantt:weekly-dependency-routing | 1.145 | 1.151 | 1.371 | 0.922 |
| terminal:flow5 | 0.877 | 1.112 | 0.821 | 0.755 |
| terminal:tree50 | 0.929 | 1.267 | 1.114 | 0.896 |
| terminal:mesh50 | 0.954 | 1.306 | 1.213 | 0.837 |
| terminal:seq20 | 1.039 | 0.889 | 0.962 | 1.004 |
| agent:edit-loop | 1.042 | 1.338 | 0.988 | 0.852 |
| receipt:flow5 | 1.041 | 1.106 | 0.968 | 0.872 |
| png:flow5 | 0.912 | 1.028 | 0.841 | 0.950 |

Tree50: Node paired ratios 0.568, 0.597, 0.517; Bun 0.528, 0.479, 0.377.

In all six TF tree pairs latency was lower, about 43% at the Node median and 52% at the Bun median. Flow5 was slower in every TF pair in both runtimes, and Bun terminal tree50 was slower in all three. These stay visible alongside substantial per-case A/A variability. The broad 2–3% TF averages are unresolved; no universal uplift is claimed.

## Selected-profile stage evidence

All 57 cases completed three rounds in each runtime, without missing baseline stages or mismatched staged inputs. Ratios are the median of per-round candidate/baseline medians. These stages use short warm-up and different timing/consumption boundaries from the public-call confirmation; do not pool them into one score.

| Stage | Node ratio | Bun ratio |
|---|---:|---:|
| text:prepare-display-formatted | 0.061 | 0.038 |
| text:wrap-ascii-repeat | 0.000528 | 0.000246 |
| text:wrap-ascii-churn | 0.215 | 0.329 |
| layout:graph-tree50 | 0.302 | 0.219 |
| render:svg-tree50 | 0.433 | 0.543 |
| render:svg-flow5 | 0.794 | 1.170 |
| render:svg-mesh50 | 0.838 | 1.223 |
| agent:edit-loop | 0.948 | 1.023 |

The wrapping probes use a plain ASCII paragraph repeated 20 times (about 1,400 characters), with width 240. The repeat probe reuses one key; churn rotates 1,024 keys beyond both cache entry caps. The repeat result mostly measures immutable-cache reuse; churn also exercises the prefix-advance algorithm without relying on fitting the rotating population in the cache. They do not represent a thousandfold speedup of general diagram rendering. Styled/Unicode/custom-metric cases retain general wrapping.

Node repeat/churn allocation estimates were about 3.4 KiB / 1.58 MiB per call versus baseline 8.59 MiB for each; these are separate V8 estimates, not retained residency. The selected profile does not enable scene-arena, paint-bvh, graph-index or other flags, so unrelated stage fluctuations cannot establish benefits from them.

## Combined-feature stress evidence

All 57 Node cases completed three process rounds. All twelve flags are configured, but the micro runner disables layout caching; this also disables positioned reuse. These are combined effects, not isolated estimates for each flag.

| Case | Combined candidate / baseline |
|---|---:|
| layout:model-order-forward-128 | 0.391 |
| layout:model-order-forward-1024 | 2.294 |
| layout:model-order-reverse-128 | 1.458 |
| layout:model-order-reverse-1024 | 6.931 |
| gantt:calendar-weekends-long | 0.009 |
| scene:lower-admit-seq20 | 1.455 |
| scene:lower-admit-class80 | 2.264 |
| scene:paint-certify-seq20 | 0.462 |
| scene:paint-certify-class80 | 0.611 |
| svg:scope-styles-class80 | 0.850 |
| render:ascii-flow5 | 0.841 |
| render:ascii-mesh50 | 0.900 |
| render:ascii-seq20 | 0.957 |
| agent:edit-loop | 1.357 |

Long recurring calendars benefit sharply in this stress case, while reverse ordering scales poorly and even the forward 1,024-node case is slower. Combined lowering/admission costs rose for sequence and class Scenes despite faster certification on retained Scene objects. The combined edit loop regressed. This does not support enabling every flag or attributing all of a shared-stage ratio to one mechanism. The ordinary Gantt release case activates neither new Gantt branch; route-audit and terminal changes need public-workflow evidence.

## Pipeline attribution

Source 07ab2f3f with all flags off, layout cache off, three instrumented rounds × five calls per workload. Percentages are shares of each workload’s own total. They are not a traffic mix and do not expose another engine’s internal phases. ELK is part of layout; the table splits it out exactly once. Public-call medians in the community table were measured separately without stage clocks and CPU sampling.

| Workload | Instrumented total ms | ELK | Other layout | Scene | Paint proof | Final SVG security | Backend | Request + other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| flow5 | 16.07 | 42.4% | 17.0% | 11.8% | 4.3% | 7.5% | 0.3% | 16.7% |
| tree50 | 87.25 | 40.3% | 25.7% | 14.7% | 4.7% | 5.9% | 0.2% | 8.4% |
| mesh50 | 507.18 | 47.4% | 44.7% | 3.5% | 1.3% | 1.4% | 0.1% | 1.6% |
| seq20 | 16.30 | 0.0% | 9.6% | 38.3% | 7.2% | 17.0% | 0.6% | 27.3% |
| c4 | 11.13 | 0.0% | 16.7% | 21.9% | 7.8% | 7.8% | 0.3% | 45.5% |
| class80 | 127.78 | 20.8% | 7.6% | 32.5% | 10.8% | 13.6% | 0.7% | 14.1% |
| er40 | 109.35 | 24.7% | 8.4% | 27.8% | 8.5% | 13.5% | 0.6% | 16.5% |
| state80 | 187.13 | 40.4% | 23.7% | 14.5% | 5.1% | 7.3% | 0.3% | 8.7% |

Mesh50 spends about 92% in layout, divided about 47% ELK and 45% other layout work; replacing only the ELK solver does not address route repair and hard graph certification. State80 also remains layout dominated. The eligible tree producer removes the nested ELK call: the selected diagnostic records zero ELK time on tree50, with 57.25 ms total versus 87.25 ms off. These instrumented totals are not the selection score.

Sequence and class spend about 45% and 43% respectively in Scene lowering/admission plus paint certification. Final-byte SVG security adds roughly 17% and 14%; it remains authoritative. The actual SVG backend is below 1% in every measured workload. The typed writer is already in baseline PR #435, so another serializer rewrite has little measured headroom here.

Other layout includes parsing, graph routing, repair and certification. Other outside layout includes unclocked color/font/style/accessibility projections, byte budgets, public wrappers and observer overhead; it is not all assigned to one function. C4’s request resolution alone is about 35% on this small fixture. Saved CPU profiles can refine those coarse categories.

The cache-on repeat diagnostic is a separate scenario: it changes cache policy and flags together. Its layout time cannot be used as an isolated position-cache before/after estimate. Stage clocks/profile overhead, host variation and different aggregation explain why these totals must not be substituted for uninstrumented render timings.

## Community totals on shared workloads

Selected text/forest profile, Node 24.19.0, layout cache off; each engine uses its own public adapter. Three fresh-process rounds. Milliseconds below are across-round medians. These are total render calls, not instrumented internal phase costs. Returned labels are checked, but equivalent geometry/meaning across all engines is not established. Merman-async is also measured in the full scorecard.

| Workload | AM | Beautiful | Zombie | Pele | Merman sync | Mermaid Rust/WASM |
|---|---:|---:|---:|---:|---:|---:|
| flow5 | 19.141 | 9.754 | 7.565 | 0.179 | 2.171 | 62.911 |
| tree50 | 36.000 | 35.620 | 31.424 | 0.955 | 5.781 | 814.549 |
| mesh50 | 447.013 | 77.923 | 60.314 | 2.443 | 13.634 | 1811.442 |
| seq20 | 16.875 | 0.136 | 0.350 | 0.120 | 2.349 | 8.966 |
| c4 | 9.345 | unsupported | 0.137 | 0.033 | 1.345 | 0.133 |
| class80 | 122.757 | 25.440 | 37.318 | 1.729 | 20.331 | 152.319 |
| er40 | 85.333 | 21.060 | 22.472 | 1.380 | 23.275 | 91.317 |
| state80 | 183.130 | 112.061 | 53.989 | 2.023 | 12.622 | 250.381 |

The mesh example produces 78.3 KiB of AM SVG versus 34.2 KiB from Pele, with V8 allocation estimates 204.5 MiB versus 1.7 MiB per call. The output-size difference alone does not identify the cause of that much larger intermediate allocation; pipeline attribution and allocation profiles are separate evidence.

Merman native and Rust/WASM allocation estimates omit native/linear memory. RSS is a different whole-worker observation after the final workload. Beautiful terminal mesh50 loses 20 labels in all rounds; unsupported C4 and lost-label cells receive no successful timing ratio. Dart and official Mermaid require the separate browser comparison below.

## Packed-release confirmation

All 557 inputs (537 eligible distinct official examples, 19 scaling cases and one edit workflow) completed three rounds. All 20 scaling/workflow cases succeeded. Stable valid SVG matches were 345 of 537 corpus inputs on both sides; acceptance did not increase and no SVG or terminal outputs were lost. Raw reports preserve unsupported and rejected inputs. SVG and ASCII were deterministic and expected enrolled labels survived.

The corpus uses same-rep sums over the 345 matched inputs, then a median within each process and a median of paired round ratios. The paired corpus ratios are 1.113, 0.746, 0.958; median 0.958. Separately summing per-input medians gives different totals; those must not be divided to replace the paired score.

| Matched memory diagnostic | Baseline | Selected candidate | Candidate/baseline |
|---|---:|---:|---:|
| Allocated during one warmed pass | 1353.48 MiB | 1299.77 MiB | 0.960 |
| GC-boundary peak JS heap during pass | 136.06 MiB | 138.84 MiB | 1.020 |
| Settled retained growth after pass | 3.66 MiB | 3.56 MiB | 0.974 |
| Whole-worker peak RSS | 301.89 MiB | 304.37 MiB | 1.008 |

These memory observations use one separate fresh worker per engine/group, restricted to the matched population; the three rounds replicate timing, not these memory checkpoints. Whole-pass allocation fell about 4.0%; separately GC-probed per-input totals fell about 4.5%, and are a different experiment. Heap peak and RSS did not fall. Retained growth after one pass is not a proof about long-running leaks.

| Scaling case | Paired latency ratios | Median ratio | One-pass allocation ratio |
|---|---|---:|---:|
| flowchart:tree-300 | 0.240, 0.266, 0.222 | 0.240 | 0.372 |
| flowchart:mesh-120-labelled-40 | 1.068, 0.906, 0.803 | 0.906 | 0.987 |
| flowchart:subgraphs-12x8 | 1.312, 1.193, 0.965 | 1.193 | 0.977 |
| sequence:20-participants-300-messages | 0.859, 0.818, 1.032 | 0.859 | 1.016 |
| class:80-classes | 0.622, 1.288, 0.900 | 0.900 | 0.966 |
| state:80-states | 0.934, 0.746, 0.967 | 0.934 | 0.982 |
| er:40-entities | 0.656, 0.936, 0.898 | 0.898 | 0.918 |
| gantt:150-tasks | 1.057, 1.327, 1.096 | 1.096 | 0.965 |
| architecture:40-services | 2.008, 1.082, 1.022 | 1.082 | 0.981 |
| xychart:12-series-80-points | 0.698, 0.730, 0.550 | 0.698 | 0.717 |
| agent:edit-flowchart | 0.704, 1.020, 0.848 | 0.848 | 0.944 |

The 300-node forest is the strongest scaling result: all three timing pairs improve, with about 63% less one-pass estimated JS allocation. Nested subgraphs use the ELK fallback and were slower in two of three pairs. Passing readiness thresholds does not make every family faster.

## Full Dave-style browser corpus

All 1,095 occurrences (546 trim-distinct sources) were attempted by each of five engines in all three rounds: 16,425 timed attempts, plus the adapted 30-attempt warm-up per engine/round. The full inventory remains in the normal local suite through PR #434. This reproduces the pinned official-fence corpus and documented local policy, not an unpublished implementation of Dave’s tweet. Timings cover public call through SVG return, excluding DOM paint, inspection and cleanup. Browser 154.0.8037.57.

| Comparator | Returned SVG / 1,095 in every round | Shared successful occurrences with candidate | Candidate/comparator round ratios | Median ratio |
|---|---:|---:|---|---:|
| baseline | 710 | 710 | 0.924, 0.889, 0.840 | 0.889 |
| pele | 1063 | 710 | 18.333, 29.235, 33.306 | 29.235 |
| mermaid | 1061 | 708 | 0.188, 0.242, 0.205 | 0.205 |
| dart | 897 | 668 | 8.314, 9.727, 8.979 | 8.979 |

The candidate and baseline each returned 710 SVGs in every round. Matched baseline/candidate latency is lower in all three browser rounds (median 0.889), while Node/Bun matrix A/A and release variability still qualify a universal speed claim. Against Dart, AM takes about 8.98 times the time on 668 shared successful occurrences. Each comparator has its own intersection; these ratios are not one common-population leaderboard. Fast rejection is excluded, and accepted SVG is not equivalent semantic or visual quality.

All 44 eligible forest occurrences (22 distinct sources) selected indexed-forest in the separate native positioning census and returned SVG in all three candidate and baseline browser rounds. That is 4% of the full corpus; eligibility is not a prediction of a large benefit on every eligible input. Geometry/fidelity and hard-contract checks remain separate.


On the common-to-all subset, every engine renders the same 666 occurrences. This additional derived table permits a uniform population comparison; it still checks returned SVG rather than equivalent diagram quality. Ratios are engine/selected-AM, below 1 means the comparator is faster.

| Engine | Total ms by round, same 666 occurrences | Median engine/AM ratio |
|---|---|---:|
| candidate | 7735.4, 6818.6, 7031.7 | 1.000 |
| baseline | 8377.5, 7679.3, 8321.4 | 1.126 |
| pele | 420.3, 230.0, 213.6 | 0.034 |
| mermaid | 41132.1, 27736.2, 33724.2 | 4.796 |
| dart | 932.0, 701.5, 784.5 | 0.112 |

### Browser JS memory

The memory population is 333 exact-source-distinct inputs from 666 occurrences successful in every engine and timed round. Each of 15 fresh Chromium processes makes 333 unsampled warm calls and 666 sampled calls (discard+retain). Checkpoints use forced GC; allocation uses 4,096-byte CDP sampling. Values below are medians of each process’s checkpoint-minus-blank delta. Sampled allocation includes renderer, observer and UTF-8 consumer JS work and is divided by sampledRenderCalls, never 999 total calls.

| Engine | Loaded delta MiB | Warmed delta MiB | Retaining delta MiB | Released delta MiB | Sampled KiB/call |
|---|---:|---:|---:|---:|---:|
| baseline | 2.67 | 23.78 | 25.73 | 25.71 | 2226.3 |
| candidate | 2.69 | 24.34 | 26.33 | 26.31 | 2143.8 |
| pele | 0.95 | 5.49 | 7.53 | 6.32 | 64.8 |
| mermaid | 2.64 | 28.36 | 30.79 | 30.77 | 7530.0 |
| dart | 3.33 | 9.25 | 10.94 | 9.82 | 253.8 |

Dart is lower after warming and in sampled JS allocation; its initial loaded JS heap delta is higher than AM’s. Candidate allocation is about 3.7% lower than baseline, with about 0.60 MiB more released heap delta. These are not exact peaks, native/WASM memory, process RSS or painted-DOM memory. The recorded retainedOutputs count is the retaining-stage count, not post-release reachability: the collector clears that array. AM backing storage returns to its discarded-stage value after release, while used heap remains higher. One staged pass does not establish a leak or its absence.


Separate CDP backing-storage scope (ArrayBuffer/external-string storage), released-minus-blank medians; do not add these values to usedSize as a total-memory claim:

| Engine | Released backing storage delta MiB |
|---|---:|
| baseline | 3.353 |
| candidate | 3.372 |
| pele | 0.675 |
| mermaid | 5.260 |
| dart | 2.221 |

### Delivered JavaScript

Gzip level 9 on actual shipped/fetched bytes. Runtime flags retain every implementation, so all flag configurations share the candidate payload. Fonts, application HTML, hosting and the full Flutter app are outside this JS-wrapper comparison.

| Artifact/request set | Raw KiB | Gzip KiB |
|---|---:|---:|
| AM baseline complete IIFE | 3386.08 | 1052.67 |
| AM candidate complete IIFE | 3405.84 | 1059.33 |
| Pele complete IIFE | 666.02 | 246.88 |
| Official Mermaid complete IIFE | 5366.02 | 1534.15 |
| Pinned Dart SVG wrapper | 2210.24 | 799.78 |
| AM baseline focused SVG consumer | 2826.92 | 861.93 |
| AM baseline lazy initial (4 requests) | 12.32 | 4.87 |
| AM baseline lazy throughFirstFlow (27 requests) | 2175.49 | 673.75 |
| AM candidate focused SVG consumer | 2843.96 | 867.93 |
| AM candidate lazy initial (4 requests) | 12.32 | 4.86 |
| AM candidate lazy throughFirstFlow (27 requests) | 2191.14 | 679.66 |

Keeping all twelve experiments adds 6,819 gzip bytes to the complete IIFE, 6,144 bytes to the identically bundled focused SVG consumer, and 6,048 bytes to requests through the first flowchart. The lazy initial raw bytes are unchanged; a 1-byte gzip shift from changed chunk names is not a download optimization. Dart’s wrapper is smaller than AM’s complete/focused all-family bundles, while AM’s first-flowchart lazy request set is smaller than Dart’s all-family wrapper. The small initial loader is not a working renderer by itself.

Dart pin: mermaid-v0.3.1 at f53b343b8fa5c30859223d623acde2da2f175a00, SDK 3.13.5, dart2js -O2, ApproximateTextMeasurer/renderSceneToSvg wrapper. SHA-256 2cb2f0d74f5171717fdb3d8fc6579903c67c2656f9f5494f328c9581bea1975b. This is not a native Flutter memory or complete web-app download comparison.

## Practical priority of the implemented structures and algorithms

This order weighs changed-stage leverage, actual reach and observations. It is not twelve isolated causal estimates: **micro-all enables the combined set**, with layout caching disabled. Future full arenas, persistent parsing and general indexed DAG solvers remain different proposals.

| Priority | Experiment; changed complexity and reach | Observation and practical limit |
|---:|---|---|
| **1** | **text-spans:** bounded immutable preparation reuse; O(N) eligible ASCII prefixes make width queries O(1). Text across graphical families, terminal and editing. | Churn 0.215 Node/0.329 Bun supports real prefix work beyond repeat-cache hits; complete keys remain O(N), estimated caches total 12 MiB. Unicode/custom/styled/tracked/monospace shaping retains the general path. Public TF gains cannot all be assigned to text. |
| **2** | **indexed-layout:** O(V+E) variable-size rectangular forest production inside existing certification. | Tree50/tree300 improve repeatedly; eligibility is only 44/1095 corpus occurrences and one peer SVG case. Labels, groups, cycles, multiple parents/nonrectangles/long edges/state visuals fall back. ELK remains shipped; this is not a general DAG solver. |
| **3** | **graph-index:** O(V+E) shared lookup/adjacency plus thresholded O(S log S) bounds index; routes in flowchart/state/C4, maps 5/8 peers and static BVHs 3/8. | Mesh is 92% layout; all-profile mesh render 0.496 is unisolated. Overlap and O(K log K) candidate-order restoration can remove benefit; mutable edge proofs keep live scans. Only some AM route passes change, not ELK. |
| **4, conditional** | **position-cache:** private positioned snapshots avoid layout/repairs on exact hits; hits remain O(source+artifact) for keys/clones/evidence/final recertification. | Repeat mesh 0.177 versus broad SVG 1.149 shows workload dependence. TF-only cache-on SVG ratio 0.979 is unresolved against A/A 1.038; the separate arm does not isolate this flag’s marginal effect. Global estimated 16 MiB/128 entries; Gantt/custom metrics/external/uncloneable C4 paths bypass. Changed appearance can miss; no cache-off micro benefit is possible. |
| **5** | **svg-passes:** safe lexical-range rebasing and disjoint style assembly reduce some O(L) scans/copies across graphical output. | Combined style scoping 0.850 but security 1.183. Token storage/searches have cost; baseline already forward-assembles normal attribute edits. Direct pass micros usually lack the active render-local cache, and final security still runs. This is not complete projection fusion. |
| **6** | **gantt-intervals:** O(B log B) interval preparation/query replaces candidate×bar scans; weekly calendars jump whole weeks then walk an exact tail. | Long-calendar micro 0.009 is a large narrow result, not general Gantt uplift. Explicit date/all-excluded fallbacks and the 10,000-step budget remain. Standard 150-tasks activates neither branch; weekly dependency stress combines routing/calendar and lacks isolated routing attribution. |
| **7** | **paint-bvh:** exactly sized numeric BVH, expected O(S log S) build versus recursive sorting O(S log² S); native graphical paint. | Combined retained-Scene certification 0.462 sequence/0.611 class also includes scene-arena reuse. Baseline already has a BVH; worst-case fallback, overlap and proof budgets remain. Fresh public Scenes do not receive every repeated-Scene micro benefit. |
| **8** | **terminal-tiles:** adaptive 32-cell dense rows reduce some Map/locality/allocation cost; expected O(1) lookup before and after. | Combined ASCII 0.841/0.900/0.957 includes text reuse, not isolated tile effects. Four terminal peers, zero Dave SVG reach. Sparse fallback/history/conversion remain; complete cells/owners are not packed numeric arenas. |
| **9** | **sankey-csr:** O(V+E) preliminary layer adjacency replaces sum-of-degree-squares copies. | Core 120-link totals 1.127 Node/0.985 Bun do not establish consistent gain. No dedicated final micro; high-degree ceiling unmeasured. Sankey only; d3 relaxation/ribbon stacking is unchanged and tiny charts can pay extra allocation. |
| **10** | **scene-arena, current variant:** share owner/ancestor records, retain admitted internal inspection, memoize exact-recount key widths. | Combined fresh admission regresses 1.455 sequence/2.264 class while retained certification improves; attribution is unisolated. Baseline already has path-stack/upper-bound accounting. A future compact Scene/text IR remains important at ~45%/~43% Scene-plus-proof shares, but current interning is not that arena. |
| **11** | **persistent-mutations, current variant:** safe flowchart draft Map overlays/touched-record cloning avoid some eager graph clones. | Combined edit-loop 1.357 provides no promotion case; not an isolated draft penalty. Full serialization/reparse/add-edge copy keep edits linear; other operations fall back. No incremental parser/source map, affected-closure validation or transaction batching. |
| **12** | **incremental-order:** heap Kahn emission O(E+V log V), indexed ranks shortcut forward cycle checks; graph ordering and C4 classification. | Combined 1024-node forward 2.294/reverse 6.931 supports caution. Other flags also touch conversion, but known complete-rank copying on backwards insertions introduces O(V²) reverse-chain work. Adapt that mechanism before promotion; favorable forward 128 alone is insufficient. |

A terminal-centered product would raise tiles; a verified exact-repeat editor could raise position reuse. Source breadth alone does not establish branch use or improvement. A full compact Scene/projection architecture can rank highly as future work without treating this limited variant as successful.

## Lessons from Mermaid Dart's source, issues, PRs and forks

The measured Dart engine is the pinned dart2js SVG wrapper, not native Flutter or the pub.dev archive. Coverage/layout/text/output contracts differ; the timing gap does not isolate a language advantage.

- **Use indexed working data with an exact fallback.** Dart's [indexed Dagre](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/vendor/dagre/src/indexed_layout.dart) and [indexed network simplex](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/vendor/dagre/src/rank/network_simplex_indexed.dart) use numeric/array state while retaining reference choices and fallbacks. AM's forest and insertion-order prototypes are narrower different algorithms.
- **Make paint-only reuse an explicit contract.** [Issues 16](https://github.com/orestesgaolin/mermaid/issues/16) and [17](https://github.com/orestesgaolin/mermaid/issues/17), plus [flow_restyle.dart](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/diagrams/flowchart/flow_restyle.dart), separate allowed paint overrides from text/topology/theme/layout changes. AM's complete appearance/options cache serves exact repeats; it is not arbitrary cross-theme geometry reuse.
- **Bound storage and keep measured text equal to painted text.** The pinned [SVG writer](https://github.com/orestesgaolin/mermaid/blob/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/render/svg_renderer.dart) keeps a spare buffer only up to 1 MiB and caps escaped attributes at 64 entries, not 64 bytes. [Issue 81](https://github.com/orestesgaolin/mermaid/issues/81)/[PR 80](https://github.com/orestesgaolin/mermaid/pull/80) exposed normal-weight measurement versus bold state paint; its manually rebased [e50489c fix](https://github.com/orestesgaolin/mermaid/commit/e50489c6036ecd98a4f7c22988398744f85c2baf) is after the measured f53 pin. Closed-without-merge metadata does not prove an absent fix.
- **Test combinations and packed consumers.** Archived open reports [HTML breaks 79](https://github.com/orestesgaolin/mermaid/issues/79) and [group overlap 82](https://github.com/orestesgaolin/mermaid/issues/82) motivate semantic/geometry fixtures; they are not reproduced AM defects. [Configuration 44](https://github.com/orestesgaolin/mermaid/issues/44), [UP ports PR 7](https://github.com/orestesgaolin/mermaid/pull/7), [port clearance 76](https://github.com/orestesgaolin/mermaid/issues/76) and [dependency PR 6](https://github.com/orestesgaolin/mermaid/pull/6) argue for direction/port/configuration combinations and clean package-consumer checks.

The archived 19 October inventory covered 76 issues, six PRs, three public forks and their returned branches against later e50489c. [yringler](https://github.com/yringler/mermaid-flutter) supplied state paint; [parlough](https://github.com/parlough/mermaid) supplied merged dependency/UP-port fixes; [definev](https://github.com/definev/mermaid) had no ahead commits on its returned branch. No additional unlanded performance/memory implementation was identified in that bounded snapshot. Private/deleted/later forks were not covered. Historical d511 AM measurements in the archived fork report are not relabeled as this candidate.

## Reproduction and evidence handling

Use Bun 1.4.0 for orchestration/Bun workers, Node 24.19.0 for Node workers and Chromium 154 for browser rendering for the closest reproduction. Build both pinned checkouts and pack their shipped bytes as recorded in the preserved execution driver/study manifest. Set AM_BASE_PACKAGE to a clean installation of the **31878241** baseline tarball. Set AM_CAND_TGZ/AM_CAND_SHA, AM_BASE_TGZ/AM_BASE_SHA and the AM_DART_* variables to verified artifact paths/hashes from the study manifest. Set Node/Bun flags **before import**; browser --features injects configuration before library load. No default API option enables these experiments.

```sh
AM_BASE_REF=3187824137a049e326745e9a2d964bb793fb27b2
AM_FLAGS=text-spans,indexed-layout
AM_OUT=bench-report/experiments/reproduction
AM_STUDY=/path/to/extracted/final-study
# Isolated candidate checkout at 07ab2f3f; normal local suite, including Dave:
env AGENTIC_MERMAID_EXPERIMENTS= bun run bench --executable /usr/bin/chromium
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" AGENTIC_MERMAID_ELK_CACHE=0 bun run bench:samples
bun run bench:dave --features "$AM_FLAGS" --rounds 3 --executable /usr/bin/chromium --out "$AM_OUT/dave"
# Screening and final confirmation; saved configs preserve A/A/off/profile arms:
bun run bench:experiments --baseline-ref "$AM_BASE_REF" --phase singles --rounds 3 --runtime node --cache off --out "$AM_OUT/singles"
bun run bench:experiments --baseline-ref "$AM_BASE_REF" --phase ablation --rounds 3 --runtime node --cache off --out "$AM_OUT/ablation"
bun run bench:experiments --baseline-ref "$AM_BASE_REF" --configs "$AM_STUDY/holdout-configs.json" --paired 1 --runtime node --rounds 3 --samples 12 --warmup 5 --warmup-ms 1000 --broad 1 --png 1 --gc natural --cache off --out "$AM_OUT/holdout-node"
# Repeat for --runtime bun; repeat-configs.json uses --cache on.
# TF-only normal-cache control: selected-cache-configs.json with --cache on.
# Separate checkpoint memory: --gc checkpoint --allocation 1, not selection timing.
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:micro --baseline "$AM_BASE_REF" --runtime node --rounds 3 --json "$AM_OUT/micro-node.json"
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:micro --baseline "$AM_BASE_REF" --runtime bun --rounds 3 --json "$AM_OUT/micro-bun.json"
# Reproduce micro-all with the twelve names from the study manifest.
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:peers --peers agentic,beautiful,zombie,pele,merman,merman-async,mermaid-rs,termaid --rounds 3 --json "$AM_OUT/peers.json"
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:release --baseline "$AM_BASE_PACKAGE" --candidate-tarball "$AM_CAND_TGZ" --candidate-sha256 "$AM_CAND_SHA" --rounds 3 --reps 5 --out "$AM_OUT/release"
bun run bench:release:browser --candidate-tarball "$AM_CAND_TGZ" --candidate-sha256 "$AM_CAND_SHA" --baseline-tarball "$AM_BASE_TGZ" --baseline-sha256 "$AM_BASE_SHA" --features "$AM_FLAGS" --dart-bundle "$AM_DART_BUNDLE" --dart-sha256 "$AM_DART_SHA" --dart-revision "$AM_DART_REV" --rounds 3 --warmup 30 --memory-passes 1 --executable /usr/bin/chromium --out "$AM_OUT/browser"
env AGENTIC_MERMAID_EXPERIMENTS= bun run bench:pipeline --cache off --rounds 3 --reps 5 --out "$AM_OUT/pipeline-off"
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS" bun run bench:pipeline --cache off --rounds 3 --reps 5 --out "$AM_OUT/pipeline-selected"
env AGENTIC_MERMAID_EXPERIMENTS="$AM_FLAGS,position-cache" bun run bench:pipeline --cache on --rounds 3 --reps 5 --out "$AM_OUT/pipeline-repeat"
```

Generated JSON, samples, CPU/allocation profiles, screenshots and plots remain uncommitted under bench-report. The preserved execution driver has the exact warm-up/sample settings, configs, artifacts, hashes, cache policy and process ordering; abbreviated commands above identify every benchmark type. A runtime flag cannot remove already bundled code. Measured source is 07ab. Historical report-only package verification preceded the runtime-changing rebases onto 1b and c517; it does not establish identity with the current candidate. The current study has separate artifacts, measurements and reviews.

## Validation and final review

Owning-boundary tests and initial independent combined-path audits cover the implemented paths. They corrected typography-key aliases, packed-BVH over-allocation, source-offset truncation, benchmark baseline/failure accounting, retained-output contamination, inherited inline-label group opacity and callback-bearing C4 retention. External admission, final geometry/paint certification, wide-grapheme ownership and final SVG security remain authoritative.

The historical study's implementation audits and 07ab CI apply to their recorded source. The rebased combined candidate requires its own source/boundary and measurement-claim reviews, required CI and shipped-byte comparison; see the 20 October report and current PR.

The historical forest witness changed spacing while preserving authored identities, labels and endpoints; passing geometry contracts is not a universal aesthetics ranking. It is separate from the rebased candidate's witness. The **Visual evidence** section of [PR #436](https://github.com/adewale/agentic-mermaid/pull/436) identifies the current base/head, selected-profile receipt and CI artifact.

These flags are constrained prototypes, not all twelve full original ambitious designs. Keep the conditional profile, adverse results, memory/payload tradeoffs and fallback coverage visible when deciding whether to promote any one of them.
