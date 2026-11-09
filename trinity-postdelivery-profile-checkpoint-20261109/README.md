# Completed compound profile and rejected heap directory

Profile/runtime source **d951d78360d45c0260779c8d63207dbe92a85c1b**; documentation **7834513e8**. No production performance rewrite ships. Deadline9 November2026,20:00UTC; existing draft PR602/recovery branch, old automations off, bounded execution only.

## Profile before intervention

Existing serial Node24/V8 source collector, cache0, one supplemental community fan-in, three backends, two profiled repeats and one edit each:9 profiled attempts,8 returned/proof-passed and one Native edit refusal. Three separate untimed warmup originals return. Unlike the before680d collection, all3 Trinity attempts now complete actual SVG+entire receipt emission. Module import, artifact compression/write and explicit GC are outside the profiled windows. Timings are instrumented and cannot substitute for unprofiled cost observations.

Five largest raw Trinity repeat source frames; two repeat windows. **Self/inclusive elapsed sample-delta ms per call are not exclusive CPU durations or removable wall time.** Inclusive values overlap. All source maps and1/2/5ms active-gap sensitivity diagnostics remain in analysis.json; no cutoff is an acceptance gate. `ensure` includes one sample above5ms, weakening its raw rank.

| Frame / source location | Self / inclusive ms | Matching case | Expected speedup |
| --- | ---: | --- | --- |
|heap, compound-lazy-visibility.ts:113|6.902 /6.902|Hot Map lookup; dense heap-page directory is an array candidate.|Unmeasured; rejected below.|
|less, same file:129|6.558 /9.379|Hot sparse state-page access; retain sparse representation and exact priorities/ties.|Unmeasured.|
|copyInner, native-paint-emission.ts:105|5.907 /9.216|None/data-oriented; required getter/mutable/ownership capture remains. Prior unsafe subtraction stays stopped.|Unmeasured.|
|ensure, first file:96|5.427 /5.427|Hot hash lookup, but sparse state IDs and reserved allocation do not justify a dense state grid.|Unmeasured.|
|swap, first file:133|4.622 /12.137|Hot heap access; same directory candidate, not an independent rewrite.|Unmeasured; rejected below.|

The existing state pages already use typed SoA columns and integer state IDs. No independent awaits occur in these frames. Query page directories are storage, not cross-request render-result caches. The full existing cache inventory remains in `docs/design/system/layout-0.6-performance-review.md`; no new cache or causal slow-design finding is inferred here.

## One bounded intervention, outside production

Heap slots are appended densely at heapSize; their page numbers are dense. State IDs remain sparse. Test only heapPages Map→array, keeping state/point/segment maps,32-slot pages, original page-capacity reservations, IDs, search order, priority comparisons, tie breaks and limits. No packed IDs, full-grid allocation or cross-query cache.

The first bare-array feasibility probe returns5 full products, but is not used to claim a performance win. The subsequent candidate length-checks page creation and publishes own array slots. Independent review finds its ordinary property descriptor still observes inherited get/set fields. An actual isolated lazy-router call under an inherited Object.prototype.get accessor returns with the Map baseline (100 expanded units,0 inherited observations), while the candidate throws after1 observation. The reproduction and candidate sources are retained. This is a private owning-router protocol counterexample, not a claim that an ordinary full public product failed.

A null-prototype descriptor would address that introduced observation. Do not spend another trial merely to rescue a candidate with no established whole-product value; the current cost comparison below already has mixed/wide outcomes. No production code, test contract, cache, cap, default or version changes.

## Fully consumed comparison

Eight serial fresh Node24 processes in ABBA/BAAB order, cache0, cold/repeat1/repeat2/edit/edit2 per process:40 complete SVG+entire receipt calls. All40 returned/proof-passed; every original and edited SVG plus entire receipt is byte-exact across baseline/candidate. Import, explicit GC, compression and artifact writes are outside measured render windows; sampling/observers off. Existing derived caches remain. No concurrent local tests/build/profile acquisition. These are four process replicas per variant on one input, not a general ratio or throughput result.

| Phase | Baseline / candidate wall median ms | Baseline / candidate CPU median ms | Baseline / candidate wall ranges ms |
| --- | --- | --- | --- |
|cold-render|357.77 /403.70|693.59 /778.81|307.41–441.79 /295.85–493.50|
|repeat1|135.16 /138.05|329.55 /451.10|107.08–208.42 /110.07–249.81|
|repeat2|128.98 /125.67|344.04 /340.34|117.44–162.94 /112.09–159.82|
|edit|170.20 /140.72|341.17 /298.48|111.72–382.65 /118.76–175.98|
|edit2|138.21 /186.05|396.41 /344.70|117.66–267.91 /108.94–234.34|

Repeat2 moves slightly favorably; edit2 and cold wall costs are adverse. CPU directions differ too. These overlapping/wide samples do not establish a stable overall gain; no speedup is invented. No before/refused product is substituted for completed work.

| Variant | Process peak RSS KiB range | Heap-used-after snapshot MB range |
| --- | ---: | ---: |
|baseline|180140–207992|45.95–72.31|
|owned-heap|176160–206780|39.95–66.61|

RSS includes loader/harness/imports/artifact retention. Snapshots are not heap peaks, settled retention, allocation rate or leak evidence. Raw per-phase before/after counters and process CPU remain in ABBA-QUALIFICATION.json and original RESULT artifacts. The rejected candidate has no shipped bundle delta or changed visible output; do not invent one.

## Decision and retained gaps

Stop the heap-directory rewrite: current evidence does not justify its cost/complexity and it adds a reproduced observation risk. This does not prove every array implementation is slower. It rejects this proposal for shipment from these measurements. Do not replay its unchanged comparisons as progress.

Current runtime still has Trinity27/30 frozen returns versus Native/ELK28; the remaining image row is separately unsupported/failed-image, not fully correct ELK output. Adverse fan-in crossings, broader capacity/quality, original editor budget excess8194gzip bytes, Sparse32 and CI readiness remain. Actual image support was separately deferred after default security rejected the opaque-emission shortcut; no security/proof exemption was shipped. Replacement24 stays sealed. Original2dad and equivalent pinned Pele runtime remain unavailable.

Next work should target a demonstrated remaining product or distribution cost at its first owner, such as the actual emitted editor budget; no repeated hotspot inventories or new qualification framework. Existing implementation/literature insights remain source-bound hypotheses, not runtime benchmark credit.

## Reproduction and recovery

`run.py`/`worker.mjs`/`analyze.mjs` are copies of the existing source collector/analyzer with this input and revision. `run-abba.py`/`measure.mjs` reuse the existing sampling-disabled full-product collector. `descriptor-probe.mjs` binds the actual lazy-router baseline/candidate observation counterexample. All overrides stay outside the source worktree. The archive retains profiles, source maps, jobs, failures, images' separate-contract pointers, raw SVG/receipts, review and logs. No retained evidence was deleted, no new PR/issues or external comments/messages.

Raw scripts, logs, final products, built assets and failed probes are retained in evidence.tar.gz. FILES.json records verified archive members and SHA256; ARCHIVE.json binds the runtime and archive. No local evidence was deleted.
