# Native layout 0.6 correctness work log

The [qualification work plan](layout-0.6-qualification.md) records the six goals
and proposed evidence; its additional research methods are not acceptance gates.
[TODO.md](../../../TODO.md#owned-graph-backend-qualification-owner-request-pr-449)
remains the sole backlog. Entries record bounded evidence, not completed parity.

## 28 October 2026: scalar-line emission authority and State coverage

PR #449 was already merged and closed. Its retained branch
`feat/dual-graph-layout-backends` was still at `d4b057246c`. The existing clean
workspace was reused, with no active competing writers. Normal merge
`37a1881c91084bafebc93859d6fc56cf5dcd2e08` integrates Main
`fb91dcd3f0382a5ad3508724b8f087ef383bbcca`; its tree exactly matched that Main
before this tranche. No PR was reopened or merged by this continuation.

### Implemented

- `55bb9df44b42c0ca04344e2d7c357b91a43b71cd`: bind Native scalar-line inspection to the sole writer's numeric
  coordinates. The existing paid immutable capture retains a private served
  line when formatting changes its coordinates. Original captured operands
  still supply validation and SVG writing; inspection derives fresh contour
  endpoints and tangents from the served line. A nonzero line rounded to zero,
  a changed line with a local transform, insufficient work or unstable captured
  geometry kind remains conditional. Changed-view construction is charged;
  arbitrary point/path work is not hidden inside scalar visits. Descriptor
  copying preserves deferred projection laziness. All production caps remain.
- `77293e2730e5e7b226bc7eb222a700de03de8e09`: extend the existing State owner with two independently authored
  development guards. Six states, two nested groups, ten ordered transitions,
  three contextual starts, parallel/reciprocal/self edges, collision-prone
  names, Unicode and a note are specified before parsing. Original source,
  canonical source and JSON-source reload produce six SVG observations across
  explicit Native/ELK with fallback disabled. Independent XML checks cover
  occurrences, immediate parents, scope containment, actual rounded-outline
  centreline contacts and tip-anchored marker resources.

### Verification

The genuine baseline failure is a line from
`(40.00000000000001,40.00000000000001)` to `(40,40)`. Its written SVG line has
both endpoints at `(40,40)`, changing automatic arrow orientation. A later
white rectangle completely covers the emitted arrow, while the old raw-space
proof incorrectly passed. Independent Resvg readback finds zero dark pixels;
removing only the known cover reveals 30. The integer control retains 34 visible
pixels. The owning regression is RED before the fix (one pass, one failure),
then GREEN. A third fractional, noncollapsed line remains passed and visibly
present, with literal served endpoint/tangent expectations. Both retained
660-byte baseline SVGs are directly byte-equal after the proof repair.

Final three owning files pass **335 tests / 4,520 assertions / zero failures**:

```sh
bun test --timeout 30000 src/__tests__/paint-certification.test.ts \
  src/__tests__/scene-native-validation.test.ts src/__tests__/agent-state.test.ts
bun run typecheck
bun run lint
```

The existing mutation/getter/CSS/resource/ownership/viewport and 4,000/50,000-point
controls remain. Two additional controls reject polygon-to-line substitution
and accidental terminal-only getter evaluation. Targeted synthetic fault
injection makes each fail; restored controls pass. These injections are distinct
from the genuine pre-existing rounding failure. Source review prompted kind
consistency and descriptor-copy hardening. Independent reviewers checked actual
SVG/raster evidence and corrected the new State oracle's initial XML ownership
and rounded-corner assumptions.

Canonical core/repository typechecks and lint pass on the final code/tests.
An earlier core check found two new readonly-array assertion typing errors;
they were corrected without weakening assertions. Lint retains one existing
oversized-JSON warning. Diff whitespace checks pass. The full unit suite was not
run locally; the subsequent manual CI checkpoint is recorded below.

### Subsequent CI checkpoint

[CI 40657347695](https://github.com/adewale/agentic-mermaid/actions/runs/40657347695)
completed on exact head `38af82155e5b4ecdfd7a1431f1e9a3497b7f50dc` using the
existing workflow dispatch, without reopening a PR. Its checkout logs bind that
commit directly, rather than an inferred PR merge checkout.

- Units: **14,500 passed / 76 skipped / zero failed**, with shard passes
  4,983 + 5,258 + 4,259. Independent semantic assertions pass 173 tests;
  63/64 modern assertions are qualified, one remains unavailable. The reviewed
  882-input grammar replay has zero untracked defects.
- Node22/24 installed consumers, CLI, MCP, dist, quickstarts and browser-site
  pass. CI types/lint pass. The PR-event red/green job is skipped on manual
  dispatch; the genuine local baseline RED and synthetic controls above remain
  the recorded discrimination evidence.
- **CI remains failed.** Lazy delivery has 58 violations, versus the prior 55;
  Quadrant, Radar and Sankey add raw-size failures. Editor raw size is
  **4,659,411 > 4,429,400**, up 1,628 bytes from the preceding baseline;
  the browser run has 21 passes and one failure, and does not reach its gzip
  assertion. Demo requests remain **38 > 36**, stopping relative comparison.
  No cap or check is relaxed.
- All eight advisory comparisons retain zero engine status differences. The
  234-source report retains 47 regressions, 51 improvements, 135 other changes
  and one unchanged case. These compare Native with ELK, not this head with
  Main, and do not establish aesthetic or correctness parity.

Main advanced during CI to `15b47663ad04947714282e487274d20bbdc956a7`
(Event Modeling label-length verification, two disjoint files). That commit is
not integrated into this tested candidate. This evidence records the tested
`fb91dcd3` integration, not qualification of the newer combined tree. The
subsequent work-log update changes documentation only; no fresh CI result for
that documentation commit or readiness claim is inferred.

### Limits and next concrete step

This increment does not establish complete same-emission authority for generic
Scene inspection, polylines, paths, compound children, numeric stroke widths,
marker-resource geometry, transforms or text. Paint-only inspection views are
not general serializable/terminal marks. The State guards cover default crisp,
normal-cache, finite untransformed geometry; they do not prove full-stroke,
font-outline, visibility, raster, terminal or cache-OFF correspondence.

All new inputs are development cases. No holdout sources were opened or new
confirmatory qualification claimed. No original seven-U population acquisition
was repeated; its current counts are not inferred from these owner tests. All
six 0.6 goals, the original seven diagrams and two State loop-allocation warnings
remain open. There was no performance tuning, timing campaign, dependency
installation, cap change, default switch, version bump or publication.

Peer observations remain unavailable: the private Trident workspace is clean
at `240a8a521b8ef9e73003f6a28724c5a6fd062478`, but the normal launcher pins
`0a0453c8` and Mermaid provider execution observation is not qualified. The old
admitted Agentic archive belongs to `e8c84a44`, not these commits. No peer call,
Trident push or pin change occurred.

Next implement one served stroke witness at the existing marker-paint owner,
including complete cap/viewport separation and an actual hidden-ink negative
control. Marker existence alone must not grant a pass. Then qualify applicable
original sources under both engines/cache policies without raising limits.

Detailed local evidence is retained under
`/tmp/pr449-20261028-emission-controls/`,
`/tmp/pr449-20261028-final-checks/` and
`/tmp/pr449-coverage-state-20261028.json`; the recovery continuation is
`/workspace/pr449-evidence/recovery-20261027/root/CONTINUATION-20261027.json`.

## 28 October 2026, continued: exact circle-stroke witness

Normal merge `34e1df3958ab9ddf7498c2b2116312a528cbab6e` integrates Main
`15b47663ad04947714282e487274d20bbdc956a7`, preserving the prior campaign.
The incoming Event Modeling owner passes 23 tests / 2,652 assertions. All five
requested Sol6.1 High agents contributed; three initially encountered model
capacity errors and resumed on the same model after bounded retries. No other
writer's changes were overwritten.

### Implemented and checked

- `f8a4b8347dc246e2e9f6fb2b9b0ebac45f161d11` adds a sufficient Native
  stroke-only circle proof. One real ring point and its complete stroke envelope
  use exact integer/cardinal arithmetic, with bounded canonical widths and full
  viewport containment. Exact contour metadata is required. Fresh complete
  bounds are unioned with the original conservative bounds; none are reduced.
  The same point must survive every relevant later body. Unsupported later
  carriers, text or shapes, non-normal paint order and viewport repair decline
  this new proof. Existing checks and work limits remain authoritative.
- The private same-emission context binds one ordered root and exact referenced
  marker resources. Unsupported styles/groups/document fragments, ambiguous IDs,
  malformed root/definition context or unbound resources disable only the new
  circle proof. Resource comparison and XML checks reuse already-paid emission
  observations. All added variable walks and changed proof work are charged.
- `3f445dff209fa1f8bdb5360d706111051e0a2392` adds four source-to-SVG guards
  for circle/cross marks at cylinder contacts under Native and ELK, with fallback
  disabled. Independent authored identities/directions, all five cylinder paint
  pieces, both cross diagonals, full resource-stroke viewport containment and
  actual marker contacts are checked. Each marker's raster is isolated from
  shafts/other markers; removing its stroke must remove its red ink. These are
  baseline-passing development guards, not bug-fix red/green evidence.

The clear circle fixture is genuinely RED before implementation: its actual
707-byte SVG has visible ring ink but the old certificate is unverified. With
the proof it passes, while covered, clipped, CSS-hidden, numeric-unstable and
own/later white-carrier erasure controls remain non-passed. Four ring pixels in
the dedicated window are separated from both shaft and card stroke by 1.5px.
All nine retained full SVGs and raster observations directly match before/after;
only the clear fixture changes U to P. Fourteen owning controls pass.

Final local checks on frozen code:

- Paint certification + Native validation: **280 passed, zero failed,
  1,403 assertions**, including existing 4,000/50,000-point, getter/mutation,
  CSS/resource/ownership/viewport and budget controls.
- Endpoint contacts: **61 passed, zero failed, 978 assertions**.
- Canonical core/repository typechecks and 1,798-file lint pass; one existing
  oversized-JSON warning remains. Diff whitespace checks pass.

Source reviews closed concrete ordering/ID-custody, raw-tangent broadphase and
own/later-carrier erasure concerns before freeze. Independent artifact review
checks actual emitted geometry and ink, rather than treating a helper pass as
final visible output. The subsequent full CI result, if dispatched, is recorded
in the recovery continuation and existing PR description with its exact head;
this local checkpoint does not claim CI readiness.

### Preserved adverse and unavailable observations

The initial width-3 reciprocal coverage source remains enrolled separately.
Both actual engine receipts are U. Its circle stroke extends 0.75px inward from
the anchor versus a 0.375px node-border half-band, leaving a 0.375px intrusion
beyond the existing contact contract. This is an unresolved producer geometry
issue, not an incorrect-accepted/P finding. ELK's cross attaches at a cap/top;
the first side-only observer was inapplicable there, not evidence of a defect.
All source/SVG/receipt/marker isolation and failed observer records are retained.

Exactly one current public original-case acquisition was made: row 87, strict
Native, cache OFF. It exits zero, is reaped, makes zero ELK calls and preserves
source/dependency/link guards. Its complete 2,999-byte SVG and entire final
receipt directly equal the retained `52924301` result: **U**, one B occlusion,
22,628 operations under 400,000. Passive same-call models preserve authored A/B
and one A-to-B circle-ended edge. The captured whole source diff directly equals
the committed code diff above; the acquisition retains its original dirty-source
revision rather than being relabelled. No other original source was rerendered.
Offline PNG readback finds 14 ring pixels versus zero in a marker-absent copy.
An initial raw-buffer raster assertion confused premultiplied edge colours;
that failed observer is retained, and straight-RGBA readback uses the same saved
PNGs without a source-call or rendering retry.

This new positive domain is deliberately flat, integer, stylesheet-free and
circle-only. Ordinary public roots/styles/groups, fractional marker resources,
crosses, cubics and general compound bodies remain outside it. Original row 87
therefore remains unverified. All seven originals and all six 0.6 goals remain
open. No holdout was opened, peer renderer acquired, performance tuned, quota
raised, default changed or release published.

Next extend exact same-emission marker-resource and group/stylesheet authority
before applying the circle proof to ordinary original cases. Preserve the new
wide-stroke counterexample for its producer repair; do not relax the circle
admission guards merely to obtain a public P.

Evidence directories: `/tmp/pr449-20261028-stroke-controls/`,
`/tmp/pr449-20261028-stroke-final-checks/`,
`/tmp/pr449-endpoint-coverage-20261028/` and
`/tmp/pr449-original87-current-34e1df39-20261028/`.

## 28 October 2026, continued: marker absorption falsifiers

Normal merge `141bbeb868c5318a7579b6d6020b305a7a58b120` integrates Main
`cc28bd508fc6cfdf7eea586bfc0c7b509154f849` (#557). Independent source review
and affected owners preserve the public SDK's mutation hooks while the private
worker truthfully omits them. Post-integration owners pass 436 tests / 5,781
assertions, including five fresh-worker controls. These observations precede
the proof correction below and are not relabelled as its qualification.

Adversarial final-ink review disproved the new circle proof's witness assumption.
A normal-order literal-black circle on its own literal-black 20px shaft received
P, yet removing only its marker-end attribute changed zero of 32,000 actual
RGBA bytes. Both PNGs are also directly byte-identical. The earlier #111 probe
changed 14 pixels and remains a nonfinding; it was not discarded or relabelled.
Two bounded source-driven refinements expose the same false-P class: an earlier
20px black chrome shaft behind a thin carrier, and the actual black page
backdrop inserted outside the retained primitive roster. Both also have zero
marker-removal RGBA differences. Backdrop evidence retains raw Native SVG and
served SVG after the existing production color finalizer, with literal black
page paint asserted. No substitute helper result establishes this finding.

The finite repair uses one exact transverse ring point strictly outside the
own cardinal shaft's full infinite strip, including butt/round/square caps.
That same point must clear every later body. The new proof additionally requires
the first graphical primitive, one endpoint marker with no siblings/mids, and
no actual inserted backdrop. These are sufficient admission restrictions for
the new proof only; generic proofs, output geometry and work limits remain.
Unsupported earlier paint is refused rather than reconstructed. No extra SVG
scan, geometry writer, perceptual threshold or epsilon is introduced.

Implementation is `b7dd86b366e5aa0643540141e9f39b9478c3f9b5`. Direct
byte comparison binds the saved acquisition production/test patches to this
commit; observations retain their actual `141bbeb86` plus frozen-patch identity.
The regressions genuinely fail before each repair: own shaft 14P/1F; earlier
shaft 15P/1F; background cohort 15P/2F. Final focused controls are 17P/0F;
full paint certification/Native validation owners are **283P/0F, 1,429
assertions**. The cohorts overlap and are not summed. Existing mutable/getter,
CSS/resource/ownership and 4,000/50,000-point controls remain in those owners.
Canonical core/repository types and 1,800-file lint pass, with one retained
oversized-JSON warning; whitespace and hygiene checks pass. The hygiene tool's
942-line/373-commit signal includes retained history, not just this repair.

All four complete served SVGs are byte-identical before/after (708, 835, 773
and 707 bytes); the raw pre-finalizer backdrop SVG is also exact. The three
confirmed absorption cases move P to U while their complete PNGs stay exact.
The clear control remains P, and removing only its marker changes 18 pixels.
Independent straight-RGBA readback agrees on those pixels; its 66 changed color
channels and Resvg's 72 premultiplied channels are different encodings, not
conflicting pixel counts. Three counterexamples have zero changed channels
under both decoders. Independent source review covers cardinal/ref/start
mapping, full caps, unique occurrence order, sole markers and the complete
finite paint roster. There are no further in-scope review blockers.

The preceding exact-head CI [40664557732](https://github.com/adewale/agentic-mermaid/actions/runs/40664557732)
on `55fce6f2c9e07bc68371a63753098c42ccfd4e73` is complete: **14,519 unit
passes / 76 skips / zero failures**, 173 semantic passes, 63/64 qualified
assertions plus one unavailable. Functional package/CLI/MCP/site lanes pass.
CI remains failed: 62 unique absolute lazy-delivery violations; editor raw
4,664,499 exceeds 4,429,400 bytes; demo requests 38 exceeds 36. Gzip/relative
assertions are not reached. Eight advisory reports retain zero status changes;
corpus234 has 47 regressions, 51 improvements, 135 changed and one unchanged.
Those compare engines, not head versus Main. The manual PR red/green job was
skipped; the local genuine failures above remain the discriminating evidence.
This earlier CI does not qualify the newer Main557 integration or repair.
Fresh exact-head CI will be dispatched after the normal retained-branch push.
All seven originals and all six 0.6 acceptance goals remain open. No holdout,
peer acquisition or performance campaign has been opened by this correction.


Next concrete step, after final-head verification: extend exact same-emission
resource/root/group/stylesheet authority at its existing owner before asking
for a public original87 promotion. Its carrier/resource numeric and geometry
obligations still need proof. Then qualify all seven under both engines/cache
policies. Keep peer-observer admission and independent authored coverage as
separate prerequisites for candidate/domain freeze and the still-sealed holdout.
Aesthetics precede controlled performance; no performance work resumes here.

Evidence: `/tmp/pr449-20261028-stroke-controls/` (including
`absorption-regression-HANDOFF.md`, `COMMITTED-SOURCE-APPLICABILITY.json` and
`FINAL-INDEPENDENT-FIDELITY-READBACK.json`),
`/tmp/pr449-20261028-stroke-final-checks/` and
`/tmp/pr449-original87-current-141bbeb8-20261028/HANDOFF.json`.


### Final integrated CI and handoff

[CI 40668459900](https://github.com/adewale/agentic-mermaid/actions/runs/40668459900)
is complete on exact pushed head `f74c9b2d3399b99f8fe7c053666e599a4fa9500c`,
integrating Main `cc28bd508fc6cfdf7eea586bfc0c7b509154f849`. All three unit
shards pass: **14,527P / 76 skips / 0F** (4,984 / 5,275 / 4,268 passes).
Independent semantic conformance passes 173 tests, retains 63/64 qualified
assertions plus one unavailable, and replays 882 grammar inputs with zero
untracked defects. Node22/24 installed consumers, CLI/MCP, dist, quickstarts,
browser-site and backend review lanes pass.

**CI is failed.** Quality retains 62 unique absolute lazy-delivery violations.
Browser functional checks are 21P/1F, solely the editor raw limit:
**4,496,462 > 4,429,400 bytes**. Demo requests remain 38 > 36. Gzip and relative
assertions are not reached. Eight advisory reports retain zero status changes;
corpus234 remains 47 regressions / 51 improvements / 135 changed / one unchanged.
No ceiling or check is relaxed. The editor reduction follows incoming Main557
plus this repair; it is not an isolated performance result or parity evidence.
Manual PR-event red/green is skipped, with the genuine local controls preserved.

Live Main and retained branch were rechecked after completion: cc28 and f74.
The following documentation-only handoff corrects this contract's stale draft
status and records CI; production, tests, dependencies and workflows remain
byte-identical to tested f74. No separate exact-head CI qualification is inferred
for that documentation commit. PR449 remains closed/merged historically; these
follow-up commits are only on its retained branch, not Main.

Read-only preparation from the retained original87 SVG identifies independent
remaining blockers: two-point polyline, fractional resource/card operands,
default marker units, scoped CSS/root attributes, harmless unused resources,
identity groups and later text. A context-only bridge cannot certify it. The
next bounded implementation must bind those served operands at their owning
emission boundary and prove separation; do not substitute helper P, repeat the
rejected large-path parsing experiment, or relax limits. The prior row87
acquisition retains its original identity and remains U. All seven originals,
all six qualification goals and the State allocation warnings remain open.

Decoded full final CI logs and structured outcome summary are retained under
`/tmp/pr449-20261028-stroke-final-checks/ci-f74/`; direct final-ink evidence and
failed-before controls remain in the stroke-controls directory above. The
recovery continuation records the final documentation head and evidence archive.
No new holdout access, peer acquisition, performance tuning, publication or
release/default change occurred.


## 28 October 2026: linked advisory job exposed a shared admission regression

The owner linked [job122730721119](https://github.com/adewale/agentic-mermaid/actions/runs/40663011207/job/122730721119),
run40663011207, on the separate benchmark-ownership branch at
`ba506d1d5ea6605b18371e511835d8af86ae2b3f`. Its comparison runs Native and
our ELK pipeline at that same revision; it does not compare PR head with Main.
Corpus234 has 47 regression / 52 improvement / 135 changed results. Generated256
has 123 regression / 133 improvement results. A regression wins the verdict
whenever any measured dimension worsens, even if another improves. Area, bends
and length dominate the generated losses; this is not a human aesthetic verdict.

The complete saved ZIPs reveal why the log's zero `status-changed` must not be
read as zero failures: that category means missing population members only.
Support error-to-render is an improvement; identical errors are unchanged.
Generated `generated-cyclic:40` fails our ELK SVG API with a paint-certification
error in both linked and f74 reports; Native renders it. The failed ELK SVG is
absent, so the recorded hidden-caption diagnostics are not an independent
physical-ink review. Native's entire256 cohort is 120P/136U, versus ELK75P/180U
plus that error. Successful API completion does not establish full correctness.

The linked corpus has no API errors. The later f74 corpus instead has one error
under each engine: the same100-requirement/99-trace stress source. Its prior
Native/ELK certificates were U at400,000 operations, but f74 rejects late frames
r98/r99 with SCENE_VALIDATION_FAILED. The peer comparator hides those matching
errors as one unchanged result, explaining52→51 improvements and zero→one
unchanged. This was an admission regression; the prior handoff's literal zero
status-change counts did not establish absence of errors.

### Implemented, independently reviewed and locally verified

Normal merge `3acc2b709690557c754a1c9fe7f3a7eb20812d26` integrates Main
`9aaffac653bcea0a0897cd7281ee48e3884751cf`, including #562 authored Flowchart
source reuse and #541 product-owned benchmark commands/pinned Trident library.
No measurements are run. The new static preparation uses a clean exact
Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038` checkout and genuine frozen
installation. An isolated package-link overlay preserves the existing shared
dependency pool; its before/after targets are recorded in evidence.

- `7e1137d76204e1300a0ded50869ed30d8cca3286` fixes the shared drawing
  producer's structural enclosure fallback. On paint-capture exhaustion, use
  the already validated constructor-owned semantic identity before falling
  back to an internal group ID. It changes one production line. Internal IDs,
  paint ancestry, conditional status, validators and quotas remain unchanged.
- Its existing Requirement owner now checks independently authored100cards,
  all fields and99ordered traces under both engines, separately through Scene
  and ordinary Native drawing. The first Scene-only2P result is retained as
  a positive control. Fresh Native realms set assertion mode before imports:
  the genuine old result is2P/2F, followed by4P/0F. No global preload is changed.
- Exactly two final matched-option public SVG calls produce276,810-byte Native
  and276,501-byte ELK artifacts. Each complete SVG and entire receipt directly
  equal the linked historical counterpart. Both remain U at400,000/400,000 with
  CONDITIONAL_PAINT, OUTPUT_SCOPE and CHECK_BUDGET. No certificate is promoted.
  Independent XML/Decimal review checks100cards,400fields,100two-line headers,
  99carriers/labels,599unique semantic IDs and all198shaft ends within their
  own0.75px outline bands, including late frames. This is not a font-outline or
  whole-marker paint certification. Acquisition patches directly match the
  committed fix, retaining the original3acc-plus-patch execution identity.
- `2d780a21f54cb5f6031da1f6abcd6f01b348a19e` fixes the existing AM quality
  report consumer. Matching failed rows remain visible with escaped typed
  details and explicit before/after/both-failed counts. Missing-population
  labels are precise. Comparison verdicts, metrics, adverse rates and the
  existing CLI failure gate are unchanged. A genuine missing-row RED precedes
  the fix; final owner is14P/0F,1,837assertions. The initial typecheck caught a
  missing required field in the new test fixture; corrected owning tests and
  canonical repository typecheck pass. The failure log remains preserved.

Final runtime/shared-boundary owners: **310P/0F,5,169assertions** across
Requirement layout, Native validation, crisp drawing and paint certification.
Incoming cleanup/Trident-launcher/CI-policy owners: **19P/0F,207assertions**.
The cohorts remain separate. Canonical core types pass; after the test-only
correction the canonical repo types and1,898-file lint pass, with one retained
oversized-JSON warning. Diff and hygiene checks pass; the1104-line/377-commit
heuristic includes retained history. All five requested Sol6.1High agents
contributed implementation or independent falsifiable review.

Fresh exact-head CI is required after pushing this combined candidate; the
prior f74 CI does not qualify it. All seven original U diagrams, the six0.6
acceptance goals, generated40's ELK refusal and the State allocation warnings
remain open. Keep the failed snapshots enrolled; no threshold, cap, default,
release version or package publication changes.

Next first follow combined-head CI and retain every failure. Then investigate
actual final ink behind the generated40 ELK label refusal at its owning boundary,
while continuing served-geometry authority for the seven originals. A context-only
row87 bridge remains insufficient. The independent holdout stays sealed; peer
admission and aesthetic qualification still precede controlled performance.

Evidence: `/tmp/pr449-linked-run-40663011207/` (both original ZIPs, selected
reference packets and independent artifact review),
`/tmp/pr449-20261028-requirement100-controls/` and
`/tmp/pr449-20261028-report-controls/`. The recovery continuation records exact
final refs, CI and the external evidence archive. No new source benchmark,
peer acquisition, holdout access or performance tuning occurred.


### Exact-head CI for the linked-job repairs

[CI40674518679](https://github.com/adewale/agentic-mermaid/actions/runs/40674518679)
is complete on pushed `5e19e47ebc133b10d9db0a281405451a1cfedcef`, integrating
Main `9aaffac653bcea0a0897cd7281ee48e3884751cf`. Units are **14,532P / 76 skips
/ 0F** (4,985 / 5,275 / 4,272). Semantic conformance passes173 tests, retains
63/64 qualified assertions plus one unavailable, and replays882 grammar inputs
with zero untracked defects. Installed Node22/24 consumers, CLI/MCP, dist,
quickstarts, browser-site and backend review pass. Manual PR-event red/green
is skipped; the genuine local failures remain the discriminating evidence.

The full diagnostic confirms corpus234 has **zero API errors under both
engines**, restoring the lost Requirement100 admission. Its vector comparison
is47regressions/52improvements/135changed/0unchanged. Generated256 retains one
ELK-backed error and zero Native errors, with123regressions/133improvements.
All six additional64-input cohorts have zero API errors under both engines.
The new CLI explicitly states per-arm and both-failed counts; its missing-member
category is no longer confused with renderer success. It still measures metrics
through a separate layout call, and no API/certificate count proves global
correctness or aesthetic superiority.

**CI remains failed.** Absolute lazy delivery has62 unique violations; browser
functional checks are21P/1F solely on editor raw size **4,496,499 > 4,429,400**.
Demo requests remain38 >36. Gzip and relative assertions are not reached. All
advisory metric losses and generated40's ELK refusal remain enrolled. No cap,
verdict, exit condition or check is relaxed. Live Main and branch recheck after
completion are9aaff and5e19. The following documentation-only handoff leaves
production/tests/dependencies/workflows exact to tested5e19; no separate CI
qualification for that documentation commit is inferred.

A saved f74 single-row report excerpt now visibly shows errors1/1/both1 while
preserving the unchanged verdict. It is report-only reuse of existing artifacts,
not a new acquisition or full-corpus result. Both complete original ZIPs remain
locally retained and their downloaded bytes match GitHub artifact digests.
The supplemental review archive contains selected packets, controls, full final
CI logs and provenance, not duplicated full ZIPs; original artifact references
remain explicit. No failed source or enrollment is deleted.

Next investigate actual final ink behind `generated-cyclic:40`'s ELK-backed
caption refusal and continue served-geometry authority for the original seven.
Holdout, peer, aesthetic and performance qualification remain open and ordered
by the0.6contract. PR449 remains closed/merged historically; follow-up commits
are on its retained branch only. No performance timing campaign occurred.


### Required-CI repair: caption loss and delivery graph (28 October)

Active follow-up to `e6f1f8cc7831918220fa5016b9f88c10dc028099`, integrating
Main `9aaffac653bcea0a0897cd7281ee48e3884751cf`. Five Sol6.1High agents have
disjoint implementation and independent review assignments. Required CI is
not green yet; no timing campaign or holdout acquisition is authorized here.

Generated-cyclic40's ELK-backed refusal came from our diamond facet pass: two
captioned forward occurrences share a target, so moving that target twice
collapsed both caption seats. The scoped guard retains their original private
routes. Mixed caption/plain duplicates retain the existing bundle allocation;
a broader distinct-target guard introduced eight existing-owner failures and
was rejected. General alias allocation remains open. Four independently
authored literal geometry cases produce genuine2P/2F RED, then4P; full owning
route contracts are379P/0F,2535assertions. Fresh production Native and Scene
SVGs directly match22455bytes, with9nodes,23edge occurrences and6captions.
Physical bundled-Inter/resvg controls show the formerly hidden caption has
0target-colored pixels,103when later occlusion is removed. Final captions have
93and160pixels with identical full/later-paint-removed masks. Target removal
has0pixels. Failed cropped/WASM observers remain retained. Certificates stay U
with both marker-envelope uncertainties; actual caption visibility does not
prove marker correctness. Evidence: `/tmp/pr449-20261028-generated40-controls/`.
The first core typecheck found test-only shape literal widening, corrected with
literal types; retain that failed log and recheck before committing.

The private lazy facades now explicitly re-export the same core that every
public render already awaits. Exact canonical in-memory closures reduce62to32
violations and clear request/Brotli failures, without omitting code or loading
providers initially. Initial gzip changes by2bytes because import hashes differ;
no byte-identical initial claim. Final materialized artifacts remain necessary.
A separately reviewed capability-table subtraction reuses the canonical48
cells while preserving all claim values, order, optional diagnostic absence,
property order, evidence, and fresh frozen arrays/rows in every mode. Existing
conformance/negotiation owners and complete before/after object controls pass
in the preview; the actual source recheck is pending. No new capability is
qualified by sharing its description. Preview raw reduction is3933bytes per
lazy family, with tiny compressed tradeoffs. Evidence:
`/tmp/pr449-capabilities-preview-20261028/`.

Rejected/unshipped delivery experiments remain explicit. A private validator
specialization saves4317rawbytes but is insufficient and adds compiler
complexity. Safe secondary SWC without final content names is an unshippable
lower bound, despite clearing compressed gates; a complete per-file profile
banner restores identity but costs enough bytes to leave18violations. A final
esbuild graph/name pass is under review, with honest canonical-origin lineage
and no fabricated final source byte attribution. Neither pipeline ships yet.
Standalone safe compressor defaults save only2720raw/788gzip; esbuild primary
is17244raw/4656gzip worse. Aliasing Mermaid's merge and full runtime factories
changes the fixed100000 configuration loop budget (256extra init iterations),
so that shortcut is rejected. Generic primitive-literal interning is unshipped:
best of eight threshold profiles is4403035raw/1348596gzip, still14096gzip over.
Raw-only improvement is not CI success. Saved inputs, actual transformed bytes
and failed measurements remain under `/tmp/pr449-editor-literal-*20261028*`.
No existing cap, work limit, API, default, provider, security, receipt or check
has been removed or relaxed. All six0.6goals and seven original U remain open.


Main advanced during this repair. Integrated `03641ceb98170eaa39a924097f796221d1e22a22`
(#556 delivery and #563 empty-wrapper guard) at
`09022c703ace5ffb857d128b09694d556b277b61`, after independently verified commits
`defce2218` (caption) and `ec54da0f7` (capability cells). Core types and route
owner pass after the test literal correction; repository types and1898-file
lint pass with the retained oversized-JSON warning. Main's raised editor caps
are explicitly not adopted: original4429400raw/1334500gzip stay enforced.
The earlier coalescing patch is preserved in Git stash and an exact temp patch,
initially unapplied during combined measurement; no concurrent edit discarded.
Main's incoming compactor uses a source-recipe hash despite CLAUDE's own-input
hash rule; this upstream mechanism is recorded, not presented as compliant or
silently rewritten into another compiler. Its annotated source/import lineage
is pre-SWC and final bytes are post-SWC; inspect actual emitted edges before
calling that graph final. The saved final-esbuild prototype is unshipped.

Actual combined standalone is4469719raw/1348374gzip:40319/13874over original
caps. Actual lazy canonical build retains19violations, down from62, with request
limits clear; no green qualification. Identifier-preserving primary Bun was
negative (2rawbytes saved,18gzip worse) in the prior same-capability epoch.
An isolated pinned Terser5.44.1 saved-input comparison is authorized as a
standard build-only alternative; root dependencies are unchanged pending a
positive result. No custom string-pool transform or packed runtime ships.


Combined eight-owner qualification is525P/0F,4176assertions. The first batch
had25sandbox child-pipe/esbuild EPERM failures; those logs remain. Only the
three affected owners were rerun using the required network-enabled execution
profile, yielding wrapper75P,cleanup14P,metadata projection6P. No test assertion
or runtime check changed. The coalescing stash patch was reapplied to config
with stash retained; canonical outputs drop67to62modules and leave exactly
four raw failures: Packet740over,Kanban51over,Ishikawa876over,ZenUML77over.
Allgzip/Brotli/request caps pass. Actual final static/dynamic import sets and
UTF8size annotations match every emitted module; publicDTS is unchanged.
Evidence: `/tmp/pr449-lazy-integrated09022-coalescing-*20261028*` and
`/tmp/pr449-20261028-main09022-owner-controls/FINAL-SUMMARY.json`.

Standard SWC hoist-vars and hoist-functions variants worsen both raw/gzip and
remain unshipped. Terser3passes timed out at117seconds without runtime output;
Terser1pass completes but is46017raw/6477gzip worse on exactfullHTML. No root
dependency or compiler helper changed. These are compiler experiment outcomes,
not product API refusals or new benchmark timing observations. A private
provider/core union extension and primitive-literal pooling followed by stock
mangling are under bounded investigation only; neither is qualified yet.


Further private provider/core union coalescing clears ALL original lazy caps.
Styled and Native providers already load after core; their private facades now
re-export that same core. Independent review finds only dynamic back-edges,
no static initialization cycle or new getter/option reads. Actual canonical
build has59JSmodules. Every actual import and finalUTF8byte size matches the
annotated metafile. Initial and all25family static source unions, including
zero-byte origins, remain exact; publicDTS remains identical. Initial improves
4requests/15428rawto3/15408raw,5856gzip/5228Brotli. Former raw failures now have
margins Packet1454,Ishikawa1310,Kanban2129,ZenUML2179,Architecture2878bytes.
Built YAML/entity/placement checks also pass. Exactbytes/metas/config retained
in `/tmp/pr449-lazy-integrated09022-provider-artifact-20261028/`.

Actual emitted Chromium owner is26P/0F,831assertions: all25families xcrisp,
hand-drawn andwatercolor compare exactSVG and FULLreceipts; NativezeroELK,
truefallbackonly, recovery, getter/YAML/entities and hostileCSS pass. Local
Firefox/WebKit are unavailable and remain enrolled for fullCI. The first
manual invocation wrongly used repository-rootcwd, loading the unit preload
and forcingSceneassertions against browserNative receipts. It produced10P/16F;
those logs remain. Canonical runnercwd=e2e has its ownno-preload bunfig, so the
unchanged26cases pass after correcting invocation only. No harness edit,
receipt field removal, JSONnormalization or assertion/cap relaxation fixed it.
Evidence: `/tmp/pr449-lazy-provider-chromium-canonical-owners-20261028.log`.

Editor remains unqualified. Thirteen generic lexically ordered literal-pool
profiles followed by stock mangling allfail gzip; best4368466raw/1339715gzip,
still5215gzip over. Six property-overlap/far-gap variants also fail; no source
helper or rootdependency was added. Finite declaration-order/mangler variants
and once-cachedmodule-local representation research remain pending. No packed
runtime, newbrowserloader, solver tuning or timing campaign is introduced.


Verified lazy change committed at `fcd9297c3`; the original editor budget
contract restored after Main integration is `432b85a3911e1e9433bccdcf7d520eae87b30e08`.
Canonical core and repository types pass on this combined source;1901-file
lint passes with the one existing oversized-JSON warning. Compiler/schema
owners525P and canonical emittedChromium owners26P remain applicable: these
commits only record the tested source/config and stricter retained testcaps.
The editor remains failed; no final CI readiness is claimed. Current best
unshipped pool-plus-stockmangling/Terser-format experiment is4368584raw and
1336443gzip,1943gzip over. Direct-to-Terser variants also fail; no rootdependency
or private representation helper has been adopted. Remaining renderer correctness,
peer/holdout/aesthetics/performance goals are unchanged.


### Published snapshot CI and package inventory repair

Published `f219abc041e0f4c2c3db62f7f6c1cdb487593456` is tested by
[CI40704506275](https://github.com/adewale/agentic-mermaid/actions/runs/40704506275).
All14554unit tests pass,76skip,0fail; independent semantics173P,63/64qualified
plus1unavailable,882grammar inputs with0untracked defects. Quality, website
payload, browser-site, Node22, CLI/MCP, dist and quickstarts pass. CIcomplete
fails on standalone bytes and the reviewed package inventory. The advisory
metric losses remain enrolled and nonblocking, with no winner claim.

Frozenf219 paired website captures use exactMain03641 and identicalBun1.4.2,
Playwright1.58.2,SystemChromium154.0.8037.57. All4head routes pass original
caps. Canonical payload-delta passes WITHOUTallow-growth: all30rows are lower
or unchanged(28lower/2unchanged). Familygzip falls5462to5629bytes; initial
5918to5856;demo271271to265782gzip and25to17requests. Complete populations and
metafiles remain retained under `/tmp/pr449-ci-relative-*20261028*`; no timing
comparison is inferred. This also confirms the earlier manual-dispatch skip
of the PR-only relative step has independent canonical evidence, not a waiver.

The complete clean Node/DTS/IIFE/lazy/Zen builds expose4Zen shared chunks,
while the old reviewed inventory expected7. The original117second aggregate
build timed out after successfulNodeDTS/IIFE; separate bounded lazy/Zen stages
complete with unchanged limits. Pinnednpm11.18 actualRED finds ONLY7versus4.
The inventory change removes precisely3identical wildcard entries; all other
paths and strict rejection rules remain. Same canonical verifier GREEN has
225exact files. RED/GREEN tarballs directly match byte for byte. All21public/
conditional targets and467relative/conditional/URLedges across100runtimeJS
modules are complete; no maps, nonliteral or missing imports. Owning package
checks6P/16assertions and targeted lint/diff checks pass. No package published.
Evidence: `/tmp/pr449-ci-package-*f219-20261028*`. Commit and final CI still
need recording after remaining standalone repair; no overall green claim.

All standalone representation experiments remain unshipped. Current best
research byte profile still exceeds originalgzip by1891bytes. Authored JS
controls expose prototype-shorthand/setter bugs in bothTerser5.44.1/latest5.51.2
and existingMainSWC, plus invalid quoted private fields inTerserquote_keys.
Keep these adverse results; static absence of named proto keys is not a generic
compiler safety proof. Dynamic computed keys may evaluate toproto and must
retain ordinary own-property semantics. Oxc0.156 full compression is rejected
for documented coercion/inherited-setter assumptions. Its renamer default also
fails proto binding controls. A documented reserved-binding safeguard passes
all12independently authored semantics/determinism controls, including escaped
spelling and ordinaryshorthand; actualfullmodule bytes are not yet measured.
Prefer a standard renamer without an added pool if it meets bothcaps. No root
dependency, emitter, parser, work limit, cap, default or holdout changed here.

Storage cleanup preserved all839files of a closedOct27generated installed
consumer in `/tmp/pr449-closed-consumer-hGAdot-20261028.tar.gz`, and all1182files
of an obsoleteephemeralbunxESLintcache in its separate verifiedarchive. All
regular member bytes and symlink targets directly match before cleanup. Only
regenerableNodebytecode/font caches were otherwise cleared. Source worktrees,
proof/failed-case artifacts and base frozen dependencies remain intact.


### Same-emission marker authority and authored Class interactions — 28 October

Runtime repair: `f56279e5b7e256877054076487449238021a0bc6`.
Authored Class coverage: `e0b6dfebb9051250a8a6bdd31442decd58bbac9d`.
Both follow published `f16a03a70cef591913e27520b388095b414a06c1`, which
integrates Main `03641ceb98170eaa39a924097f796221d1e22a22`. The live Main ref
was `42ed120b6d650d80634cdc35fc44c196c409f7fe` at the final local check;
this tranche has not been qualified against that newer base. The GitHub PR
snapshot returned older refs; live Git refs are authoritative. PR #449 remains
closed/merged and these are retained-branch follow-ups, not changes on Main.

The same five requested GPT-6.1 Sol High agents divided writer custody,
emitted-path authority, independent paint controls, authored Class coverage,
and independent end-to-end source/ink review. Source writers were disjoint;
product operations were serialized. Standalone compiler/byte experiments were
stopped on the renewed correctness instruction. No performance campaign ran.

The writer now returns a per-write receipt for actual line/polyline numbers
and path `d`. Captured raw operands remain validation/serialization inputs;
inspection retains served operands without a second geometry writer, points
parse, or global identity proof cache. Own inert operands, complete receipts,
correct source identity and paid work are required. Missing/cache-hit receipts,
mutation, getters, unknown CSS/resources and unsupported changed geometry retain
strict uncertainty. Descriptor overlays preserve optional marker metadata and
the deferred terminal projection without invoking its getter.

The existing paid path walk retains actual emitted C/S/Q/T and linear terminal
directions, including collapsed-control/zero-segment fallback. Proof authority
is restricted to same-emission Native open, non-arc contours with exact owned
sampled endpoints and matching topology. Original conservative marker bounds
are unioned with served bounds rather than shrunk. Arcs, midpoint markers,
closed/directionless paths, rounded/mismatched endpoints and unbound generic
Scene paths remain unverified. No operation or delivery cap was relaxed.

The owning paint tests reproduce four genuine baseline failures: a rounded
polyline hidden by its endpoint card, fractional polyline inspection retaining
raw rather than served coordinates, a cubic whose actual terminal derivative
opposes its sampled chord, and a cubic whose control rounding changes the SVG
fallback direction. Initial targeted baseline: 4 pass / 4 fail. After repair,
three demonstrated hidden-marker false passes become unverified; the visible
fractional polyline keeps passed with correct served coordinates. These are
soundness repairs, not repairs to hidden drawings or original-seven promotions.
Seven independently authored visible C/Q/S/T/relative controls retain passed;
a visible unsupported arc changes from passed to unverified and stays enrolled.

Full-viewport native Resvg marker-removal and cover-removal controls observe
actual ink independently of the certificate. All 128 paired SVG/PNG artifacts
are directly byte-identical between the exact f16 source snapshot and frozen
candidate. Thus pictures did not change. The two early RED runs used an
unsupported fontBuffers option; their text-free geometry comparisons remain
valid, but no font-loaded claim is made for those runs. Final controls use the
supported fontFiles option with bundled Inter. Earlier source-hash provenance
claims violated repository policy and are withdrawn, not relabelled as direct
pre/post byte evidence. Source binding uses explicit writer freeze/handoffs;
post-capture source copies and exact Git diff remain retained. The 842-file
baseline snapshot was subsequently checked directly against exact Git members.

Class coverage combines nested/shadowed names, generated-looking IDs, equal
visible labels with distinct identities, Unicode members, parallel/reciprocal/
self relations, interface realization and note ownership. Literal authored
facts are checked through source/canonical/JSON reload and strict Native/ELK
actual SVG identities, parents, ordered relations, labels and marker ends.
The full Class owner passes 145 tests / 2,043 assertions. A seeded relation-
deduplicating fault fails the new case; this establishes discrimination, not a
pre-existing product defect. Ancestor namespace declaration normalization is
intentional; actual three namespace frames and ownership are observed.

Final combined paint/native-validation/deferred/crisp owners: 312 pass,
0 fail, 1,773 assertions, including unchanged 4k/50k point budget positives
under the existing 400,000 limit. Canonical core and repository types pass;
full lint checks 1,901 files with no errors and one existing oversized-file
warning. The final Class readonly type correction changes no expected values;
its focused rerun passes 126 assertions. No local full-suite repetition was
performed; a fresh exact-head CI is required after publication. Earlier CI
40704506275 remains historical f219 evidence (14,554 unit passes, 76 skips,
173 semantic passes), not a result for this source. The original standalone
editor caps remain failed; package inventory was repaired separately at f510.

Independent peer work executed one pinned Pele 1.9.0 public parse/render for
original row 87. Raw author correspondence A to B / arrow_circle and the public
default API call pass. Its filled circle differs stylistically from our hollow
ring. Internal algorithm and physical peer ink/font admission remain unverified.
The pinned Trident adapter incorrectly normalizes arrow_circle to arrow; retain
raw evidence and prepare its shared repair separately, rather than adding an
AM harness workaround. No new public Mermaid acquisition was performed.

Original rows 77, 87, 88, 89, 103, 206 and 209 remain unverified. Historical
28 engine/cache packets were independently read back, without promoting them
to current acquisition or sound certification. All six acceptance goals remain
open; the independent holdout remains sealed. Next concrete runtime step is
row 87's complete same-emission CSS/resource/body/context authority, followed
by stroke-only marker and compound-cylinder obligations. Unsupported path
cases above remain explicit counterexamples to a general cubic-parity claim.

Local evidence: `/tmp/pr449-20261028-served-token-controls/` (RED logs,
final combined owners, core/repo types, lint, paired bytes and source epoch),
`/tmp/pr449-20261028-authored-class-controls/` (owner and seeded fault),
`/tmp/pr449-independent-ink-peer-20261028/` (independent runtime/ink/peer
readback), and `/tmp/pr449-20261028-cubic-served-review/`. These are retained
review evidence, not committed derived fixtures or tests of test presence.


### Exact c807 CI: real Scene regressions retained, repair in progress

[CI 40719610783](https://github.com/adewale/agentic-mermaid/actions/runs/40719610783)
checks out exact `c807afa61d951684ea3511a795ec5cf9e056c8b7` directly, not a
merge with current Main. It finishes failed: 14,559 unit passes, 76 skips and
9 failures. All nine are regressions introduced by the new proof domain:
the existing strict publication Block case and eight existing rounded
Requirement self-loop cases (four directions under both graph backends).
The 312 local paint/validation/crisp owners did not cover this production
Scene path. Do not report c807 as correctness-green or ready.

Semantic conformance remains 173 pass / 0 fail, 63/64 assertions qualified
plus one unavailable; grammar triage retains 882 inputs, zero untracked defects
and zero unreviewed disagreements. Installed consumers on Node22/24, package
inventory, CLI/MCP, dist, quickstarts, browser-site, site payload and backend
review pass. The quality suite passes types, lint and its 513-diagram /
2,052-format audit (zero hard/soft/render errors), but fails six raw lazy caps:
Architecture 2,320,823 > 2,318,000; Packet 590,747 > 586,500; Kanban 598,572 >
595,000; Treemap 609,332 > 606,000; Ishikawa 590,891 > 586,500; ZenUML 673,272 >
669,750. These are newly observed delivery regressions after the correctness
code, retained under unchanged caps. Browser has 21 passes and one editor raw
failure: 4,475,423 > 4,429,400; its gzip assertion is not reached. Advisory
quality remains failed. No compiler/byte tuning or check relaxation follows.

The Block failure is independently reproduced with its untouched owning test:
1 failure / 36 assertions. All four actual refused paths are open M/L/Q and
end in eastward straight L segments; this is not an arc-tangent problem.
Strict rendering deliberately selects the retained Scene adapter. Admission
already writes and caches immutable leaf fragments before certification, but
inspection lacks the Native-only emission authority required by the repair.
The untouched Requirement owner reproduces eight failures / 128 assertions:
its bend-radius-zero companions pass and radius-12 paths become unverified.
A representative actual northward terminal has tip
(155.088123456,131.823456789). Actual numeric spelling can differ from raw
sampled endpoint operands, so a boolean Scene stamp or epsilon comparison is
not a sound fix. Full SVGs and receipts are retained in
`/tmp/pr449-block-publication-ci-regression-20261028/`.

Before further implementation, the published PR contract was expanded:
collect actual tokens and committed-fragment receipts during the existing
admission serialization transaction, retain them with the exact positioned
Scene, and bind fresh occurrence ancestry/ownership at inspection. No global
observer/node proof cache, second writer, additional path parse, cap increase
or generic mutable/getter admission is allowed. Changed served d needs a
paid shallow private paint projection before existing geometry measurement,
plus complete served shaft/marker and original conservative bounds propagated
through viewport/occlusion/restoration consumers. Raw public Scene and emitted
SVG stay separate and unchanged. Missing/foreign/cache-only receipts and
alternative backends stay unverified. Implementation and GREEN are pending at
this entry; no proposed bridge is described as completed.

Separate peer work: eight saved-artifact Resvg 2.6.2 observations preserve
actual SVG bytes and use supported Inter Regular/Medium fontFiles. Whole-image
marker removal changes 41 pixels for retained historical Agentic row87 and
52 pixels for the pinned public Pele circle. Independent PNG decoding agrees.
However, Pele's intended #1f1f1f circle becomes black in this consumer; its
shaft is hidden, and bodies/text are black. This establishes isolated circle
RGBA contribution only, not readable connectivity or intended peer styling.
Browser CSS/fonts and internal algorithm remain unavailable. No Pele/browser
bug or default-peer correctness pass is inferred. See
`/tmp/pr449-row87-saved-raster-20261028/` and independent second readback.

A shared Trident model-normalization patch is prepared separately at
`/tmp/pr449-trident-flowchart-marker-proposal-20261028/flowchart-marker-normalization.patch`.
It preserves circle/cross markers, distinguishes marker presence from arrow
direction, and keeps unknown relationship evidence unavailable. Literal owner
controls are genuinely RED 3 pass / 11 fail before and GREEN 14 pass / 0 fail
with 79 assertions; scoped types/lint and independent review pass. The saved
public Pele raw model confirms arrow_circle now maps to end circle, retaining
A/B and endpoint order. Initial Bun deserialization of Node V8 failed and is
retained; Node24 readback succeeds. Neither canonical AM nor canonical pinned
Trident is changed by this prepared patch; no PR/pin/publication is created.
It grants no physical marker or algorithm credit.

Read-only simplification work identifies a smaller next row87 obligation:
validate all captured declared marker resources against their actual bytes,
including unused definitions. Require own fields/slots, exact canonical bytes,
reference agreement and duplicate/shadow/CSS/mutation falsifiers. This alone
cannot promote row87; root/group/style, fractional units/body and text remain.
The independent ellipse note preserves a literal off-support arrow whose tip
is exactly on an ellipse yet whose filled triangle intrudes beyond the owned
border band; tip contact plus an outward shaft is insufficient. This is
proposed coverage, not an executed regression or new false pass:
`/tmp/pr449-20261028-cubic-served-review/NEXT-ELLIPSE-CONTACT.md`.

### Scene repair: broader-owner failures remain enrolled

The draft restores the original strict Block and eight Requirement failures.
Focused final-ink/authority controls pass 47 tests / 720 assertions; canonical
core/repository types and lint pass. Three cold public SVGs (Block and both
Requirement bend modes) are byte-identical to c807. Saved full-viewport marker
removal observations show the Block shared ingress pair contributes 30 pixels,
store/audit 36 each, and the Requirement north arrow 42. Shared coincident
markers receive pair credit only. These observations qualify those artifacts,
not the entire draft or the original seven diagrams.

The broader six owning suites subsequently give **402 pass / 5 fail / 6,623
assertions**. Four losses concern concurrent State labels, Architecture BUG-37,
Native Class clearance and an eight-point ER crossing diagnostic. The fifth is
an unexpected ELK fork/join State promotion from U to P, still unqualified.
These failures block committing the draft. The four-point served-polyline
ceiling demonstrably masks the ER crossing; the other longer-route failures
remain enrolled until verified after repair. Do not replace their expectations
with generic uncertainty.

A separate four-point zero-immediate-terminal control was initially mistaken
for a positive. Actual whole-image marker removal changes zero pixels, while
removing its cover reveals 30. Both execution paths incorrectly passed. The
shared certifier now withholds marker credit for a zero immediate marked
segment; the adverse remains enrolled, alongside a nondegenerate positive.
Normative preceding-segment fallback alone is insufficient final-ink evidence.

Before further edits, the PR contract records the principled ceiling removal:
prepay safe finite coordinate-count work under the same 400,000 allowance,
collect every actual token during the existing formatter replacement pass,
construct immutable served points/contours there, preserve raw conservative
and served envelopes, and consume without another point walk. Refusal preserves
the SVG and uncertainty; unchanged long integer polylines keep their existing
fast path. No arbitrary larger ceiling, extra parser, cap increase or timing
campaign is authorized. Implementation and qualification are pending.

An exact c807 State baseline is now acquired with one uninstrumented public
ELK/fallback-none call and Scene assertions enabled: U, seven markers, 1,378
operations, two join-endpoint overlap issues. All 3,167 recovered Git members
are directly byte-equal before/after execution; unchanged files use hardlinks
and all active writers' files are independent copies. Its complete SVG equals
the historical row123 SVG, but current-candidate ink and raw route operands
remain unobserved. CSS hiding and substituted invisible definition negatives
are prepared to challenge the new Scene authority before any promotion.

Evidence is retained under
`/tmp/pr449-block-publication-ci-regression-20261028/` and independent readback
under `/tmp/pr449-independent-ink-peer-20261028/`. Live Main is now
`f8180b1050afe453a3d5b2184e62313d7b2ebd34`, beyond integrated 03641; it is not
jointly qualified. All six goals and original seven uncertainties remain open;
the holdout remains sealed. Five Sol6.1High agents continue disjoint work.

### Verified Scene write/proof boundary repair

Runtime/test revision **`26f8f991bc08d5f6a21153e923b54d49964a0e3e`** binds
Scene proofs to opaque, operation-owned receipts captured during the existing
admission serialization. Missing, foreign, cache-only, forged-observer and
wrong-header observations remain unverified. Inspection binds fresh ancestry,
ownership and order; alternate backends gain no default-writer authority. The
existing admission registry moves to an acyclic leaf module rather than being
duplicated. Raw public geometry remains separate from private served geometry.

Changed polylines now consume all actual tokens during the existing formatter
replacement pass, with safe finite `48*N+128` work prepaid before allocation
under the same 400,000 allowance. Immutable point slots and constant-time array
finalization avoid another point traversal. First/last nonzero raw and served
tangents, contours and raw bounds are derived in that pass. The arbitrary
four-vertex ceiling is removed; unchanged integer 4,000/50,000-point owners
still pass. Raw radial node/viewport bounds remain conservative; precise raw
and served marker poses feed overlap checks. The first attempt incorrectly
used radial bounds for marker/text overlap and caused three bend-zero
Requirement refusals. Their untouched expectations now pass without weakening
text checks. Zero immediate marked segments retain uncertainty: the apparent
preceding-segment fallback does not establish actual final ink.

Hostile-context controls found three concrete false passes in the draft:
stylesheet-hidden cubic markers under both execution paths and an invisible
substituted marker definition under Scene. Marker removal changes zero pixels;
removing only the hiding context restores ink. Exact c807 reproduction shows
the Native stylesheet defect already existed at the internal draw/certify
boundary; no public Mermaid-source defect is inferred from that fixture.
Shared paid context checks now reject these cases. They reuse canonical style
declaration data from its owning producer, compare actual Scene marker bytes
with immutable descriptors, bind palette variables and exact group matrices,
and retain generic CSS/getter/mutable/definition isolation.

The initial context gate overreached: one complete registry-derived diagnostic
enrolled **25 examples: 19 P / 6 U / 0 errors**, retaining Timeline, XYChart,
Pie, Quadrant, Radar and Sankey refusals. A separate thick Sankey call is U;
there are 26 calls total, not 26 registry examples. These failures concern
unrelated title IDs, responsive roots, hover styles, group variables and
gradient ribbons. The corrected gate derives its obligation privately from
actual non-invisible marked connector occurrences, with no family exception
or caller-supplied authority flag. Unmarked charts retain their previous proof
domain and receive no new CSS/resource/visible-ink qualification. The existing
registry owner now passes through all examples. This is a scope correction,
not evidence that those unrelated contexts are closed.

Eight other failing owner assertions assumed palette variables that their bare
SVG roots never declared. All original bare inputs remain enrolled as adverse
Native observations; explicit root-bound counterparts retain the original
status, issue and count expectations. Their SVGs differ only by that literal
root binding. Raw generic Scene checks remain unchanged. These fixture fixes
are not eight demonstrated public rendering defects.

Final frozen verification:

| Evidence | Result |
| --- | --- |
| Focused final-ink/context and untouched Block/Requirement controls | 60 P / 0 F; 871 assertions (subset of the owners below) |
| Six paint/validation/crisp/Block/Requirement owners | 417 P / 0 F; 6,872 assertions |
| Full Class backend plus font/theme owners, five files | 511 P / 0 F; 5,474 assertions |
| Canonical core/repository types | Both pass; repository preparation uses unchanged pinned Trident f080 |
| Full lint | Pass, 1,905 files; one existing oversized-JSON warning |
| Four final cold public captures | State, Block, Requirement bend0/bend12 all P; complete SVGs directly byte-equal c807 |

The two disjoint owner batches total **928 tests / 12,346 assertions**; the
focused subset is not added again. All checks use the unchanged caps. Final
State has 34,120/400,000 operations and seven markers; Block 69,964,
Requirement bend0 26,288 and bend12 26,230. These are certificate work receipts,
not timing or performance comparisons.

The exact ELK/no-fallback State transition is independently supported: seven
authored ordered relationships, six distinct marker poses, all six contributing
34 PNG pixels under bundled Inter fonts. Coincident incoming join markers count
as one paired pose. Served borderless contact and clipping agree; final SVG
equals c807 and the saved raster input. Raw same-call route/body operands remain
unavailable, so no raw floating-point explanation is asserted. This qualifies
the bounded observable U-to-P transition, not general State correctness. Final
Block/Requirement SVG equality also retains the earlier six physical artifact
observations at their recorded scope.

Evidence: `/tmp/pr449-block-publication-ci-regression-20261028/` contains
`FOCUSED-final-scoped-context.log`, `OWNERS-final-scoped-context.log`,
`CLASS-FONT-THEME-scoped-final.log`, canonical `*-scoped-final.log` statics,
`FINAL-SCOPED-ARTIFACT-COMPARISON.json`,
`STATE-FINAL-C807-COMPARISON.json`, `B-FINAL-HANDOFF.md`, all earlier failures,
and the complete final source patch. Independent final State readback is
`/tmp/pr449-independent-ink-peer-20261028/STATE-FINAL-EPOCH-BINDING-READBACK.json`.
All 20 committed source/test members directly equal the post-capture frozen
worktree. Writer handoffs establish that epoch; no pre-call source-byte snapshot
or own-source hash is claimed. Closed regenerable font caches were deleted only
after directly comparing their files with owning assets; no adverse evidence
or source was deleted.

Five requested Sol6.1High agents contributed disjoint implementation and
falsifiable reviews. No timing campaign, compiler experiment, holdout access,
peer publication, cap relaxation, release/default change, merge or force push
occurred. Original rows 77/87/88/89/103/206/209 remain unverified and all six
acceptance goals remain open. Native's preexisting unchecked extra-unused-defs
context remains a source-derived limit; no new executed shadow-ID false-pass
claim is made. Unsupported arc/mid/closed-path cases and general circle/cylinder
stroke/contact obligations remain open. Next concrete runtime step is to bind
all declared Native resources, including unused definitions, to actual bytes
before broadening row87's stroke/context domain. Full exact-head CI and the
latest-base recheck follow publication of this verified increment.


### Exact CI refusals: bind proof paints to actual root definitions

Runtime/test revision **`2af3348a68ee0fab33d484dac9627ad7076276b0`** repairs
root-paint correspondence and the unmarked inspection regression introduced
by the preceding Scene authority increment. The original CI failure population
remains enrolled. No diagram layout or SVG writer geometry changed.

[CI40740168308](https://github.com/adewale/agentic-mermaid/actions/runs/40740168308)
completed **failed** on `0cf8d8df830de41dbce1c303a79621a220c017a0`:
14,584 unit passes / 76 skips / 17 failures. Sixteen untouched large-ring
Architecture assertions (four backend/fallback modes by four directions)
expected P and received U; actual endpoint/marker checks passed. The remaining
failure lost the unmarked inline-text occlusion diagnostic under group opacity.
Semantic conformance passes 173 tests, with 63/64 qualified and one unavailable;
882 grammar inputs retain zero untracked defects. Installed consumers and
functional package checks pass. Quality still fails **23 unique lazy byte
rows** (17 raw plus six gzip), and the editor raw payload is
4,490,061 > 4,429,400. Repeated log summaries are not additional violations.
The existing advisory retains aesthetic tradeoffs; its zero status changes
refer to missing population members, not paint parity. No limit is raised.

The Architecture producer writes a configured literal root property such as
`--arch-edge-stroke:#ff0000`. Rejecting that property withdrew valid proofs;
merely allowing it would be unsound because the previous palette-only resolver
could certify a fallback while final SVG color resolution used the actual root.
An operation-owned resolver now uses the existing final-color kernel with a
private copy of validated, retained definitions. Body opacity, shaft alpha,
marker witnesses, paint and restoration consume that same resolver. Original
caller-header identity is checked before diagnostic header replacement;
a foreign header receives no color authority. Missing/unknown/derived-shadowing,
duplicate, unresolved and entity-ambiguous custom declarations remain refused.
The setup reservation of 4,096 is an abstract work weight, not a literal CPU
bound; existing bounded theme contrast searches are unchanged.

Native's **new custom-root permission** additionally requires its existing
closed-definitions grammar and paid equality between declared marker resources
and byte-checked references. The definitions grammar is recorded by the
existing scan, with no second parser. An extra unused canonical resource keeps
that new permission U even when its referenced red marker is visibly intact.
This is a conservative domain control, not a demonstrated hidden-marker defect.
It does not close Native's preexisting unchecked definitions limitation for all
old palette-only/unmarked contexts. Scene already requires resource closure.

Without an explicit write receipt, admitted unmarked connectors retain their
legacy inline-label diagnostics. Marked connectors and explicitly supplied
receipts retain strict same-write requirements. This grants no new CSS,
resource, served-geometry or custody qualification to unmarked charts.

Independent controls extend the existing cubic table rather than adding an
inventory. The finalizer's real SVG and complete Resvg pixels establish:

- A literal custom root alias gives an actually red, contributed marker and P.
- An opaque root-alias cover hides all contributed marker ink; removing only
  that cover restores it, and certification reports failed/MARKER_OCCLUDED
  with the actual foreign owner.
- Optional `accent:transparent` is an admitted nonhex palette value. Final SVG
  has a transparent marker, full marker removal changes zero pixels, and a
  literal black replacement restores it. Both execution paths previously
  returned P at the internal contact boundary. Retaining the actual standard
  root definitions now withdraws that false pass. This is not a demonstrated
  public Mermaid-source defect or a universal nonempty-marker guarantee.

The first deliberately broken resolver experiment was **nondiscriminating**:
all four tests passed because the cover assertion accepted both F and U. It is
retained as a failed experiment. Strengthening the authored opaque-cover verdict
to failed/MARKER_OCCLUDED makes the **same exact fault** fail both cover cases
(2 P / 2 F); exact source restoration gives 4 P / 0 F, 52 assertions. All seven
source/test member bytes equal their backups immediately after restoration and
after that green run. Subsequent authorized accounting-comment, resource-guard
and palette fixes are separate epochs, not restoration failures.

The two added resource/palette rows give genuine RED **1 P / 3 F**, 49
assertions. The resource guard alone gives six applicable controls P, 82
assertions. The combined resource/palette fix gives all eight P, 102 assertions.
Entity-bearing nonhex optional root declarations remain conservative U; no raw
CSS parser or permissive entity interpretation is introduced.

Final frozen verification at runtime revision 2af3348a6:

| Evidence | Result |
| --- | --- |
| Eight paint/admission/endpoint/inline-label/Block/Requirement owners | 488 P / 0 F; 7,970 assertions |
| Disjoint Class, font/theme and SVG-postpass owners, six files | 523 P / 0 F; 5,641 assertions |
| Canonical core and repository type checks | Both pass; repository preparation uses unchanged pinned Trident f080 |
| Full lint | Pass, 1,905 files; one existing oversized-JSON warning |
| Six cold public calls | State, Block, Requirement bend0/bend12 and two representative Architecture rings all P; actual SVG bytes equal their retained pre-repair artifacts |

The two owner batches total **1,011 P / 0 F / 13,611 assertions**; the focused
eight are a subset, not added again. Seven exact source/test copies taken before
the final checks directly equal the members after all checks. Four earlier
State/Block/Requirement physical bindings retain their recorded scope. The two
Architecture final operation receipts are 33,253 and 33,251 / 400,000. These are
abstract certificate-work receipts, not performance measurements.

Independent Architecture review retains eight saved PNG observations, four per
arm: default R has 208 contributed pixels per head and 416 for both; explicit
ELK T has 90 per-head conditional deltas and 284 for both. Overlapping heads
make those ELK counts nonadditive. Four off-shaft witnesses retain actual red
ink, disappear with only their own marker removed and survive removal of the
opposite marker. Ring/card/body/resources, viewport and bundled font bytes are
preserved. The default arm has no layoutDecision field; no selected-engine
claim is inferred from its absence. Only two representative arms have this
independent raster evidence, not all sixteen. Same-call raw State operands
remain unavailable; the earlier seven authored relationships/six marker poses
are not broader State parity.

Evidence roots: `/tmp/pr449-block-publication-ci-regression-20261028/` (previous
CI summary and snapshot maintenance), `large-architecture-ring-ci40740168308/`
(all RED/GREEN/fault/restoration epochs and final handoff), and
`root-color-final/` (source freeze, two owner logs, canonical types/lint, six
full public returns and actual SVGs). Independent readbacks are under
`/tmp/pr449-independent-ink-peer-20261028/`. No new image is committed: all six
checked public SVG pictures are byte-identical; the change concerns proof
status and hidden-paint refusal.

Baseline maintenance is disclosed separately from acquisition: a later theme
edit affected a hardlinked c807 snapshot member after both successful baseline
calls and their direct before/after checks. Only the snapshot member was
restored atomically from Git; all 3,167 archived members then directly matched.
The recorded calls predate the edit and remain qualified at their recorded
epochs. That snapshot is not sealed or immutable; future use requires full
before/after checks and detaching new writer files. This increment performs no
new baseline render. Details: `STATE-c807-SNAPSHOT-MAINTENANCE.json`.

All five requested GPT-6.1 Sol High agents supplied disjoint implementation or
falsifiable review. Original rows **77,87,88,89,103,206,209** remain unverified;
all six acceptance goals remain open, and the separately authored holdout stays
sealed. General stroke/cubic/cylinder/contact obligations, legacy Native
resource closure, coverage and pinned public Mermaid/Pele observations remain
incomplete. Existing Trident peer work stays separately prepared and unshipped.
No timing/compiler campaign, changed cap/default/version, publication, new
issue/PR/comment, merge or force push occurred. Live Main
`019eedd31ed730f12b5047840dd61ab9e3cccd16` is beyond integrated03641 and is not
jointly qualified. Next: follow the new exact-head CI, repair any correctness
failures, then bind legacy Native declared resources before broadening row87's
stroke/context proof domain. No ELK parity claim follows from this increment.


### Root-paint repair: terminal CI and remaining observations

[CI40748124441](https://github.com/adewale/agentic-mermaid/actions/runs/40748124441)
completed **failed** on exact candidate
**`abca8ba38a8f9c8bb04765bbdf19b8a514ea9e40`**, whose runtime/test change is
`2af3348a68ee0fab33d484dac9627ad7076276b0`. Checkout logs show that retained
branch commit, not a hypothetical merge with current Main. Its three unit
shards pass **4,537 / 5,006 / 5,066**, totaling **14,609 P / 76 skipped /
0 F**. This restores all seventeen previous CI expectations and includes the
eight added root-color controls. Installed Node22/24 consumers, quickstarts,
MCP, CLI, distribution, payload and browser-site checks pass. PR-event red/green
is skipped for this manual run; genuine local RED/fault epochs remain recorded.

Semantic conformance passes **173 / 0 F**, with **63/64 qualified and one
unavailable**. All 882 grammar inputs retain zero untracked defects and zero
unreviewed disagreements. Its broader diagnostic remains enrolled: **440/548
upstream-valid inputs rendered**, with separate model classifications of 431
structured / 10 opaque / 107 preserved. The diagnostic also retains six
reference-unqualified results and thirteen seed7 silent reads. Those categories
are not final-ink proof, a newly frozen holdout or evidence of ELK parity.
Passing assertions do not erase diagnostic gaps or establish universal meaning.
The complete decoded semantic log and remote artifact reference are retained.

Quality types, lint and audit pass: 513 diagrams / 2,052 format audits / zero
hard, soft or render errors; structural admission 513/513 and SVG markup
adapters 275/513. Overall quality still fails **23 unique lazy byte rows**:
17 raw and six gzip. Browser has **21 P / 1 F**, its editor raw HTML
**4,490,869 > 4,429,400**, an **808-byte increase** over the preceding candidate.
Editor gzip is not reached. This cost is disclosed, not tuned away or granted
a larger cap. The existing aesthetic advisory still fails: 234 corpus cases
have 47 regressions / 52 improvements / 135 changed, and the initial generated
256 have 123 regressions / 133 improvements. Both engines have zero API errors
in those and the six other historical 64-case cohorts. Zero status changes
means missing population only. These historical cohorts are not the sealed
0.6 holdout and do not prove certificate, aesthetics or performance parity.

Final independent readback is
`/tmp/pr449-independent-ink-peer-20261028/FINAL-SIX-EPOCH-READBACK.json`.
It directly rechecks all six final SVGs, source/options, full-return SVGs,
retained raster inputs/fonts and the seven frozen source/test member bytes.
State/Block/Requirement0/Requirement12 receipts use respectively
38,250 / 74,197 / 30,418 / 30,360 operations of the unchanged 400,000 cap;
Architecture uses 33,253 / 33,251. **Requirement bend0 has no bend0-specific
saved PNG**; its exact SVG preservation must not be counted as a new raster
observation. The earlier requirement marker raster concerns bend12. State raw
operands remain unavailable; coincident joins and overlapping Architecture
heads retain their stated pair/nonadditive limits.

Current increment readiness heuristics pass (342 changed text lines at the
abca documentation epoch). The generated-visual mechanical linter still fails
four image/section/SHA-label checks. The skill permits explaining unchanged
pictures: all six checked SVGs are exact; no image is fabricated and the linter
is not claimed green. No production check or cap is relaxed. Two closed
regenerable font caches were removed only after every member directly matched
its owning asset; zombie processes were distinguished from active consumers.

CI logs, exact job results, delivery rows, source patch and committed-source
byte readback are under `root-color-final/ci40748124441/` and its parent.
Main and retained remote refs were rechecked after completion: Main is
`019eedd31ed730f12b5047840dd61ab9e3cccd16`, retained head is abca8ba38. Only
integrated03641 was exercised; current Main is **not jointly qualified**.
The subsequent work-log-only revision changes no source, test, dependency or
workflow; it has no separate full-CI qualification or readiness claim.

All original seven diagrams and six goals remain open; all failed, unavailable
and unsupported observations stay enrolled. The next concrete runtime task is
legacy Native declared-resource custody, including unused definitions, before
row87's wider stroke/context admission. Shared peer work remains in the
separate Trident proposal. No timing campaign, holdout access, changed release
version/default, package publication, new PR/issue/comment, merge or force push.


### Declared Native marker resource custody

Runtime/test revision **`4ce6cf5b3ec2e3850ebae9c5a8663a3b4af838aa`** closes
Native's declared-resource loophole using its existing actual-definition scan,
canonical serializer and paid comparison. No second parser/writer is added.
Definitions metadata is read through captured own data/array slots and enrolled
in occurrence order. A later matching reference cannot erase an earlier
mismatch. Validated marked contexts require complete definitions grammar and
all actual resources bound to declarations/references; undeclared extras stay U.
An exact outer defs opener is required, rather than trusting scanner-skipped
attributes. The shared context's privately issued resolver identifies the
validated marked domain; unknown context and budget failure already refuse P.

Explicit marker declarations are byte-checked even in unmarked drawings;
unrelated unmarked nonmarker definitions do not acquire the new whole-defs
closure obligation. Generic mutable/getter/CSS/ownership isolation and the
400,000 cap remain unchanged. Missing-descriptor unused canonical resources
receive no authority, while matching declared unused resources remain P.
This is declared-resource custody, not universal document-ID/root-XML closure.

The owning cubic table adds four independently expected cases through both
execution paths. At unchanged0de, genuine RED is **5 P / 3 F**, 119 assertions:
Native incorrectly passes the missing-descriptor case and two actual hidden
arrowheads. Scene already refuses those; declared canonical-unused positives
pass under both. An earlier prepended-shadow hypothesis gives 3 P / 5 F because
marker ink remains visible; those source/log observations are retained and are
not counted as hidden-ink defects. Later placement reproduces actual shadows.
An initial external raster capture exits137 due to repeated pixel getter
materialization; partial files remain unavailable evidence. The corrected
bounded capture retains one buffer per render and directly verifies original
production bytes before/after. This is development acquisition, not a timing
or confirmatory holdout campaign.

For both later unused-marker-child and top-level-primitive ID shadows, actual
whole-image marker removal changes **zero pixels**. Removing only the exact
shadow restores **30 contributed pixels**. The literal tip triangle remains
outside its card; an off-shaft witness contributes independently of the shaft.
Both Native/Scene actual SVGs match. Independent PNG CRC/deflate/filter decoding
checks all 32 complete PNGs and exact SVG subtraction, without calling a
renderer or certificate. All **64 RED/GREEN SVG/PNG pairs** directly match;
Native now refuses the hidden markers with OUTPUT_SCOPE. No pixel repair or
public Mermaid-source defect is claimed.

A separate owning Native validation pair emits the same literal 664-byte SVG
and one black resource while its declaration either matches or claims none;
a later connector descriptor matches black. RED0de is **1 P / 1 F** because
Native ignores the conflicting declaration. GREEN is **2 P / 0 F**, 13
assertions; matching remains P and conflict becomes U/OUTPUT_SCOPE. Actual
SVG/header/inputs and test bytes directly match their recorded baseline.
This is descriptor-custody protection, distinct from hidden visible ink.

Frozen verification at4ce6cf5b3:

| Evidence | Result |
| --- | --- |
| Full cubic owner table | 36 P / 0 F; 461 assertions (subset below) |
| Eight paint/admission/endpoint/inline-label/Block/Requirement owners | 498 P / 0 F; 8,105 assertions |
| Disjoint Class/font/theme/SVG-postpass owners | 523 P / 0 F; 5,641 assertions |
| Canonical core/repository types | Both pass; unchanged Trident f080 type preparation |
| Full lint | Pass, 1,905 files; one existing oversized-JSON warning |
| Six cold public captures | All P; actual SVG/source/options byte-equal retained2af captures |

The disjoint owner total is **1,021 P / 0 F / 13,746 assertions**. Three exact
source/test copies before final checks equal current members after checks and
the committed Git bytes. The readiness heuristic passes for this100-line
source/test increment. The six public calls retain SCENE_ASSERTIONS=1; Native
production paths are additionally covered by existing fresh-process crisp
owners. No new solver/cache policy comparison follows from those six calls.

Five requested Sol6.1High agents supplied disjoint implementation or falsifiable
review. Evidence is under `/tmp/pr449-native-all-resources-20261028/` (RED1/RED2,
complete raw/raster epochs, source freeze, owner/statics logs and public-final)
and `/tmp/pr449-resource-isolation-20261028/`. Independent reports are
`INDEPENDENT-RED2-SAVED-INK-READBACK.json`,
`INDEPENDENT-GREEN-SAVED-INK-REBIND.json` and
`INDEPENDENT-FINAL-SIX-SOURCE-INK-BINDING.json`. Requirement bend0 still lacks
its own saved PNG; shared-pose/nonadditive counts and unavailable State raw
operands retain their previous limits. Fonts bind directly to owning Git
members, without importing or rendering a hardlinked baseline snapshot.

All original seven uncertainties and six acceptance goals remain open, the
independent holdout stays sealed and shared Trident peer work is unchanged.
Live Main019eedd is beyond integrated03641 and is not jointly qualified.
This increment has local verification; exact combined-candidate CI remains
necessary. The next source-derived concerns are duplicate document title IDs
outside definitions and malformed root suffixes; neither is yet an executed
counterexample. They must be checked before broadening row87's served stroke
and fractional-body proof domain. No timing/compiler tuning, cap/default/version
change, package publication, new PR/issue/comment, merge or force push.


### Declared-resource repair: terminal CI and delivery cost

[CI40756287244](https://github.com/adewale/agentic-mermaid/actions/runs/40756287244)
completed **failed** on exact candidate
**`c10a7a01d8eb085a88502e2a472e0649e2642451`**, containing runtime/test
**`4ce6cf5b3ec2e3850ebae9c5a8663a3b4af838aa`**. Actual checkout logs contain
c10; its parent is 4ce, not a hypothetical merge with live Main. All three unit
shards pass 4,537 / 5,006 / 5,076: **14,619 P / 76 skips / zero F**. The ten
additional controls are included, not added to that total again. Node22/24
installed consumers, quickstarts, MCP, CLI, distribution, payload and browser-site
checks pass. Manual PR-event red/green is skipped; the actual local RED0de
controls remain available and unchanged.

Semantic assertions pass **173 / zero F**, with **63/64 qualified and one
unavailable**. The 882 grammar inputs have zero untracked defects and zero
unreviewed disagreements. Broader diagnostics still retain 440/548
upstream-valid inputs rendered, 431 structured / 10 opaque / 107 preserved
model classifications, six reference-unqualified observations and thirteen
seed7 silent reads. These remain diagnostic gaps, not final-ink qualification.
No new public Mermaid/Pele geometry or full correctness parity is claimed.

Quality's types, lint and rendered audit pass: 513 diagrams / 2,052 formats /
zero hard, soft or render errors; structural 513/513 and SVG markup 275/513.
Overall quality fails **24 unique lazy byte rows**, now 17 raw / seven gzip.
The **new sequence gzip failure is 214,056 > 214,000**, 56 bytes over its original
cap. Browser has 21 P / 1 F: editor raw **4,491,358 >4,429,400**, **489 bytes more**
than the preceding abca candidate. Editor gzip is not reached. This additional
delivery cost is explicitly a regression of the repair; it is not relabelled
as noise or an old failure. No cap, check or work limit is relaxed and no
performance/delivery tuning or timing campaign is performed.

The existing aesthetic advisory remains failed with the same tradeoffs:
234 corpus cases have 47 regressions / 52 improvements / 135 changed; initial
256 generated cases have 123 regressions / 133 improvements. Both engines have
zero API errors in those and all six historical 64-case cohorts. Zero status
changes means missing population only. Existing historical inputs are not the
sealed 0.6 holdout, and zero API errors do not establish correctness/aesthetic
parity. No adverse case or unavailable observation is dropped.

Decoded logs, exact jobs, delivery rows and artifact references are under
`/tmp/pr449-native-all-resources-20261028/ci40756287244/`. Reference archives
remain at their authenticated GitHub artifact URLs; large raw ZIPs are not
newly downloaded. Actual source/test verification is the direct three-member
before/after/committed-byte comparison, not an own-input hash.

Post-CI live refs: retained head c10; Main has advanced to
**`700da836a418277225e2f058a77c48dc010b050b`**. Only integrated 03641 is in the
qualified candidate; new Main is **not jointly qualified**. The following
work-log-only revision changes no source, tests, dependencies or workflows
and has no separate full-CI or readiness claim. Overall CI remains red.

All original seven diagrams and six acceptance goals remain open. Next
concrete correctness step is to execute the separate title-ID/root-boundary
falsifiers, retaining failures or unavailable observations, before admitting
row87's exact served stroke/fractional-body case. Declared-resource custody is
now implemented; global document identity/grammar is not thereby proved. The
holdout remains sealed, shared Trident proposals unshipped, ELK default and
version unchanged. No new issue/PR/comment, package publication, merge or force
push is performed.


### Shared document identity and known root-fragment authority

Runtime/test revision **`165c93aad4abb3a40f0a2342524c0c05e0cc3d7b`** repairs two
executed paint-authority defects through the existing Native/Scene shared
emission context. It reuses retained document tokens and immutable marked
connector IDs, the existing output-security XML text rules and the unchanged
400,000-operation allowance. No geometry writer, generic XML parser, global
identity cache, producer-name exception or cap increase is introduced.

Four original912 Native artifacts have malformed final XML: text or a stray
angle before the opening SVG, a dangling angle after the opener, or an early
root close followed by stray text. Native draw/certify incorrectly reports P;
Resvg rejects those exact outputs, as does independent XML parsing. Admitted
Scene already rejects them. Public final output-security admission also already
rejects malformed XML: this is an internal drawing/certification defect, not a
newly demonstrated accepted public Mermaid-source rendering defect. The repair
withdraws their certificates, not their malformed bytes. Invalid-row rasters
are **unavailable**, never measured blank or zero ink.

Root preludes now require an XML-whitespace prefix and complete known
metadata/style ranges, with text checked through a pure wrapper over existing
XML character/reference kernels. Valid ordinary roots, whitespace, plain text
inside the root, spaced metadata tags and self-closing metadata remain P.
Observed document open/close and marked connector order are checked. Native
records group shells during producer construction rather than write traversal;
an initial draft incorrectly treated that callback as order evidence. Three
strict positive group/metadata controls expose **9 P / 3 F**, 71 assertions
against that draft. The construction-order check is removed, and valid
metadata spellings are preserved. All three regain their expected outcomes.
This distinction is not a general all-paint/group root-order proof.

The document-ID hypothesis required two consumers. Initial prospective
Resvg-hidden expectations fail: all twelve earlier/later title/description
and distinct-ID inputs have **30 contributed marker pixels** under Resvg2.6.2.
Independent decoding checks all 72 PNGs, exact marker/element/ID-only changes,
raw operands, font and source bindings. These failed hypotheses remain retained
and are not claimed as bug-discriminating RED or hidden Resvg ink.

A first Chromium file-URL probe is blocked by administrator policy before any
DOM or screenshot observation; it remains unavailable, not zero ink. A normal
loopback HTTP test then serves only explicitly enumerated generated SVG byte
strings, with image/svg+xml, unchanged browser policy and no filesystem route.
Installed Chromium **154.0.8037.57** independently exhibits the real defect:
when a title or description with the marker's ID occurs **before** definitions,
removing the marker changes zero pixels. Removing only that metadata element,
or changing only its ID, restores the same **28 contributed browser pixels**.
An off-shaft witness goes transparent to black/alpha250 and disappears again
with marker removal. Later metadata controls still contribute 28 browser pixels.
All 24 saved browser PNGs and exact intervention SVGs are independently decoded
and checked. Browser navigation uses actual standalone SVG/XML, not innerHTML.
This is a bounded installed-consumer observation, not new pinned public
Mermaid/Pele artifact qualification.

The final owning cases retain the honest Resvg-visible result and independently
assert actual namespace/markup facts. Their SVG bytes directly equal the earlier
Chromium-hidden artifacts or ID-only-restored distinct controls. Genuine
**pre-ID root-draft RED is 4 P / 4 F**, 116 assertions, with all physical/markup
checks passing before the status failures. This epoch includes the root-only
draft, not unmodified912; original912 complete packets independently bind the
same SVGs and incorrect P. Final cubic owner is **44 P / zero F**, 581
assertions. The shared context now refuses non-definitions DOM IDs intersecting
marked resource IDs, including Native resources:false, regardless of source
placement. Actual IDs are XML-decoded once; semantic data-id and ownership are
not conflated. Canonical actual resource bytes remain separately bound.
Distinct metadata IDs retain P. All twelve original probe rows remain enrolled:
eight collisions U/OUTPUT_SCOPE and four distinct controls P. Later visible
collisions are conservative identity refusals, not hidden-ink defects.

D's original malformed-root owner RED is **5 P / 4 F**, 49 assertions. Its
root-only GREEN is 9 P / zero F; the final expanded table is **12 P / zero F**,
71 assertions. All twenty SVG and sixteen PNG pairs against the draft-regression
epoch directly match. Ordinary/whitespace/plain-text pixels remain identical;
existing viewport/opacity refusals are retained, including the independently
blank opacity0 raster. The new spaced/self-closing/group cases were not
rerendered on original912: baseline applicability there is source evidence,
not a new baseline observation.

Final frozen verification:

| Evidence | Result |
| --- | --- |
| Ten paint/admission/endpoint/inline-label/Block/Requirement/XML-security owners | 544 P / zero F; 8,437 assertions |
| Disjoint Class/font/theme/SVG-postpass owners | 523 P / zero F; 5,641 assertions |
| Canonical core and repository types | Both pass; unchanged pinned Trident f080 type preparation |
| Full lint | Pass, 1,905 files; one existing oversized-JSON warning |
| Six cold public captures | All P; source/options/actual/full-return SVG bytes match retained captures |

The two disjoint owner batches total **1,067 P / zero F / 14,078 assertions**.
Focused tables are subsets, not additional counts. Four exact source/test
copies before final checks equal current members afterward and committed Git
bytes. The source/test readiness heuristic passes for the143-line increment.
The six public calls retain SCENE_ASSERTIONS=1; Native production is also
exercised by existing fresh-process crisp owners. No timing or new engine/cache
comparison is claimed. Their work receipts are respectively 38,404 / 74,401 /
30,456 / 30,398 / 33,353 / 33,351 of the unchanged400,000 cap.

Evidence roots: `/tmp/pr449-document-context-20261028/` (all B hypotheses,
blocked file probe, permitted HTTP browser acquisition, pre-ID and final-all
captures, owner/statics logs, four-member freeze and public-final) and
`/tmp/pr449-document-root-20261028/` (D finder, original RED, root-only GREEN,
introduced-regression RED and final GREEN). Independent reports explicitly
separate Resvg30 from Chromium28, parser refusal from unavailable rasters,
and source epochs. The final all-twelve/source/ink report and final-six report
preserve original fonts and physical scopes. Requirement bend0 still lacks
its own PNG; shared poses, overlapping Architecture heads and unavailable raw
State operands retain prior limits. No new baseline snapshot is imported or
rendered. Closed duplicate captured consumer binaries are hardlinked only to
other saved artifact copies after direct comparison; installed dependencies
and source files are not linked. Only closed regenerable caches are cleaned.

Five requested GPT-6.1 Sol High agents supply disjoint implementation and
falsifiable review. Remaining ordinary shape/text/group placement and generic
malformed root attributes are source hypotheses, not closed by this bounded
known-fragment check. Next: qualify the exact combined candidate in CI, then
execute remaining placement falsifiers or bind existing full final-XML
admission to proof authority before broadening row87's served-stroke/fractional
body domain. All original seven diagrams and all six acceptance goals remain
open, the independent holdout stays sealed, shared Trident proposals stay
unshipped and no public Mermaid/Pele correctness parity is claimed. Main700da
is beyond integrated03641 and not jointly qualified. No performance/delivery
or compiler tuning, cap/default/version change, package publication, new PR,
issue or comment, merge or force push occurs.


### Document authority: terminal CI, retained timing failure and next boundary

[CI40772917664](https://github.com/adewale/agentic-mermaid/actions/runs/40772917664)
tested exact candidate **`d65f670ac394a1b15ccb9f9774e5c606fff59f9b`**,
containing runtime/test **`165c93aad4abb3a40f0a2342524c0c05e0cc3d7b`**.
Both completed attempts remain **failed overall**. Actual checkout logs show
d65 and its parent 165; no hypothetical merge with live Main is tested.

Attempt 1 has **14,636 unit passes / 76 skips / one failure**. The sole failure
is the existing SourceMap linear-growth timing assertion at
agent-source-map.test.ts:746: 685.341710 ms against its computed relative limit
672.489888 ms. All changed paint/XML controls pass. The guard invokes chain
construction and parseRegisteredMermaid, not emission or paint functions; the
new XML helper is a pure declaration outside that timed call path. This source
trace does not establish the timing failure's cause or exclude import-residency,
GC or process effects. It remains a failed observation.

Exactly **one job-specific rerun** is requested on the same d65 commit with
unchanged parser, thresholds, dependencies and source. Retry job 123120977759
checks out d65 and passes all **4,537 / 45 skips / zero F** in shard 1, including
the previously failing guard. The latest unit shard results are
**4,537 / 5,006 / 5,094**, totaling **14,637 P / 76 skips / zero F**. Original
attempt 1 and retry logs are separate; these are latest shard results rather
than a new clean first attempt. There is no repeated retry, threshold change,
parser tuning, timing campaign or performance-parity conclusion.

Semantic assertions pass **173 / zero F**, with **63/64 qualified and one
unavailable**. All 882 grammar inputs retain zero untracked defects and zero
unreviewed disagreements. Broader diagnostics retain 440/548 upstream-valid
inputs rendered, separate model classifications 431 structured / 10 opaque /
107 preserved, six reference-unqualified observations and thirteen seed7
silent reads. These remain enrolled qualification gaps. Node22/24 installed
consumers, quickstarts, MCP, CLI, distribution, payload and browser-site pass.
Manual PR-event red/green is skipped; genuine recorded local REDs are retained.

Quality's types, lint and audit pass: 513 diagrams / 2,052 format audits / zero
hard, soft or render errors, structural 513/513 and SVG markup 275/513. Overall
quality still fails **24 unique lazy byte rows** (17 raw / seven gzip), with
sequence gzip **214,215 > 214,000**. Browser is 21 P / 1 F: editor raw
**4,492,288 > 4,429,400**, **930 bytes more** than c10; editor gzip is not
reached. These are delivery costs of this candidate. All original caps remain
unchanged; no delivery/performance tuning is performed.

The aesthetic advisory remains failed with the same vectors: 234 corpus cases
have 47 regressions / 52 improvements / 135 changed; initial 256 generated have
123 regressions / 133 improvements. Both engines have zero API errors in all
eight historical cohorts. Zero status changes denotes missing population only.
Those reused CI inputs are not the separately constructed sealed 0.6 holdout;
zero API errors and passing assertions do not establish certificate, beauty or
ELK correctness/performance parity.

Decoded logs, both timing outcomes, both summaries, latest job results and
artifact references are under
`/tmp/pr449-document-context-20261028/ci40772917664/`.
`CI-SOURCEMAP-TRACE.md` is a source assessment, not a runtime measurement or a
finding that the guard is flaky. Large raw CI ZIPs are not newly downloaded.
All successful, failed, unsupported and unavailable observations remain enrolled.

A bounded read-only architecture trace is saved as `NEXT-XML-AUTHORITY.md`.
Current positioned certification happens before colors, certificate-driven
viewport repair, text fitting, ID namespace/accessibility, numeric/style
finalization and final security. Reusing the already executed full final-XML
gate without another parse requires a private geometry-draft/final-certificate
distinction and exact drawing/request/string binding. Layout-only, direct
Native and cached raw-drawing consumers need explicit treatment. A smaller raw
XML admission at Native drawing could reuse the parser and close trailing-leaf
cases, but adds a raw scan before the mandatory final scan; cache kinds and
changed strings do not erase that work. Neither alternative is implemented,
measured, granted a larger budget or claimed to prove final ink.

Next concrete step is an owning final-artifact placement falsifier, then one
bounded private XML-admission prototype under unchanged caps, before row87's
served stroke/fractional-body expansion. Remaining ordinary shape/text/group
placement and malformed attribute cases remain unexecuted source hypotheses.
All original seven diagrams and six goals stay open, the holdout stays sealed
and shared Trident peer proposals remain unshipped.

Post-CI refs are retained d65 and live Main
**`ceca964f1a4aa4b3e748edbbce8728abd65ce632`**. Only integrated 03641 is qualified;
new Main is not jointly qualified. The subsequent work-log-only revision
changes no source, tests, dependency or workflow and has no separate full-CI
or readiness claim. No new PR/issue/comment, default/version change, package
publication, merge or force push is performed.


### Fresh bounded Native XML admission and namespace identity

This bounded continuation starts at **`25b5f5ed0d5c1a88164e0c594c55b31b60a9f514`**.
Runtime/test repair is **`d138827f4c383165b637d7dd30f8d79089853285`**
(`fix: bind Native marker proofs to fresh bounded XML admission`). PR449 remains
merged/closed; these retained-branch follow-ups are not Main. Current instructions,
qualification contract, work log, clean branch and PR discussion are reread.
The thirteen discussion entries have no newer guidance than comment6434515091
(updated 27October09:20UTC); historical performance work is not resumed. Five
requested GPT-6.1 Sol High agents own disjoint source/tests and falsifiable
soundness, isolation and actual-artifact reviews. The raw-admission contract and
its namespace-premise extension are published in the existing PR description
before their respective implementation edits.

**Demonstrated defect and repair.** Nine authored malformed direct Native
artifacts receive P on the starting runtime: an ordinary shape, prepared text
or group after the root; unknown/raw/zero/surrogate references and raw forbidden
characters in an otherwise allowed root attribute. Saxes and independent
ElementTree reject all nine complete saved SVGs. Resvg rejects eight but accepts
the surrogate-reference constructor input; no invalid-case raster is claimed.
Four valid controls retain actual saved PNGs, including an opaque off-shaft
arrow sample and its exact no-marker intervention. These are synthetic direct
Native drawings, not demonstrated public Mermaid-source rendering defects.

The exact joined raw SVG now reaches Native emission finish. Marker-bearing
proofs consume a fresh parse through the existing XML parser before their
private inspection-bound work record is sealed. The budget callback bypasses
the caller-seedable inspection cache: a cached boolean is not authority.
Already-issued inspection records cannot be overwritten, and wrapping already
issued occurrences cannot acquire fresh custody. Existing header identity,
mutable/getter, ownership, CSS and definition checks remain. No caller-provided
certificate flag, producer-name exception, global geometry cache or new parser
is introduced.

This new parse pays character/name/reference searches and materialized spans
before executing them, namespace-map entry copies before allocation and repeated
expanded URI/name keys before construction. Namespace identity separately
normalizes literal XML attribute whitespace, then expands each original XML
reference once; referenced whitespace is preserved. The security-obfuscation
decoder is byte-identical to the starting implementation. The unchanged
**400,000** allowance includes this new proof work. These units bound the
specified character/materialization/custody work; they are not machine timings
or a claim that later mandatory security work is charged to that allowance.
No-marker drawings retain their earlier proof domain, including the 4k/50k
polyline controls; complete no-marker raw-document admission is still open.

The reused parser also had five independent premises to repair: non-XML outer
whitespace, trailing FEFF, uppercase hexadecimal-reference prefix and illegal
QName local/prefix starts. A draft refused a valid leading BOM; an independently
accepted positive control exposed that introduced regression, which is repaired.
The leading BOM is accepted only at index0; inside-root FEFF remains text and
trailing FEFF remains invalid. Ordinary groups, metadata, Unicode and references
retain their authored admission behavior.

**Independent review prevented premature closure.** First-draft v1 owners pass
579 tests/8,619 assertions and canonical types, but a purposeful metadata
interaction exposes two further Native P invalid XML artifacts: duplicate
expanded names hidden by recursive reference decoding or absent literal XML
whitespace normalization. Both exact complete SVGs fail Saxes, ElementTree and
Resvg. The v2 namespace-only fix withdraws both certificates. A distinct-name
control remains P, including deep escaping and numeric-reference whitespace.
A separately enrolled encoded non-SVG-root case is XML-well-formed, already
Native U, and now rejected by envelope/security admission; it is not labelled
malformed XML or a new Native success.

Genuine controls and adverse observations are retained separately:

- Starting Native owner RED: **42P/9F/264 assertions**. The later positive RGBA
  refinement is recorded; the final whole test is not falsely labelled the
  identical initial RED byte epoch. Malformed-case assertions are unchanged.
- First parser-premise RED: **0P/5F/10**; introduced leading-BOM draft RED:
  **0P/1F/1**. Namespace-v1 Native RED: **52P/2F/293**, with exact source/test
  snapshots; public namespace RED: **0P/2F/8**.
- Isolation cases first pass2/7 assertions. Removing both overlapping seal
  guards fails only the reissue case; disabling the fresh-parse cache bypass
  fails only cache priming. Each mutation is **1P/1F/7** and directly restored
  byte-for-byte. The initial isolation RED is explicitly a pre-Native-admission
  epoch whose concurrent output-security bytes were not fully frozen.
- A focused draft run **6P/2F** reveals an overbroad test assumption: Saxes
  accepts digit-start QName cases that ElementTree rejects. Production's QName
  rejection is correct; that generalized consumer assertion is removed. Its
  queued duplicate rerun is canceled before execution. All consumer disagreement
  and failed-test evidence stays available.
- A broad local batch is incomplete at the unchanged117second limit:
  **525 passing lines, no assertion failures, exit124**. It is not a completed
  qualification or a source-attributed performance result.
- The first disjoint eight-owner batch is **167P/5F**: all five failure traces
  report **ENOSPC** while materializing bundled font snapshots. Under the product
  lock with no active products, only closed regenerable font copies (directly
  compared to all owning assets) and three old closed Bun transpiler-cache files
  are removed. No source, installed dependency, raw report, input, output or
  adverse evidence is deleted. The identical eight owners subsequently pass
  **172P/0F/5,918 assertions** with unchanged source, caps and thresholds.

**Final local verification.** Three changed owners pass **412/2,733 assertions**;
eight disjoint admission/cache/endpoint/Block/Requirement/inline-label owners
pass **172/5,918**; disjoint Class/font/theme/postpass owners pass **523/5,641**.
Total latest disjoint owners: **1,107P/0F/14,292 assertions**. Canonical core and
repository types pass using the prepared pinned Trident f080 source; full final
lint passes1,905files with its existing oversized-JSON warning. The committed
345-line source/test hygiene heuristic passes; the earlier pre-commit invocation
saw no committed diff and is retained as such. These are not readiness gates.

Final13 artifacts preserve every original SVG byte and all four valid PNG byte
and decoded-pixel observations: nine incorrect P become U/OUTPUT_SCOPE, four
valid P remain. Finalnamespace4 preserve exact falsifier bytes: two invalid U,
one distinct valid P and one separately enrolled non-SVG-root U. Invalid ink
remains unavailable. No certificate/helper output substitutes for final ink.

Twelve cold public calls are captured: six with Scene assertions ON and six with
assertions OFF using the production Native drawing path. Actual source/options,
actual and full-return SVGs match each other and the retained earlier captures
exactly. All twelve certificates pass. Scene proof counts remain
38,404/74,401/30,456/30,398/33,353/33,351; the production drawing-path counts are
103,423/234,193/70,228/71,511/75,950/75,933, all under400,000. These are proof-work
counts, not timing or layout-engine/cache comparisons. Graph backend options
remain as enrolled (including explicit ELK and Agentic arms); assertions OFF
is a drawing-path distinction, not six strict Native solver observations.
No historical Native P is inferred from an earlier Scene capture.

An independent reviewer binds all twelve final SVGs to the existing scoped
physical observations and independently decodes23 earlier saved PNGs. State
shared poses, Block shared ingress and Architecture overlapping heads remain
nonadditive; Requirement bend0 still lacks its own PNG; raw State operands and
full Architecture coverage remain limited. No fresh public raster, peer artifact
or broad actual-ink completion is claimed. Six final source/test members are
copied before final checks, compared after checks and compared directly to their
committed Git members. First-draft freezes and the one-assertion test correction
remain separate; no own-input hash is used for authority.

Evidence is under `/tmp/pr449-xml-authority-20261028/`: owners, review, isolation,
ink-review, final-artifacts, final-namespaces, both public capture lanes, negative
and incomplete logs, closed-cache maintenance records and v1/v2/v3 source epochs.
Exact-candidate CI is the next check; no new CI result is claimed in this entry.
Live Main remains **`ceca964f1a4aa4b3e748edbbce8728abd65ce632`**, beyond integrated
03641 and not jointly qualified. Existing CI delivery/aesthetic failures and all
caps remain enrolled; no delivery/performance/compiler tuning is attempted.

**Remaining boundary and next concrete step.** This is marker-bearing raw XML
admission, not a generic XML theorem or proof over later finalized SVG bytes.
Separate the private geometry draft from final certificate sealing, bind the
already mandatory final security admission to the exact output and request,
and cover standalone/layout/cache consumers deliberately. Then resume row87's
served stroke/fractional-body witness. Original rows77,87,88,89,103,206,209 remain
unverified; all six acceptance goals remain open. The independent holdout stays
sealed, shared Trident proposals stay unshipped and pinned public Mermaid/Pele
correctness comparisons are incomplete. No ELK correctness/aesthetic/performance
parity, merge, new issue/PR/comment, default/version change, package publication
or force push is claimed or performed.


### Raw XML authority: terminal exact-candidate CI and retained delivery cost

[CI40784447337](https://github.com/adewale/agentic-mermaid/actions/runs/40784447337)
completes **failed overall** on exact candidate
**`bd74cb5c4953c568b43293b78de9f9a0dea836a6`**, containing runtime/test
**`d138827f4c383165b637d7dd30f8d79089853285`**. Checkout logs bind that revision.
The single first attempt has **14,662P/76skips/0F**: shard counts
4,545/5,006/5,111 with45/13/18skips. The prior SourceMap growth guard passes
without retry or any parser/threshold change. No CI reruns are requested.

Independent semantic assertions pass **173/0F**, with **63/64 qualified and one
unavailable**. All882grammar inputs have zero untracked defects and unreviewed
disagreements. Broader diagnostics still render **440/548** upstream-valid
inputs, with431structured/10opaque/107preserved models. Across103upstream source
files, the3,474registered assertions classify1,879passed/121native-refusal/
720assertion-mismatch/735adapter-unavailable/6reference-unqualified/13skipped;
three files are uncollected. These aggregate counts match the prior CI, not a
proof that every case or actual ink agrees. They are diagnostic categories, not
720adjudicated candidate defects or broad support completion. Thirteen seed7
silent reads remain enrolled. Passing173 must not conceal these broader gaps.

Quality types, lint and the513diagram/2,052format audit pass with zero hard,
soft or rendering errors,513/513structural layouts and275/513SVG markup
adapters. Node22/24 installed consumers, quickstarts, MCP, CLI, distribution,
payload and browser-site checks pass. Manual PR-event red/green is skipped;
local genuine REDs and mutation controls remain available.

The repair has a measured delivery cost: **27unique lazy byte violations**
(17raw/10gzip), up from24. New gzip failures are Journey204,653>204,250,
Quadrant201,245>201,000 and Gantt207,326>207,000. Sequence gzip is
**214,800>214,000**,585bytes more than the prior candidate. Browser is21P/1F:
editor raw **4,493,756>4,429,400**, **1,468bytes more** than prior4,492,288;
editor gzip is not reached. All caps stay unchanged. This is a real cost of the
combined correctness repair, not an unchanged delivery result or a performance
improvement. No delivery/compiler/performance tuning or timing campaign occurs.

The layout advisory remains failed with unchanged aggregate vectors:234corpus
cases yield47regressions/52improvements/135other changes; initial256generated
have123regressions/133improvements. Both engines have zero API errors across
all eight historical cohorts; the six other64case vectors remain. Zero status
changes denotes missing population only. These reused inputs are not the sealed
0.6holdout, and zero API errors is not correctness or aesthetic parity.

The final evidence also explicitly enrolls two superseded early finder
observations: unprepared trailing text was already U/UNPREPARED_TEXT, and generic
opaque title/description metadata was U for an unrecovered reason. Their original
raw-byte freezes are unavailable in the final captures. Prepared text and typed
metadata are different authored inputs, not promotions of those earlier U cases;
no missing observation is reconstructed or labelled implementation success.
`EARLY-FINDER-LIMITATIONS.json` records that boundary separately from final13.

All decoded CI logs, terminal job list, complete summary, delivery rows and remote
artifact references are under
`/tmp/pr449-xml-authority-20261028/ci40784447337/`. No large remote ZIP is newly
downloaded. Final v3 source/test members match committed d138 directly and all
prior failed/incomplete observations remain. The final documentation-only update
changes no source, tests, dependency or workflow; it has no separate full-CI or
readiness claim. Retained branch bd74 and live Main
**`ceca964f1a4aa4b3e748edbbce8728abd65ce632`** are rechecked; only integrated03641
is jointly qualified. PR449 stays closed. Next remains exact final-output
geometry-draft/admission sealing with deliberate standalone/layout/cache handling,
then row87served-stroke/fractional-body witnesses. Original seven and all six
acceptance goals remain open, holdout sealed, peer comparisons incomplete and
shared Trident proposals unshipped. No merge, new issue/PR/comment, force push,
default/version change or package publication.


### Late accessibility identity repair and bounded CI subtraction — 29 October

The owner requests fixing CI and continuing correctness. Necessary delivery
repairs are authorized; the original byte budgets, all executable checks and
all work limits remain. The existing layout diagnostic is already advisory
(`continue-on-error`); its adverse vectors are retained, not reclassified as a
blocking failure. This increment does not repair all CI failures.

**Correctness repair:** `c632a2eaade2f24146695635c921ac4bbe5d201a`.
A controlled installed Flowchart producer renames its canonical arrow marker
and typed references to `svg-title`. The public strict-Agentic render certifies
raw ink, then accessibility injection prepends a title with that same ID.
Independent final XML parsing finds the duplicate. Chromium154 resolves the
first ID to the title and loses the head: actual and one-marker-URL-removed
pixels are equal. Three controls retain34head pixels. Resvg retains the head
in all four cases; that different observation remains enrolled. This is an
installed-producer seam, not a demonstrated natural authored-source failure.

The graphical finalizer now reserves actual once-XML-decoded emitted IDs and
allocates deterministic unused title/description suffixes. Root ARIA points to
the allocated metadata, while the original resource declarations and marker
references remain. Existing family-owned ARIA and fallback names keep their
own behavior. The owning accessibility file covers14cases in each fresh Scene
assertion mode, crossing prefixes, both metadata kinds, ordinary and encoded
occupied suffixes. Genuine baseline RED is2F/26assertions; focused GREEN is
2P/290assertions. An initial explicit empty-idPrefix fixture is rejected by the
existing option contract; that setup attempt is retained separately.

Fresh public production-drawing SVGs and eight HTTP-served Chromium PNGs show
the repaired title is `svg-title-1`, marker stays `svg-title`, and the head goes
from0to34pixels. All four actual outputs retain the same positive head ink;
three controls and all four removed-marker interventions keep exact baseline
RGBA. Independent PNG decoding validates CRC, decompression, row filters and
pixels; independent XML checks references. Actual SVG bytes bind the saved
interventions. This is actual final ink evidence, not a certificate oracle.
The source/diff epoch is unchanged across acquisition. It does not close generic
final-certificate sealing, prefix injectivity, no-marker XML or the original
seven diagrams.

**CI subtraction:** `0db3f02c7db91aed1017fd8d19db26181184f8d8`.
The pinned config generator shares only its exact720-key constructor literal.
Both complete independent factories, public exports, initialization order and
fresh mutable arrays/Sets remain. No theme code enters merge-only consumers.
Generated artifacts are the production-imported exception allowed by CLAUDE;
no dependency, declaration, parser, security gate or default changes.
Independent direct-production probes reconstruct the original full sources by
reversing only helper import/call substitution. Getter/proxy/cyclic-object,
exception/reentrancy, nested-result isolation and constructor-mutation/recovery
controls pass. Import constructs zero Sets; later calls construct distinct
720-key arrays and Sets. Initializer traces match1/1773events. Exact100000-step
admission stays merge14285P/14286F and full14248P/14249F, with successful fresh
calls after rejection. Constructor errors add an ordinary helper stack frame;
stack-byte equality is not claimed. Pinned regeneration and strict generator
checks pass; emitted two-facade comparisons pass24controls.

Local disjoint owners pass **615tests/0F/16094assertions**: accessibility/related
91/1912, security+paint358/2438, and six config owners166/11744. Focused2P is
inside91, not added twice. Canonical core/repository types pass on the combined
candidate with prepared Tridentf080. Full lint passes with the existing oversized
JSON warning. The full unit suite belongs to exact-candidate CI, not a new local
all-unit run. Five requested GPT-6.1 Sol High agents supplied disjoint test,
config prototype, independent production review, artifact review and delivery
architecture work; root alone edited the graphical production boundary.

Complete current standalone bytes are **4481508raw/1353193canonical Bun gzip9**,
versus publishedc1 **4493756/1356042**:12248raw/2849gzip lower including the ID
repair. It still exceeds original4429400/1334500caps by **52108/18693**.
Four fresh combined0db3public SVGs exactly match the earlier repaired artifacts;
all eight actual/intervention inputs directly match the retained browser inputs.
Those physical observations therefore bind to0db3without a new raster claim.
App89929 and CSS53555bytes are unchanged. The current canonical lazy build and
DTS succeed; its structural/provider/entity checks pass before the original
budget gate correctly fails **29rows:17raw/12gzip**, no request/Brotli failures.
This includes two additional gzip crossings (Radar and ZenUML) after the ID
repair versus priorCI27rows; the cost is retained. Against freshly rebuilt
c632before key-sharing, family raw counts are identical and gzip changes are
small (1–8bytes lower in the failed gzip rows). Sequence is214879>214000,
Packet raw608996>586500 and gzip194453>192500. This is partial editor shrink,
not green CI, lazy-cap repair, a performance win or ELK parity.

Rejected work remains evidence. Whole-program config sharing passes bounded
semantics but promotes the full appearance graph into merge consumers and has
an adverse tiny Brotli result; it is not adopted. Inline0 worsens old-input
bytes; reduce_funcs:false is identical. Dense-array representations fail the
old-input gzip cap, including the reserved-Oxc renamer variant. No new compiler
dependency or custom string transform ships. A single current syntax:false
Bun→unchangedSWC screen is4493382/1356579 and fails bothcaps; it is not adopted.
Static exact theme factoring has under43.2KB gross raw ceiling before overhead
and no demonstrated full gzip improvement; no transformation runs. Static ELK
alias readback does not support a reduce_vars hypothesis, so no profile runs.
Old0.11.0 pruned-ELK evidence does not qualify current0.11.1 or authorize a silent
vendor/dependency contract change. A maintained matching vendor would require
its own reconstruction and complete consumer qualification.

Earlier failed observations are preserved: the first producer attachment did
not affect the actual Native producer; a partial repeated-pixel-getter probe
exits137 with cause unestablished; its corrected single-buffer successor
completes. One prior agent turn reports an automated content-filter error;
root/another agent complete the needed acquisition. Artifact ZIP retrieval
receives proxy403 despite the configured unrestricted policy; decoded API CI
logs and remote artifact references remain available. No permission rejection
or current execution blocker is inferred. Only closed ignored website output
and dist source maps were removed to recover space; runtime JS, source,
dependencies and all failed/proof artifacts remain. Evidence lives under
`/tmp/pr449-ci-fix-20261028/`, with direct-byte-verified baseline lazy archive.

All six goals and original77/87/88/89/103/206/209 remain open/unverified; holdout
sealed, Trident prepared/unshipped, public Mermaid/Pele qualification incomplete.
Live Main last checked `db5de4b457944853c99c21a3921598fc49f8140a` is not jointly
qualified; this work stays on the retained branch. No merge/new issue/PR/comment,
force push, cap relaxation, version/default change, timing campaign or package
publication. Next correctness implementation remains the private geometry-draft
and exact final-admission seal across standalone/layout/cache consumers, then
row87 served-stroke/fractional-body proof. Delivery still requires a material,
independently qualified reduction; failed compiler screens are not a fix.


### ID/key-sharing exact-candidate CI result and next delivery boundary

[CI40793691622](https://github.com/adewale/agentic-mermaid/actions/runs/40793691622)
completes **failed overall** on exact published
**`a25b9e7b3a7f5a4c21e7c026b6d026a7857c3579`**, with runtime
**`0db3f02c7db91aed1017fd8d19db26181184f8d8`** and ID repair
**`c632a2eaade2f24146695635c921ac4bbe5d201a`**. One attempt, no retries.
All three unit shards pass **14664P/76skips/0F**:4545/5006/5113P and45/13/18skips.
This is two more passes than prior14662, corresponding to the new owning cases;
it does not establish broader correctness parity. Local disjoint615P remains
separate overlapping evidence, not added to CI's population.

Semantic173P/0F has63/64qualified and one unavailable. Grammar882retains zero
untracked/unreviewed inputs. Broader440/548renders,431structured/10opaque/
107preserved, upstream3474registered with1879passed/121native-refusal/
720assertion-mismatch/735adapter-unavailable/6reference-unqualified/13skip,
three uncollected files and thirteen seed7silent reads remain. These counts
match prior diagnostics, not independently adjudicated final ink or full support.
Quality types/lint and513diagrams/2052format audits pass with zero hard/soft/
render errors. All functional consumer lanes pass, including Node22/24,
quickstarts, MCP, CLI, dist, payload and browser-site. The browser lane's only
failure is its original editor byte gate:21P/1F, raw4481508>4429400; gzip is not
reached. The local complete candidate gzip1353193 remains separately observed.

The lazy gate retains29unique rows,17raw/12gzip. CI raw values equal the local
build; some CI compressed values differ by a few bytes and both observations
remain intact. CI Sequence214872>214000, Packet194449>192500, Radar205024>205000,
ZenUML220066>220000. No cap or check is changed. The resulting failed Quality
and browser jobs propagate to test/CIcomplete. The nonblocking advisory also
returns failure: corpus234has47regressions/52improvements/135other changes;
generated256has123regressions/133improvements; six64case cohorts retain
29/35,33/31,29/35,30/34,26/38,29/35. Both engines have zero API errors across
these historical cohorts. None is the sealed0.6holdout or establishes aesthetics.

The PR description is updated under the standing authorization, while PR449
stays closed. The292-line bounded readiness heuristic passes; two console
matches are the generator's normal size output and a test child's JSON transport.
The generated-media linter still fails one presentation check because the actual
workspace PNGs are not uploaded as public PR media; section/provenance checks
pass. This is an outstanding presentation limitation, not fabricated image URLs
or a failed pixel comparison. The source tests and direct physical observations
remain available in the local evidence. No overall readiness is claimed.

A bounded further architecture review finds a concrete remaining delivery path:
all679copied ELK computational source blobs, including259layered/115core, match
between the old compiler recipe's54123e8and the0.11.1release hyperlinkc831ba4.
However, its displayed28e5173revision differs in many core/layered files, compiler
inputs differ and the shipped GWT worker is rebuilt/changed. Installed0.11.1
artifacts match the actual public tag. This supports reconstructing a maintained
matching recipe, not relabelling an old0.11.0binary. New artifact provenance,
explicit private-vendor API narrowing and complete current consumer qualification
are required. No rebuild, vendor overlay or adoption occurs. Pruning ELK could
help the editor and ELK-demand closures; it cannot close the non-ELK lazy rows.
The exact-source finding and release-label ambiguity stay in
`architecture-new/pruned-version-review/REPORT.md`.

All decoded relevant job logs, terminal job list, unique lazy violations,
artifact references and summary are under `/tmp/pr449-ci-fix-20261028/`.
Current large ZIPs are not fetched; an earlier ZIP403remains an earlier failed
observation. Actual local shipping artifacts and seven committed source/test/
generator members are directly bound to Git and retained in `final-artifacts/`;
all61lazy archive members match emitted bytes. No source-input hashes are added.

This is verified correctness progress and partial standalone shrink; **CI is
not repaired**. Next implementation remains final geometry/admission authority,
with the maintained matching-ELK delivery reconstruction and non-ELK shared-core
reduction as distinct unresolved delivery work. Original seven and all six goals
remain open, holdout sealed and peer/Trident qualification incomplete. The
work-log-only follow-up changes no production/test/dependency/workflow and has
no separate full-CI or readiness claim. No force push, merge, new PR/issue/comment,
check/cap relaxation, default/version change, publication or timing campaign.

### 29 October: preserve resource identity through final namespacing

Parent revision: `81cd5da918b4c7307acb7f149a45a3513bbf9b68`. This is a
bounded correctness repair on the retained PR449 branch, targeting 0.6; it is
not Main, a release, full final-admission authority or seven-row qualification.
Five existing GPT-6.1 Sol High agents performed disjoint implementation and
independent falsification. The PR description stated the additional namespace
contract before implementation. No external comments/messages were sent.

`namespaceSvgIds` previously merged `arrowhead` and an existing `p-arrowhead`
when applying `p-`. An entity-spelled existing ID instead acquired the wrong
additional prefix. The repaired mapping uses once-XML-decoded identities,
reserves natural targets and unresolved reference names before allocating
suffixes, and uses the same mapping for declarations, URL/href and ARIA
references. Already-prefixed names remain stable where possible. Literal text
and data attributes remain outside rewriting.

The owning regression genuinely fails against the unchanged committed
producer: **4P/3F**, including actual Resvg marker ink. Both literal and
entity-spelled fixtures lose/substitute **94 pixels** before repair; the
current output changes **zero pixels** relative to independently authored
original red/blue/green heads. Original heads are independently nonempty.
The two definition orders have independently parsed Saxes identity/reference
expectations; uniqueness alone would miss the entity-spelled ownership defect.

Independent review then found the same preexisting failure class in encoded
CSS function names, delimiters and quoted IDs. Decode complete XML CSS segments
before URL tokenization, distinguish literal CDATA, and preserve actual XML
comments. Three gradient controls each change **800 Resvg pixels** before the
repair and zero afterward. Missing-reference controls also prevent a formerly
missing resource from accidentally becoming resolved.

A fake `</style>` inside an actual XML comment exposed premature stylesheet
range termination. The shared scanner now locates the closing style element
outside complete XML comments/CDATA; namespace processing preserves the comment
nodes. **Chromium 154.0.8037.57**, using the actual SVG Blob/image-to-canvas
path, independently observes original **800 painted gradient pixels**, old
namespace **0** (identical to the reference-removed control), and repaired
**800**, with zero original/repaired pixel differences. Exact SVG inputs,
source copies, PNGs and RGBA readbacks are retained. Resvg does not positively
support this comment fixture, so its observation remains unknown, not a second
successful raster lane.

A six-line scanner correction also prevents tag-like text in CDATA from
becoming real ID/CSS inventory. Two independently authored metadata/visible-text
controls genuinely fail before this correction and pass afterward. One old
`svg-inspection` expectation counted a phantom `red` attribute inside literal
CDATA; only that erroneous inventory item is removed, while its actual complete
style-body and transformed-byte expectations remain. This is helper text
preservation: every renderer security mode already rejects CDATA and processing
instructions. Their rejection is unchanged and they do not count as accepted
rendering successes or qualification of any original row.

Final namespace/scanner owners pass **51P/0F/832 assertions** across ID hygiene,
unique IDs, postpass characterization, SVG inspection and adversarial semantic
owners. Scoped lint and diff checks pass. Separate combined paint/native
validation/security/accessibility/preview owners pass **478P/0F/3839 assertions**;
these five files do not overlap the namespace owner's five. Final source types
and whole-repository lint pass; the existing oversized-JSON lint warning remains.
The high-severity dependency audit passes for 688 packages, retaining eight
findings below its threshold. No checks, ceilings or production work limits are
relaxed; the 400,000-operation proof limit is unchanged.

Fresh ordinary lazy ESM/DTS build passes. Independent final artifact readback
retains all **59 JavaScript modules**, metadata and source copies. All **25
families in both Scene assertion modes** preserve literal SVG bytes and entire
receipts against the retained baseline, with independently authored visible-text
witnesses parsed from actual SVG. This is 50 paired functional observations,
not a holdout or broader author-meaning/ink theorem. Caps and exact-head CI are
separate checks and remain to be recorded below.

Evidence root: `/tmp/pr449-ci-fix2-20261029/`. Relevant members include
`namespace-red.log`, `namespace-complete-owner-tests.log`, `namespace-ink/`,
`namespace-architecture-review/chromium-comment/`,
`REFROZEN-PAINT-SECURITY-PREVIEW.log`, `REFROZEN-TYPES.log`, `REFROZEN-LINT.log`,
and `production-lazy-review/final-refrozen-epoch/EPOCH-RESULT.json`.
Some review launch/observer setup attempts failed before their intended check;
their original commands/results remain alongside the corrected observations.

Unresolved counterexamples stay enrolled. Distinct overlapping prefixes `a`
and `ar` still produce a preexisting **cross-document** identity collision:
two actual `arrowhead` IDs, red ink 0/blue80 versus red40/blue40 under unambiguous
prefixes, and 60 differing Resvg pixels. This repair establishes the stated
single-document mapping contract, not a universal cross-document namespace
format. Percent-encoded IRI experiments are withdrawn: Resvg supplied no
positive original ink, and browser resolution was not established. PI phantom
tag mutation and the CDATA fake-style-close observations are retained with
all-mode renderer rejection, rather than promoted to accepted-render evidence.

All original rows **77/87/88/89/103/206/209** remain unverified; all six 0.6 goals
remain open. The holdout stays sealed, external Mermaid/Pele qualification is
incomplete, and no aesthetics, runtime, memory or ELK parity claim is made.
No timing campaign ran. Next correctness dependency is an explicit namespace
identity contract for overlapping document prefixes, followed by same-emission
geometry/paint receipts and exact final-admission authority. Row87 needs the
whole ring/body contact proof as well as a common visible stroke witness:
independent rational geometry shows a thinner B border can leave the witness
visible while admitting forbidden fill intrusion. Its current U is not repaired
by that calculation or by its retained 41-pixel marker intervention.

### 29 October: bounded standalone worker delivery; failed experiments withdrawn

The namespace repair is **`8e06d4861afb51dc5541415699c59f18259e304f`**.
This following change builds its complete standalone worker once, packs those
exact UTF-8 bytes with Brotli, and retains the existing module Blob Worker
protocol. The main thread keeps the engine-free adapter and captures the
build-owned inert payload before publishing it. No eval, Function, WebAssembly,
main-thread Blob import or required DecompressionStream is introduced.

The new build-only dependency is **brotli 1.3.3**; its base64-js 1.5.1 dependency
was already locked. CRC uses the existing UPng-owned Pako 1.0.11 dependency.
Frozen lockfile validation passes; all other locked versions are unchanged,
including canonical YAML 2.9.0 and ELK 0.11.1. Package version remains 0.4.2;
this campaign still targets 0.6 and leaves ELK as default.

Packed and decoded lengths and CRC32 values are compiled into the bootstrap.
The build independently compares the complete native-decoded worker bytes.
The loader verifies both byte sequences before constructing an immutable Blob,
then gives each Worker attempt a fresh URL. These are corruption checks over
closed build-owned code, not cryptographic authentication or a new general
Brotli-data API. Deferred CJS initialization includes dictionary/base64/CRC
setup inside one sticky physical codec budget. Nested calls cannot replenish
work or swallow a limit violation. Guards enforce output at most **8 MiB**,
window at most **22**, **32 million original loop bodies**, and a **30-second
cooperative deadline**; no hard interrupt is claimed. The existing worker
30-second deadline and every source/Scene/paint/output limit are unchanged.

Owning behavior tests cover capture-before-publication, packed/decoded corruption,
no Worker/URL on failure, immutable Blob reuse, fresh URLs after crashes,
cancellation before decode, BFCache restoration and monotonic client IDs,
original snapshots/queues/PNG callbacks, and shared/sticky work limits. An
independently authored loop case covers directives, labels, continue targets,
unbraced/empty loops and the exact 18 charged bodies. The actual codec fixture
uses the production compiler plugin and minifier. These owner tests pass
**40P/0F/275 assertions**, included in the combined 478-test population above.

Independent Acorn inversion validates **all 62 original loops across 11 codec
modules** and recovers original AST/comments after removing only the declared
guard edits. Actual oversized initial-output and meta-block-growth controls,
window23, corrupted checksums and cancellation refuse before the prohibited
allocation. Successful cold decoding of the freshly built **4,279,732-byte**
worker produces a Blob exactly equal to every independently native-decoded
byte, under one physical budget. Prior 4,278,086- and 4,279,340-byte epochs remain
separate evidence. Fresh source equality binds the unchanged guard proof;
those old byte lengths are not relabelled as the new artifact.

Opaque packing does not hide notices. The build discovers actual physical
worker dependency origins and original JS legal comments before stripping,
includes their full license texts and maintained source-adaptation notices,
and fails missing/unknown origins. Collection has explicit input, ancestry,
package, file and byte limits. Acorn correctly distinguishes actual comments
after quote-bearing regexes from inert strings: the first raw TS scanner
missed this and the genuine failed fixture is retained. All **12 external
origins and 21 full-license texts** pass independent actual-HTML readback.
Brotli's declared MIT attribution and actual Google2013 Apache headers/full
terms, base64 MIT and Pako MIT/Zlib credits remain outside the payload with an
explicit modification notice and no invented upstream copyright year. The
stale lodash attribution is corrected to the actual es-toolkit1.53.0 header,
README and Viva Republica license.

| Complete standalone HTML | Published81cd baseline | Current combined artifact | Original limit |
| --- | ---: | ---: | ---: |
| UTF-8 bytes | 4,481,508 | 1,930,461 | 4,429,400 |
| Canonical Bun gzip9 bytes | 1,353,193 | 1,238,287 | 1,334,500 |

The current gzip headroom is **96,213 bytes**. This is complete-artifact
accounting including the decoder, guards, app, styles and notices, not isolated
closure savings or an ELK-only size comparison. Runtime/memory parity is not
measured. The canonical Chromium standalone owner passes **2P/0F/504 assertions**:
actual Blob bytes equal the independently native-decoded complete worker;
all25 families/three looks match source SVGs, complete receipts and verification;
strict backend selection/fallback, one persistent Worker, crash recovery,
ASCII/Unicode and real Canvas/font/PNG export pass. Initial local invocation
used the wrong 30-second test timeout and failed while its source child was
active; the repository's canonical browser timeout is600000. That failed
invocation and one unintended duplicate old-owner run after a cwd edit error
remain recorded and are not added to the successful population.

**CI is still not fixed overall.** The unchanged lazy gate correctly exits1
with **32 byte failures:18raw/14gzip**, versus prior29(17/12). No request or
Brotli gate fails. Correctness repair cost remains visible: Packet is now
610630raw/195048gzip versus prior local608996/194453; Pie newly crosses raw,
and GitGraph/Sankey newly cross gzip. No limit is increased to conceal this.
The ordinary build/DTS, final 50 paired family functional observations, types,
lint and targeted owners pass; exact published-head CI is still a separate
requirement. All raw rows/values remain in `REFROZEN-LAZY-CAPS.log`.

The competing lazy projection/pool implementation is **withdrawn**, not left
as shipping complexity. Independent inherited setters change complex-key flow
formatting, expose removed Document methods, and invoke a rewritten constructor
that drops authored `{marker:17}` data. All class/method/constructor/tag/context
pruning is therefore rejected. A full-canonical reader facade repairs those
observations and passes84 reader cases, ranges, errors, callbacks and all25
family SVG/receipt comparisons, but saves only **194raw/77gzip/15Brotli bytes**.
The string pool saves raw bytes while increasing gzip and failing15gzip rows.
Its exact patch, tests and negative outcomes are archived; its four tracked
files are restored byte-for-byte to81cd and only its new helper is removed.
The established YAML, minifier, optimizer hash inputs and lazy configuration
are unchanged. No additional compiler/minifier profile or timing campaign ran.

The separately authorized matching-ELK0.11.1 unpruned reconstruction also remains
failed/inconclusive. Its original300-second acquisition watchdog expires while
Gradle starts a single-use daemon, before any Maven request or GWT compilation.
All778 earlier relay calls complete; both pinned tool archives verify, actual
6GiB/zero-swap/2CPU/128PID controls and2GiBtmpfs ENOSPC witness pass. The process
is reaped and the owned container is removed, independently confirmed. No
usable artifact, vendor adoption, old0.11.0 relabelling, retry or larger limit
results. The missing daemon diagnostics leave its cause unknown; this is not a
current execution/access blocker for repository work. Frozen application
normal/cache-OFF recaptures each match150 complete earlier stock observations,
including five retained expected unsupported errors.

Final evidence: `REFROZEN-{EDITOR-META,EDITOR-BUILD,LAZY-BUILD,LAZY-CAPS,TYPES,LINT,
PAINT-SECURITY-PREVIEW,STANDALONE-BROWSER}.*`,
`production-standalone-review/final-refrozen-cdata/REVIEW.json`,
`production-lazy-review/final-refrozen-epoch/`,
`production-lazy-owner/safe-port-archive/`, and
`elk/UNPRUNED-FIRST-TERMINAL.json`, all under
`/tmp/pr449-ci-fix2-20261029/`. Review harness selector/PATH/typed-array setup
failures are preserved beside their corrected observations, not called product
successes or product failures. Storage recovery removed only clean tracked
files from32 closed historical worktrees; Git objects and side files remain,
eight dirty worktrees were excluded, and exact restore commands/evidence are
in `storage-review/`. Current/concurrent source changes were preserved.

All six release goals, the seven original U rows, cross-document prefix
counterexample, generic final seal and no-marker XML obligations remain open.
Holdout sealed; no external peer correctness campaign or performance campaign.
Shared Trident work remains unshipped. Main has advanced and is not jointly
qualified. Next concrete work is exact-head CI and the unresolved namespace/
same-emission/final-admission dependencies above; failed caps are not readiness.
No merge, force push, new issue/PR/comment, default/version change, package
publication or check/cap relaxation.

### Exact first CI result and packaging/fixture follow-up

Runtime/test revision **`b6cf6807ae18976ebf1444732cb0424d83049802`** and
namespace revision **`8e06d4861afb51dc5541415699c59f18259e304f`** were normally
fast-forward pushed to the retained branch. CI **40847746357, attempt1** is
terminal **failed**, without job retries. The existing PR description is
updated; PR449 remains closed/merged and the changes are not on Main.

The original editor budget failure is repaired in actual CI: the browser job
passes all five canonical contracts, **140P/0F**, including22 editor,68 lazy
browser,2 CSP,2 CORS and46 interaction cases. The standalone full-Blob byte
comparison, all-family receipts/verification, recovery and PNG checks pass.
Node22 consumers, quickstarts, MCP, CLI, dist, website payload and browser-site
lanes pass. Node24's functional tarball tests pass, then its strict package
file check finds the new license missing from the reviewed manifest.

The quality job's sole failed check remains **32 lazy byte rows,18raw/14gzip**;
no request/Brotli failure. CI compressed values differ slightly from local
values; both remain in the logs/CI-LAZY-VIOLATIONS.json. The513 diagrams and
2052 format audits have zero hard/soft/render errors. Types and lint pass.

Unit shards record **14686P/76skips/2F**, not a clean suite: shard1 is4568P,
45skip,1F; shard2 is5005P,13skip,1F; shard3 is5113P,18skip,0F. The new tests
are not the two failures. One existing website fixture copies the builder but
omits its newly required LICENSES/Brotli-MIT.txt. The other is the unchanged
source-map growth guard:5000 shaped nodes692.5ms versus625 nodes18.6ms, above
its618.9ms limit. One subsequent authorized owning source-map file check passes
51tests/439assertions; that does not establish the CI cause or erase its
failure. Parser, source-map and complexity-test files are byte-unchanged from
81cd. Static review identifies repeated negative whole-suffix regex scanning
as preexisting potential quadratic work; preserving the diagnostic's deliberate
suffix semantics is necessary before any repair. No parser optimization,
threshold/slack increase, extra timing campaign or retry is adopted.

Semantic173P remains63/64qualified with ZenUML unavailable. Upstream3474keeps
1879passed/121native-refusal/720mismatch/735adapter-unavailable/6reference-
unqualified/13skip plus3uncollected files. The grammar diagnostics retain13
silent reads and1402unsupported observations. The advisory fails with346
regressions/393improvements/135changed across874paired occurrences; all8
populations complete with zero snapshot errors. These are overlapping dated
cohorts, not a sealed holdout or new correctness/aesthetic parity. Complete
logs, semantic artifact and denominator summary are retained in
`CI-semantic-advisory-40847746357-attempt1-SUMMARY.json`.

The additional packaging correction adds exactly **LICENSES/Brotli-MIT.txt**
to the existing reviewed npm file manifest; every other entry/count and
verifier rule is unchanged. The actual packed-package checker reproduces the
one unexpected-file failure, then passes **226 exact files** after correction.
Independent tar readback finds every before/after member and file byte identical:
the license already shipped through the declared LICENSES directory. Full
license/notice bytes match the source. This local probe verifies the file
contract, not freshly rebuilt Node/IIFE runtime contents; CI's separately built
consumer artifacts provide runtime evidence. Its archive SHA256 is
5316039129a00615a2c25e4beee3762b0af6428b749d3464e2704bfbf342cfc0.
The initial local npm cache ENOENT under /home/agent is retained; an explicitly
scoped npm_config_cache under /tmp corrects it without changing HOME or limits.

The owning checkout-with-spaces fixture now copies the actual **LICENSE,
LICENSES directory and THIRD_PARTY_NOTICES.md** alongside its existing inputs.
It still runs the copied real builder from the isolated space-containing cwd,
uses the existing dependency symlink/output-only preload, and retains every
assertion and20-second child/60-second test limit. Independent static review,
lint and diff checks pass. **Local green is not claimed**: cold and stable
filtered attempts hit the unchanged20-second child watchdog with cleanup
confirmed. One private stage-name-only diagnostic stops inside the existing
worker minifier, before Brotli packing or notice collection; this does not
establish an internal cause or justify tuning compiler options. The original
CI ENOENT and these distinct timeout observations remain separate. A new-head
CI observation is needed to close this fixture failure.

Independent review also records a cache-custody gap: the existing website
fixture content fingerprint omits scripts/build and maintained notice inputs,
so repeated edits to already-dirty files can reuse stale output. No new
self-source hashes or enlarged hash inventory are introduced to mask it.
Current artifact qualification uses fresh builds and direct source/artifact
byte comparisons; a principled cache dependency/custody repair remains open.
Repository writes are paused during a website fixture run because its existing
snapshot includes HEAD and whole-repository status, even for disjoint edits.

The two one-line package/fixture changes are the next CI candidate, not a claim
that every gate passes. Raw evidence is in CI-{unit1,unit2,unit3,browser,quality,
tarball-node24}.log, MANIFEST-{RED-CACHE-FIXED,GREEN}.log,
production-standalone-review/package-manifest-b6cf-review/,
website-space-review/, website-space-path-*.log, space-build-stage/ and
source-map-review/, under the same evidence root. All seven diagrams, the
six0.6goals and the other counterexamples above remain open; no holdout access,
performance campaign, check/cap relaxation, release/default/version change,
package publication, force push, merge or new issue/PR/comment.

### Remove a redundant standalone compiler stage within the existing deadline

CI **40852037030, attempt1** completes failed on exact
**`ed27114c42e798f7387a23e52e2870a4933cb629`**, but its functional regressions
are closed: **14688P/76skip/0F** across4569/5006/5113passing unit shards,
Node22/24 consumers, the strict226-file packed-package manifest, all140 browser
contracts, MCP, quickstarts, CLI, dist, website payload and browser-site pass.
The copied-checkout test now passes its original child bound in CI. The
previous source-map growth failure remains a retained observation; its parser
and threshold were not changed, and this passing observation is not proof of
linear complexity. Quality still fails only the32lazy rows; advisory losses
remain nonblocking. No job retry is used.

Locally the corrected checkout fixture still reached its unchanged20-second
child deadline. One bounded private stage-name trace reaches worker build end
and worker minification start, then expires; packing/notices have not started.
This is a build-stage observation, not attribution to a particular internal
optimizer operation or a rendering benchmark.

A single fixed subtraction tests a newly available architectural simplification:
**Bun already minifies the worker; omit its second SWC pass.** The new Brotli
delivery gives enough byte headroom to remove that formerly useful stage.
Main-thread and app SWC processing remain, and the raw worker is still packed
into the same inert base64 payload. No new compiler/options profile, parser
pruning, runtime algorithm, message protocol, source/Scene/proof limit or
family eligibility change is introduced. The additional contract and original
acceptance gates were published in the PR description before the production
one-line port.

The private fixed candidate matches all720worker physical input bytes and
normalized input metadata, main202physical inputs plus2virtual wrappers,
notices and every surrounding HTML byte. Its first complete byte screen passes
both unchanged caps. Its original20-second fixture equivalent then genuinely
passes1test/3assertions and produces exactly that screened HTML. The actual
repository owning checkout test also passes **1P/0F/3assertions** with the same
20-second child and60-second test limits; the earlier timeout records stay.

| Complete standalone artifact | Second SWC retained | Selected subtraction | Original cap |
| --- | ---: | ---: | ---: |
| Worker decoded bytes | 4,279,732 | 4,451,718 | 8,388,608 codec maximum |
| Worker Brotli bytes | 1,006,361 | 1,084,521 | Existing complete HTML caps apply |
| HTML UTF-8 bytes | 1,930,461 | 2,034,673 | 4,429,400 |
| Canonical Bun gzip9 bytes | 1,238,287 | 1,318,939 | 1,334,500 |

This deliberately trades **80,652gzip bytes** for removing a compiler stage,
while preserving **15,561bytes of original gzip headroom**. Against the
published81cd complete HTML it still saves2446835raw/34254gzip bytes. These
are complete-artifact observations, not a claim of faster layout, smaller
runtime memory or ELK superiority. No timing campaign runs.

Independent actual-root review performs exactly one fresh cold decode of the
**4,451,718-byte** worker under the same8MiB/window22/32M/cooperative30s bounds.
Every Blob byte equals the independently native-decoded actual HTML worker.
The helper, budget, payload, loader and lockfile directly equal the qualified
62-loop proof epoch, so negative/inversion checks are not repeated. All12
external origins and21full-license texts remain. Both actual worker/HTML byte
sequences equal the privately screened candidate; source snapshots remain
unchanged before/after. Actual editor metadata and both caps pass.

The existing canonical standalone browser owners pass again:
**2P/0F/504assertions**. Actual full worker-Blob bytes, all25families/three looks,
complete SVG/receipts/verification, backend selection/fallback, cancellation/
recovery, ASCII/Unicode and real Canvas/font/PNG behavior retain their expected
outputs. Canonical core/repository types and whole-repository lint pass.
The production change is only the worker assignment and an explanatory comment;
main/app formatting and all surrounding output remain intact. Exact new-head
CI is required after commit; the preceding ed271CI is not this code's CI result.

Evidence: `WORKER-SUBTRACTION-ACTUAL-SPACE-OWNER.log`,
`SUBTRACTION-{ACTUAL-EDITOR-META,ACTUAL-EDITOR-BUILD,ACTUAL-STANDALONE-BROWSER,
TYPES,LINT}.*`, `worker-swc-subtraction/`, `worker-swc-independent-review/`,
and `production-standalone-review/final-worker-swc-subtraction/REVIEW.json`.
All are under `/tmp/pr449-ci-fix2-20261029/`.

A separate single private subtraction for the remaining lazy gate is rejected:
esbuild minify:false followed by the unchanged existing SWC pass gives
**34failures,18raw/16gzip**, versus32in production. Architecture exceeds raw
by35458bytes; Packet and Ishikawa exceed gzip by5004each. Brotli and request
caps pass. Its additional frozen per-module graph guard also fails, but that
is a separate diagnostic: all751global inputs/59outputs match, with a36-byte
paint-work source contribution difference in one shared chunk. The unchanged
original budget report independently rejects the same built bytes. No rebuild,
new profile or guard waiver follows. An appended direct comparison reconstructs
frozen ed271Git blobs and matches all511own source/config/report/cap files;
these are explicitly reconstructed copies, not preexecution filesystem copies.
This rejected experiment adds no production self-source hashes or optimizer.
See `lazy-remove-esbuild-pass/TERMINAL.json` and its preserved reports.

The selected worker subtraction repairs the bounded local build without
trading away correctness checks. The lazy byte gate, seven original unverified
rows, all six release goals, cross-document prefix counterexample, cache-custody
and final geometry/admission authority remain open. Holdout sealed; no external
peer qualification, solver tuning, cap/timeout increase, release/version/default
change, package publication, force push, merge or new issue/PR/comment.

### Exact worker-subtraction CI and supporting-rectangle custody

Exact retained-branch commit **b75d4b51037614917585f8b896da0d6d5ad4c7fa**
completes [CI40857070739](https://github.com/adewale/agentic-mermaid/actions/runs/40857070739)
on its first attempt, with **14688P/76skip/0F** unit tests, all140 browser
contracts and52 browser-site tests passing. The1084 resolved-scene comparisons
cover35043 primitives without failures. Node22/24 installed consumers, the
strict226-file package manifest, quickstarts, MCP, CLI, dist and website-payload
lanes pass. **Overall CI remains failed:** the unchanged lazy gate has exactly
32 byte violations,18raw/14gzip, with no Brotli/request failure. Every violating
row value directly equals ed271's preceding CI observation. The separate
nonblocking advisory retains346 regressions/393 improvements/135 changed cases
across874 pairs; all eight summaries directly equal ed271. No retry, parser
threshold change, cap increase or timing campaign is used.

The live Main ref at this observation is
**0a2dc30b6220c04182f8ccd45550689422606a22**; it is not integrated or jointly
qualified. PR449 remains merged/closed; these normal fast-forward follow-ups
are on its retained branch, not Main. Complete logs, run/checkout metadata,
direct row comparisons and workflow bytes are retained under
`/tmp/pr449-ci-fix2-20261029/final-b75-ci-review/`.

Independent rectangle probes retain all adverse outcomes. Nonzero-origin
viewport examples remain Native-unverified and Scene-refused. A proposed
zero-origin clipping counterexample is **not reproduced**: raw
1.0000000000109 writes1.00000000001, matching its translation, rather than
writing1. Its served body begins at0. The snapped input writes1 and obtains
the correct final viewport expansion beginning at-10. Independent Decimal
composition of actual final XML contains both served bodies; actual body
removal changes12288 raster pixels in each, while the fixed reveal observer
changes none at that downscale. There is no demonstrated wrong P and no
geometry repair from this probe. See `rect-{body,viewport,zero-origin}-review/`.

A prospective narrow supporting-rectangle contract is published in the existing
PR description before production edits, saved as `PR-B75-RECT-CONTRACT.md`.
Five existing Sol6.1High agents own two disjoint implementation/test scopes,
independent custody and final-ink reviews, and exact-CI/compatibility observation.
The frozen development witness changes only a supporting sharp rectangle's raw
x60.00000000000001 or width30.00000000000001, which writes the existing integer
body. The existing integer-only circle/body guards must remain unchanged.
Actual final public SVG/receipt and nonempty marker-removal ink, not a helper
result, must distinguish baseline U from candidate P. Ordinary served fractional
bodies, long/unknown paint and every original limit retain strict outcomes.
This is not row87 or seven-case completion, a sealed holdout, peer qualification,
ELK parity, or readiness. The initial test fixture's unsupported marker viewBox
and canonical preload's Scene execution are recorded as setup failures, not
meaningful failing-before controls. Baseline and candidate implementation
results are recorded below only after observation.

The first rectangle candidate, **RECT1**, is rejected before commit. Its focused
public owner genuinely changes two rounded-coordinate U results to P, with
identical complete SVG/PNG bytes and24 actual marker-removal pixels. The full
paint owner passes340tests/2370assertions. However, the separately captured
50-cell comparison finds **six Native-path P-to-U regressions**: State, ER,
Journey, C4, Ishikawa and Event Modeling. All50 actual SVGs and independently
decoded XML/text rosters are unchanged. Native receipts change operation counts;
Scene-assertion receipts remain byte-identical. Native certification changes
23P/2U to17P/8U; Timeline/Xychart retain their pre-existing uncertainties.
All six affected families contain rounded rectangles, matching the overly broad
new receipt enrollment and subsequent sharp-body rejection. Public issues
supply only conditional counts, so private primitive IDs are not invented.
RECT1 sources, actual outputs, complete receipts and adverse comparisons are
preserved in `rectangle-production/RECT1/` and `native-rect-compat-b75/`.
This blocks shipping despite passing focused tests. A prospective correction
must select the narrow new authority before emission, preserve unsupported
legacy outcomes, and keep eligible missing/duplicate receipts strict. A further
review probes inherited paint that changes during the actual writer; pre-write
paint values cannot substitute for the values the writer actually emits.

The independent fixed inherited-width probe confirms an additional **RECT1
false P**: an inherited strokeWidth getter returns0.25 and deletes itself on
its third actual read. Actual final XML writes0.25, but the post-write proof
assumes the missing property's default1. The full ring reaches60.5 while the
actual body's inner outline edge is60.125, intruding0.375 into forbidden fill;
the public receipt nevertheless reports passed/issues[]. This is a concrete
new changed-overlay soundness blocker, not a speculative review checklist.
The probe runs once without read-count tuning and retains source/direct-byte
binding in `rectangle-independent-review/RECT1-TRANSIENT-WIDTH.json`.

Two new owning controls genuinely fail against RECT1: that false P and the
unmarked rounded rectangle's false U. The corrected prospective contract is
published before implementation as `PR-RECT2-ACTUAL-PAINT-CONTRACT.md`. The
existing writer must retain its actual13paint literals and transform presence
without extra caller-field reads, close one bounded occurrence-bound receipt
after writing, and compare those actual literals with inert expected paint.
Pre-write eligibility excludes unsupported bodies without waiving a failed
eligible receipt. Both record and comparison work remain in the existing
ledger. This supersedes the insufficient idea that pre-write expected paint
alone proves what a mutable prototype subsequently writes. No new candidate
success is claimed here before observation.

The final candidate, **RECT2.4**, binds one eligible supporting rectangle's
actual x/y/width/height/radii and actual13paint/one-transform literals to the
same complete write. Its pre-write domain is sharp, noncompound, positive
extent, no leaf transform and inert own paint with unchanged numeric spelling.
The actual writer issues the bounded paint/pose receipt without extra caller
field reads. Native checks actual literals, served radii and receipt identity
before any same-coordinate shortcut; missing/duplicate/mismatched receipts
remain conditional. Changed proof geometry, paint and the shallow proof leaf
have private null prototypes, preserving own metadata and checked absence.
Nested ownership and general final-output sealing are not claimed closed.
Unsupported rounded/transformed/long-numeric-paint rectangles retain their
legacy paths; no integer circle/body guard, geometry byte or work cap changes.

Acquisitions ran on parent **b75d4b51037614917585f8b896da0d6d5ad4c7fa** plus
the exact two-file production patch committed with this section; literal source
copies and direct before/after comparisons bind each epoch. RECT1 remains
rejected and preserved. RECT2's initial parse failure and subsequent missing
TypeScript narrowing guard are retained separately; neither is called a
passing observation. RECT2.3 adds only the explicit geometry-presence guard;
RECT2.4 additionally pays for the changed proof leaf's shallow inert copy.
Final types/core+repository, lint and diff checks pass, with the existing
oversized-JSON lint warning retained.

| Final local observation | Result and scope |
| --- | --- |
| Existing paint owner |342P/0F/2385assertions, including14 new public final-SVG controls. Two old b75 U cases become P with identical actual SVG/PNG bytes; the two demonstrated RECT1 regressions fail before and pass after. |
| Related writer/native owners |106P/0F/1253assertions across five existing files. Combined disjoint total448P/3638assertions; focused reruns are not added again. |
| Independent late inherited hook | A descriptor hook installs inherited paint AFTER preeligibility; actual SVG width0.25 correctly remains U. Actual emitted literals are necessary beyond the pre-write snapshot. |
| Fresh final compatibility |50/50returns,0errors; all actual SVGs and decoded XML/text rosters unchanged. Native-path23P/2U and Scene-assertion25P retain every outcome. |
| Complete receipt differences | Only Native operation counts change (+32 through+8603); all other fields match. Largest final example135121/400000operations. Scene-assertion receipts are byte-identical. No timing or memory claim. |
| Original seven development cases |28engine/policy cells, two fixed observations each:56returns/0errors/0failed certificates; row77has8P, the remaining six have48U. No row is removed. |
| Selection/repeats/cache observations | All requested/selected strict backends observed; all28fixed repeats and14cross-policy pairs have identical full SVG/receipt bytes. Native makes0ELK calls; actual Native cache behavior remains UNOBSERVED. Existing ELK cache events distinguish OFF bypass from NORMAL miss/hit; API-call counts are not inner-solver counts. |

The seven sources directly match both retained230-case corpora and current
committed corpus/fixture bytes, rather than being identified by array offsets
alone. Independent output digest and actual XML observations bind every final
packet. First observations retain98POTENTIAL_OCCLUSION and2UNMEASURED_PAINT
issues across all28cells; Native row103 additionally reports changed path
anchors requiring explicit user-space marker units. Matching overall statuses
with ELK does not erase that uncertainty or prove broader correctness parity.

A separate fixed two-engine **b75 source** control establishes that row77
already passed before this patch. Its actual SVG bytes equal RECT2.4, and only
recorded operations rise1706per engine. It is explicitly **not a newly closed
case or a U-to-P achievement** of this change. Independent current row77 ink
qualification and actual Native cache observation remain separate requirements.
Rows87/88/89/103/206/209 remain certificate-unverified under both engines and
both configured policies. All seven remain enrolled in the0.6 programme.

Evidence is under `/tmp/pr449-ci-fix2-20261029/`: final owner/type/lint logs,
`rectangle-production/`, `rectangle-independent-review/`,
`final-ink-rectangle-review/`, `rect2.4-native-compat-b75/`,
`rect2.4-original-seven/` and `row77-b75-causal/`. All rejected earlier epochs,
raw SVG/PNG/RGBA, complete receipts, source snapshots and setup failures remain.
The physical four-case ink capture and exact one-guard bridge retain their
original epoch; final public owning tests and fresh50/seven captures are
separate evidence, not relabelled historical artifacts.

This coherent change is ready for normal fast-forward continuation and its
new-head CI observation, **not overall PR/release readiness**. The previous
b75CI still fails32unchanged lazy byte rows; this new code needs its own exact
head CI and actual final delivery observations before any new CI claim. The
current live Main0a2dc30b6220c04182f8ccd45550689422606a22 is not integrated
or jointly qualified. All six0.6 goals, full seven-case qualification, generic
final sealing, compound cylinder/stroke/cubic proofs, cross-document prefix
collision, cache-custody and pinned public Mermaid/Pele/Trident qualification
remain open. Holdout sealed; ELK default/version/release and every cap remain.
The next correctness step is to consume this occurrence-bound geometry/paint
boundary for a sound complete fractional stroke/straight-polyline proof of
row87, retaining whole-body separation and its thin-border counterexample;
typed cubic and complete cylinder unions follow their owning obligations.

### 29 October: seal unchanged rectangle paint and refuse inherited fallback

Published **fc9e3e38437a7cf78f2d68a345574532ab91fd06** completes
[CI40867079574](https://github.com/adewale/agentic-mermaid/actions/runs/40867079574)
at attempt1: **14702P/76skip/0F**, every functional lane,192browser/site tests
and1084resolved-scene comparisons/35043primitives pass. CI remains failed on
**33lazy byte rows,18raw/15gzip**, one more than b75: Timeline198802gzip
exceeds its unchanged198000cap by802. Advisory vectors remain exactly equal
across874pairs:346regressions/393improvements/135other changes. The actual
uploaded CI editor metadata reports2009159raw/1310619gzip, passing original
caps with23881gzip headroom; matched b75CI costs are1202raw/684gzip lower.
This is uploaded producer metadata plus passed physical browser assertions,
not independently reconstructed HTML. Local b75measurements stay separate.
Actual checkout logs, parent b75, published/local clean fc9 and live Main
0a2dc30b6220c04182f8ccd45550689422606a22 are verified. PR449's historical
closed head is not misidentified as this tested head; no merge/base claim.

Independent current row77 review confirms expected A/B, a thick labelled
A-to-B edge, visible bundled-Inter glyphs and distinct marker ink: removing
markers changes116/120pixels in the two served engine outputs. Exact XML
checks clipped marker/body/label/root geometry; eight saved observations bind
by literal SVG equality. The separate b75control already passes with identical
SVG, so this remains **observed current development correctness, not a new
row closure**. Actual Native cache behavior and full qualification stay open.

A final unchanged-coordinate review finds **two further false passes on exact
fc9**. Each is acquired once with frozen source and independent actual XML,
complete public receipt, PNG/RGBA and positive marker-removal controls:

- An integer supporting rectangle reads inherited strokeWidth0.25, whose getter
  deletes itself on read3. Actual SVG writes0.25; the proof's legacy fallback
  assumes default1 and passes although stroke enters forbidden fill by0.375.
- A larger integer circle has world center57/40 and outer radius4.5. The body
  actually omits stroke-width (SVG default1); after writing, the producer adds
  inherited width4. The unchanged-coordinate shortcut discards the inert paint
  and returns the earlier prototype-backed leaf. Actual ring right61.5 enters
  actual fill beyond60.5 by1, but the public certificate incorrectly passes.

Independent exact rational stroke patches lie inside later opaque fill. Other
marker ink survives (24/36pixels), so this is partial erasure/contact, not
marker blindness. Preexistence before fc9 is not claimed without an earlier
baseline observation. Both adversaries remain enrolled; cleanup restores the
original prototype descriptor in finally.

The expanded contract is published before implementation. **UNCHANGE-R1** is
only7insertions/7deletions in native-paint-emission.ts: encountered inherited
paint keeps emission uncertainty sticky rather than sharing an ordinary
unsupported fallback; **every eligible rectangle** consumes its validated
actual geometry, inert paint and null-prototype leaf. Delete the coordinate
shortcut and its unused pregeometry copy. The complete SVG writer, Scene path,
integer predicates, ordinary unsupported legacy paths and all caps are
unchanged. This closes the two demonstrated sharp-domain escapes, not generic
unsupported paint, other primitive/nested-owner custody or final sealing.

| Final precommit observation at fc9 plus the exact Native-only patch | Result |
| --- | --- |
| Genuine controls |Two old false-P regressions fail2tests/21assertions, then pass2tests/26assertions with actual XML/trace/positive marker-ink checks. No fixture variants or repeated finder probes. |
| Existing owning tests |344paint tests/2413assertions and82related Native tests/1203assertions pass:426disjoint passes/3616assertions. Focused checks are included, not counted twice; unchanged writer owners are not rerun. |
| Canonical checks |Core/repository types, full lint and diff checks pass; existing oversized-JSON lint warning remains. |
| Fresh50compatibility |All50return,0errors, no actual SVG/decoded XML/text/status changes against committed fc9 outputs.16OFFreceipts change only operation counts;25ONfull receipts are identical. |
| Fresh original-seven matrix |56/56returns, no SVG/status changes;8P for already-passed77/48U for the other six. All changed receipt fields are operations only (-46/-69/-92 by row); maximum313708/400000. Repeats/cross-policy full bytes match; actual Native cache remains UNOBSERVED. |

The50-cell operation deltas range-69through+262, maximum135112/400000.
These are work-ledger observations, not layout timing or memory measurements.
All883production/runtime bindings and actual source before/after copies match
the frozen epoch; the writer directly equals committed fc9. Independent custody
and ink reviews approve this narrow correction without repeating producer or
raster probes. The actual Green public tests, old physical false-P ink and
unchanged writer are separate evidence; no new after-PNG capture is invented.
Evidence root: `/tmp/pr449-unchanged-rect-20261029/`.

A bounded peer readback also compares the exact24-byte row87source with
already-retained pinned public Pele1.9model/SVG: A/B, sole A-to-B relationship
and circle endpoint are observed at model/XML boundaries, with own Native/ELK
SVGs preserving those authored facts. Public-model equivalence and full peer
paint/provider admission remain unverified; no new provider calls, renderer,
download or timing is used. Current Mermaid12.2.0source/manifest admission is
not substituted for an executed selected-provider comparison. Exact used
bytes and provenance are copied under `/tmp/pr449-peer-row77-20261029/`.
Shared provider/fidelity implementation still belongs in Trident.

All six0.6goals remain open; six original certificates remain U and all seven
stay enrolled. Holdout sealed; ELK default/version/release unchanged. The next
concrete correctness work is still row87's complete fractional stroke/cardinal
polyline proof using actual geometry/paint authority, retaining the thin-border
counterexample and full-body separation; general final sealing, cubic/cylinder
unions, broader independent coverage and peer qualification remain. Lazy byte
failures are retained, not waived. The next committed source requires its own
exact-head CI; fc9's completed run is not relabelled as that new result.

### 29 October: reconcile contextual duplicate-marker proof with Main

Starting revision: `a1890b6265fe48bc120735540e5830d0b19df904`.
Fast-forward pull of the retained branch returned already up to date; Main was
observed at `0a2dc30b6220c04182f8ccd45550689422606a22`. The read-only
reconsideration found overlapping correctness work in Main. Its merge-object
preview has eight conflicts; no wholesale merge, raised cap, release metadata
or routing change is adopted. The first selective port follows the
duplicate-marker paint rule from `700da836a418277225e2f058a77c48dc010b050b`.
Broader serialized-marker/contact changes in `ceca964f1a4aa4b3e748edbbce8728abd65ce632`
remain pending; neither Main commit is claimed wholly integrated.

The failed assumption is observable without another implementation: equal
resource bytes and marker pose do not imply equal paint at different carriers.
One actual resource uses `context-stroke` for fill and outline; its earlier
carrier is dark and its later carrier is white. The old pairwise exemption
skips comparison. A second path collapses equal-owner/resource/pose entries
before that comparison, including a chrome repaint inheriting semantic status.
Both sites must require known equal paint; one pairwise guard is insufficient.

The existing paint-certification owner now contains independently authored
public-output controls for literal paint, contextual distinct owners, shared
owners and owned chrome repaint, through Native OFF and Scene ON. The special
test producer declares its actual chrome/connector capability; production
admission checks remain unchanged. The first RED attempt retained one accurate
role-admission rejection separately. The corrected final fixture gives genuine
**six failures (old P, required U) and two literal positive passes**, 82
assertions, against unchanged a189 production. The preceding unmodified owning
suite passed 344 tests/2,413 assertions. Test presence is not an oracle.

Independent actual-output evidence uses an isolated, directly byte-checked
a189 production snapshot and the same eight public calls. All eight return P.
Strict returned XML retains one 14-by-12 diamond resource, two ordered
70,30-to-20,30 carriers, their different stroke colors and actual references.
Chromium 154 reads those SVG documents over a bounded local HTTP route map;
24 screenshots include actual output and removal of each marker reference.
At the independently authored off-shaft strict-interior point (64,27), each
contextual case is opaque white in actual output and with the earlier reference
removed, but dark (17,17,17) when the later reference is removed. Literal paint
stays dark in all three views. This establishes contextual-paint support and
actual earlier-marker ink erasure; it does not infer paint from a certificate,
replace context paint with a guessed color, or claim whole-diagram fidelity.
`currentColor` and inheritance do not automatically follow carrier stroke and
are not relabelled as observed causal variants.

Five existing Sol 6.1 High agents have disjoint source and owning-test writers
plus independent proof, final-ink and integration reviews. Root owns serialized
execution and integration. Evidence, adverse controls, direct source copies
and actual images are under `/tmp/pr449-integration-proof-20261029/`.
The workspace evidence volume is full; the separate `/tmp` execution volume
remains writable. No evidence is discarded to make space.

Implemented source/test revision:
`152fe1e88ce71d14f1c3605e66db3a2f0d1169b4`, parent a189 above. Only
`src/scene/paint-certification.ts` changes production (49 additions/3 deletions);
the owning test adds 69 lines. Inspection, Native emission, SVG writer, imports,
dependency lock, caps, default, version and delivery pipeline remain unchanged.
Own-data descriptors copied into inert paint refuse relevant accessors and
inherited fields without invoking their getters. Explicit fill remains required;
unresolved/contextual paint cannot establish equality. String scans, copying and
equality consume the existing work ledger. The existing same-key semantic
transfer is retained, but unknown paint records U before overwriting; exact-pose
pairwise skipping also requires known equal paint. No normalized-pose alias or
new primitive acceptance is added.

Rejected R1 and its five existing repaint regressions remain recorded. R1
unnecessarily demanded an explicit marker outline and opaque group. R2 preserves
the existing typed no-outline semantics for an own-omitted stroke under the
unchanged closed emitted root/definitions/style obligations; arbitrary SVG
inheritance is not declared none. Finite positive group alpha remains owned by
the existing visibility/compositing rules rather than the resource color
identity. No old expectation or fixture paint was changed to hide a regression.

Verification of the exact R2 production bytes before commit:

| Check | Observed result |
| --- | --- |
| Six owning test files | 458 P / 0 F / 3,754 assertions, including all eight new controls and all five restored repaint positives. Focused runs are not added to this total. |
| Canonical checks | Core and repository typechecks pass; full lint passes with the pre-existing oversized-JSON warning; diff check passes. |
| Canonical public examples | 50/50 return, 48 P / 2 pre-existing U (OFF 23 P / 2 U; ON 25 P). Complete SVG/XML/text/status unchanged from actual a189 packets. Only 16 receipt operation counts change (+129 through +852); largest changed-cell count 135,916 / 400,000. |
| Original seven | 28 engine/policy cells, two fixed observations each: 56 returns, 8 P for already-passing row77 / 48 U for the other six. Complete SVG/XML/text/status unchanged; all 56 receipts change only operations (+129 through +7,336), maximum 320,744 / 400,000. All repeated and cross-policy full SVG/receipt pairs match. |
| Observed execution | Strict requested/selected backends and independently computed output digests match. Native makes zero ELK calls; actual Native cache behavior remains UNOBSERVED. ELK records 16 OFF bypasses and 16 NORMAL API calls (7 misses / 9 hits); API calls are not solver counts. |
| Public regression artifacts | Eight fresh candidate captures return two literal P and six contextual U. The isolated baseline has eight P. Their complete SVG bytes are compared separately to bind the actual retained Chromium images; no proof helper substitutes for final ink. |

R1 acquisition was never run. The existing bounded acquisition was reused once
at R2, with unchanged source inputs, work/time/output limits and all six worker
exits zero. An analysis output-name collision correctly refused overwriting the
already-written compatibility comparison; the combined analysis preserves it
and uses a separate output name. No product/data acquisition was repeated.
Source authority uses direct byte snapshots/comparisons, not hashes of own
inputs. Independent proof and integration reviews bind the actual R2 bytes.

This is a common certifier soundness repair, not an ELK/Native parity or aesthetic
claim. All six0.6goals remain open; original rows87/88/89/103/206/209 remain U,
with row103's changed cubic-anchor obligation retained. Broader final-artifact
correspondence, remaining Main marker/contact/routing/source-preservation
integration, the independent authored interaction pilot, cubic/cylinder proofs
and pinned public Mermaid/Pele qualification remain outstanding, in that
dependency order. The independent holdout remains sealed. No timing/profiling
campaign, cap relaxation, default/version/publication change or PR merge occurs.
The previous exact a189 CI failed 33 lazy byte rows; this source requires its
own exact-head CI, and no inherited readiness is asserted.

### 29 October: complete the bounded row87 circle proof outcome

Source/test commit: `f024e58717f55318931a1b44ed94b220c8f64ff1`, parent
`e440e7cb053bb7c79ad75c5d8806b182418786f8`. The retained branch was pulled
fast-forward-only (already current); Main remains separately observed at
`e68b23a8301d5c267966468fb0a5f58bf5d78eaa`, not merged or jointly qualified.

The reset follows dependencies and measures a completed diagram obligation:

1. Check whether upstream/peer changes are actually prerequisites. Main ceca's
   endpoint helper excludes this circle's interior reference point, so importing
   it cannot close87. The community catalog and pinned public Pele1.9 executable,
   model and SVG show an inline **filled** dot and shortened shaft. Pinned
   Mermaid12.2 source retains resource markers. Keep our hollow ring/resource
   encoding; inline conversion adds writer, semantic ownership and equivalence
   work without removing ring/body obligations. Stop research once this choice
   is supported; retain the useful once-materialized endpoint idea from Pele.
2. Freeze original author facts and purposeful thin-border/wide-shaft controls
   before implementation. The actual original24-byte source has A/B, LR, one
   A-to-B relationship with a circle end and no relationship label. An isolated
   baseline directly matches all852 production inputs at e440; the six stock
   owning cases give genuine2F/4P (both originals U, required P),164 assertions.
3. Reuse existing actual-write polyline/rectangle and resource authority.
   A new private compatible context requires checked canonical root/style/colors,
   complete bound definitions, actual absence of transforms and actual prepared
   one-line Inter/ASCII text correspondence. No writer/parser/dependency changes.
   Preparation ownership comes from the retained block brand; `safeFont` is a
   system-font measurement option, not an authenticity flag. Normalized fitted
   advance is enclosed by three outward text ticks, never ignored as contact.
4. Derive one complete world-ring fact with exact bounded thousandth-unit
   operands in half-thousandth integer ticks. Cardinal mapping uses no rounded
   operand, trig, contact epsilon or larger cap. One positive-area stroke patch
   clears the shaft and every later paint support; the entire ring avoids every
   forbidden fill. Later prepared text has a complete outward exclusion box.
   Preserve supplied/raw envelope unions and final viewport checks. Unknown
   CSS fallbacks, inherited/accessor defaults and unsupported geometry remain U.
5. Verify actual final meaning/ink, owning isolation, compatibility and canonical
   checks before one publication/CI cycle. Five existing Sol6.1 High agents had
   disjoint implementation/test work and named peer, proof and final-ink tasks.

The first private prototypes exposed two integration defects before publication:
unknown CSS fallback incorrectly supplied a concrete paint, and an optional
internal `separated` flag could be inherited from Object.prototype. Existing
unknown-CSS expectations stay unchanged. A new owning control draws a completely
covered integer ring, observes zero marker-removal effect, then installs that
prototype flag only during synchronous certification and restores its descriptor.
It genuinely fails1F/9 assertions before the fix. Both proof constructors now own
a required boolean (old false/new true). These were prototype regressions, not
defects newly attributed to published e440. Two physically clear fractional-body
scope controls legitimately become P under the same general tick theorem; their
independent full-ring clearance and actual marker ink are checked explicitly.

| Final observation | Result |
| --- | --- |
| Six owning test files | 465 P / 0 F / 3,942 assertions. Core/repository types and full lint pass; the existing oversized-JSON warning remains. A test-only literal-type error was fixed without changing expectations. |
| Original87, both graph engines | U to P with identical complete2,999-byte final SVG and unchanged actual/counterfactual PNG. Full annulus right148.25 clears B's filled interior148.375 by1/8;41 marker-dependent pixels, visible A/B glyphs59/68 pixels, ordered ownership and viewport fit independently observed. |
| Actual public model/peer meaning | Exported parseRegisteredMermaid returns LR, ordered A/B and the sole A-to-B circle-end relationship, matching independently authored facts and the retained pinned public Pele model. Pele's fill, shaft and style differ; its internal provider remains unverified. No executed Mermaid row87 comparison is invented. |
| Thin/wide adverse stock sources | Actual0.1 border gives1/5 forbidden-fill intrusion with a concrete open stroke patch; actual10px fixed-unit shaft plus B's border absorbs the ring (zero PNG/RGBA marker-removal difference). Both engines keep both cases U; no input tuning or discarded precondition. |
| Canonical compatibility | 50 returns,48 P/2 pre-existing U, no SVG/XML/text/status changes. All25 OFF receipts change only work (+15 through+69), maximum135,961/400,000. |
| Original-seven fixed matrix | 56 returns,16 P/40 U. Only87's eight engine/policy/repeat observations change U to P;77 stays P and88/89/103/206/209 stay U. Every SVG/XML/text remains exact; repeat/cross-policy full packets match. Work rises+16 through+28,381, maximum320,925/400,000; this is not a timing result. |

The existing106-call acquisition ran once on the final source with six zero
worker exits and direct source snapshots, not own-input hashes. Native makes
zero ELK calls; actual Native cache behavior remains UNOBSERVED. ELK retains
16 OFF bypasses and16 NORMAL API calls (7 misses/9 hits); API calls are not
solver counts. The complete row87 default geometry/ink observations do not
complete cache qualification, a general final-SVG seal or all-six-goal parity.

Evidence and exact rejected/final sources are retained under
`/tmp/pr449-row87-campaign-20261029/` and
`/tmp/pr449-row87-ring-20261029/owner/`. Root executed products under the existing
global lock; reviewers independently inspected actual XML, public models,
bundled-font PNG/RGBA and unchanged-source bytes. The holdout stays sealed.
All six0.6goals remain open. Next reuse this proof boundary for the five remaining
original uncertainties, with independent authored interaction coverage and
shared final-output correspondence still required before broader qualification.
No performance campaign, cap/check relaxation, backend/version/release change,
package publication, force push, PR merge or external comment occurred. The
previous exact e440 CI failed33 lazy byte rows; this source needs its own CI.

### 29 October: share row87 write authority and reject unrecorded group paint

Source/test revision: `ee1ca980fdaac34d02a90cfb5747107abefeb9a9`, parent
`8b098e2c5d6203eb263af588ccf3a1d4f9618f30`. This is follow-up work on the
retained PR449 branch, not Main. The historically merged PR stays closed.

The Native milestone did not close the Scene/strict obligation. Actual baseline
observations showed the same2,999-byte original SVG remained U through asserted
Scene, and strict rendering refused, under both engines. Frozen owning
expectations gave genuine14P/4F/360assertions across three sources, two engines
and Native/Scene/strict execution. Four original Scene/strict cells failed;
adverse cases and Native originals remained enrolled. Stock expectations and
the independently authored source facts were not tuned after this observation.

One shared emission-context predicate now owns prepared text, canonical context
and absence of transforms. Native's duplicate new predicate was removed.
Scene's existing first-write transaction now binds eligible sharp rectangles
to actual geometry and all13 emitted paint attributes, and prepared text to its
actual write. Receipt issuance, exact Scene/node/source/WRITTEN-byte identity,
private admission handoff, cached replay and per-inspection occurrence custody
remain distinct. New shape/text facts are consumed once per inspection. Raw
mutable/getter inputs cannot gain this authority from a later prototype change;
the private null-prototype ownership handoff precedes all new observations.
The opt-in is limited to original builtin unstyled output, excluding the
backend-added styled backdrop. Unsupported shapes retain their old proof paths.

Independent review found two implementation soundness problems before this
publication, and actual controls determined the fixes:

- The optional capture flag could be inherited, or read six times through an
  accessor, granting P without explicit output opt-in. Two genuine RED cases
  give2F/52assertions after observing identical final SVG and real marker ink.
  Capture now snapshots only an exact own-data true value; inherited/accessor
  options remain off, without invoking the accessor.
- Group closing strings and join separators could draw opaque rectangles
  absent from typed primitives. Four Native/Scene cases gave P despite complete
  final-pixel marker erasure. An empty Native group whose owner getter prevented
  shell capture caused the same false P in fractional and legacy integer
  domains. Those two further cases also observed well-formed final SVG and zero
  whole-image marker-removal effect before the failing certification assertion.
  Shared fractional context now checks complete captured group shell strings;
  the Native producer marks a failed GROUP capture uncertain using the existing
  issuer API. This closes all proof paths for that unobserved group without
  changing unrelated snapshot failures, the writer or geometry.

The six group reproductions are separate genuine epochs, not a fabricated
combined run. Initial missing DOM identity/count expectations and a nonexistent
owner refusal remain recorded as setup failures, not product false passes.
The constructor rejects the proposed constant opening-string example, so that
unrendered case is not counted. A private raw-group comparison on the same
candidate (optionOFF/ON, not an8b checkout) observes identical SVG, identical16
paint reads, no extra paint-reflection traps and no issued receipt.

The first broad owner run was483P/1F: an old test explicitly required Scene U
because write authority was missing. Its physically clear integer/raw-tail
pair has identical SVG, full ringright60.5 exactly touching fillinner60.5 and a
shaft/body-clearing stroke patch. The added scope was prospectively published
and independently reviewed before that existing test required P with literal
geometry/viewport and actual marker-removal observations. A subsequent484P run
predates the group findings and is not the final result. The first typecheck
found a test-only optional-string narrowing error, corrected without relaxing
its refusal assertion.

| Final observation | Result |
| --- | --- |
| Six owning files | **490P / 0F / 4,662assertions**. Canonical core/repository types pass. Full lint passes with the existing1.2MiB JSON warning. |
| Original87 Native/Scene/strict × both engines | All six original cells P. Four new actual Scene/strict captures return the identical2,999-byte SVG; one marker, eight primitives, five measured, two prepared text, no conditional/unmeasured paint or viewport repair. Independent final-ink readback retains41 marker-dependent pixels, A/B glyphs/ownership and1/8 fill clearance. |
| Same thin-border/wide-shaft controls | Eight ordinary Native/Scene returns U. Four strict adverse calls retain typed U refusals and explicitly have no returned final SVG/PNG. Thin actual SVG3,000B retains41 marker-dependent pixels but forbidden fill intrusion; wide actual SVG4,827B has zero marker-removal effect. |
| Fresh/cache/foreign/forged/alias/option controls | Fresh genuine receipt P; cached replay, foreign/forged receipt, aliased shape/text and inherited/accessor opt-in cannot acquire new authority. Clear group positives stay P; all six demonstrated full-erasure controls now reject P. |
| Existing50 canonical observations |50 returns,48P/2oldU, zero changed SVG/XML/status; complete receipts differ only in charged operations. Maximum136,033/400,000, delta+20..1,594. |
| Original seven, existing56 observations |56 returns,16P/40U, zero changed SVG/XML/status against published8b Native milestone; rows77/87 P and88/89/103/206/209 U. Maximum321,225/400,000, delta+20..848. Full repeat/cross-policy packets, output digests, requested/selected engines checked. |
| Source/cache accounting |852 baseline inputs match committed8b directly; seven runtime changes and nine per-mode source copies match frozen R3. Same31 runtime artifacts. Native makes zero ELK calls; its actual layout cache remains unobserved. ELK OFF records16 bypasses; NORMAL7 misses/9 hits across16 API calls, without claiming inner solver calls. |
| Independent review | Final combined-source review, module/cohort review and actual model/SVG/PNG/RGBA ink review bind R3. No remaining concrete finding inside this bounded scope. Broader correctness is unproven. |

The final candidate is directly bound to copied source/test bytes; no hashes of
own source/inputs supply authority. Full logs, exact source snapshots, actual
public models/SVG/receipts/PNG/RGBA, setup failures and independent reviews live
under `/tmp/pr449-row87-scene-20261029/` and the retained phase2 owning evidence
under `/tmp/pr449-row87-campaign-20261029/tests/phase2/`.

This is a common certifier improvement benefiting both engines, with unchanged
visible output; it is not Native-over-ELK superiority or universal correctness.
The original seven stay enrolled: rows88/89/103/206/209 remain U, including the
cubic-anchor and cylinder obligations. Native actual layout-cache use remains
unobserved in the retained protocol. All six0.6goals remain open and the holdout
remains sealed. No performance/timing campaign, cap relaxation, release/default
change, package publication, force push, PR merge/reopen, issue or external
comment occurs. Pinned Pele1.9 meaning supports A/B/circle direction; its inline
filled dot is not our hollow ring. Full public Mermaid/Pele qualification and
shared Trident fidelity work remain outstanding.

Exact8b CI40898742115 is terminal failure:14,719unitsP/76skip/0F, both browser
lanes pass,34lazy byte rows fail and the advisory comparison fails. Relative
payload comparison was skipped; exact standalone metadata download returned403.
These observations belong to8b, not this source. Final retained-branch CI must
run once on the final published head; no inherited readiness is asserted.

Next concrete dependency: qualify remaining crossing/stroke cases88/89 against
the shared actual-write authority, then the cubic103 and cylinder206/209 proof
obligations. Keep broader authored interaction coverage and independently
observed final-artifact correspondence ahead of any holdout opening or timing
campaign. Main integration and failed delivery/advisory gates remain explicit.

### 29 October: carry Main's Class contact and route-readback correctness fixes

Parent on the retained PR449 branch: `a2c1c3f13680785221ed65af7f19ca25cbca9cb5`.
This bounded port carries Main's Class surface rule from
`9fc3a141297ea0dd954fae903e5609e2efb8ba7e` and shared ELK route-readback rule from
`d2d106cb151fbcc6736b1b7b3446644660991cec`. It does not merge unrelated Main
changes, alter the default engine, update goldens, or change a version.

Class namespace/header geometry now uses the admitted contact surfaces. The
route-owning Flowchart, Class, ER and Requirement adapters normalize only the
upstream numeric roundoff covered by the shared eight-ULP helper before writing
geometry. The existing negative beyond-roundoff control stays enrolled; paint
proofs receive no new epsilon.

Class evidence: the independently authored flat/nested CEO relations give a
genuine1P/1F baseline and2P after the repair;133 owning tests/5,440 assertions
pass. Four public captures retain source/model/SVG/PNG: two explicit ELK refusals
become successful returns; both Native SVGs remain byte-identical. Independent
XML/geometry readback checks three classes, two ordered relationships,16 owned
contacts and396 shaft/header/marker supports. The complete rounding owner run
passes296 tests/41,372 assertions in six files, including Class, ER, Requirement,
subgraph hierarchy and layout equivalence. The rounding reproduction was3F/1P
before and4P after. Existing committed layout goldens pass unchanged.

Canonical core/repository types pass on the combined local source (including the
separate, still-uncommitted emission-proof work). These focused results do not
qualify that separate work: its largest cylinder still exhausts the unchanged
Native proof budget. The last published a2c CI40909866579 remains failed on35
lazy byte rows and its advisory comparison; no delivery check is waived.

Exact rejected/final sources, commands, public artifacts and independent reviews
are retained in `/tmp/pr449-completion-20261029/class/`, `ROUNDOFF-RED.log`,
`ROUNDOFF-GREEN.log`, `MAIN-PORT-OWNERS.log` and `TYPES-R8.log`. All work remains
on the existing retained PR branch; no issue, PR, force push, merge/reopen,
publication, external comment or timing campaign was created.

### 29 October: shared cross, cubic and five-piece cylinder proof authority

Parent: `e45bccc813bb5569c3aea2febb81d55e473ba8b0`; retained remote remained
`a2c1c3f13680785221ed65af7f19ca25cbca9cb5` during implementation. No issue or PR
was created. All code remains on PR449's existing retained branch; the historical
PR itself was already merged/closed. ELK remains default; no release/version,
dependency, check/cap, publication or timing campaign change occurs.

The common producer now binds actual cross stroke pieces, parsed cubic terminal
orientation, five written cylinder children, transform context and the existing
single-line prepared-text branch to one actual write. Native and Scene consume
that same authority; cached geometry/text, foreign/aliased writes and inherited
or accessor options do not acquire new facts. Unknown CSS/fallback paint stays
unverified. The full shaft and conservative raw/served envelope union remain.

Cylinder contact uses bounded exact decimal arithmetic, an outward round/bevel
stroke enclosure, actual marker viewport clipping, all five body pieces and one
strict positive interior point checked against full strokes and every other
served shaft/marker/body/text occurrence. The original 400,000-operation cap,
100,000-pair cap and coordinate/vertex/integer bounds remain. A global actual-LINE
pose guard also closes a demonstrated opposite-marker complete-erasure false
pass caused by a late supplied tangent mutation (14-assertion RED/GREEN).

Logical accounting identified repeated XML and already-written text/context
scans, rather than the solver. The existing XML verifier now validates character,
reference and delimiter spans in one paid traversal without changing its admitted
language. Existing security owners pass39 tests/478 assertions. An independent
deterministic10,205-case old/new/Saxes comparison records zero changed decisions
and zero new accepted/Saxes-rejected cases; this finite result is not universal
XML equivalence. The final large Native emission capture drops385,228 to310,861
charged operations; no timing or speed claim follows.

A metadata snapshot memo experiment was rejected and completely removed: it
increased charged emission work by2,087 and left both Native refusals unresolved.
Earlier exact-kernel variants, their failing public tests and actual diagnostics
remain retained. Sound subtraction then removes duplicate grid corners, checks
existing side contact before general SAT, uses exact point/rectangle comparisons
and rectangle-axis separators with SAT fallback, and constructs optional ellipse
gradient normals only after cardinal directions fail. Every performed visit and
arithmetic operation remains charged. R15 passes all18 cubic/cylinder public
Native/Scene/strict cells across both engines with2,058 independent XML/ink
assertions;521 other owning tests/5,655 assertions and172 text owners/499
assertions pass. Canonical core/repository types pass at R15. These are
intermediate results before final own-stroke review and capture qualification.

A final review identified a potential new witness assumption: the same marker's
background-colored stroke could repaint its fill witness. The first physical
control failed its alpha-compositing precondition; it is retained as setup
failure, not false-P evidence. The corrected original small-viewport pair
returned U, including the foreground control, because the conservative raw
stroke envelope crossed the viewport. A prospectively translated, fully
contained pair now tests this actual authority path. No success is attributed
to a helper or an unexecuted hypothesis. The fully contained pair gives a genuine 2P/2F baseline (72 assertions): both background strokes have zero actual off-shaft contrast yet return P, while matching foreground strokes correctly pass. New cylinder authority now requires absent actual stroke or opaque actual stroke matching the actual fill RGBA, charged eight operations per eligible marker. The same four controls pass all 72 assertions after this guard. This closes a defect introduced by this new proof, not an old published false pass.

Final R16 checks pass: all 18 cubic/cylinder public cells with 2,058 assertions; 525 remaining owning tests in seven files with 5,727 assertions; canonical core and repository typechecks; full Biome lint (1,911 files, existing oversized-JSON warning only). The 172 text owners and 39 XML/security owners have unchanged owning source since their passed checks. This is not final seven-diagram qualification: the fresh 84-cell, 168-call capture and independent full-ink/meaning review are next. The prepared capture worker has independently
reviewed strict XML pose/occurrence grouping, retains each actual public return
before later phases and enrolls every marker group rather than sampling the
first three. Failed/refused/unsupported/unavailable observations remain explicit.

An actually separately constructed14-case holdout was procedurally sealed on
29 October at18:44UTC, after the earlier unsupported custody statement. Root and
Agentic implementers have not opened its sources or outcomes. Shared-UID
procedural custody and the custodian's later observer-author role are disclosed;
this is not human or double-blind evidence. Candidate/domain/outcome freeze and
confirmatory execution remain pending.

Pinned public Mermaid Dagre/ELK and Pele1.9 model/render acquisition continues in
Trident against frozen91-case/1,893-criterion enrollment. Raw failures include
real Mindmap duplicate IDs, an ELK edit-prelude exception and independently
confirmed observer defects; no raw failure is silently reclassified. A separately
owner-tested private observer repair awaits a distinct committed replay epoch.
Current Agentic comparison arms remain unacquired, not borrowed historical
results. The human pilot has zero participants/responses; an independent study
administrator is still needed. Performance remains paused.

New Main `cff46b766b5de287ba421234ca42b7093ec18eff` includes the broad#585
arrowhead/bend-clearance repair and prerequisites missing on this retained
branch. Independent review confirms it addresses a pre-existing visible drawing
defect. It is not yet integrated or qualified here; importing only its helpers
would not repair the producer path. Its coherent dependency/golden disposition
packet is retained for the next integration phase. Existing a2 CI40909866579
failed35 lazy byte rows and the layout advisory. No check is waived and no
readiness, broad correctness parity, aesthetics or performance superiority is
claimed. All six0.6 acceptance goals remain open.

Exact rejected/final sources, commands, public artifacts and reviews are retained
in `/tmp/pr449-completion-20261029/`. Next: commit this verified shared-proof milestone, then acquire every original-seven execution/cache/engine cell with repeat packets and all marker groups, compare against independently frozen authored meaning and inspect actual final SVG/PNG. Continue the full 230-input development cohort and pinned peer epochs; integrate the coherent Main clearance repair before final candidate/holdout qualification. Final-head CI must be observed through completion, retaining byte/advisory failures. Human study administration and responses remain unavailable.

### 29 October: published seven-case review and broader baseline complete

The published proof milestone is `762ee634407ccbf8bc5390ade475bdbdc11dc5c5`,
following `e45bccc813bb5569c3aea2febb81d55e473ba8b0`. Its original-seven capture
is complete: 84 engine/execution/requested-cache cells, 168 public returns,
all product certificates P, all repeated SVG/receipt pairs equal and all first
SVGs equal retained historical bytes. All 708 enrolled marker-group removal
observations have positive pixel sensitivity. The largest receipt uses 399,188
of the unchanged 400,000 operations, leaving only 812.

Independent authored expectations preceded acquisition. Review compared 84
public models and independently read all 14 unique backend/row SVGs and PNGs:
37 authored nodes and 62 ordered relationship occurrences per backend, 30
literal relationship-label occurrences, 248 outline-contact diagnostics and 118
marker direction/reference-tip checks. Independently decoded PNGs for all 118
distinct removal groups have nonzero differences (minimum 33 pixels).
Source/font/counterfactual custody and repeated receipts match. No concrete lost
meaning, wrong endpoint/direction or erased marker was found under the bounded
checks. Contact diagnostics and pixel sensitivity are not universal whole-head
theorems; agent visual review is not independent human aesthetics evidence.
This source-API milestone does not qualify a future Main integration/package.

The complete 230-input development cohort at that exact head gives Native
**217P/13U** and explicit ELK **221P/9U** under each requested cache policy.
All 920 first SVG/terminal calls return and repeated outputs match. Native makes
zero ELK API calls; its actual layout-cache use remains unobserved. Native-only
uncertainties are Flowchart202/203/204/210. Both engines retain U on
205/207/208 and large Class223–228. No adverse input is removed. Selected
OFF-policy execution at previous published
`a2c1c3f13680785221ed65af7f19ca25cbca9cb5` reproduces all 13 Native U with
identical SVGs. These OFF-policy negatives were not introduced by762; this is
not a complete old-head cohort or a NORMAL-policy comparison.

Paid logical profiles retain the negative outcomes and exact SVGs. Class224
refuses an XML-envelope reservation of56 at399,988 operations. Flowchart207
completes emission at378,371 and exhausts certification in marker preparation.
Duplicated group-markup parsing costs about19,000 operations per measured case.
A separate same-emission parsing-reuse experiment is being prepared; no new
admission or timing improvement is claimed before execution.

Main `cff46b766b5de287ba421234ca42b7093ec18eff` remains an isolated combined
candidate in `/tmp/pr449-main-integration-20261029-762`. Version0.4.2,
dependencies, publication workflow and retained stricter work/delivery limits
are preserved. Its generic rectangle path exposes an existing own-stroke defect:
background-colored width4 strokes erase contrasting fill, but two Native/Scene
physical controls return P. The eight-case baseline is6P/2F/136assertions after
actual XML/off-shaft raster checks. A central surviving-fill/stroke guard gives
29P/481assertions, retaining foreground/hollow-stroke positives. Review then
tightened own-data descriptor tests with `Object.hasOwn`. Complete gates on
those final bytes are still running: the first original-cylinder15 Native cell
returns U while its Scene/strict counterparts pass. This combined candidate is
therefore not verified, committed, adopted or published. The inherited
descriptor-value source hypothesis is not an observed public false pass.

Evidence is under `/tmp/pr449-completion-20261029/`, particularly
`original-seven-independent-meaning/`, `final-seven/R16-COMMITTED/`,
`development230-R16/`, `baseline-a2-selected13/`, paid logical profiles and
`main-integration-762/`. All six release contracts remain open. The holdout is
unopened, human participation is zero and performance is paused. No new issue,
PR, external comment, force push, release/default change, publication, cap
relaxation or PR merge/reopen occurred.

### 29 October: combined-candidate authority repairs and retained negative epochs

The following results concern the isolated combined candidate with parents
`762ee634407ccbf8bc5390ade475bdbdc11dc5c5` and
`cff46b766b5de287ba421234ca42b7093ec18eff`; they do not qualify a newer Main
or a package. Main subsequently advanced to
`1fc21f5181db543c7a9735dbd166ad89d8dae03f` (#580). That later integration
must retain the stricter existing caps and undergo fresh affected checks.

Public string-keyed SVG inspection caching allowed caller-preseeded results to
be mistaken for production XML/security/viewport observations. Physical controls
on the earlier candidate reproduced six accepted root-opacity, panned-viewBox
and late-opaque-cover counterexamples across Native/Scene (six failures and one
positive control). Production inspectors now own private, unregistered keys and
fixed inspection callbacks. Shared charged group-context parsing retains fresh
same-emission authority. Earlier group-style controls failed before the repair
and passed afterward; public string probes cannot seed production authority.
The source patches were first reviewed at private revisions
`3636eeb666c023994d5faf6d152a63d73ba06769` and
`11bb2215e5ca1ceb42af1fb78677d387af850e59`, then ported to this candidate.
An excessively large viewBox diagnostic crashed the raster observer; both
setup epochs remain unavailable, not substituted as successful observations.

Inherited `Object.prototype.value` could make an accessor descriptor appear to
own a data value. A Native public control changed from five reads of an opacity
getter, invisible output and U to zero reads, visible output and P after
prototype pollution. External admission similarly changed from rejection to
accepted substituted paint. Two owning controls fail before the own-slot repair.
The five owning capture/snapshot/serialization/context consumers now require an
own descriptor value. This is a source-meaning/custody defect: the emitted SVG
agreed with the substituted value, so it is not misreported as an SVG/receipt
mismatch. Context results also always own their optional bound resolver; that
additional invariant is a reviewed defense, not a separately observed false P.

Three-piece subroutine bodies now share the actual-write compound authority
with five-piece cylinders. All three writer callbacks and all three/five actual
fragment tags are checked; ellipses do not issue additional writer callbacks.
Exact full-union contact checks use actual own strokes, clipping and a surviving
marker witness clear of every other paint occurrence. No family, fixture ID,
epsilon or cap exception is used. The four Native-only development refusals
202/203/204/210 become P with byte-identical SVG and PNG. Their new owning tests
retain independently authored endpoints, XML and actual marker-removal evidence;
the genuine earlier epoch had five failing cases, the repaired epoch eleven
passing cases and 158 assertions.

The combined candidate initially exhausted the largest cylinder's proof budget.
Negative data-copy and indexing experiments remain retained. Immutable same-
emission text rosters and a private bound-background fact alone still returned U.
Paid logical attribution then identified repeated exact body parsing. A request-
local prepared-body closure now retains only completed immutable body/paint
facts. Each marker still receives fresh resource, pose, clipping, own-stroke,
ownership and global-ink checks; generic calls remain fresh. No partial, failed
or P/contact result is cached. Both public Native206 returns pass at
391,461/400,000, versus two U at 400,000 in the preceding epoch. SVG, repeated
SVG, PNG, public model and terminal bytes are identical. An independent direct
comparison verified all 865 frozen runtime/font/package files. This is bounded
admission recovery, not a timing or performance result.

Review found an omitted optional prepared-body field in an intermediate draft
could inherit a callable authority. Physical Native/Scene controls failed before
the draft was fixed (zero marker-removal sensitivity but P); both pass after
requiring an own undefined field, with no inherited call. This was introduced
only in the private draft, not an additional published defect.

A final dirty-source development probe retains the original 20 inputs (the
seven original witnesses and all 13 earlier Native refusals), with expectations
authored before calls. Native and ELK each return 12P/8U under OFF. All 40 SVG
and terminal repeats match; all 40 public models and 542 independent arrow
direction/contact diagnostics pass their bounded checks. Native makes zero ELK
calls. Nineteen Native and sixteen ELK PNGs decode; five remain unavailable at
the unchanged 16MiB raw-RGBA guard. Remaining U are 207/208 and Class223–228.
This is not the full 230-input or final clean-source matrix.

Full frozen owning checks revealed remaining failures rather than readiness:
18 curve/body and 45 endpoint/stroke tests pass; the complementary paint/Scene
partition has 589 pass and 13 fail. Route owners pass 312 tests/41,652 assertions.
Security/text owners have 261 pass and ten failures caused by imported test
extensions requiring ^0.5.0 against the deliberately retained 0.4.2 host. Core
and repository typechecks pass; Biome passes with the existing oversized-JSON
warning. No failure is trimmed or waived. The 13 paint failures include a real
omitted-stroke false P: four actual Native/captured-Scene outputs paint a white
marker without a stroke on the white viewing surface, with zero off-shaft ink
and zero marker-removal sensitivity; an explicit foreground-stroke control has
positive ink/sensitivity. The foreground guard is being repaired at the owning
boundary. Bounds-only marker fixtures, unbound CSS positives and precise
conditional-paint diagnostics are also being reconciled with actual output.
The apparent Scene cylinder-side gap was independently resolved as a probe
omitting the existing explicit precision-capture opt-in: all four properly
captured outputs pass with unchanged SVG, so no runtime exception is justified.

The original sealed 14-case holdout remains unopened but is withdrawn from
independent confirmation because its custodian subsequently authored runtime
code. A different custodian is preparing a replacement after independent
observer/protocol review, including a generic data-only external-cohort loader.
No replacement holdout result is claimed. Pinned public peers retain the full
91-case/1,893-criterion enrollment: Mermaid Dagre 1645P/6F/242U, Mermaid ELK
1605P/4F/284U and Pele1.9 1782P/2F/109U at private Trident R5
`a80211080609220b283c3a6b4b4618921cf0808b`. Raw failures and unavailable
observations remain enrolled. Current Agentic arms remain unacquired, 1,893U
each; these unequal observations do not establish a peer correctness ranking.
Human participants/responses remain zero, and performance work remains paused.

Exact sources, commands, process cleanup, negative epochs and actual artifacts
remain under `/tmp/pr449-completion-20261029/`, including
`main-candidate-final20-off/`, `prepared-body206-third/`,
`tests/main-final-complete-owner-gates/`, `scene-side-optin-review/` and
`qualification/`. Next: close the owning failures, integrate the reviewed later
Main coherently, commit the verified candidate and repeat affected clean-source
qualification before a fast-forward-safe retained-branch push and exact-head CI.
No new issue or PR is created; all six release acceptance contracts remain open.

The complementary failures are now resolved at their owning boundaries. The
opaque semantic-marker guard rejects background fill without contrasting
stroke; two private old-source tests fail before this guard, while the final
89-case interaction subset passes 526 assertions. Bounds-only geometry remains
U, but the repaired viewport positive now uses a real public rendering with
authored marker geometry/resources: actual final XML, endpoints and off-shaft
marker-removal ink are checked. CSS-variable positives now actually bind the
root variables; the unbound control remains U. Conditional Native cases assert
their precise conditional reason while Scene overlap checks remain intact.
Raw/unrequested cylinder bodies remain U; fresh Native and explicitly requested
Scene actual-write precision passes all four side-contact positives and retains
every adverse variant. No second generic proof authority was added.

Final frozen R18 paint/writer/Scene checks pass **665 tests / 8,906 assertions**
across seven files. All three prospectively disjoint/exhaustive partitions exit
normally, reap every owned child and compare all 1,480 source files byte-for-
byte before, at lock acquisition and after execution. The superseded R17 was
stopped before any test because a concurrent test-only import correction changed
one file; its invalidation and original failures remain retained. Canonical
core/repository types and full lint pass (the existing oversized-JSON warning).
The version fixture repair uses the host's existing compatibility authority for
synthetic positive registrations and retains independently incompatible ranges;
**324 unique tests across 22 files pass**, without changing production version
or compatibility. An initially misplaced subprocess import and its complete
corrected-file replay are retained. Route checks remain 312P/41,652 assertions;
the production source for those owners is unchanged by these final test repairs.

The replacement holdout is now actually constructed and sealed by the separate
custodian: cohort `e9c578b7-218f-4c1d-911c-1d69f25ca7aa`, twelve purposeful
base/edit pairs, 24 source states across six consuming and six common families.
All 25 acquisition/observer/controller files and outcome rules were independently
reviewed and frozen at 22:36 UTC; construction/sealing followed at 22:38 UTC.
Twelve newly pinned Mermaid 11.12.2 documents supplied a different construction
method. No parser, renderer or product query occurred; no source or result was
opened by Agentic implementers. The custodian is now custody-only. The original
14 remain sealed and ineligible. Generic external-cohort loading is already
frozen, rather than deferred until after opening. Current Agentic peer arms and
the confirmatory holdout remain unacquired pending final candidate binding.

Read-only review of later Main `1fc21f5` found two concrete custody violations
in its new immutable-text reuse. A caller-prepared accessor array can be branded
immutable through inherited descriptor `value`, and 70 nested prepared plans
bypass Native's existing depth64 walk (P versus U, identical SVG). These are
isolated new-Main controls, not a complete new-Main qualification. The coherent
next integration will require own descriptor values before reading them and
omit the unbounded Native shortcut, retaining paid recursive admission. It must
also preserve this milestone's fresh group/context checks and all exact-body,
own-stroke, background and global-witness authority. No new issue/PR was filed.

### 29 October: correction of planning authority

The owner challenged the mandatory human-study requirement and the authority of
the qualification document. The assistant introduced that formal acceptance
contract at `795b2b4c62b595cc904802aa25aaafe8ae54df62`; the owner's six goals
and release timeline did not approve the additional study, statistical margins
or all-or-nothing completion gates. Calling the document "owner-directed" was
an unsupported attribution. The plan and TODO now distinguish the requested
goals from assistant-proposed methods. A human panel, study administrator and
participant recruitment are optional research and do not block completion.
Earlier log entries describing six binding contracts or missing humans as a
blocker are superseded by this correction; their historical test results remain.
No production check, budget, correctness expectation or existing CI gate is
relaxed. Continue concrete fixes and honest actual-render/metric comparisons,
reporting each measured domain and counterexample. Existing sealed artifacts
remain sealed under their custody rules; they do not create a new release gate.

### 29 October, 23:14 UTC: live branch check and remaining integration work

The verified implementation milestone is published at
`eb1fb3312507766b4a9dc2c5eddcb89247e852a2`; the planning-authority correction
is separately published at `fac4f0c8557ac1343eefe5438556dd7cf5818ef9` on the
same retained branch. A fresh connector check and Git fetch/pull confirm that
branch head; `git pull --ff-only` reports already up to date. Main remains
`1fc21f5181db543c7a9735dbd166ad89d8dae03f`. The isolated integration contains
that exact Main snapshot but is still an uncommitted merge over `eb1fb3312`.
No rebase has been completed or published and no force push occurred. The
canonical worktree is clean. Concurrent implementation was paused to inspect and
preserve all pending changes before resuming; no active agent work was lost.

Incoming Main contains sound routing fixes plus two unsafe immutable-text
assumptions. Independent actual controls show a live accessor-bearing prepared
plan can be treated as immutable through inherited descriptor value, and the
unbounded Native shortcut bypasses depth64. The minimal integrated correction
requires an own value before reading it and initially removes the shortcut.
Actual owning tests fail twice against the relevant Main source and pass in
the corrected candidate. Seventy nested prepared plans retain the same SVG but
must remain U; cached supplied text must remain independent of later mutation.

At frozen R20, canonical types and lint pass; prepared-text/cache owners pass
79 tests/339 assertions, build metadata owners pass eight/205, and additional
routing/loop/ER-label/terminal owners pass 565/6,167. The complete paint/Scene
partition reports **688P/12F**, while the six route owners report **325P/4F**.
All frozen-source guards and process cleanup complete. These failures are not
waived or called readiness. Six paint failures are older invalid-group fixtures
now rejected before any output by the stronger Main constructor. Their exact
adversarial payloads are retained with explicit rejection assertions and plain
actual-ink positive controls. Three concern spatial queries over the private
inspector's immutable roster: its kind/order/bounds facts are safe independently
of actual-write authority, while mutable paint and the exact contact theorems
keep their separate fresh checks. A subsequent **148P/0F/1,213-assertion** run
covers those repairs and existing mutable/getter/palette, alias, foreign/cached,
descriptor and hidden-ink negatives; all 1,484 source files match across that
short epoch. A full final owning run has not yet been repeated.

The remaining seven observed failures are budget refusals: four directions of
the Class128 chain, ER256's Native writer, and two 1,500-text decorative cases.
These are valid-input admission gaps, not demonstrated accepted wrong drawings.
Class128 preserves all 128 authored nodes and 127 ordered relations under both
writers, with byte-identical SVG/models, Native graph selection and zero ELK
calls, but both writers reach 400,000 operations. Forcing Scene is a measured
negative experiment and does not justify a family exception. Paid-only profiles
locate Class Scene context at 167,973 operations (85,280 on groups), with
additional write/projection/record work. ER256 Scene already passes at 219,802,
but its default Native writer exhausts capture. Timing campaigns remain paused.

A four-file depth-aware immutable-text draft is preserved but was not yet
parsed, typechecked or executed at the live status check. It must retain scalar
depth boundaries, prototype/cycle/own-slot/point checks and generic getter
behavior; arbitrary undefined geometry contexts cannot borrow text metadata
facts. Independent review is pending. The group/capture owner has adopted no
runtime shortcut or quota repricing. Next: test bounded text-fact reuse and
subtraction of unused precision work, close these seven owning refusals, finish
the Main integration while retaining the published correction, then perform
final-source checks and exact-head CI. All negative results and unverified or
unavailable observations remain enrolled. No human study is a dependency.

### 29 October, 23:59 UTC: checked session state and subtracted unsuccessful drafts

Fresh Git fetch/pull confirms retained published head
`fac4f0c8557ac1343eefe5438556dd7cf5818ef9` and Main
`1fc21f5181db543c7a9735dbd166ad89d8dae03f`. PR449 is merged/closed
(28 October, 00:25 UTC); thirteen discussion comments are unchanged since the
last check. GitHub reports zero Actions runs for this published head. The
isolated Main integration remains uncommitted over `eb1fb3312`, with all index
conflicts resolved. No rebase, Main integration commit or force push is claimed.
A whole published-branch rebase would rewrite published ancestry; preserve it
through normal integration instead of replaying 427 branch-only commits.
The old two private cache-authority commits are already represented by the
published milestone and must not be replayed merely to claim rebase activity.

Five Sol6.1 High agents split experimental cleanup and independently falsifiable
paint/ownership, CI/configuration, history and evidence reviews. No confirmed
weakening was found in the inspected staged roster/group/cap integration, but
review is not a passing test or final readiness result. Incoming Main's inherited
descriptor-value and Native depth-bypass fixes remain mandatory.

The additional R21 depth-metadata and R22/R23 THIN text-context implementations
closed **zero** large-input refusals in their controlled comparisons. Both are
removed from the candidate; their complete drafts, actual SVGs, counterexamples
and unsuccessful outcomes remain outside the repository. The simpler mandatory
R20 custody changes remain, together with independently authored depth48/64
positive and depth68/288 refusal controls. Cleanup receipts are retained under
`/tmp/pr449-completion-20261029/integration-cleanup-final/`.

A new exact frozen-source owning check after subtraction passes **82 text/cache
tests / 351 assertions**. The paint-complement and six Scene owners report
**634P/3F / 5,728 assertions**; the three failures are ER256 Native and the two
1,500-text decorative cases. The four Class128 directions each still fail the
passed-proof assertion: **0P/4F / eight assertions**. These are seven unresolved
valid-input admission gaps; no failure is waived, hidden or counted as a pass.
Canonical core/repository types and full lint pass. All checks compare all
1,484 source files directly before/at-lock/after, use existing 117+3-second
product and 300+3-second type bounds, and reap owned processes. The earlier
63 separately partitioned paint tests were not replayed in this new check;
their R20 results remain tied to R20. Exact commands/results and cleanup records
are in `/tmp/pr449-completion-20261029/live-status-after-cleanup/`.

Next concrete experiment is bounded subtraction of unused precision-text write
capture: validate actual bound single-line SVG only when the existing fractional
proof needs it, instead of eagerly retaining a receipt for every text. It is an
outside-repository prototype, not implementation success or a new gate. Adoption
requires a real budget-admission improvement and preservation of existing
negative controls and original-seven artifact evidence. No timing campaign or
price/cap relaxation is authorized. The original-six goals remain unfinished;
human participants are not a dependency.

### 30 October: published-source precision-text subtraction and live status

Runtime change `2acc924ce60f6aa7d4a87d83e2d0007e317ff427`, over published
`fac4f0c8557ac1343eefe5438556dd7cf5818ef9`, removes eager precision-text
receipt callbacks and retained attribute records. Only an existing active
fractional proof inspects its actual same-emission single-line SVG, using a
closed, paid canonical attribute/content grammar. Exact typography, prepared
metrics, ownership, getter/depth/CSS isolation and all caps remain. Ordinary
text no longer performs unused precision capture; no global result cache,
second geometry writer, family exemption or changed fee for retained work is
introduced. The optional R21 metadata and R22/R23 THIN drafts closed zero large
cases and were dropped. A first lazy parser also regressed diagram206 through
extra generic XML decoding; that epoch was rejected. The final grammar removes
those performed generic passes instead of waiving their cost.

The canonical regression has 1,500 prepared labels and an unused arrow
resource, with zero marker occurrences. Before the change, the actual output is
unverified at 400,000 operations. Afterward it passes at **382,336/400,000**,
with identical **329,865-byte SVG**. Its owning test independently reads all
1,500 actual text elements, authored occurrence IDs/order and typography, and
observes first/last glyph removal in two small pinned-font raster crops. On
unchanged parent production the test fails only at its final passed-proof
assertion after 3,011 actual-output/contract assertions; the same test passes
with this change. These two crop witnesses do not claim that all 1,500 glyphs
were separately raster-observed. The 32-marker variant remains enrolled and U;
it is not silently removed or converted to an expected success.

The complete paint/Scene owners pass **666 unique tests / 11,917 assertions**
across seven files using three disjoint/exhaustive partitions (18 +45 +603).
The standalone green regression replay is not added to that unique count.
Prepared-text/cache owners pass **74 tests / 327 assertions**. Canonical core
and repository types and full lint pass. All seven checks keep 1,480 source
files byte-identical before/at-lock/after, retain existing 117+3-second product
and 300+3-second type bounds, and reap owned descendants. Independent read-only
review found no introduced authority defect and confirmed exact correspondence
of the reviewed four-file overlay to the committed runtime. Exact commands,
red/green logs, artifacts, byte comparisons and cleanup records are under
`/tmp/pr449-completion-20261029/canonical-text-subtraction-{red,green}/` and
`conditional-text-subtraction/`. No timing campaign was run.

Latest fetched Main remains `1fc21f5181db543c7a9735dbd166ad89d8dae03f`.
PR449 is merged/closed; follow-ups remain on its retained branch. The separate
Main integration is still uncommitted, and no completed rebase is claimed.
Incoming Main's inherited descriptor-value and unbounded Native depth shortcut
remain corrected in that isolated candidate. Five Sol6.1 High agents split
cleanup, authority/CI/history reviews and evidence auditing; no competing
writers or uncommitted changes were overwritten. Published ancestry is
preserved and no force push is used.

After applying the same four files there, the exact seven previously failing
owning cases are **1P/6F**. The existing no-marker case passes. Remaining valid
admission gaps are Class128 in TB/BT/LR/RL, ER256 Native and 1,500 text labels
with 32 decorative markers. These are budget refusals; no demonstrated accepted
wrong drawing is inferred from them. Their checks/caps are not relaxed to make
the Main integration green. This failing integration is not published.

A separate private-Main overlay acquisition preserves **28 unique original-seven
OFF cells** (two graph backends × two writers × seven sources) plus four
identical-source206 repeat calls: all32P and SVG bytes baseline-equal. This is
not NORMAL-cache, strict-execution, holdout, raster or final-published-head
qualification. Its Native Agentic206 uses396,056/400,000, leaving3,944 operations;
that observation is not assigned to this canonical revision. The earlier full
230-input development and public-peer campaigns also keep their earlier exact
revisions. Current Agentic peer arms and the sealed replacement holdout remain
unacquired. Human participants are optional research, not a blocker.

At this commit, final-head CI is not yet observed; dispatch it after the normal
fast-forward-safe push and report its actual result separately. No parity with
ELK in correctness, aesthetics, timing, memory or delivery size is claimed.
Next concrete step: trace and remove duplicate context/capture work in the
32-marker counterexample, close the remaining six owning refusals, then finish
the Main integration and rerun the affected combined-candidate checks. No new
issue, PR, package, version bump or default-backend change is created.

The runtime follow-up above is now normally pushed at branch/log head
`d43ef02ee11f9c5f99d5138e9455f14efcbab27b`, with clean canonical worktree.
Exact-head CI [40978745281](https://github.com/adewale/agentic-mermaid/actions/runs/40978745281)
is running; no terminal outcome is claimed. Existing PR449 description is updated
without reopening it or creating a comment. This local integration still needs
the published d43 ancestry before eventual fast-forward-safe publication.

30 October follow-up: exact-head CI40978745281 at d43ef02ee has completed
with failure. Two unit shards fail five tests: ELKcycle40TD/BT each report
three label conflicts; left/right Sequence creation rejects overlapping-marker
proof as unverified; docs/api.md api-versions block is stale. Browser/quality
and generated-layout advisory lanes also fail; causes of those lanes remain
unclassified at this check. Semantic conformance, unit shard3, CLI, payload,
artifact, both installed tarball consumers, quickstarts and MCP pass. These new
counterexamples are additional to the six isolated-Main budget refusals. No
claim of a fully passing current branch or universalELKparity is made.


### 30 October sustained campaign: Main integration and closed metadata scope

The requested campaign started at01:53:05UTC; its requested eight-hour target
is09:53:05UTC. This entry records completed work, not eight elapsed hours.
Five GPT6.1Sol agents atHigh split three-system observations, label/crossing
repairs, Sequence/XML writes, budget attribution and independent authority
falsification. Existing uncommitted work was preserved in binary patches under
`/tmp/pr449-eight-hour-20261030/` before integration. Product work stays globally
serialized with117+3-second workers,30-second cells/tests,300+3-second type
workers and the existing400,000-operation/geometry/byte limits.

A normal pull confirms retained published head
`d43ef02ee11f9c5f99d5138e9455f14efcbab27b`. Private integration now descends from
that head and fetched Main`bb06b11c64c84b43f540854d3a96ca18c54c492a`, at private
merge`2ecf117c47ca4200b783f8a21c05dcd85d558ed0`. Version-only merge conflicts
retain0.4.2. This is a private merge integration, not a completed rebase or
passing published candidate. PR449 remains merged/closed; no replacement issue
or PR, package publication, version bump or ELK-default change is made.

Independent review found a pre-existing accepted wrong drawing: separately
admitted nonPaint accessibility fragments `<title>`/`</title>` or
`<desc>`/`</desc>` can surround a real semantic marked connector. Actual SVG is
XML-valid, certification passes, but removing its marker changes zero raster
pixels; removing only the metadata wrappers restores94marker pixels. Native
and fresh Scene receipts both reproduce this defect.

Shared document admission now requires each declared nonpainting fragment to
be a complete XML fragment beneath a canonical SVG wrapper, retaining the
existing allowed-element inventory. Both the allowed-tag scan and XML check
observe fresh bytes; public inspection-cache results cannot grant authority.
No generic geometry/paint/helper result substitutes for final ink.

The existing Native validation owner extends one table across title/desc and
Native/Scene. XML parsing and actual marker-removal raster controls precede the
admission assertion. Four targeted cases fail before the change only at that
assertion; the full owning file passes58tests/317assertions afterward. Complete
closed metadata and namespace-distinct controls remain positive; two old
namespace-alias controls now reject at the earlier admission boundary. Scoped
types(895 imported files) and lint pass, with frozen inputs and all descendants
reaped. Evidence:`authority-review/metadata-owner-{red-R2,green-R2}*` and
`metadata-scoped-*` beneath the session directory. These are owning/scoped
checks, not a claim that combined canonical core/repository types or CI pass.

Remaining work is explicit: label/Sequence fixes are independently qualified
but not yet committed; five of the six large admission refusals remain open in
the current private experiment. The1,500-label/32-marker owning case passes in
an unpublished XML/pure-origin prototype at367,793/400,000 with identical
335,043-byte SVG, but raw lexical boundary hardening and combined qualification
are still pending. The unsafe broad frozen-object memo was rejected: a
constructor-branded caller Proxy changed later actual SVG when reflection was
skipped. Only separate private allocation provenance is being considered.
Existing d43CI is failed, including browser/lazy delivery budgets; no cap is
raised. Next concrete step: commit the qualified label/contact fixes, finish
safe same-write XML authority and remove duplicated group work, then rerun
all six admission owners and exact combined-candidate checks.


The closed-metadata boundary is committed privately at
`b9888f053` (full revision recorded by Git); all other pending files were
preserved. The next coherent graph repair rejects optional port-lane/bundle
proposals that introduce a new foreign caption/shaft/marker collision. Shared
checks retain existing conflicting pair identities, not just totals, so an
old collision cannot pay for a different new one. Actual seed40ELK TD/BT
caption conflicts change3→0, preserving9nodes,23carriers,6captions, all46
endpoint contacts and23marker tips. LR/RL output stays byte-identical.

The improved ELK result exposed Native171at7crossings versus5. This source is
acyclic; an existing bounded private-chain ordering pass accidentally excluded
small DAGs along with small cyclic graphs. Its gate now admits small DAGs
while retaining the small-cycle policy and every existing work/size cap.
Independently counted written crossings change7→3; ELK remains5. All authored
endpoint/label occurrences,23start+23end contacts and23marker tips remain.
Eight neighbouring small-DAG/cycle direction controls have identical SVG bytes.

Four owning files pass253tests/9,981assertions; the strengthened existing171
row fails at7>3 without the gate change, and passes with it. The original
Native<=ELK inequality is retained. Eight changed mixed-duplicate route cases
pass138assertions;45adjacent-owner tests pass256assertions. Their certificate
kind assertion follows actual two-point straight versus bent explained-detour
geometry while retaining all existing hard violations/contact/ownership checks.
The wider990-route replay reached the unchanged117-second worker limit and
is not counted as passing. Frozen core/repository-config checks and seven-file
lint pass; final combined canonical checks still remain. Evidence and exact
source binding:`labels/FINAL-REPORT.json`,`FROZEN-SEVEN-FILES.json` and
`final-seven-overlay/` under the session root. Seed156foreign-caption conflicts
remain(TD5,BT1); no universal caption-solving or ELK-parity claim is made.


The graph repair is now privately committed at
`89085491c9701e9c26c24966d8048cf4d4e7bf37`; closed metadata admission is
`b9888f053cf941018bd339c354e2e995c29e595c`.
A separate actual-allocation subtraction shares the existing rectangle-paint
inventory's literal SVG attribute names/numeric classification and replaces
three proof-overlay walks with one descriptor-preserving inert copy. Native
and Scene still require exact own data, preserve optional undefined fields,
and retain the192-unit supported-geometry reservation and every cap.

204unique owning cases/3,528assertions pass in both baseline and overlay,
covering Native/writer/inspection plus rectangle/compound/cylinder/prototype/
forgery controls. Runtime types and three-file lint pass. Small Class/ER actual
SVGs are byte-identical; each removes676actually paid operations. All six large
refusals remain U with this subtraction alone, so it is not claimed to close
them or improve wall-clock speed. Exact before/after controls and source bytes
are in`budget-attribution/SUBTRACTION-*` under the session root. This coherent
subtraction is kept separate from the larger unpublished XML/owned-text/group
experiments. The deferred-group-only experiment is rejected for closure: its
Class lower bound is at least485,118operations before all remaining work, and
its unmarked path adds binding overhead. No work price/cap is reduced to hide
that result.


The rectangle subtraction is privately committed at`56a4d8b90`.
The existing doc-block generator now restores only`docs/api.md`'s
`api-versions` block to the retained source/package version0.4.2. The unchanged
owning doc test changes1P/1F→2P/0F(3assertions); every other API paragraph,
generator authority and version source is unchanged. The changelog still
records its actual0.5.3release. Evidence:`api-versions/RESULT.json`. No release
version is bumped to satisfy the check.

Exact published d43CI40978745281 is failed, correcting the older running note.
Retained job logs now classify its delivery failures precisely: browser
standalone HTML is2,114,766raw/1,385,699gzip bytes versus gzip cap1,334,500;
the other21browser tests pass. Lazy delivery has58distinct over-budget rows
(22raw,19gzip,17brotli) across22family/scenario groups, not the earlier rough
count56. No request-count overrun is reported. The standalone diagnostic has
one worker-side ELK module and none in the page, so it does not demonstrate a
second renderer. The generated-layout advisory has no runtime errors but
still reports quality regressions. These failures remain enrolled and caps
unchanged; local doc/geometry/proof checks do not qualify unpublished head CI.
Logs:`ci-readonly-40978745281/` under the session root.


### 30 October: same-emission Sequence marker visibility

The creation-message geometry was already correct in both directions. Its
unverified proof came from grouped var(--_arrow) paint lacking a same-write
palette witness. More seriously, the semantic-role filter omitted message:
a white-on-white head could receive P despite zero marker-removal pixels.
Shared marker checking now includes typed messages and resolves grouped paint
only through the matching private Native/Scene write context and occurrence.
Header, palette, opacity, CSS, definition, clipping and ownership isolation
remain required; no caller palette or cloned inspection borrows this fact.

The existing creation table now observes actual XML line/header/resource/text
fields and actual glyph/head ink at1px/3px widths with default/literal/white
palettes, left and right. Normal heads produce231/1,917right and231/1,918left
changed pixels; Welcome removal produces2,120/2,099. White heads produce zero
and strict certification refuses. The original cases fail2/12before the
change; all12pass/144assertions afterward. Forty exact SVG/crop/removal PNG
artifacts are byte-identical. The left raster observer uses the existing
production marker-orientation adapter; raw Resvg auto-start-reverse limitations
are retained as observer setup evidence, not relabelled as a product defect.
Broader Sequence owners pass158tests/16,354assertions. The initial8reference
failures were sandbox EPERM writing child pipes; the same frozen inputs pass
with normal IPC. Independent37-context controls retain mutable/getter/CSS/
public-cache/clone/header/owner distinctions, including actual covered-marker
F and changed-palette U. Evidence:`sequence/REPORT.json`,`authority-review/`.

The combined R5 prototype now passes both canonical core and repository types
with pinned Tridentf080278e31e4202ca89d524e4ee9e4cf3cbff038. These checks include
all tracked eval/tooling source, not a partial repository inventory. A complete
frozen workspace fixes my earlier omitted fixtures/Bun preload: its paint/Scene
complement is645P/1F/8,797assertions; only the already-open ER256Native budget
refusal remains in that partition. Eight earlier setup/config failures and
one real refusal remain in the first incomplete-workspace log. This result
qualifies that recorded private prototype; final combined head/CI are still
pending and the separate63curve/endpoint cases are recorded independently.

Two Class subtraction attempts are rejected with actual-ink controls. Moving
relations above cards paints through an unrelated card; both certificates
already reject that positioned route. Removing only repaint carriers erases
an entire baseline-accepted thick-border inheritance marker:108removal pixels
become0 and candidate correctly reports MARKER_OCCLUDED in Native and Scene.
No large-direction success is claimed for either stopped experiment; their
unrun eight-direction/writer cells remain enrolled. The published PR description
was corrected on30October04:17UTC, with published/private status separated,
CI terminal failure recorded and malformed duplicated reproduction text fixed.
New visual assets are local only; the description explicitly leaves the
mechanical linter's missing embedded-public-asset finding open. No external
comment/message or fabricated public asset link was created.


### 30 October: actual writer XML custody and pure-origin text-copy reuse

Sequence visibility is privately committed at
`66b8f05810bbb6225bb0dab12735d142875c3ab7`. The implementation worktree is now
attached to local`work/pr449-main-correctness-20261030`; retained remote head
remains d43 until a normal verified push. Existing work was preserved.

One opaque per-emission XML capture now owns actual leaf writes, raw wrappers,
group indentation/join and final document composition. Native returns the SVG
from that same composed object. Default string writer/validator APIs remain
available. Fresh typed leaf facts validate the actual escaped attribute names,
values and text, including scalar characters and duplicate attributes. Cached,
unsupported and opaque markup stays raw. Only final marker-bearing proof asks
for the lazy validation projection; its fresh whole-envelope check still pays
from the same400,000allowance. Incomplete raw lexical tokens, comments/PIs,
separators and failed-leaf fallbacks cannot hide malformed actual output:
projection decline rechecks that same object's actual SVG. Empty output cannot
insert a fake XML boundary. No public registration/safe boolean issues this
construction evidence, and no separately supplied SVG is compared to a helper
certificate. Actual geometry/stroke/cylinder/contact/ownership checks remain.

Actual constructors now distinguish private local allocations from the older
structural immutable/transferable measurement brands. Only known local records
and explicitly built arrays mint the stronger provenance, bottom-up inside the
existing freeze walk. Generic supplied interpretation immutablePlan is unchanged.
Native's first complete copy measures and pays scalar-depth extent; later copies
reuse only that same emission's completed own-origin text data in TextMark.block
and preparedLines contexts. Geometry, generic snapshot, caller Proxy/getter,
mutable/CSS/definition paths keep their checks. The original hostile custom-map
Proxy still receives two descriptor traps on both captures and produces the
same later white rectangle. Depth64P/depth65U, cycles, accessors, functions and
nonstandard prototypes retain their outcomes; no constructor depth scan or
unpaid second full-tree walk is added.

The existing1,500-label/32-decorative-marker refusal becomes P at
368,437/400,000 in the final R5 frozen runtime (355,119emission operations),
versus the earlier R3 experiment's367,793. The actual335,043-byte SVG is identical
to the recorded baseline. Root's exact implementation checks pass the three
existing text owners/3,015assertions, including all1,500actual XML fields and
first/last pinned-font glyph removal. Five large refusals remain open: Class128
in four directions and ER256Native. No timing or memory benefit is inferred.

The complete R5 paint/Scene owner partitions pass708unique tests and fail1
known ER capacity case across seven files,11,989assertions total. The63expensive
curve/endpoint cases are disjoint from the646-case complement:18P/2,109assertions,
45P/1,083,645P1F/8,797. Their actual authored meaning and final marker/label ink
checks remain. Source bytes are frozen in`combined-r5/runtime`; original failed
harness configurations remain separately recorded. The latest writer test also
keeps stateful non-string-content, raw-comment/separator and empty-boundary
falsifiers. Its26P/83assertions are owning XML behavior checks, with final-ink
coverage retained at the higher paint owners.

After applying the exact nine runtime files and latest owning test to the real
implementation worktree, canonical core+repository types pass, full Biome passes
(1existing oversized-JSON warning),96writer/Native/Sequence tests pass with
544assertions, and the3text cases pass3,015assertions. All four checks guard
2,103tracked source/config inputs before, at lock and after, retain117+3/300+3
worker bounds and30-second test bounds, and reap descendants. Executable bytes
match the qualified R5 snapshot; the already committed metadata explanation
comment is retained. Evidence:`XML-ADOPTION-BINDING.json`,`xml-adoption-checks/`,
`xml-write/`,`sequence/`,`authority-review/` and`budget-attribution/` under the
session root. No group-constructor, marker-snapshot, Scene-snapshot or residual
192-accounting experiment is silently included in this commit.

The three-system comparison is being extended with the ACTUAL original-seven
rows77,87,88,89,103,206,209. The previous20-source/60-cell baseline included seven
other historical cycles; it does not qualify these seven. New enrollment is
21cells,14fresh our cells with separately enrolled strict/normal phases,5fresh
Pele cells and2explicit exact-source/options/artifact-matched Pele reuses.
Initial product results are all14our cells strictP/normalP and all7Pele SVG/model
returns; independent final-ink observation remains underway. These are not a
28/84cross-product or pooled verdict, and the replacement holdout stays sealed.
Next concrete work: apply the independently qualified seed156caption repair,
then combine only proved actual-work subtractions against the five remaining
admission refusals. Full final-head CI and delivery budgets remain unresolved.


### 30 October: bounded caption-seat repair without shaft masking

The same-emission XML/text change is privately committed at
`9d1a054162189972d9f2efa7f3554db29b734db2`.
Seed156's remaining label conflicts were not inherited from ELK extraction:
actual routes/captions are clear until separateEdgeLabelPills moves captions
onto unrelated shafts while repairing small halo overlaps. The existing
separator now first tries four deterministic near-current cross-axis offsets,
charges them and the label roster to the same1,000,000-unit work ledger, and
checks joint seats through the existing complete paint context. It removes
the legacy permission to hide a foreign shaft beneath a caption halo. No route
or node coordinate, tolerance, sweep count,64-pair candidate limit or work cap
is changed. Custom/reentrant measurement keeps its conservative path.

The original seed156direction cases and a separately authored four-node,
four-edge interaction fail before repair(16P/3F) and pass afterward(19P/0F).
Padded conflicts change TD5→0 and BT1→0. Independent actual halo/raster checks
change TD5→0,BT2→0,interaction1→0; these different measures are not pooled.
All node boxes and every edge path remain byte-identical; only caption seats
move. Authored labels/endpoints, actual node-stroke contacts and marker tips
remain. Eight generated source/direction SVGs plus the authored interaction
exactly reproduce the independently observed pinned-font/Chromium artifacts.

The private frozen candidate passes575graph/route/bundle tests plus161text,
label and custom-measurement owners, with scoped types/lint. After exact live
adoption on9d, targeted19cases pass272assertions, actual-root core types and
scoped two-file lint pass. All2,045tracked TS/JSON bytes and head stayed unchanged
during each check, with original deadlines and descendant cleanup. Baseline and
candidate binding is by direct complete bytes in
`seed156-labels/DIRECT-BYTE-BINDING.json`; earlier source-hash metadata was
contrary to repository guidance and is explicitly superseded, not reused as
authority. No source/test rerun was invented for that artifact correction.
Evidence:`seed156-labels/FINAL-REPORT.json`,`LIVE-QUALIFICATION.json` and
`FINAL-SVG-SOURCE-BINDING.json` under the session root.

Main advanced during work to83744a4e1ae5c9d3821ba8a283811367fd31eade
(release notes/API reference). It is fetched but not yet integrated at this
entry. No literal rebase completion or current-base readiness is claimed.
Five large proof-capacity refusals remain, while failed subtraction experiments
stay enrolled: dropping marker repaint hides accepted thick-border ink; lazy
XML fact activation saves unmarked work but introduces a valid late-marker
refusal and is not adopted. Next check: integrate the new Main documentation,
finish independent receiver-sensitive getter review of text reuse, and compose
only qualified work subtractions against the remaining budget cases.


### 30 October05:29UTC: current Main and a rejected receiver-sharing assumption

Main83744a4e1ae5c9d3821ba8a283811367fd31eade is now integrated through
cd7d84354 (ancestry-preserving merge, not a rewritten rebase). Its changes are
release documentation only. TODO and the API paragraph preserve this branch's
0.4.2 source/package version and no-publication scope while recording Main's
0.5.4 release notes. The replacement24holdout remains sealed.

Independent receiver-sensitive getter review found a real introduced defect
in unpublished9d text reuse: two labels that previously received fresh block
receivers now share one. An inherited fontFamily getter keyed by receiver and
producer phase changes the second emitted font from Inter to DejaVuSansMono.
Both receipts pass. With explicitly declared identical pinned browser font
faces, the second line changes1,062RGBA pixels. The earlier raw-Resvg alias
fallback result is retained separately and does not prove font equality.
Evidence: receiver-fontfamily-falsification/REVIEW.json, CONTROL-ONLY.patch,
explicit-fontface artifacts and PNG-DIFFERENCE.json under the session root.
This counterexample supersedes the earlier text-memo soundness claim;9d has
not been pushed. The1,500/32-marker capacity closure must be re-established
after repair and is not currently a sound qualification result. The next
implementation replaces held clone identities with fresh per-occurrence
materialization from a bounded descriptor-copy plan. All text subtrees remain
in scope: prepared.display/source and preparedLines are read by actual consumers.

The original-seven three-system observation is complete at the frozen R5
revision:21cells, all14our strict+normal cells P with byte-equal phase outputs,
all7public pinned Pele1.9SVG/model returns. Independently authored meaning
matches21/21; actual111owned node labels,186carriers and195endpoint decorations
are enrolled. Marker-removal evidence covers177coincident groups, not195
individual visibility claims.45relation-caption and42first/last-node removals
are positive. Row103exact natural-curve style remains unverified: our C segments
are collinear within an orthogonal route, while Pele e2 is genuinely curved.
Default-input results remain observations of their exact frozen revision; they
do not establish generic getter correctness or global parity. Evidence:
original-seven-three-system-r5/SUMMARY.json.

The independently reviewed two-file Scene snapshot change is being adopted
separately. Completed bounded own-data null-prototype records receive a private
structural allocation fact after recursive capture/freeze; arrays and originals
do not. The existing serializer can avoid repeating prototype/freeze/key/
descriptor checks on only those exact records. Generic mutable/Proxy/getter
paths, actual writing and semantic/geometry proof remain. Reviewed physical
prototype:218owners/3,942assertions pass,34allocation/import-order controls pass;
three exact SVGs are unchanged and observed reflection removal matches290/498/324
paid operations. No Class/ER closure, timing or memory claim follows. Actual
combined-source checks are pending; source adoption does not itself qualify it.

Actual integrated-source Scene+documentation owners pass70tests/2,171assertions;
canonical core+repository types and repository biome lint pass. Source/head
byte guards and descendant cleanup pass in all three jobs. An initial command
ran biome check instead of the repository's biome lint and reported pre-existing
formatter/import-order differences; that stricter unrelated formatter result
is preserved as lint-scene-own-data.log, not hidden or mistaken for the
canonical lint result. Evidence: xml-adoption-checks/{scene-own-data-docs,
types-scene-own-data,lint-scene-own-data-canonical}-RESULT.json.

A separate introduced defect rejects the private marker-snapshot experiment.
Under restored inherited Array methods, baseline Class A-->B emits two marker-end
carriers but the prototype emits none, while both receipts pass. Returning a
cloned definition roster changed the receiver seen by the family's existing
find call. Its earlier25,341operation saving does not qualify it for adoption.
No live file contains that prototype. Evidence: label-independent-review/
marker-roster-{baseline,overlay}.{svg,json}. The reviewed two-file Scene
structural fact does not share renderer receivers and is independent of both
rejected identity-sharing assumptions.


### 30 October: authored interactions repair real grammar and loop-halo gaps

The separately reviewed Scene structural subtraction is committed privately
at9c9e6a320d28eb5e8d55465be5de6ed854d8af49; integrated Main remains83744.
The six-source interaction cohort was independently authored/frozen before
queries. Its18cells and all14returned SVGs remain enrolled and observed:
50node owners,67carriers,77observed endpoint decorations in75positive removal
groups and119positive authored-label removals. Node/relationship counts are
not a correctness score. Its held-R5 outcomes are Agentic4returned/2refused,
our ELK5returned/1refused, Pele5returned/1unsupported. Our returned strict/normal
pairs are byte-identical. Three-system epochs are kept separate from the prior
20source/60cell cohort and actual Original7/21cells. No holdout was opened.

Pinned Mermaid12.2grammar was queried independently for all6sources:5accepted;
Class's direct style declaration is a native-readable extension that pinned
Mermaid/Pele reject. It remains enrolled. Both public implementations accept
o--> but drop its circle-start meaning; actual Pele has4decorations versus
5authored in that case. Pele also draws the requested right-of-Audit State
note below Audit, despite retaining the note's intended side in its model.
Our two paths retain the right side. ER's18served cardinality ends match the
authored component topology; coincident/unkeyed ownership limits stay explicit.
Declared Inter lacks the CJK code point in the formatted case, so positive
text pixels do not prove correct fallback glyph identity. Exact natural-curve
style remains unverified. Evidence: authored-interactions-six/SUMMARY.json,
SOURCE-VALIDITY-ADDENDUM.json, ACTUAL-CARDINALITY-READBACK.json, FONT-COVERAGE.json
and class-contact-repair/grammar.log with guarded worker/cleanup records.

657dae66144037dd5fd4286a54399c5463c06715 fixes the grammar gap: the shared lexer
now accepts solid circle/cross-start plus arrow-end operators, preserving both
authored symbols and length. Typed export is accepted by12.2 and rereads with
the independent expected meanings. The owning mixed parser case fails before
repair. Afterward326unique owning/adjacent tests pass2,029assertions across6files:
171parser,13actual marker-ink,142conformance/edge-ID/metadata/Markdown. The new
actual SVG tests check authored visible text, both node-stroke contacts and
positive separate start/end marker removals on both backends. A first observer
epoch used exact binary floating sum and was corrected to1e-10precision; an
inappropriate expected-P assertion exposed the existing richer Unicode proof U
and was removed from this grammar/ink test's scope, with the refusal retained
here. No product check/tolerance was changed and no full paint-proof gain is
claimed. The original three-node mixed-case cohort still needs final-candidate
replay; a repaired two-node variant does not substitute for it.

The new Class interaction exposed a different defect. Optional loop compaction
checked bare caption boxes while mandatory final route admission already
reserves a2px halo. It removed a useful jog and drove the loop shaft through
the reciprocal report caption halo. Both compaction-time label-box creation
sites now retain that SAME existing2px reservation, so unsafe cosmetic
shortcuts keep the original feasible route. Final checks, fees, search limits
and caps are unchanged. The original four directions all fail before repair
and pass afterward:4tests/176assertions verify actual owned relations, labels,
cardinalities,6pxHub border, node-stroke contacts, positive per-caption glyph
removals and per-relation marker+overlay removal pairs. Canonical types/lint pass.
The FULL Class owner is122P/4F,2,819assertions; its four long-chain Native
400,000-budget failures remain open and are not hidden by the new4P slice.
Evidence: xml-adoption-checks/loop-halo-{red,green,class-owner}*,
types-mixed-marker-loop-halo*,lint-mixed-marker-loop-halo*.

Independent12-input/four-direction Class review changes Native4P/8refusals to
12P, preserving all4earlier success SVGs and all12ELK SVGs. A subtraction arm
disabling only cosmetic compaction also passes12; the halo fix retains safe
LR/RL compaction while matching un-compacted TD/BT output. Browser observations
cover24candidate cells,192node-stroke contacts,96positive marker groups,
96positive captions and48positive node removals, with zero foreign-shaft
intersections against actual glyph bounds plus halo. Final owner-byte-guarded
replay reproduces all24observed outputs. Initial browser import setup failure
is retained separately. Evidence: class-contact-repair/independent-halo-review/
REPORT.json. No new peer acquisition, timing campaign or public artifact claim.

Further subtraction ideas were actually falsified, not adopted speculatively.
Reusing local certified label/crossing scores removes2crossing+2label scans but
getter, preferNext and custom retainSelection controls change selected geometry
from1crossing to3. Removing initial text retention saves1,500visits on an
unchanged ordinary SVG but changes header ink under both backends; consecutive
style reuse changes visible title capitalization under an options getter.
Evidence: post-layout-reuse/REPORT.json and retention-style/REPORT.json.

The remaining critical unpublished repairs are now composed privately. Fresh
text copy plans retain fresh per-occurrence receivers; an independent own-key
fix prevents ambient iteration of PRIVATE reflection arrays from dropping own
caller/Proxy fields. Source Proxy/getter observations remain. XML construction
uses private indexed rosters and primitive actual composition, with fresh DATA
position obligations and raw fallback. Replays found and repaired introduced
R5 false-P cases from private array methods and isolated-string scalar hooks.
All22before/after-import XML replay cells pass; later actual-attribute-slice
repair is inR4 and still needs final combined qualification. The separate
Nativeowning4receiver/own-key cases and final-document XML case are green on
their respective targets, not yet one shared candidate. First composed capacity
measurement keeps ALL SIX original refusals U at400,000; original7normal cases
remain P with identical SVG. No sound capacity closure is currently claimed.
Next concrete step: finish same-candidate XML/copy/group custody review and
owning checks, retain refused cases, then normal fast-forward-safe publication
and exact-head CI. Remote retained branch remains d43; nothing was force-pushed.


### 30 October06:47UTC: repair the falsified XML and receiver-sharing paths

The Class halo repair is privately committed at
9f9816babbec1bdba83cf2feb284ec8c0ada4211. The combined source now replaces9d's
held text clones with fresh per-occurrence materialization. A first owned-text
occurrence performs the full fresh copy and records only private seen state;
the second builds a paid descriptor plan inside the existing copy walk; later
occurrences allocate fresh records/arrays and retain every assignment/depth
debit. All block/prepared/lineBlocks/runs/preparedLines diagnostics stay fresh.
Caller mutable/Proxy/getter sources retain reflective copying. A separate
pre-existing own-data bug is fixed: private reflection-key arrays are traversed
by own numeric slots so ambient iteration cannot omit caller own fields.
Source Proxy ownKeys/descriptor observations remain; this deliberately fixes
key loss, not an assertion of equivalence with the old erroneous callback.

XML evidence now uses private own-slot rosters, primitive actual composition
and scalar/name/reference checks, and occupied-space DATA obligations inside
the fresh root parser. An isolated string/array method cannot alter a private
fact independently of actual bytes. Unknown/raw/cached/failed paths still
parse their actual emitted SVG; exhausted capture cannot mint P. Primitive
numeric capture indentation and completed attribute trimming use primitive
construction; original default string writers and generic coercion/error
paths remain. Independent22before/after-import falsifiers pass on the frozen
R2 hardening; R4 additionally closes an actual before-import attribute-slice
case that made malformed SVG receive P on R5. All evidence/failed epochs
remain in label-independent-review/xml-r2-replay/ and space-xml/.

Exact actual-root adoption uses the four runtime files plus current owning
writer test from frozenR3/R4, with the single Nativefinish verify hunk applied
once. Direct byte binding and pre-adoption sources are recorded in
correctness-adoption-r3-r4/BINDING.json and before/. On that SAME source,
canonical core+repository types and full repository lint pass;96writer/Native/
Sequence owners pass607assertions. Paint's targeted composition/receiver/text
slice is6P/1F(3,048assertions), with only the retained1,500/32-marker capacity
case failing. Two additional own-data/Proxy cases pass20assertions. The first
filter did not select those two, so they are counted separately, not silently
assumed covered. All source/head guards and child cleanup pass. Evidence:
xml-adoption-checks/{repaired-xml-copy-owners,types-repaired-xml-copy,
lint-repaired-xml-copy,repaired-copy-and-final-ink,repaired-own-data-ink}*.

Capacity remains unresolved:42physical cells compare freshR3, +SPACE R4,
+separate group-constructor facts. All14SVGs are identical across arms;
Original7 normal proofs stay P (best composite minimum margin74,760), but
ZERO of the six large refusals closes. Group facts are NOT adopted here.
The unmarked1,500receipt is295,253→296,754→296,760; small extra work is not
hidden. Native+SPACE is a correctness repair, not a claimed timing/memory win.
Evidence: budget-attribution/plan-space-capacity-r4/CAPACITY-HANDOFF.json.

Paid-stage profiling locates the refusals upstream of paint certification.
Class64/128 arrive with Native400,000 already exhausted and pay0paint units;
ER256 arrives exhausted at399,955 then pays45; text32 arrives exhausted at
399,999 then pays1. Completed controls are Class32Native274,728+paint25,917
and ER128Native271,990+paint5,216. All6instrumented/control pairs preserve
identical SVG and complete proofs, with unchanged prices/caps. Repeated
validator/inspection bounds work is unpriced and cannot fix these admissions.
No paint-only cache was built. Evidence: paid-paint-review/REPORT.json and
PAID-PAINT-COUNTS.json. Next work targets repeated capture/resource comparisons.

A further same-roster counterexample remains open before publication: inherited
map on a PRIVATE final fragment array can omit an actual connector while
inspection still retains it; actual XML is valid and the old certificate P.
Both root and inert-group cases have meaningful red owning controls with
actual labels, contacts and off-shaft head removal. The repair will bind
actual serialization and inspection to the same indexed captured roster while
preserving source Proxy/getter and generic fallback observations. This is not
fixed by the XML-validity repair alone. Owner source remains held privately
during current-root checks; no parallel writer overwrote it. Remote retained
branch is still d43. No readiness or correctness-parity claim is made.

### 30 October07:46UTC: compose actual-roster and post-write authority repairs

Fetched Main and the retained branch again: Main is still
83744a4e1ae5c9d3821ba8a283811367fd31eade and the published retained branch is
d43ef02ee11f9c5f99d5138e9455f14efcbab27b. Both are ancestors of private7c4486bf0;
no concurrent remote changes were discarded. PR449 itself remains merged and
closed. No new PR or issue was created.

Three independently observed roster failures are now represented in the owning
paint test: final-root map, final-group map, and private group-child iteration.
On the old composition these can remove an actual connector while leaving valid
XML and a passed certificate. The third mode excludes the caller's submitted
array; it specifically exposes omission by the private retained traversal. Its
old output loses284foreground pixels. The repaired own-slot traversal preserves
the complete submitted occurrence and uses the same retained roster for actual
serialization and inspection. Public caller/foreign/exhausted fallback behavior
remains separate; the three paired controls preserve actual SVG and all54
observed source reads. No caller-issued trust capability was introduced.

Adopted frozenRosterR2 Drawing/XML files, the independently owned Native roster
and late-transform guard, and inert synthetic proof operands. Exact pre-adoption
bytes and complete file-to-freeze equality are recorded in
roster-transform-adoption/BINDING.json and before/. Removed the unpublished,
unused XML validation compatibility surface rather than retaining another
certificate-like result. Owning XML tests independently parse actual SVG with
Saxes before checking production verification. Actual-root Native/writer owners
pass88tests/577assertions; the targeted roster/own-data/final-ink selection
passes7tests/78assertions. These are the composed transform-only bytes, not the
pending opacity repair or a final release qualification.

Late inherited transform exposes the same failed assumption through Native
retained leaves and ordinary synthetic Scene proof wrappers. A producer emits a
white circle or stroked line over a head, then adds a transform getter after
writing. Actual SVG is unchanged and removing the covered head changes0pixels,
but the old proof moves the cover and incorrectly passes. Native conservatively
marks inherited unowned transform uncertain; synthetic proof-only operands
have no prototype. The writer's original source reads/receivers are preserved.
Full private owner62P/429assertions, strict types and scoped lint pass on the
exact transform-only freeze; mutable-before-admission and explicit own-transform
controls retain visible heads and pass. No timing claim follows.

Publication is still withheld for one demonstrated related counterexample:
with an explicitly emitted own marker opacity of1, a late inherited zero opacity
on the white cover also changes old U to falseP. The earlier opacity control
stayed U only because missing marker opacity was incidental uncertainty. The
stronger control is retained in late-transform-review/
RESULT-PROPERTIES-OWN-OPACITY.json. A bounded repair and owning control are in
progress; planning or the transform-only green results do not close this case.

The six capacity refusals remain enrolled and unresolved. Additional paid-stage
profiling has ruled out a paint-only cache as a solution. A separate bounded
experiment tests whether Class invisible repaint carriers can retain only the
complete straight terminal run instead of duplicating the entire route. ER has
no corresponding duplicated carrier: its relationship is drawn once and each
cardinality is already constant-size geometry. That source observation is not
an ER budget improvement. The replacement holdout remains sealed. Next concrete
step: close the demonstrated optional-paint authority hole, qualify the composed
candidate, then replay exact enrolled comparisons and publish only verified,
coherent work with a normal fast-forward push.

### 30 October08:08UTC: complete combined authority checks; preserve six refusals

The demonstrated late-paint class is now repaired on the composed candidate.
With all marker alpha fields explicitly1, six formerly passed but actually
covered heads become unverified: circle opacity/fillOpacity/fill and line
opacity/strokeOpacity/stroke. All20 paired field observations preserve exact
actual SVG and every pre-certification getter read; all prototypes are restored.
Independent raster controls find0changed pixels on removal of the covered head,
30on the exposed head, and48/61on the two node labels. The stronger owning test
fails on the transform-only implementation in both Native rows; both Scene rows
already pass. Evidence: late-transform-review/PAINT-FIELD-HANDOFF.json and
budget-attribution/marker-equivalence/paint-guard-*.

Native observation checks the existing complete13-field MarkPaint inventory,
including compound child paints, through paid own-slot/presence checks on its
already captured data. It does not invoke an extra source getter or return
before the existing observation path. Already inert paint has no inheritance;
a paid prototype check skips the impossible inherited-field walk. Synthetic
Scene proof operands remain inert. No writer source receiver, generic mutable
fallback, declaration/ownership rule, epsilon, price or production cap changed.
Adoption binds exact bytes in paint-field-adoption/BINDING.json; the roster
owner's final exact-SVG assertion is native-roster-owning-test-v4, not v3.

On these SAME actual-root code bytes, canonical core+repository types and full
repository lint pass. Owning checks across11files total969P/6F/45,965assertions:
88Native/writer;105adjacent Scene;607paint (557P/2F complement plus48P stock);
175Class/ER (171P/4F). All six failures are the retained capacity cases, not
newly excused expectations: four128-class Native chains, ER256Native, and
1,500labels/32decorations Native. Source/head guards and process cleanup pass.
The first full paint-owner worker reached the existing117second limit; its
partial evidence and terminated/reaped result are retained. The final full
607-test coverage is established by disjoint name partitions under the SAME
117second worker and30second test limits, with no timeout extension.
Evidence: xml-adoption-checks/{types-final-authority,lint-final-authority,
final-authority-*}. The earlier command's nonexistent deferred-test spelling
executed only the two real files (88tests); the subsequent105-test Scene run
explicitly owns the real deferred-terminal-projection.test.ts. No absent file
is counted as tested.

Further actual subtraction controls do not justify a dispatch change. ER has
one visible principal relationship, no Class-like invisible duplicate carrier;
12individual cardinality removals change48..143pixels. Shortening its route
would change visible geometry and does not address capture exhaustion. The
existing strong Scene path, selected BEFORE any Native capture, passes Class128
LR/RL at373,818/378,281, ER256at66,126 and a separate Class64TB control at264,449.
Class128TB/BT still exhaust400,000; the factory case remains Native-unverified
and has no public family Scene adapter. All six portable paired SVGs are exactly
equal. The13fresh-process control cells retain all guards and cleanup. Selecting
assertions also changes admission and deferred projection policy, so this is
not an isolated ordinary-adapter experiment. No size/direction rule or automatic
fallback was added. Evidence: scene-adapter-control/REPORT.json and
er-route-subtraction/REPORT.json. A family-wide single immutable authority is a
future structural option requiring original producer/writer custody, ordinary
path qualification and performance-hold evidence; these controls do not prove it.

A fifth Sol6.1High worker independently reread the historical comparison bytes:
all95normal SVGs parse, all23retained ours strict/normal pairs match, all21
Original7 models match independently authored facts, and all418pinned Pele files
match the fetched artifact. Original7's177positive marker groups and87positive
label removals, and authored6's75groups/119labels are supported as bounded
foreground observations, not universal correctness. This review also found and
corrected the stale work-log introduction calling the assistant-authored plan an
acceptance contract. No human-study gate applies. Evidence:
final-evidence-independent-review/PRELIMINARY-REVIEW.json.

The freshly frozen final-authority-checkpoint binds1,708files directly to this
candidate, with zero production differences from the immutable paint-guard
runtime. Its66ours-cell replay is in progress; no old proof or work count is
reused and no new peer acquisition is fabricated. The exact original three-node
mixed-marker source now parses and emits under both engines, but both strict
paths still refuse unproved cross/overlap ink; two-node controls do not close
that remaining uncertainty. Replacement24 stays sealed. Next step: commit this
verified authority repair, push normally, follow exact-head CI and finish the
separate fresh comparison. No correctness parity or delivery readiness is claimed.

Code checkpoint: `64e4be6ac340f4a1d81683878198237a91683f01` contains the
qualified authority repair and owning regressions. The08:10 pre-push fetch still
finds Main `83744a4e1ae5c9d3821ba8a283811367fd31eade` and retained remote
`d43ef02ee11f9c5f99d5138e9455f14efcbab27b`, both ancestors of that checkpoint;
the implementation worktree is clean. This following entry changes only the
work log. Exact-head CI is pending normal publication, not assumed successful.

### 30 October08:37UTC: fix built module initialization without losing admission

Published64e4be6ac at retained-head13996508f51984ae097bff7ab936c5d2d8a7ba1a
with a normal D43fast-forward. Exact-head CI41024742203 completed red, despite
independent semantic conformance and unit shard1 passing. Its built Node/browser
imports and installed consumers expose a regression from9c9e6a320: serialization
imports snapshot ownership, snapshot initializes its derived limits through
validation-core, and that core also imports serialization. The newly closed
initialization cycle reads SCENE_VALIDATION_LIMITS before initialization. A
minimal actual Bun-built NodeESM/NodeCJS/browserESM reproduction fails in all
three plain Node consumers at the same maxNodes read. This is an implementation
defect, not an execution/access blocker or a test to waive.

Tested subtraction first: reversing ONLY9c's two runtime hunks fixes all three
imports and111owners, but restores structural reflection work. Actual Scene
Class128RL regresses P378,281→U400,000 with unchanged SVG; LR changes to P398,330.
That alternative is rejected and all Root edits from it were restored exactly
from1399 before choosing the final fix. No reversal was committed or pushed.
Its failed admission, source freeze and reports remain in scene-import-cycle/.

The bounded adopted change puts the unchanged frozen9-value validation-limit
object in a dependency-free leaf module. Validation-core imports and reexports
the SAME binding; snapshot reads that leaf directly for its module-top derived
limits, retaining its lazy core error/mode dependencies. Private snapshot
completion authority, serialization, source getters, prices and all cap values
are unchanged. All three minimal built artifacts now import in plain Node;
actual SceneRL remains P378,281 with byte-identical188,701-byte SVG. An independent
review runs core-first and snapshot-first in all three artifact formats:6/6
fresh Node controls preserve core/leaf/public export identity, frozen values and
descriptors, derived limits, detached snapshots, zero accessor reads, refusal of
unissued receipts, and initialized capture/validator. No new state issuer exists.

On the exact adopted Root files, canonical core+repository types and lint pass;
118Native/writer/external-Scene/crisp owners pass851assertions, including CI's
source import/conformance failure. All source/head guards and child cleanup pass.
Evidence: scene-import-cycle/{LEAF-REPORT.json,LEAF-SOURCE-MANIFEST.json,
leaf-root-adoption/BINDING.json,independent-leaf-review/RESULTS.json} and
xml-adoption-checks/{types-limits-leaf,lint-limits-leaf,limits-leaf-owners}*.
Full installed-package/tarball checks still require the next published-head CI;
minimal artifact controls are not reported as a full-package pass.

The1399CI unit failures separate into the six retained capacity cases, the
initialization defect and its cross-runtime consequences, and an8-of322
geometry-golden difference. Each golden needs actual review before an update;
two caption-safety repairs are under separate private attribution. The initial
Main/older-caption attribution was incorrect:890affects six cyclic records and
ea1affects six caption-seat records, with four overlaps. Source-level pass counts
do not erase these CI
failures. Editor gzip remains1,397,265>1,334,500; lazy delivery has64distinct
over-budget rows (26raw/19gzip/19Brotli). The generated diagnostic has no render
errors but aesthetic tradeoffs. No limits or checks were changed.

Fresh1399comparison results retain66ours cells: old20 strict33P/7U and
normal26P/14U; Original7 both phases14P; authored6 each phase10P/2U. The123
returned phase SVGs are well formed; source/options, owned labels and literal
relations independently match. Twenty changed normal artifacts require fresh
ink review; no universal geometry/parity claim follows. The original rich
three-node mixed-marker case preserves all5authored heads, including positive
off-shaft pixels for BOTH crosses on BOTH layouts. Its remaining strict U is
a genuine correspondence/proof gap, not an observed missing head. The narrower
ASCII-only text binding and compound stroke existence assumptions are being
investigated without bypassing them. Replacement24 stays sealed. Next step:
publish the limits fix with reviewed golden/owning changes when ready, rerun
exact-head CI, and bind the final comparison to that combined source.

### 30 October09:12UTC: retain the cross counterexample; reject unsafe proof broadening

The limits initialization repair is committed and normally published as
6f7ccb418cde9888b4d66c4da1e5cf20190fe922. Main remains83744a4e1; no force push,
PR merge, version change, package publication or default-backend change occurred.

The original formatted three-node source actually paints all five heads. A
private compound-line proof expansion removed its two UNMEASURED issues, kept
the remaining contact uncertainty, passed37owners/types/lint, and preserved SVG
and all seven original proofs. Those successes were insufficient. An independent
tiny user-space cross is fully absorbed by its identically painted wide shaft:
the old proof U22257 becomes candidate P22370 while removing its marker reference
changes0pixels. Source-space nonempty stroke does not establish a surviving
semantic head. The entire runtime expansion and its broader owner extension are
REJECTED, with all failed epochs retained. No partial helper result is shipped
as a correctness improvement. Evidence: budget-attribution/authored-cross-proof/
{REJECTION-HANDOFF.json,OWNSHAFT-CONTROL-V3.json}.

Retained only the independently authored own-shaft-zero counterexample as one
mode of the existing cross-marker owning table, through BOTH Native and admitted
Scene. Actual resource/carrier/card attributes and zero full-RGBA marker removal
are asserted before requiring nonP. Current production13P/175assertions; the
rejected expansion11P/2F on identical test bytes fails only after the actual0ink
assertions. Corrected setup-only missing-new-module epochs remain distinct.
Root test-only adoption binds exact bytes at budget-attribution/
ownshaft-owning-regression/ROOT-ADOPTION.json; Root's owning selection passes13P.
Canonical core/repository types and lint pass on the combined test/golden source.
This is coverage protecting a sound refusal, not closure of the rich-text case
or any of the six budget refusals. Production remains6f and replacement24 stays
sealed. No timing/performance campaign was run.
