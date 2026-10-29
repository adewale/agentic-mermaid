# Prepared text and owned rendering geometry

Status: landed in [PR 395](https://github.com/adewale/agentic-mermaid/pull/395)
on 2026-10-17 at `53056ec569781d6f5153f90b5bd563aa70f8c5c7`.
BUILD-36 and BUG-62–64 are complete. This is the acceptance and verification
record; the [delivery reconciliation](archive/prepared-text-geometry-delivery-2026-10.md)
distinguishes merged source from the still-unpublished release. The root
backlog owns unfinished work.

PR 394 landed the terminal compositor, chronology and numbering foundation
(T8, T10 and T11). PR 395 contributed prepared display/pixel/cell
text, complete text bounds (T1–T7), additional XY endpoint/fractional tick and
Radar occurrence corrections, and their compatibility/evidence checks. Its
branch was refreshed onto landed main at `c361f4b`; the compositor was a dependency,
not a new feature delivered again by PR 395.

The contract is one interpretation of authored display text, complete measured
geometry in the output's units, and stable ownership through projection. Each
family keeps its layout algorithm. Numeric scales and sequence control state
are evaluated at their own semantic boundary before painting.

## Tasks and verification

| Task | Deliverable | Verification |
| --- | --- | --- |
| T1 Interpret text once | Prepared runs retain source, literal/formatted policy, transform and hard breaks | Exact case, tags-as-text versus styling, entity-like text, blank lines, multiple spaces, formatting boundaries and uppercase expansion |
| T2 Fit pixel blocks | Resolved weight/tracking, multiline advances, grapheme-safe wrapping and break provenance | Width bounds, indivisible clusters, source reconstruction, impossible budgets, long words, CJK, composed/decomposed accents and emoji |
| T3 Fit cell blocks | Same display reading under the existing explicit cell-width policy | Independent cell-width checks, wide continuation integrity, locale independence, hard/soft width budgets |
| T4 Allocate containers | Complete title/header/legend/label space before placing content | Independent resvg on-canvas/contrast checks, header-to-content clearance, naturally expanding versus fixed canvases, both chart orientations |
| T5 Carry graphical geometry | Scene text and connector labels retain complete typography and occupied bounds | Emitted SVG fidelity, multiline/rotated bounds, bold/tracking, styled backends, external Scene admission remains enforced |
| T6 Project SVG advances | Prepared emission owns advances; compatibility projection respects literal content | Short and wrapped literal tags, continuous formatted runs, custom fonts, exact visible characters, renderer does not transform a positioned block again |
| T7 Cover every family role | Registry-wide family probes and directed supported-role cases | All 16 built-in families, titles and applicable nodes/edges/groups/notes/compartments/axes/legends, no title-only exemption |
| T8 Own terminal cells | Reuse #386 compositor for text spaces, padding, glyph continuations and structural marks | Label-on-stroke, punctuation-only labels, duplicate/wrapped labels, opaque notes, shared corridors, corners/arrowheads, region identity and color-mode parity |
| T9 Quantize numeric values once | XY ticks/bars/lines/baseline share one domain and scale | Explicit 1..14 range, zero baseline, negative and mixed signs, zero-length bars, half/whole cells, horizontal mode, coarse ticks and bar/line overlap |
| T10 Preserve sequence chronology | Lexical event ownership and complete cell bounds | Notes before/after end, nested and empty/note-only fragments, long alt/else headers, CJK notes and note padding |
| T11 Evaluate sequence controls once | Omitted fields and off/resume retain counter intent across formats | Bare enable/re-enable, explicit start/step, hidden increments, late enable, zero/fractional values, common message numbering in SVG/ASCII/layout |
| T12 Preserve compatibility and cost | Migrate existing authorities and remove redundant paths | Existing family suites, source/serialization fidelity, deterministic output, registration/extension contracts, bounded fitting, touched-cell/allocation stress and browser payload checks |
| T13 Deliver and independently audit | One reviewable PR with full-SHA before/after evidence and audit dispositions | Discriminating tests fail on base, typechecks/lint, full CI and quality gates, independent multi-agent review after PR creation, every finding fixed or explicitly resolved |

## Research cases

Keep cases at their owning boundary in existing table-driven suites. Upstream
reports inform expected user-visible behavior; they do not define our layout.

- Mermaid [6232](https://github.com/mermaid-js/mermaid/issues/6232),
  [6393](https://github.com/mermaid-js/mermaid/issues/6393) and
  [3806](https://github.com/mermaid-js/mermaid/issues/3806): long Pie/Timeline
  titles and multiline group headers. Extend with five authored lines, a long
  unbroken word, blank lines and resolved style weight/tracking.
- Mermaid [7794](https://github.com/mermaid-js/mermaid/issues/7794) /
  [8233](https://github.com/mermaid-js/mermaid/pull/8233): fractional measurement
  boundaries. Keep pixel tolerances separate from integer cell arithmetic.
- Beautiful Mermaid [128](https://github.com/lukilabs/beautiful-mermaid/pull/128)
  and Zombie [232](https://github.com/dfadler/zombie-mermaid/pull/232): CJK,
  combining marks, flags, modifiers, ZWJ and writes to either wide-cell half.
- Beautiful Mermaid [157](https://github.com/lukilabs/beautiful-mermaid/pull/157)
  and Zombie [1354](https://github.com/dfadler/zombie-mermaid/pull/1354),
  [1416](https://github.com/dfadler/zombie-mermaid/pull/1416): spaces and
  punctuation on strokes, short gaps, reciprocal edges, junctions and markers.
- Mermaid ASCII [70](https://github.com/AlexanderGrooff/mermaid-ascii/issues/70)
  / [98](https://github.com/AlexanderGrooff/mermaid-ascii/pull/98): three-way
  labeled fan-out, narrow gaps, duplicates and supported directions.
- Mermaid ASCII [48](https://github.com/AlexanderGrooff/mermaid-ascii/pull/48),
  [104](https://github.com/AlexanderGrooff/mermaid-ascii/pull/104), and
  CaptainCrouton89 [1](https://github.com/CaptainCrouton89/mermaid-ascii/pull/1):
  explicit width policy, normal/compact/impossible fit, content survives reflow.
- Beautiful Mermaid [163](https://github.com/lukilabs/beautiful-mermaid/pull/163):
  partial XY bars and tick mapping. Preserve explicit nonzero domains; exercise
  zero, negative, mixed, coarse and reversed intervals and line/bar overlap.
- Agentic #381–#384, #391 and #392: five-line title clipping, capitalize after
  hyphenation, literal formatting tags, tick/baseline disagreement, notes around
  lexical fragment boundaries and numbering controls across output formats.

Use the existing registry-derived metamorphic builders and chart-honesty
corpus. Add exact case/punctuation/content assertions alongside the existing
case/whitespace/hyphen-normalizing raster oracle. Source expectations and raster
observations must remain independent of production preparation and stored bounds.

## Completion evidence

Implementation is in [PR 395](https://github.com/adewale/agentic-mermaid/pull/395),
rebased onto the compositor and its audit fixes from PR 394 at
`70f5937b0cf38dbd27b1c8c9238665419e267861`. The independent audit
and dispositions are recorded in [prepared-text-geometry-audit.md](prepared-text-geometry-audit.md).

Representative verification commands (Bun 1.4.2):

- `bun test --timeout 30000 src/__tests__/prepared-*.test.ts src/__tests__/connector-inline-text.test.ts`
- `bun test --timeout 30000 src/__tests__/terminal-*.test.ts src/__tests__/xychart-terminal-scale.test.ts src/__tests__/sequence-autonumber.test.ts`
- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run check:browser-lazy`
- `bun run quality:check`, plus the three covered CI shards and browser E2E lanes.

New family witnesses were checked red against original production sources;
CI independently confirms changed tests fail on the base branch. The shared
reviewer's final 252-case raster probe passes. All 28 research examples render
in both SVG and terminal with zero independent raster defects. The PR records
final full-head CI status and immutable visual artifacts; green CI is required
for delivery.
