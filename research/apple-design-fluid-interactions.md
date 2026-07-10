# Fluid interactions for Agentic Mermaid

This is the implementation record for the `apple-design` review. It is deliberately a
qualitative, repository-specific priority order—not a claim of measured traffic, user-study,
or five-reviewer scores. The code and tests are the source of truth for shipped behavior.

## Boundaries

- No new runtime dependency: editor motion remains vanilla browser JavaScript.
- No animation is added to the typing → render result swap. Rendering is made more responsive
  instead; the preview still changes atomically.
- No click-triggered control bounces or overshoots. Momentum is reserved for direct drag
  gestures.
- No new translucent chrome. Existing frosted overlays gain solid accessibility fallbacks.
- Reduced motion preserves brief opacity and colour feedback only; it does not restore
  transforms, springs, or decorative movement.

## Delivered order

| Rank | ID | Delivered behavior |
|---|---|---|
| 1 | R1 | Adaptive render debounce and a delayed spinner |
| 2 | R11 | Curated reduced-motion opacity/colour feedback |
| 3 | F1 | Testable spring, decay, and velocity primitives |
| 4 | R3 | Interruptible momentum pan |
| 5 | R2 | Presentation-transform zoom with one layout commit |
| 6 | R10 | Opaque transparency/contrast fallbacks |
| 7 | R7 | Origin-aware native comparison dialog motion |
| 8 | R12 | Pausable, replaceable toast timer |
| 9 | R5 | Two-pointer pinch zoom and pan |
| 10 | R6 | Semantic-immediate, visual 90 ms popup exits |
| 11 | R8 | Mobile panel opacity entrance |
| 12 | R15 | Motion specimens and durable design rulings |

## R1 — render response, debounce, and spinner

`editor/js/rendering.js` records only the duration of a current, successful render. The next
ordinary edit uses `EditorMotion.adaptiveRenderDelay(lastSuccessfulMs)`, clamped to 60–300 ms.
An explicit `scheduleRender(0)` remains immediate for deliberate actions such as choosing a
theme or example.

The spinner is version-scoped and delayed by 250 ms. A new edit, an empty source, a completed
current render, or a cancelled/stale render clears its pending timer. This preserves the existing
version/source guard and prevents an obsolete timer from revealing a spinner during a newer
request.

**Acceptance:** inspect a fast edit and a large diagram in a browser; fast renders do not flash a
spinner, and expensive typing retains a bounded debounce. This is a performance observation, not
a deterministic wall-clock assertion. `src/__tests__/editor-motion.test.ts` pins the delay
function's initial and clamp behavior.

## R11 — reduced motion

The universal near-zero-duration rule remains the safe default. After it, the site restores only
a 150 ms opacity `panel-in-reduced` animation for channel tabs and opacity/colour/background/
border transitions. The editor restores only the toast opacity fade and forces its resting
translation. Mobile panel switches, popovers, dialogs, press feedback, springs, and the home
mark remain non-animated under the preference.

**Acceptance:** under `prefers-reduced-motion: reduce`, no shipped element translates or scales
as an effect; tab and status comprehension fades remain short and transform-free.

## F1 — shared motion contract

`editor/js/motion.js` loads before zoom and pan. Its public global is `EditorMotion`:

- `springTo({ from, to, velocity, response, onFrame, onDone })` reports both current value and
  velocity every frame and returns `{ cancel, getState }`.
- `decay2d({ vx, vy, rate, onFrame, onDone })` reports signed deltas and stops if its consumer
  returns `false`; it returns `{ cancel, getVelocity }`.
- `makeVelocityTracker()` retains the recent 100 ms pointer window.
- `adaptiveRenderDelay()` and `clamp()` are pure helpers.

`src/__tests__/editor-motion.test.ts` uses a fake clock and fake rAF to exercise delay bounds,
velocity signs, a spring's live velocity/final state, and cancellation. This is intentionally a
real behavior test of the primitives, not a snapshot of their implementation details.

## R3, R2, and R5 — preview gesture contract

`editor/js/pan.js` owns pointer identity and scroll-space panning. A one-pointer drag preserves
the existing 1:1 rule: moving the pointer right reduces `scrollLeft`; momentum applies the same
signed direction. It samples release velocity, decays at `0.998`, stops an axis at its scroll
bound, and is cancelled by a pointerdown, wheel input, or render replacement. Pointer cancellation
never starts a coast. Under reduced motion, release does not start a coast: the preview stays at
its final direct-manipulation position.

