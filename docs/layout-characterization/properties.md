# Load-bearing properties of the layout characterisation

This is the **smallest set of properties that characterise and determine** the
hand-written ASCII grid + A\* layout algorithm
(`src/ascii/grid.ts`, `pathfinder.ts`, `edge-routing.ts`, `edge-bundling.ts`).
Each property is encoded as a property-based test in
[`src/__tests__/characterization-layout.test.ts`](../../src/__tests__/characterization-layout.test.ts)
and motivated by a worked example in [`contact-sheet.md`](./contact-sheet.md).

The renderer breadth layer is intentionally smaller and more conservative:
[`src/__tests__/characterization-families.test.ts`](../../src/__tests__/characterization-families.test.ts)
extends only the universal assumptions that hold across every diagram family
and public output surface. It is motivated by
[`contact-sheet-families.md`](./contact-sheet-families.md).

The visual-quality layer
([`visual-quality.md`](./visual-quality.md)) is an approval artifact rather than
part of the minimal property kernel: it records SVG snapshots, SVG/PNG hashes,
and review metrics for crossings, bends, route length, canvas area, label fit,
and edge-label overlap risk. After PR 30, the hard route-quality oracle lives in
`src/layout-rubric.ts` and `src/__tests__/layout-rubric.test.ts`; this document
does not duplicate those assertions.

"Load-bearing" has a precise operational meaning here (see
[§ Minimality](#minimality)): a property is load-bearing if removing it lets a
plausible single-edit mutation of the layout code survive — i.e. it is the
property that *kills* that class of mutant. Properties that kill no unique
mutant are redundant and excluded.

These are **characterisation** properties in Michael Feathers' sense (*Working
Effectively with Legacy Code*, ch. 13): they pin **what the algorithm does
today**, not what it ideally should do. A passing suite means behaviour is
unchanged; it is not a correctness oracle. When an intended change flips one of
them, that is the signal to update the characterisation deliberately.

---

## Why there are three tiers

The algorithm is a **best-effort heuristic layout**, not a solver. Empirically
(over thousands of generated graphs) its guarantees fall into three bands:

- **Tier A — universal invariants.** True for *every* valid flowchart/state
  input, including cycles, self-loops, and dense graphs. These are the hard
  contract.
- **Tier B — structural properties on well-behaved subclasses.** True for
  trees / DAGs / linear chains, where placement is unambiguous. The algorithm
  does **not** extend these guarantees to cyclic or dense graphs — and *that
  boundary is itself a characterisation* (Tier C, P10).
- **Tier C — metamorphic relations & known limits.** Relations between two
  renders (BT vs TD, RL vs LR, relabelled vs original) that pin specific design
  decisions, plus an explicit pin of a place where Tier B *fails*.

This mirrors the literature's split between **invariants** (oracle-grade, exact
assertions) and **quality heuristics** (graded, only safe to assert as
metamorphic/monotonic relations). Crossing count, edge length, and compactness
are quality heuristics and are deliberately **not** asserted here — they are
brittle golden values, not load-bearing invariants.

PR 30 adds one important refinement to that split: some visual qualities have
become hard, computable route-contract assertions for graph-projected families
(flowchart, state, architecture). Hitches, diagonal routed segments,
off-outline endpoints, edge-through-node routes, label-off-route ambiguity, and
stale straight-route certificates are no longer mere approval signals there;
they are correctness failures in `layout-rubric.test.ts` and
`contact-sheet.test.ts`. The characterisation suite therefore treats those
tests as the correctness layer and uses this directory to record approved
observable baselines around it.

---

## Tier A — universal invariants

