# Adversarial review of PR #465

Reviewed candidate: `646100e475dd1f85b3e8b4513f8545ebb4dd7e37`.

Three independent agents reviewed production geometry, proof soundness, and evidence/benchmark provenance. They reviewed the original `bc7ee3a` diff and checked the relevant follow-up changes. The proof changes were independently rechecked at `082156c`; the final `646100e` commit updates only two reviewed terminal goldens. The parent verified unchanged production source, ran the focused checks, and reviewed the combined diff. No remaining blocker was found in these scopes. CI and final benchmarks are recorded separately.

## Geometry review

- 192 base/head layouts: 16 authored side pairs × three radii × flat/nested/row/column arrangements, with titles and a second cross-group edge. No added overlaps, clipped nodes, blocked routes or failures.
- 64 ASCII/Unicode comparisons: no added terminal diagnostics. Architecture terminal text changes because tighter bounds affect pixel-to-cell projection; it is not byte-preserved.
- 12 additional public SVG/layout cases: frontmatter-derived radius, fractional/small radius, nesting, alignment, title and rounded routes. All pass. Public projection retains its existing 0.5px rounding allowance.
- 122 focused ownership/contact/geometry/terminal tests pass.

## Proof review and resolved findings

1. **P2 — clipped tip falsely verified.** Reducing only the end marker viewport width from 8 to 7 produced a native 3px arrowhead gap, even though the shaft reached the card. The audit measured the unclipped tip. Both independent contact checks now require the tip to survive viewport clipping. A native marker-only red-ink regression exposes the gap; a separate audit regression rejects it.
2. **P2 — direction reversal missed by meaning comparison.** Moving a one-ended arrow from end to start retained total marker count and the old meaning record. The audit now compares each edge's start/end/mid marker signature. The reproduced reversal changes that signature.
3. **P3 — malformed numeric lists silently shortened.** Numeric extraction discarded NaN or incomplete coordinate pairs. The audit now rejects malformed lists and incomplete pairs. These are measurement gaps, not newly discovered production rendering defects.

The proof reviewer independently reran the clipping, endpoint-reversal, NaN and incomplete-pair probes after the fixes. All were rejected or distinguished as intended. The parent ran 42 public-contact/audit tests, including marker-only native raster checks, with 440 assertions.

## Evidence review

Hosted image bytes, native widths, sources/configuration and immutable revisions match the local generated evidence. All 11 control PNG and SVG pairs are byte-identical. Historical timing and geometry counts match raw reports; the measured 11% corpus timing increase remains disclosed alongside the noisy identical-build control. A workflow receipt now records both revisions, package SHA256s and measured entry hashes for the final comparison. The reviewer checked the receipt against the actual baseline directory and verified candidate tarball paths.

These are bounded checks of enrolled sources and interactions. They do not prove universal geometry correctness or exact performance equality. Sixteen unchanged conservative native paint warnings remain explicitly recorded; the independent clipped-viewport/tangent checks cover the attached marker bodies in those fixtures.

## Final terminal-golden follow-up

CI exposed two stale `architecture_group_boundary_edge` goldens. Independent review confirmed the legitimate one-column frame/junction projection shift; authored relationships, ports, labels and group membership remain intact. The two ASCII/Architecture test files pass all 174 tests. Raw results are in `audit-geometry/golden-results.json`. An unchanged crossing-marker cell belongs to the bus arrow in both revisions, so this fixture does not establish complete per-edge ink ownership. That limitation was not introduced or worsened by the fix.

## Final validation

All 19 PR check runs passed at `646100e`. The final benchmark run passed all 17 gates across 566 enrolled inputs, including all three junction workloads. Both engines use Node 24.22.1. The final browser scorecard also completed. See `benchmark/comparison.md`, `benchmark/report.json` and `benchmark/build-provenance.json`; raw samples are in the linked Actions artifact. Every local evidence PNG/SVG matches the CI-generated copy byte-for-byte. The final candidate package SHA256 matches the preceding proof-audit candidate, confirming that the terminal-golden commit changes no packaged bytes.
