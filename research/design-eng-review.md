# Design-engineering review — Agentic Mermaid site

Scope: live local site at `http://127.0.0.1:9095/` (`/`, `/docs/`, `/gallery/`, `/editor/`) plus source inspection. Lens: detail density, tactile hierarchy, motion intent, and production craft.

## Highest-leverage fixes
1. **P0 — Fix editor mobile canvas width.** On a 390px viewport the Source panel renders only `292.5px` wide, leaving a blank right strip and clipping the placeholder. Cause is `editor/js/resize.js:73` applying an inline clamped desktop width (`max = 75vw`, `resizeBounds()` lines 5-15) even though mobile CSS expects `.panel-left { width: 100%; }` at `editor/css/panels.css:270-280`.
2. **P1 — Rework homepage first screen into a product hero, not a code block.** The first meaningful visual object is a `434.5px`-tall prompt slab (`mockups/home.html:33-66`, `website/public/styles.css:243-266`), so the product promise is visually quieter than the implementation details.
3. **P1 — Make gallery tiles legible and browsable.** Desktop gallery cards are only ~`340px` wide in a two-column `70ch` document; metadata is `13px`/`12px` and many diagrams are thumbnails (`website/public/styles.css:353-362`). Mobile intentionally forces wide SVGs to `600px` (`styles.css:364-366`), creating horizontal panning inside cards.
4. **P2 — Give copy/export interactions accessible state, not just text swap.** Public copy buttons only mutate `textContent` for 1.4s (`website/public/theme.js:198-211`); no `aria-live`, no persistent check icon, no tactile progress. This feels unfinished and is easy to miss with assistive tech.

## Before / After / Why
| Lens | Before (observed) | After (recommended) | Why / severity / evidence |
|---|---|---|---|
| Typography | Document pages are readable but too even: `h1` tops out at `39px`, body is `17px/1.7`, gallery prompt/trace compress to `13px` and `12px` (`website/public/styles.css:216-220`, `357-359`). The homepage lead does not visually outrank the large prompt block below it. | Raise homepage `h1`/lead contrast, cap code prompt height above the fold, and make gallery captions/prompts at least body-adjacent (`14-15px`) with clearer title/metadata separation. | **P1.** Current craft is competent markdown, not a memorable product surface. Screenshot probe: homepage prompt slab is `434.5px` high; gallery first tile width is `340.8px`, making diagram text tiny. |
| Layout | Public site uses a single centered `70ch` column (`styles.css:180`) while masthead spans `1120px` (`styles.css:183`). This creates a calm doc, but the homepage wastes the wide canvas and pushes proof/visuals below a code slab. | Keep docs narrow, but give homepage/gallery distinct layouts: hero split with live diagram/agent loop proof; gallery in a wider `min(1120px, 100vw)` grid with filter/preview or large featured rows. | **P1.** Homepage and gallery are product entry points, not manuals. The current layout hides the differentiator. |
| Motion | Good: theme switcher respects reduced motion and uses a click-origin View Transition (`website/public/theme.js:70-87`; `styles.css:155-160`, `393`). Weak: global transitions apply to nearly every text element (`styles.css:162-166`), so theme change risks a blanket wash rather than a designed state change. | Limit long color transitions to surfaces/plates/nav; keep text instant or shorter. Add local motion where intent exists: copy success, dropdown entry, editor panel switching. | **P2.** Motion should explain state, not decorate everything. Current reduced-motion care is good, but the kinetic hierarchy is flat. |
| Surfaces | Warm paper + grain is tasteful (`styles.css:174-177`), editor empty state is pleasant (`editor/css/preview.css:160-173`). But many plates are only slightly darker than background (`styles.css:290-293`, `360`), so diagrams and code sit in low-contrast beige-on-beige zones. | Increase surface contrast by one tonal step for hero prompt, gallery plates, and editor panel edges; reserve stronger surface only for interactive/primary objects. | **P2.** The current palette is elegant but too uniform; hierarchy depends on text weight rather than depth. |
| Optical alignment | Top nav is neat on desktop, but mobile public nav consumes `176px` before content and has 36px link targets (`styles.css:374-382`). Editor mobile topbar has a good segmented control, but the active source panel is visually broken by the 292.5px width bug. | For public mobile, collapse secondary links or make a two-row nav with 44px targets. For editor mobile, bypass desktop resize initialization and force active panels to full viewport width. | **P0/P2.** P0 for editor mobile breakage; P2 for nav tap-target polish. Metrics: editor mobile `.panel-left` computed `292.5px` in a `390px` viewport; public mobile masthead height `176px`. |
| Micro-interactions | Good foundations: focus-visible outlines exist (`styles.css:428`, `editor/css/variables.css:140-143`), theme menu uses `inert`, `aria-hidden`, roving tab index (`theme.js:97-154`). Weak: public copy buttons lack live status (`theme.js:198-211`), gallery cards are static, editor disabled export collapses to icon-only on mobile (`editor/css/topbar.css:428-435`). | Add `aria-live` or status region for copy, a checkmark/success animation, hover/focus elevation for gallery cards, and explicit mobile export text via accessible label/tooltips that remain discoverable. | **P2.** The site has accessible primitives, but the tactile layer does not yet feel considered. |

