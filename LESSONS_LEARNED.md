# Lessons Learned

This file captures recurring lessons from the fork history (`origin/main` plus the focused `origin/pr/79-mermaid-config` and `origin/pr/86-timeline` branches) relative to `upstream/main`. It is not a changelog; it records patterns to preserve in future work.

## 1. Fork and upstream hygiene

- Keep upstream PRs small, single-purpose, and based on `lukilabs/main`, not fork `main`.
- Do not upstream a broad fork branch as one PR. Extract the smallest coherent feature/fix with its own tests and docs.
- Keep fork/demo/editor/deploy/product work separate from core library changes unless upstream explicitly wants it.
- A fork audit should produce a backlog, not a grab bag. Port ideas, not branding, old layouts, committed build artifacts, or unrelated product scaffolding.
- Branches that look similar can still have different risk profiles. Clean upstream branches (`pr/79-mermaid-config`, `pr/86-timeline`) are easier to review than equivalent changes buried in fork `main`.
- When two upstream PRs touch common routing/doc files (`README.md`, `src/index.ts`, `src/ascii/index.ts`), expect light conflict resolution after the first merge.

## 2. Mermaid source/config parity

- Preprocess Mermaid wrappers before diagram detection. Frontmatter, `%%` comments, and `%%{init}` / `%%{initialize}` directives must be stripped/merged before reading the header line.
- Use a real YAML parser for Mermaid frontmatter. Regex/hand parsing breaks on anchors, nested maps, lists, block scalars, and quoted values.
- Config merging needs explicit precedence tests: base config < YAML frontmatter < init directives < direct render options where applicable.
- Diagram families should route through the same source normalization pipeline; one-off parser entrypoints drift quickly.
- Runtime config support is a contract for both SVG and ASCII renderers where possible, not just the main visual path.
- Mermaid compatibility includes syntax cleanup details: quoted labels, `<br>` normalization, semicolon-separated statements, CRLF input, accessibility directives, and comments.

## 3. Adding new diagram families

- Add parser, layout, renderer, types, tests, docs, and samples together. Partial support is hard to reason about.
- SVG support and ASCII support can be split, but unsupported behavior must be explicit and tested.
- Each diagram family needs representative integration tests plus focused parser/layout/renderer tests.
- Accessibility metadata (`accTitle`, `accDescr`) belongs on the root SVG, not accidentally rendered as diagram content.
- Preserve Mermaid docs examples as regression fixtures where possible; they expose syntax and layout assumptions better than artificial micro-examples.
- Use semantic classes and `data-*` attributes consistently so browser/editor/E2E tests can assert behavior without brittle visual matching.

## 4. Layout and rendering must evolve together

- Never add a visual knob only in the renderer if it affects size. Typography, padding, corner radius, label widths, and stroke widths often require layout changes too.
- Snapshot churn is a signal. If a golden SVG changes, verify whether layout, bounds, or config behavior intentionally changed before updating the fixture.
- Edge labels need layout-owned positions when routes can bend or multiple relationships coexist; midpoint guesses regress quickly.
- Bounds tests matter for non-flowchart diagrams. Services, groups, notes, timeline events, journey cards, and chart points must stay inside the canvas under generated inputs.
- Renderer output should avoid `NaN`, `undefined`, invalid colors, and invalid XML for arbitrary but syntactically plausible input.
- Default output semantics are a compatibility promise. Invalid or omitted options should fall back to existing defaults.

## 5. Semantic styling API

- Prefer semantic roles over flat render aliases. `style.text`, `style.node`, `style.edge`, and `style.group` explain intent; flat options like `lineWidth` or `fontSize` are ambiguous across nodes, edges, groups, axes, and cards.
- A diagram family should only claim role support when layout sizing and emitted SVG attributes both consume the role.
- Keep generic roles generic. Specialized controls such as architecture icon size or xychart axis config should remain diagram-specific Mermaid config, not forced into `style`.
- Retiring flat aliases requires both type cleanup and runtime regression coverage proving removed aliases are ignored.
- `style.text` should be a fallback, not a replacement for role-specific typography.
- Role mappings can differ by family while preserving the same public API: participants/entities/services/tasks are node-like; messages/relationships/connectors are edge-like; sections/subgraphs/blocks are group-like.

