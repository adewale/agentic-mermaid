# Prepared text and terminal delivery — 18 October 2026

Reconciled against source `a87ec8612c3df98a5b9e8f52ac0e35814b02c523`.
This is a completion record, not an additional backlog or a new audit gate.

## Landed source

| Contract | Merge evidence (UTC, 2026-10-17) |
| --- | --- |
| Shared terminal compositor (#394) | 11:04, `c361f4bf15998aef222fba26346c0926b52b96ca` |
| Prepared text and complete geometry (#395) | 12:58, `53056ec569781d6f5153f90b5bd563aa70f8c5c7` |
| Shared semantic identities and compound terminal relationships (#404) | 17:23, `e0d04a444bb584266f479fdc3a96b55d734a1fcf` |
| Graphical/terminal marker handling (#401) | 19:43, `909d3e44103def754b2691818f10f2ba900c821f` |
| State note attachments and atomic terminal routing (#405) | 20:23, `a87ec8612c3df98a5b9e8f52ac0e35814b02c523` |

BUILD-36 and BUG-62–64 are complete in source. Their original acceptance and
independent review remain in [the plan](../prepared-text-geometry-plan.md) and
[audit](../prepared-text-geometry-audit.md). Related issues #381–#384, #386,
#391 and #392 must not be treated as pending merely because those records
describe their pre-merge work.

## Superseded XY branch

PR #380's reviewed head is `d8deddb42ee35ffd0a06c4c8f48f8827e32438f8`.
Its runtime commits `48f625b96bd27ca3e24a3e4e0094dffb801912ae` and
`d871e8e5127aa2aa4e29a490960d6dfc5bf63b2c` have patch-equivalent counterparts
`e8d3298bf2e4c801b1b193a947966f8bda3f7e57` and
`54c87404ed5a92b76a1354695d19423d24e04e60` in #395. Its documentation/evidence commits are
historical context, not another runtime dependency.

The 17 October review ran 49 focused tests on current main covering XY title
rendering, independent raster containment, omission diagnostics, intentional
title disabling and chart honesty. This establishes those exercised paths,
not every font/platform. The superseded PR was closed on 18 October without
merging or deleting its old branch; #362 remains open for other counterexamples.

## Remaining scope and delivery

CONS-45 concerns only demonstrated residual adapter duplication. It does not
require rebasing or reimplementing #395. Native C4 remains #387/BUILD-6; the
shared compositor and identity helpers alone do not deliver C4 semantics.

Source declares 0.4.2, but npm and the public MCP still identify 0.4.1 at this
reconciliation. REL-1/#378 owns publication and matching deployment evidence.
A green CI/deploy workflow is not proof that an artifact was published.

Historical audit branches, dated peer benchmarks and original review
measurements are preserved. No historical score is promoted to a current gate.
