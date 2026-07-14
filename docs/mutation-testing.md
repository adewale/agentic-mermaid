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
shared Architecture, XYChart, Mindmap, and GitGraph parser/layout/renderer
cores, and `stryker.routes.config.json` / `bun run mutation-test:routes` covers
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
static `.json` files or executable `.mjs` files. The route-certificate and
subgraph-routing configs use `.mjs` so source-adjacent marker pairs resolve
their narrow mutation ranges at load time; inserting code above the behavior
cannot silently move those lanes onto unrelated lines.

Beyond the lanes documented here, the configs cover every built-in renderable
family through a named package script: flowchart uses the route lane; XYChart
and Architecture share `mutation-test:families`; State, Sequence, Timeline,
Class, ER, Journey, Pie, Quadrant, Gantt, Mindmap, and GitGraph each have a
focused command. The Mindmap/GitGraph focused lanes mutate typed editing/replay
bodies; the broad family lane mutates their parser/layout/renderer cores.

`.github/workflows/nightly-route-mutation.yml` schedules those lanes, the two
narrow route lanes, and `sabotage:routes` nightly and through manual
`workflow_dispatch`. `scripts/quality/nightly-mutation.ts` is the single
schedule authority. It partitions large whole-file targets only between
complete top-level TypeScript statements. The checked
`scripts/quality/mutation-shard-oracle.mjs` instruments the full targets and
their shards and requires the mutant multisets to match exactly, preventing a
range boundary from silently omitting or duplicating a spanning AST mutant.

Each shard temporarily runs with `thresholds.break: 0` only so it can emit its
partial JSON report. The final verifier validates the reports, recombines every
shard for its lane, and applies the original config's single aggregate
`thresholds.break` floor. That per-lane floor is a measured regression ratchet;
60% is the improvement target, not a baseline assumed for every lane. Raise a
floor when retained evidence supports it rather than assigning an unmeasured
lane the target. The verifier prints both the precise aggregate score and a
candidate floor calculated downwards from the integer detected/valid counts;
use that candidate rather than rounding the displayed score. Never lower a
calibrated floor automatically: a deliberate reduction needs retained evidence
and a reviewed explanation. Reports have unique names and are uploaded as workflow
artifacts for three days: enough for aggregation and normal failed-job reruns
without retaining roughly 90 daily copies. Before upload, repeated full test
output is removed from killed mutants; status, location, replacement, and
`killedBy` identity remain, while timeout/error diagnostics are preserved.
After the retention window, rerun the whole workflow rather than only failed
jobs. Broad mutation runs remain outside the PR gate; run a narrow lane locally
when you touch ASCII/route core logic and want immediate proof the tests bite.

## Retained nightly calibration diagnostic (2026-07-14)

[GitHub Actions run 29327418603](https://github.com/adewale/agentic-mermaid/actions/runs/29327418603)
at commit `8a7c8e44a06ca5c28bc5c5fc369c519af3a68d21` is the retained
diagnostic used to replace placeholder and historically assumed floors with
measured floors. The candidate is the aggregate score truncated down to two
decimal places, never the rounded display value.

| Complete lane | Detected | Valid | Precise score | Candidate floor |
|---|---:|---:|---:|---:|
| Routes | 1,804 | 5,443 | 33.1435% | 33.14% |
| Route certificates | 63 | 91 | 69.2308% | 69.23% |
| Subgraph routing | 57 | 66 | 86.3636% | 86.36% |
| Timeline | 574 | 984 | 58.3333% | 58.33% |
| Class | 620 | 2,358 | 26.2935% | 26.29% |
| ER | 570 | 1,893 | 30.1109% | 30.11% |
| Journey | 1,417 | 2,012 | 70.4274% | 70.42% |
| Pie | 358 | 748 | 47.8610% | 47.86% |
| Gantt | 2,229 | 3,724 | 59.8550% | 59.85% |
| Mindmap | 401 | 405 | 99.0123% | 99.01% |
| GitGraph | 294 | 303 | 97.0297% | 97.02% |

This was intentionally a diagnostic run, not a passing acceptance run. The old
90-minute jobs reproduced timeouts for State, Sequence, and Quadrant, while one
broad-family shard received GitHub's runner-shutdown signal before it could
write a report. The aggregate verifier rejected all four incomplete lanes and
reported their exact missing-mutant counts; no partial score was accepted or
used for calibration. The revised schedule splits State, Sequence, and
Quadrant into three shards each, rebalances Gantt across five shards, and
rebalances the broad-family lane across nine shards. The next complete run
calibrates the four omitted lanes and proves every measured floor together.

Some one-time corrections above lower an inherited, unmeasured floor that the
diagnostic proved false. That is evidence-backed baseline repair, not automatic
threshold decay. Once a lane has a complete retained calibration, its floor is
a ratchet and may be lowered only through a reviewed change citing new retained
evidence.

## Focused Mindmap/GitGraph historical local measurement (2026-07-10)

These figures came from local runs. Their JSON reports are gitignored and no
immutable CI artifact URL is committed, so they are diagnostic history—not a
PR acceptance gate. The retained nightly calibration above supersedes these
local figures as acceptance evidence and now enforces the measured 97–99%
floors.

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
statement-kind guards that serialize identically on valid replay state. Reports are generated at
`reports/mutation/{mindmap,gitgraph}-mutation.json` (gitignored); the committed
configs and nightly lanes make the runs reproducible. The measured scores above
are not acceptance evidence: any separately owned acceptance claim must cite
retained CI artifacts or a content-addressed report, never infer a score from a
configured break floor.

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
`mutation-incremental` CI job), separate from the broad nightly lanes. It
mutates `src/agent/structural-count.ts` (the counter + `faithfulnessWarning` +
`isDrop`), run by the sub-second `structural-count.test.ts` unit runner. A full
run is ~1 min, so it runs in full each PR.

Score is ~96% (regenerate to confirm; the report lands in `reports/mutation/`),
gated by `thresholds.break: 90`. The few survivors are all equivalent mutants,
accepted not chased:

- `structural-count.ts:96` (`case 'opaque': return null`) — two mutants
  (the case label + its string). Equivalent: an opaque body returns `null`, and
  the `default` branch *also* returns `null`, so mutating the `opaque` case
  cannot change the result for any input.
- `structural-count.ts:98` (`default:` exhaustiveness branch) — two mutants
  (the branch condition + its block). Unreachable by construction: all registered
  families are handled explicitly and the `const _never: never = body` assigns
  compile-time exhaustiveness, so the branch never executes at runtime.

What earlier survivors taught us (now killed, kept as regression fixtures): the
recursive `edges += inner.edges` state accumulation needed a *doubly-nested*
composite-state fixture, and `nodes = services + junctions` needed an
architecture fixture that actually contains a junction.

### Why `verify.ts`'s faithfulness wrapper is NOT in the gated mutate set

Move 2 measured `roundtripFaithfulnessWarnings` (the I/O wrapper around the pure
`faithfulnessWarning`): **26.67% kill / 11 survivors**. The survivors are all on
the wrapper's defensive branches — `if (!reparsed.ok) …`, `if (!after) …`, and
the `catch` — which no *real* diagram exercises: a structured diagram's
serialization always re-parses, and re-parses structured (not opaque), and never
throws. Those branches are therefore unkillable through real `verifyMermaid`
inputs without a synthetic drop, and the *decision logic* they guard already
lives in `faithfulnessWarning`, which the incremental lane gates at 96%+. Adding
the wrapper to the gated `mutate` would crater the score to ~27% and force either
a meaningless break threshold or a pile of accepted survivors. So the wrapper
stays out of the gated set and is recorded here as I/O-glue equivalents; its
logic is covered where it actually lives.
