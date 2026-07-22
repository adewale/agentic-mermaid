# Lessons learned

## 2026-07 — the sankey enrollment audit (what the machinery forced vs. what it let slide)

The sankey family enrolled cleanly through every gate the typechecker or a
registry-iterating test could see: `DiagramKind` rosters, scene admission,
fidelity oracles, doc-sync of warning codes, the tracker's auto-enrolling
group 9, and the citizenship matrix. An audit afterwards found every gap sat
in exactly the surfaces that were *hand-written per family* or *prose*:

**A contract enforced where a value is generated is not enforced where it is
consumed.** The palette guarantees WCAG/APCA visibility floors at generation
time, implicitly for opaque marks. Sankey applied those colors at 0.5 opacity
— the repo's first translucent sole-encoding marks — and the composited
ribbons dropped to WCAG ≈1.0 / APCA 0 on several built-in backgrounds with no
gate noticing. Fix: `ensureCompositedBgContrast` (effective-color floors) plus
a scene-tier registry-driven gate (`scene-effective-paint-contract.test.ts`)
that measures translucent connector paints where opacity is applied.

**Hand-written reach tests do not scale to the next family.** Radar's
palette-reach section in `perceptual-palette-impact.test.ts` was added by hand
in radar's PR; nothing enumerated category-channel families, so sankey simply
wasn't there. Same story for the union review table and the L9 aesthetic
thesis (prose conventions, zero forcing function). Fix: doc-sync gates that
enumerate `BUILTIN_FAMILY_METADATA` — a review-table row for every family, a
thesis for every non-grandfathered family — and a grandfathered ratchet list
that must not grow.

