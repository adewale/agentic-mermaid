# Independent adverse SVG review — marker capacity trial

Reviewed baseline `6edd3fd3bb70bfa4232d61aba6cd0822b5adc82d` against trial
`4db9d6db226c5957c1b003b5ad58b56af4b55480` using the saved CI SVGs and metrics.
No new rendering, screenshots, source changes, network access or test runs were
used. This document records geometry calculations, not raster visibility or
reading assessments.

Inputs:

- Baseline: `../contact-origin-3234/generated-layouts-6edd.zip`.
- Trial: `generated-layouts-4db9.zip`.
- Full comparison: `CI-COMPARISON.json` (1,748 matched records; 303 Native SVG
  changes, all 874 ELK SVGs exact, 58 proof upgrades, five downgrades and no
  delivery transitions). Proof upgrades are not automatically visible gains.

The five downgraded records all report `POTENTIAL_OCCLUSION`, not exhausted proof
work. Four have definite new vector-paint contact; one has clear actual geometry
for its named pair despite conservative envelope overlap. These distinctions
must remain separate from their common unverified proof status.

## Geometric assumptions checked against the written SVG

The selected shafts are solid orthogonal polylines with stroke width 1. The
selected cards use opaque fills and stroke width 0.75. Their polygon elements
have no `stroke-linejoin` override, and the saved CSS supplies none: ordinary SVG
miter joins apply. The selected diamonds have 90-degree tips, so the outer axial
miter extension is `0.375 * sqrt(2) = 0.53033008589`, below the default miter limit.

The selected arrow resource is unchanged: polygon `0 0, 8 2.5, 0 5`, marker size
8 by 5, reference `(8,2.5)`, auto orientation, opaque fill and round 0.75 stroke.
Shaft width 1 leaves marker scale unchanged. The demonstrated arrow-fill
intersection lies inside both marker viewports and therefore does not depend on
whether outer marker strokes are clipped.

## Five named outcomes

### Generated cyclic229 — actual shaft/card contact

Snapshot: `agentic.json`. Relation `edge:n7->n14#0`; foreign diamond
`node-shape:n12`.

The trial horizontal run extends from `(1445.067,484.654)` to
`(1665.84364607,484.654)`. The diamond's bottom vertex is exactly
`(1532.244,484.654)`. Its other vertices are `(1532.244,349.05)`,
`(1600.046,416.852)` and `(1464.442,416.852)`.

The 1px shaft crosses the filled diamond tip, even before counting card stroke.
For example `(1532.244,484.404)` lies strictly inside both the shaft strip and
the diamond fill. The fill/shaft intersection near the tip has area 0.25 square
user units; the card stroke adds paint contact. This is not just an overlapping
bounding box. Baseline's corresponding route is well above that card.

### Generated cyclic319 — actual shaft/card-stroke contact

Snapshot: `development-256-319/agentic.json`. Relation `edge:n13->n11#0`;
foreign diamond `node-shape:n0`.

The trial horizontal shaft is at y124. The diamond top is
`(2235.697,124.581)`, with side vertices `(2299.794,188.678)` and
`(2171.6,188.678)`. The centerline-to-fill gap is 0.581px: enough to avoid
the fill with a half-width 0.5 shaft, but insufficient for its mitered border.

Combined axial reach is `0.5 + 0.53033008589 = 1.03033008589`, producing
0.44933008589px axial overlap. `(2235.697,124.4)` is an explicit point in both
the shaft strip and the diamond's miter stroke. Baseline's analogous shaft
y125.2 is 5.806px above the old diamond top y131.006 and is clear.

### Generated cyclic381 — actual arrow-fill contact

Snapshot: `development-320-383/agentic.json`. Relations `edge:n11->n5#0` and
`edge:n7->n5#0`; target is rounded card n5.

Both trial heads point west, with tips at `(144.194,348.444)` and
`(144.194,344.344)`. Their pitch is 4.1px, less than the 5px fill width. For
two identical 8-by-5 triangular fills at this pitch, their fill intersection is

`0.8 * (5 - 4.1)^2 = 0.648px²`.

