# Existing profile and cache baseline

No new profiling run was used to qualify the compound repair. The prior ten-render, cache0 Chain100 full-product profile is retained in `../implementation/MAPPED-PROFILES.json`, with source-map attribution from the matching seven-entry baseline build. This table contains its five largest mapped **self** rows (excluding inspector and GC), paired with the matching inclusive row. These are sampled contributions per render, not unprofiled API timings or predicted savings. Inclusive rows overlap and cannot be added.

| Existing owner at shipping689 | Source line | Self sampled ms/render | Inclusive sampled ms/render |
| --- | ---: | ---: | ---: |
| Native paint `copyInner` | `src/scene/native-paint-emission.ts:228` | 11.2739 | 13.9963 |
| `assessLayoutGeometry` | `src/layout-rubric.ts:496` | 3.4121 | 7.0991 |
| `certifyNativePaint` | `src/scene/paint-certification.ts:1441` | 2.8691 | 17.0236 |
| Native paint `copy` | `src/scene/native-paint-emission.ts:410` | 2.7127 | 14.5912 |
| Scene `validateNode` | `src/scene/scene-validation-core.ts:783` | 2.6644 | 7.2309 |

Inspector `post` contributed30.5337 sampled ms/render and is excluded from hotspot design claims. GC contributed3.1758. The enclosing sampled root was155.9966ms/render; it is not a replacement for the matched fully consumed clocks. The related rubric owner measured2.6269 self/12.2978 inclusive; generic route contracts0.4991 self/3.6181 inclusive. The marker correctness repair was prioritized from actual refused/overlapping products, rather than inferred profile savings. Chain/fan and300-node profiles, the rejected exact-axis probe, all adverse cost cells and unprofiled controls remain in the earlier immutable implementation packet.

Existing cache inventory (unchanged by this patch):

| Existing storage | Ownership/key and invalidation | Existing bound/policy |
| --- | --- | --- |
| Native measured geometry (`agentic-producer-core.ts`) | Full measured JSON key including undefined/nonfinite encoding; returned arrays cloned; changed demand produces a new key |64 entries/8MiB estimated weight, key at most1Mi code units; startup `AGENTIC_MERMAID_ELK_CACHE=0` bypasses |
| Native order choices (same owner) | Binding-owned weak map, candidate input key; never a proof or receipt |64 entries/1MiB per results owner; same startup bypass |
| ELK geometry (`elk-instance.ts`) | Full ELK graph input; clones returned geometry |64 entries/8MiB estimated residency, key at most1Mi code units; same startup bypass |
| Positioned family snapshots / Native drawing (`experimental/position-cache.ts`) | Family-isolated key and private snapshot/request ownership; mutation-isolated public copies; native drawing bound to its layout snapshot |128 positioned entries/16MiB;128 drawings/8MiB, bounded replacement age; evicting layout evicts its drawing |
| SVG inspections (`svg-inspection-cache.ts`) | One synchronous graphical execution; exact immutable SVG bytes and private inspector symbol; rewrite gets fresh evidence |512 entries/512Ki characters; nested executions restore parent |
| Marker peer views (`route-marker-clearance.ts`) | One synchronous layout; peer geometry/style values revalidated, scoped weak-map ownership |No cross-call identity reuse; nested layouts restore parent |
| Text measurement (`text-measurement-profile.ts`) | Private per-request width/ink maps bound to immutable execution/profile identity |Shared only between that request's layout/drawing; custom measurement policy retained |
| Prepared text (`shared/prepared-text.ts`) | Existing optional text-span cache; bypassed for custom measurement and long/non-string source |Existing weighted residency policy, unchanged |
| Paint certification (`scene/paint-certification.ts`) | Private rendered-layout weak map and per-call contour/shaft/occurrence views |Existing operation/pair caps remain; not a general marker/foreign-shaft certificate |

No additional runtime cache, cross-pass metric reuse, retained search result, index or trust flag was introduced. New per-end facts are producer constraints; committed marker boxes are produced directly inside the existing obstacle construction and final seating still validates every final pose.

## Which caches can conceal expensive design

The strongest concealment comes from **inter-call positioned geometry plus certified native drawing reuse**. A repeated identical SVG request can skip layout, native capture/copy and paint certification by returning the artifact owned by the same private snapshot and original producer. That is a legitimate benefit for repeated previews, but a warm hit does not show that fresh capture or a geometry-changing edit is cheap. The existing `src/positioning.ts:129` admission checks family/metric eligibility and the cache switch; `src/experimental/position-cache.ts:289` binds a drawing to its live retained snapshot and request; `src/scene/positioned.ts:135` rechecks the producer. Eviction or a changed key/producer removes the shortcut. A claim about the owner's100-node full-consumption target therefore has to retain first-render, changed-input and cache0 cells alongside warm repetition.

