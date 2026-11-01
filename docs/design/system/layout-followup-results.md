# PR 449: experiments after runtime 24

Runtime 26 removes the retained Architecture crossing regression using bounded
single-crossing cleanup scored against final family routes. Runtime 25's broader
refinement remains an intermediate experiment with an expensive partial
improvement. The cyclic search retains its existing candidate order and bounds; no later cyclic
prototype has earned inclusion. This report follows the
[runtime24 qualification](layout-guidance-results.md); its successful results,
failed release qualifications and adverse cyclic cases remain historical
evidence rather than measurements of a later renderer.

## Experiments and decisions

| Experiment | Declared test | Observation | Decision |
| --- | --- | --- | --- |
| Remove temporary crossing-ray arrays | Frozen native 24 baseline, independent A/A, candidate and ELK; all 27 historical inputs; three rounds, both cache policies; 480-second total deadline | Environment restart interrupted the run: 12 workers completed, one was interrupted and 35 were unlaunched. No complete three-round candidate comparison. | Unqualified; keep outside production. The interrupted attempt is retained. |
| Construct shifted cycle orders only when requested | Separate native-only baseline/A/A/candidate experiment; all 27 inputs per worker; three rounds and both policies; 480-second total deadline | All 18 uncached workers completed. None of the six required cyclic tails achieved the predeclared 3% allocation saving; whole-session allocation was 0.9980× baseline. State allocation was 1.0603×. Normal-cache qualification was incomplete. | Rejected; keep existing construction. |
| Refine Architecture sibling slots using final family routes | Equal measured sizes, same parent, authored constraints, eight attempted axis swaps; strict crossing improvement, obstacle/contact checks and shared-ink veto | Runtime 25 fixes 0/5 and improves 4's crossings 2→1, but case 4 allocation rises 85.5% versus 24. | Replace the broader refinement with complete single-crossing cleanup; preserve its measured adverse cost. |
| Stop at the first improvement | Same 13 inputs and exact output/receipt parity versus 25 | Source 4 allocation 0.8520336517× 25 misses the declared 0.85 target; whole 13 allocation 0.990489×. | Rejected; do not round a missed target into a pass. |
| Complete cleanup of exactly one crossing | Structural eligibility, same eight trials/size bounds and every acceptance predicate; all 13 inputs retained | Source 4 allocation 0.556823× 25; whole 13 allocation 0.954914× uncached/0.999712× cached. Final direct 26/24 whole 13 allocation 1.001647×/1.000278×, with healthy allocation controls. | Implemented as 26; allocation-flat versus 24 while retaining 0/5 repairs. Source 4 deliberately returns to its 24/ELK two-crossing tie. Broader quality and latency gaps remain. |
| Compress historical evidence | Lossless gzip of the existing generated benchmark JSON | 2,720,717 bytes become 291,518 bytes; decompression reproduces the historical evidence exactly. | Retain the evidence with a smaller repository diff. This does not change a shipped renderer bundle. |

The native-only cycle experiment is a separately declared counterfactual, not a
repair of the interrupted four-arm experiment. It measures no ELK arm and yields
no ELK ratio. Its timing workers consume complete SVG and receipts; memory mode
measures a warmed pass, individual GC boundaries and a complete 27-input pass.
The positive repetition field does not mean repeated memory passes.

| Required uncached cyclic input | Allocation candidate/baseline, median of three paired rounds | Time candidate/baseline | Time A/A |
| --- | ---: | ---: | ---: |
| labelled-11 | 1.0061× | 1.0481× | 1.0933× |
| labelled-15 | 0.9961× | 1.0746× | 1.1354× |
| labelled-19 | 0.9914× | 1.0532× | 1.1500× |
| labelled-9 | 0.9987× | 1.0528× | 1.1185× |
| labelled-13 | 0.9989× | 1.0146× | 1.0889× |
| labelled-18-cuts | 1.0003× | 1.0931× | 1.1074× |

The acceptance target was at least three tails at or below 0.97×, whole-pass
allocation no higher than baseline and no tail above 1.03×. Meeting the last two
conditions does not compensate for missing the first. Timing controls are also
unhealthy: 18/27 A/A medians and 50/81 individual rounds fall outside reciprocal
1.1. Candidate time exceeds 1.05× on 17/27 inputs; these adverse observations
remain recorded, but the drifting controls prevent a reliable causal claim.
A/A is never used as a ratio divisor.

All 81 uncached candidate comparisons and 81 A/A comparisons preserve SVG,
receipt, decision and certification fingerprints. There are no input failures.
This supports equivalence on the enrolled observations, not full quality or
edit qualification. Allocation A/A medians pass, with four adverse individual
rounds retained. Whole-session allocation, peak heap, worker RSS and settled
retention ratios are respectively 0.9980×, 1.0022×, 0.9819× and 0.9907× baseline.
These small observations do not establish an allocation improvement.

Only 20/36 planned workers succeed overall: the normal-cache policy has two
baseline observations, an A/A timing timeout and 15 unlaunched observations.
It has no candidate observation or valid paired ratio. No deadline increase,
population reduction or retry is used to turn this into a qualification pass.

## Further cyclic attribution on frozen runtime 26

The current owner guidance prioritizes repeated cyclic candidate/normalization
cost. A new diagnostic binds its measurements to the accepted runtime 26 source
`3258d80ce165457a1dd4695bb2bc12171f492006`, rather than treating older runtime 22
profiles as descriptions of the current implementation. Twelve serial CPU/heap
profile workers complete: cyclic-11, cyclic-15 and cyclic-18-cuts, two repeats of each profile type,
cache off, Node 24.19, scene assertions off and full SVG/receipt consumption.
These are diagnostic samples, not latency benchmarks or full proof comparisons.
The worker does not retain a full receipt fingerprint; its zero SVG drift alone
cannot establish receipt equality.

The older general-crossing allocation hotspot has changed after the accepted
two-route specialization. On cyclic-18, the general counter accounts for about
10.7% of self-allocation samples, local ray construction about 5%, and the exact
two-route counter 1.42–1.53%. An initial static proposal misattributed the core's
4.4% self allocation to the pair counter; that premise is corrected here, without
changing the already declared experimental targets. Pair-query inclusive samples
(about 11.1%) overlap the functions below them. Cyclic15 still samples substantial core layout work
(9.8–12.1% self CPU and 7.8–8.5% self allocation). Generator `next` frames are
not all normalization: ancestry distinguishes core iteration from other
generators. Percentages motivate mechanisms; they cannot be added to predict
obtainable savings. The original raw profiles and completion observer remain
part of the evidence, including the transient tool-environment interruption
that did not stop the workers.

Separate untimed source instrumentation tests two concrete subtractions on the
existing 40-input population. All 1207 checks pass, all 40 outcomes agree with the
uninstrumented control (38 successes and the same two declines), and 19 public
render observations agree exactly with the frozen 26 SVG and full proof.
Across 174 normalizations, exact ranking succeeds 160 times and declines 14.
The successful cases overwrite 257 preceding greedy sweeps: 6748 node visits
and 27496 edge visits. Those declining paths still need the original fallback
and its existing guards/budgets. Strict improvements also create 245 new best-order
snapshots, copying 3542 band arrays and 28310 vertex entries. Reusing detached
snapshot arrays would remove allocation while retaining the copying work.
Object/visit counts are not allocated-byte estimates or evidence of a speedup.

