# Per-family design notes

Design notes for individual diagram families. A family's full picture is deliberately spread
across several surfaces; this hub points at each.

## Family notes

<!-- BEGIN GENERATED: family-design-notes -->
| Family | Design note |
| --- | --- |
| Flowchart | [flowchart.md](./flowchart.md) |
| State | [state.md](./state.md) |
| Sequence | [sequence.md](./sequence.md) |
| Timeline | [timeline.md](./timeline.md) |
| Class | [class.md](./class.md) |
| ER | [er.md](./er.md) |
| Journey | [journey.md](./journey.md) |
| Architecture | [architecture-beta.md](./architecture-beta.md) |
| XY chart | [xychart.md](./xychart.md) |
| Pie | [pie.md](./pie.md) |
| Quadrant | [quadrant.md](./quadrant.md) |
| Gantt | [gantt.md](./gantt.md) |
| Mindmap | [mindmap.md](./mindmap.md) |
| GitGraph | [gitgraph.md](./gitgraph.md) |
| Radar | [radar.md](./radar.md) |
| Sankey | [sankey.md](./sankey.md) |
| C4 | [c4.md](./c4.md) |
| Packet | [packet.md](./packet.md) |
| Kanban | [kanban.md](./kanban.md) |
| Requirement | [requirement.md](./requirement.md) |
| Treemap | [treemap.md](./treemap.md) |
| Ishikawa | [ishikawa.md](./ishikawa.md) |
| Block | [block.md](./block.md) |
| Event Modeling | [eventmodeling.md](./eventmodeling.md) |
| ZenUML | See the shared system and family contracts below. |
| Railroad | [railroad.md](./railroad.md) |
| Cynefin | [cynefin.md](./cynefin.md) |
| AgentFlow | [agentflow.md](./agentflow.md) |
| UseCase | [usecase.md](./usecase.md) |
| Wardley | [wardley.md](./wardley.md) |
| Venn | [venn.md](./venn.md) |
| Swimlane | [swimlane.md](./swimlane.md) |
| TreeView | [treeview.md](./treeview.md) |
<!-- END GENERATED: family-design-notes -->

The registry supplies this index. Families without a dedicated note use the
[system hub](../system/README.md) and the
[shared implementation contract](stable-family-implementation.md). Related
research and parser notes remain alongside each family document.
See also the [Flowchart parser](flowchart-parser-conformance.md),
[Gantt research](gantt-research.md), [GitGraph research](gitgraph-research.md),
[Journey migration](journey-migration-parity.md) and
[Journey usage research](journey-usage-research.md).

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
The all-family Style + Palette sheet (not committed) and gallery evidence are generated with:

```bash
bun run scripts/pr-assets/family-elevation-style-palette.ts
bun run gallery:mindmap-gitgraph
bun run gallery:mermaid-docs
bun run gallery:pie-highlight
```

## Shared rendering and verification

Family renderers use the shared style and palette system; Mermaid's pixels are
not a layout target. Accepted configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts).

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks each representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
looks and palettes. Family pages identify the independent domain expectations
and reviewed goldens. These finite examples do not establish exhaustive syntax
coverage or readability at arbitrary complexity.

## Where every registered family is documented

- **Canonical registry:** `FamilyDescriptor` registrations in `src/agent/families.ts`; use `am capabilities --json` for the generated roster.
- **User-facing catalogue:** [`diagram-families.md`](../../diagram-families.md).
- **Mutation ops:** generated — `describeOps(family)` / `opSignatures(family)`, or `families[].opFields` in `am capabilities --json`.
- **Structured/opaque scope and shared op conventions:** [`AGENT_NATIVE.md`](../../../AGENT_NATIVE.md).
- **Source-preservation level (L0–L4):** [`source-preservation-ladder.md`](../system/source-preservation-ladder.md).
- **Cross-surface citizenship checklist:** [`diagram-family-citizenship.md`](../../contributing/diagram-family-citizenship.md).
- **Mermaid syntax references:** `skills/agentic-mermaid-diagram-workflow/references/`.
