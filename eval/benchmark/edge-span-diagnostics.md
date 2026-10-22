# Private edge-span diagnostics

Run with Bun from a source checkout and an empty external output directory:

```sh
bun test eval/benchmark/edge-span-diagnostics.test.ts
bun run eval/benchmark/edge-span-diagnostics.ts /tmp/private-edge-span-run
```

This evaluator builds plain and instrumented source bundles without editing production source. Exact anchored transforms fail closed on source drift. The output contains original/transformed source, unified patches and hashes, both bundle hashes, harness/test hashes, a canonical input manifest and every success/failure trace. Neither bundle is a published renderer artifact.

The mandatory population includes the six cyclic allocation regressions, every source Architecture case, Architecture fixtures/workloads, and controlled node/label/minSpan stress cases. It retains deliberate endpoint/rank-limit declines. Every outcome (complete SVG plus receipt, raw geometry or error) is fingerprinted against the plain source build. Counter algebra is checked for each completed normalization, including optional candidates and nested scopes.

`physicalPrivateVertices` counts all completed normalization work, including rejected candidate layouts. `maxPrivateVertices` describes the largest single candidate. `selected-measured-geometry` events describe separate producer candidates and must not be summed as authored subjects or assumed to identify the final certified winner. Authored subjects, measured graphs, loop helpers, scoped representatives and physical computations are distinct.

A rank span is `rank[target] - rank[source]`; private vertices total `sum(span - 1)`, expanded vertices total `measuredNodes + privateVertices`, and expanded arcs total `sum(span)`. Forest/shared-fan paths have explicit fast-path events and no fabricated rank values. Phase snapshots retain the existing remaining work budgets. Inclusive work deltas include recursive children; exclusive summaries subtract only identical shared budget objects using evaluator-local identity tags.

Times and heap snapshots are advisory. Source instrumentation itself allocates memory, GC can make a heap delta negative, and concurrent activity can change scheduling. These are neither allocated-byte totals nor instantaneous peak measurements, and cannot be compared with ELK/package benchmark timings. Use independent frozen artifact campaigns for qualification and sampled allocation profiles for attribution. The diagnostic runner changes no work limit and makes no sparse-normalization or performance improvement claim.
