# Profile before the contact-work intervention

Source6aa0ee45d9b6052addcb77036c1f7ba4c13b2cb4, Node24 source runtime, existing worker/analyzer. Each call fully consumes SVG and entire receipt. Explicit ELK cache0. One complete unprofiled warmup then two repeats and one authored-label edit; imports/JIT warmup, compression and explicitGC lie outside measurement. No concurrent tests or other builds ran.

Case230 repeat means, elapsed sample-delta weights in milliseconds (self / inclusive). These are sampled stack weights, not exact exclusiveCPU durations or independently removable costs.

| Frame and source line | Self / inclusive | Matching requested case and change | Expected speedup |
| --- | --- | --- | --- |
| layoutLayeredGraph, src/layout/agentic-layered-core.ts99 |14.514 /57.993|None/data-oriented; measured broad placement frame does not isolate a hot hash primitive. No change justified here.|Unmeasured|
| copyInner, src/scene/native-paint-emission.ts105 |11.797 /15.757|None/data-oriented; mutable/getter/ownership copy is required. No safe redundant copy established.|Unmeasured|
| countPolylineCrossings, src/shared/edge-crossings.ts131 |8.579 /15.014|None/data-oriented; no demonstrated primitive or AoS-to-SoA opportunity in this profile.|Unmeasured|
| collectLaneBlockers, layout/route-lanes.ts:215 |8.070 /10.975|None/data-oriented; broad blocker collection, not evidence to repack indices.|Unmeasured|
| include, src/scene/bounds.ts358 |7.205 /12.617|None/data-oriented; original unused hull was already removed. No new removable projection shown.|Unmeasured|

Case372 contact safety pass is about2.059ms inclusive/call; contact helper1.572ms. It is not an end-to-end CPU hotspot. Case230 is an existing visible failure within the existing circle domain:0.453px overlap, proofU362041; ELK alternateP. Three internal candidate traces show the selected pass detects it at6037 remaining but proposals exhaust to−219. The selected context constructs111 supports,105 from two-point arrays, while only15 of127 shaft queries hit the existing memo. Source blockedBy creates fresh[a,b] arrays for each node even when a trial's same segment was just projected. Test producer-owned reuse of the two-point inputs within one trial, not full-route semantics or a cache addition. No forecasted CPU ratio or resource savings is asserted before the probe.

Current call-local caches: circle geometry Map and shaft WeakMaps in graph-paint-support.ts85. The shaft memo's point-identity misses mask repeated construction; adding a cache is rejected. Historical full cache inventory remains in docs/design/system/layout-0.6-performance-review.md. Layout/ELK/text/security caches retain their prior scope; no newly measured slow-design attribution follows for them. There are no independent sequential awaits in this synchronous target.

Profile reliability: case372 repeat/edit wall239.5/243.4/231.4ms, maximum elapsed sample gaps94.83/54.56/57.38ms; case230 repeat walls311.4/260.6ms and edit406.1ms. All raw deltas, maps, RSS/heap and products remain. Long gaps and variation prohibit a speedup claim. Edit outcomes remain separate:372 edited proofP, originalU;230 original/editU. Unchanged repeat products are validation only.