These observations motivate isolated rank-first, band-snapshot and ray-view
pilots. Each freezes all 27 historical inputs, baseline/A/A/candidate artifacts,
three rounds, both cache policies and a 480-second **total** deadline. They retain
all samples, proof fingerprints, adverse controls, timeouts and unlaunched slots;
their decisions must follow the prospective targets, not these operation counts.
A fourth combined crossing experiment has its own allocation-only declaration,
made before inspecting ray timing data. It must be measured directly; multiplying
the isolated pilots' medians would not measure their combination.

| New isolated pilot | Successful workers /36 | Required uncached tails meeting primary target /6 | Whole 27 uncached allocation /26 | Decision |
| --- | ---: | ---: | ---: | --- |
| Exact ranks before overwritten greedy sweeps | 18 | 0 | 1.001150× | Reject this implementation: time target missed; cyclic19/9/13 allocation exceeds the 1.03 guard. Cached qualification incomplete. |
| Reuse detached best-band snapshots | 16 | 0 | 1.000648× | Reject: 3% tail target and whole-pass nonincrease missed; third A/A round unavailable. |
| Return ray views without temporary tuples | 18 | 0 | 1.002351× | Reject this fresh implementation: 3% tail target and whole-pass nonincrease missed despite healthy uncached allocation controls. |

Ratios below are medians of three same-round candidate/accepted26 ratios, not
ratios of separately pooled medians. Each column reports its declared primary
metric. All cases and raw 15-call timing samples remain in the detailed evidence.

| Required uncached tail | Rank-first time, target ≤0.95× | Band allocation, target ≤0.97× | Ray allocation, target ≤0.97× |
| --- | ---: | ---: | ---: |
| cyclic-labelled-11 | 1.020846× | 0.980994× | 0.998035× |
| cyclic-labelled-15 | 0.987211× | 0.994211× | 0.992900× |
| cyclic-labelled-19 | 0.994513× | 0.990640× | 1.002079× |
| cyclic-labelled-9 | 0.958931× | 0.998877× | 0.990330× |
| cyclic-labelled-13 | 0.996784× | 1.003651× | 1.007387× |
| cyclic-labelled-18-cuts | 0.991516× | 0.999091× | 1.005877× |

Rank-first's adverse allocation ratios are 1.148286× on cyclic19, 1.065844× on 9
and 1.039948× on 13; counting fewer visits did not establish less allocation.
Its cyclic11/15 time A/A medians 1.100839×/1.058056× also fail the tighter
reciprocal 1.05 control. Ray timing has large individual A/A drift, including
round 2 cyclic ratios around 0.71–0.88; apparent timing reductions establish no
causal speedup. No timing claim is used to rescue a failed allocation target.
Rank/ray uncached allocation A/A medians pass on 27/27 inputs; band has only
two A/A rounds, so all its three-round A/A medians remain unavailable.

Rank/ray finish all 18 uncached workers, then time out the first cached baseline
worker and leave 17 slots unlaunched. Band finishes 16 uncached workers, times out
the third A/A timing worker and leaves its memory slot plus all 18 cached slots
unlaunched. No normal-policy candidate result exists. Available exact
SVG/full-receipt/decision/certificate comparisons are 162/324, 135/324 and 162/324,
with zero observed differences; the unavailable comparisons remain missing.
Uncached whole-worker RSS paired medians are 0.965849×, 0.987615× and 1.010290×;
all observed candidate settled growth is below 1.62 MB. Missing cached memory
and controls prevent full resource qualification.

Six synthetic reporting tests and 2370 independent raw metric/sample checks
pass. The initial assessment misleadingly combined stock-summary consistency
with completion in one gate. Its outputs are retained; corrected assessment
separates matching plans/failed-slot lists (true) from completion (false).
No worker result, ratio, target or deadline changes. None of these three pilots
measures an ELK arm, and none earns production inclusion. The older interrupted
ray attempt remains historically unqualified; the new complete uncached evidence
is a separate adverse observation against accepted26.

### Combined query-local crossing records: complete negative experiment

A fourth prospective declaration, SHA256
`2809a75e3e0e020de7ba74c22d8c7e0c1562a312b38e90fd057bb49b56b630e6`,
is written at 05:27:44 UTC, before viewing ray timing results or building the
combination. It combines the exact ray-view patch with two distinct lazily
created segment records local to a single two-route query. Every surviving pair
refreshes both endpoint references and both segment indices. The predicate is
synchronous and retains only an owned crossing location; neither record escapes
the query. Existing rejection order, numeric operations, deduplication and
independent final proof remain unchanged. There is no cross-call cache, index,
proof reuse, rank/band change or search-budget change.

Prototype source is `d3ccf4e7c348d45f0dbdd980ef274929ced92484`; it deliberately
keeps the 26 receipt identity for exact comparison, and **is not the accepted
runtime26 renderer**. It passes 145 owning tests, core types and canonical
Node/DTS/IIFE/lazy builds. Eight evaluator traces retain exact predicate-call
order, returned x/y/error and independent general-counter equality. A three-crossing
witness creates 24 baseline records versus two query-local records; deliberately
omitting index updates changes its count 3→1, demonstrating that the regression
test detects a real reuse fault. This logical object count predicts no byte saving.

All 108 historical27/backend/cache rows match accepted26 exactly on full SVG,
receipts, certificates, public layout, measured metrics and the complete edit
workflow. No version normalization is used. Unchanged delivery caps pass, with
worse reserve: Architecture default-ELK transfer 573892 B Brotli leaves 108 B,
and standalone 4099694 raw/1229775 gzip leaves 306 raw bytes. Production26
retains its 356/457-byte reserves because this prototype is rejected.

The separate existing memory-only protocol runs all27 inputs in 30 fresh workers,
three rounds, both cache policies, 480 seconds **per policy**. Accepted26 and its
A/A control use the immutable baseline; ELK reference and ELK A/A run from the
same checked joint artifact as joint native. Stock raw labels `native23` and
`native24` are preserved and explicitly mapped to accepted26 and joint26 in the
prelaunch execution declaration. The exact original historical27 envelope is
used after verifying source/order/workflow/expected-label equality with the
earlier ID-keyed pilot map. Initial declaration-helper format/lookup failures are
retained; no worker runs before the corrected frozen plan. No workload, target,
deadline or stock worker changes.

| Joint prototype allocation /accepted26 | Uncached | Normal cache |
| --- | ---: | ---: |
| cyclic-labelled-11 | 0.997095× | 1.000879× |
| cyclic-labelled-15 | 0.997228× | 1.000261× |
| cyclic-labelled-19 | 1.004973× | 0.999257× |
| cyclic-labelled-9 | 1.012170× | 1.002408× |
| cyclic-labelled-13 | 0.995749× | 1.000343× |
| cyclic-labelled-18-cuts | 0.999865× | 1.000414× |
| Actual complete 27 pass | 0.998425× | 1.000087× |

All 30 workers complete, artifact hashes remain unchanged and all stock gates
pass. Nevertheless, **zero of six** required uncached tails reaches the declared
0.95× allocation target, and whole-pass 0.998425× misses the declared 0.98×
maximum. Normal-cache, per-input, A/A, RSS and absolute retained-growth guards
pass; they do not compensate for those two failed improvement requirements.
The observed 0.16% uncached difference does not qualify as a useful improvement.
No implementation is promoted and no broad/future-cohort/browser promotion
qualification is claimed for this rejected prototype.

