# Backlog reconciliation, 25 October 2026

This is a completion and disposition record, not a work queue. `TODO.md`
retains unfinished work. The review used main `18017376db3168579b26cc9ecf01f8526e00146e`,
GitHub's merge/issue records and the existing owning tests. Source completion
is separate from publication; npm still served 0.4.1 during this review and
#378 targets 0.5.0.

| Retired entry | Evidence and disposition |
| --- | --- |
| BUG-20: ellipse syntax | Commit `e8a414a855f00ff902bd4e88a9a8bf762a864bcc` implements ellipse parsing, editing and routing. The public parser reads `A(-a-)` as label `a`, shape `ellipse`; the shared outline tests cover painted/routed ellipse geometry. |
| BUG-54: Quadrant quoting | Merged commit `31fb78d` and the current `agent-quadrant.test.ts` cover grammar-aware keyword/semicolon labels, exact reload and pinned-Mermaid acceptance. An unquoted extension still draws with a portability warning. #505 separately delivered statement separators and the Class header alias. |
| BUG-58: Quadrant styles | The writer at merged commit `31fb78d` and its existing tests cover fractional radii/widths, functional/variable colors and unknown properties. Unsupported source is retained with native rendering and warnings; typed authoring/regeneration is refused instead of rounding, dropping properties or claiming portable structured output. |
| TEST-5 / #265: bundle exemptions | Merged #485 binds exemptions to constructed route identities and geometry; copied certificates and changed routes lose the exemption. #265 is closed as completed. Legitimate bundles, translations and repairs retain owning tests. |
| TEST-7 / #259: tangential arrivals | #259 was closed `not_planned` on 24 October as superseded/speculative. A new incidence metric or universal normal-arrival policy is not authorized remaining work. Reopen only for a small current reproducer showing material visual harm; preserve the existing endpoint-approach checks. |
| CONS-44: config ownership | #416 merged as `83218d6c23f1f5c277bd9f7b6b860f26ca012b64`; family diagnostics and projected transport schemas are source-delivered. |
| GOV-1 / #263: mandatory scope labels | #263 is closed `not_planned`. Existing contract-scoping guidance remains in `CLAUDE.md`; the proposed label gate is not active implementation work. |
| TRIAGE-1 / #303: color surface matrix | #303 is closed as completed. The existing authored-style, theme, family-config and XY color admission owners were rerun here: invalid values are named across render, verify, typed/transport routes and configuration forms, with valid-paint and family-isolation controls retained. |
| #409: shared family composition | Closed as completed during this reconciliation. Its assessment links merged #420/#422/#423/#438/#467/#433 and real consumers of measured rows and the drawing-document shell. Further frameworks or another family are not missing acceptance requirements. Historical counts retain their original revisions. |

## Validation and limits

The existing theme-color, family-config-color, authored-style-color,
XY-color, Quadrant-agent, Architecture-agent and shared shape-outline owners
pass: **519 tests across seven files, zero failures**. Quadrant and Architecture
cases use pinned Mermaid 12.2.0 for source/model acceptance; geometry remains
Agentic's contract. The ellipse public-parser witness was also replayed.
These are bounded checks of the named witnesses and their owning regression
sets, not proof that every future syntax or color extension is portable.

## Entries corrected but still open

- PERF-1: #467/#468 and subsequent optimizations merged. Remaining current-candidate
  performance qualification and #449's native limits remain work; the old reports
  retain their measured revisions and rejected experiments.
- REL-1: #410/#416/#418/#419 are merged; #363/#367/#372 are closed. The target
  is 0.5.0. Final scope, candidate qualification, publication and matching live
  delivery remain under #378; this reconciliation performs no release.
- GOV-2: the owner already approved the `CI complete` ruleset. Applying it is
  blocked by integration permissions (HTTP 403), not another permission decision
  or missing CI code. The 25 October read still returned unprotected main and
  no rulesets.
- Architecture extensions and the empty Class spelling remain explicit limits.
  Preserve unsupported source and refuse unrepresentable typed writes; do not
  invent identifiers, icons or entities to make output look portable.

Other unchecked entries retain their existing scope. A closed issue alone was
not used to assert that an untested behavioral acceptance condition passes.
