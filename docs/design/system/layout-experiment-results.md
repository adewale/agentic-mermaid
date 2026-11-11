# Follow-up layout experiments

The follow-up improves native ER label placement and removes repeated work from
route processing. It does **not** establish that the owned engine matches or
beats ELK on every quality, cost or usability dimension. ELK remains the default.

The reference is the frozen `e9db0dbe` renderer, `agentic-layered@22`, documented
in [layout qualification](layout-qualification.md). The accepted candidate is
`agentic-layered@23`. Saved quality snapshots were captured before the identifier
bump with the same candidate algorithm; their metadata is retained rather than
rewritten to claim a later build. Final source/generated and edit replays,
browser checks and the bounded five-input cost campaign are complete.

## What was tried and what was accepted

| Experiment | Decision and evidence | Limits |
| --- | --- | --- |
| Preserve native ER label reservations and resolve final labels against foreign shafts | Accepted quality change: ER40 label/route conflicts fall **16→0**. Across the 246 source occurrences, crossings, shared spans, bends, route length, area and paint-certificate outcomes remain unchanged. | Label positions change on 15 ER source occurrences. This is a native-owned placement policy, not a universal paint-clearance proof. |
| Give ER final label positions one owner | Native layout resolves labels once after route/frame/title transforms using the actual style/style-face. Drawing and positioned projection consume the same retained centers. Provisional producer reservations are revalidated before resolution and discarded when route replacement invalidates them. | Consume the complete positioned artifact from the corresponding request; edits or a different styling request require relayout. This avoids recomputing a default-style answer that disagrees with paint. |
| Specialize repeated two-route crossing queries | Node/IIFE route repair uses an exact pair query, avoiding general sweep setup and the former separate broad-phase/counting traversal. The general counter remains the independent reference and public multi-route metric. Final cyclic18 off-cache allocation is 0.8689× the prior native implementation. | A scoped allocation improvement, with a noisy third control round; allocation remains 1.3068× ELK. This does not justify replacing all sweeps or claiming an overall speed win. |
| Keep a compact reference path in the lazy browser build | A build-only pair-query twin retains conservative rejection followed by the general crossing sweep. Node/IIFE retain the specialized representation. Browser parity and request checks pass under unchanged size caps. | A deliberate delivery/runtime tradeoff. A Node optimization does not imply identical browser savings, and deliberate payload headroom has not been achieved. |
| Replace Architecture's repeated splice/restart simplifier with a stack reduction | Accepted algorithmic subtraction: each point is pushed once and popped at most once, yielding **O(n)** reduction rather than repeated rescanning/splicing. It preserves the original neighboring-input deduplication and collinearity behavior, including retained equal endpoints after U-turn reduction. | Exact output matters more than a cleaner-looking route. This does not fix Architecture's remaining crossing regressions. No independent wall-time saving is asserted. |
| Reject impossible own-label capacity before foreign lane scans | **Rejected.** Diagnostic counts find 160 early rejections in 54,327 probes (about 0.2945%), with zero rejections on cyclic18. | The intended saving mechanism was absent on the target tail case. The guard was removed rather than retained as speculative complexity. These are counts, not timing results. |

The ER policy follows the actual successful native producer. Default ELK and
requested-native/actual-ELK fallback retain their previous label search. Selecting
the policy by the requested backend would incorrectly change fallback behavior;
selecting it by anchor presence would miss repaired native routes whose anchors
were correctly discarded.

Foreign-shaft avoidance uses the visible rounded path projection, stroke width
and conservative placement boxes, excluding only the label's owning shaft. It
remains a readability heuristic: depth-limited flattening is not an unconditional
half-pixel proof for arbitrary geometry, and a no-slot case retains the existing
visible-conflict fallback. Required labels, relationships, cardinalities, endpoint
identities and the existing 400,000-operation failure remain intact. Final paint
certification is unchanged and may still return `unverified`.

## Retained quality results

The retained [quality summary](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-experiment-results.json)
records source and generated before/after populations, per-case differences,
failures and certificate outcomes.

