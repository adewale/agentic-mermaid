# Bounds-only original marker query — 7 November 2026

Measured baseline: c9dabb20c67aa18587063ea0268fa4e5ebdf7c40.
Pushed source: 14bec477578104a1eab5a279473aa77e747f8476.
Main: 39a500425f6b74eb486b9add9e90d538fab6a914.
Runtime diff: originalRegions in paint-certification.ts requests the existing includeHull=false argument. Every original-region consumer reads only bounds; served regions retain the full hull. No cache, trust shortcut, backend/version, charge or cap change.

The recovered existing Node24 profiler ran before the intervention and consumed the entire SVG and receipt. Its first loader failed before rendering on extensionless RoughJS imports. Only that recovery loader was adapted; original collector/analyzer sources are retained. Initial Class128 Native/cache0 three-call active2ms profile self/inclusive sample weights per call:
- visit Scene snapshot100.459/114.563ms
- validateNode13.794/45.652ms
- certifyNativePaint11.310/67.092ms
- marker include10.032/17.127ms
- final-security callback8.595/23.554ms

Weights overlap and are not exclusive CPU durations or removable time. The largest traversal is first Scene admission of fresh mutable Class data, not redundant recapture; Class's Native-labelled placement still uses its Scene adapter. Already-admitted bypass and within-call alias reuse already exist. No snapshot/hash/SoA rewrite is justified by this frame. Marker JSON/resource-ID reuse was also not justified: the equality and raw observation domains differ.

A sequential before/candidate pair in separate processes records three calls each, after an untimed complete warmup. Full warmup/repeat1/repeat2/edit SVGs and entire receipts are byte-exact across arms; repeats388607/400000 ops, edit389269/400000,127markers, passed proof and no issues unchanged. Marker sample self/inclusive7.697/12.499→6.964/11.241ms. Wall448/440/419→387/343/379ms and CPU782/768/837→716/597/829ms are instrumented single-pair observations. Unchanged visit also moves106.5→93.9ms; no causal speedup ratio follows. Earlier candidate profiles overlapped test work and remain explicitly confounded, not discarded. Raw heap/RSS counters are retained; imports/warmup/cold and cache1 were not timed here.

Owning paint/curved/transform run:740passed, known Sparse32 failed, plus one child stdin EPERM before rendering. That cyclic public owner passes the permitted retry:1P392assertions. Core types exit0, changed-file lint passes. Full ESM/declarations build passes. The existing actual standalone budget and emitted-worker browser owners both pass:2tests/504assertions, full Blob, family/style SVG/entire receipts and verification, backend/fallback/recovery and exports. These requalify the changed source; unchanged diagrams are not new layout progress. No new bug-fix RED claim.

Delivery cost, actual existing reporter on emitted lazy modules:
- Every complete family closure adds10raw bytes.
- Class gzip+3; Flowchart+14; Packet0; ER+6; Requirement+1.
- Initial gzip5854→5852; Brotli5226→5227.
- Complete standalone HTML raw2186915→2186759, gzip9 1310748→1310687, Brotli11 1245137→1244928.
- Existing standalone gzip ceiling1334500 remains unchanged and passes.
- Build17.059s/673272KiB peak RSS, within existing55s; no build speed/memory ratio.
- Main39 standalone Brotli1098404 remains146524 bytes smaller. Shared lazy budget losses, Sparse32, forest residual wire+10.19%, Sparse256 area+5.04% and shared ER256 geometry refusal remain.

Standalone compression uses Bun1.4.4 node:zlib, same recipe as retained before product. Before HTML was byte-bound to the existing prebuild file. Lazy original/normalized metafiles are both retained; only the recovered ELK dependency input label was normalized for the existing reporter, without changing emitted bytes or import edges. CPU profiles use Node24.19.0 and remain separate from transfer authority.

Source report records pre-final-build qualification; this checkpoint and PR description add the later standalone/browser measurements. CI42332734235 is tracked separately; do not call pending/failed CI ready. Replacement24 stays sealed; original baseline/Trident/pinned Mermaid12.2/Pele1.9 remain unavailable. Full historical evidence ancestry is preserved on the evidence branch.

Restore evidence.tar.gz into empty scratch: profile/ contains jobs, profiles/maps, full products, reports, errors and checks; lazy/dist/ contains the exact current emitted lazy modules. checkpoint.json records every-member byte verification. Archived leases do not authorize writers.

