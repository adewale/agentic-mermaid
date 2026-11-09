# Owned marker-view reuse and spatial peer queries

Production candidate uses per-owned-pass prepared peer views with a packed BVH, explicit dirty-edge invalidation and the original exact narrow phase. These measurements separate its helper benefit from the actual full-product path. No100ms or replacement-readiness claim.

## Marker helper: demonstrated removal of repeated work

Four fresh serial Node24 source processes in ABBA order: live/indexed/indexed/live.96roster edges with separated canonical end arrows and changed terminal orientation; each pass consumes96full blocker objects and96Boolean results. Same geometry, proposals, semantics, live implementation and candidate resource generation in both arms. Firstpass includes lazy index/view construction; warm passes reuse one synchronous owner context. Edit shifts one peer and explicitly invalidates it. No persistentcache. Module import/explicitGC/artifact writing are outside timers.

| Helper phase | Live ms (2replicas) | Indexed ms (2replicas) |
|---|---:|---:|
| first-owned-pass | 158.42, 152.42 | 14.33, 13.19 |
| warm1 | 102.50, 94.68 | 6.06, 7.68 |
| warm2 | 78.64, 88.79 | 4.48, 4.49 |
| edit-one-peer | 138.71, 180.02 | 4.94, 4.81 |

All3072individual blocker/Boolean API results (4processes×4passes×192calls) are byte-equivalent as consumed JSON results; allblockers undefined and allcleartrue. This demonstrates faster repeated admission on this separated-marker kernel, not rendered output correctness or a production workload speedup.

The implementation retains O(E) marker views/tree storage for the owning pass and may cost more for few queries. Recursive BVH construction uses sorting/slices: O(Elog²E) comparison work and O(ElogE) temporary ordinal allocation; it is not a linear build. Changed-edge refits are O(logE) per occurrence.

Memory is mixed: kernel peakRSS84.63–86.99MiB indexed vs92.62–94.52live in these process lifetimes; post-edit heap18.43MiB indexed vs16.61/18.29live is adverse. ExplicitGC is before each phase, not after; postphase heaps include garbage, retained result arrays, source loader and JIT. No retained-memory ratio/leak claim. Packed tree itself additionally retains~8KiB bounds+1KiB ordinal lookup+384bytes leaf lookup at96edges(capacity128), plus views/maps.

## Native100-node fan: no attributable improvement

Existing fullSVG+entire-receipt sourcecollector, cache0, sampling/observers off; one serial before/after process pair. Baseline loads all8recorded pre-marker source overrides at `cb4204a50`; candidate loads current production sources. Sourceimport is separate; allcapture/proof limits unchanged.

| Phase | Before ms | After ms |
|---|---:|---:|
| cold-render | 558.43 | 504.65 |
| repeat1 | 311.10 | 252.02 |
| repeat2 | 322.43 | 230.07 |
| edit | 335.35 | 260.67 |

Every original/edit whole SVG and entire receipt is byte-exact across before, candidate and instrumentation-only diagnostic (24productfile comparisons). All12enrolled fullproducts return with unverified OUTPUT_SCOPE/CHECK_BUDGET400000operations. Actual finalink correctness is not established by those unchanged products.

Independent actualpublic-entry diagnostic (fivecompletecalls including collectoruntimedcacheaudit): **992 marker-blocker entries, 5 contexts created, 0 peerqueries, 0 prepared snapshots**. The publicfan stays on unchanged-marker fast paths and never builds the new index. Its elapsed timing difference cannot be attributed to marker-view reuse. Nopublic speedratio or100msclaim.

The next meaningful production performance case must actually produce changed-marker peer queries; do not replay this fan as optimization progress. Shared immutable paint capture remains a separate measured bottleneck and proof-cap limitation.

Artifacts: MARKER-RUNS.json, MARKER-COMPARISON.json, unchanged-sourcecollector, kernel harness using actual production guards, baseline8module overrides, counter-only sourceoverride, fullproducts and memory/cost rows. No source changes, commits or pushes by profiler during this acquisition.