| Population | Result against runtime22 |
| --- | --- |
| Native source/workload occurrences | 246/246 render before and after; 231 SVGs identical, 15 ER SVGs changed; no lost renders. Source label conflicts 16→0, entirely from ER40. All other retained metric totals and paint outcomes unchanged. |
| Default ELK source/workload occurrences | 246/246 render; **all 246 SVGs identical**; metrics and paint outcomes unchanged. |
| Existing generated native cases | All **640** render before and after, and all 640 SVGs are identical. Crossings, labels, spans, bends, length, area and paint outcomes remain unchanged. |
| Fresh SHA-256 counter cases 256–319 | Native renders 64/64; ELK renders 63/64. ELK's retained failure on counter266 is a paint-certification rejection and remains enrolled. Comparisons below use the 63 shared successes. |

For the 63 fresh shared successes, ELK→native totals are:

| Dimension | ELK | Native | Individual native regressions |
| --- | ---: | ---: | --- |
| Crossings | 2,000 | 562 | 0; native improves 62 cases. |
| Label/route conflicts | 105 | 0 | 0; native improves 45 cases. |
| Parallel shared spans | 25 | 0 | 0; native improves 20 cases. |
| Opposing shared spans | 24 | 0 | 0; native improves 16 cases. |
| Bends | 4,586 | 4,490 | **23** cases have more bends, despite the lower total. |
| Route length | 1,242,211 | 882,757 | **3** cases have longer routes. |
| Area | 89,551,001 | 74,767,766 | **16** cases have more area. |
| Paint uncertainty issues | 709 | 687 | Native has more issues in **7** cases; all 63 certificates remain unverified in both arms. |

Fresh cases support the existing crossing/label/shared-span result while exposing
the same tradeoffs. They are not evidence that this follow-up improved those
Flowcharts: the accepted runtime22→23 geometry change is scoped to ER labels.
Admission, shared-success geometry and proof certainty are separate comparisons.

The final replay passes **1,196 observations**: 246 native source, 246 ELK source,
640 existing generated native and 64 fresh native. The final artifacts match the
accepted-candidate captures for SVG, full receipt and certificate after
normalizing only the expected `agentic-layered@22`→`@23` implementation
identifier. The ER differences against the original runtime22 reference remain
recorded above.

An additional **64-case fresh ELK replay** retains 63 successes with exact SVG,
full receipt and certificate equality. Counter266 retains the same
`PAINT_LAYOUT_CERTIFICATION_FAILED` code and the same saved, truncated
300-character message. The original failure did not retain a full certificate,
so full-certificate equality is established for the 63 successes only.

## Final edit replay

The saved edit reference's actual implementation identifier is
**`agentic-layered@21`**, while the final artifact is `@23`. This is a saved
**21→23 replay**, not a pure runtime22 ablation. Across both cache policies the
replay covers **234 rows**, 117 per policy: each has 116 successful renders and
the same one strict-native active-hint decline. Admission and actual backend
selection are unchanged; all **36/36 undo checks** pass.

All measured transition objects remain unchanged. Native/ELK unaffected-node
motion therefore remains **13 better / 14 equal / 4 worse** across 31 comparable
transitions. Eight SVG changes are expected: ER `introduce-cycle` and
`change-direction`, each in native and native-with-fallback arms under both
cache policies. After normalizing the receipt implementation identifier from
`@21` to `@23`, the remaining receipt differences are confined to those eight
ER output/projection digests. Full certificates are unchanged except for the
corresponding ER output digest. These results preserve the measured stability
behavior; they do not establish universal mental-map preservation.

## Profiling and cost evidence

Repeated diagnostic profiles identified a narrower target than “cycle search is
expensive.” On cyclic18, the general crossing counter accounts for about
39.3%/39.2% of sampled allocation in the two observations; the route-repair pair
query path contributes about 25.0% in each. Lane-blocker scans consume CPU but
less than 0.5% of sampled allocation. These are sampled attribution observations,
not exact allocation accounting or end-to-end speed ratios. They motivate the
pair specialization and explain why the lane guard was tested separately.

An **initial crossing prototype** showed roughly **12% lower cyclic18
allocation** against its native baseline. That prototype is not the final
runtime23 candidate, and its timing A/A control was unhealthy. Retain it as
discovery evidence; do not transfer that allocation percentage or a timing claim
to the final implementation.

