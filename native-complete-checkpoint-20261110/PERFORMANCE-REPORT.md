# Native complete-request performance investigation — 10 November

The requested fully consumed Native100-node warm/cache0 <100ms result is **not achieved**. No performance production change from this investigation remains in the worktree. No new cache, cap increase, default/version change, skipped security check, or timing speedup is proposed.

Provenance: HEAD10253d29dba24554008fc61c178abcf7cc0a47cf plus the coordinator's then-current Native integration. Every timing job records complete module overrides. `joint-*` and `profilejoint-*` sources bind the integration used by each acquisition; they are not later-head qualification. Coordinator edits and measurements used separate CPU windows. Source import is recorded separately from the first target render. All timed calls consume the SVG, serialize the entire receipt, and serialize the complete `{svg,receipt}` response. Compression, explicit GC and evidence writes are outside those render windows. Existing `native-only-20261109/worker.mjs` is unchanged.

## Stopped interventions

1. Owned immutable text descriptor lookup plus scalar dispatch subtraction: four-process chain ABBA. No stable full-product gain; all20 timed calls returned unverified at400000. Rejected source overrides/jobs and logs remain as `lookup-*`/`chain100-lookup-*` and `before-*`/`chain100-before-*`.
2. Private whole-TextMark scalar operands plus constructor shape tags: four-process chain ABBA. No sufficient gain. Independent review additionally found skipped inherited `identity`/`baselineShift` semantics, factory method observation, iterator and Number/WeakMap hook observations. The whole-mark bypass was stopped. Recorded snapshots retain this rejected design, not an approved candidate.
3. Narrow constructor-owned pixel-subtree materialization: public `marks.text`, renderer and factory behavior retained; exact constructor shape tags supplied fresh ordinary literal graphs without a second descriptor/definition traversal. Twelve-process chain/forest/fan ABBA below. Whole-product gain was not established across the inputs. Independent review requested paid fixed guards and captured constructor prototype references; these were not shipped. The entire trial, shape metadata, helper, added controls and scalar shortcut were reverted. `rejected-subtree-trial.patch` plus `rejected-final-native-text-operands.ts` retain the last reviewable experiment; exact benchmark versions are the `subtree-after-*` snapshots.

These are falsified candidates, not implementation milestones. The scalar shortcut was not isolated as a proven full-product benefit and was also removed.

## Narrow subtree full-product cost

Native (`agentic`), fallback none, layoutcache0. Two fresh Node processes per variant/input; four warm repeats and four edit calls per cell, plus two first target calls. All60 timed calls returned `OUTPUT_SCOPE` + `CHECK_BUDGET`, operations400000 and zero completed occlusion pairs. They are not visible-correctness passes.

| Input | Before cold ms | Trial cold ms | Before warm/cache0 ms | Trial warm/cache0 ms | Before edit ms | Trial edit ms |
|---|---:|---:|---:|---:|---:|---:|
|chain100|396.25–1557.23|382.18–399.43|176.47–225.65|171.90–196.22|172.80–281.06|151.90–193.06|
|forest100|396.38–416.26|396.94–406.90|184.21–199.19|176.92–209.79|156.39–204.10|155.68–240.76|
|fanin100|493.67–535.22|493.02–529.78|213.25–270.48|217.09–269.64|226.92–278.27|220.14–323.25|
The1557.23ms first-target chain observation and adverse forest/fan edits remain included. N=2/cell and elapsed/process CPU variation do not support a general ratio. All30 paired whole products in this trial have identical SVGs and entire serialized receipts. Across all three stopped interventions,50/50 paired SVGs and50/50 entire receipts are exact (`whole-products-comparison.json`). The60 measured subtree calls have twelve additional untimed cache audits; each audit returns and matches final edit2. Cache-enabled cost was not measured and is not blended with cache0.

Cache audit: backend-registry and capability-decision hit; positioned-layout bypasses (`elk-cache-disabled`); native-drawing and paint-certification miss; svg-inspection has repeated start-tag misses, one local hit, and a final-security miss. This is the existing inventory, not a new reuse mechanism. Raw RSS/heap observations are retained; no memory improvement is claimed.

## Current full-response profile

Two fresh profiled processes, chain100 and fanin100, after all performance edits were reverted. Five measured calls/process including first target, repeat1/repeat2, edit/edit2; existing analyzer reports repeat1/repeat2 and first edit only. Actual code is bound by `*-current-profile-job.json`. Sample intervals have61–124ms gaps, largely in inspector post; sampled weights are attribution, not exact CPU or removable wall time. `analysis.json` preserves active-gap sensitivity at1/2/5ms and all source maps.

