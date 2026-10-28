# Block

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/block.md)
and [domain reference](https://en.wikipedia.org/wiki/Block_diagram) define the recognizable hallmark: Blocks occupy authored grid cells, with explicit column spans, empty cells and nested composites; connectors do not reorder the grid.

## Semantics and editing

The tree retains authored order, per-container columns, spans, empty cells, nested composite labels, every documented shape, directional block arrows, edge markers, labels, thickness, patterns and styles. Canonical serialization preserves the grid rather than deriving one from graph edges.

Use `asBlock` after parsing and `describeOps('block')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

Placement is a family-specific measured grid. Shape artwork and attachment ports reuse shapeOutline; Scene parts, prepared text, markers and output-security boundaries are shared. Terminal placement runs the same abstract cell allocation with cell measurements, not scaled pixel coordinates. Nonrectangular block artwork is represented by terminal frames; directional block-arrow labels identify their directions.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.
Authored fill, stroke, text color, stroke width and dash arrays reach the shape's Scene paint, including compound outlines. Font size and normal, bold or numeric font weight are measured before placement and retained by the rendered label.

## Executable evidence

All thirty documentation fences have independently captured pinned model expectations and exercise parse, canonical round-trip, native SVG, terminal and positioned JSON. The upstream bench runs portable assertions unchanged and lists DOMPurify/global-config/generated-CSS implementation exclusions.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/block-demo.mmd --format svg --output /tmp/block-demo.svg
bun run bin/am.ts render docs/design/families/block-demo.mmd --format png --output /tmp/block-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Open upstream #8310 adds accessibility directives and #8279 changes missing-style targets from crashes to warnings; these are beyond the pin. Agentic already preserves a style declared before its block and preserves every link in a chain. These intentional reader improvements do not copy Mermaid layout. https://github.com/mermaid-js/mermaid/pull/8279

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
