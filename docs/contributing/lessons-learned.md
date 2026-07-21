# Lessons learned

Process lessons this repo has paid for, so they only have to be paid for once.
Each entry names the incident that taught it. Add new lessons at the top with a
date; do not delete old ones — supersede them in place.

> **Scope.** This is the short, dated contributor process log. For the
> long-form fork narrative and major-PR retrospectives, see
> [`../project/lessons-learned.md`](../project/lessons-learned.md).

## 2026-07 — subtraction and release readiness (#205)

**A live dependency audit is a release input, not background noise.** The PR's behavioral lanes were green, but a newly disclosed advisory in Stryker's `minimatch` chain stopped the quality job before the repository-specific checks ran. Rule: preserve the audit gate, resolve the smallest compatible transitive version explicitly, prove the dependent tool still runs, and distinguish inherited aggregate failures from product regressions.

**Subtraction must retain an explicit portable boundary.** Removing audit-only exports was useful, but an initial pass also removed the only clearly browser/workerd-safe agent entry and left consumers to depend on bundler tree-shaking around native PNG code. Rule: name and test the portable contract directly; package reduction is successful only when each retained runtime has an install-and-import proof.

**The final dependency graph belongs before final evidence generation.** Package and lockfile edits after gallery generation left provenance receipts stale even though image bytes did not change. Rule: finish exports, dependency placement, overrides, and version metadata before regenerating receipts; then run the merge-ref CI rather than treating branch-head freshness as final.

## 2026-07 — complexity-aware test portfolio (#193)

**Optimize declared obligations, not test count.** The old 4,500-render matrix was exhaustive only for family × Look × Palette while fixing source complexity, output, transport, security, seed, and background. The replacement exhausts cheap Style algebra, covers expensive factors with independently verified variable strength, retains exact goldens and fault probes, and publishes the missing-tuple count. Rule: state what a row proves before optimizing it; fewer rows are useful only when the declared interaction and oracle strength improve.

**Independently verify a generated test plan.** A covering-array generator can share its own blind spot with a self-check. The replacement uses a separate tuple enumerator and fake/removed-family sabotage; family registration is compile-time closed over mandatory conformance profiles. Rule: the producer of evidence does not get to be the only judge of completeness.

**Do the arithmetic before promising a cost target.** The provisional 350–600-row estimate conflicted with a named 15 × 20 × 3 triple obligation, whose lower bound is 900. The implementation kept the obligation, produced 1,047 core rows, and reported the estimate miss instead of weakening coverage. Rule: budgets are hypotheses; hard combinatorial lower bounds and measured fault sensitivity win.

**Treat contact sheets as bounded probes in a complex domain.** Machine oracles establish structure, safety, determinism, and finite geometry; they do not establish hierarchy, rhythm, or taste. A registry-derived contact sheet supports pattern recognition across comparable cells, but a scaled overview cannot prove native-size readability. Rule: bind row/source/dimension/output hashes, record inspected cell IDs and findings, and never equate an agent/model sanity scan with independent human approval.

**A broad receipt hash can create work without creating confidence.** Test-only changes invalidated four galleries even though all image bytes were unchanged; the first merge-ref CI attempts then exposed three more broad visual authorities after a `package.json` script-only edit. Replacing `src/**/*.ts` globs with a fail-closed transitive import graph cut the seven receipt input sets by 59.9–98.5% and preserved true-dependency invalidation. Rule: evidence freshness follows the artifact's build graph; unrelated repository churn is not provenance.

## 2026-07 — public-artifact freshness and delivery closure (#184)

**Byte-identical production is not proof of current provenance.** The deployed
site matched the repository byte-for-byte, yet five public SVGs predated the
current deterministic text-geometry contract and a copied terminal snapshot no
longer matched current output. Rule: inventory every deployable file and classify
it as authored input, generated output with a freshness oracle, or versioned
external asset. Local↔production equality proves deployment parity only; it does
not prove that either side was derived from current code.

