# Bounded layout certification

All 17 native families expose layout evidence through the existing SVG, PNG,
ASCII and layout receipt APIs. `verifyMermaid` includes graphical evidence;
debug layout includes `paintCertification`, which `measureQuality` and
`checkQuality` consume. A certificate reports `passed`, `failed` or `unverified`,
its native coordinate unit, coverage, bounded work and limitations.

```ts
const result = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })
console.log(result.receipt.layoutCertification)
```

The default `report` policy preserves explicit limitations. It still rejects
proven native text/marker occlusion and enforces production layout-pass
contracts. `strict` requires a passed final certificate, including for plain
string renders; missing evidence, exhausted checks, custom graphical backends,
and unverified interactive states cannot become successful strict renders.
Output security remains a separate policy.

## Pixel geometry

The graphical checker consumes the admitted Scene from the exact positioned
artifact and the retained family projection. It does not reparse source or run
layout again. Text uses the original prepared runs and occupied bands. Typed
paths, strokes, joins, caps, markers and composed transforms contribute paint
envelopes. Unknown artwork and lowering-time text fallback are explicit.

One outward viewport expansion can contain these envelopes without moving
nodes, changing data values, rerouting relationships or changing membership.
The final viewport is checked again. The SVG keeps its requested display
dimensions; its viewBox describes the expanded user-unit region. The receipt
binds the proof to the secured SVG digest also used for PNG rasterization.

Paint order determines occlusion. A later opaque rectangle that contains a
whole occupied text region proves that text is hidden. Conservative path
envelopes, rotated empty corners and partial intersections do not prove hidden
ink; an unresolved candidate remains unverified. Identical marker artwork
repainted by an owned carrier is evaluated at its final paint position.
Occlusion scans stop at their explicit comparison budget instead of returning
a successful result from an unfinished scan.

These are native geometry guarantees. They do not prove every antialiased
pixel for an arbitrary installed font, host stylesheet, custom backend or
interactive state. Declared translucency and intentional overlap between data
marks retain their meaning. Text/source correspondence and quantitative chart
placement remain separate from aesthetic preferences.

## Terminal cells

Terminal proof consumes the final native cell document and exact encoded
output, independently of pixel geometry. It checks retained measured text,
wide-grapheme continuations, typed stroke/marker glyphs, ownership,
memberships, endpoint references and allocated containment frames. Encoded
ANSI/HTML output is compared with the same retained cells. A renderer returning
text without a native document is unverified.

Receipt evaluation remains lazy under `report`: text-only callers do not pay
for a certificate. Strict callers require it before receiving output. The scan
has explicit operation, output-size and issue limits. Native representation
choices, such as replacing a continuous curve with cells, are reported
separately from cell-layout correctness. Full authored semantic parity and
complete route-connectivity proof are outside this cell certificate.

## Priority and pass budgets

Preserve authored identities, labels, endpoints, membership and chart values.
Then satisfy hard geometry and content visibility. Route clarity, crossings,
preferred ports, bends, symmetry and compactness can improve within those
constraints; a lower-priority preference cannot silently break a higher one.

Production passes enforce their declared order, geometry freeze, metric
allowances and renewed route certificates. Measurements come from actual
before/after geometry. Metric requests are selective; enabling a budget does
not request every rubric metric for every pass. Bounded final graph candidates
cannot hide a pass-contract error behind another successful layout.

Some priorities require explicit local tradeoffs. Separating ambiguous shared
duplicate routes can justify a bounded crossing cost for that same proposal.
Fewer bends alone cannot buy a new crossing. Proven hard feasibility can
justify losing a preferred port. A merely symmetric reciprocal lane must keep
an already valid canonical contact. The owning regressions record these cases
alongside the existing final hard checks.
