# Visual review and production comparison

Originally reviewed 2026-07-15 and re-reviewed for the current branch on
2026-07-22 at native resolution. The Section B sheet is
`docs/design/families/section-b-brand-evidence.png` (1560×7944, 60 cells). The
website comparison captured every visible diagram SVG on the branch homepage
at `http://127.0.0.1:9095/` and its deployed equivalent at
`https://agentic-mermaid.dev/` in the same Chromium build and viewport.

## Current-branch re-review

The 2026-07-22 re-review covers the two geometry changes introduced after the
original production comparison. In all four style variants, State initial and
final transition shafts now end on the painted pseudostate rings (a 2px gap in
the previous shared-box approximation is now 0px). XYChart now retains the
authored `Renders` y-axis title and `0 --> 100` range through the agent
parse/serialize projection. The remaining 52 cells provide current-state
regression context; this sheet is not presented as a causal before/after image
for those families. The dedicated shape-outline contact sheet supplies the
revision-pinned before/after comparison.

## Deployed website comparison

The audit compared SVG bytes first, then rasterized each SVG independently.
Eleven of thirteen SVGs are byte-identical to production. Class changes because
the official exemplar now demonstrates inheritance and composition and because
endpoint symbols are no longer occluded by class surfaces. Gantt retains the
previously audited family-authored opacity difference.

| # | Diagram screenshot | Branch appearance | Difference from deployed production |
|---:|---|---|---|
| 1 | Flowchart · Watercolor + Paper | Warm paper, hand-drawn service boundaries and database cylinders. | SVG and screenshot byte-identical; no geometry, paint, or text change. |
| 2 | Flowchart · Report Figure + GitHub Light | Restrained publication lines and compact labeled groups. | Byte-identical. |
| 3 | Flowchart · Compact Trace Map + Tokyo Night | Dark operations palette, uppercase compact labels, orthogonal routing. | Byte-identical. |
| 4 | Timeline · Hand-drawn + Catppuccin Latte | Two roadmap columns with sketch frames and purple milestones. | Byte-identical. |
| 5 | Class · Patent Hatching + Paper | Compact three-class composition/inheritance example with technical hatching and complete diamond/triangle endpoints. | Intentional source and renderer change: 319.4×432 → 420.7×471.6. The old example showed only an association; the branch visibly demonstrates composition and inheritance, with markers painted after surfaces and diamonds/lollipops anchored outside the owning class. |
| 6 | ER · Riso Print + Salmon | Wide three-entity relationship strip with red print treatment. | Byte-identical. |
| 7 | Journey · Dark Ops Dashboard + GitHub Dark | Dark score rail, four task cards, actor legend, and section bands. | SVG and independent raster are byte-identical. |
| 8 | Quadrant · Compact Trace Map + Nord Light | Four-quadrant planning matrix with sparse labeled points. | Byte-identical. |
| 9 | Gantt · Plan Drafting + Solarized Light | Release train with status-specific task bars and milestone diamond. | 1,881 of 238,056 independently rasterized pixels differ (0.790%, maximum channel delta 12). Geometry, fills, labels, and dates are unchanged. The branch carries family-authored task opacity into rough redraw strokes (`1`, `0.92`, `0.95`); production redraws every outline at full opacity. This preserves task-status semantics rather than inventing branding. |
| 10 | Agentic Mermaid edit loop | Source → parse → narrow → mutate → verify → serialize/render, with warning return path. | Byte-identical. |
| 11 | Sketch note style card | Watercolor/Paper approval flow with loose ink. | Byte-identical. |
| 12 | Report figure style card | GitHub Light approval flow with publication treatment. | Byte-identical. |
| 13 | Ops map style card | Nord Light compact trace treatment with uppercase labels. | Byte-identical. |

All thirteen branch captures were readable at native size. No labels were
clipped, no connectors crossed unrelated text, and no diagram overflowed its
frame.

## Section B all-family sheet

An exact production screenshot does **not** exist for these role-style records:
the pinned pre-Section-B commit `e60be1e68b5aa51fac205c7cf9e481ea3b27ffc8`
rejects the public `roles` field with `Invalid style spec: unknown field
"roles"`. The review therefore does not fabricate a before image. The
comparison below states the visible branch projection against each production
family's existing semantic/layout behavior; source values and family-owned
meaning remain unchanged.

Across every row, the four columns of treatment are consistent: the sentinel is
large, bold, rounded, purple/red; editorial is warm, thin, serif, and nearly
square; technical is compact, blue/teal, and square; operations is dark,
uppercase, monospaced, and cyan. The following family-specific checks were made
in all four treatments:

