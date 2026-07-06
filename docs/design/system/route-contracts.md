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

type RouteInvariant =
  | 'straight'             // exactly two points, axis-aligned with flow
  | 'explained-detour'     // bends, and directLaneBlockedBy is non-empty
  | 'bundle'               // path owned by the fan-out/fan-in bundler
  | 'outer-feedback'       // feedback routed around the nodes through an outer channel (ELK feedbackEdges + tightening)
  | 'feedback-detour'      // feedback whose reverse lane is blocked; blockers say why
  | 'self-loop'
  | 'container-attach'
  | 'unverified-shape'     // endpoint shape has no straight attachment side

type RoutePortAssignment = {
  side: 'N' | 'E' | 'S' | 'W'
  slotIndex: number          // 0-based order along that side
  slotCount: number          // endpoints allocated to this node side
  role: 'flow-source' | 'flow-target' | 'feedback-source' | 'feedback-target'
    | 'self-loop-source' | 'self-loop-target'
    | 'container-source' | 'container-target'
    | 'cross-hierarchy-source' | 'cross-hierarchy-target'
  port?: AnyPort             // exact designated port when final geometry lands on one
}

type RouteCertificateBase = {
  edgeIndex: number          // index into MermaidGraph.edges
  routeClass: RouteClass
  bendCount: number
  directLaneClear?: boolean  // primary-forward and feedback
  directLaneBlockedBy?: Array<{ kind: 'node' | 'label' | 'channel' | 'span' | 'crossing' | 'port'; id: string }>
  sourcePort?: AnyPort
  targetPort?: AnyPort
  sourcePortAssignment?: RoutePortAssignment
  targetPortAssignment?: RoutePortAssignment
}

type RouteCertificate =
  | (RouteCertificateBase & {
      invariant: 'straight'
      straightened?: true    // true only when the final route is two-point straight
    })
  | (RouteCertificateBase & {
      invariant: Exclude<RouteInvariant, 'straight'>
      straightened?: never   // detours cannot carry stale straightening metadata
    })
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

Diamond fan-outs have one extra port-constraint case: when sibling decision
branches share a target rank, branches spread across the diamond's facet/cardinal
ports and still enter each peer target through its facing cardinal port. If those
two port lanes differ, a straight segment would have to give up one endpoint
contract; the branch is therefore certified as an `explained-detour` blocked by
`kind: 'port'`, and verification treats the Z-route as intentional only while
the final endpoints still sit on the selected ports.

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
- Certificates also record `sourcePortAssignment`/`targetPortAssignment`,
  the dynamic allocator's additive side/slot/role view: physical side,
  deterministic slot order along that side (`N/S` left→right, `E/W`
  top→bottom), semantic role (`flow-*`, `feedback-*`, etc.), and the exact
  `AnyPort` when the final endpoint is designated. This does **not**
  reinterpret the V1 `sourcePort`/`targetPort` vocabulary; it is the stable
  bridge for debugging and for feeding port intent into placement.
- Pre-layout placement now consumes a conservative slice of the same intent:
  primary-forward edges get ELK node-port hints on the flow sides (`E/W` for
  LR/RL, `S/N` for TD/BT), and eligible unlabeled rectangle/diamond feedback
  edges get flipped-side `FIXED_SIDE` hints on the return lane. Duplicate
  feedback ports also record deterministic side slots, but feedback
  `FIXED_ORDER` remains deferred: the measured contact-sheet duplicate-feedback
  case regressed when ELK was allowed to enforce order. Self-loop, labeled
  feedback, non-rect/diamond feedback, container, cross-hierarchy and
  direction-override cases are explicitly relaxed and recorded as diagnostics,
  leaving family-specific contracts to the final certificate pass.

State diagrams inherit all graph certificates through their projected graphs
(`stateBodyToGraph` → `layoutGraphSync`). Non-graph families expose
family-specific certificates only when they own a final-geometry model:
architecture debug layouts now emit `family-layout` / `side-anchored`
endpoint-side certificates after the architecture reroute, while class and ER
debug layouts emit `family-layout` / `orthogonal-box` certificates for
relationship endpoints anchored on class/entity boxes. Default layout JSON
remains certificate-free.

