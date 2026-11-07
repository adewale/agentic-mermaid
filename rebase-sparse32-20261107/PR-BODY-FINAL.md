Compared with main `39a500425`, this PR delivers the enrolled ER208 chain that main refuses, reduces the default forest's area and wire, and restores a selected hollow-circle marker. Standalone gzip is 7.90% smaller. Brotli size, build memory and some proof work are higher. **This remains a draft; CI is not green.**

## Demonstrated improvements

The same six sources and options were frozen before outcomes. After the latest runtime change, all 18 PR calls were requalified: 15 returned and three refused. Every returned SVG and entire receipt is byte-exact to the integrated PR1693 product; all three refusal names/codes/messages match. Main39 is unchanged, so its retained products are reused. This validates preservation, not a new layout gain.

| Input | Omitted backend: main→PR | Explicit Native: main→PR |
| --- | --- | --- |
| ER208 relationship chain | **400k geometry-work refusal→SVG delivered**, proof passed | Same gain; 208 identities, 207 ordered relationships and 414 normal contacts retained |
| Nonlinear forest | **Area−26.98%, wire−37.60%**, eight bends unchanged | Same gain; explicit ELK painted geometry unchanged |
| Raw hollow circle | **0→225 confined marker pixels** | Same paint gain; proof remains unverified in every mode |
| Sparse256 | Painted geometry unchanged | **Area−77.05%**, connected wire unchanged |
| Requirement TB cycle | Painted geometry unchanged | **Area−22.95%, wire−8.56%**, eight bends unchanged |
| ER256 relationship chain | Both revisions still refuse at the unchanged 400k geometry cap | Both still refuse |

Across the combined comparison, 27 products return: 21 proof-passed and six unverified; nine calls refuse. Omitted Flowchart layout can use the existing forest fast path in both revisions. These selected results do not establish a general workload ranking, whole-diagram glyph attribution or readability across arbitrary fonts.

## Delivery and execution costs

Complete production HTML uses the same Bun 1.4.4/dependency topology and production builder. Compression is Bun node:zlib gzip9/Brotli11; local and CI absolute sizes remain separate.

| Complete HTML / observed build cost | Main39 | PR14bec | Change |
| --- | ---: | ---: | ---: |
| Raw bytes |4,742,588|2,186,759|−2,555,829|
| Gzip9 bytes |1,423,188|1,310,687|**−112,501 (−7.90%)**|
| Brotli11 bytes |1,098,404|1,244,928|**+146,524 (+13.34%)**|
| Peak build RSS, KiB |430,832|673,272|**+242,440**|

The current build completes in 17.1 seconds within the existing 55-second deadline. These single build observations establish no speed or memory ratio. The original standalone gzip ceiling of 1,334,500 bytes is unchanged and now passes locally. The actual emitted-worker owner also passes: 504 assertions across the two tests cover complete Blob bytes, enrolled family/style SVGs, entire receipts/verification, backend/fallback, crash recovery and ASCII/Unicode/PNG.

Private worker delivery reuses one existing compressor pass before packing, then specializes the bounded decoder dictionary for the exact build-owned stream. Each build traces dictionary reads, preserves offsets/length and verifies every decoded worker byte; notices and byte/CRC/loop/window/time/cancellation checks remain. The earlier dictionary step saved 37,701 gzip and 37,131 Brotli bytes while adding 95,553 raw bytes. The latest hull change modifies worker code and was requalified through the actual browser owner; its complete HTML saves a further 61 gzip and 209 Brotli bytes. No cache is added.

Lazy family transfer remains adverse. The matched pre-hull Packet plus complete YAML closure grows **196,160→230,648 gzip bytes**, despite 22→13 requests. Flowchart selected ELK grows 734,953→774,077. The latest change adds 10 raw bytes per family closure, including Class gzip+3 and Flowchart+14. Initial gzip moves 5,854→5,852, Brotli 5,226→5,227. Current lazy/demo/editor-empty budget failures remain; no ceiling or approval label is changed.

A matched-compressor packing probe saved only 2,416 gzip bytes and left 32,073 above main's static Packet transfer. It was compression-only, not executable ESM or a bound on all possible rewrites. Six-pass worker compression exceeded the build deadline; raw worker insertion worsened gzip. These stopped hypotheses and the earlier Python/Bun compressor mismatch remain in evidence.

Proof work also remains higher on some drawings: forest default 22,851→98,311; raw circle 41,687→156,940; Requirement default 25,613→102,468. Sparse256 default falls 102,610→90,857. These counts are not CPU measurements; caps stay unchanged.

## Runtime cleanup and profile

The latest source change requests bounds without constructing an unused original marker hull in paint certification. Every original-region consumer reads only bounds; served regions retain their full hull. Resource/pose encoding, proof charges and caps remain unchanged.

