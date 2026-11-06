# Standalone worker compression — 6 November 2026

Source `970c9f807bd82b6c3e731aadef3585ee6b071523` descends from `63a32f5b9`.
Reuse the existing SWC compressor with one pass for the already Bun-minified
worker; other callers retain six. The worker graph, notices, bounded decoder,
byte/CRC limits, cancellation and Blob lifecycle remain in place. No cache,
package pin, backend default, release version or ceiling changes.

Matched Bun 1.4.4 / ELK 0.11.1 complete production builds:

| Product / cost | Before | After |
| --- | ---: | ---: |
| HTML raw bytes | 2,194,300 | 2,089,396 |
| HTML gzip9 bytes | 1,427,769 | 1,346,874 |
| HTML Brotli11 bytes | 1,360,667 | 1,281,514 |
| Worker decoded JS bytes | 4,857,766 | 4,692,517 |
| Worker packed bytes | 1,177,244 | 1,098,566 |
| Peak build RSS, KiB | 554,312 | 691,384 |
| Observed build wall, seconds | 42.4 | 20.2 |

HTML saves 80,895 gzip bytes (5.67%) and 79,153 Brotli bytes (5.82%). Peak RSS
rises 137,072 KiB (24.73%). Both final builds finish within the existing 55-second
child deadline. Variable single samples establish no speed ratio. The decoded
JavaScript changes; observable worker equivalence is the contract.

The actual emitted-worker owner passes complete Blob comparison, enrolled
family/style SVGs, full receipts and verification against source, backend/fallback,
crash recovery and ASCII/Unicode/PNG. Two existing minifier cases, core types and
three-file lint pass. The browser budget owner still fails by 12,374 gzip bytes;
the combined browser invocation exits 1 with one pass, one failure and 499
assertions. Current CI is recorded in handoff/CI.json. PR602 remains draft.

Six-pass worker compression hit the existing candidate deadline and is unshipped.
Another control timed out under concurrent typing. Literal raw insertion was
only a compression lower bound: it saved 5,910 Brotli bytes while worsening gzip
by 283,230 bytes, before solving HTML representation obligations. Both hypotheses
are stopped. Failed dependency/type attempts and harness drafts remain in the
archive. Import identity reuse and Bun data-URL fragment parsing were test
harness errors; inert comments inside base64 give the two cases separate modules.

The replacement environment lost `/tmp`. Source and comparisons were recovered
from pushed refs; no intervening execution is claimed. A wrong ELK 0.11.0 install
was replaced locally with the pinned 0.11.1. Final worker/facade/app/CSS byte counts
match the November 5 control. Whole HTML adds 26,747 raw notice bytes because
symlinked external dependencies are enumerated: 45,305→72,052 notice bytes. Keep
that cost and the earlier matched main comparison separate. Historical evidence
remains on ancestor `dd7f8e9da`; original baseline/Trident/pinned peer comparisons
remain unavailable, and Replacement24 stays sealed.

Reproduce with the pinned dependencies:

```sh
NODE_ENV=production AGENTIC_MERMAID_SCENE_ASSERTIONS=0 bun run scripts/site/editor.ts
bun test src/__tests__/browser-runtime-minify.test.ts
bun test e2e/browser.test.ts --test-name-pattern 'standalone editor renders and verifies with one persistent Blob worker|standalone editor stays within its single-renderer payload budget' --timeout 180000
bun run typecheck:core
bunx biome lint scripts/site/editor.ts scripts/build/runtime-minify.ts src/__tests__/browser-runtime-minify.test.ts
```

`evidence.tar.gz` contains 72 files (24,250,623 raw bytes; 11,453,482 archive bytes),
every member byte-compared. Extract into empty scratch space; comparison/ contains
four trial directories, complete HTML, metafiles, controllers and checks. Symlinks
are recorded as metadata without dereferencing them. Tests never read this
archive. The handoff preserves the description, readiness diagnostics and released
coordination state. Obtain a fresh live lease before writing; archived leases
cannot authorize a writer. Deadline: 2026-11-08T23:59:59Z.
