# Layout guarantees and robustness — what we can promise, and how

A literature + industry synthesis answering one question: **which layout
invariants can we guarantee in 100% of inputs and keep robust under fuzzing, and
which are provably impossible to guarantee — so we must optimize-and-certify
instead?** It was produced by a fan-out of research sub-agents over the academic
graph-drawing / map-labeling literature and the engineering practice of yFiles,
Graphviz, ELK, OGDF, Adaptagrams/libavoid, cola.js, tldraw, Excalidraw, and
draw.io/mxGraph. Citations are at the end.

This doc is the *map*. The route-engine details live in
[`route-contracts.md`](./route-contracts.md); the quality metrics in
[`layout-rubric.md`](./layout-rubric.md).

## TL;DR

The field partitions drawing properties into two kinds, and we must treat them
differently:

| Kind | Examples | Best achievable | Our use |
| --- | --- | --- | --- |
| **Conventions / feasibility** (membership predicates) | orthogonality, port-exactness, no node overlap, monotone flow, axis-alignment, determinism, lane-distinctness | **100%, by construction**, usually polynomial | the **hard** rubric invariants (must be 0) |
| **Aesthetic optima** | min crossings, min bends (free embedding), min area, max symmetry | **NP-hard — no 100% guarantee**; optimize then certify the value achieved | the **soft** rubric metrics (ratcheted) |
| **Label placement** (in between) | place every label cleanly without moving nodes | **NP-hard** (Kakoulis–Tollis ELP; Marks–Shieber: poly ⇔ P=NP). Algorithms **maximize placed labels and may drop/overlap some** | `findLabelSlot` + certify-or-fallback |

So "100% + fuzz-robust" is reachable **only when reframed**: not "always produce
the optimal/clean drawing" (impossible for the NP-hard ones) but *"always satisfy
the hard conventions — by construction, or by a checker that vetoes and falls
back — while optimizing the soft aesthetics and honestly certifying the value we
hit."* That is the architecture we already have; the research says where to
tighten it.

## The robustness mechanism (why fuzzing keeps finding 1–2px bugs)

Our recurring failures — labels grazing nodes, collinear edges merging, endpoints
just off a port at 1–2px — are the textbook symptom of **floating-point
geometric predicates returning inconsistent signs near degeneracy** (Kettner,
Mehlhorn, Pion, Schirra, Yap 2008). The cure is the Exact-Geometric-Computation
paradigm, **not** more fuzzing (Dijkstra: testing shows presence, never absence):

1. **Exact discrete predicates.** Evaluate the *decisions* — does this label pill
   overlap this node? is this endpoint on this port? are these two segments
   collinear-and-overlapping? does this segment pass through this shape? — in
   **integer arithmetic on snapped coordinates with one fixed tie-break**
   (Simulation of Simplicity), not against scattered ε. The *coordinates* being
   slightly off is harmless; the *branch decisions* being wrong is catastrophic
   and self-reinforcing. This collapses the near-degenerate class fuzzing keeps
   surfacing and makes producer and checker bit-identical. (Yap EGC; Shewchuk
   adaptive predicates; CGAL's "exact predicates, inexact constructions";
   Edelsbrunner–Mücke; Hobby snap-rounding.) Today these decisions are spread
   across tolerances (`EPS`, `GRAZE`, `TOL`, `BOUNDS_TOL`, `PORT_TOLERANCE`) — the
   symptom, not the cure.
