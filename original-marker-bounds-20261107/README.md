# Bounds-only original marker query — 7 November 2026

Measured baseline: c9dabb20c67aa18587063ea0268fa4e5ebdf7c40.
Pushed source: 14bec477578104a1eab5a279473aa77e747f8476.
Main: 39a500425f6b74eb486b9add9e90d538fab6a914.
Runtime diff: originalRegions in paint-certification.ts requests the existing includeHull=false argument. Every original-region consumer reads only bounds; served regions retain the full hull. No cache, trust shortcut, backend/version, charge or cap change.

The recovered existing Node24 profiler ran before the intervention and consumed the entire SVG and receipt. Its first loader failed before rendering on extensionless RoughJS imports. Only that recovery loader was adapted; original collector/analyzer sources are retained. Initial Class128 Native/cache0 three-call active2ms profile self/inclusive sample weights per call:
- visit Scene snapshot 100.459/114.563ms
- validateNode 13.794/45.652ms
- certifyNativePaint 11.310/67.092ms
- marker include 10.032/17.127ms
- final-security callback 8.595/23.554ms

Weights overlap and are not exclusive CPU durations or removable time. The largest traversal is first Scene admission of fresh mutable Class data, not redundant recapture; Class's Native-labelled placement still uses its Scene adapter. Already-admitted bypass and within-call alias reuse already exist. No snapshot/hash/SoA rewrite is justified by this frame. Marker JSON/resource-ID reuse was also not justified: the equality and raw observation domains differ.

A sequential before/candidate pair in separate processes records three calls each, after an untimed complete warmup. Full warmup/repeat1/repeat2/edit SVGs and entire receipts are byte-exact across arms; repeats 388607/400000 ops, edit 389269/400000, 127 markers, passed proof and no issues unchanged. Marker sample self/inclusive 7.697/12.499→6.964/11.241ms. Wall448/440/419→387/343/379ms and CPU782/768/837→716/597/829ms are instrumented single-pair observations. Unchanged visit also moves 106.5→93.9ms; no causal speedup ratio follows. Earlier candidate profiles overlapped test work and remain explicitly confounded, not discarded. Raw heap/RSS counters are retained; imports/warmup/cold and cache1 were not timed here.

Owning paint/curved/transform run: 740 passed, known Sparse32 failed, plus one child stdin EPERM before rendering. That cyclic public owner passes the permitted retry: 1P / 392 assertions. Core types exit0, changed-file lint passes. Full ESM/declarations build passes. The existing actual standalone budget and emitted-worker browser owners both pass: 2 tests / 504 assertions, full Blob, family/style SVG/entire receipts and verification, backend/fallback/recovery and exports. These requalify the changed source; unchanged diagrams are not new layout progress. No new bug-fix RED claim.

Delivery cost, actual existing reporter on emitted lazy modules:
- Every complete family closure adds 10 raw bytes.
- Class gzip+3; Flowchart+14; Packet0; ER+6; Requirement+1.
- Initial gzip 5854→5852; Brotli 5226→5227.
- Complete standalone HTML raw 2186915→2186759, gzip9 1310748→1310687, Brotli11 1245137→1244928.
- Existing standalone gzip ceiling 1334500 remains unchanged and passes.
- Build 17.059s / 673272 KiB peak RSS, within existing 55s; no build speed/memory ratio.
- Main39 standalone Brotli 1098404 remains 146524 bytes smaller. Shared lazy budget losses, Sparse32, forest residual wire+10.19%, Sparse256 area+5.04% and shared ER256 geometry refusal remain.

Standalone compression uses Bun1.4.4 node:zlib, same recipe as retained before product. Before HTML was byte-bound to the existing prebuild file. Lazy original/normalized metafiles are both retained; only the recovered ELK dependency input label was normalized for the existing reporter, without changing emitted bytes or import edges. CPU profiles use Node24.19.0 and remain separate from transfer authority.

Source report records pre-final-build qualification; this checkpoint and PR description add the later standalone/browser measurements. CI 42332734235 is tracked separately; do not call pending/failed CI ready. Replacement24 stays sealed; original baseline/Trident/pinned Mermaid12.2/Pele1.9 remain unavailable. Full historical evidence ancestry is preserved on the evidence branch.

Restore evidence.tar.gz into empty scratch: profile/ contains jobs, profiles/maps, full products, reports, errors and checks; lazy/dist/ contains the exact current emitted lazy modules. checkpoint.json records every-member byte verification. Archived leases do not authorize writers.


Late affected-input qualification uses the existing capture runner at source14bec:
18 public calls, 15 returns and 3 ER256 refusals. All 15 SVGs and entire receipts bind
byte-exactly to PR1693; refusal name/code/message match. Unchanged main39 products
are reused. affected-products.tar.gz preserves 101 byte-verified members, 509006 raw
bytes and 393472 archive bytes. This is validation after the changed runtime, not
new layout progress. Source report's pre-build note is supplemented by the final
standalone/browser measurements above. CI checkout 379ceddc has parents main39/
PR14bec and tree e4b2b2cb3f4272f76d35c76e20e9b4d28ea3795c, equal to source14bec.

The initial local cyclic-child stdin error produced no render product; no product-level failure is inferred from that transport error. Its permitted retry passed.

Final CI42332734235 completed failed: only Sparse32 in unit shard2; lazy/payload/advisory failures remain. Both other unit shards, all browser/semantic/package/CLI/MCP/isolation lanes pass. The PR remains draft. The local source report contains earlier pre-final-build notes; this checkpoint adds final measurements.