Class and ER still render through their own ELK engines (`src/class/layout.ts`,
`src/er/layout.ts` call `elkLayoutSync` directly), so they do not participate
in the graph route straightener or port ranking. This is deliberate: class and
ER boxes carry compartment/attribute-row geometry and cardinality endpoint
semantics that the generic flowchart graph pass does not model. Projecting them
through `MermaidGraph` would either discard those row/compartment constraints or
require a second family-specific clipping pass after graph certification, which
would recreate the stale-certificate problem this document forbids. Their
`FamilyEdgeRouteCertificate`s and verify tripwires cover the accepted invariant instead:
orthogonal relationship paths, on-canvas non-overlapping boxes, and endpoints on
class/entity boundaries. Sequence messages likewise expose opt-in family `lifeline-message`
`FamilyEdgeRouteCertificate`s, while timeline/chart families expose
`RegionContainmentCertificate`s. These are family-specific certificates rather
than graph-route ports:
sequence anchors are lifelines, and timeline/chart anchors are intervals,
plot boxes, legend rows, sections, or quadrant regions.

### 6.2 Port ranking — the cost model over the four ports

Ports are ranked, per shape and per side, following the yFiles
port-candidate cost model (fixed candidates with costs + overflow):

1. **A side carrying exactly ONE line uses its canonical port** — the
   diamond's *vertex* (the sharp bit), the side *midpoint* elsewhere. For a
   single-line diamond side this is absolute: lines emit from points (dot
   and yFiles draw decisions the same way), and when the straight vertex
   lane is blocked the repairs rank by bend count:
   1. the straight vertex lane (0 bends);
   2. the **1-bend hook**: vertex lane along the flow axis, then one
      perpendicular stub into the target's *facing* cross-side port — the
      box's top/bottom in horizontal flow (the entry the IBM flowcharting
      manuals illustrate). Requires the vertex lane to clear the target's
      cross extent and a stub of at least `HOOK_STUB_MIN = 8` px (a
      shorter stub reads as a hitch, not an entry — the degenerate TD/BT
      case keeps its Z). **A fan-in merge outranks the hook**: when a
      same-target sibling already holds the flow-side entry port, the Z
      that converges there into one shared arrowhead (yFiles edge
      grouping; Kakoulis–Tollis unambiguity) beats splitting the fan-in
      across two sides;
   3. the 2-bend Z from the vertex into the target's flow-side port.
   The fixed-point loop upgrades hook/Z back to a straight vertex lane
   the moment a blocking obstacle moves, and downgrades an
   order-dependent hook to the merging Z once the sibling settles on the
   shared port.
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

#### 6.2.1 Where multi-line attachment lands: competitive + literature grounding

When a side carries several lines (rule 2), each line takes a straight
lane into its own target's port, so the attachment points on the source
facet are **target-determined** — they land wherever those lanes cross the
facet, and are therefore *not* rotation-consistent across flow directions
(a 2-way fan-out attaches at ~20%/80% of the facet in LR but ~6%/94% in
TD, because ELK spaces siblings by node heights in one axis and widths in
the other). This is a deliberate choice; the verified landscape
(primary-source research, June 2026):

- **Graphviz dot does what we do**: portless edges are "aimed at the
  node's center and … clipped at the node's boundary" (dotguide §3.1,
  TSE93 §5) — attachment is a byproduct of the route. Merging endpoints
  is opt-in (`samehead`/`sametail`).
- **ELK does the opposite**: FREE ports get a side from edge direction,
  a crossing-minimal order (barycenter heuristic), then coordinates by
  even distribution (`portAlignment=DISTRIBUTED`). Schulze/Spönemann/von
  Hanxleden (JVLC 2014) themselves show even distribution causing
  avoidable bends and name "local adjustments to eliminate edge bends"
  (their Fig. 4b) as the alternative — the certifying straightener is
  that adjustment, applied proof-first.
- **yFiles splits the difference**: `PortAssignmentMode.DEFAULT`
  "distributes ports evenly along the border of the node" (corner gap =
  ½ inter-port gap — rotation-consistent), then buys straightness back
  with a bounded correction (3.x `maximumPortDeviation`, default 3px;
  2.x `straightenEdges` was off by default and mutually exclusive with
  symmetric placement). Its flowchart-specific layer
  (`FlowchartLayout`, demo source) instead *avoids* shared facets:
  Yes-branches get `WithTheFlow`, No-branches `Flatwise` (a side
  vertex), deterministically de-conflicted — as soft port candidates
  that crossing minimization may override.
