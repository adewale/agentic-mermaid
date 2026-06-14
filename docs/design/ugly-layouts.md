# What Makes a Layout Ugly

This document states the working definition of an *ugly* diagram layout that
this project has converged on, and maps each defect to a detector. It is the
specification for `eval/ugly-detector/` (which audits **rendered** output —
SVG, PNG, ASCII — not just the internal geometry the rubric checks).

## The one-line definition

> **A layout is ugly when an edge's geometry isn't forced by the node
> positions** — when it bends, floats, splays, crosses, or breaks symmetry in
> a way a clearer alternative would avoid for the *same* layout. Every bend,
> offset, and asymmetry should be the cheapest one the node positions allow,
> or it shouldn't be there. Ugliness is **unexplained geometry**.

## The defects (and how we detect them)

Grouped by the layer they live in. The first group are **hard** — they must
never appear in a finished render. The second are **soft** — present in good
layouts only when forced, and ranked below.

### Hard defects (a finished render must have zero)

| Defect | What it looks like | Detector |
|---|---|---|
| **Diagonal segment** | an edge segment that is neither horizontal nor vertical, in an orthogonal drawing | segment with `|dx| > ε` AND `|dy| > ε` |
| **Edge through a node** | an edge crossing a node's interior (occlusion) | segment intersects a non-endpoint node's body deeper than stroke width |
| **Floating endpoint** | an edge ending at an arbitrary point on the outline, not a designated connection point | endpoint not within tolerance of the shape's outline / a designated port |
| **Node overlap** | two node bodies overlapping | bbox/footprint intersection |
| **Hitch / dogleg** | a short perpendicular jog on a run whose lane is clear | a segment much shorter than its collinear neighbours, perpendicular, with a clear straight alternative |
| **Label off its route** | a label pill sitting away from the edge it names | label centroid far from its edge's polyline |

### Soft ranking (good layouts minimize these, in this priority order)

The operative priority, distilled from Purchase 1997/2002 and Ware 2002 and
from the choices made across this project:

1. **Straightness / continuity** — fewest bends; a multi-edge path reads as a
   line. (Beats everything below.)
2. **Designated-port attachment** — endpoints sit on a *named*, deterministic
   connection point, not a target-determined float. **Subtlety we encode:**
   straightness normally beats port-exactness (the strict-ports experiment was
   measured and rejected), *except* when a designated port is reachable
   **without costing a bend** — then take it. The diamond 8-port model exists
   precisely to make E/F/G/K port-exact *and* straight/symmetric at once.
3. **Symmetry / balance** — where the structure is symmetric (peer fan-ins,
   reciprocal pairs), the drawing should be too: a centered hub, two equal
   parallel lines, no peer privileged over another.
4. **Fewest bends and crossings** — after the above.

### Specific ugly shapes we have named

- **Cramming at a sharp point** — two lines crowded onto a vertex when they
  could be spread (the ±6 reciprocal-on-a-diamond-tip, before facet-mids).
- **Pinch-then-splay / hourglass** — edges converging to a narrow pair of ports
  then fanning back out to wider targets (the rejected F facet-mid+bend).
- **A line through a shape's body** — routing the short way *through* a node
  instead of around it (the rejected G facet-mid prototype).
- **Asymmetry where symmetry is natural** — a fan-in hub stuck at the top of
  its sources, or a reciprocal pair of unequal lengths.

## Why detect from rendered output (not just geometry)

The `assessLayout` rubric (`src/layout-rubric.ts`) checks the **internal
geometry** (`PositionedGraph`). The ugly-detector checks the **rendered
artifact** — the SVG/PNG/ASCII a consumer actually sees — so it:

1. catches rendering bugs where clean geometry renders wrong;
2. works on *any* diagram, including external SVGs and golden fixtures not
   produced by our layout pass;
3. validates the ASCII pipeline, which is a separate renderer that never sees
   the `RouteCertificate` contracts.

The three formats degrade in fidelity: **SVG** is the authoritative analysis
(vector paths + shape geometry are recoverable exactly); **PNG** is a faithful
raster of an SVG, so its check is "analyze the source SVG, plus a coarse
pixel-orthogonality sanity pass"; **ASCII** is a glyph grid, so detection is
limited to what the grid reveals (diagonal line glyphs, edge glyphs inside a
box interior).

## Running the audit

```
bun run audit:ugly                # render every corpus to SVG/PNG/ASCII, report
bun run audit:ugly -- --verbose   # also list soft findings
bun run audit:ugly -- --json      # machine-readable report
```

The runner (`eval/ugly-detector/audit.ts`) renders every diagram corpus in the
project — the contact-sheet scenarios, the heuristic-tracker examples, the
site samples, the layout-compare fixtures, and the ASCII/Unicode golden
fixture sources — to all three formats and runs the detectors. It exits
non-zero if any **hard** finding is present, so it doubles as a CI gate.
`src/__tests__/ugly-detector.test.ts` pins the detector's behavior.

### What the audit found (2026-06)

Across **338 diagrams / ~1000 format-audits**, exactly one real hard defect:

- **A cross-hierarchy edge into a nested subgraph drops the subgraph offset.**
  In `INCLUDE_CHILDREN` mode (no direction override), an edge from a node in an
  outer subgraph to a node in an *inner* (nested) subgraph — e.g. `A --> B`
  where `A` is in `outer` and `B` is in `inner` inside `outer` — renders at
  coordinates that are correct *relative to the inner subgraph* but missing the
  containing subgraph's translation, so the edge floats away from both nodes.
  Reproduces minimally; flat subgraphs and inner-only edges are clean. Tracked
  separately from the diamond/fan-in routing work.

The remaining non-clean results are **render errors** (a diagram type or config
header a given renderer rejects), not layout defects, and are bucketed as such.

Two findings the audit initially raised were **detector** false positives, now
fixed and regression-tested: a cylinder's footprint must union its cap ellipses
(not just the body rect), and a sub-pixel endpoint jog within the curved-shape
clip floor (~1.5px) is not a visible dogleg.
