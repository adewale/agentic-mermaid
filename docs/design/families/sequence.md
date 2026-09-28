# Sequence family — elevation notes

Status: shipped-feature record for the family-elevation-plan §Sequence work
(the family predates the per-family design-doc convention; this document
records the contracts added by the elevation waves, not a full first-release
spec — the layout/renderer live in `src/sequence/`, the agent body in
`src/agent/sequence-body.ts`).

## Shipped in the elevation waves

- **Parser truth** (items 1/3/4): word-boundary block grammar shared with the
  agent body, standalone `activate`/`deactivate`, `-x`/`<<->>` arrows,
  `autonumber` rendering, `box … end` groups, `create`/`destroy` lifelines.
  Evidence: `sequence-parity-before.png` / `sequence-parity-after.png`.
- **Reorder/insert ops** (item 6, ops half): see
  `src/agent/op-schema.ts` sequence section and
  `src/__tests__/agent-sequence-ops.test.ts`.

## SequenceRuntimeConfig (item 6, config half — 2026-07)

Typed `sequence` config section (`SequenceRuntimeConfig` in
`src/mermaid-source.ts`), following the class/er/flowchart wire-or-warn
pattern. Wiring lives in `src/sequence/config.ts`; the verify lint's
unwired-key list is the sequence descriptor's `config.noopKeys` in
`src/agent/families.ts`.

### Wired keys (natural mappings in `src/sequence/layout.ts`)

| Key | Upstream meaning | Mapping here |
|---|---|---|
| `actorMargin` | margin between actors (default 50) | edge-to-edge actor gap: center gap = (w₁+w₂)/2 + actorMargin (upstream's exact formula). Unset keeps the historical floor `max(140, halfWidths + 40)`. |
| `width` / `height` | actor box size (150/65) | actor box minimums (historical defaults 80/40 preserved when unset) |
| `diagramMarginX` / `diagramMarginY` | outer margins (50/10) | outer padding (historical 30 preserved when unset) |
| `messageMargin` | space between messages (35) | vertical advance per message row (historical 40 preserved) |
| `noteMargin` | margin around notes (10) | note-to-actor gap (historical 10) |
| `activationWidth` | activation rect width (10) | activation rect width (historical 10) |
| `showSequenceNumbers` | show node numbers (false) | starts the diagram with autonumbering on, threaded into `parseSequenceDiagram` so SVG **and** ASCII agree; an explicit `autonumber` directive still wins from its own line |

Absent or empty config uses the canonical sequence defaults; each explicit
knob overrides only its documented layout field.

### Unwired keys → INEFFECTIVE_CONFIG

Everything else documented on upstream's `SequenceDiagramConfig` — <!-- BEGIN GENERATED: noop-keys:sequence -->`actorFont`, `actorFontFamily`, `actorFontSize`, `actorFontWeight`, `arrowMarkerAbsolute`, `bottomMarginAdj`, `boxMargin`, `boxTextMargin`, `forceMenus`, `hideUnusedParticipants`, `labelBoxHeight`, `labelBoxWidth`, `messageAlign`, `messageFont`, `messageFontFamily`, `messageFontSize`, `messageFontWeight`, `mirrorActors`, `noteAlign`, `noteFont`, `noteFontFamily`, `noteFontSize`, `noteFontWeight`, `rightAngles`, `useMaxWidth`, `useWidth`, `wrap`, `wrapPadding`<!-- END GENERATED: noop-keys:sequence --> — is accepted for config-shape compatibility
and named per key by verify's Tier-3 `INEFFECTIVE_CONFIG` lint (the exact
list is the sequence descriptor's `config.noopKeys` in
`src/agent/families.ts`). Font keys stay unwired deliberately:
typography routes through the style system (`RenderOptions.style` roles),
not per-family config.

Evidence: `sequence-config-before.png` / `sequence-config-after.png`
(source `sequence-config-demo.mmd`) — actorMargin/width/height/
messageMargin tuning plus `showSequenceNumbers` message numbering.
