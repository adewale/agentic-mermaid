# Fully consumed execution and actual compressed payload

Before `32b025bff14e3020fd709a08d84f8543f57cb0cd`; current `6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b`. Runtime change e459cd7; final6d8 test-only. Pure kernel and optional layout-optimization module are byte-identical. Baseline158 shipped dist files match the saved32b npm archive; the current public entry hashes are recorded in source-build-binding.json.

108 fresh serial pinned Node24.19.0 processes;9cases×2cache settings×3replicas×2arms. Each API clock consumes SVG plus the complete receipt serialized as JSON and UTF8. Three process means of7warm repeats; cold/import/first edit and3edited repeats remain separate. Compression, explicit GC and file writes stay outside clocks. RSS/heap include runtime, harness, retained products and prior compression. Warm repeated records are stable modulo documented cached execution counters. This is exploratory sampling, not formal calibration or a full Trident score run.

All1,296 products returned:1,152 paint passes and144 unverified; each arm has576P/72U. All U are the existing17-node marker findings. Zero render or lifecycle failures. No improvement in proof availability is claimed. All1,080 within-arm repeated SVG comparisons are exact;420 receipt differences are solely documented cache1 execution counters/selections; zero other repeat receipt differences.

The raw comparator retains72 flags named defaultSvgViolation from the earlier default-exact protocol. Every flag is dense24-default: geometry changes with the new ordinary policy. Independent saved-SVG analysis finds124crossings/175bends/75edges/18captions/samecanvas in both outputs, −20.676px wire and passing paint. These raw differences and the legacy flag names remain visible; default policy is no longer claimed unchanged.

## Per-case execution

Times are medians of per-process measures; the final column separately reports median within-replica warm ratios. Those statistics need not equal the ratio of the two displayed medians. No aggregate win is inferred.

### Cache0

| Case | Import ms B→A | Cold ms B→A | Warm ms B→A | First edit ms B→A | Edited warm ms B→A | Paired warm change |
|---|---:|---:|---:|---:|---:|---:|
| winning-duplicate-return-balanced | 186.24→174.07 | 127.59→127.64 | 15.07→15.88 | 16.39→16.32 | 12.58→12.50 | +0.9% |
| lcg-135-balanced | 191.67→181.44 | 336.72→298.50 | 154.59→131.56 | 121.42→265.02 | 127.99→121.60 | -7.8% |
| lcg-139-balanced | 180.22→186.37 | 397.52→417.15 | 181.58→177.22 | 174.10→168.08 | 208.74→211.61 | -2.4% |
| cyclic19-balanced | 183.96→176.66 | 479.59→455.35 | 222.40→235.63 | 204.79→194.79 | 194.42→218.73 | +4.8% |
| cyclic19-default | 179.90→177.90 | 374.88→397.20 | 179.43→161.90 | 165.30→152.73 | 167.77→163.85 | -3.6% |
| dense24-balanced | 265.54→190.06 | 1038.83→1291.28 | 752.39→717.81 | 685.08→639.73 | 778.05→702.44 | -4.6% |
| dense24-default | 174.53→168.05 | 818.91→882.48 | 504.20→490.73 | 452.74→446.63 | 502.69→477.80 | -3.7% |
| bm52-wallet | 212.13→165.06 | 171.38→143.66 | 26.56→22.83 | 26.57→22.00 | 23.34→19.37 | -13.6% |
| bm83-workflow | 177.03→168.41 | 215.72→234.37 | 69.10→71.48 | 63.37→60.07 | 84.89→58.66 | +3.9% |

| Case | Warm RSS MiB B→A | Warm heap MiB B→A | Whole-process peak RSS MiB B→A |
|---|---:|---:|---:|
| winning-duplicate-return-balanced | 97.72→95.25 | 24.82→24.91 | 99.88→96.91 |
| lcg-135-balanced | 150.77→165.54 | 40.52→37.18 | 170.18→189.36 |
| lcg-139-balanced | 169.98→159.09 | 39.42→40.63 | 242.46→231.71 |
| cyclic19-balanced | 179.96→190.79 | 54.25→50.75 | 237.21→249.88 |
| cyclic19-default | 159.04→160.26 | 41.42→41.06 | 228.61→230.66 |
| dense24-balanced | 302.21→280.90 | 88.71→80.08 | 306.14→289.71 |
| dense24-default | 244.04→268.30 | 83.93→81.19 | 256.90→281.79 |
| bm52-wallet | 100.85→97.08 | 25.48→21.67 | 104.57→99.86 |
| bm83-workflow | 127.81→137.34 | 32.34→32.00 | 147.51→155.28 |
### Cache1

