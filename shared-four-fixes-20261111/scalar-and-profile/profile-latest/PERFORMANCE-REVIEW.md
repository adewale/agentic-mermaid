# Profile of the actual shared pipeline, source48d62e103

Node24.19.0, cache disabled, actual built public `renderMermaidSVGWithReceipt`, fixed Trident Chain100 source. Entire SVG/receipt serialized and UTF8 counted once. Three sampled calls (two repeats and first authored edit) are retained with the original source/options in job.json. IDENTITY.json binds six actual loaded JS/map artifacts; all735 project source-map comparisons match commit48d62e103e9b8a6d6d8fe3159ebe384880721609.

These are sampled CPU attributions, not uninstrumented elapsed latency or expected speedups. Inspector.post contributes104.1ms self in repeat1 and37.5ms in repeat2; it is instrumentation. GC and every raw sample remain retained. Inclusive parent/child times overlap and must not be summed.

The five highest product self-time locations in repeat1 (excluding inspector/GC and counting the recursive copier as one mapped function):

| Source at48d62e103 | Repeat1 self / inclusive ms | Matching case and intervention | Expected speedup |
|---|---:|---|---|
| src/scene/native-paint-emission.ts:109 copyInner |29.075 /34.303|Data-oriented redesign: it visits every source field, so blindly converting to SoA does not match. Reuse paid producer operands without shortened caller receivers; keep generic mutable/getter capture. Prior shortened text projection failed actual output and was withdrawn.|Unmeasured. Repeat2 still25.727/30.419. Removing the entire function would bound this sampled location, not establish an API speedup.|
| src/layout-rubric.ts:493 assessLayoutGeometry |7.060 /13.107|Hash lookup case: endpoint IDs repeatedly resolve through a new node Map. Resolve fixed private endpoint ordinals once while retaining generic public sparse/reordered fallbacks. Prior combined endpoint/numeric experiment regressed fan-in and was rejected; no repeat of that branch.|Unmeasured; existing adverse result prevents a positive claim.|
| src/scene/scene-validation-core.ts:768 validateNode |6.363 /13.379|Data-oriented redesign: validation follows fields already copied by capture. Pass exact completed producer facts to the actual writer; generic and changed receivers still validate fresh. A frozen object or certificate alone is insufficient.|Unmeasured. A broad bypass would violate the contract.|
| src/layout-rubric.ts:650 measureRubricMetrics |5.340 /24.459|Data-oriented redesign: avoid recomputing hard facts and soft metrics when a consumer discards them. The narrow hard-only removal is shipped4db7ab076; remaining public quality vectors must still be computed. This includes assessLayoutGeometry above.|Unmeasured. No clean100-node win from the narrow cleanup; raw cold outlier retained.|
| src/scene/svg-writer.ts:719 XmlLeafWrite.attribute |4.970 /6.358|Cache case: per-capture literal/name caches hide repeated lexical processing. Reuse actual fixed writer names and source-bound operands; never reuse cached markup as write authority. Variable escaped values, UTF16 and final insertion checks remain fresh.|Unmeasured; actual-write subtraction48d62e103 needs final clocks and payload qualification.|

Other phases change the ordering. Repeat2 exposes measured-graph-producer:174 at4.749ms, scopeSvgStyles:175 at4.126/5.333ms, route-contracts:150 at3.764/5.872ms and certifyNativePaint:1491 at3.368/18.812ms. First edit exposes paint-certification part:1796 at10.624/10.928ms and emission-context hint:328 at8.315ms. PROFILE-SUMMARY.json retains the full phase lists. No independent serial awaits appear in these synchronous hot paths. Bit packing and SoA are not justified by this profile alone.

## Existing caches and registries in this path

- The layout-result cache produces fast exact-input hits while first edited work remains slow (historical599:15.6ms hit versus184.6ms first edit). It hides fresh-work cost; it is excluded from the fresh100ms goal. No extra cache is proposed.
- Captured owned text instruction plans retain descriptor operands but materialize fresh full receiver graphs. This is producer reuse within a render; the generic copier remains dominant for distinct labels. Adding more result caching would conceal that design cost.
- SvgXmlCapture name/value Maps retain lexical results within one capture. They hide repeat grammar/escaped-literal work, but cannot prove occurrence custody or final XML position. Fixed-name actual writer events now avoid some of that work directly.
- Measured-graph footprint Map retains shape reservations by structural marker key. It avoids repeated marker-resource construction. It is a candidate for direct bounded builtin footprint calculation, not a reason to cache more resources. No speedup was measured for that redesign.
- Existing route-marker peer views and first-leg memoization retain stable geometry only within a guarded pass; mutable/text-measurement paths fall back. The prior quadratic scans were addressed separately. This profile does not justify removing their guards or extending their lifetime.
- Per-proof strokeAlpha, occurrenceBounds, actualShaftParts and pathContours Maps avoid repeating occurrence work in one paid proof. They are scratch indexes; no persistent certificate or stale source authority follows.
- The renderedCertificates WeakMap serves the returned RenderedLayout API. It does not qualify new or edited output.
- XML-write, actual geometry, group-emission, retained text and written-polyline WeakMaps bind private producer/write ownership. These registries are correctness state, not a claim that layout or validation became fast; removing them is a different contract change.

No source changes are made by this report. Current source work is incomplete: Chain100 and Sparse32 still exceed400000 operations, larger cases fail earlier, and100ms has not been demonstrated. The actual checked marker paint identity is the next bounded reuse intervention; its independent work-attribution bound must be confirmed by real full proofs and clocks.
