# C4 cache/planner owner correction

Main commit 65a05ede intentionally changed C4's allocator callback into cloneable occupied-Set/assigned-Map state and made the source-derived C4 cache key fit. The previous 9109d437 owner protected fresh uncloneable callbacks. Exact c037 CI and local reproduction fail its stale callback-type assertion; no runtime corruption is demonstrated.

The same owner now covers cache 0/cache 1 using the established Bun child harness. All existing style, labels, endpoint, JSON/mutable Scene and late producer-replacement checks remain. The owner exercises actual authored reservation, semantic-key idempotence and distinct-key allocation, then poisons exposed planner maps and geometry and requires fresh complete Scene/SVG equality. Fresh exposure retains identity and permanently relinquishes original-producer custody; cached exposure requires independent generated-state collections. The poisoned customer/surface key is one the real renderer uses.

An audit-only preload deliberately shares the cached planner state: the new cache 1 guard fails on the occupied Set. Production source is untouched by that negative probe. Eight checks against the existing built SDK under pinned Node24.19 pass public Scene/layout mutation isolation, complete products and literal SVG ID uniqueness. These built checks do not claim the private source-custody assertions were run under Node.

The broad affected run has 130 passes and one reader-extension timeout under Bun's default 5000ms. That unchanged reader case passes with the repository canonical 30000ms timeout; the failed run remains. This is 131 distinct affected owners across three files using the successful initial observations plus the targeted canonical rerun. Canonical core/repo types terminal 0; one-file lint passes.

Two attempts to expand the complete source harness to raw Node fail before behavior observation on parameter-property then JSON import syntax. Both setup logs remain; no loader/dependency/framework or experimental flag is retained in the owning test. Runtime source and all frozen build/cost artifacts are unchanged. Parent owns the test-only commit and exact-head CI.
