Compared with fixed main `f9ec8c115`, this PR delivers the enrolled ER208 input that main refuses, reduces the default-path forest's area and wire, and restores a selected hollow-circle marker. It also has substantial resource costs and unresolved failures. **This remains a draft.**

## What gets better—and what does not

These are matched **main → PR741** results on six existing inputs enrolled before their outcomes. Every lane uses identical source/options and the public SVG-with-receipt API in fresh Node24 processes. “Default” below means `graphLayout` omitted; this is not always ELK. The ordinary forest takes the existing forest fast path in both revisions.

| Input | Default-path main → PR | Explicit Native main → PR |
| --- | --- | --- |
| ER208 relationship chain | **400k geometry-work refusal → SVG delivered**, proof passed | Same delivery gain; 208 identities, 207 ordered relationships and 414 normal contacts retained |
| Nonlinear forest | **Area −26.98%, wire −37.60%**, eight bends unchanged | Same improvement. Explicit ELK painted geometry remains unchanged |
| Raw hollow circle | **0→225 confined marker pixels** | Same paint gain. Proof remains unverified in all modes |
| Sparse256 | Painted geometry unchanged | **Area −77.05%**, connected wire unchanged |
| Requirement TB cycle | Painted geometry unchanged | **Area −22.95%, wire −8.56%**, eight bends unchanged |
| ER256 relationship chain | Both revisions still refuse at the unchanged 400k geometry cap | Both revisions still refuse |

All 36 actual calls are retained: 27 returned (21 proof-passed, six proof-unverified), nine refused. Six earlier zero-call dependency-loader failures remain separate tooling history. They are not counted as main delivery failures. The loader correction changes no library source, and no successful capture was repeated.

Independent review checks authored identities, ordered relationships, fields, captions and normal contacts against actual final SVGs. Selected prior circle/forest ink controls bind by exact SVG bytes. Whole-diagram glyph attribution, readability and arbitrary fonts remain unqualified. These six fixtures establish selected benefits, not a complete workload ranking or a runtime speedup.

## Costs and remaining losses

Equivalent complete standalone production builds use the same Bun1.4.4, installed dependencies, command and environment:

| Complete editor HTML | Main | PR | Delta |
| --- | ---: | ---: | ---: |
| Raw bytes | 4,735,937 | 2,167,553 | −2,568,384 |
| Gzip9 bytes | 1,420,933 | 1,419,207 | −1,726; nearly flat |
| Brotli11 bytes | 1,097,178 | 1,355,838 | **+258,660 (+23.58%)** |

Both measured gzip builds exceed the existing 1,334,500 standalone ceiling. That does not assert a main CI result. The selected-ELK lazy Flowchart closure separately grows **732,640→771,830 gzip bytes (+39,190)** in the PR's current-main CI comparison. Smaller raw HTML does not establish a general download win.

Proof work also rises on some unchanged drawings: forest default 22,851→98,311; raw circle 41,687→156,940; Requirement default 25,613→102,468. Sparse256 default falls 102,610→90,857. Relevant Scene, ER and Native-paint caps are unchanged. These are work counts, not CPU measurements. N=1 capture timings/RSS remain descriptive; no runtime ratio follows.

Current Native versus ELK differences remain separate from main-relative gains:

- Forest: **wire +10.19%, area −6.43%**, eight bends in both. The latest source-exit fix accounts for a 5.74% wire reduction within the branch.
- Sparse256: Native area **+5.04%** versus ELK. The +0.97% backfill candidate is unshipped; +115.35% is obsolete history.
- Requirement TB: current Native is **10.43% smaller**, with 30.34% less wire and eight versus ten bends. The historical **+9.53% area loss is stale** on this exact PR741 input; it must not drive another TB fix. Other directions were not requalified here.
- ER256 refusal remains distinct from Sparse32's **400k proof-cap failure**. Sparse32's text/marker delivery and proof availability remain separate findings.

