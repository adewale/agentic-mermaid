# Class cardinality and Requirement shaft review

The final sheet was generated from `6a665b29` through the unchanged generator: 92 public SVG calls and 92 public native PNG calls. Its dimensions remain 1560×12504. The final Class/ER default-style fixes do not add source defaults to these examples; all 92 SVGs and per-cell PNGs match the earlier independently diagnosed `a27668a0` capture byte-for-byte.

Exactly 587 pixels change against the previous approved sheet. The changes are limited to Class and Requirement in each of the four variants:

| Variant | Class | Requirement |
| --- | ---: | ---: |
| Sentinel | 57 | 147 |
| Editorial | 29 | 111 |
| Technical | 40 | 53 |
| Operations | 40 | 110 |

All eight before/after pairs were inspected at native 520×380 cell size. Class source cardinality `1` moves away from the aggregation marker and its page-colored text halo. The aggregation diamond remains complete and the cardinality remains readable; `logs`, the target cardinality, nodes, members, marker identities and path topology are retained. The source seat moves 24px in Sentinel and 12px in the other variants before sheet fitting.

Requirement's authored `verifies` relation now has an actual `6 4` shaft dash, matching the family contract. The endpoint arrow, normal legs, labels and card content are retained. This fixes the previous solid paint without changing the example's geometry.

The other 84 cells, all section headings, the background and unused cells are pixel-identical. No ER cell changes. The full before/after SVGs, PNGs, literal sources/options, pixel census and crops are retained by the PR correctness review. The updated artifact SHA-256 is `540df3a8b83cca9e73ce34ab56afeb83d00e2852b88a0b53b60fb7b3ea476350`.

This is an agent review of these finite artifacts, not human approval, universal backend parity or a font-independent exact glyph-ink proof. No renderer limits, semantic checks or certification statuses were relaxed.

## Main #545 integration review, 27 October 2026

The canonical sheet generated from the merge of PR parent `0129a21d3a7a0a3bcbde72032dad6cc806a929ed` and Main parent `8a4a7e2c110349a6a6dda1bc4ff6f71ee8006b69` contains 100 family-by-variant cells at 1560×14024. Its SHA-256 is `5981b0cbd8f93ef27e21f3aea781e47af8783af68f39891d8776698610ac4d90`. The generator completed once under the existing 117-second work, 3-second cleanup and 16 MiB artifact limits; runtime source and selected rendering dependencies were unchanged during capture.

Aligned by family and variant, all 92 existing diagram-body crops are pixel-identical to the PR's approved sheet. Five heading cells each differ by one antialiasing pixel because the expanded variant bands move their absolute positions. All eight added Event Modeling and ZenUML cells are pixel-identical to Main's approved sheet. Compared with Main's complete sheet, only the eight Class and Requirement cells change, by the same 587 pixels itemized above; every other cell, heading and background pixel is identical.

The Codex agents inspected all eight Class/Requirement before/after triptychs and all eight added family cells at native 520×380. Class cardinalities remain separated from their aggregation markers; Requirement retains the authored dashed verifies shaft. Event Modeling retains the three ordered steps, lane ownership and directed relations. ZenUML retains both participants and reciprocal Hello/Reply arrows. The four variants retain their distinct typography, spacing, corners, strokes and palettes. Main's separate enrollment review remains in [stable-families-review.md](stable-families-review.md); the prior PR audit above is preserved.

This approves the composed finite rendering sheet only. It is agent review, not human approval, deployed-site parity, general backend parity or an exhaustive density, readability or font-outline proof. No limits, source semantics or certification checks were relaxed.

## Main #545 native checkout scope integration, 28 October 2026

The three `zenuml-native-checkout` SVG goldens for patent-drawing/github-light, hand-drawn/dracula and watercolor/solarized-light were captured through the unchanged public renderer with the owning test's exact style stacks, omitted seed (backend default 0) and canonical Scene-assertion preload. The source was `bb0bfef1a9b7987e33de2e7ce5a67ffd342a22ba`; the three-call capture completed under the existing 117-second work, 3-second cleanup and 16 MiB artifact limits with unchanged source/dependency guards.

PR commit `4371bf456d50431cc5b6a4e45c1e85bc1a046e7c` moved numeric canonicalization before CSS scope hashing. Passive unchanged-result observations and an independent hash calculation confirm that each old golden's scope hashes the raw preformatted SVG, while its replacement hashes the canonical written SVG. Examples include raw dash offsets `6.2000000000000455` and `5.149999999999977`, already written as `6.2` and `5.15` in both old and new emitted artifacts.

For each complete SVG, one consistent old-to-new namespace substitution makes the full literal strings identical: exactly three occurrences, covering the root class and its selectors. Every other byte of geometry, paint, text, element order, resource identity and reference is unchanged. Only these three reviewed goldens were refreshed; `normalizeSvg` remains whitespace-only by default and scope masking remains diagnostic only. This is an agent review of exact namespace equivalence, not a new physical, raster or universal rendering qualification.

## Issue #566 terminal readability review, 28 October 2026

The canonical sheet regenerated from the issue #566 working tree contains 100 family-by-variant cells at 1560×14024. Its SHA-256 is `527f9d58bca6aac83fa9e998b469691f6114fb4884cfcd489542af036d6ef209`. A per-pixel comparison with the previously approved sheet (`5981b0cbd8f93ef27e21f3aea781e47af8783af68f39891d8776698610ac4d90`) finds exactly one changed cell: Architecture under the sentinel variant (22,855 pixels). Every other cell, every heading and the background are pixel-identical.

Architecture placement uses the shared Flowchart ELK conversion. Its edge/node spacing now equals the terminal hook that seats a stroke-scaled marker after a rounded corner (here 3px strokes and a 14px radius), so the placed diagram is slightly wider and is scaled to fit the cell. The agent inspected the before/after cell at native 520×380: the API->Database arrowhead now sits on a straight shaft instead of overhanging its rounded corner; API->Cache keeps its reads label and its entry; the Backend group, icons and palette are unchanged. Default-style Architecture geometry is byte-identical (the layout-equivalence corpus shows no Architecture change).

This approves the composed finite rendering sheet only. It is agent review, not human approval, deployed-site parity, general backend parity or an exhaustive density, readability or font-outline proof. No limits, source semantics or certification checks were relaxed.
# PR #571 adversarial audit repair, 2026-10-29

The styled terminal hook now includes the arrow resource's round stroke support,
and ELK reserves the actual visible edges' marker demands. Regenerated the sheet
and compared every pixel with the previous PR capture: changes are confined to
the Architecture sentinel cell. Inspected its complete before/after crops at
native size: API, Database, Cache, the Backend frame, reads caption and both
directed links remain legible; spacing changes slightly. The other 99 cells are
byte-identical at the pixel level. The approval records the exact new PNG bytes.
This is agent review, not human approval or exhaustive rendering certification.