| ID | Property | Statement (holds ∀ valid input) | Kills mutants in |
|----|----------|----------------------------------|------------------|
| **P1** | Totality | `render(src)` never throws and is non-empty. | A\* iteration cap (`pathfinder.ts`), multi-pass safety break (`grid.ts:582`), index guards |
| **P2** | Determinism | `render(src)` is byte-identical across runs. | MinHeap FIFO tie-break (`pathfinder.ts:16-27,60-63`), label/segment tie-breaks (`edge-routing.ts:299-305`), stable root sort (`grid.ts:469-470`) |
| **P3** | Orthogonality | Output contains no diagonal connector glyphs (`/ \ ╱ ╲`). | A\* move set (`pathfinder.ts:124-129`), `mergePath` (`pathfinder.ts:266-301`) |
| **P4** | Rectangularity | Every output line has the same display width. | canvas sizing (`canvas.ts setCanvasSizeToGrid`), row/column padding (`grid.ts setColumnWidth`) |

P2 is the **keystone**: it is what makes the golden/approval corpus
(`src/__tests__/testdata/`) valid at all, and it is the property the whole
determinism apparatus (FIFO heap `seq`, ELK-free pure code, insertion-ordered
maps) exists to provide. P3 is the **defining** invariant — "orthogonal A\*
router" *is* the algorithm; a diagonal is by definition a bug
(`assertNoDiagonals`, `validate.ts`).

## Tier B — structural properties (trees & chains)

| ID | Property | Statement | Scope | Kills mutants in |
|----|----------|-----------|-------|------------------|
| **P5** | Node conservation | Every declared node is drawn. | out-trees | placement multi-pass (`grid.ts:515-583`) |
| **P6** | Box non-overlap | Drawn node boxes are pairwise disjoint. | out-trees | 3×3 reservation + stride-4 collision shift (`grid.ts:76-104`) |
| **P7** | Monotone layering | For each forward edge `u→v`, `v`'s box is strictly downstream of `u` on the flow axis (below for TD, right for LR). | trees | layer stride (`grid.ts:539`), flow-axis direction (`grid.ts:496-571`) |
| **P8** | Structural round-trip | `asciiToMermaid(render(chain))` recovers the same node and edge counts. | linear chains | edge emission (`converter.ts`), routing reaching endpoints (`edge-routing.ts:222-228`) |

P7 is the **Sugiyama layer-assignment essence** in character space: it is the
single property that says "this is a layered downward/rightward drawing." P8 is
the only property that checks **edges connect the right endpoints** end-to-end,
dogfooding the repo's own documented round-trip contract (`reverse.ts`).

## Tier C — metamorphic relations & known limits

| ID | Property | Statement | Pins |
|----|----------|-----------|------|
| **P9a** | BT = flip(TD) | An ASCII BT render equals the vertical flip (with arrowhead remap) of the TD render. | `index.ts:179-194` (BT laid out as TD then flipped) |
| **P9b** | RL = LR | An RL render is byte-identical to the LR render. | `index.ts:179-181` (RL "not yet implemented", treated as LR) |
| **P9c** | Relabel invariance | Replacing labels with same-length labels leaves the layout skeleton unchanged. | placement depends on label *width*, not identity |
| **P10** | Known limit | A 2-cycle does **not** conserve all nodes (P5 fails). | placement multi-pass safety break (`grid.ts:582`) — pins that this is *currently* lossy |

P9b and P10 are "canary" characterisations: they currently pin a *limitation*.
If someone implements real RL support or makes cyclic placement lossless, these
tests flip — which is exactly when a human should look and re-approve.

---

## Renderer-family breadth properties

These properties answer the "all renderers" part of the prompt. They do **not**
claim that every renderer shares the grid algorithm's structural invariants;
sequence, class, ER, timeline, journey, xychart, pie, quadrant, and
architecture each have their own layout strategy. Instead, they pin the
cross-family contracts that make the render surface usable and refactorable.

