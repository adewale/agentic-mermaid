# SVG semantic identity, references, and accessibility

Agentic Mermaid exposes one contract across every built-in family. Consumers should inspect these attributes instead of inferring meaning from geometry or renderer-specific CSS selectors.

## Identity

Every Scene part with source-facing semantics emits identity (source nodes,
relations, groups, participants, class/ER members, chart data points,
sections/tasks/periods/events, and titles):

- `data-id`: deterministic and unique within one SVG;
- `data-role`: a closed `SceneRole` value;
- `data-from` / `data-to`: normalized source endpoints for relations;
- authored Mermaid class tokens on `class` where that family supports classes.

Source-authored IDs win. Parts without authored IDs receive semantic IDs derived from labels, endpoints, series/category identity, and a deterministic occurrence suffix. The public Scene model carries the same information as `SvgSemanticIdentity`; the DOM attributes and typed value are generated together. Layout furniture such as grids, ticks, halos, and duplicate visual labels retains typed Scene identity but does not emit a second DOM identity.

`data-id` is source-facing identity and is intentionally **not** changed by `RenderOptions.idPrefix`.

Sankey prepares one family-owned identity plan before graphical or terminal
layout. It reserves authored node names before allocating link and title names;
structured endpoint/occurrence keys distinguish authored punctuation from
generated suffixes. Ordinary readable names stay compatible, while ambiguous
generated names receive deterministic collision suffixes. SVG semantic attributes,
graphical layout regions and terminal ownership consume the same plan.
Scene part IDs and SVG resource IDs keep their separate namespaces. Source
objects and Scene parts need not have a one-to-one correspondence, and a part
can contain several resolved primitives. Those primitives have no independent
stable IDs; their containing part provides the association. Primitives in
`scene.frame` have no containing part. See the
[shared vocabulary](./api.md#vocabulary). Existing `SceneNode` and `*Mark` type
names refer to parts. A marker decorates a path or connector at its start, end
or interior vertices; it is not another spelling for part. Resolved-scene
export separately rejects unsupported marker placement such as `marker-mid`.

XML attributes preserve authored TAB, LF and CR with numeric character
references. Attribute readers decode serialized values exactly once; typed
semantic references are never decoded or sanitized as display text. This keeps
literal entity-looking names distinct from actual whitespace. Regression checks
use a real XML DOM alongside layout and terminal identity correspondence.

XML cannot carry other C0 controls, U+FFFE/U+FFFF or lone surrogates in any
form. Display text never holds them: every output draws a control as `?` and a
noncharacter, lone surrogate or bidi embedding/override/isolate control as
U+FFFD, and terminal receipts report the replacement. A typed Scene identity
keeps such authored characters verbatim (layout JSON and Scene ids carry them);
only the emitted SVG bytes write them as the same inert characters. Two
authored ids that differ only by such a character therefore share one DOM
`data-id`. Built-in Scene ids carry authored identities and labels of any
length within the Scene text budget; only external Scene documents use the
short safe id grammar.

## Multi-diagram references

`idPrefix` namespaces local SVG `id` declarations and every supported local reference:

- `url(#…)` in markers, filters, clip paths, masks, gradients, and paints;
- `href="#…"` and `xlink:href="#…"`;
- every token in `aria-labelledby` and `aria-describedby`.

References are rewritten only when their target is declared in the same SVG. This prevents accidental rewriting of label text. Two instances rendered with distinct prefixes have no colliding declarations, while their semantic `data-id` values remain comparable. Prefixes accept ASCII letters, digits, `_`, `-`, `.`, and `:`; unsafe attribute/URL characters fail fast.

Style rules need no prefix. An inline `<style>` element applies to its whole host page, so every render scopes its own rules: the root `<svg>` carries a class `am-<hash>` derived from the finished output, and each selector in the SVG's style sheets is rewritten to match only inside that root (`.am-<hash> .xychart-bar`, `svg.am-<hash>`). Two different diagrams inlined in one page therefore keep their own paint, and identical renders share one scope harmlessly. Declarations, strings, comments, and non-selector at-rules are copied unchanged, and resvg rasterizes the scoped SVG to the same pixels as the unscoped one (`property-svg-style-scope.test.ts`; the page-level property runs in the browser lane as `svg-style-isolation-browser.test.ts`).

## Connector marker authority and attachment

`ConnectorMark.markers` is authoritative for SVG `marker-start`, `marker-mid`
and `marker-end`, marker bounds and terminal projections. The connector
constructor supplies missing SVG references and rejects extra, conflicting,
duplicate, shorthand or inline-CSS marker declarations. Matching internal
carrier attributes are checked assertions, not a fallback source of meaning.
Unknown constructor fields (including the removed `startMarker`/`endMarker`)
fail at runtime, even when TypeScript accepts an object spread. Independent
Scene admission compares actual SVG marker references with the typed markers;
the existing corpus gate exercises this across every registered family.

Attachment intent remains family-owned:

| Family / marker | Contact contract |
|---|---|
| Flowchart, State, Architecture triangular arrows | Triangle tip at the route endpoint. `tipAnchoredArrow` derives polygon, reference and start/end orientation together. |
| Class relationships | The relationship-specific tip or tangent contacts the class; diamonds and lollipops are not ordinary triangular arrows. |
| Sequence messages | Arrow tips or cross centres attach to message endpoints; these are not a universal node-surface normal constraint. |
| Gantt dependencies | Tip at the dependency route endpoint. |
| Journey baseline | Free-ending axis marker, with its existing reference offset; no node-surface contact claim. |
| ER relationships | Cardinalities are separate geometric glyphs, not SVG marker resources. |

Agreement between SVG and Scene does not prove that the family's authored
geometry is correct. Family vector/raster tests still check visible attachment,
direction, scaling and final route geometry. This contract does not require
perpendicular incidence on every surface or certify every SVG rasterizer.

The pinned resvg 2.6.2 N-API and WASM adapters do not implement SVG 2's
`auto-start-reverse`. They lower it to `auto` with a separately rotated start
resource and mirrored reference point, preserving the resource's viewBox,
clipping and marker units. Public SVG and browser Canvas retain the original
SVG 2 resources. Browser regressions check seven marker-using families in
three stroke styles, plus rotated carriers and nonzero viewBoxes; this is
bounded contact parity, not pixel identity or certification of every viewer.

Final Flowchart/State routing also removes terminal runs shorter than one pixel
along an open rectangle face when the preceding shaft already meets that face
normally. Only existing shaft segments remain, contact stays on the same face,
and route certificates are refreshed. Larger turns, corners and curved/sloped
surfaces are not flattened into a universal perpendicular-arrival rule.

### Native terminal endpoints

ASCII and Unicode do not reuse SVG coordinates or require graphical layout.
Architecture, Sequence, Flowchart, State, Class and ER declare endpoint marker
intent from their parsed family models on their native allocated ports. The
owned `TerminalDocument` carries that intent separately from painted cells.
At serialization, it checks the completed drawing for missing, extra,
displaced, wrong-kind, wrong-direction and wrong-owner markers, including
cells outside a serialized row. Directional heads must face inward relative
to their allocated face, and framed ports must lie on or immediately outside
that face of the actual native card/container bounds. Expectations and semantic markers follow offset
composition and reflection together; half/stick and hollow/filled variants
remain distinct even when ASCII uses the same character for different kinds.

ER cardinalities retain their one- or two-cell, outward-normal glyph groups;
they are not treated as inward-pointing arrows. A deliberately unroutable
Architecture relation keeps its expected heads and authored faces but records
a family projection diagnostic and an owned endpoint summary instead of
pretending those heads were drawn. Journey retains ordered scored tasks and
reports the loss of its geometric axis. Gantt retains dependencies as owned
`after`/`until` text, with a diagnostic that geometric arrows are not drawn.

Flowchart/State terminal routes use physical endpoints after RL projection,
clip container relations to the actual frame, and preserve reciprocal lanes.
Only ordinary one-way arrow relations share a bundled terminal; other marker
kinds and bidirectional relations retain independent native routes. Sequence
self-message heads both face their own lifeline. Incompatible Flowchart/State
heads reserve face capacity and separate native port slots before physical
cards are drawn, including parallel self routes. These are cell-space rules,
not a claim of SVG/terminal pixel parity or validation of arbitrary externally
supplied string renderers. Optional Scene projection receipts remain separate
graphical evidence, not the oracle for the native final-cell check.

## Relation accessibility

Typed edges, messages, and relationships emit:

```xml
<… data-role="edge" data-from="API" data-to="DB"
    role="graphics-symbol" aria-roledescription="relation"
    aria-label="API to DB: reads" … />
```

The Scene part carries `SvgSemanticAccessibility` and `SvgRelationSemantics` with the same endpoint and label values. Decorative label/halo parts do not repeat the relation ARIA node.

## Palette contract

For every concrete built-in palette, rendering deterministically raises insufficient colors toward the palette foreground:

- normal text roles: WCAG 2.x contrast **≥ 4.5:1**;
- faint informational text: **≥ 3:1**;
- relation lines and markers: **≥ 3:1** against the page background.

Colors that already pass are byte-preserved. Runtime CSS variables cannot be certified without their eventual background and therefore pass through unchanged.
