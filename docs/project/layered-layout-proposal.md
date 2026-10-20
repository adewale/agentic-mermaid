# Staged replacement of ELK for graph layout

Build an internal layered and compound graph solver behind the existing
certification boundary. Evaluate a pinned subset of Pele's layout algorithms
as the first implementation candidate. Keep Agentic Mermaid's text preparation,
authored identities, geometry contracts, Scene lowering, paint certification,
output security and receipts. Retain ELK for unsupported inputs and rejected
candidate layouts until each replacement cohort earns promotion.

The [dual backend contract](../design/system/layout-backends.md) defines public
selection and comparative measurements. ELK remains a supported default;
Agentic selection is opt-in, with explicit optional ELK fallback. This supersedes
implicit fallback and eventual ELK retirement as requirements of this proposal.

The initial implementation uses an owned indexed DAG producer rather than
vendoring Pele. It shares node measurement and the direct positioned-graph
boundary, then retains the existing route passes and strict certification.
Pele remains an algorithm and compound-layout comparison reference. Cyclic and
compound cohorts remain on ELK until separately implemented and qualified.

This is the design and acceptance boundary requested on 20 October 2026.
Implementation work belongs in the owner's existing issue and backlog process;
this document does not create a second queue. Sequence Scene optimization and
this graph solver can proceed independently because sequence layout does not
use ELK.

## Problem and scope

The comparison against main `c517a1611290c7aa463512dc8b8d5156a3424a98`
shows a large graph-rendering gap that the conditional forest solver cannot
close. In the refreshed mesh50 CPU profile, ELK accounts for about 55% of
samples under graphical execution and route contracts account for about 29%.
These are inclusive stack categories, not an additive wall-time model. A new
solver must improve final routes enough to reduce downstream repair work as
well as its own production time.

The forest experiment establishes a useful integration pattern: try a solver
only on an explicit structural cohort, certify the result, and retain the
established fallbacks. It does not establish that a general replacement is
easy. In the pinned documentation census, the current rectangular forest
cohort contains 22 distinct examples. Broadening to nontrivial flat DAGs would
add only 17 more; 65 other flat DAG examples are singletons for which main
already bypasses ELK. Those counts describe documentation structure, not user
traffic or demonstrated new-solver support.

The first release scope is flowcharts. Class, ER, State and other ELK consumers
retain their existing adapters until their family-specific semantics and
geometry have independent acceptance evidence. Terminal-cell layout remains
owned by the terminal adapters.

## Architectural boundary

The replacement is a measured-graph-to-positioned-graph producer. It must not
call Pele's Mermaid parser or use Pele's final SVG as a substitute for our
Scene. Those surfaces cannot prove preservation of Agentic Mermaid's typed
editing model, prepared text, accessibility, ownership or receipts.

The intended execution is:

```text
Authored graph and resolved style
  -> existing text preparation and node measurement
  -> immutable measured graph with dense internal indices
  -> structural eligibility and deterministic work preflight
  -> layered or compound solver
  -> direct PositionedGraph adapter
  -> existing route and layout contracts
  -> candidate certification
  -> existing title projection, Scene and final output pipeline

Unsupported input or rejected candidate
  -> complete existing ELK candidate list
  -> the same contracts and output pipeline
```

Extract the measurement boundary from `mermaidToElk` before optimizing the
solver. The current forest experiment still constructs an ELK-shaped graph
and calls `elkToPositioned`; a general replacement should not depend on ELK's
intermediate representation. Refactor that boundary with output-identity
checks before introducing new geometry, so conversion changes and algorithm
changes remain independently reviewable.

### Measured graph input

Use stable dense indices inside the solver and retain separate mappings to
authored node IDs, group IDs and edge indices. An edge index is necessary for
parallel edges, including edges whose endpoints and labels are identical.
Generated port, dummy and label nodes occupy a separate internal index space;
they must never become authored Scene identities.

| Input | Required meaning |
|---|---|
| Nodes | Authored ID, shape, measured width and height, prepared label reference, authored order and parent group index |
| Groups | Authored ID and parent, local direction, header measurement, padding, minimum bounds and member indices |
| Edges | Authored index and optional ID, source and target indices, shaft style, markers, minimum rank span and prepared label dimensions |
| Ports | Owning subject, boundary side and offset constraints, terminal or group-boundary relationship |
| Request | Direction, spacing, resolved style geometry and deterministic resource limits |

Prepared text remains an opaque immutable reference to the existing measured
authority. The solver consumes dimensions and attachment constraints; it does
not shape, wrap, transform, abbreviate or discard authored text. Rank reversal
and dummy-node expansion must retain mappings back to the original edge.

### Positioned graph output