| ID | Property | Statement | Scope |
|----|----------|-----------|-------|
| **F1** | Dispatch totality | Each of the 12 built-in families renders non-empty text/SVG and a valid PNG signature. | flowchart, state, sequence, class, ER, timeline, gantt, journey, xychart, pie, quadrant, architecture |
| **F2** | Sentinel label conservation | Representative labels survive on the text and SVG surfaces, proving family dispatch did not fall through to an empty/adjacent renderer. | all 12 families |
| **F3** | Renderer determinism | Representative text, SVG, and PNG renders are byte-stable across repeated calls. | all 12 families |
| **F4** | Output hygiene | Plain text has no ANSI escapes when color is disabled, and text/SVG do not leak `NaN`, `Infinity`, or `undefined`. | all 12 families |
| **F5** | Text orthogonality / block-only output | Generated text renders contain no diagonal connector glyphs. | all non-grid families, with flowchart/state covered by P3 |
| **F6** | Rectangularity boundary | Rectangular text output holds for box/graph families only; chart/list/architecture families are intentionally ragged. | sequence, class, ER are rectangular; pie pins the ragged boundary |

F1-F4 are finite matrix properties because the renderer surface is a dispatch
contract: one canonical specimen per family catches missing switch branches,
misdetected families, broken PNG rasterization, and accidental text/SVG leakage.
F5-F6 are generated where a family has a compact valid-input generator and the
invariant is meaningful.

---

## Visual-quality approval signals

The graph-drawing literature treats crossings, bends, route length, canvas area,
and label overlap as aesthetic objectives or optimization costs. They are
important, but they are not invariant in the same way as totality,
determinism, or orthogonality. PR 30's route-contract work promoted a subset of
these signals to hard checks when a clear geometric contract exists; the
remaining cross-family metrics stay in a generated approval artifact instead of
being folded into the minimal PBT kernel:

| ID | Signal | What changes mean |
|----|--------|-------------------|
| **V1** | SVG snapshots | Human-visible visual drift in any renderer family. |
| **V2** | SVG/PNG fingerprints | Byte-level drift on both vector and raster public surfaces. |
| **V3** | Quality metrics | Changes in crossings, bends, route length, area fill, label fit, or edge-label overlap risk. |
| **V4** | Generator drift check | A stale contact sheet or visual report fails `characterization-generated-artifacts.test.ts` / `bun run characterization:check`. |

These signals should trigger review, not panic. A quality metric can improve,
degrade, or simply change because a layout strategy changed. The review question
is whether the new visual behaviour is intended and whether the generated
artifact was updated deliberately.

The PR 30 rebase is the model case. The generated-artifact check identified
only the flowchart and state snapshots as stale after the route-contract merge,
which matches the observed layout surface of that PR in this canonical family
set. Drift in class, ER, sequence, chart, pie, quadrant, timeline, journey, or
architecture snapshots would have required a separate explanation unless the PR
explicitly claimed and reviewed that family. Architecture is graph-projected
through route contracts, so the important fact here is not that PR 30 could
never affect it; it is that this rebase did not.

---

## <a id="minimality"></a>Minimality: why this set, and no smaller

The target is *the smallest set of properties whose removal lets a previously
killed mutant survive* (the operational definition of "load-bearing" from
property-based mutation testing, Bartocci et al. 2023). The reasoning per
property:

- Drop **P2 (determinism)** → a mutant that swaps the deterministic heap
  tie-break for an order-dependent one survives every other property (output is
  still total, orthogonal, rectangular, correctly shaped) but breaks the golden
  corpus non-reproducibly. Only P2 catches it.
