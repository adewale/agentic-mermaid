# Mutation testing (ASCII layout core)

Stryker mutation testing is scoped to the four ASCII layout modules where a
silent logic regression is most expensive: `src/ascii/pathfinder.ts`,
`src/ascii/edge-routing.ts`, `src/ascii/converter.ts`, `src/ascii/grid.ts`.
The config is `stryker.ascii.config.json`; its command runner executes the
ASCII test files (goldens, invariants, properties, unit tests) per mutant.

## Running

```bash
# One module (preferred — a full module takes 5–15 minutes):
npx stryker run stryker.ascii.config.json --mutate 'src/ascii/pathfinder.ts'

# All five (also available as `bun run mutation-test:ascii`):
npx stryker run stryker.ascii.config.json
```

(`stryker.families.config.json` / `bun run mutation-test:families` covers the
agent family parsers, and `stryker.routes.config.json` / `bun run
mutation-test:routes` covers the route-contracts module
(`docs/design/route-contracts.md`), all with the same policy.)

Narrow lanes for PR-scale survivor harvests:

```bash
bun run mutation-test:links            # text-embedded link-length parsing
bun run mutation-test:routes:certs     # route-certificate finality + stale-route audit
bun run mutation-test:routes:subgraph  # subgraph endpoint/LCA routing
bun run sabotage:routes                # one-line revert checks against committed HEAD; expects focused tests to fail
```

The JSON report lands in `reports/mutation/` (gitignored). Broad route lanes
are intentionally not part of the PR gate, but `.github/workflows/nightly-route-mutation.yml`
runs `mutation-test:routes`, `mutation-test:routes:certs`,
`mutation-test:routes:subgraph`, and `sabotage:routes` nightly and on manual
`workflow_dispatch`, uploading reports as artifacts. Run the narrow lane locally
when you touch ASCII/route core logic and want immediate proof the tests bite.

## Policy

A SURVIVED mutant is a test gap until shown otherwise. Either kill it with a
test (and sabotage-verify the test), or classify it below with a reason.
Don't chase 100%: performance-guard and unreachable-branch mutants are
documented, not killed with synthetic inputs.

## Baseline (June 2026, first scoped run)

| File | Score | Killed+timeout | Survived |
| --- | --- | --- | --- |
| pathfinder.ts | 60.3% → 70.8% after `ascii-pathfinder-units.test.ts` | 184 → 216 | 121 → 89 |
| edge-routing.ts | 55.1% | 163 | 133 |
| converter.ts | 38.4% | 94 | 151 |
| grid.ts | 70.1% | 421 | 180 |
| route-contracts.ts | 58.1% → 72.3% → 75.6% → 73.1% across the first three batches; 54.31% at 0b43c90, then 50.69% at 526d9cf after the slanted-family batch (shapePorts generalization, convex-polygon geometry: 2659 → 2740 mutants — absolute kills 1444 → 1381). The percentage fell purely on denominator growth (~3× since batch 3); a survivor-harvest batch is the documented next quality step. | 882 → 2740 | 50.69% (1381 killed) — survivor harvest pending |

(Numbers from the June 2026 runs; regenerate rather than trusting this
table — the report lands in `reports/mutation/`.)

## Survivor classification

**Killed by `src/__tests__/ascii-pathfinder-units.test.ts`** (32 mutants):
`buildMoveDirs` preferred-direction ordering (it only decides ties between
equal-cost A* paths, which the golden corpus never isolates; the unit tests
pin `path[1]` per direction), `heuristic` corner-penalty logic, and
`mergePath` straight-run detection (backtracks and mixed-delta steps must
be preserved).

**Accepted — performance guards, not behavior** (pathfinder): the #66
bounded-search mutants (`next.x > boundX || next.y > boundY` weakenings,
`maxIterations` arithmetic). They change how much work an unreachable-target
search does before returning null, not what any reachable search returns. A
test would need to time the search, which is flakier than the risk warrants.

