# Geometry-owned route indexes and proof reuse

The route experiment preserves the enrolled geometry and certification outcomes.
Its prototype reduces changed-mesh post-solver time, but the final built-package
experiment does **not** qualify a latency or peak-RSS advantage: every relevant
repeatability control fails. Keep PR449 draft, Native opt-in, and ELK default.

## Implementation and ownership

The measured final source is `5cf9fa2aaf1d5578e821fdab4c596f1be8adf508`, based on
public PR449 `296455e9a10a2b7c1c803213fbd0d221c295b010` / main
`2cff725d219c75b75593b1d3e9bacd74cba7a08e`. It pins stock ELK 0.11.1; no pruned
compiler payload is used. Later documentation does not change that measured source.

| Work | Implemented behavior | Evidence and limit |
|---|---|---|
| Node obstacles | Build bounded flat cell/CSR indexes once per owned node geometry, lazily per cross axis; retain authored ordinals and exact predicates. | Fewer than 32 nodes, unsafe numbers, excessive span or membership fall back to the original scan. Earlier operation census: 4,589,027→2,716,917 node visits; operation counts are not CPU or allocation measurements. |
| Route channels | Cache conservative route envelopes in a context-owned WeakMap. Delete the entry on route replacement, in-place endpoint repair and rollback. | Exact segment predicates still decide collisions; live labels retain their original order. Non-finite geometry falls back. No cross-render cache or topology-only geometry reuse. |
| Candidate search | Reuse a Boolean first/source-leg proof only within one immutable Z-route search. Key by source candidate, jog position/value and original versus label-stripped probe. | Candidate order, ties, label ownership and exact comparisons remain unchanged. No proof survives acceptance of a geometry write or another search. |
| Crossings | Reuse the unchanged route's count within its search; reject after a complete deduplicated pair count exceeds the allowance; omit counts that occlusion repair never uses. | Early exit is only an inequality proof. Full certificate collection remains complete and ordered. |
| Allocation subtraction | Use only side occupancy for the side allocator; build node maps directly; remove redundant geometry wrappers, revision counters, point references, proof state and duplicate fallback code. | No experiment selectors, environment switches, old Map implementation or prepared-crossing helper remain in the final source. |
| Host compatibility | Keep borrowed placement contexts live; bypass geometry/proof caches when custom measurement is active. | Callback mutation, errors and re-entry are observable behavior. Removing the custom-host bypass fails an owning clearance regression. |

These caches are owned by a route-contract invocation whose node geometry is
fixed. A route envelope entry represents the current route revision because every
owner write invalidates it. Standalone endpoint cleanup runs outside these private
contexts. Label positions are deliberately not retained in the envelope cache.

## Comparison with earlier experiments

The exploratory stage study enrolled 24 distinct sources: mesh50, labelled mesh120,
tree50 and dense96, in TD/LR, each original, changed-label and changed-node. It
captured actual production pass contexts for both backends and cache policies.
Deserialization, equality checking and I/O were outside the stage timing; index
construction and the actual pass were inside. Solver, parsing and surrounding
pipeline work were outside. One warm and two timed passes used a fixed rotation;
this was not a randomized or position-balanced engine benchmark.

The completed confirmation retained 14,400 stage records / 9,600 timed records,
480 reference contexts and 960 complete public packets. The worker checked exact
graph values, aliases, order and numeric identity. Actual mutated stage contexts
were not individually retained, so independent readback verifies those worker
assertions and all retained public packets, not a reconstruction of every stage
output. V8 serialization bytes are not a canonical encoding of equal arrays.

Prototype `f614be523c8d0c41f4521fbc2c671e4747d72db3` includes other private
experiments absent from final source 5cf. These within-prototype ratios therefore
do **not** measure the final built package. Ratios below compare each mechanism
with the same prototype's OFF control; lower is better.

| Changed labelled mesh120 post-solver wall time | Native off | Native normal | ELK off | ELK normal |
|---|---:|---:|---:|---:|
| Earlier Map/search index | 0.9192 | 0.9104 | 1.0875 | 1.0682 |
| Revision-owned channel envelope alone | 1.0038 | 0.8725 | 1.0411 | 1.0385 |
| Revision envelope + crossing + source-leg proofs | **0.6277** | **0.6276** | **0.8891** | **0.8540** |

The changed-mesh cells pass the exploratory wall and CPU A/A guard of 0.9–1.1.
Native's combined mechanism saves about 37% of this stage's time on these inputs;
the isolated envelope is not consistently beneficial. Across all stage frames the
combined ratios are 0.6214/0.7530 Native off/normal and 0.8513 ELK off. ELK normal's
aggregate 0.8540 is unavailable: A/A wall1.130859 / CPU1.114199 fails. In total,
13 of 40 exploratory groups fail controls; all remain in the record.

An earlier attempt failed its 300-second worker limit. Its per-query route-bounds
variant was adverse at 2.1319×, and prepared crossing bounds did not help. That
failed attempt was retained; the narrower confirmation was a separate prospective
study, not a repair or dropped tail. Prepared crossing bounds and per-query index
construction were excluded from the final implementation.