**Unreferenced assets are still public when a build publishes them.** No page
linked the six stale snapshots, but direct URLs remained stable and observable
because `copyDir` admitted every file in the source directory. Rule: do not use a
blind directory copy as an artifact-admission policy. Allowlist generated output,
keep authored source separate from rendered derivatives, and test the exact
non-source public inventory. If an obsolete derivative has no consumer, delete
it rather than preserving an unaudited compatibility surface.

**Dependency-complete evidence must be regenerated after the final rebase.** A
late base update added website/test inputs after the branch receipts were fresh;
GitHub evaluated the merge ref and correctly found palette and visual receipts
stale even though branch-head checks had passed earlier. Rule: use the order
implementation → tests → final rebase → generation → freshness checks → merge-ref
CI. When a moving base changes an evidence input tree, regenerate from the new
base; do not copy conflict-side hashes or assume the earlier receipt survives.

**A successful workflow is not proof that its external side effect happened.**
The post-merge deployment workflow concluded `success` after explicitly skipping
the Cloudflare deploy because its secrets were unavailable; live probes still
returned the removed files. Rule: distinguish `deployed`, `skipped`, and `failed`
in automation and reports. Delivery closes only with a deployment/version
identity plus live HTTP probes for both retained and removed routes.

**A retry classifies a flake; it does not erase it.** The first PR CI attempt hit
two existing 10-second styled-matrix timeouts; the unchanged rerun passed. Rule:
record the first failure and why a rerun is justified. A repeated timeout needs a
budget, isolation, or performance fix instead of becoming ritual rerun policy.

## 2026-07 — cross-family aesthetics from the radar family (#161)

The full plan, the families-that-beat-radar table, a before/after radar mock, and an
every-family review against the union of lessons live in
[`../design/system/cross-family-aesthetics.md`](../design/system/cross-family-aesthetics.md).
The durable process lessons:

**Beauty is a property of the roles a family assigns, not of family rendering code.** Radar became a first-class citizen — hand-drawn/wash, every registered Palette × Look combination, halos, DOM identity — with *zero* new scene roles and *zero* new mark kinds, purely by lowering its marks onto existing roles (`pie-slice`/`grid`/`point`/`axis`/`legend`/`title`) whose traits the backends dispatch on (`rough-backend.ts:446-459`). Rule: a family opts into (or out of) the marquee look one role assignment at a time; audit which role each mark carries, and decide every `sketch:'none'` opt-out on the *signature* glyph on purpose — the recurring cross-family gap is a hand-drawn box holding a ruler-crisp icon/marker/glyph (architecture `raw` icons, er `cardinality`, class `<defs>` markers, mindmap/gitgraph `chrome` primaries).

**Share the palette, not just the palette *system*.** Timeline inherits the sketch/halo *look* of every Palette but paints all sections the same gray because it never derives hue from the accent; quadrant points are one accent with no categorical identity. `pieSliceColors(count, {accent,bg})` is the shared identity radar/pie use, and it hue-spreads past 6 categories where `getSeriesColor`'s mono ladder degrades. Rule: categorical color comes from the shared palette re-derived from `RenderContext.colors`, so a swap recolors for free and series identity matches across families — but only where a *series* concept exists (not sequence, not the monochromatic structural families; there it is an opt-in accent, never the baseline).

**The label concern is a ladder, and radar sits near its bottom.** Radar reserves *static* gutters; ER actively de-collides labels (`separateRelationshipLabels`), quadrant adds spiral placement with leader lines, gantt reserves *vertical* room per wrapped block (`rowAdvance`) and repairs-then-surfaces, timeline compresses to a width budget, flowchart draws a bordered knockout box (better than a bare paint-order halo over busy fills), journey gates label ink to WCAG-AA. Rule: hold every family to the *union* — wrap → compress → de-collide → leader-line → reserve vertical room → knockout-box → AA-gate — reaching for the highest rung its content needs, and copy the family that already implements that rung rather than reinventing it.

**A green rubric certifies the floor, not beauty.** `assessRenderedLayout`/`assessJourneyLayout` and the overlap-audit score finiteness, on-canvas, box-non-overlap, group tiling, and label presence — nothing scores recession, translucent blend, silhouette legibility, or palette harmony (those come free from roles). Rule: pair the deterministic gate with a one-line per-family aesthetic thesis ("the silhouette IS the message") written *before* the work; `bun run track` score 100 means you didn't break the floor, not that the diagram is beautiful.

