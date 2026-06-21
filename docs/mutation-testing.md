# Mutation testing (ASCII layout core)

Stryker mutation testing is scoped to the five ASCII layout modules where a
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
agent family parsers, and `stryker.routes.config.json` / `bun run
mutation-test:routes` covers the route-contracts module
(`docs/design/system/route-contracts.md`), all with the same policy.)

Narrow lanes for PR-scale survivor harvests:

```bash
bun run mutation-test:links            # text-embedded link-length parsing
bun run mutation-test:routes:certs     # route-certificate finality + stale-route audit
bun run mutation-test:routes:subgraph  # subgraph endpoint/LCA routing
bun run sabotage:routes                # one-line revert checks against committed HEAD; expects focused tests to fail
```

The JSON report lands in `reports/mutation/` (gitignored). Beyond the lanes
documented here, `stryker.*.config.json` also covers the per-family parsers
(state/sequence/timeline/class/er/journey/pie/quadrant/gantt via
`mutation-test:families`), characterization, and the link-grammar lane — see
`package.json` scripts for the full index. Broad route lanes
are intentionally not part of the PR gate, but `.github/workflows/nightly-route-mutation.yml`
runs `mutation-test:routes`, `mutation-test:routes:certs`,
`mutation-test:routes:subgraph`, and `sabotage:routes` nightly and on manual
`workflow_dispatch`, uploading reports as artifacts — though every scheduled
run to date has been cancelled at the 90-minute cap before uploading anything
(the unsharded routes lane exceeds it; PR #63 carries the sharding fix), so
current scores come from local runs. Run the narrow lane locally
when you touch ASCII/route core logic and want immediate proof the tests bite.

To turn a JSON report into a triage list — mutation score, survivors grouped by
mutator, line hotspots, and the full `file:line:col — mutator — replacement`
list — run `bun run scripts/mutation-survivors.ts` (reads
`reports/mutation/*-mutation.json`; pass `--out triage.md` to also write a file).
The June 2026 nightly scored routes ~54.5% (1904 killed+timeout of 3492 mutants,
command runner, measured across the four nightly shards — up from the 52.15%
baseline after the harvest passes; the command runner runs every test per mutant so
it has no "no coverage" class and scores a few points above the vitest-runner's
50.79%, which counts 383 no-coverage mutants as not-killed). Its `auditRouteContracts`
region was lifted 75.1% → 83.43% on a scoped re-run, the ninth pass took 7 more in
`directLaneBlockers`/`findLabelSlot`, and the tenth pinned `tryRepairContainerEdge`'s
contract guards. Route-certificates scored
54.04% (74 survivors, up from 27.95%/116 after two harvest batches — vertex-hook
entry sides and reciprocal/off-port enrollment; most of the residual are
equivalent mutants, classified below), and subgraph-routing 86.79% (7 survivors).

## Runner & tooling

The route lanes (`stryker.routes.config.json`, `stryker.route-certificates.config.json`) use
Stryker's generic **command runner** — it reruns the whole `bun test` file per mutant. The full
`route-contracts.ts` lane is ~3.5k mutants, too slow for a single job (≈3.5 h; it timed out), so
`.github/workflows/nightly-route-mutation.yml` **shards it by line range**: four parallel jobs,
each mutating a slice of the file, so every shard finishes inside its cap. To triage a whole run,
download the `route-mutation-routes-shard-*` artifacts and run `scripts/mutation-survivors.ts` over
each. `src/__tests__/route-contracts.test.ts` pins the fast-check seed (scoped via
`before`/`afterAll`) so the lane is reproducible without making the rest of the suite deterministic.

**Why command-runner + sharding (not the vitest-runner).** The official
`@stryker-mutator/vitest-runner` with `coverageAnalysis: "perTest"` was prototyped and is genuinely
faster — on one runner it finished the full lane in ~47 min (≈4.4×), running only the tests that
cover each mutant. The cost is structural: it requires moving the suite off `bun:test` to Vitest and
carrying a **second test runner** permanently, plus line-range configs that drift when the file
moves. Sharding the command runner keeps everything on one runner (`bun test`) and completes just as
reliably by running the slices in parallel — trading cheap nightly runner-minutes for that
simplicity. The community `@hughescr/stryker-bun-runner` was also rejected: it classified ~86% of
mutants as **static** and ran them *sequentially*, ~2× *slower* on the full lane.

For harvest iteration, scope the lane with `npx stryker run stryker.routes.config.json --mutate
'src/route-contracts.ts:L-R'` — a narrow range finishes in a couple of minutes.

Two helper scripts (both read `reports/mutation/*-mutation.json`):
- `bun run scripts/mutation-survivors.ts` — triage a report (score, survivors by mutator, line
  hotspots, full survivor list).
- `bun run scripts/mutation-kill-prompts.ts` — turn survivors into per-mutant LLM "kill
  prompts" (mutation diff + source-context window + covering tests + a sabotage-verify
  instruction), with an equivalence-prone prefilter. Semi-automates the harvest loop; drive it
  from an agent session, then sabotage-verify each generated test before keeping it.

