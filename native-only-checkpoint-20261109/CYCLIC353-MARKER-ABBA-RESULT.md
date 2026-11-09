# Native cyclic353: actual marker-path before/after

Exact existing public regression fixture:10nodes,23edges, mixed node shapes, cycles and parallel arrows. Original and one authored label edit. Four fresh Node24 source processes in serial ABBA order; root tests/builds paused. Layout cache disabled, sampling and timed observers disabled. Every completed call consumes fullSVG and serializes the entire receipt. Before uses9recorded source overrides at cb4204a50; candidate uses current production marker-context integration. Source import, explicitGC, artifact compression/writes are outside render timers. Existing derived caches remain.

| Phase | Before ms (2replicas) | After ms (2replicas) |
|---|---:|---:|
| cold-render | 402.73, 395.52 | 385.49, 616.32 |
| repeat1 | 163.32, 176.46 | 169.56, 430.73 |
| repeat2 | 124.95, 136.13 | 135.85, 147.96 |
| edit | 169.10, 198.68 | 170.66, 164.24 |

All16enrolled fullproduct calls returned with passed receipts. Every original/edit SVG and complete receipt is byte-exact across arms and process replicas: **True** (32file comparisons). This preserves the recorded meaning/layout/proof outputs; it does not substitute for independent finalink inspection.

The separate path-count diagnostic proves the public Native fixture executes the optimization:5complete calls including one untimed audit produce15contexts,90peer queries and15prepared snapshots. Unlike the100-node fans, this is a demonstrated production peer-query path.

These two replicas per arm are bounded observations, not throughput/p95/general performance evidence. Preserve adverse cold/warm/edit and memory effects below. This input has10nodes; any call under100ms does not establish100nodes under100ms.

| Cost observation | Before | After |
|---|---:|---:|
| cold-render: postphase heap MiB | 57.69, 57.88 | 56.50, 53.15 |
| cold-render: peak process RSS MiB | 210.43, 211.21 | 204.48, 194.38 |
| repeat1: postphase heap MiB | 64.34, 64.84 | 63.73, 65.28 |
| repeat1: peak process RSS MiB | 219.80, 221.58 | 205.03, 199.64 |
| repeat2: postphase heap MiB | 58.83, 58.98 | 59.03, 58.75 |
| repeat2: peak process RSS MiB | 221.55, 223.46 | 206.90, 199.64 |
| edit: postphase heap MiB | 41.56, 41.23 | 68.41, 40.99 |
| edit: peak process RSS MiB | 228.05, 229.71 | 211.15, 199.64 |

Heap/RSS include the source loader, runtime/JIT, retained warmup SVG/receipt and artifact lifetime; postphase heaps contain garbage. No leak or memory-saving ratio claim. This paired public observation is separate from the much larger isolated96-edge marker-helper benefit.

Raw jobs,9baseline overrides, fullproducts, perphase rows, memory and process chronology retained. No production edits or git operations by profiler.
