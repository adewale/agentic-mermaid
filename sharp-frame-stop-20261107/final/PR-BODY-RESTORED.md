Compared with main `39a500425`, this PR delivers the enrolled ER208 chain that main refuses, reduces the default forest's area and wire, and restores a selected hollow-circle marker. Standalone gzip is 7.90% smaller. Brotli size, build memory and some proof work are higher. **This remains a draft; CI is not green.** The latest attempted contact repair was reverted after it reintroduced working circle/shaft contacts.

## Demonstrated improvements

The same six sources and options were frozen before outcomes. Before the now-reverted expansion, all 18 PR calls were requalified: 15 returned and three refused. Every returned SVG and entire receipt is byte-exact to the integrated PR1693 product; all three refusal names/codes/messages match. Main39 is unchanged, so its retained products are reused. This validates preservation, not a new layout gain.

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

| Complete HTML / observed build cost | Main39 | Retained PR14bec runtime | Change |
| --- | ---: | ---: | ---: |
| Raw bytes |4,742,588|2,186,759|−2,555,829|
| Gzip9 bytes |1,423,188|1,310,687|**−112,501 (−7.90%)**|
| Brotli11 bytes |1,098,404|1,244,928|**+146,524 (+13.34%)**|
| Peak build RSS, KiB |430,832|673,272|**+242,440**|

The retained runtime14bec build took 17.1 seconds within the existing 55-second deadline. The generated HTML has been restored byte-exactly after the reverted experiment. These single build observations establish no speed or memory ratio. The original standalone gzip ceiling of 1,334,500 bytes is unchanged and now passes locally. The actual emitted-worker owner also passes: 504 assertions across the two tests cover complete Blob bytes, enrolled family/style SVGs, entire receipts/verification, backend/fallback, crash recovery and ASCII/Unicode/PNG.

Private worker delivery reuses one existing compressor pass before packing, then specializes the bounded decoder dictionary for the exact build-owned stream. Each build traces dictionary reads, preserves offsets/length and verifies every decoded worker byte; notices and byte/CRC/loop/window/time/cancellation checks remain. The earlier dictionary step saved 37,701 gzip and 37,131 Brotli bytes while adding 95,553 raw bytes. The latest hull change modifies worker code and was requalified through the actual browser owner; its complete HTML saves a further 61 gzip and 209 Brotli bytes. No cache is added.

Lazy family transfer remains adverse. The matched pre-hull Packet plus complete YAML closure grows **196,160→230,648 gzip bytes**, despite 22→13 requests. Flowchart selected ELK grows 734,953→774,077. The latest change adds 10 raw bytes per family closure, including Class gzip+3 and Flowchart+14. Initial gzip moves 5,854→5,852, Brotli 5,226→5,227. Current lazy/demo/editor-empty budget failures remain; no ceiling or approval label is changed.

A matched-compressor packing probe saved only 2,416 gzip bytes and left 32,073 above main's static Packet transfer. It was compression-only, not executable ESM or a bound on all possible rewrites. Six-pass worker compression exceeded the build deadline; raw worker insertion worsened gzip. These stopped hypotheses and the earlier Python/Bun compressor mismatch remain in evidence.

Proof work also remains higher on some drawings: forest default 22,851→98,311; raw circle 41,687→156,940; Requirement default 25,613→102,468. Sparse256 default falls 102,610→90,857. These counts are not CPU measurements; caps stay unchanged.

## Runtime cleanup and profile

The latest retained runtime change requests bounds without constructing an unused original marker hull in paint certification. Every original-region consumer reads only bounds; served regions retain their full hull. Resource/pose encoding, proof charges and caps remain unchanged.

