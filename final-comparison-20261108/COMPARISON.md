# ELK, Native and Trinity: verified comparison

Source head: `21194248b21873a87fa72fa545f67cfd8b49dad4` (test/document maintenance). Runtime: `fe911360151ebfd534799db7da8d0533931054ec`. Existing draft PR602 only; no new PR or issue. Integrated main: `e7cb05baa7f68154942a9ce9c6e9aaaee163dc94`. Measurements bind their individual revisions below; do not treat different dated mixes as a before/after speedup.

Decision: retain ELK. Trinity adds useful opt-in delivery and smaller measured code closures, but is not a qualified replacement. Native is often faster on these small inputs; costs and quality remain mixed. No overall correctness percentage or composite score follows.

## Delivery and correctness

Frozen same-input 30-case public cohort, same options except backend:

| Metric | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| SVG returned with passed receipt certification | 28 | 28 | 24 |
| Explicit unsupported | 0 | 0 | 4 |
| Input errors | 2 | 2 | 2 |
| Trident criteria passed | 575 | 576 | 518 |
| Trident criteria unsupported | 6 | 6 | 65 |
| Trident criteria blocked/unknown | 29 | 28 | 28 |
| Trident criteria failed | 3 | 3 | 2 |

The 613-criterion ledger includes common parser and prelude checks: it is not a solver pass rate. Fewer failed Trinity criteria can result from declining a case; they do not establish higher correctness than a backend that returns it. Independent authored expectations cover identities, parents, endpoint direction, labels and family semantics; actual browser SVG observations cover visible labels, clipping, contacts and ownership only where enrolled. Passed receipt certification does not establish every visible/readability property. Unknown ink and unsupported outcomes remain enrolled.

Trinity's four enrolled unsupported inputs are nested Flowchart with parallel/Unicode, Class namespaces/members/cardinality, nested reciprocal State aliases, and controlled image. Two shared font-size/reset input errors remain. No omitted failures, silent flattening or fallback credit. Explicit fallback records unsupported then selected ELK; hard defects/work exhaustion stay hard.

The routed Trinity slice is64nodes/128edges, with measured body/marker/label support and canonical paint. Forest body placement has separate4096/16384 admission; single-container Architecture uses that placement with its own routes. Admission at a cap is not delivered coverage at capacity. Native/ELK retain broader existing domains. ER256 now delivers in four directions through both Native/ELK at the original400k work limit; Trinity does not gain that capacity from the shared repair. Sparse32's proof exhaustion is a separate unresolved limitation.

## Complete-product wall time

Fresh serial Node24 processes consume SVG plus the entire JSON receipt. Imports, explicit GC, artifacts and compression are outside render windows. Two process replicas per backend/cache/input, five windows each;300 calls total, all returned/passed. Repeats and repeated edits are byte-exact; edits change SVG. Layout-cache0 still permits existing derived caches. Small exploratory samples: no general ratio, percentile or throughput claim. Cold-render excludes module import, so it is not application startup.

Each cell is **cold / repeat2 / edit2 milliseconds**. Values are medians across two processes. The existing raw report retains all first-repeat/edit windows and ranges.

| Input / source / layout cache | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Flowchart / `bbab8283d` / 0 | 318.57 / 33.74 / 33.77 | 153.21 / 19.59 / 20.33 | 139.91 / 17.53 / 14.80 |
| Flowchart / `bbab8283d` / 1 | 327.33 / 5.75 / 15.85 | 165.28 / 5.09 / 13.01 | 141.92 / 5.64 / 15.76 |
| Requirement / `bbab8283d` / 0 | 308.13 / 45.26 / 39.11 | 164.63 / 31.18 / 27.09 | 154.87 / 28.69 / 28.23 |
| Requirement / `bbab8283d` / 1 | 352.66 / 26.53 / 25.02 | 158.21 / 25.19 / 22.00 | 162.93 / 28.47 / 24.78 |
| Class / `a67632464` / 0 | 300.10 / 35.90 / 34.20 | 160.80 / 26.57 / 23.13 | 159.70 / 21.25 / 24.03 |
| Class / `a67632464` / 1 | 328.76 / 22.29 / 21.82 | 180.72 / 21.61 / 18.14 | 174.89 / 21.90 / 22.48 |
| ER / `bcf5e6bad` / 0 | 343.84 / 32.51 / 30.42 | 201.88 / 23.09 / 24.82 | 300.15 / 22.64 / 21.74 |
| ER / `bcf5e6bad` / 1 | 356.27 / 17.96 / 19.25 | 153.83 / 17.19 / 16.87 | 155.88 / 19.14 / 18.98 |
| Architecture / `fe9113601` / 0 | 450.56 / 62.45 / 44.81 | 186.22 / 29.26 / 43.92 | 247.81 / 62.75 / 26.83 |
| Architecture / `fe9113601` / 1 | 376.81 / 22.65 / 27.45 | 167.46 / 30.10 / 22.07 | 188.27 / 30.03 / 22.52 |

