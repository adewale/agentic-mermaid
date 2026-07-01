# Code Context

## Files Retrieved
1. `website/build.ts` (lines 14-116, 200-332, 506-573) - static site route map, mockup transforms, generated masthead, install route generation, editor generation path.
2. `mockups/home.html` (lines 13-91) - homepage masthead and agent prompt widget source.
3. `mockups/gallery.html` (lines 13-45+) - gallery page source with inline generated diagram tiles.
4. `mockups/styles.css` (lines 180-397) - site masthead/theme switcher, prompt widget, gallery layout CSS.
5. `mockups/theme.js` (lines 1-220) - site masthead theme picker behavior and copy-button handler for homepage widget.
6. `scripts/site/editor.ts` (lines 1-146) - editor HTML generator; bundles `src/browser.ts` plus `editor/**` partials/CSS/JS into `editor.html`.
7. `editor/html/topbar.html` (lines 1-200) - editor topbar, theme dropdown, export popover markup.
8. `editor/html/right-panel.html` (lines 1-98) - preview SVG container, verify panel, Unicode/ASCII text output markup.
9. `editor/css/panels.css` (lines 1-60, 239-296) - panel layout, resize handle, mobile panel switching.
10. `editor/js/resize.js` (lines 1-61) - desktop-only resize behavior and ARIA separator values.
11. `editor/js/tabs.js` (lines 1-82) - mobile Source/Style/Preview panel state.
12. `editor/css/export.css` (lines 1-111) - export popover positioning/visibility.
13. `editor/js/export.js` (lines 1-135) - export dropdown toggle, SVG/PNG/copy actions.
14. `editor/css/font-picker.css` (lines 1-85) and `editor/js/font-picker.js` (lines 1-140) - font popover UI/positioning.
15. `editor/css/color-picker.css` (lines 1-81) and `editor/js/color-picker.js` (lines 1-87) - color popover UI/positioning.
16. `editor/css/preview.css` (lines 1-96, 310-372) - preview SVG container and Unicode/ASCII sizing/overflow.
17. `editor/js/rendering.js` (lines 1-220) - live render insertion, theme patching, text output rendering.
18. `src/index.ts` (lines 70-107, 211-276) - renderer accessibility extraction/injection and SVG render finalization.

## Key Code
- **Generation path:** `bun run website/build.ts` emits `website/public/**`. Core mockup pages are copied/transformed via `pageOutputs` (`website/build.ts:25-34`, `:300-304`). Editor is special: `website/build.ts:197-204` runs `bun run scripts/site/editor.ts`, reads root `editor.html`, transforms it, then emits `website/public/editor/index.html` at `:304`.
- **Site masthead/theme picker:** source HTML appears in each mockup (e.g. `mockups/home.html:13-25`), but generated docs/install pages use `mastheadHtml()` in `website/build.ts:208-220`. CSS is `mockups/styles.css:181-234` and `:317-360`; JS is `mockups/theme.js:1-181`.
- **Install route/nav:** `/install/` is mapped in `website/build.ts:16`, nav current in `topNavHrefForRoute()`/`setNavCurrent()` (`:98-116`), masthead link in `mastheadHtml()` (`:209-218`), and content is generated in `docPages` (`website/build.ts:506-508`). Severity: **medium** if editing `mockups/home.html` nav only; install/docs generated pages will not inherit changes unless `mastheadHtml()` also changes.
- **Homepage prompt widget:** `mockups/home.html:31-74` contains `section.agent-hero`, prompt/code ids `home-agent-prompt` and `home-mcp-config`, buttons with `data-copy-target`. Styling: `mockups/styles.css:262-296`. Copy behavior: `mockups/theme.js:183-220`.
- **Editor mobile panel resize:** desktop resize is disabled at `editor/js/resize.js:37-40` and `:49-51` under `(max-width: 760px)`. Mobile switches are handled by `editor/js/tabs.js:1-82`, CSS hides/shows panels in `editor/css/panels.css:270-296`. Severity: **high** for requested mobile resize; current implementation intentionally hides `.resize-handle` on mobile (`panels.css:281-283`) and has no vertical/height resize path.
- **Editor popovers:**
  - Export markup `editor/html/topbar.html:102-200+`, CSS `editor/css/export.css:1-111`, JS `editor/js/export.js:1-28` toggles `.open` and closes on outside click.
  - Font CSS `editor/css/font-picker.css:18-35`, JS `editor/js/font-picker.js:89-116` positions fixed popup near `#font-select-btn`.
  - Color CSS `editor/css/color-picker.css:1-13`, JS `editor/js/color-picker.js:20-38` positions fixed popup near clicked `.color-edit-btn`.
  Severity: **medium** for mobile/overflow risk; popovers use fixed pixel widths and limited viewport clamping, no focus trap/Escape handling for font/color, and export dropdown lacks ARIA expanded/list semantics updates.
