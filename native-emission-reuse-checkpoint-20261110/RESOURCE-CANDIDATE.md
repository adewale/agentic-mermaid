# Native resource equality producer trial

This is an uncommitted trial, not a completed performance result. The requested fully consumed 100-node warm product under 100ms remains unmet. Fixed work limits and final XML/resource validation remain unchanged.

## Rejected rosters

The first implementation retained private field rosters while Native copied resources. In the chain100 diagnostic, capture work rose from 271590 to 313706 (+42116) while the repeated resource comparison stage fell from 41877 to 11484 (−30393), a net **+11723 operations/render** before unchanged context/XML stages. There were 198 shortcut hits across two renders. This falsified the intended work subtraction.

The second version used actual frozen point construction operands and omitted unused outer marker-container facts, but charged raw string-key comparisons. Capture rose to 318427 (+46837) with resource work still 11484, a net **+16444 operations/render**. It was also rejected. Its complete three-file sources and patch are retained as `rejected-resource-roster2-*` and `rejected-resource-roster2.patch`. No speedup is claimed for either version.

## Final bounded candidate, full-product trial pending

The only private receipt is `{snapshot, count, token, point}`. During each required Native copy, actual native data-property writes compare the actual current primitive or child correspondence with one captured own descriptor on the prior closed copied node. The completed fresh node supplies its actual own-key count; readonly array length is compared explicitly. A native frozen point supplies its actual numeric construction operands. No source object identity alone grants equality, no copied product receivers are shared, and no separate operand roster is allocated.

Equality correspondence is not XML, CSS, marker-byte, occupied-position, or paint authority. Existing unique resource serialization, actual definitions-byte binding, document/context/resource validation, and final actual output validation remain required. Late public reflection or Number hooks retain the original recursive comparison path. Interposed write/close or retained-text transfer calls decline correspondence. This private-fact domain assumes standard Object/WeakMap/WeakSet intrinsics at module load, matching the existing private serialization-receipt domain; arbitrary preimport intrinsic substitution cannot be authenticated locally.

Focused Native and prepared-text owners: 174 pass, 0 fail, 1076 expectations (2.38s), `resource-owners-clone.log`. Three-file Biome lint passes. Core types passed for the earlier roster implementation; the final clone implementation is not yet type-qualified. New controls cover an actual define wrapper changing a copied value and restoring itself, a transfer hook adding a field then restoring itself, late reflection preserving original receiver observations, and an added source field never exposing a private roster through inherited array access.

The frozen clone diagnostic reports capture303304 (+31714 versus271590) and finish-resource11484 (−30393 versus41877), net **+1321 operations/render** before unchanged downstream stages, with198 shortcuts across two renders. This is not a net ledger reduction. Parent approved a bounded fully consumed product trial because it removes mirror rosters and one prior descriptor/key-array traversal, whose allocation cost is not represented by ledger total alone. No timing claim is made before that trial; cold/warm/edit must be reported separately and adverse outcomes retained.

## Full-product disposition: rejected and reverted

The final clone candidate is rejected: both target 100-node warm cohorts regressed. All three candidate runtime/test files were restored exactly to HEAD after preserving source, patch, focused owner logs, jobs, raw full products, and adverse results. No resource correspondence optimization ships.

| Fixture | Arm | Cold median ms (2) | Warm median ms (8) | Edit median ms (8) |
|---|---|---:|---:|---:|
| chain100 | baseline | 360.37 | 174.11 | 172.52 |
| chain100 | clone | 386.61 | 182.68 | 177.12 |
| fanin100 | baseline | 512.62 | 228.52 | 221.75 |
| fanin100 | clone | 484.73 | 252.86 | 227.41 |
| chain300 | baseline | 636.56 | 420.59 | 347.09 |
| chain300 | clone | 643.06 | 399.22 | 335.38 |

These are fresh-process ABBA results from existing worker artifacts, full SVG plus entire serialized receipt, sampling/timed observers disabled, cache0. Import is separate. All54 candidate stored SVG products match baseline bytes for their phase. Every fixture/arm remains unverified at the unchanged capture-work cap; no correctness-proof completion or under100ms result is claimed. The mixed300-node warm/edit improvement does not offset the adverse target100-node results.