## 6. Theme and color handling

- CSS variables are excellent for live theming, but export/render pipelines like `resvg` may need resolved concrete colors.
- Theme switching must clear diagram-family CSS variables. Otherwise stale architecture/timeline/chart variables leak between renders.
- Derived CSS variables can require re-rendering SVGs on theme switch; changing root variables alone may not recompute all derived color state as intended.
- Test accent/line/border/surface propagation across every diagram family, not just flowcharts.
- Contrast fixes are product quality fixes. Salmon, Tufte, and dark variants showed that palettes need line/border/readability checks, not just pleasant backgrounds.
- Avoid first-paint theme flash by restoring persisted theme before paint and delaying transitions until after restore.

## 7. ASCII renderer lessons

- ASCII/Unicode output is a first-class renderer, not a fallback screenshot. It needs dedicated tests for routing, labels, edge styles, CJK widths, and multiline content.
- CJK/Korean/full-width characters need explicit width logic; JavaScript string length is not display width.
- Diagonal characters are a regression smell for this renderer. Property tests should assert orthogonal ASCII/Unicode routing remains diagonal-free.
- Mermaid edge marker parity (`--o`, `--x`, bidirectional arrows, thick/dotted styles) must be tested in both SVG and ASCII where supported.
- Multiline normalization must be shared where possible so SVG and ASCII do not interpret labels differently.

## 8. Browser/editor/demo lessons

- Browser E2E tests should cover every fork-added diagram family, not only flowcharts. The editor bundle is the integration point users actually hit.
- Keep E2E tests out of the default unit-test CI command unless the environment is prepared for browser dependencies.
- UI polish fixes can be regressions: Contents buttons, theme pills, flash-on-load, and button alignment all need explicit browser checks when they affect navigation or first paint.
- Exploratory mocks/screenshots are useful during theme work, but avoid treating them as upstream library deliverables.
- GitHub Pages deploys need the exact assets users navigate to (`/editor`, `/editor.html`, and showcase pages), not just the root demo.
- Cloudflare/custom deploys require the correct account/project token; local tooling success is not enough if the project belongs to another account.

## 9. Testing strategy

- Property-based tests found classes of bugs example tests missed: config merging, crash freedom, SVG well-formedness, layout bounds, color algebra, and HTML generation.
- Audit tests for quality, not just quantity. Remove weak assertions, skipped tests, mock-reality drift, and tests that do not fail for the intended regression.
- Test defaults and invalid inputs. A robust option resolver proves both the styled path and the no-op/invalid path.
- Use focused reruns to distinguish real failures from one-off timeouts, especially in property-heavy suites.
- CI should run the right scope for the environment. Unit suites and E2E suites may need separate commands/dependencies.
- Public API/package export tests catch runtime compatibility bugs that TypeScript alone misses.

## 10. TypeScript/package hygiene

- Strict TypeScript findings can expose real API drift. A non-null assertion may be appropriate after a test proves the key exists, but do not paper over uncertain data paths.
- Package export fallbacks matter for runtimes with different conditional export resolution.
- Avoid committing generated `dist/` unless the project explicitly requires it for release; build output should be reproducible.
- Keep renderer signatures consistent as new options pass through. `src/index.ts` should be the obvious routing layer, not a place where families silently drop options.

## 11. Documentation and reviewability

- Add diagram-type implementation guidance once the second or third family repeats the same pattern. A guide prevents rediscovering parser/layout/renderer/test requirements.
- Docs should include runtime config support, Mermaid parity caveats, and examples that reviewers can paste directly.
- A backlog should separate high-confidence ports from larger feature ports and deliberate non-goals.
- Good PR descriptions should explain What / Why / How / Testing / Risk and avoid bundling unrelated fork artifacts.

## 12. Current release/process gap

- This repository currently has no project `CHANGELOG.md`. Only dependency changelogs exist under `node_modules`.
- Until a changelog exists, commit history plus `TODO.md`/`LESSONS_LEARNED.md` are carrying release/process memory. If this fork starts shipping tagged releases, add a real changelog.
