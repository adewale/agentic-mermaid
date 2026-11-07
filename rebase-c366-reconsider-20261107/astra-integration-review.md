# Astra final integration review

Reviewed source: `93c6d75dc1373d5c238cc764d938ca6af91bebfe`; final adjustment compared with `a62af0daf`. Read-only Git-object inspection, 2026-11-07. No builds, tests, rendering experiments or production edits. **No blocking issue or serious merge loss found in the reviewed scope.**

## Final XML adjustment

[output-security.ts:391–433](https://github.com/adewale/agentic-mermaid/blob/93c6d75dc1373d5c238cc764d938ca6af91bebfe/src/output-security.ts#L391) makes an actual algorithm choice: metered callers get a fresh per-element `Set` for raw attribute names; unmetered callers retain main's bounded small-list scratch and promotion to a Set. This restores d8's metered lookup operation plan rather than executing the small-list comparisons without charging them. Both paths reject duplicate raw names; common parsing, attribute-value validation, namespace expansion, and expanded-name checks remain downstream. The patch neither changes the proof cap nor grants successful certification without the existing checks.

[paint-certification.test.ts:170–188](https://github.com/adewale/agentic-mermaid/blob/93c6d75dc1373d5c238cc764d938ca6af91bebfe/src/__tests__/paint-certification.test.ts#L170) uses generated SHA256-counter case 255 in a child, sets `AGENTIC_MERMAID_SCENE_ASSERTIONS=0` before importing public APIs, performs the stated layout-then-render sequence, consumes the SVG, checks 16 node identities/35 edges and Native selection, and requires passed paint proof with the original 400,000-operation cap. This is appropriately aimed at the actual Native path. The test does not assert an exact 399,809 operation count or full SVG equality; those stronger claims belong to the coordinator's separate captured comparison. The reported RED-before/GREEN-after child run is discriminating evidence; parent Scene-assertion probes that already passed are not.

## Baseline reconciliation

Static comparison of committed JSON shows that the final adjustment changes only `corpus/state/14`, moving three reverse-transition caption seats. Nodes, groups, bounds and every route vector remain identical to a62. The final state14 edges, groups and bounds exactly match d8. Its only difference from d8 is the nine concurrency-region `parentId` fields added to nodes by main. Thus this baseline edit reconciles main's parent semantics with retained PR edge/label geometry; it does not replace those routes with unexplained new paths.

## Capture and validation merge review

The following production files are byte-identical between d8 and final: `scene/native-drawing.ts`, `native-paint-emission.ts`, `part-capture.ts`, `inspection.ts`, `serialization.ts`, `svg-writer.ts`, and `written-geometry.ts`. ER layout, renderer, shared ink index and caption planner are also unchanged from d8. The previously flagged PR ownership/capture foundation, island packing and cardinality identity are therefore retained in those files.

Final validation incorporates main's `SubjectIndex` instead of JSON tuple sets. Inspection shows that references retain stable handles across later declarations, exact role membership remains separate, and semantic-group declarations retain their own flag. The accompanying added native-validation test covers forward references, more than eight roles for one identity, and a missing final declaration. The PR's captured write path, group-validation callback, fresh metadata-envelope admission, and aggregate-reference checks remain present.

Final paint certification also incorporates main's outline-width lookup optimization. Its bounded scan and promoted map retain newest matching width semantics; PR occurrence/capture proof logic remains alongside it. I found no basis in this focused read to claim either validation weakening or a newly introduced capture bypass. This is a limited source review, not an independent hostile-input audit.

## Qualification limits

The reported 1,748 corpus delivery/proof/route matches, six inherited State fill/scope changes, current-main forest/Class improvements with exact ELK controls, 233 family/SDK passes, broad suite results and final browser pass are coordinator-run evidence; I did not rerun them. Keep their exact source and test-environment bindings. Sparse32 and the original payload ceiling remain failures, so neither all-tests-green nor payload compliance is warranted. The final commit records a62 and the previously published d8 as parents, consistent with preserving published ancestry for a normal push.