2. **One independent, total checker on every output** that re-derives each hard
   invariant from rendered geometry alone and *vetoes* a violating layout,
   falling back to a safe route. [`layout-rubric.ts`](../../../src/layout-rubric.ts)
   already does this right for outlines (it reimplements each shape's outline so a
   port regression can't hide itself); the **route** checker is weaker — its audits
   reuse the producer's own `directLaneBlockers`/`tryStraighten`, so a bug there is
   invisible to it. (Certifying algorithms: McConnell–Mehlhorn–Näher–Schweitzer
   2011; checker-only formal verification: Alkassar–Böhme–Mehlhorn–Rizkallah 2011.)
3. **Exhaustive small-scope enumeration** (all non-isomorphic graphs ≤ 5–6 nodes ×
   shapes × 4 directions) is a *complete* proof in-scope — the real "ever" — with
   fuzzing relegated to the large-graph tail (small-scope hypothesis, Jackson 2006).

## The three problems, with verdicts

### 1. A label displaces the node off its port → 100% solvable by construction

Industry is **unanimous**: every hand-authored editor — tldraw, Excalidraw,
draw.io/mxGraph, yFiles' generic labeler — **decouples labels; node positions are
never perturbed by a label.** The two systems that reserve in-band label space
(Graphviz's `label` dummy-node; yFiles' integrated mode) *both document it as
distorting the layout* — Graphviz's FAQ: edge labels as dummy nodes "can
dramatically distort the layout," and `xlabel` (post-layout placement) is offered
as the escape hatch. That `xlabel` is our `APL_DECOUPLE_LABELS`.

**Verdict: making "a label can never move a node" a structural invariant is
correct, and the literature says make decoupling the default.** Already built and
validated (fixes the sym A→B port and the minimal repro, zero corpus-quality cost,
deterministic). The only blocker to default-on is problem 2.

### 2. Label on a shared trunk (the bent-duplicate regressions) → split verdict

Two problems under one error code:

- **(a) the two edges share a trunk** — the universal industry solution is a
  *dedicated duplicate-edge spreading pass*: mxParallelEdgeLayout (bucket by a
  **direction-independent edge key**, fan into lanes by perpendicular offset,
  default spacing 20), yFiles' ParallelEdgeRouter (leading-edge + parallel
  reinsertion). With **distinct fixed ports per parallel edge** (Spönemann's
  FIXED_POS port-constraint hierarchy — which `allocateRoutePorts` already plans
  slots for) the edges become non-collinear at both ends **by construction**.
  100%-achievable; the current pass just carves out *labeled* bent duplicates —
  exactly the fuzz regression.
- **(b) the label finding a private segment** — the NP-hard half. We **cannot**
  guarantee a clean placement always *exists* (Kakoulis–Tollis: maximize placed
  labels, may drop some). But we **can enforce the invariant** as
  *certify-or-fallback*: if no edge-private labelable segment survives laning, the
  route contract **vetoes that geometry and falls back** (reserved label corridor /
  boundary-label leader à la Bekos et al. / suppress). The *output* invariant "no
  label on a shared trunk" becomes total via the checker's veto.

**Verdict: port-exactness + lane separation = 100% by construction;
clean-label-placement = not guaranteed (NP-hard) but enforceable as
certified-or-safe-fallback.** Extend the duplicate-lane assignment to cover
labeled bent duplicates (keyed by unordered pair), then veto-and-fallback for the
residue. This unblocks decoupling-by-default.

### 3. Bundling adds bends without removing crossings → can never be 100%; gate it

The visualization literature is flat: edge bundling (Holten 2006; Holten–van Wijk
2009) **reduces visual clutter but does not reduce the number of crossings, and
adds curvature/ambiguity.** Bundling an already-crossing-free fan is all cost, no
benefit (our observed defect: `bundleEdgePaths` on shared-hub fans, +bends, 0
crossings removed). Bundling is irreducibly a heuristic — never a 100% guarantee.