Intersection occupies the last 1.44px toward their bases. For example
`(151.794,346.394)` is strictly inside both fills and both marker viewports.
Stroke is unnecessary to establish contact. Tips remain distinct. Baseline
tips are at y266.518428571 and y277.061285714, more than 10.54px apart.
No raster or reading loss is inferred from the new fill intersection alone.

### Generated SHA37 — actual extended shaft/card contact

Snapshot: `independent-sha256-counter-v1-0-63/agentic.json`. Relation
`edge:n9->n17#0`; foreign rectangle `node-shape:n11`.

The trial card is `(1202.983,342.4)`, size `99.748 by 49.75`, so its bottom is
y392.15. The selected horizontal shaft is at y392.4 and spans the entire card
width. Combined half-strokes are 0.875px, but the centerline-to-body gap is
only 0.25px: 0.625px of combined stroke overlap. The shaft also enters the
opaque card fill by 0.25px along approximately 99.748px of its bottom edge.
For example `(1252.857,392.025)` lies in both shaft and fill.

Baseline card height is 36.9 (bottom y379.3), and its corresponding shaft is at
y385.3, leaving 6px centerline clearance. This is the strongest extended
physical counterexample: it accompanies slightly more wire and area without
a bend or crossing reduction.

### Generated SHA191 — conservative envelope warning, actual named pair clear

Snapshot: `independent-sha256-counter-v1-128-191/agentic.json`. Relation
`edge:n11->n1#0`; foreign diamond `node-shape:n14`.

The trial horizontal shaft is at y244.15, above diamond top
`(1066.198,245.694)`. The 1.544px centerline-to-tip gap exceeds the actual
combined axial reach 1.03033008589, leaving approximately 0.51366991411px of
paint separation. Its vertical and final horizontal runs are over 13px left
of the diamond, and the endpoint marker is farther left still. No actual
contact between this named pair is demonstrated. The broader sufficient
supports can overlap without their actual paint doing so.

## Actual quality tradeoffs

| Case | Wire change | Area change | Bends | Crossings |
| --- | ---: | ---: | ---: | ---: |
| Cyclic229 | +762.582px (+3.130%) | −0.164% | 94→110 | 28→28 |
| Cyclic319 | +76.200px (+0.383%) | +3.299% | 69→63 | 4→4 |
| Cyclic381 | +375.762px (+3.758%) | −2.541% | 56→69 | 6→5 |
| SHA37 | +28.024px (+0.155%) | +0.272% | 83→83 | 17→17 |
| SHA191 | −27.799px (−0.153%) | +1.836% | 82→74 | 8→8 |

The trial also has demonstrated positive Native201/241 marker repairs. The
acyclic control grows its hub body 36.9→49.75 (+34.8%), while its complete canvas
is unchanged and wire falls 482.2→463.9; body growth alone is not a canvas-area
claim. None of these metrics supplies an automatic acceptance threshold.

## Stop and next causal observation

Withdrawing the trial is justified as a bounded engineering decision: it fixes
selected marker contacts but also introduces actual unrelated contacts, including
the extended SHA37 card-border contact, whose responsible stage has not yet been
located. It is not justified by counting proof downgrades, requiring every metric
to improve, or treating the 58 proof upgrades as 58 visible repairs.

The strongest next probe is SHA37 only. Retain the measured body-capacity change
as the diagnostic control, and observe the same n11 card and n9→n17 route at the
native raw-layout, marker-finalization, measured-shortening and shared-cleanup
boundaries. Locate the first stage that reduces the actual border/shaft gap from
clear to 0.25px centerline separation. Do not assume the shortener is responsible
merely because it caused the earlier case152 defect.

Once that stage is identified, its existing lane constructor—not a blanket
post-layout rejection, new capacity gate or cache—would be the owning place to
investigate preserving clearance beside the enlarged card. For the saved final
SHA37 card, a horizontal centerline needs to be beyond y393.025 plus serialization
separation to clear its bottom stroke; that is a geometric diagnostic, not a
proposal to move it without checking the other live ink. No implementation is
recommended before the stage trace establishes causation.
