Compared with current main `39a500425`, this PR delivers the enrolled ER208 input that main refuses, reduces the default forest's area and wire, and restores a selected hollow-circle marker. It also increases some proof work, Brotli delivery size and build memory. **This remains a draft.**

## Improvements over current main

The same six inputs and options were frozen before outcomes. Fresh main39→PR1693 qualification makes 36 public SVG-with-receipt calls in separate Node24 processes, consuming the whole SVG and entire receipt. All 27 returned products bind byte-exactly to the earlier mainf9/PR741 products; nine calls still refuse. This preserves the demonstrated gains through integration, without claiming a new layout improvement.

| Input | Omitted backend: main→PR | Explicit Native: main→PR |
| --- | --- | --- |
| ER208 relationship chain | **400k geometry-work refusal→SVG delivered**, proof passed | Same gain; 208 identities, 207 ordered relationships and 414 normal contacts retained |
| Nonlinear forest | **Area−26.98%, wire−37.60%**, eight bends unchanged | Same gain; explicit ELK painted geometry unchanged |
| Raw hollow circle | **0→225 confined marker pixels** | Same paint gain; proof remains unverified in all modes |
| Sparse256 | Painted geometry unchanged | **Area−77.05%**, connected wire unchanged |
| Requirement TB cycle | Painted geometry unchanged | **Area−22.95%, wire−8.56%**, eight bends unchanged |
| ER256 relationship chain | Both revisions still refuse at the unchanged 400k geometry cap | Both still refuse |

Of 27 returns, 21 have passed proof and six remain unverified. Omitted Flowchart layout uses the existing forest fast path in both revisions; “default” does not always mean ELK. Selected circle/forest ink controls remain bound by exact SVG bytes. Whole-diagram glyph attribution, readability and arbitrary fonts remain unqualified. These cases establish selected benefits rather than a complete workload ranking.

## Delivery and execution costs

Complete production standalone builds use identical Bun 1.4.4, installed dependencies, environment and builder on main39/PR1693:

| Complete HTML / build cost | Main39 | PR1693 | Change |
| --- | ---: | ---: | ---: |
| Raw bytes |4,742,588|2,091,362|−2,651,226|
| Gzip9 bytes |1,423,188|1,348,449|**−74,739 (−5.25%)**|
| Brotli11 bytes |1,098,404|1,282,268|**+183,864 (+16.74%)**|
| Peak build RSS, KiB |430,832|683,124|**+252,292**|

Both builds finish within the existing 55-second child deadline. The 12.1/20.8s observations establish no speed ratio. The actual emitted-worker owner passes complete Blob comparison, enrolled family/style SVGs, full receipts/verification, backend/fallback, crash recovery and ASCII/Unicode/PNG. The paired browser run records 499 assertions: one passing worker test and one failing budget test. The original gzip ceiling is retained, exceeded locally by **13,949 bytes**. Extra notices caused by symlinked dependencies remain included. Local and CI absolute build sizes stay separate.

The November 6 one-pass worker compression had its own matched before/after saving of 80,895 gzip / 79,153 Brotli bytes, with 137,072 KiB extra peak RSS. It reuses the existing browser compressor before packing; other callers keep six passes. The current integration adds no further optimization. A full six-pass worker candidate exceeded the build deadline and was stopped. Literal raw insertion was only a compression lower bound: 5,910 Brotli bytes saved while gzip worsened 283,230 bytes. That hypothesis was also stopped. No cache or ceiling is added by the campaign's compression change.

Proof work remains adverse on some unchanged drawings: forest default 22,851→98,311; raw circle 41,687→156,940; Requirement default 25,613→102,468. Sparse256 default falls 102,610→90,857. These are work counts, not CPU measurements. Caps remain unchanged. Single-sample timing/RSS observations establish no runtime ratio.