ELK's 24-case stage workload includes five typed SVG certification refusals and
12 unverified SVG results per policy; Native has 24 passed SVG results. The ELK
changed-mesh group includes a refusal, so its ratio is not a successful-render
speed claim. Native's combined changed-mesh post-pass still takes about
1.96× off / 2.12× normal the absolute ELK post-pass time in this prototype.

## Final canonical package qualification

The final source was rebuilt through all six canonical build commands and then
qualified against the unchanged public ELK 0.11.1 baseline. Each backend matches
its **own** baseline, not the other backend's geometry.

| Surface | Result | Limit |
|---|---|---|
| Owning route/index tests | 295 tests / 23,031 assertions across 10 files; canonical core/repository types, full lint and diff check pass. | Behavior guards, not a claim that output-preserving optimization must fail the old implementation's assertions. |
| Canonical Node | All eight slots complete; 300 complete values / 1,200 UTF-8 comparisons plus 60 host cases pass. | Finite enrolled outputs, including identity, order, callbacks and errors. |
| Actual lazy Chromium | 120 paired cases / 232 UTF-8 comparisons plus two fresh-context fault recoveries pass; independent readback compares 122 value graphs. | Default forest→ELK→HTML demand chain remains unobserved. A failed ESM import stays rejected in that context. |
| Actual IIFE | 30 tests / 279 assertions, including 23 registry families and DOM checks, pass. | An initial zero-test harness rejection is retained. Individual SVG packets were not separately retained for independent readback. |
| Delivery | Original 23 strict caps and 78 request comparisons pass. Architecture Native 252,087 / ELK 569,881 Brotli bytes, 35/34 requests. | Native selected-demand closure is 55.8% smaller, not a whole-package saving. Both closures grow941 bytes versus public 0.11.1. |
| Standalone delivery | IIFE 3,797,769 raw / 1,195,002 gzip9 bytes; editor 4,074,646 raw / 1,222,768 gzip9; original caps pass. | Both include fallback machinery; no general installed-memory or npm-tarball reduction. |

Three earlier source shapes passed builds but failed the unchanged Block delivery
cap by 56, 101 and 22 Brotli bytes. They remain failed. Actual removal of redundant
objects/state/method dispatch brought the final candidate within the existing cap;
no budget was raised.

Full75 paint certification is unchanged per policy: Native 65 passed / 10 unverified,
ELK 59 passed / 16 unverified. There are no failed paint certificates in this enrolled
75-input corpus. Unverified does not mean certified, and this is not universal
correctness parity with ELK or an improvement in layout quality.

## Final fixed-policy whole-product benchmark

All 72 fresh workers finish: six balanced blocks × six roles × two cache policies.
Each process renders all 75 ordered H27+D48 inputs with one warm and two timed
passes: 16,200 calls, including 10,800 timed calls. Complete SVG UTF-8 and complete
receipt JSON/UTF-8 production are timed; retained payload I/O is outside. Each
worker has 120 seconds and each policy 2,700 seconds. Actual policy totals are
979.343 / 924.898 seconds, off/normal. No profile, forced GC, A/A division, time
correction, retry or sample removal is used. The frozen assessor ran once.

B is public 3547 Native; C is final 5cf Native; E is final 5cf stock ELK 0.11.1.
ELK receives the same optimized postprocessing as Native. Each role has a fresh
same-build A/A counterpart. No private compiler specialization disadvantages ELK.

**Every performance endpoint is unavailable under the unchanged controls.**
Independent arithmetic matches all 800 assessor bands and all 320 endpoint
decisions. All 24 aggregate A/A bands, all 450 input/control bands and all six RSS
control bands fail their original gates.
The independent raw audit separately passes all 16,200 calls / 32,400 SVG and
receipt references, 10,800 private payload files against six genuine oracles,
all 72 source/lifecycle/journal bindings, deadlines, storage limits and cleanup.
Both physical SDKs and the identical stock ELK runtime files were checked. Raw
capture validity does not make the failed statistical controls pass.
The following medians are descriptive observations only, not qualified wins or
losses, allocated-byte measurements, browser timings or steady-state estimates.

| Descriptive ratio, lower is better | Cache off | Cache normal |
|---|---:|---:|
| Final Native / prior Native, whole75 time | 0.9323 | 0.9069 |
| Final Native / ELK, whole75 time | 0.7226 | 0.5176 |
| Final Native / ELK, H27 time | **1.0957** | 0.5773 |
| Final Native / ELK, D48 time | 0.6281 | 0.5148 |
| Final Native / ELK, six cyclic tails time | **1.5548** | 0.5264 |
| Final Native / ELK, process peak RSS | 0.6957 | 0.6961 |
| Final Native / prior Native, process peak RSS | 0.9670 | **1.0057** |

The uncached six-tail ratio is adverse in every block (1.1017–1.7114), but failed
controls still prevent a qualified causal comparison. Native's own uncached tail
median is 1.0079, also not the declared upper-bound benefit target≤0.98. Whole75
off C/E spans0.5317–1.3827 across blocks. Repeated identical builds vary enough to
invalidate broad claims; favorable aggregate medians cannot establish superiority.