**Accepted — unreachable via convention** (pathfinder): the `dy`-dominant
fallback in `buildMoveDirs` (lines ~157–159). All nine 3×3 `Direction`
constants either match an explicit cardinal branch or have `|dx| >= |dy|`,
so the branch only runs for synthetic Direction values. Candidate for
simplification, not for synthetic-input tests.

**Found dead code**: the first mutation run showed the audit-suggested sort
tie-breaks on the two `b.index - a.index` comparators in
`determineLabelLine` could never fire — segment `index` is unique by
construction — so they were reverted. Only the width-sort tie-break (where
ties are real) remains. Mutation testing earning its keep: it falsified an
audit assumption the test suite couldn't.

**Killed by `route-contracts.test.ts` survivor harvests** (170 mutants
across five passes): RL/BT axis orientation (reciprocal-pair regressions in
both reversed directions), every `directLaneBlockers` blocker kind at its
exact ±4px clearance boundary on both axes (non-square obstacles so a
swapped width/height changes the verdict), own-label lane capacity in
rendered-pill units, the same-edgeIndex self-exclusion, sub-epsilon
polyline simplification, the hitch deviation rounding, `findLabelSlot`
stagger and pill-boundary arithmetic, the primary-over-feedback exemption
asymmetry, the feedback path of `findRouteHitches`, shared-trunk detection
on both axes at its collinearity/pill-extent boundaries, the ±2px line
between the stale and shape-misanchor tripwires, container perimeter
tolerance, and the container repair's horizontal-gap axis selection.

**Accepted — equivalent on the real input domain** (route-contracts): the
collinearity cross-product variants in `simplifyPolyline` behave identically
for the orthogonal polylines ELK produces (several algebraic rearrangements
preserve the zero/non-zero verdict for axis-aligned triples), and the
`isMonotoneStaircase` diagonal/backward guards are defensive against passes
that do not currently exist — real extracted routes are orthogonal and the
backward case is already excluded by feedback classification upstream.

**Accepted — performance guards** (route-contracts): the `seen`-set and
stack mechanics inside `classifyRoutes`' DFS change traversal cost, not
reachability verdicts, on the small graphs flowcharts produce.

**Accepted — bounded-iteration guard** (route-contracts): the fixed-point
loop's `round < 4` weakenings only change how many re-prove rounds run;
the duplicate-edge regression pins one unblocking round, and constructing
a graph that needs three chained rounds would be a synthetic-input test.

**Open test gaps** (highest-value first):
- `directLaneBlockers` label-rect axis ternaries retain a few survivors on
  rect width/height swaps for near-square pills; a multi-line (taller than
  wide) label obstacle fixture would discriminate them.
- `findLabelSlot`'s rect-overlap conjunction retains sign-variant survivors
  for rects that only graze on one axis; corner-touching fixtures would
  pin them.
- The audit's pill-hit prefilter (`hitsPill`) retains inclusive-vs-strict
  comparison survivors for segments that exactly graze the pill border;
  they only widen the prefilter the collinearity check still gates.
- The container repair's reversed-order gaps (target above / left of
  source) lack fixtures; the gap arithmetic is symmetric with the two
  covered directions.
- `grid.ts` `ensureSubgraphSpacing` (~48 survivors): the overlap/min-spacing
  resolution between root subgraphs is never triggered by the corpus —
  placement upstream appears to avoid overlaps already. Needs either a
  corpus sample that genuinely overlaps or a dead-code verdict.
- `converter.ts` entry/exit attachment roles and phantom still-used checks
  (`resolveSubgraphEdges` area): rendered-output invariants tolerate several
  mutants because other mechanisms compensate. Needs assertions on the
  resolved edge structure, not just the rendered text.
- `edge-routing.ts` label segment filter (`width >= lenLabel && index > 1 &&
  orientationMatches`): the labeled-fanout invariants pin the TD vertical-drop
  case; LR orientation and the index>1 exclusion lack direct coverage.
