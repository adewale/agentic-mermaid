# Layout pass audit — 2026-10-29

Keep the current execution order while simplifying the proposal, label-placement, and certificate machinery underneath it. The strongest findings are inaccurate mutation declarations and a now-false claim that the three symmetry passes commute. Neither justifies removing a geometric or semantic check.

These are recommendations, not an implemented reorder or an equivalence proof. The audit covers production code at `0a2dc30b6220c04182f8ccd45550689422606a22`. Its source review and bounded probes were read-only; no implementation or test files were changed. This document records the findings and proposed stages.

The recommendations follow the repository’s requirement to protect observable contracts at their owning boundaries, rather than preserve pass names or create another inventory gate: [testing-strategy.md](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/docs/testing-strategy.md#L753). All repository citations below are pinned to the audited commit.

**Prioritized findings**

1. **Correct the declared effects before using the manifest to restructure execution.**

   The manifest accurately lists the execution sequence, but does not accurately describe several passes’ effects:

   | Pass | Declared effect | Additional actual writes |
   |---|---|---|
   | `alignForkRejoinPeerCenters` | Positions | Incident/internal route points and label anchors through `shiftNodeSetCross`. |
   | `centerPeerBarycenters` | Positions | Route points and label anchors; its rollback already acknowledges these writes. |
   | `honorLinkRankDistance` | Positions | Group positions and dimensions, reconstructed routes, label anchors. |
   | `applySymmetricFanoutEmissions` | Edges | Target positions and dimensions; enclosing groups can expand for diamond fans. |
   | `extractEdgesRecursively` | Extraction | Prepared text on nodes/edges/groups and group header height. |
   | `placeStateNotes` | Translation | Creates note objects and may then translate all geometry. |

   Evidence: [fork/rejoin movement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L617), [shared movement helper](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/shared.ts#L191), [centering checkpoint](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1417), [group rebuilding](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/rank-distance.ts#L116), [rank-route reconstruction](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/rank-distance.ts#L431), [fanout target movement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/fanout.ts#L164), [fanout group expansion](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/fanout.ts#L229), [text retention](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1640).

   Two accompanying explanations are stale:

   - `alignLabeledSourcePort` says it is the last node mover, although fanout emission moves nodes later.
   - It says `alignPortLanes` excludes labeled edges, although the latter’s general slide loop does not exclude them.

   See [manifest comments](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1495) and [actual slide loop](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L1080).

   These discrepancies currently misdescribe the code; they do not themselves demonstrate a bad rendered diagram. They become dangerous when used to justify reordering, caching, or an earlier freeze. Before the freeze, the runner does not enforce advertised mutation categories.

   **Recommendation:** expand the effect vocabulary enough to distinguish node boxes, group boxes, route points, label anchors, prepared text, bundle ownership, certificates, and notes. Keep these declarations descriptive unless their actual enforcement is deliberately implemented. Correct the comments without changing execution.

2. **The symmetry passes are not freely reorderable on current code.**

   The manifest explicitly claims that their order is “empirically free”: [layout-engine.ts](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1432).

   A read-only permutation probe disproves that claim:

   - 84 fixtures: 44 contact-sheet cases and generated flowchart seeds 0–39.
   - All six orders of fanout emission, symmetric parallel lanes, and duplicate lanes.
   - 504 completed layout calls with explicit ELK.
   - Nine physical-geometry differences, confined to seeds 6, 16, and 22.
   - Every differing order ran duplicate lanes before symmetric parallel lanes.
   - Zero thrown pass/certification failures.

   The comparison excludes certificates and prepared text.

   A concrete case is:

   ```mermaid
   flowchart TD
     N0((ok))
     N1((warnings))
     N2(["same word ok"])
     N3(["validate input"])
     N4[(warnings)]
     N4 --->|ok| N1
     N4 ---> N1
     N4 ===>|same word ok| N1
     N0 ===> N2
     N0 -->|warnings| N2
     N1 --> N3
     N1 -->|process the request| N3
     N1 ---> N3
     N2 --->|a longer label goes here| N4
   ```

   All node boxes remain identical. The unlabeled `N4 → N1` edge changes from:

   ```text
   (160.28125,475.8) → (160.28125,543.8) → (154.901,543.8) → (154.901,611.8)
   ```

   to:

   ```text
   (160.28125,475.8) → (160.28125,505.8) → (154.901,505.8) → (154.901,611.8)
   ```

   That is a 38-pixel elbow displacement. Both outcomes pass hard certification. Seed 6 additionally increases final `labelConflicts` from **0 to 1** after the swap and changes selected node geometry.

   The overlap in ownership is visible statically: symmetric parallel lanes select the two *labeled occurrences* of a directed pair, even when an unlabeled occurrence also exists; duplicate lanes subsequently process fully or partly labeled pairs whose shared ink still needs repair. See [symmetric selection](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/parallel-lanes.ts#L81) and [duplicate fallback](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/parallel-lanes.ts#L305).

   **Recommendation:** declare `applySymmetricParallelEdgeLanes → applyParallelDuplicateLanes`. Preserve fanout’s current position too; the bounded experiment does not prove its general commutativity. The result establishes observable and preference changes, not a current-order hard-constraint defect or universal superiority of one ordering.

3. **Final hard certification cannot replace the local admission rules.**

   The final gate checks semantic correspondence, finite/bounded geometry, reserved group headers, and the rubric’s eight hard metrics. Those metrics are:

   ```text
   offOutlineEndpoints, endpointApproaches, diagonalSegments,
   unexplainedBends, hitches, nodeOverlaps, labelOffRoute, edgeThroughNode
   ```

   See [candidate certification](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/certification.ts#L301) and [hard metrics](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-rubric.ts#L676).

   That is not an exhaustive proof of every requirement. Full marker/shaft paint, label collisions, duplicate-edge distinguishability, opposing shared ink, state-note side ownership, and all authored styling distinctions have additional owners. Semantic correspondence also checks selected fields; it is not equality of every authored node/edge property.

   Consequently, these simplifications would lose protection:

   - Delete local marker/label/header admission because final certification passes.
   - Treat `hard === 0` as equivalence between candidate outputs.
   - Replace constructed bundle evidence with `routeCertificate.invariant === 'bundle'`.
   - Collapse duplicate relationships into one representative route.
   - Replace full reserved header bands with the visible title glyph rectangle.

   Bundle exemption additionally requires an edge-object-keyed `WeakMap` record of related, constructed geometry. Arbitrary cloning loses that evidence; arbitrary rerouting cannot carry it forward. Uniform translation and label-only edits preserve it. See [bundle ownership](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/bundle-routes.ts#L20).

   **Recommendation:** retain admission at its current owner even when implementations are consolidated. A transaction helper must preserve object identity, constructed-bundle provenance, and the difference between “could not prove an optional improvement” and “required geometry is invalid.”

4. **The feedback between placement, routing, and labels is substantive.**

   Several early passes deliberately predict or project later work:

   - Peer resizing evaluates paint clearance against privately repaired endpoint geometry; it does **not** publish those projected route repairs.
   - Port alignment stages a complete proposal and may privately reanchor its routes before paint admission.
   - Labeled-source alignment asks the downstream straight-lane predictor which lane it will use.
   - Port alignment consults the fanout ownership predicate to avoid moving a source that the emitter must keep centered.
   - Centering treats small terminal fans differently because the later emitter owns their spread.
   - Final label movement can free a route lane, so route closure runs after labels settle.

   Evidence: [peer paint projection](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L16), [port proposal publication](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L431), [labeled-source proposal](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L172), [fanout prediction](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L1076), [centering](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L259).

   The two route-contract passes also have different jobs:

   - `applyRouteContracts` classifies and repairs initial routes, including self-loops, compound/container cases, terminal approaches, and alternative orthogonal routes. Its retry mechanism is an initial sweep plus at most four retry rounds.
   - `closeRouteContracts` uses settled route/label occupancy to remove auditor-proven hitches, followed by proven subpixel endpoint-tail cleanup. Its successful route changes monotonically remove bent edges, giving an edge-count bound.

   See [initial retry loop](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L852) and [final closure](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1705).

   **Recommendation:** preserve both boundaries. A general unbounded “repeat all cleanup until stable” loop would change termination, priority, and work limits. Moving closure before label repair would miss newly available lanes.

5. **Certificates mix historical reasoning, current geometry, and scheduling enforcement. Clarify those roles before consolidating them.**

   After the freeze, the runner requires changed route geometry to have a new, defined certificate object. It does not validate the certificate’s claims at that point. Label-only changes do not require recertification. The final independent geometry check remains necessary: [runner checks](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/pass.ts#L177).

   `recertifyReroutedEdge` recomputes bends and exact port contacts, deliberately inherits direct-lane analysis, and also inherits side/slot assignments. Final hitch closure allocates a fresh port plan but writes assignments only to closed edges: [recertification](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L923), [closure assignments](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1036).

   The inherited direct-lane analysis is documented behavior, so calling it a confirmed stale-certificate bug would be unjustified. Side/slot metadata presents a plausible maintenance risk when one late repair changes neighboring endpoint order. A bounded 124-fixture ELK trace found **no** stale final physical port assignments.

   **Recommendation:** distinguish immutable route classification and retained reasoning from current measured fields and bundle provenance. A later refactor could refresh all physical port assignments from one final plan, but that is a hypothesis requiring a behavioral counterexample and validation—not a necessary fix established by this audit. Do not remove intermediate certificate issuance while the runner relies on it.

The following inventory records the actual execution boundaries. `P` means ELK input **or** `mergeEdges`; `E` means ELK only; `M` means `mergeEdges`; `A` means all producers. “Improve-only” means nondecreasing for `straight`/`portRate` and nonincreasing for the other metrics. “None” means no runner metric budget, not absence of local checks. Declared predecessor numbers refer to this table.

| # / pass | Enabled; declared predecessor | Actual writes and local acceptance/rollback | Runner metric budget |
|---|---|---|---|
| **1. `extractEdgesRecursively`** | A; none. ELK extraction itself requires `elkResult`. | Adds flattened absolute-coordinate edges, preserves authored edge fields, orthogonalizes sections; retains prepared text and header heights. No rollback. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/elk-edges.ts#L25) | None |
| **2. `alignLayerNodes`** | P; 1 | Moves same-layer node centers and incident endpoint runs. Projects clipping/approach checks before admission; no label repositioning or pass rollback. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/layer-alignment.ts#L62) | Bends and straight improve-only |
| **3. `equalizePeerNodeDimensions`** | P; 2 | Resizes eligible 2–5 rectangular ungrouped peers; packs layers and moves upstream collision cones. Publishes node boxes only. Individual and whole-proposal restoration protect geometry/paint. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L76) | None |
| **4. `alignForkRejoinPeerCenters`** | P; 3 | For the eligible three-way diamond fork/rejoin island, moves nodes, terminal/internal routes, and associated label anchors. Checks the whole moved closure first. No runner rollback. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L558) | Symmetry improve-only; bends +2 |
| **5. `alignPortLanes`** | E; 4 | Stages node positions, routes, labels, and possibly refreshed certificates; publishes only after full admission. Includes fan-in, facet, side-input, and ordinary edge strategies. Local frozen-node bookkeeping preserves earlier decisions. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L431) | Straight, port rate, bends improve-only |
| **6. `centerPeerBarycenters`** | P; 5 | Up to three sweeps over eligible fans; moves nodes, routes, labels. Lazy checkpoint snapshots node coordinates and edge points/label anchors. **Only pass returning a runner rollback.** [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L211) | Symmetry improve-only; bends +2 |
| **7. `honorLinkRankDistance`** | P; 6; useful only with authored link length >1 | Moves downstream closures, resolves introduced overlaps, rebuilds group boxes, and reconnects routes/labels. Preserves compound contacts through proven stretch or reconstruction. No whole-pass rollback; impossible compound reconstruction can reject the candidate. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/rank-distance.ts#L11) | None |
| **8. `alignLabeledSourcePort`** | P; 7; labeled eligible single-out sources | Moves a source/upstream chain, routes and labels; predicts the straightener’s lane for up to four iterations. Private staging and paint admission; yields to corank ownership. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L172) | Port rate improve-only |
| **9. `bundleEdgePaths`** | M; 8 | Replaces unlabeled compatible fan routes, establishes bundle ownership, replaces `bundled`, records `genericBundled`. Shrinks/recomputes member sets until admitted; complete shaft/marker/header and opposing-route checks. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/edge-bundling.ts#L138) | None |
| **10. `markCorankFanInBundles`** | P; 9; eligible mixed-label corank fan-in | Reconstructs all spokes as a staged fan, moves labels, clears certificates, establishes ownership. Whole-spoke acceptance. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/peers.ts#L485) | None |
| **11. `clipEdgeToShape`** | A; **9**, not 10 | Removes exactly duplicate consecutive points, trims proven boundary runs, clips endpoints, carries known bundle proof through this allowed rewrite. Direct mutation. [Manifest implementation](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1525) | Approaches improve-only; port rate may lose 1 only if approaches improve |
| **12. `applySymmetricFanoutEmissions`** | P; 11; eligible 2–3 terminal rectangular leaves | Can resize/move targets and expand groups, then writes routes/labels, clears certificates, establishes ownership. Restores node/group snapshots on rejection. Grouped rectangular fans use route-only mode; diamond fans can move geometry. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/fanout.ts#L128) | Symmetry improve-only; bends +2 |
| **13. `applySymmetricParallelEdgeLanes`** | P plus labeled directed pair; 11 | Tries ordered outer/inside lanes for exactly two labeled occurrences; commits routes/labels, clears certificates, establishes ownership. Staged marker, route, crossing, and label admission. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/parallel-lanes.ts#L71) | Symmetry and crossings improve-only |
| **14. `applyParallelDuplicateLanes`** | P plus directed pair; 11 | Handles fully/partly labeled directed pairs and unlabeled target-face buckets, including other feeders. Writes routes/labels, clears certificates, establishes ownership. Each local proposal must justify its own crossing allowance. Native label-preservation policy differs. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/parallel-lanes.ts#L236) | Parallel overlaps improve-only; ≤1 added crossing per repaired overlap |
| **15. `collapseTinyBundledHitches`** | A; 12, 13, 14 | For owned, unlabeled four-point routes into rectangle targets, removes a proven ≤6px hitch; clears certificate and carries valid ownership. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/obstacle-routing.ts#L263) | Bends improve-only |
| **16. `reassignBundledSiblingLabels`** | A; 15; labeled owned sibling fans | Label anchors only. Grouped rectangular cases stage the complete assignment with paint checks; ordinary cases use bundled seating. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/fanout.ts#L50) | None |
| **17. `applyRouteContracts`** | A; 16 | Classifies, normalizes, repairs, straightens, seats some labels, establishes final draft certificates. Initial sweep plus bounded retries; local route proposals, no pass rollback. **Sets node freeze after successful completion.** [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L106) | Conditional straight/bend/port allowances, detailed below |
| **18. `reanchorOffOutlineEndpoints`** | A; 17; non-self node endpoints off outline | Rebuilds a route between flow ports if clear, moves label to path midpoint, reissues certificate. Failed proposal leaves route unchanged. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/obstacle-routing.ts#L27) | None |
| **19. `rerouteEdgesThroughNodes`** | A; 18; eligible foreign-node penetration | Tries interior shifts, obstacle-band detours, then terminal detours; retains endpoints, checks node bodies and group headers, moves label midpoint, reissues certificate. Failed repair leaves route for final rejection. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/obstacle-routing.ts#L80) | None |
| **20. `repairLabelsOnSharedTrunks`** | A; 19; label on shared collinear ink | Label anchors only; searches suitable segments/lateral seats with paint/header and shared-trunk ownership checks. Restores original when unsuccessful. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1231) | None |
| **21. `repairLabelsOffOwnRoute`** | A; 20; displaced non-self label | Label anchors only; tries on-route seats, then controlled nearest-route/mirrored fallbacks. No feasible seat means unchanged. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1297) | None |
| **22. `separateEdgeLabelPills`** | A; 21 | Label anchors only. Three sweeps, single/pair/joint candidates, then bounded paint-seat rescue. Preserves originals on unknown paint, no room, or exhausted work. Native policy additionally preserves foreign-route clearance. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1410) | None |
| **23. `closeRouteContracts`** | A; 22 | Reproves eligible settled hitches, changes routes and possibly their own label anchors, refreshes affected certificates/ports; trims proven tiny endpoint tails. At most edge-count scans. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/route-contracts.ts#L1711) | Straight and bends improve-only |
| **24. `translateGeometryToNonNegativeOrigin`** | A; 23 | Uniformly translates nodes, groups, routes, labels as needed, using prepared label extents. No notes exist yet. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/route-geometry.ts#L660) | None; uniform-translation freeze check |
| **25. `placeStateNotes`** | Authored notes present; 24 | Creates notes in authored order beside final leaf/group anchors; moves each only outward past obstacles. May uniformly translate all geometry including notes. [Owner](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1681) | None; uniform-translation freeze check |

