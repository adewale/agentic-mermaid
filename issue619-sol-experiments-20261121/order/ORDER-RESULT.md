# Controlled ordering results

Keep the c18f607364ca1d85dd91a669c8ac33a2c7173a23 incumbent. None of the tested ordering/options combinations earns a production change. All experiments are scratch source-loader diagnostics; no production files, defaults, budgets, balanced acceptance rules or runtime fallback were changed.

## Completed public matrix

`run.ts` reuses the existing `eval/layout-compare/run.ts:snapshotSample` owner: complete public layout-with-receipt, complete public SVG-with-receipt and `measureQuality`. Complete source, public layout, SVG, both receipts, per-occurrence crossing/overlap pairs and actual kernel feedback/rank/order traces are retained in each `<arm>-<case>.json` and `<arm>-<case>.svg`. All cases use explicit `{graphLayout:{backend:'elk'}}`. Instrumented execution does not establish latency or allocation cost.

| Intervention | Force | Cyclic19 crossings | Caption-edit crossings | Nine-chain crossings / paint | Auth crossings / paint |
| --- | --- | ---: | ---: | --- | --- |
| Incumbent | true | 37 | 37 | 3 / passed | 0 / passed |
| Relax force only | false | 48 | 48 | 3 / passed | 0 / passed |
| Declared child array | true | 84 | 84 | 21 / **unverified** | 0 / passed |
| Declared child array | false | 62 | 62 | 21 / **unverified** | 0 / passed |
| highDegree treatment false | true | 37 | 37 | 3 / passed | 0 / passed |
| highDegree treatment false | false | 48 | 48 | unassessed | unassessed |
| postCompaction NONE | true | 37 | 37 | unassessed | unassessed |
| postCompaction NONE | false | 48 | 48 | unassessed | unassessed |

The caption edit adds one `x` to the existing edge-12 label. It keeps all 19 authored nodes, 44 occurrences and 11 edge captions. Nine-chain is the archived 9-node/23-occurrence cyclic source; Auth Flow is the existing regression source. Unneeded controls were not repeated for an intervention that already loses its primary comparison.

All completed public requests returned; `snapshotSample.ok` alone does not imply passed paint. The nine-chain declared-order receipt is explicitly **unverified**, with potential marker occlusion on both `n3→n6` occurrences and `n5→n6`, all by `node-shape:n6`. The public artifacts preserve those failures.

### Primary force-only causal result

The c18 forced cyclic19 model is exactly equal to the archived ordinal-10 input. Force-only changes the existing `forceNodeModelOrder` boolean; labels/boxes/ports, edge occurrences, child array, spacing and MODEL_ORDER breaker stay fixed. Both primary cells retain exactly `e12,e28,e30,e32,e35` as kernel feedbacks and the same ranks. The within-layer order changes at the source layer and the layer containing n7/n11.

| Cyclic19 public output | Forced | Unforced |
| --- | ---: | ---: |
| Crossings | 37 | 48 |
| Bends | 112 | 100 |
| Wire | 27,374.179 | 29,287.842 |
| Width | 1,473.00115 | 1,393.29951667 |
| Height | 1,602.229 | 1,620.329 |
| Area | 2,360,085.160 | 2,257,603.613 |
| Same-pair shared spans | 0 | 0 |
| Opposing shared spans | 0 | 0 |
| Native paint | passed | passed |

The unforced cell saves bends and area but adds eleven crossings, wire and height. It fails the Astra ordering stop condition and cannot pass balanced's no-worsening vector. Under the unchanged production policy, cyclic19's duplicates exclude the optional candidate before it is produced. This scratch matrix directly measures its completed geometry without removing that gate; it does not claim production selected or compared an optional producer.

Both primary SVGs contain 44 actual polyline edge elements, 44 attached end markers, eleven authored edge-caption metadata values and identical occurrence IDs, endpoint/direction/style/marker metadata. Node IDs/labels agree. Both paint receipts cover 116 measured primitives/supports, zero unmeasured, 31 prepared texts, 44 markers and no issues. Public quality counts the complete projected public polylines; a separate numerical recomputation from rounded SVG coordinates was not run. The full written SVGs are retained for that check.

The small edit repeats the crossing loss. Nine-chain geometry is identical under force-only; Auth Flow geometry is identical, its A→B→C→D→E→F→G→H x coordinates increase strictly, and C→B/F→E still end backward. These controls do not rescue the adverse primary result.

### Child-order and supported processor interactions

Declared node order changes the MODEL_ORDER feedback decisions, not only crossing minimization. On cyclic19 it makes seventeen kernel edges feedback while public route certificates still classify the original five. On nine-chain the kernel reverses thirteen while public certificates retain only edge 13 as feedback. These mismatches independently block promotion; no source-derived route consumer was reconciled in scratch. Both force settings also materially worsen crossings and nine-chain marker proof.

Disabling high-degree treatment has no measured effect on either primary force cell. Disabling post-compaction preserves the 37/48 crossing counts while worsening wire/area and bends: forced has 114 bends, 28,349.230 wire and 2,541,411.601 area; unforced has 107 bends, 31,026.118 wire and 2,456,148.794 area. Both primary variants pass paint and have zero same-pair/opposing shared-route overlaps. A combined block was not run because no isolated gain or causal interaction warranted it. Spacing changes were prepared but not executed.

## Original-JS reciprocal screen

`js-screen.mjs` runs the captured SDK model and actual peer model through original ELK.js 0.11.1 with only breaker and force changed. Pinned worker SHA256 is `c93ae799ceb15b94b19272307b5bfde46e7dde6f274a2fb78afeba2ac0393f77`. Every raw cell retains 19 nodes, 44 occurrences and eleven labels.

| Model | MODEL_ORDER / forced | MODEL_ORDER / unforced | DEPTH_FIRST / forced | DEPTH_FIRST / unforced |
| --- | ---: | ---: | ---: | ---: |
| Captured SDK | 37 | 48 | 50 | 58 |
| Actual peer | 57 | 41 | 43 | 31 |

These are **raw-only** counts. DFS changes the SDK model's physical upward box relations from five to fourteen and increases crossings in both force cells. Exact original-JS reversed flags were not traced; the retained upward relations are not presented as those flags. The peer's 31 requires its other interacting model differences. This result does not attribute that advantage to a single knob and provides no reason to port DFS or add a runtime fallback. No full public DFS candidate was run because both SDK raw cells already lose; its downstream geometry, paint and role-consumer agreement remain unassessed.

## Reproduction and retained failures

Pinned executable prefix:

```sh
export PATH=/workspace/pr449-runtime-recovery/node-v24.19.0-linux-x64/bin:/workspace/elk-layered-tools/bun-1.4.4/package/bin:$PATH
bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts forced
bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts unforced
bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts declared-forced
bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts declared-unforced
bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts highdegree-forced
ORDER_CASES=cyclic19,cyclic19-label-edit bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts highdegree-unforced
ORDER_CASES=cyclic19,cyclic19-label-edit bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts compaction-forced
ORDER_CASES=cyclic19,cyclic19-label-edit bun /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/run.ts compaction-unforced
node /workspace/elk-layered-tools/issue619-sol-experiments-20261121/order/js-screen.mjs
```

`FAILURES.md` records the initial Bun/V8 archive incompatibility, an internal-component trace/report failure, and the initial wrong summary-size field. Complete retained per-case summaries use actual `layout.bounds.w/h`; the original forced log retains the null size emitted by the first field projection. The per-case artifacts and corrected summaries are authoritative. No incomplete run was counted as a success.

CPU slots were released after each authorized bounded matrix. No further render/kernel/benchmark runs are pending.
