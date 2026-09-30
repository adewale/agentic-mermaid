# Palette performance evidence

This directory separates two different claims:

- `src/__tests__/perceptual-palette-impact.test.ts` is the portable CI gate. It verifies deterministic work-count invariants from the real implementation: the `>24` path is engaged, performs no pairwise distance checks, and stays under a linear candidate-evaluation ceiling.
- `bun run eval/palette-performance/run.ts --record` records warmed wall-clock observations for the built-in-theme × counts 7–24 matrix. The report includes the runtime, OS, architecture, CPU, protocol, recording commit, distributions, claim/warrant/backing/rebuttal, and explicit limitations.

Record only from a clean committed worktree. The recorder refuses dirty inputs. After recording, inspect `report.json` (gitignored, not committed); its `sourceCommit` is informational.

The timing numbers describe one palette-generation call on the recorded environment, not a full render or a cross-machine guarantee. Most controlled families compute one peer-category channel per output render. Journey computes two independent channels: sections and actors.

This follows the testing-best-practices guidance to keep performance measurements separate from correctness tests, compare evidence with precise provenance, avoid wall-clock CI thresholds, assert that the optimized path actually engaged, and state what a result cannot prove.
