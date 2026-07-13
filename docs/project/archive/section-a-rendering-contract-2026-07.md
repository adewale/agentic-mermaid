# Section A rendering contract — completion record

Status: completed on the Section A implementation branch in July 2026, based
on `0a81c3b` (the merge of PR #148). The landing PR link is added before this
record is merged. Live follow-up work is owned only by root `TODO.md`.

This record closes Section A of
[`brand-primitives-plan.md`](../brand-primitives-plan.md). It does not close
independent family-adoption, source-preservation, terminal, or remaining
non-marker `RawMark` work.

| Boundary | Result | Primary executable evidence |
|---|---|---|
| A0 — truth | Capability states and parity claims are registry-derived and use explicit native/projected/diagnosed/absent meanings. | `section-a-capability-report.test.ts`, `section-a-render-contract.test.ts` |
| A1 — identity | Namespaced extension identities, deterministic discovery, immutable registration, and the diagnosed `tufte` compatibility window replace shadowing and copied menus. | `extension-registries.test.ts`, `style-spec-authority.test.ts` |
| A2 — request | One internal immutable request/appearance boundary drives runtime validation and transport receipts; public schemas and receipt digests expose its behavior without exporting executable implementation types. | `render-options-authority.test.ts`, `section-a-transport-parity.test.ts` |
| A3 — primitives | Typed connector routes, terminals, markers, roles, hit semantics, and fine-grained backend claims replace graphical marker-string reconstruction and supply terminal evidence. Family cell-grid topology remains independently owned. | `scene-connector-contract.test.ts`, `terminal-projection-security.test.ts` |
| A4 — family | `FamilyDescriptor` owns routing, examples, operations, positioning hooks, roles, and capability evidence; every built-in uses one positioned artifact/projection. | `section-a-family-descriptor-conformance.test.ts`, `positioned-artifact-convergence.test.ts` |
| A5 — parity | The 42 product/output cells, all first-party backends, strict insertion, color profiles, terminal appearance/diagnostic projection, and content-addressed bundled-resource receipts are explicit and tested. Host font inputs are marked host-dependent. | `section-a-transport-parity.test.ts`, `browser-png-contract.test.ts`, `editor-security-closures.test.ts` |
| A6 — evolution | A version-pinned Mermaid manifest, lossless unknown-header behavior, namespaced family/resource contracts, and a bounded executable backend SVG admission report make additions reviewable without core switches. Primitive claims remain declarations; PNG inherits admitted SVG through the canonical rasterizer. | `upstream-family-manifest.test.ts`, `resource-manifest-integrity.test.ts`, `extension-registries.test.ts` |
| A7 — deletion | Generated family, StyleSpec, RenderOptions, SDK, and capability projections replace copied tables; completed plans moved under `docs/project/archive/`. | `docs-consolidation-contract.test.ts`, freshness checks below |

## Authorities retired

- copied family rosters, hand-written SDK family declarations, narrower lists,
  and manually maintained machine-capability tables; the qualitative fidelity
  audit remains human-reviewed evidence with registry-checked row coverage;
- per-surface RenderOptions lists and schemas, PNG-specific appearance merging,
  and Code Mode standing in for unrelated product transports;
- copied style/theme labels, the picker-only `crisp` entry, silent registration
  replacement, ambiguous palette/look discovery, and hand-written StyleSpec
  field/schema tables;
- family-local connector marker XML and graphical backend reconstruction of
  connector semantics from serialized SVG;
- independent SVG-versus-layout positioning for registered built-ins and the
  unused positioned-additions/Treatment pipeline;
- deterministic claims for untracked host fonts, unverified post-check resource reads, unsafe
  editor SVG insertion, and surface-specific strict-output sanitizers;
- active-path historical consolidation, Style rollout, hosted-MCP, and issue-71
  execution plans; Git history and this archive retain provenance without
  retaining another authority.

Compatibility projections that remain (`knownStyles`, `THEMES`,
`BUILTIN_FAMILY_METADATA`, and legacy aliases) are derived from canonical
descriptors. They are not independent authorities.

## Verification

Run from the repository root:

```sh
bunx tsc --noEmit
bun run build
bun run agent-doc-artifacts:check
bun run render-options-docs:check
bun run style-spec-artifacts:check
bun run section-a-report:check
bun run upstream-manifest:check
bun run website:check
bun test src/__tests__/
```

Visual baseline updates remain governed by the repository's explicit golden
approval mechanism; this record does not weaken that gate.