| Family | Audited difference from the production capability floor |
|---|---|
| Flowchart | Node typography, padding, radius, border weight, and connector treatment change together; branch topology and labels are unchanged. |
| State | State boxes and transitions inherit the same role face. Start/end markers keep their semantics and positions; transition shafts now meet the painted rings instead of the larger layout boxes. |
| Sequence | Actor boxes and message/lifeline strokes project the brand face; request/response direction and message semantics remain unchanged. Separate fragment fixtures confirm resolved padding, divider clearance, and header-over-lifeline compositing. |
| Timeline | Period/event cards inherit node/group/label fallbacks; chronological order and rail anchors remain intact. |
| Class | Class surfaces, members, and relationships remain structurally identical while archetype paint and typography change. Endpoint overlays keep markers visible above class surfaces; the #178 marker-resource fix anchors composition/aggregation diamonds and lollipops wholly outside the owning class in both endpoint spellings and every direction. |
| ER | Entity surfaces use fallbacks and the exact relationship projection changes connector typography/stroke without changing cardinality. |
| Journey | Section headers use resolved tracking/weight in both measurement and rendering; task scores, actor attribution, and rail geometry remain meaningful and collision-free. |
| Architecture | The shared palette/Look contract changes paint while the census honestly marks exact role projection not-applicable; service/junction topology stays unchanged. |
| XY chart | Exact bar/series projections change paint and line weight; authored values and bar heights remain unchanged. The agent round trip now retains the authored y-axis title and range, so those axes intentionally differ from the earlier sheet. The lower inset contains the full resolved-font baseline and descent in every treatment. |
| Pie | `Pro` remains the family-authored highlighted slice and every wedge path is unchanged. The sentinel category binding changes applicable paint/cue only. All legend rows now fit the canvas under rendered role typography. |
| Quadrant | Archetype styling changes the frame, labels, and points without moving authored coordinates or quadrant meaning. |
| Gantt | Task/milestone paint and cues change while dates, durations, critical status, and timeline geometry remain authoritative. |
| Mindmap | The shared palette/Look contract produces a coherent family treatment while exact role projection remains not-applicable; hierarchy and branch order are unchanged. Direction-monotonic cubic controls remove short-edge hooks without moving endpoints. |
| GitGraph | The shared palette/Look contract changes commit/branch treatment while exact role projection remains not-applicable; commit topology is unchanged. Layout and rendering share a 12-unit horizontal commit-label inset. |
| Radar | Exact point/legend projections and visible cue treatment change; axis values, polygon coordinates, and series identity remain unchanged. |

### Defects found and corrected during review

1. All four sheet headings previously used absolute `y=37/64`, overprinting
   their text in the first band and leaving later bands blank. Heading
   coordinates now include each section offset.
2. Pie layout measured the 13px default legend while rendering a 16px role
   font in the sentinel, clipping `Enterprise (10.0%)`. Layout and rendering
   now share `PIE_STYLE_DEFAULTS`, resolved weight/transform/tracking, and the
   same style face. All four Pie panels fit after regeneration.
3. Class endpoint symbols could be painted under or anchored inside class
   surfaces. The post-surface overlay preserves complete silhouettes, while the
   #178 marker-resource refs now place composition/aggregation diamonds and
   lollipops wholly outside the owning class.
4. XY bottom labels reserved the tick coordinate but not the resolved baseline
   shift/descent. The lower inset now contains every label, including the large
   Sentinel treatment.
5. GitGraph commit pills used only four units of horizontal label padding.
   Layout and rendering now share a 12-unit inset.
6. Mindmap cubic controls could reverse direction on short links. Monotonic
   controls remove the hook while preserving node and endpoint geometry.
7. Styled Sequence fragment fixtures inherited adjacent-frame collisions and
   lifeline-over-header paint. Resolved group padding, message width, and a
   single post-lifeline header projection repair those production defects.

After those corrections and the 2026-07-22 re-review, all 60 cells were
inspected as four native-width variant crops: headings are distinct, text is
readable, endpoint silhouettes remain complete, and cards remain inside their
panels. State shaft endpoints and XY axis projection changed as described
above; other quantitative and family-authored emphasis geometry remains
unchanged. The receipt additionally executes
the sentinel across all registered families through default, rough, and hybrid
public SVG+PNG paths. Corrected Class marker attachment is included in the
native-size review.

## Built-in Pie Look production comparison

The eight intentionally changed styled-output goldens were rendered as native
PNGs in both the branch and the production worktree at `828c6944`. Unlike the
Section B custom-role sheet, these are valid production equivalents because
all eight Look names exist on the pinned production comparison commit `828c6944`.

| Look | Production → branch PNG | Review |
|---|---:|---|
| accessible-high-contrast | 867×552 → 999×544 | The branch reserves the actual large bold role font; all four legend rows fit instead of clipping at the production right edge. |
| architectural-plan | 867×552 → 919×538 | The uppercase condensed legend receives its measured width; wedge angles and values are unchanged. |
| chalkboard | 867×552 → 974×544 | The wider handwritten labels now own sufficient canvas width; sketch geometry and palette remain unchanged. |
| ops-schematic | 867×552 → 919×538 | Monospaced uppercase metrics are reflected in layout; no label clipping. |
| patent-drawing | 867×552 → 894×540 | Serif legend width is reserved with a small canvas expansion; hatch and quantitative geometry remain intact. |
| publication-figure | 867×552 → 950×540 | Publication typography receives its true width rather than the generic 13px estimate. |
| risograph | 867×552 → 925×542 | Serif legend rows fit; riso hatching and source-order values are unchanged. |
| status-dashboard | 867×552 → 925×542 | Bold dashboard rows fit inside the dark canvas; colors, percentages, and highlight target are unchanged. |

The canvas changes are intentional layout repairs, not data changes: slice
angles, values, source order, and family-authored emphasis remain authoritative.
The old production screenshots visibly truncate long legend rows; every branch
screenshot contains all text with normal right-side breathing room.

## Ancillary Pie evidence

The committed `pie-highlightslice-regression-matrix.png` and
`pie-highlightslice-after.png` were regenerated and inspected after typography
measurement was unified. Their current bytes are unchanged: the long bold
Potassium legend stays inside the canvas, crisp/hand-drawn/watercolor emphasis
remains non-geometric, the pointer tooltip stays legible, and the standalone
Product X card has no clipping or collision.
