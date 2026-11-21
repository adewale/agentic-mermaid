# Long-edge expansion: unchanged-kernel diagnosis

Source: `6d8d7fbc835b2767b83a3bbdfca5e7b7d9f8e19b`. Its pure kernel is byte-identical to baseline `32b025bff14e3020fd709a08d84f8543f57cb0cd`. No production optimization was made for this diagnosis. [Ownership review](../astra-long-edges/REVIEW.md).

The feedback identifies real expanded work. On a 96-node chain with one extra forward edge at each fitting source, the splitter creates exactly **94, 616 and 1,656** ordinary dummies at spans2/8/24. After splitting there are190/712/1,752 nodes and283/799/1,823 edges. These records survive crossing minimization and placement until joining. No hyperedge merge contracts them in these cases. Maximum layer width is2/8/24. Every copied edge-options map is empty; copying entries is not this workload's cost, although map objects are allocated.

## Unmodified shipped kernel

| Span | Authored edges | Dummy count | Median of9 kernel calls | First call | Median subsequent8 | Peak whole-process RSS |
|---|---:|---:|---:|---:|---:|---:|
|2|189|94|30.85ms|87.80ms|26.13ms|141.45MiB|
|8|183|616|54.66ms|149.00ms|46.56ms|153.96MiB|
|24|167|1,656|154.27ms|172.91ms|119.08ms|244.59MiB|

Each row is one fresh Node24.19.0 process, nine layouts of cloned graphs with40×30 boxes, RIGHT direction and randomSeed1. Input cloning is outside the clock; kernel and complete-output-JSON times are separately retained. No explicit GC was requested. Whole-process RSS includes runtime, module and serializer. This is a diagnostic, not a calibrated speedup estimate or an end-to-end AM comparison. The feedback used Node24.22.1 with unspecified dimensions/options; its timings are not interchangeable with these rows.

The shipped output and private instrumented source output deep-equal the pinned elkjs0.11.1 oracle for all three inputs using the existing comparison policy: exclude only output-added numeric GWT `$H`; preserve authored fields, numbers and array order. All18 timing/profile hashes per case match the qualified JSON. Raw inputs, oracle returns, qualification failures/recovery and exact hashes remain in this directory.

## CPU and allocation sampling

Separate private builds instrument existing phase boundaries. Nine layouts per process use inspector CPU sampling and allocation sampling at8192bytes with collected minor/major objects included. Timing of these instrumented processes is not used for the table. Observers are separated in stack attribution; GC remains unattributed to a producing phase. These are sampled allocations across nine layouts, **not retained heap or RSS**, and allocation stack estimates are noisy.

| Span | Split CPU | Crossing CPU | Placement CPU | Routing CPU | GC CPU | Split allocations | Crossing allocations |
|---|---:|---:|---:|---:|---:|---:|---:|
|2|0.7%|44.2%|4.8%|4.6%|10.4%|3.52MiB|194.63MiB|
|8|1.9%|46.5%|8.1%|4.2%|14.1%|20.08MiB|349.53MiB|
|24|2.4%|50.5%|7.3%|4.0%|15.1%|52.33MiB|655.18MiB|

In span24, `calculatePortRanks` and `initPositions` account for approximately160.1 and146.0MiB of sampled allocations at their own stack frames. Their source repeatedly filters port arrays, reverses filtered side lists, and constructs counter state while sweeps visit expanded ranks. Other allocations and CPU remain in setup, routing, placement, observers and the harness; see [complete attribution](summary.json). Sampling does not prove the benefit of removing any particular allocation.

## Recommended implementation order

1. Prototype removal of temporary filtered/reversed arrays in `BarycenterPortDistributor.calculatePortRanks` and `CrossingsCounter.initPositions`, preserving the exact port order, counts, arithmetic operations and random consumption. Targeted array elimination addresses a measured larger allocator than splitting. Verify output parity before timing an uninstrumented candidate; do not introduce cross-layout caches.
2. Independently test sharing normalized ordinary continuation options. Retain private copies at inverted-port and compound writes. Prefer a readonly internal view with explicit copy-before-write boundaries; never share mutable geometry, labels, adjacency or junctions. The source constructs27 explicit objects/collections per split, but this experiment removes only part of that cost.
3. Evaluate a compact/sparse segment representation separately if expanded sweep work still dominates. Preserve rank-by-rank append and target incoming order. Existing phases depend on adjacent-rank occurrences, dummy identity, per-occurrence labels and random draws. A traversal shortcut can change coordinates without breaking connectivity.

Eiglsperger, Siebenhaller and Kaufmann's [2005 JGAA paper](https://doi.org/10.7155/jgaa.00111) keeps the transformed graph linear in input size through sparse normalization and adapted ordering/compaction. Its crossing bound supports a separate algorithmic experiment; it does not establish equality with ELK's current coordinates. The present measurements favor exact-output allocation changes before that larger replacement.

Reproduce with the retained `prepare.ts`, `worker.mjs`, `run.py` and `analyze.py`, using the recorded pinned runtime and source checkout. The private build and absolute paths are diagnostic tools, not a new production framework or CI gate. `summary.json` retains counters, hashes, heap samples and full sampled attribution.
