# Current-head matched runtime against Main

This measurement fills the missing current-head comparison. Source remains unchanged at `4cddae30548df1adf0ea1908c88454fae3bcb36d`; Main is `a2e5ddc927e7432affbc293b7996a74b5fe59003`. It is not an optimization trial.

Current repeated-response medians are higher on all three scaling cases in both engines. Native LR identity is faster on repeated calls, while its first render, process RSS and at-return heap are higher. The general 100-node full-response target remains open: current Native chain100/fanin100 medians are 117.68/171.96 ms.

The existing receipt worker ran once: 48 serial fresh Node 24.19.0 processes, four cases × two engines × two qualified SDKs × three replicas, 432 calls. Every call returned. Main has 216 passed receipts; current has 162 passed and 54 unverified receipts. All current Chain300 calls exhaust the unchanged 400000-operation proof budget, while Main Chain300 receipts pass. Those are unequal proof availability despite equal SVGs.

Each timed call includes the public render plus one `JSON.stringify` of the entire original product and UTF8 byte counting. SDK import is separate; cold means first render after import. Repeat columns summarize per-process medians of four same-source calls, then median/min/max across three processes. Edit1 is the first edited source, edit2–4 repeat that edited source. Explicit GC, artifact encoding/compression and retained receipt encoding are outside API clocks. No sampling, timed diagnostic observers, browser, build, stock-render benchmark or corpus rerun was used. Cache0 is the existing ELK-cache environment setting, not all internal caches off. The extra Scene assertions flag is 0, matching the production default; proof/capture caps remain active.

| Engine / case | Main repeat ms [min,max] | Current repeat ms [min,max] | Median change |
|---|---:|---:|---:|
| Native / chain100 | 77.22 [74.15, 77.88] | 117.68 [113.15, 123.26] | +52.39% |
| Native / fanin100 | 121.42 [120.99, 124.42] | 171.96 [141.87, 176.46] | +41.62% |
| Native / chain300 | 192.90 [175.70, 205.11] | 266.11 [265.13, 321.13] | +37.95% |
| Native / LR identity | 33.04 [32.78, 34.27] | 27.12 [25.91, 27.63] | -17.93% |
| ELK / chain100 | 167.02 [159.82, 171.82] | 212.74 [188.46, 217.69] | +27.38% |
| ELK / fanin100 | 345.35 [342.00, 393.18] | 380.54 [364.71, 394.31] | +10.19% |
| ELK / chain300 | 411.57 [380.73, 459.67] | 521.24 [520.85, 547.11] | +26.65% |
| ELK / LR identity | 44.63 [42.72, 47.22] | 53.09 [51.14, 57.42] | +18.96% |

All eight current cold-render medians and repeat-phase RSS medians are higher. At-return heap is higher in seven cells; Native Chain300 is the exception (42.20→40.25 MiB). The retained Main Native chain100 import outlier is 328.19 ms; import min/max remain in the full metrics.

All times below are medians in ms, Main→current. Cold excludes import. Full precision, process ranges, CPU and every phase/memory field remain in `RECEIPT-METRICS.json` and the raw worker results.

| Engine / case | Import | Cold render | First edit | Repeated edit |
|---|---:|---:|---:|---:|
| Native / chain100 | 183.96→264.42 | 184.14→254.89 | 65.29→114.54 | 57.55→101.08 |
| Native / fanin100 | 179.40→202.69 | 258.08→344.87 | 124.86→186.19 | 113.62→152.00 |
| Native / chain300 | 207.71→197.48 | 408.25→527.03 | 213.33→231.04 | 185.19→253.56 |
| Native / LR identity | 190.01→193.03 | 126.92→140.20 | 33.37→24.49 | 30.98→22.36 |
| ELK / chain100 | 195.10→193.28 | 481.25→543.83 | 146.63→216.30 | 163.76→172.25 |
| ELK / fanin100 | 188.83→201.39 | 664.85→730.12 | 303.02→352.44 | 296.37→359.99 |
| ELK / chain300 | 176.28→191.82 | 791.92→1016.58 | 415.87→461.36 | 394.70→492.60 |
| ELK / LR identity | 181.66→206.81 | 308.35→353.97 | 38.71→51.19 | 36.53→46.77 |

Memory is MiB, Main→current. RSS is process memory including imports/harness/artifacts, not browser or package size. Heap is measured at API return, not retained-after-GC heap. Peak RSS is the existing process maximum sampled in repeated-call rows and summarized with the same process-median rule.

| Engine / case | At-return RSS | Peak RSS | At-return heap |
|---|---:|---:|---:|
| Native / chain100 | 132.58→140.82 | 132.58→140.82 | 28.90→31.52 |
| Native / fanin100 | 135.18→140.60 | 141.34→153.88 | 24.16→34.52 |
| Native / chain300 | 180.44→190.61 | 181.80→190.61 | 42.20→40.25 |
| Native / LR identity | 106.36→110.42 | 106.36→110.42 | 19.50→25.91 |
| ELK / chain100 | 187.49→195.38 | 187.49→198.42 | 46.81→55.38 |
| ELK / fanin100 | 198.26→229.60 | 204.45→236.52 | 55.16→60.87 |
| ELK / chain300 | 291.18→295.06 | 291.49→295.06 | 87.71→99.03 |
| ELK / LR identity | 130.67→146.42 | 130.67→146.42 | 40.80→43.36 |

All 432 reconstructed full-response byte counts match their timed UTF8 counts. There are 216 paired Main/current calls: 189 SVGs and non-certification receipts are exact; the 27 changed SVGs are Native LR identity. No complete receipt/product pair is exact. All 336 within-worker repeated products and 288 cross-replica products are exact. LR identity therefore measures changed geometry, not a behavior-preserving speedup. The existing qualified geometry comparison has Native identity wire 1485.5→560 and bends 28→0; no new geometry qualification is claimed here.

Response compression below is for the unedited source product, computed after clocks using gzip9/Brotli11 once for each of 32 unique source/edit responses. It is not browser module/download payload. The previously measured browser app gzip 381739 Native/740834 ELK is unchanged and was not remeasured here.

| Engine / case | Raw response bytes Main→current | gzip9 Main→current | Brotli11 Main→current |
|---|---:|---:|---:|
| Native / chain100 | 113504→113504 | 7719→7719 | 4703→4714 |
| Native / fanin100 | 116978→116978 | 7237→7237 | 4548→4548 |
| Native / chain300 | 328258→328584 | 18467→18682 | 10681→10947 |
| Native / LR identity | 24345→24013 | 3132→3037 | 2534→2435 |
| ELK / chain100 | 113487→113487 | 7715→7716 | 4703→4659 |
| ELK / fanin100 | 117867→117867 | 8098→8098 | 5135→5133 |
| ELK / chain300 | 328386→328712 | 18530→18745 | 11025→11140 |
| ELK / LR identity | 23996→23996 | 3030→3030 | 2439→2439 |

This is an exploratory three-process same-host comparison, not formal calibration. Keep the adverse cold/edit/memory results, overlapping ranges and different proof/geometry behavior. No source progress, broad latency claim, payload improvement or 100 ms closure follows. Inputs, SDK entry hashes and the byte-identical worker are bound in `PLAN.json`; all calls and proof counts are retained. No additional calls or favorable reruns occurred.
