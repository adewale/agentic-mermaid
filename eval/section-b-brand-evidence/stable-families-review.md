# Stable-family visual review

Reviewed 2026-10-19 by the Codex agent, after production-code freeze.
This is agent review, not human approval or deployed-site parity.

The registry-driven sheet now contains 92 family-by-variant cells, up from 68,
at 1560 × 12504 pixels. The 24 additions show Packet, Kanban, Requirement,
Treemap, Ishikawa and Block in the distinctive sentinel and three held-out
editorial, technical and dark operations StyleSpec records.

Each new cell was inspected at its native 520 × 380 review size in four
1560 × 1140 lower-band crops. Bit intervals, column/card membership,
requirement compartments and marker direction, nested 60/40 areas, fishbone
causes and directed blocks remain recognizable. Labels and quantities remain
visible; typography, measured spacing and palette changes compose through the
existing public styling contract.

After aligning the changed variant-band positions, all 68 previous diagram-body
crops are pixel-identical. Six previous captions have small raster differences
inside their heading areas because the expanded sheet moves them to different
absolute positions. No existing diagram geometry or paint changes are approved
by this enrollment update.

The exact reviewed PNG bytes are bound by `visual-approval.json`. Reproduce the
sheet with `bun run gallery:section-b`; the owning test regenerates and compares
the committed reviewed golden. Separate identity, area, route, containment,
contrast and pinned semantic tests establish properties an image cannot prove.
The small review examples do not certify arbitrary density, fonts or displays.

## Performance and contract follow-up, 2026-10-20

The Codex agent inspected the same 24 new-family cells after the style-contract
fixes. Twenty-one cells changed; all 68 established-family cells and the three
Block holdout cells are pixel-identical to the preceding reviewed sheet. The
full sheet dimensions and cell positions are unchanged.

The sentinel now exposes independent Kanban column padding, Packet padding and
corners, Requirement node and relationship typography, Treemap section/header
paint and group spacing, and Ishikawa authored typography. The three holdouts
retain their distinct editorial, technical and dark operations treatments.
Requirement compartments and directed verification, Packet bit proportions,
Treemap 60/40 areas, Kanban membership and fishbone cause attachment remain
intact. Labels are complete, markers connect, and the basic Block example
retains its authored grid and direction. Separate dense Block parallel-edge and
arrow-polygon evidence covers routing that this small sheet does not exercise.

This refresh approves those visible new-family styling changes only. It does
not certify arbitrary density or contrast chosen explicitly by an author. The
updated approval record binds the exact reviewed PNG bytes.

## Radar legend refresh, 2026-10-21

The Codex agent reviewed PR #456's Radar legend change against the previously
approved sheet, SHA-256
`0995a0d590d401d4dfe06abb5daba9aaf68fa3726ab33c229c4401df32e90b47`.
A whole-image pixel comparison found exactly 1,328 changed pixels in four
Radar cells: sentinel 328, warm editorial 332, light technical 334, and dark
operations 334. All other 88 cells, headings, and background are pixel-identical.
The sheet remains 1560 × 12504, with unchanged cell positions.

All four before/after Radar pairs were inspected at their native 520 × 380
cell size. Legend swatches now use the opaque category colors. Axes, labels,
plot geometry, curve opacity, and positions are unchanged. The pixel changes
are confined to legend-swatch bands, matching the renderer's intentional
change from curve opacity to an opaque key.

The reviewed candidate SHA-256 is
`49fe0f51a79d80e9ca4f5ce34afe6df78209b0322999a7c9061ae59400c407c5`,
bound by the updated approval record. This incremental approval covers those
four legend cells only. It is agent review, not human approval, deployed-site
parity, or a general readability proof for arbitrary inputs, fonts, density,
or displays. No rendering logic or test assertion changed for this refresh.

### PR #456 category and authored-label follow-up

The incremental agent review inspected five native-size before/after pairs: the sentinel Pie role key and GitGraph in all four variants. Pie now binds its Pro key to the same role paint as the mark. GitGraph shows the authored merge label and opaque rails; its shorter canvas fits at a larger size. All other 87 cells are pixel-identical. The exact image digest and bounded approval are in `visual-approval.json`.