Adverse observations matter: Trinity ER cache0 cold300.15ms versus Native201.88; Architecture repeat2 62.75ms versus Native29.26 and ELK62.45. Cached winners change by input; no uniform Trinity or Native advantage. Edits are small authored edits, not a displacement/readability qualification.

## CPU and memory

CPU milliseconds for the same **cold / repeat2 / edit2**, cache0. Process CPU can exceed wall time because runtime work can use multiple threads.

| Input | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Flowchart | 465.47 / 74.08 / 67.99 | 208.68 / 34.77 / 40.77 | 197.55 / 31.86 / 31.57 |
| Requirement | 467.32 / 81.78 / 66.68 | 269.63 / 57.99 / 48.87 | 267.64 / 55.29 / 49.12 |
| Class | 469.31 / 62.12 / 54.62 | 229.35 / 44.96 / 39.92 | 228.57 / 36.83 / 42.75 |
| ER | 492.00 / 59.67 / 54.61 | 326.67 / 39.21 / 37.19 | 368.28 / 44.87 / 34.01 |
| Architecture | 637.01 / 128.23 / 75.75 | 299.50 / 67.62 / 62.15 | 353.54 / 121.66 / 44.16 |

Observed **process peak RSS KiB / heap-used-after-window MB** ranges across the two cache0 processes and all their windows:

| Input | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Flowchart | 181,220–194,016 / 49.08–53.91 | 172,356–188,900 / 37.00–64.45 | 179,400–188,716 / 35.87–39.69 |
| Requirement | 191,792–195,080 / 51.73–57.03 | 185,612–187,716 / 40.17–41.86 | 171,468–188,564 / 36.78–40.81 |
| Class | 189,592–195,800 / 48.40–56.71 | 159,080–172,780 / 38.53–68.38 | 171,364–181,428 / 38.43–43.95 |
| ER | 180,696–180,888 / 49.96–55.35 | 185,272–188,584 / 36.22–40.57 | 147,584–171,200 / 37.01–49.16 |
| Architecture | 180,984–195,956 / 51.95–56.47 | 170,208–174,796 / 36.64–55.12 | 170,308–172,484 / 35.94–39.82 |

RSS includes imports, harness and artifacts; heap snapshots are not heap peaks, and GC affects deltas. These observations establish no universal memory superiority, allocation-rate gain or leak/settled-retention result. Cache1 memory and every per-window delta remain in the source PERFORMANCE.json files.

## Actual fetched code and output bytes

Same six-family browser input union plus four enrolled features at runtimefe911. The real lazy binding consumes whole public SVG+receipt; all three browser lanes pass. Counts include binding requests, while product bytes exclude the separately reported binding. Server responses were raw; gzip9/Brotli11 compress exact fetched files afterward. These are code-delivery bytes, not compressed-wire, startup or throughput results.

| Product metric | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Raw bytes | 2,750,587 | 1,463,511 | 1,361,905 |
| gzip9 bytes | 856,349 | 483,797 | 450,550 |
| Brotli11 bytes | 686,964 | 414,176 | 385,763 |
| Requests including binding | 41 | 47 | 47 |

Whole output JSON (SVG plus full receipt), **raw / gzip9 / Brotli11 bytes**, original input cache0:

| Input | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Flowchart | 11,839 / 2,282 / 1,956 | 11,856 / 2,286 / 1,959 | 11,856 / 2,292 / 1,963 |
| Requirement | 18,875 / 3,210 / 2,748 | 18,735 / 3,177 / 2,693 | 18,867 / 3,204 / 2,710 |
| Class | 17,185 / 3,108 / 2,642 | 17,144 / 3,073 / 2,631 | 17,389 / 3,109 / 2,658 |
| ER | 17,509 / 3,067 / 2,611 | 17,529 / 3,079 / 2,631 | 17,635 / 3,077 / 2,602 |
| Architecture | 16,637 / 2,839 / 2,426 | 16,682 / 2,855 / 2,452 | 16,663 / 2,848 / 2,437 |

The current shared editor product is1,341,338 Bun gzip9 /1,281,204 Brotli11 bytes. Its original1,334,500gzip ceiling fails by6,838; backend-specific lazy savings do not erase this product failure. No default, package version or ceiling was changed. Package-wide, standalone-native-only and equivalent Pele startup rankings are not established by the fetched union.

## Retained actual-SVG quality examples

Every cell is **area / connected wire / bends** on the same named input. Different metrics remain separate. Units are SVG square units, SVG units and bend count.

| Input | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| Requirement TB | 257,555.1 /963.47 /10 | 230,692.46 /671.2 /8 | 244,079.95 /1,051.96 /18 |
| Class inheritance/composition/dependency TB | 136,680 /348.90 /2 | 131,040 /214.60 /0 | 129,238 /340.30 /4 |
| ER attributes/cardinality TB | 147,532 /400.60 /0 | 119,152 /271.60 /0 | 102,566.1 /192.10 /0 |
| Architecture ports/groups/branching | 151,171.228 /352 /4 | 151,171.228 /358.133 /4 | 151,593.494 /354 /4 |

