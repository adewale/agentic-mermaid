# Lessons learned

Process lessons this repo has paid for, so they only have to be paid for once.
Each entry names the incident that taught it. Add new lessons at the top with a
date; do not delete old ones — supersede them in place.

> **Scope.** This is the short, dated contributor process log. For the
> long-form fork narrative and major-PR retrospectives, see
> [`../project/lessons-learned.md`](../project/lessons-learned.md).

## 2026-07 — the all-family elevation PR (#142)

**Make exhaustive ledgers executable.** The plan said config honesty covered the
family set, but its hard-coded matrix omitted State and `state.*` keys vanished
silently. Rule: assign stable IDs to every plan item, restrict status to a small
enum, require evidence or an exact remainder, and assert registry equality for
any “all families” table. A prose count is not enrollment.

**Close phases against finite exit contracts.** “Substantially complete” is not
a reviewable state. Rule: list the executable gates that close a phase and decide
which later features are outside it. For honesty, lossless opaque preservation
plus an actionable warning is complete; modeling that syntax is a later parity
item and must remain visible in the backlog.

**A before/after image proves change, not intent.** The first visual-evidence
matrix said what moved but not why. Its Timeline row showed a horizontal diagram
becoming vertical, which looked like an arbitrary redesign until the caption was
amended to say that the fixture explicitly authors `timeline TD` and the old
renderer ignored it. Rule: every visual comparison needs the authored trigger or
user contract (**why**) separately from the pixels a reviewer should inspect
(**what**). If the reason is not visible beside the evidence, the reviewer cannot
distinguish a correction from churn.