Input screening also keeps the adverse observations. Native/ELK paired-block
medians exceed1.05 on9/75 off and1/75 normal inputs. Five off inputs exceed1.05
in every block: cyclic-labelled11,15,13,18-cuts and DAG seed2091 (96-node
complete-two-wide layers, alternating labels, LR). Seed2091 is also the normal
median loss at1.210. Against prior Native,26/75 off and21/75 normal medians
exceed1.05. None is a qualified regression because the corresponding controls
fail, but none is discarded or hidden by the favorable aggregate.

## Community, literature and next decisions

The latest PR449 comment points to Frankenmermaid's ordered flat incidence,
generation-stamped spatial queries and exact-dependency graph reuse. This work
applies ownership to the actual route lifecycle and accounts for construction,
small cases and live labels. It does not revive an old index merely under a new
name. Exact topology equality cannot authorize unchanged geometry or paint.

Relevant primary sources are [Adapton, PLDI 2014](https://matthewhammer.org/adapton/adapton-pldi2014.pdf)
(read sections 2 and 5.1–5.2: separate mutation from demanded recomputation),
[kinetic certificates, Basch/Guibas/Hershberger](https://www.ime.usp.br/~cris/aulas/19_1_6957/BaschGH-DSforMobileData.pdf)
(indexed introduction/conclusion only; full PDF fetch timed out), and
[PhysX single-object caching](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/SceneQueries.html#single-object-caching)
(test a prior blocker before traversing an index). These motivate local dependency
proofs, not approximate clearance, broad memoization or a general dependency graph.

The bounded source-leg proof is implemented and tested. A current-node Boolean
blocker witness remains an **untried** follow-up: recheck current membership,
incident exclusions and exact geometry, then fall back to the original query.
It must never replace the complete ordered certificate collector. Its failed-hint
checks, small/clear lanes and interactions with source-leg memoization need a
prospective operation census before a timing claim. Literature is not exhausted.

This experiment supplies no basis to expand Native to more diagram families or
remove ELK fallback. Earlier DAG-only restriction lost seven Native-only successes;
there is no new evidence to impose it. Pele and the community tools have different
contracts; their published numbers cannot qualify an equal-workload victory here.
See the [community comparison](layout-community-comparison.md) for historical
crossings, route complexity, Architecture and editing trade-offs, still unresolved.

Main advanced to `dce89b73d00bf9d4b8f847b1ab261d9c58e06083` during this benchmark
and merged #433. It changes shared provider replay, family/cache/render ownership
and the Boolean blocker collector. These changes are **not** part of source 5cf
or qualified by these measurements. The integration review must compose one
deferred error/provider identity, retain the YAML/native-or-forest/ELK/entities
demand chain and duplicate-provider rejection, then rebuild and requalify the
combined package. Reusing old percentages would be invalid. This draft does not
claim to have completed that new integration.

The repository readiness script passes the scoped source delta's secret/debug
checks and warns about its541 changed lines. Against newly advanced main, the
whole historical PR additionally flags existing imported public Codecov text and
a test's local `token` variable; this broader warning is retained, not represented
as a clean whole-PR readiness result. Full CI remains a separate current-head gate.

## Retained local evidence

These are local evidence locations, not committed derived artifacts or hosted
downloads. The frozen plan, raw worker payloads, failed attempts, once-run assessor
and independent audit outputs remain available in the execution workspace.

- Final source: `/tmp/pr449-route-lean-source-20261024` at 5cf9fa2a.
- Prototype confirmation: `/tmp/pr449-revision-stage-confirmation-v3-20261024`;
  independent review: `/workspace/pr449-frontier/revision-stage-confirmation-independent-review-20261024`.
- Six builds/delivery: `/tmp/pr449-route-lean-evidence-v4-20261024`.
- Node preparation and once-run assessment:
  `/workspace/pr449-frontier/route-lean-node-semantic-preparation-20261024`;
  independent review: `/workspace/pr449-frontier/route-lean-node-semantic-independent-review-20261024`.
- Browser/IIFE independent review:
  `/workspace/pr449-frontier/route-lean-browser-iife-actual-readback-20261024`.
- Fixed cost plan, raw 72 workers and once-run assessment:
  `/tmp/pr449-route-lean-fixed-cost-20261024`;
  method: `/workspace/pr449-frontier/route-revision-fixed-cost-preparation-20261024`.
- Independent fixed-cost payload/lifecycle and statistics reviews:
  `/workspace/pr449-frontier/route-lean-fixed-cost-raw-review-20261024` and
  `/workspace/pr449-frontier/route-lean-fixed-cost-statistics-review-20261024`.

To reproduce the owning checks, use Bun 1.4.2 on the measured source:
`bun test src/__tests__/node-lane-index.test.ts src/__tests__/route-channel-geometry.test.ts src/__tests__/route-contracts.test.ts`,
then `bun run typecheck` and `bun run lint`. The frozen external experiment plans
are review evidence, not a new supported benchmarking API. No new timing run was
performed to repair a failed control or select a favorable result.
