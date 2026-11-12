# Rejected Native100 trials and current CI

The pushed source remains `94365c93ef8930a0d953fbca8c00542c8f4947b4`. Existing evidence parent is `b85e5bc881fe5d59de90df71d5c7f4eb28779cc6`. This checkpoint preserves subsequent unshipped experiments and work in progress. It does not claim completion or continuous execution between runs.

## Verified production state

943's private ledger batching retains operation totals/status and exact products. Its recorded matched Node run observed stock SVG median 138.58→124.82 ms and fully consumed warm response 182.77→157.62 ms, with first edit 194.06→214.29 ms adverse. These observations do not establish a causal speedup ratio. The Native100 target remains open.

Exact-head CI43225853391 completed with failure. Lint, core/repository types, all three unit shards, browser build/E2E, platforms and consumers pass. Payload and layout advisory fail. CI mixed payload is 2,514,385 raw / 782,245 gzip / 622,395 Brotli bytes, over caps by 84,385 / 20,745 / 4,395. Editor gzip is 1,380,367 versus 1,334,500; demo is 825,941 raw / 315,579 gzip / 276,128 Brotli versus 788,000 / 302,500 / 276,000. Per-PR growth checks also fail. No caps or approval labels changed.

## Stopped work

- Whole owned-data freeze shortcut: actual Node stock median 114.94→129.85 ms, full 149.47→166.27 ms, cold 362.37→433.02 ms; proof passed but work increased by6,038 through marker replay. Unsafe diagnostic only, rejected.
- Stable budget class: stock 154.74→135.78 ms but fresh source 101.18→129.98 ms adverse. All27 complete paired SVG/receipts matched. Not an overall win; rejected.
- Scalar-budget/plain-facade correction: the first clock used eight entries against seven and is explicitly a mismatched diagnostic. The corrected equal-build run worsened stock 119.28→155.52 ms, fresh 106.16→112.00, full 160.99→170.82. All27 products matched. A symbol-slot budget-binding hazard was also identified in review. Rejected; no production fix or safety claim for it.
- Closed x/y metadata shortcut: stock 130.03→128.93 ms was tiny/mixed; full165.47→193.03, cold425.49→459.37, first edit168.38→197.75 adverse. Owning tests and27 complete products passed. Rejected.
- Constructor metadata, two-pass closure: stock144.75→158.01 ms and full168.48→171.41 adverse; some cold/edit samples improved.166 owning checks, lint and27 products passed. Rejected.
- Constructor metadata, single post-freeze closure: stock125.25→144.96 ms, full162.75→165.15, repeated edit144.43→151.70 adverse. Fresh source102.99→100.19 and cold413.04→405.54 improved.27 complete products matched. Unadopted WIP patch retained for redesign, not a claim of progress.

Every arm's raw samples, adverse distributions and exact artifacts are retained. Some diagnostic before/after proof work differs or the approach is unsafe; none supplies a production performance ratio. The whole-capture and scalar variants do not justify a wider ownership rewrite. V8 trace shows copyInner eventually optimizes; the 'too large to optimize' hypothesis is false. Numeric geometry validation alone is sub-millisecond. The previous spatial/alias/minifier probes remain stopped.

## Remaining work and staged dependencies

Native100, repeated pipeline processing, Chain300's unchanged400k unknown proof status and payload budgets remain unresolved. Unknown proof status is separate from visible failure. ER256 already passes; no invented repair. Original baseline/pinned Mermaid/Pele remain unavailable and Replacement24 stays sealed.

The emitted browser graph already defers canonical backend/conformance into the Scene provider; the proposed registry-edge defect was falsified. A small final-SVG budget helper extraction is staged only, with no isolated payload benefit claimed. It becomes useful only when real Native full-validator consumers are removed.

`finish-metadata-operands/CONSTRUCTOR-WIP-SINGLE-PASS.patch` is a source recovery patch, not approved production. The runtime archive also contains final CI logs/snapshot and the standalone PR description. Source/build archive preserves all named compiled trials and actual control/single-pass outputs, excluding node_modules and Git administrative files. MANIFEST hashes every archived file, and both archives were read back and verified. All original local files remain intact; no evidence was deleted.