The final `layout-final-cost@1` campaign completes **48 workers**, with **zero
worker failures and zero input failures**, in **279.79 seconds** against its
600-second budget. It uses three rounds, 15 timing repetitions, five fixed inputs
(cyclic15, cyclic18, ER40, Flowchart5 and Sequence20), off/normal startup cache
policies, and separate time/memory workers. Memory uses one post-warmup render per
input plus one five-input pass; 15 timing repetitions do not multiply memory
samples. The existing release worker consumes full SVG UTF-8 and receipt JSON
inside API timing and computes SHA-256 fingerprints outside timing. Instrumented
profiling did not run concurrently with this campaign.

The runtime is Node **24.19.0**, V8 **13.6.233.17-node.51**, Linux x64. Artifact
manifests remain unchanged across the campaign. The reference manifest SHA-256 is
`b0a4c597d9c83420f04b9c81a9e6a536c661161cd1b9f8815fb791d83a3dd46a`;
the runtime23 candidate manifest is
`af52a04e80042f8651aaa8d8bb17a365b9a6c409f2c07f97e86d0591a8280f76`.
The worker SHA-256 is
`c212cf4759b15cce2de0bfacb568fe8d6df983087a1dbb6e8e8e3ee1a16c110e`.
Only the expected **six ER40 SVG comparisons** differ from the native reference
(three rounds × two cache policies); all other candidate SVG comparisons and all
A/A SVG comparisons match. This cost record retains exact receipt differences,
including the intentional implementation identifier change.

Ratios below are medians of within-round ratios, with lower values favorable.
`Prior` means runtime22 native; `ELK` uses the frozen reference package. **Time
ratios are descriptive, not speed claims**: off-cache latency A/A fails the
reciprocal 1.1 control band in at least one round on three of five inputs; normal
cache fails on all five. A favorable median cannot erase an unhealthy round.

| Cache | Input | Time / prior | Time / ELK | Allocation / prior | Allocation / ELK |
| --- | --- | ---: | ---: | ---: | ---: |
| Off | cyclic15 | 1.0622 | 1.4322 | 0.9692 | 1.5812 |
| Off | cyclic18 | 1.0112 | 1.1144 | **0.8689** | 1.3068 |
| Off | ER40 | 1.0986 | 0.8384 | 1.0143 | 0.8503 |
| Off | Flowchart5 | 0.9966 | 0.5454 | 1.0044 | 0.6386 |
| Off | Sequence20 | 1.0686 | 0.9967 | 0.9991 | 1.0004 |
| Normal | cyclic15 | 0.9271 | 0.9438 | 0.9984 | 1.0041 |
| Normal | cyclic18 | 1.0012 | 0.9364 | 1.0002 | 0.9911 |
| Normal | ER40 | 0.8914 | 0.9351 | 0.9807 | 0.9905 |
| Normal | Flowchart5 | 0.9835 | 1.0498 | 0.9979 | 0.9949 |
| Normal | Sequence20 | 1.0195 | 1.0307 | 0.9997 | 0.9994 |

Cyclic18's off-cache allocation ratios are **0.8861, 0.8689, 0.7602**; the median
is a **13.1% reduction** from prior native. Allocation A/A is 1.001149, 0.999060,
1.180979: the first two rounds support a scoped improvement, while the third is
noisy. The result still allocates **30.7% more than ELK**. Cyclic15 has a favorable
0.9692 median but its second round allocates **34.7% more** than prior native;
there is no robust allocation improvement there. ER40's quality fix costs
**1.43% more off-cache allocation**; its 9.86% time increase is descriptive under
the latency-control caveat. Neither cost is hidden by the quality gain.

| Five-input pass memory | Off / prior | Normal / prior | Interpretation |
| --- | ---: | ---: | --- |
| Allocation | **1.0176** | 0.9860 | Off-cache total allocation worsens; corresponding native/ELK ratios are 1.1587 off and 0.9888 normal. The cyclic18 gain is not a pass-wide allocation win. |
| Peak heap | 0.9872 | 0.9802 | Small occupancy reductions; peak heap is distinct from allocation and retained growth. |
| Peak RSS | 0.9931 | 0.9971 | Approximately tied. RSS covers the worker lifetime, including import and warmup. |
| Retained growth | — | — | No retention win claimed. Normal-cache A/A median is 0.5225, with incomplete/zero-denominator observations; clamped nonnegative growth ratios are unstable. |

