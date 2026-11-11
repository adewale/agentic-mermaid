# Documentation audit, 30 October 2026

The documentation cleanup and five simplification recommendations landed
directly on `main` in
[`19a0922c`](https://github.com/adewale/agentic-mermaid/commit/19a0922c6df601ed7c3aa2d3d47c617a701e042e),
[`9519ca5f`](https://github.com/adewale/agentic-mermaid/commit/9519ca5f1daf904f4b98a1b8e9097c201400cf96)
and
[`4c72d1c8`](https://github.com/adewale/agentic-mermaid/commit/4c72d1c8266a48c31a4ebc5f4f33a0eb0fe648a0).
This record explains those changes and their evidence. It does not establish
a recurring audit gate or a second backlog.

## Findings and decisions

| Recommendation | Delivered change and owning boundary |
| --- | --- |
| Generate shared facts | [Doc-block renderers](../../../scripts/docs/doc-blocks.ts) use the owning tool registries, verification definition, layout limits and family metadata. The website uses those tool registries for both MCP inventories. Existing documentation tests compare emitted inventories with runtime tools. |
| Keep one release checklist | [Releasing](../../contributing/releasing.md) covers source preparation, documentation reconciliation, publication, public installation, production verification and completion records. One-time publishing setup is separate. |
| Prepare releases with one command | [`release:prepare`](../../../scripts/prepare-release.ts) updates version projections and invokes the existing generators. An optional date finalizes notes; failed generation restores prior file contents. It neither publishes nor changes Git refs or the index. |
| Separate current contracts from history | The [backend guide](../../design/system/layout-backends.md) contains the current contract. Its [dated design and experiment record](layout-backends-2026-10.md) retains the original measurements and limitations. |
| Keep operational records outside npm | [Directory records](../mcp-directory-listings.md) moved into repository-only project documentation. The reviewed [package manifest](../../../scripts/ci/publish-package-files.json) no longer includes their former root-doc path. |

The audit also repaired stale contributor commands, research links, family
navigation and the completed release task in `TODO.md`. Missing historical
benchmark drivers are recorded as reproducibility gaps rather than described
as runnable commands. Completed 0.5.4 publication and deployment proofs live
in the [release record](releases.md#054--2026-10-30).

## Verification and limits

[Canonical CI](https://github.com/adewale/agentic-mermaid/actions/runs/41055556521)
and [Ruff](https://github.com/adewale/agentic-mermaid/actions/runs/41055556784)
passed on the final implementation commit,
`4c72d1c8266a48c31a4ebc5f4f33a0eb0fe648a0`. This includes the unit shards,
semantic and MCP conformance, browser/site checks, payload budgets, packaged
consumers and quality gates. These results belong to that revision; later
changes need their own affected checks.

Two findings received explicit regression probes:

- Replacing the emitted MCP inventory with the obsolete list caused the
  existing website documentation test to fail; restoring the registry-driven
  output passed.
- The first CI run exposed a copied-paragraph matcher in the homepage prompt
  evaluation harness. It could no longer remove semantic guidance after the
  verification wording changed. Explicit section boundaries replaced that
  matcher, and the existing test now checks exact removal, changed wording,
  duplicate sections and preservation of the shared verification definition.

The existing [release-preparation tests](../../../src/__tests__/prepare-release.test.ts)
cover version projections, changelog rollover, repeat invocation, rejected
inputs, an unchanged Git index and rollback after generator failure. The
existing generators remain responsible for their output formats.

At this audit's completion, source was prepared as 0.5.5 with Unreleased
notes. Publication and production remained at 0.5.4. Source preparation and
passing CI do not establish npm availability, MCP Registry publication or a
new deployment. The release checklist retains those separate checks.

The review covered 210 maintained Markdown files, generated documentation
and the affected website surfaces. It does not prove every prose claim,
external link or archived research result remains valid indefinitely.
