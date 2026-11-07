# Native and ELK: performance comparison

Source: `d8c8ac879793a586b4b741c178b89d7900bd27ed`. Node 24.19.0 public source API, same shared measurement/emission/certification pipeline and pinned ELK 0.11.1. This measures the selected layout backend inside the PR, not PR-versus-main or packaged/browser startup.

Native has lower uncached-repeat medians in five of six fixed workloads. Crossing276 favors ELK. Cached-repeat behavior is mixed, including Class128 and Requirement losses for Native. No representative-workload aggregate speedup is inferred.

## Method and completion

Six frozen source/edit pairs, cache 0 and 1, four fresh sequential processes per backend/cache/input, with alternating backend order: 96 processes. Each times its first render after imports, four original-source repeats, a real label edit, and an edited repeat: 672 timed calls. Every call consumes the full SVG and serializes the entire receipt/product. All 672 return with passed final proofs. Every source repeat matches its complete first SVG/receipt, all edits change the SVG, and all 96 edited outputs contain their expected actual text. All 96 processes record the requested backend with fallback none.

V8 sampling and timed observers are off. Common module import is recorded separately. Explicit GC, file writes and compression are outside render timing. One post-timed cache audit per process confirms real hits/bypasses. Original SVG retained for determinism and the source harness affect memory. Four process replicates, with four within-process repeat samples each, are a limited sample; JSON retains ranges and paired process medians.

## First render after import

Milliseconds, median of four fresh processes per cell; cache disabled. Source module import is additional common work, not included below: median 2,277.3ms across 96 processes (range 2,018.9–3,583.7ms). The selected backend is supplied only after that import. This is not compiled-package or browser cold startup; OS filesystem caches are not cleared.

| Workload | Native ms | ELK ms |
| --- | ---: | ---: |
| Unequal-height forest | 220.2 | 398.9 |
| Crossing276 | 705.8 | 834.9 |
| Class128 chain | 722.9 | 1,128.4 |
| ER256 LR chain | 1,105.0 | 1,502.0 |
| Sparse256 | 468.6 | 880.8 |
| Requirement, five relationships | 152.6 | 381.8 |

## Repeats and edits

Milliseconds. Repeat cells pool 16 calls across four processes. Edit is the first changed-source call with caching enabled, four fresh-process observations per backend. Paired-process results and min/max values are in PERFORMANCE.json.

| Workload | Uncached Native | Uncached ELK | Cached Native | Cached ELK | Edit Native | Edit ELK |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Unequal-height forest | 40.1 | 60.1 | 8.1 | 8.7 | 47.9 | 76.6 |
| Crossing276 | 320.4 | 264.9 | 8.7 | 11.4 | 226.4 | 290.4 |
| Class128 chain | 480.6 | 598.0 | 327.1 | 298.9 | 540.5 | 556.6 |
| ER256 LR chain | 829.5 | 991.7 | 720.6 | 719.1 | 852.2 | 1,021.2 |
| Sparse256 | 299.1 | 503.6 | 282.0 | 291.0 | 292.7 | 591.2 |
| Requirement, five relationships | 30.0 | 52.3 | 31.9 | 27.9 | 30.4 | 52.8 |

Crossing276 uncached repeats are about 21% slower in Native; all four paired process medians favor ELK. Class128 cached repeats are about 9% slower in Native, again with all four paired medians favoring ELK. Requirement cached repeats favor ELK in three of four pairs. Near-equal cache figures for forest/ER/Sparse have overlapping process variation and should be read as close.

Positioned-layout cache hits occur in every cache 1 post-timed audit. Forest/crossing276 also hit the completed native drawing. Class/ER/Sparse bypass that drawing cache for `owned-scene-geometry`, while Scene paint certification remains active. Requirement drawing/certification also miss. Layout caching therefore leaves substantial output-side work in those families. This is evidence about the current paths, not permission to add caches or a source-frame CPU attribution.

## CPU and memory

