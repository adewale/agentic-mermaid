# Current shipping Native / ELK comparison —2525b91c,12 November2026

Unmodified canonical Node SDK from exact-head CI43288474739, verified-test-package13976512100. Both engines use the SAME package/dist/index.js and source diagnostic:chain100. Node24.19.0; AGENTIC_MERMAID_ELK_CACHE=0 and scene assertions0 explicitly. Existing Trident workers, serial execution,3process replicas per engine, no profiler/timed observers. Separate stock-SVG and fully consumed SVG+receipt protocols. This is new measurement coverage at the actual shipping build boundary, NOT a code speedup against historical custom31/943 builds. No production source changed. Parent evidence2b255 preserves canonicalZIP/provenance, all rejected trials and earlier diagnostics.

## Measurements

| Boundary | Native | ELK |
|---|---:|---:|
| Stock repeatedSVG median of3process medians |155.74ms|Unavailable:4worker lifecycle failures|
| Stock process medians |162.66 /155.74 /145.04ms|No completed samples|
| Stock pooled p95 (21samples) |213.45ms|Unavailable|
| Fresh-source stock median |123.12ms|Unavailable|
| Alternating label-edit stock median |89.65ms|Unavailable|
| Fully consumed repeated response, median of3process medians |163.27ms|277.76ms|
| Full-response process medians |164.79 /161.25 /163.27ms|277.76 /243.48 /289.14ms|
| Full-response pooled p95 (12repeats) |210.17ms|344.30ms|
| First full response, excluding import |421.54ms|810.79ms|
| SDK import median |292.67ms|272.01ms|
| First edited-source full response |182.28ms|277.33ms|
| Repeated edited-source full response |140.61ms|255.13ms|
| Warm full-response pooled CPU median |276.65ms|444.44ms|
| Warm full-response RSS median |112.00MiB|172.95MiB|
| Transient after-render heap median |30.12MiB|56.09MiB|

Stock uses existing7adaptive samples per track per process (21samples/engine when completed); minimum4ms and each recorded call was one iteration here. Full worker consumes the entire SVG+receipt by JSON serialization/UTF8count once inside each API clock; compression/evidence encoding/explicitGC sit outside clocks. Full repeat is4responses per process,12per engine. edit1 is the first changed source; edit2–4 are repetitions of that same edit, never fresh-edit costs. Import is separately timed. RSS/heap include harness/import/compression/retained warmup; after-render heap is transient, NOT retained memory. CPU may exceed wall time due process/runtime parallel work. Raw distributions and all rows remain retained.

## Correctness and completion limits

All6full workers completed, all54responses returned (27per engine), and every reported layout proof passed under the original400000operation cap. All54entire receipts independently record requested=selected, fallbacknone and exactly one selectedattempt: Native agentic-layered@28; ELK elk-layered@1. ACTUAL-BACKEND-SELECTION.json lists every exact receipt path/value. Stock jobs call api.renderMermaidSVG(source, their explicit options) without an engineoverride; this SVG-only API exposes no receipt, so no stockreceipt collection is claimed. Baseline238786operations / edited238815operations are identical across engines. All source repetitions preserve entireSVG and entire receipt within their engine; all edited outputs changeSVG. Every baselineSVG in BOTH engines is byte-identical:95817UTF8bytes, SHA2564ef1a802431cfeddcd046cb765a506fe70775476234555e04027742cd5bbd0c7. This establishes equal consumed output for this input; it is not new all-family visual coverage. Existing stock admission labels painted semantic correspondence unmeasured, and no new browser ink run occurred. Do not report a new browser-correctness pass.

Native100 under100ms is NOTmet: all3recorded stock process medians exceed100ms. Native remains faster/lowerRSS in the valid full-response comparison; this does not make it a complete ELK replacement or prove code improvement over historical different build protocols.

Original stock orchestration completed3Native workers and lost all3ELK workers before completed IPC evidence. CgroupOOMkill count increased12→15 across the comparison; exact individual original exit signals were not retained. One bounded missing-ELK retry used unchanged workload/heap/GC and existing GNUtime observer, then STOPPED at its first failure: signal9, peakRSS354116KiB(345.82MiB), OOM31→32/kill15→16 during that attempt. Remaining2replicas were not retried. No ELK stock latency, speedup ratio or pass is invented; this arm is locally resource-blocked. The completed full-response comparison remains valid. Memory pressure and the failed original runs are part of the evidence, not erased by a retry.

Exact2525CI is terminalFAILURE: types/lint/all3unit shards/canonicalNode+browserbuild/browserE2E/semantic/platformconsumersPASS; payload/site/lazy budgets and layout advisoryFAIL. Mixed2514987raw/782452gzip/622671Brotli vs caps2430000/761500/618000. Demo826543/315769/276446 vs788000/302500/276000. Editor1380423gzip vs1334500. No ready claim, cap/default/version change, newPR/issue or manualCI dispatch.

## Decision

Keep source2525b91c. Its8policy/decision invariants are verified; the new comparison does not resolve Native100 or payload losses. Independent scope/value review found no currently demonstrated removable pass sufficient to justify another capture/XML/rubric representation rewrite; group snapshot alone is only2.18ms in a separate diagnostic protocol. Previously adverse variants remain stopped. Trinityv3 deletion remains unapplied pending explicit owner approval after automatic approval review blocked the destructive change. No elapsed time counts as approval. Next source patch requires genuinely new causal evidence; do not replay failed variants as progress.

## Four owner tasks: current status

1. Native performance/pipeline work: INCOMPLETE. Current shipping stock155.74ms exceeds100ms. Earlier private-ledger work and parser/schema subtraction remain, but repeated processing is not fully eliminated. Rejected capture/XML variants do not count as fixes. Current evidence provides no justified next source patch; another unprofiled rewrite would be speculation.
2. Shared proof/capture availability: INCOMPLETE. Retained Chain300 both engines are unknown at400000operations; unknown is distinct from renderer refusal or visible error. No cap was raised, and no blanket all-proof-pass gate is invented. This comparison only covers Chain100, not a Chain300 repair.
3. ER256 actual relationship delivery: previously requalified8/8, with256entities/255relationships and no foreign contacts in retained evidence. It already passed at the inherited baseline; there is no new ER repair in2525 and no transfer of proofPASS into a fresh visual claim.
4. Payload/shared validation: INCOMPLETE. Descriptor/prototype/dispatch invariants are fixed and schema construction240→114 is retained, but mixed/demo/editor and existing per-PR payload-growth gates still fail. Trinity cleanup is separately blocked pending owner approval; its unapplied byte savings are not counted.

Grouped delivery remains the separately retained12/12replacement cohort with flow/crossing qualification and adverse+5.56%ancestor wire; the owner's original12graphs/image are lost. This shipping performance slice does not recover them or establish all grouped inputs correct. No claim that allfourtasks are100%resolved.