| Case | Import ms B→A | Cold ms B→A | Warm ms B→A | First edit ms B→A | Edited warm ms B→A | Paired warm change |
|---|---:|---:|---:|---:|---:|---:|
| winning-duplicate-return-balanced | 167.88→170.95 | 126.25→134.62 | 2.08→2.16 | 25.50→25.77 | 2.40→2.33 | +6.1% |
| lcg-135-balanced | 168.29→165.01 | 344.60→289.72 | 4.10→3.18 | 158.25→156.31 | 7.00→6.82 | -21.0% |
| lcg-139-balanced | 164.48→186.58 | 368.83→426.95 | 4.32→4.74 | 180.02→202.87 | 7.96→8.63 | +9.9% |
| cyclic19-balanced | 173.80→180.39 | 467.93→437.14 | 5.24→5.19 | 237.90→235.04 | 8.48→8.15 | -4.7% |
| cyclic19-default | 175.31→169.51 | 390.50→383.33 | 5.22→4.86 | 179.22→178.71 | 8.85→8.44 | -6.4% |
| dense24-balanced | 165.72→178.46 | 1055.74→1017.54 | 7.05→6.21 | 994.63→713.21 | 10.50→13.96 | -11.9% |
| dense24-default | 168.45→173.17 | 770.23→832.26 | 6.98→6.99 | 583.58→496.01 | 12.29→10.35 | -0.6% |
| bm52-wallet | 168.05→196.32 | 164.06→178.21 | 2.82→2.92 | 35.91→31.90 | 3.77→4.14 | +9.6% |
| bm83-workflow | 185.07→175.19 | 244.33→241.77 | 6.62→6.95 | 91.75→96.34 | 11.61→10.51 | +11.8% |

| Case | Warm RSS MiB B→A | Warm heap MiB B→A | Whole-process peak RSS MiB B→A |
|---|---:|---:|---:|
| winning-duplicate-return-balanced | 90.65→90.66 | 18.19→18.20 | 92.63→92.73 |
| lcg-135-balanced | 117.42→116.72 | 22.09→22.07 | 137.12→137.02 |
| lcg-139-balanced | 140.93→133.68 | 22.57→22.57 | 147.39→138.47 |
| cyclic19-balanced | 137.15→133.48 | 23.03→23.06 | 143.43→143.53 |
| cyclic19-default | 129.70→131.03 | 22.71→22.71 | 135.15→137.00 |
| dense24-balanced | 190.60→183.05 | 24.88→24.86 | 261.84→224.90 |
| dense24-default | 178.12→171.64 | 24.53→24.52 | 186.12→181.32 |
| bm52-wallet | 100.06→96.91 | 19.94→19.67 | 102.69→102.88 |
| bm83-workflow | 109.02→109.62 | 21.23→21.23 | 130.73→129.82 |

Costs remain. Uncached cyclic19 balanced warm paired+4.8%/+10.69ms and approval workflow+3.9%/+3.20ms. Seed135 uncached first edit grows+118.3%/+143.61ms despite a better original drawing and lower warm median. Dense balanced cold grows+21.1%/+225.31ms. Seed135 paired peakRSS grows18.05MiB; seed139 warm heap grows1.77MiB. Uncached dense balanced warm paired−4.6%/−34.58ms and paired peakRSS−15.65MiB. Cache1 first edit of seed139 grows12.7%; all variations remain in summary.json. These observations do not assign the differences to a specific changed function.

## Payload

Flowchart selected closure: **352,667→353,084gzipB (+417B)**,26requests unchanged; Brotli 300,014→300,261. Budgeted frontmatter closure includes complete YAML:27requests,383,916→384,333gzipB. Pure solver transfer219,984raw/62,699gzip/51,951Brotli unchanged. Initial5requests:6,249→6,247gzipB but5,538→5,543BrotliB. Shared-core and remaining families can change slightly; complete before/after reports are retained.

Npm270files unchanged:archive7,104,337→7,107,924B (+3,587); unpacked21,019,620→21,024,746B (+5,126). No budget was raised. All lazy budgets and real Chromium home/examples/demo/editor request graphs pass. The earlier c18→32b payload/cost report is a different delta and remains on the existing evidence branch.

## Verification

Full local unit suite:17,073passed/78skipped/0failed,608files across3canonical sequential shards. Final shard1=6498/15, shard2=4375/28, shard3=6200/35. Shard2 predates a final test-only strengthening in shard1; its runtime source and consumed inputs are unchanged.900focused tests; owning baseline red confirmed; build/core+repo types/lint pass. Eight pre-push checks pass, one browser-lookup check skipped; explicit actual Chromium payload check independently passes.529diagrams/2116formats report no hard/soft/render findings. Canonical font manifest and4WOFF2 regenerations pass; advisory gate zero high/critical,14lower-severity findings. Goldens/caps/versions remain unchanged.

Failures and recovery are preserved: first Bun child-pipe sandbox failures; initial shards with stale fixture/obsolete invisible-point assertion/full tmp storage; font containerTLS; a Chromium Unix-socket path limit under the long temporary directory. The final actual checks use disk-backed short TMPDIR and the existing certificate wrapper. No failed check was relabeled passed. Automatic review rejected a continuation command that would have manually recorded a recovery status, so the entire pre-push command was rerun and its actual exit captured. Source and artifact bindings remain explicit.

Local checks only, per owner instruction. No remote CI or merge-readiness claim is implied. No new full-suite timing baseline or peer performance scores were fabricated.