- **Standards do NOT mandate vertex exits**: ISO 5807:1985 (verified via
  its identical GOST 19.701-90 adoption) says lines enter left/top,
  leave right/bottom, "directed toward the **center** of the symbol" —
  dot's model, not a vertex rule. ANSI X3.5-1970 has no attachment rule
  at all, and neither standard assigns yes/no to sides; both require
  every decision exit to be labeled. Vertex exits (top in; left/right/
  bottom out) are an IBM-illustrated convention (C20-8008 1959,
  GC20-8152 1969) whose own text permits exit "in any direction".
- **Academia has no direct answer**: the validated priority order is
  crossings ≫ bends/continuity > symmetry (Purchase GD'97/JVLC 2002;
  Ware et al. 2002 on path continuity), and the node-placement
  literature trends toward straightness through ports (Brandes–Köpf;
  Rüegg et al. GD'15). Port assignment exists as a named phase since
  Sander (GD'95) — order from crossing reduction, raster coordinates —
  and Eichelberger's UML aesthetics *desire* equal port spacing, but
  **no study has ever compared attachment-point policies empirically**;
  the question is settled by tool convention.

Conclusion: straight-into-the-target-port maximizes the empirically
supported aesthetics (zero bends, continuity, exact target ports) at the
cost of the weakest one (rotation-consistent source attachment). The
known divergence from yFiles/ELK even-spread is accepted. A strict
"midpoint-only ports" ranking flip was prototyped and measured AGAINST:
on the docs corpus it converted 3 straight edges into 2-bend Zs for a
+1.9pp port-rate gain, and our own hitch prover correctly flagged the
new Zs (a clear straight lane existed). The asymmetry's real fixes are
**placement-side**: the port-lane alignment pass below, and (future
work) yFiles-style branch-direction assignment — give each decision
branch its own side pre-layout, so no facet carries two lines.

#### 6.2.2 Port-lane alignment — the placement repair

"Straight but off both midpoints" (an edge floating through the sliver
where two side-spans overlap) is a *placement* defect, not a routing
choice: ELK's BALANCED node placement averages competing pulls and
aligns the node with neither neighbor, and no routing-side repair can
reach "straight AND port-exact" from there. `alignPortLanes`
(`src/layout-engine.ts`, after `alignLayerNodes`, before bundling)
slides ONE endpoint node along the cross axis so the two midpoint ports
share a lane — the port-aware coordinate assignment of Rüegg et
al. (GD'15), applied as a targeted post-pass. ELK option alternatives
were measured and rejected: `favorStraightEdges` is a no-op under
BALANCED; `NETWORK_SIMPLEX` straightens one edge while un-porting
another; `bk.fixedAlignment: LEFTUP` gets a similar local result but
sacrifices the globally symmetric placement BALANCED provides.

Every slide is proof-gated, mirroring the occlusion doctrine:

- candidates are monotone flow-axis staircases (≤ 4 simplified points)
  between rect-like endpoints with misaligned midpoint lanes;
- the resulting shared port lane must be clear of intermediate nodes
  (otherwise the slide manufactures a through-node route the
  straightener can never collapse);
- the slid node's other edges must be bent, with a perpendicular
  segment to absorb the shift; their terminal runs translate, and a
  label pill riding a translated run follows it;
- the new bbox keeps clear of nodes, foreign edge corridors, and label
  pills; group members never move;
- both endpoints of an applied alignment are FROZEN — a later slide may
  not re-break a proven alignment (the cascade hazard found by the
  property oracle).

Downstream, the certifying straightener collapses the aligned staircase
onto the shared port lane with its usual proof, and the fan-in rules
compose: once the side input holds the target's entry port, a
co-terminating decision branch converges there (merge outranks the
hook). Corpus effect: straight edges 97 → 99, multi-bend routes 7 → 6,
port-exact endpoints 76.0% → 77.1% — better on every axis, where the
ranking-flip experiment traded one metric for another.

The pass covers the whole **PORT_EXACT catalog**, not just rects:
circles, stadiums, hexagons, cylinders, pseudostates, and diamonds all
slide (port-only shapes can never be "straight but off-port", so for
them the slide converts a forced 2-bend Z into a port-to-port
straight). Three additional proof obligations came with the extension,
each driven by a property-oracle counterexample or a pinned example:

- the straight-edge re-anchor uses `shapePorts` for BOTH coordinates
  (a diamond's sloped facet and a circle's curve change the main anchor
  with the cross slide; bbox side midpoints are exact for every shape);
- a **source diamond with a fan-out never aligns** — its vertex has
  capacity 1 (yFiles cost model) and multi-line sides must spread;
- when a terminal run translates, the adjoining perpendicular segment
  STRETCHES across a swept corridor, which is proved node-free like any
  lane (a 123px slide once swept a sibling's hop through a circle).

A companion routing rule completes the composition: an
`explained-detour` whose **entry is off-port** now seeks a port-exact Z
(equal bends, exact ports) — so the edge left behind by an alignment
(its sibling claimed the lane) still converges at the shared entry
port. Cumulative corpus effect: straight edges 97 → 101, multi-bend
routes 7 → 5, port-exact endpoints 76.0% → 78.2%.

**The slanted family** (trapezoids, parallelograms `[/x/]`/`[\x\]` —
the ISO I/O symbol, previously misparsed — and the asymmetric flag) is
PORT_EXACT too: their N/S flats take spans, their E/W ports sit at the
TRUE side midpoints — the slant midpoint or the flag point, with the
cross coordinate still on the node centerline so every port-lane
mechanism composes unchanged. shapePorts is the single source of port
truth (tightenOuterFeedback and tryVertexHook now consume it instead of
raw bbox math — byte-identical for all previously supported shapes);
clipping uses a generic convex-polygon clipper, and the rubric carries
exact polygon outline oracles and footprints for all five.

#### 6.2.3 Active fan-in centering — symmetry for peer merges

`alignPortLanes`'s default slide moves a hub onto *one* source's lane,
which makes a peer fan-in (A→T, C→T) asymmetric: one edge straight, the
other a merge-Z, with the hub stuck at the top. For an **unlabeled,
equal-rank peer fan-in** — a target T whose incoming edges are ≥2 distinct
unlabeled forward sources all stacked in one layer — the pass instead
snaps T to the **exact cross-axis barycenter** of its sources (correcting
ELK's ~20px Brandes–Köpf placement drift), so both edges leave their
source's port and converge **mirror-symmetric** at T's single exact port.
The move is gated by the same occlusion doctrine (`hubMoveSafe`: no node,
foreign-corridor, or label-pill collision; T not in a group, T not also
emitting a forward edge), and the centered hub is frozen against later
slides.

The boundary is deliberate (verified on the docs corpus): it applies
*only* to single-column unlabeled peer fan-ins; it does **not** fire when
any incoming edge is labeled, sources span multiple ranks (e.g. ELK wraps
a large fan-in into a grid — correctly out of scope, since a grid has no
single symmetry axis), the hub also emits a forward edge, the move would
occlude, or the hub is in a subgraph — each keeps the prior behavior.
Achieves exact symmetry (0.00px barycenter error) with a ≤1.5px clipping
floor on curved/pointed outlines; cost is +2 bends per fan-in (two equal
bent lines replace one-straight/one-Z) with **zero hard-metric
regressions**. This is the literature-validated trade for *balanced
peer merges* (Purchase's symmetry aesthetic), distinct from the
*main-path* cases (A–K) where straightness still wins.

#### 6.2.4 Diamond facet-mid ports (the 8-port model)

A diamond's four cardinal ports are its vertices — but each *side* of a
diamond is two slanted facets, so a cardinal vertex is a poor anchor when
a side must carry more than one designated line. Diamonds therefore
expose **four extra ports at the facet midpoints** (`diamondFacetPorts`:
NE/SE/SW/NW, the midpoint of each slant, all exactly on the outline). This
is strictly additive and diamond-only: `shapePorts` stays four-cardinal
for every shape, and `portAt` checks the four cardinals first (byte-for-
byte the legacy probe) and only tests the facet-mids when a diamond
endpoint misses all four — so non-diamonds and diamond *vertex*
attachments are unchanged. Certificates' `sourcePort`/`targetPort` widen
to `AnyPort = PortSide | DiamondFacet`, and the port-rate metric counts a
facet-mid as a designated port (not a floating attachment).

Three behaviors use them:
- **Facet-mid alignment** (E): a diamond emitting two forward edges on one
  flow side attaches the upper at the NE facet-mid and the lower at SE,
  and `alignPortLanes` snaps each target onto that facet-mid's cross-lane
  (cy ∓ h/4) — so both edges are **port-to-port straight** instead of
  spreading at target-determined facet points. Proof-gated by the existing
  occlusion checks plus a combined-pair overlap guard (in vertical flow
  (F) the two targets would converge and collide — wider than the facet
  span — so the pass correctly bails and F keeps the spread).
- **Reciprocal facet-mids** (G): a diamond↔diamond unlabeled reciprocal
  pair attaches at the *nearest facing* facet-mids — Q.NE→R.NW (upper),
  R.SW→Q.SE (lower) — two parallel lines **between** the diamonds, never
  through them. Non-diamond reciprocals keep the ±`PAIR_SEPARATION`/2
  vertex offset.
- **South-vertex entry** (K): a single unlabeled forward edge whose source
  sits below a diamond whose facing cardinal port is already claimed
  routes into the perpendicular **S vertex** (a canonical port) rather
  than floating on the facet.

All endpoints stay exactly on the outline (the `ROUTE_SHAPE_MISANCHOR`
tripwire and rubric `offOutlineEndpoints` remain 0). Measured on the
heuristic tracker (`bun run track`): 6 improvements (E/G/K + the
diamond-reciprocal example move their endpoints onto designated ports),
0 regressions, 0 hard violations across all 51 examples.

#### 6.2.5 Dynamic side/slot/role allocator

The allocator now runs as a first-class route-contract component. For every
final node endpoint it derives:

- **side** — the physical cardinal side used by the final endpoint (facet-mid
  diamonds keep the semantic adjacent side when possible, e.g. NE/SE on an
  E-exit);
- **slotIndex/slotCount** — deterministic order among endpoints on that node
  side, sorted by final side coordinate (`N/S`: x, `E/W`: y), then source
  order; and
- **role** — why the endpoint is there (`flow-source`, `flow-target`,
  `feedback-source`, `feedback-target`, container/cross-hierarchy/self-loop
  variants).

The same allocator also feeds the existing port-ranking occupancy map, but
that occupancy deliberately counts the **semantic** side for primary and
unlabeled feedback endpoints only, preserving the proven routing behavior
while exposing richer final endpoint metadata. Labeled feedback keeps its
outer-channel route and does not compete for the facing side. This closes the
#26/#38 dynamic-port slice without changing default JSON: assignments are
visible only on opt-in debug certificates (`layoutMermaid(d, { debug: true })`
or `am render --format json --certificates`).

All of these compositions are pinned by the **contact sheet**
(`eval/visual-rubric/scenarios.ts`, lettered A–V; rendered for humans by
`bun run contact:sheet`): `src/__tests__/contact-sheet.test.ts` asserts
zero hard rubric metrics AND snapshot-pins each scenario's full layout
geometry, so future changes cannot visually break these drawings
without a deliberate re-pin and sheet review. The L–V fan-in scenarios
demonstrate the symmetric merge across every PORT_EXACT shape; E/G/K
demonstrate the diamond facet-mid ports.

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
  internal exceptions on rare dense multigraphs (issue #34 pins a
  3-node/9-edge cyclic trigger: tier 0 throws `Invalid hitboxes for
  scanline constraint calculation`, tier 1 succeeds with feedback routing
  disabled). `layoutGraphSync` retries through progressively plainer option
  sets; the route pass repairs whatever the survivor produces.
  Crash-freedom is part of the renderer's contract.

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
ROUTE_STALE_AFTER_NODE_MOVE{ edge, node }         endpoint detached, or a non-incident node moved onto a route
```

Shapes without an anchor contract yet (circle, stadium, …) are exempt from
`ROUTE_SHAPE_MISANCHOR` rather than flagged — their endpoints sit on the
bbox today and warning on every one would be noise, not signal.

Still deliberately out of scope:

- Broad ELK port mutation beyond node-local primary/feedback semantics. The
  implemented hint layer now emits `FIXED_SIDE` for eligible primary-forward
  routes and for the narrow unlabeled rectangle/diamond feedback slice, while
  labeled feedback, non-rect/diamond feedback, self-loop, container,
  cross-hierarchy and family-rerouted cases remain owned by the certifying
  repair pass. Feedback `FIXED_ORDER` is still gated on new evidence: applying
  it to duplicate feedback lanes regressed `contact-sheet/AQ` in `bun run
  track`. `FIXED_POS` everywhere would still fight ELK's crossing minimization.

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

The diagram above is the conceptual sketch. The **authoritative** post-ELK pass
order is the `LAYOUT_PIPELINE` manifest in `src/layout-engine.ts` (reified per the
layout-pass-pipeline design doc), reproduced here and kept
in sync by `src/__tests__/layout-pass-docsync.test.ts` (regenerate with
`UPDATE_DOCS=1 bun test src/__tests__/layout-pass-docsync.test.ts`):

<!-- LAYOUT-PIPELINE:start -->

1. `extractEdgesRecursively` - flatten ELK edges to absolute coords (+orthogonalize cross-hierarchy)
2. `alignLayerNodes` - snap same-layer nodes onto a shared flow-axis line
3. `equalizePeerNodeDimensions` - equalize peer box sizes + pack layers so symmetry is visible downstream
4. `alignForkRejoinPeerCenters` - center fork/rejoin hubs on their peer barycenter
5. `alignPortLanes` - slide one endpoint node so a floating-straight edge becomes port-exact (Ruegg GD15)
6. `centerPeerBarycenters` - center peer fan-in/fan-out trunks over peer barycenters (#57/#61)
7. `honorLinkRankDistance` - shove target sub-DAG to honor variable-length link rank distance; push ahead anything the shove lands on and rebuild blocked reconnect routes through free channels (#81)
8. `alignLabeledSourcePort` - slide a single-outgoing labelled source onto the lane the straightener will use so the exit stays mid-port (alignPortLanes excludes labelled edges)
9. `bundleEdgePaths` - bundle fan-out/fan-in edges into shared trunks (when mergeEdges)
10. `markCorankFanInBundles` - re-route + mark co-ranked mixed-label fan-in spokes bundle-owned (justified symmetric-convergence bend)
11. `clipEdgeToShape` - clip edge endpoints to real (non-rect) shape outlines
12. `applySymmetricFanoutEmissions` - re-route small equivalent fan-outs symmetrically; mark bundle-owned
13. `applySymmetricParallelEdgeLanes` - separate parallel edges into symmetric non-crossing lanes
14. `applyParallelDuplicateLanes` - split exact duplicate edges into separated lanes
15. `collapseTinyBundledHitches` - remove sub-perceptual hitches introduced by bundling
16. `reassignBundledSiblingLabels` - re-home labels onto the correct bundled sibling segment
17. `applyRouteContracts` - classify -> simplify -> straighten (fixed-point) -> certify; FREEZES node geometry
18. `reanchorOffOutlineEndpoints` - re-route an edge whose endpoint dangles off a moved node onto that node's flow port (edge-only, freeze-safe)
19. `rerouteEdgesThroughNodes` - re-route an edge left running through a node by a node-mover (honorLinkRankDistance/alignPortLanes) around the obstacle (edge-only, freeze-safe)
20. `repairLabelsOnSharedTrunks` - re-slot a labeled edge whose pill sits on a trunk shared with another edge (label-only, freeze-safe)
21. `repairLabelsOffOwnRoute` - re-slot a labeled edge whose pill sits off its OWN route onto it — ELK offset placement on an already-straight edge (label-only, freeze-safe)
22. `separateEdgeLabelPills` - slide colliding edge-label pills along their own routes into clear slots — parallel/reciprocal lane labels stack at midpoints (label-only, freeze-safe)
23. `translateGeometryToNonNegativeOrigin` - shift whole graph to a non-negative origin (allowed after freeze)

<!-- LAYOUT-PIPELINE:end -->

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
  certificates exist for every edge (a post-freeze repair that re-routes an
  edge re-certifies it via `recertifyReroutedEdge`; gated deterministically by
  `certificate-completeness.test.ts` — corpus, shrunk #83 repros, fixed-seed
  duplicate-edge sweep); no primary-forward hitch survives when
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
| Phase 2 — semantic `FIXED_SIDE` / `FIXED_ORDER` ports | conservative slice implemented: primary-forward edges feed inferred source/target side intent to ELK fixed-side ports; eligible unlabeled rectangle/diamond feedback routes now feed flipped-side `FIXED_SIDE` ports with deterministic slot diagnostics; feedback `FIXED_ORDER` remains deferred after measured corpus regression; labeled feedback, unsupported-shape feedback, self-loop/container/cross-hierarchy/direction-override relaxations rely on final certificates |
| Phase 3 — certifying simplifier | implemented (proof-free + proof-carrying layers) |
| Phase 4 — bundle contract | first slice implemented: bundled paths are proved clear of nodes, blocked members fall out of the bundle; per-trunk certificates deferred |
| Phase 5 — family adoption | state composites (`stateBodyToGraph`) flow through graph route contracts and certificates; architecture now emits family-specific endpoint-side certificates in debug layouts; class/ER keep their own ELK engines and emit family-specific orthogonal-box certificates plus rendered-layout geometry tripwires; sequence emits lifeline-message certificates; timeline/charts emit family element-containment layout certificates |

## 11. Acceptance criteria mapping

1. MFA/login renders straight forward edges when lanes are clear, in SVG **and** ASCII (longest-path ASCII layering put the fan-in join after its deepest parent; regression tests on both renderers + regenerated visual evidence).
2. Feedback retry edges emit feedback-route certificates — straight-with-proof (labeled ones park their pill in the open canvas beside the lane), `feedback-detour` with blockers otherwise — unit + regression test.
3. Disabling the direct-lane proof reintroduces a failing test — `ROUTE_HITCH` tripwire + straightener unit tests + mutation lane.
4. A blocker node prevents straightening with an explained-detour certificate — blocked-lane regression.
5. Diamond endpoints land on the diamond polygon, not bbox corners — ray-intersection re-anchoring + property test + `ROUTE_SHAPE_MISANCHOR` tripwire.
6. No node movement after the route pass — pipeline placement + `ROUTE_STALE_AFTER_NODE_MOVE` tripwire.
7. Corpus diff shows no regressions — `eval/layout-compare` runs recorded in the PR (18 changed / 0 regressions for the full batch).
8. Diagnostics available to tests and tooling — `classifyRoutes` / `auditRouteContracts` / `findRouteHitches` exported; `layoutMermaid(d, { debug: true })` attaches graph `RouteCertificate`s, family `FamilyEdgeRouteCertificate`s, and `RegionContainmentCertificate`s to layout JSON; and `am render --format json --certificates` exposes the same opt-in certificate schema without changing default JSON output.

## 12. Issue #25 open questions, resolved

1. *Certificates public or test-only?* — public but opt-in: `layoutMermaid(d, { debug: true })` and `am render --format json --certificates` expose route certificates; default JSON remains certificate-free for schema stability. V1 certificates keep the concrete `AnyPort = N|E|S|W|NE|SE|SW|NW` vocabulary, and the additive side+slot+semantic-role allocator is exposed as `sourcePortAssignment` / `targetPortAssignment`.
2. *Mermaid source route hints?* — no, as recommended; intent stays inferred from semantics and author order.
3. *Should feedback always detour?* — resolved by adopting ELK's feedbackEdges outer-channel routing plus loop tightening: labeled feedback loops around the nodes (label riding the loop with reserved space), unlabeled feedback collapses to a parallel straight back-arrow when provably clear. Feedback never shares the forward lane.
4. *Should labels force a bend?* — a label may only sit ON its own route (Kakoulis–Tollis unambiguity; dot's virtual-node doctrine). If the straight lane cannot host the pill, the edge keeps its outer loop — the canvas grows to make room, the label never floats beside a lane it doesn't belong to.
5. *Should architecture use ELK?* — unchanged: architecture keeps shared placement plus its own side-anchored rerouting. Public debug layout now exposes architecture-specific endpoint-side certificates for the final geometry instead of stale graph certificates.
