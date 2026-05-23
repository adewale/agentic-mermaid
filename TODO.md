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