Requirement numbers are retained from its public01497b98f qualification; Classa676,ERbcf5,Architecturefe911. These are specific quality examples, not all-workload averages. Observed crossing/parallel/opposing counts in the Class/ER/Architecture examples are zero. That does not prove no other visible contact. All directions, raw SVGs and adverse cells are retained. Aspect ratios can be derived from recorded widths/heights; edit displacement, broad symmetry/readability and larger-capacity Trinity quality remain unqualified.

Native's named contacts152/372/201/241, crossing276 and Class2 remain. Historical Sparse256 implemented area gap is+5.04%; the+0.97%candidate is unshipped. The improved current forest wire397.71 versus ELK396.47 supersedes the old+16.89%wire figure; Native area165,356 versus ELK176,727 remains a useful tradeoff. No Trinity result on that named historical forest is inferred from its small Flowchart timing case.

## Metrics not established by this run

| Metric | ELK / Native / Trinity comparison status |
| --- | --- |
| Isolated solve on identical measured input at the final head | No new three-way backend-only ranking; public costs above include the full consumer. |
| Application startup, import time and compressed network transfer | Not established; cold-render excludes import, browser server is raw. |
| p95/p99 latency and sustained throughput | Not established by two process replicas. |
| State-specific runtime | State delivery/ink is qualified; no separate State runtime sample in the five-input timed cohort. |
| Allocation rate, settled retention and leaks | Not established; RSS/heap observations do not answer these. |
| Larger routed capacity and broader nested workloads | Trinity unsupported/unqualified; small-case speed does not erase missing delivery. |
| Edit displacement, symmetry and broad readability | Not independently qualified; changed/exact edit bytes prove different behavior. |
| Package-wide or one-binary-per-backend size | No new comparable three-way product; use the measured actual lazy union and shared editor budget separately. |

## Profile and practical next decision

Current45-product steady profile, five supported inputs ×three backends ×three windows. Raw elapsed sample-delta **self /inclusive ms per call**: copyInner2.162/2.842; external snapshot visit1.581/1.749; certifyNativePaint0.740/3.531; copy0.623/2.948; omitUndefinedObjectFields0.552/0.604. Inclusive costs overlap; sampled elapsed weights are not removable exclusive CPU. Cold/import causes were not isolated here.

The source performance review names files/lines, matching data-oriented proposals and existing caches. Alias/cycle maps enforce custody; pending lazy promises enforce dependency lifetime. Already-admitted snapshots already bypass readmission. Trinity adds no geometry cache. A deliberately unsafe diagnostic-path-only ceiling preserves40 successful full products but breaks nested errors and gives inconsistent timings, including repeat2 worsening26.76→28.04ms. It must not ship; no speedup is invented and no performance rewrite was applied.

Highest-value remaining work is to support the owner's currently refused workload with actual-ink contracts, then remove a demonstrated shared cost only if a safe ceiling can materially close it. Do not optimize the reported criterion counts or erase ELK metric differences indiscriminately. Retain ELK while those outcomes and original distribution failures remain.

## Roadmap disposition and verification

1. Neutral measured contract: implemented.
2. Existing adapters: implemented for migrated domains; broader family/compound paths remain.
3. Measurement/dispatch/legacy completion split: implemented, existing products preserved.
4. Bounded Trinity kernel: implemented.
5. Family/compound migration: six-family bounded delivery implemented; broader compounds incomplete.
6. Profile-first shared-cost investigation: report complete, insufficient diagnostic ceiling stopped; no sufficient safe optimization shipped.
7. Public/lazy interfaces and explicit fallback: implemented for the bounded domains.
8. Comparison: bounded delivery/meaning/actual ink/cost qualification complete; broader capacity and workload unqualified.
9. Adoption decision: retain ELK.
10. Retirement: deferred.

Owning tests, core/repository types, lint, lazy/editor builds and selected Native/ELK exact-product requalification pass. The latest test-only head repairs two obsolete Class/ER refusal assertions: both reproduced failing;51Requirement owners now pass after sandbox-child retry. Runtimefe911 CI42534101146 completed failure (Sparse32, lazy/website budgets, advisory and those stale tests). Exact latest-head CI42536426208 is still in progress; its quality job already fails original lazy payload budgets. The PR remains draft/not ready; normal pushes preserve history.

Original2dad baseline remains unavailable; recovered Tridentf080/Mermaid12.2 and Pele1.13 source review do not establish a pinned Pele1.9 runtime comparison. Replacement24 stays sealed. No new qualification framework, new PR/issue, cache, default/version/cap change or ELK retirement.

Source and raw evidence: existing PR602 and Architecture checkpoint8e4ebd21df5041ea654343d2037622c9f9ddc3c7; primarya7aa224e,Class8afca58d,ERae1ee1da on the existing evidence branch. The preceding cohort observations are carried forward only where unaffected; unchanged replays are validation, not added progress.
