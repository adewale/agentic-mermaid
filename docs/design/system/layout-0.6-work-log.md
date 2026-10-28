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
