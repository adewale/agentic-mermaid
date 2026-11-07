# Lazy delivery causal profile — 7 November 2026

Measured renderer/build source: bbda2112af8d791d8628a3769c86084e4cb962b3.
Current pushed head: c9dabb20c67aa18587063ea0268fa4e5ebdf7c40.
Main: 39a500425f6b74eb486b9add9e90d538fab6a914.
Only the work log differs between measured and current source. No runtime implementation, dependency, cap, ceiling, backend or version change was made in this cycle.

The existing reporter measures actual complete emitted request closures, gzip level9 and Brotli quality11:

| Closure | Main gzip | PR gzip | Delta |
| --- | ---: | ---: | ---: |
| Initial |5919|5854|−65|
| Packet + complete YAML |196160|230648|+34488|
| Flowchart selected ELK + YAML |734953|774077|+39124|
| ER selected ELK + YAML |693457|734901|+41444|
| Requirement selected ELK + YAML |631964|666689|+34725|

Packet budgeted requests fall22→13. Fewer requests do not establish less consumed transfer. YAML remains roughly31533B and selected ELK428724B gzip in both; initial transfer saving does not explain the added common code. Local recovered-topology figures stay separate from actual CI products. The PR's Packet gzip ceiling remains192500; main's own ceiling is210250. No ceiling was changed in this cycle.

The five largest positive source contributions at the esbuild stage, BEFORE SWC, are paint-certification +33674B, emission-context +14557B, serialization +14341B, native-paint-emission +13249B and svg-writer +12655B. These are diagnostic module bytes, not additive compressed attribution, self/inclusive CPU samples or predicted speedups. The dated CPU report remains historical.

Smallest causal probe: concatenate the same static Packet closure with newline separators and gzip using the exact reporter implementation, Bun1.4.4 node:zlib level9. Main21files/164917B; PR12files/199406B. PR concatenation196990B saves2416B, still32073 above actual main. Stop this particular fragmentation shortcut as sufficient for this demonstrated gap. This is compression-only data, not executable ESM and not a mathematical bound on all possible future bundling rewrites. Module identity and side effects would require separate qualification for a real implementation.

A first Python gzip9 probe produced different absolute compressed bytes; it is retained as predecessor evidence. Independent review caught the implementation mismatch. fragmentation-bun.json exactly matches the existing transfer JSON static totals. The original work-log commit aae654e5b is preserved; the ordinary follow-up c9dabb20c uses the matching Bun figures.

Independent boundary review found no defensible substantive subtraction. Receipts, strict refusals, viewport repair and actual-write custody consume the added machinery. Source-only input still reaches styled backends and internal Scene fallback. Terminal modules total4969B raw versus4911B on main, only58B growth; removing them crosses constructors, deferred admission and path/mid-marker validation. No broad rewrite was justified and no rendering checks were removed.

Reproduction in each checkout, with the shared dependency overlay:
    node node_modules/tsup/dist/cli-default.js --config tsup.browser-lazy.config.ts
Then use the PR's existing scripts/build/browser-lazy-report.ts --measure-only --json, with --root for main. Original and normalized metafiles are both retained. Only the recovered ELK input label ../pr449-tools-20261106/elkjs-0.11.1/ is relabelled node_modules/elkjs/ in a COPY; emitted products and import edges are unchanged. The original reporter errors are retained. Bun/tsup startup failed; Node24 tsup builds and declarations succeeded. These are not execution speed comparisons.

The unchanged owning lazy-budget gate still fails and is retained. Source diff check passes; no runtime tests were repeated as new progress for this documentation-only result. CI for new head is tracked separately and remains unqualified until completion. Earlier bbda CI42324034140 completed failed: standalone budget/browser passed, Sparse32, lazy/demo/editor payload and advisory failures remained.

Restore evidence.tar.gz into an empty scratch directory; its profile/ files retain probes/logs/reports and main/dist/ + pr/dist/ retain actual emitted modules. checkpoint.json records byte counts and every-member verification. Archived leases are historical and cannot authorize a writer. Source and evidence branches are preserved without rebase or force push. Replacement24 remains sealed; original baseline/Trident/pinned Mermaid12.2/Pele1.9 remain unavailable.

