# Exact-axis crossing probe: withdrawn

Disposition: **rejected and restored**, no production change retained. Source returns exactly to `68986ba8e3b76ad99dad44c6ec8d43475cc5e12f`. Do not repeat this axis variant to seek favorable clocks.

The profiled fan-in100 crossing path made 67,890 exact intersection calls per render, including 29,106 same-axis misses (42.87%). A finite-span axis classification in each existing segment record skipped only guaranteed zero-determinant pairs; malformed nonfinite/overflowing spans kept the original fallback. No index, trust flag, cache, cap, default, version or proof policy was added.

The observed opportunity and sampled reduction did not establish a useful complete-product benefit. Native fan-in100 full repeat increased 155.88→163.11 ms, ELK 348.48→383.02 ms. Native chain100 full repeat increased 101.90→105.37 ms and first edit 134.86→174.94 ms. SVG-only fan medians improved slightly, while multiple cold/edit/zero-opportunity chain cells worsened. All adverse cells remain in the raw results.

## Provenance and controls

- Exact source baseline 689, integrated Main913, canonical CI43311727806 SDK SHA256 `62ac69ba8225005e24f712a99c13477039c8d417b0f201cdabdea8d25415893b`. Trident f080278, locked project dependencies, pinned Node24.19.0 and Bun1.4.4.
- Matching actual seven-entry Node builds reuse recovered `build-node.ts` and current tsup configuration/onSuccess providers. Baseline and candidate use isolated source snapshots and shared locked dependency symlinks. No hand-edited compiled code is timed. The earlier scratch compiled counter package is diagnostic-only.
- 66 source-mapped profile products: all132 SVG/entire-receipt comparisons exact canonical CI689. Actual source maps attribute copyInner to native-paint-emission228, crossingPoint to edge-crossings73/74, and rubric to layout-rubric496/656. Inspector post overhead is retained and excluded from design claims; sampled contributions do not imply unprofiled milliseconds saved.
- One unprofiled cache0 cohort: 144 stock workers (warm/cold/import/memory/baseline) and36 full workers/324 calls. Three fresh process replicas,7 adaptive warm batch means; exploratory, not formal calibration. Backends Native+ELK, cases chain100/fan-in100/chain300, same source/options/edit expectations. Zero lifecycle failures, cgroup OOM0.
- All162 paired full products have exact whole SVGs **and entire receipts** (324 component comparisons). All6 retained stock source pairs are exact and match same-arm public WithReceipt SVGs. Each arm has108 passed/54 unknown full products; all chain300 outcomes remain400000-operation unknown. Diagnostic stock meaning/paint qualification remains partial/unmeasured, not falsely upgraded by byte identity.
- Before/after owners164P/0F,7990 assertions; scoped lint passes. Core types pass; canonical repository typecheck passes after fetching exact pinned Trident/frozen lockfile. New public getter/mutation guard is behavior-preserving and passes baseline; this performance refactor has no claimed red→green bug fix.

## Unprofiled observations

Cells are baseline→candidate medians of3 process medians, milliseconds. Stock fresh means comment-varied source; edits alternate authored base/edit as the existing protocol specifies. Full first edit is distinct from repeat edits. Import is excluded from cold render. No cross-host ratio versus earlier campaign numbers is claimed.

| Case | Backend | Stock repeat | Stock fresh | Stock edit | Stock cold | Import | Full repeat | Full cold | First edit | Repeat edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chain100 | agentic | 85.90 → 87.15 | 67.73 → 71.01 | 66.47 → 63.34 | 247.88 → 249.50 | 174.76 → 189.52 | 101.90 → 105.37 | 256.16 → 232.26 | 134.86 → 174.94 | 94.52 → 90.20 |
| chain100 | elk | 154.83 → 151.04 | 109.58 → 109.11 | 108.85 → 111.17 | 525.82 → 518.97 | 185.59 → 178.27 | 191.22 → 170.76 | 514.01 → 515.52 | 215.55 → 237.58 | 181.29 → 171.89 |
| fanin100 | agentic | 128.42 → 125.52 | 104.07 → 95.01 | 95.90 → 98.00 | 334.16 → 329.69 | 189.19 → 191.02 | 155.88 → 163.11 | 319.98 → 336.87 | 172.81 → 149.32 | 141.68 → 137.66 |
| fanin100 | elk | 258.21 → 249.65 | 211.71 → 212.63 | 213.45 → 227.94 | 842.13 → 820.33 | 257.30 → 200.65 | 348.48 → 383.02 | 760.89 → 810.13 | 338.22 → 401.32 | 331.57 → 320.28 |
| chain300 | agentic | 200.33 → 204.62 | 168.48 → 177.12 | 193.98 → 189.03 | 454.29 → 467.48 | 178.01 → 184.85 | 291.53 → 288.54 | 472.50 → 452.99 | 296.72 → 292.92 | 255.51 → 262.96 |
| chain300 | elk | 324.24 → 303.37 | 270.88 → 265.25 | 325.10 → 310.62 | 859.34 → 957.41 | 192.66 → 204.32 | 474.79 → 462.10 | 878.04 → 900.17 | 460.97 → 485.34 | 459.22 → 462.62 |