The [report-first performance review](https://github.com/adewale/agentic-mermaid/blob/930faf846c6bec55e1f9b053844700e08281faf6/docs/design/system/layout-0.6-performance-review.md) retains five measured hotspots with self/inclusive distinction, cache inventory and adverse samples at source 99ed. Its inventory and profiles are historical; newly integrated main code has not received a new performance profile. No causal rendering speedup or expected-speedup forecast is established.

## Remaining differences from ELK

- Forest: Native **wire+10.19%, area−6.43%**, eight bends in both. The earlier source-exit fix reduced branch wire 5.74%; residual placement/terminal cost remains.
- Sparse256: Native **area+5.04%**. The +0.97% backfill candidate is unshipped; +115.35% is historical.
- Requirement TB: Native is **10.43% smaller**, with 30.34% less wire and eight versus ten bends. The old TB+9.53% loss is falsified on this input. BT/LR/RL remain unqualified at this checkpoint.
- Shared ER256 refusal remains separate from Sparse32's 400k proof-cap failure. Delivered text/markers, proof availability and readability remain separate findings.

Original baseline2dadf0dbc2685c8435df541de99f3edce841450d/Trident/pinned Mermaid12.2/Pele1.9 products remain unavailable after recovery. Pele1.8 was not substituted. Replacement24 stays sealed.

## Visual evidence

PR baseline SHA: `39a500425f6b74eb486b9add9e90d538fab6a914`.
Current PR head SHA: `930faf846c6bec55e1f9b053844700e08281faf6`.
Tested combined runtime: `1693c2a2b7fd93cb5da11f1a358d162180fa19cc`; the latest head updates only the work log.

The pictured SVGs were captured at mainf9/PR741. Fresh main39/PR1693 SVGs and entire receipts are byte-exact to those products, so the existing images and selected ink controls are reused with their original limits. Equal scale and four manifest-verified Inter weights show the same six cards/four arrows; no image was edited.

| Main before | PR after | What to inspect |
| --- | --- | --- |
| <img alt="Main: the six-card forest has large vertical gaps and a shared source exit below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-main.png" width="340"> | <img alt="PR: the same six cards and four arrows use less vertical space, with separate exits below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-pr.png" width="340"> | Compare the empty vertical spans and retained card text/target arrows. Width and raster scale are fixed; card dimensions are retained. |

[Fresh inputs/options, complete SVGs/receipts, refusals, binding results, builds and independent review](https://github.com/adewale/agentic-mermaid/tree/5958c1c2b42e8e08d0a95d5563688c9976d459f3/main-integration-20261107) are outside the source diff. The [original pictures and capture records](https://github.com/adewale/agentic-mermaid/tree/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105) retain generation provenance. Byte binding adds no new glyph-attribution or general-readability claim.

## Scope and qualification

Normal merge 1693 combines main39 with PR970, preserving typed parser inspection, authored UTF16 diagnostics and source-MCP isolation beside the inherited PR449 capture/ownership foundation. The sole conflict retains the original standalone ceilings. Main's 0.5.7 identity, backend-default setting, ownership/getter/CSS/definition isolation and all caps remain in place. SDK regeneration reproduces the merged declarations exactly.

Local qualification: 273 parser/MCP tests; 146 foundation tests plus 103 after restoring missing xmlchars; core typing without diagnostics; 52-file lint. Independent source-position/admission probes reproduce no defect. These are bounded contract checks, not full-suite readiness. The PR remains broad because it includes the inherited foundation. Reviewed Class/Requirement/browser goldens qualify earlier behavior and add no rendering feature.

Prior head 970 [CI42311014876](https://github.com/adewale/agentic-mermaid/actions/runs/42311014876) completed failed on merge 672f436 into mainf9: standalone gzip 1,337,753 remains 3,253 over the original ceiling; Sparse32, lazy/demo payloads and advisory diagnostics fail. Integration [CI1693 run42316449234](https://github.com/adewale/agentic-mermaid/actions/runs/42316449234) tests merge a785d98 into main39: CLI, MCP and macOS/Windows isolation pass; quality, standalone/demo payloads and advisory fail. Unit/semantic jobs were cancelled by the documentation push, not passed. [Latest-head CI42317300663](https://github.com/adewale/agentic-mermaid/actions/runs/42317300663) completed **failed**, testing merge302cc19 into main39. Shards1/3, semantic conformance, browser contracts, CLI/MCP, package consumers and macOS/Windows isolation pass. Shard2 fails only Sparse32; standalone CI gzip1,339,386 is4,886 over the unchanged ceiling. Lazy/demo payloads and the advisory diagnostic fail. No ready claim or waiver.

Reproduce the integration owners with Bun 1.4.4:

```sh
bun test src/__tests__/diagram-parsers.test.ts src/__tests__/diagram-work-limits.test.ts src/__tests__/mcp-source-tools.test.ts --timeout 60000
bun test src/__tests__/scene-svg-writer.test.ts src/__tests__/scene-native-validation.test.ts --timeout 60000
NODE_ENV=production AGENTIC_MERMAID_SCENE_ASSERTIONS=0 bun run scripts/site/editor.ts
```

Earlier four directional forest owners failed before the source-exit repair; the merge adds no new bug-fix RED claim. The existing emitted-worker owner is the regression guard for the changed build.

The [work log](https://github.com/adewale/agentic-mermaid/blob/930faf846c6bec55e1f9b053844700e08281faf6/docs/design/system/layout-0.6-work-log.md) and [restore checkpoint](https://github.com/adewale/agentic-mermaid/blob/5958c1c2b42e8e08d0a95d5563688c9976d459f3/main-integration-20261107/README.md) retain exact revisions, adverse costs, stopped hypotheses and byte-verified archives. Source and evidence are pushed separately. Archived leases cannot authorize writers. Bounded continuation and regular pushes remain authorized through **2026-11-08T23:59:59Z**; continuous execution is not claimed.