Additional conditions that a consolidation must preserve:

- Port-lane work is restricted to at most 64 nodes plus groups and 128 edges; staged paint work uses a finite shared budget. Duplicate-lane marker fallbacks reuse that bounded machinery. See [port work limits](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/port-lanes.ts#L21).
- `APL_NO_LABELED_SOURCE_PORT`, `APL_NO_CORANK_FANIN`, and port-alignment’s `APL_NO_CENTER`, `APL_NO_FACET`, `APL_NO_SVERTEX` suppress particular strategies. They are not interchangeable whole-pipeline switches.
- Rank overlap pushing is bounded by `nodes.length * 4`; grouped fanout label seating and late label rescue have their own finite work limits.
- Unknown/custom paint is not permission to accept a geometric approximation. Optional proposals often decline when complete paint cannot be proved.

**The runner’s budgets and freeze rules are part of the behavior.**

`runPipeline` executes array order; `after` only verifies prior execution. It does not sort the graph or infer dependencies from effects. Disabled passes count as visited and skip their dependency check: [pass.ts](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/pass.ts#L102).

For `applyRouteContracts`, let `I` be the largest positive improvement among `hard`, crossings, and endpoint approaches. It may lose at most `floor(I)` straight routes and add at most `4 * floor(I)` bends. Port rate may worsen by at most 1 only if one of hard defects, crossings, bends, endpoint approaches, or opposing overlaps improves. The condition combines improvements using **maximum, not sum**. There is no declared unconditional hard-improve-only budget on this pass: [manifest budgets](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1578), [budget calculation](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/pass.ts#L149).

The runner’s rollback behavior is deliberately narrower than general transaction rollback:

- Only centering declares `proposal: true` and returns a rollback.
- A non-hard metric-budget failure can invoke that rollback.
- The restored state must satisfy the original budgets and preserve its original hard state.
- Exceptions, hard-budget violations, freeze violations, and measurement failures propagate; they cannot be hidden by rollback.
- A successful later layout candidate cannot hide a `LayoutPassContractError`.

See [rollback enforcement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/pass.ts#L209) and [candidate exception policy](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/certification.ts#L319).

After freezing, node and recursive group membership, dimensions, and positions are checked. Translation must be uniform across those boxes, routes, and label anchors. Changed route points require a fresh certificate. Label-only edits are permitted. The snapshot is not a complete semantic snapshot and does not include note objects or every group metadata field.

Combining passes while checking metrics only at the combined boundary would allow one stage’s gain to pay for another stage’s regression. Combining private candidates into one rollback could likewise hide a required failure. Preserve these boundaries even if public pass wrappers become fewer.

**A conservative ordering change is to strengthen dependencies without moving any execution.**

Retain the existing declared graph and add:

```text
markCorankFanInBundles
    → clipEdgeToShape

applySymmetricFanoutEmissions
    → applySymmetricParallelEdgeLanes
    → applyParallelDuplicateLanes
```

The last edge is supported by the permutation counterexample. The first two conservatively encode the current sequence while their general interchangeability remains unproved. This is not a claim that the resulting graph is mathematically minimal.

The resulting phase sequence remains:

```text
extract/text
→ placement preparation and alignment
→ generic/corank bundle construction
→ endpoint clipping
→ fanout geometry and routes
→ symmetric parallel proposals
→ duplicate-lane fallback
→ bundle hitch/label cleanup
→ route contracts and freeze
→ off-outline repair
→ through-node repair
→ shared-trunk label repair
→ own-route label repair
→ pill separation
→ final route closure
→ origin translation
→ state notes
```

Do not move fanout emission wholesale into the earlier placement block: its inputs currently include constructed/clipped routes, and earlier alignment deliberately predicts its ownership.

A useful future distinction is **box geometry frozen** after fanout versus **route rewrites require certificates** after `applyRouteContracts`. The current `freezesNodes` flag combines those concerns. Simply moving that flag earlier would reject legitimate certificate-clearing route construction in passes 13–16. Introduce separate states only after proving all subsequent box writes are absent, including behavior under supported custom measurement callbacks.

**Recommended implementation stages**

1. **Make the present behavior accurately reviewable.**

   Correct effects, stale explanations, and missing ordering edges. Keep all calls, arguments, budgets, and enabled predicates unchanged. Extend an existing behavioral regression for the parallel-order interaction; do not add a source-text test asserting an inventory or a preferred pass count.

   The physical-only permutation harness and existing freeze tests provide evidence for this stage. This is the lowest-risk, highest-confidence improvement.

2. **Consolidate duplicated label-seat mechanics while retaining three ordered policies.**

   The late label repairs already share some helpers, but still repeat segment ordering, center-out seat generation, pill/halo construction, and candidate rejection mechanics. Extract only the common mechanics.

   Retain separate policies and their current order:

   - Shared-trunk ownership repair.
   - Distance from the label’s own route.
   - Collision separation and bounded rescue.

   Preserve the differences in trigger thresholds, legal lateral offsets, overhang, shared-trunk exclusion, self-loop handling, native foreign-route clearance, unknown paint, and custom measurement. A single weighted “best label position” function would change these priorities.

   Evidence should include [nested header label repairs](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/__tests__/route-contracts.test.ts#L390), [custom live measurement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/__tests__/route-contracts.test.ts#L443), [shaft width handling](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/__tests__/route-contracts.test.ts#L3194), and [rescue refusal/work exhaustion](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/__tests__/route-contracts.test.ts#L3243).

3. **Consolidate parallel-route proposal construction around the existing admission helper.**

   Both parallel owners already use `parallelLaneProposalAllowed`; do not invent a second generic acceptance framework. Share static occurrence grouping and candidate construction where equivalent, and keep live occupancy checks current: [existing shared admission](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/passes/parallel-lanes.ts#L209).

   Preserve the current **whole-graph** order: all symmetric proposals precede duplicate fallback. Processing “symmetric then fallback” one pair at a time would introduce another unproved interleaving.

   Preserve duplicate fallback’s broader target-face buckets, mixed labels, feedback direction, authored occurrence order, marker-driven fallback, and per-proposal crossing allowance. Validate visible multiplicity and marker ownership, not merely retained edge count.

4. **Unify transaction mechanics selectively, then expose the real freeze boundary.**

   Common snapshot, staged publication, and restoration code can be shared between placement proposals. Keep each owner’s eligibility and admission policy explicit.

   In particular:

   - Peer equalization’s endpoint repairs remain private projections.
   - Centering’s rollback restores its actual routes and labels.
   - Fanout restores node **dimensions** and group boxes as well as positions.
   - Constructed bundle records remain attached to the live committed edge objects.
   - Required failures remain distinguishable from rejected cosmetic proposals.

   Only after this is verified should box freeze and certificate-required routing become separate states. This offers a clearer architecture without prematurely forcing placement and routing into independent phases.

5. **Clarify certificate finalization before optimizing repeated route work.**

   Separate retained reasoning from fresh geometric measurements. If a final port-plan refresh is introduced, update all affected assignments, including unchanged neighboring edges whose slot order can change. Preserve `straightened` as evidence that the certifying straightener performed a collapse; a late two-point repair must not invent that history.

   Keep the final hitch proof and the late closer coupled to the same live occupancy semantics. Do not replace them with cached early clearance.

6. **Optimize measured cost, not the number 25.**

   No performance benchmark in this audit establishes which passes dominate runtime. Most manifest entries are already thin wrappers.

   Plausible targets are repeated immutable topology/reachability work, repeated static edge-occurrence grouping, and allocations in staged geometry. Geometry-dependent indexes require explicit invalidation after node, group, route, or label changes. Custom text measurement already forces some cache bypasses; preserve that behavior: [live route context](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/route-geometry.ts#L526).

   Preserve candidate counts, authored order, and deterministic work counters. Do not exchange these for elapsed-time limits or an unbounded fixed point.

**Producer distinctions and requirements that block broader simplifications**

- **Native layered/compound and native forest do not use the same early pipeline.** Forest enables `mergeEdges` and shared fan preparation. Native layered placement reserves private label channels and skips the ELK placement repairs. All native calls also supply preservation options for self-loops, labels, and straight routes; late pill separation preserves foreign-route clearance. See [native handoff](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/agentic-producer-core.ts#L372) and [pipeline options](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1588).

- **`mergeEdges: false` does not mean “no bundle ownership.”** Corank and specialized fan/parallel owners have independent reasons to establish justified geometry. Native producers may supply shared-edge ownership. A single bundling toggle must not erase those distinctions.

- **Candidate selection is observable.** ELK preference order is titles, crossings, label conflicts, bends, ports, symmetry, area. Native refinement uses label conflicts, opposing overlaps, parallel overlaps, crossings, physical bends, area. Their bounds and strict-error behavior differ. Do not unify them casually: [ELK preferences](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/certification.ts#L30), [native refinement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout/agentic-producer-core.ts#L420).

- **The unbundled alternative is deliberately narrow.** It reuses the selected raw ELK placement, is bounded, and is disabled for directed parallel pairs to protect multiplicity. Do not run every route alternative for every placement: [route-alternative policy](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L2183).

- **Compound geometry has authored ownership.** Preserve parentage, member containment, per-side group insets, container contacts, direction overrides, complete reserved header bands, and monotonic stretch precision. A generic rectangular obstacle router does not replace the rank-distance compound repair.

- **Feedback and parallel occurrences remain separate relationships.** Preserve authored indices and labels, actual terminal directions, marker multiplicity, reciprocal port competition, and legitimate shared geometry. Geometric “forwardish” predicates used for layout motifs are not substitutes for semantic route classification.

- **Styles affect feasibility.** Label transforms, measured text, halo, marker kind and scale, shaft width, rounded bends, unknown CSS paint, and invisible carriers with visible captions matter. Centerline clearance alone is insufficient. Independent retained-paint certification remains a separate layer: [scene paint certification](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/scene/paint-certification.ts#L931).

- **State notes require final geometry.** Preserve authored order, declared left/right side, composite-group anchors, outward-only obstacle avoidance, note padding/margins, and uniform translation of every subject. Current note obstacles include node/group boxes, inflated visible route segments, and edge-label pills; that is the implemented coverage, not a universal painted-pixel proof. Combining translation helpers is reasonable; moving note placement before settled routes/labels is not: [note placement](https://github.com/adewale/agentic-mermaid/blob/0a2dc30b6220c04182f8ccd45550689422606a22/src/layout-engine.ts#L1671).

**Validation and limits**

The focused command passed **389 tests, 0 failures, 3,039 expectations**, in 18.38 seconds. The audit runtime was Bun 1.4.2 with Node 24.19 available. Run this portable command from the repository root with its dependencies installed:

```sh
bun test \
  src/__tests__/layout-pass.test.ts \
  src/__tests__/layout-certification.test.ts \
  src/__tests__/layout-bundle-proposals.test.ts \
  src/__tests__/certificate-completeness.test.ts \
  src/__tests__/state-notes.test.ts \
  src/__tests__/linkrank-packing.test.ts \
  --timeout 60000
```

Those tests cover runner contracts/rollback, bounded candidate selection, bundle paint admission, certificate presence, state notes, and rank/compound preservation. Additional route, symmetry, labeled-source, and backend-selection regression sources were reviewed but not run as part of this audit.

The following **local review artifacts** were retained outside the repository in the authoring session. They are not published evidence or portable repository files; the concrete source and geometry counterexample are recorded above:

- `layout-audit-evidence.md`: commands, concrete source, geometry difference, and limitations.
- `layout-audit-permutations.ts`: physical-only permutation script.
- `layout-audit-permutations-results.json`: all 504 permutation outcomes.
- `layout-audit-order.ts`: detailed three-fixture script.
- `layout-audit-order-results.json`: physical geometry and rubric results.
- `layout-audit-focused-tests.log`: focused test log.

The earlier 124-fixture trace was exploratory; its full script was not retained. Its absence of stale physical port assignments is bounded negative evidence, not a general proof.

The permutation evidence uses explicit ELK and default styles. It does not establish native-backend commutativity, full raster equivalence, performance gains, or exhaustive satisfaction of every contract. No full-suite or CI completion claim is made.

