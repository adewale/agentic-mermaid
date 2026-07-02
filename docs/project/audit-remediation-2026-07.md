# Audit remediation plan — 2026-07-01/02

Source: the label/box overlap fuzz audit (7 real classes, 5 clean families), the
83-issue archaeology (closure-hygiene pattern), and the swept-under-carpet
inventory (dead nightly lane, live CI flake, unowned label policy).

Principles: detector-first (a gate that fails red before each fix, stays as the
regression gate after), no-op-gated fixes where the corpus is already clean,
visual review + [approve-goldens] where the corpus itself was defective,
receipts-on-issue at every closure, follow-ups filed at deferral time.

## Workstreams

**WS1 — Land the stranded fixes (closure debt)**
- PR + CI + merge: `claude/linkrank-overlap-repair` (#81 fix) → close #81 with receipts.
- PR + CI + merge: `claude/multiline-metadata-lint` (#44 first slice) → update #44.
- Merge PR #82 (divergence doc, green since yesterday). Close PR #75 (superseded by merged #79).
- Reconcile #55 against the shipped BUILD-20 manifest → close with receipts.
- Exit: no session work stranded on branches; tracker state = code state.

**WS2 — Certificate completeness + CI determinism (#83)**
- Root-cause the uncertified edge on the duplicate-parallel-edge repro; fix in
  applyRouteContracts (or the parallel-lane path).
- Pin the fast-check seeds in route-contracts property blocks (kill the ~1-in-7 flake).
- Red→green: deterministic repro test + the previously-flaky property at a pinned seed.
- Exit: #83 closed with receipts; suite deterministic.

**WS3 — Overlap detection tooling (new, durable)**
- Promote the SVG overlap auditor (text boxes via renderer's own text metrics,
  group/containment ownership, rotation-aware) into `eval/overlap-audit/`:
  `audit.ts` (library), `corpus-gate.ts` (curated corpus must be label-clean),
  `fuzz.ts` (12 hash-seeded family generators, deterministic).
- Wire a unit gate: `src/__tests__/label-overlap-gate.test.ts` running the corpus
  gate + small fuzz smoke (deterministic seeds) — goes red on any regression.
- Exit: label collisions are a measured, gated metric for every family.

**WS4 — Label collision fixes, family by family (detector-red first)**
- W4a flowchart+state: post-freeze `separateEdgeLabels` repair — slide colliding
  edge labels along their own routes to clear positions (parallel/reciprocal/
  feedback classes). Corpus HAS these defects → visual review + baseline update.
- W4b quadrant: point-label collision avoidance (candidate positions around the
  point) + canvas clamping.
- W4c xychart: deterministic tick-label thinning when measured widths collide.
- W4d ER: parallel relationship label separation (same-pair relations).
- W4e gantt compact: collision-aware task-label placement in compact displayMode.
- W4f architecture: investigate group-containment breach (timeboxed); fix or file
  a focused issue with the shrunk repro.
- Exit per family: fuzz affected-rate → 0% (or documented residual + issue), corpus
  visually reviewed, red→green tests.

**WS5 — Tracker hygiene + residual issues**
- File focused issues for genuinely-open residuals: broader link-length semantics
  (#32's untracked remainder), hitch residual + minimum-gap spacing characterization,
  #26's four named residuals, architecture containment (if W4f defers).
- Update #44 with landed slice; leave open (feature).
- #35 stays open with the #63 dependency (user decision) — note in summary.
- Exit: every known residual has an owner issue with a repro.

**WS6 — Lessons learned + changelog + internal consistency**
- Update CHANGELOG.md (user-facing changes from this remediation).
- Add/extend a lessons-learned doc (closure discipline, detector-first, the
  "generator noise" trap, label blind spot, dead-signal alarm).
- Consistency audit (agent-assisted breadth + verified fixes): docs claims vs
  shipped behavior (fork-differences, mutation-testing rows, TODO.md BUILD flags,
  testing-strategy claims vs dead nightly, README), all sync gates
  (docsync/website/hero/site/comparison).
- Exit: no doc asserts something the code contradicts; all sync gates green.

## Progress tracking
Task list mirrors WS1–WS6; this file is committed with results appended in WS6.

## Results

### WS1 — Landed
PR #84 (the #81 packing fix) and PR #85 (#44 multiline lint slice) merged after
green CI; #81 closed with receipts; PR #82 merged; PR #75 closed as superseded
by shipped #79; #55 closed reconciled against the committed BUILD-20 manifest
(12 families, 648 imported cases, 0 deferred, bench 584/584).

### WS2 — Landed (PR #86)
recertifyReroutedEdge at all three post-freeze reroute sites; deterministic
certificate-completeness gate (corpus + shrunk #83 repros + fixed-seed sweep);
route-contracts property seed pinned to the exact seed that exposed #83
(previously a ~1-in-7 CI flake). #83 closed with the merge.

### WS3 + WS4 — Landed (PR #91)
eval/overlap-audit (auditor + corpus gate + 12-family fuzz) and the family
fixes. Corpus: 25 findings → 0. Fuzz affected-rates (of 120): quadrant 89%→32%,
state 70%→32%, architecture 37%→6%, flowchart 31%→20%, xychart 28%→0%,
er 15%→2%, gantt 13%→3%; sequence/class/timeline/journey/pie stayed 0%.
Gate label-overlap-gate.test.ts: corpus hard-zero + per-family ratchets
(5 gate tests fail without the fixes). Contact-sheet scenario AJ re-pinned
deliberately after visual review (parallel labels part cleanly).

### WS5 — Filed
#87 (link-length remainder, the #32 correction), #88 (7 residual hitches +
minimum-gap question), #89 (#26's four promised follow-ups), #90 (architecture
service/group containment breach with deterministic repro).

### Found during execution
PR #91's first CI run rolled a seed that failed a THIRD unpinned property
suite (the parser Cartesian-product property) — a pre-existing generator bug
(grammar-ambiguous ids with interior hyphen runs) fixed on the #91 branch with
the same pin-and-constrain policy. Confirms the residual: the repo's remaining
fast-check suites should get the seed policy as a sweep (noted in
lessons-learned). *Resolved post-remediation:* the sweep landed as a repo-wide
`bun test` preload pin with an `AM_FC_SEED` escape hatch, two meta-gates, and
a 1,368-run multi-seed hunt (zero latent failures) — see
`docs/testing-strategy.md` §4 and the CHANGELOG entry.

### WS6 — This commit
CHANGELOG updated; docs/contributing/lessons-learned.md added; consistency
sweep findings fixed (see the commit touching the affected docs).
