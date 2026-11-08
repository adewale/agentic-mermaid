# Sparse32: five largest source leaf weights before intervention

Source00938cc04693fe5da7a02a5d226406c3c2848251. Node24.19.0, V8 sampling200us,
one warmup followed by3 profiled identical complete drawNative products.
The inherited phase named edit is not an edit. Every product delivers but remains
unverified at the original400k cap. Imports, explicitGC, compression and writes
are outside profiled calls. Existing analyzer reused with retained transform maps.

Self is leaf sample-delta weight; inclusive is stack presence, overlaps other
rows and cannot be summed. Values below are aggregate3calls, not CPU time per
successful certification or independently removable duration. Profiles include
observer/JIT/GC costs; no performance ratio follows.

| Spot and original source line | Self / inclusive ms | Matching case and justified proposal | Expected speedup |
|---|---:|---|---|
| materializeText, scene/native-paint-emission.ts:87 |189.991 /197.255|Existing cache: textPlans reuses reflection instructions but still constructs fresh receivers. Investigate producer-owned numeric/text operands that can preserve inherited getter receiver isolation. Do not add a cache or share mutable receivers.|Unmeasured; no safe causal subtraction demonstrated.|
| copyInner, scene/native-paint-emission.ts:105 |117.366 /347.147|None/data-oriented: reflective graph capture, alias/cycle and admission rules. Establish a redundant traversal of the same owned data before changing representation.|Unmeasured.|
| copy, scene/native-paint-emission.ts:243 |30.087 /354.808|None/data-oriented: dispatch/custody proof before materialization. Inclusive time mostly overlaps the first two rows; removing the wrapper cannot recover that duration.|Unmeasured.|
| text, scene/marks.ts:490 |22.376 /28.183|None/data-oriented: constructing text occurrences. No measured one-field pass or hot hash primitive supports SoA/index packing.|Unmeasured.|
| validateNode, scene/scene-validation-core.ts:767 |22.106 /43.827|None/data-oriented: typed-node admission with independent depth/node ceilings. Reuse requires authoritative owned validation, not a second certificate cache.|Unmeasured.|

The existing cache inventory remains in
docs/design/system/layout-0.6-performance-review.md. For this path, textPlans
can mask reflection-plan miss work but does not mask repeated receiver allocation;
capturedLeaves and capturedTextPaint also retain call-local ownership/provenance.
No measured finding establishes that replacing these with flat arrays or adding
packed indices improves this case. There are no independent sequential awaits
in these synchronous frames. No new cache ships.

The CPU ranking and exhausted proof ledger answer different questions. Sparse32
first exhausts XML/capture work; optimizing text CPU alone does not show that it
would close proof availability. The smallest XML streaming intervention still
exhausts and changes ambient lookup timing. It is stopped. Removed-check output
is a diagnostic bound only. Full frame mappings, sensitivity counters and all
profiles are in analysis-sparse-before and profile-before.