`editor/js/zoom.js` separates a temporary presentation zoom from the committed layout zoom. A
button press uses a critically damped 0.3 s spring; continuous modifier-wheel input uses a
transform and commits once after 120 ms idle. Every transform and commit preserves its cursor or
viewport-center anchor. A new pan commits and cancels a current zoom before taking control; an
input/rerender cancels active preview motion before replacing the SVG.

Two active pointers in pan mode form a pinch: distance drives presentation zoom about the moving
midpoint and midpoint movement pans. Releasing one pointer re-bases a normal one-pointer drag;
releasing both commits the presentation zoom. This deliberately shares the same transform/commit
path as wheel and button zoom rather than inventing a second coordinate model.

**Acceptance:** verify at 0.25× speed that pointer release has no sign seam, bounds stop coasting,
pointerdown grabs a coast, repeated zoom presses retarget from the visible scale, and pinch
hands off without a jump. Review a DevTools trace on a large diagram: continuous zoom should not
commit width/height per wheel tick.

## R10 — solid overlay accessibility fallbacks

The shortcuts dialog and public comparison dialog disable both prefixed and unprefixed backdrop
blur under either `prefers-reduced-transparency: reduce` or `prefers-contrast: more`. They use
opaque token backgrounds and strong borders. These media features are progressive enhancements;
the default surfaces remain readable in engines that do not expose the preference.

## R7 — native comparison dialog lifecycle

The public comparison lightbox remains a native `<dialog>`; it is never replaced by a positioned
`div`, so top-layer modality, Escape, and browser focus behavior remain intact. Every opener
passes its actual invoking element to `openComparison(section, origin)`. The source grid's rect is
captured before it is moved into the dialog, then a 200 ms scale/fade uses that origin.

All close paths are centralized in `requestClose()`: Close, native `cancel`/Escape, and backdrop
click snapshot a noninteractive visual tail, then call native `dialog.close()` on the same event
frame. The `close` event remains the single restoration point for the moved grid, controls,
overflow, trigger attributes, and focus; the 120 ms tail is a detached, `inert`, `aria-hidden`
copy and cannot retain modality or focus. Reduced motion skips the exit tail; opening remains
opacity-only.

`src/__tests__/website-browser-a11y.test.ts` covers grid and header openers, animated close, Escape,
and focus return. The standalone research mock now uses native dialogs too; it is an interaction
prototype, not the production implementation.

## R12 — toast agency

A shown editor toast enables pointer interaction and a temporary tab stop. Its one live region
keeps remaining duration, start time, pause state, and replacement timer. Pointer hover or focus
pauses dismissal; leave/focus departure resumes it; a replacement fades out for 80 ms before the
new message resets the full timer. Hidden toasts are noninteractive and leave the tab order.

## R6 and R8 — small state transitions

Popup controllers close semantically on the event frame: ARIA, `inert`, tab stops, focus, and peer
state release immediately. Eligible popups then retain only a noninteractive `.closing` visual tail
for 90 ms; reopening cancels that tail. Reduced motion skips the tail. The shortcuts dialog is
ported to a direct body child while open, makes its editor siblings `inert`, and restores them on
the same close event before its noninteractive visual tail.

At phone widths, the incoming editor Source/Style/Preview panel uses a one-way 160 ms opacity
entrance under `prefers-reduced-motion: no-preference`. The outgoing panel remains `display:none`;
there is no spatial claim and no two-panel overlap.

## R15 — durable rules

`/about/design` now documents press, enter, exit, interruption, momentum, reduced-motion, and
opaque-overlay rules. Its draggable momentum strip is a small public specimen, not editor code.
`DESIGN.md` carries the same durable rulings, including exclusions: rubber-band splitters,
translucent floating preview toolbars, haptic copy ticks, global page transitions, and broad
px-to-rem conversion require a separately justified review.

## Validation

Run after changes to these inputs:

```bash
bun test src/__tests__/editor-motion.test.ts
bun test src/__tests__/website-build.test.ts
bun test src/__tests__/website-browser-a11y.test.ts
bun run test:browser
bunx tsc --noEmit
bun run website
bun run website:check
```

Browser tests prove observable contracts—dialog lifecycle/focus, mobile panel reachability, and
popup inertness. They do not claim a machine-independent frame-rate benchmark; review the
performance and gesture acceptance cases manually on representative large diagrams and touch
emulation before merging.
