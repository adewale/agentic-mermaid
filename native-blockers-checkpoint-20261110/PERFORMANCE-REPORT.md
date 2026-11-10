# Performance blocker: investigation stopped without a sufficient fix

The100-node<100ms finish condition is NOT met. No new lane/crossing index, cache, work-cap/default change or performance production edit from this run ships. Existing per-edge marker views/BVH from10253 remain. The two compound correctness fixes are independently committed; do not describe them as closing the performance request.

The historical1.0s/0.57s/7.3s workload sources and environment are unidentified. These measurements use named retained chain100/fanin100 inputs plus an explicitly generated chain300, not a claimed replay of those timings. Every fresh Node process consumes SVG, serializes the entire receipt AND the complete response. Module import, explicit GC, compression and artifact writes are outside render timing; cold first-render, warm/cache0 and edit are separate. Existing `native-only-20261109/worker.mjs` is unchanged. All jobs/overrides, RSS/heap observations, original errors and adverse samples are retained.

## Profile before edits

Fresh7257 chain100, three analyzed calls (repeat1/repeat2/edit), source maps and raw CPU profiles retained. Mean sampled self/inclusive milliseconds per call:

|Frame|Source|Self / inclusive ms|
|---|---|---:|
|copyInner|scene/native-paint-emission.ts:105|29.74 /36.08|
|assessLayoutGeometry|layout-rubric.ts:493|6.29 /15.24|
|verifyDocumentEnvelope|output-security.ts:326|4.59 /10.42|
|measureRubricMetrics|layout-rubric.ts:648|4.54 /22.39|
|copy|scene/native-paint-emission.ts:243|4.46 /36.88|

Inclusive weights overlap; samples are attribution, not removable wall time. `analysis.json` retains gap sensitivity and transformed source mappings. The corresponding instrumented placement is0.58–1.04ms; layout35.96–63.14ms; drawing112.29–172.64ms across the four observed warm/edit calls. Drawing alone exceeds100ms in this run. Eliminating layout cannot establish the target for this measured path. No expected safe speedup is invented.

The existing text-copy plans retain immutable descriptor instructions within an emission, while still constructing fresh receivers. Existing positioned-layout/native-drawing/paint-certification caches can hide repeated producer/consumer work. Cache-off measurements and the previous detailed cache inventory in `native-complete-20261110/perf/REPORT.md` remain separate. No additional cache is proposed.

## Tested and reverted

1. A private Native route/label BVH for lane blockers and proposal crossings, sharing existing plain-geometry admission and invalidated on route/label writes, in-place edits and rollback. Unknown/custom/borrowed data keeps live scans. Whole products match, but the route-only ablation does not establish a full-response improvement. Temporary storage isO(E), constructionO(ElogE); this added memory/code is not justified by the measured result.
2. A general global crossing BVH over captured segment boxes. Dense fan boxes cannot prune, so tree construction, candidate allocation and sorting add cost. The first combined trial's fan warm median240→293ms is adverse. A reviewer also found observable `involved.has` callbacks disappeared on pruned pairs; the targeted RED probe changes crossing0→1. The later trial restores the original callback path. All versions remain recorded; none ships.
3. Replace the costly global BVH with the existing bounded CSR lane index over capturedYintervals. Restore original peer order and exact predicates; preserve callback and extreme arithmetic fallbacks. Sparse chain discovery prunes many pairs, but the following full-response results still do not establish the requested improvement. All changes and their owning tests are reverted, including the new private index module. No hypothesis is kept alive by an isolated helper speed result.

Final CSR experiment: two fresh processes per arm/input, orderABBA, four warm observations and four edit observations per arm. Medians below; all ranges and cold costs remain in `FINAL-INDEX-ABBA-SUMMARY.json` and `FINAL-300-ABBA-SUMMARY.json`.

|Input|Before cold ms|Trial cold ms|Before warm ms|Trial warm ms|Before edit ms|Trial edit ms|
|---|---:|---:|---:|---:|---:|---:|
|chain100|426.72|370.68|176.20|178.62|176.68|183.91|
|fanin100|570.36|499.52|241.82|233.76|250.27|277.31|
|chain300|694.77|647.39|432.84|428.34|377.93|402.92|

The before chain warm375.07ms and trial chain300 warm522.28ms outliers are retained. Cold observations improve in this small sample while edits worsen; no uniform ratio or retained-memory reduction is claimed. `INDEX-MEMORY.json` preserves heap-used snapshots and process cumulative RSS high water, including harness/import/artifact effects; these are not retained-heap or renderer-only peak measurements.

All30 paired products match whole SVG AND entire serialized receipt (60/60 stream comparisons). All60 timed calls return unverified at400000 operations before completed occlusion; these are not proof passes or established visible correctness. The final source does not include these experiments. A long Class child timed out during trial qualification; its restored-source exact retry passes. That event remains adverse evidence, without claiming the timeout isolates one index's cost.

Untimed instrumentation confirms chain100 invokes zero proposal peer queries, whereas fanin100 makes45 across cold/audit renders and builds two peer trees. Global fan discovery still visits262554 pairs across six calls. This disproves the assumption that the new peer index alone removes the dominant measured work. Diagnostic-source counters and cache-audit artifact-read errors are kept separate from the timing windows.

## Remaining cause

The requested marker/lane/crossing intervention does not close the full-response deficit. Shared native-paint capture, resource/context processing and XML/security work dominate. Prior text-only, literal-only and legacy-completion removal probes were already insufficient and were not replayed as progress here. A sufficient next intervention must remove duplicate producer/consumer work across that boundary while retaining fresh receivers, getter/reflection/UTF16/CSS/definitions isolation and all original work accounting. This report does not authorize skipping those contracts or claiming the performance blocker fixed.

One final source-only UNSAFE causal bound forces native capture exhausted from
the beginning, bypassing its entire obligation. Five actual SVGs remain exact,
but receipts/work/proof custody change, so it is not equivalent work and never
ships. A single fresh process measures warm111.21/93.66ms and edit80.63/86.07ms,
cold297.88ms. These are not accepted performance results or a speedup ratio.
They confirm that the capture boundary contains enough cost to investigate;
they do not supply a safe implementation or establish the100ms finish condition.
The override, all products and differing receipts remain in
`UNSAFE-capture-ceiling/` and `UNSAFE-CAPTURE-SUMMARY.json`.
