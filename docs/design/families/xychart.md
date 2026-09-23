# XY Chart (xychart / xychart-beta) — Design Notes

## Overview

The xychart implementation follows the same parse -> layout -> render pipeline used elsewhere in Agentic Mermaid, with Mermaid's stable `xychart` syntax treated as primary and `xychart-beta` preserved for backward compatibility.

Supported chart forms:

- vertical and horizontal charts
- bar, line, and mixed-series plots
- categorical and numeric x-axes
- semicolon-separated Mermaid statements
- Mermaid accessibility directives (`accTitle` / `accDescr`)
- Mermaid YAML frontmatter and `init` / `initialize` directives, including Mermaid-style loose object literals, for the current documented `xyChart` config surface
- SVG, PNG, and ASCII output routed through the public entry points

## Pipeline

### Source preprocessing

`src/mermaid-source.ts` strips comments, parses Mermaid YAML frontmatter plus `init` / `initialize` directives, and produces trimmed diagram lines before xychart parsing begins.

The preprocessing layer now intentionally lives in one shared place so future Mermaid-surface additions do not have to be reimplemented separately in SVG and ASCII entry points.

### Parser

`src/xychart/parser.ts` accepts:

- `xychart` and `xychart-beta`
- `horizontal` on the header
- semicolon-separated one-line Mermaid statements
- `accTitle` and single-line or block `accDescr`
- quoted or unquoted titles where Mermaid allows them
- categorical labels with quoting preserved and normalized
- optional series labels on `bar` and `line`
- numeric axis ranges
- Mermaid frontmatter/directives for the current chart, responsive sizing, accessibility, and theme overrides

The parser keeps unknown Mermaid config fields out of the typed result instead of trying to guess their meaning.

### Layout

`src/xychart/layout.ts` treats Mermaid `xyChart.width` and `height` as total chart size, then fits title and axis furniture into the remaining reserved space before computing the plot area.

Key layout choices:

- vertical charts use a left numeric axis and bottom categorical or numeric x-axis
- horizontal charts place the numeric axis at the top and category axis on the left, matching Mermaid more closely
- ticks use a simple linear tick generator for readable numeric steps
- plot geometry stays within the declared chart box
- legend-worthy charts get a right-side legend column whose space is reserved
  before the plot expands into the remaining width (see Legend below)

### Legend

The earlier stance ("legends are omitted to keep mixed charts visually quiet")
is obsolete: upstream Mermaid shipped xychart legends in 2026-06 (PR #7724,
closing #5292), so a legend is now parity, not noise. The contract:

- a chart is **legend-worthy** when it has more than one series, or when any
  series carries an explicit name (`bar "Revenue" [...]` / `line avg [...]`) —
  naming a single series opts it into the legend, matching upstream
- every series of a legend-worthy chart gets one swatch+label entry in source
  order; **unnamed series get deterministic `Bar N` / `Line N` defaults**,
  numbered within their type. This is a deliberate divergence from upstream,
  which omits unnamed series from the legend: the ASCII renderer had already
  established the `Bar N` / `Line N` naming, and dropping entries would leave
  multi-series colors ambiguous
- swatches are theme-aware and reuse the exact per-series colors of the plot
  marks (`--xychart-color-N`): a rounded rect for bar series, a stroke sample
  plus center dot for line series
- the SVG legend sits in a right-side column, top-aligned with the plot area,
  and is **contained by construction**: layout reserves its measured width
  before sizing the plot, and drops the whole column (never clips it) when the
  width budget or the plot band cannot fit it. The ASCII legend keeps its
  established top row placement
- naming and order come from one shared builder (`src/xychart/legend.ts`)
  consumed by both the SVG layout and the ASCII renderer, and a consistency
  test (`xychart-legend.test.ts`) pins the agreement between the two surfaces

Config surface (mirroring upstream's contract): `xyChart.showLegend`
(default `true`), `xyChart.legendFontSize` (default 14),
`xyChart.legendPadding` (default 5), and
`themeVariables.xyChart.legendTextColor`.

### Renderer

`src/xychart/renderer.ts` and `src/ascii/xychart.ts` share the same parsed chart semantics. PNG output is produced by rasterizing the SVG renderer output.

Current SVG rendering decisions:

- explicit axis lines and tick marks by default
- subtle grid lines behind the plot area
- straight line segments rather than spline interpolation
- line dots only for interactive output
- bars encode value as length from zero: every bar grows from zero clamped
  into the value range (the axis end nearest zero when an authored range
  excludes it) toward its own sign, and its value end clamps into the range
  too, so a bar never leaves the plot. The automatic range of a chart with a
  bar series always includes zero. The terminal renderer uses the same
  baseline rule (`barBaselineValue` in `src/xychart/axis-utils.ts`)
- `showDataLabel` applies to bars only, matching Mermaid behavior. All labels
  share one font size fitted to the bars' cross-axis room; each bar then places
  its own label inside its value end, or beyond it within the plot when the bar
  is too short (`showDataLabelOutsideBar: true` prefers beyond). A bar with no
  room for either keeps its bar and loses only its own label, which
  `verify` reports (`LABELS_HIDDEN`, `target: "data-labels"`)
- labels inside a bar use the black or white ink with the higher WCAG contrast
  against that bar's fill (at least 4.58:1 for any opaque fill); labels beyond
  a bar use the page text color. `themeVariables.xyChart.dataLabelColor`
  overrides both
- value-axis labels are centered on their ticks, so layout reserves the half
  label that the end ticks reach beyond the plot (top of an untitled vertical
  chart, left and right ends of a horizontal chart's top axis)
- a vertical chart thins its category tick labels when they would overlap;
  `verify` lists the authored names it does not draw (`LABELS_HIDDEN`,
  `target: "x-axis"`), as it does when a horizontal chart drops a category
  axis whose widest name does not fit. `BAR_RANGE_EXCLUDES_ZERO` flags an
  authored bar range that excludes zero
- `useMaxWidth` / `useWidth` control responsive root SVG sizing
- `themeCSS` remains accounted for by the parser but is diagnosed at the public
  render boundary; raw selectors can escape an imported SVG, so authors use a
  declarative `StyleSpec` instead
- series colors come from the shared theme accent unless Mermaid frontmatter provides `plotColorPalette`

## Compatibility Notes

Supported Mermaid compatibility surface is documented in [README.md](../../../README.md).

Intentional gap today:

- visual parity aims to stay close to Mermaid, but is not byte-for-byte identical

## Agent Surface

The structured body (`src/agent/xychart-body.ts`) models the header
orientation, title, axes, and series, and its op menu includes two
whole-chart/point-level ops beyond the series-level set:

- `set_orientation {horizontal: boolean}` — flips the `xychart-beta
  horizontal` header suffix; `false` drops the suffix (vertical is the
  serialized default)
- `set_data_point {seriesIndex, index, value}` — edits a single value in
  place with prescriptive index validation (`SERIES_NOT_FOUND` /
  `POINT_NOT_FOUND` errors name the valid ranges) and rejects non-finite
  values so the serializer can never emit NaN

## Verification Expectations

XY chart changes should keep the following layers covered:

- parser tests for stable/beta headers, quoted labels, comments, and frontmatter
- layout tests for chart bounds, axis placement, and visibility rules
- renderer tests for semantic classes, escaping, and theme token usage
- legend tests for presence rules, containment, config, and the SVG/ASCII
  naming-and-order consistency guard (`xychart-legend.test.ts`)
- integration tests for full parse -> layout -> render behavior
- ASCII tests for unicode and ASCII-safe rendering
- `scripts/site/samples-data.ts` coverage so the visual samples page exercises the feature