| Whole 27 paired median, direct observations | Uncached | Normal cache |
| --- | ---: | ---: |
| Joint /accepted26 allocation | 0.998425× | 1.000087× |
| Accepted26 A/A allocation | 0.988489× | 0.999718× |
| Joint /accepted26 worker RSS | 1.007720× | 0.958460× |
| Accepted26 A/A worker RSS | 0.996570× | 0.950269× |
| Joint /current-artifact ELK allocation | 0.959303× | 0.993433× |
| Joint /current-artifact ELK worker RSS | 0.920201× | 0.920760× |
| ELK A/A allocation | 0.999719× | 0.999973× |
| ELK A/A worker RSS | 0.980387× | 1.003178× |

Each ratio requires all three same-round observations. Eight individual per-input
A/A round outliers remain descriptive, as prospectively declared; whole-pass
A/A allocation/RSS are the required controls. The six uncached cyclic inputs
still allocate about 1.26–1.78× ELK. Whole-pass averages do not establish universal
memory superiority, and normal RSS differences alongside its A/A control do not
establish a stable improvement over accepted26. Allocation is a GC-boundary
estimate; RSS covers the fresh process, and retention has an absolute 16 MiB cap.
This protocol consumes complete SVG/receipts but produces no latency samples or
fingerprints; the separately frozen 108-row replay supplies the exact proof
comparison. Its memory-mode `reps:25` is not 25 timed or memory repetitions.

This complete negative experiment neither retries nor repairs the original
three 480-second-total pilots. Their missing cached workers and failed primary
targets remain. The result supports retaining accepted26 and prioritizing a new
mechanism for repeated candidate work; deleting temporary JavaScript objects or
visits alone has not delivered the declared benefit. Do not infer the cause from
V8 sampling shares, add overlapping profile percentages, multiply isolated ratios
or retune evaluated cases into a claimed holdout win.

### Durable evidence for this round

[The cyclic experiment archive](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-runtime26-cyclic-experiments.json.gz)
retains all four exact candidate source/test patches against the published f2af
base, accepted3258 and prototype build identities, executed harness bytes and
immutable declarations. It contains the12 raw CPU/heap profiles, complete40-case
normalization diagnostic, all three pilots, the complete30-worker joint memory
experiment and108-row parity replay, current-head CI raw reports/provenance,
all samples/outliers/failures/missing slots and both initial/corrected reporting
sources. The independently verified reporting checks total6+6 synthetic tests,
2370 original-pilot raw checks and464 joint raw checks. Profile-premise,
declaration-helper and reporting corrections remain visible.

There is **no source or SVG projection** in this new archive: complete strings,
receipts, certificates and other structured fields survive lossless interning.
Canonical JSON changes formatting, so the file index also retains every original
raw SHA256/size. The archive indexes831 files and581 unique bodies. It is
9138100 gzip bytes, SHA256
`ef582ba7b554106ddc4700a4f5f6f4af323ba35c4d512332ce5c8334eb1416da`.
The recorded decoder run verified all content hashes and restored 256903815
canonical bytes, SHA256
`d762a447f5226d835205a8e5656e8d9f84adeb9a499ffdb2bedda6488beb1a17`:

The [original snapshot](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-followup-results.md)
retains the raw archive and original instructions. Its standalone decoder command
is unavailable: the decoder was not retained in repository history.

Existing historical archives are unchanged. This is repository evaluation
evidence, not an addition to a renderer's fetched bundle or a new qualification
of the accepted production artifact.

### Independent reporting-head CI observation

