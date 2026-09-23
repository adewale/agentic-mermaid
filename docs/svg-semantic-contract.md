# SVG semantic identity, references, and accessibility

Agentic Mermaid exposes one contract across every built-in family. Consumers should inspect these attributes instead of inferring meaning from geometry or renderer-specific CSS selectors.

## Identity

Every source-semantic Scene mark emits (nodes, relations, groups, participants,
class/ER members, chart data marks, sections/tasks/periods/events, and titles):

- `data-id`: deterministic and unique within one SVG;
- `data-role`: a closed `SceneRole` value;
- `data-from` / `data-to`: normalized source endpoints for relations;
- authored Mermaid class tokens on `class` where that family supports classes.

Source-authored IDs win. Anonymous marks receive semantic IDs derived from labels, endpoints, series/category identity, and a deterministic occurrence suffix. The public Scene model carries the same information as `SvgSemanticIdentity`; the DOM attributes and typed value are generated together. Layout furniture such as grids, ticks, halos, and duplicate visual labels retains typed Scene identity but does not emit a second DOM identity.

`data-id` is source-facing identity and is intentionally **not** changed by `RenderOptions.idPrefix`.

## Multi-diagram references

`idPrefix` namespaces local SVG `id` declarations and every supported local reference:

- `url(#…)` in markers, filters, clip paths, masks, gradients, and paints;
- `href="#…"` and `xlink:href="#…"`;
- every token in `aria-labelledby` and `aria-describedby`.

References are rewritten only when their target is declared in the same SVG. This prevents accidental rewriting of label text. Two instances rendered with distinct prefixes have no colliding declarations, while their semantic `data-id` values remain comparable. Prefixes accept ASCII letters, digits, `_`, `-`, `.`, and `:`; unsafe attribute/URL characters fail fast.

Style rules need no prefix. An inline `<style>` element applies to its whole host page, so every render scopes its own rules: the root `<svg>` carries a class `am-<hash>` derived from the finished output, and each selector in the SVG's style sheets is rewritten to match only inside that root (`.am-<hash> .xychart-bar`, `svg.am-<hash>`). Two different diagrams inlined in one page therefore keep their own paint, and identical renders share one scope harmlessly. Declarations, strings, comments, and non-selector at-rules are copied unchanged, and resvg rasterizes the scoped SVG to the same pixels as the unscoped one (`property-svg-style-scope.test.ts`; the page-level property runs in the browser lane as `svg-style-isolation-browser.test.ts`).

## Relation accessibility

Typed edges, messages, and relationships emit:

```xml
<… data-role="edge" data-from="API" data-to="DB"
    role="graphics-symbol" aria-roledescription="relation"
    aria-label="API to DB: reads" … />
```

The Scene node carries `SvgSemanticAccessibility` and `SvgRelationSemantics` with the same endpoint and label values. Decorative label/halo marks do not repeat the relation ARIA node.

## Palette contract

For every concrete built-in palette, rendering deterministically raises insufficient colors toward the palette foreground:

- normal text roles: WCAG 2.x contrast **≥ 4.5:1**;
- faint informational text: **≥ 3:1**;
- relation lines and markers: **≥ 3:1** against the page background.

Colors that already pass are byte-preserved. Runtime CSS variables cannot be certified without their eventual background and therefore pass through unchanged.