**Verdict: add a net-benefit gate** (the hyperedge-routing cost view): only keep a
bundle when it does not increase total bends without removing a crossing; never
bundle a crossing-free fan. The `simplifyPolyline` bend count + a member-vs-member
crossing count make a heuristic *safe* ("bundling never worsens crossings or
bends"), which itself *is* a 100%-guaranteeable property.

## The bigger architectural opportunity (larger scope, separate track)

Much of the 16-pass whack-a-mole re-derives by hand what an exact solver one stage
upstream already owns:

- ELK already runs **Brandes–Köpf** (correct-by-construction coordinate
  assignment), then we override it with **6 node-moving heuristic passes**.
  Switching to `NETWORK_SIMPLEX` placement + `nodeFlexibility: PORT_POSITION` (or
  BK + `edgeStraightening: IMPROVE_STRAIGHTNESS`) folds **port-exactness +
  straightness into the placement solve** — potentially retiring several passes.
- An **exact orthogonal router** (libavoid: A\* over an orthogonal visibility
  graph, *provably* bend-and-length-optimal per connector, object-avoiding by
  construction — Wybrow–Marriott–Stuckey 2009) would make
  `diagonalSegments`/`edgeThroughNode`/`unexplainedBends` zero **by construction**.
- **Constraint solvers** (VPSC / IPSep-CoLa) guarantee non-overlap + alignment +
  directed-flow as *hard* constraints — but only when satisfiable; over-constrained
  systems degrade (silently, in WebCola). Net: they convert open-ended
  geometry-repair bugs into *one* characterizable failure mode (constraint
  infeasibility) you fuzz once.
- **Exact ILP/SAT/SMT is disqualified** for us: NP-hard, tens of nodes, runtime
  *nondeterministic* (one SAT layout solver's UNSAT proofs: median 4 min, max
  23 h) — fatal to deterministic real-time. Lone exception: Tamassia
  min-cost-flow bend-minimization is poly + deterministic but only for a *fixed*
  embedding (a full Topology-Shape-Metrics rewrite).

## Per-invariant verdict table

| Invariant | Status | Mechanism |
| --- | --- | --- |
| Determinism | **Guaranteed by construction** | pure functions, fixed orderings, integer predicates |
| Port-exactness | **Guaranteeable by construction** (currently optimize-and-certify) | emit endpoints from `shapePorts`/`diamondFacetPorts` + grid-snap; FIXED_POS ports |
| Axis-alignment / no diagonals | **Guaranteed by construction** | emit only axis-aligned segments |
| No edge-through-node / no hitch | **Optimize-and-certify** (feasible ⇒ achievable) | straighten then independent checker; on reject keep the ELK route |
| No node overlap | **Guaranteeable by construction** | separation constraints (VPSC) — when satisfiable |
| No-label-occlusion | **Optimize-and-certify** (NP-hard) | maximize placed; veto-and-fallback (never draw occluding) |
| No-label-on-shared-trunk | **Optimize-and-certify** (NP-hard) | duplicate-lane construction + veto-and-fallback |
| Min crossings / bends / area | **Provably impossible to guarantee** | NP-hard; certify "no worse than input, count = N", never "minimum" |

## Prioritized roadmap

1. **Minimal (recommended first):** extend duplicate-lane repair to labeled bent
   duplicates + veto-and-fallback → flip `APL_DECOUPLE_LABELS` to default-on; add
   the net-benefit gate to `bundleEdgePaths`. Retires problems 1 and 3, enforces
   problem 2. Lowest risk; ships the validated decoupling win.
2. **Robustness hardening:** exact integer predicates on snapped coordinates +
   one independent total checker run on every output. Attacks the 1–2px fuzz class
   at the root.
3. **Upstream re-architecture:** ELK placement strategy + libavoid-style exact
   router + a VPSC post-pass. Biggest payoff, biggest scope.

## Honest bottom line on "100%"

- **Achievable and worth driving to zero by construction + checking:**
  determinism, port-exactness, axis-alignment, no-edge-through-node,
  no-unexplained-bend, no-hitch, no-node-overlap (these are *conventions /
  feasibility*).
- **Achievable only as "certified-clean-or-explicit-fallback":**
  no-label-occlusion, no-label-on-shared-trunk (NP-hard placement — you cannot
  have fixed-position-AND-always-clean for every input).
- **Provably impossible to guarantee as a minimum:** crossings, bends, area, edge
  length (NP-hard). Saying so plainly is part of dimension-7 "trust."

The path to "no fuzz-surfaced geometric violation, ever" runs through **exact
predicates + an independent, mandatory checker + exhaustive small-scope
verification**, with fuzzing relegated to adversarial tail-coverage — not through
a search for a complete construction that the literature proves does not exist.

## Citations

**Aesthetic invariants & complexity.** Di Battista, Eades, Tamassia, Tollis,
*Graph Drawing*, Prentice Hall 1999; Tamassia (ed.), *Handbook of Graph Drawing
and Visualization*, CRC 2013. Garey & Johnson, "Crossing Number is NP-Complete,"
*SIAM J. Alg. Disc. Meth.* 4(3), 1983. Eades & Wormald, "Edge crossings in
drawings of bipartite graphs," *Algorithmica* 11, 1994. Tamassia, "On embedding a
graph in the grid with the minimum number of bends," *SIAM J. Comput.* 16(3),
1987. Garg & Tamassia, "On the computational complexity of upward and rectilinear
planarity testing," *SIAM J. Comput.* 31(2), 2001. Sugiyama, Tagawa, Toda, *IEEE
TSMC* SMC-11(2), 1981. Brandes & Köpf, "Fast and simple horizontal coordinate
assignment," GD 2001 (LNCS 2265; erratum arXiv:2008.01252). Purchase, "Metrics for
graph drawing aesthetics," *JVLC* 13(5), 2002.

**Label placement.** Kakoulis & Tollis, "Labeling Algorithms," ch. 15 in the
Handbook (CRC 2013); "On the Complexity of the Edge Label Placement Problem,"
*Comput. Geom.* 18(1), 2001 (ELP NP-hard, reduction from 3-SAT); "A Unified
Approach to Automatic Label Placement," *IJCGA* 13(1), 2003 (conflict-graph +
bipartite matching, maximize placed). Marks & Shieber, "The Computational
Complexity of Cartographic Label Placement," Harvard TR-05-91, 1991 (NP-complete;
optimal ⇔ P=NP). Formann & Wagner, SoCG 1991. van Kreveld, Strijk, Wolff, "Point
labeling with sliding labels," *Comput. Geom.* 13, 1999 (slider models, PTAS).
Bekos, Kaufmann, Symvonis, Wolff, "Boundary Labeling," *Comput. Geom.* 36(3), 2007
(crossing-free, all-labels, poly-time for one-/two-opposite-sided — the escape
hatch); Kindermann et al., "Multi-Sided Boundary Labeling," *Algorithmica* 76(1),
2016. Binucci et al., "Orthogonal drawings of graphs with vertex and edge labels,"
*Comput. Geom.* 32(2), 2005 (ILP, no-overlap by enlarging the drawing).

