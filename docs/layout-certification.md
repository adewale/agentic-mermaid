# Bounded layout certification

All 17 native families expose layout evidence through the existing SVG, PNG,
ASCII and layout receipt APIs. `verifyMermaid` includes graphical evidence;
debug layout includes `paintCertification`, which `measureQuality` and
`checkQuality` consume. Quality reports paint confidence under its own
`paintCertification` metric; it does not change the label-fit score. A certificate reports `passed`, `failed` or `unverified`,
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
dimensions and aspect ratio; its viewBox describes the expanded user-unit region. The receipt
binds the proof to the secured SVG digest also used for PNG rasterization.

Paint order determines occlusion. A later opaque rectangle that contains a
whole occupied text region proves that text is hidden. Conservative path
envelopes, rotated empty corners and partial intersections do not prove hidden
ink; an unresolved candidate remains unverified. Tree visits and primitive
comparisons share a 400,000-operation budget, in addition to the 100,000-pair
limit. Identical marker artwork
repainted by an owned carrier is evaluated at its final paint position.
Occlusion scans stop at their explicit comparison budget instead of returning
a successful result from an unfinished scan.

These are native geometry guarantees. They do not prove every antialiased
pixel for an arbitrary installed font, host stylesheet, custom backend or
interactive state. Crisp palettes and role styles use the same retained native
geometry; rough backends and shadow ink remain outside the proof. Declared translucency and intentional overlap between data
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
separately from cell-layout correctness. Unrelated edge shafts may share cells
as straight perpendicular crossings; declared bundles retain their intentional
joins. The checker uses each owner's painted direction, so a merged junction
cannot lend one route another route's stroke.

Explicitly connected routes prove a path through their final visible owned
stroke and marker cells. An internally allocated immutable path can witness
that proof, but every point is checked again after composition. Missing, stale
or ambiguous witnesses use the same bounded traversal and cumulative budget.
Other routes retain endpoint and marker checks without a complete path proof.
Full correspondence with authored source remains the family renderer's contract.

Class keeps a valid compact layout. If allocation fails or its actual contacts
are invalid, bounded recovery reserves separate routes, endpoint labels and
namespace crossings before painting. It keeps text upright in all four layout
directions and preserves authored identities, markers and note targets. Unboxed
interfaces keep their captions and publish the actual owned lollipop as their
physical surface. Hyperlink footer rows and their complete text extents are
reserved before recovery is painted; safe links stay inert and unsafe actions
remain source-only under the existing security policy. Both representations
still use the same final operation and output limits. An unfinished check cannot
become a passed certificate.

## Priority and pass budgets

Preserve authored identities, labels, endpoints, membership and chart values.
Then satisfy hard geometry and content visibility. Route clarity, crossings,
bends, preferred ports, symmetry and compactness can improve within those
constraints; a lower-priority preference cannot silently break a higher one.

Production passes enforce their declared order, geometry freeze, metric
allowances and renewed route certificates. Measurements come from actual
before/after geometry. Metric requests are selective; enabling a budget does
not request every rubric metric for every pass. Bounded final graph candidates
cannot hide a pass-contract error behind another successful layout.

Some priorities require explicit local tradeoffs. Separating ambiguous shared
duplicate routes can justify a bounded crossing cost for that same proposal.
Fewer bends alone cannot buy a new crossing. An actual repair of a route through
a node, a diagonal or an invalid endpoint approach can justify a bounded bend
cost or losing a preferred port. An endpoint approach is checked against the
actual shape boundary, separately from its preferred attachment ports.
Opposite-direction shafts sharing positive-length collinear ink are measured
separately from ordinary crossings and deliberate same-direction fan trunks.
A merely symmetric reciprocal lane must keep an already valid canonical
contact. The owning regressions record these cases alongside the existing final
hard checks.

Final graph candidates first pass authored correspondence and hard geometry.
The bounded preference comparison follows the
[graph priority order](quality.md#layout-priorities-and-their-limits): readable
group titles, crossings, padded label conflicts, avoidable bends, preferred
endpoint contacts, peer alignment and canvas area. A candidate with a better
lower-priority score cannot displace one with a better earlier score. This final
comparison does not excuse a production pass-contract error.

A repaired viewport with non-scaling strokes is unverified: keeping the display
size changes the stroke extent in user units. Endpoint checks allow an arrow’s
stroke to meet its declared endpoint’s owned outline; the marker body must stay
outside the filled interior. Repaint equality includes resource geometry,
orientation, stroke units and the composed transform.
