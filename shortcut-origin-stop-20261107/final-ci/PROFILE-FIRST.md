# Targeted profile before the stopped shortcut trial

Revision3234, Node24 source runtime, existing collector/analyzer. One fully consumed unprofiled warmup, two same-input repeats and one authored-label edit; cache0. SVG and entire receipt consumed. Imports, artifact compression and explicit GC outside the timed windows. No after-profile/equivalent-work speedup is claimed.

Five largest aggregate source self frames across those three calls. Cells are sampled elapsed-delta self/inclusive milliseconds, not exclusive CPU durations or additive removable costs. Repeat and edit phases remain separate.

| Frame/source line | Repeat1 self/inclusive | Repeat2 self/inclusive | Edit self/inclusive | Matching case | Expected speedup |
| --- | ---: | ---: | ---: | --- | --- |
| layoutLayeredGraph, layout/agentic-layered-core.ts:99 | 19.485/59.467 | 20.006/60.751 | 25.390/83.119 | None/data-oriented; no removable-work or hash/AoS cause isolated. | Unmeasured |
| copyInner, scene/native-paint-emission.ts:105 | 10.964/16.584 | 12.579/14.783 | 27.914/31.639 | None/data-oriented; no removable-work or hash/AoS cause isolated. | Unmeasured |
| countPolylineCrossings, shared/edge-crossings.ts:131 | 11.911/17.503 | 14.861/20.487 | 14.798/34.508 | None/data-oriented; no removable-work or hash/AoS cause isolated. | Unmeasured |
| collectLaneBlockers, layout/route-lanes.ts:215 | 13.624/18.824 | 9.372/15.092 | 13.887/18.142 | None/data-oriented; no removable-work or hash/AoS cause isolated. | Unmeasured |
| obstacles, layout/route-lanes.ts:361 | 8.670/10.165 | 10.822/12.379 | 9.208/12.067 | None/data-oriented; no removable-work or hash/AoS cause isolated. | Unmeasured |

Wall observations: repeat364.978/361.490ms; edit469.119ms. Raw samples/maps, gaps, CPU/RSS/heap and complete products remain. No cold/import/cache1 latency was measured by this source-runtime collector.

The existing complete cache inventory stays in docs/design/system/layout-0.6-performance-review.md. The staged two-point WeakMap-miss hypothesis was already insufficient and is not replayed. No new cache, hash-table packing, AoS→SoA conversion or await parallelization was justified here. The experimental scalar participated in the existing geometry cache key; the entire experiment is reverted.

New causal evidence is geometric, not a CPU optimization: measured shortening creates152 stroke contact from an already-clear route. Its attempted clearance veto repairs that selected output but changes Native17 compaction/marker contacts; the introduced-only narrowing also retains those contacts. No runtime performance gain is shipped.
