# Native layout: execution priorities and measurable outcomes

Updated 8 November 2026 for draft [PR602](https://github.com/adewale/agentic-mermaid/pull/602).
This is the owner's requested implementation plan, not a new acceptance contract.
[TODO.md](../../../TODO.md#owned-graph-backend-qualification-owner-request-pr-449)
remains the backlog owner. Backend defaults, versions and production limits stay
unchanged. Automated work remains stopped; manual runs have bounded leases.

The objective is reliable delivery of the owner's diagrams with understood
quality and resource costs. ELK supplies counterexamples and alternative layouts.
Authored meaning and actual final SVG/ink determine correctness. Equalizing every
ELK metric is neither necessary nor sufficient.

## Stack rank

| Rank | Proposal | Concrete intervention and result to seek |
| --- | --- | --- |
| 1 | Remove shared ER256 refusal | Reuse one retained glyph/shaft snapshot until route mutation invalidates it. Query each glyph union once, then retain exact piece checks. Implemented: all four directions now deliver through both public backends at the original400k limit. Snapshot reuse alone and union queries alone still refuse BT; the combination delivers. |
| 2 | Finish Sparse32 proof without weakening capture | Separate its 1,500-label / 32-marker proof exhaustion from delivery and visible ink. Attribute the first exhausted XML/capture stage, then subtract repeated construction or scanning. Stop a candidate that cannot recover enough work. Preserve fresh-byte, namespace, UTF16, getter, CSS and ownership obligations. |
| 3 | Reduce the shipped dependency closures | Standalone dependency split implemented: declarative option validation no longer loads the graphical backend closure on the main thread. Measure initial/lazy requests and both compressed formats; continue removing unnecessary imports before changing encodings. Include decode/first-render cost and offline-worker behavior; a gzip win cannot conceal a Brotli loss. No new caches or raised budgets. |
| 4 | Remove demonstrated visible contacts | Start with retained cases152/372/201/241. Trace producer placement, routing, label seating and final emission. Preserve each occurrence's real painted clearance, including circles, miter joins and parallel markers. Crossing276 remains a separate quality loss. |
| 5 | Improve the remaining layout frontier | Class2 is smaller but taller; Native area65,400 versus ELK61,400. Sparse256's implemented historical area gap is+5.04%. Seek a measured placement/ordering improvement while retaining adverse height, wire, bends and contacts. The+0.97% backfill candidate remains unshipped. |
| 6 | Subtract measured execution work | Profile fully consumed SVG plus the entire receipt before optimization. Investigate snapshot/admission/completion only where ownership or an immutable geometry epoch proves reuse is valid. Compare cold, warm recompute, cache hit and edit separately; report RSS and heap separately. |

The implemented first item changes ER256 delivery from2/4 to4/4 directions per
backend. Native BT/RL finish at385,344 geometry operations; ELK at371,874. Already
admitted TB/LR preserve exact SVGs while Native work falls397,206→343,421 and ELK
384,466→330,681. All1,748 fixed-roster SVGs and delivery/proof/route outcomes stay
exact; those unchanged cases are validation. Fresh returned ER256 products are
supplemental evidence, not additions to a denominator chosen after outcomes.
That ER change saved7gzip/157Brotli bytes. The option-contract split then reduced
standalone gzip1,386,827→1,332,711 and Brotli1,318,081→1,272,057. Integrating
main608 adds1,212gzip/1,392Brotli bytes: final1,333,923/1,273,449, with577bytes
spare under the original1,334,500 gzip ceiling. Worker/backend validation remains
intact. No causal runtime or memory speedup is established.

Sparse32 streaming validation was tested and stopped: it still exhausts400k and
review found an unresolved authority concern from moving ambient lookups into
emission. The diagnostic removed-check pass is not a repair. Production XML
validation remains unchanged; this item is still open. A subsequent deferred
name-token/prepared-mask trial also remains unverified at400k. Count-only
diagnostics report450,245→421,715 emission operations, before final proof work;
these relaxed diagnostic counts are not admissible passes. Independent review
finds that sharing paint replay cannot close this witness: its own-paint labels
never consume that replay. Stop this hypothesis rather than adding more machinery.

At0c162c446, canonical lazy artifacts with the same pinned ELK0.11.1 show Native
closures smaller in raw/gzip/Brotli bytes for all nine graph families measured by
the existing report. Flowchart is378,598gzip/320,974Brotli for Native versus
746,952/590,334 for ELK; Native uses29 module requests versus25. These are built
static/provider closures, not captured browser requests, startup timing or full
delivery qualification. This backend comparison is distinct from the PR's common
pipeline growth versus main: Flowchart+46,076gzip, Timeline+40,813gzip. Removing
forced render-core grouping worsens every family closure (roughly+900gzip and
+2,700Brotli), so that outside-source trial is stopped. No runtime change ships.
The first reference build's ELK0.11.0 dependency mismatch was corrected before
the equal-dependency comparison; failed attempts and adverse costs are retained.

Full runtime CI at0c162c446 has completed failed: Sparse32, lazy/website payload
limits and generated-layout advisory. Browser/site, package-consumer, CLI,
semantic conformance and the other two unit shards pass. A smaller Native solver
download and a passing standalone ceiling do not close those remaining failures.

A newly reproduced missing-meaning or visible-output defect can outrank a resource
optimization. These are priorities, not a promise to run every experiment before
shipping an independent repair.

## Trident comparison at df133c694

Pinned Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038` now measures the same
compiled public Node SVG artifact with Native/ELK selection and fallback disabled.
All27 graph-related portable cases remain enrolled;22 other cases are explicitly
outside backend selection. Across25 successfully returned positive pairs, observed
uncached cold/repeat medians and memory are lower for Native. Cached repeats are
mixed:14 lower,11 higher; Class128 is280.59ms Native versus252.57ms ELK.
One round, three fresh processes per cell and seven warm samples are exploratory,
below Trident calibration settings. No general speed ratio or p95 follows.
This SVG-only clock does not replace the earlier entire-receipt measurements.

The independent30-case fidelity cohort returns28SVGs per backend. Of613 planned
criteria each, Native has576passed/28blocked/3failed/6unsupported; ELK575/29/3/6.
Two failed requests use unsupported top-level fontSize; both omit an authored image
under the current warned offline-placeholder policy. Unknown pseudostate/ER paint
and ELK Requirement label ownership remain unknown, not incorrect drawings.
All50 returned portable seed SVGs bind exactly to100 measured cache0/1 products;
all52 returned seed/edit receipts confirm selected backend without fallback.

Actual Trident browser capture of the same six-family union fetches Native
476,485gzip9/407,052Brotli11 product bytes versus ELK851,989/682,687. Native uses
39requests versus37, including the separately reported binding. These compress
the actual fetched bytes after raw local responses; they are not compressed wire
measurements or browser startup timing. Both1,000-call retention diagnostics grow
substantially despite lower Native memory; no settled-memory or no-leak claim.

This adds comparison coverage, not a runtime improvement. The original fixed
counterexamples and distribution/proof failures remain; df133 CI completed failed.
The focused cached Class128 supplement uses five rounds,31warm samples and
30fresh workers. Across15process medians/backend, repeats are233.80ms Native
versus225.45ms ELK, with ranges224.83–298.90/208.91–238.03. All four warm rows
meet per-lane calibration; missing cold rows remain missing. Per-lane A/A repeat
bands span roughly10–14%, so they do not establish the earlier fixed11%backend
penalty. Native remains slower in central observations; neither parity nor an
optimization gain follows. Stop optimization based only on that exploratory gap.
All ten saved SVGs match the original timed products; artifact hashes are unchanged.
The image scope gap does not automatically authorize changing offline product policy.
Raw results, frozen inputs, exact artifacts, reproduction and all limitations are
in the existing evidence branch's `trident-native-elk-df133-20261108` checkpoint.

## Interface and state proposals

Extend the existing backend selection, typed fallback and family conformance
paths when an actual adapter needs a distinction. Keep measured placement,
completed routes, final emission and paint proof separate. A placement-only
adapter must not pretend to own routes. Refusal, unavailable proof and an unknown
visible result must not collapse into one failure flag.

A call-local geometry snapshot is usable only while its routes are unchanged.
Face allocation refreshes it after a move; later frame/caption repair invalidates
it for final checks. This lifetime belongs to the shared ER finalizer, not to a
new global cache. Its broad-phase bounds never replace exact collision tests.

Defer a general solver registry, a new conformance framework, sparse long-edge
representation and broad phase-state refactors until a concrete consumer or
profile justifies them. Retire duplicate ER index/caption proposals already in
main. Add interaction coverage to the owning test of each real repair.

## One implementation cycle

1. Reproduce one named loss with fixed input/options. Label it meaning, refusal,
   visible contact, layout quality, proof availability, execution cost or unknown.
2. Locate the first responsible stage. Attribute shared defects to the shared
   producer/consumer; record a causal hypothesis and what would disprove it.
3. Test the smallest intervention. Preserve unsuccessful trials and stop a
   falsified mechanism. Do not count unchanged comparisons as progress.
4. Requalify the owning public contract and nearby mutation/repair paths.
   Compare the existing corpus at coherent milestones. Retain all failures,
   unsupported cells, unknowns and adverse costs; Replacement24 stays sealed.
5. Commit and push verified work and recoverable evidence. Record exact revisions,
   observable gain, cost and next counterexample. Follow final-head CI honestly.

Reuse [layout comparison](../../../eval/layout-compare/run.ts), existing family
conformance tests, actual SVG/raster tools and the
[profiler/cache inventory](layout-0.6-performance-review.md). Do not introduce
another qualification framework or a composite pass score.

## Metrics to hillclimb

The starting measurements below bind to runtime93c6d75dc / test-only follow-up
a19526203 on mainc366de0d1. The current implementation's evidence records its
changes separately; the payload row below includes the option-contract split. Each row keeps its workload and denominator; these numbers
must not be pooled into an overall correctness percentage.

| Metric | Starting measurement | Optimize / retain alongside it |
| --- | --- | --- |
| ER256 delivered directions, explicit backend/no fallback |2/4 Native;2/4 ELK | Increase complete deliveries; preserve256 entity IDs,255 ordered relations,510 cardinality carriers, actual labels and contacts; keep400k geometry cap. |
| Fixed874-input delivery roster |874 returned/backend | Preserve every enrolled outcome; list supplemental ER256 separately. Returned SVG is not a visible-correctness proof. |
| Final paint proof availability | Native740 passed /134 unverified; ELK696 /178 | Reduce unverified cases by removing real work, while retaining correctness and original caps. |
| Demonstrated actual-ink losses | Named counterexamples remain; whole-workload count unknown | Remove the contact/missing-ink witness and requalify nearby geometry. Never report unknown as zero. |
| Forest wire / area | Native397.71 /165,356; ELK396.47 /176,727 | Retain the useful wire/area tradeoff,8 bends and final contacts; do not spend cycles forcing the remaining0.31% wire delta to zero. |
| Class2 area / height | Native65,400 /327; ELK61,400 /307 | Reduce area with height/aspect ratio, wire and visible layout reported. |
| Crossing276 / Sparse256 |6vs4 crossings; historical area+5.04% | Retain adverse bends, contacts, height and compressed SVG cost. |
| Standalone transfer |1,333,923 gzip9;1,273,449 Brotli11 bytes | Original gzip ceiling1,334,500 passes with577bytes spare. Earlier mainc3661,517,563 /1,170,181 has a different tradeoff; no current-main standalone ratio. |
| Native/ELK lazy Flowchart closure |378,598/746,952 gzip;320,974/590,334 Brotli | Retain the Native byte saving alongside29vs25 module requests; measure actual startup and fallback demands separately. Other family and PR-versus-main closure costs remain explicit. |
| Fully consumed runtime | d4 checkpoint:24fresh ER256 BT/RL processes,168complete calls/proofs passed;48actual-XML cold/edit products audited | Cold/cache/edit results are mixed; Native loses uncached BT edits and cached RL repeats. This predates main608; no merged-head speedup or p95 estimate is established. |
| Trident SVG-only runtime |27enrolled cases;25completed positive pairs favor Native uncached, cache1 repeat14lower/11higher; exploratory | Focused cached Class128 central observations remain slower, but the original fixed11%penalty is not established. Keep API/import/cache/edit scopes and partial semantics separate; no general speed ratio. |
| Trident memory | Flowchart128 cache0 peak worker RSS125.43MiB Native/185.85MiB ELK; three processes/cell | Peak worker includes import/driver/qualification; API-return/post-GC snapshots are separate. Both1,000-call retention diagnostics grow substantially; no settled-memory or leak conclusion. |

Quality is a vector: missing meaning, visible collisions, area, wire, bends,
crossings, aspect ratio and edit displacement have different costs. Keep the
individual counterexamples rather than choosing weights that make a candidate win.
Resource metrics cannot compensate for a drawing that loses authored meaning.

The six original goals remain coverage, broader correctness, layout quality,
performance, sound verification and comparison with public Mermaid/Pele artifacts.
The longer [historical research proposal](https://github.com/adewale/agentic-mermaid/blob/a195262036dbb07c7ce4919505d4ff47dea09e63/docs/design/system/layout-0.6-qualification.md)
is retained in Git. Its additional statistical protocols and human studies were
never owner-approved completion gates. Peer artifacts remain unavailable in any
lane not actually recovered; Trident source recovery alone is not a peer run.
