# Independent integration-boundary review

Compared main `39a500425f6b74eb486b9add9e90d538fab6a914` to
`9fb35b8bf8dc654a19612de3cc6a50144d68b0a7` (#606), against PR head
`96990f17b36af1dd05c1ce140d3ddf44aedfa8de`. Main adds opt-in bundled Inter
advances, bounded optional layout search and their lazy/build providers. Its
default and opt-in contracts must coexist with the PR's recovered ownership,
paint, route and capture foundations. This is a read-only boundary review;
no source edits, tests, builds, renders or network calls were performed.

## Concrete conflict resolutions

### Native producer and layered core

The producer import conflict is a union: keep `fitMeasuredLayout` from the PR and
`layoutOptimization` from main. Retain the PR's complete-candidate callback,
one shared shortening ledger, marker finalization and fitting of completed
alternatives. Main's new `ports` order must pass through that same completion
path, rather than replacing it with main's older post-hoc finishing sequence.

Keep the PR's captured `defineOrderSlot` construction and complete restoration
of speculative band orders. Main's port-aware coordinate pass belongs after
port assignment and before channels are constructed, as its patch specifies.
The new optional `MeasuredGraph.portAwarePlacement` participates in the existing
JSON geometry key. No stopped clearance or capacity trial is part of this merge.

The auto-merged layout engine must retain PR `preserveEndpointSeats` (rather than
the old `preserveStraightRoutes`) and the resolved style argument to
`rerouteEdgesThroughNodes`. Preserve the retained circle fallback itself. Add
main's opt-in budget wrapper, ELK order alternative, comparison metrics and
viewport routing without replacing those default-route protections.

Main's budget distinguishes mandatory producer calls from at most two extra
optional calls. Preserve its error propagation and nested-render isolation;
do not reset the PR's native routing/shortening allowances inside each optional
candidate. New search is opt-in, not a reason to apply the stopped experiments.

### Text profile and prepared text

`text-measurement-profile.ts` needs the union of both execution models:

- PR `measureInk`, validated copied ink bounds, `fontFamily`, `hasInk`, the ink
  cache and font-context restoration.
- Main partial-profile `covers`, width returning `undefined` for uncovered
  runs, private estimated-fallback registration and immutable-profile cache
  identity propagated through snapshots.

Validate and snapshot `measureInk` alongside `measure`; returning main's
`{id,version,measure}` snapshot alone silently removes actual ink capability.
Conversely, returning only the PR snapshot loses main's private coverage and
immutable registration. A host spelling the built-in id/version must not acquire
immutable-profile authority.

`prepared-text.ts` must retain the PR's owned/generic allocation distinctions,
sealed cluster arrays, fragment/run ink and private block ownership marks. Add
main's run-specific coverage checks in advance/tracking/fallback logic and its
temporary default-estimator context for unsupported shaping runs. The imports
are a union, including `withTextMeasurementExecution`, not a choice of one side.

Bundled Inter is an immutable **width** profile. Its cache identity is not
evidence of actual shaped glyph ink. Keep PR shaped-ink and Inter-envelope
admission checks authoritative; do not mark a block qualified merely because
the opt-in profile was library-owned or its id resembles Inter.

### Positioning and cache custody

Preserve the PR `!preferSceneDrawing(plan.family.id)` borrowing exclusion and
combine it with main's `reusableMetrics` predicate. Keep library-owned snapshots,
independent returned arrays and original-producer identity checks.

At the function tail, retain the PR's third
`request.appearance.font` argument to `withTextMeasurementExecution`, then add
main's outer `withLayoutOptimizationBudget(..., isolate=true)` wrapper. Dropping
the font argument changes the PR's default font-envelope context; dropping the
outer wrapper breaks nested optional-budget isolation and receipt evidence.

Persistent positioning reuse may include only privately registered immutable
profiles, with their identity appended to the existing key. Host width/ink
profiles remain bypassed even when their id/version matches the built-in.

### Build/runtime module ownership

`runtimeLayoutBackendSource` must contain the union of:

- PR node-lane-index declarations and `fitMeasuredLayout`.
- Main deterministic order, plain-data, UTF8, ink-index and lazy optimization
  declarations.

Keep the matching `onResolve` aliases for all those canonical leaves. Selecting
one side loses PR broad-phase/fitting ownership or main's demanded providers;
duplicating function/registry owners under different module identities is also
unsafe. Existing source-only admission and error-class identity must survive.

Preserve main's optional CJS kernels, package import mappings, node provider
twins, parser-position lazy provider and bounded dependency replay. The build
consolidator links live ESM bindings and reports final emitted import edges;
retain that provenance together with the PR's standalone packing/compression
and captured worker-byte checks. Do not claim payload savings from request
counts or old esbuild contribution totals.

The package-file manifest conflict contains build-dependent chunk multiplicity.
Keep the new optional runtime entries, then regenerate the manifest through its
existing verifier against the actual combined clean build. Do not choose old or
new repeated chunk counts by hand as a substitute for build ownership.

### Ceilings remain unresolved costs, not merge shortcuts

Main raises standalone limits from4,744,000/1,424,000 raw/gzip bytes to
4,774,000/1,440,000. The campaign's retained PR limits are stricter:
4,429,400/1,334,500. Main also raises Gantt raw642,000→643,000; the PR has
stricter Gantt gzip/Brotli values as well. Preserve the campaign ceilings and
report the combined measured failures. Importing opt-in features does not itself
justify relaxing those limits. This does not imply main violated its own review
policy; it distinguishes the PR's existing qualification contract.

## Focused verification required on the combined candidate

1. **Types and conflict lint:** core and relevant build/e2e typing, plus lint of
   resolved files. Review the final diff for conflict markers and dropped PR
   imports or guards.
2. **Profile/ownership interaction:** `inter-metrics.test.ts`,
   `host-text-measurement.test.ts` and `prepared-text.test.ts`. Exercise covered
   ASCII, unsupported script/weight/italic/monospace fallback, host `measureInk`,
   mutation/getter snapshot custody, nested/default font contexts and built-in-id
   spoofing/cache bypass. Width tests alone do not qualify ink.
3. **Optional/default layout:** `layout-optimization.test.ts`,
   `layout-certification.test.ts` and affected native measured/cache and route
   owners. Include omitted options versus `fontMetrics:'estimate'`, explicit
   balanced/viewport options, authored adjacency/wrapping, nested callbacks,
   cold/warm cache and budget exhaustion. Keep original endpoint/loop/label
   correspondence checks alongside rubric scores.
4. **Retained public products:** rebind selected default SVGs and entire
   receipts, particularly circle230 and enrolled17/152/37/201/241/372. Default
   changes must be identified even if main's new opt-ins pass. These controls
   are bounded preservation evidence, not a universal renderer audit.
5. **Built consumers:** existing browser runtime metadata-projection/minifier
   owners; emitted lazy browser tests for Inter/search/parser demand and retry;
   built dist/Node/browser consumers for optional CJS resolution and demand-only
   loading; actual standalone worker byte/cancellation/backend owner. This
   merge changes build module ownership, so source-only tests are insufficient.
6. **Costs/publication:** actual emitted lazy request closures and raw/gzip/
   Brotli bytes, standalone bytes and build observations, package-file verifier,
   and current release identity. Regenerate SDK/other owned declarations through
   existing generators if their owning checks require it; do not blanket-update
   geometry or visual goldens.

The repository-wide suite belongs to exact final-head CI. Previous main39/PR
readiness and byte bindings do not qualify the combined main9fb candidate.
Passing a focused integration subset does not remove enrolled Sparse32, payload
or advisory failures, and new feature tests do not establish general readability.

## Final combined-resolution review — 780b5f1b

Read-only review of merge `780b5f1b04ac7ac5db35cdd442d98df652daf17d`
(parents `96990f17` and `9fb35b8b`) found no blocking lost contract in the
resolved runtime or final test adaptations. The worktree was clean at the final
inspection. No source writes, builds, tests, or render calls were performed by
this reviewer.

- `positioning.ts:65–68` retains both the PR scene-preference/producer-custody
  conditions and main's reusable-metrics condition for borrowed geometry.
  `positioning.ts:166–168` retains the appearance font argument and surrounds
  positioning with the opt-in optimization budget. A host profile still cannot
  acquire owned-cache authority merely by matching a built-in identifier.
- `agentic-producer-core.ts:95–105` retains one shared shortening allowance,
  marker finalization, route shortening, complete-candidate fitting and the
  callback passed to raw layout. Main's port-aware option coexists with that
  completion boundary rather than replacing it. The layered completion/fitting
  foundation is therefore retained during optional candidate production.
- The text-profile/prepared-text union retains captured `measureInk`, bounded
  immutable ink observations, owned pixel/cluster handling, and font-family
  execution context alongside main's immutable built-in registration and
  per-string coverage/fallback. Bundled Inter width coverage is not promoted to
  ink certification.
- `runtime-render-contract.ts:382` now removes `projectSvgCss` together with the
  other structure imports when structure and postprocessing are coalesced.
  This repairs a real binding omission; it does not weaken the strict import
  matcher or delete the projection operation.
- `dist-artifact.e2e.test.ts:58–66` observes ELK using Node's resolved module
  identity and requests an explicitly cyclic ELK layout. Resolving the path
  does not load the module. The cycle avoids the PR's dependency-free forest
  path, so the existing demand-loading assertion remains meaningful.
  `browser-lazy-report.ts:132–134` recognizes the canonical symlink target in
  emitted inputs while retaining the prior node_modules spelling, one-chunk
  checks and closure accounting. It does not relax a byte ceiling.
- The optimization table at `layout-optimization.test.ts:35–46` now distinguishes
  the already straight PR fan (zero optional calls) from the four-bend triangle
  (one optional call), retaining exact SVG, ordered endpoints, hard-validity and
  empty selected-strategy assertions. This is an honest strict-improvement /
  selection-metadata owner. The supplied guard-removal counterfactual selects
  identical SVG, so it must not be advertised as preventing an observed visible
  port/symmetry loss. The optional comparison implementation, including port
  rates and raw symmetry, is byte-identical to main9fb; the separate canonical
  port/symmetry and symmetry-rounding owners remain. A new adverse optional-port
  geometry witness is not established by the adapted table.
- Existing standalone raw/gzip ceilings remain `4_429_400` / `1_334_500` in
  `e2e/browser.test.ts:402–403`. The changed generated package inventory is a
  publication/build-shape adaptation, not a changed runtime admission allowance.

The coordinator reports successful corrected types, targeted owners, all build
forms, actual built consumers, package inventory and bounded frozen-product
bindings. Those executions were not rerun by this reviewer. The reported 18 PR
and 18 main controls plus nine named controls support bounded preservation;
they do not establish that all opt-in layouts or all authored ink are improved.
The 18 known JSDOM loader failures remain failures, and the retained EPERM and
empty-wrapper attempts should remain distinguished from later successful
permitted checks. Exact merge-head CI and broader advisory results remain
separate evidence; this review neither clears them nor creates an acceptance
gate from their warning counts.
