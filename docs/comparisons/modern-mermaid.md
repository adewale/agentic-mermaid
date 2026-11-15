# Modern Mermaid — checked 23 October 2026

Follow-up: the requested [editor delivery implementation and before/after
measurements](../project/editor-delivery-cost-2026-10-23.md) apply to the working
candidate after this original comparison snapshot. The baseline measurements
below retain their recorded revision and scope.

Agentic Mermaid can learn most from Modern Mermaid's presentation workflow:
curated examples, immediately visible looks, backgrounds, image copying and
sharing in one workspace. The measured rendering engine and editor are slower
than Agentic's on the shared probes. The strongest caution is a visible rectangle
annotation that disappears from both PNG export and a shared link.

## Identity and scope

| Item | Inspected revision or distribution |
| --- | --- |
| Modern Mermaid | [`a021cbce37fc0b07a9f4791c28e983101ea06f2d`](https://github.com/gotoailab/modern_mermaid/tree/a021cbce37fc0b07a9f4791c28e983101ea06f2d), default branch `main`, last commit 7 June 2026 |
| Modern's renderer | `mermaid@11.12.1`, resolved by its checked-in `pnpm-lock.yaml` |
| Modern's application | Private manifest `mermaid_advanced@0.0.0`; React 19.2.0, Vite 7.2.4, html-to-image 1.11.13; MIT license |
| Agentic Mermaid | [`87c9c3174c0d4edc16c69c0da82b69a325cc32ec`](https://github.com/adewale/agentic-mermaid/tree/87c9c3174c0d4edc16c69c0da82b69a325cc32ec), source-built browser bundle and website |
| Current language reference | `mermaid@12.2.0`; fetched syntax pages from `mermaid-js/mermaid@1fb7869866dd619168d840291c9c54b4f129758b` |

Modern has a separate repository root, `821bb7dfe8efb4349f97bcfa33bee5d815ca277a`.
It imports Mermaid, calls `initialize` and `render`, then modifies the returned
SVG. It supplies no independent Mermaid parser or layout engine. The community
file records an `observed` member categorised as `editor` and `integration`,
with a `depends-on` edge to Mermaid. Community membership now includes
applications; renderer benchmark eligibility remains a separate decision.
Its SVG is a preview surface; its download UI offers PNG/JPEG, not SVG.

These measurements use a local production build. They do not establish that
`modern-mermaid.live` serves the same bytes. No npm publication or new renderer
peer is inferred from the private application manifest.

## Method

The runner reuses `officialCorpusInventory()` rather than making a favorable
subset: **1,095 fence occurrences, 546 distinct source strings, 34 documentation
groups**, including duplicates and the mixed examples page. It executes three
serial passes per engine, reversing engine order in the middle round. Each pass
gets a fresh page and initialized engine; later inputs share that page's caches.
Cold import time is outside the render timer. Rejections are retained as failures
and excluded from matched-input timing ratios.

The Modern engine measurement uses its locked Mermaid dependency with its
default Linear Light Mermaid configuration. It excludes React, the 300 ms
debounce, SVG postprocessing and painting. The separate application probes use
the unmodified built application, including those behaviors. Theme-family
probes reinitialize the dependency with each theme's configuration; they do not
substitute for the application's postprocessing or prove visual quality.

Environment: Apple M2 Ultra, macOS/Darwin 25.5.0, Chromium 145.0.7632.6,
1440×1000 desktop and 390×844 mobile. The Modern/corpus runner reports Bun
1.3.13 and Node compatibility version v24.3.0. Agentic's website was built with
the repository-required Bun 1.4.2. Network requests outside the local server and
service workers were blocked. This excludes external font availability,
analytics, PWA precaching and remote-image success from the measured workflow.
Compression figures are local gzip level 9/Brotli estimates, not measured CDN
transfer. Single-machine timings are advisory. Process memory, non-Chromium
browsers, native/CLI execution and an exhaustive theme/font/background cross
product are outside this run.

The Agentic build identifies itself as `87c9c317…-dirty` because of this
documentation/benchmark addition. There are no changes to `src/`, `bin/`,
`editor/` or `website/`. Its editor receipt records the shipped asset hashes.

## Full inventory results

An acceptance means an SVG string was returned in **all three rounds**. It does
not establish preserved meaning, successful external assets, correct styling,
or readable geometry. The newer corpus also contains families neither Modern's
11.12.1 dependency nor Agentic currently renders.

| Renderer/configuration | Accepted occurrences | Accepted distinct sources |
| --- | ---: | ---: |
| Modern's Mermaid 11.12.1 + Linear Light | 795 / 1,095 | 397 / 546 |
| Agentic Mermaid | 823 / 1,095 | 411 / 546 |
| Reference Mermaid 12.2.0 | 1,061 / 1,095 | 529 / 546 |

| Matched successful population | Inputs | Agentic round totals | Comparator round totals | Median comparator / Agentic |
| --- | ---: | --- | --- | ---: |
| Modern / Agentic | 793 | 2,286 / 2,253 / 2,150 ms | 4,378 / 3,899 / 3,892 ms | 1.81× |
| Reference / Agentic | 821 | 2,389 / 2,358 / 2,248 ms | 14,074 / 14,268 / 14,094 ms | 6.05× |

The populations differ between these two rows. The first is a comparison with
Modern's older dependency and configuration, not a claim that its application
accelerates upstream Mermaid. Duplicate fences contribute to the totals; these
are corpus-run costs with cache effects, not isolated cold-call latency.

| Documentation group | Total | Modern | Agentic | Reference |
| --- | ---: | ---: | ---: | ---: |
| agentflow | 24 | 0 | 0 | 24 |
| architecture | 12 | 6 | 12 | 12 |
| block | 60 | 60 | 60 | 60 |
| c4 | 12 | 12 | 12 | 12 |
| class | 76 | 70 | 76 | 76 |
| cynefin | 6 | 0 | 0 | 6 |
| er | 50 | 46 | 50 | 50 |
| eventmodeling | 26 | 0 | 0 | 26 |
| examples (mixed page) | 18 | 18 | 18 | 18 |
| flowchart | 228 | 224 | 228 | 226 |
| gantt | 22 | 22 | 20 | 22 |
| gitgraph | 70 | 70 | 70 | 70 |
| ishikawa | 2 | 0 | 2 | 2 |
| kanban | 6 | 6 | 6 | 6 |
| mindmap | 30 | 30 | 30 | 30 |
| packet | 7 | 7 | 7 | 7 |
| pie | 4 | 4 | 4 | 4 |
| quadrant | 6 | 6 | 6 | 6 |
| radar | 6 | 6 | 6 | 6 |
| railroad | 28 | 0 | 0 | 28 |
| requirement | 18 | 18 | 18 | 18 |
| sankey | 16 | 16 | 16 | 16 |
| sequence | 76 | 72 | 76 | 76 |
| state | 44 | 44 | 44 | 44 |
| swimlane | 26 | 0 | 0 | 26 |
| timeline | 28 | 28 | 28 | 28 |
| treeview | 26 | 0 | 0 | 26 |
| treemap | 16 | 16 | 16 | 16 |
| usecase | 48 | 0 | 0 | 48 |
| journey | 2 | 2 | 2 | 2 |
| venn | 16 | 0 | 0 | 16 |
| wardley | 38 | 0 | 0 | 38 |
| xychart | 16 | 12 | 16 | 16 |
| zenuml | 32 | 0 | 0 | 0 |

The two Modern-only occurrences, `gantt.md:657` and `gantt.md:697`, are the
**same source** containing raw `config.themeCSS`. Agentic deliberately rejects
it in default security mode with `RenderConfigError`, recommending a declarative
StyleSpec. This is a security-policy difference, not evidence of missing Gantt
geometry. Modern's older dependency also rejects newer Architecture row/column
syntax and the `datastore` flowchart shape. Both Mermaid dependencies fail the
two remote-image occurrences in this blocked-network run. ZenUML requires an
unregistered external diagram integration here; zero does not mean the upstream
ecosystem cannot render it.

## Editor, payload and outputs

Both editor probes change root labels in 5/50/150-node ternary trees, exclude
one warmup and retain three samples, and wait for DOM output plus two animation
frames. Modern includes Playwright input-dispatch overhead and reports a new
SVG/error; Agentic's existing probe dispatches input in-page and additionally
requires verified output with a receipt. These are useful workflow comparisons,
not identical render-only timers. Timer gaps use a nominal 5 ms heartbeat and
are responsiveness indicators, not browser Long Task API measurements.

| Nodes | Modern median preview | Agentic median verified preview | Modern worst timer gap | Agentic worst timer gap |
| --- | ---: | ---: | ---: | ---: |
| 5 | 358 ms | 90 ms | 11 ms | 7 ms |
| 50 | 392 ms | 105 ms | 63 ms | 10 ms |
| 150 | 519 ms | 183 ms | 145 ms | 17 ms |

Modern's first default preview took **877 ms** on one cold local page. Its
observed document/CSS/JS request graph comprised **15 files**, **1,296,501 raw /
323,423 gzip / 270,988 Brotli bytes**. This excludes images and externally hosted
fonts. The web build also generates a PWA precache of 56 entries / 3,194.83 KiB;
that background installation cost was not exercised with service workers blocked.
Agentic's four requested editor JS assets through the full 150-node session were
4,270,025 raw / 1,328,543 gzip / 1,058,625 Brotli bytes. That is a different
consumption boundary and excludes HTML/CSS/fonts, so it is not a startup-byte
ratio. It still identifies a useful payload investigation alongside Agentic's
faster verified interaction.

| Probe | Observed result |
| --- | --- |
| Example catalog | 13 examples × 6 language variants; all **78/78** rendered in the actual editor |
| Theme catalog through the UI | **24/24** selected the requested theme and rendered the same two-node flowchart; active theme identity was checked |
| Theme share restoration | **18/24** restored the requested theme; six shared themes silently became Linear Light |
| Theme/config breadth | **552/552** dependency renders: 24 themes × 23 documentation groups with a representative the dependency accepts, including the mixed examples page |
| Background/font controls | Source catalog has 27 backgrounds and 7 font choices; every combination was not rendered or font-fidelity tested |
| JPEG export | 1,483×489, 48,326 bytes, opaque white corner |
| Transparent PNG export | 1,483×489, 29,964 bytes, alpha-zero corner |
| Image clipboard | Actual `image/png` item, 29,964 bytes |
| Unicode share | `Unicode café 日本語` source round-tripped exactly; URL length 164 in this local run; keys `c`, `theme`, `bg`, `font` |
| Invalid source and recovery | Invalid source displayed an error while retaining old SVG; the next valid edit rendered `Recovered` / `Valid` |
| Reload unsaved edit | Unsaved `Recovered` edit was lost; the URL's earlier source was restored |
| Mobile at 390×844 | Screenshot shows clipped toolbar/preview and a 63.5 px textarea; this is not a usable responsive layout |
| Web and extension builds | Both production build commands passed; installed-extension behavior and offline PWA operation were not tested |
| Upstream tests/lint | 2 manifest tests passed; lint failed with 27 errors and 5 warnings |

The application-theme probes were corrected and rerun on 23 October using
Bun 1.4.2 and the same pinned Modern build and Chromium version. The original
probe accepted any SVG after visiting a theme URL, which counted default-theme
fallbacks as successes. The corrected probe chooses each theme through its UI,
checks the active theme, then shares and reopens that state. `win95`, `doodle`,
`organic`, `hightech`, `kawaii` and `geometricCollage` produce share URLs naming
the chosen theme but reopen as Linear Light because the URL loader's allow-list
omits them. This is a Modern share-restoration defect, independent of the valid
552-render dependency/config matrix. The original engine and other application
measurements above retain their dates and revisions.

Screenshots were inspected for desktop, mobile, Ghibli and Hand Drawn looks,
and the annotation/export discrepancy. External fonts were blocked, so these
images do not prove that the advertised custom fonts work offline or export
faithfully. A successful theme render is not a contrast or accessibility audit.
No end-to-end autocomplete, batch export or advertised Cmd/Ctrl shortcut support
was established; the inspected Editor is a highlighted textarea and Layout's
explicit keyboard listener handles Escape for fullscreen.

### Annotation fidelity defect

The probe draws a rectangle above the diagram using the actual annotation UI.
The editor displays it and reports one annotation. Exporting a transparent PNG
again produces **identical bytes and zero differing decoded RGBA channels**
compared with the pre-annotation image, at the same dimensions. Opening a new
share link yields zero annotations. The runner retains the editor screenshot,
both PNGs and the machine-readable comparison.

This follows the inspected implementation: `exportImage` and `copyImage` capture
`contentRef`, while the annotation SVG is a sibling overlay. The share builder
serializes source/theme/background/font, with no annotation document. The
experiment proves the PNG/share failure for this rectangle; it does not claim
that every tool, output format or custom styling case has been checked.

## What Agentic should adopt

| Priority | Lesson | Concrete next step and success criterion |
| --- | --- | --- |
| 1 | Make visual capability easy to discover | Group existing styles and examples by user task, with a few polished preview cards. Preserve source while switching looks; expose copy/export in the same workspace. Validate first-use completion, not just a larger theme count. |
| 1 | Carry all authored content across outputs | If adding annotation tools, put owned annotation state in the document/Scene and the share schema. A rectangle must survive SVG, PNG, clipboard and reload, with an independent artifact check. Avoid a preview-only DOM overlay. |
| 1 | Treat sharing as a document contract | Version the shared state, including source, style stack, seed and authored overlays. Test Unicode, edits after opening a link and graceful handling of large/malformed state. Make unsaved-state behavior clear. |
| 2 | Keep the interaction advantage while reducing delivery cost | Preserve verified worker previews and latest-request ownership. Investigate the measured editor request graph before changing bundles; measure initial and fully consumed payload separately. Modern shows how loading family code on demand can coexist with an approachable editor. |
| 2 | Prefer a few coherent looks over selector accumulation | Modern's themes coordinate background, text, lines and annotation colors. Express that coherence through Agentic's declarative style roles and seeded rendering; avoid depending on upstream SVG class names and CSS string rewriting. |
| 2 | Test workflow promises at their owning boundary | Add behavioral coverage when implementing a feature: visible content must appear in exports/shared state, invalid input must recover, mobile controls must be reachable. Manifest-only tests cannot catch the observed loss of artwork. |

This benchmark adds evidence and recommendations. It does not implement these
features or broaden Agentic's supported-family contract.

## Reproduce and inspect evidence

At the pinned Agentic checkout, use Bun 1.4.2 or later and an installed Playwright
Chromium. Check out Modern at the full SHA above in a sibling `modern-mermaid`
directory, then:

```sh
cd ../modern-mermaid
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm build:extension
pnpm test
pnpm lint   # expected failure at the inspected revision
cd ../agentic-mermaid
bun install --frozen-lockfile --ignore-scripts
bun run build:browser
bun run bench --profile full --suites modern-editor --modern-editor-root ../modern-mermaid --out ../modern-mermaid-evidence
bun eval/trident/run.ts source bench:modern-summary ../modern-mermaid-evidence/modern-editor
bun run website
bun run bench --profile full --suites editor-preview --out ../agentic-editor-evidence
```

The runner writes `inventory.json`, `report.json`, `summary.json`, image exports
and screenshots outside the repository. `report.json` retains all **9,855**
engine attempts, source IDs, errors, per-round times and app probes. The
summarizer rejects incomplete or duplicated engine passes and incomplete app
runs. Theme rows must identify the active theme; share rows must identify both
the shared and restored theme. Older reports lacking that evidence are rejected
by the summarizer. Reports now retain the complete measured corpus and hashes
of both dependency module trees, Modern's lockfile/theme config and the shipped
Agentic bundle. The summarizer requires exact input ID coverage for each engine
and round, and rejects a report paired with a different inventory.
`RESUME_ENGINES=1` can repeat application probes after a harness change only
when revisions, complete inputs and dependency/config bytes match. Admission
runs before any existing evidence is overwritten; the original engine
measurement date and environment are retained separately from the new app
probes. Older reports without the full input/dependency
binding must rerun the engines. Use a fresh output directory for independent runs.
Generated benchmark evidence is not committed.

Agentic's typecheck and repository lint passed. Both benchmark scripts passed
`node --check`, the full benchmark completed, and `git diff --check` passed.
Focused tests cover evidence admission, changed dependencies and exact engine
coverage. Generated benchmark evidence remains outside the repository.

The evidence guards were qualified by a fresh full run at Agentic revision
`97f5a178f12e9f68dda84694f90b256efe92c338`. All 9,855 engine attempts completed:
795 Modern, 823 Agentic and 1,061 reference inputs were accepted, with 24/24 UI
theme selections and 18/24 share restorations. The dependency snapshot includes
199 Modern and 280 reference JavaScript/ESM modules. The original speed figures
above retain their original measurement date and baseline. Actual CLI probes
confirm that the old summarizer accepted altered-source and foreign-ID evidence
and the corrected one rejects both. Invalid resumes leave the saved report and
inventory untouched; valid resumes preserve the engine rows, date and environment.

Primary implementation sources: [manifest and dependency declaration](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/package.json),
[resolved dependency lock](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/pnpm-lock.yaml),
[preview/render/export implementation](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/src/components/Preview.tsx),
[layout/share wiring](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/src/components/Layout.tsx),
[share schema](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/src/utils/compression.ts),
[themes](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/src/utils/themes.ts),
and [extension tests](https://github.com/gotoailab/modern_mermaid/blob/a021cbce37fc0b07a9f4791c28e983101ea06f2d/src/test/manifest.test.ts).
