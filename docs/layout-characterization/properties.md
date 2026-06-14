# Load-bearing properties of the ASCII grid layout

This is the **smallest set of properties that characterise and determine** the
hand-written ASCII grid + A\* layout algorithm
(`src/ascii/grid.ts`, `pathfinder.ts`, `edge-routing.ts`, `edge-bundling.ts`).
Each property is encoded as a property-based test in
[`src/__tests__/characterization-layout.test.ts`](../../src/__tests__/characterization-layout.test.ts)
and motivated by a worked example in [`contact-sheet.md`](./contact-sheet.md).

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

Conversely, the set does **not** include redundant properties:

- "Edges are 4-adjacent paths" is already implied by **P3** at the output level.
- "Same-level nodes share a flow-axis coordinate" is the converse of **P7** and is
  not independently load-bearing for trees.
- Crossing count / edge length / compactness are **quality heuristics**, not
  invariants — asserting exact values is brittle and they are intentionally
  left to the golden corpus, not this kernel.

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
  Stryker (`stryker.ascii.config.json`) is the tool that can verify it.

## How to use this

```bash
# Run the characterisation kernel
bun test src/__tests__/characterization-layout.test.ts

# Regenerate the worked-examples contact sheet (approval workflow)
bun run scripts/characterization/contact-sheet.ts

# Verify which properties are actually load-bearing (kills unique mutants)
npx stryker run stryker.ascii.config.json
```
