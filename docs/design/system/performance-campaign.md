# Measured performance campaign

The owner requested this campaign on 22 October 2026 after a review of main
`b09ef80229df42a620cf899054c721f0d7ecfe36`, the active performance and native-layout
branches, the Mermaid community inventory and the layout literature. Evaluate
every unclaimed opportunity below, measure the combined artifact, retain or
reject changes from evidence, then rebase and qualify the final revision.
`TODO.md` owns completion status.

## Scope and ownership

PR #433 owns its release candidate, shared postprocessing and allocation work.
Its latest source reports restored State parity; the earlier cache-hit
regression is historical, not a current confirmed defect. Its broad performance
targets remain unmet. PR #449 owns native solver algorithms, implemented
Architecture placement-only routing, cyclic cost tails and solver qualification.
Its runtime 26 source needs qualification beyond older runtime 24 reports.
PR #465's Architecture contact authority is merged into main `87c9c317` and
preserved as a separately attributed dependency. Their existing work is not
credited to this campaign.

The experiments cover:

- Built-in SVG import separation from external Scene admission and conformance.
- Native drawing construction without repeated descendant/ancestor copies.
- Requested family-rubric metrics and correctly scoped proof reuse.
- Private positioned-artifact/cache ownership, public mutable copies and budgets.
- One family-owned Flowchart/Sequence draft per mutation batch.
- Call-local verification serialization, closure parsing and normalization.
- Shared scalar Sequence gap aggregation and Gantt section/lane membership.
- Terminal proof observations collected during existing scans.
- Sankey bucket appends, GitGraph branch extents and lazy Quadrant candidates.
- Lightweight CLI/MCP command and help dispatch.
- Final SVG emission/inspection consolidation after the drawing changes.
- Update-aware ELK repair passes with preserved final geometry.
- Lazy MCP membrane iteration while preserving #365's execution semantics.

The architecture-wide completeness review also identified work outside those
initial packages. Evaluate source-order queue preparation, request-local pass
metadata, shared route classification, forest conversion preparation, and a
fixed-geometry obstacle query. Family follow-ups cover Gantt calendar and
dependency traversal, nested Sequence frame/overlay work, and large Quadrant
collision filtering. Evaluate a private SVG-only installation artifact without
changing the existing package's PNG installation contract. Persistent peer,
tail-latency and allocation targets remain coordinated with #433's maintained
benchmark work.

These are experiments, not preselected implementations. Record a concrete
disposition for each broader proposal, including ownership or compatibility
constraints that prevent safely removing work. A narrower optimization does not
establish completion of a shared workspace, generation-aware proof system or
placement-before-routing redesign.

Each experiment must remove concrete work at its owner. Rejected private
recipes, broad memo/index prototypes and removed feature flags need new evidence
before reconsideration. Independent changes use separate commits; shared files
have one active owner. No new runtime dependency or diagram family is required.

## Preservation requirements

Retain source meaning, authored identities, order, labels, endpoint sides,
markers, public mutation behavior, diagnostics, deterministic output, admission
limits and security. Optimizations should preserve output bytes; an intended
visible change needs separate same-input evidence and an explanation. A faster
rejection does not count as a successful render.

Pixel and terminal measurement and layout remain separate. The proposed
Sequence numeric interval helper was evaluated and rejected after measured
slowdowns; it is not shipped. Gantt grouping uses section identity rather than
label, and compact lanes choose the lowest eligible index. Terminal proof
indexes are local to an assertion.

Public objects are mutable. Proof reuse requires a privately owned immutable
artifact and matching source, descriptor, font/style, options and backend
dependencies. Layout, paint and source-correspondence proofs retain their
independent meanings. Security checks observe final bytes after relevant
transformations. MCP laziness preserves hardening and collection semantics.

## North-star measures

The goal is lower cost for complete, correct public renders. Beating Beautiful and approaching Pele are competitive targets, not forecasts of what a particular redesign can achieve. There is no composite score that can hide a speed loss with a smaller download or treat lower allocation as lower retained memory. Compare the same sources, supported semantics, output consumers and runtime settings; keep the cohort fixed.

