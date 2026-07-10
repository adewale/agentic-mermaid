# Per-family design notes

Design notes for individual diagram families. A family's full picture is deliberately spread
across several surfaces; this hub points at each.

## Families with a dedicated design note

| Family | Design note | Notable cross-cutting surface |
|---|---|---|
| Architecture (`architecture-beta`) | [`architecture-beta.md`](./architecture-beta.md) | ops in `AGENT_NATIVE.md`; level in [`source-preservation-ladder.md`](../system/source-preservation-ladder.md) |
| Gantt | [`gantt.md`](./gantt.md) (+ [`gantt-research.md`](./gantt-research.md)) | schedule resolver; citizenship worked example |
| Journey | [`journey.md`](./journey.md) (+ [`journey-migration-parity.md`](./journey-migration-parity.md), [`journey-usage-research.md`](./journey-usage-research.md)) | migration parity; classic visual mode; usage research |
| XY chart | [`xychart.md`](./xychart.md) | — |
| Flowchart | [`flowchart-parser-conformance.md`](./flowchart-parser-conformance.md) (conformance) | routing in [`route-contracts.md`](../system/route-contracts.md) |

Families **without** a dedicated design note — sequence, class, ER, pie, quadrant, timeline,
state — are documented entirely through the cross-cutting surfaces below.

## PR #142 generated visual evidence

The `*-demo.mmd` fixtures in this directory drive the captioned before/after PNGs in
[PR #142](https://github.com/adewale/agentic-mermaid/pull/142). “Before” artifacts were rendered
at `476e72f` (or, for the dense-loop follow-up, `84b2ca95`); “after” artifacts use the PR branch.
Most after images regenerate with:

```bash
bun run bin/am.ts render docs/design/families/<name>-demo.mmd --format png \
  --output docs/design/families/<name>-after.png
```

The Gantt completion image additionally uses `ganttToday: '2024-01-08'`; the dependency image
uses `{ gantt: { dependencyArrows: true, criticalPath: true } }` through `renderMermaidPNG`.
The all-family Style + Palette sheet is generated and tested byte-for-byte:

```bash
bun run scripts/pr-assets/family-elevation-style-palette.ts
```

## Where every family is documented (all 12)

- **Canonical registry:** `BUILTIN_FAMILY_METADATA` in `src/agent/families.ts` — and its generated roster table in [`abstraction-audit.md`](../system/abstraction-audit.md) §2.
- **User-facing catalogue:** [`diagram-families.md`](../../diagram-families.md).
- **Mutation ops + structured/opaque scope:** [`AGENT_NATIVE.md`](../../../AGENT_NATIVE.md).
- **Source-preservation level (L0–L4):** [`source-preservation-ladder.md`](../system/source-preservation-ladder.md).
- **Cross-surface citizenship matrix:** [`diagram-family-citizenship.md`](../../contributing/diagram-family-citizenship.md).
- **Mermaid syntax references:** `skills/agentic-mermaid-diagram-workflow/references/`.
