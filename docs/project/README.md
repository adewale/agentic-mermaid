# Project plans and records

[`TODO.md`](../../TODO.md) is the only owner-facing backlog. A design document
explains a decision or acceptance boundary; it does not create a second queue.
Open issues and PRs supply reproductions and implementation evidence, not proof
that work has shipped. Current capabilities come from the registry and owning
code/tests, not dated inventories.

## Maintained context

| Document | Purpose and backlog owner |
|---|---|
| [Website payload plan](website-payload-plan.md) | Measured optimization boundaries; remaining work is WEB-2. Historical byte totals are not current budgets. |
| [MCP directory listings](mcp-directory-listings.md) | Repository-only directory submissions, ownership and dated publication evidence. |
| [Hosted abuse controls](mcp-abuse-controls-plan.md) | Threat model and acceptance detail for SEC-4. DEC-6 separately owns whether hosted execute should remain. |
| [MCP interop](mcp-client-interop-verification-plan.md) | Implemented TypeScript lane, instrumented Python probe and recorded manual client coverage; includes the completed TEST-4 verification record. |
| [Brand/family design record](brand-primitives-plan.md) | Design rationale and completed rollout; current architecture lives in the [system hub](../design/system/README.md). Old report/receipt tables are not current gates. |
| [Divergences](divergences.md) | Deliberate product boundaries, not feature requests. |
| [Lessons learned](lessons-learned.md) | Engineering lessons, not mandatory restoration of historical machinery. |
| [Benchmark evidence](https://github.com/adewale/trident/blob/main/RESULTS.md) | Current measurement methods, bounded findings, peer gaps and reproduction; raw reports remain review artifacts. |
| [Conditional forest layout](conditional-forest-layout.md) | Opt-in forest eligibility, fallback boundary and reproducible qualification commands. |
| [Staged replacement of ELK](layered-layout-proposal.md) | Proposed measured-graph adapter, Pele evaluation, staged scope and acceptance boundary for replacing ELK. |

## Completed and superseded work

The [release record](archive/releases.md) binds completed releases to their
source, CI, registry publication and verified production deployment.

The [archive](archive/) retains dated evidence without claiming it describes
today's build, protocol, CI or deployment. In particular:

- The consumed [0.5 investigation](https://github.com/adewale/agentic-mermaid/blob/30f0af5d63e460c8bd3de88358414f2c7857a2c6/docs/project/0.5-performance-investigation.md)
  retains its original measurements and hypotheses in immutable history. Useful
  findings and remaining opportunities are consolidated in the benchmark evidence.
- The [test-portfolio migration](archive/complexity-aware-test-portfolio-plan.md)
  is complete; TEST-3 retains only the unperformed observational follow-up.
- The [stateless MCP migration](archive/stateless-mcp-migration-plan.md)
  records completed phases and the original standards-evidence limitations.
- The [dogfooding strategy](archive/dogfooding-docs-strategy.md) was superseded
  by the derived-artifact policy in `CLAUDE.md`.
- CONS-26's State/Timeline defects (#368) were fixed in #379. Do not keep their
  old reproductions as an unfinished consolidation task.
- [Prepared text and terminal delivery](archive/prepared-text-geometry-delivery-2026-10.md)
  records BUILD-36/BUG-62–64 completion and #380's superseded runtime work.
  Publication and deployment completed with [0.5.4](archive/releases.md#054--2026-10-30).
- The #248 delivery plan has been removed. #248 was closed `not_planned`, and
  #361 dismantled its harness/report/receipt programme. Useful assertions now
  belong in ordinary owning tests; the deleted plan remains recoverable in Git.

When work lands, remove the completed backlog entry rather than keeping an
unchecked narrative. When a proposal is declined, retain its history without
requiring future contributors to execute it. Do not turn archived checklists,
generated branch inventories or research issue lists into new gates.
