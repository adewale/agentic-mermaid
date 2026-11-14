# Independent retention review: horizontal complete path bundles

**Recommendation: retain the scoped change.** It fixes the demonstrated placement-order loss, removes the six observed horizontal route tangles, and lowers complete-response wall time, CPU and memory on the two measured permutation workloads. It adds a small payload cost and has adverse control timings. It does not close the general runtime, payload, proof-coverage or remaining layout-quality obligations.

The reviewed three-file diff still hashes to `c3bc059b3ee17fe8d397ed89f29fc0d97d8ad11a8f3ee4d008f45a5f5e8cd64d` after qualification. The actual Node entry is `735d7a0dd72efadccc760e90dd20a484b1233778926613811de100108814c552`, based on runtime c037 and test-only parent1e6882. No production source was changed by this reviewer.

## Why this change is justified

The first responsible stage is recursive child placement: cross-group edges are hosted above the child scopes, so independent edgeless child placement lost their common path order. The final rule uses the existing paid quotient traversal's explicit acyclic result. Flat cross-scope edges plus that result rule out leaf cycles and paths revisiting a group. Degree-at-most-one checks and `N = G * (N - E)` then establish that every path visits every group. This permits one authored-root walk to refill only invocation-private child buckets, with unchanged public identities, edge occurrences and authored arrays.

That proof removed the draft's extra N-entry traversal buffer and second refill pass. Final storage is two N arrays plus G cursors; preflight and staged charges cover `2N + G + 3` slots and `6N + G + 4E + 3` operations before any child write. Budget/strategy declines cannot be mistaken for a proved DAG. No second quotient cycle scan, sort, public flag, cache or cap increase is introduced. The helper still performs and pays for its degree scan and root walk.

The boundary was narrowed using actual negative evidence. An all-direction pilot reduced TB crossings while increasing wire8.81%; vertical production behavior remains unchanged. An isolated-node case gained four bends under the broader forest rule; complete-bundle admission restores its entire baseline product. Branching, partial bundles, explicit order/partition including zero, mixed directions, nesting, labels, invisible/local/frame edges and quotient declines retain the existing ordering policy. The source uses fresh measured records already constructed by the public producer, without new reads of raw graph getters.

## Actual output evidence

The independently executed32 pinned-Node products all return scoped proofP. All16 ELK products and ten Native vertical/healthy-identity products are entire-product exact to c037. Six Native horizontal products change, with fresh existing Trident/Chromium meaning, paint and painted-direction passes. The other26 observations are reused only after exact source/options/SVG/receipt binding. All32 retain served group rectangles, authored identity order, and edge occurrence/endpoint/marker bindings.

The changed default LR/RL permutation cases have crossings25/21→0, bends39→0 and wire4848.0375/4898.5375→560. Both two-group cases and both stroke4 permutation cases also become straight with zero measured crossings. Area decreases without shrinking the group frames. The existing served marker/foreign-shaft scanner checks7,379 pairs over all32 outputs: zero filled intersections and zero unresolved supports. Exact node-boundary contact and general glyph/CSS/transform collision coverage remain outside this observer; scoped proofP is not used to claim them.

The parent's separate original99 run is closed:198 complete products and public parser bodies are exact, with unchanged inputs/options/preludes. Existing owners, types, lint and Node/browser builds are qualified as recorded in the implementation report. The retained LR SVG-element images were captured directly with the existing browser/fonts and independently viewed; no image editing was used.

- [All32 output bindings and quality measurements](PATH-ORDER-BUILT-REVIEW.json)
- [Before image](path-order-built-observed/before/LR-permutation-agentic.svg-element.png), [after image](path-order-built-observed/LR/LR-permutation-agentic.svg-element.png)
- [Original99 closure](../path-order-implementation/original99/CLOSED.json)

## Costs and adverse observations

The independent retained-data calculation checks1,328 summaries across all16 cells from192 stock processes and48 full-response processes, including baseline-adjusted retained memory. All432 complete-response calls returned proofP; every repeated SVG and entire receipt equals its process warmup. All source/edit inputs, Node24.19, cache0, and disabled profiling/observers are verified. This is the declared exploratory three-process protocol, with separate first-use/import/edit phases, not formal calibration or a favorable rerun.

| Native case | Full repeat ms | CPU ms | Stock repeat ms | Post-call heap MiB | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| LR permutation | 41.29→24.26 | 66.11→38.19 | 30.42→20.95 | 26.90→25.84 | 122.82→110.94 |
| RL permutation | 39.92→24.76 | 63.31→40.47 | 30.45→19.24 | 26.36→25.95 | 120.62→110.58 |
| Healthy LR identity | 24.12→25.98 | 36.54→38.36 | 19.31→19.69 | 25.85→25.84 | 111.04→110.89 |
| Chain100 | 110.51→98.96 | 180.95→157.22 | 89.64→98.01 | 29.71→30.19 | 144.11→140.93 |

The two Native permutation full-response ranges are separated in these samples: LR38.79–43.05→24.08–26.15ms; RL38.51–45.91→24.32–26.69ms. Their first-render and first/repeated-edit medians also improve. Healthy identity's full, stock and edit medians worsen despite unchanged output. Chain100 is ineligible, its full ranges overlap, and first edit worsens145.63→152.98ms while stock repeat worsens. Its98.96ms median cannot close the general100-node requirement. ELK outputs are unchanged and timings are mixed; for example RL first-render394.55→452.56ms is adverse. All eight comparative rows and import/cold/edit/memory/resource ranges are retained, without an ELK speedup claim.

Independent sums of all132 fresh browser response unions match their retained delivery totals and separate the two binding modules. All132 observations pass their declared delivery/support scope and all browsers close. Flowchart app gzip grows381425→381739 bytes for Native (+314), and740833→740834 for ELK (+1); Brotli grows216/23 bytes. Observed requests remain32/27, product-only30/25. Browser post-GC Flow heap grows5,328,080→5,329,012 bytes for Native and10,600,436→10,604,784 for ELK. These are small adverse observations, not payload or memory wins. Compression is applied to actual fetched bytes; it is not a claim about compressed network transfer.

- [Independent full/stock calculation](PATH-ORDER-COST-INDEPENDENT-REDUCTION.json)
- [Independent132 delivery sums](PATH-ORDER-PAYLOAD-INDEPENDENT-REDUCTION.json)
- [Complete implementation report and raw-table links](../path-order-implementation/REPORT.md)

The named quality benefit and reduced actual routing/output costs justify the bounded source change despite the disclosed control/payload costs. Exact-head publication/CI remains parent-owned. Previous Main-integration overhead, Chain300 proof capacity, TB routing, other named Native/ELK quality tradeoffs, and broader payload budgets remain open; this local result does not replace those obligations.
