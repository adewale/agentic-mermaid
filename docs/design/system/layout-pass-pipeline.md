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
  mutates: PassEffect               // what geometry it changes — drives the freeze invariant (§3.2)
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
boxes"), the symmetry passes after `bundleEdgePaths`+`clipEdgeToShape`. The runner topologically
checks the declared order; the prototype's flat chain (audit A5) is replaced by the real
partial order so the list documents *constraints*, not just *a* sequence.

### 3.2 Freeze (precise definition — audit A4)
`applyRouteContracts` sets `frozen`. After it, a pass may run **iff** its `mutates` is
`'translate'` or `'edges'`-that-recertify; `'positions'` and `'dimensions'` are rejected,
because moving a box or a node invalidates the ports/lanes/certificates the route pass just
proved. The prototype's coarse "movesNodes" flag is split into `positions`/`dimensions`/
`translate` so the legitimate post-freeze pass (`translateGeometryToNonNegativeOrigin`, a
uniform shift) is allowed while a stray re-center is caught. This turns
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
  stays 0 across every pass.
- **Doc-sync test:** `route-contracts.md §8` is generated from the manifest; drift fails CI.
- **Mutation lane:** the relocated passes join the scoped Stryker config (most are currently
  unreachable to it because they're private — a coverage win on its own).

## 8. Open questions

1. **Is the intra-symmetry order load-bearing?** (`applySymmetricFanoutEmissions` →
   `applySymmetricParallelEdgeLanes` → `applyParallelDuplicateLanes`.) The saga commits imply
   yes; confirm by permuting under the corpus gate and record the real `after` reasons.
2. **Should ASCII's grid pipeline adopt the same `LayoutPass` shape?** Tempting, but its passes
   are grid-geometry, not float — keep the *abstraction* shared only if the corpus shows the
   `after`/freeze/ratchet vocabulary actually fits; otherwise this stays SVG-side (the I8
   doctrine: share intent, not geometry).
3. **Where do `equalizePeerNodeDimensions`' dimension changes sit relative to the freeze?** They
   precede routing so it's moot today, but the `dimensions` effect kind exists to keep it
   honest if a future pass wants to resize post-route.

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
  pass list stops at `applyRouteContracts`; the contract doc owns what's inside it.

---

**Bottom line.** The prototype proved the abstraction is cheap, faithful, and catches real bug
classes, and its audit surfaced exactly where a real implementation must do more: make the list
the execution path, measure the ratchet against the rubric, split the freeze effect kinds, and
gate every step on byte-identical snapshots. The result is the geometry-layer twin of the
family-dispatch waist the repo just shipped — and it closes the single clearest remaining
abstraction gap the audit/archaeology identified.