**The reverse flow is real — radar did not invent every discipline it codified.** ER's active de-collision, quadrant's leader placement, gantt's vertical reservation, flowchart's knockout box, gitgraph's rotated-bounds packing, timeline's budget compression, and pie's largest-first admission each *beat* radar's own label handling. Rule: when improving one family, mine the whole family set for the best existing technique for that concern before writing a new one; the union of lessons flows in every direction, not just outward from the newest family.

## 2026-07 — closing Mermaid 11.16 fidelity gaps (#149)

**A zero-overlap claim is only as strong as the transforms the auditor understands.** GitGraph's hardest labels were rotated 45°, while the universal overlap auditor deliberately skipped arbitrary angles; its green result therefore said nothing about the visible collisions. Rule: audit final transformed corners for every emitted transform, add a discriminating rotated-label probe, and run the real-content corpus through the upgraded oracle before tuning spacing.

**Evidence layout can manufacture ugliness.** Squeezing a twelve-lane history into a two-column 300px card made readable source geometry illegible, while Mindmap's shared max-width columns charged both sides for one long label and created empty horizontal bands. Rule: measure both renderer geometry and presentation scale; size bilateral columns independently, pack from authored text bounds, and never use a thumbnail grid as the sole readability proof.

**A new family is not compatible with Style + Palette until composed rendering is tested.** Crisp family tests can stay green while a rough/hybrid look, palette CSS variables, strict security, or font metrics fail on the styled backend. Rule: enroll every family—and representative broad, deep, Unicode, long-label, and many-lane content—in deterministic look+palette stacks; assert palette precedence, finite geometry, semantic text, and reference safety rather than accepting a non-empty SVG.

**A PR screenshot is current only when its generator and URL are current.** An image can remain visually unchanged after source work and still be weak evidence if nobody reran its generator or if the PR points at an older head. Rule: regenerate every described artifact, fail on byte/receipt drift, bind dependency-complete receipts where practical, and update PR image URLs to the resulting immutable head.

**Popularity-weighted examples catch seams that official syntax cases miss.** The official GitGraph config tests proved `mainBranchName` parsing and the renderer honored it, yet a transit-map example showed `layoutMermaid` reparsing wrapper-less canonical source and reporting a false 0×0 layout. Explicit Mindmap `tidy-tree` had the same projection drift. Rule: supplement exact upstream oracles with diverse real-content scenarios selected from docs, issue demand, terminal corpora, and high-signal fork networks; run each through parse → verify/layout → serialize → SVG → terminal, not only the family renderer.

**A family is not faithful when its labels merely survive.** Mindmap accepted rich syntax and rendered every node, yet a one-sided dendrogram missed the family’s central, radiating metaphor. Rule: audit syntax coverage, semantic preservation, and recognizable family appearance separately; terminal availability is a fourth, independent claim.

**Promotion from opaque to native must close the serializer at the same time.** Flowchart icon/image and edge-presentation metadata could render before the agent body could reproduce it, so native parsing would have traded source fidelity for structure. Rule: remove an opaque fallback only after the typed model and canonical serializer reproduce every promoted key; keep dimensions or placement opaque until they are modeled too.

**The public geometry projection must use the renderer’s final label placement.** ER SVG already separated some duplicate labels, while `RenderedLayout` reported raw route midpoints and therefore disagreed with the pixels its readability gate was meant to audit. Rule: compute collision-separated positions once and share them with SVG and verification; reserve endpoint-marker zones as obstacles, then ratchet the global readability count to zero.

**Inert metadata is still sensitive in strict mode.** A safe Gantt URL in `data-href` could not fetch by itself, but strict security promises no external reference text at all. Rule: preserve safe inert interaction metadata in normal static output, strip it under `security: 'strict'`, and test callbacks and unsafe schemes remain absent in both modes.

