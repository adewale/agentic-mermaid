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
