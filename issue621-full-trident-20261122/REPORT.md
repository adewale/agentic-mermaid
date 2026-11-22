# Full Trident comparisons, 22 November 2026

Pele scores above AM under the current Trident definition, chiefly through stronger public-parser fidelity. AM completes more of the rendering corpus and has a higher label-check lower bound. AM and Pele tie on every one of their 60 common fully assessed flowchart crossing cases. The PR and main have identical headline scores and ordered callback outcomes; the PR’s targeted readability gains coexist with substantial balanced-mode stress costs.

The accepted costs do not reveal a new regression blocking the scoped route-traceability/readability repair. This is evidence for that scoped merge decision, not a general ELK.ts victory or closure of issue #619. The source branch remains draft; nothing was merged.

## Scope and identities

- PR #621 source: `6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b`; current main/base: `f49196e7f5d6d2f0970a4a76fe62644ee5e9d004`. Production source is unchanged in this task.
- Historical AM release for both Native and ELK.js: `6f11d6d095c61f63c89bb558ba66b3bf519f2a9e`. Its shared consumer is older, so this comparison cannot isolate kernel-only gains. Native owns eight backend families; the remaining 25 use shared paths.
- Trident 0.4.0 release/head checked at preparation: `ceb42fa47215f5349cbe96ed56ef48a7b90095b4`. Existing reviewed AM adapters: `43ac1128f67ab5674d0c303084bc1503f96ec249`; evidence-backed current/main and ZM version admissions are retained. [Complete adapter delta from the public release](trident-adapters-vs-release.patch). [Scoring and corpus byte identity](trident-scorer-and-corpus-identity.json): every checked scorer and input corpus is unchanged.
- Node 24.19.0 leads PATH; Bun 1.4.4; Chromium 156. One CPU timing stream. All compared runs here use this host; no cross-host improvement is claimed.
- DaveBench: all 1,342 documentation occurrences, 658 distinct sources, three runs per output format, 30 warm-ups per run. Pinned Mermaid accepts 1,338; only those receive completion credit. Times include failed calls across the full 1,342. There are 84 full format runs and 112,728 attempted measured calls, plus excluded warm-ups.
- Drawing Correctness: all 127 cases, 2,540 actual SVG/terminal exports across the configured arms. This is label presence and format validity, not full paint or relationship proof.
- Mermaid Fidelity: all 352 original files attempted for every applicable distinct parser artifact; 7,346 reference-qualified callbacks. The canonical public-parse population is 3,405; 3,941 other qualified callbacks are inventory. Eighteen reference skips remain outside qualification. These scores are computed together, not compared to earlier reports with a different population.
- Native/balanced terminal and parser aliases refer to freshly executed identical artifact paths; they are not independent solver wins.
- Pele is the public npm SDK. The [nine actual hosted-playground tests](https://github.com/adewale/agentic-mermaid/blob/ef8e9a16be384365a7ba254bfb3638de63a14d8d/issue619-pele-hosted-20261121/README.md) remain separate: hosted cyclic 19 has 40 crossings versus 38 in the local SDK. No full hosted-UI score is claimed.
- Franken 0.6 uses public WASM source `0ddba9402355b2d484a8023f5e55afc69f614865` and public CLI release source `8a3b1e99b54dd9d42712c4fb0a202c24fdf26b64`; their different distribution revisions are preserved.

## Canonical scores /100

Ranges retain unresolved work. Overall is Trident’s equal-weight mean of applicable completion, label correctness and parser fidelity components. It contains neither speed nor memory nor crossings. SVG-derived PNG is excluded from duplicate scoring; absent terminal interfaces are n/a.

| Configuration | DaveBench | Drawing | Fidelity | Overall |
|---|---:|---:|---:|---:|
| Mermaid 12.3.0 | 100.00 | 96.85–98.43 | 100.00 | 98.95–99.48 |
| Pele SDK 1.13.0 | 97.61 | 98.43–99.21 | 94.10–94.63 | 96.71–97.15 |
| AM / ELK.ts default | 99.55 | 99.21 | 84.08–89.57 | 94.28–96.11 |
| AM / ELK.ts balanced | 99.55 | 99.21 | 84.08–89.57 | 94.28–96.11 |
| Main default | 99.55 | 99.21 | 84.08–89.57 | 94.28–96.11 |
| Main balanced | 99.55 | 99.21 | 84.08–89.57 | 94.28–96.11 |
| Historical ELK.js 0.11.1 | 99.55 | 99.21 | 84.08–89.57 | 94.28–96.11 |
| Historical Native | 99.48 | 98.43 | 84.08–89.57 | 93.99–95.83 |
| Zombie Mermaid 5.18.0 | 83.56 | 94.49–95.67 | 35.74–56.71 | 71.26–78.65 |
| Frankenmermaid 0.6.0 | 93.83 | 85.43–92.52 | unassessed (0–100) | 59.76–95.45 |
| Beautiful Mermaid 1.1.3 | 38.04 | 68.90 | 6.96–6.99 | 37.97–37.98 |

Frankenmermaid’s range is not a measured zero. The full original test execution completed, but 0.6 changed 205 of 1,087 native models relative to reviewed 0.5, including new Kanban and sequence metadata. The old view/absence review cannot safely score it. [Version review and raw model comparisons](model-review/REVIEW.md).

ZM 5.18’s existing bound models were reviewed:1,083/1,087 ordered native observations match 5.17; four Git models add an unused `config.useMaxWidth`. Native declarations retain the fields/encodings read by existing views. Six newly exported parser families lack bindings; their old family-table absence confirmation is withheld, so they remain unknown with no pass credit. Raw runs and initial fully unreviewed scores are retained; only the standard Trident re-scoring helper was used.

## Full rendering completion and time

Completed counts below use the 1,338 reference-accepted inputs. The median total time covers all 1,342 attempts. Three fresh repetitions after warm-up; raw ranges and every failure remain in each arm’s `dave-report.json`. Different completion counts are unequal work, so these totals do not establish equal-work speed ratios. Browser SVG is an awaited, consumed SVG boundary; it is not the complete Node receipt boundary below. PNG here is Trident’s SVG-to-canvas conversion for every row. Franken terminal includes fresh native process startup; the other terminal rows are persistent Node API calls.

| Configuration | SVG completed | SVG s | PNG completed | PNG s | Terminal completed | Terminal s |
|---|---:|---:|---:|---:|---:|---:|
| Mermaid 12.3.0 | 1338 | 35.381 | 1338 | 55.086 | n/a | n/a |
| Pele SDK 1.13.0 | 1306 | 0.571 | 1306 | 7.470 | n/a | n/a |
| AM / ELK.ts default | 1332 | 4.512 | 1332 | 14.813 | 1332 | 4.644 |
| AM / ELK.ts balanced | 1332 | 4.791 | 1332 | 16.017 | 1332 | 4.644 |
| Main default | 1332 | 4.680 | 1332 | 15.208 | 1332 | 4.392 |
| Main balanced | 1332 | 4.749 | 1332 | 14.690 | 1332 | 4.392 |
| Historical ELK.js 0.11.1 | 1332 | 5.131 | 1332 | 16.019 | 1332 | 4.559 |
| Historical Native | 1330 | 4.583 | 1330 | 14.485 | 1332 | 4.559 |
| Zombie Mermaid 5.18.0 | 1118 | 1.866 | 1118 | 9.474 | 1118 | 2.151 |
| Frankenmermaid 0.6.0 | 1177 | 1.115 | 1173 | 15.700 | 1334 | 2.479 |
| Beautiful Mermaid 1.1.3 | 511 | 1.163 | 511 | 3.416 | 507 | 0.200 |

Default AM SVG totals have median 4.512 s versus main 4.680 s; balanced 4.791 s versus main 4.749 s. Three-repeat ranges overlap, so no formal speed win is claimed. The targeted Node stress cases below show costs that this corpus total hides.

## Label outcomes and public meaning

All AM layout arms share the same measured parser outcomes, including per-file callback order and repeated-title ordinals: [exact comparison](fidelity-callback-equality.json). Current/main each have 2,863 scored passes, 355 known nonpasses and 187 unassessed callbacks. Known nonpasses include 132 actual failures, 116 oracle-verified refusals and 107 confirmed absent concepts. These are inherited limitations, not a claim of complete Mermaid compatibility.

Pele has 3,204 passes, 183 known nonpasses and 18 unknowns over the same 3,405 callbacks. Mermaid’s reference control has 3,405 passes. ZM has 1,217 passes, 1,474 known nonpasses and 714 unknowns; new unbound families receive no pass credit. BM has 237 passes, 3,167 known nonpasses and one unknown; this broad corpus includes many families outside its narrower parser.

Current/main SVG labels:126 correct /127, one renderer refusal. Historical Native:124 correct /127, three refusals. Pele:125 correct, one unknown and one refusal; its unknown could tie AM. The common AM refusal is the frozen regression with a bare `subgraph` and no id/title. It was not silently removed. Native additionally refuses the eight-retry self-loop input for local loop-attachment capacity and a USER→PROJECT ER corridor. Those two current-versus-Native differences already exist on main and are not new PR #621 gains.

## Actual retained SVG geometry

The unchanged Trident observer assessed 72 flowchart inputs per configuration where possible. Every pair below uses identical case IDs and only a metric completely assessed on both sides. Excluded/capped rows and reasons remain in the raw observer output; no unknown is zero. Counts use Trident’s emitted-SVG policy, not a new aesthetics weighting.

| Pair (AM balanced on left) | Common crossing cases | AM crossings | Peer crossings | AM lower / peer lower / equal |
|---|---:|---:|---:|---|
| Historical ELK.js 0.11.1 | 63 | 3 | 3 | 0 / 0 / 63 |
| Historical Native | 62 | 1 | 1 | 0 / 0 / 62 |
| Zombie Mermaid 5.18.0 | 60 | 1 | 1 | 0 / 0 / 60 |
| Frankenmermaid 0.6.0 | 34 | 1 | 1 | 0 / 0 / 34 |
| Beautiful Mermaid 1.1.3 | 57 | 3 | 3 | 2 / 2 / 53 |
| Mermaid 12.3.0 | 59 | 3 | 1 | 0 / 1 / 58 |
| Pele SDK 1.13.0 | 60 | 1 | 1 | 0 / 0 / 60 |

PR versus main: all 63 common assessed crossings agree (three total), all 63 assessed edge/node collision counts agree (zero), all 60 assessed label-overlap counts agree (zero), and all 55 assessed edge/label counts agree (zero), in both default and balanced modes. No structure verdict changes. This is scoped non-regression, not proof that every SVG has complete topology or ink certification. Current SVG structure has 43 topology passes, one failure, 71 unknowns and 12 n/a; layout has 90 passes, one failure, 35 unknowns and one n/a.

Named trade-offs remain. The `Start→Queue→Done` input with eight labelled Queue self-loops has two AM crossings and zero Mermaid crossings; Native refuses it. The Neovim/Node.js module example has zero AM edge/label intersections versus one observed in Mermaid. Exact inputs are retained in [drawing-inputs.json](drawing-inputs.json), keyed `drawing:90e78c1ed707e7e4` and `drawing:22e97a0fc1fff023`.

The exact nine targeted stress/readability inputs are not in the canonical 127 Drawing cases. Their earlier scoped evidence remains necessary: wallet now has three separately traceable upper arrivals, zero crossings and+16.52% wire; balanced seed 135 changes 13→8 crossings cumulatively, with+0.13% wire in its latest step. Cyclic 19 remains AM 37 / historical Native 23 / ZM 31 / hosted Pele 40 / local Pele 38. Seed 139 remains AM 24 / ZM 17 / Pele 21 and has two n 16 marker/node potential-occlusion findings. The earlier scoped Trident observer cap on the difficult example was not raised or counted as a pass. Common peer glyph/paint clearance is not certified.

## Fully consumed Node renders: whole PR versus main

Three fresh processes per arm/case/cache; seven warm calls per process and three repeats after one actual edit. Each clock consumes SVG plus the entire receipt: receipt JSON serialization and separate actual UTF 8 buffers for SVG and receipt. Import, cold, warm, first edit and edited repeats are separate. GC, output compression and evidence writes are outside API clocks. Medians below are medians of per-process means; paired ratios and every phase/replica are retained in [summary.json](consumed-qualified/summary.json). This is exploratory sampling, not formal calibration.

This protocol differs from earlier whole-product JSON/UTF 8-length probes; do not attribute absolute cross-protocol or cross-run time differences to code. The within-run main/PR comparison uses identical work. RSS/heap include the Node harness, import, retained products and prior evidence compression; no browser memory is mixed into these rows.

All 336 qualified processes yield 4,032 products:3,552 own-certifier paint passes and 480 unknowns, zero render/lifecycle errors. Main and current each have 936 passes and 72 unknowns, all current unknowns on seed 139. Every Chain 300 phase is passed in every arm (72 each), including main: no PR-specific proof restoration is claimed. Historical scopes/revisions differ and are not ranked by pass rate.

The initial two Event edit sources were invalid (`cmd Save edit`). All four arms refused them identically:192 parse-error products remain in the original 336-process run. Only those two controls were recovered using valid `cmd SaveEdit`; all eight public-parser checks accepted the corrected sources and 48 fresh processes completed. The qualified population uses the original 12 non-Event cases and those two recovered cases. Across all actual work, 384 processes /4,608 products include 3,936 passes, 480 unknowns and 192 invalid-edit refusals; 384 original Event cold/warm returns are retained duplicate observations rather than extra success credit. [Derived population provenance](consumed-qualified/provenance.json).

| Cache 0 case | Main import ms | PR import ms | Main cold ms | PR cold ms | Main warm ms | PR warm ms | Main first edit ms | PR first edit ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `winning-duplicate-return-balanced` | 172.37 | 180.02 | 121.00 | 132.01 | 13.72 | 15.83 | 14.64 | 16.06 |
| `lcg-135-balanced` | 193.38 | 168.80 | 287.28 | 326.54 | 129.57 | 171.59 | 102.97 | 126.48 |
| `lcg-139-balanced` | 169.25 | 166.84 | 344.86 | 398.50 | 132.56 | 186.26 | 140.81 | 196.40 |
| `cyclic19-balanced` | 170.76 | 174.89 | 434.23 | 439.06 | 168.94 | 256.54 | 149.45 | 209.93 |
| `cyclic19-default` | 169.30 | 171.10 | 415.10 | 378.28 | 164.08 | 176.47 | 142.60 | 151.70 |
| `dense24-balanced` | 159.65 | 171.49 | 701.48 | 975.82 | 477.62 | 712.23 | 471.45 | 640.36 |
| `dense24-default` | 167.01 | 169.22 | 722.15 | 734.64 | 484.95 | 494.35 | 451.11 | 446.50 |
| `bm52-wallet` | 163.15 | 175.16 | 161.11 | 155.75 | 25.58 | 23.49 | 25.95 | 23.07 |
| `bm83-workflow` | 164.63 | 165.88 | 218.59 | 240.30 | 77.98 | 66.77 | 56.00 | 60.07 |
| `diagnostic:chain100` | 170.86 | 174.94 | 214.21 | 215.89 | 78.77 | 82.73 | 63.17 | 69.12 |
| `diagnostic:fanin100` | 157.91 | 163.52 | 336.79 | 355.61 | 202.46 | 195.28 | 207.60 | 196.57 |
| `diagnostic:chain300` | 170.77 | 163.76 | 412.56 | 428.02 | 210.32 | 223.89 | 202.01 | 174.69 |
| `event-clear` | 201.93 | 172.60 | 65.99 | 70.71 | 4.54 | 5.16 | 6.08 | 6.49 |
| `event-card-blocked` | 216.42 | 175.04 | 70.05 | 66.17 | 4.98 | 5.22 | 5.89 | 6.11 |

Balanced dense warm increases 477.62→712.23 ms (median ratio+49.1%); its cold 701.48→975.82 ms and first edit 471.45→640.36 ms also rise. Cyclic 19 balanced warm 168.94→256.54 ms; seed 139132.56→186.26 ms. Wallet warm 25.58→23.49 ms and first edit 25.95→23.07 ms improve. Source-level benefits and adverse costs are both retained.

| Cache 0 case | Main warm RSS MiB | PR warm RSS MiB | Main warm heap MiB | PR warm heap MiB | Main peak process RSS MiB | PR peak process RSS MiB |
|---|---:|---:|---:|---:|---:|---:|
| `winning-duplicate-return-balanced` | 90.18 | 97.90 | 22.62 | 24.86 | 91.80 | 99.76 |
| `lcg-135-balanced` | 132.60 | 146.81 | 37.56 | 38.13 | 168.08 | 170.25 |
| `lcg-139-balanced` | 152.31 | 171.66 | 36.19 | 40.26 | 173.20 | 235.23 |
| `cyclic19-balanced` | 155.33 | 193.71 | 42.79 | 50.30 | 223.04 | 250.86 |
| `cyclic19-default` | 175.46 | 152.40 | 42.71 | 41.08 | 234.36 | 223.54 |
| `dense24-balanced` | 276.39 | 293.55 | 83.11 | 81.23 | 290.27 | 300.09 |
| `dense24-default` | 259.59 | 246.00 | 74.36 | 81.58 | 269.51 | 258.05 |
| `bm52-wallet` | 100.94 | 97.12 | 25.39 | 21.60 | 104.89 | 100.08 |
| `bm83-workflow` | 130.78 | 129.04 | 31.64 | 32.36 | 147.80 | 147.64 |
| `diagnostic:chain100` | 132.26 | 130.58 | 34.72 | 34.40 | 154.31 | 153.04 |
| `diagnostic:fanin100` | 154.38 | 153.02 | 32.66 | 32.67 | 237.54 | 234.25 |
| `diagnostic:chain300` | 209.23 | 212.25 | 64.17 | 69.35 | 239.23 | 241.49 |
| `event-clear` | 85.64 | 85.60 | 15.74 | 15.79 | 86.96 | 86.94 |
| `event-card-blocked` | 87.43 | 88.24 | 15.73 | 15.82 | 88.80 | 89.28 |

| Cache 1 case | Main cold ms | PR cold ms | Main warm ms | PR warm ms | Main first edit ms | PR first edit ms | Main edited warm ms | PR edited warm ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `winning-duplicate-return-balanced` | 113.44 | 136.99 | 2.15 | 2.21 | 17.43 | 26.69 | 2.43 | 2.47 |
| `lcg-135-balanced` | 247.67 | 309.49 | 3.20 | 3.57 | 136.78 | 156.73 | 6.61 | 5.81 |
| `lcg-139-balanced` | 351.50 | 427.21 | 5.24 | 4.91 | 159.96 | 221.44 | 9.04 | 8.52 |
| `cyclic19-balanced` | 392.66 | 454.32 | 5.60 | 5.40 | 193.85 | 278.29 | 8.68 | 8.57 |
| `cyclic19-default` | 370.27 | 370.73 | 5.03 | 5.15 | 172.40 | 181.86 | 7.74 | 8.14 |
| `dense24-balanced` | 829.83 | 1146.15 | 7.17 | 6.56 | 572.98 | 838.65 | 11.55 | 11.43 |
| `dense24-default` | 826.56 | 855.50 | 6.74 | 6.77 | 558.81 | 530.92 | 11.54 | 10.72 |
| `bm52-wallet` | 163.84 | 261.87 | 3.13 | 3.21 | 56.73 | 35.59 | 4.25 | 4.07 |
| `bm83-workflow` | 256.05 | 262.16 | 7.00 | 7.40 | 95.98 | 103.37 | 11.48 | 11.69 |
| `diagnostic:chain100` | 241.16 | 249.20 | 10.27 | 10.60 | 94.60 | 100.12 | 15.66 | 16.80 |
| `diagnostic:fanin100` | 365.77 | 389.65 | 9.97 | 10.63 | 237.45 | 244.40 | 18.19 | 18.92 |
| `diagnostic:chain300` | 436.76 | 442.39 | 23.76 | 24.71 | 254.63 | 283.65 | 43.14 | 40.87 |
| `event-clear` | 62.78 | 61.67 | 1.63 | 1.69 | 9.07 | 9.09 | 2.19 | 2.10 |
| `event-card-blocked` | 67.64 | 64.68 | 1.48 | 1.44 | 9.54 | 8.71 | 1.95 | 2.13 |

### Same-host historical renderer controls

Each cell below is warm ms / warm RSS MiB / warm heap MiB, cache 0. These are complete AM public renders and receipts at different shared consumer revisions, not isolated ELK kernel measurements. The older Native’s different drawings, refusals and paint unknowns remain in raw evidence. No aggregate win from unequal behavior is claimed.

| Case | Main ELK.ts | PR ELK.ts | ELK.js historical | Native historical |
|---|---:|---:|---:|---:|
| `winning-duplicate-return-balanced` | 13.72 / 90.18 / 22.62 | 15.83 / 97.90 / 24.86 | 22.02 / 118.01 / 33.74 | 8.29 / 89.95 / 18.91 |
| `lcg-135-balanced` | 129.57 / 132.60 / 37.56 | 171.59 / 146.81 / 38.13 | 120.77 / 165.46 / 51.92 | 232.45 / 149.86 / 27.92 |
| `lcg-139-balanced` | 132.56 / 152.31 / 36.19 | 186.26 / 171.66 / 40.26 | 179.69 / 174.03 / 55.70 | 297.94 / 167.57 / 35.15 |
| `cyclic19-balanced` | 168.94 / 155.33 / 42.79 | 256.54 / 193.71 / 50.30 | 204.37 / 181.76 / 58.99 | 347.40 / 163.68 / 31.56 |
| `cyclic19-default` | 164.08 / 175.46 / 42.71 | 176.47 / 152.40 / 41.08 | 214.69 / 180.01 / 60.42 | 180.57 / 148.85 / 30.91 |
| `dense24-balanced` | 477.62 / 276.39 / 83.11 | 712.23 / 293.55 / 81.23 | 580.65 / 273.63 / 80.87 | 406.75 / 181.34 / 47.32 |
| `dense24-default` | 484.95 / 259.59 / 74.36 | 494.35 / 246.00 / 81.58 | 596.01 / 275.80 / 81.44 | 176.46 / 162.27 / 30.77 |
| `bm52-wallet` | 25.58 / 100.94 / 25.39 | 23.49 / 97.12 / 21.60 | 53.69 / 136.36 / 38.40 | 24.48 / 99.74 / 21.55 |
| `bm83-workflow` | 77.98 / 130.78 / 31.64 | 66.77 / 129.04 / 32.36 | 124.21 / 170.78 / 53.46 | 134.62 / 145.11 / 28.86 |
| `diagnostic:chain100` | 78.77 / 132.26 / 34.72 | 82.73 / 130.58 / 34.40 | 173.18 / 189.43 / 51.01 | 62.84 / 122.54 / 28.33 |
| `diagnostic:fanin100` | 202.46 / 154.38 / 32.66 | 195.28 / 153.02 / 32.67 | 318.91 / 242.94 / 63.99 | 117.11 / 139.56 / 33.21 |
| `diagnostic:chain300` | 210.32 / 209.23 / 64.17 | 223.89 / 212.25 / 69.35 | 393.35 / 319.24 / 93.27 | 192.05 / 177.19 / 46.52 |
| `event-clear` | 4.54 / 85.64 / 15.74 | 5.16 / 85.60 / 15.79 | 4.87 / 88.25 / 15.98 | 4.85 / 88.32 / 15.93 |
| `event-card-blocked` | 4.98 / 87.43 / 15.73 | 5.22 / 88.24 / 15.82 | 4.81 / 88.41 / 15.94 | 5.20 / 89.45 / 15.94 |

## Browser memory and actual compressed assets, all systems

One additional full 1,342-case SVG pass per configuration reuses the unchanged Trident browser host, renderer call and mechanical admission, without a timing ranking. Every row completed collection. [All samples, output failures and resource hashes](browser-resources/results.json). RSS is a sampled sum over that Chromium instance’s process tree, so shared pages may be counted more than once; it is not standalone library RSS. JS heap excludes WASM/external/GPU memory. Post-GC heap is measured after the full population; no forced GC occurs during it. This single pass is not a calibrated memory comparison, and rejected inputs impose different work.

Gzip is actual level 9 compression of each exact unique executable/resource body; Brotli is quality 11. Inlined entry bytes are explicitly charged, so an inline script is never a zero-byte delivery claim. Requested assets and provided entries are separate fields in the raw records. These are all-family Trident adapter artifacts, not AM’s production flow-only lazy closure or a hosted-site deployment.

| Configuration | Raw returns /1342 | Sampled browser-tree RSS MiB | Peak observed JS heap MiB | Post-GC JS heap MiB | Gzip bytes | Brotli bytes | Unique assets |
|---|---:|---:|---:|---:|---:|---:|---:|
| AM / ELK.ts default | 1332 | 687.93 | 95.89 | 33.96 | 1,129,682 | 898,149 | 1 |
| AM / ELK.ts balanced | 1332 | 692.77 | 102.20 | 34.48 | 1,129,696 | 898,432 | 1 |
| Main default | 1332 | 695.65 | 98.44 | 34.29 | 1,127,266 | 896,343 | 1 |
| Main balanced | 1332 | 696.72 | 103.74 | 34.65 | 1,127,280 | 896,604 | 1 |
| Historical ELK.js 0.11.1 | 1332 | 713.38 | 117.55 | 40.79 | 1,563,949 | 1,230,280 | 1 |
| Historical Native | 1330 | 697.93 | 96.65 | 31.62 | 1,563,952 | 1,229,830 | 1 |
| Frankenmermaid 0.6.0 | 1181 | 606.34 | 10.77 | 1.36 | 1,181,131 | 897,848 | 2 |
| Zombie Mermaid 5.18.0 | 1120 | 604.11 | 47.27 | 17.56 | 783,797 | 623,636 | 1 |
| Beautiful Mermaid 1.1.3 | 513 | 575.27 | 44.44 | 11.49 | 492,995 | 382,527 | 1 |
| Pele SDK 1.13.0 | 1306 | 585.98 | 24.63 | 10.69 | 275,154 | 223,408 | 1 |
| Mermaid 12.3.0 | 1338 | 901.06 | 103.69 | 47.87 | 2,393,822 | 1,811,896 | 6 |

Current default’s Trident artifact is 1,129,682 gzip bytes versus main 1,127,266: **+2,416**, with one provided bundle each. Balanced adds the same 2,416 gzip bytes. The old Native/ELK.js Trident artifacts both retain their shared monolithic package closure; they do not describe Native-only production lazy downloads. Pele’s 275,154 gzip bytes and lower observed browser heap are meaningful observations at its public SVG boundary, alongside its 32 reference-accepted render misses. They do not establish equivalence to AM’s full receipt/certification API.

### npm archive, main versus PR

| Artifact | Archive bytes | Unpacked regular-file bytes | Regular files | SHA 256 |
|---|---:|---:|---:|---|
| main | 7,096,884 | 21,003,201 | 269 | `21dab05ac04c65f60cf5ef44daa178f7a74919273345d1235a768e243ddbdaff` |
| current | 7,107,924 | 21,024,746 | 270 | `1fc109fd0e957585a6f5e3a79586958cb520c04d9bef53ce4cd16c8fb538518e` |

The package archive adds 11,040 bytes versus main; file count changes 269→270. These are package archives, not the transitive installed production-dependency closure. Current’s fresh archive has exactly the same 270 payloads/modes as the prior tested `6d8d7fb` archive; [payload identity](current-archive-payload-identity.json). No source rebuild improvement is inferred from archive-envelope bytes. Existing unchanged lazy/actual-Chromium payload budgets passed local checks on this exact source head; no cap was raised and no new CI run is claimed here.

## Merge reassessment

The earlier small-example statement that Pele “has more crossings” should not be generalized. The complete common crossing population ties AM/Pele, and Pele’s full Trident score range is above AM’s. Pele is also much faster on its observed public SVG corpus totals and has a smaller measured benchmark artifact, while AM renders more inputs. Those are separate facts, not an equal-work global speed ranking.

PR #621 remains a defensible scoped readability/traceability repair with the owner-accepted costs: its owning regressions are red→green, prior exact-head local checks pass, no full-corpus semantic/structure regression was observed, and the targeted wallet/ordering gains remain demonstrated at the unchanged head. The broad headline score does not improve, and optional balanced stress costs are substantial. If the criterion were “no slower than main on every case” or “better than Pele on all metrics,” the evidence does not meet it.

The exact-head existing local verification remains 17,073 unit passes /78 skips /zero failures, 900 focused tests, build/types/lint and local quality/payload checks. Those were run on 21 November; this task did not rerun unchanged CI. Remote workflow runs remain empty as requested. The PR stays draft and unmerged.

Issue 619 stays open: cyclic 19 and seed 139 crossing/paint gaps, different-rank arrival behavior outside the local predicate, and incomplete common glyph/ink observation remain. The next performance intervention should profile the extra balanced candidate’s producer, route/occurrence validation and paint work before removing repeated work at its shared owner. The separate long-edge port-rank/position allocation proposal has not been implemented or credited.

## Preserved failures and reproducibility

- Frozen-catalog timestamp refusal, sandbox Bun pipe failure, unsupported peer terminal selection, read-only npm cache failure and their actual recoveries are retained in the command/status logs. No failed collector was relabelled successful.
- All native/render/admission failures, partial observations and observer cap reasons remain in the raw archives. Original invalid Event edits and successful corrections are both retained. Initial fully unreviewed peer Fidelity scores remain in `scores-initial-unreviewed.json`.
- The first model-review catalog selected older 0.4/5.14 pins; those preparations remain separate. The actual comparisons use reviewed 0.5 `a5be33` /5.17 versus measured 0.6/5.18. Bun’s `node:v8` serialization shim produced the model files; the attempted Node decoder rejected that format. Read them using Bun 1.4.4, as the successful comparison did.
- No production code, default, version, cap, golden or dependency changed. No new PR, issue, merge, release or remote CI was requested.

Start from Trident release`ceb42...`, apply `trident-adapters-vs-release.patch`, and install its pinned dependencies per Trident’s README. Place that checkout at `harness/` beside the retained scripts. The frozen catalogs, prepared artifact manifests, exact archive identities, raw commands in `collection*-status.json`, original input revisions and every source/output digest bind this report. Installation roots in raw jobs are the actual measured paths and must be rebound to verified identical artifacts to reproduce elsewhere. `reduce-reviewed.ts` uses only canonical Trident report/merge/scoring helpers; `compare-observations.py` sums only common fully assessed existing metric values. `browser-resources.ts` is a resource observer around the existing host/call, not a new scorer.

Raw directories are archived separately in the evidence packet to avoid installing packages or committing evidence into the PR’s source diff. The packet manifest records each published file’s hash; install trees and package bundles are not included. Prior captioned visual evidence stays at its immutable links.
