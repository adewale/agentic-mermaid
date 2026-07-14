# Section A rendering contract — landing candidate record

Status: open landing candidate in PR #163, implemented and locally verified in
July 2026 on the Section A landing branch after PR #148 landed. This record must
not claim completion or `main` until PR #163 merges. Live follow-up work remains
owned only by root `TODO.md`.

If PR #163's landing gates pass and it merges, this record closes Section A of
[`brand-primitives-plan.md`](../brand-primitives-plan.md). It does not close
independent family-adoption, source-preservation, terminal, or remaining
non-marker `RawMark` work.

| Boundary | Result | Primary executable evidence |
|---|---|---|
| A0 — truth | Capability states and parity claims are registry-derived and use the applicable checked vocabulary for each dimension rather than mixing family, transport, output, backend and realization states. | `section-a-capability-report.test.ts`, `section-a-render-contract.test.ts` |
| A1 — identity | Namespaced extension identities, explicit core/Scene compatibility for executable extensions, committed-only discovery, immutable registration, and the diagnosed `tufte` compatibility window replace shadowing and copied menus. | `extension-registries.test.ts`, `family-registration-conformance.test.ts`, `style-spec-authority.test.ts` |
| A2 — request | One internal immutable request/appearance boundary drives runtime validation and transport receipts; public schemas and receipt digests expose its behavior without exporting executable implementation types. Family-specific options either apply or emit a stable not-applicable diagnostic. | `render-options-authority.test.ts`, `section-a-transport-parity.test.ts` |
| A3 — primitives | Typed connector routes, terminals, markers, roles, hit semantics, and fine-grained backend claims replace graphical marker-string reconstruction and supply terminal evidence. Family cell-grid topology remains independently owned. | `scene-connector-contract.test.ts`, `terminal-projection-security.test.ts` |
| A4 — family | `FamilyDescriptor` owns routing, examples, operations, positioning hooks, roles, and capability evidence; every registered built-in or extension uses one positioned artifact/projection, and external registration is staged until its native declarations pass executable conformance, including meaningful positive-bounds layout evidence. | `section-a-family-descriptor-conformance.test.ts`, `family-registration-conformance.test.ts`, `extension-family-public-api.test.ts`, `positioned-artifact-convergence.test.ts` |
| A5 — parity | Every generated shared-field×surface and product/output cell is exhaustively classified and evidence-linked, with executable public-adapter sentinels rather than a misleading full Cartesian claim. Every registered family and first-party backend has registry-wide bounded conformance coverage; hosted policy across SVG, PNG, ASCII and Code Mode layout, strict insertion, color profiles, portable PNG controls, admitted terminal appearance/diagnostic projection, and content-addressed bundled-resource receipts have focused executable gates. Host font inputs are marked host-dependent. | `section-a-transport-parity.test.ts`, `hosted-execute-differential.test.ts`, `backend-capability-conformance.test.ts`, `section-a-family-descriptor-conformance.test.ts`, `family-registration-conformance.test.ts`, `characterization-families.test.ts`, `browser-png-contract.test.ts`, `website-render-receipts.test.ts`, `editor-security-closures.test.ts` |
| A6 — evolution | A version-pinned Mermaid manifest, lossless unknown-header behavior, namespaced family/resource contracts, and claim-keyed executable SVG witnesses make additions reviewable without core switches. Every first-party core primitive/feature/operation claim has an exact witness; namespaced extension claims are retained as explicitly unverified. PNG inherits admitted SVG through the separately tested canonical rasterizers. | `upstream-family-manifest.test.ts`, `resource-manifest-integrity.test.ts`, `extension-registries.test.ts`, `backend-capability-conformance.test.ts` |
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
