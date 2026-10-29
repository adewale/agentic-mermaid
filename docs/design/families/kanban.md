# Kanban

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/kanban.md)
and [domain reference](https://en.wikipedia.org/wiki/Kanban_board) define the recognizable hallmark: A Kanban board preserves ordered workflow columns containing ordered task cards.

## Semantics and editing

Columns and tasks retain IDs, labels, metadata, icons and class assignments. Ticket, assignee and priority are visible task data. Canonical writes use the native indentation grammar and structured metadata; moving a card changes its column membership explicitly.

Use `asKanban` after parsing and `describeOps('kanban')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

Cards reserve prepared label and metadata rows before placement. The board measures fixed-width columns and full card heights. Typed Scene groups retain membership, while native terminal columns/cards use their own cell measurements. Unknown icon sources remain offline and have explicit text fallbacks; ticket links are inert metadata subject to shared URL policy.

Graphical callers may opt into whole-column wrapping with `kanban: { maxWidth: 720 }` in render options. The width is best-effort: columns retain a readable 160px minimum, measured fonts, source order and card membership. Exceptionally small widths or a long title may exceed the request. Terminal output retains its own `targetWidth` layout. The Editor exposes an explicit **Wrap board to preview width** control and preserves that width for exports and shared links.

Malformed labels and metadata report authored line/column positions through frontmatter and accessibility directives. `SourceMap.spans.metadata` optionally maps each item occurrence to property key/value spans in the original source; repeated authored IDs retain separate owners.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.

## Executable evidence

The first official example is retained in kanban-demo.mmd. Native family tests and the pinned grammar benchmark exercise metadata, order, icon/class declarations, typed movement and round-trip closure.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/kanban-demo.mmd --format svg --output /tmp/kanban-demo.svg
bun run bin/am.ts render docs/design/families/kanban-demo.mmd --format png --output /tmp/kanban-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Open upstream #8121 ports the parser with token and database oracle parity across 107 inputs. Open #8140 and #8281 address accessibility and dropped class assignments. These are useful regression references, not new pinned syntax requirements. https://github.com/mermaid-js/mermaid/pull/8121

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
