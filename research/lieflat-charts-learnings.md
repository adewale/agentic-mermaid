# Lieflat Charts: learnings for Agentic Mermaid

**Status.** External-survey research note, written 2026-09-23 against Lieflat
Charts commit
[`4eef5ce`](https://github.com/larashero3-dotcom/lieflat-charts/commit/4eef5ce00d0907a03b8eff42578b5a04942915e9)
(2026-08-19). Every measurement of this repository was taken at `c349dac` and
can be reproduced from the sources under [Reproduction](#reproduction). This is
analysis, not backlog: any follow-up promoted from here gets its own `TODO.md`
entry first.

The [Flint note](./flint-chart-deep-dive.md) supplied the method: name a
bounded perceptual failure, measure it, and return the evidence. Lieflat
supplies a practitioner's list of chart-honesty rules. Applying those rules to
this renderer found five places where the rendered chart misstates or hides
what the source says, while `verify` reports `ok`. Four of them are concrete
fixtures for the Flint note's lesson 4, "test semantic truth after presentation
transforms"; the fifth is a readability failure of the kind lesson 36 in
[lessons learned](../docs/project/lessons-learned.md) describes.

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
   `BELOW_READABLE_SIZE` (lesson 36).
4. **Emphasis leaves geometry alone, and there is one focus.** Lieflat's wire
   preset gives the accent to exactly one element. `highlightSlice` emphasizes
   a wedge without moving it, and the Brand `accent-area` constraint bounds
   how much of a diagram the accent may cover.
5. **Ordered values go on position.** Journey places scores on a baseline with
   a single fill, the channel Lieflat reserves for ordered data.
6. **Text drawn on a data mark needs its own contrast.** Every Lieflat preset
   carries a `HALO` color for `paint-order` halos. Pie picks label ink per wedge
   with `contrastTextColor`, and sankey's `outlined` labels use a halo.
   Finding 4 below is where this is not applied.

## What applying its rules found

Each finding gives Lieflat's rule, what renders here, why `verify` stays
silent, and the smallest fix that reuses code already in this repository.

### 1. Peer colors: six or fewer is neither ordinal nor categorical

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
separates unordered peers poorly. Xychart series, pie slices, radar curves,
sankey nodes, gitgraph and mindmap branches, and Journey sections all take
their peer colors from it. Journey requests `Math.max(6, sectionCount)`
colors, so every small journey draws from the six-color row. Rendered xychart
series colors (pie slices are identical) across the default style and the 20
built-in palettes:

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
1.04:1 (ΔE_OK 0.037) on 3 px strokes, and the legend swatch is the only link
from a series name to its line. On `tokyo-night-light`, a two-series chart
paints `#34548a` and `#285a8a` at 1.05:1 (ΔE_OK 0.020). Lieflat's `INK_BOOST`
rule, which thickens colored hairlines 1.8×, exists because thin colored
strokes are harder to tell apart than filled areas. Pie is less exposed than
series charts: a 1.5 px white stroke separates wedges, and both the legend
rows and the slice labels carry percentages.

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
  a monotone single-hue ramp is kept for ordered encodings. The repository
  already has a precedent. Journey's actor dots use a golden-angle hue palette
  at constant lightness for up to six actors (`legacyActorPalette` in
  [`journey/renderer.ts`](../src/journey/renderer.ts)). At five colors it
  measures a minimum ΔE_OK of 0.101, where the ladder measures 0.037.

Choosing between them is an aesthetic call for the owner.

### 2. Bars are measured from the axis floor, not zero

**Lieflat's rule.** Bars never break the axis, because a bar's contract is
length proportional to value. Its diverging-bar template draws an explicit
zero rule and grows signed bars away from it.

**What renders.** `layoutVerticalBars` and `layoutHorizontalBars` receive
`yRange.min` as their baseline ([`xychart/layout.ts`](../src/xychart/layout.ts)
lines 158 and 248). When the author gives no range, the parser pads the data
minimum by 10% of the span and floors it to zero only when the minimum lies
within half a span of zero ([`xychart/parser.ts`](../src/xychart/parser.ts)
lines 132–143). In every case below, `verify` returns `ok` with no warnings.

- Auto range, bars 52, 58, 61, 66: heights 36, 189, 266, 393 px. Enterprise
  reads as 10.9 times Basic, while the data ratio is 1.27, a Tufte lie factor
  of about 37.
- Authored `y-axis 45 --> 75`, bars 50, 60, 70: heights 72, 215, 358 px, a lie
  factor of about 10.
- Signed bars −10, 20, −5, 25: every SVG bar grows upward from the floor, and
  −10 renders shorter than −5 (36 px against 87 px with the auto range; 86 px
  against 129 px with an authored `-20 --> 30`). The ASCII projection of the
  same source hangs negatives from zero (`Math.max(0, yRange.min)` in
  [`ascii/xychart.ts`](../src/ascii/xychart.ts) lines 261 and 455), so the two
  outputs disagree about the sign of the data. That breaks lesson 8 in
  [lessons learned](../docs/project/lessons-learned.md), "final pixels and
  public projections must agree".

Upstream `mermaid@11.16.0` draws bars from the plot floor
([`barPlot.ts` line 52](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagrams/xychart/chartBuilder/components/plot/barPlot.ts#L52))
and auto-ranges to exactly the data minimum and maximum
([`xychartDb.ts` line 120](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagrams/xychart/xychartDb.ts#L120)),
so upstream's smallest bar has zero height. The floor baseline is inherited
parity; the padding heuristic is already our own divergence. The convention
in chart grammars runs the other way: Vega-Lite's
[`zero`](https://vega.github.io/vega-lite/docs/scale.html) is "true for x and y
channels if the quantitative field is not binned and no custom domain is
provided."

**Smallest fix.** Give both projections one baseline rule: zero, clamped into
the axis range. The SVG layout helpers already accept any baseline and grow
bars in either direction; ASCII's `Math.max(0, min)` also needs the upper
clamp for ranges that are entirely negative. For charts with bar series,
include zero in the auto range. When the author wrote the range (the parser
already records `rangeAuthored`) and it excludes zero, keep it and add a Tier 3
lint that reports the implied lie factor. Charts with only line series keep
their current range.

### 3. Category names are thinned like numeric ticks

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
source rendered `horizontal` shows all eight names.

**Smallest fix.** Keep thinning on numeric axes, where ticks can be
interpolated. On a categorical axis, report it: a Tier 3 warning that names
the blank categories and the existing typed remedy,
`set_orientation {horizontal: true}`.

### 4. Data labels are all or nothing, and ignore the bar they sit on

**Lieflat's rule.** Labels drawn over data get a `paint-order` halo in the
page color (every preset defines `HALO`), so they read on any fill.
Information that cannot fit at the size floor moves to hover instead of being
shrunk.

**What renders.** `buildBarDataLabels`
([`xychart/renderer.ts`](../src/xychart/renderer.ts) from line 626) has two
problems.

- Every label shares one font size: the smallest size that fits across all
  bars. If that falls below 8 px, no labels are drawn at all. With 24 daily
  bars of five-digit values and `showDataLabel: true`, the chart renders zero
  labels, and `verify` says nothing.
- Labels sit inside the top of each bar in the global text color
  (`var(--_text)`) rather than a color chosen against that bar. In all 21
  styles, some series' labels fall below WCAG 4.5:1: 2.17:1 on the default
  style, 1.19:1 on `tokyo-night`, and 1.03:1 on `solarized-light`. The
  [palette contract](../docs/svg-semantic-contract.md) certifies text roles
  against the page background, but a data label's backdrop is its bar. The
  opt-in Brand `contrast` constraint returns "unmeasurable" on this chart
  rather than a ratio.

Pie already solves the second problem with a per-wedge
`contrastTextColor(fill)` ([`pie/renderer.ts`](../src/pie/renderer.ts) line
217), and the Scene IR already carries `label.halo`
([`scene/ir.ts`](../src/scene/ir.ts) line 256), which only sankey's `outlined`
labels use today.

**Smallest fix.** Reuse `contrastTextColor`, or the halo, for bar labels. When
labels are dropped, say so; `INEFFECTIVE_CONFIG` already exists for
configuration that has no effect.

### 5. Published percentages are silently renormalized

**Lieflat's rule.** When rounded shares do not sum to 100, say so ("rounding
ate the other two") and never invent the missing units. Its worked example is
a real survey: 49, 27.4, 13.9, 5, and 3.2.

**What renders.** That exact input produces a 50% slice and the legend row
"Augmented [49] (49.7%)", because every share is divided by 98.5. The chart
states numbers that are not in the source, and `verify` reports only that the
title is long.

**Smallest fix.** A Tier 3 lint for a pie whose values all lie between 0 and
100 and whose total is near 100 but not 100. It should name the total and the
remedies: an explicit remainder slice, or a note in `accDescr`. The tolerance
needs calibrating against the corpus so that ordinary counts do not trigger
it.

### Incidental findings

Building a multi-chart evidence page for this note, the same shape as a
Lieflat deliverable, surfaced two defects outside the rules above.

- **Inline SVG styles leak between diagrams.** Each SVG's `<style>` rules are
  unscoped (for example `.xychart-color-0 { … }` and a bare `svg { … }`). With
  a default chart and a `dracula` chart inlined on one page, the first chart's
  line computes to Dracula's `#bd93f9` in Chromium although its own style says
  `#3b82f6`. `idPrefix`, the documented option for
  [multi-diagram pages](../docs/svg-semantic-contract.md), namespaces ids and
  references but not these rules. Lieflat's validator treats the page as the
  unit and rejects duplicate ids across the charts on it; `idPrefix` covers
  ids for the same reason but not styles.
- **An untitled xychart clips its top tick label.** The label sits at `y="0"`
  with `dominant-baseline="middle"`, so the upper half of its glyphs falls
  outside the viewBox, and `verify` returns `ok`. `OFF_CANVAS` catches a bar
  below the axis minimum but not an axis tick label.

## Worth adopting

1. **Declare palette logic as data.** Lieflat's presets say what their colors
   mean (`ordinal`, `categorical`, or `mono+accent`) and how many categories
   they can carry. A palette here is `bg`, `fg`, `line`, `accent`, `muted`,
   `surface`, and `border`, and every peer color is derived from `accent` and a
   count. The derivation therefore has to guess the data's level of
   measurement, and at six or fewer it serves neither ordered nor unordered
   data well (finding 1). Several built-in palettes come from editor themes
   that publish curated categorical colors (Dracula, Nord, Catppuccin,
   Solarized, Tokyo Night). An optional authored categorical role would use
   those designed colors where they exist and keep the derivation as the
   fallback. This is a candidate only; it needs its own `TODO.md` entry and a
   pass through the
   [style–palette compatibility](../docs/design/style-palette-compatibility.md)
   audit.
2. **Assert a contract over its whole domain.** Lieflat's palm preset
   annotates its own closest pair. Here the perceptual floor was written when
   the path for seven or more colors was rebuilt and was never pointed back at
   six or fewer, whose byte pins then protected the collisions. A byte pin is
   a regression guard, not evidence of quality. A perceptual contract should
   enumerate every count and every built-in style it claims to cover.
3. **Use real data to find semantic failures.** Lieflat's
   `examples/lenny-2026-survey.html` works through a real survey and
   exercises its honesty rules: the rounding loss is stated, missing
   comparison data is deleted rather than invented, and decorative randomness
   is turned off where shares must be exact. One published input found
   finding 5, and one signed series found finding 2. The Flint note already
   calls for cross-style and cross-output fixtures that assert direction,
   ordering, emphasis, denominators, and units. The inputs in
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
style and every entry in `BUILTIN_PALETTE_DEFINITIONS`.

Finding 1, with `--style tokyo-night-light`; three or more `line` series show
the default-style collision:

```text
xychart-beta
    x-axis [Mon, Tue, Wed, Thu, Fri]
    y-axis 0 --> 100
    line "Accepted" [58, 61, 55, 66, 70]
    line "Declined" [42, 39, 45, 34, 30]
```

Finding 2; replace the series with `bar [52, 58, 61, 66]` for the truncated
auto range:

```text
xychart-beta
    x-axis [North, South, East, West]
    bar [-10, 20, -5, 25]
```

Finding 3; add `horizontal` to the header to see every name:

```text
xychart-beta
    x-axis ["Platform Infrastructure", "Developer Experience", "Payments and Billing", "Identity and Access", "Mobile Applications", "Data Engineering", "Customer Support Tools", "Growth Experiments"]
    y-axis "Tickets" 0 --> 120
    bar [110, 95, 80, 72, 60, 44, 30, 12]
```

Finding 4, with `--style tokyo-night`:

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

Finding 5:

```text
pie showData title How engineers describe their AI identity (survey, %)
    "Augmented" : 49
    "Skeptical" : 27.4
    "Curious" : 13.9
    "Resistant" : 5
    "Dependent" : 3.2
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
`packages/mermaid/src/diagrams/xychart/chartBuilder/components/plot/barPlot.ts`
and `packages/mermaid/src/diagrams/xychart/xychartDb.ts`.

Vega-Lite [scale documentation](https://vega.github.io/vega-lite/docs/scale.html),
property `zero`.