**Routing, ports, parallel edges.** Wybrow, Marriott, Stuckey, "Orthogonal
Connector Routing," GD 2009 (libavoid; per-connector bend/length optimal);
"Orthogonal Hyperedge Routing," Diagrams 2012. Spönemann et al., "Port Constraints
in Hierarchical Layout of Data Flow Diagrams," GD 2009 (FREE/FIXED_SIDE/
FIXED_ORDER/FIXED_POS). Rüegg et al., "Size- and Port-Aware Horizontal Node
Coordinate Assignment," GD 2015. Gansner, Koutsofios, North, Vo, "A Technique for
Drawing Directed Graphs," *IEEE TSE* 19(3), 1993 (edge label = virtual node).
Holten, "Hierarchical Edge Bundles," *IEEE InfoVis* 2006; Holten & van Wijk,
"Force-Directed Edge Bundling," *EuroVis* 2009 (bundling does not reduce
crossings).

**Constraint-based layout.** Dwyer, Koren, Marriott, "IPSep-CoLa," *IEEE TVCG*
12(5), 2006 (hard separation constraints by gradient projection); Dwyer, Marriott,
Stuckey, "Fast Node Overlap Removal," GD 2005 (VPSC, O(n log n)); Dwyer & Koren,
"Dig-CoLa," InfoVis 2005; Hoffswell, Borning, Heer, "SetCoLa," EuroVis 2018
(WebCola constraints degrade silently when infeasible).

**Robustness / exactness / verification.** Kettner, Mehlhorn, Pion, Schirra, Yap,
"Classroom examples of robustness problems in geometric computations," *Comput.
Geom.* 40(1), 2008. Yap & Dubé, "The exact computation paradigm," 1995. Shewchuk,
"Adaptive precision floating-point arithmetic and fast robust geometric
predicates," *DCG* 18(3), 1997. Edelsbrunner & Mücke, "Simulation of Simplicity,"
*ACM TOG* 9(1), 1990. Hobby, "Practical segment intersection with finite precision
output," *Comput. Geom.* 13, 1999. Fabri & Pion, "CGAL," ACM SIGSPATIAL 2009
(EPICK/EPECK). McConnell, Mehlhorn, Näher, Schweitzer, "Certifying algorithms,"
*Computer Science Review* 5(2), 2011. Alkassar, Böhme, Mehlhorn, Rizkallah,
"Verification of certifying computations," CAV 2011. Chen, Cheung, Yiu,
"Metamorphic testing," HKUST-CS98-01, 1998. Jackson, *Software Abstractions*, MIT
Press, 2006 (small-scope hypothesis).

**Industry practice surveyed.** yFiles (integrated vs. generic labeling;
`integratedEdgeLabeling` default false; ParallelEdgeRouter), Graphviz (`label`
dummy-node vs. `xlabel`/`forcelabels`; `concentrate`), ELK (`LabelDummyInserter`/
`Switcher`/`Remover`; BK vs. NETWORK_SIMPLEX placement), OGDF (ELabelInterface),
Adaptagrams/libavoid + cola.js, tldraw (`normalizedAnchor`/`isPrecise`/elbow
arrows), Excalidraw (`FixedPointBinding`), draw.io/mxGraph (`exitX`/`entryX` fixed
connection points; `mxParallelEdgeLayout` spacing).