## Memory and bytes

RSS is whole stock process including harness/import/earlier work and GNU observer. Baseline-adjusted retained heap uses separate fresh-process after-GC controls. Full at-return heap retains warmup/evidence and is not isolated per-call allocation or retained memory. Browser/native/WASM memory is outside these Node observations.

| Case | Backend | Stock process peak RSS MiB | Stock baseline-adjusted retained heap MiB | Full at-return heap MiB |
| --- | --- | ---: | ---: | ---: |
| chain100 | agentic | 138.51 → 137.98 | 6.97 → 6.98 | 29.36 → 29.36 |
| chain100 | elk | 192.93 → 191.81 | 21.13 → 21.09 | 55.21 → 54.70 |
| fanin100 | agentic | 141.08 → 142.00 | 7.05 → 7.07 | 32.45 → 30.49 |
| fanin100 | elk | 195.70 → 195.11 | 21.66 → 21.64 | 60.57 → 57.80 |
| chain300 | agentic | 184.88 → 184.88 | 8.95 → 8.90 | 48.51 → 45.40 |
| chain300 | elk | 301.54 → 286.62 | 28.48 → 28.55 | 105.86 → 102.10 |

Actual matching emitted Node JS/CJS set (15files, per-file compression, excluding maps/assets/types): raw3,939,496→3,939,632B (+136), gzip9 1,208,186→1,208,256B (+70), Brotli11 952,032→952,075B (+43). This is the emitted set, not a browser fetched closure or network transfer. Browser payload/heap and the existing mixed/site/editor budgets were not requalified for this withdrawn patch; no browser gain or budget closure is claimed.

## Retained evidence and verification

- `withdrawn-axis-source/candidate.patch` SHA256 `a12cf06f38b05ec396bee1b776d540c65672ab5a29fb9800d1080ac38d327676`, exact withdrawn source/test files and both actual source/build trees.
- `axis-clock/{SVG,RECEIPT}-METRICS.{json,csv}`, complete original job/result streams, individual workers and all response bytes. `axis-clock/SOURCE-PAIR-EXACTNESS.json` retains all162 pairs.
- `PROFILE-PRECISE-SUMMARY.json` binds canonical minified locations; `MAPPED-PROFILES.json` uses actual matching build source maps. All raw cpuprofiles/products retained. `BUILD-PRODUCT-CONTROLS.json` is the canonical CI exact-product control.
- `NUMERIC-PARITY.json`:1152 raw-helper pairs exact across zero/subpixel/huge-finite/Infinity/-Infinity/NaN and involved filtering. This preserves fallback without claiming invalid geometry is correct.
- `OPPORTUNITY-SUMMARY.json` and diagnostic-only scratch package preserve counters,0-opportunity chains and exact products; no timing gain inferred from that package.
- `NODE-EMITTED-BYTES.json` contains exact file hashes and real compression bytes.
- Commands: `bun test src/__tests__/edge-crossings.test.ts src/__tests__/edge-crossing-pair.test.ts src/__tests__/layout-rubric.test.ts`; `node_modules/.bin/biome lint src/shared/edge-crossings.ts src/__tests__/edge-crossings.test.ts`; `bun run typecheck`; successful exact retry `bun run typecheck:repo` outside sandbox. All invoked with pinned Node/Bun leading PATH.
- Initial sandbox esbuild service failures, proxy failure before repo tsc, and timing preflight JSON EOF before0workers are retained setup failures. Successful matching builds/preparation/clocks ran outside the sandbox. Initial scratch counter variable collision/zero-counter encoding failures are retained; fixed counters were exact and never used as clocks.

Production source was restored only after exact patch/source preservation. `git status --short` is empty. No source commit, push, PR or cap change was performed by this implementation agent. Root owns evidence checkpointing. The next intervention is the independently audited no-op pass-budget/compound quality seam; the campaign continues.
