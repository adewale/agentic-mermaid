# Route Contracts: Principled Routing Without Hitches

Status: implemented (Phases 0, 1 (complete), 3, and the first slice of Phase 4 of issue #25's rollout; see "Rollout status")
Supersedes: the draft spec in issue #25, whose claims this document re-verified against the code.

## 1. The problem

A **hitch** is a short dogleg on an edge whose semantics imply a straight lane:
the route jogs perpendicular to the flow axis even though nothing blocks the
direct lane. Issue #25 framed this correctly as a contract failure — the
pipeline encodes direction and rough placement, but never the invariant
"a forward edge is straight unless something provably blocks it."

Measured evidence (the MFA/login regression, `flowchart LR`, live
`layoutGraphSync` output before this work):

```
B -> C        (269.0,120.5) (375.7,120.5) (375.7, 97.8) (416.6, 97.8)   22.7px dogleg
D --Yes--> E  (813.6,152.3) (875.1,152.3) (875.1,158.0) (963.8,158.0)    5.7px dogleg
E -> F        ... (1209.5,147.0) (1209.5,147.0) ...                      duplicated point + 16.5px dogleg
F --Yes--> G  (1357.9,158.0) (1470.5,158.0) (1470.5,124.6) (1482.5,124.6) 33.4px doorstep jog
```

Every one of these edges is a forward edge whose direct lane is clear.

## 2. Verified claims (what issue #25 got right and wrong)

We re-verified every code claim in issue #25 before designing. Corrections
matter because they change where the fix belongs.

| Claim | Verdict | Evidence |
|---|---|---|
| "edge-point orthogonalization after ELK" exists | TRUE | `orthogonalizeEdgePoints()` `src/layout-engine.ts` — but it only fires for cross-hierarchy SEPARATE-mode edges |
| "layer-node snapping after ELK has already routed" | TRUE | `alignLayerNodes()` `src/layout-engine.ts` — adjusts only first/last edge points after moving nodes |
| "shape clipping after routing" | TRUE | `src/shape-clipping.ts`, diamonds only; runs after bundling |
| "branch bundling after route extraction" | TRUE | `bundleEdgePaths()` (SVG) and `src/ascii/edge-bundling.ts` (ASCII); bundled paths are fully rebuilt, so they are never stale |
| "ASCII path re-selection and label-line guessing" | TRUE | `src/ascii/edge-routing.ts`; FIFO tie-breaking already deterministic (`pathfinder.ts` `seq` field) |
| Hitches are caused by the aggregate of these passes | **FALSE for the common case** | Raw ELK output (before any post-pass) already contains every dogleg and the duplicated point listed above. The cause is ELK's FREE port placement spreading edge endpoints along node sides (B exits at y=120.5, C enters at y=97.8, both centers at y=126.7). |
| A simplifier exists but is unsafe | **FALSE** | There is no simplifier at all. `pointsToPolylinePath()` emits ELK's points verbatim — not even consecutive-duplicate or collinear-point removal. |
| No route classification exists | PARTIALLY TRUE | Cycle detection exists for ELK model order (`sourceAwareNodeOrder`), and fan-in/fan-out grouping exists in both bundlers, but nothing is unified or consumed as routing intent. |

Consequence: the first principled fix is **not** semantic ELK ports (issue
#25 Phase 2, large blast radius) but a **certifying route pass** after layout:
classify every edge, prove or refute the direct lane, straighten only with
proof, and certify everything else. Semantic ports remain the right Phase-2
follow-up; they reduce how often the prover has to repair, but the contract
layer is what makes either approach testable.

## 3. Design principles (inherited from issue #25, unchanged)

1. Intent before geometry — classify edges before deciding how they may bend.
2. Every bend must be intentional or explained — certificates, not vibes.
3. No post-layout node movement without rerouting or recertification.
4. Labels are route requirements: a straightened segment must host its label.
5. ASCII and SVG share route intent. The ASCII grid router already attempted
   direct lanes first with FIFO-deterministic ties; this work additionally
   gave its placement longest-path layering (a fan-in target sits after its
   DEEPEST parent, so a later parent's edge never runs backward — the ASCII
   side of acceptance criterion 1) and made label-segment choice prefer the
   widest fitting segment (a mid-route channel) over the shared final
   approach into a fan-in target.

## 4. Data model

```ts
type RouteClass =
  | 'primary-forward'   // added in author order without creating a cycle
  | 'feedback'          // would create a cycle; may straighten onto its OWN reverse lane, never the forward edge's lane
  | 'self-loop'
  | 'container'         // endpoint is a subgraph id
  | 'cross-hierarchy'   // endpoints in different subgraph scopes

interface RouteCertificate {
  edgeIndex: number          // index into MermaidGraph.edges
  routeClass: RouteClass
  bendCount: number
  invariant:
    | 'straight'             // exactly two points, axis-aligned with flow
    | 'explained-detour'     // bends, and directLaneBlockedBy is non-empty
    | 'bundle'               // path owned by the fan-out/fan-in bundler
    | 'outer-feedback'       // feedback routed around the nodes through an outer channel (ELK feedbackEdges + tightening)
    | 'feedback-detour'      // feedback whose reverse lane is blocked; blockers say why
    | 'self-loop'
    | 'container-attach'
  directLaneClear?: boolean  // primary-forward and feedback
  directLaneBlockedBy?: Array<{ kind: 'node' | 'label' | 'channel' | 'span' | 'crossing'; id: string }>
  straightened?: boolean     // true when the certifying straightener collapsed the route
}
```

`PositionedEdge` gains an internal `edgeIndex` so certificates can be
recomputed from `(MermaidGraph, PositionedGraph)` by any consumer (verify,
tests, debug tooling) without trusting the layout pass to hand them over.

## 5. Edge classification

Mirrors the cycle detection ELK's model order already uses, so classification
and layout cannot disagree:

1. Walk `graph.edges` in author order, adding each edge to a reachability
   relation unless `target` already reaches `source`; those become `feedback`.
2. `source === target` → `self-loop`.
3. Endpoint is a subgraph id → `container`.
4. Endpoints in different subgraph scopes → `cross-hierarchy`.
5. Everything else → `primary-forward`.

In `B --> C; C -- No --> B`, `B->C` is primary-forward and owns the straight
lane; `C->B` is feedback — it may render as a straight parallel back-edge on
its own lane (the classic reciprocal-pair rendering) but never on the forward
edge's lane. This matches what ELK's
`cycleBreaking.strategy: MODEL_ORDER` already decided, so the certificate
describes reality rather than re-deriving a parallel truth.

## 6. The certifying straightener

Runs at the end of `elkToPositioned()`, after bundling and shape clipping,
immediately before bounds are computed. Two layers:

**Proof-free simplifications (all edges):** remove consecutive duplicate
points and collinear midpoints. These preserve the drawn geometry exactly;
no certificate change beyond `bendCount`.

**Proof-carrying straightening (primary-forward and feedback, not bundled,
both endpoint shapes straightenable):** a route that is monotone along the
edge's own flow axis but not straight is collapsed to a single axis-aligned
segment iff a *candidate lane* exists that is provably clear. Feedback edges
run the identical proof with the axis sign flipped: their forward-facing
side is the graph's backward-facing one. The channel-separation check below
is what keeps a straightened feedback lane off the forward edge's lane —
a reciprocal pair renders as two parallel arrows, never one merged line.

Candidate lanes, tried in order (cross-axis coordinate for LR = y):

1. the current target endpoint's cross-coordinate (moves only the source end),
2. the current source endpoint's cross-coordinate (moves only the target end),
3. the extremes of the existing route — the outer channel the router already
   proved navigable (this is how a feedback edge wrapping a node collapses
   onto a single straight back-lane beside it),
4. the center of the overlap of both nodes' attachment spans,
5. the quartiles of that overlap — an unlabeled feedback loop's own cross
   values all sit on the forward lane or outside the span, so the parallel
   back-lane that collapses it to the classic two-arrow rendering lies
   between the span center and a span end.

A candidate is valid when it lies inside both endpoint nodes' attachment
spans (diamonds allow the whole facet minus a 10px vertex margin — the
flowchart convention attaches anywhere along the slanted edge, and a
proportional restriction needlessly forbade straight lanes to partners
sitting off the diamond's centerline; rectangles use the full side minus a
4px margin), and the lane is **clear**:

- it does not pass through any other node's bounding box (4px inflation;
  bbox is a conservative over-approximation of non-rectangular shapes — it
  can only suppress a legal straightening, never allow an illegal one),
- it does not pass through any other edge's label **pill** (measured text
  plus the renderer's 8px pill padding, at current positions at proof time;
  one exception: a primary edge's proof ignores the label of its reciprocal
  feedback partner — primary owns the lane, and the partner's label is
  movable decoration that is re-placed when the partner straightens, or
  stays on its detour),