Return final node and group bounds, original semantic fields, edge routes,
label positions and original edge indices in the repository's existing pixel
coordinate system. Retain complete authored parent membership. Supply typed
route geometry and endpoint anchors so the existing contracts can check the
actual path; a promise that an edge connects two IDs is insufficient.

Orient the solved coordinates back into TD, BT, LR or RL exactly once. Group
translations must move members, nested groups, edge labels and every affected
route segment together. Document title bands remain in their current owning
projection after candidate certification.

Each producer works on a fresh mutable solver workspace. Rejected candidates
cannot mutate the authored graph, prepared blocks or the state later used by
ELK. The direct adapter must preserve the existing terminal, agent and custom
backend contracts without introducing a second semantic authority.

## Pele reuse decision

Pele 1.6.0 is the first candidate because its shipped declarations expose
indexed layered and compound algorithms. `layered` accepts measured nodes and
edges with minimum spans, label dimensions and port offsets. `compoundLayout`
adds parent indices, per-group direction, padding and minimum bounds. These
are plausible adapter boundaries, not proof that its output meets our route
or ownership contracts.

The installed 1.6.0 package declares MIT licensing and its license attributes
the code to kepano, copyright 2026. Before copying algorithms, pin the exact
upstream source revision corresponding to the evaluated artifact, inspect the
licenses of every transitive source module, and retain the applicable notices
in `LICENSES/` and `THIRD_PARTY_NOTICES.md`. Record imported modules and local
changes beside the vendored source. This proposal introduces no dependency or
copied Pele implementation.

Compare two candidates on the same adapter and acceptance cases:

1. A minimal, attributed vendored subset of Pele's layout implementation with
   a small adapter. This gives us control over deterministic work bounds,
   patching, module delivery and the exact solver version.
2. A small owned layered solver if the Pele adapter requires extensive
   changes to satisfy our ports, routes or compound semantics. Reuse measured
   inputs, the adapter contract and acceptance cases rather than creating a
   second parser or renderer.

Avoid a runtime dependency on undocumented deep paths in Pele's package.
Choose vendoring only if the imported algorithm remains a coherent,
maintainable unit after adaptation. Stop and retain ELK if either candidate
requires dropping supported content or bypassing a hard contract.

## Implementation stages

### Establish the adapter and controls

Extract measured inputs and the direct `PositionedGraph` adapter with no
change to default output. Record baseline revisions, package identities,
cache settings and environment metadata. Add a scoped internal solver flag;
keep the new producer off by default during qualification.

Preserve all four established ELK strategies. A preliminary solver gets one
additional bounded attempt, rather than consuming a fallback slot. Recover
from expected geometric infeasibility through that list only when ELK fallback
was requested. Unexpected solver defects remain engine errors. Propagate
`DiagramWorkLimitError` and pass-contract failures, as certification already
does; fallback must not disguise a work-limit violation or broken invariant.

Retain selected strategy, attempt count and existing certification evidence in
the receipt. Diagnostic tooling should additionally record eligibility,
rejection reason and the before/after counts of route repairs. Keep those
development diagnostics out of ordinary product flows.

### Prove labelled graphs and feedback routes

Implement measured flat DAGs with fan-in, fan-out, labelled edges, variable
node sizes, disconnected components and long-rank edges. Use stable authored
order for ties in cycle breaking, ranking and crossing sweeps. Include
reciprocal and parallel edges and self-loops in the initial feasibility
study; their implementation may remain ineligible until their geometry passes.

Before investing in broad tuning, demonstrate a cyclic mesh with intact
labels and a nested-group graph with a crossing-boundary edge. These are
early feasibility probes for the broader architecture. Tree performance alone
does not justify continuing the general replacement.

Use synthetic label and dummy nodes only in the solver workspace. Reattach
their routes and labels to the original edge index after ranking. Preserve
marker clearance and clip endpoints to the actual node outline. Start with
rectangles; other shapes remain on ELK until shape-specific boundary checks
pass. Bound ranks, expanded nodes, expanded edge segments and crossing sweeps
before allocating the expanded graph.

### Add compound layout

Add bottom-up group sizing and top-down coordinate translation with explicit
boundary ports. Reserve group headers and account for edges entering or
leaving a group separately from edges inside it. Include nested groups with
reciprocal edges, parallel edges, a group endpoint, an internal endpoint and
local direction overrides in the same acceptance case.

Do not flatten groups to make the solver accept them. Empty groups, authored
names resembling generated IDs and edges to group IDs must preserve the same
public identities, parents and endpoints as the current model. Keep State
visual annotations and other family-specific compound behavior on their
existing paths until separately qualified.

### Qualify and promote individual cohorts

Promote cohorts independently: labelled flat DAGs, then cyclic/parallel
graphs, then compound graphs. A failed compound gate does not require
discarding a certified DAG improvement. Keep one explicit eligibility
predicate per promoted capability boundary and exercise its fallback cases.