## Concrete findings
- **Blocker / P0 — Editor mobile panel is not full width.** Evidence: Playwright at `390x844` showed `.main` width `390px` but `.panel-left` width `292.5px`; screenshot `/tmp/agentic-design-review/editor-mobile.png` shows a blank right strip. Source cause is `setPanelWidth(panelLeft.getBoundingClientRect().width)` at `editor/js/resize.js:73`, which calls `resizeBounds()` with `max: window.innerWidth * 0.75` (`resize.js:5-15`) and writes inline width. This overrides the intended mobile CSS at `editor/css/panels.css:270-280`.
- **Major / P1 — Homepage lacks a crafted first impression.** The first screen reads like documentation: H1 + two paragraphs + giant prompt. `mockups/home.html:33-66` promotes the agent prompt before any visual proof or product affordance; `website/public/styles.css:243-266` gives the prompt a large standard `pre` treatment. It is honest, but visually under-sells the renderer/editor.
- **Major / P1 — Gallery is a contact sheet, not a gallery.** The grid is constrained to the doc measure and two columns (`website/public/styles.css:353`), with compact metadata (`styles.css:357-359`). Diagrams are real output, which is good, but most cards do not provide a large-enough reading experience. Mobile wide diagrams force internal horizontal scrolling by design (`styles.css:364-366`).
- **Medium / P2 — Mobile public nav has low tap comfort and too much vertical tax.** Links drop to `min-height: 36px` at `website/public/styles.css:380`; observed mobile masthead height is `176px`. This delays content and misses the usual 44px comfort target for touch.
- **Medium / P2 — Copy success is not robustly perceivable.** `website/public/theme.js:198-211` changes button text to `Copied`/`Copy failed`, then resets. There is no live region, icon, pressed affordance, or persistent state. This is a low-effort AX/craft win.

## Correct / keep
- **Theme accessibility is better than average.** The theme menu sets `aria-hidden`, `inert`, `aria-checked`, and roving tab index (`website/public/theme.js:97-154`). Reduced motion is honored for both View Transitions and global animation (`website/public/styles.css:158-160`, `393`; `editor/css/variables.css:149-158`).
- **Editor desktop has strong functional composition.** The split pane, verify panel, text output, zoom controls, and placeholder are coherent. The empty state at `editor/css/preview.css:160-173` has good hierarchy and restrained surface treatment.
- **The content strategy is clear.** Docs and homepage copy consistently position local-first agent editing. The issue is not message clarity; it is visual priority and interaction finish.

## Residual risks
- `plan.md` was requested but is absent (`ENOENT`), so I could not validate against the intended plan.
- No source files were edited. This report is the only file written.
- Visual review used Playwright screenshots and DOM metrics; no manual browser devtools/auditory screen-reader pass was available in this runtime.
- Repository already had many uncommitted changes before this report; I did not attribute or modify them.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings include severities and file paths: editor/js/resize.js:5-15,73; editor/css/panels.css:270-280; website/public/styles.css:180,183,216-220,243-266,353-366,374-382; website/public/theme.js:70-87,97-154,198-211; mockups/home.html:33-66."
    }
  ],
  "changedFiles": [
    "research/design-eng-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "curl -I --max-time 5 http://127.0.0.1:9095/ && curl -L --max-time 10 -s http://127.0.0.1:9095/{docs,gallery,editor}/",
      "result": "passed",
      "summary": "Confirmed live local site responds and inspected homepage/docs/gallery/editor HTML."
    },
    {
      "command": "node /tmp/agentic-design-review/probe.mjs",
      "result": "passed",
      "summary": "Captured desktop/mobile screenshots and DOM metrics for homepage, docs, gallery, and editor."
    },
    {
      "command": "node /tmp/agentic-design-review/mobile-probe.mjs",
      "result": "passed",
      "summary": "Verified editor mobile Source panel computes to 292.5px inside a 390px viewport."
    },
    {
      "command": "git diff --cached --name-only | wc -l",
      "result": "passed",
      "summary": "Returned 0 staged files."
    }
  ],
  "validationOutput": [
    "Live HTTP / returned 200 OK.",
    "Playwright metrics: editor-mobile viewport 390x844, .main width 390, .panel-left width 292.5; home-desktop .agent-prompt height 434.5; gallery-desktop first plate width 340.8; public mobile masthead height 176."
  ],
  "residualRisks": [
    "Requested plan.md was missing (ENOENT), so plan alignment could not be checked.",
    "Review used screenshots/DOM metrics rather than a full screen-reader pass.",
    "Repository had pre-existing unstaged modifications; this review did not inspect ownership of those changes."
  ],
  "noStagedFiles": true,
  "notes": "Source files were not edited; only the requested review report was written."
}
```