| Input | Frame | Source | Mean self / inclusive sampled ms per repeat |
|---|---|---|---:|
| chain100 | copyInner | scene/native-paint-emission.ts:105 |28.26 /34.11|
| chain100 | attribute | scene/svg-writer.ts:487 |5.58 /8.77|
| chain100 | validateNode | scene/scene-validation-core.ts:768 |5.24 /17.82|
| chain100 | scanStartTags | svg-structure.ts:120 |4.69 /9.22|
| chain100 | copy | scene/native-paint-emission.ts:243 |4.60 /34.91|
| fanin100 | copyInner | scene/native-paint-emission.ts:105 |36.75 /44.39|
| fanin100 | crossingPoint | shared/edge-crossings.ts:73 |26.27 /51.05|
| fanin100 | localRays | shared/edge-crossings.ts:56 |8.94 /15.63|
| fanin100 | validateNode | scene/scene-validation-core.ts:768 |8.17 /23.59|
| fanin100 | crossing anonymous | shared/edge-crossings.ts:111 |7.25 /7.25|

Repeat2 instrumented stages: chain placement0.61ms, whole layout35.65ms, drawing136.23ms, security10.35ms; fan0.98/97.95/141.30/7.21ms. Inclusive weights overlap and cannot be added. Native placement is not the principal full-response deficit. Expected safe speedup/ceiling remains unknown.

## Bounded unsafe counterfactual and exact cap attribution

`UNSAFE-literal-noop-svg-writer.ts` removes **all** `state.literal` validation and fees. It is deliberately unsafe and never entered production. Even this zero-literal-cost lower bound cannot finish chain100: all five calls remain unverified400000/zero occlusion pairs. Its199.18/179.46ms warm observations are not an unprofiled before/after ratio against profiled measurements.

Non-timing bucket overrides use the unchanged collector, phases=[]; first source plus the collector's untimed edit audit execute. The audit intentionally lacks edit2 output and records an artifact-read audit error after returning a render, not a renderer failure. Exact source-call totals:

| Stage | Charged operations before exhaustion |
|---|---:|
| Capture, other (snapshots, roster, group custody etc.) |209748|
| Capture, emission context |54354|
| Capture, XML recording |7186|
| Finish, resources/other |42180|
| Finish, emission context |63084|
| Finish, XML projection before failure |23448|
| Total |400000|

Current capture alone consumes271288. Ordinary exhaustion is in `XmlLeafWrite.check` → `state.literal`. With literal work entirely removed, it still exhausts at399853 when `boundary` attempts184 operations for a raw group opening; it has not reached the final namespace parser or any geometric occlusion pair. The edited source independently reproduces the same failure class. `chain100-current-buckets.log` and `chain100-UNSAFE-literal-buckets.log` preserve full stacks and bills.

This disproves literal-only escaped-string reuse as a sufficient repair. The group's raw boundary/projection and remaining resource/context obligations require further producer-owned subtraction; simply eliminating layout cleanup or text literal checks does not establish completion. No claim that XML envelope checks can be bypassed follows from constructor geometry ownership.

## Review and owner checks

The stopped trial reached203 passing owning checks across scene-native-validation, scene-svg-writer and prepared-text, ten existing receiver/XML controls, and core typecheck. Those are experiment checks, not validation of a shipping optimization. Initial Sparse32 failure at paint-certification.test.ts167 is known before this investigation; two child-stdin EPERM failures are preserved in `owners-first.log`. Whole-mark review failures and the intermediate strict-fee control failures remain recorded. The attempted eslint command was unavailable (the repository uses Biome); no lint success is claimed for a rejected design. No whole100-node raster proof or compressed-network response qualification was performed here.

## Reproduction

From the existing evidence collector directory:

```
AGENTIC_MERMAID_ELK_CACHE=0 node --expose-gc worker.mjs OUT /tmp/pr449-week-comparison-20261101/native-complete-20261110/perf/chain100-current-profile-job.json
```

Use the corresponding cost/profile/counterfactual JSON for another enrollment. Jobs contain exact full sources/options/module snapshots. Replaying rejected packed jobs also requires their recorded companion `native-text-operands.ts` in an isolated source checkout because that new module was removed from production; do not restore it as a proposed fix. `run-subtree-cost.py` and `run-current-profile.py` are one-off orchestration of the same existing collector, not a new performance framework.