This campaign is a **bounded five-input experiment**, not the full 27-input
release qualification or an edit-workflow cost campaign. The prior full27 two
cyclic latency failures and other unmeasured tails remain open. Source replay and
the five-case cost run do not establish universal cost parity with ELK.

Core and repository type checks, build and lint pass. Final replay passes all
1,196 observations; browser checks pass 47 tests / 1,006 assertions and standalone
checks pass 2 tests / 20 assertions. The additional fresh ELK and saved edit
replays preserve their expected successes and declines as detailed above.

The baseline check passes in **10.03 seconds** using the repository-standard
30-second test timeout. Initial direct Bun invocations used its 5-second default
and timed out; those attempts are retained as harness evidence and do not
establish a renderer runtime defect.

The completed runtime22 qualification remains the broader cost reference. Its
uncached corpus/edit gains coexist with approximately tied normal-cache time,
two cyclic latency ceiling failures and six uncached cyclic allocation
regressions versus ELK. This narrower campaign does not close all those failures.

## Browser delivery

The lazy build already separates family and solver acquisition. This follow-up
keeps the compact reference crossing path there and strips shape-inspector
documentation prose from the lazy SVG graph while retaining shape aliases,
geometry and executable validation. Node/IIFE retain their public inspector
documentation. This is capability-specific subtraction, not removal of required
render checks.

Final compressed transfer sizes sum the acquired chunks:

| Closure | Gzip bytes | Brotli bytes | Requests |
| --- | ---: | ---: | ---: |
| Initial loader | 5,492 | 4,937 | 4 |
| Flowchart with native solver | 286,406 | 253,451 | 34 |
| Flowchart with ELK | 711,604 | 576,829 | 34 |
| Architecture with native solver | 283,799 | 250,592 | 34 |
| Architecture with ELK | 708,997 | 573,970 | 34 |

The browser suite passes **47 tests / 1,006 assertions**; the standalone suite
passes **2 tests / 20 assertions**, including the retained acquisition/parity
contracts. Caps remain unchanged. Architecture's ELK closure is only **30 Brotli
bytes** below its 574,000-byte cap. Standalone is **4,099,781 raw bytes** and
**1,229,764 gzip bytes** against caps of 4,100,000 and 1,260,000, leaving only
**219 raw bytes** of headroom. The final build passes, but it has not achieved a
deliberate maintenance reserve. These transfer and correctness checks establish
no browser latency or painting-performance claim.

## Have we matched or beaten ELK on every aspect?

**No.** The following separates the new result from outstanding qualification
limits rather than treating an aggregate win as universal parity.

| Aspect | Current assessment |
| --- | --- |
| Admission and semantics | Observed source admission matches; fresh native admission is better by one retained ELK paint failure. Unsupported hints, ancestor endpoints, ambiguous identities and bounded-search declines still require truthful handling. |
| Crossings | Native source total remains 533 vs ELK879, and fresh shared cases improve strongly. Architecture0/5 still each add a crossing. |
| Labels and shared spans | Source native label conflicts are now **0 vs ELK40**, closing ER40's known 16-conflict regression in this population. Native measured parallel/opposing spans remain 0/0 vs ELK18/9. This is not a universal all-input guarantee. |
| Bends, length and area | Aggregate length/area gains remain; source totals include 3,190 native vs 2,673 ELK bends. Existing per-case regressions remain: more bends in 25 source / 268 generated cases, longer routes in 20 source cases, more area in 34 source / 191 generated cases. The fresh holdout also has losses in all three dimensions. |
| Paint certainty | Source certificates remain native219 passed/27 unverified vs ELK217/29. All 634 previously shared generated certificates and all 63 fresh shared certificates remain unverified. Lower issue totals are not passed proofs. |
| Edit stability | The final saved21→23 replay preserves all 234 rows' admission/backend outcomes, every transition object and all 36 undo checks. Native/ELK motion remains 13 wins / 14 ties / 4 losses; fallback retains 20 order inversions vs ELK17. Eight ER SVG changes are expected. The separate five-input cost campaign does not measure edit-workflow cost or establish an incremental-layout guarantee. |
| Ports, symmetry and readability | Exact authored-port witnesses and selective internal measures are useful, but full preferred-port/symmetry evidence and human task evaluation remain incomplete. |
| Runtime and memory | Final five-input cost campaign completes. Cyclic18 allocation improves against prior native but remains 1.3068× ELK; cyclic15 remains 1.5812× ELK. Off-cache pass allocation worsens to 1.0176× prior native / 1.1587× ELK. Latency controls prevent a speed-win claim; full27 tail qualification remains open. |
| Browser payload and requests | Final Flowchart and Architecture native closures retain substantial transfer advantages over selected ELK; Flowchart uses 34 requests in both arms. Existing family-specific request tradeoffs remain, and the unchanged Architecture/standalone caps have only 30 Brotli / 219 raw bytes of headroom. No browser latency advantage is established. |

