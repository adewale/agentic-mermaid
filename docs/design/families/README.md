# Per-family design notes

Design notes for individual diagram families. A family's full picture is deliberately spread
across several surfaces; this hub points at each.

## Families with a dedicated design note

| Family | Design note | Notable cross-cutting surface |
|---|---|---|
| Architecture (`architecture-beta`) | [`architecture-beta.md`](./architecture-beta.md) | ops in `AGENT_NATIVE.md`; level in [`source-preservation-ladder.md`](../system/source-preservation-ladder.md) |
| Class | [`class.md`](./class.md) | namespace, generic, paint, and cardinality coverage |
| ER | [`er.md`](./er.md) | ordered typed/opaque segments and terminal clearance |
| Flowchart | [`flowchart.md`](./flowchart.md) (+ [`flowchart-parser-conformance.md`](./flowchart-parser-conformance.md)) | routing in [`route-contracts.md`](../system/route-contracts.md) |
| Gantt | [`gantt.md`](./gantt.md) (+ [`gantt-research.md`](./gantt-research.md)) | schedule resolver; citizenship worked example |
| GitGraph | [`gitgraph.md`](./gitgraph.md), [`gitgraph-research.md`](./gitgraph-research.md) | replay semantics, deterministic identities, history/use-case visual research |
| Journey | [`journey.md`](./journey.md) (+ [`journey-migration-parity.md`](./journey-migration-parity.md), [`journey-usage-research.md`](./journey-usage-research.md)) | migration parity; classic visual mode; usage research |
| Mindmap | [`mindmap.md`](./mindmap.md) | indentation-sensitive tree, compact bilateral layout, and spatial terminal output |
| Pie | [`pie.md`](./pie.md) | donut, labels, palette, and legend geometry |
| Quadrant | [`quadrant.md`](./quadrant.md) | point paint and dense placement |
| Sequence | [`sequence.md`](./sequence.md) | block/lifecycle semantics and containment |
| State | [`state.md`](./state.md) | regions, notes, pseudostates, paint, and loop routes |
| Timeline | [`timeline.md`](./timeline.md) | shared grammar and vertical layout |
| XY chart | [`xychart.md`](./xychart.md) | legend, axes, orientation, and raster parity |

## Generated visual evidence

The `*-demo.mmd` fixtures in this directory drive captioned review PNGs. The
pre-Mindmap/GitGraph before/after set belongs to
[PR #142](https://github.com/adewale/agentic-mermaid/pull/142): “before”
artifacts were rendered at `476e72f` (dense-loop follow-up `84b2ca95`,
class-generics completion `fb220147`). Follow-on Mindmap/GitGraph evidence
uses baseline `c7e33247` as the reproducible unsupported-family before state
and generated after images; no fake before picture is substituted for a
render that did not exist.
Most after images regenerate with:

```bash
bun run bin/am.ts render docs/design/families/<name>-demo.mmd --format png \
  --output docs/design/families/<name>-after.png
```

The Gantt completion image additionally uses `ganttToday: '2024-01-08'`; the dependency image
uses `{ gantt: { dependencyArrows: true, criticalPath: true } }` through `renderMermaidPNG`.
The all-family Style + Palette sheet and gallery evidence are generated and checked with:

```bash
bun run scripts/pr-assets/family-elevation-style-palette.ts
bun run gallery:mindmap-gitgraph
bun run gallery:mindmap-gitgraph:check
bun run gallery:mermaid-docs
bun run gallery:mermaid-docs:check
```

## Where every registered family is documented

- **Canonical registry:** `BUILTIN_FAMILY_METADATA` in `src/agent/families.ts` — and its generated roster table in [`abstraction-audit.md`](../system/abstraction-audit.md) §2.
- **User-facing catalogue:** [`diagram-families.md`](../../diagram-families.md).
- **Mutation ops + structured/opaque scope:** [`AGENT_NATIVE.md`](../../../AGENT_NATIVE.md).
- **Source-preservation level (L0–L4):** [`source-preservation-ladder.md`](../system/source-preservation-ladder.md).
- **Cross-surface citizenship matrix:** [`diagram-family-citizenship.md`](../../contributing/diagram-family-citizenship.md).
- **Mermaid syntax references:** `skills/agentic-mermaid-diagram-workflow/references/`.
