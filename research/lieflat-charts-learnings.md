# Lieflat Charts: learnings for Agentic Mermaid

**Status.** External-survey research note, written 2026-09-23 against Lieflat
Charts commit
[`4eef5ce`](https://github.com/larashero3-dotcom/lieflat-charts/commit/4eef5ce00d0907a03b8eff42578b5a04942915e9)
(2026-08-19). Every measurement of this repository was taken at `c349dac` and
can be reproduced from the sources under [Reproduction](#reproduction); the
production website was measured the same day. This is analysis, not backlog:
any follow-up promoted from here gets its own `TODO.md` entry first.

The [Flint note](./flint-chart-deep-dive.md) supplied the method: name a
bounded perceptual failure, measure it, and return the evidence. Lieflat
supplies a practitioner's list of chart-honesty rules and treats a page of
charts, not a single chart, as the unit it checks. Applying both to this
renderer found ten issues, listed under [Issues](#issues). In every case
`verify` reported `ok`. All ten are now fixed; [Resolution](#resolution)
names each fix and the property-based test that pins it. The issue sections
below describe the code as it was measured at `c349dac`.

## What Lieflat Charts is

- An Agent Skill for moxt.ai, Claude Code, and Codex. It turns a user's data
  into single-file HTML charts, or into one of twelve bilingual report pages
  when the user explicitly asks for a report. It ships no chart library of its
  own; each chart is hand-written SVG, Chart.js, or ECharts code sharing one
  small token file. Generation is template-first: the agent finds one of 64
  reference implementations, indexed in `catalog.md` by data shape, occasion,
  and expected reading time, and adapts that implementation's code.
- Reading speed organizes the catalog. "Lupi" charts give each record one
  hairline mark for readers who will spend 30 seconds or more. "Glance" charts
  pre-aggregate into bold shapes for readers who will spend under 10. The
  default order is Lupi Editorial, then Lupi Basics, then Glance, and moving
  down the order requires a written reason.
- One token file, `mono-tokens.js`, fixes a paper-and-charcoal gray ladder
  under the rule "lightness is data: most important = darkest". Each of three
  color presets in `color-presets.js` declares a `logic`. Porcelain is
  `'ordinal'` (lightness encodes value), palm is `'categorical'` (hue encodes
  category), and wire is `'mono+accent'` (gray carries the data and one orange
  element carries the focus). Each preset states its capacity, and palm
  annotates its own closest pair: amber and olive, close in lightness, must
  not be used as equal peers.
- Enforcement is prose plus a validator. `SKILL.md` (about 37 KB, in Chinese)
  holds hard rules, a "when to say no" list, and a 14-item self-check the
  agent runs before delivery. `scripts/validate.mjs` checks required files,
  duplicate ids within a page, that every color literal in a color template
  belongs to its preset, that no file calls `Math.random()`, and that key
  policy sentences still exist. A Playwright smoke test exists; there is no CI.
- The license is PolyForm Noncommercial 1.0.0. This note takes ideas and
  published conventions only. No code, token values, or palettes are copied
  into this MIT project.

## What it validates (independent convergence)

1. **Decoration never moves data.** Lieflat draws all demo jitter from a
   deterministic `rnd(i, k)` and turns its decorative randomness off where
   shares must be exact. Here `seed` re-rolls ink, never layout. Measured with
   bars at 100, 101, 102, and 103 under `excalidraw` and `watercolor`, 40 seeds
   each: drawn top edges stay within 1.07 px and 1.37 px of the true value (at
   most 0.32 data units), and none of 240 adjacent pairs is drawn in the wrong
   order.
2. **Labels are chosen by importance under a spacing floor.** Lieflat's
   barcode chart keeps the "top-3 peaks, kept at least 6 days apart so labels
   never collide". Pie admits on-slice labels largest-first and drops any that
   would overlap ([pie design](../docs/design/families/pie.md)).
3. **Text has a size floor; it is not shrunk to fit.** Lieflat's floor is
   6.5 px (5.5 px on full-width charts), and anything smaller moves to hover.
   Here xychart data labels stop at 8 px, and PNG output reports
   `BELOW_READABLE_SIZE` (lesson 36 in
   [lessons learned](../docs/project/lessons-learned.md)).
4. **Emphasis leaves geometry alone, and there is one focus.** Lieflat's wire
   preset gives the accent to exactly one element. `highlightSlice` emphasizes
   a wedge without moving it, and the Brand `accent-area` constraint bounds
   how much of a diagram the accent may cover.
5. **Ordered values go on position.** Journey places scores on a baseline with
   a single fill, the channel Lieflat reserves for ordered data.
6. **Text drawn on a data mark needs its own contrast.** Every Lieflat preset
   carries a `HALO` color for `paint-order` halos. Pie picks label ink per wedge
   with `contrastTextColor`, and sankey's `outlined` labels use a halo. Issue 5
   below is where this is not applied.

## Issues

Severity follows the spirit of the rubric in
[#248](https://github.com/adewale/agentic-mermaid/issues/248): **high** means
the rendered output contradicts the data or corrupts another diagram;
**medium** means the chart loses identity or readability, or an authored
option silently does nothing; **low** means a bounded defect or a missing lint.

| # | Severity | Issue | Where |
|---:|---|---|---|
| 1 | High | Signed bars grow from the axis floor in SVG, while ASCII grows them from zero | xychart SVG and PNG |
| 2 | High | Inline SVG styles repaint other diagrams on the same page, including the production Examples page | SVG embedding, all families |
| 3 | Medium | Peer colors collide for two to six series in every built-in style | xychart, radar, pie, sankey, gitgraph, mindmap |
| 4 | Medium | One short bar removes every data label | xychart |
| 5 | Medium | Data labels inside bars miss WCAG 4.5:1 in every built-in style | xychart |
| 6 | Medium | Category axis labels are blanked to avoid overlap, without a warning | xychart |
| 7 | Medium | The automatic range for bar charts excludes zero | xychart SVG and ASCII |
| 8 | Low | An authored bar range that excludes zero passes `verify` silently | xychart |
| 9 | Layout reserves the half label that end ticks reach beyond the plot. The same containment rule covers the rest of the chart's text: the last category row's descent in a short horizontal chart, the x-axis title's line box, and rotated axis titles longer than the room beside the plot | [`property-xychart-text-containment`](../src/__tests__/property-xychart-text-containment.test.ts): resvg's glyph bounding box of every generated chart, with titles and axis titles, stays inside the viewBox (default style, verified across 16 seeds); the same property found that bars beyond an authored range left the canvas (fixed under 1) |
| 10 | Low | `INEFFECTIVE_CONFIG` misdescribes official xychart keys | xychart config |

### 1. Signed bars grow from the axis floor in SVG

**Lieflat's rule.** Bars never break the axis, because a bar's contract is
length proportional to value. Its diverging-bar template draws an explicit
zero rule and grows signed bars away from it.

**What renders.** `layoutVerticalBars` and `layoutHorizontalBars` receive
`yRange.min` as their baseline ([`xychart/layout.ts`](../src/xychart/layout.ts)
lines 158 and 248). For bars −10, 20, −5, 25, every SVG bar grows upward (or
rightward) from the axis floor, so −10 renders shorter than −5: 36 px against
87 px vertically, 54 px against 131 px horizontally. The ASCII projection of
the same source hangs negatives from zero (`Math.max(0, yRange.min)` in
[`ascii/xychart.ts`](../src/ascii/xychart.ts) lines 261 and 455), so the two
outputs disagree about the sign of the data. That breaks lesson 8, "final
pixels and public projections must agree". `describe` reports the negative
values, and `verify` returns `ok`.

Upstream `mermaid@11.16.0` also draws bars from the plot floor
([`barPlot.ts` line 52](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagrams/xychart/chartBuilder/components/plot/barPlot.ts#L52)),
so the SVG behavior is inherited parity; the ASCII projection already
diverges from it.

**Smallest fix.** Give both projections one baseline rule: zero, clamped into
the axis range. The SVG layout helpers already accept any baseline and grow
bars in either direction; ASCII's `Math.max(0, min)` also needs the upper
clamp for ranges that are entirely negative.

### 2. Inline SVG styles repaint other diagrams on the same page

**What renders.** Every rendered SVG carries unscoped `<style>` rules: family
classes such as `.xychart-color-0 { … }` and a bare `svg { … }` block of
derived variables. When two diagrams share a document, the later rule wins
for both. `idPrefix`, the documented option for
[multi-diagram pages](../docs/svg-semantic-contract.md), namespaces ids and
references only. A minimal case: a default xychart and a `dracula` xychart on
one page; the first chart's line computes to Dracula's `#bd93f9` although its
own style says `#3b82f6`.

**On the production site.** `agentic-mermaid.dev/examples/` inlines 15
default-theme diagrams, and its loader inserts the style-and-palette gallery
into the same document (`content.replaceChildren`). Reconstructed from the
production page and fragment bytes, loading the gallery repaints 8 of the 15
main-page diagrams: the timeline, journey, architecture, xychart, pie,
quadrant, gantt, and radar examples. The xychart's grid lines turn from
`rgb(225, 225, 225)` to `rgb(39, 39, 42)`, and the architecture example's group
frame turns from near-white to dark blue, `rgb(28, 74, 120)`. The gallery
diagrams themselves render as they would alone (0 of 785 elements differ),
because each family appears only once among them.

Upstream `mermaid@11.16.0` namespaces every rule under the SVG's id with
stylis (`compileCSS` in
[`mermaidAPI.ts`](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/mermaidAPI.ts#L219)).
Lieflat's validator makes the same point from the other side: it treats the
page as the unit and rejects duplicate ids across the charts on it.

**Smallest fix.** Scope emitted rules to the root element's id, which every
render already has, including the `svg` variable block.

### 3. Peer colors collide for two to six series

**Lieflat's rule.** Choose a palette's logic from the data's level of
measurement: a lightness ramp for ordered values, distinct hues for unordered
categories, and neutrals plus one accent for a single focus. State the
capacity, and never use two colors of similar lightness as equal peers.

**What renders.**
[`categoricalPalette()`](../src/shared/categorical-palette.ts) serves every
count up to `MONO_LADDER_MAX = 6` from the legacy `getSeriesColor` ladder: the
accent, followed by HSL tiers that alternate darker and lighter with a small
hue drift. The ladder is not monotone (for the default accent, OKLCH lightness
runs 0.62, 0.47, 0.62, 0.41, 0.70, 0.45), so it cannot express order. It also
stays inside one hue band (224° to 283° for the default accent), so it
separates unordered peers poorly. Rendered xychart series colors (pie slices
are identical) across the default style and the 20 built-in palettes:

| Series | Styles with a pair below ΔE_OK 0.06 | Below 0.10 | Worst pair |
|---:|---:|---:|---|
| 2 | 6 / 21 | 9 / 21 | 0.020 (`tokyo-night-light`) |
| 3 | 8 / 21 | 13 / 21 | 0.020 (`tokyo-night-light`) |
| 4 | 11 / 21 | 18 / 21 | 0.020 (`tokyo-night-light`) |
| 5 | 11 / 21 | 18 / 21 | 0.020 (`tokyo-night-light`) |
| 6 | 21 / 21 | 21 / 21 | 0.012 (`salmon`) |
| 7 | 0 / 21 | 0 / 21 | 0.106 (`tufte-dark`) |
| 8 | 0 / 21 | 0 / 21 | 0.105 (`solarized-dark`) |

The 0.06 column is the "distinguishable" floor in
[`pie-elevation.test.ts`](../src/__tests__/pie-elevation.test.ts); 0.10 is the
floor the path for seven or more colors guarantees. In every built-in style, a
six-series chart is harder to read than a seven-series one. On the default
style, a three-series line chart paints North `#3b82f6` and West `#5f79f2` at
1.04:1 (ΔE_OK 0.037) on 3 px strokes; on `tokyo-night-light`, a two-series
chart paints `#34548a` and `#285a8a` at 1.05:1 (ΔE_OK 0.020).

Exposure differs by family. For xychart series and radar curves, the legend
swatch is the only link from a name to its marks. Pie slices also carry
percentages, and sankey nodes, gitgraph branches, and mindmap branches carry
text labels, so for them color is a secondary cue. All six render the same
colliding default pair. Lieflat's `INK_BOOST` rule, which thickens colored
hairlines 1.8×, exists because thin colored strokes are harder to tell apart
than filled areas.

**Why the tests pass.** The separation floors are asserted only at seven
colors and above (7, 8, 12, 15, and 24, in `pie-elevation.test.ts` and
[`categorical-palette-rollout.test.ts`](../src/__tests__/categorical-palette-rollout.test.ts)).
The range up to six is pinned by bytes, and the consuming families keep six as
an explicit compatibility boundary, so the pins preserve the collisions. The
module header's premise, that the ladder degenerates only past six, is
contradicted by the table.

**Smallest fix.** Point the existing separation test at counts 2 to 6 over
every built-in palette; it fails today. There are two ways to make it pass,
and both change goldens for charts with two to six series:

- run the existing `enforceMinDeltaE` repair over the ladder, which keeps the
  ladder's look wherever it already separates; or
- adopt Lieflat's split: unordered peers get distinct hues at every count, and
  a monotone single-hue ramp is kept for ordered encodings. Journey's actor
  dots are the precedent: a golden-angle hue palette at constant lightness for
  up to six actors (`legacyActorPalette` in
  [`journey/renderer.ts`](../src/journey/renderer.ts)), which measures a
  minimum ΔE_OK of 0.101 at five colors where the ladder measures 0.037.

Choosing between them is an aesthetic call for the owner.

### 4. One short bar removes every data label

**Lieflat's rule.** Information that cannot fit at the size floor moves to
hover instead of being shrunk or dropped.

**What renders.** `buildBarDataLabels`
([`xychart/renderer.ts`](../src/xychart/renderer.ts) from line 626) gives every
label one shared font size, the smallest size that fits across all bars, and
draws nothing if that falls below 8 px (line 654). With `showDataLabel: true`,
bars 100, 90, 40 get three labels, but bars 100, 90, 2 get none: the one short
bar removes the other two. Twenty-four daily bars with five-digit values also
render zero labels. The authored option silently does nothing, and `verify`
reports nothing.

**Smallest fix.** Label the bars that can hold a label, or place labels above
the bars as upstream's `showDataLabelOutsideBar` does, and report suppressed
labels; `INEFFECTIVE_CONFIG` already exists for configuration with no effect.

### 5. Data labels inside bars miss WCAG 4.5:1

**Lieflat's rule.** Labels drawn over data get a `paint-order` halo in the
page color (every preset defines `HALO`), so they read on any fill.

**What renders.** Data labels sit inside the top of each bar in the global
text color (`var(--_text)`) rather than a color chosen against that bar. In a
three-series chart, every one of the 21 styles has a series whose labels fall
below WCAG 4.5:1: 2.17:1 on the default style, 1.19:1 on `tokyo-night`, and
1.03:1 on `solarized-light`. The
[palette contract](../docs/svg-semantic-contract.md) certifies text roles
against the page background, but a data label's backdrop is its bar. The
opt-in Brand `contrast` constraint returns "unmeasurable" on this chart rather
than a ratio. Upstream's own remedies, `showDataLabelOutsideBar` and the theme
variable `dataLabelColor`, are among the xychart settings #248 lists as
byte-ineffective, so an author cannot fix it either.

**Smallest fix.** Reuse pie's per-wedge `contrastTextColor(fill)`
([`pie/renderer.ts`](../src/pie/renderer.ts) line 217), or the `label.halo`
the Scene IR already carries ([`scene/ir.ts`](../src/scene/ir.ts) line 256),
which only sankey's `outlined` labels use today.

### 6. Category axis labels are blanked without a warning

**Lieflat's rule.** A category label is an identity. Cramped category axes
are reserved for names of about four characters or short abbreviations; long
names move to a horizontal layout where each name gets a full row.

**What renders.** `buildBottomAxisTicks` keeps every k-th label to prevent
overlap ([`xychart/layout.ts`](../src/xychart/layout.ts) lines 418–430, from
the 2026-07 overlap audit), on numeric and categorical axes alike. Eight team
names at the default width produce eight label elements, four of them empty:
Developer Experience, Identity and Access, Data Engineering, and Growth
Experiments have bars but no names. `verify.layout` and `describe` both list
all eight, so an agent that verifies and describes the chart cannot see the
loss, which is the kind of invisible failure lesson 36 describes. The same
source rendered `horizontal` shows all eight names. Upstream's `labelRotation`
is also byte-ineffective here (#248).

**Smallest fix.** Keep thinning on numeric axes, where ticks can be
interpolated. On a categorical axis, report it: a Tier 3 warning that names
the blank categories and the existing typed remedy,
`set_orientation {horizontal: true}`.

### 7. The automatic range for bar charts excludes zero

**What renders.** When the author gives no range, the parser pads the data
minimum by 10% of the span and floors it to zero only when the minimum lies
within half a span of zero ([`xychart/parser.ts`](../src/xychart/parser.ts)
lines 132–143). For bars 52, 58, 61, and 66, heights are 36, 189, 266, and
393 px: Enterprise reads as 10.9 times Basic, while the data ratio is 1.27, a
Tufte lie factor of about 37. SVG and ASCII agree here.

Upstream auto-ranges to exactly the data minimum and maximum
([`xychartDb.ts` line 120](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagrams/xychart/xychartDb.ts#L120)),
so its smallest bar has zero height; the padding heuristic is already our own
divergence. Chart grammars go the other way: Vega-Lite's
[`zero`](https://vega.github.io/vega-lite/docs/scale.html) is "true for x and y
channels if the quantitative field is not binned and no custom domain is
provided."

**Smallest fix.** Include zero in the automatic range for charts with bar
series. Charts with only line series keep their current range.

### 8. An authored bar range that excludes zero passes silently

An authored `y-axis 45 --> 75` with bars 50, 60, and 70 renders heights 72,
215, and 358 px, a lie factor of about 10. The author asked for that range,
so it should render as written, but `verify` could say what it costs. The
parser already records `rangeAuthored`, so a Tier 3 lint can report the
implied lie factor.

### 9. Untitled charts clip their outermost value-axis label

Without a title, the top y-axis label "100" sits at `y="0"` with
`dominant-baseline="middle"`; its bounding box spans y −9 to 7, so 9 of its
16 px fall outside the viewBox. A horizontal chart's last value label spans x
689.9 to 710.1 on a 700-wide viewBox. `verify` returns `ok`: `OFF_CANVAS`
catches a bar below the axis minimum but not an axis label.

### 10. `INEFFECTIVE_CONFIG` misdescribes official xychart keys

The pinned upstream manifest lists `xyChart.showDataLabelOutsideBar` and
`xyChart.xAxis.labelRotation`. The warning calls the first "unknown" and
tells the author to "check the spelling", and says the second "must be a
documented axis-config field". The theme variable `dataLabelColor` gets no
warning at all, and the SVG is byte-identical with or without all three.
Wiring these keys is already part of #248's config-effect matrix. The wording
is a separate defect, because it sends an agent to fix a spelling that is
already correct.

## Resolution

All ten issues are fixed on the branch that carries this note. Each fix is
verified by a property-based test (fast-check, seed pinned by the test
preload) that states the contract against rendered output rather than against
the code that produces it. Unless the table says otherwise, the property was
run against the unfixed code and fails there, and passes with the fix.

| # | Fix | Property that pins it |
|---:|---|---|
| 1 | One baseline rule for SVG and ASCII: bars grow from zero clamped into the axis range, and their value end clamps too, so a bar never leaves the plot | [`property-xychart-bar-encoding`](../src/__tests__/property-xychart-bar-encoding.test.ts): shared baseline, length proportional to distance from it, sign agreement between SVG and ASCII |
| 2 | Every SVG scopes its own `<style>` rules to a root class derived from the finished output ([`svg-style-scope.ts`](../src/svg-style-scope.ts)) | [`property-svg-style-scope`](../src/__tests__/property-svg-style-scope.test.ts): the CSS rewrite matches a stylesheet model exactly; every render in every family and style is fully scoped; resvg pixels are unchanged. The page property runs in Chromium: [`svg-style-isolation-browser`](../src/__tests__/svg-style-isolation-browser.test.ts) |
| 3 | The one-to-six-color ladder now passes through the same visibility and separation repair as larger palettes, keeping its exact bytes wherever it already met the contract | [`property-categorical-palette-contract`](../src/__tests__/property-categorical-palette-contract.test.ts): ΔE_OK ≥ 0.10 between every pair and visibility on the page, for any accent, background, and count |
| 4 | Labels share one font size fitted to the bars' cross-axis room; each bar then places its own label inside or beyond its end, and a bar with no room loses only its own label. Wires `showDataLabelOutsideBar` | [`property-xychart-data-labels`](../src/__tests__/property-xychart-data-labels.test.ts): shrinking one bar never removes another bar's label. The companion "sparse chart labels every bar" property passes on the unfixed code too, because the floor baseline of issue 1 kept bars long; it is a regression guard, and it found the zero-bar placement case during this work |
| 5 | Label ink inside a bar is the black or white with the higher WCAG contrast against that bar's fill; the shared `contrastTextColor` switched from a brightness cut-off to that rule, which also fixes node text on custom fills. The sketch looks halo text with the page color over hatched or washed bars, so there the backend paints the family's page ink instead (`TextMark.pageFill`). Wires `themeVariables.xyChart.dataLabelColor` | [`property-xychart-data-labels`](../src/__tests__/property-xychart-data-labels.test.ts) (every label ≥ 4.5:1 against the surface under its glyphs, in every palette and look; fails when the inside-label ink or the backend re-ink is reverted) and [`renderer-contrast`](../src/__tests__/renderer-contrast.test.ts) (ink contract for any opaque fill) |
| 6 | The layout records the authored category names it does not draw; `verify` reports them as `LABELS_HIDDEN` (`target: "x-axis"`), and bars with no room for their value as `target: "data-labels"` | [`property-xychart-verify-lints`](../src/__tests__/property-xychart-verify-lints.test.ts): the warning names exactly the categories and values absent from the SVG (fails when the report is removed) |
| 7 | The automatic value range of a chart with a bar series includes zero, padding only the side away from zero | [`property-xychart-bar-encoding`](../src/__tests__/property-xychart-bar-encoding.test.ts) |
| 8 | `BAR_RANGE_EXCLUDES_ZERO` flags an authored bar range that excludes zero and names the baseline the bars are drawn from | [`property-xychart-verify-lints`](../src/__tests__/property-xychart-verify-lints.test.ts): fires exactly when the range excludes zero on a chart with bars |
| 9 | Layout reserves the half label that end ticks reach beyond the plot | [`property-xychart-text-containment`](../src/__tests__/property-xychart-text-containment.test.ts): resvg's glyph bounding box of every chart stays inside the viewBox; the same property found that bars beyond an authored range left the canvas (fixed under 1) |
| 10 | The 17 official upstream keys the diagnostics called unknown, across sequence, xychart, gantt, mindmap, and gitgraph, are registered: wired where this renderer honors them, otherwise reported as accepted with no effect | [`upstream-config-key-diagnostics`](../src/__tests__/upstream-config-key-diagnostics.test.ts): no key in the pinned upstream manifest is ever called unknown or undocumented, while an invented key still is |

## Reconsidered and dropped

- **Pie renormalization of published percentages.** Survey shares of 49,
  27.4, 13.9, 5, and 3.2 render a 50% slice, because each share is divided by
  98.5. That is what a pie means: its slices are shares of the plotted total,
  and `showData` already prints each raw value beside its share. Lieflat's
  rule ("rounding ate the other two") is authoring advice. At most it belongs
  in [choosing a diagram](../docs/choosing-a-diagram.md) as one line (add an
  explicit remainder slice), not as a heuristic lint that would fire on
  ordinary counts.
- **Journey sections in issue 3.** Journey's section colors come from the same
  function, but they render as pale tints behind named sections, so color is
  not what identifies a section.

## Worth adopting

1. **Declare palette logic as data.** Lieflat's presets say what their colors
   mean (`ordinal`, `categorical`, or `mono+accent`) and how many categories
   they can carry. A palette here is `bg`, `fg`, `line`, `accent`, `muted`,
   `surface`, and `border`, and every peer color is derived from `accent` and a
   count. The derivation therefore has to guess the data's level of
   measurement, and at six or fewer it serves neither ordered nor unordered
   data well (issue 3). Several built-in palettes come from editor themes that
   publish curated categorical colors (Dracula, Nord, Catppuccin, Solarized,
   Tokyo Night). An optional authored categorical role would use those
   designed colors where they exist and keep the derivation as the fallback.
   This is a candidate only; it needs its own `TODO.md` entry and a pass
   through the
   [style–palette compatibility](../docs/design/style-palette-compatibility.md)
   audit.
2. **Assert a contract over its whole domain.** Lieflat's palm preset
   annotates its own closest pair. Here the perceptual floor was written when
   the path for seven or more colors was rebuilt and was never pointed back at
   six or fewer, whose byte pins then protected the collisions. A byte pin is
   a regression guard, not evidence of quality. A perceptual contract should
   enumerate every count and every built-in style it claims to cover.
3. **Check the page, not only the diagram.** Lieflat's deliverable is a page
   of charts, and its validator checks the page. This repository verifies one
   diagram at a time, which is how issue 2 reached production. A test that
   renders two diagrams of one family in different styles on one page, and
   compares each against its isolated render, would have caught it.
4. **Use real data to find semantic failures.** Lieflat's
   `examples/lenny-2026-survey.html` works through a real survey and
   exercises its honesty rules: the rounding loss is stated, missing
   comparison data is deleted rather than invented, and decorative randomness
   is turned off where shares must be exact. A signed series found issue 1,
   and a series with one small value found issue 4. The Flint note already
   calls for cross-style and cross-output fixtures that assert direction,
   ordering, emphasis, denominators, and units; the sources under
   [Reproduction](#reproduction) are the first such fixtures, each failing
   today.

## Where we deliberately diverge

1. **Prose-enforced taste.** Lieflat's rules live in a 37 KB skill and a
   self-check the agent must remember to run, and its validator can only
   confirm that the sentences still exist. This repository's bet is that
   anything checkable becomes a `verify` code. Lieflat's refusals (no broken
   axes, no multi-hue single series, no interaction on decorative marks)
   should arrive here as lints, not as skill prose.
2. **Template-first generation.** Lieflat stops agents from inventing
   look-alike charts by making them copy reference code. Here the renderer
   owns the look and agents author Mermaid source, so there is nothing to
   copy.
3. **Chart vocabulary.** Lieflat's 64 chart types include unit charts,
   beeswarms, ridgelines, and maps. Mermaid's enumerated families are the
   product, and xychart exists for corpus compatibility
   ([TanStack note](./tanstack-charts-learnings.md)). The goal is to make the
   existing families honest, not to add chart types.
4. **Monochrome past six categories.** Lieflat drops color above six
   categories. A fifteen-slice Mermaid pie is read through its legend and needs
   color, and the path for seven or more colors measures at least 0.10 apart.
   Keep it.
5. **Assigning lightness by importance.** Lieflat hands out its gray ladder
   by importance, so the darkest mark is the largest (its waffle sorts
   categories by share first). Here slices and series keep source order, which
   is the author's intent; a Likert scale must not be re-sorted. Fix the
   palette logic instead.
6. **Motion and the chart frame.** Lieflat animates every entrance and frames
   each chart with a conclusion as its title, a subtitle that carries the
   legend, and a source line. Motion is out of scope
   ([`DESIGN.md`](../DESIGN.md)), and Mermaid has no subtitle or source syntax,
   which this repository will not add. `accTitle` and `accDescr` carry the
   reader's question ([choosing a diagram](../docs/choosing-a-diagram.md)).

## Reproduction

Each source below was checked at `c349dac` with `bun run bin/am.ts verify
<file> --json` and `bun run bin/am.ts render <file> --format svg` (or
`--format ascii`). Color and contrast figures use the repository's own
`deltaEOK` and `wcagContrastRatio` on rendered SVG colors, across the default
style and every entry in `BUILTIN_PALETTE_DEFINITIONS`. Page-level figures
compare each element's computed fill and stroke in Chromium, in the page and
alone.

Issue 1; add `horizontal` to the header for the horizontal case. Issue 7:
replace the series with `bar [52, 58, 61, 66]`.

```text
xychart-beta
    x-axis [North, South, East, West]
    bar [-10, 20, -5, 25]
```

Issue 2: render this source twice, once with the default style and once with
`--style dracula`, inline both SVGs in one HTML page, and read the first
line's computed stroke.

```text
xychart-beta
    x-axis [A, B, C]
    y-axis 0 --> 100
    line "S" [10, 50, 90]
```

Issue 3, with `--style tokyo-night-light`; three or more `line` series show
the default-style collision:

```text
xychart-beta
    x-axis [Mon, Tue, Wed, Thu, Fri]
    y-axis 0 --> 100
    line "Accepted" [58, 61, 55, 66, 70]
    line "Declined" [42, 39, 45, 34, 30]
```

Issue 4; change `2` to `40` and all three labels return:

```text
---
config:
  xyChart:
    showDataLabel: true
---
xychart-beta
    x-axis [A, B, C]
    y-axis 0 --> 100
    bar [100, 90, 2]
```

Issue 5, with `--style tokyo-night`; issue 9 is the same chart without a
title:

```text
---
config:
  xyChart:
    showDataLabel: true
---
xychart-beta
    x-axis [Q1, Q2, Q3]
    y-axis 0 --> 100
    bar "North" [60, 70, 80]
    bar "South" [55, 65, 75]
    bar "West" [50, 60, 90]
```

Issue 6; add `horizontal` to the header to see every name:

```text
xychart-beta
    x-axis ["Platform Infrastructure", "Developer Experience", "Payments and Billing", "Identity and Access", "Mobile Applications", "Data Engineering", "Customer Support Tools", "Growth Experiments"]
    y-axis "Tickets" 0 --> 120
    bar [110, 95, 80, 72, 60, 44, 30, 12]
```

## Sources

Reviewed at Lieflat Charts commit
[`4eef5ce00d0907a03b8eff42578b5a04942915e9`](https://github.com/larashero3-dotcom/lieflat-charts/tree/4eef5ce00d0907a03b8eff42578b5a04942915e9):

- [`SKILL.md`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/SKILL.md):
  output modes, selection order, hard rules (bars never break the axis at
  line 90, rounding at line 126, colored line weight at line 266), the
  refusal list, and the self-check.
- [`catalog.md`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/catalog.md):
  the 64 chart types indexed by data shape, occasion, and reading time.
- [`color-presets.js`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/color-presets.js)
  and
  [`mono-tokens.js`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/mono-tokens.js):
  palette logic, capacities, `INK_BOOST`, halos, and the deterministic `rnd`.
- [`templates/glance-gallery.html`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/templates/glance-gallery.html#L567)
  (diverging bar) and
  [`templates/lupi-gallery.html`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/templates/lupi-gallery.html#L345)
  (barcode label spacing).
- [`examples/lenny-2026-survey.html`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/examples/lenny-2026-survey.html)
  and
  [`examples/README.md`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/examples/README.md):
  the real-survey worked example and the rules it exercises.
- [`scripts/validate.mjs`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/scripts/validate.mjs)
  and
  [`LICENSE`](https://github.com/larashero3-dotcom/lieflat-charts/blob/4eef5ce00d0907a03b8eff42578b5a04942915e9/LICENSE)
  (PolyForm Noncommercial 1.0.0).

Upstream Mermaid at `mermaid@11.16.0`
([`f3dea58`](https://github.com/mermaid-js/mermaid/tree/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc)),
the version pinned in `docs/project/upstream-mermaid-manifest.json`:
`packages/mermaid/src/diagrams/xychart/chartBuilder/components/plot/barPlot.ts`,
`packages/mermaid/src/diagrams/xychart/xychartDb.ts`, and
`packages/mermaid/src/mermaidAPI.ts`.

This repository's issue
[#248](https://github.com/adewale/agentic-mermaid/issues/248), for the
fidelity rubric and the byte-ineffective xychart settings; and the production
page `https://agentic-mermaid.dev/examples/` with its style-and-palette
fragment, fetched 2026-09-23.

Vega-Lite [scale documentation](https://vega.github.io/vega-lite/docs/scale.html),
property `zero`.
