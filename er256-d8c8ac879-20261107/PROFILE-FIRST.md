# ER256 profile before intervention

Source dda69ef2287da0ad569d334f0b200cc186de8c05. Node24.19.0, existing collector with refusal-aware warmup/row guards; cache0. One refusal warmup, two refusal repeats and one authored-caption edit. All three exhaust the unchanged400k geometry cap before delivery. Imports, compression and explicitGC are outside the profiled calls. Failed first collector attempt is retained separately.

Self is elapsed leaf sample weight; inclusive is stack presence and overlaps other rows. Values aggregate three calls, not time per successful render or independently removable time. The original-source locations use retained transform source maps.

| Spot | Self/inclusive ms | Matching case and intervention | Expected speedup |
| --- | ---: | --- | --- |
| finishErGeometry, src/er/layout.ts:1324 | 34.108/188.039 | Data-oriented: reuse the existing spatial broad phase for final body checks; skip repeated sorting only when the immutable child partition inherits the same axis/order. | Unmeasured |
| finish, src/er/layout.ts:1296 | 26.827/327.033 | Data-oriented: reuse the existing spatial broad phase for final body checks; skip repeated sorting only when the immutable child partition inherits the same axis/order. | Unmeasured |
| qualify, src/shared/immutable-parts.ts:12 | 24.483/24.828 | Data-oriented: retain validation; no causal removable work demonstrated. | Unmeasured |
| tryParseCssColor, src/shared/color-math.ts:160 | 22.850/23.882 | Data-oriented: retain validation; no causal removable work demonstrated. | Unmeasured |
| resolveRoleStyle, src/scene/roles.ts:238 | 16.195/21.756 | Data-oriented: retain validation; no causal removable work demonstrated. | Unmeasured |

Existing cache inventory: docs/design/system/layout-0.6-performance-review.md. Positioned-layout caches can hide miss-path production, but this cache0 refusal run does not show a causal cache defect. No new cache, hash packing, SoA or await parallelism is justified by these five frames. The call-local spatial index reuses one geometry snapshot; its charge still accounts for construction and query visits.

Baseline stage trace: entry69616; canonical contacts/obstacles71148; after label seating229578; after initial snapshot and contact seating301852; after final geometry extraction305932; raw body scan371212; subsequent painted-shaft scan exhausts400k. Removing both scans alone was already falsified in the preceding run. Current isolated controls retain refusal with index-only body checks and sort-order reuse alone; the combination returns a complete proof-passed product. Output correctness and equal-work speed remain separate qualification obligations.
