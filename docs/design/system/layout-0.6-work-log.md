# Native layout 0.6 correctness work log

The [qualification contract](layout-0.6-qualification.md) defines acceptance;
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
