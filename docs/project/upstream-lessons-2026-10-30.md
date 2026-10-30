# Upstream lessons and dispositions — 30 October 2026

This review extends the Beautiful Mermaid, Zombie Mermaid and Pele scan with
the thirteen additional repositories below. It inventories all open issues/PRs
and each repository's 100 most recently updated items: **3,048 distinct items,
including 2,408 open items**. Titles were triaged and selected bodies, PR merge
metadata and relevant comments were read. This is not a claim to have reviewed
every implementation or every historical discussion. Empty issue history is
recorded rather than treated as evidence of quality.

The implementation began on main `83744a4e` and the PR is rebased onto
`4c72d1c8`. Source changes are unreleased. No registry publication or production deployment is authorized by
this work. The original three-project report and the detailed source snapshots,
probe outputs, profiles and browser captures are retained with the session.

## Additional projects

| Repository | Inventoried / open | Lesson and source |
| --- | ---: | --- |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | 2029 / 2016 | New line-point and dark-theme reports reinforce role-specific contrast checks, not a blanket palette override. [#8613](https://github.com/mermaid-js/mermaid/issues/8613), [#8610](https://github.com/mermaid-js/mermaid/issues/8610). |
| [Latias94/merman](https://github.com/Latias94/merman) | 105 / 7 | Merged text-stage and native-font fixes distinguish authored text, measured rows and actual export ink. [#249](https://github.com/Latias94/merman/pull/249), [#255](https://github.com/Latias94/merman/pull/255). |
| [wevm/ondine](https://github.com/wevm/ondine) | 10 / 4 | The full-size PNG proposal preserves readable diagram scale under a memory cap; the remaining dark/custom-fill limitation is explicit. It is an open proposal. Ondine is a Rust port of Pele, not an independent layout algorithm. [#10](https://github.com/wevm/ondine/pull/10), [merged attribution #7](https://github.com/wevm/ondine/pull/7). |
| [kevinswiber/mmdflux](https://github.com/kevinswiber/mmdflux) | 113 / 28 | Fit reports disclose compromises; wrapped lines own gaps; reconnects require unambiguous endpoint evidence rather than positional IDs. Logical ports remain distinct from final visible paths. [#422](https://github.com/kevinswiber/mmdflux/pull/422), [#425](https://github.com/kevinswiber/mmdflux/pull/425), [#411](https://github.com/kevinswiber/mmdflux/pull/411), [#272](https://github.com/kevinswiber/mmdflux/issues/272). |
| [1jehuang/mermaid-rs-renderer](https://github.com/1jehuang/mermaid-rs-renderer) | 100 / 61 | Real migration reports combine entity decoding, scope direction and dotted edges. The public recursion-depth report gives no private reproduction; do not mistake a 64KiB input cap for a stack-depth bound. [#152](https://github.com/1jehuang/mermaid-rs-renderer/issues/152), [#166](https://github.com/1jehuang/mermaid-rs-renderer/issues/166). |
| [AlexanderGrooff/mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) | 100 / 25 | Merged quote-aware ampersand scanning and fan-out label preservation protect meaning, not just layout resemblance. [#106](https://github.com/AlexanderGrooff/mermaid-ascii/pull/106), [#98](https://github.com/AlexanderGrooff/mermaid-ascii/pull/98). |
| [fasouto/termaid](https://github.com/fasouto/termaid) | 14 / 0 | Merged Markdown rendering tracks complete fences and ignores examples nested in other fences. Its streaming-friendly choice to keep incomplete fences as text differs from static CommonMark verification through EOF. [#13](https://github.com/fasouto/termaid/pull/13). |
| [excalidraw/mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw) | 100 / 27 | The merged Pele migration and per-type lazy loading are real integration choices. Adapter-owned label placement and older-consumer fallbacks matter as much as renderer capability. [#115](https://github.com/excalidraw/mermaid-to-excalidraw/pull/115), [#116](https://github.com/excalidraw/mermaid-to-excalidraw/pull/116). |
| [vercel/streamdown](https://github.com/vercel/streamdown) | 109 / 43 | Do not surface an unfinished streaming diagram as a final failure; preserve the last valid artifact. Cache identity must distinguish plugin closures, not just function names. [#667](https://github.com/vercel/streamdown/issues/667), [merged #702](https://github.com/vercel/streamdown/pull/702). |
| [farnabaz/streamdown-pele](https://github.com/farnabaz/streamdown-pele) | 0 / 0 | No issue/PR history was available. Its integration README and the linked Pele math request establish the workflow, not a measured quality or adoption claim. |
| [peng-shawn/mermaid-mcp-server](https://github.com/peng-shawn/mermaid-mcp-server) | 15 / 7 | A main-frame readiness failure illustrates the operational cost of browser lifecycle management. Our browserless path avoids that particular dependency; it still needs its own admission and resource limits. [#8](https://github.com/peng-shawn/mermaid-mcp-server/issues/8). |
| [mermaid-js/mermaid-cli](https://github.com/mermaid-js/mermaid-cli) | 177 / 82 | Merged PDF-background repair and the font-subset proposal show that browser SVG success does not establish exported color or font correctness. [#1192](https://github.com/mermaid-js/mermaid-cli/pull/1192), [open #1211](https://github.com/mermaid-js/mermaid-cli/pull/1211). |
| [mermaid-js/mermaid-live-editor](https://github.com/mermaid-js/mermaid-live-editor) | 176 / 108 | The open NBSP-export repair separates HTML serialization from valid SVG XML: `&nbsp;` cannot simply be written into an XML image. [#2052](https://github.com/mermaid-js/mermaid-live-editor/pull/2052). |

A closed issue is not proof of a merged fix; a merged change is not proof of
published or deployed behavior. The source references above distinguish open
proposals from verified merge metadata. Independent repository roots also do
not imply independent algorithms or equal semantic scope.

## Implemented candidate contracts

- **Numeric ticks:** tiny and large finite domains retain distinct finite ticks;
  reversed domains reverse the ticks. Normalization prevents overflow when a
  finite domain crosses both extremes. SVG and terminal projections share the
  same normalized fraction. Fixed decimal/significant-digit rounding is removed;
  shortest round-trip labels distinguish even adjacent representable values.
  Interpolation retains the exact authored x-axis endpoints. Regression cases failed before the fix; unsupported tick densities
  terminate rather than recursively normalizing without progress.
- **Discretionary breaks:** U+00AD and U+200B occupy no visible width when unused.
  A chosen soft hyphen paints a measured hyphen; a zero-width space breaks without
  one. Pixel and cell wrapping preserve the authored source, selected break
  positions, style and grapheme boundaries. A selected hyphen retains the
  authored hint's source span instead of pretending to be an unrelated glyph.
- **Resolved scenes:** the existing API is callable from Code Mode and discoverable
  through capabilities and `describe_sdk`. Unsupported artwork fails atomically
  with a nominal error carrying a stable code, Scene part ID and feature.
  Constructor/prototype escape protections, read-only results and host render
  policies still apply. Primitive declarations are derived from their canonical
  types on demand; discovery keeps the internal Scene node opaque. Code Mode
  retains its 2MiB default result limit, and uncaught errors retain the prior text
  envelope. Catch and return selected typed fields when needed.
- **Markdown verification:** `am verify --markdown` reuses the normal verifier,
  checks extracted top-level Mermaid blocks, maps available warning lines into the
  physical document and explicitly marks block-start fallback locations. The
  fence parser tracks non-Mermaid examples, HTML blocks/comments, longer fences,
  tilde fences and CRLF. Nested list/blockquote fences require host extraction.
  An unclosed fence extends to EOF for static Markdown; streaming completion is
  a host decision. Existing Markdown rendering continues past invalid diagrams.
  No remark/rehype package or new rendering engine is introduced.

The owner brought resolved-scene discovery/error work forward from its earlier
0.6 deferral. Operating-guide consolidation and library-entry simplification
remain separate, deferred work. Mathematical labels remain research only.

## Routing profile and simplification decision

The pre-rebase source diagnostic observes the existing **25-pass** pipeline, all four
fixtures `flowchart-basic`, `fan-in-fan-out`, `cyclic-labelled-15-chains` and
`cyclic-labelled-18-cuts`, default and publication styles, position-cache allowed
and disabled, and two rounds. Every one of the **32 SVG observations** matches
its uninstrumented SVG and fully consumed receipt exactly. The cache-allowed
arm is not a claim that every observation hits a cache. Twelve terminal renders
of the same fixtures also retain identical text and receipts across repeats.

The aggregate timed pass bodies put `applyRouteContracts` at about **2,868ms**,
`bundleEdgePaths` at **229ms**, parallel duplicate lanes at **186ms** and port
lanes at **99ms**. Sampling identifies rounded connector projection, marker
construction/clearance and paint geometry as useful SVG investigation targets.
Terminal samples within the render/receipt call highlight occupied-cell lookups,
`getPath`, movement admission and terminal placement/ownership. These results
point to routing and proof work, not simply the function named label placement.

These are diagnostic source observations: two/three rounds, warmup outliers,
profiler overhead and separate lazy-receipt consumption. The SVG CPU capture also
includes module loading and harness JSON writes. They establish no speedup,
peer ranking, memory win or release performance qualification.

**Keep the pass order and resource/quality limits.** The profile supplies no
proof that a repair can be removed. The next bounded investigation is whether
identical candidate geometry projections and occupancy queries can be shared
inside the operation that owns them. Before retaining such a change, establish
that the inputs are identical and preserve:

- declared pass dependencies, dimensions and positions before the node freeze;
- metric budgets, conditional allowances, transactional rollback and hard-safe
  restoration;
- source/target endpoint ownership, painted marker depth, straight terminal leads,
  independent label seats and truthful shared trunks;
- geometry revision invalidation, certification work charges, failure behavior
  and deterministic SVG/terminal output;
- complete receipt consumption, cold/warm controls and actual loaded payload cost.

A render-lifetime cache, a visually unchanged screenshot or a faster first
candidate alone does not prove those constraints. No pass reorder, new cache,
threshold increase or performance claim is part of this candidate.

## Contrast preferences

Chromium **154.0.8037.57** on Linux was exercised with normal media,
`prefers-contrast: more` and `forced-colors: active`, for inline SVG and the
same SVG loaded into an image. Strict rendering made no external requests.
Computed inline paint and image pixel palettes were recorded, alongside six
screenshots.

| Selected style | Text / connector ink | Connector width | Preference behavior in this probe |
| --- | --- | --- | --- |
| Default | RGB 87,87,89 / 147,147,149 | 1px | Unchanged across the three media settings |
| Explicit `accessible-high-contrast` | RGB 5,5,5 / 5,5,5 | 2.6px | Same explicit palette in all settings and both embedding modes |

This does not establish real Windows High Contrast, screen-reader behavior,
all browsers or universal contrast compliance for authored colors. The result
supports host-side preference selection of the existing high-contrast look,
as documented in [Style authoring](../style-authoring.md#host-contrast-preferences).
The host handles preference changes and passes an explicit style to the renderer.

No automatic SVG media rules are added: those would introduce multiple possible
paint states into a resolved scene that currently promises concrete paint.
Explicit host selection preserves deterministic source/options behavior and a
known static palette for image, PNG and PDF use. Authored paint remains
meaningful; the existing contrast constraints can inspect the selected result.

## Mathematical labels: explanation only

The [separate research report](math-labels-research-2026-10-30.md) explains the
actual migration demand and compares Mermaid's browser KaTeX/MathML path,
Pele's measured host resolver and Merman's explicit native math capability.
It distinguishes support in source, merged APIs, published artifacts and
reported paint failures. It also separates Markdown math from formulas inside
Mermaid diagrams and from streaming lifecycle failures.

The owner explicitly does not want implementation. No typesetter, math resolver,
math fallback or math implementation backlog item is added.

## Local verification

Before the rebase and HTML-context audit fix, the local candidate passed
**329 tests across 11 affected suites**, covering
numeric layout, pixel/cell text, measurements, resolved scenes, structured errors,
Markdown CLI, SDK discovery/declarations and local/hosted execution parity.
Earlier broader XY and geometry checks also passed; their counts overlap and
are not added to this total. Selected new regressions fail against the base.

Core and repository type checks, lint, declaration generation, documentation
blocks and the complete package build pass. Lint retains the existing warning
for a 1.2MiB fixture. The lazy browser entry remains **5,921 bytes gzip**, with
six families accounting for shared on-demand ELK and nineteen excluding it.
The initial MCP execute description is **15,077 bytes**, below its unchanged
15,150-byte test ceiling; detailed resolved types remain on demand.

A locally packed tarball was installed in a separate consumer directory.
Node 24.19 and Bun 1.4.2 pass public root/core exports, numeric SVG, Unicode
SVG/terminal output, Markdown exit status and physical lines, and stdio MCP
initialization/discovery/typed refusals. Public TypeScript declarations compile.
The installed runtime-neutral entry also bundles and executes successfully in
Chromium's main thread and a Web Worker with zero external requests.

These are dated local candidate checks, not final-head CI or release qualification.
The PR records checks for its final revision, including the HTML-context repair. The
PR remains unmerged; no publication or deployment occurred.