**Family-specific quality metrics are opt-in code; treat the opt-in as part of
enrollment.** The tracker auto-enrolled sankey into the generic family rubric,
but the journey-style family assessor (the metric that actually measures the
family's defining aesthetic — ribbon crossings here) had to be hand-added.
When adding a family, ask: what is this family's *domain-defining* invariant
(conservation → `FLOW_IMBALANCE` lint) and its *domain-defining* aesthetic
number (crossings → `sankeyCrossings`), and wire both before calling
enrollment done. The property harness immediately repaid this: it found a real
1px-visibility-floor overstack defect the fixture tests never reached.

Process lessons this repo has paid for, so they only have to be paid for once.
Each entry names the incident that taught it. Add new lessons at the top with a
date; do not delete old ones — supersede them in place.

> **Scope.** This is the short, dated contributor process log. For the
> long-form fork narrative and major-PR retrospectives, see
> [`../project/lessons-learned.md`](../project/lessons-learned.md).

## 2026-07 — MCP scope honesty and conformance

**An aggregate runner exit code is not task completeness.** One hosted attempt
returned zero from the harness even though all 80 Codex provider calls had
failed before producing traces. Rule: after execution, enumerate the exact
prepared run directories and require a successful provider return code,
complete process/provider/trace/operation observations, a completed final agent
message, and a non-empty output for every row. Write the failure receipt before
exiting so the rejected run remains diagnosable.

**A declared runner version is not provenance.** A stale 0.4.0 executable was
passed alongside the string `0.6.0`, changing workspace-trust behavior while
the receipt looked current. Rule: verify the installed distribution version
behind the exact runner binary, bind its digest, and fail before model calls
when the declared and installed versions disagree.

**A before/after run with byte-identical treatments is not an A/B test.** The
first hosted comparison changed repository code while both loaded skill trees
had identical blobs, so its numerical delta could not be attributed to the
skill. Rule: hold one neutral workspace, fixture tree, manifest, stimulus set,
and randomized schedule constant; hash both selected treatment trees; reject
the comparison unless those hashes differ and every non-treatment receipt
matches.

**Hash the model input, not a convenient description of it.** The first receipt
hashed selected IDs and path-shaped metadata, so an instruction edit or changed
workspace bytes could retain the same claimed stimulus/workspace identity.
Rule: canonicalize and hash every prepared task field the model can observe,
hash workspace contents, bind the emitted JSONL bytes, and make downstream
execution, output, and report receipts recompute those digests rather than trust
copied labels.

**Freeze the treatment before the release matrix, then test generalization
elsewhere.** Focused follow-ups found useful prompt improvements but were not a
substitute for rerunning the complete repeated matrix over the final skill tree.
Rule: use three repetitions for iteration, five exact repetitions for release,
and report tune-set gains as tune-set gains. Keep holdout prompts and keys
private together; do not tune after opening them, and do not send them to a
hosted model without explicit data-egress approval. A small green canary can
still miss stochastic schema and response-shape errors; stress the failing
slice at higher repetition, freeze the resulting treatment, then run the full
release matrix once and report it as-is.

**A summary file is not a reproducible result.** A hand-maintained aggregate can
outlive the runs or silently describe a different treatment. Rule: publish the
generated comparison with an archive of prepared tasks, runner manifest,
execution/materialization receipts, immutable traces, outputs, and grader
reports; content-address both payload and archive, verify after fresh extraction,
and prove regeneration is byte-identical with relocated run roots.

**An instruction to ignore a component is not an ablation.** The initial four
arms mounted the full skill and merely told the model to disregard a named rule,
making them non-blind and impossible to confirmation-grade. Rule: declare an
exact section, patch, list item, or resource removal; materialize the altered
skill trees; require different hashes and zero isolation warnings; and teach
manifest relocation to rebase both `skill_root` and repository patch paths.

**The no-skill arm must be isolated by construction.** Prepared rows carried
both project skills even for hosted-diagram tasks, including the unrelated live
editor skill, and older harness output left skill paths on `without_skill`
rows. Agents spent up to 768,563 input tokens in one run and could still reach
the treatment from the repository. Rule: make workspace, fixtures, and skill
tree independent roots, filter to the skill the case targets, use a neutral
workspace when repository access is unnecessary, and emit no treatment paths
for the control arm.

**A normalized event summary is not answer evidence.** The former harness 0.4.0 retained
the complete Codex final message in `trace.jsonl` but wrote only its first 500
characters to `output.md`. Valid request JSON placed after a short explanation
was cut mid-token and graded as absent. Rule: materialize the full final message
from the immutable trace before grading, rewrite only when the shorter artifact
is an exact prefix, preserve the adapter output, record content digests, and
fail closed on any mismatch.

**Execute a proposed request instead of grading its vocabulary.** Keyword
assertions gave credit to invalid hosted calls with anonymous argument objects,
wrong JSON-RPC methods, `classDiagram` as a family, or library APIs in place of
direct tools. Rule: require one machine-readable `{tool, arguments}` envelope,
validate it against the advertised closed schema, and run it through the same
production verify/describe/mutation core. Bind exact source bytes, requested
detail fields, relationship direction/kind, and the response envelope itself;
near-matches such as a missing terminal newline or a second JSON block must
fail. Keep a semantic judge for honesty and interpretation that the executable
oracle cannot establish, and count those rows as deferred until calibrated.

**Optional expected behavior must not become a mandatory literal.** The
underspecified-quality case said an agent *may* inspect read-only, then failed
safe clarifying answers that did not contain `verify`, `describe`, or `render`.
Rule: deterministic gates cover required behavior and forbidden actions;
optional phrasing belongs in a soft semantic rubric. Report both mean assertion
fraction and all-graded-assertions pass rate so partial credit cannot look like
complete success, while disclosing deferred semantic rows separately.

**Model identity is surface-specific.** The hosted receipt requested an API
snapshot name that ChatGPT Codex rejected, then actually ran a stable alias.
Rule: configure the model per executor/auth surface, record requested and
accepted identities separately, and never stamp a configured snapshot onto
traces that ran another model name.

**Protocol compliance belongs to a surface and transport, not to a shared
dispatcher.** The dispatcher understood five revisions, but the local stdio
transport could not receive the batches required by `2025-03-26`, and the
hosted POST-only endpoint could not honestly claim the `2024-11-05` HTTP+SSE
transport. Rule: advertise the intersection of message semantics, transport
obligations, and implemented handlers. Test each transport's advertised version
list independently; shared code is not evidence that every caller serves the
same protocol.

**An empty optional namespace is still a capability claim.** Returning empty
`prompts/list` and `resources/list` results while advertising both capabilities
made clients and conformance probes reasonably treat those methods as product
surface. Rule: omit optional capabilities that the product does not implement,
and return Method Not Found for their methods. Do not add fake empty handlers or
diagnostic tools merely to make a generic harness look greener.

**A protocol error that answers a parsed request must preserve its id.** The
hosted endpoint rejected an unsupported protocol header before reading the body,
so it returned `id: null` even when the request carried a valid id. Rule: keep
transport refusals before parsing, but perform request-level version admission
after a bounded body read. Invalid modern metadata is `-32602`; a real
header/body mirror disagreement is `-32020`; an unsupported revision is
`-32022` with the correlated request id and retryable supported-version list.

**Official conformance needs a strict applicability boundary.** The upstream
caching scenario probes prompts and resources even when discovery omits them,
and several stateless checks require specially named diagnostic tools. Rule:
commit a narrow expected-failure baseline only for demonstrably inapplicable
fixtures, fail on every unlisted failure, and also fail when a baseline entry
unexpectedly passes. Product discovery must remain more honest than the test
fixture.

**Eval volume, provenance, and answer leakage are separate quality axes.** A
271-example documentation corpus was dominated by flowcharts, aggregate layout
rates could hide a one-example family regression, and literal prompt phrases
appeared in output assertions. Rule: publish family-macro and example-micro
rates together, pin corpus commit/count provenance, state known family skew, tag
every agent case for slice reporting, and replace answer-shaped keyword checks
with structural or artifact assertions.

**A hidden prompt with a public answer key is not hidden.** The holdout and
holdback rows omitted prompt text but retained expected behavior and literal
assertions in the committed manifest. The documented strict command also could
not run because the ignored prompt bundle did not exist. Rule: publish only the
case identity, taxonomy, fixture reference, and private prompt reference; keep
the prompt and its full answer key in one ignored bundle, hydrate them only at
execution time, and make strict validation part of the evidence receipt.

**Prepared tasks must resolve from the directory the harness actually uses.**
Skill paths written as repository-root-relative were resolved from
`skill-evals/`, and artifact prompts wrote to a checkout while `file_exists`
graded a run directory. Both failures could make the treatment ineffective or
turn correct work into a false negative. Rule: inspect a prepared task before a
large run, re-home skills and fixtures to the exact compared checkout, and make
artifact destinations absolute under that run's grading root.

**Evaluate the evaluator before evaluating the agent.** Expanding 31 cases to
39 improved intended coverage but did not show that the assertions could detect
their named faults, did not execute the new rows, and left a one-run two-case
smoke as the latest result. Rule: feed known-good controls plus targeted
sabotage across every assertion class, run with/without treatment at least three times, execute
trigger precision separately, and publish per-slice failures, variance,
timeouts, tokens, latency, and cost. Manifests are inputs; completed repeated
runs are evidence.

**A test must not inherit an input that its own comment says may hang.** The
TTY guard's positive-control case called `readFileSync(0)` inside the aggregate
runner and could wait forever on the runner's open stdin. Rule: give blocking
input paths a real bounded subprocess pipe and close it explicitly; a timeout
comment is not an oracle.

## 2026-07 — hosted MCP production rollout (#228, #233–#236)

**Treat production promotion as a transaction.** The first workflow could report
success without proving the intended bytes were live; later attempts exposed
credential, upload-result, rate-limit, and response-parsing failures at different
state transitions. Rule: bind a candidate to the exact successful main SHA,
attach it at zero traffic, test it through production, re-check the target,
promote that immutable version, and keep rollback armed until final identity and
behavior pass.

**Put the production rate budget below every probe.** Pacing only the long E2E
script still let smoke and final verification burst into the WAF. A phase-local
sleep also forgets requests spent by earlier phases. Rule: one shared helper owns
every production request and one job-wide timestamp owns the rolling cadence;
contract tests reject bare bypasses. Also enumerate equivalent compute routes:
protecting `/mcp` alone says nothing about `/.well-known/mcp` when both dispatch
to the same handler.

**Parse machine output structurally all the way down.** Wrangler's uploaded
version identifier moved inside structured JSON, and a valid MCP tool result put
its application JSON inside `result.content[].text`. Grepping either output made
correct responses look broken. Rule: validate cardinality and type at each layer,
decode nested JSON explicitly, and make malformed fixtures fail the same helper
production uses.

**Crossing the production edge is a separate interop claim.** The reference SDK
unit lane proves an external client drives the handler, but it bypasses Cloudflare,
the deployed Worker, and the public route. Rule: before promotion, run a pinned
official client against the live URL, record server identity, negotiated version,
session behavior, exact tools, and one real call. Keep the limitation honest: the
stable `1.29.0` client exercised `2025-11-25`, not the unreleased final
`2026-07-28` client path.

## 2026-07 — BUILD-31 lazy browser split

**A green aggregate suite can hide an import-order bug.** The family-loaded
browser entry correctly stopped importing the complete registry, but the legacy
Flowchart/State parser still depended on that registry installing a resolver as
a module side effect. The full local suite passed because another test imported
the registry first; the isolated 2,800-case CI process parsed every case as an
unsupported family and performed zero layouts. Rule: a lazy boundary must leave
direct core imports independently initialized. Share only the lightweight
compatibility authority below that boundary, and add a fresh-process test that
cannot inherit another test's module cache. A detector copied into generated
source through `Function#toString()` must also be dependency-free: the first fix
serialized a reference to an unimported normalizer, so the website payload
capture—not the bundler—caught the broken demo. Typecheck generated source and
exercise the built page before accepting a source-level unit test.

**Drive browser artifacts through the path users actually take.** Two Linux CI
runs hung for exactly 300 seconds while WebKit received the 2.9 MB compatibility
bundle through Playwright's `addScriptTag({ path })` control channel, even though
the WebKit lazy-ESM test passed immediately in the same run and all 89 browser
contracts passed locally. A browser distribution contract should serve the
artifact over loopback and load a real `<script src>`/ESM URL, then assert both
the network request and the rendered result. This removes the automation
transport from the product signal without weakening the browser guarantee.

## 2026-07 — browser distribution and the 0.3.0 bump

**Verify against the toolchain CI pins, not the one on `PATH`.** `bun run test` re-invokes bare `bun`, which resolves from `PATH` — so running a pinned 1.3.13 binary as `<pinned>/bun run test` still executes the suite under the system 1.3.11. Compression output differs between those versions, which produced two phantom "pre-existing failures" that passed when the same files were invoked directly. Worse, before spotting it, four checked-in editor deep links were "repaired" against the wrong Bun, turning a contract that passed on CI into one that failed there. Rule: when a recorded artifact embeds a toolchain (`eval/website-payload/baseline.json` names bun/playwright/chromium), match it before concluding anything from a red test, and check which binary a script actually ran rather than which one you invoked.

**Confirm the sabotage landed before trusting what a green run means.** A red→green check used an anchored `sed` that silently matched nothing, because the minified artifact opens with `"use strict";`. The suite stayed green and that was nearly recorded as evidence the test discriminated. Rule: assert the sabotage is present — grep for it — before running the test that is supposed to fail.

**A `0.x` caret pin is minor-bounded, so a minor bump is a breaking change to it.** Five built-in registrations declared `core: '^0.2.0'`, which means `<0.3.0`. Bumping `PACKAGE_VERSION` made every built-in registration incompatible; the registries never finished initializing and it surfaced as `ReferenceError: Cannot access 'REGISTRY' before initialization` across 4,722 unrelated tests, nowhere near the cause. Rule: pins that track the package version need a guard test that fails first and names the fix, not a comment.

**Regenerating an artifact is not the same as correcting it.** Evidence generators re-rasterize their PNGs, and rasterization varies by environment — clean `main` reproduced the same PNG drift in the same sandbox, so committing regenerated images would have baked local font rendering into approved visual evidence. Only the input hashes had actually changed. Rule: when a receipt fails, find out which field moved; update that field the way its own test computes it (one receipt prepends `manifest.json` to the transitive closure, and missing that wrote a hash over the wrong input set), and leave approved bytes alone.
## 2026-07 — post-merge route-verification audit (#88, #190)

**A generated counterexample is evidence about an invariant, not automatically a product requirement.** The issue #88 investigation expanded from route-contract closure into a general endpoint and arrowhead repair largely in response to degenerate generated diagrams. That repair added routing, label, marker, and certificate machinery before the input domain, prevalence, and visual value were clear; most of it was later removed. Rule: before production code responds to a generated failure, establish that the input is supported, the defect is user-reachable and materially harmful, and the proposed invariant has representative before/after witnesses. Keep other pathological cases as discovery evidence or telemetry, not silent product policy.

**Rollback the mechanism, retain the discriminating evidence.** Removing the rejected endpoint router did not require forgetting why it had been attempted. The useful residue was the bounded problem statement, representative regression witnesses, one canonical 2,800-case runner, receipts, and sabotage probes. Rule: when an approach is too broad or costly, subtract the production mechanism while preserving the smallest tests, measurements, and reproducers that can distinguish a future better solution.

**Share an expensive artifact, not its proof.** The old hitch and edge-through-node paths performed 4,800 layouts in 30.44 seconds locally. One runner now lays out 2,800 cases once in 17.33 seconds and fans the positioned graphs into hitch, rubric, route-audit, and certificate observations: 41.7% fewer layouts, 43.1% less local time, and 40% more edge-through-node coverage. Rule: consolidate traversal and expensive production, but keep obligation enumeration and correctness oracles independently implemented so one shared mistake cannot certify itself.

**Severity vocabulary must have one executable meaning.** `offOutlineEndpoints` was documented as a hard metric, classified as cosmetic elsewhere, and recorded under `hardViolations` while treated as non-blocking telemetry by the canonical runner. Rule: a named severity has one authority and one gate policy. Either prove and enforce the invariant across an enrolled domain, or rename and scope the observation; do not silently downgrade it in a consumer.

**A detector is not part of an audit until the public command reaches it.** `auditRenderedRoutes` existed and tests exercised it, while `audit:ugly` described shared-label checks without calling that detector. Rule: test command-to-detector reachability with a known failing fixture, expose detector enrollment in the receipt, and distinguish “implemented” from “integrated.”

**Derived defaults need provenance before projection.** XYChart derives a y-axis range when the author omits one. Projecting that convenient render-time value into the agent AST made serialization invent syntax the user never wrote. Rule: when one model feeds both rendering and source editing, distinguish authored, normalized, and derived values at the authority boundary; serialize only authored state unless the operation explicitly materializes a default.

**A shared boundary is incomplete if a later repair owns its own attachment math.** Sharing shape paint and initial clipping still allowed route shortening to put semantic polygons and small circles back on their layout boxes. Rule: enumerate every producer that can write the final endpoint, then make all of them consume one boundary-plus-side profile. Keep the final checker independent and exercise every shape through a forced late-repair path, not only a happy-path layout.

**Serializer closure is part of an admitted mutation domain.** XYChart mutation accepted every finite JavaScript number while its serializer emitted exponent notation that the pinned Mermaid grammar rejects. Rule: if an operation admits a value, construct syntax guaranteed to reparse into the same family; test language boundaries such as subnormals and exponent thresholds, and reject a mutation if reparsing changes either diagram or body kind.

**Relationship removal can erase implicit entities.** State transitions may introduce their endpoints without standalone declarations. Removing the last transition used to leave the state in the typed body while serialization silently omitted it. Rule: when a relationship mutation strands an implicit entity, either remove that entity by contract or promote it to an explicit declaration before returning. Enforce family-and-body closure at the mutation boundary so this loss is found immediately.

**Run the repository's test command, not the runner's broad default.** Bare `bun test` also discovers checked-in upstream Mermaid `*.spec.ts` source fixtures whose upstream-only imports are deliberately unavailable. The canonical `bun run test` scopes execution to `src/__tests__/` and tests harvested cases through repository adapters. Diagnose discovery errors before calling them product regressions, but still run the declared full suite after focused passes.

## 2026-07 — subtraction and release readiness (#205)

**A live dependency audit is a release input, not background noise.** The PR's behavioral lanes were green, but a newly disclosed advisory in Stryker's `minimatch` chain stopped the quality job before the repository-specific checks ran. Rule: preserve the audit gate, resolve the smallest compatible transitive version explicitly, prove the dependent tool still runs, and distinguish inherited aggregate failures from product regressions.

**Subtraction must retain an explicit portable boundary.** Removing audit-only exports was useful, but an initial pass also removed the only clearly browser/workerd-safe agent entry and left consumers to depend on bundler tree-shaking around native PNG code. Rule: name and test the portable contract directly; package reduction is successful only when each retained runtime has an install-and-import proof.

**The final dependency graph belongs before final evidence generation.** Package and lockfile edits after gallery generation left provenance receipts stale even though image bytes did not change. Rule: finish exports, dependency placement, overrides, and version metadata before regenerating receipts; then run the merge-ref CI rather than treating branch-head freshness as final.

**A version bump is a projection update, not a scalar edit.** The canonical package and primary registry metadata advanced together, but the hosted registry copy, generated agent guidance, and compatibility-message assertions still carried the previous version. Rule: keep one version authority wherever runtime behavior permits, derive assertions from it, regenerate declared projections, and let a distribution-version contract enumerate the few copies that must remain materialized.

**A release-only platform gate is still part of the product test topology.** Making Worker outputs ephemeral caused the Windows release smoke to build the website during test preload, exposing a resolver branch that treated every non-Linux host as macOS and probed `/dev/fd`. Rule: enumerate platform capabilities explicitly, keep the portable security proof authoritative when an optional OS proof is unavailable, and exercise release-platform setup before a release event can become the first caller.

**A file URL pathname is not a portable filesystem path.** After the resolver fix, the same Windows release smoke advanced far enough to expose editor generation passing `/D:/...` from `URL.pathname` into `Bun.build`; POSIX CI had hidden the distinction because URL paths and local paths coincide there. Rule: convert `file:` URLs with `fileURLToPath`, join local descendants with `node:path`, and keep a Windows execution lane for generators that feed release tests.

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

## 2026-07 — ownership as a subtraction tool

**Universal syntax belongs before family dispatch.** Accessibility directives had accumulated in renderer parsers, structured-agent parsers, and family-specific tokenizers, so adding a family meant copying grammar and inheriting subtly different colon, block, suffix, and malformed-input behavior. Normalize universal directives once, pass families a directive-free grammar view plus typed metadata, and retain shared-parser adapters only where a public direct parser still needs compatibility. The extension contract must prove a newly registered family gets this behavior without family code.

**Preservation needs one owner for every byte—and one owner for every universal semantic.** Treat the parsed wrapper as the exact prefix before the family header—even when that prefix is empty or only a UTF-8 BOM—and the opaque family source as the exact suffix from that boundary. If the family body is instead derived from a separately normalized view, comments or directives can belong to both fields and be duplicated when a descriptor is replaced. Structured serializers are different: their grammar view deliberately excludes universal init directives, so config authored after the header must be re-emitted by the shared envelope unless the serializer's actual output already contains those bytes. Descriptor identity alone cannot decide ownership because a matching source-preserving serializer may deliberately return `body.source`. Neither can authored bytes or insertion-order JSON: ask the shared grammar what the emitted text contains and compare recursively key-sorted config, because preserving source while reformatting or sorting a directive is still preservation. Canonical mode must remove the source-preserving copy through the shared universal grammar and fold every parseable directive into effective frontmatter in authored order. Re-emitting an earlier raw directive all-or-nothing is unsafe when only one leaf was overridden or an object was replaced by a scalar, array, or null: the stale raw value then overrides the final frontmatter and breaks idempotence. Preserve raw only when the directive cannot be parsed. Regex whitespace at a line boundary must be horizontal-only; `\s` crosses CR/LF and can erase the next indentation-sensitive statement. When a transform moves bytes between owners, use metadata from the rebuilt artifact rather than mixing a new source map with old wrapper metadata, but retain loss receipts that reparsing an already-canonical artifact can no longer reconstruct. Use normalized text only to recognize wrapper constructs; retain original spans so CRLF and other authored formatting survive, and test canonical, mutation, source-returning, and replaced extension descriptors.

**A command should own one artifact boundary.** `typecheck` silently built the website and every Bun test silently inherited the same build through a global preload. That made unrelated parser tests mutate generated state and obscured which tests actually consume website artifacts. Keep `typecheck` as `tsc --noEmit`; let website-consuming suites request their build fixture explicitly; let browser runners build their own served artifact.

**Production payloads should not carry authoring structure.** Source-fragment comments help maintain the editor template and inline CSS, but the build was copying them verbatim into the public HTML and consuming a strict payload budget without affecting the DOM or cascade. Strip author-only HTML and style comments after extracting executable source, then ratchet raw and compressed ceilings to the measured smaller artifact.

**A release should attest CI, not impersonate it—and attestation must precede credentials.** Repeating the full CI graph on a release event doubles runtime and creates a second, slowly drifting definition of “green.” Require canonical CI success for the exact immutable release SHA before checked-out code can reach credentials, retain genuinely platform-distinct smoke coverage, and grant OIDC only to minimal registry jobs. Build and `npm pack` once in an unprivileged job, compare the real tarball against a reviewed fail-closed manifest, transfer it with a digest, and publish that exact `.tgz`; a dry-run followed by directory publication only inspects one pack and publishes another.

**Retryability needs a durable verified input.** Separating npm and MCP Registry publication avoids republishing an immutable npm version, but only while the exact inspected artifact still exists. Retain the digest-bound tarball for the operational recovery window so a later MCP-only retry cannot be stranded after npm has already succeeded.

**Immutable publication still needs idempotent recovery.** A registry can commit a version before the runner records success. For npm, treat an existing version as success only after independently hashing the retained tarball and matching that SHA-512 integrity to the registry record. For the MCP Registry, query the exact name-and-version endpoint, compare its publisher-owned `.server` object structurally with the verified `server.json`, and separately require the Registry's mutable official status to remain `active`; other registry-owned `_meta` fields are expected to differ, but a deleted or deprecated record is not a successful publication. In both cases absence means publish, while a mismatch, inactive record, or ambiguous preflight must fail closed. Otherwise a lost response can permanently strand downstream publication, bless different immutable content, or report success for a record removed by moderation.

**An integrity check must bind identity as well as bytes.** A checksum can validate one file while a neighboring manifest selects another, and interpolating an artifact-controlled filename into shell source turns a data boundary into code execution inside the credentialed job. Give transferred release files fixed names, require an exact regular-file set, compare manifest digest, checksum record, and recomputed bytes, and pass even fixed paths through environment variables rather than workflow-expression interpolation in shell source.