The [performance report](https://github.com/adewale/agentic-mermaid/blob/14bec477578104a1eab5a279473aa77e747f8476/docs/design/system/layout-0.6-performance-review.md) retains the historical five-spot/cache review and adds a current Class128 profile before intervention. The largest sampled frame is first Scene admission, not redundant recapture. Class's Native-labelled placement still uses its Scene adapter; skipping mutable-input admission was not justified.

A sequential before/candidate pair preserves all warmup/repeat/edit SVGs and complete receipts. Repeats retain 388,607/400,000 proof operations; edit 389,269; all 127 markers and passed proof remain. Marker-region sampled self/inclusive weights move 7.697/12.499→6.964/11.241ms per call. Unchanged code also moves; this is **not an established end-to-end speedup**. Confounded earlier profiles, raw RSS/heap, errors and adverse observations are retained. Cold/import latency and cache1 were not measured in this bounded probe.

## Rebase and Sparse32 diagnosis

The requested merge-preserving rebase onto current main39 completed at the same 14bec head and tree. Missing historical Git objects were repaired, and intermediate files were preserved. No force push was needed. Heads 62af, deafff39d and dd365 add work-log qualification. The attempted frame expansion5ac52 was reverted in6aa0ee45d; runtime and tests are byte-exact to dd365/14bec. Delivery/profile measurements above remain pinned to14bec, rather than claiming another unchanged build as progress.

The existing Sparse32 owner still fails. A stage trace is clean at **337,890 operations before XML closure**; the first refused charge requests 7 at 399,994 during typed-text literal validation. The actual 1,500-row/32-marker ink checks and direct Scene proof pass, while emitted Native proof remains unverified at the unchanged 400,000 allowance. This differs from ER256's geometry refusal.

A seven-bit prepared-attribute probe retained literal checks but still exhausted the allowance. It is saved and reverted, with all three control SVGs exact. Smaller 1,000/1,250-label probes pass at 328,063/395,813 operations; these are descriptive points, not maximums or acceptance gates. The original failure stays enrolled. [Rebase records, first-charge trace, failed candidate and independent review](https://github.com/adewale/agentic-mermaid/tree/a5c343e6600185b53679411a2f85575447454d50/rebase-sparse32-20261107) are backed up. No new runtime gain or capacity repair is claimed.

## Remaining differences from ELK

- Forest Native: **wire+10.19%, area−6.43%**, eight bends in both. Residual placement/terminal cost remains.
- Sparse256 Native: **area+5.04%**. The +0.97% backfill candidate is unshipped; +115.35% is historical.
- Requirement cycle Native: **TB/BT area−10.43%, wire−30.34%**, eight versus ten bends; **LR/RL area−1.44%, wire−20.25%**, six versus eight bends. The old TB/BT+9.53% loss does not reproduce on this fixture.
- Shared ER256 geometry refusal remains separate from Sparse32's proof-cap failure.

Six newly enrolled BT/LR/RL calls at 62af consume the full public SVG and entire receipt; all return with proof passed. Independent final-SVG inspection retains three authored cards, five ordered relationships and caption owners, and ten normal contacts per output. In manifest-pinned Inter rasters with system fonts off, each of 15 text programs and five arrows contributes pixels. LR/RL are wider and shorter: 970.194×251.95 versus ELK753.144×329.3, so the lower area does not establish better readability. SVG gzip6 is17–41B smaller, Brotli11 is23–43B smaller; N=1 CPU/wall/RSS observations establish no speed ratio. This is new directional qualification, with no runtime change or new layout gain. [Six actual products, PNGs, per-occurrence masks, costs and independent review](https://github.com/adewale/agentic-mermaid/tree/2b02e8d5970d3e3f695677d0e2fc9620ce064544/requirement-directions-20261107) are recoverable.

Ordinary painted-contact loss remains: original CI `sha256-counter-v1:152` delivers 17 nodes and 39 relationships but leaves 122 selected shaft pixels fully hidden by an unrelated card. Its strokes overlap by 0.823px. Checkpoint `5ac52ad3f` fixed that selected output through a nearer lane, but the complete CI comparison exposed five passed→unverified records across four unique sources. SHA33 and ELK296/362 reintroduced actual circle/shaft overlaps of 0.875, 0.125 and 0.5px. Native17 also changed its selected placement and gained marker-envelope warnings; its full causal path and visible marker impact remain unknown.

The added rectangle checks spent the shared optional allowance before existing circle repairs. A same-ledger circle-first probe restored17/33 proof but left152 unfixed, so it was stopped too. **Both implementations are reverted; no net renderer improvement ships from this attempt.** Current head `6aa0ee45d9b6052addcb77036c1f7ba4c13b2cb4` restores prior runtime/tests exactly. Fresh17/33/ELK296 SVGs bind byte-exactly to old CI with their recorded index prefixes;152's full SVG and entire unverified receipt bind exactly to its prior product.

The [complete positive/adverse products and stop decision](https://github.com/adewale/agentic-mermaid/tree/62d61e5cc41211f4aa3d5f50c0d8d05c0748e284/sharp-frame-stop-20261107) preserve the verified23MB CI artifact, all1,748 matched backend/case records, ten changed SVGs, all costs and the stopped priority-order probe. These existing corpora do not establish a general workload ranking. Passing505 local route owners,92 nearby cases and the real standalone owner did not establish preservation of those later circle decisions. Cases372/102 remain unverified. Case276's crossing-only candidate also stays reverted because it introduced a real painted contact. Next investigation must profile and reduce shared contact-query work before expanding the supported domain, without a new cache or quota.

Original baseline `2dadf0dbc2685c8435df541de99f3edce841450d`, Trident and pinned Mermaid 12.2/Pele 1.9 products remain unavailable. Pele 1.8 was not substituted. Replacement24 stays sealed.

## Visual evidence

PR baseline SHA: `39a500425f6b74eb486b9add9e90d538fab6a914`.
Current PR head SHA: `6aa0ee45d9b6052addcb77036c1f7ba4c13b2cb4`.

The pictures were captured at mainf9/PR741. Main39/PR1693 SVGs and entire receipts bound exactly to those products; the latest 18 PR calls bind again to PR1693. The existing images therefore retain their original selected-ink limits. Equal scale and four manifest-verified Inter weights show the same six cards/four arrows; no image was edited.

| Main before | PR after | What to inspect |
| --- | --- | --- |
| <img alt="Main: six forest cards have large vertical gaps and a shared exit below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-main.png" width="340"> | <img alt="PR: the same cards and arrows use less vertical space and separate exits below Root D" src="https://raw.githubusercontent.com/adewale/agentic-mermaid/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105/forest-pr.png" width="340"> | Compare empty vertical spans, retained card text and target arrows. Width/raster scale and card dimensions are fixed. |

## Scope, checks and recovery

Normal merge 1693 integrates main39 while retaining the inherited PR449 capture/ownership foundation, UTF16 diagnostics, typed parser and source-MCP isolation. Main's 0.5.7 identity, backend-default setting, mutable/getter/CSS/definition isolation and all caps remain. Reviewed Class/Requirement/browser goldens qualify earlier intentional spacing behavior.

Historical qualification at unchanged runtime14bec: 740 passed, known Sparse32 failed, and one child stdin permission error returned no render product. That public cyclic owner passes its permitted retry (392 assertions). Core types, changed-file lint, ESM/declarations and the actual standalone browser owners pass. These are behavior-preserving regression guards, not a new bug-fix RED claim.

[Retained runtime CI42332734235](https://github.com/adewale/agentic-mermaid/actions/runs/42332734235) completed **failed**. It tested main39 plus PR14bec at an identical source tree: Sparse32, lazy/payload budgets and the advisory diagnostic failed; the other runtime lanes passed. [Stopped candidate CI42346721251](https://github.com/adewale/agentic-mermaid/actions/runs/42346721251) also completed **failed**, and its complete products exposed the new circle regressions described above. [Current rollback-head CI42347646535](https://github.com/adewale/agentic-mermaid/actions/runs/42347646535) is in progress; its quality job has failed. No readiness claim, waiver, manual CI dispatch, force push or rebase.
Reproduce the affected owners with Bun 1.4.4:

```sh
bun test src/__tests__/paint-certification.test.ts src/__tests__/curved-connector-projection.test.ts src/__tests__/scene-transform.test.ts --timeout 60000
bun run typecheck:core
NODE_ENV=production AGENTIC_MERMAID_SCENE_ASSERTIONS=0 bun run scripts/site/editor.ts
bun test e2e/browser.test.ts --test-name-pattern 'standalone editor' --timeout 120000
```

[Current profile, full products, checks, builds, independent review and stopped probes](https://github.com/adewale/agentic-mermaid/tree/57c180d47b2d01a618ec2a1c4e1ca87d1606c538/original-marker-bounds-20261107) are backed up outside the source diff. [Main integration evidence](https://github.com/adewale/agentic-mermaid/tree/19fbe17aaeee45d5c01a5e953705ca1da13fc704/main-integration-20261107) and [original pictures](https://github.com/adewale/agentic-mermaid/tree/a073858f2d9a51b6ddcfb55fb2effae394b18793/main-comparison-20261105) remain in history. The [work log](https://github.com/adewale/agentic-mermaid/blob/6aa0ee45d9b6052addcb77036c1f7ba4c13b2cb4/docs/design/system/layout-0.6-work-log.md) records exact revisions and remaining losses. Archived leases cannot authorize writers. Bounded continuation remains authorized through **2026-11-08T23:59:59Z**.

