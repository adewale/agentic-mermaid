# Issue #26/#38 closure decisions

Status: active implementation ledger for the remaining principled-layout work.

## D1 — Certificate exposure policy

Route certificates are public but opt-in.

- Library: `layoutMermaid(d, { debug: true })` includes `RenderedLayoutEdge.route`.
- CLI: `am render --format json --certificates` includes the same route object.
- Default layout JSON stays certificate-free to preserve the stable, compact schema.
- Non-graph families may omit route certificates until they own family-specific certificate models; accepted class/ER/architecture certificates now use `routeClass: "family-layout"` rather than graph route classes.

## D2 — Port-certificate vocabulary

V1 keeps the existing concrete `AnyPort` vocabulary: `N|E|S|W` for cardinal shape anchors, plus diamond facet midpoints `NE|SE|SW|NW` where the graph router proves those are the actual contact points.

The richer #38 policy now extends V1 certificates with additive `sourcePortAssignment` / `targetPortAssignment` metadata: physical side, deterministic ordered slot, slot count, semantic role, and the exact `AnyPort` when present. These fields do not reinterpret existing `sourcePort` / `targetPort`; they are the bridge for debugging and the conservative primary-DAG pre-layout `FIXED_SIDE` port hints. Constraint/relaxation reason metadata remains future work if a verifier starts emitting actionable port degradations.

## D3 — Warning taxonomy for unsupported or degraded route intent

Current warning codes stay grouped by severity/tier:

- **Structural/source**: parseable diagrams that cannot resolve or would render invalidly (`EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `UNRESOLVABLE_SCHEDULE`, etc.).
- **Geometric route tripwires**: post-certification violations (`ROUTE_HITCH`, `ROUTE_UNEXPLAINED_BEND`, `ROUTE_*_MISANCHOR`, etc.).
- **Lint/source-preservation**: preserved but unmodeled syntax (`UNSUPPORTED_SYNTAX`, `COMMENT_DROPPED`) that does not make `verify.ok` false.

Future degradation codes should follow this naming before implementation:

| Code family | Tier | When to emit |
|---|---|---|
| `PORT_*` | geometric | A route endpoint violates intended side/order/slot after a port allocator exists. |
| `*_DEGRADED` | lint or geometric | A renderer intentionally maps richer route intent to a weaker representation, e.g. ASCII cannot preserve lane separation. |
| `ACTION_*` | structural or lint | A source action/link is unsafe, stripped, source-only, or unsupported by the requested render surface. |
| `TRACE_*` | lint | A source/render region cannot be mapped stably. |

Do not add dormant `WarningCode` enum values until at least one verifier/renderer can emit them and docs/capabilities/agent instructions can be updated in the same change.

## D4 — Text measurement contract

SVG layout and quality measurement use `TEXT_MEASUREMENT_CONTRACT` / `measureText` from `src/text-metrics.ts`:

- Inter-compatible proportional estimate in px.
- Shared wide/zero-width codepoint ranges from `src/shared/unicode-ranges.ts`.
- Emoji detection via `Emoji_Presentation` or `Extended_Pictographic`.
- East Asian ambiguous-width symbols stay single-cell; fullwidth/CJK/emoji are wide.

ASCII/Unicode keep terminal-column measurement, but must use the same shared Unicode range tables for wide and zero-width decisions.

## Implementation ledger (2026-06)

Completed slices from the remaining #26/#38 ordering:

1. Stale #26/#38/#34 status notes reconciled in this ledger, `issue-26-audit.md`, and `route-contracts.md`.
2. Certificate exposure policy implemented: public opt-in via `layoutMermaid(..., { debug: true })` and `am render --format json --certificates`.
3. Port vocabulary decision recorded: V1 `AnyPort`, future allocator extends rather than replaces it.
4. Unsupported/degraded warning taxonomy recorded; no dormant core `WarningCode`s added.
5. Text measurement contract exported as `TEXT_MEASUREMENT_CONTRACT` / `measureText`.
6. Flowchart `SourceMap` now covers nodes, edges, groups, and labels; family traceability now includes class members, ER attrs/cardinalities, chart marks, and Gantt tasks/sections.
7. Existing route certificates are exposed on the chosen JSON/CLI/API surface.
8. `analyzeMermaid(Source)` exposes feedback edges, Gantt critical path/slack, and source-only action records.
9. Action/security records use a non-executing record model; unsafe schemes are flagged source-only/unsafe.
10. Mermaid link length is honored conservatively for simple no-subgraph primary-forward DAGs in all four directions.
11. Class/ER received semantic layout validators and debug `FamilyEdgeRouteCertificate`s: real layout geometry, on-canvas/non-overlap checks, relationship endpoint-on-box tripwires, and `orthogonal-box` certificates.
12. Architecture now emits final-geometry `side-anchored` `FamilyEdgeRouteCertificate`s in debug layouts; stale graph certificates remain forbidden.
13. Stable region-tree V1: flowchart layout JSON flattens subgraphs with `parentId` + direct `members`; debug layout JSON exposes `regions` plus non-executing `actions`; SVG subgraph groups carry `data-region`/`data-parent-id`; ASCII metadata exposes best-effort subgraph label regions.
14. ASCII/Unicode route parity is explicit: `ASCII_ROUTE_PARITY_CONTRACT` records the mapping from shared `classifyRoutes()` route intent to terminal-grid routing; `renderMermaidASCIIWithMeta` emits structured degradation warnings such as `ASCII_EDGE_REGION_UNMAPPED`.
15. Dynamic route port allocation now exposes side + ordered slot + semantic role on opt-in route certificates while preserving V1 `sourcePort` / `targetPort`.
16. Pre-layout placement consumes a conservative route-intent slice: primary-forward edges feed inferred fixed-side source/target ports to ELK only when neither endpoint participates in non-primary routes; feedback/container/cross-hierarchy cases stay owned by final route repair.
17. Sequence and timeline now share the real rendered-layout adapter/verify geometry path instead of empty synthetic verification layouts.

Deferred by design rather than silently open in this PR-sized slice:

- Broad ELK port constraints beyond safe per-edge primary-forward hints remain high-blast-radius and require corpus/mutation evidence before expanding.
- Sequence/timeline/chart certificate schemas are family-specific rather than graph-route schemas: sequence proves lifeline-message anchors; timeline/charts prove rendered element containment in their own layout frames.
