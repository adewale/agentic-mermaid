# Mutation testing

The original ASCII Stryker lane is scoped to the five layout modules where a
silent logic regression is most expensive: `src/ascii/pathfinder.ts`,
`src/ascii/edge-routing.ts`, `src/ascii/converter.ts`, `src/ascii/grid.ts`,
`src/ascii/draw.ts`.
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
shared Architecture, XYChart, Mindmap, GitGraph, and Radar parser/layout/renderer
cores plus Radar's structured editing body, and `stryker.routes.config.json` /
`bun run mutation-test:routes` covers
the route-contracts module
(`docs/design/system/route-contracts.md`), all with the same policy.)

Narrow lanes for PR-scale survivor harvests:

```bash
bun run mutation-test:links            # text-embedded link-length parsing
bun run mutation-test:routes:certs     # route-certificate finality + stale-route audit
bun run mutation-test:routes:subgraph  # subgraph endpoint/LCA routing
bun run sabotage:routes                # one-line revert checks against committed HEAD; expects focused tests to fail
```

JSON reports land in `reports/mutation/` (gitignored). Stryker configs may be
static `.json` files or executable `.mjs` files. The route-certificate,
subgraph-routing, and link-grammar configs use `.mjs` so source-adjacent marker
pairs resolve their narrow mutation ranges at load time; inserting code above
the behavior cannot silently move those lanes onto unrelated lines.

Beyond the lanes documented here, configs exist for every built-in renderable
family through named package scripts: flowchart uses `mutation-test:routes`;
XYChart, Architecture, and Radar share `mutation-test:families`; State, Sequence,
Timeline, Class, ER, Journey, Pie, Quadrant, Gantt, Mindmap, and GitGraph each
have a focused command. These are **opt-in diagnostic survivor harvests**. They
emit scores and JSON reports, but have no `thresholds.break` and are neither
scheduled nor acceptance gates.

Two bounded checks run automatically on each PR:

- `mutation-test:incremental` mutates one small, pure module in about one minute
  and enforces its measured score.
- `sabotage:routes` injects five named one-line regressions and requires the
  focused behavioral tests to fail.

This distinction is deliberate. Mutation testing is useful when it challenges
a specific test or design assumption; family membership alone is not a reason
to enroll code in an expensive recurring sweep. A local mutation score without
a retained report is diagnostic evidence, not a repository acceptance claim.

## Why broad scheduled mutation was retired (2026-07-14)

The nightly workflow, its sharder, mutant-set oracle, aggregate verifier, and
orchestration tests were retired and deleted. The operational evidence did
not support maintaining them:

- all 26 scheduled runs from 19 June through 14 July failed or were cancelled;
- the workflow expanded from four route checks to every family while it was
  still unable to produce a successful retained run;
- the final repair grew to 39 coverage workers (41 jobs total), yet long lanes
  still timed out and hosted runners disappeared before producing reports; and
- rerunning unchanged mutation-relevant code consumed runner-hours without
  adding information.