**Audit issue acceptance criteria, not issue keywords.** The broad family uplift
overlapped five open issues, but three were only partly complete: Architecture
accepted `align` without honoring its geometry (#101), Flowchart parsed markdown
while discarding emphasis (#102), and the Class/State work for #118 still lacked
Class generics. Rule: before claiming closure, replay every acceptance condition
and probe the actual output. Either finish the overlap in the current PR or state
precisely what remains; a parser accepting syntax is not the same as the product
implementing it.

**Goldens pin output; discriminating invariants prove correctness.** Snapshot drift
did not reveal that eight dense self-loops had only six unique label centers, that
Architecture routes still used pre-alignment anchors, or that an aligned lane hid
an unconstrained sibling. Direct geometry assertions exposed all three. Rule: pair
intentional golden updates with tests for the causal property—unique occupancy,
post-move anchoring, containment, non-overlap, determinism, or source-order
invariance—and verify that reverting the fix makes those tests red.

## 2026-07 — style coverage and typography semantics

**A style transform is a semantic contract, not a blanket SVG rewrite.**
The first style-coverage pass made typography expressive enough to expose an
important boundary: class names, entity names, relationship labels, section
labels, chart titles, and task labels are diagram labels; class members and ER
attributes are schema/code-like literals. Uppercasing `Account` to `ACCOUNT`
is a look. Uppercasing `displayName`, `createdAt`, `orderId`, or
`closeAccount(reason: string)` destroys authored signal. Rule: label transforms
apply to labels; syntax-like internals still participate in role-token paint
and contrast audits, but keep authored casing unless a future explicit
`member`/`attribute`/`syntaxText` policy says otherwise.

**Measure the text the renderer will actually draw.** Aggressive typography is
not layout-neutral: uppercase, weight, letter spacing, and compact labels all
change measured width and row/axis/title budgets. The Gantt fix had to measure
the transformed/tracked text, not the Mermaid source token, before rendering
compact task labels and axes. Rule: any layout that reserves space for text
must run the same transform path that the renderer uses, or the style will pass
unit tests while visibly clipping in the editor.

**Coverage evidence has to separate plumbing, readability, and taste.** The
state-space diagram and galleries explain what the style catalog covers, but
the durable gate is `style:audit`: every built-in family is rendered with
sentinel role tokens, role propagation is checked, and contrast floors are
enforced. Visual galleries answer "are these looks differentiated?"; the audit
answers "does the style system reach the elements it claims to reach?" Keep
both, and be explicit about the remaining gap: arbitrary user-authored
style/palette stacks are not yet universally WCAG-proved.

## 2026-07 — the layout-shift audit and look-control rework

**User-initiated layout shift is CLS-exempt but still visible jank — diff
positions, don't trust the metric.** A whole-site audit read CLS 0.000
everywhere, yet clicking the home "Use with an agent" button slid its
neighbours 83px, selecting a diagram style reflowed the wrapped mobile topbar
by a full row (the theme dropdown jumped 284px), and the editor's "Copy agent
prompt" slid 81px. All fired within 500ms of the click, so `hadRecentInput`
flagged them out of the Core Web Vitals number. Rule: to audit click-induced
shift, diff each anchor's bounding rect before/after the interaction and read
the raw (unfiltered) `layout-shift` entries — CLS alone certifies nothing about
what the user sees at the moment they click.

**A width reservation is only correct once you check every breakpoint it
crosses.** The Share button grew ~7px when its label became "Copied"; the
obvious fix — a permanent inline `min-width` — would have overridden the
≤760px `font-size:0` rule and broken the mobile icon-only square, because
inline styles beat media queries. Reserving the label's width in `em` instead
collapsed to 0 exactly when the mobile rule zeroed the font. Rule: prefer a
unit/property the responsive rules can still override, and verify the
reservation at each breakpoint it passes through before shipping it.

**A layout invariant stated in a component's own copy is a test spec.** The
seed-shuffle button's tooltip said "(never moves layout)" — true when clicked,
false when it *appeared*, which is what reflowed the topbar. The existing
style-switch test asserted "the chrome never moves" but only compared colours,
so the regression passed straight through it. Rule: when a component claims a
layout invariant (in a tooltip, a comment, or a test's own name), the guarding
test must assert positions, not a proxy like colour.

**Restructure by re-wrapping markup and re-scoping CSS; touch the JS only when
an id or class contract actually changes.** Fusing the Style and Theme
dropdowns into one split pill kept every button/wrap/menu id and the `.open`
class the shared popup controller toggles, so selection, keyboard, and focus
logic ran unchanged — the only rename was a CSS-only button class. Rule: when
JS binds elements by id and toggles known classes, a visual restructure is a
markup + CSS job; reading the id/class contracts first tells you whether the JS
is even in scope.

**Label from the code's own vocabulary, and check the word against its sibling
controls.** "Theme" for the palette axis collided with the adjacent light/dark
toggle and with Mermaid's `themeVariables`, and was category-muddy (internally
a theme is a palette-only style) — while the style registry, CLI, and docs
already called it a "palette." Relabelling to "Palette" was three visible
strings with no code rename: there is no public `theme` render field, and
renaming `state.theme` / `data-theme` / the localStorage key would have broken
saved editor state and share links. Rule: audit where a term is actually used
before putting it on a control; a user-facing label is not an API, and the two
are allowed to differ.

## 2026-07 — the website consolidation PR (#113)

**A long-running branch that commits generated output collides catastrophically
with a base that stops committing it — keep website changes source-only.** PR
#113 committed the whole `website/public` bundle (100+ files) across nine
commits. Meanwhile `main` (#110) had made `website/public` a gitignored build
artifact, rebuilt by the test preload and at deploy. The result was a "dirty"
PR whose merge was ~20 modify/delete conflicts on generated pages — the actual
change (five source files) was buried under hundreds of artifact diffs.
Resolution was to adopt the artifact model (`git rm -r website/public`, keep
only `build.ts`, `source/pages`, the contract test, and `TODO.md`), which
collapsed the PR from ~86 changed files to 5. Rule: never commit
`website/public`; a website PR's diff is source only. A committed generated
bundle turns every base change into a conflict and hides the real edit in noise.

**Deterministic build + `website:check` can pass on wrong-but-deterministic
output — assert content, not existence.** The sitemap (the PR's headline
feature) shipped with only an `existsSync` gate. Because the build is
deterministic and `website:check` only diffs regenerated-vs-committed output, a
stale or malformed sitemap would regenerate identically and pass every gate —
the wrong output is reproduced, not caught. A multi-agent audit flagged it; the
fix asserts the sitemap lists exactly the live pages (no removed routes, no
machine artifacts, one `<loc>` per page) and was verified red→green by injecting
a removed route. Rule: for generated content, the test must *discriminate*
correct from incorrect output, because determinism guarantees a wrong generator
passes a same-vs-same check.

**`bun test` green is not `tsc` green, and a piped exit code lies.** A new test
passed `bun test` but failed strict `bun x tsc --noEmit` — a `matchAll` capture
group is typed `string | undefined`. It nearly shipped because
`bunx tsc … | tail` printed "exit: 0": the pipeline's status was `tail`'s, not
tsc's, masking two real type errors. Rule: run the actual CI gate
(`bun x tsc --noEmit`) after adding tests, and read `${PIPESTATUS[0]}` (or drop
the pipe) so a tool's failure is never hidden behind a successful `tail`/`grep`.

**Check what the platform already serves before adding a competing file.**
Production serves Cloudflare's *managed* content-signals `robots.txt` at the
edge; a repo `website/public/robots.txt` would likely have been shadowed and
never delivered its `Sitemap:` line. A live `curl` settled it — the repo file
was removed and the directive routed to the Cloudflare dashboard (TODO DEC-5).
Corollary: for platform-managed surfaces (robots.txt, headers, redirects),
verify the live response before shipping an asset that may never win. And a
related cleanup that landed the same PR: hand-maintained parallel route lists
drift (the `_redirects` list had silently dropped `/about/design`) — derive
them from one source (here, the emitted-pages map) to delete the drift class.

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