- it does not run collinearly (within a 4px corridor) along another edge's
  parallel segment ("channel" blocker),
- if the edge has a label, the new segment has capacity for the pill
  (pill extent along the lane + clearance), and an **on-lane label slot**
  exists — midpoint, then 1/3, then 2/3 — whose pill rect is clear of
  nodes, other pills, and other edges' segments. On-lane only: a label
  must sit on its own route so the label-to-edge association stays
  unambiguous (Kakoulis & Tollis' edge-label-placement criterion; dot
  realizes the same doctrine by making labels virtual nodes with reserved
  layout space). A labeled edge whose lane cannot host its pill does not
  straighten — it keeps its certified outer loop, where ELK's inline label
  dummy has reserved space ON the loop,
- it does not **increase edge crossings**: a perpendicular crossing is
  legal when the router chose it, but a repair (straightening or loop
  tightening) must never create one the original route avoided. The
  fixed-point iteration makes this constructive: tightening a loop out of
  a sibling's corridor unblocks the sibling's straightening on the next
  round.

Endpoints are re-anchored on the actual shape boundary: rectangle-like
shapes by side intersection, diamonds by ray-polygon intersection (the same
machinery as `shape-clipping.ts`). Shapes outside the straightenable set
(circle, stadium, asymmetric, …) are skipped, because today their endpoints
sit on the bbox and a straightened lane could visibly detach from the
rendered outline; they keep their ELK route and certify as explained or
unverified-shape detours.

