# Test Coverage Matrix

Test category coverage across diagram types. Use this to identify gaps when adding or auditing diagram support.

| Test type      | Flowchart | Sequence | Class | ER  | Timeline | Journey | XY Chart | Architecture |
|----------------|-----------|----------|-------|-----|----------|---------|----------|--------------|
| Parser         | yes       | yes      | yes   | yes | yes      | yes     | yes      | yes          |
| Layout         | yes       | yes      | -     | -   | yes      | yes     | yes      | yes          |
| Renderer       | yes       | -        | -     | -   | -        | -       | yes      | yes          |
| ASCII          | yes       | -        | -     | -   | yes      | yes     | yes      | yes          |
| Integration    | yes       | yes      | yes   | yes | yes      | yes     | yes      | yes          |
| Theme          | -         | -        | -     | -   | -        | yes     | -        | yes          |
| SVG Snapshot   | -         | -        | -     | -   | -        | yes     | -        | yes          |
| Config         | -         | -        | -     | -   | -        | -       | -        | yes          |
| Accessibility  | -         | -        | -     | -   | yes      | yes     | yes      | yes          |
| Property-based | yes       | -        | -     | -   | -        | -       | yes      | -            |
| Edge styles    | yes       | -        | -     | -   | -        | -       | -        | -            |
| Multiline      | yes       | -        | -     | -   | -        | -       | -        | -            |

# Architecture Audit — Resolved Issues

Issues found by auditing architecture against all other diagram types (2026-03-20).

| Issue | Severity | Resolution |
|-------|----------|------------|
| Config duplication | Medium | Removed duplicate `MERMAID_THEME_COLORS` and color resolution from `config.ts`. Architecture now uses the shared `buildColors()` pipeline for color resolution. `resolveArchitectureVisualConfig()` only computes architecture-specific visual metrics (font sizes, icon sizes, junction radii) and surface/border overrides from `clusterBkg`/`clusterBorder`. |
| Double-parsing in ASCII | Low | Architecture parser now accepts `lines[]` instead of raw text. ASCII dispatch passes `normalizedSource.lines` — preprocessing runs once, not twice. |
| Parser input inconsistency | Low | `parseArchitectureDiagram()` signature changed from `(text: string)` to `(lines: string[])`, matching the convention used by sequence, class, ER, timeline, and journey parsers. |
| ARIA ID uniqueness | Low | All diagram types (architecture, journey, timeline) now generate content-hash-based ARIA IDs (e.g., `arch-1a2b3c-title`) instead of hardcoded IDs. XYChart already used hash-based IDs. Safe for multiple diagrams on one page. |
| Missing `role="img"` on xychart | Note | Added `role="img"` to xychart SVG output when accessibility metadata is present, matching the convention used by timeline, journey, and architecture. |

# Remaining Gaps

### Cross-cutting

- [x] Add theme tests for timeline, xychart, sequence, class, and ER diagrams
- [x] Add SVG structural snapshot tests for timeline, xychart, and older diagram types
- [x] Add property-based tests for timeline, journey, and architecture diagrams
- [x] Add accessibility (accTitle/accDescr) support to sequence, class, and ER parsers/renderers

### Sequence

- [x] Add dedicated renderer unit tests
- [x] Add ASCII test coverage for notes before the first message

### Class

- [x] Add layout tests
- [x] Add dedicated renderer unit tests

### ER

- [x] Add layout tests
- [x] Add dedicated renderer unit tests

# Fork Feature Backlog

Potential ports from the fork audit. Keep upstreamable work split into small branches based on `lukilabs/main`; keep editor/demo/product-specific work on the fork.

## High-confidence ports

- [ ] Add a focused CLI based on `vinceyyy/beautiful-mermaid:feat/cli`
  - [ ] `beautiful-mermaid render <file> --ascii`
  - [ ] `beautiful-mermaid render <file> --svg -o <out.svg>`
  - [ ] stdin input support
  - [ ] theme listing / `--theme`
  - [ ] CLI parser, render, diagram smoke, and E2E tests
- [ ] Add `quadrantChart` SVG support based on `zachwill/beautiful-mermaid:feat/quadrant-chart`
  - [ ] Parser/layout/renderer/types
  - [ ] Interactive point tooltips via `interactive: true`
  - [ ] Clear unsupported behavior or implementation for ASCII output
  - [ ] README, samples, editor/E2E coverage
- [ ] Add Vercel-inspired themes
  - [ ] `vercel-dark`
  - [ ] `vercel-light`
  - [ ] Theme tests and editor theme-list coverage
- [ ] Port any remaining Vercel-inspired visual ideas on top of semantic style roles
  - [x] Use `options.style.text/node/edge/group` rather than flat render aliases
  - [x] Apply supported roles consistently across SVG diagram families with layout + renderer coverage
  - [ ] Evaluate theme presets separately from styling API changes
  - [ ] Keep animation experiments fork-first and separate from core styling
- [ ] Add package/browser export improvements if useful
  - [ ] Browser/global export entrypoint
  - [ ] Package export fallback compatibility
  - [ ] Build and package tests

## Larger feature ports

- [ ] Add C4 diagram support from `kristjanakkermann/beautiful-mermaid`
  - [ ] Start with C4 parser/layout/SVG/tests
  - [ ] Follow with C4 ASCII if SVG path is accepted
  - [ ] Preserve focused PR boundaries; avoid bundling ArchiMate in the same upstream PR
- [ ] Add ArchiMate layered diagram support from `kristjanakkermann/beautiful-mermaid`
  - [ ] Parser/layout/SVG/tests
  - [ ] ASCII renderer as a follow-up
  - [ ] Reconcile custom `archimate-layered` DSL with Mermaid compatibility expectations
- [ ] Consider Vercel-style SVG animation as fork-first work
  - [ ] `animate: true | AnimationOptions`
  - [ ] Rank/dependency delay model compatible with current ELK layout pipeline
  - [ ] CSS/SMIL edge draw and moving arrowheads
  - [ ] `prefers-reduced-motion` handling
  - [ ] Visual regression/browser tests

## Deliberate non-goals / defer

- [ ] Do not port Vercel package rename, committed `dist/`, `.vercel`, or branding into upstream branches
- [ ] Do not fold `zhenhuaa/mdv` wholesale into the package; treat terminal Markdown viewing as a separate tool or future companion package
- [ ] Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture
