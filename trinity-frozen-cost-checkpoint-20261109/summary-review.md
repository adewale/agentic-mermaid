# Independent cost-summary/report review

Read-only inspection of summarize-cost.mjs, svg-metrics.ts and write-report.py while serial acquisition continued. No summary execution, compression, rendering, profiling, tests, builds, network, source edits or new agents.

## Concrete correction before using geometry as roster-complete

svg-metrics.ts checks that each extracted carrier has data-from/data-to and that the number of carriers matches expected.edges.length. It never compares the extracted endpoint occurrence multiset with the frozen expected endpoint roster. A same-count duplicate/wrong endpoint pair would therefore retain non-null geometry and carrierRosterExact=true, despite the report's statement that ownership mismatches are unknown. Compare endpoint multiplicities when the authored roster can be expressed at this boundary; where correspondence cannot be established, retain unknown. Do not replace this with a set (parallel occurrences matter), infer identity from count alone, or grant semantic/ink validation from matching metadata.

A smaller reporting caution: replicaWholeProductsExact is true for a single returned replica. That is vacuous cross-replica equality, not a comparison. Retain/report the actual product/comparison count if this field is cited. It is not currently used to make the README's repeat-equality claim.

## Cost summary behavior

The aggregate repeat equality logic correctly requires both original and repeated calls to have returned. Thus the acquisition's undefined===undefined flags on two failures do not earn repeat credit. Edit/edit2 exactness similarly requires both returned and compares actual complete SVG/receipt artifact bytes. Prior-cohort SVG comparisons require both a newly returned original and a previously returned retained product. Missing terminal RESULT files and nonzero process exits are preserved separately. Per-phase outcomes retain complete failures, and attemptWallMs includes errors while returnedCost is calculated only over returned rows. There are no refusal-versus-completed speed ratios.

Captured product errors still use status=error; capability refusals remain distinguishable by failure name/message and the report explicitly separates the controlled-image refusal from shared invalid options. A collector exit zero is not a returned product. Partial/missing coverage cannot establish the stated full cohort: write-report expects every requested cell, and the coordinator plans to run it only after acquisition terminates. Keep actual process/call counts and terminal records authoritative rather than inferring 360 completed successes from the schedule.

The summary uses medians/ranges over two process replicas per phase rather than pooling repeat1/2 as independent processes. ImportMs stays separate. It preserves raw process CPU, lifetime RSS and heap snapshots/deltas. The report correctly explains that first-target calls follow imports and may follow literal preludes; repeats/edits are correlated; cache0 is the existing switch rather than all caches off; and lifetime RSS/heap deltas do not measure isolated-call peak memory, settled retention, leaks or browser/package memory superiority.

## Payload and geometry interpretation

Combined payloads are actual acquired original SVG plus parsed complete receipt serialized together, then compressed with matching Node codecs after timing. rawMatchesTimedProductBytes records the size cross-check. Separate SVG byte streams are also retained. Those are render-result payloads, not shipped runtime code or compressed network/startup costs. Keep the existing editor/lazy-bundle figures separately bound to their own runtime/artifact evidence, as the report does.

The SVG parser reads width/height only on the outer root, so nested SVG dimensions do not overwrite the viewport. It tracks SVG transform attributes through ancestors. Transformed carriers, curved/non-M/L paths, absent endpoint attributes, malformed/nonfinite coordinate counts, nonorthogonal segments and edge-count mismatches become geometryUnknown and null geometry rather than zero. Curves or hidden carriers must not be presented as fully measured visible ink. CSS transforms, clipping/masks, stroke width, marker geometry and raster visibility are not projected by this metrics script; this is raw carrier geometry with explicit scope, not final ink certification. Root viewport Number conversion can yield unavailable dimensions for unit-bearing/non-numeric roots; do not coerce such a null result to area zero.

The script inspects only cache0/replica0 original SVGs for geometry. That representative choice is defensible only as labeled: returned repeat/prior equality supports reuse where established, but geometry is not separately observed for every cache mode, replica or edit. Where no authored relationship roster exists, count/ownership completeness is unknown; an empty extracted roster alone does not prove zero relationships.

The report retains the pre-existing image placeholder fidelity failure, broader domain/resource failures, original caps, draft status and separate exact-head CI failure. Its first frozen30 cost coverage is useful new measurement, not unchanged fidelity validation presented as new progress, a runtime optimization, or replacement readiness.

## Conclusion

No additional cost/error/memory-summary blocker found in the inspected logic. Resolve or narrow the endpoint-roster claim above before citing geometry as complete. This review did not execute scripts or validate their eventual generated report; terminal acquisition results and actual derived rows remain necessary evidence, not an invented new acceptance gate.

## Resolution: reviewed corrections before summary execution

Both reported issues are resolved in the inspected script revisions. summarize-cost.mjs now records replicaProductComparisons=max(0, returned products minus one) and emits null for replicaWholeProductsExact when no cross-replica comparison exists. It no longer grants a vacuous true to one returned product.

svg-metrics.ts now requires an independently expressible expected endpoint roster. It builds a counted multiset of extracted source/target pairs, consumes directed authored occurrences first in exact orientation, then consumes undirected authored occurrences in either orientation. Reserving directed occurrences first prevents an undirected match from stealing a necessary directed occurrence; parallel and self-loop multiplicities remain counted. Both equal total count and complete consumption are required. Absent/unexpressible expectations produce null, mismatches produce false, and either adds an explicit geometryUnknown reason so geometry stays null.

These changes resolve the endpoint-ownership/count claim and vacuous-replica-equality finding. They do not turn carrier metadata correspondence into raster/marker/image proof or broaden the representative SVG acquisition. No remaining actionable summary blocker found in this narrow follow-up. Review only: no script execution, compression or runtime tests were performed while timing acquisition continued.

## Final resolution: completed acquisition and report

Reviewed final README.md, PERFORMANCE.json, SVG-METRICS.json, QUALIFICATION.json and FAILURE-CLASSES.json without rerunning acquisition, qualification, compression or experiments. Independently summed the phase records: 180 backend/cache/input cells each have two process replicas; totals reconcile to 360 processes, 1,248 timed attempts, 1,140 returned, 1,140 proof-passed and 108 errors. The failures classify exactly as 96 RenderConfigError attempts from the two retained invalid-fontSize inputs and 12 GraphLayoutUnsupportedError attempts from Trinity controlled-image. Original-input delivery remains ELK 28/30, Native 28/30 and Trinity 27/30.

QUALIFICATION recordedOutcomes matches PERFORMANCE totals, including 332/332 prior original-SVG comparisons, 664/664 returned repeat comparisons and 72/72 returned edit pairs. The reported 664 compressed complete-product files correspond to 332 original products times two codecs. QUALIFICATION records all sizes/compressed hashes/decoded raw hashes verified and no process failures or missing records. This follow-up checked consistency of those recorded results; it did not independently decompress or rehash files. The retained initial Python Brotli-import failure is not a product failure or a reason to rerun timing; final verification uses the recorded matching Node codecs.

The corrected generic SVG extraction retains all 90 original/backend rows: 77 have available geometry, six returned rows explicitly have unknown geometry, and seven are nonreturned. The six unknowns are the three Class namespace/note products (nonorthogonal note tethers and endpoint-roster mismatch) and the three State pseudostate products (generated endpoint identities). None receives zero-valued geometry credit. Cells with no cross-replica comparison now have exact=null; no vacuous exact flag remains.

README's memory/timing/payload distinctions match the data and prior review: first-target source calls are not universal cold startup; preludes remain untimed preconditioning; repeat/edit observations are correlated; RSS is process lifetime high-water; heap snapshots are not retained-allocation or peak proof; actual response JSON/SVG bytes are distinct from shipped runtime and network/startup costs. Returned/proof-passed is explicitly separated from decoded-image fidelity. Existing Native/ELK placeholders remain independently failed for that image criterion, while Trinity's refusal remains a separate unavailable delivery.

Adverse reporting is supported rather than hidden. Nested-State cache0 Trinity first-target range is 261.015–2966.588 ms versus ELK 529.644–609.879 ms; two observations do not support a stable slowdown ratio. Repeat2 ranges overlap (Trinity 38.686–102.072, ELK 62.867–151.067 ms). Cached Flowchart and Architecture workflow losses are also shown. The report draws no universal performance/memory dominance or retirement conclusion and preserves failed exact-head CI, original limits and draft status.

**Final disposition: no remaining actionable reporting blocker found in the completed records reviewed.** This acquisition adds the first frozen30 cost coverage; artifact equality supports reuse of the earlier observed outputs and does not constitute new visible-correctness progress or resolve existing replacement limits.
