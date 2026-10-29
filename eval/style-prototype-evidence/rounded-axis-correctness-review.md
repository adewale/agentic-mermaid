# Rounded connector axis correctness review

The Cupertino documentation prototype remains 900×191. An actual SVG rendered from `513371a59c0a8dfce42d1fc893292d281433d60b` with the exact fixture, style and options rasterizes pixel-for-pixel to the prior reviewed PNG. The current `a27668a0` SVG preserves all 127 XML elements, 7 authored relationships, 6 nodes and visible text.

Removing intermediate precision 3 from the shared rounded projection preserves exact cardinal line/quadratic tangents and marker approaches. Reading the serialized SVG independently checks 45 nonzero line/quadratic tangent vectors and 14 finite outward node contacts. The old SVG contains small noncardinal legs from independently rounded vertices. The current SVG contains none.

Before/after images were inspected at native 900px width. Exactly 44 pixels change, bounded by (156, 98)–(772, 132), on the corrected connectors. Node layout, labels, group boundaries, marker identities and canvas size are retained. This is an intentional correctness change.

The other five existing cookbook entries were generated through the unchanged script and are byte-identical to their committed images. Only the Cupertino PNG and its recorded digest change. This records agent review, not human approval, exact font-outline certification or universal backend parity.

The full diagnostic sources/options, actual before/after SVGs and PNGs are retained by the PR correctness review. No product cap, route guard or semantic assertion was relaxed.


The later canonical routing review captured exactly one catalog SVG, final positioned graph and PNG at `8d7479e94ee8daf031bed1baa9d4b278745a4085`, including `shadow: true`. The reviewed PNG is now `0b8a5382ca5c4363514ed5ff8d92753484c91146ef7a8e2e26786fe1fda13ee2`; it remains 900×191. It replaces the earlier `25b7` image after a fresh review. The intermediate `888fa847` / `f019` image is not the approved replacement.

Against the prior reviewed image, exactly 1,000 pixels change in (145, 70)–(780, 139). The only non-scope XML changes are three relationship paths: Intake→Validate, Repair→Validate and Audit→Export. Nodes, group geometry, styles, all semantic attributes, the seven authored relationships, Core's four members and all nine prepared text elements are unchanged. Against the intermediate `888` image, 5,124 pixels change in (145, 70)–(881, 144); Export returns to its prior vertical position while retaining separated incoming markers.

Independent serialized-geometry readback checks 48 nonzero cardinal L/Q tangent vectors, 21 pairs of complete marker envelopes, foreign marker/shaft/card separations, both actual opaque label halos and the full Core header. The two Export marker anchors are 13.633333333px apart, leaving 5.008333333px between their complete unclipped stroke envelopes. The six node/decision labels, two edge captions and group header are readable in the actual raster; agent reviewers found no visual regression.

The endpoint statement is deliberately finite: 13 contacts have exact equality with a served shape face or vertex. Intake's horizontal endpoint is `146087499999/566499999997000000000`px outside the independently written diamond facet (about 2.58×10⁻¹⁰px). Its outward direction and actual clipped round-tip stroke/body contact are proved exactly; centerline equality is not asserted or accepted using a tolerance. This review does not claim exhaustive font-outline or shadow-filter certification.

The existing cookbook owner reproduced the approved Cupertino PNG bytes at both `4461bc8b7aca0e509240eeff05dba96ecc346f03` and `04c52334046b46bd57a9b74ad296270661a861f3`. The later target-only fallback applies to same-direction duplicate edges, which this seven-edge fixture does not contain. The separate transit-map screenshot mismatch remains unapproved and is outside this artifact review. The Vercel and Cloudflare artifact hashes are unchanged. The SVG/PNG/model and exact readback are retained with the PR evidence. This records agent review, not human approval or a new general paint theorem.

## Issue #566 terminal readability review, 28 October 2026

The Cupertino capture regenerated from the issue #566 working tree is `394143d21e27fe7aea850f0da2600bbdb68289a6d186a7650dd2a7140bf3bf6b` at 900×187, replacing `0b8a5382…` at 900×191. The SVG keeps all 127 XML elements, 6 nodes, 7 authored relationships, Core's members and every prepared text. All seven relationship paths change: Flowchart placement now spaces layers so a stroke-scaled marker sits on a straight shaft after the rounded corner, and the canvas is 4px shorter.

The agent inspected the before/after pair at native width and a 3× crop of the decision and Export regions. Repair→Validate and the no return now leave Repair on separate lanes instead of running beside each other into the decision's west vertex; both captions sit on their own routes; the two Export arrowheads keep a 5.008px complete stroke-envelope gap. Layout certification passes, no marker envelopes overlap and no route shares opposing ink. The single secondary `hitches` finding (Audit→Export deviates 6.8px) is unchanged from the prior capture.

The transit-route-map, mid-century-report and star-chart-atlas screenshots also change and were inspected the same way; they carry no approval record. The Vercel and Cloudflare captures are byte-identical. This records agent review, not human approval or a general paint theorem.
# PR #571 adversarial audit repair, 2026-10-29

Reviewed the regenerated Cupertino, transit and mid-century cookbook captures.
The terminal spacing includes marker stroke support, retaining complete labels,
cards, group membership and separate decision/Export entries. Cupertino changes
from 900x187 to 900x186, transit from 900x189 to 900x187, while mid-century stays
900x199. Vercel, Cloudflare and star-chart PNG bytes are unchanged. The approval
records the new Cupertino bytes. This finite agent review is not human approval
or a claim about arbitrary custom-style geometry.
