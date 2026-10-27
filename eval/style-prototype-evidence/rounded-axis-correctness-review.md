# Rounded connector axis correctness review

The Cupertino documentation prototype remains 900×191. An actual SVG rendered from `513371a59c0a8dfce42d1fc893292d281433d60b` with the exact fixture, style and options rasterizes pixel-for-pixel to the prior reviewed PNG. The current `a27668a0` SVG preserves all 127 XML elements, 7 authored relationships, 6 nodes and visible text.

Removing intermediate precision 3 from the shared rounded projection preserves exact cardinal line/quadratic tangents and marker approaches. Reading the serialized SVG independently checks 45 nonzero line/quadratic tangent vectors and 14 finite outward node contacts. The old SVG contains small noncardinal legs from independently rounded vertices. The current SVG contains none.

Before/after images were inspected at native 900px width. Exactly 44 pixels change, bounded by (156, 98)–(772, 132), on the corrected connectors. Node layout, labels, group boundaries, marker identities and canvas size are retained. This is an intentional correctness change.

The other five existing cookbook entries were generated through the unchanged script and are byte-identical to their committed images. Only the Cupertino PNG and its recorded digest change. This records agent review, not human approval, exact font-outline certification or universal backend parity.

The full diagnostic sources/options, actual before/after SVGs and PNGs are retained by the PR correctness review. No product cap, route guard or semantic assertion was relaxed.
