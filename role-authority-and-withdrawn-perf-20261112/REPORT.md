# Shared role validation fix; performance trial withdrawn

PR602 source: `fc4bd85a3f51ddac635f77a65188bba37399f742`. Control: `9644bce7edd0cd9706bb5dbfc30a89d8d2feb643`. Frozen Main integration remains 913; this is manual follow-up, with automations off.

## Correctness improvement

Borrowed public role descriptors could change the canonical font-size minimum and append an unknown text transform. Both invalid inputs then passed validation, and fresh JSON Schemas inherited the corruption. Commit `0bbe3876f16c3de0ba825572681c1fdb7861b26a` freezes the canonical descriptor leaves and enum arrays. Both mutation attempts now fail and both inputs reject. Caller StyleSpecs and fresh schema copies remain mutable and isolated.

The owning mutation test fails before the fix and passes afterwards; 57 other role/style/config checks and lint pass. The actual built public SDK reproduces the same before/after behavior. Public schema bytes and order remain identical (22,561 bytes). A local editor-discovery child timeout also reproduces on clean control; no timeout was increased. Final CI passes all three unit shards.

Commit `361ce266f2667d02dc704dc9f4e247c46c701ac0` also avoids constructing discarded property schemas: 240 objects become 114. This is construction subtraction, without a demonstrated end-to-end CPU or retained-memory gain.

## Output and resource qualification

Existing Trident: 124 portable and 198 authored inputs, with 310 returned SVG/receipt products exactly equal to control and 12 unchanged errors. All 194 authored meaning, actual Chromium ink and quality vectors are unchanged. Eight complete public-browser products also match. These are validation of unchanged output, not new visible coverage.

Mixed browser payload: 2,514,528 raw / 782,233 gzip / 622,543 Brotli bytes. All caps fail: excesses are 84,528 / 20,733 / 4,543 bytes. Relative to control the costs are +103 / +21 / +98 bytes. Requests are unchanged. Post-GC browser heap changes range from -2,012 to +8,672 bytes; no memory win is claimed.

## Withdrawn performance experiment

Commit `313a142bf3f02632f0461273f4c8c975c685cf94` moved scalar classification to the recursive capture entry. Final matched 24-worker measurements preserved all 54 products but worsened Native repeated SVG latency from 148.52 to 179.41 ms (pooled p95 217.70 to 393.55 ms). ELK fully consumed warm response worsened from 327.03 to 349.62 ms and cold response from 911.99 to 935.23 ms. Some edit/full-response samples improved; all mixed and adverse results are retained.

Separate matched stock and fully consumed profiles preserve 11 products each. Stock copy inclusive time rises from 20.63 to 22.07 ms and rubric inclusive time from 17.69 to 23.23 ms; these overlap and cannot be added. The full-response profile differs and retains its two large sample deltas. Neither justifies overriding the adverse stock timings. Commit `3b6a84f626d8f258bdf6dd352c5cf06d1f3d7a94` restores the capture implementation exactly to control. No performance improvement is claimed for this withdrawn work.

## Remaining losses

Native100's target remains unmet. Chain300 returns unknown proof status at the unchanged 400,000-operation cap on both engines; this is not a visible-render failure. ER256 already passed eight lanes, so no repair is claimed. Original baseline/pinned Mermaid/Pele comparisons remain unavailable; Replacement24 stays sealed.

Final CI run 43203405612 completed with failure. Types, lint, all unit shards, browser E2E and consumer/platform checks pass. Browser/website/editor payload budgets and layout advisory fail. The PR is not ready. No caps, defaults, versions or caches were added.

`final-fix-evidence.tar.gz` contains actual SDK/build/browser/Trident evidence and source patch. `withdrawn-performance.tar.gz` preserves all trial sources, compiled artifacts, timings, profiles and adverse outcomes. `MANIFEST.json` identifies and hashes every archived file; both archives were read back and verified before this checkpoint.
