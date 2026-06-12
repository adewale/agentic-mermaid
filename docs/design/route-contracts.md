# Route Contracts: Principled Routing Without Hitches

Status: implemented (Phases 0, 1, 3 and the first slice of Phase 4 of issue #25's rollout; see "Rollout status")
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
5. ASCII and SVG share route intent (ASCII already satisfies the invariants
   this spec adds for SVG; its grid router attempts direct lanes first and
   ties break FIFO-deterministically).

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
    | 'feedback-detour'      // feedback whose reverse lane is blocked; blockers say why
    | 'self-loop'
    | 'container-attach'
  directLaneClear?: boolean  // primary-forward and feedback
  directLaneBlockedBy?: Array<{ kind: 'node' | 'label' | 'channel' | 'span'; id: string }>
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
4. the center of the overlap of both nodes' attachment spans.

A candidate is valid when it lies inside both endpoint nodes' attachment
spans (diamonds use the central 50% of their span so edges never attach next
to a vertex; rectangles use the full side minus a 4px margin), and the lane
is **clear**:

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
  (pill extent along the lane + clearance), and a **label slot** exists on
  the lane — the midpoint, then 1/3, then 2/3 — whose pill rect is clear of
  nodes, other pills, and other edges' segments. Reciprocal labeled pairs
  with room stagger their labels; with standard-height LR nodes there is
  provably no room for a ~30px pill between two parallel horizontal lanes,
  so the labeled feedback edge keeps its detour and certifies the label as
  the blocker. The label moves to the chosen slot.

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

## 7. Validation: ROUTE_HITCH

`verifyMermaid` gains a Tier 2 (geometric, advisory) warning:

```
ROUTE_HITCH { edge, deviationPx }
```

fired when a primary-forward or feedback edge has bends **and** a clear
candidate lane exists for it (feedback lanes are proved against the flipped
axis). Because the straightener runs by default in the same pipeline, this
warning is a tripwire: it fires only if the straightener is disabled,
regressed, or proven wrong — making the invariant load-bearing (acceptance
criterion 3 of issue #25). It is computed by re-running the prover over the
final positioned graph, not by trusting the layout pass.

Out of scope for this iteration (deliberately, with reasons):

- `ROUTE_UNEXPLAINED_BEND` and friends — until Phase 2 ports land, most
  non-straight routes are ELK channel routing; warning on them is noise.
- Mutating ELK port constraints (`FIXED_SIDE` etc.) — Phase 2; needs corpus
  evidence to bound the blast radius.
- ASCII changes — the ASCII router already satisfies the direct-lane-first
  and FIFO-determinism contracts; it shares the classification module when
  it needs route classes.

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
| Phase 1 — validation warnings | `ROUTE_HITCH` implemented; other codes deferred until they can fire without noise |
| Phase 2 — semantic `FIXED_SIDE` ports | deferred; certificates now provide the measurement to land it safely |
| Phase 3 — certifying simplifier | implemented (proof-free + proof-carrying layers) |
| Phase 4 — bundle contract | first slice implemented: bundled paths are proved clear of nodes, blocked members fall out of the bundle; per-trunk certificates deferred |
| Phase 5 — family adoption | deferred; certificate shape designed to extend (see issue #25 §14) |

## 11. Acceptance criteria mapping

1. MFA/login renders straight primary-forward edges when lanes are clear — regression test + regenerated visual evidence.
2. Feedback retry edges emit feedback-route certificates — straight-with-proof when their reverse lane is clear, `feedback-detour` with blockers otherwise — unit + regression test.
3. Disabling the direct-lane proof reintroduces a failing test — `ROUTE_HITCH` tripwire + straightener unit tests + mutation lane.
4. A blocker node prevents straightening with an explained-detour certificate — blocked-lane regression.
5. Diamond endpoints land on the diamond polygon, not bbox corners — ray-intersection re-anchoring + property test.
6. No node movement after the route pass — enforced by pipeline placement.
7. Corpus diff shows no regressions — `eval/layout-compare` run recorded in the PR.
8. Diagnostics available to tests — `classifyRoutes` / `certifyRoutes` exported; `verifyMermaid` surfaces `ROUTE_HITCH`.
