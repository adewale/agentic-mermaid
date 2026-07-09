# Journey Migration Parity Spec

Status: implemented for SVG visual metaphor, structured accessibility/literal text parity, marker namespacing, ASCII width handling, and style/palette/config coverage
Last reviewed: 2026-07-09
Issue: https://github.com/adewale/agentic-mermaid/issues/128
Origin: https://github.com/adewale/agentic-mermaid/pull/6
Research: [`journey-usage-research.md`](./journey-usage-research.md)

## Problem

Journey diagrams had two different gaps that were easy to conflate:

1. Some Mermaid Journey syntax was parsed by the renderer path but still caused
   the agent structured parser to fall back to opaque source preservation.
2. Agentic Mermaid's previous Journey SVG used a card-based visual language,
   while Mermaid's native Journey renderer uses a timeline-like experience curve.

The first gap was a correctness and migration-support issue. The second is a
visual parity issue. Pre-launch, we do not need to preserve the previous
card-based Journey layout as public behavior. The chosen direction is to make
Mermaid's Journey visual metaphor the default public renderer.

## Origin

Journey support was not originally requested through a tracked Agentic Mermaid
issue. It landed in
[`#6`](https://github.com/adewale/agentic-mermaid/pull/6), whose PR body says:
there was "no tracked issue in this fork for the change." The immediate
trigger was that Mermaid `journey` input failed with:

```text
Invalid mermaid header: "journey"
```

So the original implementation solved family coverage first: parse Mermaid
Journey syntax, route it through SVG and ASCII rendering, preserve accessibility
metadata, and add tests. The visual model was then made to fit the library's
existing card-like house style. That is where the implementation diverged from
Mermaid's own Journey metaphor.

## Goals

- Preserve Mermaid Journey syntax as structured data whenever the syntax is part
  of Mermaid's documented Journey grammar.
- Make parser failures explainable instead of silently collapsing to opaque.
- Make `describe`, facts, verification, and ASCII output expose the same Journey
  semantics that the SVG renderer consumes.
- Make the public SVG Journey renderer use Mermaid's Journey visual metaphor:
  a left-to-right experience curve with section spans, actor legend, actor
  dots, score-positioned sentiment marks, and a progression baseline.
- Treat the current card layout as an implementation artifact unless we later
  choose to expose it as an explicitly named alternate look.

## Current Syntax Support Snapshot

Agentic Mermaid now supports the documented Mermaid Journey grammar in both the
renderer parser and the structured agent parser:

- `journey` header;
- `title ...`;
- `accTitle: ...`;
- inline `accDescr: ...`;
- block `accDescr { ... }` and `accDescr: { ... }`;
- `section ...`;
- task lines in the documented form `Task name: <score>: <actor>, <actor>`;
- task lines without actors, which Mermaid accepts in practice;
- comments, YAML frontmatter, and `%%{init: ...}%%` / `%%{initialize: ...}%%`
  directives before parsing;
- `<br>` / `<br/>` label normalization for title, section, task, and actor
  text;
- title/accessibility-only Journey header furniture.

Mermaid's official docs define the score as an integer from 1 through 5. The
parser enforces that range rather than accepting Mermaid's currently buggy
out-of-range face placement behavior.

The implementation also accepts the current Mermaid `JourneyDiagramConfig`
shape:

- margins and sizing: `diagramMarginX`, `diagramMarginY`, `leftMargin`,
  `maxLabelWidth`, `width`, `height`, `taskMargin`;
- title/task typography: `taskFontSize`, `taskFontFamily`, `titleColor`,
  `titleFontFamily`, `titleFontSize`;
- Journey colors: `actorColours`, `sectionFills`, `sectionColours`;
- sequence-era compatibility fields present on Mermaid's Journey config:
  `boxMargin`, `boxTextMargin`, `noteMargin`, `messageMargin`, `messageAlign`,
  `bottomMarginAdj`, `rightAngles`, `activationWidth`, `textPlacement`.

The fields that visibly affect the current Journey SVG are the Journey-specific
layout, typography, and color fields. The sequence-era fields are accepted for
Mermaid config compatibility but do not all have meaningful Journey geometry.

Known remaining syntax/parity gaps and caveats:

- Semicolon-separated Journey statements are not modeled. This is not part of
  the documented Journey syntax, but Beautiful Mermaid issue #7 shows terminal
  users notice semicolon compatibility in Mermaid-like renderers.
- Journey ASCII remains a compact semantic list, not a visual clone of
  Mermaid's SVG Journey chart. It now wraps to `maxWidth` using terminal display
  width, including CJK/emoji text, but it is intentionally not a miniature SVG
  curve renderer.
- Journey marker IDs are no longer the fixed `journey-arrowhead`; they are
  derived from the diagram content and also participate in the repo-wide
  `idPrefix` post-pass. Two different Journey diagrams no longer collide by
  default. Repeated identical SVGs on the same page still need distinct
  `idPrefix` values, matching the existing multi-diagram embedding contract.

## Non-goals

- Do not expand Journey into full customer journey mapping, service blueprinting,
  emotional-lifecycle canvases, or swimlane workflow modeling in this issue.
- Do not make Journey a flowchart variant.
- Do not rely on embedding Mermaid's renderer as a black box.
- Do not change the meaning of Mermaid Journey scores. Scores remain integers
  from 1 through 5.

## Current Failure Modes

### Parser split

There are two Journey parsers with different responsibilities:

- `src/journey/parser.ts` powers the Journey renderer.
- `src/agent/journey-body.ts` powers structured agent parsing and mutations.

The renderer and structured agent parsers now accept Journey accessibility
directives:

- `accTitle: ...`
- `accDescr: ...`
- multiline `accDescr { ... }`

It also normalizes quoted labels and `<br>` tags.

The agent body parser now models those accessibility directives as part of the
Journey body, so their presence no longer forces an opaque fallback. Title-only
and accessibility-only Journey header furniture also stays structured when it is
otherwise valid.

This is where the implementation had gone wrong: accessibility was handled as a
rendering concern, but it is also part of the family syntax contract. Every
Journey syntax line that the renderer accepts must either be represented in
`JourneyBody`, represented as shared diagram metadata without forcing an opaque
body, or produce a targeted diagnostic.

### Opaque fallback

`structuredFamilyHooks` treats Journey parse misses as opaque source.
The verifier still reports broad `UNSUPPORTED_SYNTAX` / `journey_opaque`
diagnostics for genuinely unmodeled source. That preserves source, which is
good, but migration tooling benefits when common malformed cases are separated:

- unsupported documented syntax,
- malformed score,
- parser drift between renderer and agent paths,
- or genuinely unknown Journey extension.

Invalid Journey scores now receive a Journey-specific diagnostic. Broader
malformed-line taxonomy is still a useful future refinement.

### Incomplete semantic surfaces

Structured Journey output still has room to become richer:

- JSON describe output exposes task nodes but not a full Journey model.
- Facts mention labels but do not summarize sections, score ranges, actor
  participation, or Journey accessibility.
- Verification offers targeted invalid-score diagnostics, but not yet precise
  remediation for every malformed-line class.
- ASCII width handling now wraps Journey task and actor text to `maxWidth` using
  terminal display width; a visual clone of the SVG curve remains out of scope.

### Visual expectation mismatch

Before this migration, Agentic Mermaid's Journey renderer presented the diagram
as section columns containing stacked task cards. Native Mermaid Journey diagrams present
the same syntax as a left-to-right journey, where each task is a point in a
progression and its score controls vertical placement.

That difference is not a small styling mismatch. It changes the user's first
read of the diagram:

- Agentic Mermaid reads as a structured checklist grouped by section.
- Mermaid Journey reads as an experience curve over time.

## Mermaid Journey Visual Model

Mermaid's native Journey renderer treats tasks as ordered points in a horizontal
progression:

- tasks are laid out left to right in source order,
- sections span horizontal ranges across consecutive task columns,
- actor names appear in a legend at the left,
- actor participation on a task is shown with small colored dots,
- each score maps to a vertical position,
- each scored point is represented by a face icon,
- a horizontal baseline or arrow reinforces forward progression.

Journey-specific Mermaid config includes controls for task spacing, task font,
actor colors, section fills, section colors, title color, left margin, and actor
label wrapping. The implemented renderer maps those fields onto the Mermaid-like
Journey metaphor while leaving sequence-era fields that do not apply to Journey
geometry as accepted compatibility metadata.

## Agentic Mermaid Visual Model

The previous Agentic Mermaid Journey renderer was documented in
`docs/design/families/journey.md` and implemented by:

- `src/journey/layout.ts`
- `src/journey/renderer.ts`
- `src/ascii/journey.ts`

It intentionally used Agentic Mermaid's house style:

- sections are side-by-side columns,
- tasks stack vertically inside each section,
- each task is a card,
- scores are shown as local five-cell meters,
- actors are shown as local text pills,
- section containers use crisp frames and header bands.

That model was useful for compact, scannable documents, but it was not visually
compatible with Mermaid Journey examples found in the wild.

## Visual Parity Strategy

Adopt Mermaid's Journey visual metaphor as the default public SVG renderer.

Prototype and visual evidence:

- [`journey-mermaid-classic-prototype.svg`](./journey-mermaid-classic-prototype.svg)
- [`journey-mermaid-classic-prototype.png`](./journey-mermaid-classic-prototype.png)
- [`journey-mermaid-classic-implementation.png`](./journey-mermaid-classic-implementation.png)

The old card layout has been removed from the public SVG renderer. If it ever
returns, it should be an explicitly named alternate look rather than the default.
The public default should remain Mermaid-compatible.

Possible type if the alternate survives:

```ts
type JourneyLook = "mermaid-classic" | "agentic-cards";
```

Default:

- Use `"mermaid-classic"`.

There is currently no public alternate card layout. If one survives later, its
setting should live near other render style options rather than in the parser:

```ts
render(source, {
  journey: {
    look: "agentic-cards"
  }
});
```

If the public API already has a stronger convention for family-specific render
options, use that convention instead.

## Mermaid-classic Acceptance Criteria

The `"mermaid-classic"` Journey layout must:

- place tasks in one left-to-right sequence using source order,
- calculate section spans from the number of tasks in each section,
- draw a left actor legend with stable actor colors,
- wrap long actor labels within a configured maximum label width,
- mark per-task actor participation with small colored dots,
- map score 5 to the highest positive position and score 1 to the lowest,
- render a neutral middle position for score 3,
- show score state with face icons or an equivalent unmistakable sentiment mark,
- draw a horizontal progression baseline or arrow,
- keep visible title and accessibility metadata behavior unchanged,
- support theme colors without hardcoded contrast regressions,
- avoid clipping long task labels, actor labels, and section names.

The implementation reuses the existing `JourneyDiagram` model. It does not
introduce a second syntax model.

## Parser and Model Spec

### JourneyBody

`JourneyBody` represents the supported Journey syntax consumed by the renderer:

- visible title,
- ordered sections,
- ordered tasks,
- score per task,
- actors per task,
- accessibility title,
- accessibility description,
- source locations when available through the shared source map.

Accessibility metadata also appears in shared diagram metadata, but its presence
does not force `JourneyBody` to become opaque.

### Shared normalization

Renderer and agent parsing share normalization behavior for:

- quoted labels,
- escaped quotes,
- `<br>` and `<br/>`,
- comments,
- frontmatter and init directives before the `journey` header.

The same source text should not produce different task labels depending on which
surface parsed it.

### Diagnostics

Journey diagnostics should distinguish at least:

- invalid score range,
- malformed task line,
- actor list parse failure,
- unsupported but preserved Journey line,
- parser drift between renderer and structured parser.

Opaque fallback is still allowed for source preservation, but it should include
the reason that triggered opacity.

## Describe, Facts, and Verify Spec

`describe(..., { format: "json" })` should expose a Journey body with:

- diagram kind,
- visible title,
- accessibility title and description when present,
- sections in source order,
- tasks in source order,
- task score,
- task actors,
- implicit section state for unsectioned tasks.

Text facts should include:

- section count,
- task count,
- actor count,
- score range,
- average score,
- lowest-scoring tasks,
- highest-scoring tasks,
- actor participation counts,
- accessibility title/description presence.

`verify` should report Journey-specific diagnostics instead of only generic
opaque warnings when the source is close enough to classify.

## ASCII Spec

Journey ASCII output should remain readable in plain terminals, but it should
honor width constraints:

- wrap task labels,
- wrap actor labels,
- keep score markers adjacent to the task they describe,
- preserve section order,
- avoid lines longer than `maxWidth` when a width is provided and feasible.

A Mermaid-classic ASCII mode is optional. The priority is making current ASCII
output truthful to the structured model and width contract.

## Follow-up Implementation Plan

1. Introduce a shared Journey parse core or shared normalization helpers so
   `src/journey/parser.ts` and `src/agent/journey-body.ts` cannot drift on
   documented syntax.
2. Extend `JourneyBody` and related JSON serializers for accessibility metadata
   and full section/task ordering.
3. Replace Journey opaque fallback with typed parse outcomes that carry a reason.
4. Update `verify` to map Journey parse outcomes to specific diagnostics.
5. Expand Journey facts and describe output.
6. Add richer Journey facts and JSON describe summaries.
7. Keep migration fixtures based on representative Mermaid Journey examples.
8. Decide separately whether the old card layout is worth reintroducing as a
   deliberately named alternate look.

## Test Plan

Add fixtures covering:

- `accTitle: ...`
- `accDescr: ...`
- multiline `accDescr { ... }`
- quoted title, section, task, and actor labels,
- `<br>` in title, section, task, actor, and accessibility text,
- score values 1 through 5,
- invalid scores 0, 6, and non-numeric scores,
- tasks before the first explicit section,
- long task labels,
- long actor labels,
- multiple actors per task,
- repeated actors across sections.

For each valid fixture, test:

- renderer parser output,
- agent structured body output,
- `describe` JSON,
- facts text,
- `verify` result,
- SVG accessibility metadata,
- ASCII output under a narrow `maxWidth`.

For the public Journey renderer, add SVG structure tests that assert:

- tasks advance horizontally,
- section spans cover the expected task columns,
- actor legend is present,
- actor dots are associated with the right tasks,
- score positions are monotonic from 1 through 5.

## Migration Decision

The current Journey renderer should be treated as a supported Agentic Mermaid
prototype that proved parser and renderer coverage, not as a public compatibility
contract. The failure was that the implementation made Journey exist by adopting
the library's card-layout house style instead of preserving Mermaid's Journey
visual metaphor.

The immediate fix for issue #128 should prioritize parser parity and diagnostics.
Pre-launch, the visual fix should replace the default SVG layout with the
Mermaid-style experience curve. The old card layout should be removed from the
public renderer unless we later decide to reintroduce it as a deliberately named
alternate look.