**Suppressing equivalents — prefer prose classification (below) over `// Stryker disable`
comments.** Disable-comments are line+mutator granularity, but in these survivors the killed
and equivalent mutations of a mutator routinely share a line (e.g. line 1694 carries 4 killed
*and* 9 survived `LogicalOperator` mutants), so a disable comment would also drop the real
kills from the score. Only suppress a line where *every* mutation of that mutator is provably
equivalent.

**Boundary survivors** (the `< tol` / `±EPS` / `±0.5` family) are best killed as a *class* with
property-based + metamorphic tests (`fast-check`) rather than pixel-exact fixtures — see the
"property-based & metamorphic coverage" block in `route-contracts.test.ts`, which probes
offsets arbitrarily close to each tolerance with `fc.double({min,max})` and asserts the audit
is translation-invariant.

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
| route-contracts.ts | 58.1% → 72.3% → 75.6% → 73.1% across the first three batches; 54.31% at 0b43c90, then 50.69% at 526d9cf after the slanted-family batch (shapePorts generalization, convex-polygon geometry: 2659 → 2740 mutants — absolute kills 1444 → 1381). The percentage fell purely on denominator growth (~3× since batch 3); a survivor-harvest batch is the documented next quality step. | 882 → 2740 | 50.69% (1381 killed) — survivor harvest pending |

(Numbers from the June 2026 runs; regenerate rather than trusting this
table — the report lands in `reports/mutation/`.)

## Survivor classification

**linkrank lane residual (124 at the 65.07% run)**, classified:

- **Real gap, next harvest**: the subgraph-scoped `separationUnit` branch (walk the
  overlapped node's scope chain, push its outermost subgraph unit) never fires — the
  degenerate repro set has no subgraphs. Killing these needs a subgraph + long-link
  shove-overlap fixture.
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

**Killed by `route-contracts.test.ts` survivor harvests** (≈260 mutants
across ten passes): RL/BT axis orientation (reciprocal-pair regressions in
both reversed directions), every `directLaneBlockers` blocker kind at its
exact ±4px clearance boundary on both axes (non-square obstacles so a
swapped width/height changes the verdict), own-label lane capacity in
rendered-pill units, the same-edgeIndex self-exclusion, sub-epsilon
polyline simplification, the hitch deviation rounding, `findLabelSlot`
stagger and pill-boundary arithmetic, the primary-over-feedback exemption
asymmetry, the feedback path of `findRouteHitches`, shared-trunk detection
on both axes at its collinearity/pill-extent boundaries, the ±2px line
between the stale and shape-misanchor tripwires, container perimeter
tolerance, and the container repair's horizontal-gap axis selection. The
sixth pass (vertex-hook entry side) pinned `tryVertexHook`'s cross-side port
selection on all four entries — the existing LR/N case plus the LR/S mirror
(target above the lane) and the TD/W, TD/E rotations — and its two early
returns (a stub shorter than `HOOK_STUB_MIN`, and a sibling already holding
the facing entry port so the fan-in merge outranks the hook), lifting the
`mutation-test:routes:certs` lane from 27.95% to 52.17% (116 → 77 survivors).
The seventh pass (reciprocal / off-port enrollment) isolated the "already
straight" branch with hand-built on-port geometry: a reciprocal pair that must
still split to the symmetric lane (center ± 6), and a straight edge floating off
its ports that must snap back onto the port lane — taking the lane to 54.04%
(74 survivors). The eighth pass (route-audit boundary harvest) pinned
`auditRouteContracts`' exact tolerances — `onRectPerimeter`'s ±1px on every
border (left/right via LR, top/bottom via TD with an orthogonal approach so no
spurious `ROUTE_UNEXPLAINED_BEND` fires), the inflated ±2px attached-vs-stale
split, `ROUTE_UNEXPLAINED_BEND` on a feedback edge (not just primary-forward),
and the non-incident `ROUTE_STALE_AFTER_NODE_MOVE` overlap with its ±0.5 inset
and segment-direction min/max — killing 29 of the audit region's survivors
(lines 1915–2062: 87 → 58, 75.1% → 83.43% on the scoped lane). The residual
there is the `onRectPerimeter` perpendicular-range guards (always also caught by
the facing border, so equivalent) and the `ROUTE_LABEL_ON_SHARED_TRUNK`
collinearity/overlap math (an open gap, partially covered by the boundary test
above). The ninth pass (label-rect main extent + slot-overlap conjunction) closed
the two horizontal `directLaneBlockers` label gaps with a wide, short obstacle
pill placed just past the lane's left end — so the main extent rides on the
pill's width plus the full 2×CLEARANCE, taking the width/height swap, the zeroed
extent, and both clearance-arithmetic mutants — and pinned `findLabelSlot`'s
`rectsOverlap` on its left and both vertical sides (the `+PAD` term on three of
the four clauses) with pad-band fixtures on a long lane. Scoped lanes 839–842 /
900–902 reached 89.66% (7 survivors killed); the 6 that remain are the
strict-vs-non-strict edge comparisons, accepted as equivalent (open-gaps note).
The tenth pass exported `tryRepairContainerEdge` and unit-tested its contract
directly — the reversed target-above-source repair, the not-a-rect-endpoint
decline, and the already-straight no-op — killing the guard/setup survivors
(function body, not-a-rect guard, already-straight return) the function had no
direct test for and that the redundant pipeline repair paths had masked. Its
`gaps` array (the four-direction lane *selection*) stays open: a single-direction
fixture can't discriminate it (a wrong-but-still-positive gap picks the same
axis), so it needs two competing positive gaps — and the container integration
fixtures that used to kill it no longer cover it after main's #32 container-layout
change.

