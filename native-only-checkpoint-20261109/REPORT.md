# Native100-node before profile

Revision `dee908197a8fe678d05cb6e1c6827d05ae9d4fb7`. Existing source profiler/collector, Native (`agentic`), fallback none, layoutcache0. Each completed call consumes the whole SVG and serializes the complete receipt. Source import measured separately. No optimization or speedup claim. Two fresh unprofiled process replicas per input; sampled calls are separate. Existing derived caches remain.

| Input | Cold target ms | Warm uncached repeats ms (4calls) | Edit ms (2calls) | Result |
|---|---:|---:|---:|---|
| chain100 | 325.63–377.09 | 145.76–214.75 | 144.29–177.60 | returned; proof unverified |
| forest100 | 368.40–403.15 | 171.30–186.39 | 172.84–193.25 | returned; proof unverified |
| fanin100 | 612.72–884.11 | 226.30–356.90 | 225.59–232.92 | returned; proof unverified |

Source import spans2201.81–2706.40ms and is excluded from targetrender durations. All original repeat SVGs and entire receipts byte-exact with their warmup. The36 enrolled calls are not proof passes: these100node products retain `OUTPUT_SCOPE` and `CHECK_BUDGET`; capture exhausts400000operations before occlusionpairs. Actual visible correctness remains unknown until inspected.

Exact counts:3profile processes×4calls(cold+repeat1+repeat2+edit)=12calls;6unprofiled costprocesses×4calls=24calls; all36return. Collector performs one extra untimed cacheaudit call/process; those9calls return but audit deliberately expects missing edit2artifact and records an audit error, not a rendering error. No edit2phase was enrolled.

Fan acquisition may overlap a coordinator250ms focused test; all raw observations retained and fan elapsed timings are provisional. Chain/forest were acquired without tests/builds; all profiles have long sampling gaps (57–117ms on these inputs). Sampled weights are elapsed interval attribution, not exact exclusive CPU or removable walltime. The1/2/5ms active-gap sensitivity diagnostics are in analysis.json.

## Five largest fan repeat source frames

Means over2profiled repeat windows; source maps retained. Inclusive numbers overlap and must not be added.

| Frame | Source line | Self / inclusive sampled ms per call | Matching case / proposed intervention | Expected speedup |
|---|---|---:|---|---|
| `crossingPoint` | `src/shared/edge-crossings.ts:73` | 33.55 / 57.41 | Data-oriented rewrite: specialize cardinalsegments before generic determinant/ray work, retaining exact endpoint/subdivision/tangency semantics. | Unmeasured; no numeric estimate. |
| `copyInner` | `src/scene/native-paint-emission.ts:105` | 33.38 / 39.52 | AoS→SoA at the owned emission producer: compact geometry/paint operand records to reduce repeated reflective copies; external mutable/accessor objects retain the defensive fallback. | Unmeasured; largest shared owner, not solved by marker cache. |
| `localRays` | `src/shared/edge-crossings.ts:56` | 11.46 / 17.00 | Data-oriented rewrite: reuse prepared routeendpoint/vertex coordinates; do not allocate ray/angle objects for rejected endpoint contacts. | Unmeasured; inclusive overlaps crossingPoint. |
| `validateNode` | `src/scene/scene-validation-core.ts:768` | 6.06 / 19.99 | Data-oriented rewrite: validate once at owned producer and consume retained typed fields downstream; keep external validation and mutation/ownership isolation. | Unmeasured; no authorization to skip checks. |
| `countPolylineCrossings` | `src/shared/edge-crossings.ts:131` | 5.15 / 58.09 | Data-oriented rewrite: compact segment fields; preserve existing x/y broadphase and exact narrowphase. Y-index only if candidate work actually shrinks. | Unmeasured; many fan candidate boxes overlap. |

The simple chain is dominated by shared emission capture: `copyInner`44.93self/54.06inclusive ms perrepeat; forest31.82/38.86. Chain `verifyDocumentEnvelope`326 is9.42/14.84ms; forest8.42/11.68. XML envelope checks must not be bypassed because source geometry is owned.

## First responsible stages and requested marker work

- Profile repeat2 Native placement is0.58ms(chain),0.50ms(forest),2.00ms(fan); whole layout45.05/44.31/114.29ms. Drawing245.83/173.99/158.18ms; security26.04/21.14/11.90ms. These are instrumented stage observations, not unprofiled ratios. Full product100ms target is currently unmet; solver-only already fast on these cases.
- `routeCandidateMarkerBlocker`, `src/layout/route-marker-clearance.ts:132–173`, reconstructs `markerView(peer)` at156 inside the changed occurrence×peer loop. A synchronous per-edge prepared view plus spatial peer query fits the owner request. It must invalidate after every accepted route mutation, preserve custom measurement/reentrant getters/style observation, preserve unknown mapping refusal, and retain exact ordered blocker/narrowphase authority. A points-array identity alone misses in-place edits.
- No `markerView` frame was sampled in fan100; only~6.12ms total inclusive marker blocker weight over the six chain/forest sampled windows. It would be false to attribute these100node losses primarily to marker view reconstruction. Cache/index changes need a workload that executes the expensive path before claiming progress.
- The measured crossing hotspot already has an x-sweep and Y-bound rejection (`src/shared/edge-crossings.ts:131–167`). Fan boxes overlap around convergence, so adding another generic spatial index is not established as a win. Profile the cardinal narrowphase rather than claiming an absent broadphase was added.

## Existing cache inventory for this path

| Cache/reuse | Scope | Observed / concern |
|---|---|---|
| positioned-layout | bounded process cache | bypassed by cache0; enabling would hide true rerender cost |
| native-drawing / paint-certification | bounded retained products | observedmisses; adding cache entries would hide shared emission cost instead of fixing it |
| backend-registry / capability-decision | loaded backend metadata | observedhits; no evidence these hide a material design loss |
| svg-inspection | one synchronous graphical execution, exact bytes and private producer key;512entries/512KiB chars | multiplemisses + hit; repeated complete document scans remain material; closure authority prevents blindly sharing public inspection results |
| text measurement widths | one render request | existing measurement reuse; no evidence of dominant cost here |
| emission textPlans/capturedLeaves/capturedTextPaint | one private emission capture | existing reflection instructions/owned operands; copyInner remains dominant, no added cache proposed |
| labelSeatPaintContext route/body/labelmaps | one synchronous labelproposal | already prepares route/marker supports once peredge, live label positions; not the unindexed route candidate peer loop |
| foreign circle shaft support weakmaps | one preference context | existing route-local reuse; no newcache proposal |

Reproduction: `AGENTIC_MERMAID_ELK_CACHE=0 node --expose-gc worker.mjs OUT CASE-job.json` from this evidence directory. `worker.mjs` is the existing source collector copied unchanged; `analyze.mjs` is existing source-map analyzer with input directory filter only. Complete products/profiles/maps/rows/jobs/errors retained. No production edits, tests, commits or pushes by this profiling agent.
