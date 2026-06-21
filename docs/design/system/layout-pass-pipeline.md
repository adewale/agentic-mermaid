# Draft spec — reify the post-ELK geometry pipeline as a `LayoutPass` list

Status: **draft / RFC.** Derived from a runnable design-time prototype (an exploratory
spike, not included in this change) and its audit (below).
No behavior is changed by this document. Companion to
[`route-contracts.md`](./route-contracts.md) (the geometry layer this formalizes) and
[`abstraction-recommendations.md`](./abstraction-recommendations.md) (the family-dispatch
waist this mirrors one layer down). The binding constraint, as everywhere, is
**determinism** (CLAUDE.md: identical input → identical geometry).

This is the *geometry-layer companion* to the family-dispatch waist shipped in PR #74
(`render-family-hooks.ts` + `PositionedDiagram`). PR #74 reified *which family* runs;
this reifies *which geometry passes* run, in what order, under what invariants.

---

## 1. Motivation, with measured evidence

`elkToPositioned` (`src/layout-engine.ts`) runs a sequence of hand-wired, comment-documented
mutation passes over a shared `{ nodes, edges, groups }` bag after ELK. A runnable
design-time prototype (an exploratory spike, not part of this change) measured the gap
between what runs and what is documented/checked:

| Fact | Value | Source |
|---|---|---|
| Real post-ELK passes | **16** | recovered from `src/layout-engine.ts` by the prototype |
| Documented in `route-contracts.md §8` | **5** | the §8 pipeline diagram |
| **Undocumented passes** | **11** | `equalizePeerNodeDimensions`, `alignForkRejoinPeerCenters`, `alignPortLanes`, `centerPeerBarycenters`, `honorLinkRankDistance`, `applySymmetricFanoutEmissions`, `applySymmetricParallelEdgeLanes`, `applyParallelDuplicateLanes`, `collapseTinyBundledHitches`, `reassignBundledSiblingLabels`, `translateGeometryToNonNegativeOrigin` |
| Passes that are *exported* (reusable/testable in isolation) | **3 of 16** | the other 13 are private to `layout-engine.ts` |

