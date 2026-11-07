# Literature relevant to our ELK usage

7 November 2026. This maps published algorithms to the ELK features we actually request. It does not treat a paper's asymptotic bound as an expected speedup in our JavaScript implementation.

## Our ELK surface

At Native source `d8c8ac879793a586b4b741c178b89d7900bd27ed`, [layout-engine.ts](https://github.com/adewale/agentic-mermaid/blob/d8c8ac879793a586b4b741c178b89d7900bd27ed/src/layout-engine.ts#L665) requests ELK **layered** with orthogonal routing, measured node/edge-label sizes, model-order cycle breaking, model-order-aware ordering, balanced Brandes–Köpf placement, high-degree treatment, post-compaction, explicit port side/index constraints and compound hierarchy. Direction-override cases change hierarchy handling. Class, ER and Requirement have their own adapters into the same layered machinery.

The installed JavaScript dependency is elkjs0.11.1. The recovered Eclipse Java tag0.11.0 is useful algorithm/test source, not proof of the exact code in that JS artifact. We are not using every algorithm in ELK: force/stress/tree/radial research is not the first explanation for this configured layered comparison. ELK computes rectangle/line geometry, while our shared renderer owns actual shape outlines, text, markers, CSS, definitions and final ink. A shared defect in those consumers should not be assigned to the solver.

## 1. Phase contracts, hierarchy and model order

Domrös, von Hanxleden, Spönemann, Rüegg and Schulze, **The Eclipse Layout Kernel** (2023): [paper](https://arxiv.org/abs/2311.00533), [full text](https://arxiv.org/html/2311.00533v1), especially §§3–4.

The paper describes five layout phases, ordered intermediate processors, and import/export normalization. Processor pre/postconditions and dependencies make feature interactions manageable, but can become a maintenance burden. Its practical experience favors source/model order for stable tie-breaking and warns that a small edit can disrupt a user's mental map despite a good aesthetic score.

**Apply here:** expose actual stage states and require the facts a pass consumes: measured, ranked, ordered, port-constrained, routed, emitted. Carry real/virtual identity through transformations. Normalize direction once where practical. Preserve ordered arrays at boundaries and test small-edit displacement independently from exact replay. Reuse producer-owned facts to remove duplication; do not add an orchestration framework or assume every existing pass is redundant.

## 2. Ports must participate before routing

Schulze, Spönemann and von Hanxleden, **Drawing Layered Graphs with Port Constraints** (2014, JVLC): [author preprint](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf).

The algorithm distinguishes free ports, fixed side, fixed order and fixed position, and adapts ordering/placement to these constraints. Ordering node centers alone cannot count or avoid all crossings once endpoint port order matters. Compound boundaries introduce additional port relationships that must survive the phases.

**Apply here:** current fixed side/index/group constraints are part of the problem, not incidental annotations. A route optimizer cannot remove wire forced by fixed docks. For the forest wire deficit, test alternative admissible docks/order/coordinates at the first constraining stage. For compound graphs, independently check boundary order and interior endpoint alignment. Do not unlock authored or marker-required constraints to make a metric smaller.

## 3. Ranking, coordinates and labels are coupled

Gansner, Koutsofios, North and Vo, **A Technique for Drawing Directed Graphs** (1993): [primary PDF](https://www.graphviz.org/documentation/TSE93.pdf), especially ranking, coordinate assignment and §5.4 edge labels.

The pipeline separates rank assignment, ordering, coordinates and routing; their objectives interact. Edge labels consume space in the graph rather than appearing as decoration after routing. The label construction doubles ranks and compensates rank separation. Coordinate optimization must retain explicit node separation while favoring straight edges.

**Apply here:** reserve measured label/terminal demands before coordinates. Rank count is not physical separation. Astra found Native already halves nominal spacing, but repeated nonlinear channel floors defeat that compensation. Fixing where clearance is charged is more principled than toggling compact ranks. The compensated diamond preserved48px physical spacing and final contacts but added bends; the paper does not erase that adverse result. Network-simplex ranking is an option for a demonstrated rank-span deficit, not an automatic replacement of every current ranker.

## 4. Coordinate assignment needs the corrected algorithm

Brandes and Köpf, **Fast and Simple Horizontal Coordinate Assignment** (GD2001), read with Brandes, Walter and Zink, **Erratum: Fast and Simple Horizontal Coordinate Assignment** (2020): [erratum and references](https://arxiv.org/abs/2008.01252), [full PDF](https://arxiv.org/pdf/2008.01252).

The erratum identifies two flaws in horizontal compaction and gives corrections while retaining linear-time behavior and compatibility with extensions for variable sizes and ports. Merely reproducing the original pseudocode can inherit those faults.

**Apply here:** our ELK path requests balanced BK; current Pele has offset-aware alignment. If a named Native wire/bend/alignment loss warrants a coordinate prototype, use corrected compaction, measured half-widths and port offsets, with separation and block/class regression tests. This is not evidence Native currently has the BK bug—our producer is different—and no expected runtime or area percentage follows from the paper.

## 5. Reduce the representation, not just allocation overhead

Eiglsperger, Siebenhaller and Kaufmann, **An Efficient Implementation of Sugiyama's Algorithm for Layered Graph Drawing** (JGAA2005): [journal/DOI](https://jgaa.info/index.php/jgaa/article/view/paper111), [full PDF](https://jgaa.info/index.php/jgaa/article/download/paper111/2849/2656), §§2–3.

Sparse normalization represents a long edge using endpoint-adjacent dummy vertices and a segment instead of a dummy at every intervening layer. Under the described ordering scheme, this gives linear-sized normalized/compaction structures and corresponding improved bounds, rather than the traditional worst-case O(VE) space.

**Apply here:** profile real versus virtual nodes/edges and cumulative rank span. If expansion is material, a segment representation can reduce solver work, copies, hash lookup and memory together. Stable integer indices and phase-local arrays may then improve locality. Labels, port offsets, cycles, hierarchy and exact work accounting still need reconstruction. Native's current bounded domain may limit the practical gain; measure before a broad rewrite. Pele's20,000-dummy direct-curve escape is a different tradeoff, not this equivalent representation.

## 6. Label association is a correctness/readability question

Schulze, Wechselberg and von Hanxleden, **Edge Label Placement in Layered Graph Drawing** (Diagrams2018): [paper](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/diagrams18cds.pdf), [longer report](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/report-1802.pdf).

The paper distinguishes label layer assignment and side/inline presentation. Labels must be visibly associated with their own edge; moving one away from a collision can create ambiguity with another edge. Inline designs need appropriate background treatment. Width-aware layer choice is coupled to the dimensions it changes; this is not a solved universal area heuristic.

**Apply here:** retain edge ownership and measure the actual text/background/marker footprint. Diagnose Requirement TB/BT area at label seating and reserved bands before changing global spacing. Judge collision removal together with edge association and final emitted ink. User-task results about reading diagrams are not execution-speed measurements and do not justify silently changing label style.

## Tests and practical limits

ELK's [unit-testing documentation](https://eclipse.dev/elk/documentation/algorithmdevelopers/unittesting.html) shows black-box graph/configuration/algorithm matrices and white-box checks before/after processors. In particular, white-box tests can otherwise pass when their processor never executes; require actual execution for a relevant regression. [Random graph generation](https://eclipse.dev/elk/documentation/algorithmdevelopers/randomgraphs.html) is useful when seeds and minimized failures are retained.

The literature supports targeted hypotheses, not a universal metric winner. Preserve source/model order and determinism, hard geometry and authored meaning, and report area/wire/bend/runtime tradeoffs separately. Test the smallest causal intervention on a demonstrated deficit; do not implement all six ideas as a new speculative pipeline.
