# User Journey (`journey`) Design Note

## Overview

This document captures the design choices behind Agentic Mermaid's `journey`
implementation. The goal is Mermaid syntax and visual-metaphor compatibility
with output that still feels native to the rest of the library rather than like
a separate embedded renderer.

The implementation follows the standard Agentic Mermaid pipeline:

- `src/journey/parse-core.ts` — the single Journey grammar (statement
  classification, normalization, accessibility blocks) shared by every
  consumer below, so parsing surfaces cannot drift
- `src/journey/parser.ts` — walk events → `JourneyDiagram` for rendering
- `src/agent/journey-body.ts` — walk events → structured `JourneyBody`
  (typed parse issues explain any opaque fallback)
- `src/journey/layout.ts`
- `src/journey/renderer.ts`
- `src/ascii/journey.ts`

## Input Model

Supported Mermaid constructs:

- `journey`
- `title ...`
- `section ...`
- scored tasks in the form `Task: 1..5[: Actor, Actor]`
- `accTitle: ...`
- `accDescr: ...`
- multiline `accDescr { ... }`
- Mermaid comments, frontmatter, and init directives before the header
- `;`-separated statements (upstream lexer parity: a semicolon terminates a
  statement, so `A: 5: Me; B: 3: Me` is two tasks — while HTML entities like
  `&amp;` keep their semicolons as literal label text)

Quoted labels are normalized the same way other Agentic Mermaid diagram
parsers normalize Mermaid labels. `<br>` is converted to multi-line text for
titles, section labels, tasks, actor labels, and accessibility metadata.

## Layout Strategy

Journey diagrams are rendered as a left-to-right experience curve:

- tasks are laid out in source order as horizontal task columns
- named sections are tiled spans: each span is wide enough for both its tasks
  and its header label, tasks center inside the span, and the next span starts
  after the previous one — spans cannot overlap by construction
- unnamed implicit sections stay unframed
- actors are collected into a left legend in first-seen order
- task participation is shown with compact actor-colored dots (derived actor
  colors rotate hue per actor and are sized to the actual actor count, so two
  actors never share a dot color)
- score `5` maps to the highest guide position and score `1` maps to the
  lowest guide position
- a smooth experience-curve line connects the score markers in task order
  beneath the faces (upstream Mermaid draws no connecting line; disable with
  `render(source, { journey: { experienceCurve: false } })` for the classic
  marker-only look)
- each task gets a vertical track from its task box to the progression baseline
- each score is rendered as a sentiment marker on the curve
- the baseline arrow reinforces forward progression and overshoots the last
  section slightly; the canvas reserves only arrowhead clearance below the
  baseline (no dead bottom band)
- long task and section labels wrap at the shared `maxLabelWidth` cap instead
  of stretching the plot (CJK breaks without inserted hyphens)

The layout uses the shared text measurement helpers so task boxes, section
spans, and the actor legend expand from content rather than from hardcoded label
assumptions.

## Visual Language

The renderer follows Mermaid's Journey metaphor while preserving the higher
quality Agentic Mermaid treatment:

- crisp rounded task boxes and section spans
- subtle tinted section fills instead of heavy blocks
- compact actor dots instead of noisy repeated labels
- score guide lines and a restrained baseline rather than a full chart frame
- theme-driven colors via shared CSS custom properties instead of renderer-local
  default-blue assumptions

This keeps the diagram family distinct from flowcharts while still matching the
library's spacing, contrast, and restraint.

## Style, Palette, And Mermaid Config

Journey uses the same public Style + Palette stack as the rest of the SVG
pipeline. Named looks and palette-only styles control the family-wide treatment
(colors, typography, strokes, fills, and page treatment) without adding
Journey-specific public style fields.

Journey-specific visual channels are palette-aware. Section fills/bands,
section strokes, actor dots, score marker faces, score marker ink, and the
baseline all derive from Agentic Mermaid palette tokens unless Mermaid source
config provides a more specific Journey override.

Supported Mermaid `journey` config fields include:

- `actorColours`
- `sectionFills`
- `sectionColours`
- `taskFontSize`
- `taskFontFamily`
- `titleColor`
- `titleFontFamily`
- `titleFontSize`
- `taskMargin`
- `width`
- `height`
- `diagramMarginX`
- `diagramMarginY`
- `leftMargin`
- `maxLabelWidth`

`useMaxWidth` renders the responsive Mermaid contract (`width="100%"` with
`max-width` capped at the natural size). Explicit `sectionFills` are used
as-authored for the section label band (Mermaid semantics), and explicit
`sectionColours` are kept only when they clear WCAG AA against that band —
otherwise the label flips to the band's black/white contrast color instead of
rendering invisible text.

The sequence-era fields that do not map to this visual metaphor (`noteMargin`,
`messageMargin`, `messageAlign`, `bottomMarginAdj`, `rightAngles`,
`activationWidth`, `textPlacement`) are accepted in normalized config for
Mermaid compatibility but do not alter Journey SVG geometry; `verify` reports
them with an ineffective-config lint so migrating users are not misled.

## Accessibility

`accTitle` and `accDescr` are surfaced as root SVG accessibility metadata:

- root SVG gets `role="img"`
- root SVG gets `aria-roledescription="user journey"`
- `accTitle` maps to `<title>` and `aria-labelledby`
- `accDescr` maps to `<desc>` and `aria-describedby`
- when `accTitle` is absent, the visible Mermaid `title` becomes the fallback
  accessible title

Accessibility metadata is intentionally non-visual. It improves assistive
technology output without changing the rendered diagram layout.

## Known Boundaries

- Journey support currently models Mermaid's scored-task syntax, not richer
  swimlane semantics beyond section grouping.
- Accessibility metadata is surfaced in SVG output; PNG output inherits the
  rendered SVG pixels; ASCII output ignores it because it is not part of the
  visible terminal rendering model.
- Mermaid Journey config colors and Agentic style roles both affect SVG output;
  ASCII stays intentionally text-first and does not render color palettes.