**An external oracle’s old limitation is not the product contract.** Promoting Mermaid 11.16 XY labels, Sequence aliases, ER groups, and Flowchart metadata made several pinned expectations fail because they described this renderer’s former fallback rather than upstream semantics. Rule: retain upstream source/title/order provenance, but update executable expectations to the newly modeled meaning and document when an independent parser is too old to recognize it.

## 2026-07 — the all-family elevation PR (#142)

**A callback in an SDK declaration is not a callback across a sandbox boundary.** Code Mode cloned render options through JSON, which silently removed `onConfigDiagnostic` even though autocomplete advertised it. Rule: bridge callbacks explicitly—clone only data, collect host diagnostics, then invoke the hardened sandbox callback—and differential-test local and hosted harnesses.

**A family-specific hook is not wired until routing can select it.** State had a registered family hook, but shared source detection still classified `stateDiagram-v2` as Flowchart, so State-only configuration could never reach it. Rule: test detector → family registry → layout hook → geometry as one path; unit-testing the resolver alone is insufficient.

**Conformance compares semantics across parsers, not incidental declaration-order geometry.** The all-family property initially required byte-identical layout before and after canonical serialization. Architecture correctly canonicalizes declaration order, so equivalent structure can move without semantic drift. Rule: agent facts and renderer nodes/edges/groups must remain equal; geometry determinism is asserted separately for each canonical input.

**Partition config into wired, legacy, and value-sensitive fields.** Pretending legacy Dagre calibration has an ELK/measured-text equivalent is as dishonest as silently ignoring it. Rule: wire only faithful mappings with field-specific geometry probes; qualify warnings for legacy, invalid, unknown, and unavailable-renderer requests; test explicit options, source wrappers, and hosted envelopes.

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
notification), the gate will die quietly exactly when it matters. Three
consecutive scheduled failures are now a stop condition: fix, narrow, disable,
or delete the signal before expanding it.

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

## 2026-07 — terminal width and SVG contracts

**A hard width option is not a renamed wrapping hint.** Keep legacy `maxWidth`
best-effort behavior separate from `targetWidth`: measure display cells after
rendering, preserve grapheme clusters, and return a typed impossible-geometry
error instead of silently exceeding the caller's bound.

**Terminal coordinates are display cells, never UTF-16 indices.** Use
`visualWidth`, grapheme iteration, and continuation cells for sizing, centering,
clipping, writes, validation, and click-region metadata. A literal spacer after
a wide glyph makes it three cells wide; the continuation is canvas state, not
output text.

**Semantic identity and DOM-reference identity are different namespaces.**
Keep source-facing `data-id` stable, while `idPrefix` rewrites declared SVG
`id`s and every local URL/href/ARIA reference. Test the contract as an
all-family, two-instance matrix; testing one arrow marker cannot prove filters,
clip paths, gradients, or accessibility references safe.

## 2026-07 — family completion mechanics

**One happy mutation chain is not an operation contract.** The first focused
Mindmap/GitGraph mutation runs scored only 22.57% and 21.91% even though the
citizenship suite was green. Exhaustive per-operation tests—success, exact error,
null-clearing, ordering, cycle/duplicate guards, immutability, and verification
warnings—raised the latest local runs to 98.77% and 97.03%. A test that
touches every op name can still leave almost every branch unproved; mutation
evidence is a useful check on that distinction. The reports were gitignored
and the configs are diagnostic only, so retain a CI artifact or a
content-addressed report before presenting a local score as acceptance evidence.

**Treat mutation survivors as design feedback before classifying them.** The
GitGraph run exposed an unused `currentBranch` helper, which was removed rather
than “covered.” It also exposed missing clone, custom-main-branch, no-tag, and
non-target statement rewrite assertions. Only after those real gaps were closed
were the remaining canonicalization and discriminated-union equivalents
classified. Do not write the survivor rationale before trying to make it fail.

**Blank structured canvases and opaque-only content are different emptiness.**
The ER segment-preservation fix correctly kept an empty tolerated subgraph
opaque, but an over-broad zero-entity check also made a header-only `erDiagram`
opaque and broke MCP typed authoring. Gate the *reason* for emptiness (opaque
segments present), not only the resulting entity count; add a direct blank-
canvas test alongside the unsupported-syntax case.