Edges are processed in author order, each straightening updates the
geometry the next proof sees, and the pass iterates to a fixed point:
straightening one edge can vacate the channel that blocked a sibling
(duplicate parallel edges do exactly this), so blocked edges are re-proved
until nothing changes. The pass is deterministic and never lets two
straightened lanes collide (the channel check sees prior results).

If no candidate lane is clear, the certificate records
`invariant: 'explained-detour'` (`'feedback-detour'` for feedback edges)
with the concrete blockers, e.g. the MFA fixture's `D --No--> G` is blocked
by node `F` standing in every candidate lane — exactly the explained detour
issue #25 demands.

**Bundle contract (issue #25 Phase 4, first slice):** the fan-out/fan-in
bundler used to rebuild trunk paths with no obstacle awareness, so a skip
edge in `A --> X; A --> B; X --> B` could run its trunk straight through
`X`'s box. Bundled paths are now proved clear of every non-endpoint node
before they are assigned; a blocked member falls out of the bundle (keeping
its ELK route, which the route-contract pass then straightens or explains),
and the junction is re-derived from the members that remain.

**Feedback routing (issue #25 §8.1/§11.3, literature-grounded):** feedback
edges no longer compete with their forward partner for the same
flow-facing side. `elk.layered.feedbackEdges: true` (the option issue #25
§10 listed, enabled now that classification is wired) routes reversed
edges *around* the nodes through an outer channel — so the forward lane of
a reciprocal pair is straight directly out of ELK, and the loop carries
its inline label with reserved space. On top of ELK's loop the pass runs
**loop tightening**: ELK can wrap a loop around the source's forward side
before reaching its channel, parking the drop column in a sibling's
corridor; when the source's channel-facing facet (the decision diamond's
"bottom port") can reach the channel directly — on-boundary when the shape
spans the channel, else via one short proven hop — the excursion is cut.
Certified `outer-feedback`. Unlabeled feedback whose parallel reverse lane
proves clear still collapses to the classic two-straight-arrows rendering;
labeled feedback keeps the loop because its pill belongs ON its route.

**Container repair (spec §11.5):** under SEPARATE hierarchy mode (subgraph
direction overrides) ELK could leave a container-to-container edge floating
in the diagram margin, attached to neither box — the
`ROUTE_CONTAINER_MISANCHOR` tripwire caught exactly one such edge in the
docs corpus. When the two end rects are cleanly separated along one axis,
the route collapses onto a proven straight lane between the facing borders
(the container rect stands in as a rectangle; the lane axis comes from how
the rects are separated, not the graph direction). Composite-state edges
onto containers straighten through the same path.

### 6.1 Diamond ports: what the literature says (and what we adopted)

Our diamonds support geometrically unbounded attachment (endpoints
ray-clip onto the polygon), but the lane logic originally used only the
two flow-facing facets — the N/S facets sat unused, which is what forced
reciprocal pairs and their labels into a corridor capped by the node
height. The literature pass that fixed this:

- Ports on all four sides with constraints is the standard layered model —
  Schulze, Spönemann & von Hanxleden, *Drawing Layered Graphs with Port
  Constraints*, JVLC 2014 (ELK Layered's foundation).
- Labels are layout citizens with reserved space on their own edge — dot
  represents edge labels as virtual nodes (Gansner, Koutsofios, North &
  Vo, TSE 1993); ELK's inline edge labels are the same mechanism; Kakoulis
  & Tollis' edge-label-placement criteria demand unambiguous
  label-to-edge association.
- Feedback routes around the drawing through outer channels — the
  Sugiyama tradition, shipped as `elk.layered.feedbackEdges`.
- Flowchart convention (ISO 5807 lineage) attaches decision branches at
  the vertices, leaving in different directions.

Adopted (issue #26 Workstream 3, realized): every shape carries four
canonical **ports** at its bbox side midpoints — `shapePorts()` — which lie
exactly on the rendered outline for the whole catalog, because each shape
is symmetric and inscribed in its bbox: the diamond's N/E/S/W *vertices*,
the rectangle's side *midpoints*, and the boundary extremes of circles,
stadiums, hexagons and cylinders are the same four points. The industry
model behind this is yFiles port candidates (fixed anchors with costs and
capacities) and Visio connection points with static vs dynamic glue:

- **Static glue first**: straightening tries the lane through the target's
  port, then the source's, before any floating candidate — aligned chains
  run port to port, and a fan-in target receives its edge at the exact
  side midpoint. Same-target edges may converge exactly collinearly at the
  shared port (the classic fan-in merge into one arrowhead).
- **Dynamic glue second**: when centers don't align, a straight lane still
  beats a port-pure Z-bend; the off-port end floats on the side/facet
  (Mermaid's own attachment model). A port lane may attach its floating
  end closer to a diamond vertex than the 10px aesthetic margin — exact
  connection points outrank the margin.
- **Loops are port-exact**: feedback exits the source's channel-facing
  port (the diamond's exact S/N vertex) and enters the target's
  channel-facing side midpoint, with short proven hops to the channel.
- **Port-only shapes**: circle, doublecircle, stadium, hexagon, cylinder
  and the state pseudostates joined the straightenable set — their bbox
  side midpoints are their only on-outline bbox points, so they accept
  port lanes exactly and nothing else.
- Certificates record `sourcePort`/`targetPort` whenever an endpoint sits
  on a canonical port, computed after all geometry settles.

Class, ER and state diagrams inherit all of this through their projected
graphs; architecture's side-anchored syntax (`L`/`R`/`T`/`B`) maps 1:1
onto `W`/`E`/`N`/`S` ports. Sequence/timeline have no graph ports —
their anchors are lifelines and intervals (issue #26 WS1 family
certificates).

### 6.2 Port ranking — the cost model over the four ports

Ports are ranked, per shape and per side, following the yFiles
port-candidate cost model (fixed candidates with costs + overflow):

1. **A side carrying exactly ONE line uses its canonical port** — the
   diamond's *vertex* (the sharp bit), the side *midpoint* elsewhere. For a
   single-line diamond side this is absolute: if no straight lane through
   the vertex exists, a single proof-gated Z from the vertex into the
   target's port still outranks a straight lane floating on the facet —
   lines emit from points (dot and yFiles draw decisions the same way).
   The fixed-point loop upgrades the Z back to a straight vertex lane the
   moment a blocking obstacle moves.
2. **A side carrying several lines spreads them** along its legal region
   (facet/flat) — no line hogs the point. Fan-ins INTO a side still prefer
   the target port, where same-target edges merge into one arrowhead.
3. **When two single-line port lanes conflict** (misaligned centers), the
   sharper shape wins — vertex (sharpness 2) over flat midpoint (1) — and
   the source wins ties (emit beats receive).
4. Curved/pointed regions never take floating attachment (port-only);
   flat regions (hexagon/stadium N–S, cylinder E–W walls) absorb overflow.
5. **A reciprocal pair (unlabeled A→B with unlabeled B→A) renders as TWO
   EQUAL parallel lines**, straddling the shared centerline at
   `pairCenter ± PAIR_SEPARATION/2` (primary on the low side, feedback on
   the high side — deterministic, never colliding). Equal deviation from
   the center gives equal lengths: a diamond facet's width depends on the
   lane's distance from the vertex, so an asymmetric split would draw one
   long and one short arrow. This is how dot offsets reciprocal splines
   symmetrically about the spine. Both pair members enroll in the
   fixed-point pool even when already straight and on-port: the symmetric
   lane usually only proves clear after the partner has been repaired, so
   a member that had to settle for a fallback lane (an *upgradeable*
   success — any straightening that won on a non-preferred candidate) is
   re-proved each round until the symmetric lane wins or geometry stops
   moving. Port-only shapes (circles) keep both lines on the exact port —
   their spans admit no offset, by rule 4.

Occupancy is computed from route classes: primary edges count on the flow
sides, unlabeled feedback on the flipped sides (parallel back-lanes), and
labeled feedback not at all (it leaves via the outer channel's N/S ports).
A bi-directional pair therefore puts two lines on each facing side —
the symmetric pair of rule 5 — while a retry diamond's forward side
carries one line and gets the vertex.

### 6.3 Hardening found by the property oracles (layout-rubric harness)

Randomized property tests over all shapes × directions × patterns
(`src/__tests__/layout-rubric.test.ts`) drove these fixes — each was a real
defect class found by a counterexample, now pinned:

- **Shape-aware clipping for the whole catalog** (`src/shape-clipping.ts`):
  circle/ellipse, stadium, hexagon, and cylinder outlines (clipping
  previously existed only for diamonds, so off-port endpoints floated off
  curved outlines). Cylinder cap clipping keeps the ray's own coordinate so
  segments stay orthogonal.
- **Occlusion-safe layer alignment**: `alignLayerNodes` no longer snaps a
  layer when the move would park a node on an already-routed foreign edge
  corridor — the root cause of stale through-node routes (rule 9 enforced
  at the source).
- **Through-node repair triggers**: a route passing through a node's bbox
  triggers the Z-repair regardless of bend count, for primary, feedback,
  and straight-certified edges; removing an occlusion outranks the
  never-increase-crossings rule (a legal crossing beats an occlusion).
- **Flat-side spans**: hexagon N/S, stadium N/S and cylinder E/W sides are
  flat regions on the bbox edge, so they accept attachment anywhere on the
  flat (yFiles overflow-candidate pattern); only the curved/pointed pair is
  port-only. Duplicate edges from such shapes get parallel anchors instead
  of fighting over one port.
- **Fixed-point completeness**: geometry mutations from loop tightening and
  Z-repairs drive the retry loop like straightenings do, and
  `simplifyPolyline` iterates to a fixed point (ELK emits degenerate
  zero-net spikes whose midpoints only become collinear after their
  neighbors are removed).
- **Residual diagonal orthogonalization**: ELK's feedback router rarely
  joins a port with a 45° segment; such segments are replaced with an
  axis-aligned elbow continuing the previous segment's axis.
- **ELK crash degradation ladder**: the bundled GWT build of ELK throws
  internal exceptions on rare dense multigraphs (one trigger pre-existing,
  one via feedbackEdges). `layoutGraphSync` retries through progressively
  plainer option sets; the route pass repairs whatever the survivor
  produces. Crash-freedom is part of the renderer's contract.

## 7. Validation: the ROUTE_* tripwires (issue #25 Phase 1, complete)

`verifyMermaid` gains six Tier 2 (geometric, advisory) warnings. The layout
pipeline upholds every one of these invariants itself, so the warnings are
tripwires: they fire only when a pass mutates geometry after route
certification, or the pipeline regresses. All are recomputed over the FINAL
positioned graph, not trusted from the layout pass, and all are zero across
the docs corpus by construction (the one corpus hit during development was
a real floating-edge bug, which was then fixed — see "Container repair").

```
ROUTE_HITCH                { edge, deviationPx }  bends although a clear lane exists (flipped axis for feedback)
ROUTE_UNEXPLAINED_BEND     { edge }               diagonal segment under orthogonal routing
ROUTE_LABEL_ON_SHARED_TRUNK{ edge, sharedWith }   label pill on a line segment another edge shares collinearly
ROUTE_CONTAINER_MISANCHOR  { edge, container }    container edge not terminating on the container border (§11.5)
ROUTE_SHAPE_MISANCHOR      { edge, node }         endpoint off the rendered shape boundary (§11.6; rect-like + diamond)
ROUTE_STALE_AFTER_NODE_MOVE{ edge, node }         endpoint detached from its node entirely
```

Shapes without an anchor contract yet (circle, stadium, …) are exempt from
`ROUTE_SHAPE_MISANCHOR` rather than flagged — their endpoints sit on the
bbox today and warning on every one would be noise, not signal.

Still deliberately out of scope:

- Mutating ELK port constraints (`FIXED_SIDE` etc.) — issue #25 Phase 2.
  Re-evaluated with the prover in place: `FIXED_SIDE` alone cannot pin port
  *positions* (only sides, which ELK already picks correctly here), so it
  would not remove the endpoint spread that causes hitches; `FIXED_POS`
  everywhere would fight ELK's crossing minimization. The certifying pass
  is the load-bearing mechanism; ports are worth revisiting only if corpus
  evidence shows side-choice errors.

## 8. Pipeline placement

```
parse
  -> MermaidGraph
  -> mermaidToElk (model-order cycle breaking ≙ classification)
  -> ELK layered layout
  -> extractEdgesRecursively (+ orthogonalize cross-hierarchy)
  -> alignLayerNodes
  -> bundleEdgePaths (returns the set of bundle-owned edges)
  -> clipEdgeToShape
  -> route contracts: classify -> simplify (proof-free) -> straighten (proof-carrying) -> certify
  -> bounds, renderer
```

The hard rule from issue #25 stands: no node-coordinate mutation after the
route-contract pass. `alignLayerNodes` runs before it, so any endpoint drift
it introduces is repaired or explained by the certifying pass rather than
shipped.

## 9. Testing strategy (per testing-best-practices)

- **Red-first regression**: the MFA/login fixture asserts every
  primary-forward edge with a clear lane renders with exactly two
  axis-aligned points; written failing against the pre-change renderer.
- **Blocked-lane regression**: inserting a blocker node into the direct lane
  must prevent straightening and produce `explained-detour` naming the
  blocker (acceptance criterion 4).
- **Unit tests**: `classifyRoutes` (primary/feedback/self-loop/container),
  `directLaneClear` (node, label, channel, span blockers each),
  straightener safety (no straightening without proof; label capacity).
- **Property tests (fast-check)**: random small DAG-ish flowcharts —
  certificates exist for every edge; no primary-forward hitch survives when
  the prover says the lane is clear; straightened endpoints remain on shape
  boundaries; repeated runs byte-identical (determinism).
- **Goldens**: ASCII goldens must not change (`goldens:ascii:check`); SVG
  changes are reviewed via the corpus comparison harness
  (`eval/layout-compare`) — regressions-first verdicts, not eyeball-only.
- **Mutation testing**: the route-contracts module joins the scoped Stryker
  lane so a deleted proof check cannot survive.

## 10. Rollout status vs issue #25

| Issue #25 phase | Status here |
|---|---|
| Phase 0 — diagnostics (classification + certificates) | implemented |
| Phase 1 — validation warnings | complete: all six ROUTE_* codes implemented as zero-noise tripwires |
| Phase 2 — semantic `FIXED_SIDE` ports | re-evaluated and not needed for hitches (see §7): FIXED_SIDE cannot pin positions, and the prover already enforces the outcome ports were meant to produce; revisit only on corpus evidence of side-choice errors |
| Phase 3 — certifying simplifier | implemented (proof-free + proof-carrying layers) |
| Phase 4 — bundle contract | first slice implemented: bundled paths are proved clear of nodes, blocked members fall out of the bundle; per-trunk certificates deferred |
| Phase 5 — family adoption | graph-projected families (state composites, class/ER/architecture via layoutGraphSync) already flow through classification, straightening, container repair, and certificates; non-graph families (sequence/timeline/charts) need family-specific layout certificates per issue #25 §14 — out of routing scope |

## 11. Acceptance criteria mapping

1. MFA/login renders straight forward edges when lanes are clear, in SVG **and** ASCII (longest-path ASCII layering put the fan-in join after its deepest parent; regression tests on both renderers + regenerated visual evidence).
2. Feedback retry edges emit feedback-route certificates — straight-with-proof (labeled ones park their pill in the open canvas beside the lane), `feedback-detour` with blockers otherwise — unit + regression test.
3. Disabling the direct-lane proof reintroduces a failing test — `ROUTE_HITCH` tripwire + straightener unit tests + mutation lane.
4. A blocker node prevents straightening with an explained-detour certificate — blocked-lane regression.
5. Diamond endpoints land on the diamond polygon, not bbox corners — ray-intersection re-anchoring + property test + `ROUTE_SHAPE_MISANCHOR` tripwire.
6. No node movement after the route pass — pipeline placement + `ROUTE_STALE_AFTER_NODE_MOVE` tripwire.
7. Corpus diff shows no regressions — `eval/layout-compare` runs recorded in the PR (18 changed / 0 regressions for the full batch).
8. Diagnostics available to tests and the debug UI — `classifyRoutes` / `auditRouteContracts` / `findRouteHitches` exported, and `layoutMermaid(d, { debug: true })` attaches each edge's `RouteCertificate` to the layout JSON (issue #25 open question 1, as recommended).

## 12. Issue #25 open questions, resolved

1. *Certificates public or test-only?* — exposed via `layoutMermaid(d, { debug: true })` (the issue's own recommendation); default output unchanged.
2. *Mermaid source route hints?* — no, as recommended; intent stays inferred from semantics and author order.
3. *Should feedback always detour?* — resolved by adopting ELK's feedbackEdges outer-channel routing plus loop tightening: labeled feedback loops around the nodes (label riding the loop with reserved space), unlabeled feedback collapses to a parallel straight back-arrow when provably clear. Feedback never shares the forward lane.
4. *Should labels force a bend?* — a label may only sit ON its own route (Kakoulis–Tollis unambiguity; dot's virtual-node doctrine). If the straight lane cannot host the pill, the edge keeps its outer loop — the canvas grows to make room, the label never floats beside a lane it doesn't belong to.
5. *Should architecture use ELK?* — unchanged: architecture keeps shared placement plus its own side-anchored rerouting; its graphs flow through classification/certification like every layoutGraphSync caller.
