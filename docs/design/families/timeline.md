# Timeline (`timeline`) Design Note

## Overview

Design choices behind Agentic Mermaid's `timeline` implementation: Mermaid
syntax compatibility with output native to the rest of the library.

Pipeline:

- `src/timeline/parser.ts` — renderer-grade parser → `TimelineDiagram`
- `src/agent/timeline-body.ts` — structured `TimelineBody` (parse / serialize /
  mutate; structured-or-opaque fallback)
- `src/timeline/layout.ts` — one placement walk for both orientations
- `src/timeline/renderer.ts` — SceneGraph lowering + crisp SVG
- `src/ascii/timeline.ts` — chronological outline for terminals

The renderer parser and agent body share `src/timeline/parse-core.ts` for
header/content directives and event splitting. A colon starts a new event only
when followed by whitespace, so `10:30` remains text on both surfaces.
Event-less periods are modeled and serialize in the bare form (`2020`) accepted
by the renderer; a dangling `2020 :` remains losslessly opaque instead of
producing canonical source the renderer would reject.

## Input model

Supported Mermaid constructs:

- `timeline`, `timeline LR`, `timeline TD` (direction rides the header line)
- `title ...`
- `accTitle: ...`, `accDescr: ...`, multiline `accDescr { ... }`
- `section ...`
- `<period> : <event> [ : <event> ...]`, continuation lines `: <event>`,
  bare event-less periods (`release now`)
- Mermaid comments, frontmatter, and init directives

### Direction contract (upstream PR #7270, v11.14+)

Upstream's jison lexer accepts exactly two direction tokens, on the header
line only:

```
timeline LR   ← horizontal, the default
timeline TD   ← vertical
```

Agentic Mermaid matches that contract, with two deliberate tolerances:

- the token is case-insensitive (`timeline td` works — the source router
  already lowercases headers when routing);
- the `tb`/`bt`/`rl` tokens the router historically tolerated stay
  accepted-and-ignored (horizontal), so existing sources render unchanged.

Any other header suffix (`timeline EXTRA`) keeps the pre-existing behavior:
the agent surface preserves it verbatim as an opaque body.

On the agent surface, `TimelineBody.direction?: 'LR' | 'TD'` captures the
explicit token (undefined = bare header) and the serializer re-emits it, so
direction survives parse → mutate → serialize. There is deliberately no
`set_direction` op yet — direction is not part of the journey-parity op
convention this family mirrors; edit the header through source until a
dedicated op is scheduled.

## Layout strategy

### One placement walk, two orientations

`layoutTimelineDiagram` computes geometry along a **main axis** (the direction
periods advance in) and a **cross axis** (pill band → rail → event stacks),
then maps to screen x/y at materialization:

- **LR** maps main→x, cross→y: pills above a horizontal rail, event cards
  stacked below each period — the historical layout, byte-identical by
  construction (the arithmetic is the same expressions on the same numbers;
  the corpus SVG/layout golden gates pin it).
- **TD** maps main→y, cross→x: periods flow downward along a vertical rail,
  pills sit left of the rail, event cards run rightward from it.

Boxes never rotate — text measurement is orientation-independent — only
positions map through the axis frame. Two pieces of header furniture are
deliberately outside the transform: the title always spans the top of the
canvas, and section header bands stay horizontal (they consume cross-axis
space in LR and main-axis space in TD).

Invariant tests (`src/__tests__/timeline-direction.test.ts`) pin the
transform: TD periods advance monotonically in y, the rail is vertical,
pills/events stay on their side of the rail, every box stays inside the
canvas and its section frame, and explicit `timeline LR` is
geometry-identical to the bare header.

### Width control

`renderMermaidSVG(source, { timeline: { maxWidth: px } })` is a best-effort
width budget for **horizontal** timelines (a 13-period chart renders ~2,500px
wide unconstrained). When the projected width exceeds the budget, the layout
derives a per-column budget from the fixed overhead and re-runs the metric
pass once with proportionally compressed wrap caps and box minimums — reusing
the existing `wrapTimelineText` machinery, never a second wrapper. Properties:

- no-op when the chart already fits (the default path stays byte-identical);
- deterministic (a pure function of the same inputs);
- floor of 36px on wrap caps so labels never wrap to letter soup;
- best-effort: unbreakable tokens and extra-wide section headers can still
  exceed the budget;
- ignored in TD mode (vertical timelines are inherently narrow) — `timeline
  TD` is the recommended answer for long timelines.

