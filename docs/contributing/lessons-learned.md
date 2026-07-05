# Lessons learned

Process lessons this repo has paid for, so they only have to be paid for once.
Each entry names the incident that taught it. Add new lessons at the top with a
date; do not delete old ones — supersede them in place.

> **Scope.** This is the dated contributor process log. For the long-form
> cumulative fork narrative (loops 1–22), see
> [`../project/lessons-learned.md`](../project/lessons-learned.md).

## 2026-07 — the brand-system and chrome-polish passes

**Design intent and shipped hex drift apart; compute claims on what shipped.**
The pine accent was chosen 28° of OkLCH hue from the semantic success green —
in the design tool. The shipped hexes had converged to 15° apart (11° in dark
mode): links and "Copied" confirmations read as one colour, worse for
deuteranopes, and the review that picked pine had cited the design-intent
number. The separation now lives as an executable claim
(`chrome-token-lockstep.test.ts` asserts ≥ 20° on the shipped values). Rule:
any colour-relationship claim is computed on the committed hex, and if the
relationship matters, it becomes a test.

**A "keep in lockstep" comment is a hope; a test is a guarantee.** Three files
carried the shared chrome tokens (site stylesheet, editor stylesheet, and the
editor's `chromeThemeColors()` in JS), synchronized only by comments — and a
12% vs 13% hairline drift had already shipped that way. The lockstep test now
extracts the triplet, brand chip, functional hues (both polarities), radii,
motion tokens, and the hairline mix from all three sources and asserts
equality. Corollary: the first draft of that test was itself rejected by the
repo's test-quality lint (`toBeTruthy`) — new guard code has to pass the
house's existing guards.

**A rebrand includes the assets nobody opens.** Months of chrome work shipped
while `og-image.png` still read "Beautiful Mermaid — by the team at Craft":
the upstream project's card, wrong name, pre-fork palette, posted on every
social share of the site. The CSS was audited to the percent; the PNG was
never looked at. Rule: a brand change enumerates its raster/social surfaces —
og-image, touch icons, favicon, README-rendered artifacts, repo social
preview — and someone *views* each one.

**Breakpoint boundaries hide unreachable controls; probe them mechanically.**
Between 761 and ~1000px the editor topbar clipped with no scroll path — Copy
agent prompt and Export Image were simply unreachable on an iPad portrait,
8px above the mobile breakpoint. Nothing failed: no overflow, no console
error, desktop and phone both fine. The check that catches it is mechanical
(every interactive element's bounding rect inside `innerWidth`, sampled just
above each breakpoint), and the fix is a policy, not a tweak: toolbars either
wrap or scroll; they never assume they fit.

**When one value moves, its coupled values move with it.** The iOS input-zoom
fix (16px fields under coarse pointers) would have silently desynced the
line-number gutter, which shares the textarea's font metrics row-for-row; the
`forced-colors` block predated the new functional tokens and left them
unmapped under Windows High Contrast. Both were caught only by asking "what
else derives from or aligns with this?" before shipping. Same failure shape
in both: a correct local change, an unenumerated dependency.

**Verify a suspected gap exists before fixing it.** A review flagged popover
keyboard handling (Escape, focus restore) as unaudited. The audit found a
shared `createPopupController` already covering all seven popovers, including
roving tabindex in the theme listbox. "Audited, no change needed" is a
result worth reporting; patching per-component without looking for the shared
mechanism would have added the inconsistency it meant to prevent.

**Consistency work starts with a census, not a scroll-through.** Grep every
value class and count occurrences (radii, durations, easings, font sizes,
press scales, icon strokes, z-indexes, gaps) — the count-one entries are the
findings. This surfaced 58 untokenized transition durations, three press
scales where the system wanted one, five icon stroke weights where two were
deliberate, and seven magic z-indexes with an accidental popover-above-popover
ordering. Eyeballing pages finds none of these reliably.

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
