# Vertical routing diagnostics: no production change retained

Starting and ending source: `4cddae30548df1adf0ea1908c88454fae3bcb36d`, including Main `a2e5ddc927e7432affbc293b7996a74b5fe59003`. This bounded 14 November run used the existing source probes, Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038` and actual SVG observers. Baseline complete products match the qualified Node 24.19.0 build. Candidate products are Bun source diagnostics, not built or shipped implementations. No benchmarks, broader qualification or source changes were warranted by these results.

## What was reproduced

These are delivered meaningful drawings with route-quality tradeoffs, not refusals or demonstrated missing relationships. Native is smaller and uses shorter wire here, while ELK has fewer crossings and bends.

| Existing permutation | Wire | Bends | Crossings | Actual SVG area |
| --- | ---: | ---: | ---: | ---: |
| TB Native | 5367.4625 | 44 | 29 | 261286.025 |
| TB ELK | 7503 | 28 | 23 | 1160773.2 |
| BT Native | 5013.175 | 40 | 23 | 260088.4 |
| BT ELK | 7679.75 | 34 | 7 | 1099183.05 |

The first responsible routing stage concatenates independent real-terminal attachments around a temporary group-level guide. For the first TB edge its guide retains an 8px vertical step above the actual protected title. That step adds two bends, but removing it can move a title-constrained approach into another edge's lane. The unchanged A4→B1 route is selected by the existing sparse fallback after primary, outer-channel and direct strategies decline.

## Three causal interventions and their disposition

| Diagnostic | Whole-drawing result | Disposition |
| --- | --- | --- |
| Decline only TB edge0 primary attachment; use existing full fallback | Wire5367.4625→5548.8875, bends44→46, crossings29→31; area unchanged | Rejected. Fewer bends on one edge worsened the complete drawing. |
| Join TB edge0 attachments at the existing source anchor | Same wire/area; bends44→42, crossings29→31 | Rejected. Two new proper crossings meet unchanged A4→B1 at (453,144.9) and (487,148.9). |
| Preserve the title-constrained side: TB end anchor / BT start anchor | TB bends44→42, BT40→38; wire, area and crossings unchanged | Parked as low value. Only edge0 changes in each drawing; nine peers remain exact. |

The third diagnostic has coherent structural eligibility: same-direction vertical, fully lifted unlabeled recursive leaf endpoints, a straight two-point quotient, actual protected north title and existing complete terminal-width facts. It retains the original visibility-grid domain, terminals, query order, fallback strategies and caps; only the free leg's query goal changes. Explicit before/after arrays prove the constrained TB suffix and BT prefix stay identical. This is stronger than inferring preservation from a shared goal.

Fresh existing Trident/Chrome observations pass authored meaning, declared paint and direction for both third-diagnostic outputs. Scoped proofs pass. The separate served marker/foreign-shaft scan finds zero hits and zero unresolved supports. Exact general node contacts and glyph collisions remain unavailable; scoped proofP does not imply universal collision freedom. See `REVIEW.json`, exact authored inputs/options in `CASE-INPUTS.json`, and the four retained actual SVGs.

## Why it was not implemented

The positive prototype removes two output vertices in one edge per diagram, but no traversal, grid, pass or representation disappears. It would add direction/title/quotient/terminal eligibility work to every primary attempt and touch four routing query sites. It does not reduce wire, area or crossings. No runtime, memory, payload or charge-ledger gain was measured; source instrumentation is not a paid production admission. Broader tests/builds/clocks would be premature for this value. Production remains unchanged and all diagnostic work is retained locally.

The larger shared full-response cost, Chain300 proof-capacity loss and failed payload budgets remain open. The audit did not find a supported small subtraction this cycle: final SVG digest reuse and marker-view reuse already exist, and original captured pixel reuse was previously verified. Repeating the stopped scalar/XML/rectangle/private-hook shortcuts or deleting real validation obligations is not a fix. The next performance intervention requires a concrete duplicated operation at its actual producer/consumer with preserved custody, rather than a lower accounting charge.

PR602 remains a draft. Exact-head CI `43553008254` failed quality/payload/editor/advisory gates; all three unit shards and browser/installed consumers passed. This evidence does not claim readiness, complete gap closure or continuous execution between scheduled runs. The hourly continuation remains enabled. This small selected checkpoint contains no previously blocked mapped profile, related audit report or historical archive.
