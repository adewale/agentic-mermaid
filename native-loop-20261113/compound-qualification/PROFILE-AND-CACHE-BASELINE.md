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