The original campaign baseline2dadf0dbc2685c8435df541de99f3edce841450d/Trident/pinned Mermaid12.2/Pele1.9 comparison remains unavailable after recovery. Pele1.8 was not substituted. Replacement24 stays sealed.

## Visual evidence

PR baseline SHA: `f9ec8c115de14020d3c182d5d7f2e7e70bfcdefb`.
Current PR head SHA: `63a32f5b972de9dea25834a746e441780acc01f2`.
Tested runtime head: `741b80dba91c0e1f4feba9a62695f7820bc79a23`; the new head changes only the work log.

The pair below renders the same omitted-backend forest at equal scale with four manifest-verified Inter weights. It compares actual main with PR741, rather than two intermediate branch checkpoints.

| Main before | PR after | What to inspect |
| --- | --- | --- |
| <img alt="Main: the six-card forest has large vertical gaps and a shared source exit below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-main.png" width="340"> | <img alt="PR: the same six cards and four arrows use less vertical space, with separate exits below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-pr.png" width="340"> | Compare the empty vertical spans and retained card text/target arrows. Width and raster scale are fixed; card dimensions are retained. |

[Exact inputs/options, SVGs, entire receipts, refusals, independent review, compression and paired builds](https://github.com/adewale/agentic-mermaid/tree/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105) are outside the source diff. The archive records the capture command/controller and every outcome. Selected ink reuse adds no new public render or attribution claim.

The owning forest regression can be reproduced with Bun1.4.4:

```sh
bun test src/__tests__/fanout-symmetry.test.ts src/__tests__/forest-lazy-boundary.test.ts src/__tests__/indexed-forest.test.ts src/__tests__/layout-equivalence.test.ts --timeout 60000
```

Four directional owners fail against the previous fork gate. The repaired runtime passes 44 nearby/corpus tests (322 geometry records unchanged), 28 ownership/CSS tests, core types and two-file lint. A fresh Native repeat matches; explicit ELK stays byte-exact. The latest report commit changes no renderer or tests.

## Scope, qualification and recovery

Normal merge `fa85d8123` retains mainf9 and recoverye057, including the inherited ownership/capture foundation. Private-copy, mutable/getter/CSS/definition isolation and UTF16 contracts remain part of the broad diff. Main's 0.5.7 identity, backend-default setting and caps are unchanged. No release or publication change is introduced.

Nine Class geometry records, the Requirement PNG and the Class browser PNG were independently reviewed before their expectations changed. These commits qualify existing behavior; they add no rendering feature. Repairs to integration-introduced regressions are recorded separately from improvements over main.

Runtime [CI741 run42064078938](https://github.com/adewale/agentic-mermaid/actions/runs/42064078938) completed **failed**. Shards1/2, semantic conformance, CLI/MCP, browser scene checks and package consumers pass. Shard3 fails only the enrolled Sparse32 case. Rounded-header screenshots pass; quality/full-payload checks and the advisory layout diagnostic fail. The documentation head needs its own CI status. No failed lane or ceiling is waived.

The [report-first performance review](https://github.com/adewale/agentic-mermaid/blob/63a32f5b972de9dea25834a746e441780acc01f2/docs/design/system/layout-0.6-performance-review.md) retains five measured hotspots with self/inclusive distinction, the cache inventory and adverse samples at revision99ed. No causal speedup is established and no cache is added. The next resource probe is whether worker precompression explains the Brotli loss, while preserving decoded bytes and browser contracts.

The [work log](https://github.com/adewale/agentic-mermaid/blob/63a32f5b972de9dea25834a746e441780acc01f2/docs/design/system/layout-0.6-work-log.md) and [latest restore checkpoint](https://github.com/adewale/agentic-mermaid/blob/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/README.md) retain revisions, historical costs, stopped hypotheses and byte-verified archives. Source/tests are on this PR branch; evidence is on `review/pr449-evidence-20261105`. Archived leases cannot authorize writers. The owner permits bounded continuations and regular pushes through **2026-11-08T23:59:59Z**; continuous execution is not claimed.