The later documentation/evaluator head `f2af40c1` has completed required
[CI39878862964](https://github.com/adewale/agentic-mermaid/actions/runs/39878862964)
and Ruff successfully; the generated-layout advisory remains red. Its runtime,
build and dependency sources are unchanged from frozen 3258. This is a separate
canary, not a replacement for the renderer's dedicated campaigns below.
All three raw uncached canary comparisons fail completion: ELK reference has
1/21 memory groups, while ELK A/A, strict native and fallback each have 0/21
after an ELK A/A module-import timeout consumes the shared deadline. All 27
timing cases complete for three rounds. Cyclic15 native/ELK is 1.515862× strict
and 1.512741× fallback, with paired ELK A/A 0.983853×; both exceed the 1.5 limit.
All three normal-cache reports complete and pass. Workers use Node 24.21.0;
the coordinator's Node 26.3.0 is not the measured worker runtime. This canary
has source binding, without the dedicated campaigns' exact 20-Node-file equality
manifest. A green reporting job does not repair failed backend qualification.

### Landing contract and integration order

A [newer owner review](https://github.com/adewale/agentic-mermaid/pull/449#issuecomment-6358150200)
recognizes that runtime26 now has direct qualification and that release,
differential and churn still fail. It prefers #467, then #433, then this branch;
this is an integration preference, not a missing ancestry dependency. Current
main remains `87c9c317` and both related PRs are unmerged. Their results cannot
qualify an unbuilt combination. The accompanying
[#433 review](https://github.com/adewale/agentic-mermaid/pull/433#issuecomment-6358155962)
also requires reconciliation of native drawing/security ownership and retained
State80/PNG controls.

Before landing, resolve the failures or obtain owner review of an explicit
narrower shipping contract. The [shipping options](layout-shipping-options.md)
make that proposal concrete, including subtraction of production-native delivery
from a prerequisite-only slice and the separate unmeasured acyclic-preview
alternative. No narrower contract is implemented or approved here. Existing
six-family opt-in alone is not a new narrower proposal, and Flowchart-only retains
the failing cyclic tails.

After actual integration/rebase, preserve thin CLI startup, backend-aware cache
keys, fixed quotas, public-result isolation, inherited/sibling namespaces,
malformed-envelope error precedence and final PNG security. Rebuild/freeze and
qualify that exact package against its current base, including all original
populations, declines and missing-data/deadline rules. Keep this PR draft; the
four failed improvements do not resolve its landing conditions.

## Implications for scope and ELK comparison

Keep ELK as the default and native placement opt-in for the existing six graph
families. Narrowing to Flowchart would retain every measured cyclic tail;
expanding families has no new supporting evidence. The
[community comparison](layout-community-comparison.md) and
[literature review](layout-exploration/layout-literature.md) continue to motivate
family ownership, bounded optional work, final-route scoring and independent
proofs. They do not establish measured wins over other community renderers.

The repeated-normalization profile remains the next cost mechanism to address.
Sparse Sugiyama representations target expansion within a candidate; our lazy
order experiment shows that removing eager order construction alone does not
materially reduce the repeated candidate cost. Preserve the counterexample
corpus and measure the changed mechanism before adopting another representation
or cache. Better source-level allocation counts alone are insufficient.

The deadline and A/A evidence also requires separating process startup/import,
solver work and full SVG/receipt consumption in future profiles. Record wall and
process CPU time, GC activity and allocation samples alongside each candidate's
normalization/route/acceptance counts. Attribute repeated work and rejected
choices before introducing a cache or raising a search bound. Collect that
instrumentation in separate diagnostic runs, with exact output/proof parity;
keep the unchanged full-consumption release workers as the qualification
authority. Profiling cannot retroactively repair a timeout or justify relaxing
its deadline.

We have not established superiority to ELK on every aspect. The earlier report
records cyclic time/allocation losses, per-case bend/length/area losses,
unverified paint, edit-motion losses and incomplete uncached release memory.
Those remain open until a final artifact demonstrates otherwise.

The fresh Architecture evidence below points to initial placement and routing:
cleanup changes none of 64 bases, and 25/26 agree throughout that corpus. The next
mechanism experiments should trace route-corridor assignment, authored-port
ordering and stateless topology/rank/tie switches. Port-constraint literature,
Wybrow's orthogonal routing work, mental-map research and the pinned Pele review
motivate these hypotheses; they do not supply measured improvements here.
Compare cleanup disabled and strict Pareto acceptance against crossing-first
acceptance before widening optional work. Preserve the known 0/5 witnesses and
the 84-unit length tradeoff. Any new quality, motion or allocation target needs
a declaration and a future untouched cohort: the 64 cases below are now evaluated
data. Keep all six families opt-in, without expansion or a default change.

## Intermediate runtime 25 source geometry

Frozen source is `b33c89c76ccc98e839c90f8ff603a7cd606ffca5`, with
`agentic-layered@25`. The optimizer runs only after an actual native placement;
default ELK, explicit ELK and typed native-to-ELK fallback do not call it.
It reuses the family's complete authored-side and sibling legality predicate.
Every relationship is rerouted for each candidate; final family and paint
certification remain independent. Aligned diagrams, edge labels and group-boundary
terminals are excluded, as are populations exceeding 16 services,24 total
services/junctions/groups or 32 edges. At most eight coordinate exchanges are tried.

| Architecture witness | Runtime 24 →25 | ELK comparison |
| --- | --- | --- |
| Source 0/5 | Crossings 1→0; length 922→596; bends 6 and area 318682 unchanged | Now ties ELK crossings; the two source occurrences contain the same relationship example. |
| Source 4 | Crossings 2→1; length 1972, bends 12 and area 534488 unchanged | Fewer crossings than ELK's 2. |
| All 13 Architecture-family source occurrences | Crossings 4→1; all 13 retain passed paint certificates and zero shared spans | Native 25/ELK crossings 1/2. Bends equal on 13; length better 4/equal 9; area better 2/equal 11. |

These 13 occurrences comprise six corpus sources, two fixtures and five workload
sources, including the separately named junction supplements. They are not 13
independent corpus examples. No complete peer-renderer or human readability
superiority is inferred from these geometry scores.

| All 249 source/workload occurrences | Native 25 | ELK | Native per-case losses |
| --- | ---: | ---: | ---: |
| Proper crossings | 530 | 877 | 0 |
| Label conflicts | 0 | 38 | 0 |
| Parallel / opposing shared spans | 0 /0 | 18 /9 | 0 /0 |
| Bends | 3190 | 2673 | 25 |
| Route length | 598546 | 803233 | 17 with absolute 1e-6 epsilon;18 raw |
| Area | 84494457 | 107123368 | 33 |
| Label fit, paired mean | 1 | 1 | 0 |
| Minimum node gap, paired mean | 53.67 | 59.82 | 40;88 cases unavailable |
| Passed /unverified paint certificates | 222 /27 | 220 /29 | Unverified remains explicit |

This closes the source crossing losses; the bend, length, area, edit-motion and
paint-certainty gaps remain. It does not justify an all-aspects ELK parity claim.
Totals above are rounded for display. Minimum-gap means use only available
paired measurements; infinite/undefined zero- or one-node gaps stay unavailable.

## Intermediate runtime 25 delivery

The strict browser budget command passes every unchanged limit on the canonical
root build. Native closures below are structural fetched-file closures, not
proof that every input is natively eligible. Fallback can additionally fetch ELK.

| Family | Complete ELK closure, Brotli bytes | Selected-native closure, Brotli bytes | Native /ELK |
| --- | ---: | ---: | ---: |
| Flowchart | 576263 | 253184 | 0.4394× |
| State | 576166 | 253087 | 0.4393× |
| Class | 527580 | 205701 | 0.3899× |
| ER | 564093 | 241014 | 0.4273× |
| Requirement | 516049 | 194170 | 0.3763× |
| Architecture | 573823 | 250744 | 0.4370× |

Transfer savings do not establish request-count or browser-latency wins. Class
and Requirement native closures each need one additional request. The package
still supplies both engines. Architecture's unchanged 574000-byte Brotli cap
leaves only 177 bytes; the standalone editor is 4099570 raw/1229736 gzip, leaving
430 raw bytes under 4100000. Durable maintenance headroom remains open.

The rejected initial private-chunk build imports generic rubric code into the
optional producer, changing shared chunk partitioning and exceeding four limits.
Passing the unchanged family-owned shared-ink predicate into the helper removes
that dependency. All predicates, tolerances, search order and eligibility guards
remain unchanged. Its isolated-worktree 573713-byte Architecture result differs
from root's 573823 because a dependency symlink changes hashed import filenames;
normalized code and every raw file length match. Root sizes are authoritative.
Earlier inline 117-byte overrun and initial private-chunk 1099-byte overrun are
retained; no cap is increased to accept the feature.

## Runtime 25 cost observations

The new counterfactual compares immutable runtime 24 with runtime 25 and an
independent runtime 24 A/A. Every worker receives all 13 Architecture-family
sources. All 36 planned workers complete under the 480-second total bound,
with zero input failures, zero A/A output drift and unchanged artifact hashes.
The 18 intentional candidate SVG changes are exactly sources 0/4/5 across three
rounds and two policies. This experiment has no ELK arm or ELK ratios.

Uncached source 4 allocation rises **1.8555×** runtime 24, with allocation A/A
1.0102×. The entire 13-input pass rises **1.0483×**, illustrating how an aggregate
can conceal a costly input. Cached allocation is effectively unchanged. Source 4
time is 1.4447×, but timing controls are unreliable across the experiment:
7/13 uncached and 8/13 cached A/A medians fail reciprocal 1.1, with 20/39 and 22/39
individual round failures respectively. The final cached A/A timing worker takes
77.07 s versus its baseline's 5.01 s. All observations remain retained; no A/A ratio
division or causal speedup claim is used.

This identifies another subtraction experiment: stop after the first strict
legal crossing improvement instead of spending the remaining trial budget.
Its separately declared counterfactual must preserve all 13 SVGs/receipts/certs,
reduce uncached source 4 allocation by at least 15%, keep the uncached 13-input
pass at or below baseline and cached pass within a 1% guard. This is a new
mechanism experiment, not a retry or relabelling of runtime 25's adverse result.

That first-improvement experiment completes all 36 workers with zero failures,
exact SVG/receipt parity and unchanged artifacts. Source 4 allocation is
0.8520336517× runtime 25: a 14.7966% reduction, which **misses** the declared 0.85
limit. The experiment is rejected rather than rounding it into a pass. All
allocation A/A medians fit reciprocal 1.1 and no candidate input exceeds 1.05×.
Whole 13 allocation is 0.990489× uncached and 0.999185× cached; its modest aggregate
saving does not override the primary-target failure.

A third, separately declared exploratory scope is complete cleanup of an initial
single proper crossing. It keeps the same eight-trial/size limits and every
legality, shared-ink, obstacle and endpoint-face check, accepting only 1→0.
It deliberately leaves multiple-crossing layouts at their original family
routes: source 4 would return from runtime 25's 1 crossing to runtime 24/ELK's 2.
This structural narrowing was motivated by the observed cost and is not an
independent confirmation of the previous target. All 13 inputs remain enrolled.
Its allocation targets are source 4≤0.60× runtime 25, whole 13≤0.98× uncached and
≤1.01× cached. These ratios alone do not prove an improvement over runtime 24;
runtime 24 and ELK remain comparators, alongside prospective Architecture inputs
and boundary edits.

The single-crossing experiment completes all 36 workers with zero failures,
zero A/A drift and exactly six intended source 4 output changes (three rounds,
two policies). Source 4's uncached allocation is **0.556823× 25**; the whole 13
pass is **0.954914× uncached /0.999712× cached**. All predeclared allocation targets
and median allocation controls pass, with no other input above 1.05×. This earns
a final qualification run, not a universal cost or readability claim. Nine per-input
timing-control medians are outside reciprocal 1.1; no latency improvement is
claimed from the pilot. Complete per-call samples, p95/max and adverse controls
remain retained.

The separately declared whole 27 mixed-session memory experiment completes
30/30 workers and passes its gates in 128.84 s uncached and 88.63 s cached, below
the unchanged 480-second per-policy bounds. Every worker receives all 27 historical
inputs, including the edit workflow. Actual worker runtime is Node 24.19.0.

| Whole 27 memory, paired median ratios | Uncached | Normal cache |
| --- | ---: | ---: |
| Native 25 /ELK pass allocation | 0.9602× | 0.9932× |
| Native 25 /ELK peak heap | 0.7498× | 0.8650× |
| Native 25 /ELK whole-worker RSS | 0.9545× | 0.8733× |
| Native 25 /ELK settled-pass growth | 0.4133× | 0.7432× |
| Native 25 /native 24 pass allocation | 1.0027× | 0.9999× |
| Native 25 /native 24 whole-worker RSS | 1.0284× | 0.9564× |

Allocation is effectively flat against runtime 24, not a new general allocation
improvement. All aggregate allocation/RSS A/A gates pass, while individual
outliers remain in the evidence. Uncached cyclic 11/15/19/9/13/18-cuts allocation
is respectively 1.8447×/1.5947×/1.3198×/1.2482×/1.5429×/1.4255× ELK.
Native 25/native 24 cyclic 18-cuts allocation rises 7.2%; preserve the per-input
controls rather than attributing this to an unchanged cyclic algorithm.
These are GC-boundary estimates and settled growth, not total retained heap;
the experiment establishes no latency result and repairs no earlier deadline
failure. Historical raw labels `native23`/`native24` mean baseline 24/candidate 25
in this new declaration, with an explicit alias map.

## Intermediate runtime 25 hosted qualification

These four dedicated campaigns measure frozen 25 against 24, with three rounds,
25 timing repetitions and the unchanged 480000 ms shared bound per cache policy.
Each uses a separate hosted runner. All 20 candidate and 20 baseline Node JS
files match the frozen local artifacts in every campaign; actual workers are
Node 24.21.0. Historical report names `native23`/`native24` are aliases for 24/25.

| Campaign | Result and retained failure |
| --- | --- |
| [Release39870453621](https://github.com/adewale/agentic-mermaid/actions/runs/39870453621) | Failed. Normal reports pass; uncached native/fallback memory is entirely missing (21 groups each), ELK has only 2/21 groups, and cyclic 15 exceeds the 1.5× ELK time gate. |
| [Direct39870459904](https://github.com/adewale/agentic-mermaid/actions/runs/39870459904) | Failed overall. Actual 25/24 and independent 24 A/A complete all 27 timings and 21 memory groups and pass under both policies. The separate candidate-ELK comparison loses 10 memory groups to import timeout/deadline and fails cyclic 15/13/18-cuts large-case gates. |
| [Architecture39870465128](https://github.com/adewale/agentic-mermaid/actions/runs/39870465128) | Failed its control gate: normal-cache 32-junction ELK A/A timing 1.12033× exceeds 1.1. All three inputs and rounds complete; native/fallback reports pass both policies. Uncached native times are 0.3908–0.4002× ELK. |
| [Churn39870470895](https://github.com/adewale/agentic-mermaid/actions/runs/39870470895) | Failed its normal 256 source diagnostic. All 108 memory workers succeed. Four normal-outer controls/instrumented workers complete; outer-off ELK control then times out, leaving three workers unlaunched. Other five source diagnoses pass. No completed observation has a rendering/instrumentation mismatch. |

The actual direct 25/24 seven-official-corpus time ratios are 0.979874× uncached
and 1.035605× cached; corresponding A/A ratios are 0.979504×/1.000558×.
These are not whole 27 latency aggregates. Off cyclic 13 allocation is 1.042527× 24;
cached Class cyclic-members is 1.092037× 24. Churn uncached 256 retained growth is
1.096854× 24 while its 24 A/A is 1.204390×: retain both without asserting a reliable
retention regression or discarding the adverse row.

An independent same-head CI canary completes all six required paired reports,
all 27 timing inputs and 21 memory groups under both policies, and passes its
qualification gates. Seven-corpus native/ELK time is 0.59083× uncached/0.98227× cached;
allocation 0.74097×/0.99720× and RSS 0.78495×/0.79270×. This is a successful replica,
not repair of the four failed campaigns. Its binding is weaker: source revision,
without per-file JS hashes. Uncached cyclic 15 still takes 1.46914× ELK at median
(one round 1.5350×), cyclic 18-cuts 1.43507× and cyclic 13 1.42536×. Algorithmic
cyclic changes did not ship, and these observations do not establish a causal
runtime 25 speed improvement. The old 25 full CI was later auto-cancelled by the
new 26 push after its stalled installation finally finished; its canary result
remains separate from overall CI status.

## Final runtime 26 qualification

The frozen final source is
`3258d80ce165457a1dd4695bb2bc12171f492006` (`agentic-layered@26`).
It includes the tested CI provisioning fix, which changes no renderer input.
Complete cleanup accepts only an initial single proper crossing and a candidate
with zero. It makes no attempt to partially reduce multiple-crossing layouts.
This scope was chosen after observing case 4's allocation cost; its prospective
validation is new evidence, not confirmation of the rejected first-return target.

All 13 original Architecture source occurrences still match or beat ELK on
proper crossings, bends, route length and area. Source 0/5 retain their 1→0
crossing repair and 922→596 route-length reduction with unchanged bends/area.
Source 4 deliberately returns to 24's geometry and two crossings, matching ELK;
the intermediate 25 one-crossing improvement is surrendered. The duplicate 0/5
witness and this tradeoff stay explicit.

Final validation passes both type checks, changed-file lint,62 owning tests
(894 assertions),319 default geometry records,51 Chromium contracts
(1023 assertions),two standalone contracts (20 assertions),six changed
Architecture Node/lazy exact-SVG/loading checks and 72 copied-asset byte checks.
The actual runtime 26 CI browser lane also passes all 95 tests, including the four
Firefox/WebKit checks and 55 bundle contracts. The previous three-browser trial
remains separate evidence.

The unchanged strict browser payload gate passes all families. Final Architecture
delivery is 573644 Brotli bytes, with 356 bytes of reserve; its selected-native
closure is 250626 Brotli bytes. The standalone editor is 4099543 raw/1229724 gzip,
with 457 raw bytes of reserve. This remains inadequate maintenance headroom.
The initial final 26 size command raced website generation's lazy rebuild and
failed on a temporarily missing chunk; its log is retained. The stable-artifact
check then passed without a source change or cap increase.

| Final 26 family | Complete ELK closure, Brotli bytes | Selected-native closure, Brotli bytes |
| --- | ---: | ---: |
| Flowchart | 576117 | 253099 |
| State | 576003 | 252985 |
| Class | 527531 | 205713 |
| ER | 563939 | 240921 |
| Requirement | 516000 | 194182 |
| Architecture | 573644 | 250626 |

Selected-native transfer closures are 56–62% smaller than complete ELK closures.
These are fetched-file totals, not the size of a package with ELK removed.
The package still supplies both backends, fallback adds ELK, and Class and
Requirement each require one extra native request. Browser latency and durable
payload reserve remain separate requirements.

Fresh Flowchart seeds 512–575 and 64 new Architecture bases with predetermined
edit/undo states were enrolled only after final build/payload freeze. The latter
uses all 64 bases, four backends (24/25/26/ELK), both cache regimes and all three
states:1536 observations. Twelve prescribed exclusion controls remain in the
population. Its exact generator/recipe bytes and hashes are retained. Neither
cohort was tuned or supplemented after inspection. Quality results below are
separate from runtime and browser-delivery qualification.

### Final known replay and Flowchart holdout

| Population per engine | Native 26 | ELK 26 | Comparison with frozen 25 |
| --- | ---: | ---: | --- |
| 249 source occurrences | 249/249 | 249/249 | Only the declared native source 4 rollback changes |
| 704 retained generated cases | 704/704 | 698/704 | Exact SVG, normalized receipt and certificate parity |
| Known SHA 320–383 | 64/64 | 63/64 | Exact parity, including the same failure |
| Known SHA 384–447 and 448–511 | 128/128 | 128/128 | Exact parity |
| Fresh SHA 512–575 Flowcharts | 64/64 | 64/64 | Exact parity on frozen 25 and final 26 |

These 2418 candidate observations preserve all seven known ELK paint failures,
including their codes, saved diagnostics and complete certificates. Source 4
matches 24's SVG, normalized receipt and metrics exactly. Only scoped
`agentic-layered@24/@25/@26` implementation identities are normalized; output
and proof differences are retained. All 234 original edit observations preserve
25's behavior: each policy has 116 successes and the same strict native hint
decline, with 36/36 undo byte checks. Those original sequences alone do not test
the new Architecture crossing threshold.

| Known source metric,249 occurrences | Native 26 total | ELK total | Native better/equal/worse |
| --- | ---: | ---: | --- |
| Proper crossings | 531 | 877 | 22/227/0 |
| Label conflicts | 0 | 38 | 16/233/0 |
| Parallel overlaps | 0 | 18 | 14/235/0 |
| Opposing overlaps | 0 | 9 | 4/245/0 |
| Raw bends | 3190 | 2673 | 31/193/25 |
| Route length | 598546.20 | 803232.61 | 84/148/17 |
| Canvas area | 84494456.75 | 107123368.21 | 71/145/33 |

Length/area totals are rounded to two decimals. Comparisons use absolute
epsilon 1e-6; strict raw floating-point comparison has 18
length losses instead of 17. Native paint evidence remains 222 passed/27
unverified versus ELK 220/29. Measured node-label fit ties on all 249; minimum
node gap is better 30/equal 91/worse 40, with 88 unavailable measurements. These
known-source results do not establish universal superiority, as the new
Architecture evidence demonstrates.

### Prospective Architecture quality and edit stability

All 1536 observations succeed and retain passed native-scene paint certificates.
There are no measured identity, label, membership, relationship, authored-side,
boundary or endpoint-anchor discrepancies. All 512 undo SVG checks and 512 undo
public-layout checks pass. Cache-off and normal results agree exactly on SVG,
layout, receipts, certificates, measured quality and edit transitions.

| Observable cleanup versus unoptimized 24, per cache | Bases | Edited states |
| --- | ---: | ---: |
| Structurally eligible | 52 | 52 |
| Structural eligibility plus one baseline crossing | 8 | 9 |
| Inferred admission after the exact private all-pair ink predicates | 1 | 3 |
| SVG/public-layout changes | 0 | 1 |
| Proper crossing 1→0 changes | 0 | 1 |

The inferred admissions are offline applications of the production predicates
to frozen 24 routes, not instrumented private-call or trial counts. The one
observable cleanup is seed 28's added-edge state: crossing 1→0, with bends 8 and
area 407650 unchanged, but route length 963→1047, an 84-unit increase. Unchanged
service aligned mean motion on edit and undo improves 91.115→64.437 versus 24.
All other 24→26 states preserve SVG/layout/proof parity after implementation
normalization. Native 25 and 26 agree on every state, so this cohort shows no
observable effect of narrowing 25's scope.

The unoptimized 64 bases have 17 zero-crossing, nine single-crossing, seven
two-crossing and 31 larger-crossing layouts. No prescribed edit crosses 1↔2:
23 keep the count,31 change other counts, five enter one crossing from another
count and five leave one crossing. Direct 1↔2 threshold stability remains
untested; no post-hoc cases were selected to fill that gap.

| Fresh Architecture base metric,64 cases; both caches | Native 26 total | ELK total | Native better/equal/worse |
| --- | ---: | ---: | --- |
| Proper crossings | 239 | 226 | 18/25/21 |
| Raw bends | 800 | 806 | 12/46/6 |
| Route length | 168100 | 167502 | 24/8/32 |
| Canvas area | 32577130 | 32802173 | 23/28/13 |
| Label conflicts | 0 | 2 | 1/63/0 |
| Parallel overlaps, published metric | 0 | 0 | 0/64/0 |
| Opposing overlaps | 6 | 1 | 0/60/4 |

Against ELK, native edit motion is better 70/equal 10/worse 48 across 128 transitions
per cache. Against 25 all 128 tie; against 24 two improve and 126 tie. Passed paint
and semantic checks therefore coexist with 21 crossing losses and 48 worse
edit-motion transitions. Human readability, perceived symmetry and incremental
guarantees remain distinct, unproved aspects. The complete per-case
crossing/bend/length/area loss tables for both policies are retained in the
[runtime26 quality evidence](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-runtime26-quality.json.gz).

That archive losslessly envelopes the explicitly projected complete case
evidence, its index, exact eight generator/harness/analysis byte records and
report/loss tables. Diagram source and full SVG strings are replaced by UTF-8
SHA256 identities; complete receipts/certificates, fresh Architecture public
layouts and motion, failure diagnostics,93 executed JS/WASM hashes and 38 raw
workspace-file hashes remain. Raw SVG-bearing files stay in the task workspace.
The fresh Flowchart and Architecture cohorts are separate; neither justifies a
claim of ELK dominance or broader native-family admission.
The envelope is 64445123 uncompressed bytes and 2382917 gzip bytes. Its gzip
SHA256 is `b378f692376247105d04c3c25f763771bc4f02e06cd224beb2e91e58ba320ebe`;
the uncompressed-envelope SHA256 is
`5567303eb5a512441a14472e1593a9f60b0de2744051e007de1fabeedb13ca71`.

## Final runtime 26 memory and cost

The separately declared whole 27 mixed-session memory experiment completes all
30 workers and passes its declared allocation/RSS controls and growth gates.
Uncached execution takes 145.98 s and cached execution 91.16 s, each below the
unchanged 480-second per-policy bound. Actual workers run Node 24.19.0. Each
worker receives all 27 historical inputs, including the edit workflow. This
experiment measures memory only and does not repair a hosted qualification
failure or establish latency.

| Whole 27 memory, median of three paired round ratios | Uncached | Normal cache |
| --- | ---: | ---: |
| Native 26 /ELK pass allocation | 0.954487× | 0.994505× |
| Native 26 /ELK peak heap | 0.758468× | 0.927916× |
| Native 26 /ELK whole-worker RSS | 0.873106× | 0.883955× |
| Native 26 /ELK settled-pass growth | 0.411498× | 0.734543× |
| Native 26 /native 24 pass allocation | 0.999084× | 1.000650× |
| Native 26 /native 24 whole-worker RSS | 0.994229× | 1.011098× |

This supports lower worker RSS than ELK in this population, with effectively
flat allocation against 24. It does not establish that every input allocates
less, or that cached allocation meaningfully beats ELK. GC-boundary heap and
allocation estimates, process-lifetime RSS and settled growth describe different
quantities. All per-input rounds and adverse controls remain in the evidence;
normal native 24 A/A peak-heap ratio is 1.07351×, though the declared allocation/RSS
control gates pass. Ratios are never divided by A/A.

Uncached native/ELK per-input allocation remains worse on the six cyclic tails:
labelled 11/15/19/9/13/18-cuts are 1.855834×/1.598178×/1.270558×/1.256533×/
1.538803×/1.570994×. Normal-cache official Flowchart#82 is 1.063837× ELK.
No per-input allocation/heap 26/24 median exceeds 1.05×. Preserve nine uncached
allocation A/A round outliers and three cached heap A/A round outliers; cached
Class 80 heap A/A median 0.825524× is unhealthy even though the declared whole-pass
allocation/RSS controls pass. Aggregate health does not erase individual tails.

The immutable memory declaration SHA256 is
`167bb1cb62cca54b71863d3bf09454c9958bfdd090af1fad280395904428998e`.
The direct 24/A/A/26 Architecture experiment completes all 36 planned workers,
with zero input failures, zero A/A SVG drift and unchanged artifact hashes.
The 12 intended SVG changes are exactly source 0/5 across three rounds and both
policies; the same 12 ASCII changes and certification differences are retained.
All 78 raw candidate receipt differences (13 inputs across six cells) remain,
with no unexpected decision drift after scoped implementation normalization.
All measured paint certificates pass. Every worker receives all 13 Architecture
family inputs; the experiment has no ELK arm. It uses 15 timing repetitions and a 480-second total bound,
distinct from hosted qualification's 25 repetitions and 480 seconds per policy.

| Direct native 26 /native 24 allocation | Uncached | Normal cache |
| --- | ---: | ---: |
| Whole 13 Architecture pass | 1.001647× | 1.000278× |
| Whole 13 allocation A/A | 0.999396× | 1.000283× |
| Source 4 | 1.002291× | 1.000347× |
| Source 4 allocation A/A | 0.997495× | 1.003113× |

Final 26 is allocation-flat versus 24, while avoiding 25's costly partial source 4
improvement and retaining the 0/5 crossing repairs. No Architecture input has an
allocation or peak-heap median above 1.05× 24 in this experiment. This is a direct
measurement; no 25/24 and 26/25 medians are multiplied to infer 26/24. Timing
controls and dedicated hosted 26 qualifications remain separate below.
The repaired source 0/5 occurrences cost 1.023008×/1.047269× uncached allocation
versus 24, with corresponding A/A 1.010946×/1.026600×; cached costs are flat.
Their quality repairs are not allocation improvements.

The experiment completes in 309.323 s. Timing A/A median controls fail on 11/13
uncached and 3/13 cached inputs, with 34/39 and 25/39 unhealthy individual rounds.
Tail controls fail on 13/13 and 9/13 inputs respectively. Preserve the cached
source 4 median-time ratio 1.076982× 24 and other adverse medians, plus p95/max
observations such as source 5's cached 2.198737× and 32-large-junctions'
uncached 1.808675×. With 15 samples per input, this worker's p95 equals its maximum.
All samples and comparisons remain in the evidence. These drifting controls
prevent a causal latency improvement claim.

## Final runtime 26 hosted qualification

All four dedicated campaigns use frozen source 3258d80c, corrected 24 baseline
`1fac4b85ba52df693976cdc7265a7dd02b6e9782`, three rounds, 25 repetitions and the
unchanged 480000 ms shared deadline per cache policy. Dispatch verifies the branch
head before and after every request; populations and gates are unchanged.
The three rounds apply to timing. Legacy hosted memory has one independent
matched measurement per group, not three-round memory medians: one seven-corpus
group, 19 individual scaling groups and one edit group. The local whole 27
three-round mixed-session experiment above has a different scope.
The immutable final campaign declaration SHA256 is
`f13861879000ab536ebd2ce120881282ba5b92a3c7be9a7447a73e0f78d4c0d9`.

| Campaign | Qualification |
| --- | --- |
| [Release 39876523273](https://github.com/adewale/agentic-mermaid/actions/runs/39876523273) | Failed uncached memory completion: all four arms have 0/21 memory groups after the initial ELK corpus warmup timeout. All 27 timing inputs and three rounds complete; strict-native cyclic 15 median 1.499536× passes its 1.5× time gate. All three normal-cache comparisons pass. |
| [Direct 39876529106](https://github.com/adewale/agentic-mermaid/actions/runs/39876529106) | Failed uncached qualification: runtime 24 baseline has 9/21 memory groups, its A/A 8/21, candidate 26 and candidateELK 0/21 after cyclic 13 memory-pass timeout/deadline. All three uncached comparisons fail completion; candidate/ELK also fails cyclic 15 time at 1.516404×. All three normal-cache comparisons pass. |
| [Architecture39876534282](https://github.com/adewale/agentic-mermaid/actions/runs/39876534282) | Passes all six paired reports, including both ELK A/A controls. All three supplements and rounds complete. |
| [Churn 39876539352](https://github.com/adewale/agentic-mermaid/actions/runs/39876539352) | Failed both 256 source diagnoses despite all 108 memory workers succeeding. Uncached 256 normal-outer native instrumented worker times out after three successful workers, leaving four unlaunched; cached 256 normal-outer ELK instrumented worker times out after one successful control, leaving six unlaunched. Both 96/129 source diagnoses pass under both policies. |

Architecture 16/32/32-large native/ELK time ratios are respectively
0.397594×/0.391868×/0.400489× uncached and 0.959447×/0.887545×/0.990906× cached.
These are supplementary junction workloads, not the fresh 64 quality population
or a whole 27 latency result. All median control gates pass; cached 16-junction
ELK A/A rounds 1.131285× and 0.897945× remain adverse individual controls.
Supplement allocation is 0.478539×–0.488104× ELK uncached and effectively tied
cached. Cached settled growth is 1.003797×–1.016030× ELK, preserving small
retention losses despite the time/RSS wins. No all-aspects win follows.
All 20 candidate and 20 baseline Node JS files match the declaration exactly.
The supplementary report's official-corpus gates are null because those corpus
inputs are absent; null is not a successful corpus measurement.

The independent source 26 CI backend job is green, but its raw uncached
native-with-ELK-fallback report fails cyclic 15's unchanged 1.5× speed gate:
median 1.511118× ELK, rounds 1.511118×/1.512965×/1.479373×, with paired ELK A/A
1.001824×. Strict native narrowly passes at 1.498201×, with rounds
1.498201×/1.499975×/1.489571×. All normal-cache reports pass. Seven-official-corpus
native/ELK time is 0.567857× uncached/0.984884× cached; allocation
0.738774×/0.997380× and worker RSS 0.788296×/0.780990×. Those are seven-corpus,
not whole 27 quantities. The green reporting job does not establish a complete
qualification pass. Its source binding remains separate from dedicated
campaigns' exact compiled-file equality.

All 108 churn memory workers complete (54 per policy). At 96/129/256 distinct
input keys, native 26/ELK allocation ratios are 0.666594×/0.681852×/0.697296×
uncached and 1.001090×/0.697210×/0.720933× cached; worker RSS is
0.750117×/0.693877×/0.860965× uncached and 0.742077×/0.691935×/0.836013× cached.
These are medians of three paired memory rounds, covering the separately
declared churn sessions. Native 26/24 allocation is effectively flat at all sizes
and policies (0.998282×–1.000267×). Retention varies: normal 256 rounds include
26/24 at 1.219902× and baseline A/A at 1.122313×, so no universal retention
improvement is claimed. The completed normal 96/129 diagnostics with the outer
cache disabled observe 96/129 unique measured solver keys and 224/323 inner-cache
evictions for both engines. Neither 256 source diagnosis completes. No completed
control/instrumented pair changes rendered output, but missing workers establish
neither output equality nor complete 256 key/eviction cardinality.

Dedicated direct 26/24 seven-corpus time is 0.986333× uncached and 0.987775×
cached, alongside baseline 24 A/A 1.006392×/1.012492×. These near-flat observations
do not establish a broad speed improvement. There is no uncached candidate
memory comparison in that campaign: allocation/RSS/retention gates with missing
candidate data remain null. The separately successful local whole 27 memory
experiment and canary do not repair either dedicated deadline failure. All 20
candidate and 20 baseline Node JS files match the frozen declaration in release,
differential and Architecture; churn remains a separate observation.

| Dedicated release, seven official corpus inputs only | Uncached | Normal cache |
| --- | ---: | ---: |
| Native 26 /ELK time, median of three same-round corpus-sum ratios | 0.598176× | 0.963800× |
| Native 26 /ELK allocation, one matched memory group | unavailable | 0.995765× |
| Native 26 /ELK worker RSS, one matched memory group | unavailable | 0.794879× |
| Native 26 /ELK settled growth, one matched memory group | unavailable | 0.989580× |

Release timing round ratios are 0.590625×/0.631456×/0.598176× uncached and
0.972154×/0.953679×/0.963800× cached. This near-tied cached allocation and modest
timing observation do not establish universal superiority. The normal direct 26/24
seven-corpus memory group is 0.999944× allocation,0.972077× RSS and 0.986477× settled
growth; its three paired time rounds are 0.987775×/0.989191×/0.984106×.
Timing uses paired rounds rather than a ratio of medians, a geometric mean, a
sum of per-input medians or an A/A correction. Missing uncached memory remains
unavailable. None of these seven-corpus quantities is a whole 27 result.

## CI provisioning

The old 25 all-engine CI job fetched 119 MB of Ubuntu OS packages in 43 m 44 s before
browser tests; a prior run spent 45 m 07 s in the same phase and was cancelled before
browser execution. The isolated corrected trial
[39872273272](https://github.com/adewale/agentic-mermaid/actions/runs/39872273272)
keeps all browsers, versions, package signatures, suites/components and tests.
It changes only the Azure archive/mirror-file indirection to the official HTTPS
Ubuntu archive and separates OS/browser installation logs. OS dependencies
complete in 65 s, browser installation in 15 s, and the canonical shard in 168 s;
95 tests/1376 assertions pass, including all four Firefox/WebKit checks.
This is observed provisioning liveness, not a renderer performance comparison.

The first isolated trial failed closed before installation because its URI
preflight omitted the runner's `mirror+file` representation. That test gap and
the corrected trial are both retained. The temporary experiment-branch trigger
is excluded from the integrated install-only fix. The actual runtime 26 source
[CI run 39874963426](https://github.com/adewale/agentic-mermaid/actions/runs/39874963426)
passes all required correctness, browser, package, unit and backend-canary jobs.
The generated-layout advisory remains red. Actual browser dependency download
is 119 MB in 25 s; its 95 tests pass with all three browsers. A green backend job
is checked against its raw qualification reports separately; it does not
override a failed dedicated campaign. Documentation/evaluator commits made
after this frozen source have their own CI status.

## Evidence

[Final26 benchmark evidence](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-runtime26-benchmarks.json.gz) preserves all
four dedicated campaigns and the separate canary; complete local 30-worker
memory and 36-worker Architecture results; exact executed harnesses, inputs,
compiled manifests and package/lock identities; browser/source validation; and
both CI-provisioning trials, including the first failed preflight. Its
deterministic gzip is 4,699,444 bytes, SHA256
`aeebba2b292ebf781a38a49407d7a36d323faa2775bcaa85cab9839f70d0698a`.
Lossless interning restores exactly 73,422,567 canonical JSON bytes, SHA256
`44dfaa17cdcf840355faad897a6d508575e980e5dee6fb0a1e5788561afac62b`.
The recorded decoder run verified that hash and all 588 content
hashes. The envelope retains 1,283 original-file index entries and 240 explicit
SVG hash/size projections, without dropping numerical samples, receipts,
certificates, controls, null gates, failure diagnostics or unlaunched rows.
The standalone decoder is unavailable, as described below. Mutable main
report/PR prose is excluded; frozen source and measured artifact identities
remain authoritative.

[Intermediate25 quality evidence](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-runtime25-quality.json.gz) preserves
the original broad-refinement outcomes and independently declared Flowchart
cohort 448–511. Its gzip SHA256 is
`bc51ffa8764c68afba2d1b9488136b2b075056648a82fbe53a76dc207c5b24bc`;
the uncompressed envelope SHA256 is
`309813c8de1ca93c0e6ad84d9cf23d785b5de37a5624e8c35723086f04a7fcdb`.
Final 26 quality and benchmark evidence are separate, preserving rather than
overwriting the intermediate results.

[Intermediate25 benchmark evidence](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-runtime25-benchmarks.json.gz) retains
all four failed manual campaigns, the separate canary, whole 27 memory and the
three Architecture cost experiments. Its deterministic gzip is 4,703,503 bytes,
SHA256 `74a12d3683d19a9060a2238883acb9164530254111ce0ab91a67d7155beed604`.
Lossless string/container interning reduces the original 12,496,840-byte gzip
by 62.36%, without removing any field. It restores the exact 80,516,503-byte
canonical JSON, SHA256
`e12d910a2e29a9b85c0a4f4c679de0c24a58bbe26d04de8e6bf15ba14d4ed1cd`,
including all 695 content-addressed bodies and 1,530 original-file index entries.
Full SVG bodies were already explicitly projected to hash/size before interning;
that projection remains distinct from the subsequent lossless compression.

The wrapper documents `lossless-json-intern@1` and embeds its reference decoder.
The formerly linked standalone `decode-layout-evidence.py` was not retained in
repository history, so this checkout does not provide that expansion command.
Do not execute embedded decoder text from an untrusted archive. The recorded
canonical/content hashes remain evidence for the original expansion, rather
than a claim of current standalone reproducibility. Quality archives and
historical guidance use ordinary gzip JSON and need no interning decoder.

[Experiment evidence (gzip JSON)](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-followup-experiments.json.gz) contains
the original declarations, interruption observer, worker results, assessments
and rejected payload reports. It projects 432 full SVG strings to SHA256 and
UTF-8 size while preserving all measurements, receipt/decision/certification
fingerprints and original file hashes; its representation field documents this
projection. It is compact evidence, not a byte-identical copy of those raw JSON
files. The original files remain in the task workspace.

The original four-arm declaration SHA256 is
`6b1d18f2de6f5a33299c167365e2ac704af891e63027dbe1674b6846ba728810`;
the separate native-only declaration is
`c2c88d055c16f64de43f0a2e1d5c8a27ae5a07c100180a05b9b4ab13f2b5b5ce`.
The complete native-only assessment SHA256 is
`4bacea77425e1e30552c68a052f07cdfedf8e6c6fcaf7d85f2c60ee69b18fa11`.
The compressed evidence SHA256 is
`6c258bd4290d9139b4b6070b8c71505e0d82c7ffcc8083b4acba4026a7c03f86`.

Historical benchmark evidence is now
[lossless gzip JSON](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-guidance-benchmarks.json.gz), with compressed SHA256
`bf34ecbb2ac7816defc571c0c386d445fae7e2b27eedf73fb37948d1104a93ee`.
Its uncompressed SHA256 remains
`64a39f5ce73ebd2fc6fd506bc8ff1c8369afac19f8c2c613a483c0a87fac6e35`.
