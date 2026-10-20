# Graph layout backends and comparative measurement

Status: implementation and qualification contract for an opt-in owned backend.
Native measured Flowchart/State placement includes cycles, loops and independent
nested scopes. Cross-hierarchy leaf routes and specialized Class/ER/Architecture/
Requirement geometry still require ELK. Quality and cost qualification remains
in progress; admission is not proof of parity. Implementation scheduling remains
in root TODO.md.

This design adds an owned graph-layout backend alongside ELK, lets callers
select either one, and measures both through the same Agentic Mermaid rendering
pipeline. The deliverable is supported selection, truthful execution evidence
and reproducible comparisons. It does not require declaring either backend the
winner or removing ELK.

The initial implementation provides checked selection, attributed fallback,
shared final-artifact certification, and release-runner comparisons of strict
Agentic, Agentic with ELK fallback, and an ELK A/A control. The broader protocol
below also specifies subsequent work: dedicated edit-stability measurements,
browser backend comparisons, cache-churn cohorts and the complete aesthetic
preference vector. Unsupported or unavailable evidence must remain explicit;
the initial implementation does not establish a performance or quality winner.

## Qualification target

The continuation target is quality parity with ELK and lower execution time,
memory and browser transfer cost, while preserving explicit ELK support. This
is a stronger target than the initial selection-and-measurement delivery:

- Match authored content, connectivity, ports, label ownership, certification
  and deterministic output. Compare final route crossings, label conflicts,
  spacing, bends and area on the same inputs; pixel-identical geometry is not
  required. A faster drawing with avoidable crossings does not qualify.
- Keep the full comparison population: variable-size forests, labelled DAGs,
  parallel/reciprocal edges, cycles, self-loops, disconnected components,
  compound groups and cross-boundary edges, plus each existing ELK family's
  specialized geometry. Declines and fallback remain visible. Native-only
  performance claims cannot count fallback as a native completion.
- Measure fully consumed public workflows with caches disabled and enabled,
  edited inputs and memory churn. Require repeated improvements beyond the
  paired ELK A/A variation, and preserve adverse runs rather than retrying
  until a gate passes. Allocation, peak RSS and retained memory are distinct.
- Measure the emitted browser request graph as well as compressed bytes.
  Strict Agentic rendering must not fetch ELK; explicit ELK and fallback must
  still work. A smaller solver source file or deferred initialization alone
  does not establish smaller downloads. The all-in-one synchronous entry and
  the asynchronous entry have different delivery constraints.
- Rebase periodically and bind correctness, quality and cost evidence to the
  final combined revision. Keep default ELK regression gates active throughout.

Research and community inputs checked during the continuation:

- [Mermaid's layout documentation](https://github.com/mermaid-js/mermaid/blob/develop/docs/config/layouts.md)
  includes a tidy-tree backend and distinguishes the ELK-inclusive package
  from its tiny build. This supports specialized placement and actual demand
  loading; it is not an acceptance oracle for our geometry.
- [Mermaid issue 6646](https://github.com/mermaid-js/mermaid/issues/6646)
  explicitly identifies node-boundary intersection as necessary for tidy-tree
  integration. Reuse our clipping and final certification instead of treating
  center-to-center lines as finished routes.
- [Brandes, Walter and Zink's coordinate-assignment erratum](https://arxiv.org/abs/2008.01252)
  documents two flaws in the original Brandes–Köpf algorithm. A future compact
  DAG placer must account for the corrections, not implement an uncorrected
  recipe. The shared forest producer currently uses conservative subtree
  intervals, not a claim to implement that algorithm.
- [ELK's layered-algorithm overview](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)
  separates private cycle breaking from final authored arrow direction. The
  native producer uses a deterministic source/sink/degree-bucket variant of the
  [Eades–Lin–Smyth feedback-arc heuristic](https://www.sciencedirect.com/science/article/pii/002001909390079O),
  then restores the direction of every authored route. It does not copy ELK's
  implementation or silently reverse the user's relationships.
- [Pele's compound-ordering proposal](https://github.com/obsidianmd/pele/pull/4)
  coordinates group order and border-port order from a flat ordering, and
  compares completed routes. Its reported extra layout passes are a reminder
  to measure the quality/cost tradeoff. It supplies failure cases and ideas,
  not copied code or proof that this implementation matches ELK.
- [Mermaid's bundle-size discussion](https://github.com/orgs/mermaid-js/discussions/4314)
  illustrates the practical cost of carrying multiple engines. Keep ELK as an
  on-demand alternative rather than charging every native render for it.
- [Mermaid issue 8302](https://github.com/mermaid-js/mermaid/issues/8302)
  records a compound graph that becomes cyclic only after groups collapse,
  causing avoidable detours. It was closed as completed in September 2026;
  retain its graph as a design challenge, not an assertion of a current bug.
- [Mermaid's layout-maker guide](https://mermaid.js.org/community/layout-makers-guide.html)
  also separates measured placement from painting, and reserves edge-label
  geometry before layout. Its lazy registration model supports fetching only
  the selected engine. Documentation pages disagree about the current default;
  our behavior and compatibility pin remain owned by this repository.
- [Stately's native layout project](https://github.com/statelyai/layout)
  demonstrates that a TypeScript ELK alternative is not unprecedented. Its
  own documentation distinguishes phase-level differential coverage from
  incomplete broad geometry parity. Neither API compatibility nor many local
  comparisons establishes a complete replacement.
- [ARCOL](https://doi.org/10.1111/cgf.70437) extends orthogonal layout with
  aspect-ratio objectives. Compactness and usable proportions remain separate
  quality dimensions; matching crossings alone cannot establish parity.

## Scope and existing foundations

The integration baseline is main
[ee00f39](https://github.com/adewale/agentic-mermaid/tree/ee00f3943dcee603bf4de4a4c3da73e36f846641).
At that revision, Flowchart, State, Architecture, Class and ER use ELK Layered.
Other families retain their own placement algorithms. Requirement becomes an
additional consumer only when its implementation is integrated; the open
[six-family PR](https://github.com/adewale/agentic-mermaid/pull/438) is not part
of this baseline.

The new backend replaces graph geometry production, not parsing, typed editing,
prepared text, style resolution, Scene, SVG/PNG output, terminal-cell layout or
security. Family-specific meanings remain with their family adapters. This
follows [family composition](family-primitive-composition.md) and
[issue 409](https://github.com/adewale/agentic-mermaid/issues/409).

Build on these existing boundaries:

| Boundary | Responsibility |
|---|---|
| src/types.ts and src/render-contract.ts | Checked public options, immutable request resolution, applicability, transport parity and receipts |
| src/positioning.ts | One resolved request enters the registered family layout hook; the resulting positioned artifact is independently checked |
| src/layout-engine.ts, src/class/layout.ts, src/er/layout.ts and src/architecture/layout.ts | Family graph preparation, geometry production, routing and repair |
| src/scene/positioned.ts | Shared retained Scene and final paint evidence |
| src/render-stages.ts and eval/benchmark/ | Optional stage observation and existing micro, release, browser and peer measurements |

The [layered layout proposal](../../project/layered-layout-proposal.md) and
[conditional forest contract](../../project/conditional-forest-layout.md)
already landed through PR 443. This specification supplies their public backend
selection and comparative measurement contract. The guarded forest optimization and common final-artifact assessor are
foundations for the general replacement. Explicit ELK selection bypasses forest
placement; omission preserves main’s existing automatic policy.

## Backend selection

Add one checked, family-scoped render option. The public name distinguishes
graph layout from the existing Scene rendering backend.

```ts
interface GraphLayoutOptions {
  backend: 'elk' | 'agentic'
  fallback?: 'none' | 'elk'
}

interface RenderOptions {
  // Existing fields remain.
  graphLayout?: GraphLayoutOptions
}
```

| Request | Required behavior |
|---|---|
| graphLayout omitted | Preserve the existing automatic policy, including the guarded forest optimization |
| backend: 'elk' | Use the existing ELK strategy and downstream family pipeline |
| backend: 'agentic', fallback omitted or 'none' | Use only Agentic; report unsupported inputs or exhausted feasible candidates explicitly |
| backend: 'agentic', fallback: 'elk' | Try Agentic when eligible; permit one attributed transition to ELK for the cases defined below |
| backend: 'elk', fallback: 'elk' | Reject redundant configuration during option validation |
| Unknown backend, fallback or nested field | Reject during checked option admission |

Main's selected performance paths now enable forest placement and positioned
caching by default. An omitted selector can therefore avoid ELK on an eligible
forest; a successful strict native render is not automatically a download win
against that default. Compare explicit ELK with strict native when measuring
solvers, and measure the default policy separately. Cache hits retain immutable
producer decisions and replay per-request fallback diagnostics and roles.

An empty graphLayout object is invalid. Normalize omitted fallback to 'none'.
There is no automatic backend race, machine-dependent selector or default
change in this delivery. Candidate generation within the selected backend
remains deterministic.

ELK selection means the current Agentic Mermaid pipeline using ELK, including
existing candidate strategies, repairs and certification. It does not expose
unprocessed ELK output or promise new ELK algorithms.

Source, parsed-diagram, layout, verify, mutation validation, SVG and PNG adapters
must consume the same resolved selection. Source and parsed representations of
the same diagram must not choose different backends. Add CLI options
--graph-layout elk|agentic and --graph-layout-fallback none|elk, and project the
same checked option into MCP and browser surfaces through their existing schema
authority.

Preserve public return shapes. String-returning render APIs still return strings
on success and throw a typed owning exception on failure. Convert an internal
unsupported decline into that API's existing exception or structured diagnostic
boundary; do not add a success/error union to existing render return types.

Mermaid config.layout and flowchart/state defaultRenderer retain their existing
preservation and diagnostic behavior. They are not aliases for graphLayout.
Source syntax, canonical serialization and Mermaid compatibility do not change.
Family normalizers cannot rewrite the selected backend.

For families without this graph producer, retain their normal layout and emit
the existing RENDER_OPTION_NOT_APPLICABLE diagnostic for an explicit selector.
Declare applicability at existing family/option authorities; do not reuse a
spacing-option family list that also includes C4. Capability listings must
distinguish family availability from Agentic's input-specific eligibility.

### Terminal output and graphical companions

Pixel and terminal-cell geometry remain distinct. A graphLayout selector does
not replace Flowchart's grid placer or Class/ER cell placement. Where a terminal
family consumes pixel placement, the selector must reach that dependency.
Architecture currently calls layoutArchitectureDiagram directly from
src/ascii/architecture.ts and quantizes its pixel positions into cells. Forward
the captured selector through that call and src/render-family-hooks.ts; its
terminal geometry may therefore change under explicit Agentic selection.

Terminal APIs can also evaluate optional graphical connector evidence, including
on deferred receipt access. That execution must honor graphLayout too. Explicit
Agentic without fallback must never initialize ELK through a hidden companion
path. An unsupported optional graphical projection retains the existing explicit
projection limitation while native terminal output may still succeed.

Execution evidence must identify whether a graph decision belongs to primary
pixel placement or a graphical companion. A successful terminal grid is not
evidence that the Agentic graph backend supports that diagram. Full receipt
consumption must be included in comparisons that evaluate such companions.
If primary and companion layouts both execute, record separate decisions rather
than allowing the later decision to overwrite the earlier one.

## Geometry production contract

Keep the existing FamilyDescriptor registry and positioned-artifact boundary.
Introduce an internal graph-producer interface for the two implementations;
do not introduce a second family registry or a public layout plugin framework.

Family adapters prepare their domain model and measured requirements before
dispatch. The backend-neutral problem must retain:

- Stable authored node, group and edge identities, ordered endpoints, parent
  membership and deterministic source order. Internal dense indices must map
  back without collisions between authored and generated identities.
- Measured node/card compartments and group titles, minimum sizes, padding,
  group hierarchy and effective direction, including mixed directions.
- Port sides, fixed-order requirements where used, endpoint semantics and
  marker/outline clearance requirements supplied by the family.
- Every edge, including duplicates, reciprocal edges and self-loops; measured
  labels, their ownership and endpoint labels where used; rank-distance and
  route requirements actually consumed by the current family pipeline.
- Prepared text and its measurement context, with dimensions matching the
  chosen style, font, wrapping and units.

This is a graph contract, not a universal representation for charts, sequence
messages or weighted Sankey ribbons. Existing positioned and Scene types remain
the outward authority. An adapter may initially wrap ELK-shaped intermediate
data, but the owned algorithm must not depend on elkjs at runtime. Backend-
specific tuning stays inside its adapter; do not reduce the common contract to
an untyped map of ELK option strings.

Each implementation returns either a geometry candidate or a typed decline.
A candidate contains positioned nodes/groups, owned label geometry, routes and
endpoint/port references sufficient for the existing family pipeline. A decline
names an unsupported requirement or a documented local search limit. Validate
semantic correspondence before accepting geometry.

Existing family routing, shape clipping and certification remain shared where
their contracts agree. A backend may provide better routes and avoid a repair
only when the existing behavioral contract is still checked. No post-placement
movement may retain stale routes, labels, bounds or certificates. Measurement
must identify backend-specific adapter and repair costs rather than assuming
the two implementations perform identical internal work.

## Agentic implementation domain

Extend the forest prototype rather than creating a competing fast path. Its
first declared domain is flat rectangular forests without edge labels, fan-in,
cycles, long-rank edges or State-specific visuals. Unsupported shapes or graph
features must be declined before expensive work; they must not be silently
flattened, dropped or reinterpreted.

The first broader owned producer targets flat measured labelled DAGs,
including fan-in, parallel edges, disconnected components and extended rank
spans. Nonrectangular Flowchart nodes use the shared outline clipping and
graph certification; shape-specific paint limitations remain explicit in the
receipt. Directed cycles use private feedback-arc ordering and retain authored
arrow and label ownership. Forest fans retain shared trunks; layered graphs
retain their separately measured corridors instead of generic trunk bundling.
Flat State graphs share this producer while retaining their own style defaults,
pseudostate dimensions and note margins. Notes are placed by the existing
certified geometry pipeline, without treating them as authored graph nodes.
Self-loops reserve private turnaround boxes and separate attachment ports;
only authored nodes and edges survive the expansion. Independent nested scopes
are placed inside measured headers and padding, retaining local directions,
frame endpoints, State composites and concurrency regions. Cross-hierarchy leaf
routes still require boundary-port coordination and decline explicitly, as do
empty frames and overlapping node/frame identities. Constrained family ports
and the remaining graph-family adapters need further expansion. Admission of a
feature is not a claim of quality or cost parity over every admitted graph.

Complete, unlabelled rectangular fan nets may share a private junction when
every source already connects to every target. The adapter checks compatible
plain edge styling; incomplete nets, duplicate edges and measured labels keep
individual routing. Only authored subjects are returned, and producer-owned
shared routes enter the existing bundle certificate and full paint audit.

Inter-rank channels reserve physical tracks instead of hiding crossings in
coincident shafts. A routing dependency graph orders intersecting runs; cyclic
terminal conflicts receive visible doglegs. Stable barycenter sweeps retain the
best inversion ordering, followed by bounded adjacent switches. These are
established layered drawing techniques, not a claim of a new general layout
algorithm. Native layered placement owns its dimensions, ports and label
corridors; ELK-specific node movers and fan reconstruction must not invalidate
those reservations. Shared outline clipping and final geometry/paint auditing
still apply. Per-request limits bound expanded vertices, channel-pair checks,
routing dependencies and optional crossing-reduction comparisons, including
recursive scopes and loop expansion.
Feasible rank compaction moves a vertex only toward a bound that cannot
increase total edge span. Small cyclic scopes may compare deterministic
feedback orientations and reversed initial node/edge orders using actual
visible polyline crossings, then bends and area, retaining the earlier candidate
on exact ties. This search has shared per-request limits of 128
optional layouts, eight million point-pair scoring units, and separate routing
work; optional declines retain the best feasible candidate. It cannot consume
the mandatory routing budget of later scopes. No ELK result participates in
candidate selection, and zero-crossing primary layouts skip the search.
Class/ER compartments, Architecture ports and State semantics remain adapter
responsibilities even when they share a producer.

Use indexed working data and published graph-drawing algorithms where useful.
Pele's layered and compound code, including its proposed global group-ordering
improvements, are implementation references. Selective adaptation is permitted
with the required license notices. Do not depend on private Pele package imports
or replace Agentic's Scene pipeline with Pele SVG.

This delivery does not claim incremental layout. Prior positions, authored
rank/order hints and local-edit stability are later extensions of the same
problem contract. Report edit stability now so later work has a baseline.

## Fallback and failure handling

Fallback is explicit policy, not proof that Agentic completed an input.

| Agentic outcome | With fallback: 'none' | With fallback: 'elk' |
|---|---|---|
| Eligible candidate passes mandatory checks | Return Agentic artifact | Return Agentic artifact |
| Unsupported requirement | Typed unsupported result | Dispatch to ELK without fabricating an Agentic success |
| Documented local search budget exhausted or all bounded candidates rejected by geometry checks | Explicit bounded failure | Attempt ELK and retain the rejection reason |
| Parser/admission error, invalid options, global resource limit or security failure | Preserve the owning error | Preserve the owning error; do not retry to bypass the boundary |
| Unexpected exception, lost identity/edge/label, malformed candidate or internal consistency failure | Engine error | Engine error; do not conceal a defect through fallback |

At most one backend transition is allowed, Agentic to ELK. ELK never falls back
to Agentic. Existing ELK candidate/degradation bounds remain unchanged for an
explicit ELK request. The fallback policy declares bounded Agentic attempts and
reserves work for ELK under an admitted total resource envelope before running;
it cannot reset global accounting or multiply retries without a declared bound.
No selection may depend on elapsed time, benchmark history or global success
rates.

Use a closed reason-code catalog. A complete, finite candidate that fails a
declared mandatory geometric feasibility check may be candidate-rejected.
Non-finite coordinates, missing identities/edges/labels, invalid endpoint
references and contradictory ownership are internal defects, not recoverable
infeasibility. Crossing counts remain soft quality evidence under the existing
policy; they are not an automatic fallback trigger.

Support typed outcomes for unsupported, local-work-limit, candidate-rejected,
global-limit and internal-error without collapsing them into a generic render
failure. Integrate with existing error-origin and warning catalogs: an explicit
unsupported backend request is a capability/configuration limitation; an engine
defect must remain attributable to the engine. Optional terminal companions
preserve their existing limitation behavior.

## Execution evidence and cache isolation

Add a deterministic layoutDecision to the relevant positioned artifact and
public receipt projection. Do not overload executionDecision.backend, which
already identifies the Scene painting backend. Retain the execution evidence
privately with the admitted artifact, so consumer-provided metadata cannot
authorize cached geometry or certificates.

The decision must expose the requested backend and fallback policy, the executed
backend, bounded attempt outcomes and reason codes, implementation/policy
identity, and whether the result is primary geometry or a companion. A family
that does not participate reports not-applicable rather than claiming ELK or
Agentic execution. Fallback must also be visible through the existing diagnostic
surfaces when the caller does not request a receipt.

Keep observations separate from deterministic evidence. Elapsed times, cache
hits/misses, heap/RSS samples and machine identity belong in an optional trusted
diagnostic trace and benchmark records, not request/output digests or secured
SVG bytes. Cache-hit and cache-miss executions must have the same semantic
layoutDecision; actual computation/cache activity remains observable in trace.
On a cache hit, the retained decision describes the artifact's logical
production path. The trace separately records which kernels actually ran during
this call, including zero calls and existing singleton bypasses. Reports must
distinguish selected artifacts from physical solver invocations.

Capture graphLayout during immutable request resolution and include its
normalized policy in existing request identity. Project the actual decision
from the retained positioned artifact without rerunning layout. Follow the
existing render-contract compatibility/versioning policy for receipt additions;
do not add a new hash of our own source inputs as a provenance system.

Every geometry cache must distinguish backend and implementation/policy identity
and include all geometry-affecting inputs: hierarchy, order, directions, ports,
labels, sizes, spacing, style/text measurement and effective family options.
A successful fallback cannot be cached and later labelled an Agentic result.
Return immutable private data or isolated copies, retain bounded eviction, and
avoid cross-request mutation through caches. No persistent reuse across edits
is assumed.

Add symmetric benchmark controls to disable/reset all relevant geometry caches
for both implementations. Preserve the existing ELK cache control for backwards
compatibility. Disabling only ELK's cache is not a valid uncached comparison.

## Correctness and layout quality

Both implementations pass the existing semantic, family geometry, route, Scene,
paint and output-security contracts on the artifacts they actually return.
Backend choice cannot weaken a checker, silently remove content or convert a
hard requirement into a soft score. Equality with ELK does not waive a known
defect, and ELK pixels are not the correctness oracle.

Extend owning tests with independently specified identities, endpoints, labels,
membership and marker semantics. Use purposeful combinations: grouped fan-in,
nested groups with wide titles, labelled feedback cycles, parallel/reciprocal
edges, self-loops, mixed directions, nonrectangular outlines and fixed-side
Architecture ports; include namespaces, Class/ER cardinalities and State notes.
Import reduced upstream failure cases where their semantics apply.

Use the common final-artifact assessor and the policy in
[quality.md](../../quality.md), [layout-rubric.md](layout-rubric.md) and
[route-contracts.md](route-contracts.md). Report the quality vector separately:
readable titles, proper crossings, padded label conflicts, avoidable bends,
preferred ports, symmetry and area, retaining the applicable priority order.
Do not introduce a new weighted score that trades hard feasibility for area or
crossings. Report unavailable evidence explicitly.

Require deterministic geometry and secured bytes for repeated equivalent
requests within each backend on supported runtimes, regardless of cache state.
The two backends need not produce identical geometry or bytes. Refactoring the
existing ELK path must preserve its output; intentional ELK fixes require their
own behavioral evidence rather than being hidden in backend extraction.

Review a fixed, stratified visual sample of both final outputs, including worst
metric regressions and compound cases. SVG acceptance, label survival and
passing certificates do not alone establish equal readability.

The existing visual snapshot runner accepts the checked selector and retains
both source-SVG and parsed-layout receipts. For example:

```sh
bun run eval/layout-compare/run.ts snapshot --graph-layout elk \
  --families flowchart,state --label ELK --out bench-report/elk-visual.json
bun run eval/layout-compare/run.ts snapshot --graph-layout agentic \
  --families flowchart,state --label Agentic --out bench-report/agentic-visual.json
bun run eval/layout-compare/run.ts report --before bench-report/elk-visual.json \
  --after bench-report/agentic-visual.json --out bench-report/layout-review.html
```

The report retains declines, exposes actual fallback, expands full public
quality measurements, and keeps backend changes visible even when SVG bytes
agree. Preview IDs are scoped per panel; the original SVGs and receipts remain
in the snapshots. Quality is measured in a separate layout call, and this
review does not time rendering. Include shared opposing/parallel route ink
alongside proper crossings: overlap cannot be counted as crossing reduction.

## Comparative measurement

Extend existing benchmark commands and report types; do not create a parallel
benchmark programme. Enroll these three arms from the same built package:

1. Explicit ELK.
2. Explicit Agentic without fallback.
3. Agentic with ELK fallback.

Also retain a pre-change ELK package comparison for extraction overhead and a
true same-artifact A/A control for environmental variation. Keep input, effective
typography/style, safety/security settings, harness and output consumption equal.
Backend-specific tuning must be named, pinned and reported; no hidden quality
reduction may count as a speedup.

Extend bench:release with --layout-modes elk,agentic,agentic-with-elk and
--layout-cache off|normal. The third mode maps to backend: 'agentic' with
fallback: 'elk'; these are report arm names, not a third backend. Apply equivalent
selection to the existing browser, micro and peer runners where applicable.
For example:

```sh
bun run bench:release --baseline /path/to/pre-change --candidate /path/to/candidate \
  --layout-modes elk,agentic,agentic-with-elk --layout-cache off \
  --rounds 3 --reps 5 --out bench-report/layout-backends
```

Do not pass new selector fields into the pre-change package; run it as the
unchanged ELK control. Emit the existing machine-readable report plus a readable
comparison with per-case outcomes, denominators and metric regressions.

### Populations and attribution

Retain all enrolled inputs, including unsupported families, backend declines,
timeouts and failures. Derive family/corpus membership from existing sources,
not a new copied capability roster. Publish distinct-source and occurrence
counts, predeclared Agentic eligibility, attempted/completed Agentic inputs,
fallback count and final artifact success separately, per family and workload.
Corpus eligibility is not production traffic share.

Report paired timing on the same successful inputs, with its denominator beside
every aggregate. Do not time rejection as fast rendering, compare unrelated
success populations or count ELK fallback as Agentic completion. Retain all
unmatched statuses alongside matched-success results. Synthetic deployment mixes
must be labelled as such when real traffic weights are unavailable.

Each benchmark row records input ID, arm, actual execution/attempt outcomes,
cache regime, certification status, output consumption, sample population and
artifact identity. Fallback latency pays the Agentic attempt, conversion,
certification and ELK work. Optional diagnostic collection cannot be required
for ordinary rendering.

### Timing and memory boundaries

Release decisions use uninstrumented public calls. Report kernel-only and
instrumented pipeline measurements as diagnostics, separately from those calls.
Extend the stage observer to identify Agentic kernel time and graph preparation,
conversion, routing/repair and certification where the owning boundaries allow.
Kernel timers are nested inside layout; exclusive totals must count them once.
Do not infer another renderer's internal stages from its total time.

Keep both text-return cases and fully consumed public cases. The latter include
renderWithReceipt, UTF-8 encoding of the output and full receipt JSON
serialization inside the timed operation, including deferred companion work.
PNG/rasterization and terminal output retain separate cohorts.

Measure these regimes separately:

| Regime | Required observations |
|---|---|
| Fresh process | Use a separate fresh process or browser context for each first-use scenario: import, eligible Agentic render, explicit ELK and fallback; include initialization cost |
| Warm process with geometry caches disabled | Both backends recompute layout; disclose retained text/font caches and warm-up |
| Exact repeat with normal caches | Render to render, verify to render, bounded cache churn/eviction and fully consumed receipts |
| Edit sequence | Rename/label growth, add/remove node or edge, introduce a cycle, move membership, change shape/port/direction, undo, and transitions into/out of eligibility |

Use adjacent paired runs with counterbalanced order, at least three fresh
process pairs per cohort and the existing harness sample/warm-up policy. Retain
per-round ratios, actual samples and median/tail observations. A small movement
inside A/A variation is unresolved; do not subtract A/A noise or divide
independently referenced aggregates to manufacture a causal effect. Run timing
without concurrent builds, tests or report generation.

Separate allocation churn, settled/retained heap, peak RSS and download cost.
Use separate memory workers and disclose sampling/GC scope. A lower allocation
count is not a lower residency or whole-process memory claim. Include bounded
cache lifetime and post-eviction observations.

### Edit stability

For each edit, identify unchanged subjects by stable authored identity. Report
unchanged-node displacement both raw and after removing global translation,
normalized by the original median node diagonal. Also report relative-order
inversions, port-side changes and route changes for unchanged edges. Predeclare
the affected neighborhood and report whole-graph movement too, so choosing a
large affected set cannot hide disruption. Distinguish stability within a fixed
backend from a discontinuity caused by backend fallback. Stability is a measured
property in this delivery, not an incremental-layout guarantee.

### Delivery and reproducibility

Measure actual Node import graphs, browser initial/focused/lazy delivery, first
Agentic use and first ELK/fallback use, with compressed bytes and request counts.
Retaining runtime selection may retain both implementations in a bundle; no ELK
download reduction is claimed without measuring the request graph. Preserve
synchronous APIs and existing Node, Bun, browser worker and workerd support.

Retain source and harness revisions, fetched/shipped package identities, runtime,
OS/CPU, settings, cache policy, workload references, attempt records and raw
measurements. Generated reports and visual evidence remain build/CI artifacts,
not committed derived inventories. Results belong to the measured package and
protocol, not a later branch head.

## Acceptance and delivery sequence

The initial delivery is complete when all of the following hold:

- Explicit ELK remains available for its current graph consumers. Omitting the
  selector retains main's automatic policy, including the enabled guarded forest
  optimization. No promotion of the new layered backend is implied.
- Both explicit selections work through the canonical request and positioned
  artifact boundaries, with equivalent behavior across applicable public
  adapters. At least the declared forest domain completes through Agentic.
- Agentic without fallback performs no ELK work or initialization, including
  during verification and deferred receipt/companion consumption. Unsupported
  inputs, defects and limits retain their distinct outcomes.
- Optional fallback is bounded, observable and never counted as an Agentic
  completion. Cache hits preserve decision provenance and artifact isolation.
- Both implementations satisfy mandatory contracts on their declared domain;
  repeated execution is deterministic. Existing defects remain distinguishable
  from introduced regressions.
- One generated comparison covers the three arms, all enrolled statuses,
  uncached/repeat/edit regimes, complete receipts, quality, memory and delivery.
  No comparative speed claim is required to deliver support for both backends.
- Existing release gates remain enforced. At the baseline they limit corpus
  latency to 1.25 times baseline, per-family/scaling latency to 1.5 times,
  allocation and RSS to 1.25 times, and retained growth to 16 MiB. Read the owning
  harness for the effective policy rather than creating a second gate table.

Apply full existing coverage and release gates to the default/explicit ELK path
and the Agentic-with-ELK-fallback arm. Strict Agentic must complete its entire
predeclared domain with mandatory correctness and resource limits enforced;
outside-domain inputs remain visible as unsupported, rather than shrinking the
full-population denominator. Initially report its latency and memory against
ELK on that domain; establish an accepted Agentic baseline for subsequent
regression gates. Supporting both backends does not require Agentic to beat
ELK, and partial support must not weaken ELK or fallback coverage.

Implement in this dependency order: extract selection and the ELK adapter with
unchanged behavior; integrate the Agentic forest producer and strict selection;
add bounded fallback and retained execution evidence; extend existing comparative
measurements; then broaden the owned producer using the same contracts.
Add owning tests as each behavior lands, not a final standalone testing phase.

Any later default change is a separate decision. It requires complete support
for the proposed input domain, no new hard failures, reviewable quality
regressions, and a predeclared meaningful public-workflow improvement repeated
beyond observed A/A variation. Publish backend-specific comparisons alongside
whole-product release gates. Changing the default does not remove explicit ELK
selection or its regression coverage.

The channel routing work also follows a long-established distinction between
node ordering and segment ordering. [ELK's resolved fixed-port overlap report
#318](https://github.com/eclipse-elk/elk/issues/318) documents why one orthogonal
run per inter-layer channel can be insufficient, and why cyclic segment
constraints need splitting. Its linked [orthogonal routing thesis](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/thw-bt.pdf)
is a design reference; it is not evidence that our implementation already
matches ELK. Public quality reports retain proper crossings, opposing shared
spans and indistinguishable duplicate spans separately.

[TALA became open source on September 7, 2026](https://d2lang.com/blog/tala-is-open-source/),
under MPL-2.0. Its architecture separates independent candidate graphs, placement,
routing, exact label geometry and completed-layout scoring. Its deterministic
network-simplex ranker follows the [Gansner et al. ranking objective](https://graphviz.org/documentation/TSE93.pdf);
its general orthogonal placement also explores multiple explicit seeds. The
[implementation architecture](https://github.com/d2lang/d2/blob/master/d2layouts/d2talalayout/ARCHITECTURE.md)
is a research reference, not imported code or evidence of Agentic parity.
The release announcement explicitly notes weaker long-DAG results, nonlinear
runtime scaling and possible large changes after an edit. General orthogonal
placement and layered placement therefore need different quality and stability
comparisons. Candidate scores must concern rendered routes and labels; fewer
feedback arcs or rank inversions alone do not prove a better final drawing.
No TALA code or dependency is introduced here. Public indexed X searches did
not yield a citable post; that does not establish that nobody posted about it.

## Implementation references

- [Current request and receipt authority](https://github.com/adewale/agentic-mermaid/blob/19873682c786567d2807cad31c5017c0b3f05336/src/render-contract.ts)
  and [positioning seam](https://github.com/adewale/agentic-mermaid/blob/19873682c786567d2807cad31c5017c0b3f05336/src/positioning.ts).
- [Existing ELK cache and synchronous adapter](https://github.com/adewale/agentic-mermaid/blob/19873682c786567d2807cad31c5017c0b3f05336/src/elk-instance.ts),
  [release harness](https://github.com/adewale/agentic-mermaid/blob/19873682c786567d2807cad31c5017c0b3f05336/eval/benchmark/release-bench.ts)
  and [stage harness](https://github.com/adewale/agentic-mermaid/blob/19873682c786567d2807cad31c5017c0b3f05336/eval/benchmark/render-stage-bench.ts).
- [Owned forest prototype](https://github.com/adewale/agentic-mermaid/blob/2f591dbcd723f41334877c586f8a7a2c40816f21/src/experimental/indexed-forest.ts).
- [Pele compound crossing proposal](https://github.com/obsidianmd/pele/pull/4),
  [Mermaid authored grid proposal](https://github.com/mermaid-js/mermaid/issues/8401)
  and [Mermaid Dart indexed layout](https://github.com/orestesgaolin/mermaid/tree/f53b343b8fa5c30859223d623acde2da2f175a00/packages/mermaid_core/lib/src/vendor/dagre/src)
  supply algorithm and failure-case references, not Agentic acceptance oracles.