Not yet exposed as a CLI flag or a frontmatter config key (upstream has no
such key; inventing one in the upstream-shaped config space was deliberately
avoided).

## Config contract (wire-or-warn, P4)

Wired `timeline` config keys (frontmatter / init / `mermaidConfig`):

| Key | Effect |
| --- | --- |
| `disableMulticolor` | collapses every color family to family 0 — for per-period families **and** labeled per-section families (the labeled-section gate was fixed under plan §Timeline 3; upstream semantics) |
| `sectionFills` | explicit family fill palette |
| `sectionColours` | explicit family label palette |

Theme variables `cScale0..11` / `cScaleLabel0..11` / `cScaleInv0..11` feed the
same palette derivation.

Everything else in upstream's documented `TimelineDiagramConfig` — the
journey-shaped sequence-era remainder (`diagramMarginX/Y`, `leftMargin`,
`width`, `height`, `padding`, `boxMargin`, `boxTextMargin`, `noteMargin`,
`messageMargin`, `messageAlign`, `bottomMarginAdj`, `rightAngles`,
`taskFontSize`, `taskFontFamily`, `taskMargin`, `activationWidth`,
`textPlacement`, `actorColours`) plus the base `useMaxWidth`/`useWidth` — is
accepted for config-shape compatibility but has no effect here, and verify
names each present field with the Tier-3 `INEFFECTIVE_CONFIG` lint
(`TIMELINE_NOOP_CONFIG_FIELDS` in `src/agent/verify.ts`, journey pattern).

## Agent surface

`asTimeline` narrows to a structured body. The authoritative operation menu is
`MUTATION_OPS_BY_FAMILY.timeline`:

- `set_title`
- `add_section(label, index?)` / `remove_section(index)` /
  `set_section_label(index, label)`
- `add_period(sectionIndex, label, events?, index?)` /
  `remove_period` / `set_period_label`
- `add_event(sectionIndex, periodIndex, text, index?)` /
  `remove_event` / `set_event_text`
- `move_period(fromSection, fromIndex, toSection, toIndex)`
- `move_event(fromSection, fromPeriod, fromIndex, toSection, toPeriod, toIndex)`
- `move_section(from, to)`
- `set_accessibility_title(title | null)` /
  `set_accessibility_description(description | null)`

Conventions (mirroring what journey got in PR #141):

- `index?` on the add ops is an insert position (omit = append), validated
  with a prescriptive range error (`Timeline insert index 9 out of range
  (0..2)`).
- move ops take the insert position **after removal**; bad positions name the
  legal range. Not-found errors carry a `(valid: 0..N-1)` hint.
- moving the last period out of an implicit (unlabeled) section drops the
  emptied section, matching `remove_period`.
- accessibility text rejects `;`, `{`, `}` (they could not survive
  serialize → re-parse); multi-line descriptions serialize in the
  `accDescr { ... }` block form.
- a timeline with only a title / accessibility metadata / period-less
  sections verifies as renderable header furniture (upstream parity), not
  `EMPTY_DIAGRAM`.

A differential test (gantt convention) pins the body↔renderer seam: the
canonical source the body serializer emits — including direction and
accessibility metadata — must re-parse identically under
`parseTimelineDiagram` (`src/__tests__/agent-timeline.test.ts`).

## ASCII

The terminal renderer is a chronological outline (title, `[section]`
brackets, `○ period` markers, `├─ event` branches). It is
orientation-agnostic: `timeline TD` renders the same outline as `timeline LR`
by construction (the outline is already vertical).

## Test map

- `src/__tests__/timeline-parser.test.ts` — renderer-grade parser incl.
  direction tokens
- `src/__tests__/timeline-layout.test.ts` — horizontal layout geometry
- `src/__tests__/timeline-direction.test.ts` — TD invariants, LR identity,
  width control
- `src/__tests__/timeline-integration.test.ts` — end-to-end SVG incl.
  `disableMulticolor` with labeled sections
- `src/__tests__/timeline-ascii.test.ts` — outline renderer incl. TD parity
- `src/__tests__/agent-timeline.test.ts` — body parse/serialize/mutate, full
  registry operation menu, differential vs the renderer parser, `INEFFECTIVE_CONFIG`
- `src/__tests__/property-layout-bounds.test.ts` — fast-check bounds over the
  positioned layout
- corpus gates: `svg-equivalence` / `layout-equivalence` /
  `styled-output` / `scene-fidelity` (the `timeline TD` corpus entry
  `corpus/timeline/5` renders vertically; its golden records were regenerated
  surgically for that reason)