Process CPU for uncached repeats, median milliseconds across 16 calls/four processes, includes all Node threads:

| Workload | Native CPU ms | ELK CPU ms |
| --- | ---: | ---: |
| Unequal-height forest | 63.1 | 112.4 |
| Crossing276 | 586.3 | 416.0 |
| Class128 chain | 729.3 | 934.6 |
| ER256 LR chain | 1,272.5 | 1,638.1 |
| Sparse256 | 539.7 | 830.5 |
| Requirement, five relationships | 57.2 | 91.7 |

Process CPU includes all Node threads and can exceed wall time. RSS includes source imports, the harness, previous compression and retained first products; heap is sampled after the edited repeat with explicit GC before that call. These are observations, not package/browser memory budgets or a leak experiment. Values below are cache-enabled medians from four processes, MiB.

| Workload | Native peak RSS | ELK peak RSS | Native heap | ELK heap |
| --- | ---: | ---: | ---: | ---: |
| Unequal-height forest | 159.7 | 177.8 | 36.8 | 46.7 |
| Crossing276 | 205.1 | 208.1 | 46.7 | 58.3 |
| Class128 chain | 264.9 | 290.5 | 81.3 | 92.9 |
| ER256 LR chain | 292.9 | 349.0 | 91.1 | 107.7 |
| Sparse256 | 246.6 | 284.7 | 60.3 | 71.2 |
| Requirement, five relationships | 158.9 | 177.1 | 36.3 | 45.6 |

Native’s median peak RSS is lower on all six measured cases, although the crossing276difference is small. All call-level CPU/heap/RSS snapshots and ranges are retained.

## Actual compressed products

Bytes, Native/ELK, compressed offline from actual complete products using the same Node 24 zlib: gzip9 and Brotli11. The reconstructed full product exactly matches the timed consumer’s raw byte count.

| Workload | SVG gzip9 N/E | SVG Brotli11 N/E | Entire product gzip9 N/E |
| --- | ---: | ---: | ---: |
| Unequal-height forest | 1,480 / 1,482 | 1,232 / 1,229 | 2,683 / 2,681 |
| Crossing276 | 3,107 / 3,157 | 2,574 / 2,666 | 4,386 / 4,437 |
| Class128 chain | 13,063 / 13,063 | 7,555 / 7,555 | 14,851 / 14,844 |
| ER256 LR chain | 48,420 / 48,324 | 30,727 / 30,314 | 50,225 / 50,244 |
| Sparse256 | 13,306 / 12,747 | 6,638 / 6,836 | 14,902 / 14,477 |
| Requirement, five relationships | 1,636 / 1,677 | 1,353 / 1,401 | 2,827 / 2,871 |

Native is not uniformly smaller: Sparse256 adds 559 SVG gzip bytes, despite a smaller Brotli product; ER256 adds 96 SVG gzip bytes and 413 Brotli bytes. Class SVG bytes are equal. Whole-product and SVG transfer are separate costs.

The current standalone includes both backends. Selecting Native downloads the same HTML artifact: 2,204,863 raw / 1,324,640 gzip9 / 1,258,659 Brotli11 bytes, using the previously verified complete Bun 1.4.4 build. A Native-only bundle was not built; no backend-switch download saving is claimed.

## Reproduction and limits

PLAN.json freezes sources, options, edit pairs and alternating process order. run-measurements.py adapts the existing sampling-optional collector without changing production code. It retains process failures/timeouts; there were none in this run. summarize-performance.py, PERFORMANCE.json, ACTUAL-EDIT-TEXT.json, PERF-BACKEND-SELECTION.json and PAYLOAD.json retain all results. Failed report-only probe drafts are preserved separately.

These timings exclude source import, process launch, compression and explicit GC. Browser interactive latency, compiled package cold imports, real startup module request graphs and Native-only package payloads are not measured here. There is no comparison with failed ER256 BT/RL work, no ratio from a refusal against a delivered result, and no claim that a particular PR change caused these backend differences.
