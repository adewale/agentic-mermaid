# Local UI/AX audit — Agentic Mermaid website/editor

Date: 2026-06-28
Target: `http://127.0.0.1:9095/`
Scope: `website/public`, `mockups/styles.css`, `mockups/theme.js`, `website/build.ts`, `editor/css/*.css`, `editor/html/*.html`, `editor/js/*.js`
Mode: review-only for product code; wrote this audit artifact only.

## Context checked
- `plan.md`: not present at repo root (`ENOENT` when read).
- `progress.md`: notes a prior AX conventions brief and lack of web fetch tools; this audit used local files plus live localhost checks.
- Live site responded `200 OK` with CSP/security headers. Editor and homepage loaded without console/page errors in Playwright at `1440x900`, `390x844`, and `320x568`.

## Correct / already strong
- **Accessibility basics:** public pages and editor have skip links and main targets (`website/public/index.html`, `website/public/editor/index.html`; editor generated from `website/build.ts:116-135` plus `scripts/site/editor.ts`). Editor has a real workspace landmark: `<main id="editor-main" aria-label="Mermaid editor workspace">` generated in `scripts/site/editor.ts:156`.
- **Keyboardable primary shell:** editor segmented controls use buttons with `aria-pressed` and arrow-key support in `editor/js/tabs.js:32-76`; resize separator is keyboard-adjustable in `editor/js/resize.js:45-62`.
- **Responsive baseline:** Playwright found no horizontal overflow at `390px` or `320px` on homepage/editor (`scrollW === clientW`), and no nameless visible focusable controls in sampled loaded DOM.
- **Contrast sample:** sampled body/nav/buttons/editor controls had no computed text/background pairs below 4.5:1 in the tested default theme.
- **Theming foundation:** public site uses a clean triplet-derived token model in `website/public/styles.css:74-135` mirrored from `mockups/styles.css`; theme changes set `data-theme`/`data-scheme` via `website/public/theme.js:44-55`.
- **Motion restraint:** public logo motion is gated behind `prefers-reduced-motion: no-preference`, and reduced motion globally clamps transitions/animations in `website/public/styles.css:385-393`; editor has a similar reduced-motion reset in `editor/css/variables.css:153-163`.

## Findings

### P1 — Color picker is not keyboard/screen-reader robust
- **Files/selectors:** `editor/html/left-panel.html:155-176` (`#color-popup`), `editor/js/color-picker.js:18-37`, `editor/js/color-picker.js:49-95`, `.color-edit-btn` triggers.
- **Evidence:** opening a color control only adds `.open` and positions the popup; it does not move focus into the popup, set trigger `aria-expanded`, attach `aria-controls`, give the popup `role="dialog"`, or handle `Escape`. The only close paths are close button or outside click.
- **Live check:** Playwright opened `#color-popup`, pressed `Escape`, and `#color-popup.open` remained `1`; trigger `aria-expanded` was `null`.
- **Impact:** keyboard users can open the picker but are left on the trigger with an unannounced floating surface; Escape does not dismiss it, and the open popup can intercept subsequent pointer actions.
- **Impeccable dimensions:** accessibility, attention-to-detail.

### P2 — Export and font popovers miss common disclosure/menu behavior
- **Files/selectors:** `editor/html/topbar.html:118-139` (`#export-chevron-btn`, `#export-dropdown`), `editor/js/export.js:25-37`; `editor/html/left-panel.html:178-199` (`#font-popup`), `editor/js/font-picker.js:95-125`.
- **Evidence:** export chevron has a title but no `aria-haspopup`, `aria-expanded`, or `aria-controls`; `toggleExportDropdown()` only toggles `.open`, and global close only listens for outside click. Font select opens and focuses search, but trigger also lacks expanded/controls state and Escape handling.
- **Live check:** after opening and pressing Escape: `exportAfterEscape=1`, `fontAfterEscape=1`; both trigger `aria-expanded` values were `null`.
- **Impact:** custom popovers do not meet user expectations for keyboard dismissal/state announcement; screen-reader users get less reliable disclosure state.
- **Impeccable dimensions:** accessibility, anti-AI-slop (polished custom controls should behave like native ones).

### P2 — Mobile editor hides theming/dark-mode controls completely
- **Files/selectors:** `editor/css/topbar.css:359-413`, especially `#dark-light-btn, .theme-dropdown-wrap { display: none; }`; editor theme trigger in `editor/html/topbar.html:80-98`.
- **Evidence:** at `390px` and `320px`, Playwright computed `themeBtnDisplay="none"` and `darkBtnDisplay="none"`. The CSS explicitly removes both controls under `max-width: 760px`.
- **Impact:** mobile users cannot change diagram theme or editor light/dark chrome from the main UI. This is a responsive/theming regression even if color overrides remain in the Style panel.
- **Impeccable dimensions:** theming, responsive behavior, attention-to-detail.

### P2 — Editor ships as a single large, non-cacheable HTML payload
- **Files/selectors:** `scripts/site/editor.ts:110-175` builds self-contained HTML with inline CSS, app JS, and browser bundle; emitted to `website/public/editor/index.html` by `website/build.ts:161-169`. Header policy in `website/public/_headers:1-7` gives HTML `Cache-Control: public, max-age=0, must-revalidate`.
- **Evidence:** `wc -c website/public/editor/index.html` = `2,295,147` bytes. Local server transfer sizes: `plain_download=2295147`, `gzip_download=679611` for `/editor/`.
- **Impact:** first editor load pays ~680KB gzip before any app interactivity, and repeat visits cannot independently cache the large renderer/app bundle because it is inline in revalidated HTML.
- **Impeccable dimensions:** performance, attention-to-detail.