The [last scheduled baseline](https://github.com/adewale/agentic-mermaid/actions/runs/29309167850),
[calibration diagnostic](https://github.com/adewale/agentic-mermaid/actions/runs/29327418603),
and [cancelled 41-job repair](https://github.com/adewale/agentic-mermaid/actions/runs/29340333016)
are retained as historical evidence, not as acceptance authority. The focused
configs, marker-based scopes, survivor classifications, incremental gate, and
sabotage probes remain because they are independently useful.

The causal record is in
[`project/archive/mutation-infrastructure-postmortem-2026-07.md`](./project/archive/mutation-infrastructure-postmortem-2026-07.md);
a deeper forensic companion — run-level CI evidence, the provenance of the
guidance that inspired the lanes, and the published research context — is in
[`project/archive/mutation-nightly-forensics-2026-07.md`](./project/archive/mutation-nightly-forensics-2026-07.md).
The durable stop rule is: after three consecutive scheduled failures, an owner
must fix, narrow, disable, or delete the diagnostic before adding scope. Any new
recurring lane also needs a demonstrated fault class, one complete retained
baseline, a runner-minute budget, an owner, and a removal criterion. No single
proxy—coverage, mutation score, assertion count, or matrix enrollment—is “the”
adequacy signal.

## Focused Mindmap/GitGraph historical local measurement (2026-07-10)

These figures came from local runs. Their JSON reports are gitignored and no
immutable CI artifact URL is committed, so they are diagnostic history—not a
PR acceptance gate or a current break floor.

| Lane | Mutants | Killed | Survived | Score |
|---|---:|---:|---:|---:|
| `bun run mutation-test:mindmap` (`src/agent/mindmap-body.ts`) | 405 | 400 | 5 | **98.77%** |
| `bun run mutation-test:gitgraph` (`src/agent/gitgraph-body.ts`) | 303 | 294 | 9 | **97.03%** |

The operation suites exercise every happy path, validation branch, source-order
rewrite, recursive/cycle guard, null-clearing path, and verification warning.
Mindmap's five survivors are two correlated node-syntax tuple guards plus
three exception-path mutations around the node/body stability probes (two
empty `catch` forms remain falsy; one `false`→`true` mutation is retained as a
non-gating test gap). GitGraph's nine
survivors are canonical serialization equivalents (trimming an already
canonical header, explicit `NORMAL`, and optional attribute whitespace),
merge-field guards implied by the discriminated model, or widened
statement-kind guards that serialize identically on valid replay state. Reports
are generated at `reports/mutation/{mindmap,gitgraph}-mutation.json`
(gitignored); the committed configs make the runs reproducible. The measured
scores above are not acceptance evidence: any separately owned acceptance claim
must cite retained CI artifacts or a content-addressed report.

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
| layout/passes/index.ts:931-1165 (linkrank packing repair) | 49.86% → 65.07% after the geometry-characterization harvest (355 mutants; killed 176 → 230+1 timeout). The +54 kills were the repair's candidate ORDERING / ahead-node selection / push-delta arithmetic — invisible to HARD-metric assertions (a mutant picking a different clear lane still yields zero violations), pinned instead by per-repro geometry snapshots in `linkrank-packing.test.ts` (layout determinism makes them stable). | 355 | 124 — see classification below |
| route-contracts.ts | 58.1% → 72.3% → 75.6% → 73.1% across the first three batches; 54.31% at 0b43c90, then 50.69% at 526d9cf after the slanted-family batch (shapePorts generalization, convex-polygon geometry: 2659 → 2740 mutants — absolute kills 1444 → 1381). The percentage fell on denominator growth (~3× since batch 3); residuals from that run are classified below. | 882 → 2740 | 50.69% (1381 killed) — historical snapshot |

(Numbers from the June 2026 runs; regenerate rather than trusting this
table — the report lands in `reports/mutation/`.)

## Historical survivor classification

This section explains the recorded run; it is not a secondary test backlog.
Only root `TODO.md` can schedule a new fixture or survivor-harvest package.

**linkrank lane residual (124 at the 65.07% run)**, classified:

- **Unexercised branch in the recorded corpus**: the subgraph-scoped
  `separationUnit` branch (walk the overlapped node's scope chain, push its
  outermost subgraph unit) did not fire because the degenerate repro set had no
  subgraphs. A subgraph + long-link shove-overlap fixture was not part of that run.
- **Unexercised defensive fallbacks**: the `rungSource` feedback family and some
  min-lane branches fire only on inputs the deterministic enumeration no longer
  produces (0 residual signatures); every adopted route is still runtime-validated by
  `routeClearOfNodes`, so a wrong fallback cannot ship a through-node route.
- **Equivalent on the real input domain**: exact-tie tiebreaks (`flowGap !== 0` id
  fallback), the `pairKey` separator literal (any injective separator), the defensive
  round cap (`nodes.length * 4` — forward-only motion terminates before it), and the
  candidate-list `slice(0, 16)` caps (lists are shorter in practice).

**Killed by `src/__tests__/ascii-pathfinder-units.test.ts`** (32 mutants):
`buildMoveDirs` preferred-direction ordering (it only decides ties between
equal-cost A* paths, which the golden corpus never isolates; the unit tests
pin `path[1]` per direction), `heuristic` corner-penalty logic, and
`mergePath` straight-run detection (backtracks and mixed-delta steps must
be preserved).

**Accepted — performance guards, not behavior** (pathfinder): the #66
bounded-search mutants (`next.x > boundX || next.y > boundY` weakenings,
`maxIterations` arithmetic). They change how much work an unreachable-target
search does before returning null, not what any reachable search returns.
Timing the search was judged less reliable than the risk warranted.

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
the duplicate-edge regression pins one unblocking round, while three chained
rounds were outside the recorded real-input corpus.

**Residual observations from that run** (not scheduled):
- `directLaneBlockers` label-rect axis ternaries retain a few survivors on
  rect width/height swaps for near-square pills; the corpus lacked a multi-line
  (taller than wide) label obstacle.
- `findLabelSlot`'s rect-overlap conjunction retains sign-variant survivors
  for rects that only graze on one axis; corner-touching fixtures were absent.
- The audit's pill-hit prefilter (`hitsPill`) retains inclusive-vs-strict
  comparison survivors for segments that exactly graze the pill border;
  they only widen the prefilter the collinearity check still gates.
- The container repair's reversed-order gaps (target above / left of source)
  were absent; the recorded classification relied on symmetry with the two
  covered directions.
- `grid.ts` `ensureSubgraphSpacing` (~48 survivors): the overlap/min-spacing
  resolution between root subgraphs is never triggered by the corpus —
  placement upstream appeared to avoid overlaps, so the run could not
  distinguish reachable behavior from defensive dead code.
- `converter.ts` entry/exit attachment roles and phantom still-used checks
  (`resolveSubgraphEdges` area): rendered-output invariants tolerate several
  mutants because other mechanisms compensate; the run asserted rendered text,
  not the intermediate resolved edge structure.
- `edge-routing.ts` label segment filter (`width >= lenLabel && index > 1 &&
  orientationMatches`): the labeled-fanout invariants pin the TD vertical-drop
  case; LR orientation and the index>1 exclusion lack direct coverage.

## Incremental per-PR lane (`stryker.incremental.config.json`)

A fast lane gates the small, pure faithfulness counter on every PR (the
`mutation-incremental` CI job), separate from the opt-in diagnostic configs. It
mutates `src/agent/structural-count.ts` (the counter + `faithfulnessWarning` +
`isDrop`), run by the sub-second `structural-count.test.ts` unit runner. A full
run is ~1 min, so it runs in full each PR.

The 2026-07-14 post-Radar run scored **97.01%** (130 killed / 134 valid; regenerate to
confirm, with the report in `reports/mutation/`), gated by
`thresholds.break: 90`. The retained floor deliberately remains below the
measured score; this result for one small pure module is not a repository policy
or a reason to expand mutation scope.

The survivor review found real valid-domain gaps rather than accepting a score:
the State counter needed both a doubly nested composite and concurrent-region
fixtures; ER needed a semantic-subgraph fixture and the public empty body with
its optional `groups` field absent; and `nodes = services + junctions` needed an
Architecture fixture containing a junction. These cases remain because they
pin real behavior, not because they improve a metric.

Four survivors are classified rather than killed with invalid inputs or by
weakening the code's forward-compatibility tripwire:

- two mutations to `case 'opaque': return null` are equivalent because the
  exhaustive default also returns `null`; and
- two mutations to the `default` branch are unreachable for the valid
  discriminated union. Its `const _never: never = body` assignment is retained
  so adding a family without a count remains a compile-time error.

### Why `verify.ts`'s faithfulness wrapper is NOT in the gated mutate set

Move 2 measured `roundtripFaithfulnessWarnings` (the I/O wrapper around the pure
`faithfulnessWarning`): **26.67% kill / 11 survivors**. The survivors are all on
the wrapper's defensive branches — `if (!reparsed.ok) …`, `if (!after) …`, and
the `catch` — which no *real* diagram exercises: a structured diagram's
serialization always re-parses, and re-parses structured (not opaque), and never
throws. Those branches are therefore unkillable through real `verifyMermaid`
inputs without a synthetic drop, and the *decision logic* they guard already
lives in `faithfulnessWarning`, which the incremental lane currently measures
at 97.01%. Adding the wrapper to the gated `mutate` would crater the score to
~27% and force either
a meaningless break threshold or a pile of accepted survivors. So the wrapper
stays out of the gated set and is recorded here as I/O-glue equivalents; its
logic is covered where it actually lives, where the current measured score is
97.01%.
