# Visual review and production comparison

## PR #394 final agent review — 2026-10-17

The regenerated reviewed PNG is **1560×9464**, with SHA-256
`8d18b4679019db5535fcf9b930a6c3a156115cf4834022ef8476a95e7467593e`. A Codex agent inspected
**all 64 cells** at their native 520×380 size, arranged as sixteen unscaled
four-treatment panels: Sentinel, Editorial, Technical, and Operations. The
candidate includes the working-tree fixes from the independent audit on top of
`f96f6bd297cc4a85f94f5cb8dff033d7fbac9ba8`; that commit alone does not identify
the candidate production code. The artifact hash identifies the exact reviewed
bytes, and `visual-approval.json` records this **agent review, not human approval**.

The review checked label containment, readable family structure, complete
connector/marker silhouettes, header clearance, resolved typography and palette
coherence. Fine member/cardinality text remains small at the sheet's thumbnail
scale; this visual review does not establish arbitrary-size accessibility or
script/font coverage. No deployed website was rechecked in this pass.

| Native cells inspected in all four treatments | Observations |
|---|---|
| Flowchart, State | Branch labels remain visible; directional tips and pseudostate contacts remain complete. |
| Sequence, Timeline | Request/response direction, actor headers, milestone chronology and event cards remain readable and contained. |
| Class, ER | Class/entity names, member or attribute rows and relationship endpoints remain present; no card crops its labels. |
| Journey, Architecture | Scores/actors and group/service topology remain legible; headers clear contained content. |
| XYChart, Pie | Axis ranges and quantitative marks remain meaningful; title/legend text fits. Pie retains authored Pro emphasis and source-order values. |
| Quadrant, Gantt | Point labels, axis titles, dates, task ranges and milestones remain visible; external point-label placement stays within its panel. |
| Mindmap, GitGraph | Hierarchy/commit topology remains readable, including complete branch labels and rotated commit pills. |
| Radar, Sankey | Axis/series legends and flow labels remain complete; chart data and family structure stay visible. |

Compared with the PNG committed at the context commit above, **37 cells change
in 358,245 pixels; 27 cells are pixel-identical**. Changes occur in Timeline,
ER, Journey, Architecture, XYChart, Pie, Quadrant, Gantt, Mindmap, GitGraph and
Radar. These counts describe the candidate-versus-committed image comparison;
they do not attribute every changed pixel to an individual fix. No baseline
image is fabricated for the pre-Section-B revision that rejected roles.

The representative Gantt and accessible XY SVG goldens were also regenerated
and inspected. Both retain their canvas dimensions and have zero off-canvas
text pixels in an independent bundled-font raster census. Their full text bands
change label placement and XY plot clearance as intended.

### Cookbook screenshots

All six existing cookbook PNGs were regenerated and inspected at native 900px
width. Before/after inspection of Cupertino, Vercel and Cloudflare confirms
readable labels, complete markers, preserved topology or quantitative data, and
retained role/semantic styling. Cupertino changes 900×192 → 900×191; Vercel
remains 900×643 (22,220 pixels changed); Cloudflare remains 900×339 (7,475 pixels
changed). Transit Route Map, Mid-century Report and Star Chart Atlas remain
pixel-identical. The exact bytes for the three documentation-only prototypes
are recorded in
[`eval/style-prototype-evidence/visual-approval.json`](../style-prototype-evidence/visual-approval.json).
This is an agent review of published documentation assets; the existing
non-endorsement and non-equivalence limitations remain in force.

## PR #390 reviewed-golden refresh — 2026-10-16

The current [reviewed rendering golden](../../src/__tests__/testdata/section-b-brand-evidence.png)
is 1560×9464 and contains 64 family-by-variant cells. It lives under
`src/__tests__/testdata/`, the repository's explicit exception for reviewed
rendering goldens. The gallery generator and unit test use this single copy;
PR before/after evidence remains a generated review artifact.

The previous committed PNG byte-matches a fresh production render at immutable
main `9925294bdf9501662b754c1260acb1c1b6819cdc` with Bun 1.4.2. The candidate was
generated at `e43f37e3ec50d0697c9f26807f53e33f49dd5b81` with the same inputs and
bundled fonts. A per-pixel comparison found 17,623 changed pixels out of
14,763,840, entirely within the four Sequence cells:

| Treatment | Changed pixels |
|---|---:|
| Sentinel | 5,188 |
| Editorial | 4,981 |
| Technical | 6,976 |
| Operations | 478 |

The other 60 cells are pixel-identical. Codex agents inspected the four Sequence
before/after crops at native size. Request/response text and arrow direction
remain complete, typography and palettes retain each treatment, and all content
fits its panel. Small changes in actor dimensions, label clearance, and lifeline
positions follow the updated sequence geometry. This records an agent visual
review, not human approval.

This simple two-participant sheet is a rendering baseline, not a reproduction
of the closed-fragment or intervening-lifeline defects. PR #390's dedicated SVG
and raster regressions provide that behavioral evidence; accepting this golden
alone does not establish that the renderer is correct.

## Historical Section B reviews

Originally reviewed 2026-07-15 and re-reviewed for the current branch on
2026-07-22 at native resolution. The Section B sheet at that time was
1560×7944 with 60 cells. The
website comparison captured every visible diagram SVG on the branch homepage
at `http://127.0.0.1:9095/` and its deployed equivalent at
`https://agentic-mermaid.dev/` in the same Chromium build and viewport.

## Current-branch re-review

The current re-review covers the two geometry changes introduced after the
original production comparison. In all four style variants, State initial and
final transition shafts now end on the painted pseudostate rings (a 2px gap in
the previous shared-box approximation is now 0px), and the final arrow tip no
longer extends through the outer ring. XYChart now retains the
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
| State | State boxes and transitions inherit the same role face. Transition shafts now meet the painted rings instead of the larger layout boxes, and the arrow tip uses that exact contact coordinate rather than extending one marker unit through the final ring. |
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
panels. State shaft/arrow-tip contact and XY axis projection changed as described
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

## PR #401 marker review after prepared-text rebase

Compared the current production-generated sheet with immutable main
`53056ec569781d6f5153f90b5bd563aa70f8c5c7`. Both are 1560×9464.
Only Sequence, Class and Architecture change in each of the four treatments:

| Treatment | Sequence pixels | Class pixels | Architecture pixels |
|---|---:|---:|---:|
| Sentinel | 683 | 1111 | 159 |
| Warm editorial | 159 | 312 | 66 |
| Light technical | 319 | 552 | 90 |
| Dark operations | 409 | 719 | 114 |

Total: 4,693 changed pixels; the other 52 family-by-treatment cells are
pixel-identical to upstream's already reviewed artifact. Codex inspected all
twelve changed native-size before/after cells. Responses now point into the
receiving participant; Class triangles/diamonds align with vertical shafts;
Architecture tips touch the authored boundary. Prepared text, card geometry,
labels, colors, routing and all unaffected family output are preserved.
The approval names SHA-256
`b2e6c3a54c1e7c625fa5499752c56eeec371552882b34c19df9375e569f9f124`.
This is an agent review, not human approval or deployed-site parity. Native
terminal changes are reviewed separately in the immutable PR evidence bundle
and `terminal-native-route-regressions.test.ts`.


## PR #411 native C4 extension

The 2026-10-18 review adds C4 to the four existing treatments without changing
the 1560×9464 canvas. Compared with the committed artifact at
`4b6f965e37d40ccde4600d9cf504858759a843ac`, exactly 790,384 pixels change:
197,596 in each previously empty C4 cell. All 64 existing family-by-treatment
cells are pixel-identical; their earlier reviews remain applicable.

Codex inspected the four new native-size C4 cells and an unchanged dark Sankey
control. Customer and API text, person silhouettes, relationship label halos,
and type legends are legible within their allocations across the Sentinel,
warm editorial, light technical and dark operations treatments. This extends
the sheet to 68 cells. The reviewed PNG SHA-256 is
`39b6c470e29e40159fc9bddddb63f711f534d2022b9322f5913834be885972ac`.

This is agent review of the rendered artifact, not human approval or a claim
of published-package or deployed-site parity. Separate bounded probes cover
C4 nested boundaries, repeated/reversed/self relationships, shape overrides,
person padding, full label halos and owned terminal connectivity.