### P3 — Mobile editor topbar consumes a large share of short screens
- **Files/selectors:** `editor/css/topbar.css:359-437` wraps the topbar, makes the mobile segmented switch full-width, hides some labels, and keeps export/actions in the same header block.
- **Evidence:** Playwright measured `.topbar` height `110px` at `390x844`; at `320x568`, `.topbar` height was `156px`, leaving the editor main at `412px`.
- **Impact:** no horizontal overflow, but on small phones the chrome dominates the viewport and reduces the actual editing/preview area. This is a rhythm/responsive polish issue.
- **Impeccable dimensions:** responsive behavior, layout rhythm.

### P3 — Public mobile nav touch targets are below the 44px polish target
- **Files/selectors:** `website/public/styles.css:374-382` and matching source `mockups/styles.css:374-382`; `.masthead .links a { min-height: 36px; }`, `.link-editor { min-height: 40px; }` under `max-width: 640px`.
- **Evidence:** CSS intentionally lowers mobile nav links to 36px/40px. Playwright did not find tiny (<24px) targets, so this is not a hard blocker, but it falls short of the common 44px touch target expectation.
- **Impact:** acceptable but not impeccable on coarse pointers, especially with dense wrapped nav rows.
- **Impeccable dimensions:** accessibility, responsive behavior, layout rhythm.

### P3 — Focus affordance for desktop resize handle is too thin visually
- **Files/selectors:** `editor/css/panels.css:213-231`; generated handle `website/public/editor/index.html:2484` (`role="separator" tabindex="0"`).
- **Evidence:** live audit saw the focusable resize separator as `4px` wide by `848px` high. CSS expands pointer hit area via `::before`, but the visible/focusable rail remains only 4px.
- **Impact:** keyboard support exists, but visual focus/target discoverability is fragile for motor/low-vision users.
- **Impeccable dimensions:** accessibility, attention-to-detail.

## Residual risks / not fully covered
- Contrast was sampled from default loaded themes, not exhaustively across all 24 public themes and editor diagram themes.
- Playwright checks were heuristic, not a full axe-core/AT pass; no screen reader was run.
- Visual audit used DOM/computed metrics and local inspection, not screenshot diffing or real-device touch testing.
- Repo had many pre-existing unstaged changes; this audit did not determine which were part of the latest fix set.

## Commands run
- `curl -I --max-time 5 http://127.0.0.1:9095/ && curl -sS --max-time 5 http://127.0.0.1:9095/editor/ | head -n 30` — passed; live server responded 200 and editor HTML loaded.
- `node <<'NODE' ... Playwright local audit script ... NODE` — passed after correcting the initial scratch script; checked homepage/editor at three viewports, focusables, overflow, contrast samples, console errors, and popover behavior.
- `wc -c website/public/editor/index.html website/public/styles.css website/public/theme.js website/public/shader-mark.js` — passed; editor HTML measured 2,295,147 bytes.
- `curl -sS -H 'Accept-Encoding: gzip' -o /dev/null -w ... http://127.0.0.1:9095/editor/` — passed; gzip transfer measured 679,611 bytes.
- `git status --short` / `git diff --cached --name-only` — passed; found many pre-existing unstaged files and no staged files.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete P1-P3 findings are documented with file paths/selectors, live Playwright evidence, byte-size/performance measurements, and residual risks."
    }
  ],
  "changedFiles": [
    "research/local-ui-ax-audit.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "curl -I --max-time 5 http://127.0.0.1:9095/ && curl -sS --max-time 5 http://127.0.0.1:9095/editor/ | head -n 30",
      "result": "passed",
      "summary": "Local site responded 200; editor HTML loaded."
    },
    {
      "command": "node <<'NODE' ... Playwright local audit script ... NODE",
      "result": "passed",
      "summary": "Checked homepage/editor at 1440, 390, and 320px widths; verified overflow, focusable names, contrast samples, console errors, and popover behavior."
    },
    {
      "command": "wc -c website/public/editor/index.html website/public/styles.css website/public/theme.js website/public/shader-mark.js",
      "result": "passed",
      "summary": "Measured editor HTML at 2,295,147 bytes."
    },
    {
      "command": "curl -sS -H 'Accept-Encoding: gzip' -o /dev/null -w 'gzip_download=%{size_download}' http://127.0.0.1:9095/editor/",
      "result": "passed",
      "summary": "Measured /editor/ gzip transfer at 679,611 bytes."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "Playwright: no console errors, no horizontal overflow at tested viewports, no nameless visible focusables in sampled DOM.",
    "Popover checks: exportAfterEscape=1, colorAfterEscape=1, fontAfterEscape=1; missing aria-expanded on export/color/font triggers."
  ],
  "residualRisks": [
    "No exhaustive theme contrast matrix was run.",
    "No axe-core or screen-reader pass was run.",
    "No real-device touch testing or screenshot diffing was performed.",
    "Many unstaged repo changes pre-existed this audit."
  ],
  "noStagedFiles": true,
  "notes": "plan.md was not present; progress.md was read. Product code was not edited."
}
```
