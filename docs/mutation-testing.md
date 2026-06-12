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

The JSON report lands in `reports/mutation/` (gitignored). This is not part
of CI: run it when you touch ASCII core logic, or when adding tests there and
you want proof they bite.

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
| route-contracts.ts | 58.1% → 71.5% → 72.3% across two survivor harvests | 352 → 438 | 254 → 168 |

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

**Killed by `route-contracts.test.ts` survivor harvests** (86 mutants across
two passes): RL/BT axis orientation (reciprocal-pair regressions in both
reversed directions), every `directLaneBlockers` blocker kind at its exact
±4px clearance boundary on both axes (non-square obstacles so a swapped
width/height changes the verdict), own-label lane capacity, the
same-edgeIndex self-exclusion, sub-epsilon polyline simplification, and the
hitch deviation rounding.

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

**Open test gaps** (highest-value first):
- `route-contracts.ts` `RECT_LIKE` membership ('service'/'subroutine'
  removals survive): no fixture straightens an edge between those shapes.
  One regression per shape would pin the whitelist.
- `route-contracts.ts` `findRouteHitches` staircase guard: no test feeds
  validation a post-certification mutation that is *not* a monotone
  staircase, so `if (false) continue` survives there.
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
