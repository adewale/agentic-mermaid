# Treemap

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/treemap.md)
and [domain reference](https://en.wikipedia.org/wiki/Treemapping) define the recognizable hallmark: Nested rectangles encode hierarchical containment and value-proportional leaf area.

## Semantics and editing

The semantic tree keeps labels, numeric values, parent membership and class definitions independently of tiling order. Typed edits change values or move hierarchy nodes without flattening their domain data. Both stable and beta header aliases are read; canonical writes use treemap.

Use `asTreemap` after parsing and `describeOps('treemap')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

A dedicated hierarchical tiler computes area partitions. Shared prepared text, owned Scene rectangles/groups, palettes and numeric formatters compose the output. Terminal output keeps the hierarchy and values in a family-owned cell projection. Small values and dense labels remain visible or explicitly reported; the model never loses them.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
The Scene retains explicit class and Style text colors; shared sketch backends
still apply their existing page-halo readability policy. When a Style chooses
opaque text ink but leaves categorical fills automatic, the shared palette
chooses fills for readable text, page visibility and distinct peers together;
it does not repair each rectangle independently. When the selected sketch
backend puts readable labels on its page-colored halo, that page is their
reading surface and the cell palette retains its visibility/separation policy.
Graphical host backend overrides remain authoritative; unpainted layout models
the nominal Style backend. The search is deterministic
and bounded. Peer separation is enforced through 24 categories; larger palettes
retain the existing best-effort linear behavior. If bounded search cannot
satisfy concrete choices, it reports a prescriptive error: choose a different
text color or an explicit fill. Authored fills remain exact,
and unresolved or translucent ink does not receive a fabricated contrast guarantee.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.

## Executable evidence

The first official treemap example is retained in treemap-demo.mmd. Proportional-area, hierarchical-containment, typed-edit and parser-oracle tests supply separate semantic and geometry evidence.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/treemap-demo.mmd --format svg --output /tmp/treemap-demo.svg
bun run bin/am.ts render docs/design/families/treemap-demo.mmd --format png --output /tmp/treemap-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Upstream #7247 improves dense-label handling, #7178 fixes class styles, and #7403 fixes dark-theme labels; these fixes are included in the pin. The trailing-whitespace proposal #8206 was closed unmerged, so accepted reader extensions must be documented explicitly. https://github.com/mermaid-js/mermaid/pull/7247

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
