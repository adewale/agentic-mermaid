# Shared reachability prototype — blocked draft

Historical owner screen. The [rebased packed public measurements](reachability-packed-2026-10-23.md) record the current 213,172-byte result, fixed-control confirmations and public analysis supplement. Figures below retain their original source/build attribution.

The invocation-local reachability prototype is **not selected for landing**. Its owner-level timing and allocation evidence supports further qualification, but the exact canonical build exceeds the unchanged Block lazy-browser Brotli budget: **213,108 bytes > 213,000 bytes**, an overrun of **108 bytes**. The budget is unchanged. This blocked draft stops before source compression tuning, packed public measurements or a full release replay.

This is a separate follow-up to [#468](https://github.com/adewale/agentic-mermaid/pull/468). Revisit it after [#433](https://github.com/adewale/agentic-mermaid/pull/433), then build and qualify the actual combined artifact. Independent PR ratios cannot be added, and #433's changes do not establish that this prototype will meet the budget.

## Change and identities

A single private helper owns directed-search scratch for `sourceAwareNodeOrder` in `src/layout-engine.ts` and `classifyRoutes` in `src/route-contracts.ts`. Each caller retains its own adjacency, admission rules, authored insertion order, property reads, duplicate handling, and missing/container endpoint behavior. Both the initial ready sort and neighbor sort remain. The helper lazily allocates a reusable stack and visited-generation map on the first query; it keeps no state between owner invocations and stores no transitive closure or graph-result cache.

The change removes duplicated search implementation and repeated temporary collection ownership. Repeated searches retain total worst-case work **O(E(V+E))** across edge queries; it is not incremental topological ordering or a shared end-to-end layout workspace.

The component comparison uses baseline `cd735107876616bff09b53d4c38bdfae1bec7984` and measured prototype `81a760613f833870aedb42efa59b34f97b9233a4`. The prototype was subsequently rebased onto #468's documentation-only reporting head `065233fd3b539539f0c5fd607fc868ec1f6336e4`, producing runtime commit `74c46ebf2daa461b2664232cf4208a2b57a7ad4a`. Git comparisons prove production, dependencies, build configuration, evaluation fixtures and runtime/package asset inputs unchanged from `81a76061`; only inherited backlog/archive reports differ. The canonical build receipt and cap failure remain bound to **81a76061**, not relabeled as a build of the rebased head. No packed artifact was frozen for this prototype.

## Qualification and owner measurements

The independent source oracle passes all **246 cases**. Its 240 generated flat graphs use independent Boolean closure and linear order expectations; nested conversion and mutable-accessor cases additionally retain explicitly labeled legacy differential checks. The seven-file affected-owner run passes **415 tests**, with **eight explicit source-only missing-dist skips**, and both core/repository typechecks and scoped lint pass. The two extended owner files also pass against unchanged baseline production: **352 tests**. These are refactor guards, not baseline-red feature tests. An initial missing-`bun` child PATH failure remains in the logs; the corrected-PATH run passes.

After the canonical build supplied dist, the existing determinism owner was rerun: **29 tests pass, zero skips or failures**, including the previously skipped eight Node/Bun layout, PNG and ASCII guards. Those checks use the actual 81a76061 build with production-identical rebased source. They do not replace the missing packed public performance qualification.

The frozen owner screen completes all nine serial phases: **40 successful cost workers**, **640 case rows**, **7,040 measured batch timings**, and **320 separate untimed Node allocation observations**. Four two-worker source/compiled oracle blocks preserve exact output fingerprints. Bun 1.4.2 executes source; Node 24.19.0 executes bundles of the actual owner imports. The primary ratio is the median of seven same-round candidate/baseline ratios, with three same-baseline A/A pairs per runtime.

| Owner case | Bun time ratio | Node time ratio | Node allocation ratio |
|---|---:|---:|---:|
| Branching feedback 50: classification | 0.6551 | 0.6635 | 0.9877 |
| Branching feedback 50: conversion | 0.7253 | 0.7976 | 1.0153 |
| Chain feedback 150: classification | 0.4868 | 0.5095 | 0.1898 |
| Chain feedback 150: conversion | 0.6513 | 0.6661 | 1.0562 |
| Chain feedback 400: classification | 0.5008 | 0.5371 | 0.2165 |
| Chain feedback 400: conversion | 0.6009 | 0.6454 | 0.4764 |

There are material adverse controls. **Bun zero-edge classification is 1.263974, slower in all seven pairs**, exceeding its preregistered adverse threshold and A/A absolute displacement of 0.0551. Its median paired increase is **9.714 ns per owner call**. Node's same control moves in the opposite direction, so no cross-runtime average is appropriate. Node sparse-eight classification is **1.127370**, slower in six pairs, with a paired increase of **0.1847 µs**; its A/A displacement of 0.1325 exceeds the median slowdown, leaving that timing concern unresolved. Several conversion A/A controls are broad.

Allocation is mixed: Branch-50 conversion is **1.015342, higher in all seven pairs**; Chain-50/150 conversion medians are **1.044982/1.056198**, with mixed directions. Chain-400 classification/conversion allocation is lower in all seven pairs, but candidate observations vary substantially. These are GC-boundary V8 estimates, not exact allocation, native/WASM memory, per-call peak, or a retained-memory guarantee.

Parsing is outside timing. Timed batches include whole owner calls and a cheap output-length sink; complete final-output fingerprints are checked outside the clock. Thus these results support owner-level attribution, **not public SVG/receipt speedups**. Actual packed public confirmation, unchanged payload caps and integration qualification remain outstanding.

## Evidence

External reproducibility records are under `/workspace/am-continuation/`: `reachability-owner-v3-analysis.{md,json}`, `reachability-independent-selection.md`, `reachability-cost-v3-preparation.json`, `reachability-cost-queue-v3/`, `reachability-owner-oracle-v3.json`, `reachability-source-qualification-v1/`, `reachability-final-build-v1.json`, `reachability-final-caps-v1.log`, and `reachability-rebase-proof-v1.json`. Frozen runners/configs, source/output hashes, actual process exits, raw observations and original failures are retained there. The next qualification must name its own combined source and artifact identities.
