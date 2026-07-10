# Applying the `apple-design` skill to the Agentic Mermaid website — stack-ranked

**Purpose of this document.** Implementation-ready recommendations for elevating the Agentic
Mermaid website (public site + `/editor/`) using Emil Kowalski's `apple-design` skill
(<https://www.skills.sh/emilkowalski/skill/apple-design>, source:
`emilkowalski/skills` → `skills/apple-design/SKILL.md`). The skill distills Apple's
*Designing Fluid Interfaces* (WWDC 2018), the materials/typography talks, and the eight
design principles into web-platform techniques. Its through-line:

> An interface feels alive when motion starts from the current on-screen value, inherits
> the user's velocity, projects momentum forward, and can be grabbed and reversed at any
> instant.

This document was produced after auditing the actual code; every item cites current state
with file:line references and includes acceptance criteria. An earlier draft held 17
items; a five-lens ranking review (felt user impact, engineering value, skill fidelity,
brand fit, accessibility) stack-ranked them and **five were removed from scope** (see
"Removed from scope" at the end). The **12 items below appear in final rank order**,
grouped into the review's quality tiers. Original audit IDs (R1, R11, F1, …) are retained
for traceability — do not renumber them.

An **interactive before/after mock** of the demoable items (working spring/decay
simulations styled with the site's own tokens) lives next to this file:
`research/apple-design-before-after-mock.html` — open it directly in a browser.

## Stack rank at a glance

| Rank | ID | Item | Tier |
|------|----|------|------|
| 1 | R1 | Adaptive render debounce + delayed spinner | 1 — Do first |
| 2 | R11 | Curated reduced-motion (replace blanket kill) | 1 — Do first |
| 3 | F1 | Vanilla motion utility (prerequisite) | 2 — Core fluid-feel block |
| 4 | R3 | Momentum panning with grab-to-interrupt | 2 — Core fluid-feel block |
| 5 | R2 | Smooth, interruptible, compositor-friendly zoom | 2 — Core fluid-feel block |
| 6 | R10 | `prefers-reduced-transparency` / `prefers-contrast` fallbacks | 3 — High-value cheap wins |
| 7 | R7 | Origin-aware comparison lightbox (public site) | 3 — High-value cheap wins |
| 8 | R12 | Toast micro-fixes (pausable timer) | 3 — High-value cheap wins |
| 9 | R5 | Two-finger pinch zoom + pan on touch | 3 — High-value cheap wins |
| 10 | R6 | Symmetric, fast popover exits | 3 — High-value cheap wins |
| 11 | R8 | Mobile editor panel crossfade | 3 — High-value cheap wins |
| 12 | R15 | Design-page motion specimens + DESIGN.md rulings | 4 — Durability |

---

## 0. Read this first (context for the implementing agent)

### What the site already gets right — do not "improve" these

The site is unusually well-crafted; several skill principles are already implemented.
Preserve them:

- **Press feedback on pointer-down** (skill §1): `:active { transform: scale(0.96) }` with a
  fast `--dur-press: 0.1s` exists on every control (`website/source/assets/styles.css:786`,
  `editor/css/affordances.css:18`). ✔
- **Typography** (skill §15): size-specific tracking is already exact — display `-0.022em`,
  headings `-0.018em`, body `0`; tight leading on display (1.03) and loose on body (1.6)
  (`styles.css:128–147`). Hierarchy is built from weight+size+leading as a set. ✔ No action.
- **Origin-aware popovers** (skill §7): editor popovers scale in from their trigger with
  correct `transform-origin` (`editor/css/affordances.css:52–59`). ✔ (exits need work — R6.)
- **Hit targets**: 44 px minimums on coarse pointers (`affordances.css:83–107`), invisible
  hit-halo on the dialog close button (`editor/css/misc.css:97`), 16 px input font on touch
  to prevent iOS zoom. ✔
- **`setPointerCapture` on drags** (skill §2): pan (`editor/js/pan.js:29`) and resize
  (`editor/js/resize.js:41`) both capture. ✔
- **Design foundations** (skill §16): direct nav labels, wayfinding, semantic status colors
  paired with text, forced-colors coverage, tiered warning feedback. ✔
- **One deliberate entrance** (home diagram staggered node-settle on the mark's clock,
  `styles.css:738–755`) rather than scroll-triggered animation soup. ✔

### House rules that constrain the skill — rulings on conflicts

`DESIGN.md` defines the north star: *"A standards manual attached to a capable workbench."*
It **prohibits** glass panels, glowing gradients, broad soft shadows, and SaaS gloss. The
skill's §12 (translucent materials) partially conflicts. Rulings for this work:

1. **No new translucent surfaces anywhere.** The only materials work in scope is adding
   accessibility fallbacks to the frosted surfaces that already exist (the shortcuts
   dialog, `editor/css/misc.css:53–69`; the comparison lightbox backdrop,
   `styles.css:451`) — that is R10.
2. **No new dependencies.** The editor is dependency-free vanilla JS. Do not add
   framer-motion/Motion. All spring/decay work is a ~60-line helper (F1).
3. **No overshoot on click-triggered UI.** The skill itself says bounce is earned only when
   the user's gesture carried momentum. Popovers, toasts, copy feedback stay critically
   damped.
4. **Never animate the render path.** Typing → preview must stay an instant swap
   (skill §1: response beats choreography). Latency work = R1, not crossfades.
5. **Determinism and tests**: `bun test src/__tests__/` is the CI gate.
   `website-build.test.ts` pins selectors that must exist in `styles.css` (e.g. lines
   758–766 of the test file), `chrome-token-lockstep.test.ts` pins editor/site token
   parity, and `website-browser-a11y.test.ts` drives the comparison lightbox. Run the full
   suite and `bun run website` after CSS/token changes.
6. Respect the three-layer CSS architecture (BRAND / THEME / SCHEME) documented at the top
   of `website/source/assets/styles.css:1–15`. Motion tokens live in the BRAND layer.

---

## Tier 1 — Do first: kill latency, stop the reduced-motion harm

### Rank 1 · R1 — Adaptive render debounce + spinner that never flashes

**Why ranked #1:** four of five review lenses ranked it first. Typing is the product's
highest-traffic interaction, latency is the skill's stated foundation ("Response is the
foundation everything else is built on"), and the change is small, standalone, and
low-risk — the best value-per-effort in the list.

**Skill:** §1 — "Be vigilant about every latency… audit debounces, artificial timers."

**Current state:**
- Every keystroke schedules a render behind a fixed **300 ms debounce**
  (`editor/js/rendering.js:13–20`, `scheduleRender(delay ?? 300)`).
- The spinner turns on **immediately** for every render (`rendering.js:430`,
  `spinner.classList.add("visible")`) and off in `finally` — so even a 25 ms render
  flashes a spinner in the corner.
- The status bar prints "Rendered in Nms", so real render cost is already measured.

**Change:**
1. Track the last successful render duration (`ms` is already computed at
   `rendering.js:436`). Set the next debounce adaptively:
   `delay = clamp(lastRenderMs * 1.5, 60, 300)`. A typical small diagram renders in tens
   of ms → typing feedback lands ~4–5× sooner. Big diagrams keep the protective 300 ms.
2. Delay spinner visibility: start a `setTimeout(showSpinner, 250)` when the render
   begins; clear it in `finally`. The spinner then only ever appears for genuinely slow
   renders, and quick renders read as instantaneous.
3. Keep the existing version-guard (`isCurrentRender`) exactly as is — it already prevents
   stale results landing (good interruptibility).

**Acceptance:** with the default flowchart loaded, a character edit updates the preview in
≤ ~120 ms end-to-end; no spinner is visible for renders < 250 ms; a 300-line diagram still
debounces at 300 ms. No test changes expected.

**Risk:** low. Purely timing.

### Rank 2 · R11 — Curated reduced-motion instead of the blanket kill-switch

**Why ranked #2:** the accessibility lens's unanimous top pick — the current rule actively
punishes the exact population that opted into an accessibility preference — and it
protects every motion item ranked below it, so it must land **before** new animations
ship.

**Skill:** §14 — "Reduced motion doesn't mean *no* feedback — it means a gentler,
non-vestibular equivalent… Keep opacity/color changes that aid comprehension. Replace
slides/springs with cross-fades."

**Current state:** both stylesheets nuke *everything* to 0.01 ms:
`styles.css:760` and `editor/css/variables.css:235–244`
(`* { animation-duration: .01ms !important; transition-duration: .01ms !important }`).
That also kills pure opacity fades (toast, tab panel fade, copy status) and even *color*
transitions — reduced-motion users get a strictly harsher UI than necessary, which is
precisely what §14 argues against.

**Change:** keep the blanket rule as the base (it's a safe default), then re-allow the
comprehension-aiding, non-vestibular set after it:
```css
@media (prefers-reduced-motion: reduce) {
  /* after the blanket kill: restore short, transform-free fades */
  .toast, .tabs-ready .tab-panel:not([hidden]), .copy-prompt-status,
  body, .doc, a, button /* color/background transitions */ {
    transition-duration: 0.15s !important;
    transition-property: opacity, color, background-color, border-color !important;
  }
  .toast.show { transform: translateX(-50%); } /* position without the slide */
}
```
Audit each animation once: transforms (slides, scales, the home-page node settle, the
copy-pop) stay dead; opacity/color fades ≤ 200 ms come back. Dark↔light scheme changes
keep their 0.2 s color ease (skill: "ease dark↔light theme changes" — the current blanket
rule ironically makes theme flips *abrupt* for reduced-motion users).

**Acceptance:** with reduced motion on — no element translates or scales anywhere; toasts
and tab switches still fade; theme/scheme flips still ease; everything else instant.

**Risk:** low, but requires a careful pass over both stylesheets. Keep the override block
adjacent to the existing kill rules with a comment explaining the §14 rationale.

---

## Tier 2 — Core fluid-feel block (build as one coordinated effort)

The three items below share code and a risk seam: F1 supplies the physics, R3 and R2 both
live on the preview canvas and share cancel paths. Land them consecutively.

### Rank 3 · F1 — Tiny spring/decay utility: `editor/js/motion.js` (prerequisite)

**Why ranked #3:** zero user-visible change by itself — its position is inherited from the
gestures it unlocks (R3, R2, R5), so it belongs immediately before its first dependent,
not higher.

**Skill principles:** §3 interruptibility ("always animate from the presentation value"),
§4 behavior over animation, §5 velocity handoff, §6 momentum projection.

The editor loads plain scripts in order (see how `pan.js`/`zoom.js` share globals). Add
`motion.js` before them with three primitives, parameterized the way Apple does (damping
ratio + response, not mass/stiffness):

```js
// Critically damped spring (damping ratio 1.0). Closed form — no library needed.
// response ≈ time-to-target feel in seconds (Apple's "response"; 0.3–0.4 for UI).
// Returns a cancel function; onFrame receives the current value each rAF.
function springTo(from, to, initialVelocity, response, onFrame, onDone) {
  var omega = (2 * Math.PI) / response;         // undamped angular frequency
  var A = from - to;
  var B = initialVelocity + omega * A;
  var start = performance.now(), raf = 0;
  function frame(now) {
    var t = (now - start) / 1000;
    var e = Math.exp(-omega * t);
    var x = to + (A + B * t) * e;
    var v = (B - omega * (A + B * t)) * e;
    if (Math.abs(x - to) < 0.001 * Math.max(1, Math.abs(A)) && Math.abs(v) < 0.01) {
      onFrame(to); if (onDone) onDone(); return;
    }
    onFrame(x);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return function cancel() { cancelAnimationFrame(raf); };
}

// Exponential decay for momentum (UIScrollView-style). rate 0.998 = normal scroll feel.
function decay(velocity, rate, onFrame /* (delta) */, onDone) { /* v *= rate^dt_ms per frame,
  emit v*dt movement, stop below ~4 px/s; return cancel fn */ }

// Apple's momentum projection (from the WWDC sample code — use exactly this form):
function project(initialVelocity /* px/s */, rate) {
  rate = rate || 0.998;
  return (initialVelocity / 1000) * rate / (1 - rate);
}

// Pointer velocity tracker: keep the last ~100 ms of {t, x, y} samples from
// pointermove; velocity = least-squares or first/last delta over the window.
function makeVelocityTracker() { /* push(t,x,y); getVelocity() -> {vx, vy} px/s */ }
```

**Notes.** Every consumer must (a) start from the *current* on-screen value, (b) accept a
retarget mid-flight (cancel + re-spring with the live velocity — the closed form above
takes `initialVelocity`, so this is free), and (c) be cancelled by any new pointerdown.
That is the skill's §3 in one sentence.

**Acceptance:** unit-testable pure functions; no `Date.now` (use `performance.now`); zero
allocations per frame beyond the closure.

### Rank 4 · R3 — Momentum panning with grab-to-interrupt (the flagship "feel" upgrade)

**Why ranked #4:** skill-fidelity #2 (interruptibility + velocity handoff on a core
gesture is the doctrine's textbook combination) and the most viscerally noticeable
fluid-vs-clunky difference a non-designer will feel. The accessibility lens flagged
self-moving content as a vestibular risk — which is exactly why R11 (rank 2) must ship
first.

**Skill:** §2 (1:1 tracking — already done), §5 (velocity handoff), §6 (momentum
projection), §3 (grabbable mid-flight).

**Current state:** `editor/js/pan.js` tracks 1:1 via `scrollLeft/scrollTop` (correct), but
on `pointerup` motion stops dead (`endPan`, `pan.js:42–47`). A flick feels like hitting a
wall — the exact seam the skill says separates "fluid" from "fine".

**Change:**
1. Feed `pointermove` events into the velocity tracker (F1) during a pan.
2. On `pointerup`, read release velocity; if speed > ~50 px/s start a `decay` loop
   (rate 0.998) applying deltas to `scrollLeft/scrollTop`. Clamp at scroll bounds
   (stop the axis that hits an edge).
3. Interruption: any `pointerdown` on `previewBody`, any wheel event, or a new render
   cancels the decay instantly — the user "grabs" the moving canvas. This is
   non-negotiable per skill §3.
4. Applies to both pan-mode and `⌘/Ctrl`-drag pan. Touch pans in pan-mode get it too
   (`touch-action: none` is already set, `preview.css:105–113`).
5. Keep momentum under `prefers-reduced-motion` (native scroll deceleration persists under
   reduced motion on every platform; it is user-generated motion, not vestibular
   decoration) — but see R11: everything else around it must already be calm.

**Acceptance:** a flick on a large zoomed-in diagram coasts and decelerates naturally;
touching the canvas mid-coast stops it exactly where it is and a new drag starts from
there with no jump; wheel input cancels coasting; velocity at handoff is continuous (no
visible seam between finger-up and coast — review frame-by-frame at 0.25×).

**Risk:** low-medium. Self-contained in `pan.js` + `motion.js`.

### Rank 5 · R2 — Preview zoom becomes smooth, interruptible, and compositor-friendly

**Why ranked #5:** felt-impact #2 — zoom fires constantly and today produces discrete
jumps plus layout-thrash jank on big diagrams — but it carries the list's riskiest
integration seam (transform-then-commit), so it lands right behind its sibling R3, which
shares that seam and its cancel paths.

**Skill:** §3 (interruptible, retarget from current value), §11 (animate only
`transform`/`opacity`; commit layout when settled), §1 (respond instantly).

**Current state:**
- Zoom buttons step ×1.25 and apply instantly by rewriting the SVG's `width`/`height`
  (`editor/js/zoom.js:9–19`) — a full layout + repaint of a potentially huge SVG per step.
- `Ctrl/⌘+wheel` zoom does the same per wheel tick with cursor anchoring
  (`editor/js/pan.js:58–76`). On large diagrams every tick relayouts.
- "Fit" and the 100% reset jump instantly (`zoom.js:28–45`).

**Change:**
1. Introduce a single animated `zoomValue` driven by `springTo` (response ≈ 0.3,
   critically damped). `applyZoom` becomes the *commit* function; a new
   `animateZoomTo(target, anchorPoint)` retargets the spring from the live value —
   pressing `+` three times fast must glide to the final target with no jumps
   (this is the skill's §3 litmus test).
2. During any *continuous* zoom (spring in flight, or a wheel-tick stream), scale with
   `transform: scale()` on the SVG relative to the last committed layout size
   (compositor-only), keeping the cursor-anchor math. When the interaction goes idle for
   ~120 ms, commit once via the existing width/height path and clear the transform, so
   scrollbars/pan metrics stay truthful.
3. Anchor rules: buttons and reset anchor at the viewport center of `preview-body`; wheel
   keeps the cursor anchor; "Fit" springs both zoom and scroll offsets.
4. Reduced motion: `matchMedia('(prefers-reduced-motion: reduce)')` → skip the spring,
   call `applyZoom` directly (current behavior).

**Acceptance:** repeated `+` presses produce one continuous glide; grabbing the canvas
(pan) mid-zoom-animation cancels the zoom spring cleanly; wheel-zooming a large example
(load one from Examples) no longer relayouts per tick (verify with a DevTools performance
trace — layout should appear only on commit); zoom label still reads correct percentages.

**Risk:** medium — the transform-then-commit seam must not visibly shift the diagram.
Guard: compute the committed scroll offsets from the same anchor math already in
`pan.js:69–75`.

---

## Tier 3 — High-value cheap wins (safe to sprinkle into any PR)

### Rank 6 · R10 — Accessibility fallbacks for the existing frosted surfaces

**Why ranked #6:** trivial, risk-free closure of a genuine gap; the brand lens called the
omission "a credibility hole in a standards manual."

**Skill:** §14 — `prefers-reduced-transparency` and `prefers-contrast` are independent
signals; translucent surfaces must have frostier/solid equivalents.

**Current state:** the shortcuts dialog panel is 88%-opaque + blur
(`editor/css/misc.css:53–69`) and the comparison dialog backdrop blurs
(`styles.css:451`) — **neither has a `prefers-reduced-transparency` or
`prefers-contrast` fallback.** Both files handle `forced-colors` and `reduced-motion`
but miss these two signals entirely.

**Change:** add to both stylesheets:
```css
@media (prefers-reduced-transparency: reduce) {
  .shortcuts-dialog-panel { background: var(--popover-bg); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .shortcuts-dialog { backdrop-filter: none; -webkit-backdrop-filter: none; }
  /* site: */ .comparison-dialog::backdrop { backdrop-filter: none; }
}
@media (prefers-contrast: more) {
  .shortcuts-dialog-panel { background: var(--popover-bg); border-color: var(--line-strong); }
}
```

**Acceptance:** toggling "Reduce transparency" in OS settings (or DevTools emulation)
yields fully solid overlays.

**Risk:** trivial.

### Rank 7 · R7 — Origin-aware comparison lightbox on the public site

**Why ranked #7:** brand lens #2 — the comparisons dialog is the marketing centerpiece
where evaluating engineers form their quality judgment, and this is the only motion
upgrade on the public site. No dependency on F1.

**Skill:** §7 (anchor interactions to their source), §12 (materialize, don't just fade).

**Current state:** clicking a comparison grid opens a `<dialog>` via `showModal()` with
**no entrance or exit animation at all** (inline site JS in `website/build.ts:1137–1445`;
dialog styles `styles.css:449–455`). The backdrop already blurs (`styles.css:451`).

**Change:** on open, set the dialog's `transform-origin` from the invoking panel's center
(the click target rect is available in the `data-comparison-lightbox-panel` handler,
`build.ts:1358, 1445`), then animate `opacity 0→1` + `scale(0.98)→1` over ~200 ms
`--ease-out`; on close, reverse along the same path at ~120 ms before calling `close()`.
Backdrop fades in sync. Reduced motion: fade only, no scale.

**Acceptance:** the lightbox visibly grows out of the panel the user clicked and returns
into it; `website-browser-a11y.test.ts:125` (which clicks a panel) still passes; keyboard
open (Enter on the "Inspect" button) uses the button as origin.

**Risk:** low. Pure enhancement in the inline script + CSS.

### Rank 8 · R12 — Toast micro-fixes

**Why ranked #8:** near-infinite value/effort ratio; the accessibility lens flagged the
unpausable dismiss timer as a WCAG 2.2.1-class timing barrier (slow readers race failure
messages).

**Skill:** §16 agency/utility, §13 harmony.

**Current state:** `editor/js/toast.js` — fixed 2.5 s timer, no pause; new messages
replace text mid-flight abruptly. Style at `misc.css:19–41` (fade + 4 px rise — fine).

**Change:** pause the dismiss timer on `pointerenter`/`focusin`, resume on leave (users
reading a share-link failure toast shouldn't race it); when a toast is already visible,
restart with a quick 80 ms fade-out/in so the text swap doesn't teleport.

**Risk:** trivial.

### Rank 9 · R5 — Two-finger pinch zoom + pan on touch

**Why ranked #9:** the only outright capability gap in the list — a missing feature reads
as "broken," not "unpolished" — tempered by minority touch usage of a code workbench and
by medium risk on the same transform seam as R2. Ship after R2/R3 settle.

**Skill:** §2, §10 (detect plausible gestures in parallel).

**Current state:** in pan mode `touch-action: none` claims touch input, but a second
pointer is ignored (`pan.js:26` tracks a single `panPointerId`), so touch users have no
diagram zoom at all — only the toolbar buttons.

**Change:** track up to two active pointers in pan mode; two pointers = pinch (scale about
the midpoint using the R2 transform path, committing on gesture end) + midpoint pan;
releasing one finger degrades gracefully to a 1:1 pan from the current value. Reuse the
wheel-zoom anchor math.

**Acceptance:** on a touch device (or DevTools touch emulation) pinch zooms about the
pinch center, tracks 1:1, and hands off into the momentum/zoom systems.

**Risk:** medium. Requires F1 + the R2 transform path.

### Rank 10 · R6 — Symmetric, fast popover exits

**Why ranked #10:** real but subtle — menus are touched many times per session, but an
instant close is low-pain asymmetry rather than a felt defect, and the popup state
machine needs care.

**Skill:** §7 — "If something disappears one way, we expect it to emerge from where it
came"; enter and exit along the same path.

**Current state:** editor popovers (export dropdown, theme/style menus, font/color
pickers) enter with a 160 ms origin-anchored fade/scale, but **exit instantly** —
`affordances.css:48–59` documents this as intentional ("dismissal should never lag").
The shortcuts dialog likewise has enter-only animation (`affordances.css:60–68`).

**Change:** keep dismissal *feeling* instant but honor path symmetry: add a `.closing`
state that plays the exact inverse (fade/scale back into the trigger) at **~90 ms** —
faster than the 160 ms entrance, well under perception-of-lag, then hide on
`animationend` (with a `setTimeout` fallback). Input must not be blocked during exit: the
popup controller (`createListboxPopupController`, `editor/js/helpers.js:126`) should drop
its open state and release focus immediately on close, with only the visual trailing.
Apply the same to the shortcuts dialog scrim/panel and the export dropdown. Reduced
motion: exits stay instant.

**Acceptance:** menus visibly retreat into their trigger; mashing the trigger to
open/close rapidly never gets stuck (the `.closing` animation is cancelled/replaced by a
reopen — interruptibility again); Escape/blur dismissal begins on the same frame as the
event.

**Risk:** low-medium (state machine care in `helpers.js`).

### Rank 11 · R8 — Mobile editor panel switch: cut → crossfade

**Why ranked #11:** trivial softening of a jarring full-viewport hard cut, on a minority
(mobile) path — cheap, self-contained, ships in minutes.

**Skill:** §7/§14 — abrupt full-viewport content swaps are disorienting; a gentle fade
aids comprehension.

**Current state:** on ≤760 px, switching Source/Style/Preview flips `display: none`
(`editor/css/panels.css:278–287`, driven by `editor/js/tabs.js:4–8`) — a hard cut of the
entire viewport.

**Change:** mirror the site's existing tab idiom (`styles.css:757–758`, `panel-in`
keyframe): when `data-mobile-panel` changes, the incoming panel plays a one-way ~120 ms
opacity fade-in (`animation: panel-in var(--dur-control) var(--ease-out)`). No exit
animation (the outgoing panel is gone — correct for a display toggle), no slide (nothing
spatial is being asserted between these views). Reduced motion: none (the global override
already flattens animations).

**Acceptance:** panel switches read as a soft cut; no layout shift; rapid tab mashing
never shows two panels.

**Risk:** trivial.

---

## Tier 4 — Durability

### Rank 12 · R15 — Add the motion vocabulary to the living design page

**Why ranked #12:** changes almost nothing a current user perceives, but the brand lens
ranked it #3 — codified restraint rules survive future contributors, and it only pays off
after the motion vocabulary above it has shipped. Do it last.

**Skill:** §17 — prototype interactively; the site's own `/about/design` page already
renders specimens off live tokens (`styles.css:862–885`, `.dz-motion`, `.dz-press`).

**Change:** add specimens for whatever ships from the tiers above: the spring response
values in use, a momentum-pan demo strip, and a note codifying the rulings from §0
("bounce only after momentum", "no new translucent surfaces", "never animate the render
path"). Append the same rulings to `DESIGN.md` so future agents inherit them — including
the list of descoped items below, so they aren't reintroduced from the skill by a future
pass.

**Risk:** none.

---

## Explicit non-goals (things the skill suggests that this site should refuse)

1. **No spring library dependency** — F1 covers every need in ~60 lines.
2. **No bounce/overshoot on click-triggered UI** (popovers, dialogs, copy feedback, tabs).
   The skill authorizes overshoot only when the user's gesture carried momentum; the only
   in-scope candidate is R3's coast (a decay, not a bounce).
3. **No new translucent materials anywhere** — on the public site's document surfaces per
   `DESIGN.md`, and on editor chrome per the ranking review (see R9 below). Materials work
   is limited to R10's fallbacks for the frosted overlays that already exist.
4. **No crossfade on the render swap** — render latency work is R1; choreography on the
   typing path would *add* perceived latency.
5. **No global page transitions** — `styles.css:212–218` deliberately disables root view
   transitions; leave that decision alone in this pass.
6. **Don't touch the home-page entrance stagger or the shader mark** — both already follow
   the skill (one entrance on load; sweep only on hover/focus; static under reduced
   motion; WebGL fallback).

## Removed from scope by the ranking review (do not reintroduce)

Five items from the original 17-item audit were cut after the five-lens stack rank.
Listed so a future pass doesn't rediscover them from the skill and re-propose them:

- **R4 — rubber-band splitter bounds.** Once-per-session control; the brand lens judged a
  springy splitter "the closest item to a bouncy gimmick on a precision instrument," and a
  firm clamp communicates the bound honestly. (F1's rubber-band helper was dropped with
  it.)
- **R9 — translucent floating preview toolbar.** The accessibility lens ranked it dead
  last for cause: it deliberately places chrome over arbitrary busy diagram content,
  manufacturing the exact legibility-risk surface class R10 exists to remediate, and it
  flirts with `DESIGN.md`'s no-glass prohibition.
- **R13 — haptic tick on copy.** Bottom-three for four of five lenses; the brand lens
  called it exactly the category of gimmick that damages this brand.
- **R14 — px→rem spacing/control conversion.** A legitimate text-scaling accessibility
  win, but the widest blast radius in the list (site-wide mechanical change, screenshot
  diffing, test updates). Removed from this effort's scope; if the text-scaling harm is
  revisited later, it should be its own carefully staged project, not a motion-polish
  rider.
- **R16 — standalone review-recipe item.** Ships nothing itself; its substance survives as
  the per-PR checklist in the sequencing section below.

## Suggested sequencing

| PR | Contents | Effort |
|----|----------|--------|
| 1 | R1 (adaptive debounce, delayed spinner) | S |
| 2 | R11 curated reduced-motion (site + editor) — before any new animation ships | M |
| 3 | F1 + R3 (motion utils, momentum pan) | M |
| 4 | R2 smooth zoom (coordinate with R3's cancel paths) | M |
| 5 | R10 + R12 + R8 (trivial wins, no interdependencies) | S |
| 6 | R6 popover exits | S–M |
| 7 | R7 lightbox origin (public site) | S–M |
| 8 | R5 pinch zoom (after the R2/R3 seam has settled) | M |
| 9 | R15 design-page specimens + DESIGN.md rulings | S |

Each PR: run `bun test src/__tests__/`, `bunx tsc --noEmit`, `bun run website` (stamp
sync), and apply the repo's `good-pr` skill checklist — for these visual changes, §2
(captioned before/after renders or short recordings) and §4 (tests that fail when the fix
is reverted, e.g. debounce-adaptivity unit tests on `scheduleRender`) matter most. For
every motion PR, review the interaction frame-by-frame (Playwright slow-mo; Chromium is
pre-installed) and answer three questions before merge: does it start from the current
value? can it be interrupted by input? what does it do under reduced motion?