The 11 undocumented passes are almost exactly the symmetry/peer-centering family added
across the decision-branch saga (#42/#56/#57/#61/#73) and the duplicate-lane work. The §8
diagram froze at the PORT_EXACT era and the saga never updated it. Three structural problems
follow:

1. **No single source of truth.** The pipeline order lives only in the imperative body of one
   function; the doc is a stale prose copy. Adding pass #17 needs no doc change and gets none.
2. **Cross-pass invariants are comments, not checks.** Two load-bearing rules — *"after the
   route-contract pass only whole-graph translation is allowed"* and the symmetry-saga ratchet
   *"this pass may move symErr but must not worsen crossings/hard"* — exist as English in
   `layout-engine.ts` and `route-contracts.md`. Nothing enforces them; a misordered or
   over-reaching pass is caught only by snapshot diff, if at all.
3. **No reuse seam.** 13 private passes can't be unit-tested, mutation-tested, or reordered in
   isolation; the symmetry passes had to be verified through full-pipeline snapshots.

The prototype demonstrates the fix is cheap: a typed pass list + a 60-line runner reproduces
the order faithfully and **catches both bug classes** (node-move-after-freeze; metric not
owned) on injected-fault pipelines, with the real manifest running clean.

## 2. The abstraction

```ts
interface LayoutPass {
  id: string
  doc: string                       // one-line role (the §8 line is GENERATED from this)
  after: string[]                   // partial-order deps, each with a recorded reason (see §3.1)
  mutates: PassEffect[]             // what geometry it changes (a SET — see note) — drives the freeze (§3.2)
  mayChangeMetrics: RubricMetric[]  // rubric metrics it is permitted to move — the ratchet (§3.3)
  determinism: 'pure-order' | 'fixed-point' | 'in-place'
  enabled?: (ctx: LayoutPassContext) => boolean   // e.g. bundling is gated on mergeEdges
  run: (ctx: LayoutPassContext) => void           // mutates the shared PositionedGraph in place
}

type PassEffect =
  | 'positions'    // moves node x/y         → invalidates routes, ports, certificates
  | 'dimensions'   // changes node w/h       → invalidates routes (boxes moved)
  | 'edges'        // rewrites edge polylines only
  | 'translate'    // uniform whole-graph shift — preserves ALL routes/ports/certs
  | 'extract'      // builds geometry from ELK output (pre-routing)
```

**`mutates` is a *set*, not one value** (correction grounded in the code: `equalizePeerNodeDimensions`
writes node positions *and* dimensions). `extract` marks the producer — the first pass builds geometry
from ELK; `translate` marks the lone finalizer permitted after the freeze; the `bounds` computation at
the tail is pure arithmetic, a **non-pass epilogue** that is not a member of the list.

`LayoutPassContext` is the real shared bag, not a model: `{ nodes, edges, groups, graph,
direction, style, bundled, margins, layoutPadding }` plus a `frozen` flag the runner sets.
The whole pipeline is one ordered constant:

```ts
const LAYOUT_PIPELINE: LayoutPass[] = [ /* the 16 passes */ ]
```

and `elkToPositioned` becomes `runPipeline(ctx, LAYOUT_PIPELINE)` — **the list is the
execution path, not a description of it** (the prototype's key correction to itself, audit
finding A6). This mirrors the idiom PR #74 already shipped: a record of per-unit functions in
a fixed, source-ordered list, dispatched by a thin runner (`render-family-hooks.ts`).

## 3. The three invariants the runner enforces

### 3.1 Ordering (partial, with reasons)
Each `after` edge carries *why* it exists (recoverable from the comments/commits), e.g.
`alignPortLanes` after `equalizePeerNodeDimensions` ("downstream centering must see symmetric
boxes"), the symmetry passes after `bundleEdgePaths`+`clipEdgeToShape` — but, per §8 R1, with **no `after`
among themselves** (their order is empirically free). The runner topologically
checks the declared order; the prototype's flat chain (audit A5) is replaced by the real
partial order so the list documents *constraints*, not just *a* sequence.

### 3.2 Freeze (precise definition — audit A4)
`applyRouteContracts` sets `frozen`. After it, a pass may run **iff** every effect in its
`mutates` set is `'translate'` (or an `'edges'` write that re-certifies); any `'positions'` or
`'dimensions'` effect is rejected, because moving a box or a node invalidates the
ports/lanes/certificates the route pass just proved. The prototype's coarse "movesNodes" flag is split into `positions`/`dimensions`/
`translate` so the legitimate post-freeze pass (`translateGeometryToNonNegativeOrigin`, verified
to add a single `(dx, dy)` to every node, group, edge point and label — a pure uniform shift) is
allowed while a stray re-center is caught. This turns
`route-contracts.md`'s prose rule into a typed, checked one.

### 3.3 Ratchet (must be *measured*, not declared — audit A2)
`mayChangeMetrics` is the symmetry-saga discipline made structural: a pass may move only the
metrics it lists, and **no pass may worsen `hard`**. Critically, the real implementation must
not *trust* the declared set (the prototype's weakness): in a debug/test mode the runner calls
the existing `assessLayout` (`src/layout-rubric.ts`) before and after each pass and asserts the
delta touches only declared metrics. The declaration is the contract; the rubric is the proof.
This makes "centering must not cost crossings" a CI check instead of a reviewer's memory.

## 4. Determinism and the migration plan (the real risk)

The prototype deliberately punts the hard part: it models effects with counters, so it proves
the *invariant shapes* but not *byte-identical geometry* (audit A1). The real work is exactly
the determinism-preserving migration, and it follows the proven PR #74 playbook —
**wrap-then-replace, one pass at a time, behind the snapshot/drift-sentinel suite**:

1. Land `LayoutPass`/`runPipeline` and the manifest with each `run` *delegating to the existing
   function* (no logic moved). `elkToPositioned` calls `runPipeline`. Assert byte-identical
   output across the contact sheet (A–V), the 271-entry docs corpus, the determinism grid, and
   the cross-process test. This is a pure indirection step — zero geometry change by
   construction.
2. Relocate the 13 private passes into `src/layout/passes/` as `(ctx) => void` units, one
   commit each, snapshot-gated. (Adding `export`/moving a function is behavior-preserving; the
   gate proves it.)
3. Generate `route-contracts.md §8` from the manifest (`doc` fields) via a doc-sync test, the
   way `BUILTIN_FAMILY_METADATA` projects family lists. The drift in §1 becomes impossible.
4. Turn on the §3 invariant checks in the test/debug runner; fix or annotate any pass whose
   real behavior violates its declared contract (expected: a few `mayChangeMetrics` widen to
   match measured reality — itself a useful finding).

No step changes geometry; each is independently revertible; determinism is the gate, not an
afterthought.

## 5. What the prototype got wrong or deferred (the audit, verbatim)

A self-critique, so the spec inherits the lessons rather than the prototype's shortcuts:

- **A1 — models effects, not geometry.** Counters, not a real `PositionedGraph`; proves invariant
  *shape* only. → §4 makes byte-identity the migration gate.
- **A2 — metric ownership is declared, not measured.** The `mayChangeMetrics` values are
  hand-guessed; nothing checks them. → §3.3 measures them against `assessLayout`.
- **A3 — faithfulness is regex, not AST.** It verifies manifest→source order but can't detect a
  *new* unmodeled pass, a conditional call, or a rename. → made moot by §4.1 (the list IS the
  path); until then, an AST check (ts-morph) over `elkToPositioned`'s call statements.
- **A4 — freeze modeled too coarsely** (one "movesNodes" bit). → §3.2 splits the effect kind and
  handles `dimensions` vs `positions` vs `translate`.
- **A5 — ordering encoded as a total chain.** The real constraints are a partial order with
  reasons. → §3.1.
- **A6 — the prototype is a shadow, not the path.** A shadow re-drifts. → §4.1 makes the manifest
  the execution path; the faithfulness check is a migration scaffold, not the end state.
- **A7 — non-pass orchestration ignored.** `margins`, `nodeMap`, the `mergeEdges` gate, the
  per-edge `clipEdgeToShape` loop. → `enabled?(ctx)` for gates; pass granularity is graph-level,
  with intra-pass loops staying inside a pass's `run`.

## 6. Grounding: literature and the repo's own precedent

- **Nanopass** (Sarkar/Waddell/Dybvig ICFP 2004; Keep/Dybvig ICFP 2013) and the **LLVM/MLIR
  pass manager**: a compiler back-end is a typed, ordered list of small passes with declared
  invariants — exactly this pipeline. The references already live in
  `abstraction-recommendations.md`; they were applied to family dispatch, not yet to geometry.
- **Proof-carrying transforms** (the existing `RouteCertificate`, à la Necula PCC 1997): the
  freeze invariant is the cross-pass complement — certificates prove an edge; the freeze proves
  no later pass invalidated it.
- **The repo's own waist precedent**: `render-family-hooks.ts` (record of per-family functions,
  metadata-ordered) is the template. This is the same move one layer down — a thin waist, not a
  universal IR (the `lessons-learned.md` Loop 22 doctrine: *"prefer thin waist contracts over
  universal models"*).

## 7. Testing strategy

- **Characterization first:** the indirection step (§4.1) is gated by byte-identical contact
  sheet + corpus + determinism grid + cross-process snapshots — red-first is "any diff fails."
- **Property tests** (mirroring `property-abstraction-waists.test.ts`): the pipeline is a valid
  topological order of its `after` graph; no `positions`/`dimensions` pass runs after `frozen`;
  for a random corpus, `assessLayout` deltas per pass ⊆ declared `mayChangeMetrics`; `hard`
  stays 0 across every pass. Plus a **commutativity guard** for any passes declared mutually
  unordered (the three symmetric passes, §8 R1): all orderings must produce byte-identical geometry
  across the corpus, so a future order-sensitive change fails loudly.
- **Doc-sync test:** `route-contracts.md §8` is generated from the manifest; drift fails CI.
- **Mutation lane:** the relocated passes join the scoped Stryker config (most are currently
  unreachable to it because they're private — a coverage win on its own).

## 8. Questions — resolved and open

### Resolved

- **R1 (was OQ1) — the three symmetric passes' order is NOT load-bearing.** Permuting
  `applySymmetricFanoutEmissions` / `applySymmetricParallelEdgeLanes` /
  `applyParallelDuplicateLanes` through all **6** orderings produced **byte-identical**
  `layoutMermaid` geometry across an **83-diagram** corpus (the heuristic-tracker triggers —
  reciprocal / fan-in N=3–8 / diamond / mfa — plus 10 targeted fan-out/parallel/duplicate
  fixtures). They are non-trivial there (skipping all three changes **28/83** diagrams), so this is
  commutativity, not vacuity. *Consequence:* the three declare an `after` on bundling/clipping but
  **none on each other** (§3.1). *Caveat:* corpus-empirical, not a proof — they share the `bundled`
  set, so a diagram where one edge is simultaneously a symmetric-fanout member and an exact
  duplicate could in principle interact; the commutativity guard (§7) rides CI so any future break
  fails loudly.
- **R2 (was OQ3) — `equalizePeerNodeDimensions` vs the freeze — subsumed by A1.** It writes node
  positions *and* dimensions (hence `mutates` is a set, §2); it runs pre-route so the freeze is moot
  for it today, and the `dimensions` effect kind keeps a future post-route resize honest.

### Open  (P1 = real design risk · P2 = refinement)

*Effect & freeze model*
- **A2 (P1) — is `hard == 0` per-pass or end-state?** Intermediate passes (e.g. `alignPortLanes`
  sliding a node) can transiently create an overlap a later pass clears, but the rubric's hard
  metrics are end-state. Per-pass is too strict (false positives); end-state-only can't localize the
  culprit. Lean: end-state for `hard`, per-pass for ownership/direction.
- **A3 (P2) — `bundled` is a non-geometry channel** written by bundling + the symmetric passes and
  read by route contracts. Is it frozen post-route, and does `reads`/`writes` cover Set membership?

*Ratchet semantics*
- **B1 (P1) — `mayChangeMetrics` needs direction, not just a set.** Passes *trade* metrics (fan-in
  centering buys symmetry with +2 bends). "May change X" ≠ "may worsen X"; without a per-metric
  direction/budget (`improve-only` | `may-worsen` | `trade≤N`) an intended trade is
  indistinguishable from a regression.
- **B2 (P2) — cost & placement of the measured ratchet.** `assessLayout` × passes × corpus is
  expensive; confirm it rides debug/CI only, never the production render path.

*Pipeline boundary*
- **C1 (P1, partly settled in §2) — phase tagging.** The list is `extract` → … → `translate`;
  ELK/`mermaidToElk` are upstream; `bounds` is a non-pass epilogue. Open: do producer/finalizer
  passes need an explicit `phase` tag, or does `mutates` (`extract`/`translate`) carry it?
- **C2 (P2) — end-to-end vs post-ELK only?** Should `mermaidToElk`+ELK ever be passes (full
  nanopass), or is post-ELK the permanent boundary? Lean: post-ELK only — ELK is a black box.

*Migration mechanics*
- **D1 (P1) — extraction blast radius.** The 13 private passes close over module-scope state (22
  `DEFAULTS`/`ARROW_HEAD`/`PORT_EXACT`… references); relocating them to `src/layout/passes/` likely
  needs a precursor "shared kernel" extraction. Scope it before promising migration step 2.
- **D2 (P2) — context assembly.** Passes take inline-computed args (`margins`, a `nodeMap` rebuilt
  *after* node moves, the `mergeEdges` gate). Is `LayoutPassContext` a faithful superset, and does it
  need lazy/derived fields (a `nodeMap` that recomputes on position change)?

*Cross-surface*
- **E2 (P2) — should ASCII's grid pipeline adopt the same `LayoutPass` shape?** Share the
  *abstraction* only if the corpus shows the `after`/freeze/ratchet vocabulary fits grid geometry;
  else keep it SVG-side (I8: share intent, not geometry).

## 9. Where the academic ideal is the *wrong* call here

- **Do not build a general pass *framework* (plugin discovery, dynamic registration).** The
  passes are in-tree, finite, and order is load-bearing and deterministic. A fixed source-ordered
  array is the right amount of structure; a registry that external code extends would reintroduce
  the import-order nondeterminism the repo forbids. (Same conclusion PR #74 reached for families.)
- **Do not lift passes into a typed effect system / monad.** TypeScript renders it awkward and it
  buys nothing over `mutates` + a runner check; the data-oriented descriptor stays inspectable and
  serializable (the repo's recurring constraint).
- **Do not unify with the route-contract internal stages** (classify→simplify→straighten→certify).
  Those are sub-steps *inside* one pass with their own fixed-point loop; flattening them into the
  top-level list would leak the straightener's internals and break its iteration contract. The
  pass list treats `applyRouteContracts` as one opaque pass (its internal
  classify→simplify→straighten→certify fixed-point is owned by the contract doc); only the
  whole-graph `translate` finalizer runs after it.

---

**Bottom line.** The prototype proved the abstraction is cheap, faithful, and catches real bug
classes, and its audit surfaced exactly where a real implementation must do more: make the list
the execution path, measure the ratchet against the rubric, split the freeze effect kinds, and
gate every step on byte-identical snapshots. The result is the geometry-layer twin of the
family-dispatch waist the repo just shipped — and it closes the single clearest remaining
abstraction gap the audit/archaeology identified.
