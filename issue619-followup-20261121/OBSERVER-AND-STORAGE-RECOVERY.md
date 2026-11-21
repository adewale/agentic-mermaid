# Observer limits and local storage recovery

PR #621 source remains `c18f607364ca1d85dd91a669c8ac33a2c7173a23`; there are no source edits in this recovery. The normal source push reported `Everything up-to-date`.

## Why the crossing observation was unassessed

Trident 0.4.0's `flowchart-svg-layout-v2` policy samples SVG geometry using a nominal 0.5 CSS-pixel step, adjusted by the transform matrix. Its global budget is 32,768 samples, shared by node contours, edge centerlines and markers. It charges the samples before simplifying them, so even a long straight segment can consume thousands of samples. The separate comparison work limit is 2,000,000 operations. The archived failure here was specifically `Layout sample budget exceeded`, not a comparison-limit failure or an inability to render the input.

The archived 17 November observer run used the same titled 19-node/44-edge source, SHA-256 `f1d482325fb4f8c463b88269655bce30a02556b0b2a1990deae3cef6f0714e12`. It predates the current wrapper and is not a new c18 observation.

| Archived product | Nodes observed | Edges observed | Partial crossings | Qualified full crossing total |
| --- | ---: | ---: | ---: | --- |
| Native | 19/19 | 13/44 | 3 | unassessed |
| Zombie Mermaid | 19/19 | 7/44 | 0 | unassessed |
| ELK.js | 19/19 | 10/44 | 3 | unassessed |
| ELK.ts | 19/19 | 10/44 | 3 | unassessed |

Once the edge inventory is incomplete, partial counts cannot stand in for whole-diagram totals. In particular, Zombie's partial zero is not evidence of a crossing-free diagram. Node-overlap observations with complete node coverage can still be assessed. Label-related observations also had separate ambiguous-caption ownership gaps; a larger sampling allowance would not resolve those.

[Extracted coverage and original reasons](analysis/trident-cyclic19-capped-coverage.json). The later complete static SVG diagnostic examined all 946 edge pairs and produced the already-reported current counts: ELK.ts 37, same-wrapper ELK.js 37, Zombie 31, hosted Pele 40. Its exact curve/endpoint definition differs from Trident's sampled metric; it is not an official Trident score replacement.

A useful observer repair would parse straight SVG segments directly, use error-bounded subdivision for curves and prune disjoint bounds before comparison, retaining explicit work limits and incomplete outcomes. No Trident policy, cap or scoring code was changed here.

## Docker recovery

`docker system df` identified one stopped container, `elk-port-local-ci-20261116`, exited since 18 November, with a reported 1.14 GB writable layer. No containers were running. Both images, zero local volumes and zero build-cache entries were retained; there was no blanket prune.

Before removal, the full filesystem was exported and its private Docker configuration saved. Streaming tar/gzip verification passed for 49,453 members, with 3,662,364,537 logical file bytes and a 1,608,653,347-byte archive. The verified backup was moved to a private on-disk recovery directory; its prior host-RAM path remains an alias. It is not published because it may contain private configuration or files. Bind-mounted workspace data and the original images remain intact.

Only the verified stopped container was removed. After preserving the archive on disk, the workspace reported 4,843,450,368 free bytes, about 4.51 GiB. For future one-off CI containers, use `--rm` and bind-mount outputs that must survive; inspect `docker system df` and archive any needed stopped-container contents before targeted removal.

The unchanged pinned font-subset check now passes its manifest and four canonical WOFF2 files. It retains the pinned image, Python/fonttools/Brotli versions, wheel hashes and output-byte comparisons. Local runner accommodations are a temporary `/tmp` memory mount and its trusted host CA bundle; TLS verification was not disabled.

A fresh full `bun run check:pre-push` exits 0: eight checks pass, with the default Playwright browser lookup skipped. Its installed-browser equivalent also exits 0 using `/usr/bin/chromium` and passes the actual website request graphs and unchanged payload budgets. The repeated 529-diagram/2,116-format audit reports no hard findings, soft findings or render errors; types, lint, website artifacts, lazy bundle and dependency checks pass. This is environment-recovery validation, not new layout or speed progress. Existing failed logs remain unchanged.

[Recovery result](checks/storage-recovery-result.json) · [Full pre-push log](checks/pre-push-storage-recovered-c18f6073.log.gz) · [Font log](checks/font-storage-recovered-c18f6073.log.gz) · [Actual Chromium report](website-payload-storage-recovered-c18f6073.json). No remote CI ran, no source or golden changed, and the PR stays draft pending review. The previously reported runtime/memory costs and unresolved crossing loss remain.
