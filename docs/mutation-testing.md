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

# All four:
npx stryker run stryker.ascii.config.json
```

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

**Open test gaps** (highest-value first):
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
