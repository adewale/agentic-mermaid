# Standalone worker compression — 6 November 2026

Source970c9f807bd82b6c3e731aadef3585ee6b071523 descends from63a32f5b9. The change reuses the existing SWC browser compressor with one pass for the already Bun-minified private worker; all other callers keep six. The worker graph, notices, bounded Brotli decoder, CRC/byte limits, cancellation and Blob lifecycle stay in place. No cache, dependency pin, backend default, release version or ceiling changes.

Matched complete production builds on Bun1.4.4/ELK0.11.1 measure control→candidate:

| Product / cost | Before | After |
| --- | ---: | ---: |
| HTML raw bytes |2,194,300|2,089,396|
| HTML gzip9 bytes |1,427,769|1,346,874|
| HTML Brotli11 bytes |1,360,667|1,281,514|
| Worker decoded JS bytes |4,857,766|4,692,517|
| Worker packed bytes |1,177,244|1,098,566|
| Peak build RSS KiB |554,312|691,384|
| Observed build wall seconds |42.4|20.2|

Whole HTML saves80,895gzip/79,153Brotli bytes. Peak RSS rises137,072KiB(+24.73%). Both final builds complete inside the existing55-second child deadline. These single observations and variable earlier build times support no speed ratio. The actual decoded JS changes; browser operation equivalence is the contract, not equal source bytes. Independent review verifies equal worker input metadata and byte-exact notices.

Final qualification:2 existing minifier semantic cases pass; core TypeScript exits0;3-file canonical lint passes. The existing actual emitted-worker browser owner passes: complete Blob bytes, all enrolled family/style SVGs, full receipts and verification versus source, both backends/fallback, crash recovery and ASCII/Unicode/PNG. The budget owner still fails:1,346,874>1,334,500 by12,374bytes. Combined browser invocation exits1 with one pass/one failure and499assertions. No readiness claim. New source CI42311014876 is in progress; previous63aCI42076722214 completed failed with Sparse32, lazy/demo/standalone payload and advisory losses retained.

Stopping evidence: full six-pass worker minification has an isolated55s candidate timeout, in addition to a control timeout under concurrent typing. It is unshipped. Literal raw insertion is only a compression lower bound, not executable HTML:5,910Brotli bytes saved while gzip worsens283,230bytes. UTF8base64 also worsens transfer. Stop those hypotheses. Failed harness drafts, a missing-codec build, wrong-ELK0.11.0 products and missing-dependency type attempts remain alongside the corrected results. Minifier test module identities needed inert comments inside base64; reused imports/URL fragments were harness failures, not product regressions.

The replacement environment lost/tmp. Source and earlier comparison were restored from pushed branches; no intervening execution is claimed. Pinned dependencies recovered locally without editing package/lock files. Final worker/facade/app/CSS byte counts match the November5 control, but symlinked external dependency notices add26,747raw bytes (45,305→72,052notice bytes). Preserve that topology cost. These complete HTML absolutes do not replace the earlier matched main→PR table. The historical main comparison and all prior evidence remain on ancestor dd7f8e9da. Forest wire+10.19%, Sparse256area+5.04%, sharedER256 refusal and Sparse32 proof cap remain separate; RequirementTB historical+9.53% remains falsified at741. Original baseline/Trident/pinned Mermaid12.2/Pele1.9 unavailable; Replacement24 sealed.

Reproduce on the pinned checkout:

```sh
NODE_ENV=production AGENTIC_MERMAID_SCENE_ASSERTIONS=0 bun run scripts/site/editor.ts
bun test src/__tests__/browser-runtime-minify.test.ts
bun test e2e/browser.test.ts --test-name-pattern 'standalone editor renders and verifies with one persistent Blob worker|standalone editor stays within its single-renderer payload budget' --timeout 180000
bun run typecheck:core
bunx biome lint scripts/site/editor.ts scripts/build/runtime-minify.ts src/__tests__/browser-runtime-minify.test.ts
```

Budget failure is expected in the retained symlinked environment. No test reads this evidence. Restore evidence.tar.gz into empty scratch space; its comparison/ prefix contains four trial directories, controllers, whole compressed HTML, metafiles, diagnostics and checks. Every member was byte-compared. Original dependency symlinks are recorded as metadata and not dereferenced into the archive. Archived leases never authorize writers; acquire fresh live coordination before continuing. Campaign deadline2026-11-08T23:59:59Z remains unchanged.
