# Radar diagram family — demand crawl + implementation plan

> Status: **planning** (no code yet). This document is the research + plan for adding a
> `radar-beta` diagram family to Agentic Mermaid. It pairs a popularity-weighted crawl of
> Mermaid, Mermaid ASCII, and Beautiful Mermaid with a full Mermaid-syntax compliance spec,
> an aesthetic study, and a phased, file-level implementation plan grounded in this repo's
> registry-driven family architecture.
>
> Sibling references: [`gantt-research.md`](./gantt-research.md),
> [`gitgraph-research.md`](./gitgraph-research.md),
> [`../../contributing/adding-diagram-types.md`](../../contributing/adding-diagram-types.md).

---

## 0. TL;DR

- **Demand is real but concentrated on the basics done well.** In upstream Mermaid the
  headline signal is the original feature request **#2280 "Radar Chart" (17 👍)**; radar
  shipped as `radar-beta` in **v11.6.0** via **PR #6381**. Post-launch engagement is bug
  polish plus exactly **two unmet feature asks**: (1) **value/tick labels on the rings**
  (#6473 / PR #6481 — stalled unmerged 14+ months) and (2) **robust long axis-label
  layout** (wrap / multi-line / auto-fit; #7683, only partly addressed by #7781).
- **Neither fork has any radar-specific demand.** Beautiful Mermaid has zero radar mentions
  (its closest precedent is the already-shipped `xychart`); Mermaid ASCII is structurally
  out-of-medium for polar charts. So the fork audience won't dictate scope — the upstream
  demand + the diagram's aesthetic spirit should.
- **What people use radar for:** skill/competency matrices, product/service comparisons,
  test/QA coverage, academic grades, RPG character stats, KPI/performance profiles.
- **The win:** ship spec-complete `radar-beta` **and** the two things upstream still hasn't
  delivered — **ring value labels** and **legible long axis labels** — rendered in the
  project's translucent, sketch-capable house style, with an optional dashed **"frontier"
  reference curve** (the exact gesture in the user's own example radar).
- **Architecturally this is a well-trodden path.** Radar is a "chart-type" family exactly
  like pie/quadrant/xychart: a `src/radar/` module + `src/agent/radar-body.ts` + two
  `register*` calls, plus ~20 compile-forced registry/union entries. There is **no core
  `parse`/`layout`/`render` switch to edit** — the plugin registry dispatches everything.
- **One genuinely new primitive is required:** a deterministic closed cardinal-spline path
  helper (`curveCardinalClosed`, tension 0.17) — no spline utility exists in `src/` today.

---

## Part 1 — The popularity-weighted crawl

### 1.1 Method & weighting

"Popularity-weighted" = rank threads by GitHub **reactions** (👍 as the primary demand
proxy) then by **comment count** (discussion intensity), across open **and** closed
issues/PRs. Crawled via cross-repo `search_issues` / `search_pull_requests` (sorted by
`reactions` and by `comments`), then deep-read the top threads' bodies + comments.

**Scoping caveat that matters:** a broad full-text `radar` search in `mermaid-js/mermaid`
surfaces high-reaction issues that only mention the word incidentally (e.g. #1361 ER links
114👍, #177 diagram-type poll 99👍). The *genuine* radar family is a `radar in:title`
search: **6 issues + 5 PRs**. The real demand signal is small and concentrated — reported
honestly below rather than inflated by keyword collisions.

### 1.2 Mermaid core (`mermaid-js/mermaid`) — the primary signal

Ranked by (reactions, comments):

| 👍 / 💬 | State | # | Title | Ask / purpose |
|---|---|---|---|---|
| 17 / 1 | closed ✅ | [#2280](https://github.com/mermaid-js/mermaid/issues/2280) | Radar Chart | **Original feature request** (skill/test-coverage viz). Resolved by #6381. |
| 3 / 8 | merged ✅ | [#6381](https://github.com/mermaid-js/mermaid/pull/6381) | feat: Add radar diagram | **The implementation** — ships `radar-beta`. |
| 1 / 23 | **open** 🟡 | [#6481](https://github.com/mermaid-js/mermaid/pull/6481) | Add optional axis / tick labels | Value labels on rings (`tickLabels`). Stalled in review 14+ months. |
| 0 / 11 | merged ✅ | [#7781](https://github.com/mermaid-js/mermaid/pull/7781) | fix: align axis labels by angular position | Stop long axis labels clipping the viewBox. |
| 0 / 7 | merged ✅ | [#7076](https://github.com/mermaid-js/mermaid/pull/7076) | correct viewBox casing | `viewbox`→`viewBox` so SVG scales/contains. |
| 0 / 5 | merged ✅ | [#7188](https://github.com/mermaid-js/mermaid/pull/7188) | Remove trailing comma from doc example | Fix a broken docs example. |
| 0 / 5 | merged ✅ | [#7333](https://github.com/mermaid-js/mermaid/pull/7333) | line/column numbers in parse errors | Radar (and others) now report location. |
| 0 / 0 | **open** 🟡 | [#6473](https://github.com/mermaid-js/mermaid/issues/6473) | Radar: optional tick labels | The request behind PR #6481. |
| 0 / 0 | closed ✅ | [#7683](https://github.com/mermaid-js/mermaid/issues/7683) | axis label rendering inconsistencies | Long labels clipped/compressed; asked for wrap/multi-line. |

**Headline demand:** **#2280, 17 👍** — the number to quote for "how much did people want
radar." Everything after launch is measured in *comments* (bug/review threads), not upvotes.

**What people USE radar for** (quoted from threads):

- Team/skill matrices & competency assessment — *"teammate level on some technos"* (#2280).
- Test/QA coverage — *"percentage of tests on each test types"* (#2280).
- RPG / character stats — the bug repro uses `Naruto` over `Agility, Speed, Strength, …` (#7683).
- Academic grades — canonical docs example: Alice vs Bob across Math/Science/English/… .
- Product/service comparison — docs "Restaurant Comparison" across Food/Service/Price/Ambiance.
- Dashboards/docs needing full metric names (motivation for the long-label ask, #7683).

**Requested-but-missing, ranked by how loudly:**

1. **Tick / value labels on the rings** — the *only* explicit post-launch feature ask (#6473,
   PR #6481: `tickLabels` / `tickLabelsAxis` / `tickLabelsOffset`). **Still unmerged.** #1 gap.
2. **Long / descriptive axis-label handling** — users want wrapping, `<br/>` multi-line, or
   dynamic font-fit (#7683). Only *angular-position alignment* shipped (#7781); wrap /
   multi-line / auto-fit remain unimplemented.
3. **Usable parse errors** — line/column numbers (#7162 → #7333, done).

**Explicitly NOT represented as demand** (searched for; no issues/PRs exist): negative
values, per-axis custom scales, legend *positioning*, tooltips/interactivity, start-angle
rotation, reference-band overlays, an explicit fill-vs-outline toggle, per-curve colors
beyond theme, export controls. There is no measurable pull for advanced analytics — the
surface is thin and centered on **tick labels + label-rendering polish**.

**Implementation facts:** keyword `radar-beta` (deliberately beta; docs carry a 🔥 marker),
shipped **v11.6.0**, PR **#6381** by **@thomascizeron** (merged 2025-03-21), praised by
maintainer @knsv as a template PR. Multiple overlapping series supported (multiple `curve`
lines). Curves drawn with a **closed Catmull-Rom spline** (`curveTension` 0.17). Author
admitted weak rendering-test coverage at launch (~4.6% patch coverage) — a quality gap this
fork's rubric/golden-test discipline is well suited to close.

### 1.3 Beautiful Mermaid (`lukilabs/beautiful-mermaid`) — the fork's upstream

- **Radar demand: zero.** No issue or PR names radar. `search` scoped to `radar` → 0 results.
- Supported-diagram matrix (README): *"6 diagram types — Flowcharts, State, Sequence, Class,
  ER, and XY Charts."* Radar/pie/quadrant are absent. The only chart family is **xychart**
  (merged PR #40) — the **data-chart precedent** a radar PR would follow.
- The only home for radar is the umbrella issue **#59 "Add support for all Mermaid v11
  diagrams" (2 👍)**, which doesn't even enumerate radar (its one example is gantt). The named
  appetite is for structural types (C4, timeline, mindmap, TreeView), not charts.
- For scale: the single most-upvoted issue in the whole repo is **#1 "CLI support for AI
  agents" (16 👍)** — an order of magnitude above any diagram-family request.

### 1.4 Mermaid ASCII (`AlexanderGrooff/mermaid-ascii`) — the terminal renderer

- **Radar demand: zero, and structurally so.** Supported types are only **Graphs/Flowcharts**
  and **Sequence Diagrams**. The coverage tracker (#74) lists flowchart, sequence, ER, state,
  gantt, class — **no data charts at all** (pie/xy/quadrant/radar never appear, even in the
  long tail).
- This is an **ASCII/Unicode terminal renderer**: curved axes, filled polygons and continuous
  scales map poorly onto a character grid, so radar is *out-of-medium* rather than merely
  low-priority. (This directly informs our own ASCII strategy — see §5.4.)

### 1.5 Ecosystem scan

- **Very new, still beta.** `radar-beta` shipped v11.6.0 (early 2026) and remains beta — the
  recency *is* the niche signal.
- **Terminology** (all treated as synonyms): radar = spider = star = cobweb = polar = Kiviat.
  Users searching "spider chart markdown" land on the same feature.
- **Dominant use-cases:** skill assessments, performance reviews, multi-dimensional comparison
  of a few entities across shared axes.
- **Adoption is gated by renderer version-lag:** renders in up-to-date native hosts (Obsidian,
  Notion, mermaid.ink on recent builds) but **not** in GitHub-native Markdown or Kroki's
  default bundle yet (both pin older Mermaid). Agentic Mermaid, by shipping radar itself, is
  ahead of those hosts.

### 1.6 Demand synthesis → scope

The proven demand is **the basics done beautifully** (skill matrices, comparisons, grades,
RPG stats) **plus the two things upstream still hasn't delivered**:

1. **Ring value/tick labels** (the loudest unmet ask), and
2. **Robust long-axis-label layout** (wrap / multi-line / auto-fit).

Shipping spec-complete `radar-beta` and cleanly closing those two gaps — in this project's
distinctive aesthetic — is the highest-leverage version of this feature.

---

## Part 2 — Full Mermaid `radar-beta` syntax (the compliance contract)

This is the "**full support for the Mermaid syntax**" checklist. Extracted from
`mermaid-js/mermaid@develop`: grammar `packages/parser/src/language/radar/radar.langium`,
`packages/mermaid/src/diagrams/radar/{db,renderer,styles,types}.ts`, config schema
`config.schema.yaml` (`RadarDiagramConfig`), and `radar.spec.ts` (authoritative on
accepted variants + defaults). Agentic Mermaid's citizenship gate treats parse-acceptance or
opaque-preservation as **not** support — every stable construct below must be modeled and
rendered with its documented semantics.

### 2.1 Grammar

Header (three spellings, all valid): `radar-beta`, `radar-beta:`, `radar-beta :`. Detector is
`/^\s*radar-beta/`. **There is no non-beta `radar` alias** — the family header is `radar-beta`.

```langium
entry Radar:
  NEWLINE* ('radar-beta' | 'radar-beta:' | 'radar-beta' ':') NEWLINE*
  ( TitleAndAccessibilities
  | 'axis'  axes+=Axis   (',' axes+=Axis)*
  | 'curve' curves+=Curve (',' curves+=Curve)*
  | options+=Option (',' options+=Option)*
  | NEWLINE )* ;

fragment Label: '[' label=STRING ']' ;
Axis:  name=ID (Label)? ;
Curve: name=ID (Label)? '{' Entries '}' ;
fragment Entries:
  NEWLINE* entries+=NumberEntry   (',' NEWLINE* entries+=NumberEntry)*   NEWLINE* |
  NEWLINE* entries+=DetailedEntry (',' NEWLINE* entries+=DetailedEntry)* NEWLINE* ;
DetailedEntry returns Entry: axis=[Axis:ID] ':'? value=NUMBER ;   // colon OPTIONAL
NumberEntry   returns Entry: value=NUMBER ;
Option:
  ( name='showLegend' value=BOOLEAN | name='ticks' value=NUMBER
  | name='max' value=NUMBER | name='min' value=NUMBER
  | name='graticule' value=GRATICULE ) ;
terminal GRATICULE returns string: 'circle' | 'polygon' ;
```

Statement rules that must be honored:

- **Body is an unordered, repeatable alternation.** `axis`, `curve`, `Option`, title/acc, and
  blank lines may appear in any order and any count; each accumulates. Axes are always
  populated before curves internally, so keyed curves resolve even if `curve` precedes `axis`.
- **Axis:** `axis A` · `axis A, B, C` · `axis A["Label"], B["Label"]`. Label optional; when
  omitted `label = name`.
- **Curve:** `curve id["Label"]{…}`, multiple comma-separated per line. Two mutually exclusive
  entry forms (a single curve cannot mix):
  1. **Positional:** `{1, 2, 3}` → values map to axes in **declaration order**.
  2. **Keyed:** `{ C: 3, A: 1, B: 2 }` (colon optional → `{ C 3, A 1, B 2 }` also valid) →
     **reordered to axis order** (so over `axis A,B,C` this yields `[1,2,3]`).
  Newlines allowed between entries and around braces.
- **Body options:** `showLegend true|false`, `ticks N`, `max N`, `min N`,
  `graticule circle|polygon` — one per line or comma-joined, interleaved anywhere.
- **Title / accessibility:** `title <free text>`, `accTitle: …`, `accDescr: …` (and block
  `accDescr { … }`). Title may also come from YAML frontmatter `title:`.

Lexical rules:

- **STRING** labels are `"…"`/`'…'` with backslash escapes; **labels must be quoted**
  (`axis A[Math]` is invalid; use `axis A["Math"]`).
- **ID** — a leading `\w` followed by an optional `[-\w]*\w` tail — starts alnum/underscore,
  may contain internal dashes, **cannot end with a dash**, no spaces.
- **NUMBER** = `FLOAT | INT` with **no sign token** → **negative numbers are not
  expressible** in radar syntax (values, `min`, `max` are ≥ 0).
- `%%` line comments and `%%{init: …}%%` directives are hidden terminals (allowed anywhere);
  YAML frontmatter supported.

### 2.2 Body options vs config-only settings (do not cross them)

| Setting | Where settable | Default |
|---|---|---|
| `showLegend`, `ticks`, `max`, `min`, `graticule` | **diagram body** (`Option`) | `true`, `5`, `null`(auto), `0`, `circle` |
| `width`, `height`, `marginTop/Right/Bottom/Left`, `axisScaleFactor`, `axisLabelFactor`, `curveTension` | **config only** (frontmatter `config: radar:` / `%%{init:{radar:…}}%%`) | `600, 600, 50×4, 1, 1.05, 0.17` |

`min/max/ticks/graticule/showLegend` are **not** part of `RadarDiagramConfig`; the
`width/height/margins/axisScaleFactor/axisLabelFactor/curveTension` group is **not** settable
by a body keyword. Modeling them in the wrong place is a fidelity bug.

### 2.3 Theme variables (nested under `themeVariables.radar`)

`axisColor`, `axisStrokeWidth` (2), `axisLabelFontSize` (12), `curveOpacity` (0.5),
`curveStrokeWidth` (2), `graticuleColor` (#DEDEDE), `graticuleStrokeWidth` (1),
`graticuleOpacity` (0.3), `legendBoxSize` (12, **declared but unused** — legend rect is
hardcoded 12×12), `legendFontSize` (12). **There is no `curveStrokeColor`** — a curve's fill
and stroke are the same `cScale{index}` color, fill drawn at `curveOpacity`. Series colors
cycle 1:1 with curve index into `cScale0..11` (only 0–11 have CSS; index ≥ 12 is unstyled — no
wraparound). Title uses top-level `fontSize` / `titleColor`.

### 2.4 Rendering semantics (must reproduce)

- **Frame/center/radius:** `totalW = width + marginL + marginR` (700 default), `viewBox="0 0
  totalW totalH"`, center at `(marginL + width/2, marginT + height/2)`, `radius = min(w,h)/2`
  (300 default).
- **Value→radius:** `maxValue = options.max ?? max(all entries)`, `minValue = options.min` (0);
  `relativeRadius(v) = radius · (clamp(v, min, max) − min) / (max − min)`. Values are **clamped**
  to range, not dropped. `axisScaleFactor` is **not** applied to data radius.
- **Axis placement:** axis `i` of `n` at `angle = 2πi/n − π/2` → **axis 0 at top (12 o'clock),
  clockwise**. Spoke length = `radius · axisScaleFactor`. Axis label at `radius ·
  axisLabelFactor` (1.05) + 4px, `text-anchor`/`baseline` chosen by the sign of cos/sin so
  labels splay outward.
- **Curve path:** `graticule circle` ⇒ smooth **closed Catmull-Rom** `<path>` via
  `curveTension` (0.17); `graticule polygon` ⇒ straight `<polygon>` (`curveTension` ignored).
  `tension = 0` degenerates to a polygon. **`graticule` controls both the ring shape and the
  curve edge style.**
- **Graticule:** `ticks` (5) rings at `radius · (i+1)/ticks`; `circle` → `<circle>`s,
  `polygon` → axis-angled `<polygon>`s. **No tick VALUE labels are rendered** — `ticks` is
  only a ring count. *(This is the #6473/#6481 gap.)*
- **Legend:** if `showLegend`, top-right, `lineHeight 20`, hardcoded 12×12 swatch + label per
  curve — **including curves skipped from drawing** (see edge cases), no wrapping.
- **Title:** centered above the top ring.

### 2.5 Edge cases / validation (behavior to match or deliberately diverge from)

| Case | Mermaid behavior |
|---|---|
| Empty curve `{}` | **parse error** (≥1 entry required) |
| Negative literal | **not expressible** (no sign in `NUMBER`) |
| Positional entry count ≠ axis count | curve **silently skipped from drawing** but **still legended** |
| Keyed curve missing an axis | **throws** `Missing entry for axis …` |
| Keyed curve, zero axes | **throws** `Axes must be populated before curves…` |
| Duplicate axis ids | no dedup; keyed refs resolve to the first match |
| Single axis | renders (one spoke; curve degenerates) |
| `min > max` / `min == max` | **unguarded** → NaN/degenerate radii |
| value outside `[min,max]` | **clamped** |
| > 12 curves | index ≥ 12 unstyled (no color) |
| `ticks 0` | no rings |

**Agentic-Mermaid stance:** where Mermaid "fails loudly" we mirror the failure with a named
diagnostic; where Mermaid is **unguarded** (`min>max`, `min==max`, silent curve-skip) we
should record a **named divergence** in the divergence ledger and surface a Tier-3 warning
(e.g. `RADAR_DEGENERATE_SCALE`, `RADAR_CURVE_ARITY_MISMATCH`) rather than emitting NaN
geometry — the citizenship rule is "unsupported/invalid forms fail loudly rather than
silently disappearing." The delivered implementation additionally bounds `ticks` to the
positive integer range `1..64`; this deliberate resource-safety divergence is recorded in
the harvest ledger.

### 2.6 Canonical examples to vendor as fixtures

```
---
title: "Grades"
---
radar-beta
  axis m["Math"], s["Science"], e["English"]
  axis h["History"], g["Geography"], a["Art"]
  curve a["Alice"]{85, 90, 80, 70, 75, 90}
  curve b["Bob"]{70, 75, 85, 80, 90, 85}
  max 100
  min 0
```

```
radar-beta
  title Restaurant Comparison
  axis food["Food Quality"], service["Service"], price["Price"], ambiance["Ambiance"]
  curve a["Restaurant A"]{4, 3, 2, 4}
  curve b["Restaurant B"]{3, 4, 3, 3}
  graticule polygon
  max 5
```

```
radar-beta
  axis A,B,C
  curve mycurve{ C: 3, A: 1, B: 2 }   %% → entries [1,2,3]
```

---

## Part 3 — Aesthetic spirit & design principles

Radar's load-bearing idea: **the silhouette IS the message.** Readers compare the overall
*footprint* of a few entities across shared dimensions — not exact values. So our renderer
should make the *shape* gorgeous and legible and quietly mitigate radar's known distortions.

**On-brand principles for THIS project** (hand-drawn rough.js strokes, translucent semantic
fills, 21 themes — and note the user's own example: a solid green filled envelope + a dashed
orange "frontier" outline over a light graticule):

1. **Translucent filled envelopes, ~25–35% alpha**, with optional rough/sketch edges. Keep the
   fill low-jitter even when the stroke is rough, so overlaps stay legible.
2. **A receding, quiet graticule** (3–5 rings, faint theme "grid" ink, `opacity ≈ 0.1`) — the
   calmest, most jitter-free element; a scaffold the lively data sits on. Circular (target) and
   polygonal (web) as a toggle.
3. **Dot vertices as a signature** — small filled dots at every data point so precision
   survives the smoothed/rough edge ("the sketch marks the measurement").
4. **Dashed "frontier / target" curve as a first-class style** — a dashed, outline-only,
   fill-free reference loop (goal / budget / benchmark / last-quarter) over the filled actuals.
   This is the distinctive, on-brand move and mirrors the user's own radar. *(Delivered as a
   style/annotation extension, not core `radar-beta` syntax — see §5.3 decision.)*
5. **Emphasized max ring + short radial axis labels** placed ~1.2–1.25× beyond the outer ring,
   so the legend is optional and the scale boundary is unambiguous.
6. **Theme-aware series palette** (fill = stroke hue at low alpha); keep 2–3 series
   distinguishable in both light and dark themes; cap default legible series ≈ 5.
7. **Restrained legend** (tiny, cornered, swatch + label).
8. **Smooth vs straight as a knob, mild curvature by default** so category discreteness isn't
   erased; dots always mark true vertices.
9. **Mitigate the known lies by construction** — shared 0→max scale by default, deterministic
   stable axis order, explicit max ring (bounds the area-exaggeration effect).
10. **Generous margins** so labels and the dashed frontier never clip.

**Aesthetic rubric (for judging a rendered radar):** (1) silhouettes distinguishable in <2s
without reading numbers; (2) grid clearly recedes; (3) translucent overlaps read (blended, not
muddy, none fully buried); (4) every spoke self-labeled + max ring unambiguous; (5) ≤5 series,
harmonious in light/dark, frontier instantly distinct from actuals; (6) sketch/dots tasteful
and honest (consistent scale, generous margins, nothing clipped).

---

## Part 4 — How Agentic Mermaid adds a family (architecture the plan builds on)

Verified against the code. Radar is a "chart-type" family like pie/quadrant/xychart.

- **No per-family `switch` in `parser.ts`, `layout-engine.ts`, or `renderer.ts`.** Those serve
  only the ELK graph pathway (flowchart/state/er/class). Chart families are wired through a
  **three-layer plugin registry** + **compile-forced exhaustive maps** that make `tsc` /
  `satisfies` fail until the new family is added everywhere.
  - `src/agent/families.ts` — registry (`registerFamily`/`getFamily`/`knownFamilies`,
    `REGISTRY` at :175) + the `BUILTIN_FAMILY_METADATA` manifest (:131) with a compile-time
    coverage assertion against `DiagramKind` (:169).
  - `src/agent/families-builtin.ts` — import-time `registerFamily({…})` installing
    `parse`/`serialize`/`mutate`/`verify`/`buildSourceMap`/`extractLabels`. The
    `structuredFamilyHooks('kind', {parseBody, serialize, mutate, headerOk})` helper (:42)
    gives the **structured-or-opaque** contract for free.
  - `src/render-family-hooks.ts` — `registerRenderHooks(id, {layout, renderSvg, lowerScene,
    renderAscii})` (quadrant block ~:280).
- **Public entrypoints dispatch through the registry with no edit:** `renderMermaidSVG`
  resolves `getFamily(kind).layout/renderSvg` (`src/index.ts:334`); `renderMermaidASCII`
  resolves `getFamily(kind).renderAscii` (`src/ascii/index.ts:163`).
- **Quality bridge:** `src/agent/family-layouts.ts` `layoutFamilyToRendered` (switch at :115)
  projects a family's positioned layout into the generic `RenderedLayout` the rubric consumes.
- **Two color systems compose:** the project's `DiagramColors` waist + **style stacks** (21
  themes, rough/hybrid backends) apply to *any* family that lowers to the SceneGraph
  (`scene/style-registry.ts` — "N styles + M families, never N×M"); Mermaid's radar
  theme-vars/config are read per-family via a `resolveRadarVisualConfig`/`resolveRadarTheme`.
- **The gate:** `docs/contributing/adding-diagram-types.md` + the test
  `src/__tests__/diagram-family-citizenship.test.ts`. Registration is **blocked** until the
  family is *syntax-complete* (every stable construct rendered with documented semantics — not
  parse-only) **and** *visual-metaphor complete* (Mermaid + Wikipedia references, the hallmark
  asserted by an independent geometry test, a committed captioned artifact). This gate is
  exactly the user's two requirements.

---

## Part 5 — Implementation plan (phased, file-level)

Legend: **NEW** = new file · **EDIT** = add a `radar` arm to an existing registry/union/map ·
⛔ = compile-forced (build breaks until done).

### Phase 0 — Upstream harvest & fixtures (do this BEFORE coding)

Per the contributing doc, harvest first — it surfaces the real semantics the docs omit.

- **NEW** `eval/mermaid-radar-bench/` — vendor `radar.spec.ts` cases + `radar.langium` +
  `db.ts` defaults as an executable exclusions ledger.
- **EDIT** `eval/mermaid-docs-corpus/corpus.json` (+ `divergences.json`) — add the radar docs
  examples from §2.6, plus a divergence entry for each place we intentionally guard Mermaid's
  unguarded behavior (`min>max`, `min==max`, silent curve-skip).
- **EDIT** `docs/design/mermaid-family-fidelity-audit.md` — add the `| Radar |` row (Mermaid
  11.x officialDocs + Wikipedia + this doc), and pin the Mermaid version being implemented.

### Phase 1 — Model + parser (rendering pipeline)

- **NEW** `src/radar/types.ts` — `RadarChart` (axes, curves, min/max, ticks, graticule,
  showLegend, title) and `PositionedRadarChart` (`width/height, cx, cy, radius, rings:{r,value}[],
  axes:{id,label,angle,labelX,labelY,anchor}[], curves:{label,colorIndex,vertices:{x,y}[],
  areaPath?,dots:{x,y}[],style?}[], legend, title, visual`). Mirror `src/quadrant/types.ts`.
- **NEW** `src/radar/parser.ts` — `parseRadarChart(lines): RadarChart` for the header
  `radar-beta`, `axis`/`curve` (positional + keyed, colon-optional), `max/min/ticks/graticule/
  showLegend`. Plus `applyRadarFrontmatterConfig`. Model the §2.5 validation as loud errors.
- **NEW** `src/radar/config.ts` — `resolveRadarVisualConfig(frontmatter): RadarVisualConfig`
  with the §2.2 defaults + `RADAR_WIRED_CONFIG_FIELDS` / `RADAR_NOOP_CONFIG_FIELDS` (wire-or-warn,
  mirror `src/quadrant/config.ts`), and `resolveRadarTheme` (mirror `xychart/parser.ts`
  `resolveXYChartTheme`) reading `themeVariables.radar.*` + `cScale0..12`.
- **EDIT** `src/mermaid-source.ts` — add `'radar'` to `RoutedDiagramType` (:839) ⛔; add
  `radar-beta` to `detectDiagramTypeFromFirstLine` (:854) and the loose detector (:880); add a
  `RadarRuntimeConfig` interface (near :61) and `radar?:` on `MermaidRuntimeConfig` (:301).

### Phase 2 — Layout + SVG

- **NEW** `src/radar/spline.ts` — **the one genuinely missing primitive**:
  `closedCardinalSplinePath(points, tension = 0.17): string` (closed Catmull-Rom→Bézier, d3
  `curveCardinalClosed` parity) + `polarPoint(cx, cy, r, angle)` reusing pie's convention
  (`x = cx + r·sinθ`, `y = cy − r·cosθ`; axis 0 at top, clockwise). Pure & deterministic.
- **NEW** `src/radar/layout.ts` — `layoutRadarChart(chart, options, visual): PositionedRadarChart`:
  value→radius scale; ring radii; axis angles + anchor from `cosθ` sign; per-curve vertices via
  `polarPoint`; `areaPath = graticule==='polygon' ? undefined : closedCardinalSplinePath(v,
  tension)`; legend metrics (reuse `pie/layout.ts`); a **2-pass gutter sizing** (like
  `quadrant/layout.ts`) so long axis labels never clip (**directly answers upstream #7683**);
  colors via `pieSliceColors(curves.length, {accent, bg, overrides: cScale})`.
- **NEW** `src/radar/renderer.ts` — `lowerRadarScene(ctx): SceneDoc` + `renderRadarSvg =
  DefaultBackend.render(lowerRadarScene(ctx))` (mirror `quadrant/renderer.ts`). Back-to-front
  emission: prelude → graticule rings (`shape` circle/polygon, role `grid`, fill none) → spokes
  (`shape` line, role `axis`) → **ring value labels** when enabled (`text`, role `axis` — our
  **#6473/#6481** differentiator) → per-curve area (`shape` polygon-or-path, role `radar-area`,
  `paint:{fill, stroke, strokeWidth, opacity: curveOpacity}`, `channels.category = curve.label`)
  → vertex dots (`shape` circle, role `point`) → axis labels (`text`, role `axis`,
  multi-line-aware) → legend (`group`) → title (`text`).
- **EDIT** `src/scene/ir.ts` — add role `'radar-area'` to `SceneRole` (:47); add optional
  `points?: {x,y}[]` to the `path` variant of `Geometry` (:72) so the smooth area can be
  polygonized by the sketch/wash backends (additive, keeps `scene-fidelity.test.ts` satisfied —
  crisp element stays `<path>`, semantic geometry stays `path`).
- **EDIT** `src/scene/rough-backend.ts` — add `'radar-area'` to `SKETCH_SHAPE_ROLES` (:39) and
  prefer `geom.points` for a `path` when present. Rings/spokes stay crisp (`grid`/`axis` are
  intentionally not sketched — keeps the scaffold readable). This is what earns the sketch/
  watercolor-wash aesthetic "for free" via `hybrid-backend.ts`.
- **EDIT** `src/render-family-hooks.ts` — imports + `registerRenderHooks('radar', {layout:
  ctx => layoutResult(layoutRadarChart(parseRadarChart(ctx.source.lines), ctx.options,
  resolveRadarVisualConfig(ctx.source.frontmatter)), {injectAccessibility:false}), renderSvg:
  svg(renderRadarSvg), lowerScene: scene(lowerRadarScene), renderAscii: …})` (mirror quadrant ~:280).

### Phase 3 — Agent-native typed mutation (required — definition of done, not a follow-up)

- **NEW** `src/agent/radar-body.ts` — `parseRadarBody(lines): RadarBody | null` (structured-or-
  opaque), `renderRadar(body): string` (canonical serializer, deterministic fixed order),
  `mutateRadar(body, op): Result<RadarBody, MutationError>` (`switch(op.kind)` with a `never`
  exhaustiveness guard), `verifyRadar(body, opts): LayoutWarning[]`. Template:
  `src/agent/quadrant-body.ts`.
- **EDIT** `src/agent/types.ts` ⛔ — `'radar'` in `DiagramKind` (:22); `RadarBody`; `| RadarBody`
  in `DiagramBody` (:689); `RadarValidDiagram` (:746); `| RadarValidDiagram` in
  `MutableValidDiagram` (:752); `asRadar` narrower (:784); `RadarMutationOp` union (:1033);
  `| RadarMutationOp` in `AnyMutationOp` (:1085); `| RadarBody` in `ValidDiagramPayload.body`
  (:1302). Re-export `RadarBody`/`asRadar` from `src/agent/index.ts`.
- **EDIT** `src/agent/mutate.ts` — add the typed `mutate(d: RadarValidDiagram, op: RadarMutationOp)`
  overload (:19).
- **EDIT** `src/agent/families-builtin.ts` — `registerFamily({id:'radar', detect: l =>
  l.startsWith('radar-beta'), extractLabels: extractRadarLabels, verify, buildSourceMap,
  ...structuredFamilyHooks('radar', {headerOk: h => /^radar-beta\s*:?\s*$/i.test(h), parseBody:
  parseRadarBody, serialize: renderRadar, mutate: mutateRadar})})` (mirror quadrant :837); write
  `extractRadarLabels` (title + axis labels + curve labels); add a `body.kind==='radar'` branch
  to `buildChartSourceMap` (:354).
- **EDIT** `src/agent/mutation-ops.ts` ⛔ — `radar: [...]` in `MUTATION_OPS_BY_FAMILY` (:9).
- **EDIT** `src/agent/op-schema.ts` ⛔ — `RADAR_SCHEMA` (mirror `QUADRANT_SCHEMA` :273) + `radar:
  RADAR_SCHEMA` in `SCHEMAS` (:326).
- **EDIT** `src/mcp/sdk-decl.ts` — `'radar'` in the declaration `DiagramKind`, a `RadarBody`
  interface, `RadarMutationOp`, `asRadar` narrower, and the `radar?:` config shape (doc-sync
  enforced).

**Proposed radar op set** (axes and curves are coupled — every curve carries one value per
axis, so axis edits re-shape all curves; the mutator enforces this invariant):

```
set_title(title)
add_axis(name, label?, index?, fill?)      remove_axis(name)   rename_axis(from,to)
set_axis_label(name, label)                reorder_axis(from,to)
add_curve(name, label?, values[], index?)  remove_curve(name)  rename_curve(from,to)
set_curve_values(name, values[])           set_curve_value(curve, axis, value)
set_curve_label(name, label)               reorder_curve(from,to)
set_config(max?, min?, ticks?, graticule?, showLegend?)
```

### Phase 4 — ASCII

Radar maps poorly onto a character grid (no braille/sub-cell/float-rasterizer primitives
exist, and every other chart family drops exact geometry). **Recommendation: a grouped
proportional-bar table** (grouped by axis, one colored bar per curve + a curve legend) —
structured like `src/ascii/pie.ts`, reusing `pieSliceColors`, `padEndToVisualWidth`,
`wrapText`, `colorizeText`. Deterministic integer cell math.

- **NEW** `src/ascii/radar.ts` — `renderRadarAscii(lines, config, colorMode, theme,
  frontmatter?, targetWidth?): string` (mirror `pie.ts`; re-parse via `parseRadarChart`).
- **EDIT** `src/render-family-hooks.ts` — `renderAscii` in the radar block (import at ~:66).
- **EDIT** `src/ascii/index.ts` doc-comment enumerating families (:6–19); **EDIT**
  `src/ascii/meta.ts` — a `body.kind==='radar'` branch in `candidatesForDiagram` (mirror pie).

### Phase 5 — Quality / rubric

- **EDIT** `src/agent/family-layouts.ts` ⛔(test) — `radarToRendered(d, opts)` + `case 'radar':`
  in `layoutFamilyToRendered` (:115), projecting spokes/vertices/legend into `RenderedLayout`
  (vertices as `role:'labelled-mark'`; the citizenship test requires `layoutMermaid(base).nodes
  .length > 0`).
- **EDIT** `src/family-rubric.ts` — add `radar: 'center'` to `GROUP_CONTAINMENT_AXES` (:119) if
  needed; ship an `assessRadarLayout` (modeled on `assessJourneyLayout`) with **HARD**
  radar-specific checks: axis-label collision around the circle, vertices on-axis at scaled
  radius, value→radius monotonicity within the outer ring, rings evenly spaced, legend disjoint
  from the plot. Register a stable `RADAR_RUBRIC_WEIGHTS`.

### Phase 6 — Metadata + the compile-forced registry spine

- **EDIT** `src/agent/families.ts` ⛔ — a `BUILTIN_FAMILY_METADATA` row: `{id:'radar',
  label:'Radar', headers:['radar-beta'], narrower:'asRadar', editorDiagramType:'Radar',
  editorExampleId:'radar-basic', editorGlyph:'R', example:'radar-beta\n  axis a["Speed"],
  b["Power"], c["Range"]\n  curve x["Model X"]{4,5,3}\n  curve y["Model Y"]{5,3,4}'}`. (Note:
  header is **`radar-beta`**, not `radar`.)
- **EDIT** `src/shared/family-config-diagnostics.ts` ⛔ — `radar:` in `FAMILY_CONFIG_SPECS`
  (:37) + a `radar:` block in `FAMILY_VALUE_RULES` (:106).

### Phase 7 — Tests (red→green; must fail when the fix is reverted)

- **NEW** `src/__tests__/radar-parser.test.ts`, `radar-layout.test.ts`, `radar-integration.test.ts`,
  `radar-renderer.test.ts` (+ golden SVG under `testdata/svg/`), `radar-ascii.test.ts`,
  `radar-config.test.ts`, `property-radar.test.ts` (fast-check round-trip), `agent-radar.test.ts`
  (parse/narrow/mutate/verify/serialize + structured-or-opaque sad paths + the axis/curve
  coupling invariant + a differential test that our canonical source re-parses identically under
  `parseRadarChart`).
- **EDIT (⛔ compile-forced test maps):** `helpers/metamorphic-families.ts` (:46),
  `helpers/family-count-fixtures.ts` (≥1 radar fixture), `ascii-target-width.test.ts` (:13),
  `agent-doc-sync.test.ts` NARROWERS (:434), `mermaid-upstream-suite-bench.test.ts` (:112),
  `diagram-family-citizenship.test.ts` (`MUTATION_CONFIG_NEEDLES` :50, `REQUIRED_FAMILY_EVIDENCE`
  :67), `doc-sync.test.ts` (:99, :212), `scripts/pr-assets/brand-primitives-probe.ts` (:227),
  `website/build.ts` (:631).
- **NEW** `stryker.radar.config.json` (or reuse `stryker.families.config.json`) covering
  `src/agent/radar-body.ts` + `src/radar/parser.ts`; wire a `mutation-test:radar` lane in
  `package.json` + `.github/workflows/nightly-route-mutation.yml`.
- Regenerate baselines: `layout-geometry-baseline.json`, `svg-output-baseline.json`,
  `styled-output-baseline.json`, and `bun run goldens:ascii`.

### Phase 8 — Docs, editor, samples, citizenship

- **NEW** `docs/design/families/radar.md` (design note, mirror `quadrant.md`) + `radar-demo.mmd`
  + captioned before/after renders.
- **EDIT** `docs/diagram-families.md`, `README.md` (families list), `AGENT_NATIVE.md` (family
  row + narrower list + mutate overload + a "Radar MutationOp kinds" section),
  `Instructions_for_agents.md` (mirror), regenerate `llms.txt`.
- **EDIT** `docs/contributing/diagram-family-citizenship.matrix.json` ⛔(test) — a `radar` row
  with all surfaces `satisfied` + evidence, `mermaidSyntaxParity` and `familyVisualMetaphor`
  cells (pinned Mermaid docs + Wikipedia + a named signature + an independent geometry test +
  a committed artifact).
- **EDIT** `editor/js/examples.js` (basic radar example + `Radar:'R'` glyph;
  `editor-examples.test.ts` enforced), `scripts/site/samples-data.ts` (radar samples),
  `skill-evals/shared-benchmark.json` (≥1 fixture-backed `family:radar` case),
  `skills/agentic-mermaid-diagram-workflow/references/{cli,code-mode}.md`, `src/cli/index.ts`
  capabilities prose (:235).

### Condensed file ledger

**NEW (core):** `src/radar/{types,parser,layout,renderer,config,spline}.ts`,
`src/ascii/radar.ts`, `src/agent/radar-body.ts` + tests + `docs/design/families/radar.md` +
`stryker.radar.config.json`.

**EDIT (compile-forced spine — miss one and `tsc`/`satisfies`/a coverage assertion fails):**
`mermaid-source.ts` (RoutedDiagramType 839, both detectors, RadarRuntimeConfig,
MermaidRuntimeConfig 301) · `agent/types.ts` (DiagramKind 22, RadarBody, DiagramBody 689,
RadarValidDiagram 746, MutableValidDiagram 752, asRadar 784, RadarMutationOp 1033,
AnyMutationOp 1085, payload 1302) · `agent/mutate.ts` · `agent/families.ts`
(BUILTIN_FAMILY_METADATA 131 + assertion 169) · `agent/families-builtin.ts` · `render-family-
hooks.ts` · `agent/family-layouts.ts` · `agent/mutation-ops.ts` · `agent/op-schema.ts` ·
`shared/family-config-diagnostics.ts` · `mcp/sdk-decl.ts` · `scene/ir.ts` +
`scene/rough-backend.ts` · the ~10 test/registry maps in Phase 7.

---

## Part 6 — Key decisions & recommendations

1. **Header is `radar-beta`, not `radar`.** Mermaid ships no stable `radar` alias. Model the
   three spellings (`radar-beta`, `radar-beta:`, `radar-beta :`). *(Corrects a plausible
   `startsWith('radar')` shortcut — it would mis-detect and break header round-trip.)*
2. **Default: circle graticule + mild smooth curve** (spec-faithful: `graticule circle`,
   `curveTension 0.17`). Expose polygon + straight edges as the documented toggle. Keep
   curvature gentle so category discreteness isn't erased.
3. **Ship the two unmet upstream asks as our differentiators** — **ring value labels**
   (#6473/#6481) via a config flag, and **long-axis-label wrap/multi-line + 2-pass gutter
   sizing** (#7683) via existing `measureMultilineText`. Both are additive beyond core parity;
   record them in the divergence ledger as **enhancements** (Mermaid renders without them, so
   they must be off-by-default-compatible / not change parse semantics).
4. **The dashed "frontier" curve is a *style extension*, not core syntax.** Adding non-Mermaid
   body keywords would break "full Mermaid syntax support" + round-trip. Deliver it either via
   (a) the **style stack** (a per-curve dashed/outline-only treatment, like the rough/hybrid
   styles) or (b) a **modeled per-curve style annotation** analogous to quadrant point styles
   (upstream #5173) that round-trips. Keep `radar-beta` body syntax pure.
5. **Guard Mermaid's unguarded cases** (`min>max`, `min==max`, positional arity mismatch) with
   named Tier-3 diagnostics + divergence-ledger entries instead of emitting NaN/silent drops —
   required by the citizenship "fail loudly" rule.
6. **ASCII = grouped bar table**, not a braille spider — consistent with how every other chart
   family degrades and with Mermaid ASCII being out-of-medium for polar.
7. **Additive IR change only:** one new `radar-area` role + optional `points?` on path
   geometry. No new mark *kinds*; rings/spokes/dots/labels/legend/title all reuse existing
   `ShapeMark`/`TextMark`/`GroupMark`.

## Part 7 — Risks & mitigations

| Risk | Mitigation |
|---|---|
| Closed-spline helper diverges from d3 `curveCardinalClosed` → curves don't match Mermaid | Port the exact Catmull-Rom→Bézier formula; unit-test against Mermaid's `closedRoundCurve` sample coordinates from `radar.spec.ts`; `tension 0` must degenerate to the polygon. |
| Long axis labels clip (the upstream bug) | 2-pass gutter sizing + `measureMultilineText`; a rubric check asserts every label box is within bounds. |
| Smooth filled area doesn't sketch/wash | Emit vertex `points?` on the path so `hybrid`/`rough` can polygonize (Phase 2 IR edit). |
| Missing a compile-forced registry entry | The `satisfies`/coverage assertions and citizenship test *are* the checklist — `bunx tsc --noEmit` + `bun test` will name every gap. |
| Area-exaggeration / arbitrary axis order misleads | Deterministic stable axis order (repo mandate), shared 0→max default, explicit max ring; aesthetic rubric check #6. |
| Beta syntax churns upstream | It's `-beta`; pin the Mermaid version in the fidelity audit + divergence ledger and revisit on upstream changes (e.g. if #6481 merges, align our tick-label config names). |

## Part 8 — Suggested sequencing

Phase 0 (harvest) → Phase 1 (model/parser) → Phase 2 (layout/SVG, incl. spline) → Phase 3
(agent-native) → Phase 4 (ASCII) → Phase 5 (rubric) → Phase 6 (registry spine) in lockstep with
1/3 → Phase 7 (tests, red→green verified) → Phase 8 (docs/citizenship). Realistically 2–4 focused
PRs: (A) parser+types+registry spine (renders nothing yet, compiles), (B) layout+SVG+spline+scene,
(C) agent-native+ASCII+rubric, (D) tests+docs+citizenship — or one large PR if the citizenship
gate is satisfied in a single pass.

---

*Sources: Mermaid issues/PRs #2280, #6381, #6473, #6481, #7076, #7188, #7333, #7683, #7781;
Beautiful Mermaid #40, #59; Mermaid ASCII #74; Mermaid `radar.langium` / `db.ts` / `renderer.ts`
/ `radar.spec.ts`; Wikipedia "Radar chart"; Nadieh Bremer, data-to-viz, Observable, Highcharts.
Full crawl transcripts retained in the session research artifacts.*