- **Editor rendered SVG accessibility:** live SVG insertion is `editor/js/rendering.js:194-199` (`previewInner.innerHTML = svg; var svgEl = ...`). Library accessibility exists only when source contains `accTitle`/`accDescr`: `src/index.ts:70-107` injects `<title>/<desc>`, `role="img"`, `aria-labelledby`; called during `renderMermaidSVG()` finalize at `src/index.ts:247-263`. Severity: **medium** if requirement is every rendered preview SVG has accessible name; current default diagrams without accTitle/accDescr get no role/title from `src/index.ts` and editor does not add fallback ARIA.
- **Unicode output sizing/overflow:** markup in `editor/html/right-panel.html:75-96`, content set by `setTextOutputs()` and `renderTextOutputs()` in `editor/js/rendering.js:71-78`, `:168-178`. CSS `editor/css/preview.css:314-372` uses `max-height:190px`, `min-height:92px`, `overflow:auto`, `white-space:pre`, `font-size:12px`. Severity: **medium** for mobile overflow/readability; horizontal overflow is intentional, but panel can dominate limited viewport and no responsive font/height adjustments exist beyond one-column verify tier.
- **Gallery layout:** source is `mockups/gallery.html`; CSS at `mockups/styles.css:369-397` sets two-column grid, `.gallery-wide/.gallery-span` full row, plate `overflow:auto`, wide SVG `width:max(100%,640px)` and mobile `width:max(100%,600px)`. Severity: **low/medium** depending request; mobile wide diagrams intentionally overflow horizontally inside tile.

## Architecture
- The **public site is mostly static mockups** under `mockups/`, transformed by `website/build.ts` into `website/public/`. Edits to homepage/gallery/site CSS/theme picker should be made in `mockups/*`, then build regenerates `website/public/*`.
- The **install and docs-like routes are generated strings** in `website/build.ts` using `pageShell()` and `mastheadHtml()`, not separate mockups. Navigation changes must update both mockup mastheads (home/gallery/etc.) and `mastheadHtml()` or pages diverge.
- The **live editor is modular source** under `editor/`; `scripts/site/editor.ts` concatenates CSS/JS partials and bundles `src/browser.ts`. `website/build.ts` then emits the generated editor at `/editor/`.
- The editor renderer calls browser API exposed from `src/browser.ts`, receives SVG string from `src/index.ts`, inserts it into `#preview-inner`, then separately renders Unicode/ASCII into `<pre><code>` outputs.

## Start Here
Open `website/build.ts` first: it determines which files are authoritative versus generated. Then edit specific sources: `mockups/home.html`/`mockups/styles.css`/`mockups/theme.js` for site UI, `editor/**` for editor behavior, and `src/index.ts` only if SVG accessibility must be solved at render-library level rather than editor-only fallback.

## Review Findings
- **High:** Mobile editor resize is not implemented and is explicitly disabled (`editor/js/resize.js:37-40`, `editor/css/panels.css:281-283`). Requested mobile panel resize likely requires new UX (vertical splitter? resizable text output?) and changes in `tabs.js`/`panels.css`/`resize.js`.
- **Medium:** Generated install/docs masthead can diverge from mockup mastheads unless `website/build.ts:mastheadHtml()` is updated alongside mockup headers.
- **Medium:** Preview SVG accessibility is conditional on Mermaid source `accTitle`/`accDescr`; editor does not add a default accessible name after insertion.
- **Medium:** Editor popovers use minimal ARIA/focus management and fixed positioning; mobile clipping/keyboard behavior should be checked after changes.
- **Medium:** Unicode output uses fixed max height/font size and horizontal scroll; may overflow or be hard to use on small screens.
- **Low/Medium:** Gallery wide tiles intentionally horizontal-scroll; if request is “no overflow”, change `mockups/styles.css:392-397` and possibly tile classes in `mockups/gallery.html`.

## Residual Risks
- I did not run the site build or visual tests; findings are source-level only.
- Some line ranges in large inline SVG mockups are approximate beyond the initial page structure because embedded SVGs dominate files.
- Need product decision for mobile resize behavior: current mobile model is tabbed single-panel, not split view.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete source paths, generation paths, functions, and severity-tagged review findings are listed for masthead/theme picker, install route/nav, homepage prompt widget, editor resize/popovers/SVG accessibility, Unicode sizing, and gallery layout."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "ls/find/grep/read source inspection",
      "result": "passed",
      "summary": "Mapped site, editor, and website generation files without editing."
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "No build or visual regression commands were run; source inspection only.",
    "Mobile resize requires a UX decision because existing mobile editor is tabbed, not split.",
    "Inline SVG-heavy mockup files make some deeper line ranges approximate after initial structure."
  ],
  "noStagedFiles": true,
  "notes": "Findings written to research/request-implementation-context.md; no repository files edited except the requested research output."
}
```