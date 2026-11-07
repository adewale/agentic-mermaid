# Targeted before-profile at6edd

Existing Node24 collector: one complete unprofiled warmup, two repeats, one authored-label edit; cache0. Each call consumes the full SVG and entire receipt. Imports, explicitGC and artifact compression are outside measurement. No new cache or equivalent-work speedup is claimed.

Largest aggregate source self frames across the three calls; values below are elapsed sample-delta weights per call, not exclusive CPU durations or independently removable work. Repeat/edit raw phases and reliability gaps remain separate in analysis.json and the profile artifacts.

| Frame / actual mapped source | Self / inclusive ms, three-call mean | Matching requested case | Expected speedup |
| --- | ---: | --- | --- |
| layoutLayeredGraph / layout/agentic-layered-core.ts:99 | 20.174 / 69.077 | None/data-oriented; no causal hash/AoS/await deficit isolated. | Unmeasured |
| countPolylineCrossings / shared/edge-crossings.ts:131 | 11.310 / 14.962 | None/data-oriented; no causal hash/AoS/await deficit isolated. | Unmeasured |
| copyInner / scene/native-paint-emission.ts:105 | 8.871 / 12.510 | None/data-oriented; no causal hash/AoS/await deficit isolated. | Unmeasured |
| include / scene/bounds.ts:358 | 4.500 / 8.448 | None/data-oriented; no causal hash/AoS/await deficit isolated. | Unmeasured |
| minimumSpanRanks / layout/minimum-span-ranks.ts:22 | 4.470 / 5.169 | None/data-oriented; no causal hash/AoS/await deficit isolated. | Unmeasured |

The existing full cache inventory remains in docs/design/system/layout-0.6-performance-review.md. This correction reuses measured spans and the existing cache-keyed minimumPortSpacing; one per-request incident counter is not a cache. It adds bounded preparation work rather than claiming a CPU optimization. Cold/import/cache1 latency was not measured by this collector; after-case proof/geometry differs, so no timing ratio is valid.
