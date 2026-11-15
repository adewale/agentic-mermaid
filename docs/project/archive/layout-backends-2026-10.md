# Graph layout backend design and experiments — October 2026

Historical design and experiment record, preserved from release 0.5.4.
For current selection, limits and fallback behavior, read the
[current backend contract](../../design/system/layout-backends.md). The measured
revisions, rejected experiments and unfinished qualification below retain their
original scope; they are not current release gates.

Status: implementation and qualification contract for an opt-in owned backend.
Native measured Flowchart/State placement includes cycles, loops and independent
nested scopes. Requirement cards and relationship labels also use measured
native placement. ER cards, frames and relations and Class cards, independent namespace frames
and relations also use this kernel. Bounded cross-namespace Class and cross-hierarchy
Flowchart/State leaf and frame routes preserve scope placement and frame headers.
Ancestor container endpoints, ambiguous identities, active hints and exhausted
corridor searches still decline. Architecture compounds use owned placement;
ports, alignments and final routing remain owned by its adapter. The current
research and campaign are in [layout-qualification.md](../../design/system/layout-qualification.md).
Quality and cost qualification remains
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
follows [family composition](../../design/system/family-primitive-composition.md) and
[issue 409](https://github.com/adewale/agentic-mermaid/issues/409).

Build on these existing boundaries:

| Boundary | Responsibility |
|---|---|
| src/types.ts and src/render-contract.ts | Checked public options, immutable request resolution, applicability, transport parity and receipts |
| src/positioning.ts | One resolved request enters the registered family layout hook; the resulting positioned artifact is independently checked |
| src/layout-engine.ts, src/class/layout.ts, src/er/layout.ts and src/architecture/layout.ts | Family graph preparation, geometry production, routing and repair |
| src/scene/positioned.ts | Shared retained Scene and final paint evidence |
| src/render-stages.ts and eval/benchmark/ | Optional stage observation and existing micro, release, browser and peer measurements |

The [layered layout proposal](../layered-layout-proposal.md) and
[conditional forest contract](../conditional-forest-layout.md)
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
algorithm. Four pairs of constrained median sweeps reduce adjacent-rank center span
without changing band order or the requested spacing between real boxes.
Private labels retain occupied widths and long channels compact within their
remaining feasible intervals. This is median coordinate descent, not a claim
of Brandes–Köpf or an optimal node-placement solution.
Native layered placement owns its dimensions, ports and label
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
optional layouts (at most twelve per cyclic scope), eight million point-pair scoring units, and separate routing
work; optional declines retain the best feasible candidate. It cannot consume
the mandatory routing budget of later scopes. No ELK result participates in
candidate selection, and zero-crossing primary layouts skip the search.
Completed native routes may take shorter orthogonal paths without moving
nodes or changing endpoint rays. The shortcut proof rejects foreign node/header
and padded-label intersections, new shared shafts and unowned route contacts;
it uses the existing proper-crossing counter. A moved label needs a measured
slot clear of nodes, other labels and foreign routes. Authored loops and owned
fan/forest routes retain their specialized geometry. Work is bounded once over
the complete graph: at most 128 edges, 2,048 route points, 512 scored proposals,
24 per edge, four accepted edits per edge and eight million work units. Budget
exhaustion preserves the feasible result and never triggers ELK fallback.
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

Consumed Node comparisons keep text-span measurement enabled on both sides.
The off regime disables positioned-result and ELK geometry caches; normal
enables both. Workers record these startup environment values before importing
the measured package. Automatic forest selection is disabled in these solver
comparisons, including the external default-only ELK baseline. Measure the
product's automatic policy separately. Earlier experiments that disabled all
performance features use a different protocol and retain that provenance.

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
[quality.md](../../quality.md), [layout-rubric.md](../../design/system/layout-rubric.md) and
[route-contracts.md](../../design/system/route-contracts.md). Report the quality vector separately:
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

The ELK A/A control requires the same artifact and identical SVG, terminal and
full-receipt fingerprints across workers. Its warm corpus, per-family and
per-workload latency ratios, corpus allocation and peak RSS must lie within
the reciprocal 1.1× interval (1/1.1 to 1.1). Reject implausible speedups as well
as slowdowns: a one-sided publication regression gate cannot establish a
healthy control. Keep ordinary publication thresholds separate, never divide
native timings by the A/A ratio, and retain failed or incomplete runs.

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

Mermaid community reports also constrain adapter work: [nested wide headers
#7901](https://github.com/mermaid-js/mermaid/issues/7901) remains open as of
2026-10-20; the comparison fixtures include an adapted nested-header example.
[Adjacent Class cardinality labels #8335](https://github.com/mermaid-js/mermaid/issues/8335)
was closed on 2026-09-28 and shows why endpoint labels must reserve space
against neighboring routes, beyond the main relationship label.
[Cycle-strategy delivery #8172](https://github.com/mermaid-js/mermaid/issues/8172)
was closed on 2026-10-04: preserving checked configuration across frontmatter,
source and browser entry points matters independently of solver quality. These
are upstream integration reports, not proof of defects in our retained ELK path.

Marker-driven label repair preserves the native producer's pre-proved foreign
shaft clearance. Candidate slots check the same padded-rectangle interior
predicate used by the label-conflict counter, including terminal ink and halos.
The additional shaft checks have a shared one-million-segment work bound;
exhaustion stops optional sliding. The retained ELK repair policy is unchanged.

Distinct native ports follow neighboring reserved lanes when the node face has
room for eight-pixel separation and corner margins. Dense sides retain the
proportional spread, and loop attachment pairs keep their existing allocation.
This reduces terminal jogs without authorizing shared ink. Final route closure
and its auditor treat settled reciprocal labels as obstacles: unlike an earlier
repair, they have no later label pass on which to rely.

[Edge concentration in hierarchical drawing](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)
and [ELK's merged-port option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-mergeEdges.html)
are established alternatives for reducing repeated fan routing. Exploratory
one-sided concentration and direct shared-port variants increased bends or
crossings in the generated multigraph cohort; neither is enabled. Broader
cycle-orientation sampling within the same twelve-alternative cap also trades
some crossing improvements for regressions elsewhere. Keep those adverse
results rather than presenting either experiment as a proven improvement.

The release runner uses a reciprocal 1.1-times interval for ELK A/A timing,
allocation and peak RSS, and requires identical artifacts, outputs and complete
receipt fingerprints. A control that is suspiciously faster also fails. Normal
cache measurements enable the position cache before import; disabled-cache
measurements disable both layout caches while preserving shared text spans.
The CI canary enrolls six official corpus inputs and thirteen frozen/scaling
workloads in both regimes. Its corpus aggregate covers only the official inputs,
with the workloads reported separately; it is not full-domain qualification.

Requirement's adapter owns its card/header/field measurements, relationship
stereotypes, title translation and Scene markers. It passes neutral measured
rectangles and padded relationship labels to the same native kernel; ELK's
schema is constructed only in the retained ELK callback. Source, parsed,
layout, PNG and deferred browser entry points retain the selected producer's
receipt. Only a typed local capability decline can invoke optional ELK fallback;
dependency loading, unexpected defects and global work errors propagate.
The adapter's tests cover all four directions, parallel relations, cycles,
self-loops and foreign-label clearance. Broader cost and quality qualification
still includes the remaining unsupported families in its denominator.

Small native self-loops may replace their reserved private corridor with a
three-segment turn. The proposal preserves distinct source attachments and
outward terminal rays, clears measured nodes and foreign labels, and cannot add
proper crossings, shared shafts or unowned contacts. A moved label needs a
measured clear slot beside its loop, including clearance from foreign shafts.
Bounds exclude discarded helper geometry and all translated points retain
independent ownership. The optional refinement shares two million comparisons
across scopes, examines at most 32 turn lanes per loop, and skips scopes above
256 nodes, 128 edges or 2,048 route points. Exhaustion keeps feasible geometry
without invoking fallback.

Small acyclic constraint graphs may replace feasible heuristic ranks with a
minimum-total-span assignment. The implementation cancels positive residual
cycles in the unit-edge-flow dual and accepts recovered rank potentials only
when primal and dual objectives agree. It is an owned bounded flow method, not
an implementation of ELK's network simplex. The [hierarchical-drawing handbook's
layer-assignment chapter](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)
describes why minimum height, minimum span and minimum drawing width are
different objectives. The refinement shares 200,000 residual-arc checks across
scopes, allows at most 128 augmentations per invocation, and skips more than
64 nodes, 128 edges or total minimum span 128. Exhaustion retains the previous
feasible ranks; it does not decline a previously supported input. Tiny weighted
DAG tests compare its objective against exhaustive feasible rank assignments.

A small flat Flowchart with remaining crossings may try at most two completed
alternatives after the normal bounded search: one authored-order cycle
orientation, then a compact private-rank candidate. The default reserves two
ranks per minimum link span; the compact candidate reserves an extra rank only
for measured labels. Both retain authored link lengths and arrow direction.
The residual-flow dual uses the same span constraints in relaxation, cycle gain
and objective certification; exhaustive labelled-DAG tests check this policy.

All completed drawings pass owned correspondence and geometry certification
after shared cleanup. Final padded-label conflicts, opposing/parallel shared
spans, proper crossings, raw bends and area are compared in that order; exact
ties retain the earlier drawing. An optional local decline or geometric
rejection retains the current best and allows the next bounded trial.
Unexpected defects, changed meaning, dependency suspension and global limits
propagate. Alternative trials are limited to 20 nodes, 64 edges, total minimum
span 128 and 2,048 final route points. Each raw placement retains its existing
search/routing work limits; the final selector certifies the primary once and
stops after a zero-crossing selection. It never runs ELK for native scoring.
State, compounds and Architecture's family-specific final routing do not use
this generic final comparison.

The compact-policy prototype retains 160 native renders versus 157 with ELK.
Completed-layout selection reduces the crossing regressions from eight to two:
seed 96 = 13 versus 8 and seed 131 = 5 versus 3. The previous nine-node result of 7 crossings / 52 bends becomes
3 / 40 vertically and 3 / 42 horizontally, versus ELK 5 / 52, 5 / 53 or 6 / 55 depending on
direction. This closes that fixture, not general quality parity. Applying the
compact policy unconditionally adds regressions elsewhere (including seeds 16,
91 and 137, plus an Architecture example); that wholesale replacement is not
used. Both previous 15-/19-node improvements and all adverse inputs remain.
Fresh combined-head quality and cost evidence are required before qualification.

The [OCMu64 exact solver](https://doi.org/10.4230/LIPIcs.IPEC.2024.35) uses
reductions and branch-and-bound for one-sided crossing minimization. Recent
[parallel exact/FPT work](https://arxiv.org/abs/2509.23706) studies that ordering
subproblem too. Neither alone solves our measured labels, ports, cycle reversal
and final orthogonal routes. A bounded exact rank-ordering prototype did not
improve the nine-node fixture. [libavoid's routing controls](https://www.adaptagrams.org/documentation/classAvoid_1_1Router.html)
separate length, bends, crossings and shared-path penalties. An owned bounded
visibility-grid experiment reaches 5 crossings there but 56 bends; it remains
unshipped while the smaller rank candidate achieves 3 / 40. No upstream solver
implementation was copied and no new solver dependency is added.

Recent Mermaid community reports reinforce separate engine contracts:
[connector-shape and color changes](https://github.com/mermaid-js/mermaid/issues/8496)
concern final appearance beyond placement, and [fractional-DPI label wrapping](https://github.com/mermaid-js/mermaid/issues/7794)
describes why a headless browser result alone does not establish every display's
text measurement. Both backends retain the same owned prepared text and Scene
painting. The [BPMN/swimlane work](https://github.com/mermaid-js/mermaid/issues/8160)
also depends on docking, anchored nodes, pools and lanes; generic layered boxes
do not replace those constraints. This informs future fixed-port and hierarchy
support without claiming those upstream features are implemented here.

Flat ER placement retains the ER adapter's attribute, key and comment measurement,
cardinalities, identifying/non-identifying shafts, relationship-label allocation,
styles and title rules. Its neutral placement carries entity bounds and owned
routes; only the ELK callback constructs ELK objects. Grouped ER diagrams decline
with a typed reason and can use the explicitly requested ELK fallback. The initial
26-case official/scaling diagnostic renders 20 natively and declines six grouped
cases; all 20 native paints pass, with no additional proper crossings. This does
not establish bend, area or full family parity. Terminal ER cell placement remains
owned by its existing adapter.

Flat Class placement retains measured member compartments, annotations, notes,
lollipop interfaces, relationship markers and endpoint cardinality allocation.
Only the retained ELK callback constructs ELK schema and repeats namespace-header
sizing; the common projector consumes neutral absolute bounds and owned routes.
Native labels reserve their actual painted location, accounting for the Class
renderer's eight-pixel route-anchor offset. Explicit namespace identity in the
neutral geometry distinguishes authored class names from generated frame names.
The initial official/scaling diagnostic renders 34/39 cases natively and declines
five namespace cases; all 34 paints pass without extra proper crossings. Class
padded-label and shared-shaft counters remain unavailable in the public quality
projection; neither admission nor unavailable counters proves full family parity.

Terminal routing has its own capacity limits. A declined route can retain an
owned endpoint/marker summary with explicit projection diagnostics, while its
geometry-collision diagnostic continues to fail terminal geometry certification.
A rendered summary is neither a physical route nor evidence of backend parity.

The snapshot runner also accepts a bounded generated Flowchart population. Both
arms require explicit backend selection, retain every source/outcome and consume
complete SVG and layout receipts. Generated snapshots omit the independent
terminal projection and label that omission; they measure quality, not runtime.
For example, reproduce seeds 96–159 with each backend using:

```sh
bun run eval/layout-compare/run.ts snapshot --graph-layout elk \
  --generated-start 96 --generated-count 64 --out /tmp/elk-holdout.json
bun run eval/layout-compare/run.ts snapshot --graph-layout agentic \
  --generated-start 96 --generated-count 64 --out /tmp/agentic-holdout.json
bun run eval/layout-compare/run.ts report --before /tmp/elk-holdout.json \
  --after /tmp/agentic-holdout.json --out /tmp/holdout.html
```

The advisory CI diagnostic now records all 224 development cases, including
adverse results. The clean `9877f370` holdout renders 64/64 natively and 62/64 with
ELK (one geometry and one paint rejection). Seven shared inputs have additional
native crossings: seeds 96, 125, 131, 132, 134, 138 and 145. No additional measured
label conflicts or opposing/parallel spans occur. Once used to choose a
refinement, these seeds are development evidence, not an unseen holdout.

ELK's [model-constraint documentation](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html)
and [force-node-order option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-forceNodeModelOrder.html)
distinguish order hints from constraints that crossing minimization cannot
violate. Architecture's compound child order therefore remains an explicit
capability boundary, even when unconstrained native container placement renders.

Flat Architecture diagrams reuse the graph producer for placement while
retaining the family adapter's authored side constraints, alignment directives,
service/junction geometry, obstacle routing and label allocation. Temporary graph
routes do not rank Architecture's final artifact: both producer choices honor
`compareRoutePreferences: false`. Only typed capability declines permit the
requested one-way fallback. Grouped diagrams retain ELK and an explicit native
decline for compound child order and boundary placement. The initial flat
diagnostic renders all three eligible official/scaling cases, with passing
paint proofs and no added proper crossings. An unshipped container-quotient
experiment renders all seven but adds a crossing on official examples 0 and 5;
it is not accepted as native compound support.


The next native candidate refinement moves all private vertices of a long edge
as a block across their consecutive ranks. A sequence of single-rank swaps can
stall because an intermediate move adds crossings even though moving the whole
chain reduces them. [Global k-Level Crossing Reduction (2011)](https://www.infosun.fim.uni-passau.de/~chris/down/GlobalCrossingReductionPP.pdf)
and [OGDF's global-sifting modules](https://ogdf.github.io/doc/ogdf/group__gd-layered-crossmin.html)
provide prior art. This engine uses a smaller owned heuristic, not an OGDF port:
try five deterministic relative positions, keep only a strict reduction in the
exact layered inversion count, and restore the best completed order before
budget exhaustion. Measured labels move with their edge block. No authored
node, edge, rank constraint or endpoint identity is replaced.

Only the compact candidate uses this phase, with at most 20 nodes, 64 edges,
256 expanded vertices and 128 proposals per acyclic placement. An independent
two-million-unit score budget is shared across its cycle trials and scopes;
charges include expanded-arc Fenwick queries/updates and rank slots. Exhaustion
keeps feasible geometry without invoking ELK. The existing routing, rank and
final-certification limits remain. To contain repeated layout cost, compact
candidates above 16 measured nodes retain their primary and at most two optional
cycle orders; smaller compact graphs retain the full bounded cycle search. The normal primary and
its original authored-order alternative remain available in both cases.

The initial joint-chain prototype renders 160/160 development cases, versus
157/160 with ELK, without additional proper crossings or measured label/shared
shaft conflicts on shared successes. It gives seed 96 eight crossings / 70 bends
versus ELK eight / 79, and seed 131 one / 36 versus three / 58. Its unrestricted compact
search backslides relative to the preceding native kernel on seeds 33, 115 and 125
(16→18, 21→23 and 26→28 crossings), while still beating ELK there; it also has more
raw bends in 73 / 157 pairs. Those observations remain visible rather than being
called universal aesthetic parity. Final bounded implementation evidence and
cost controls are required. The two difficult sources are now frozen fixtures,
render-review images and benchmark workloads, retaining every earlier input.

At the committed `7a0752c5` checkpoint, the predeclared seeds 160–223 holdout
renders 64/64 on both backends. Seeds 171 and 217 add native crossings (10 versus
7, and 22 versus 17), without additional measured label or shared-shaft conflicts.
Those cases have now informed a change and all 224 are development data. All
outcomes remain retained. Seeds 224–255 form the next 32-case holdout; measure
them only after the next implementation is committed.

Mermaid 12.2's [layout-maker guide](https://mermaid.js.org/community/layout-makers-guide.html)
also separates measured node geometry and edge polylines from shared shapes,
markers, labels and painting. That supports the existing adapter boundary;
it does not make family-specific cardinalities, ports or compound boundaries
interchangeable with generic boxes.

The follow-up preserves the validated small-cycle ordering while spending the
two scarce larger-compact trials on different cycle cuts before varying input
order. For true DAG inputs, it reapplies the existing bounded adjacent-switch
pass after joint-chain moves. A private orientation tag prevents that new DAG
pass from changing the separately validated cycle policy. Both passes use the
same existing neighbor-comparison budget. The initial unrestricted combination
closed the 224-case crossing gaps but added bends to the old nine-node fixture;
that failed owner test is retained and the adopted policy keeps its no-extra-bend
requirement. No ELK call participates in native selection.

ER compounds reuse the family's existing frame derivation, scoped directions,
sibling separation and boundary routing after either producer places measured
entity cards. Frame endpoint relations retain their original relationship
indices rather than being submitted as nonexistent entity nodes. Group-only
and empty frames use the same family-owned placement under both selections.
Native scoped route repairs preserve the actual attachment face normals so
cardinality marks stay outside their cards. ELK's legacy path remains intact.
Tests compare authored fields, membership, endpoints, directions, source/parsed
SVG, layout, PNG and complete visible labels in all four orientations. Existing
unverified paint observations remain explicit; native rendering may not add
uncertainty against a passed ELK proof. The compound fixture is retained in
geometry, browser dependency, rendered review and execution-cost populations.

Native ER repairs also validate leaf routes after scoped moves, try both aisle
axes within the same 400,000-operation budget, and reserve the resolved bend and
stroke envelope around foreign cards and headers. The nested official ER case
exposes a real rounded-route clearance failure: a 20px sibling gap cannot hold
both the cardinality stem and rounded bend beside an unrelated card. Native
rounded placement now reserves that extra gap; ELK keeps its legacy geometry.
Both sharp and 8px rounded variants retain passed paint certification.

Local validation of this follow-up passes 172 owning tests / 4,546 assertions,
including the old nine-node no-added-bend contract and both former holdout gaps.
All 28 ER corpus/workload inputs render on both backends without additional
proper crossings (28 passed native paint results; ELK has 27 passed / one
unverified).
The complete 224-case development scan has 224 native and 221 ELK renders and
no additional crossings or measured label/shared-shaft conflicts on shared
successes. This is development evidence; exact committed CI and unseen cases
are still required. The added fixture contributes one default geometry record
(315→316), with all 315 previous records unchanged. Two local canonical geometry
runs timed out rather than passing; do not infer a canonical pass from that
record comparison. A direct 5s-default ER test run also timed out in PNG work;
the canonical 30s owning run completes without changing its timeout.

A current community review still identifies wrapping/aspect ratio as a separate
need ([Mermaid #7505](https://github.com/mermaid-js/mermaid/issues/7505),
[#7368](https://github.com/mermaid-js/mermaid/issues/7368)); fewer crossings does
not prove an appropriate viewport shape. Microsoft's [MSAGL rectilinear router](https://github.com/microsoft/automatic-graph-layout/blob/master/GraphLayout/MSAGL/Routing/Rectilinear/RectilinearEdgeRouter.cs)
already separates obstacle padding, corner-fit radius, port management, bend
costs and sparse/full visibility graphs. Its sparse option explicitly trades
memory for potentially suboptimal paths. That is relevant prior art for the
remaining routing/size trade-offs, not evidence that this bounded aisle repair
implements a full visibility router or a new research result.


### Bounded reuse for edit workflows

ELK already memoizes raw measured layout when source/semantic edits miss the
outer positioned cache. The native backend now does the same at its neutral
geometry boundary. It stores no authored display text, prepared-text evidence,
receipts or final family objects. Keys retain every measured field and private
solver option, spelling out undefined/non-finite values without marker-string
collisions. Copies on insertion and hits isolate geometry translated by family
adapters. Failed computations are never retained. The cache is limited to64
entries, keys no larger than1Mi code units and an8MiB conservative weighted
estimate; oversized results stay uncached. `AGENTIC_MERMAID_ELK_CACHE=0` disables
both engines' geometry reuse. The browser creates this cache only after the
native implementation is actually loaded.

A source-comment edit diagnostic confirms that the outer positioned cache
misses while ELK reuses raw placement and native previously recomputed it.
The new raw cache removes that repeated solver work; full final-candidate
cleanup/certification remains visible and can still dominate native edit cost.
These concurrent local stage samples locate work, not qualify speed ratios.
Five cache-behavior contracts fail with reuse bypassed; public current-text
reattachment and cache-off controls remain regression guards. The combined
owning/startup suite passes142 tests /4,641 assertions before further changes.

The next canary predeclares3 paired rounds with25 repetitions (previously5),
the same reciprocal1.1× A/A limits and the same480s/cache and17-minute CI
budgets. It retains all22 enrolled inputs and adds the existing full
`agent:edit-flowchart` workflow, giving6 official +16 scaling +one workflow.
This improves precision for very short warm samples without changing gates,
normalizing by controls or deleting adverse observations. All previous failed
controls and slower native results remain evidence for their exact protocols.
This workflow repeats one deterministic edit; it is not a cache-churn cohort.


The clean145809d6 checkpoint is fully built (Node declarations, IIFE, lazy
browser declarations) and passes all required CI lanes. Its224-case exact-head
advisory artifact has224 native /221 ELK renders and zero crossing regressions;
three reference errors still make that advisory red. Clean six-family coverage
is218/235 native, with17 explicit declines, versus235/235 ELK. All218 shared
successes avoid additional proper crossings. The declared224–255 holdout renders
32 native /31 ELK (one reference certification rejection), but seed228 adds
crossings15 versus12. Both engines'31 shared paint results are unverified.
Exploration has now used that failure, so all256 are development data and remain
in the advisory population. No new unseen population is claimed yet.

At that same checkpoint, the6-official/16-workload canary has healthy cache-off
A/A (about0.98×) and native official time about0.59×, allocation0.81× and peak
RSS0.79×. Normal A/A is unhealthy on Requirement cycles, cyclic19 and Architecture
alignment; native about0.97× is unqualified, allocation1.00× and peakRSS0.79×.
These numbers predate the reuse changes and the new25-repetition protocol.
Immutable evidence: [CI](https://github.com/adewale/agentic-mermaid/actions/runs/39510580488),
[generated inputs](https://github.com/adewale/agentic-mermaid/actions/runs/39510580488/artifacts/12305356994),
[costs and render pairs](https://github.com/adewale/agentic-mermaid/actions/runs/39510580488/artifacts/12305683798).

### Replaying the chosen native order

Raw geometry reuse alone leaves repeated final-candidate cleanup/certification.
For eligible flat small graphs, a second bounded cache retains only which
strategy won: primary, authored order or compact private ranks. Its key includes
the complete semantic graph (including Maps/Sets and style maps), resolved
options/style andAPL environment controls. It is
scoped to the actual pipeline bindings and limited to64 entries /1MiB of
estimated residency, with a65,536-code-unit key ceiling. The cache shares the
startup cache-off switch and is bypassed for trusted custom text-measurement
profiles. It stores no geometry, text evidence, receipt or certificate.

A hit rebuilds the selected current candidate and the caller still performs
mandatory final correspondence/geometry certification; it never accepts a
cached proof. The owner contract checks byte-identical SVG after a comment edit,
unchanged decisions and paint proof, and a changed request digest. Node/edge
style-map changes force fresh selection; trusted host metrics bypass replay.
Bypassing order reuse makes that contract fail;8 cache/edit contracts /53
assertions pass with it. Broader combined and rebased verification remains
required. This reduces repeated search work without changing the cold policy,
its quality limitations, or the known seed228 gap.


The follow-up is rebased onto mainff33700d (#451). Conflict resolution retains
empty Class/ER title canvases under both backend selections and preserves all303
main geometry records exactly; the branch has316 records including its13 added
fixtures. Explicit native/ELK empty-title checks protect that combined behavior.
Both rebased typechecks and changed-file lint pass. The combined369-test run has
289 passes and80 sandbox pipe-write errors from the upstream grammar worker;
rerunning its104 owning State contracts with local process/network access passes
104/104 (687 assertions), resolving those80 errors without changing source or
timeouts. Those two run populations overlap; do not add their counts.

The completed145809d6 dense workload data also remains adverse: cache-off
cyclic15 allocates195.2MiB natively versus51.2MiB with ELK, and cyclic19 allocates
275.1MiB versus104.4MiB. Native peak RSS is lower (172.4versus180.9MiB and
179.8versus192.9MiB), but lower peak memory does not imply lower allocation.
These workload failures of the broader memory goal cannot be replaced by the
six-official-input allocation aggregate0.81×. The25-repetition/reuse protocol
still needs fresh exact-head execution and does not retroactively qualify them.


### Keep reuse inside the optional implementation

The08b8ab71 quality gate correctly rejects38 Class requests against its37-request
ceiling. Shared cache/measurement imports had split an additional chunk into
families selecting ELK. Native cache storage now stays inside its optional
implementation; the graph adapter supplies the existing custom-metrics callback.
Direction conversion lives in the neutral backend facade, so Class and ER no
longer import the whole Flowchart/State pipeline for that enum mapping. Backend
selection, shared error identity and stage-observer state use the same facade;
existing internal import paths remain compatibility reexports. Lazy native
readiness is checked at one shared boundary, with atomic initialization and the
same deferred loading/retry semantics. No dependency or budget ceiling changes.

Current performance toggles are deliberately absent from the strategy key:
text-span and positioned reuse preserve geometry, and the indexed automatic
forest policy does not apply to explicit native selection. The owner contract
checks replay across those flag combinations as byte-identical SVG; custom host
metrics still bypass replay and style-map changes force a fresh choice. A
65-graph contract also proves eviction without retaining caller mutations.
Nine cache/edit contracts /63 assertions pass.

A canonical lazy JavaScript probe now passes all existing ceilings: initial4
requests /5,458 gzip bytes; Class ELK34 requests /652,938 gzip bytes and native35
/223,172; Architecture ELK34 /707,020 gzip and571,888 Brotli, native34 /275,966
and243,269. These are prospective JavaScript closures, not a complete published
artifact or input-eligibility proof. The first callback-isolation attempt still
exceeded Class gzip and Architecture Brotli limits; the intermediate failed
probes remain in the local evidence. Complete declarations/IIFE/lazy builds and
browser dependency contracts must bind the final committed head before these
numbers support a shipped-cost claim. Synchronous IIFE still carries both engines.

### Reduce allocation while keeping the same layout

Node allocation sampling of the dense15/19-node cases identifies rank
relaxation iterators, tiny median sorts and repeated crossing buffers as hot
allocation sites. The refactor indexes residual arcs directly, reuses rank
scratch arrays between augmentations, reuses the crossing-score Fenwick trees,
and restores trial rank arrays in place. Directional medians with one or two
neighbors use the same lower/upper value without sorting; larger neighborhoods
retain their sort. Indexed score/adjacent-switch loops remove temporary tuple
and iterator objects while retaining comparison order and all work charges.
The shared proper-crossing sweep uses stable in-place active-set compaction;
intersection arithmetic, endpoint tolerances and deduplication stay unchanged.

An exploratory cache-off phase-only variant reduces measured allocation from
146.8→88.7MiB and182.5→109.9MiB for the two fixtures. Those concurrent local
GC-profiler traces do not measure whole-render cost or qualify performance, and
precede the final indexed scoring loops. All such variants and failed diagnostic
launches remain retained. The full shipped canary remains the qualification gate.

The final Node-source comparison against the clean08b8ab71 shipped Node artifact
retains exact SVG bytes and complete serialized receipts on256/256 generated
cases. This preserves the existing seed228 failure too. The canonical default
geometry test passes at its30-second limit (316 records, no baseline update);
all303 records from main remain unchanged. Final affected contracts pass159 tests
/5,261 assertions, both typechecks and changed-file lint pass. A separate78-test
metadata/startup run overlaps that population and is not added to it. The new
browser-only readiness wrapper still requires fresh built-browser validation.


### Independent Class namespace scopes

The Class adapter now supplies measured namespace frames and class membership to
the existing native compound engine. Nested scopes retain their header bands,
full captions, parent identities, member compartments, notes, cardinalities and
interface glyphs. Internal frame IDs reserve all authored card identities,
including names that resemble generated namespace IDs. Flattened namespace
configuration remains explicit. Empty native namespaces retain their frames;
the default ELK empty-diagram behavior stays unchanged. Cross-namespace leaf
relations still decline explicitly, without moving endpoints or flattening groups.

The new `class-compound-backends.mmd` workload exercises nested and sibling
frames, a generated-looking authored card name, a scoped note and an interface.
Both backends pass visible-label and painted-geometry checks in all four
directions. Source, parsed, layout and PNG surfaces retain native attribution.
Reinstating the earlier namespace rejection makes all five new scope/surface
contracts fail. The default geometry baseline adds only this fixture; all316
previous records remain unchanged. An initial update invocation used Bun's
default five-second timeout and failed after writing the baseline; that adverse
log is retained separately from the canonical thirty-second check.

Before the next measurement, the canary population expands from23 to25 inputs:
all previous inputs remain, with official Class example17 and the new namespace
workload added. This is seven official inputs, seventeen scaling workloads and
one fixed edit workflow, with the same three rounds, twenty-five repetitions,
cache regimes, controls and gates. Do not compare the new aggregate directly
with the previous six-official-input aggregate. Namespace captions reserve their
full measured width; matching ELK's wrapping/aspect ratio is not established.


### Exact-head allocation and bundle checkpoint (32a1a969)

[CI run39517782723](https://github.com/adewale/agentic-mermaid/actions/runs/39517782723)
passes every required lane. The generated advisory retains its one crossing
regression. The complete Node/declaration/IIFE/lazy build at this clean head
passes the existing download ceilings, and six selected-solver/fallback browser
contracts pass498 assertions. Transfer closures match the JavaScript probe
above. This qualifies those closures for this built head, not arbitrary later
commits; synchronous IIFE still contains both engines.

The unchanged23-input canary completes all three25-repetition rounds under
both cache regimes. ELK A/A time is0.9972× cache-off and1.0211× normal, with
all reciprocal control checks healthy. Native time on the six official inputs
is0.5238× ELK cache-off and0.9992× normal; allocation is0.79× and1.00×, peak RSS
0.78× in both. All seventeen workload latency diagnostics pass. Normal timing
and allocation are effectively tied, not evidence of a clear win. These are
raw ratios; no control normalization or retries were used. The orchestrator
runs Node26.3.0; shipped-artifact workers report Node24.22.0.

Dense allocation still fails the broader goal despite the scratch-buffer work:
cache-off cyclic15 allocates136.48MiB natively versus58.97MiB ELK; cyclic19
allocates229.31 versus119.71MiB. Peak RSS favors native163.58 versus188.80MiB
and172.45 versus206.44MiB respectively. With normal caching, the same inputs
allocate11.45 versus11.16MiB and15.21 versus15.24MiB. The fixed edit workflow
allocates8.35 versus11.49MiB cache-off,6.93 versus6.92MiB normal; it is still
not a cache-churn experiment. Earlier adverse08b8ab71 and145809d6 runs remain
part of the evidence. The matching quality, performance and memory goal stays open.


The expanded source diagnostic enrolls236 cases across all six graph families:
221 native renders,15 explicit declines,236 ELK renders. None of the221 shared
successes adds proper crossings. Class is38/41, all38 with passed paint; the
remaining three cases have cross-namespace relations. This diagnostic does not
include the separate256 generated cases or prove all quality dimensions. The
new Class owners pass12 tests /348 assertions, with overlapping selection
contracts49 /411. Changed-file Biome lint passes. The first lint command
incorrectly requested an uninstalled ESLint binary; its failure is retained.
A concurrent canonical geometry check also times out (137s elapsed against the
unchanged30s limit); its completed record comparison is not a canonical pass.


### Bounded private long-edge insertion (qualification in progress)

A long edge's private vertices can be trapped by single-rank switching: moving
one vertex first adds crossings even when moving the complete chain removes
them. The compact candidate now tests exact simultaneous insertion positions
for one private chain while holding all other rank orders fixed. Each adjacent
rank contributes an inversion cost, so dynamic programming solves this local
subproblem; it is not a global crossing optimum or a physical-routing proof.
Only a completed strict improvement is applied. Ties prefer less displacement.
Already crossing-free chains and partial scores that cannot improve are skipped.
The existing shared two-million-comparison optional budget remains unchanged,
including across cycle trials and nested scopes. Exhaustion retains completed
geometry. Indexed arc buffers avoid allocating tuples in the transition loop.

This search applies to compact13–20-node, at-most64-edge and256-expanded-vertex
placements. Tiny cyclic graphs retain their existing all-start cycle heuristic.
The initial unrestricted variant lowers the retained seed228 crossing count
from15 to11 (ELK12), with75 bends (ELK74), and adds no extra crossings in all256
development cases. It also regresses the nine-node RL bend contract to58 versus
ELK55. That adverse version and a failed displacement-tie attempt remain
retained. The scoped version must pass the unchanged small-graph contract and
a fresh full population scan before qualification. An initial red-proof command
accidentally invoked the package-wide test script and was interrupted; only
the correctly scoped causal check counts as a result.

The local exact solver matches exhaustive simultaneous insertions on128 small
randomized layered graphs; tests independently count crossings, retain fixed
vertex order and verify exhaustion cannot apply a partial insertion. The
public seed228 regression is retained alongside seeds171 and217, and frozen
as `cyclic-labelled-15-chains.mmd`. Before measurement, the canary retains all25
inputs and adds this workload:26 inputs (seven official,18 scaling,one fixed
edit workflow), with the same controls, rounds, repetitions and gates.

[Dobler and Roithinger2025](https://arxiv.org/abs/2502.20896) explicitly studies
the gaps caused by long edges weaving between layers, extending heuristics and
exact one-sided crossing minimization with gap constraints. This implementation
does not implement their gap-constrained model or claim their guarantees. It
uses standard dummy chains, inversion counting and dynamic programming. Together
with the earlier global-sifting literature, this is further evidence that
research beyond a single ELK configuration exists without making ELK obsolete.

Mermaid [#8302](https://github.com/mermaid-js/mermaid/issues/8302), checked
October21, is closed and taggedv12.0.1. Its report concerns hardcoded spacing,
label placement and feedback-route detours at a specified old renderer revision;
it is evidence for adapter/configuration and cross-boundary route tests, not
proof of an unresolved defect in the ELK algorithm itself.


The final scoped/pruned source scan completes all256 development cases:256
native renders,252 ELK renders (two paint and two geometry rejections). None
of the252 shared successes adds proper crossings, padded-label conflicts or
opposing/parallel shared ink. Seed228 is11 crossings /75 bends versus ELK12
/74. This closes the retained crossing failure on development data; paint
confidence, broader bend/area parity and a fresh committed holdout remain open.
The final pruned owners pass11 focused tests /1,085 assertions, including both
frozen15-node fixtures, all four old nine-node orientations and retained seeds.
The earlier scoped owning run passes109 /4,526 before adding the frozen fixture
and pruning; these populations overlap. Disabling chain insertion makes only
seed228 fail among the three retained-seed contracts (15 versus12 crossings).
Both typechecks and changed-file lint pass.

The clean Class3715d2d6 artifact completes Node/declarations/IIFE/lazy builds
and passes all existing transfer limits. Initial lazy transfer is4 requests
/5,458 gzip /4,917 Brotli bytes. Class ELK34 requests /653,234 gzip /525,579
Brotli versus native35 /223,468 /198,156. Architecture ELK34 /707,020 /571,882
versus native34 /275,966 /243,263. Six built browser contracts pass498 assertions,
including concurrent nested Class rendering with only the selected solver.
These measurements bind3715d2d6, before chain insertion.


The canonical thirty-second baseline update passes (13.33s), adding only the
new frozen long-edge fixture:317→318 records, with all317 prior records
unchanged. This update does not bless native geometry changes; the baseline
tracks default rendering, which still uses the existing ELK policy.


The next fresh generated qualification population is predeclared here as
seeds256–319 inclusive (64 inputs), using the committed existing generator.
Run it only after this chain-insertion implementation is committed, preserve
every backend outcome and review the full preference vector. Do not inspect
or tune against those sources before that checkpoint. Any failure used to
choose a subsequent refinement makes this population development data.


The final combined owning/selection/cache/family/benchmark run passes196 tests
/6,019 assertions across nine files. Counts include the new frozen fixture and
exhaustive insertion checks; earlier overlapping runs are not added to them.


### Fresh holdout and allocation-preserving cleanup

The predeclared4ab4bf82 holdout256–319 completes64 inputs: native63 renders,
ELK63 renders, with62 shared successes. Seed296 has31 native crossings versus
ELK22. Seed319 fails the unchanged `applyRouteContracts` straight-route
ratchet (1→0); ELK renders it. ELK separately rejects seed303's paint geometry.
All outcomes are retained. Seeds256–319 are now development data because their
failures are being used to guide work. The remaining failures are not removed
from the qualification population. A preferred diamond port bends an already
valid native straight route in seed319; the explicit preservation prototype
renders it with4 crossings versus ELK20, both81 bends, but is not yet shipped.

Class3715d2d6 CI completes required gates, but the cold25-input cost run is
incomplete: its ELK-reference cyclic10 worker times out against the remaining
overall budget. Only10/25 matched inputs remain, with no paired corpus memory.
The healthy cold A/A0.9859× does not qualify an incomplete native comparison.
The normal run completes25/25: A/A0.9477×, native official time1.0032×,
allocation1.00×, peak RSS0.79×. These adverse outcomes remain in
[artifact12311926200](https://github.com/adewale/agentic-mermaid/actions/runs/39521059556/artifacts/12311926200);
there was no retry or raised budget.

Allocation sampling identifies repeated lane-existence queries as a cleanup
hotspot. Those queries now return a Boolean without constructing blocker
evidence. Certificate-producing queries retain the same ordered, deduplicated
blocker records. Indexed loops and scalar label bounds avoid iterator, closure
and rectangle allocations; all arithmetic, current-label measurement,
reciprocal exceptions, comparisons and tolerances remain unchanged.

Against the clean4ab4bf82 shipped Node artifact, the source allocation-only
change retains exact SVG bytes, full receipt JSON and error names/messages
for both backends on557 inputs (237 official/scaling plus320 generated):
1,114 identical outcomes, including21 errors/declines. The first diagnostic
launch incorrectly requested320 cases from the generator's256-per-call limit;
it failed before comparison. The completed comparison uses256+64 without
changing that limit. Existing route owners pass195 tests /3,092 assertions,
both typechecks and lint pass, and all318 default geometry records pass the
unchanged30-second gate (13.67s), with no golden update.

A separate exploratory Node GC-profiler diagnostic consumes complete SVG UTF-8
and receipt JSON from both loaded artifacts, with caches off. For cyclic15 it
measures116,358,000→103,628,344 allocated bytes; cyclic19
173,768,608→158,489,696. Concurrent work, two loaded bundles and short warmup
exclude runtime/RSS qualification. These allocation reductions do not establish
a win over ELK; the full controlled canary remains required.


### Preserve valid native straight contacts

Native route cleanup now has an explicit `preserveStraightRoutes` policy. Before
replacing a straight contact with a preferred diamond vertex/hook, it verifies
exact axis alignment, current lane obstacles and actual endpoint approach
validity. A valid straight lane keeps its geometry and receives current route
evidence; blocked or invalid lanes still require repair. ELK retains its
existing policy. The straight/bend/port metric allowances are unchanged, and
pass-contract errors still propagate. Native implementation attribution is16.

The public retained-seed regression fails before this fix with the original
`applyRouteContracts` ratchet error. After the fix, seed319 renders at4 crossings
versus ELK20, both81 bends. The complete320-case source population now renders
320 natively versus315 ELK. The retained five ELK paint/geometry rejections
remain in the denominator. Seed296 remains the only additional proper-crossing
case (31 versus22); none of the original256 shared successes adds crossings.
All320 cases are development data.

The initial combined route/selection owners pass247 tests /3,521 assertions;
ten focused final straight/shape/seed checks pass72 assertions after tightening
the guard to exact axis alignment. Both typechecks and lint pass. These test
populations overlap. A concurrent canonical geometry check times out at35.96s
against the unchanged30s limit; it is retained as failed, not a pass. A clean
isolated committed-head check remains required. No baseline is updated.

The generated CI advisory now retains all320 inputs in two windows (256+64),
without changing the generator's256-per-call ceiling or the job's10-minute
limit. The original root256 artifacts remain, and the added development window
gets its own complete snapshots/report. A failing first report cannot prevent
the second report being written. Known seed296 and reference errors stay visible.

The4ab4bf82 canary is also unqualified: its cold arm loses its ELK-reference
nine-node-chain worker to the remaining overall budget, leaving0/26 matched
inputs. The normal arm completes timing but times out in native memory for
that same workload, leaving later memory observations absent. Both A/A controls
are healthy (0.9996× cold,0.9988× normal), but cannot qualify incomplete arms.
The normal official raw ratio0.9955×, allocation1.00× and peakRSS0.79× are
retained partial evidence only.
[Artifact12312463962](https://github.com/adewale/agentic-mermaid/actions/runs/39522619395/artifacts/12312463962)
is retained without retry or budget increases. All required4ab4bf82 lanes pass;
this does not establish the performance goal.


### Diversify small feedback cuts without more routed trials

The remaining development case296 has three feasible two-edge cycle cuts.
The existing traversal starts did not explore the useful cut with authored
node/edge order intact. For compact17–20-node graphs with at most48 edges
and a primary feedback count of at most two, the producer now enumerates
feasible one-edge cuts, then two-edge cuts only if no one-edge cut is found.
Each completed cut passes a topological check. Temporary longest-path spans
provide a diversity proxy: the two optional routed trials explore opposite
span extremes, with authored order intact. Existing primary-cut/permutation
deduplication still applies. No source text or fixture identity selects a path.

All graph checks charge the same two-million-comparison optional ordering
budget used by joint/chain moves. Exhaustion retains completed feasible cuts,
never a partial topological order. The existing two larger-compact optional
trials,128 shared cycle attempts, score/rank/routing limits and final owned
certifier remain unchanged. Enumeration/topological sorting are standard
techniques, not a new layout family or a global crossing-optimality guarantee.
Native implementation attribution is17.

The helper matches exhaustive total-order cut enumeration on128 small cyclic
multigraphs; budget tests verify only complete orders escape. Disabling it
makes only296 fail among the five retained-seed contracts (31 versus22).
The production case is19 crossings /90 raw bends versus ELK22 /94, with lower
area and route length; its longest route still has six bends versus ELK's four.
The complete320-case development scan renders320 natively versus315 ELK,
without extra crossings, padded-label conflicts or opposing/parallel shared
ink on the315 shared successes. All five reference rejections remain.

Broader preferences still differ:141 of315 shared drawings have more native
raw bends, with median ratio1.00 and worst1.3864× (seed11). Native area is
larger in100 cases, median ratio0.9030 and worst1.8733× (seed117). These
tradeoffs, paint uncertainty, specialized-family dimensions and compound
declines prevent calling the broader quality goal complete.

The final combined cut/core/selection/cache/benchmark/route run passes363 tests
/7,787 assertions across seven files. Earlier overlapping populations are not
added. The new frozen18-node cut workload adds exactly one default geometry
key318→319; all318 prior records stay unchanged. The canonical30s update
passes in17.50s. Before the next canary, all26 inputs remain and this workload
is added:27 inputs (seven official,19 scaling,one fixed edit workflow), with
unchanged three rounds,25 repetitions,480,000ms/cache deadline and17-minute
job limit. Do not compare changed-population aggregates as speed improvements.

The next fresh generated population is predeclared as seeds320–383 inclusive
(64 inputs). Execute it only after committing this implementation. Keep every
outcome; using any failure to choose a refinement makes it development data.

### Diagnose incomplete benchmark workers

Worker breadcrumbs now identify module import, cold SVG, SVG/ASCII correctness,
timing, quality, memory, result writing and event-loop drain. Writes occur
outside the elapsed SVG operations and GC-profiler windows; the full process
RSS still includes worker infrastructure. The coordinator also retains each
assigned worker budget and total worker wall time, distinguishing a nearly
exhausted overall deadline from a genuinely long individual worker. A timeout
stays failed even when a result file exists. There is no automatic retry,
extra budget, early-success acceptance or forced process exit.

Four focused Node worker contracts pass30 assertions: both cache regimes
still consume full output/receipts, while separately blocked ASCII correctness
and blocked process shutdown retain distinct stages and nonzero exit status.
The latter writes a payload before blocking; it still cannot pass as a worker.
These diagnostics change the measurement protocol metadata, not the gates or
API timing boundaries. Earlier incomplete runs remain unqualified.

### Recover the shared browser margin

The complete1f7a9bdf browser build correctly fails Architecture Brotli at
572,087 versus572,000 bytes. Reusing the same straight-route draft update
across three sites and naming the checked lane bounds removes duplication
without changing assignments or property-update order. A successful Node API
JavaScript-only probe now passes existing limits (Architecture571,957 Brotli),
including the new native cut helper. Full clean committed-head builds remain
required; the43-byte margin is small. The preceding Bun API launch failed
with esbuild service stopped; a report against leftover files is explicitly
unusable, and both failed launch and raw report remain retained. No limit rises.

An additional crossing-buffer/scalar-contact prototype matches1,114 full
outcomes on557 inputs against the preserved straight-route diagnostic build,
including20 errors/declines. It remains unshipped: a local full-render profiler
shows15-node allocation100,497,104→102,083,976 bytes (worse), while19-node
allocation159,620,712→141,233,744 improves. Those two-loaded-bundle diagnostics
do not qualify performance, memory or download cost.


### Rebase onto conditional rendering and retain incomplete cost evidence

The branch is rebased onto main9cd93ba5 (#457). Its cosmetic rollback contracts,
conditional text/dependency work and separate optional Pele1.6 read-only entry
remain intact. That Pele entry supplies unsupported-family SVG only; it is not
our measured graph backend, editable model, or evidence of native quality parity.
The shared opposing-ink helper accepts the route fields it actually consumes;
all lazy participants share one deferred-dependency error identity. Payload
ceilings still count the complete demanded ELK transfer, alongside separately
reported static and native-solver closures. No existing ceiling rises.

At980a03ed all required CI lanes pass. The advisory generated report remains
failed because it retains the five ELK reference rejections; a shared-success
comparison is not permission to discard those errors. The full clean build,
payload gate and built-browser contracts pass (six tests /498 assertions).
Architecture default ELK closure is571,957 Brotli bytes against572,000;
its native closure is244,446. Those costs precede this rebase.

The predeclared legacy320–383 population first executed on clean980a:64 native
and64 ELK successes, no additional native proper crossings. The six-family
source cohort is238:223 native,15 capability declines,238 ELK successes,
no extra proper crossings among shared successes. Existing unknown specialized
metrics, preference differences and compound gaps remain open.

Cost artifact12315805437 from CI39529516711 retains all27 inputs, three rounds,
25 consumed repetitions and480,000ms per cache regime. Neither regime qualifies
a native winner. Cold ELK A/A runs out of the overall budget: its first failed
memory worker receives722ms, runs739ms and stops in memory warmup. Native cold
comparison never begins. Normal ELK A/A completes27 inputs with corpus ratio
0.99308. The subsequent native comparison also runs out of the shared deadline;
its first failed100-requirement timing worker receives2,124ms and runs2,156ms.
Its partial corpus ratio0.99633 is unqualified. These traces establish deadline
exhaustion, not an unbounded renderer hang. No retries, control normalization,
repetition/population reductions or deadline increases rescue either run.
A compiled-worker exploratory pilot has identical output/receipt fingerprints
but inconsistent timing across three counterbalanced pairs; it is not shipped.

### Independent generator qualification, declared before first execution

The legacy LCG consumes two draws per edge. On even node counts its alternating
low bit restricts sources to one parity. Keep every legacy source unchanged:
seeds0–383 are now development data. Add a separate `sha256-counter-v1` population:
each endpoint draw takes the first big-endian32 bits of SHA256 of the ASCII
counter string `agentic-mermaid-qualification-v1:<seed>:<counter>`, modulo its
bound. Shape/direction/node-count/edge-count/label grammar stays identical.
This does not assert unbiased real-world sampling or cryptographic layout work;
it removes that specific generator correlation and records a distinct identity.

Declare seeds0–63 inclusive (64 cases) before generating or laying them out.
Commit the generator, CLI identity metadata and this declaration first. Tests
use only development seeds1000–1025 to verify replay, parsing, source parity,
endpoints, labels and bounded ranges. Keep every outcome, including paint
rejections and regressions. Any failure used to refine the solver becomes
development data. The advisory CI diagnostic retains its original320 inputs,
adds legacy320–383 and this separate64 population, and reports every window even
if another window fails; its ten-minute ceiling remains unchanged. Quality on
this synthetic grammar does not close compound, specialized, preference,
performance, memory, bundle or actual edit-churn qualification.


### Independent population result and three-edge cycle refinement

The first independent SHA counter population0–63 executes on clean17c01a67:
64 native and64 ELK successes, with one additional native crossing at seed22
(16 versus15). There are no additional native padded-label conflicts or shared
route overlaps. All128 paint certificates are unverified, so this is not a paint
parity result. Preserve both complete snapshots. This population is now
**development data**; no later run is a fresh holdout on those inputs.

That17-node /35-edge graph's primary feedback order reverses three edges.
The two larger compact trials previously could not explore a small-cut
alternative there. After exhausting one- and two-edge reversal cuts, a bounded
three-edge search now branches on one witnessed directed cycle: every feedback
set must contain an edge of it. Deduplicate chosen edge sets, stop at depth
three, and test a completed reversal set with the existing topological/span
checker. Charge DFS inspections and completed checks to the same shared two
million ordering-work budget. Only complete topological orders escape budget
exhaustion. The existing two routed trials,128 shared attempts, rank, scoring,
channel and certifier limits remain unchanged; no new per-fixture policy exists.
The caller enables this only for the existing17–20-node compact scope with a
primary feedback count of at most three. Solver attribution becomes18.

The retained public seed22 test fails16>15 before the change and passes14≤15
after it. Native raw bends fall75→74, still above ELK67; maximum route bends
fall12→4, equal to ELK. Exhaustive total-order checks cover minimum cut sets up
to both two and three edges, with a retained three-reciprocal-cycle example.
Focused helper/development-source checks pass10 tests /2,137 assertions.
All448 retained generated inputs (legacy384 plus independent64) now render
natively versus443 ELK. There are no extra proper crossings, padded-label
conflicts or opposing/parallel shared ink among443 shared successes; all five
ELK rejections remain. Those scans include dirty exploratory snapshots and
clean982c043e windows; they are development diagnostics, not timing evidence.
Every native generated paint certificate is unverified. All broader goal gaps
remain open.

### Scalar contact allocation, without the adverse buffer-pooling change

The earlier combined crossing-buffer/scalar prototype remains unshipped.
Isolating scalar contact checks eliminates temporary point objects, eager
contact maps and nested endpoint tuple arrays; it retains the same endpoint,
shaft/contact rejection and shared proper-crossing metric. A before/after Node
artifact comparison on686 inputs (238 source/workload,384 legacy generated,
64 independent generated), both backends, preserves all1,372 exact SVG/full
receipt/error outcomes, including20 errors/declines. Neither source-specific
lookup nor a quality tolerance changes. Two-loaded-artifact cold diagnostics
reduce allocation101,005,336→97,181,384 bytes for15 nodes, and
159,898,080→148,242,512 for19. These are exploratory full-render GC estimates,
not A/A-qualified performance, peak RSS, or proof of beating ELK's dense memory.

The rebase's canonical default geometry check passes all319 retained records
(28.71s within the existing30s per-test ceiling), with no baseline rewrite.
An initial accidental five-second default invocation times out and is retained.
Core typechecking passed; repository typechecking initially catches two renamed
browser-test helper references, then passes after fixing them. An attempted
cache-copy prototype test launch accidentally invokes the full package test
script; it is terminated and retained as incomplete, including environment
failures. The correctly scoped cache-copy prototype contracts pass9/63, but
no production copy change is made on that evidence alone.

### Current research and community refresh (2026-10-21)

[Angelini et al., WG2026, bounded-span upward-planar drawing](https://doi.org/10.4230/LIPIcs.WG.2026.6) proves hardness even for restricted
families and provides algorithms under additional structural parameters.
[Baumann, Rutter and Sudholt, Algorithmica2026](https://doi.org/10.1007/s00453-025-01361-5) analyzes evolutionary permutation
operators for one-sided bipartite crossing minimization; its strongest runtime
comparison concerns crossing-free instances. Neither is a drop-in compound
orthogonal router or a browser speed comparison. Our witnessed-cycle branching
is a standard bounded search technique, not an implementation of those papers.

Mermaid community updates still emphasize integration and user preferences:
[ER grouping #3225](https://github.com/mermaid-js/mermaid/issues/3225) asks for
meaningful entity groups, matching why we retained family-owned ER frames;
[connector changes #8496](https://github.com/mermaid-js/mermaid/issues/8496)
reports changed curves, positions and colors after an upgrade, but supplies no
reproducible source, so it is preference evidence rather than an ELK solver
counterexample. C4 #7849 and BPMN #8160 remain active on separate family/scope
contracts. A lower crossing score alone does not satisfy those expectations.


The next fresh population is predeclared as independent `sha256-counter-v1`
seeds64–127 inclusive,64 cases, before any source generation or layout run.
Execute only after committing this refinement and allocation change. Keep all
448 existing generated inputs in the diagnostic and add this window in CI;
retain the same ten-minute job ceiling. Do not call independent0–63 fresh again.


### Fresh independent64–127 and optional policy ownership

The predeclared second SHA counter window first executes on clean53c17357:
64 native versus63 ELK successes, with no additional proper crossings,
padded-label conflicts or opposing/parallel shared spans. ELK seed85 rejects
final paint (an unrelated-card shaft intersection and potential marker
occlusion); preserve that complete outcome. Across the512 generated inputs,
native512 versus506 ELK render, with six reference rejections retained.
The previous448 remain development data. Paint uncertainty, raw-bend/area
tradeoffs, missing specialized metrics and compound eligibility remain open.
The combined pre-relocation owning check passes466 tests /8,966 assertions;
subsequent policy/certification coverage includes the existing strict error,
meaning-preservation and mutation-isolation contracts, not weaker tolerances.

The complete53c17357 Node/declaration/IIFE/catalog/lazy build succeeds, but its
actual payload gate fails Flowchart gzip709,031>709,000 and Architecture
Brotli572,307>572,000. No ceilings rise. Move native candidate/refinement
policy into the optional producer; keep mandatory correspondence, geometry
and metric checks in shared functions supplied through typed bindings.
The producer performs the same final strict certification before returning.
Share the formerly duplicated backend-selection kernel. Measured family
adapters still admit only typed capability declines; only the generic graph
adapter opts into certified candidate rejection. Unexpected defects, pass
contracts, deferred dependencies and work limits still escape. Retain the
geometry decision before observing it, with the same receipt field ordering.
These are implementation/module-boundary changes, not geometry policy19.

Keep every JS-only probe, including adverse module/chunk behavior:

| Probe | Architecture Brotli bytes | Outcome |
| --- | ---: | --- |
| Clean53c17357 full build |572,307|Fails; Flowchart gzip also fails by31 |
| Direct optional imports for refinement |574,048|Fails; Flowchart and State also exceed gzip/Brotli |
| Shared certifier/score bindings |572,153|Fails |
| Separate metric bindings |572,131|Fails |
| Indexed/compacted opposing-span prototype |572,196|Fails; unshipped |
| Optional owned-certification policy |572,157|Fails |
| Shared backend selection; original opposing sweep |571,961|Passes JS-only probe; requires complete clean-head build |

The last probe reports Flowchart708,577 gzip /573,764 Brotli, Class653,252 /
525,641, Architecture707,020 /571,961. Complete native closures are
Class225,443 gzip /200,033 Brotli and Architecture277,923 /245,157;
initial four requests /5,457 gzip /4,919 Brotli. Actual requested input
eligibility and extra named-reference/fallback transfers remain separate.
The Architecture margin is only39 bytes. Do not describe a successful probe
as full shipped-build validation.

A separate cache-copy prototype preserves nine owning contracts /63 assertions
and exact output on four profiled inputs, but full-render time varies adversely
(e.g.15-node round2,65.70ms candidate versus23.04ms baseline), and a Class
allocation observation is worse. Both-loaded-artifact diagnostics have no
independent A/A or peak-RSS qualification. It remains unshipped. The opposing
sweep prototype matches10,000 mixed/tolerance/reversal/invisible route sets,
but its added bytes fail the unchanged budget and it is also unshipped.
A new full consumed19-node cache-off allocation sample points to repeated
proper-crossing preparation/scoring and lane-blocker work as material remaining
hotspots; it is diagnostic sampling, not a performance win.


### Rebase main's grammar and ER leaf-route repair

The branch is rebased again onto maine951d229 (#448). Preserve its grammar,
authored-text retention and ER leaf-route repair, as well as #457's conditional
dependency work. Main independently raises Flowchart gzip709,000→710,500 and
Brotli574,000→575,500; State gzip709,000→710,500 and Brotli574,000→575,000;
ER gzip716,000→716,500. The Architecture572,000-Brotli limit is unchanged.
The branch makes no bundle-budget edits relative to this new base and cannot
claim an engine saving from those upstream ceiling changes.

Clean combined d0a98258 builds all shipped variants and passes both typechecks.
Seven real-browser solver/forest/fallback checks pass531 assertions.
The238-case family scan remains223 native /15 typed declines /238 ELK, with
no additional native crossings on shared successes. A concurrent owning run
has139 passes and one30-second11-node selection timeout; keep it. The separate
idle selection file passes54 tests /441 assertions without a timeout change.
Earlier overlapping counts are not added together.

The default geometry gate identifies exactly one changed record among319:
our ER compound fixture's ORDER→AUDIT route. A fresh, isolated source invocation
on pristine maine951d229 produces **the exact same full default fixture layout**
as the branch. Main's new leaf-route repair replaces the old
(241,291)→(676,291)→(676,184)→(1111,184) route with
(241,291)→(273,291)→(273,228)→(1079,228)→(1079,184)→(1111,184),
and moves the `logs` label from(676,238) to(666,228). Update only that golden
edge path/label position to retain the upstream fix. The other318 records stay
unchanged. This is not a native-policy geometry change or a broad baseline reset.

The complete new-base payload gate still rejects d0a98258: Flowchart
710,770 gzip /575,669 Brotli, State710,720 /575,581, and Architecture572,130
Brotli. Preserve that failed combined build and its artifacts; neither the
previous successful JS probe nor upstream's revised limits qualify this head.
Continue reducing actual code cost rather than raising limits.

### Continued qualification: d1b73e34 and main bd0ccbe5

The complete d1b73e34 CI run39538409813 retains all512 generated native
successes and506 ELK successes, with no additional native proper crossings
on their shared successes. All three unit shards and browser, CLI, package,
MCP and semantic lanes pass. The required quality gate still fails its five
compressed-payload limits; the advisory generated report retains the six
ELK reference rejections. Neither is a reason to discard those inputs.

The27-input, three-round,25-repetition cost artifact12319366074 has a
complete healthy normal-cache control (A/A1.0109958), but native corpus time
is **1.0303272**, allocated-byte ratio **1.00**, and peak-RSS ratio **0.79**.
Matched525-sample p50s are5.148901ms ELK and5.149807ms native; p95s are
8.775486ms and9.154563ms. Retained native growth is0.3MiB across seven
memory inputs. Passing permissive regression checks is not beating ELK.
Cache-off A/A completes healthy at1.0420469, but the comparison is
incomplete, with zero fully paired corpus results: the reference18-cuts
worker receives only2,900ms of remaining budget and expires during timing
at2,920.9ms. Keep this incomplete campaign; do not divide native timing by
A/A, reduce its population or repetitions, or increase its deadline.

Rebase onto mainbd0ccbe5 (#458) before the next combined qualification.
Main independently replaces ordinary crisp Scene construction with native
drawing programs and removes the optional unsupported-family Pele fallback.
It also changes several payload budgets, including Flowchart/State gzip
712,000 and Brotli577,000, Class gzip713,000/Brotli577,000, ER gzip718,000/
Brotli582,000 and Architecture Brotli573,000. This branch makes no budget
edits relative to main. Attribute neither these ceiling changes nor main's
rendering savings to the native graph solver. Preserve the new `drawing`
diagnostic stage alongside `graph-preparation` and `agentic` when reconciling
the shared stage observer. Rebased core and repository typechecks pass.

Allocation diagnostics before this rebase tested batching all route-pair
crossings, preparing the candidate polyline once, and skipping the general
crossing scorer for contact-free finite orthogonal pairs. All preserve10,000
direct rejection/count comparisons. Batching reduces allocations but loses
median time on both dense cases. Prepared scoring's19-node timings include
an adverse1,374.29ms sample. The initial contact-free variant reduces median
allocated bytes from100,699,280 to93,921,904 on15 nodes and156,267,944 to
137,079,688 on19, but15-node median time rises255.53→292.22ms; retain that
loss. These fresh-process GC-profiled diagnostics have no independent A/A
control and qualify no shipped performance claim.

A separate25-repeat, profiler-free pilot defers the orthogonality check
until a contact-free pair actually needs it. On15 nodes, the three per-worker
medians are303.47/395.15/417.16ms before and231.04/279.29/189.42ms after.
Its six19-node workers fail before rendering because their fixture path is
temporarily absent during the rebase. A browser probe also overlaps the
rebase and fails to build. Preserve both launch errors; neither is valid
19-node timing or combined-artifact evidence. Subsequent diagnostics use
immutable input snapshots and identify the new base explicitly.

The community remains a source of integration requirements, not evidence
that one placement heuristic subsumes every family. Kroki's own
[v0.33.0 release](https://github.com/yuzutech/kroki/releases/tag/v0.33.0)
(2026-10-05) makes ELK the Mermaid default and documents a Dagre opt-out.
The current [Mermaid C4 tracker](https://github.com/mermaid-js/mermaid/issues/7849)
still separates placement, boundary titles, relationship identity and label
wrapping. Their evidence reinforces retaining ELK, testing the actual
adapter and output contracts, and measuring code download separately from
solver execution. A smaller owned solver has not made ELK obsolete.

The next allocation change keeps the general crossing scorer for every pair
that could contribute a crossing. For finite orthogonal polylines, every
proper crossing is already a perpendicular contact in the existing shaft/
contact veto. If that scan finds only authored common endpoints or no
contacts, its proper-crossing count is provably zero; those common endpoints
are excluded by the metric as well. Defer checking orthogonality until such
a pair occurs. Diagonal/non-finite input still takes the unchanged scorer.
No geometry preference, tolerance, search ceiling or mandatory certification
is relaxed.

Factor the shared route owner at the same time: read preferred cardinal
coordinates without cloning four ports, reuse diamond-sibling classification,
axis-point construction and the three identical longest-segment/center-out
label enumerations. Read `x`/`y` directly in lane checks instead of using
computed property names. Keep all sample arithmetic, stable ties and public
certificate fields. Reuse the existing weighted LRU for ELK with exactly its
64-entry/1,048,576-key-code-unit bounds and copy-on-store/hit behavior; the
native LRU remains private to its optional chunk. Filter environment names
before reading values for the native strategy key, preserving its sorted
APL pairs. Consolidate the selected-attempt append without changing fallback,
error identity, receipt ordering or observer/retention ordering.

Before the direct-coordinate-load extension, Node bundles of clean rebased
5ab4380d and the combined prototype produce **1,500 identical full SVG,
serialized-receipt or error-name/message outcomes** on750 inputs:238 source/
workload cases, all384 legacy generated cases and128 independent-generator
development cases. All21 errors/declines stay enrolled. The direct-load
extension changes12 property reads to equivalent `x`/`y` conditionals; it
still requires owning tests, default geometry and the combined shipped build.

A new predeclared three-round Latin-order diagnostic uses immutable fixture
snapshots, fresh Node24.19.0 workers, two consumed warmups and25 consumed
timed renders, with allocation profiling in separate workers. Per-worker
median times (baseline / factored-plus-contact-free / direct-load extension):
15 nodes248.18 /275.52 /207.23ms;19 nodes368.95 /334.16 /270.17ms. The middle
variant loses on15 nodes. In the third19-node round, even the direct-load
variant loses257.58ms versus254.93ms baseline; preserve it. Median allocated
bytes are99,687,400 /93,663,232 /89,776,616 on15 nodes and154,309,136 /
132,098,176 /121,954,456 on19. All18 timing rows and18 memory rows complete,
and each fixture retains one SVG/receipt fingerprint across every contender.
These two-case diagnostics have no independent A/A and compare experimental
Node bundles, not the canonical shipped-package27-input canary. They justify
further qualification, not a claim of beating ELK.

The adopted direct-load candidate passes355 owning tests /4,977 assertions
across native placement/cache, ELK cache, shared route contracts, selection,
certification, measured-backend errors and the new crisp drawing path. The
canonical default-geometry gate passes all319 records without a golden edit
(two tests,17.45s total; geometry comparison12.96s), and repository lint passes.
Run the complete build, both typechecks and real-browser request checks on
the frozen combined revision before publishing its next cost campaign.

Frozen891bcb7d now passes the complete Node/declaration/IIFE/catalog/lazy
build and every compressed browser budget, plus both typechecks and seven
real-browser checks /531 assertions. Architecture is572,901 Brotli against
main's573,000 limit. The Flowchart closure is711,547 gzip /576,472 Brotli
with ELK and282,545 /249,762 with the selected native solver; each has33
requests. Class and Requirement native closures need one more request than
their ELK counterparts (34 vs33 and29 vs28); do not call this a request-count
win. Browser execution confirms that strict native selection fetches no ELK,
and explicit ELK and actual fallback still load it. These download results
do not apply to the all-in-one synchronous bundle.

A separate raw-geometry observation rejects another proposed optimization:
all nine retained dense cyclic Flowchart fixtures produce three distinct raw
geometry results in their three final-candidate trials. Memoizing duplicate
raw results would add key/cache overhead without removing a trial on this
cohort. Keep that diagnostic; do not add speculative result deduplication.

On published73cb5e4f, all required CI39543898268 lanes pass. The generated
artifact12320503357 retains512 native completions and506 ELK completions,
with no additional native crossings, padded-label conflicts or opposing/
parallel shared spans in any of the five retained windows. All506 shared
successes have unverified paint on both backends. The native certificates
contain7,004 issues versus6,556 for ELK on that same shared population;
do not suppress that adverse uncertainty count or turn it into a claim of
known painted failures. The six reference rejections stay enrolled.

An unshipped invocation-scoped prepared-segment cache preserves10,000
direct score/rejection cases and134,511 pair counts, including diagonal,
degenerate and non-finite fallback cases. Its predeclared three-pair,
25-repeat diagnostics are mixed:15-node per-worker median time219.00→229.83ms
and19-node703.33→402.08ms. Separate median allocations are88,515,440→
89,086,616 bytes and121,632,840→121,691,576 bytes, respectively. Both
allocation medians are slightly worse. All12 timing and12 memory workers
complete with identical output fingerprints. With no independent A/A and no
allocation benefit, retain the prototype without adopting it. A sorted-cache
variant is only a proposal, not measured evidence.

A fresh allocation profile of the actual clean891bcb7d Node distribution
now points toward rank ordering: iterator steps under `reorder` account for
about2.44MB in one sampled consumed19-node call, with another2.12MB under its
sort comparator. These are sampled allocation locations, not qualified time
or memory comparisons. The next prototype preserves neighbor summation order,
uses indexed traversal, bounds insertion sorting to finite bands of at most16
vertices (at most120 data comparisons), and reuses typed numeric median
scratch. Large/non-finite bands and non-finite/negative-zero median inputs
retain the original comparator behavior. No search candidate or resource
ceiling changes.

The73cb5e4f cost artifact12321213053 is not a qualified improvement. Both
27-input comparisons exhaust the unchanged480,000ms overall budget.
Cache-off A/A completes healthy at1.0084910; the native comparison has zero
fully paired corpus results and no memory observations. Its first expired
worker is native11-node correctness-ASCII, given only1,133ms remaining
(1,145.8ms wall time). Normal-cache A/A completes but fails an individual
large-case reciprocal1.1 bound, despite its aggregate0.9722344. The native
normal comparison then expires in19-node correctness-SVG with425ms remaining
(434.1ms wall time), and has no matched memory observations. Its partial
official-corpus ratio0.9931414 is unqualified. Preserve the adverse control,
all missing cases and both incomplete campaigns; do not normalize, retry the
unchanged controls, shrink the population or increase deadlines.

The ordering-allocation prototype preserves all750 full native SVG/receipt/
error-name-message outcomes, including all15 capability declines. Its new
three-pair,25-repeat consumed-render diagnostic has per-worker median times
194.98→172.89ms on15 nodes and315.06→193.31ms on19. The second15-node pair
is adverse (183.19→183.64ms); retain it. Separate median allocated bytes are
88,281,776→75,899,288 and121,169,960→111,540,296. All12 timing and12 memory
workers complete, with one output fingerprint per fixture across both arms.
These fresh-process two-case diagnostics have no independent A/A, and do not
qualify the full canary. The adopted source passes145 owning tests /4,830
assertions across raw/native/cached placement, public selection and all six
family adapters. Node sorting scratch uses external ArrayBuffer storage;
V8 allocation, whole-process RSS and retained memory remain separate metrics.

Wall-time accounting explains why passing required CI is insufficient for
this cost target. In73cb5e4f's cache-off A/A alone,126 time workers take
411.74s and42 memory workers46.11s. Timed SVG calls account for210.03s,
renderer import23.31s, first SVG36.16s, and the other time-worker work142.24s.
That residual includes startup, correctness, ASCII, quality and shutdown;
it is not attributed to a specific cause without more instrumentation.
Normal A/A's corresponding totals are254.22s time and39.75s memory.
The shared480s comparison budget leaves very little cold native work. This
is an observed measurement constraint, not permission to weaken its protocol.

The adopted ordering change also passes the unchanged319-record default
geometry gate (two tests,28.26s total; comparison20.10s) and repository lint.
Freeze its complete build and verify real-browser loading before publishing
the next code revision; the prior code revision's cost failures stay recorded.

Frozenb25aa100 passes the complete Node/declaration/IIFE/catalog/lazy build,
both typechecks, all current browser budgets and seven real-browser checks /
531 assertions (20.63s). Flowchart closure costs711,545 gzip /576,508 Brotli
with ELK and282,722 /249,948 with native, each33 requests. Architecture is
572,952 Brotli against the inherited573,000 limit. No budget file changes.

A predeclared actual-package diagnostic then uses the unchanged canonical
Node worker on the frozen891bcb7d andb25aa100 distributions: two dense
development inputs, three rounds,25 repetitions, separate memory workers,
two ELK arms and the two native revisions, with a shared480s diagnostic cap
and60s per-worker cap. Of48 workers,47 complete; old-native19-node round2
expires during timing at60,045ms without a result. Keep that failure.
The15-node ELK A/A time ratios are0.846/1.405/0.776;19-node ratios are
1.284/1.175/1.510. This control is unhealthy; do not claim a speed winner or
retry it unchanged. Every completed time row preserves expected text and
deterministic output; the two native revisions have identical SVG and receipt
fingerprints on their completed rows.

Actual-package median pass allocations (ELK reference /old native /new native)
are49,443,944 /90,085,928 /77,267,776 bytes on15 nodes and100,187,800 /
120,036,232 /113,084,112 on19. Native still allocates more than ELK in both.
New-native peak RSS medians are147,030,016 and157,278,208 bytes versus ELK
158,900,224 and166,350,848; the old-native medians are lower than new-native
at138,936,320 and156,893,184. Preserve that RSS tradeoff. New-native retained
growth is425,096 /420,504 bytes versus ELK491,888 /356,424. Allocation, RSS
and retention do not tell one uniformly favorable story, and this incomplete
two-case experiment cannot qualify the27-input comparison.


### Bounded cross-hierarchy leaf corridors (@19)

The owned solver now lifts each cross-scope leaf edge to the immediate children
of its lowest common ancestor. Bottom-up placement retains local directions,
frame dimensions and label reservations. Only scopes hosting lifted edges use
compact private ranks. A bounded rectilinear visibility search then connects
actual leaf outlines to the quotient route. Obstacles include leaf bodies,
unrelated frames, related frame header bands, occupied labels and foreign
shafts. The raw shortener preserves these routes' boundary corridors. This is
standard visibility-routing prior art, not a new general compound algorithm.
ELK Layered supports a much broader compound domain and hierarchy-port model;
see its [algorithm reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
and [hierarchy edge merging](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-mergeHierarchyEdges.html).

Admission is conservative: at most64 leaves,16 groups,16 cross-scope edges,
128 total edges and2048 raw route points. Grid states count against the existing
32768 aggregate expansion bound; obstacle tests, visibility arcs, coordinate
sorts and heap operations debit the existing shared routing budgets. Exhaustion
or an obstructed corridor yields a typed decline. Cross-scope frame endpoints
remain unsupported. No solver ceiling, measurement deadline or payload budget
is raised. Strict native requests never execute ELK.

The complete238-input source/workload development comparison admits231 native
inputs versus223 before, with238 ELK successes. Five Flowchart and three Class
inputs are newly supported; all223 previously supported inputs have identical
SVGs and complete receipts in the prototype before the implementation ID bump.
No measured crossings, label conflicts or parallel/opposing overlaps increase
against ELK across shared successes. Class specialized overlap/label metrics
remain unavailable; absence is not a zero. Six promoted inputs pass paint
certification; two remain unverified, also unverified with ELK. An initial
candidate introduced one extra crossing on Flowchart example96; compact ranks
in lifted host scopes remove it. Both the failed candidate and full cohort
remain in the ignored diagnostic reports. This is development evidence, not a
fresh holdout or full aesthetic parity. Seven declines remain: cross-scope frame
endpoints, overlapping frame/node identities, a96-leaf workload outside the
local corridor domain, and four Architecture compounds.

The preceding84b20082 cost run (CI39548848015) completes both healthy ELK A/A
controls: aggregate ratios0.977798 cache-off and0.999070 normal. Both native
comparisons remain incomplete under the unchanged shared480s budgets. Cache-off
has no matched corpus or memory result; its first native100-card Requirement
cold SVG receives336ms and expires after343.74ms. Normal has seven paired
inputs and a partial0.989408 ratio, with no matched memory result; its first
failure is an ELK-reference11-node correctness-ASCII worker receiving1176ms
and expiring after1190.49ms. These are failed qualification runs, not speed wins.
All required CI checks pass on that revision. The new compound domain still
needs its own cost evidence; it cannot inherit the flat-domain measurements.


The October21 community review checks Mermaid[#8302](https://github.com/mermaid-js/mermaid/issues/8302)
(feedback into a group; closed as completed September28) and
[#7901](https://github.com/mermaid-js/mermaid/issues/7901) (long nested frame
titles; still open). They motivate separate endpoint/arrow preservation and
measured-header containment checks, not a claim that our pinned ELK has either
reported bug. Compact quotient routing can itself create a cycle even when the
leaf graph is acyclic; no global optimality is claimed. A future sparse visibility
router should be evaluated against Marriott, Stuckey and Wybrow's
[Seeing around corners (2014)](https://research.monash.edu/en/publications/seeing-around-corners-fast-orthogonal-connector-routing/)
before adding another search layer. The current grid is deliberately bounded
and conservative; it is not the sparse algorithm from that paper.


The canonical Node package repeats the complete238-input comparison:231 native,
238 ELK, with no lost successes or additional measured crossing/label/shared-shaft
conflicts. All223 previous native SVGs remain identical; complete receipts differ
only by the declared implementation revision. The unchanged319-record default
geometry gate passes (17.96s total,15.52s comparison). Both typechecks, lint,
owning placement/selection/cache/family tests and the complete Node/declaration/
IIFE/catalog/lazy build pass. Browser budgets pass unchanged: Flowchart closure
711,542 gzip /576,399 Brotli with ELK versus285,656 /252,360 native,33 requests
each. The new native routing code adds2,934 gzip bytes relative to the prior
native build; Architecture's default closure is572,811 Brotli against573,000.
Class and Requirement native closures still require one extra request.

A broad local browser run is retained as incomplete/failed: Firefox exceeds its
180s launch limit with read-only sandbox/cache errors, and WebKit lacks required
shared libraries. The runner is stopped after those launch failures; subsequent
teardown-induced failures do not diagnose layout behavior. The targeted Chromium
emitted-import/cross-scope/fallback contracts are checked separately. Full
cross-engine validation remains a CI obligation, not an inferred local pass.

The targeted Chromium run passes8 tests /606 assertions (24.85s), including
concurrent cross-scope Flowchart, State and Class rendering with one selected
solver import, native-only cross-scope loading and actual frame-endpoint fallback.


The predeclared three-example cross-scope diagnostic completes54/54 canonical
workers on frozenab5ed275, with25 fully consumed timing repetitions per worker
and separate warmup/input/pass/retention memory workers. All content/determinism
checks pass. Retain all three rounds.
A/A round-time ratios are0.694/1.036/1.341 for Flowchart (geomean0.988),
0.696/0.977/0.492 for Class (0.694) and0.501/0.927/1.111 for State (0.802).
The aggregate control ratio is0.819; Class and State fail the predeclared
[1/1.1,1.1] per-input bound. This is not a qualified timing win, and it is not
retried unchanged. ELK-reference/native median pass allocations are7,714,640 /
5,832,280 bytes for Flowchart,7,007,352 /5,582,784 Class and7,781,240 /
5,296,144 State. Peak RSS is125,550,592 /100,925,440;126,910,464 /
102,633,472;126,279,680 /101,052,416 respectively. Retained growth is
987,080 /588,856;704,824 /324,632;992,696 /591,216. These are observations on
three development inputs only. Typed-array backing stores are not included in
V8 heap allocation; RSS remains separate. The27-input qualification stays open.


Currentab5ed275 CI39554337334 passes every required lane, including all unit
shards, browser/cross-engine contracts, consumers, semantic conformance, payload
and quality. Generated artifact12325300634 retains512 native /506 ELK successes,
no extra measured crossings/labels/shared spans, all506 shared paint certificates
unverified, and7004 native versus6556 ELK issues. Cost evidence is still pending.
The local Firefox/WebKit failures remain recorded despite the successful CI run.

A request-scoped crossing scratch prototype is not adopted. Its50006 direct
metric comparisons match, including involved filters, reversed/shrinking/empty
inputs, diagonals and numeric edge cases. All12 memory and12 timing workers
complete with identical native SVG/receipt fingerprints. Median allocated heap
bytes fall78,255,664→73,657,880 on15 nodes and112,210,064→109,617,160 on19.
However, median profiler-free worker medians move225.86→245.72ms on15 nodes
and312.05→300.67ms on19;19-node peak RSS moves135420→155180KiB. These
uncontrolled custom-bundle diagnostics are not qualification, and their adverse
time/RSS signals are retained rather than shipping an allocation-only result.


A separate private-vertex record reuse prototype is also not adopted. All12
memory and12 timing workers complete with identical SVG/receipt fingerprints.
On15 nodes median allocations increase75,962,744→76,813,032 bytes; on19 they
fall112,609,104→109,841,032. Median profiler-free worker medians are237.52→
210.12ms and440.80→243.33ms, but there is no independent A/A, one15-node
round gets slower, and the first before-memory worker's284632KiB RSS is an
adverse outlier retained in the report. These custom-bundle diagnostics do not
justify introducing mutable request scratch into the production core.


The separated-interior-contact scoring prototype is not adopted either. All50009
score/rejection comparisons match. Its12 memory and12 timing workers complete,
with median allocations77,369,136→76,650,776 on15 nodes and113,115,144→
113,602,112 on19. Median profiler-free worker medians move294.02→307.91ms
and455.16→414.33ms; the after15-node memory run includes a291880KiB RSS
outlier, retained. The guarded shortcut does not establish a consistent cost
benefit and never changes the published scorer.

The completeab5ed275 cost artifact12324944916 is unqualified in both cache
regimes. Both full ELK A/A controls are healthy (1.011737 cache-off;1.011207
normal). Cache-off control timing workers use427.41s and memory49.01s of the
shared480s budget. The next ELK-reference corpus worker receives3340ms and
expires after3373.07ms during timing; native has no paired corpus or memory
result. Normal control timing uses263.83s and memory41.31s. Its native100-card
Requirement timing worker in round3 receives1899ms and expires after1929.15ms.
The normal partial seven-input0.995276 ratio is unqualified, with no matched
memory. No deadline or population changes rescue these runs. Required CI is
fully green; passing required checks does not complete the owner's cost goal.


### Measured headers and large-scope direct corridors (@20)

Rebase onto mainb1a50dfa includes#454's precise cleanup warnings and bounded
startup-test child. The next native revision carries the adapter's actual measured
header height separately from top content padding. Flowchart/State use the
already measured group header; Class uses its namespace header measurement.
The private contract validates a finite header strip inside top padding. Missing
measurement retains the conservative padding strip. No header height is inferred
from rendered output or fixture identity.

The visibility-grid domain remains at most64 leaves. Larger scopes use at most64
short corridor/prefix proposals per cross-edge, with a separate pair allowance of
min(16384, remaining shared pairs/8). Every obstacle test also debits the existing
shared pair budget; tested segments and self-contact checks debit shared arc/pair
budgets. Centers on each side precede quarter ports, blocked endpoint rays are
rejected early, and L/Z/perimeter proposals must clear all bodies, headers,
unrelated frames, labels and foreign shafts within the host content bounds.
If no complete path is proved, the large input declines; no large dense grid is
allocated. The global4096-subject/32768-expansion and routing-work ceilings stay
unchanged, as do16 groups,16 cross-edges,128 edges and2048 initial route points.
This replaces the preemptive64-leaf rejection with a bounded additional routing
algorithm; it does not raise the grid or work ceilings to admit the workload.

The initial direct probe still declines the96-node workload. A second candidate
reorders port proposals and adds perimeter corridors, but the conservative full
top-padding obstacle still seals useful routes. Passing the actual header strip
unblocks the content padding without crossing painted headers. The third
prototype completes the full238-input development cohort:232 native,238 ELK,
six native declines, no lost cases or added measured crossings/label/shared-span
conflicts. All231 prior native SVGs and complete receipts remain identical before
the implementation revision bump. The96-node case has zero measured crossings,
label conflicts and parallel/opposing overlaps, with passing paint certification
for both engines. The earlier failed probes and full cohort stay recorded.

Production owning checks pass121 tests /4004 assertions before the additional
raw reserve test; that test separately passes and proves a blocked probe retains
positive shared pair reserve with a typed decline. The public large-workload
check preserves all96 nodes,12 scopes,95 authored endpoints, paint certification,
quality and native ASCII companion execution. Larger-domain qualification still
needs more than one successful development workload, so16 additional80-node
sources across global directions/local overrides/labels are declared before
execution. All outcomes will remain enrolled, including native declines.


### October21 rebase and additional large-compound audit

The complete frozen canonical `a84fc42f` package, on main `b1a50dfa`, finishes
all238 development inputs:232 native successes,238 ELK successes and six native
declines. All231 previously successful native SVGs and complete receipts are
identical after allowing only the implementation revision19→20. No added
measured crossings, label conflicts or parallel/opposing overlaps occur.

The16 prospectively declared80-node development cases also all finish with both
engines. They cover TB/BT/LR/RL global direction crossed with inherited, opposed,
alternating local directions and labelled internal/cross-scope links. Native
paint certification passes16/16; ELK passes14/16 and remains unverified on the
BT-alternating and RL-alternating inputs. None has an added measured native
crossing, label conflict or parallel/opposing overlap. This is a development
audit, not a fresh holdout or a timing/memory qualification. The frozen package,
all inputs and all outcomes remain recorded before the next rebase.

The branch is subsequently rebased onto main `297eaaf2` (including `dfe5a674`'s
layout-pass split, layout hints and flattened Class namespace header repair).
Those upstream improvements must not be credited as native engine savings.
Default geometry and backend integration must be rechecked at that combined
revision. Native Flowchart/State must explicitly decline active layout hints
until it implements them, so a requested ELK fallback can preserve the author's
preferences. Empty hint collections do not require a fallback.

The additional community review checks Mermaid
[#8326](https://github.com/mermaid-js/mermaid/issues/8326) (repeated subgraph IDs,
closed via#8337) and [#7659](https://github.com/mermaid-js/mermaid/issues/7659)
(compound merge-edge adaptation, closed via#7712). Both concern the adapter's
interpretation of authored identities or solver output; neither establishes a
current ELK algorithm defect or proves our native engine fixes those inputs.
They reinforce retaining endpoint/ownership checks alongside visual metrics.

The hint regressions first fail seven cases without the native guard (15 pass,
7 fail), then pass within132 engine/selection/hint tests and3707 assertions.
The34 specialized adapter tests pass with1310 assertions. Both typechecks pass
before the four-line hint guard; the final combined checks are recorded below.
Default geometry first times out at74.21s while competing with the compiler;
the retained serial rerun passes the unchanged gate in26.98s (32.73s whole
file). No baseline or timeout is changed to rescue that adverse run.


The next allocation probe changes only private degree-one adjacency: initialize
its single incoming/outgoing entry at construction instead of pushing into two
empty arrays. Vertex numbering, neighbor order, ranks and all work ceilings
stay fixed. The declared before/after diagnostic retains both dense15/19-node
inputs, three rounds,25 timing repetitions, separate one-pass GC allocation
measurements,60s worker limits and480s total. Its24 workers have no ELK A/A
control, so even favorable timing cannot qualify a speed win. It must preserve
all750 existing development SVG/receipt/error outcomes before consideration.


The combined rebased canonical package comparison completes238/238:232 native
and238 ELK successes, six retained native declines, no added measured crossing,
label or shared-span conflicts and no metric-collection errors.231 native SVGs
and complete receipts remain byte-identical to frozen `a84fc42f`. The remaining
Class example21 changes because main's flattened namespace adaptation preserves
full authored paths and omits an empty wrapper. Its namespace-header repair is
retained for both producers; this is an upstream semantic/geometry change,
not a native optimization. The existing four-direction fanout test is extended
to both backends with full-path assertions.

The final pre-payload-fix typechecks pass. Emitted Chromium checks pass8 tests /
648 assertions, including the96-node native route with zero ELK fetches and
actual fallback imports. MCP declaration/discovery integration passes3 focused
tests /93 assertions. The canonical Node/DTS/IIFE/catalog/lazy build passes.

The rebased payload gate fails honestly: Architecture's default ELK structural
closure is573764 Brotli bytes against main's573500 ceiling (264 bytes over).
No budget is raised. Browser builds can omit the `LAYOUT_PIPELINE` description
strings that are used only by Node inspection/documentation, retaining pass
IDs, dependencies, mutation declarations, metric budgets, enabled/run functions,
freezing and proposal contracts unchanged. Node manifests keep the prose.
This shared browser packaging reduction applies to both engines and cannot be
claimed as a native algorithm saving. Its emitted parity and budgets still
require verification after rebuilding.


The private adjacency diagnostic completes24/24 workers without failures and
with identical before/after SVG/receipt fingerprints on both dense examples.
Median sampled pass allocation changes77,447,888→75,355,600 bytes on15 nodes and
112,327,440→111,553,080 on19. Whole-worker RSS changes184956→136468 KiB on15 but
137980→151440 KiB on19. Medians of the three25-repeat timing medians change
375.78→509.48ms on15 and599.28→419.84ms on19. There is no A/A control and neither
source bundles nor these two development inputs qualify shipped performance.
The15-node timing and19-node RSS observations are adverse; this candidate is
not adopted. Its bounds and whole diagnostic stay intact. The full750-output
comparison is not run for this rejected candidate; fingerprint identity here
covers only the two measured inputs.


The final combined metadata projection passes both typechecks, lint and the
canonical IIFE/lazy browser builds (including declarations). Emitted Chromium
checks pass32 tests /763 assertions: all23 IIFE families match source bytes,
the lazy entry has strict-mode family parity, both selected solvers load once,
and the large native workload fetches no ELK. The expanded Class flattening
check passes both backends in all four directions (2 tests /474 assertions).

All current payload budgets pass unchanged. Architecture's default closure
falls573764→572815 Brotli bytes after omitting browser pipeline prose, leaving
685 bytes below main's573500 ceiling. Flowchart's matched structural closures
are711263 gzip /576405 Brotli /34 requests with ELK, and285963 /252906 /34 with
native. Class/Requirement native still need one additional request. Main's
layout-pass split changes the module graph; no cross-base request/byte delta is
credited to the native solver. Node pipeline descriptions remain available.

A separate next probe lifts the shared crossing metric's endpoint and parameter
tolerance closures to module helpers, preserving arithmetic and contact rules.
Its50006 direct comparisons across10000 reproducible development route sets,
reversals, involvement filters, shrinking/empty routes and numeric edge cases
match exactly with unchanged inputs. The declared cost diagnostic uses both
retained dense inputs, three counterbalanced native-before/native-before-A/A/
native-after arms,25 timing repetitions, separate memory,36 workers,60s per
worker and480s total. Its symmetric A/A limit is reciprocal1.1 per input and
aggregate; it is never a normalization divisor. No ELK or full-population cost
claim follows from this source-bundle probe. Production adoption requires
further output and shipped-package evidence.


At published `f008a304`, full generated CI artifact12330180304 retains512 sources:
512 native and506 ELK successes. No additional proper crossings, padded-label
conflicts or parallel/opposing spans occur on the506 shared successes. All506
shared paint certificates remain unverified:7004 native issues versus6556 ELK
issues. The advisory failure is retained and does not establish complete paint
parity. Full browser, payload, quality, consumer and semantic CI lanes pass.
Unit shard1 fails one hosted MCP description ceiling:15040 bytes against the
unchanged strict15000 bound. Removing two redundant prose sentences, while
retaining the complete declarations and security constraints, yields14987.
All66 hosted MCP tests /298 assertions and three focused discovery/declaration
checks pass; no limit or type field is removed. The fix awaits its own CI head.

The closure-free crossing diagnostic completes36/36 workers with identical
before/A/A/after SVG/receipt fingerprints.15-node median sampled allocation is
76,295,480→75,927,408 bytes,19-node112,579,936→111,206,424. Median whole-worker RSS
is130716→219408 KiB on15 and144012→142864 on19. Medians of the three25-repeat
time medians are330.38→323.93ms and407.25→487.29ms. Both native-before A/A timing
controls are unhealthy: per-input round-ratio geomeans0.85484 and0.88815,
aggregate0.87134. No speed result qualifies, no unchanged retry is made, and
the15-node RSS and19-node timing are adverse. The probe is not adopted and its
full750-output run is unnecessary after rejection. Direct metric equivalence
alone did not prove a useful engine optimization.

The next private prototype checks a larger source of repeated work: native
small-graph refinement certifies the chosen geometry, then the outer native
entry certifies that same object again without an intervening geometry edit.
A request-local returned certificate may avoid only that second assessment.
Public attached receipts are never accepted as proof; cached order choices,
uncertified/large/compound candidates and every new alternative still execute
strict mandatory certification. The final retained metadata must be identical.
The declared750-input comparison retains238 source/workload inputs and all512
existing development generated sources, including errors. It executes Node on
fixed JSON inputs; an initial scanner import fails before any row because the
Bun fixture extractor uses `import.meta.dir`, so extraction is moved to Bun
before the Node comparison. Neither data nor solver is changed to rescue an
outcome. A separate36-worker before/A/A/after diagnostic retains the preceding
three-round/25-repeat/60s/480s protocol, with no ELK or whole-workload win claim.


The full `f008a304` cost artifact12330278064 completes the normal-cache campaign
with a healthy symmetric ELK A/A corpus ratio0.9894733. Both arms complete all27
inputs, three rounds and separate memory (126 timing +42 memory workers). The
native official-corpus paired ratio is0.9881609; sampled corpus allocation is
28,925,944 versus29,015,520 bytes (0.996913), peak RSS147,554,304 versus185,532,416
(0.795302), retention362320 versus360072 (1.006243). Corpus p50/p95 are4.8486/
8.6608ms native versus4.8231/8.5441ms ELK. These near-tie timing/allocation results,
with slightly higher retention, do not prove the owner's full cost objective;
RSS remains lower. Controls are not divisors. All20 large/agent cases remain
included; the seven-input official-corpus ratio is not an all27-input aggregate.

Cache-off A/A is healthy0.9814889, taking305.997s timing and34.245s memory.
Native comparison still exhausts the same shared480s budget: the first failure
is native13-node cyclic timing in round2,2865ms allowed and2888.30ms observed,
with no result.58 timing workers complete, zero matched official corpus inputs
and no paired memory; no cache-off speed/memory claim qualifies. The complete
normal and incomplete off campaigns both remain recorded. No ceilings,
populations, repetitions or deadlines are changed, and the adverse controls
from earlier heads are not replaced by this result.


The request-local certificate prototype matches all750 SVG/complete-receipt/error
outcomes (744 native successes, six identical declines) and passes126 existing
certification/selection/cache tests via the private implementation override.
The declared cost run attempts36 workers:33 complete, then the native-before
A/A19-node timing worker in round3 exhausts the remaining18.25s and the final
two workers retain campaign-deadline failures.15-node timing A/A is unhealthy
(three paired round ratios1.38005/1.25788/1.01597, geomean1.20820);19-node A/A has
only two pairs and cannot qualify. Median pass allocation is76,668,224→75,979,184
bytes on15 but111,723,472→113,055,576 on19. RSS is138624→144984 KiB and143516→138744
KiB. There is no consistent allocation gain and no qualified time result; the
prototype is not adopted despite exact output equivalence. All outcomes remain.

### Opt-in shared-reference measurement protocol

The default legacy pair protocol remains unchanged. `--layout-reference shared`
is a separate, explicitly labelled experiment. It schedules one fresh ELK
reference, a separate same-artifact ELK A/A worker and native worker per group
and round, rotating arm positions. The same reference observation serves the
A/A and native comparisons; it is never divided out of a ratio. All27 retained
inputs, three rounds,25 repetitions, worker semantics, both cache regimes and
the480000ms per-regime deadline remain fixed. This eliminates a duplicate ELK
reference process, not a control observation, and completion cannot be credited
as an engine speedup or used to erase the earlier incomplete protocol results.

Memory populations are paired independently for each comparison. Strict native
declines or timing failures cannot shrink A/A or fallback populations. A memory
result can be reused only for the same arm and identical ordered input IDs;
different matched subsets get their own fresh worker. Failed observations are
reused as failures rather than retried. Candidate-only successful corpus memory
remains separately measured for the absolute retention gate. All samples and
reuse records are retained in the shared journal, with per-comparison reports
pointing to it. The protocol is recorded in configuration and the journal.

Owning tests exercise partial native support, a native timing failure, and a
failed shared-reference memory observation. They verify full control/fallback
populations, independent native subsets and no retry of a failed memory worker.
The complete benchmark owner file passes59 tests /228 assertions before the
additional journal-header and explanatory-text-only edits. Full type/lint and
the predeclared actual-package experiment follow; no performance claim exists
for the new protocol yet. The main CI legacy canary is not changed.


Final shared-reference typechecks and lint pass. The prospective full trial uses
the exact27 case IDs from `f008a304`'s CI definition and that head's immutable
canonical Node package. The harness is frozen at its reviewed commit too.
Each cache regime keeps3 rounds,25 repetitions and480000ms. With all inputs
successful, the three-arm design produces189 timing and63 memory workers;
any failures, subset-specific memory workers or missing results remain recorded.
Both off and normal run once, without an unchanged retry. Trial completion is
not an engine speedup and its figures must remain distinguished from legacy
four-arm scheduling. The timing controls, output checks, strict declines and
memory population rules remain fully enforced.

### Worker rebase and subsequent experiments (October 21)

The next rebase integrates main `ee24030c` (#455), retaining its standalone
worker entry and applying the browser runtime projection to both hosted worker
and facade builds. The owned engine remains `agentic-layered@20`. New owning
preview cases cover ELK, native and explicit fallback through the shared
positioned artifact: each positions once and retains the direct renderer's
complete receipt and verification. The worker queue also preserves the queued
backend choice. These preview, layout-hint and hosted-MCP files pass102 tests /
514 assertions; the canonical package build and both typechecks pass.

All238 retained source/workload inputs complete the Node comparison against
the frozen `f008a304` package:232 native successes,238 ELK successes, six
unchanged native declines. Every native SVG and complete receipt is identical
across the rebase. All232 measured crossing comparisons and148 available
label/shared-span comparisons have no additional native conflicts; these are
development comparisons, not a new independent holdout.

The local default-geometry test exceeds its unchanged30s comparison deadline
(37.480s); that failed gate remains recorded. A pristine-main control passes
its303 records in19.187s. A separate diagnostic finds319/319 exact geometry
matches, with the303 shared records taking19.384s and the16 added fixtures
7.191s. This confirms geometry equivalence without converting the failed timed
gate into a pass or changing its deadline/baseline.

The prospectively declared shared-reference trial is now complete as an
attempt, and fails qualification in both cache regimes. It uses controller
`f28d70cd`, the frozen canonical `f008a304` package and Node26.3.0 (per its
recorded environment). Cache-off first fails the ELK reference13-node cyclic
timing worker in round1 (10722ms allowed,10775.38ms observed); normal first
fails the native13-node cyclic worker in round1 (11266ms,11426.88ms). Neither
finishes round1, neither comparison has a matched official-corpus population,
and neither regime has paired memory. A/A is also incomplete. All27 input IDs,
missing observations and journals remain retained. There is no qualified speed
or memory result and no unchanged retry. Legacy CI scheduling remains the
default; sharing a reference has not solved local campaign completion.

A further unshipped prototype prepares immutable route segments only within
the measured-shortening/loop-compaction phase, specializing two-route and
single-involved-route queries. It preserves numerical crossing rules and all
work debits; general or numerically unsafe queries use the original counter.
It matches90006 differential counter queries including route/point reversal,
shrinking populations, involved filters, invisible routes and numeric edge
cases. Full750-outcome and cost qualification are still required. No engine
improvement is claimed from these direct counter checks.

The rebased standalone editor currently exposes a packaging regression:
4,107,828 raw /1,274,431 gzip bytes, versus unchanged limits4,100,000 /1,260,000.
Pristine main is4,044,706 /1,250,651. The family lazy-transfer check passes with
unchanged budgets, but that does not excuse the standalone failure. A full
esbuild compiler substitution and an unminified-Bun/esbuild two-stage prototype
do not close the complete-HTML budget and are discarded. No schema prose,
validation, rendering feature or budget is removed to make this pass. The
worker browser check passes with the repository runner's600000ms timeout
(1 test /16 assertions), as do32 emitted IIFE/lazy tests /763 assertions;
an initial direct invocation used Bun's5s default and is retained as a failed
noncanonical test attempt.

The standalone packaging fix adds pinned `@swc/core@1.15.8` as a development
dependency and minifies only the inline module after Bun bundles it. It keeps
both solvers, full editor schema documentation, validation, legal comments,
inline-script escaping and function arity. Hosted chunk generation and the
published Node/IIFE/lazy build paths are unchanged. Compression defaults are
disabled: only declaration joining, constant evaluation and unused local
elimination accompany identifier mangling. No inlining or loop rewriting is
enabled. Canonical complete HTML is4,091,237 raw /1,226,663 gzip bytes, within
both original limits. This common packaging saving is not a native algorithm
saving. The final size, all-family worker/backend and pointer/momentum tests
pass3 tests /28 assertions. Repository types passed after adding the minifier;
the final option names also exist in its installed declarations. Fresh CI must
check the combined revision.

The initial full-compression SWC prototype makes smaller HTML (3,977,305 /
1,210,269) and passes all-family SVG parity, but is rejected: the existing
pointer/momentum test hits its unchanged60s deadline both in the full editor
suite and alone. The full run has9 passes and11 failures, ten following Bun's
browser shutdown. Pristine main passes the pointer case in37.04s, the same
branch's original Bun build in31.56s, and that exact Bun HTML served from the
main workspace in24.50s. The limited candidate passes in30.29s. These functional
controls isolate the problem without claiming a qualified browser speed gain.
A Terser build prototype is cancelled without a result after several minutes;
it is not adopted. None of these attempts is erased by the final checks.

Published `192b1582` CI passes all unit shards, quality, payload, consumers and
semantic lanes; its browser lane fails only the raw standalone size check
(4,107,828), which the packaging fix addresses. The original local30s geometry
timeout remains recorded alongside the independent exact diagnostic. Generated
paint remains an advisory failure.
The emitted standalone worker now checks byte-exact strict-mode SVG parity
against the source renderer for every registered built-in example, alongside
backend selection, fallback, queueing, worker recovery, native terminal
receipts and real Canvas PNG export. The existing size test is unchanged.

The immutable-phase crossing prototype completes750/750 development outcomes:
744 native renders and six identical declines, with exact SVGs, complete
receipts and errors.86 existing crossing/native/self-loop tests pass3447
assertions through the private implementation override. Its prospectively
declared diagnostic first runs18 separate memory workers on the two retained
dense inputs (three rotating before/A/A/after rounds). Both inputs must reduce
median sampled pass allocation by at least5%, keep median RSS within1.05 and
have allocation A/A within reciprocal1.10 before18 timing workers may run.
The same480s campaign deadline,60s worker deadlines and25 timing repetitions
remain. Any failed gate rejects the prototype without an unchanged retry.
This is not a full ELK cost comparison; retained heap and the full27-input
canary still need qualification if an optimization is adopted.

The wider community reinforces the separate offline packaging constraint.
[Mermaid #6294](https://github.com/mermaid-js/mermaid/issues/6294) remains open
when checked October21 and asks for a plain bundled ELK distribution for
desktop/standalone editors. Mermaid's pinned
[12.0.0 change record](https://github.com/mermaid-js/mermaid/blob/6d8921f94f9a12b76586eddcf45a566080d4767e/packages/mermaid/CHANGELOG.md#1200)
documents the move back to bundled default ELK, while retaining the separate
layout package for Tiny. Those product choices do not prove any solver
obsolete. For this project, a smaller on-demand native family closure does
not excuse an oversized self-contained editor or justify requiring a CDN.

The completed `192b1582` CI cost artifact
[12338283814](https://github.com/adewale/agentic-mermaid/actions/runs/39582781085/artifacts/12338283814)
retains all27 inputs,3 rounds,25 repetitions and480s per cache regime. Off A/A
is healthy1.0400606, with126 timing workers taking407.242s and42 memory workers
45.835s. The native comparison completes eight timing workers, zero matched
official-corpus inputs and no paired memory. Its first failure is the ELK
reference10-node cyclic timing worker in round1 (3097ms allowed,3121.85ms
observed). This is not a native solver failure or a qualified speed result.

Normal A/A completes126 timing +42 memory workers (248.345s +38.624s), with
official-corpus ratio0.9800823, but fails the per-case reciprocal1.10 control
on ER compound domains. Native comparison completes102 timing workers and
has a partial seven-input corpus ratio0.9979953; no paired memory completes.
Its first failure is the ELK reference18-cut cyclic worker in round3, during
SVG correctness (673ms allowed,684.20ms observed). Both incomplete measurement
and unhealthy normal A/A prevent a time/memory claim. The latest workflow
job's success status is artifact collection, not proof of qualification.
The prior complete normal-cache result at `f008a304` remains recorded; it is
not combined with these partial observations or divided by a control ratio.


### October 21 practical-compatibility integration and rejected allocation trials

The branch was rebased onto main `1133266f` (practical Mermaid compatibility).
Targeted coverage now exercises the new ellipse syntax with both backends and
Architecture literal icon text through native SVG and parsed-source terminal
rendering. The latter preserves both primary and graphical companion backend
attribution. The 238-input production audit retains 232 native renders and six
identical declines; all 232 native SVGs and complete receipts match the frozen
pre-rebase reference. New syntax is covered by the targeted tests, rather than
being presumed covered by that older corpus.

Core/repository types, canonical build, lazy payload budgets, and 102 preview,
hint and hosted tests pass. An independent diagnostic matches all 319 legacy
geometry records (303 shared plus 16 added). This uses the baseline encoder,
including its integer-pixel Flow/State coordinates, and is not a fresh
full-precision SVG baseline. The unchanged local 30-second default-geometry
gate fails at 46.869 seconds; the diagnostic does not turn that failure into a
pass. No baseline, timeout or budget is relaxed.

The standalone editor retains the limited SWC settings and additionally removes
comments and tag indentation from static partials before catalog/runtime data
insertion, preserving raw-text and preformatted elements. Complete HTML is
4,095,126 raw /1,228,096 gzip bytes, below the original 4,100,000 /1,260,000
limits. The emitted worker and size checks pass (2 tests /19 assertions).
The pointer test times out when run alongside heavy diagnostics, then passes
serially in 28.239 seconds under its unchanged 60-second limit; the competing
run remains a failure. These are integration checks, not solver speed claims.

Three allocation prototypes are rejected. Each preserves full 750-outcome
SVG/receipt/error behavior (744 renders, six declines), and each completes all
18 prospectively declared memory workers. The gate requires at least a 5%
allocation reduction on BOTH retained dense inputs before timing is allowed:

| Private prototype | 15-node allocation ratio | 19-node allocation ratio | Outcome |
| --- | ---: | ---: | --- |
| Immutable phase segment preparation | 0.977226 | 0.966711 | Reject; no timing stage |
| Identical per-edge proposal score memo | 0.981721 | 0.960381 | Reject; no timing stage |
| Packed numeric crossing sweep | 1.003246 | 0.986981 | Reject; no timing stage |

The packed prototype also matches 90,014 direct crossing queries, including
sparse, capped and numerical edge cases, and passes 104 owner tests /3,774
assertions on the practical-compatibility rebase. Its exactness does not excuse
its allocation result. None of these implementations is shipped; engine ID
remains `agentic-layered@20`. The fresh canonical Node allocation profile shows
substantial work outside crossing counting, including repeated layered-core
and chain-order allocations, which guides subsequent experiments.

Published `1516ebbd` CI passes every required lane, including the full browser
suite and unchanged payload caps. Generated paint remains advisory failure.
Its cost artifact [12340329214](https://github.com/adewale/agentic-mermaid/actions/runs/39587214812/artifacts/12340329214)
retains all 27 inputs, three rounds, 25 repetitions and the shared 480-second
per-cache-regime deadline. Off A/A completes 126 timing and 42 memory workers
and is healthy (1.010344), but the native comparison completes only 20 timing
workers, zero paired official-corpus inputs and no paired memory. Its first
failure is an ELK-reference 15-chain timing deadline in round one (2617 ms
allowed, 2637.636 ms observed).

Normal A/A also completes, with corpus ratio 1.004367, but its cyclic-labelled
15-chain per-case control is unhealthy. The native comparison completes 124
timing workers and a partial seven-input corpus ratio of 0.977620, with no
paired memory. Its first failure is ELK-reference edit-flowchart ASCII
correctness in round three (670 ms allowed, 680.938 ms observed). Neither cache
regime qualifies a time or memory win. Workflow job success means evidence
collection, not qualification; partial ratios are not normalized by A/A or
combined with earlier complete results. The overall replacement goal remains
open, and ELK remains the default and supported fallback.


The subsequent rebase includes main `35902e75` (shared family text rows and
spacing, plus executable Getting Started documentation). Main now owns the
shared `config-spacing.ts` helper, so the branch's equivalent
`diagram-spacing.ts` extraction commit is dropped rather than duplicating it.
All 92 affected family/shape/backend tests pass (6,275 assertions). Main's
payload budget changes remain inherited upstream changes; the branch budget
file still matches main exactly. Fresh combined CI is required for this base.


The combined `32cbf8ce` rebase passes canonical Node/declaration/IIFE/lazy builds,
core/repository types, changed-file lint and every required
[CI lane](https://github.com/adewale/agentic-mermaid/actions/runs/39603529676),
including all three unit shards, both browser lanes, payload, package consumers,
Node 22, quickstarts, red/green and semantic conformance. This includes the
unchanged default-geometry gate in CI; the recorded local timeout remains a
failure. The fresh generated
[paired artifact](https://github.com/adewale/agentic-mermaid/actions/runs/39603529676/artifacts/12347991099)
retains 512 native /506 ELK successes across 512 enrolled sources. On the 506
shared successes there are no additional proper crossings, label conflicts or
opposing/parallel spans. All 506 shared paint certificates remain unverified,
with 7,004 native issues versus 6,556 ELK issues. No broader parity conclusion
follows. The PR's review images/reports are now pinned to this actual rebased
artifact, with both backend selections identified at the same immutable SHA.
The generic visual linter still objects to a downloadable report without an
embedded image and to a same-revision solver comparison rather than distinct
merge-base/head images; those mechanical failures remain recorded, rather than
mislabeling provenance to satisfy the heuristic.


The deferred private-chain row-copy prototype is also rejected. It delays
filtered row construction until the exact insertion DP accepts an improvement,
retaining dimensions, tie-breaking and work debits. All 750 development outcomes
match (744 native renders, six identical declines), including complete SVGs,
receipts and errors; 58 owner tests pass 4,724 assertions. All 18 declared memory
workers finish, with healthy allocation A/A ratios 0.994853 /0.975732. Candidate
allocation ratios are 1.000717 /0.964109 on the retained 15/19-node dense inputs,
and RSS ratios 1.010597 /1.023688. The unchanged 5%-on-both gate fails, so timing
is skipped without a retry. Exactness and a 3.6% reduction on one input do not
qualify this implementation for adoption. Engine remains `agentic-layered@20`.


A separate scalar private-channel adjacency prototype is rejected at its
prospectively declared six-worker screen. Real vertices retain ordered arrays;
private channel vertices store scalar predecessor/successor identities, with
matching traversals and debits. The 58 existing owner tests pass 4,724
assertions, and all six screening SVG/receipt fingerprints match. With healthy
allocation A/A 0.983197 /0.999032, candidate allocation ratios are
1.039174 /1.009618 and RSS ratios 1.103030 /1.045299 on the 15/19-node inputs.
Thus removing the source-level arrays does not reduce measured memory in this
implementation. The screen fails; no 750-outcome or formal timing campaign is
attempted, as declared, and no production representation changes. This is a
single-round rejection screen, not a qualified general performance comparison.


The complete `32cbf8ce` CI
[cost artifact](https://github.com/adewale/agentic-mermaid/actions/runs/39603529676/artifacts/12347588617)
also fails qualification, retaining all 27 inputs, three rounds, 25 repetitions
and 480 seconds per cache regime. In cache-off, ELK A/A completes 126 timing
workers (444.744 seconds) but only 24 memory workers (34.919 seconds). Its corpus
time ratio 1.013857 is within limits, but the incomplete control is not healthy.
The first failure is ELK-reference compound-Class memory import with only 132 ms
remaining (140.553 ms wall). No native-comparison timing or memory worker runs;
there are zero paired corpus inputs. The whole shared budget is already spent.

Normal-cache A/A completes 126 timing and 42 memory workers (276.620 and
41.724 seconds), with corpus ratio 1.001899, but the aligned Architecture case
fails the reciprocal 1.10 per-case control. The native comparison completes 78
timing workers, zero complete paired corpus inputs and no paired memory. Its
first failure is native aligned-Architecture timing in round two, during import
(267 ms allowed, 275.266 ms wall). These are budget-limited incomplete campaigns,
not evidence of a solver exception or a new time/memory win. Metadata records
Node 26.3.0 in this CI controller; separate local prototype screens use Node
24.19.0 and are not pooled with it. The earlier complete normal-cache result
remains historical evidence, without substitution, retries or normalization.
