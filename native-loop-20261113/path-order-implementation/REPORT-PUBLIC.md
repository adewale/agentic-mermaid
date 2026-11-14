# Horizontal complete-path ordering — qualified local milestone

Parent: `1e6882c9c40ad2989bb64c3cb7662fd4696016d4`; runtime baseline: `c037a727de23228c2dccfc6f8bc12dcb77ba94ca`. Frozen patch: `c3bc059b3ee17fe8d397ed89f29fc0d97d8ad11a8f3ee4d008f45a5f5e8cd64d`.

The owned recursive compound producer previously gave each disconnected child scope only its local edges. Cross-group disjoint paths therefore lost their common order before routing. This change refills existing private child arrays in stable authored-root path order for horizontal, flat, same-direction complete path bundles. Authored node/edge arrays, identities and occurrence indices remain unchanged. Vertical layouts, explicit model order/partition, labels on edges, invisible/local/frame edges, nesting, branches and quotient-analysis declines retain their prior ordering strategy. A cardinality-admitted graph that fails the degree check still pays for the performed degree analysis; no work is refunded.

The existing paid quotient traversal now distinguishes a confirmed DAG from other strategy declines. Only that computed outcome permits the new ordering. With indegree/outdegree at most one, the DAG prevents scope revisits; `N = G * (N - E)` proves every path covers every group. This rejects isolates and truncated bundles before allocation. The helper prepays and allocates two node arrays plus one group cursor array, then refills existing buckets directly. It adds no second quotient cycle scan, sort, cache, backend, capacity increase or caller flag.

The initial broader pilot is retained: TB crossings 29→26 but wire +8.81%, so TB/BT were excluded. An isolated-leaf public counterexample had wire 80→126.45 and bends 0→4; complete-bundle admission restores its entire SVG+receipt bytes to the baseline. These are scope decisions based on structural witnesses, not a runtime metric gate.

Owning evidence: original horizontal assertion red on four width/direction cases; isolate/partial table red on four cases before bundle admission. Final Native/cache owners 349P, selected Class contact/identity owners 6P, refined existing boundary table 25P. Canonical core/repository typechecks and scoped lint terminal 0. Canonical seven-entry Node and browser-lazy builds terminal 0. Exact logs and source/build manifests are adjacent.

Actual pinned-Node compound products: all32 return;26 complete products are byte-identical to c037. Only six Native horizontal outputs change. Fresh existing Trident/Chromium observations pass complete meaning, paint and actual direction for those six. The independent final-SVG marker/foreign-shaft support scan is clear for all32 (7,379 pairs; zero hits/unknowns). All served frame boxes, identities and edge occurrence order are unchanged. This narrow scan is separate from the receipt: the general marker/foreign-shaft category is not covered by the current certificate.

| Native case | Wire before→after | Bends before→after | Crossings before→after | Actual SVG area before→after |
|---|---:|---:|---:|---:|
| LR permutation | 4848.0375→560 | 39→0 | 25→0 | 205076.265625→176346 |
| RL permutation | 4898.5375→560 | 39→0 | 21→0 | 205076.265625→176346 |
| LR two-group | 2580.275→280 | 19→0 | 10→0 | 144913.59375→125712 |
| RL two-group | 2604.4→280 | 19→0 | 9→0 | 132624→125712 |
| LR stroke4 | 4975.625→950 | 36→0 | 19→0 | 254473.276061→210393 |
| RL stroke4 | 4736.125→950 | 36→0 | 17→0 | 249602.666027→210393 |

All16 ELK and the ten unchanged Native vertical/identity products match complete c037 products. The original99 comparison independently runs pinned Node24.19:198/198 complete products and public parser bodies are exact to c037, with identical inputs/options/preludes. Existing DOM observations are reused only under those equality bindings; no unchanged DOM replay is presented as progress. Evidence: `original99/CLOSED.json`, `original99/node-products/SUMMARY.json` and `../audit/PATH-ORDER-BUILT-REVIEW.json`.

The SVG-element before/after images are `../audit/path-order-built-observed/before/LR-permutation-agentic.svg-element.png` and `../audit/path-order-built-observed/LR/LR-permutation-agentic.svg-element.png`.

Matched same-host costs and browser delivery are complete. These are exploratory three-process medians, not a formal calibration. Existing stock SVG-only workers keep seven adaptive warm means; full-response workers consume the same public SVG+entire receipt once and count UTF8 bytes. Import, first render, first edited source and repeated edited source are separate. No sampling or observer callbacks are active in timing workers. Cache0 is the existing positioned/drawing/solver cache policy, not a claim that all source/style/font retention is disabled. The full cold-render figures exclude import. At-return heap is not retained-after-GC heap.

The isolated declared grid completed 192 stock workers and 48 full-response workers (432 calls), all terminal0 with no lifecycle failures. Every full call returned scoped proofP. Of 216 baseline/candidate cold/repeat/edit product pairs, 162 SVG+receipts are exact; only the 54 Native permutation pairs change. All 36 compound warmup products match the independently observed complete products. No timing variant or favorable rerun was selected.