The [performance report](https://github.com/adewale/agentic-mermaid/blob/14bec477578104a1eab5a279473aa77e747f8476/docs/design/system/layout-0.6-performance-review.md) retains the historical five-spot/cache review and adds a current Class128 profile before intervention. The largest sampled frame is first Scene admission, not redundant recapture. Class's Native-labelled placement still uses its Scene adapter; skipping mutable-input admission was not justified.

A sequential before/candidate pair preserves all warmup/repeat/edit SVGs and complete receipts. Repeats retain 388,607/400,000 proof operations; edit 389,269; all 127 markers and passed proof remain. Marker-region sampled self/inclusive weights move 7.697/12.499→6.964/11.241ms per call. Unchanged code also moves; this is **not an established end-to-end speedup**. Confounded earlier profiles, raw RSS/heap, errors and adverse observations are retained. Cold/import latency and cache1 were not measured in this bounded probe.

## Rebase and Sparse32 diagnosis

The requested merge-preserving rebase onto current main39 completed at the same 14bec head and tree. Missing historical Git objects were repaired, and intermediate files were preserved. No force push was needed. Head 62af adds only the work-log diagnosis; runtime and delivery measurements above remain those of 14bec.

The existing Sparse32 owner still fails. A stage trace is clean at **337,890 operations before XML closure**; the first refused charge requests 7 at 399,994 during typed-text literal validation. The actual 1,500-row/32-marker ink checks and direct Scene proof pass, while emitted Native proof remains unverified at the unchanged 400,000 allowance. This differs from ER256's geometry refusal.

A seven-bit prepared-attribute probe retained literal checks but still exhausted the allowance. It is saved and reverted, with all three control SVGs exact. Smaller 1,000/1,250-label probes pass at 328,063/395,813 operations; these are descriptive points, not maximums or acceptance gates. The original failure stays enrolled. [Rebase records, first-charge trace, failed candidate and independent review](https://github.com/adewale/agentic-mermaid/tree/a5c343e6600185b53679411a2f85575447454d50/rebase-sparse32-20261107) are backed up. No new runtime gain or capacity repair is claimed.

## Remaining differences from ELK

- Forest Native: **wire+10.19%, area−6.43%**, eight bends in both. Residual placement/terminal cost remains.
- Sparse256 Native: **area+5.04%**. The +0.97% backfill candidate is unshipped; +115.35% is historical.
- Requirement TB Native: **area−10.43%, wire−30.34%**, eight versus ten bends. The old TB+9.53% loss is falsified on this input; BT/LR/RL remain unqualified.
- Shared ER256 geometry refusal remains separate from Sparse32's proof-cap failure.

Original baseline `2dadf0dbc2685c8435df541de99f3edce841450d`, Trident and pinned Mermaid 12.2/Pele 1.9 products remain unavailable. Pele 1.8 was not substituted. Replacement24 stays sealed.

## Visual evidence

PR baseline SHA: `39a500425f6b74eb486b9add9e90d538fab6a914`.
Current PR head SHA: `62af995fafa5392364ab2567678f11e59fea9ea6`.

The pictures were captured at mainf9/PR741. Main39/PR1693 SVGs and entire receipts bound exactly to those products; the latest 18 PR calls bind again to PR1693. The existing images therefore retain their original selected-ink limits. Equal scale and four manifest-verified Inter weights show the same six cards/four arrows; no image was edited.

| Main before | PR after | What to inspect |
| --- | --- | --- |
| <img alt="Main: six forest cards have large vertical gaps and a shared exit below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-main.png" width="340"> | <img alt="PR: the same cards and arrows use less vertical space and separate exits below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-pr.png" width="340"> | Compare empty vertical spans, retained card text and target arrows. Width/raster scale and card dimensions are fixed. |

## Scope, checks and recovery

Normal merge 1693 integrates main39 while retaining the inherited PR449 capture/ownership foundation, UTF16 diagnostics, typed parser and source-MCP isolation. Main's 0.5.7 identity, backend-default setting, mutable/getter/CSS/definition isolation and all caps remain. Reviewed Class/Requirement/browser goldens qualify earlier intentional spacing behavior.

Latest local proof owners: 740 passed, known Sparse32 failed, and one child stdin permission error returned no render product. That public cyclic owner passes its permitted retry (392 assertions). Core types, changed-file lint, ESM/declarations and the actual standalone browser owners pass. These are behavior-preserving regression guards, not a new bug-fix RED claim.

[Last completed runtime CI42332734235](https://github.com/adewale/agentic-mermaid/actions/runs/42332734235) completed **failed**. It tests merge `379ceddc9661ecb46a8babe9ce00c850e8b3792c`, whose parents are main39 and PR14bec and whose tree equals the pushed source. Unit shard 2 fails only Sparse32. Lazy/payload budgets and the advisory diagnostic fail. Shards 1/3, browser-site including the original standalone budget, browser contracts, semantic conformance, CLI/MCP, package consumers and macOS/Windows isolation pass. [Documentation-head CI42336119035](https://github.com/adewale/agentic-mermaid/actions/runs/42336119035) is in progress, not passed. No readiness claim or waiver.

Reproduce the affected owners with Bun 1.4.4:

```sh
bun test src/__tests__/paint-certification.test.ts src/__tests__/curved-connector-projection.test.ts src/__tests__/scene-transform.test.ts --timeout 60000
bun run typecheck:core
NODE_ENV=production AGENTIC_MERMAID_SCENE_ASSERTIONS=0 bun run scripts/site/editor.ts
bun test e2e/browser.test.ts --test-name-pattern 'standalone editor' --timeout 120000
```

[Current profile, full products, checks, builds, independent review and stopped probes](https://github.com/adewale/agentic-mermaid/tree/57c180d47b2d01a618ec2a1c4e1ca87d1606c538/original-marker-bounds-20261107) are backed up outside the source diff. [Main integration evidence](https://github.com/adewale/agentic-mermaid/tree/19fbe17aaeee45d5c01a5e953705ca1da13fc704/main-integration-20261107) and [original pictures](https://github.com/adewale/agentic-mermaid/tree/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105) remain in history. The [work log](https://github.com/adewale/agentic-mermaid/blob/62af995fafa5392364ab2567678f11e59fea9ea6/docs/design/system/layout-0.6-work-log.md) records exact revisions and remaining losses. Archived leases cannot authorize writers. Bounded continuation remains authorized through **2026-11-08T23:59:59Z**.

