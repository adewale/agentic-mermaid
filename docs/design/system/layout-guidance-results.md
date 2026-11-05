# PR449 guidance follow-up: runtime24

The initial review snapshot is `9ce3653f`. Independent review subsequently found
that its placement return omitted measured multiline group-header height: a
four-line band shrank from 74.8px to 28px even though paint certification passed.
The corrected renderer at `d645c8c5` retains that placement metadata without
changing full-graph frames. Failing-before/passing-after tests check actual SVG
band height, title bounds, padding and nested custom-font headers. The original
hosted run remains pre-correction evidence; the corrected-artifact benchmarks
are reported below. A new untouched counter384–447
holdout is declared after this correction; counter320–383 remains retained data.

Runtime24 gives Architecture an explicit unfinished placement contract. It
retains every relationship as a placement influence and lets the family own
final routes, authored sides, contact geometry and certification. The useful
measured improvement is smaller Architecture geometry and less local allocation;
neither the pilot nor the quality scores establish superiority to ELK in every
aspect. ELK remains the default, with native opt-in across six graph families.

This follows [the PR guidance](https://github.com/adewale/agentic-mermaid/pull/449#issuecomment-6349457023).
The integrated runtime23 baseline is
`2fe1079a1fcdbb673ceb76d07e6ee6f8d3ab7f21`, after rebasing onto main
`87c9c3174c0d4edc16c69c0da82b69a325cc32ec`. It already includes
[#465](https://github.com/adewale/agentic-mermaid/pull/465)'s actual junction
outline contacts and [#466](https://github.com/adewale/agentic-mermaid/pull/466)'s
shared clipping/label fixes. Their gains are not attributed to runtime24.
The integration also propagates family-owned custom placement sizes and updates
exactly one default geometry golden: the new PR fixture's junction ring is now
16×16 at its actual outline instead of its old 28×28 allocation box.

The [machine-readable evidence](https://github.com/adewale/agentic-mermaid/blob/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-guidance-results.json) retains all pilot
rounds, rejected arms, quality/admission changes, adverse metric cases, edit
comparison and raw-file hashes. The [runtime23 report](layout-experiment-results.md)
remains historical evidence, not a relabelled runtime24 benchmark.
The [final benchmark evidence (gzip JSON)](https://raw.githubusercontent.com/adewale/agentic-mermaid/a6b9b14161bd281804d5f2c9149320dfd882eb0f/docs/design/system/layout-guidance-benchmarks.json.gz) retains the
dedicated hosted campaigns, independent CI canary, per-case rounds and tails,
missing/failed gates, churn observations, artifact provenance and the separate
whole 27-input memory-only declaration and results.

## Guidance and experiments

| Guidance | Implemented or measured result | Acceptance and limit |
| --- | --- | --- |
| Architecture placement only | Private nodes/groups contract; no generic final routing, shortening, discarded receipt or certification. Original cross-scope relationships remain placement constraints. | Accepted. Cyclic/loop temporary geometry remains where placement scoring needs it. The family independently routes and certifies the final result. |
| Preserve contacts and sizes | Default/ELK/native/fallback custom 40px rings tested on all four sides; authored sides, marker/shaft contacts and empty scopes preserved. | Accepted. Styled paint that was unverified is not promoted to passed. |
| Fixed channel index | Per-search lazy index with exact segment narrow phase; no persisted mutable index. | Rejected. Cyclic18 allocation rises 9.4% at paired median; worst round +24.0%. |
| Exact-generation proof reuse | Immediate private candidate metrics; final independent proof retained; mutation/decline witnesses tested. | Rejected for this release. No robust net benefit; whole-pass allocation rises 8.6% at median. |
| Measure before sparse normalization | Evaluator-only source transforms record rank span, expanded/private vertices, candidate/scoped repetition and work use. | Accepted diagnostics. Final 40-input run has zero output/counter mismatches, including two deliberate declines. No production instrumentation or sparse rewrite. |
| Browser reserve | Omit unexposed conformance observations in lazy/editor builds, preserving evaluation, coercion, exceptions, every predicate and failure diagnostic. | Accepted narrow subtraction. Node/IIFE inspectors and editor schema help remain complete. Reserve improves but remains fragile. |
| YAML import subtraction | Named-import ablation, with parsing/writing tests. | Rejected and reverted: standalone unchanged, Architecture Brotli 43 bytes worse. |
| Full qualification and cache churn | Fixed historical27 corpus/edit population, direct native23 A/A/differential, supplementary Architecture sizes, actual cache-key/eviction probes. | Results are recorded separately below; a passed pilot cannot substitute for these campaigns. |

Architecture source case3 previously lost cross-scope placement influence through
an edge-filtered retry. Its area falls **1,040,650→410,916 (−60.5%)** and route
length **1,760→632 (−64.1%)**; bends remain four and crossings remain zero.
The other 12 Architecture SVGs and all 13 ELK SVGs are unchanged. Architecture0
and Architecture5 still each have one crossing where ELK has zero.

## Pilot and allocation limits

The predeclared six-input pilot uses three rounds, 15 timing repetitions,
independent time/memory workers, cache off, full SVG/receipt consumption and
native23 A/A. All five arms share one 480,000ms bound. It completes **30 workers,
zero failures, 257.85s**, with all artifact hashes unchanged. Only Architecture3
changes SVG, in all three Architecture-arm rounds. There is no ELK arm in this
pilot and no normal-cache speed claim.

Architecture per-input median allocation ratios are 0.902, 0.449 and 0.897 on
cases0/3/5. However, separately measured whole-six-input pass allocation is
**1.017×** baseline; proof reuse is **1.086×** and lane indexing **1.043×**.
Do not sum per-input medians or describe the local savings as an aggregate win.
Timing A/A is noisy: cyclic18 spans 0.849–1.133 and Architecture0's median is
0.856. Observed timings do not establish a latency improvement; A/A is a check,
not a ratio divisor. Retained-growth clamped zeros do not establish retention
improvements either.

## Quality, fresh holdout and edits

Final built-artifact replay enrolls 249 source/workload cases and 704 retained
generated cases per engine: native succeeds on all 953, ELK on 947. There are no
admission changes from integrated23. All 704 native generated SVGs and receipts
are unchanged; all ELK outcomes are unchanged. The only source change is the
intentional Architecture3 improvement. Receipt comparison normalizes only the
native implementation version.

After the initial freeze, the predeclared fresh SHA256-counter seeds320–383 run
on both baseline and candidate. Native succeeds on 64, ELK on 63; ELK seed325's
paint rejection is retained. There are no before/after outcome changes. On the
63 common successes, native/ELK crossings are **512/1,827**, label conflicts
**0/95**, parallel spans **0/29** and opposing spans **0/19**, without a per-case
loss in these measures. Native has **29 more-bend, six longer and 14 larger**
cases. These outcomes are retained as known regression data after the header
correction; their SVGs, receipts and admission are unchanged.

The corrected artifact is then frozen before inspecting a new declared
SHA256-counter window, **384–447**. Both engines render all 64 cases, with no
before/after outcome changes versus integrated23. Native/ELK crossings are
**539/1,958**, labels **0/105**, parallel spans **0/24** and opposing spans
**0/36**, without a per-case loss in those four measures. Native has **23
more-bend, two longer and 12 larger** cases. All 64 paint certificates from each
engine remain unverified. No tuning follows these observations.

Both cache policies' edit replays retain all **234 observations**, the same
strict-native hint decline and **36/36 undos**. SVG, public geometry, transition,
backend, admission and certificate outcomes are unchanged; full receipts differ
only by implementation version. Native aligned motion remains 13 better,
14 equal and four worse cases of 31 versus ELK. This is quality replay, not
incremental-layout or edit-latency proof.

| Source quality measure, 249 common successes | Native | ELK | Native per-case losses |
| --- | ---: | ---: | ---: |
| Crossings | 533 | 877 | 2 |
| Label conflicts | 0 | 38 | 0 |
| Parallel / opposing spans | 0 / 0 | 18 / 9 | 0 / 0 |
| Bends | 3,190 | 2,673 | 25 |
| Route length | 599,198 | 803,233 | 20 |
| Area | 84,494,457 | 107,123,368 | 33 |
| Passed paint certificates | 222 | 220 | Remaining: 27 native /29 ELK unverified |

## Profiling and the next mechanism to test

The six adverse cyclic cases still perform **17–27 complete normalizations**
per public call and allocate **1,388–3,049 cumulative private vertices**; the
largest individual candidate has only 75–234. Cyclic15 performs 27 normalizations
and builds 3,023 private vertices; cyclic18 performs 17 and builds 2,053.
Architecture0/5 each have only three private vertices across two normalizations.
Sparse normalization therefore targets a different mechanism from those
Architecture crossings. Measure repeated candidate construction separately from
edge-span expansion before choosing another representation. Keep exact geometry,
search bounds, independent final certification and adverse inputs as gates.

[Eiglsperger, Siebenhaller and Kaufmann's sparse Sugiyama representation](https://jgaa.info/index.php/jgaa/article/view/paper111)
addresses dummy expansion under its crossing model. It is a useful next
experiment if span dominates an individual candidate, but does not itself remove
17–27 repeated candidates. Label ranks, reversed/parallel edges and compound
boundaries must remain explicit; the paper's bounds are not yet this engine's
bounds. The failed lane/proof experiments argue for measuring each allocation
mechanism separately before retaining another cache or representation.

The [label-aware compaction literature](https://www.mdpi.com/1999-4893/9/2/22),
[routing/crossing research](layout-exploration/layout-literature.md) and
[mental-map evidence](layout-exploration/stability-certification.md) support
retaining constraints and measuring final geometry and edits independently.
[Mermaid8368](https://github.com/mermaid-js/mermaid/issues/8368) illustrates damage
from straightening a reserved label route; [Mermaid815](https://github.com/mermaid-js/mermaid/issues/815#issuecomment-1717860019)
illustrates edit-order disruption. These motivate ownership and witnesses, not
weaker geometry checks.

The [community comparison](layout-community-comparison.md) and
[inventory](https://github.com/adewale/agentic-mermaid/blob/ee9c9dc32f9bc3b47de2f5990bc1466b55815649/docs/mermaid-community.json) still distinguish complete renderer
costs from small mount runtimes. Pele/Ondine suggest family boundaries and
compilation; Zombie demonstrates explicitly narrower optional solving; Merman
demonstrates lifecycle/request ownership and selected-family builds. This
follow-up does not rebenchmark or establish superiority to those implementations.
Reducing to Flowchart would retain every measured cyclic tail, while the resolved
ER40 blocker no longer justifies quarantining ER. Keep the existing six-family
opt-in scope; neither expansion nor a default switch is justified.

## Frozen full benchmarks and delivery

The corrected renderer is frozen at review head `890abfa5`, with runtime source
at `d645c8c5`. All four hosted campaigns' 20 Node JavaScript hashes match the
local corrected24 snapshot; their baseline hashes match integrated23. The
recorded review protocol (`layout-runtime-review.md`, not retained in this checkout) fixes three
rounds, 25 timing repetitions and 480,000ms per cache-policy campaign. No failed
campaign was retried, reduced or given a longer deadline.

| Campaign | Normal cache | Cache off | Qualification |
| --- | --- | --- | --- |
| [Release versus ELK](https://github.com/adewale/agentic-mermaid/actions/runs/39855889129) | All 27 timings and 21 memory groups complete. Seven-corpus time **0.9803×**, pass allocation **0.9976×**, RSS **0.7929×**, retained growth **1.0091×** ELK. | All 27 native/fallback timings complete; all 21 native/fallback memory groups missing at the shared deadline; ELK A/A completes only two rounds. | **Failed** overall; normal-cache required gates pass. Time/allocation are effectively tied, with lower corpus-worker RSS. |
| [Direct native24/native23](https://github.com/adewale/agentic-mermaid/actions/runs/39855894579) | Seven-corpus time **0.9916×**, allocation **0.9998×**, RSS **0.9963×**; complete. | Seven-corpus time **1.0131×**; candidate memory entirely missing, baseline only 5/21 memory groups. Cyclic15 is **1.5234× ELK**, failing the unchanged 1.5× gate. | **Failed** overall. Normal-cache native24/native23 is effectively flat. |
| [Architecture supplement](https://github.com/adewale/agentic-mermaid/actions/runs/39855899813) | Per-case time **0.903× /1.027× /1.022×** ELK; allocation approximately equal. | Per-case time **0.389–0.416×**, allocation **0.473–0.493×**, RSS **0.754–0.824×** ELK. | All six paired reports complete; required gates and median A/A checks pass. Three scaling inputs, with no official-corpus aggregate. |
| [Cache churn](https://github.com/adewale/agentic-mermaid/actions/runs/39855904996) | Whole-population pass allocation native/ELK at 96/129/256 sources: **1.0013× /0.6959× /0.7193×**. | Corresponding ratios **0.6665× /0.6814× /0.7021×**. | **108/108 workers complete**, artifacts stable. Native24/native23 is approximately equal. No churn latency is measured. |

The time and memory aggregates labelled **seven-corpus** cover seven official
inputs, not a whole 27-input mixed session. Matched time has 525 samples
(7×25×3). The legacy 21 memory groups comprise one pooled seven-corpus worker,
19 individual scaling workers and one edit worker. Never sum per-case medians
or present these scopes as a full 27-input allocation aggregate. Allocation and heap
are GC-boundary estimates; RSS covers a whole worker. Clamped zero retained
growth is not evidence of a retention win.

The independent [ordinary-CI canary](https://github.com/adewale/agentic-mermaid/actions/runs/39855841529)
retains the same adverse finding: cache-off ELK A/A times out, native memory is
missing and cyclic15's time ratio is **1.5015×** (rounds 1.4565/1.5015/1.5178).
Its reporting job succeeds, but its cache-off qualification is false. The
direct-differential cyclic15 replica is 1.5234×, with all three rounds above 1.5×;
the release run's 1.4929× does not erase those failures. The canary records the
source revision but lacks per-file JavaScript hashes, so its artifact binding
is weaker than the four dedicated campaigns.

Architecture's cached 16-junction retained-growth ratio is **1.706×**, while its
ELK A/A ratio is 1.739×: no reliable universal retention win is established.
Two normal-cache per-round timing controls spike to 1.180× and 1.124× despite
healthy medians; all rounds remain recorded. Cache churn confirms **129/256
distinct geometry keys** and **323/704 inner-LRU evictions**, including when the
outer cache is off. Historical 96 normal-cache sources do not evict the 128-entry
outer cache; their geometry cache does evict. Adverse churn cases include
cache-off 96 RSS 1.029× and cache-off 129 retained growth 1.020× native23.
Their corresponding ELK ratios are 0.7557× and 0.3189×. Exceeding the
cache capacity produces allocation savings, not across-the-board memory wins.

The [pre-header-fix run](https://github.com/adewale/agentic-mermaid/actions/runs/39852532569)
is preserved separately: release, differential and churn fail; Architecture
succeeds. Its continue-on-error step statuses do not change those saved outcomes.
It includes deadline exhaustion, an import timeout and cyclic15 gate failures;
it cannot qualify corrected geometry. All 108 pre-fix churn memory workers
finish, but source diagnostics fail: six cache-off256 failures, four normal129
failures and normal256 never launched within the shared deadline. The corrected
campaign's complete source diagnostics do not erase these earlier failures.

### Separate whole 27-input memory experiment

A new experiment was declared before execution using the unchanged stock
release memory worker, all 27 historical inputs in every worker, five arms
(ELK, ELK A/A, native23, native23 A/A, native24), three fresh rounds and the same
480,000ms shared deadline per policy. It completes **30/30 workers**, in 114.4s
off and 77.6s normal, with artifacts unchanged. The
original `layout-memory-only.py` runner is not retained in repository history;
the declaration/input envelope and recorded results remain in the evidence.
This is a reproducibility gap, not an available command in a clean checkout. There were no competing local builds,
tests or benchmark workers. This local Node 24.19.0 experiment is separate from
the hosted Node 24.21.0 campaigns and Node 24.22.0 CI canary.

| Whole 27-input mixed-session memory, native24 / ELK | Cache off | Normal cache |
| --- | ---: | ---: |
| Whole-pass allocation estimate | 0.9420× | 0.9935× |
| Pass peak-heap estimate | 0.7511× | 0.8669× |
| Whole-worker peak RSS | 0.9066× | 0.9915× |
| Settled-pass retained growth | 0.4257× | 0.7330× |
| Native24/native23 whole-pass allocation | 0.9818× | 1.0008× |

These are medians of same-round ratios. All declared aggregate A/A and candidate
gates pass, but normal ELK A/A RSS is **1.0989×**, barely inside 1.1×, and its third
round is 1.1160×. The cached RSS difference does not establish a win. Uncached
native23 A/A State per-input allocation is 0.8515×, and cyclic18-cuts has an A/A
round at 1.1905×; aggregate gates do not certify every individual measurement.

Whole-pass savings also conceal costly inputs: uncached native allocation is
**1.7823× ELK on cyclic11, 1.6094× on cyclic15, 1.5359× on cyclic13 and 1.4843× on
cyclic18-cuts**. Native24/native23 cyclic18-cuts allocation rises 5.1% at median
in this experiment, with the noisy control retained. Normal whole-pass allocation
and RSS are effectively tied with ELK, and new-versus-old native results are
mostly flat. No universal memory win is claimed.

Native settled-pass retained growth is 1.42–1.47MB uncached and 0.51–0.54MB cached;
this is growth after settling, not total resident/retained memory. Memory mode
does one warmup, per-input GC measurements and one complete measured pass;
the job's 25-repetition field is ignored by this mode. It establishes **no latency
result**, and cannot replace the failed legacy deadlines or cyclic timing gate.
Its worker consumes complete SVG/receipts but exposes no fingerprints in memory
mode; separate correctness/timing campaigns retain that evidence.

Payload caps are unchanged. Architecture's budgeted solver closure measures
**573,467 Brotli bytes**, leaving **533** under its 574,000-byte cap. The
standalone editor measures **4,098,345 raw /1,229,264 gzip bytes**, leaving
**1,655 raw bytes** under its unchanged cap. Both improve on the previous
30/219-byte reserves but remain fragile; deliberate maintenance headroom is
still open. The combined upstream baseline initially exceeded both caps, so its
574,114 Brotli /4,100,466 raw sizes are retained separately from this comparison.

Final validation passes core/repository types, Node/declarations/IIFE/lazy
builds, changed-file lint, 132 owning tests, the 319-case default geometry
baseline, targeted evaluator/projection tests, 47 Chromium contracts (1,006
assertions) and two standalone contracts (20 assertions). The final projection
test also preserves evaluation/coercion/throw order after minification. An
unprivileged child-process test failure is retained; it passes with the required
execution permissions. Browser projection changes leave every frozen Node JS
artifact unchanged before the header correction. The corrected renderer passes
115 owning tests and repeats the 47 browser/two standalone contracts. The
initial CI also passes all unit shards, semantic conformance, browser/package
E2E, payload and red/green lanes. Its quality gate's sole dependency-audit failure
is addressed by a three-line DOMPurify 3.4.16→3.4.17 override/lock patch; Mermaid
stays 12.2.0, the audit passes and 36 upstream compatibility tests pass. The
generated advisory remains red on known ELK quality gaps, not new renderer
regressions. No all-aspects ELK win is claimed.

Required [CI on frozen renderer head 890abfa5](https://github.com/adewale/agentic-mermaid/actions/runs/39855841529)
is complete and green: all required jobs pass, with 19 green jobs and the known
generated-layout advisory red. Ruff also passes.
The generated-layout advisory remains red on retained quality tradeoffs, while
the green benchmark-reporting job contains the failed uncached qualification
described above. These are separate outcomes.

## ELK assessment and remaining work

The owned engine has smaller selected-family browser closures, fewer aggregate
crossings/label conflicts/shared spans, useful uncached Architecture gains and
lower uncached whole 27-input memory estimates. It has **not matched or beaten ELK on
every aspect**. It still loses two source Architecture crossing cases, 25 source
bend cases, 20 route-length cases, 33 area cases and four aligned-motion cases.
Generated paint certainty and human readability remain unproven. Cached costs
are largely tied; uncached cyclic time/allocation tails and full qualification
deadlines remain open. The next cost experiment should isolate repeated
candidate normalization before changing sparse expansion. Keep ELK as default,
retain six-family opt-in, and preserve existing caps and final certification.