## Deployment scope after these experiments

Keep the owned engine **opt-in across its six supported families** while
retaining construct-specific eligibility and truthful ELK fallback. ER no longer
needs quarantine for the known ER40 label/route problem: the scoped fix clears
that measured blocker while preserving default ELK output. Other ER guarantees
still need their own evidence.

Restricting the engine to Flowchart alone would retain all measured cyclic
latency/allocation tails and discard useful results from other families; it does
not target the remaining cost mechanism. These results also do not justify
expanding grammar coverage or switching the default. Address the remaining
Architecture crossings, cyclic costs, uncertain paint proofs and edit behavior
with their own acceptance criteria before making broader deployment claims.

## Community and literature lessons carried forward

These changes apply the label-reservation lesson from
[label-aware orthogonal compaction](https://www.mdpi.com/1999-4893/9/2/22)
and the community's retained-label-lane failures: placement preferences must
survive valid translations and be revalidated after routing. The pair query
applies the profiling result by removing general-purpose bookkeeping at a
two-route callsite, while preserving the exact crossing predicate. Peer speed
rankings remain those of the separately pinned community experiment; this
follow-up does not rebenchmark or establish superiority over those renderers.

The [community comparison](layout-community-comparison.md) and
[Mermaid Community inventory](https://github.com/adewale/agentic-mermaid/blob/ee9c9dc32f9bc3b47de2f5990bc1466b55815649/docs/mermaid-community.json) distinguish shared
lineages, published claims and same-input measurements. Useful ideas include
Pele/Ondine's family boundaries and build-time compilation, Zombie's explicitly
narrow optional solver, and Merman's ownership of runtime lifecycle and request
snapshots. None of their small mount-runtime or incremental-solver byte claims
is directly comparable to a complete renderer closure.

The retained investigation provides the underlying proposals and cautions:

- [Literature and layout algorithms](layout-exploration/layout-literature.md): routing, ordering, label placement and scope-specific opportunities.
- [Community feedback](layout-exploration/community-feedback.md) and [primary evidence](layout-exploration/community-primary-evidence.json): fidelity expectations and concrete reported failures.
- [Scope and subtraction](layout-exploration/scope-subtraction.md): fewer passes, narrower guarantees and family eligibility counterfactuals.
- [Profiling strategy](layout-exploration/profiling-strategy.md), [profile review](layout-exploration/profile-review.md) and [profile results](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-exploration/profile-results.json): sampled observations, causal experiments, cache controls and A/A limits.
- [Stability and certification](layout-exploration/stability-certification.md): task-specific mental-map literature, exact predicate/construction distinctions, shared final geometry and retained proof scope.

These sources favor explicit constraints, authoritative geometry, measured
subtraction and task-specific evidence. Removing a redundant scan or rejecting
an ineffective guard advances that approach; removing labels, authored ports,
required certification or adverse cases would weaken the goal.

## Reproduction limits of the recorded cost experiment

The original `layout-change-ablation.py`, enrolled-input file and summarizer
were workspace artifacts and are not retained in this repository's Git history.
The former repository links and commands could not reproduce the campaign from
a clean checkout. The measured five-case population, declared 600-second bound,
driver identities and worker results remain in the accompanying evidence; this
record does not claim a current runnable reproduction.

For new measurements, use the pinned [Trident runner](../../../eval/trident/README.md)
and the current [local release benchmark procedure](../../contributing/releasing.md#local-release-benchmarks).
A new run has its own source/input identities and does not replace this campaign.
