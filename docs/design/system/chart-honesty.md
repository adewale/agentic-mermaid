# Chart honesty — what every family owes its reader

> Status: **enforced** for text (H1–H4) in every registered family and every
> registered style. H5–H7 are enforced where colors, scales and styles are
> generated; the as-drawn gaps are measured and tracked (see
> [Known gaps](#known-gaps)).
>
> Origin: the [Lieflat Charts review](../../../research/lieflat-charts-learnings.md)
> found ten XY-chart defects. Each one is an instance of a principle that holds
> for any diagram, so the fixes are stated here as family-agnostic contracts,
> measured on the rendered output, and bound to the family registry so that a
> new family inherits them.

## The principles

A diagram is honest when a reader can trust what they see: the text is there
and readable, the marks that tell things apart are distinguishable, the sizes
that encode quantities are in proportion, and the output means the same thing
wherever it is placed.

| # | Principle | Measured as | Lieflat issue |
|---|---|---|---|
| H1 | **Text is legible against what is actually behind it.** | WCAG 1.4.3 contrast between the glyph ink and the pixels around the glyphs, in the rasterized output: ≥ 4.5:1, or ≥ 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold) | 5 |
| H2 | **Text stays on the canvas.** | No glyph pixel more than 0.75 user units outside the viewBox | 9 |
| H3 | **Authored text is drawn, or `verify` says it is not.** | Each authored string a sample expects appears in the drawn text, or in a `LABELS_HIDDEN` warning | 4, 6 |
| H4 | **A style changes how text looks, never what it says.** | The drawn text, read in document order and compared without case, whitespace, and wrap hyphens, is identical in every style | — |
| H5 | **Peers are distinguishable as drawn.** | ΔE_OK ≥ 0.10 between peer colors and a visibility floor against the page | 3 |
| H6 | **Quantities are drawn in proportion.** | Bar lengths start at zero; value-encoding sizes are not changed by a style | 1, 7, 8 |
| H7 | **The output is self-contained, and config is honest.** | An SVG's CSS applies only to itself; accepted config that has no effect is reported | 2, 10 |

H4 is the one the Lieflat review did not name. It exists because a style is a
lens, not an editor. A look may uppercase a title or wrap a label at a
different point. It must not drop, add, or reorder what the reader reads.

## How text is measured

[`src/__tests__/helpers/rendered-text.ts`](../../../src/__tests__/helpers/rendered-text.ts)
measures every `<text>` the way a reader sees it:

- **The raster.** resvg's WebAssembly build draws the SVG at 2 device pixels
  per user unit with the bundled fonts, on a canvas enlarged by 48 units on
  every side so glyphs drawn off the canvas still land somewhere countable.
- **Glyph ownership.** A second, aliased raster fills each text with its own
  id color and hides every other mark. Aliasing matters: an antialiased edge
  shared by two labels would blend two id colors into a third label's id.
- **Ink and surround.** The ink is the most common color among a text's glyph
  pixels, since fully covered pixels all carry it. The surround is every pixel
  within one user unit of the glyphs, past a one-pixel fringe. Contrast is
  taken at the surround's 10th percentile. A tick passing close to a label
  does not fail it; a surface under it does.

The oracle is the rasterizer rather than the layout's own text metrics on
purpose. A check that measured text with the same estimate the layout used
could never disagree with the layout.

## What satisfies the principles

Families meet the contract through shared mechanisms, not per-family
patches. A new family should use them:

- **Theme tones legible on every surface the theme paints.** `resolveColors`
  ([`src/theme.ts`](../../../src/theme.ts)) derives text, secondary text, and
  muted text that clear WCAG AA on the page, node fill, group header, and key
  badge together.
- **Ink chosen against the fill it sits on.** `legibleInk`
  ([`src/shared/color-math.ts`](../../../src/shared/color-math.ts)) and
  `inkOnAuthoredFill` ([`src/color-resolver.ts`](../../../src/color-resolver.ts))
  re-ink text on authored and data fills, composited over the page. An
  authored text color always wins; `verify` reports it as `LOW_CONTRAST` when
  it fails.
- **Halos for text over lines, bands, and data.** A label that crosses other
  marks carries a halo in the surface beneath it. Examples: sankey labels over
  ribbons, XY data labels, quadrant point labels on the dividers, sequence
  labels that straddle a box edge, and fragment section labels. The sketch
  looks give every role with the `textHalo` trait a page-colored halo
  ([`src/scene/rough-backend.ts`](../../../src/scene/rough-backend.ts)).
- **Room for titles.** Every family draws the frontmatter `title:`.
  `withFrontmatterTitle` ([`src/mermaid-source.ts`](../../../src/mermaid-source.ts))
  hands it to the family, and `diagramTitleBand` / `diagramTitleMark`
  ([`src/styles.ts`](../../../src/styles.ts)) give families without a native
  title a band above the diagram. Canvases grow to hold titles, or wrap them,
  and group and namespace titles size or wrap their containers.
- **Measurement that follows the style.** Layouts measure text with the
  style's font size, weight, letter spacing, and text transform, so a style
  that uppercases or enlarges text also enlarges the room reserved for it.
- **Omissions are reported.** When a layout leaves out text for want of room,
  it records what it dropped, and `verify` names it as `LABELS_HIDDEN`: XY
  axis categories and data labels, and quadrant point labels.

## How a family is bound

Nothing in this contract depends on remembering to add a family to a list:

1. **Stress samples are required by the type system.** `HONESTY_SAMPLES` in
   [`helpers/chart-honesty.ts`](../../../src/__tests__/helpers/chart-honesty.ts)
   is a `Record<DiagramKind, …>`. A new family does not typecheck until it
   brings samples: long titles, long group titles, authored fills, labels on
   data marks, text declared after first use, and a frontmatter title.
2. **Every family, every style, measured as drawn.**
   `chart-honesty-text-<part>.test.ts` splits the registry `HONESTY_PARTS` ways
   by position. Each family's corpus is its descriptor example, its editor
   example, its Section B census fixture, and its stress samples, rendered in
   the default renderer and in every registered style.
3. **Generated diagrams.**
   [`property-chart-honesty.test.ts`](../../../src/__tests__/property-chart-honesty.test.ts)
   builds each family at random sizes with its metamorphic generator
   (required for every family by citizenship), adds a random frontmatter
   title of 1 to 14 words, and checks the result in a random style.
4. **Citizenship.** The `chartHonesty` surface of the
   [citizenship matrix](../../contributing/diagram-family-citizenship.md)
   must cite the partition file that checks the family. The citizenship test
   checks that the partitions cover the registry exactly, and that every
   family has a sample whose frontmatter title it must draw.

H5–H7 are enforced where the colors, scales, and styles are generated:

- H5: [`property-categorical-palette-contract`](../../../src/__tests__/property-categorical-palette-contract.test.ts)
  holds every peer pair ≥ 0.10 apart and visible on the page, for any accent,
  background, and count. [`scene-effective-paint-contract`](../../../src/__tests__/scene-effective-paint-contract.test.ts)
  re-checks translucent connectors where their opacity is applied.
- H6: [`property-xychart-bar-encoding`](../../../src/__tests__/property-xychart-bar-encoding.test.ts)
  holds bars to a shared zero baseline in SVG and ASCII.
  [`property-xychart-verify-lints`](../../../src/__tests__/property-xychart-verify-lints.test.ts)
  holds `BAR_RANGE_EXCLUDES_ZERO` to fire exactly when an authored range
  excludes zero. Value-encoding strokes (`ConnectorStroke.encodesValue`, the
  sankey ribbons) keep their width in the sketch looks.
- H7: [`property-svg-style-scope`](../../../src/__tests__/property-svg-style-scope.test.ts)
  scopes every family's CSS in every style.
  [`upstream-config-key-diagnostics`](../../../src/__tests__/upstream-config-key-diagnostics.test.ts)
  keeps official keys from being called unknown.

## Reproducing a failure

Each violation is one line naming the family, the sample, the style, the
principle, the text, and what was measured:

```text
sequence / boxes, late alias and frontmatter title [accessible-high-contrast] legible: "hello" #050505 on #000080 is 1.27:1, below 4.5:1
```

Run the partition that holds the family, for example
`bun test src/__tests__/chart-honesty-text-3.test.ts`. A property failure
prints its fast-check seed; `AM_FC_SEED=<seed>` reproduces it (see
[`docs/testing-strategy.md`](../../testing-strategy.md) §4).

## Known gaps

These were measured and are tracked in [`TODO.md`](../../../TODO.md):

- **H5 as drawn (BUILD-30).** A census keyed by scene categories, over every
  family's honesty corpus in every style, found three cases where drawn
  colors compress below the palette's separation:
  - The watercolor wash glazes pie slices at 30%, which leaves ΔE_OK 0.03
    between slices, while their legend keys stay opaque.
  - Journey actor dots under watercolor are 0.049 apart.
  - Radar legend keys are drawn at the curve opacity with a neutral border,
    0.06–0.09 apart in most palettes. The curves themselves separate by their
    opaque outlines.

  The next step is an as-drawn oracle keyed by legend categories: keys must
  be distinguishable, and each key must match the marks it names.
- **H6 for radar (BUILD-31).** An authored `min` above zero draws radii
  proportional to `value − min`, and out-of-range values are clamped, with no
  report.
- **Edges over group titles.** Edges are drawn above groups, so an edge can
  cross a group's header text. This predates the contract and belongs to
  layout, not paint.
