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
run locally; no fresh CI result is claimed for this closed-PR continuation.

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