| Case/backend | Full repeat ms | Full CPU ms | Stock repeat ms | Full cold ms (excl. import) | First edit ms |
|---|---:|---:|---:|---:|---:|
| permutation-LR / Native | 41.29→24.26 | 66.11→38.19 | 30.42→20.95 | 157.59→134.52 | 41.60→23.05 |
| permutation-LR / ELK | 100.81→95.23 | 156.79→143.28 | 75.32→79.30 | 418.63→403.34 | 89.41→81.78 |
| permutation-RL / Native | 39.92→24.76 | 63.31→40.47 | 30.45→19.24 | 156.43→134.10 | 40.23→24.66 |
| permutation-RL / ELK | 97.36→98.08 | 142.38→146.38 | 75.37→76.01 | 394.55→452.56 | 90.17→94.17 |
| identity-LR / Native | 24.12→25.98 | 36.54→38.36 | 19.31→19.69 | 132.97→130.89 | 23.20→23.85 |
| identity-LR / ELK | 51.54→48.86 | 83.55→78.16 | 40.28→44.96 | 320.88→332.33 | 47.45→49.93 |
| chain100 / Native | 110.51→98.96 | 180.95→157.22 | 89.64→98.01 | 251.82→236.17 | 145.63→152.98 |
| chain100 / ELK | 194.28→180.22 | 316.52→308.76 | 142.91→146.59 | 568.35→509.45 | 196.64→188.78 |

| Case/backend | Full import ms | Post-call heap MiB | Peak RSS MiB | Stock retained heap delta MiB (baseline adjusted) |
|---|---:|---:|---:|---:|
| permutation-LR / Native | 199.80→193.01 | 26.90→25.84 | 122.82→110.94 | 6.35→5.83 |
| permutation-LR / ELK | 183.04→191.13 | 45.70→45.71 | 146.36→147.00 | 18.98→19.01 |
| permutation-RL / Native | 183.06→182.53 | 26.36→25.95 | 120.62→110.58 | 6.35→5.83 |
| permutation-RL / ELK | 188.00→185.80 | 46.02→46.02 | 145.70→145.66 | 19.03→19.01 |
| identity-LR / Native | 185.22→178.08 | 25.85→25.84 | 111.04→110.89 | 5.84→5.83 |
| identity-LR / ELK | 194.52→206.72 | 43.34→43.35 | 138.62→138.91 | 17.41→17.40 |
| chain100 / Native | 176.21→189.30 | 29.71→30.19 | 144.11→140.93 | 6.56→6.51 |
| chain100 / ELK | 179.24→205.85 | 54.67→54.57 | 199.11→198.67 | 20.58→20.67 |

Full-repeat per-process ranges (ms): Native LR38.79–43.05→24.08–26.15; RL38.51–45.91→24.32–26.69; identity23.09–24.63→24.55–26.17; chain100105.82–121.90→98.64–107.38. All raw ranges, cold/import/edit/repeated-edit, CPU, stock retained heap/RSS, external/arrayBuffer fields and failures remain in `cost/{RECEIPT-METRICS,SVG-METRICS}.{json,csv}`. ELK RL cold is adverse 394.55→452.56ms; it is retained in the table and raw controls.

Native LR/RL permutation full-response ranges do not overlap in these samples; the source change has the independently demonstrated routing mechanism and improved final geometry. Healthy LR identity has an adverse full-repeat median (24.12→25.98ms) and stock median (19.31→19.69ms). Chain100 is ineligible and its stock median worsens (89.64→98.01ms); its full ranges overlap despite a lower candidate median. ELK products are unchanged and its mixed timing changes are control variation, not an ELK optimization claim. The general 100-node below100ms is not closed; Chain300 was not replayed for an unchanged path and its prior proof/latency gap remains open.

All 132 existing fresh-realm browser delivery observations pass; all 132 browsers close. This is declared delivery/label/support scope, not additional deep-meaning certification. Each fetched union includes the mandatory same-family support probe and the enrolled source. Actual app module bytes and the two Trident binding modules are reported separately; compressed sizes use gzip9/Brotli11 on actual fetched bytes, not a claim of compressed wire transfer.

| Flowchart app closure | gzip before→after | Brotli before→after | Observed requests before→after |
|---|---:|---:|---:|
| Native | 381425→381739 (+314) | 324913→325129 (+216) | 32→32 |
| ELK | 740833→740834 (+1) | 586049→586072 (+23) | 27→27 |

Request counts include two observer bindings (Native 927 gzip/767 Br; ELK 925 gzip/769 Br). Product-only request counts are 30/25. Native total observed gzip is 382352→382666 and ELK 741758→741759. Every family’s actual fetched list, compression, heap sample and transport scope remain in `browser/RESULTS.json`; no payload improvement is claimed. These compound-order deltas are separate from prior Main-integration payload increases.

The complete source/build, original99, actual32, delivery and cost results bind this local milestone to the frozen patch and parent. Source publication is complete; exact-head CI remains pending. No current-Main readiness or all-gap closure is claimed. The general 100-node latency, Chain300 proof capacity, certificate coverage limits and remaining named quality losses remain open.

Published source: `4cddae30548df1adf0ea1908c88454fae3bcb36d`, parent `1e6882c9c40ad2989bb64c3cb7662fd4696016d4`, tree `282b9774ab6f6c45752e730691802c3db41a9783`. Runtime/test patch matches the qualified build; only the later work-log note differs. Exact-head CI remains separate. Historical diagnostic material requiring public-disclosure approval is excluded from this checkpoint and remains local.
