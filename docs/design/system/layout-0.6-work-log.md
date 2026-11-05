# Native layout recovery: results and handoff

The owner stopped the campaign on **5 November 2026 at 13:20:32 UTC**. Both the
hourly campaign and deadline-report automations are disabled. Work ran in bounded
sessions. This document records the stopped state; it does not schedule more work.

Draft [PR #602](https://github.com/adewale/agentic-mermaid/pull/602) preserves the
source on `work/pr449-reconstruct-20261103`. Its recovery base is
`3b56da55e6570908beb5d96c25f4c03c1a828a22`; integration with current `main` remains
unfinished. ELK is still the default. Versions, publication settings and caps are
unchanged. Replacement24 remains sealed.

## Remaining differences from ELK

These are retained same-input observations at their recorded revisions, not a
ranking of current `main`. Unknowns and refusals remain part of the workload.

| Workload | Native compared with ELK | Cause or remaining work |
| --- | --- | --- |
| Sparse256: 256 cards, one relationship | Area 3,633,619.5 vs 3,459,200: **+5.04%**. Wire 132.598 vs 214.598. | The default isolate clearance fix removed 51.22% of the previous Native area. Residual shelf packing remains; connected geometry is unchanged. |
| Nonlinear forest | Wire **+16.89%**, area **−6.43%**. | Fixed-dock routes are already shortest. Inspect placement and terminal seating; the stopped leaf-seat trial increased area 6.88%. |
| Requirement cycle | TB/BT area **+9.53%**; LR/RL **−1.44%**. | Directional placement loss remains. Fields, relations and observed ink were retained at `15972c57e`. |
| ER256 relationship chain | **Both backends refuse.** | Distinct from Sparse256 above. Guarded shortcuts did not remove enough work. |
| Sparse32 | Delivered 1,500 text records and 32 contributing markers; proof unverified at 400,000 operations. | Proof availability, middle-glyph attribution, readability and arbitrary fonts remain separate unknowns. |

The original `campaign-baseline2dadf0dbc2685c8435df541de99f3edce841450d`, Trident and
pinned Mermaid12.2/Pele1.9 were unavailable after recovery. The complete original
four-way comparison is therefore unfinished. Pele1.8 was not substituted.

## Latest implemented changes

`c93e0c51f37b1d9edabd81ad6404764eb1dff7e6` uses the existing 20px ER component
clearance for flat Native isolates when the author has not requested node spacing.
Connected spacing stays 70px; explicit 0/70, frontmatter 90 with option 0 override,
groups and getter behavior remain covered. On the same 1,199-byte source and default
options, area fell from 7,449,331 to 3,633,619.5. The old **+115.35%** ELK deficit
is historical. All 256 names, 140×56 bodies, the identifying N0→N1 relation and
its two cardinality owners remain. Sampled N0/N255 header and cardinality ink is
retained; this does not qualify every glyph or font. Proof passed before and after,
with operations **90,546→91,015 (+469)**, unchanged pairs and caps.

`b32489e19e290f7e3327715678bb1b5c1f419249` shares captured raw orthogonal carriers
with terminal paint. The enrolled hollow circles in both backends changed from
0 to 225 confined pixels. Geometry, resources and normal contacts were preserved.
Two getter drifts and a descriptor refusal introduced during development were
removed. Proof remains unverified, **156,838→156,940 (+102 operations)**. Earlier
plain/linear/STEP repairs remain in history; cubic, closed, diagonal, reversal and
insufficient-runway cases remain outside the demonstrated fix.

Earlier gains include nested Class captions (6/8→8/8), ER192/207/208 delivery,
ER208 scene reuse (proof 400k cap→287,124/280,068 with unchanged SVG), Class128
certification in four directions, measured forest placement, Requirement marker
clearance and shared multiline formatting. Inspection/emission ownership repairs
remove reproduced false certification passes. These have distinct revisions and
bounded evidence; shared-consumer repairs benefit both backends.

## Qualification and costs

The two runtime commits were qualified before this documentation cleanup:

| Runtime revision | Recorded verification |
| --- | --- |
| `b32489e19` | Owning RED→GREEN; 384 tests in 8 files, core types and four-file lint passed. Initial descriptor regression and failed drafts retained. |
| `c93e0c51f` | Owning default-spacing RED→GREEN; 144 tests in 7 files, core types and two-file lint passed. Two Node24 source and two compiled whole-SVG/entire-receipt bindings matched. |

The whole repository suite and final-head CI are **not qualified**. Earlier broad
checks retained 973 passes and the known Sparse32 failure at their own revision.
Documentation/backup cleanup changes no runtime or tests and adds no delivery claim.

Sparse256 cost observations at `c93e0c51f` fully consume SVG and the entire receipt.
Each cell is one sample per phase in a fresh backend/cache worker, after imports
and initial GC. Imports, compression and memory counters are recorded separately.

| Cache setting | Native cold / repeat / edit, ms | ELK cold / repeat / edit, ms |
| --- | --- | --- |
| 0 | 714 / 320 / 485 | 2,357 / 1,049 / 1,026 |
| 1 | 784 / 256 / 668 | 4,625 / 395 / 1,145 |

Peak RSS was Native 193,944/195,008 KiB and ELK 277,324/274,500 KiB for cache 0/1.
Native SVG is 265,157 raw / 13,323 gzip9 / 6,638 Brotli11 bytes; ELK is
260,973 / 12,762 / 6,836. The ER code closures are Native 23 requests / 330,472
gzip / 279,193 Brotli bytes, versus ELK 21 / 700,600 / 550,613. The isolate fix
adds 6 gzip / 15 Brotli code bytes; Native gzip SVG remains larger than ELK.
These samples establish no causal runtime speedup or cache benefit. Raw heaps,
slower samples, imports and stage observations remain in the backup.

## Stopped experiments and missing work

Final-row backfill reduced Sparse256 area another 3.88% (candidate +0.97% vs ELK),
but moved N255 above N2. It was stopped to retain predictable row-major packing;
this is a value tradeoff, not an authored-order requirement or acceptance gate.
It is **unshipped**; the implemented area deficit remains +5.04%.

The start-circle parser shortcut changed multiline one-edge meaning into two
edges and was stopped. Broad normalization caused ten regressions and was
withdrawn. ER256 shortcuts failed the causal sufficiency test. The Node24 profile
withdrew descriptor-Map causation; no cache/array/SoA rewrite or speedup forecast
is justified by it. A reliable five-hotspot performance report remains unfinished.

If the owner requests continuation, begin with one demonstrated loss and locate
the first responsible stage. For the forest, investigate placement/terminal seats
before routing. Keep adverse area/wire/runtime costs and unknowns visible. Unchanged
replays are validation. Authored meaning and final ink decide correctness; ELK
supplies counterexamples and alternative solutions, without requiring zero metric
differences. Integrate with current `main` before claiming the PR is ready.

## Restore after environment loss

The [backup and restore guide](https://github.com/adewale/agentic-mermaid/blob/24f5f1ab972937d687691d5282b6cec04830c5b8/recovery-20261105/README.md)
on `review/pr449-evidence-20261105` preserves all 5,122 current comparison files,
prior evidence snapshots, controllers, stopped patches and coordination records.
Its archive reconstruction was byte-checked. Restore into empty scratch space;
historical leases must not reactivate the stopped campaign.

The full pre-cleanup log remains at
`0a4534ee814d0c380de138b845b0d8e3f5226132:docs/design/system/layout-0.6-work-log.md`;
older full logs and failed trials are retained in Git history and the backup.
This is recovered November 3–5 work, not restoration of the original lost campaign.
