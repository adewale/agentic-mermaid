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
That ER change saved7gzip/157Brotli bytes. The next change separates the shared
option contract from executable rendering: standalone gzip1,386,827→1,332,711 and
Brotli1,318,081→1,272,057. The original1,334,500 gzip budget now passes locally,
with1,789bytes spare. Worker/backend validation remains intact. No causal runtime
or memory speedup is established.

Sparse32 streaming validation was tested and stopped: it still exhausts400k and
review found an unresolved authority concern from moving ambient lookups into
emission. The diagnostic removed-check pass is not a repair. Production XML
validation remains unchanged; this item is still open.

A newly reproduced missing-meaning or visible-output defect can outrank a resource
optimization. These are priorities, not a promise to run every experiment before
shipping an independent repair.

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
| Standalone transfer |1,332,711 gzip9;1,272,057 Brotli11 bytes | Reduce both actual artifacts where possible; original gzip ceiling1,334,500 passes locally with1,789bytes spare. Current main1,517,563 /1,170,181 has a different tradeoff. |
| Fully consumed runtime | No fresh post-rebase p50/p95 baseline | Measure milliseconds/call per family/backend/regime, output bytes and attempts; compare equivalent completed work. Refusal versus delivery is not a speed ratio. |
| Memory | No fresh settled/peak comparison | Peak process RSS, retained heap after the same workload and allocation separately. Profiler artifacts/retained products are not a leak experiment. |

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
