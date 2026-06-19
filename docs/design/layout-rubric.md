# Layout-Quality Rubric

Status: implemented — `src/layout-rubric.ts` (metrics), `eval/visual-rubric/` (harness + fixtures), `src/__tests__/layout-rubric.test.ts` (CI gates + property oracles).
Companion to `docs/design/route-contracts.md`.

## Why a deterministic rubric

The competitive analysis (appendix B) found that no tool in this space gates
layout quality with computable metrics: Graphviz's criteria live in the TSE93
paper (A1–A4) but its CI compares outputs textually; Mermaid relies on
pixel-diff visual regression (Argos/Applitools); D2 accepts goldens "if it
looks right" by eye. This rubric computes the literature's validated
aesthetics from final geometry on every test run, so "looks correct" is a
checkable claim, not a reviewer's impression.

## 1. Validated aesthetics (Purchase et al.)

| Aesthetic | Evidence that optimizing it helps comprehension | Key source |
|---|---|---|
| **Minimize edge crossings** | **Strong.** "By far the most important aesthetic" in controlled experiments. | Purchase 1997, *Which Aesthetic has the Greatest Effect on Human Understanding?*, GD'97 — [eprints.gla.ac.uk/35804](https://eprints.gla.ac.uk/35804/) |
| **Minimize bends** | **Weak-to-moderate**, direction confirmed. | Purchase 1997; Purchase 2000, *Effective information visualisation*, IwC 13(2) |
| **Path/edge continuity** | **Strong.** After path length, continuity and crossings-on-path dominate cognitive cost — the empirical justification for proof-carrying straightening. | Ware, Purchase, Colpoys & McGill 2002, *Cognitive Measurements of Graph Aesthetics*, IV 1(2) — [SAGE](https://journals.sagepub.com/doi/10.1057/palgrave.ivs.9500013) |
| **Maximize symmetry** | Weak, task-dependent. | Purchase 1997 |
| **Angular resolution** | No clear comprehension effect; legibility floor only. | Purchase 1997/2002 |
| **Orthogonality** | No direct evidence, but the substrate that makes bends countable and continuity checkable. | Purchase 2002, *Metrics for Graph Drawing Aesthetics*, JVLC 13(5) — [eprints](http://eprints.gla.ac.uk/35814/) |
| **Consistent flow direction** | Weak-to-moderate; universal in the Sugiyama tradition. | Purchase 2002 |

Edge labels: the Edge Label Placement problem is NP-hard; quality criteria
are (i) no overlap, (ii) **unambiguous association** with the labeled edge,
(iii) preferred positions — Kakoulis & Tollis, *Labeling Algorithms*,
Handbook of Graph Drawing ch. 15 ([PDF](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/labeling.pdf));
applied to layered drawings in Schulze et al.
([Kiel report 1802](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/report-1802.pdf)).

Open-source metric tooling: **gdMetriX** (GD 2024 — [docs](https://livus.github.io/gdMetriX/))
implements crossings/flow/orthogonality/angular metrics for straight-line
drawings; our rubric computes the orthogonal-polyline equivalents in-house.

## 2. The rubric (`src/layout-rubric.ts`)

HARD metrics — must be 0 for every diagram, enforced in CI for the entire
fixture battery and over randomized diagrams (property tests):

| Metric | Definition | Grounding |
|---|---|---|
| `offOutlineEndpoints` | endpoint not on the rendered shape outline (per-shape closed-form oracle, independent of the clipping code) | yFiles strong port constraints; shape fidelity |
| `diagonalSegments` | non-axis-aligned segment under orthogonal routing | Tamassia orthogonal tradition |
| `unexplainedBends` | bends on an edge certified `straight` | Purchase bends; route contracts |
| `hitches` | edge bends while a clear direct lane exists (re-proved on final geometry) | Ware continuity; issue #25 |
| `nodeOverlaps` | node bbox interiors intersect | hygiene |
| `labelOffRoute` | label pill farther from its own route than pill-height/2 + 4px | Kakoulis–Tollis unambiguity |
| `edgeThroughNode` | edge segment through a non-incident node interior | gdMetriX closest-element; hygiene |

SOFT metrics — reported per diagram and gated per fixture class
(`eval/visual-rubric/fixtures.ts` carries the thresholds; e.g. crossings = 0
and ≤ 2 bends/edge for the whole simple battery):

| Metric | Definition | Grounding |
|---|---|---|
| `edgeCrossings` | proper polyline∩polyline intersections (collinear port-merges excluded) | Purchase 1997 (strongest factor) |
| `totalBends`, `maxBendsPerEdge` | interior vertices | Purchase 1997 |
| `portEndpointRate` | fraction of edge ends exactly on a canonical port | yFiles port candidates |
| `portAnchoredEdgeRate` | fraction of edges with ≥ 1 port end | static-glue policy |

Additionally enforced upstream of the rubric (route contracts): repairs may
never increase crossings; feedback never shares the forward lane; flow
consistency is the classifier's definition of `feedback` itself.

## 3. Harness

```
bun run rubric:visual          # renders both batteries, writes HTML galleries
                               # + summary.json, exits nonzero on violations
bun test src/__tests__/layout-rubric.test.ts   # same gates in CI + property oracles
```

For PR review expectations, see [`../contributing/visual-review-evidence.md`](../contributing/visual-review-evidence.md).

- **Simple battery** (~120): every routing pattern (chain, diamond chain,
  labeled fan-out, fan-out×3, fan-in, reciprocal, retry, cycle, skip edge,
  self-loop, container) × all four directions, plus a chain and a
  reciprocal pair per shape (rect, rounded, stadium, circle, diamond,
  hexagon, cylinder, subroutine) × four directions, plus mixed-shape
  gauntlets.
- **Complicated set** (6): the issue #25 MFA regression, the README hero,
  the auth-flow with dashboard, nested subgraph direction overrides, a
  15-node release workflow with three cycles, and a double-diamond fan.
- **Property oracles** (fast-check, random diagrams over all shapes ×
  directions × patterns): endpoints-on-outline, certificate port-field
  truthfulness, zero hitches, all hard metrics zero.

The first property run immediately found a real pre-existing bug — stadium
endpoints floating off the semicircular ends (clipping only supported
diamonds) — which forced shape-aware clipping for the entire catalog
(`src/shape-clipping.ts`). That is the harness working as designed.

## Appendix A: "At least as good as the best", operationally

- **Straight-lane chains** — bar: Graphviz dot (perfectly straight chain
  spines). Ours: chain fixtures assert `maxBendsPerEdge = 0` along chains
  via the hitches/unexplained-bends gates, port-to-port when centers align.
- **Decision diamonds** — bar: yFiles, whose port-candidate documentation
  uses the flowchart diamond as its canonical example (fixed side-midpoint
  candidates with costs/capacities). Ours: the same model (`shapePorts` +
  static-glue-first candidate order).
- **Retry loops** — bar: yFiles `backLoopRouting` ("exit at the bottom and
  enter at the top"). Ours: ELK feedbackEdges + loop tightening exits the
  exact S/N port and enters the target's side midpoint.
- **Fan-in merges** — bar: ELK layered convergence. Ours: same-target edges
  may converge exactly collinearly at the shared port (single arrowhead).

## Appendix B: competitive findings (condensed)

- **Graphviz dot**: center-aim + clip by default; compass/record ports as
  opt-in; labels are virtual nodes (TSE93 §5.3) — the doctrine our label
  handling follows; back edges reversed internally, reciprocal pairs drawn
  as nodesep-offset parallel splines; regression suite compares outputs,
  no quality metrics in CI.
- **Mermaid (dagre)**: no ports at all (center-aim + boundary intersect);
  labels are dagre dummy nodes but re-placed post-hoc (misplacement issues
  #2793); long-standing edge-overlap complaints (#1006, #5060, #6336);
  visual testing is pixel-diff (Argos/Applitools).
- **D2**: dagre/ELK/TALA engines; **no user ports** (discussion #605,
  diamond attachment tracked in #1212); goldens accepted by eye
  (`TESTDATA_ACCEPT=1` "if it looks right"); publishes crossing-minimization
  rationale only.
- **PlantUML (activity beta)**: structured AST-driven layout — deterministic,
  crossing-free within constructs, dedicated loop-back channels (`backward`)
  — at the cost of expressiveness; no positional control (#1821).
- **yFiles**: the commercial reference — port candidates with costs and
  capacities (canonical example: the decision diamond), integrated
  layout-time labeling, back-loop routing, cost-driven bend-minimizing
  orthogonal router.
- **draw.io**: real Sugiyama (mxHierarchicalLayout) but floating perimeter
  attachment only; their own docs recommend floating over fixed points for
  auto-layout.
- **Excalidraw**: no auto-layout (delegates to Mermaid/dagre); best-in-class
  interactive single-edge A* elbow routing with aesthetic costs.