| Measure | Goal | Measurement boundary |
|---|---|---|
| Fresh-render p50 and p95 | Beat Beautiful on the fixed shared cohort, then approach Pele. The current architectural investment milestone is at least 2× fresh Sequence speed. | A public render through complete UTF-8 SVG consumption; complete serialized receipts form a separate Agentic track. Preserve per-case results as well as the fixed-cohort geometric mean. Peer receipts and unobservable semantics remain unavailable rather than equivalent. |
| Allocation per complete render | Beat Beautiful on comparable cases; halve fresh Sequence allocation for the architectural milestone. | Independent sampled V8 allocation probes, both SVG and full receipts, with same-artifact controls. This excludes native/WASM memory and does not establish retention. |
| Retained and peak memory under churn | Lower steady post-GC retained heap without unbounded growth; reduce valid worker-memory measurements while keeping cache/output lifetimes explicit. | Separate warmed, output-held and released checkpoints, plus cache-cleared checkpoints where supported; fixed unique-source/edit/churn sequences. Process-lifetime maxRSS with a possible inherited floor cannot qualify renderer footprint. Report worker current-RSS/current-mm peaks and startup context when available; no invented subtraction of high-water marks. |
| Delivered code and requests | Lower compressed bytes for actual consumers and first diagrams, and reduce the complete supported-feature closure. | gzip/Brotli for the shipped consumer, lazy initial closure, actual first-family requests, and all YAML/entity/ELK demand transfers. Compare matched feature scopes; broader packages with different APIs/families are descriptive comparisons. Retain unchanged worst-case caps. |

Record which stages actually compute or reuse work: a new source variant may retain reusable topology or geometry, and cache-on public latency remains distinct from newly computed engine throughput. Required checks cover first use, warm new sources, exact repeats and real edits under cache off/on, plus scaling and the full supported corpus. First-call render latency is separate from module acquisition/import/startup. One first-use call per round does not qualify p95, and missing cold allocation probes remain unavailable. Layout size/crossings/bends and routing failures remain owner-specific quality checks; faster rendering cannot be purchased by losing authored meaning, coverage, public mutation/getter behavior, security, limits or failure ordering.

The competitive goal is a candidate/peer ratio below 1 on observable matched semantics. The existing maintained regression targets (p50 1.05, p95 1.10, allocation 1.05) and its control/noise policy govern investigation/qualification; they are not claims of competitive success. Keep calibrated passes, failures, unavailable and uncalibrated cells distinct. Stage-share arithmetic, replay substitutions, source microbenchmarks and literature examples guide experiments but do not satisfy these public-call targets.

The current 2×/50% milestone is a go/no-go investment gate for a broad architectural Sequence slice, not a claim that halving Agentic would catch Beautiful across every family. Narrow changes may be retained for demonstrated incremental gains or consistency benefits under the existing campaign selection rules, with regressions and tradeoffs explicit.

## Measurement and selection

Run maintained complete release and browser corpora, scaling and workflow cases,
peer workloads, and package/consumer/lazy payload measurements. Add focused
scaling inputs for changed mechanisms. Use a fixed harness for before/after;
record effective cache policy, assertions, engines, dependencies, revisions and
artifact identity.

Separate cold startup, warm new-source rendering, exact repeats, edit workflows,
plain output and consumed receipts. Measure allocation, peak RSS and post-GC
retained heap under churn separately. Report supported shared peer cohorts and
refusals. Keep raw samples and failures as generated artifacts. Use A/A controls
and serial cost measurements without competing implementation tests/builds.

Compare each experiment's behavior and targeted cost with the baseline, then
test the combined candidate. Retain a demonstrated performance improvement or
a concrete consistency benefit without a material cost regression. Reject
mechanisms that add overhead, lose guarantees or lack justification. Do not sum
individual percentage gains or weaken existing gates.

After rebasing onto current main, rerun affected contracts and benchmark the
final artifact against its new base and the recorded starting point. Report
what improved, what regressed, rejected experiments, remaining limitations and
next work. Earlier measurements remain bound to their original revisions.


## Recorded outcome

PR #467 records the completed baseline, selected and rejected experiments,
combined replay and rebased qualification in the
[campaign report](../../project/archive/performance-campaign-2026-10-22.md).
The [original recommendation crosswalk](../../project/archive/performance-campaign-2026-10-22-crosswalk.md)
accounts for every original area, including broader work that remains absent.
Lower allocation and faster editing/startup do not establish the competitive
rendering or production bundle-size goal. `TODO.md` retains landing and
remaining performance work; this design contract is not a second backlog.

The [catch-up campaign](../../project/archive/performance-catchup-2026-10-23.md)
starts after merged #467/#468. It records withdrawn bc8’s allocation and lazy
delivery changes, failed peer qualification, rejected partial fusion, native
bounds rejection, and source-pinned Frankenmermaid ideas. Final #471 retains
only diagnostics and authored reporting; its measured production trials were
withdrawn after selection and ownership integration. #433 has carried
YAML/security work while #449 retains the graph solver and readiness owners.
Their eventual composition requires a newly qualified artifact; branch gains
are never added. PERF-1 remains the sole completion inventory.