**An aggregate compatibility fixture is not an upstream-suite harvest.** Count
every direct `it`/`it.each` block in source order and map it to an executable
portable/error case, an executable divergence, or a named source-inexpressible
exclusion. Bind the inventory to a commit and source-file hash. The complete
Mindmap/GitGraph pass exposed real inline-comment, legacy commit-message,
multiline accessibility, and mixed branch-order semantics that one synthetic
smoke case had hidden.

**Generated evidence needs registry-driven enrollment, not manual memory.** A
new family can pass rendering tests while remaining absent from contact sheets,
visual metrics, style matrices, tracker baselines, SDK declarations, or the
website. Every generated surface should either iterate the built-in registry or
have an exact-set test against it; regeneration comes only after the invariant
that explains the new bytes.

**Scene semantics must use the same numeric normalization as crisp output.** A
Mindmap polyline and several node dimensions differed only by floating-point
spellings (`106.35000000000001` vs `106.35`), but styled backends consume the
typed geometry, not the crisp string. Round once when constructing Scene
geometry and serialize that same value; do not weaken the fidelity oracle to
ignore drift.

**Typed strings must be closed under the serializer's line grammar.** A value
can pass a CSS-like or decoration parser yet contain `\n`, `\r`, `%%`, or a
closing delimiter that turns canonical output into a new node/entity/class on
reparse. Validate mutation-only paint with one shared single-line gate, and for
compact decoration grammars prove the prospective body through
serialize→parse structural equality. Success is not established until the
serialized result preserves identity, hierarchy, and field values.

**A direct upstream test block can expand to several executable cases.** Source
order and a file hash prove which `it(...)` call was harvested, but a constant
`for ... of` plus template interpolation can still hide manually fabricated
variants. AST-evaluate constant loop bindings and template spans, then compare
the exact expanded source list and order to the oracle. Likewise, SVG identity
completeness means exact `(id, role, from, to)` tuples; endpoint or element
counts cannot detect a deterministic wrong ID.

## 2026-07 — ecosystem parity follow-up

**A generated artifact can be fresh while its source is semantically stale.** The architecture SVG matched its committed Mermaid source, but both still claimed twelve families after the registry had fourteen. Validate source claims against the runtime registry before checking generated-byte freshness. Apply the same exact-set rule to editor diagnostics and characterization fixtures: support inventories are executable metadata, not prose to copy.

**Graph provenance is not graph reachability.** A GitGraph commit authored on another branch may already be in the current head's ancestry through branch creation or merge. Cherry-pick validity therefore requires a parent walk from the current head, not `source.branch !== currentBranch`. The discriminating test must construct inherited reachability; a same-branch rejection only proves the weaker rule.

**Delimiter concatenation is not an identity scheme.** `${from}->${to}` is ambiguous as soon as authored IDs may contain `->`; suffixes such as `:shape` have the same problem. Preserve readable legacy IDs only for a strictly safe atom alphabet, and encode all other tuples injectively. Test two different endpoint tuples that collide under concatenation and compare exact semantic IDs.

**Reserved-prefix grammars must fail closed.** In indentation-sensitive syntax, `::icon (x)`, `:::`, malformed shape delimiters, and empty accessibility directives are not harmless text: accepting them as default nodes changes meaning on canonical serialization. Pair rejection cases with successful parse→serialize→parse properties around every reserved prefix, not just malformed snapshots.

**A ledger needs executable coordinates, not only filenames.** A cited test file can exist and still contain no assertion for the row's claim. Store an exact `(row ID, cited file, test title)` mapping, require equality with every done row, and resolve each title against a declared `test`/`it`. Gaps found this way exposed three real weak claims: label-less ER relations, XYChart raster backgrounds, and Quadrant axis-label budgets.

**Cross-renderer comparisons should preserve authored semantics, not imitate pixels.** Render the same fixture in the official Mermaid version and local SVG/terminal engines, caption which node/commit/parent/shape properties to inspect, and state renderer differences. When a comparison tool does not support the family, retain its exact versioned error; do not substitute a different diagram and call it parity.
