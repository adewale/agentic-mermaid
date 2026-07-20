# Website payload reduction plan

Status: measured launch follow-up; implementation is tracked by `TODO.md` **WEB-2**. This plan separates the mobile-navigation fix from payload changes so font, gallery, and editor-bundle risks remain independently reviewable.

## Baseline

Cold Chromium navigations against `https://agentic-mermaid.dev` on 2026-07-20 used fresh browser contexts and `waitUntil: "networkidle"`. Transfer/decoded sizes come from Navigation and Resource Timing; wall-clock and paint timings are diagnostic because the public network and CDN vary.

| Route | transferred | decoded | dominant cost |
|---|---:|---:|---|
| `/` | 655,559 B | 1,252,588 B | full Inter Regular/Medium TTF plus display-face subsets |
| `/editor/?empty=1` | 985,863 B | 3,314,258 B | one 956,045 B transferred / 3,196,587 B decoded editor module |
| `/examples/` | 1,007,137 B | 3,282,845 B | 247,565 B transferred / 1,966,349 B decoded HTML plus three full Inter weights and display fonts |

The Examples page already uses `content-visibility: auto`; that reduces off-screen layout/paint but not network or HTML parse bytes. Cloudflare already compresses responses, so raw-file size alone is not a user-transfer metric.

## Measurement protocol

For every payload PR:

1. Build `website/public` from a clean checkout.
2. Measure cold and warm desktop plus 390px mobile navigations in isolated Chromium contexts.
3. Record transferred bytes, decoded bytes, resource count, FCP, DOMContentLoaded, and the five largest resources.
4. Compare the same commit locally and at the deployed edge; do not attribute CDN/TTFB variance to a source change.
5. Add a ratcheting CI budget only after the first reduction lands. Budgets should pin deterministic raw/gzip asset sizes while browser probes validate the real loading graph.
6. Reject an optimization that drops searchable content, offline editor behavior, font coverage, accessibility, or exact Editor-link render parity.

## Ordered interventions

### 1. Site-font delivery

The shell currently downloads full Inter TTF files while four display faces already have Latin-subset WOFF2 companions. Extend the reproducible subset pipeline to the Inter weights actually used by each route.

Requirements:

- pin the fonttools/Brotli versions and subset character set;
- use explicit `unicode-range` faces and retain a tested fallback for uncovered glyphs;
- keep full TTFs available to trusted editor/export embedding without making every document page fetch them;
- verify regular, medium, semibold, bold, punctuation, and representative non-ASCII fallback in Chromium;
- target at least a 30% cold-transfer reduction on both `/` and `/examples/` before setting the first budget.

### 2. Examples delivery

The page embeds the complete gallery as roughly 1.97 MB of decoded HTML. `template`, `content-visibility`, or CSS hiding alone cannot reduce transfer bytes.

Split the catalog into a server-rendered searchable index plus independently cacheable family/card payloads. Render a representative initial tranche and fetch further cards on explicit “Show more” or near-viewport intent. Preserve stable anchors/permalinks, captions, source access, no-JS access to the index, and every Examples → Editor state handoff.

Target: at least a 40% reduction in initial decoded HTML and transferred document bytes, with no loss in sitemap/link closure or browser parity.

### 3. Editor module graph

The editor currently ships one approximately 3.20 MB decoded module. Produce a bundle composition report before choosing split points. Prefer dynamic imports at real interaction boundaries—PNG/export tooling, optional preview helpers, or other cold features—rather than family splits that make ordinary diagrams waterfall through many chunks.

Requirements:

- preserve offline all-family SVG editing after the initial editor load;
- modulepreload only the critical entry graph;
- use content-hashed immutable chunks;
- test slow/cancelled chunk failures and retain strict CSP;
- target at least a 20% cold entry-transfer reduction without regressing median local FCP or editor readiness.

## Non-goals

- Removing unused deploy assets does not count as page-transfer improvement unless the loading graph requested them.
- A smaller byte count does not justify hiding navigation, dropping fonts, removing examples from search, or weakening deterministic rendering.
- One favorable wall-clock run is not evidence; byte deltas and repeated comparable runs are the authorities.