**Accepted — equivalent on the real input domain** (route-contracts): the
collinearity cross-product variants in `simplifyPolyline` behave identically
for the orthogonal polylines ELK produces (several algebraic rearrangements
preserve the zero/non-zero verdict for axis-aligned triples), and the
`isMonotoneStaircase` diagonal/backward guards are defensive against passes
that do not currently exist — real extracted routes are orthogonal and the
backward case is already excluded by feedback classification upstream. The
residual reciprocal-enrollment survivors (lines 1693–1704) are broadening
mutations — `reciprocal → true`, the over-matching `.some` predicate, the
always-true OR-chain, the always-push retry — and are equivalent: re-enrolling
an edge that is already straight and already on its port re-lanes it to that
same port (candidate index 0, never added to the retry pool), so widening the
trigger adds only idempotent no-ops. Only mutations that can turn enrollment
OFF when it is needed are killable, and the two new enrollment fixtures take
those.

**Accepted — performance guards** (route-contracts): the `seen`-set and
stack mechanics inside `classifyRoutes`' DFS change traversal cost, not
reachability verdicts, on the small graphs flowcharts produce.

**Accepted — bounded-iteration guard** (route-contracts): the fixed-point
loop's `round < 4` weakenings only change how many re-prove rounds run;
the duplicate-edge regression pins one unblocking round, and constructing
a graph that needs three chained rounds would be a synthetic-input test.

**Open test gaps** (highest-value first):
- `directLaneBlockers` label-rect main extent and `findLabelSlot`'s
  `rectsOverlap` conjunction are pinned as of the ninth pass. The only residual
  mutants are the strict-vs-non-strict boundary comparisons (`<`↔`<=`, `>`↔`>=`)
  at the clearance/pad edges; they differ only when a coordinate lands exactly on
  an edge — a measure-zero, ULP-fragile case on ELK's float geometry — so they
  are accepted as equivalent rather than killed with synthetic exact-boundary
  inputs.
- The audit's pill-hit prefilter (`hitsPill`) retains inclusive-vs-strict
  comparison survivors for segments that exactly graze the pill border;
  they only widen the prefilter the collinearity check still gates.
- `tryRepairContainerEdge` is now unit-tested directly (tenth pass): the reversed
  target-above-source repair, the not-a-rect decline, and the already-straight
  no-op, killing the guard/setup survivors the function lacked direct coverage
  for. Residual: the four-direction `gaps` *selection* (needs two competing
  positive gaps to discriminate — the container integration fixtures stopped
  covering it after main's #32 layout change) and the group/diamond-endpoint
  rect synthesis.
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
  (the branch condition + its block). Unreachable by construction: all twelve
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