- Drop **P3 (orthogonality)** → a mutant adding a diagonal A\* move survives P1/P2/P4
  (still total, deterministic, rectangular) but produces `\`/`/`. Only P3 catches it.
- Drop **P4 (rectangularity)** → an off-by-one in row/column padding can ragged-edge
  the canvas while staying total, deterministic, and diagonal-free.
- Drop **P7 (monotone layering)** → a mutant that flips the flow axis or zeroes the
  `+4` level stride still renders *something* total/orthogonal/rectangular;
  P5/P6 (conservation, non-overlap) can still hold. Only P7 sees that children
  no longer go downstream of parents.
- Drop **P8 (round-trip)** → a mutant that drops or duplicates an edge keeps every
  geometric invariant; only the end-to-end node/edge-count check notices.
- Drop **P5/P6** → conservation and non-overlap are independent failure modes
  (a node can be dropped *or* two boxes can collide); neither implies the other.
- Drop **P9a/P9c** → BT-flip and relabel mutants are otherwise invisible: a broken
  flip still yields a valid TD-shaped diagram; a label leaking into placement
  still yields a valid diagram for the original labels.
- **P1 (totality)** is the cheap floor that every other property silently assumes
  (they can't assert on a throw).
- Drop **F1/F2** → a renderer-family dispatch branch can disappear, fall through,
  or return a placeholder while the deep grid tests remain green.
- Drop **F3/F4** → renderer-specific nondeterminism or leaked layout sentinels can
  escape outside the grid engine, invalidating contact sheets, snapshots, and PNG
  raster output.
- Drop **F5/F6** → the breadth layer stops recording which text renderers share
  the grid-like contracts and which intentionally do not.

Conversely, the set does **not** include redundant properties:

- "Edges are 4-adjacent paths" is already implied by **P3** at the output level.
- "Same-level nodes share a flow-axis coordinate" is the converse of **P7** and is
  not independently load-bearing for trees.
- Crossing count / edge length / compactness are **quality heuristics**, not
  invariants — asserting exact values is brittle and they are intentionally
  left to the visual approval layer, not this kernel.

The unit-level A\* invariants (shortest Manhattan path on an empty grid,
obstacle avoidance, `mergePath` idempotence, bounded search) are *also*
load-bearing but already covered by the existing
[`property-ascii-routing.test.ts`](../../src/__tests__/property-ascii-routing.test.ts);
this kernel deliberately sits one level up, at the whole-render contract, to
avoid duplicating them.

---

## Academic grounding (one line each)

- **Layered drawing / Sugiyama–Tagawa–Toda (1981); Gansner et al. (1993, `dot`).**
  The 4-phase model (cycle removal → layer assignment → crossing minimisation →
  coordinate assignment) this algorithm approximates on a character grid; P7 is
  the layer-assignment phase made observable.
- **Brandes–Köpf (2002).** Horizontal coordinate assignment with a hard "≤2
  bends per edge" bound — an example of an invariant that *is* assertable, vs.
  crossing count which is not.
- **Hart, Nilsson & Raphael (1968), A\*.** `f = g + h`; the router's heuristic is
  Manhattan distance plus a `+1` corner penalty (prefers straight runs).
- **Tamassia (1968→1987) bend minimisation; Wybrow–Marriott–Stuckey (2009)
  Orthogonal Connector Routing.** Orthogonality (P3) is a hard invariant of the
  search space; bend/length minimisation are *objectives* (penalties), not
  invariants — hence not asserted exactly.
- **Feathers (2004), characterisation tests; Falco, approval/golden tests.** The
  whole framing: pin actual behaviour, review diffs, approve changes.
- **Bartocci et al. (2023), property-based mutation testing.** The "load-bearing
  = kills a unique mutant" criterion used in [§ Minimality](#minimality);
  Stryker (`stryker.characterization.config.json` for fast PR evidence,
  `stryker.ascii.config.json` for the exhaustive run) is the tool that can
  verify it.

The fast characterization Stryker config is a smoke gate over selected mutation
ranges, not a substitute for the exhaustive ASCII run. Surviving mutants in the
smoke report are useful backlog signals for future deeper characterisation; the
full ASCII config remains the expensive overnight-style audit.

## How to use this

```bash
# Run the characterisation kernels
bun test src/__tests__/characterization-layout.test.ts
bun test src/__tests__/characterization-families.test.ts

# Verify PR 30 route-contract correctness before approving visual drift
bun test src/__tests__/contact-sheet.test.ts src/__tests__/layout-rubric.test.ts
bun run track

# Regenerate the worked-examples contact sheets (approval workflow)
bun run scripts/characterization/contact-sheet.ts
bun run scripts/characterization/contact-sheet-families.ts
bun run scripts/characterization/visual-quality.ts

# CI-friendly generated-artifact drift check
bun run characterization:check

# Quick mutation evidence for the load-bearing ranges
bun run mutation-test:characterization

# Exhaustive but slow: mutates the whole ASCII layout core
bun run mutation-test:ascii
```
