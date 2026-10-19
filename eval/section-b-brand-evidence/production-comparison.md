# Visual review and production comparison

## Typed SVG writer refresh — 2026-10-19

The regenerated reviewed PNG is **1560×9464**, with SHA-256
`1c911e827bb74398ea18fc9f448a0a12230a86900aafec30af3f27f8a5574c27`. A per-cell pixel comparison against the previously approved artifact
found changes in **five of 68 cells**; the other 63 cells and every heading are
pixel-identical. A Claude Code agent inspected each changed cell at native
520×380 beside its predecessor. This is **agent review, not human approval**,
and no deployed website was rechecked.

| Changed cells | Observations |
|---|---|
| Sankey (all four treatments) | At most 2/255 per channel: link stroke opacity is written unrounded. Not visible. |
| Pie (Sentinel) | The highlighted Pro slice's emphasis border is 5px, the width its typed paint already certified (bound `selected` slot width 4, plus 1). A stylesheet rule computed from the base slice width used to override it to 4px. Wedge geometry, fills, labels and legend are unchanged. |

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

## PR #411 C4 presentation follow-up

On 18 October 2026, the follow-up review compares the same four treatments
against `6724062c5da0e13401ab63744b3e7c11efc2684f`. Exactly 29,346 pixels
change, confined to C4: 10,808 Sentinel, 7,288 warm editorial, 5,927 light
technical and 5,323 dark operations. All 64 other family/treatment cells remain
pixel-identical. The canvas remains 1560×9464.

Codex inspected all four C4 cells at native size. Automatic legend marks now
distinguish Person from System, shared label typography is prepared before
measurement/emission, and the card/relationship/legend text stays readable in
the existing palette treatments. The reviewed artifact SHA-256 is
`95768feda747cc4f5e0c4e2d42041ad01442fcf923f0593d27705bf596203f3b`.
This is agent review, not human approval. It does not establish arbitrary dense
layout quality; those limitations are explicitly verified on separate inputs.

## PR #420 C4 relationship clearance

The 18 October 2026 independent audit compares the same 68 cells against
`a3b06894a21396aed5c822c195e87f1082a4da84`. Exactly 132,756 pixels change,
confined to C4: 35,487 Sentinel, 32,357 warm editorial, 33,272 light technical
and 31,640 dark operations. The 1560×9464 canvas, all headings and the 64 other
family/treatment cells remain pixel-identical.

The auditor inspected all four C4 before/after pairs at native 520×380. The
Uses/HTTPS label is centered in a measured shaft gap with full background
clearance; the target arrowhead, Customer/Person and API/System text,
description and legend remain complete in each palette treatment. The wider
layout uses the same public PNG scale-to-cell presentation. The reviewed PNG
SHA-256 is `68a5b52113cc918048c3016ea0a5b6203f51eee169b689f99dd44d2159484c9d`.

This is agent review, not human approval or arbitrary input/font coverage.
The five official C4 inputs and independent owned-ink checks cover the broader
visibility repair separately; this four-style witness establishes only its
rendered presentation on the existing sheet.

## PR #420 integration with #421 outline contrast

The independent review after merging main
`ba37758062ed8daf805a2be6a472a49ef0c2222b` preserves both changes. Against that
main, exactly 132,756 pixels change in the same four C4 cells: 35,487 Sentinel,
32,357 Editorial, 33,272 Technical and 31,640 Operations. All 64 other cells
and every heading remain pixel-identical. Against the earlier #420 sheet,
exactly 10,071 pixels change in the three upstream Timeline holdout cells:
2,665 Editorial, 3,585 Technical and 3,821 Operations.

The auditor inspected native 520×380 comparisons of all C4 and Timeline
treatments. C4 keeps the centered Uses/HTTPS halo in a clear shaft gap, complete
arrowheads, person/card text, API description and legend. Timeline changes
paint without changing dates, event text or geometry. The reviewed 1560×9464
PNG SHA-256 is
`3aee18640b52271ee8a0f0f15a817f8abe3c4ad32c7692185ba45cb9624354c1`.
This is agent review, not human approval or arbitrary palette/font coverage.

## Final paint certification refresh — 2026-10-18

The production candidate at
`366eae2a5e75703a05a83c0d91d40b7e34ffb915` regenerates the existing
1560×9464, 68-cell sheet. Compared with the previously approved PNG
`3aee18640b52271ee8a0f0f15a817f8abe3c4ad32c7692185ba45cb9624354c1`,
exactly 76,480 pixels change in eight cells:

| Family | Treatment | Changed pixels |
|---|---|---:|
| Journey | Sentinel | 18,730 |
| Journey | Light technical | 10,253 |
| Journey | Dark operations | 12,234 |
| XY chart | Sentinel | 8,382 |
| XY chart | Warm editorial | 6,752 |
| XY chart | Light technical | 6,535 |
| XY chart | Dark operations | 7,125 |
| Flowchart | Dark operations | 6,469 |

The other 60 cells and every heading remain pixel-identical. The independent
Codex AI auditor inspected all eight changed before/after pairs at native
520×380 and confirmed that the final regenerated crops match those reviewed
bytes. Journey's fitted viewport retains the task and actor labels, score
positions and complete rail arrow. XY retains its Revenue title, USD axis,
0–100 ticks, Q1–Q3 categories and authored relative bar heights after viewport
fitting. Flowchart's NO label moves into the decision-side corridor while YES,
both destination labels, connecting routes and arrowheads remain complete.
These counts describe final artifact differences rather than attributing every
pixel to one repair.

The reviewed PNG SHA-256 is
`147a364dca5e02da89bd6b01c438c2ed3d21949f1051bd0a45d95e299a195cbb`.
This is independent AI agent review, not human approval or deployed-site
parity. The sheet does not establish arbitrary input, font or dense-layout
coverage. Separate owned-geometry regressions exercise initially occluded
endpoint markers, including a single feedback label that previously bypassed
repair; the sheet is not presented as a reproduction of that defect.