After promotion, remove redundant conversion and repair work only when an
independent proof shows it is unnecessary. Retain final route certification,
Scene admission, paint certification, output security and receipt consumption.
Changing storage or solver implementation does not remove those obligations.

## Correctness and quality gates

| Boundary | Required evidence |
|---|---|
| Meaning | No lost or duplicate nodes, groups, edges or labels; unchanged authored identities, parents, source values and prepared text provenance |
| Connectivity | Every route reaches the owned source/target boundary; markers, reciprocal edges, parallel edges and self-loops retain their distinctions |
| Geometry | Existing hard layout and pass contracts pass on final geometry, including label containment, group containment, finite extents and route clearance |
| Paint | Native Scene certification runs on the emitted geometry; final secured bytes retain the receipt's output digest |
| Determinism | Repeated calls and fresh Node, Bun and Chromium processes agree for each supported direction |
| Fallback | Unsupported inputs, ordinary solver errors and rejected geometry retain all existing ELK candidates; work-limit and pass-contract errors remain visible |
| Visual quality | Review generated before/after renders for dense labelled graphs, cycles and nested groups, alongside crossings, bends, canvas area and text occlusion metrics |
| Other surfaces | SVG, PNG, styled/custom backends, agent edit/verify and terminal correspondence retain their owning contracts |

Use independent geometric expectations and purposeful combinations at the
owning boundaries. Test exact byte identity for the measurement extraction
and for ineligible inputs. For supported new layouts, protect meaning,
connectivity and owned ink rather than requiring ELK's exact coordinates.
Mermaid's rendering is not a quality oracle. Keep generated qualification
reports and visual evidence under ignored artifact directories.

## Performance and delivery gates

The proposed promotion target is at least a 2× median improvement in fully
consumed end-to-end rendering for each promoted graph cohort, with lower JS
allocation and no correctness loss. Apply it to labelled DAGs, cyclic meshes
and compound graphs separately; a fast tree cohort cannot mask a slow mesh.
If the solver is faster but route repair erases the gain, reject the
performance claim and address the produced geometry before promotion.

Run three or more alternating fresh-process pairs against the same main
revision, using calibrated warm samples, an A/A control and a flag-off
control. Report per-case and per-cohort ratios without normalizing A/B by the
A/A result. Confirm repeatable effects beyond observed control noise. Keep
ELK result caching disabled for the primary comparison. Measure cached,
changing-source and cold-start workloads separately.

Every end-to-end confirmation must encode the SVG as UTF-8 and serialize the
entire receipt inside the timer. Keep allocation probes, forced-GC retained
heap diagnostics and ordinary timing in separate runs. Report the exact
successful-input denominator and every rejection; a new failure cannot
improve the matched-input score. Include source churn to distinguish layout
improvement from repeated-text or complete-result caching.

On successful inputs outside the promoted cohort, require byte-identical
output and no repeatable runtime or allocation regression beyond the measured
control spread. Check worst-case inputs and percentile latency as well as
cohort aggregates. Hard-code no timing assertions in unit tests.

Run packed-artifact browser qualification and the existing lazy payload
budgets without raising them to accommodate the experiment. Retaining ELK as
a statically imported fallback does not reduce download size. Claim a
delivery improvement only after the actual module/request graph shows that
eligible first renders avoid fetching ELK, including the cost of the new
solver and its adapter. Synchronous public rendering and browser lazy loading
may require different delivery strategies; preserve their current contracts.

## Release and rollback decision

Release the smallest cohort that passes all gates. Keep the old producer
available for unsupported cases and diagnostic comparisons. An eligibility
change and its tests belong together in one coherent commit. Record the
final combined candidate and dependency revision for each review.

Disable the new cohort if supported inputs lose content, hard contracts fail,
fallback rates rise materially on the fixed evaluation population, or a
repeatable performance/allocation regression appears. A fallback that preserves
correctness but runs both solvers frequently is still a performance failure.

Retain explicit ELK support and regression coverage alongside the owned backend.
Any change to default selection requires separate cohort promotion evidence.
Removing ELK is outside this implementation contract.

## References

- [Layout engine](../../src/layout-engine.ts) and
  [candidate certification](../../src/layout/certification.ts).
- [Typed Scene contract](../../src/scene/ir.ts),
  [paint certification](../../src/scene/paint-certification.ts) and
  [testing strategy](../testing-strategy.md).
- [Pele source](https://github.com/obsidianmd/pele), evaluated package 1.6.0,
  particularly `dist/layout/layered.d.ts`, `dist/layout/compound.d.ts` and
  its included MIT license.
- [Sketch port](https://github.com/Gaurav-Gosain/tuios/pull/919), comparison
  revision `880e652ee56b1607cc454847a359703d7cdc88e6`.
- [Conditional performance experiments](https://github.com/adewale/agentic-mermaid/pull/436).
