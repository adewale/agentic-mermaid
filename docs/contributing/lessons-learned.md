# Lessons learned

Process lessons this repo has paid for, so they only have to be paid for once.
Each entry names the incident that taught it. Add new lessons at the top with a
date; do not delete old ones — supersede them in place.

## 2026-07 — the label-overlap audit and remediation

**A metric you never measure is a defect class you ship.** No gate measured
label-label or label-box occlusion in any family until the 2026-07 audit — and
the curated, human-reviewed corpus itself carried collisions in five families
(architecture edge-label pairs, quadrant point labels, gantt compact rows,
state reciprocal pills, flowchart feedback pills). The blind spot had even been
*seen* and deferred (issue #42's review explicitly carved out "a separate
label-lane/self-loop policy") — deferral without an owner issue is how a known
gap becomes an ambient defect. Rule: every deferral gets a filed issue at
deferral time (see the closure-hygiene lesson below).

**Detector first, then the fix, then the detector becomes the gate.** The
remediation sequence that worked: build the overlap auditor → calibrate it on
the curated corpus (which also separates auditor bugs from real defects — two
of the initial finding classes were the auditor's own rotation and region-
border mistakes) → fix family by family with the detector red first → land the
detector as a permanent gate (`label-overlap-gate.test.ts`: corpus at zero,
per-family fuzz ratchets). A fix without the standing gate would regress
silently; a gate calibrated before the corpus was clean would have been
disabled as noisy.

**"Generator noise" is a hypothesis, not a verdict.** The deep-fuzz
`offOutlineEndpoints` hits were dismissed as duplicate-parallel-edge generator
artifacts — but duplicate parallel edges are *valid Mermaid*, and that same
input class turned out to break certificate completeness (#83) and stack labels
(70% of fuzzed state diagrams). When a fuzz class is excused, the excuse needs
the same evidence bar as a fix: either the input is genuinely invalid, or the
class gets an owner issue.

**Fixing one flaky suite does not fix the policy.** Hours after the
route-contracts seeds were pinned (#86), a *different* property file
(`property-mermaid-source-and-parser.test.ts`) failed CI on a rolled seed — its
generator emitted grammar-ambiguous ids (`s---Py3` reads as the link
`s --- Py3`, in this engine and in Mermaid) that only rare seeds produce. Two
sub-lessons: property generators must be constrained to inputs whose expected
behavior is actually unambiguous, and a determinism policy has to be applied as
a sweep (every fast-check suite), not incident-by-incident.

**An invariant enforced by a random property is a lottery, not a gate.**
Certificate completeness was guarded only by an unpinned fast-check property —
it fired roughly one CI run in seven, which reads as "flaky CI" rather than
"real bug" and trains people to re-run. Invariants get deterministic gates
(enumerated corpus + pinned seeds); randomness is for *finding* new
counterexamples (deep fuzz lanes), not for *holding* known ground.

**A dead quality signal is worse than no signal.** Every CI run printed "the
mutation score is the adequacy signal" while the nightly mutation lane had been
timing out (cancelled) for over a week — the signal's *existence* was asserted
by docs while its *output* was absent, and nothing alarmed. If a scheduled
gate's failure/cancellation isn't itself surfaced (a required check, a badge, a
notification), the gate will die quietly exactly when it matters.

## 2026-07 — tracker archaeology (issues 1–83)

**Closure needs receipts on the issue, at closure time.** The audit found
issues closed with zero receipts (#29, #34, #36, #41), an issue closed against
its own last comment (#32), and closures that predated their fix (#37, #38's
first close). Each needed a later archaeology pass to reconstruct. The rule
this repo now follows: an issue closes with a comment naming the receipts
(tests, docs, PRs, measurements) — and if part of the scope is deferred, the
follow-up issue is filed *in the same action* (#87–#90 are the back-fill for
past deferrals).

**A pass that mutates geometry owns the consequences of the mutation.** Three
post-freeze repairs re-routed edges and dropped their certificates without
re-issuing them (#83); the shove pass moved nodes and left overlaps behind
(#81). The doctrine that fixed both: any pass that mutates layout state must
hand every invariant on — re-anchor the edges it moves, re-certify the routes
it rewrites, re-separate the boxes it displaces. "A later pass will catch it"
is how symptom-repair whack-a-mole starts.

**Fix the invariant upstream, keep the net downstream.** The #81 degenerate
class (18 fuzz signatures) collapsed to zero by restoring one upstream
invariant (no node overlaps after a shove) — after a session of fixing
individual routing symptoms had removed only one sub-class. The post-freeze
nets stay as insurance, but they are gated on violations that should never
occur, not used as the primary mechanism.