**Native/ELK measured geometry caches** can similarly hide repeated rank/order/routing cost. They still pay key construction and copy returned geometry, and they do not repair a poor route or certify newly emitted ink. Native's **order-choice cache** is narrower: it remembers a selected alternative, never a proof. The corresponding alternative search is admitted only for ungrouped graphs with at most20 nodes and64 edges (`agentic-producer-core.ts:169`); it cannot explain the measured100/300-node chain and100-node fan hotspots. Removing these bounded caches without removing redundant work would make repeated user operations slower, so this audit proposes no blanket deletion and no additional cache.

`AGENTIC_MERMAID_ELK_CACHE=0` is **not a promise that every form of retained data is disabled**. At startup it bypasses both solver result caches and Native order choices; the positioning owner also uses it to bypass its cross-call positioned/drawing tier. Existing prepared-text reuse can remain enabled under `text-spans` (`experimental-performance.ts:1`, `shared/prepared-text.ts:327`). Per-request text measurement, same-execution SVG inspection, route marker views and per-certification contour/shaft views remain distinct local mechanisms. The archived profile worker intentionally selected no cache-event observer, so its evidence does not contain per-cache hit rates; those must not be invented from function names or the word cache0.

## Repeated work that cache0 still exposes

The mapped Chain100 profile above still spends11.2739 sampled self ms in native `copyInner`,3.4121 in rubric geometry, and2.8691 in the paint certifier's own body; their inclusive parents overlap. The frozen-source observation in [`../audit/rubric-enumeration/REPORT.md`](../audit/rubric-enumeration/REPORT.md) separately finds four rubric measurements for Chain100 and Chain300. Across those measurements, Native makes67,914 and623,714 segment/node checks respectively, all bounding-box misses, plus19,800 and179,400 node/node pairs. That is concrete repeated enumeration even when result memoization is bypassed. It supports investigating a cheaper candidate enumeration **inside one owned measurement**, with unchanged exact predicates and observable read order. It does not authorize reusing an old metric across a pass that changes routes, labels, certificates or bundle ownership.

The paint/copy hotspot is also real under cache0, but previous scalar-copy, XML and broad reuse experiments were withdrawn for insufficient whole-product savings or ownership/getter regressions. A hot function is a ceiling for investigation, not a license to delete its isolation contract. The failed exact-axis crossing probe is the immediate caution:42.87% of fan intersection calls were avoidable misses, yet matched fully consumed costs worsened. Call-count reduction did not establish an end-to-end win.

**Per-invocation owned fact reuse is different from inter-call memoization.** A contour derived once from immutable served geometry, a marker peer view revalidated against the current route/style values, or one SVG inspection shared by consumers of exactly the same bytes avoids repeated derivation without keeping a prior render's answer. `route-marker-clearance.ts:271` creates a new execution scope and restores nested scopes; its peer records revalidate style and coordinates. `svg-inspection-cache.ts:13` similarly binds results to one execution and exact immutable strings. Such reuse still needs finite work/allocation bounds, proper invalidation at mutation, and live fallback for borrowed/public getters. Existing private work ledgers and new per-end marker constraints are ownership/state facts, not result caches.

For the current identity regression, the measured waste is even earlier than memoization: both LR/RL exact product traces show valid but needless quotient excursions becoming physical committed routes; later edges then search around them. Final marker seating and generic cleanup change none of those paths. Selecting a valid straight real-terminal candidate before retaining an unlabeled guide removes the cause if the bounded probe succeeds. Caching the guide faster would leave its quality problem intact. This causal routing work is currently higher priority than adding any retention layer.

This interpretation uses the existing source-map profile, cache owners and closed untimed observations only. No new profile/replay, hit-rate estimate, timing extrapolation or production change was performed for this section.

## Main integration changes the next profile's baseline

Main advanced to `a2e5ddc927e7432affbc293b7996a74b5fe59003` after the frozen689 profile and the compound fix. The [pinned source review](../audit/MAIN-INTEGRATION-REVIEW.md) records its existing route-box rejection, one-walk owned positioned snapshots, captured family-data budget reuse, and source/appearance/finished-output memoization. The old segment/node counts and copy proposals must not be carried forward as Main's remaining work. The new positioned-snapshot copy owner is distinct from `native-paint-emission.copyInner`, which those Main changes do not edit.

After integration, `AGENTIC_MERMAID_ELK_CACHE=0` still bypasses the positioned/drawing and solver tiers but does not disable Main's new normalized-source and appearance caches. Fresh-process, changed-input and repeated cache0 cells therefore remain distinct. The completed 689-versus69d5 clocks qualify the compound patch against its actual base; they do not qualify Main or predict a combined speedup. Requalify the merged products and obtain a fresh mapped profile before another performance change. No new profile, production optimization or cache was added by this audit.
