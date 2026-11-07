# Profile before endpoint-packing intervention

Revision780b5f1b04ac7ac5db35cdd442d98df652daf17d; Node24 existing collector, Native SHA201 literal input. One complete unprofiled warmup, then two full SVG/entire-receipt repeats and an authored-label edit. Cache0. Imports, explicitGC and compression are outside measurement. Repeat walls308.833/323.239ms; edit275.515ms. This does not measure cold/import or cache1.

V8 elapsed sample-delta weights, aggregate across three calls; not exclusive CPU durations or independently removable time. Self is leaf attribution; inclusive is stack presence, so do not sum inclusive rows. Raw profiles, source maps, heap/RSS and reliability details are retained in profile-before and analysis.json.

| Measured spot (original source before intervention) | Aggregate self / inclusive ms | Matching case and next causal probe | Expected speedup |
| --- | ---: | --- | --- |
| layoutLayeredGraph — layout/agentic-layered-core.ts:102 | 66.660 / 234.858 | Data-oriented: already integer-indexed typed scratch; isolate repeated graph traversal before considering compact adjacency. No measured hash/AoS bottleneck established. | Unmeasured |
| copyInner — scene/native-paint-emission.ts:105 | 53.031 / 67.307 | Data-oriented snapshot traversal: retain owned immutable capture, UTF16/getter/alias contracts; establish redundant field visits before changing layout. | Unmeasured |
| countPolylineCrossings — shared/edge-crossings.ts:131 | 27.432 / 47.570 | AoS→SoA candidate: segments carry point references plus bounds; broad phase reads bounds. A flat bounds/index trial must preserve exact contacts, ties and cap charging; no measured benefit yet. | Unmeasured |
| refinePrivateChainOrder — layout/chain-insertion-order.ts:4 | 23.691 / 34.770 | Data-oriented: indexed adjacency already; isolate repeated scan/score work before redesign. | Unmeasured |
| crossingScore — layout/agentic-layered-core.ts:472 | 23.213 / 23.492 | Data-oriented: already Uint32Array order/tree work, no hot hash access or sequential awaits. Probe score traversal volume before changing representation. | Unmeasured |

Existing caches and evidence flags are inventoried in docs/design/system/layout-0.6-performance-review.md (layout/completed-product, text/numeric, appearance/route, admission/writing/inspection groups). Positioned-layout cache hits hide production on repeat workloads; the evidence does not establish a slow-design diagnosis for every cache. This cache0 targeted run retains derived text/paint caches after warmup. No cache is added and no optimization speedup is promised. The endpoint correction adds bounded measured support preparation and changes output; before/after latency is not an equal-work performance ratio.
