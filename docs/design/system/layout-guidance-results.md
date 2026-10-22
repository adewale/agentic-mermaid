# PR449 guidance follow-up: runtime24

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

The [machine-readable evidence](layout-guidance-results.json) retains all pilot
rounds, rejected arms, quality/admission changes, adverse metric cases, edit
comparison and raw-file hashes. The [runtime23 report](layout-experiment-results.md)
remains historical evidence, not a relabelled runtime24 benchmark.

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

After freezing geometry, the predeclared fresh SHA256-counter seeds320–383 run
on both baseline and candidate. Native succeeds on 64, ELK on 63; ELK seed325's
paint rejection is retained. There are no before/after outcome changes. On the
63 common successes, native/ELK crossings are **512/1,827**, label conflicts
**0/95**, parallel spans **0/29** and opposing spans **0/19**, without a per-case
loss in these measures. Native has **29 more-bend, six longer and 14 larger**
cases. Generated paint certainty remains incomplete.

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

The [label-aware compaction literature](https://www.mdpi.com/1999-4893/9/2/22),
[routing/crossing research](layout-exploration/layout-literature.md) and
[mental-map evidence](layout-exploration/stability-certification.md) support
retaining constraints and measuring final geometry and edits independently.
[Mermaid8368](https://github.com/mermaid-js/mermaid/issues/8368) illustrates damage
from straightening a reserved label route; [Mermaid815](https://github.com/mermaid-js/mermaid/issues/815#issuecomment-1717860019)
illustrates edit-order disruption. These motivate ownership and witnesses, not
weaker geometry checks.

The [community comparison](layout-community-comparison.md) and
[inventory](../../mermaid-community.json) still distinguish complete renderer
costs from small mount runtimes. Pele/Ondine suggest family boundaries and
compilation; Zombie demonstrates explicitly narrower optional solving; Merman
demonstrates lifecycle/request ownership and selected-family builds. This
follow-up does not rebenchmark or establish superiority to those implementations.
Reducing to Flowchart would retain every measured cyclic tail, while the resolved
ER40 blocker no longer justifies quarantining ER. Keep the existing six-family
opt-in scope; neither expansion nor a default switch is justified.

## Frozen full benchmarks and delivery

Full27 release, native23 A/A/differential, supplementary Architecture and cache
churn results are pending execution. The [review protocol](../../../eval/benchmark/layout-runtime-review.md)
fixes three rounds, 25 repetitions and 480,000ms per cache-policy campaign. It
preserves failed and incomplete populations, and separates 96-source historical
churn from new 129/256 actual-geometry-key churn. Workflow success alone is not
qualification: read support, A/A, per-case tails and matched memory gates.

Payload caps are unchanged. Architecture's budgeted solver closure measures
**573,455 Brotli bytes**, leaving **545** under its 574,000-byte cap. The
standalone editor measures **4,098,285 raw /1,229,250 gzip bytes**, leaving
**1,715 raw bytes** under its unchanged cap. Both improve on the previous
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
artifact unchanged. No all-aspects ELK win is claimed.
