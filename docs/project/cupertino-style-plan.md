# Cupertino style — plan

> Execution detail for one probe of the umbrella
> [brand-primitives discovery plan](./brand-primitives-plan.md), which frames
> the goal (the right primitives for brand expression across all families),
> the three example brands, and the declarative–programmatic balance.

## Decision

Add `cupertino` as a built-in full look: an Apple-HIG product surface — borderless
white cards on a grouped gray page, hierarchy from surface and weight instead of
outlines, systemBlue held in reserve. It is the first built-in that encodes a
*design system* (semantic tokens, a typography ramp, elevation) rather than a
texture, and it becomes the worked example for users registering their own brand
styles.

The style is derived from emilkowalski's `apple-design` skill
(<https://www.skills.sh/emilkowalski/skill/apple-design>), which distills Apple's
WWDC design talks. Only its static chapters transpose to a diagram renderer:
materials & depth ("Designing Fluid Interfaces", WWDC 2018), size-specific
typography ("The Details of UI Typography", WWDC 2020), and the eight design
principles ("Principles of Great Design"). The motion chapters — springs,
velocity handoff, interruptibility — do not transpose into the static Cupertino
Look, and every public artifact says so rather than implying otherwise. The
motion ethos survives only as geometry: the largest edge bend radius of any
built-in, concentric corner radii.

A working prototype is registered in `src/scene/style-registry.ts` on this
branch, rendered across all fourteen families, and reviewed by a five-lens
elevation pass (HIG fidelity, differentiation, engine feasibility, teaching,
cold-eyes visual). The registered palette/font path reaches all fourteen;
Mindmap and GitGraph do not yet consume the internal role-face overrides, so
their renders expose a residual fidelity gap rather than proving complete
fourteen-family face coverage. The findings below are verified against code
and renders.

## Why it earns built-in status

- **It fills the largest empty region of the style space.** Every existing look
  is sketch/nostalgic, print/technical, or ops. There is no modern
  product-surface look; `crisp` is neutral, not designed. This is the
  highest-demand register for an agent-native tool documenting software.
- **It opens a new axis, not a new texture.** Every default-backend look that
  sets a node border uses `var(--fg)`; cupertino alone separates nodes with
  surface fill + elevation (`borderColor: 'transparent'`). The engine gaps this
  exposed (findings below) are platform primitives any future borderless look
  (material/fluent) will reuse.
- **It is the flagship of the crisp backend.** Every other full look leans on
  the rough/hybrid machinery; cupertino proves the fast, byte-stable default
  path can carry a premium look from the palette + face system alone.
- **It teaches.** Existing looks teach "styles can imitate media"; cupertino
  teaches "styles can encode a design system": token mapping, alpha fills that
  survive palette stacking, a weight-based type ramp, restraint rules (no
  uppercase, no 1px dividers), and every value carrying a checkable source.

Naming: keep `cupertino` — the ecosystem metonym for Apple-style UI (Flutter's
iOS widget library is literally named Cupertino), trademark-safe, and it
composes with the `-dark` sibling convention (`zinc-dark`, `tufte-dark`).

## The spec (v0.2, as prototyped)

```ts
colors: { bg: '#f2f2f7', fg: '#000000', line: '#7a7a80', accent: '#007aff',
          muted: '#66666b', surface: '#ffffff', border: 'rgba(60,60,67,0.29)' }
font: 'Inter'   // SF Pro's license restricts it to Apple platforms; Inter is
                // the bundled PNG-safe stand-in. Do not substitute.
face:
  node:  13/600, tracking 0, padding 24/12, radius 10, fill var(--surface,
         var(--_node-fill)), border transparent
  edge:  11/500, tracking 0.07 (SF small-size bump ≈ +6/1000em), width 1.5,
         bend radius 16, stroke var(--line, var(--_line))
  group: 12/600 in var(--muted), padding 16/16, radius 26 (= 10 + 16, corner
         concentricity), fill rgba(120,120,128,0.08), header band
         rgba(120,120,128,0.12), border transparent
```

Value provenance, and the two deliberate deviations from Apple's literal tokens:

| Value | Source | Note |
|---|---|---|
| `#f2f2f7` / `#ffffff` | systemGroupedBackground / systemBackground | pure-white surface is the *sourced* token; it reads as elevation only because the page is tinted (rubric amendment below) |
| `#000000` fg | label (light) | |
| `rgba(60,60,67,0.29)` | separator | alpha fills survive palette stacking |
| `rgba(120,120,128,0.08/0.12)` | quaternary/tertiary systemFill tier | |
| `#7a7a80` line | systemGray `#8e8e93`, darkened | HIG's gray measures **2.92:1** on the page — under this repo's 3:1 stroke gate. 3.82:1 after adjustment |
| `#66666b` muted | secondaryLabel, darkened | HIG's `rgba(60,60,67,0.6)` composites to **~2.8:1** over the group panel — under the 4.5:1 text gate. 4.68:1 after adjustment |

The repo's legibility gates win over literal HIG fidelity; the deviation is
documented in the spec comments. White cards measure **1.12:1** against the
page — separation is carried by the drop shadow, which is why Phase 1 below is
a hard prerequisite.

## What the mock + elevation review exposed

Verified findings, in dependency order. E* came from building the mock, R* from
the five-lens review; ✅ = already resolved in the v0.2 prototype.

| id | Finding | Where |
|---|---|---|
| E2 | `shadow` exists (`buildShadowDefs`, `src/theme.ts:302`) but is not a StyleSpec field, is not threaded into the SVG call made by `renderMermaidPNG` (`src/agent/png.ts:102-109`), and has no CLI flag. With cards at 1.12:1 the shadow is load-bearing: `style: 'cupertino'` alone cannot reproduce the mock, breaking the "(source, stack, seed) is complete" contract and making published screenshots unreproducible. | gates Phase 2 |
| E6a | Mechanical stacking bug: THEMES registration writes explicitly-`undefined` color channels (`src/scene/style-registry.ts:300-312`); the nested colors merge (`:197-199`) can spread them over a look's declared channel. Cupertino's node face now has a defensive `var(--surface, var(--_node-fill))` fallback, but the composition protocol can still erase channels for consumers without one. | Phase 3 |
| E6b | Dark needs design, not derivation: Apple dark *inverts* elevation (cards `#1c1c1e` lighter than a `#000` page, hairlines instead of shadows) while `buildShadowDefs` floods white glow on dark bg (`theme.ts:307-309`). | Phase 4 |
| E1 | Edge-label chips are hardcoded (`rx="2" fill="var(--bg)" stroke="var(--_inner-stroke)"`, `src/renderer.ts:704-750`) — the most ubiquitous off-brand element across families. | Phase 3 |
| E3 | `quadrantFill` emits `color-mix(in srgb, <rgba> …, var(--bg))` (`src/quadrant/renderer.ts:371-377`); `inlineResolvedColors` only reduces hex-input mixes (`src/theme.ts:662-668`), so this rgba form survives for resvg. srgb mix over rgba-on-hex is deterministic math — inline it at resolve time. | Phase 3 |
| E4 | Quadrant points take `nodeFillColor` — surface-white points vanish on pale region fills. | Phase 3 |
| E5/E9 | "No border" is not first-class: only `borderColor:'transparent'` (lineWidth must stay > 0), and Gantt treats any defined border value — including transparent — as bordered (`src/gantt/renderer.ts:141,183-184`), leaving white bars invisible outside section bands (1.07:1). | Phase 3 |
| E7 | The accent still has no shared structural-role hook; state initial/final dots render in the heaviest ink on the canvas (`src/renderer.ts:1252-1280`, `var(--_text)`) — the cheapest, most on-brand accent home. | Phase 3 |
| E8 ✅ | The section-band finding is closed across Timeline, Journey, and Architecture. Architecture now projects `style.groupHeaderFillColor` to `groupHeaderSurface` (`src/architecture/config.ts:179,212`) and emits it through `--arch-group-band` (`src/architecture/renderer.ts:56,172`). | done on main |
| R1 ✅ | HIG grays failed the repo's own gates (`docs/style-authoring.md` rubric item 4). Resolved in v0.2 (values above). | done |
| R2 | The old "all charts use one hue" finding is now only partly true. XYChart still derives a same-family accent ramp (`src/xychart/colors.ts:92-123`), while Pie uses explicit `pie1..pie12` overrides and switches high-count charts to a count-sized hue spread (`src/pie/palette.ts:21-23,44-80`). The remaining brand gap is a public StyleSpec categorical series palette that can seed Apple system colors once across chart families (light: `#007aff #34c759 #ff9500 #ff3b30 #af52de #5ac8fa`; dark variants shift accordingly). | Phase 4/5 |
| R3 | Titles still have no dedicated face role. Pie now defaults its title to 18/600 but projects it through the group-header role (`src/pie/renderer.ts:41-64`); other families retain their own mappings. A shared brand title role remains the residual request: 17/600 in `fg`. | Phase 5 |
| R4 ✅ | Registry drift was real, but is closed on this branch: hosted MCP and llms-txt derive their Look menus from `knownStyles()` + `styleKind`, with drift tests; editor membership was already registry-derived and now has the Cupertino display label. | done on branch |
| R5 | The "teach brand styles" claim collides with `face` being internal-only (`KNOWN_KEYS`, `src/scene/style-registry.ts:237-242` — no `face`): a user following an "anatomy of cupertino" cookbook can reproduce only colors+font. | Phase 5 decision |
| R6 | ER still splits attribute type/name to opposite card edges (`src/er/renderer.ts:340-370`, name `text-anchor="end"`), reading as label/value pairs on wide padded cards. | backlog |

## Phases

Each phase is one PR-sized concern (good-pr: one concern, minimal diff,
red→green tests stated).

### Phase 0 — registry-drift cleanup (complete on this branch)

- Hosted MCP and llms-txt now derive their Look menus from `knownStyles()` +
  `styleKind`; the editor's option membership already followed the registry.
- Drift tests assert that every registered Look appears in both generated
  descriptions.
- All 16 Looks, including Cupertino, now ship discoverable by construction.

### Phase 1 — elevation becomes a style capability

- Add `shadow?: boolean` to `StyleSpec`: `KNOWN_KEYS`, `validateStyleSpec`,
  `docs/schemas/style-spec.schema.json`, field-reference row in
  `docs/style-authoring.md`.
- Thread it: styled scene path reads the resolved stack's `shadow`;
  `renderMermaidPNG` passes it through; SVG path already has
  `buildShadowDefs`/`buildStyleBlock` plumbing.
- Dark-aware: on dark backgrounds emit hairline-over-lightening, not the white
  glow (or suppress shadow entirely; decide in Phase 4 — until then keep the
  existing luminance behavior).
- Tests: crisp corpus byte-identity (field defaults absent), PNG renders with
  and without, red→green by asserting the filter def appears only when asked.

### Phase 2 — ship the style

- The v0.2 spec above, plus `shadow: true` once Phase 1 lands.
- Already done on this branch: golden matrix entry + regenerated
  `styled-output-baseline.json` (23 new Cupertino rows; 23 fixtures × 16 Looks
  = 368 records, with no unrelated drift),
  website fact-strip count 15 → 16.
- Blurb stays use-case-first and accurate to what renders (no "one blue accent"
  claim until E7's hook exists; blurbs surface verbatim in `am styles`, the
  editor picker, and the website's "Best for" column).
- `STYLE_LABELS` entry in `scripts/site/editor.ts`; `STYLE_THEME_LABELS` in
  `website/build.ts`; consider the fourth home-showcase persona ("Product doc")
  and one examples-page family slot (sequence or journey).
- Rubric amendment in `docs/style-authoring.md` item 2: ban *unsourced*
  pure #000/#fff — a design system's own token may be pure when surrounding
  values make it deliberate (cupertino's white cards on a tinted page).
- One-line non-affiliation note where built-ins are cataloged (covers
  `excalidraw` too).
- `docs/fork-differences.md`: extend the style examples sentence with the
  design-system category.

### Phase 3 — the borderless axis (independent engine fixes, each style-gated)

All default to today's exact output; crisp stays byte-identical. Each lands
with a red→green test that fails when the fix is reverted.

1. **Colors merge drops undefined channels** (E6a): skip-undefined in the
   per-channel merge or filter at THEMES registration; test with
   `['cupertino','zinc-dark']` asserting `--surface` is emitted.
2. **Edge-label chips** (E1): internal edge-face fields
   (chip radius/fill/stroke) defaulting to the current hardcoded string;
   cupertino sets pill radius (height/2), `var(--surface)` fill, no stroke.
3. **Gantt bar stroke fallback** (E5/E9): when resolved `nodeBorderColor` is
   transparent/absent, stroke bars with `var(--border)`; follow-up: accent
   fills for `active`/`crit`.
4. **State initial/final dot hook** (E7): fill resolved from a face field
   defaulting to `var(--_text)`; cupertino sets `var(--accent)` — the style's
   single deliberate color moment in structural diagrams.
5. **color-mix numeric inlining** (E3): teach `inlineResolvedColors` to
   evaluate `color-mix(in srgb, …)` when both inputs resolve (rgba-over-hex
   compositing is closed-form); unblocks quadrant PNG for any translucent
   style.
6. **Quadrant point fill** (E4): points should prefer accent over node fill.
7. ~~**Architecture header band** (E8 remainder).~~ **Resolved on main:**
   Architecture now projects `style.groupHeaderFillColor` into its visual config
   and `--arch-group-band`, matching Timeline and Journey. Retained here to close
   the discovery trail; no Phase 3 work remains for E8.

### Phase 4 — cupertino-dark

Follow the tufte precedent (palette in `THEMES`, stackable by name), but the
review is explicit that a palette alone cannot fix dark: group-fill alpha must
roughly double (quaternary fill dark is `rgba(118,118,128,0.18)`) and hairlines
replace shadows — face-level changes. Decide then: THEMES palette + documented
`['cupertino','cupertino-dark']` stack as v1, full dark look if the palette
residuals grate.

Palette (Apple dark grouped tokens): bg `#000000`, surface `#1c1c1e`,
fg `#ffffff`, muted `rgba(235,235,245,0.6)` (gate-check first), line `#98989d`
(gate-check), accent `#0a84ff`, border `rgba(84,84,88,0.6)`.

### Phase 5 — teaching

- `docs/style-authoring.md`: a ~20-line "Design-system styles" section — the
  7-slot token-mapping table (page bg → `bg`, elevated card → `surface`,
  separator → `border`, secondary label → `muted`, accent spent once), alpha
  fills for stack-survival (with the E3 caveat until fixed), the type-ramp
  rule, and "declare what the system forbids". Cupertino becomes worked
  example #2 beside Making Software: *a texture style captures how ink
  behaves; a design-system style captures how a company decides.*
- Cookbook: decide R5 — either promote a minimal public face subset
  (per-role size/weight/tracking, cornerRadius, fill/border colors, bendRadius)
  into `StyleSpec` with full schema/docs treatment, or keep `face` internal and
  teach the boundary honestly: a `brand-card.style.json` public-fields
  approximation rendered beside the real built-in so the delta is visible.
  This is the one genuinely open product decision in the plan — it re-treads
  the deliberate role-styling removal
  (`docs/project/remove-role-styling-plan.md`), so default to **keep face
  internal** unless brand-style demand proves out.
- Cross-family categorical series palette (R2) and title role (R3) ride
  whichever of Phase 3/4 PRs touches the nearest renderer, or wait for demand.
- Every published screenshot ships only after Phase 1 so the caption's
  reproduction command actually reproduces it (cookbook `--check` contract).

## Testing strategy

- `bun test src/__tests__/` is the branch gate after the golden matrix addition
  (baseline +23 Cupertino rows; 368 records total, no unrelated drift) and the
  website count bump.
- Crisp byte-identity and the svg-equivalence corpus gate every Phase 3 change;
  each fix defaults to current bytes and is exercised via cupertino goldens.
- Contrast gates are now computed facts in this plan (2.92 → 3.82, 2.67 → 4.68);
  a follow-up could assert them in the style-rubric tracker.
- ASCII/unicode renderers are untouched — styles apply to SVG/PNG only; docs
  should not imply otherwise.

## Honest limits

- The source skill is ~70% motion; a static style captures its materials,
  typography, and principles chapters only. Marketing copy must not promise
  "fluid interfaces". This is specifically a gap in cross-family diagram
  motion tokens; the editor/site shell already animates its own interactions,
  and authored Flowchart edge animation is a narrower Mermaid feature.
- Mindmap and GitGraph consume Cupertino's public palette/font path but not its
  internal role-face typography, spacing, radii, or role colors. They remain in
  the all-family evidence to make that limitation visible, not to imply parity.
- Without Phase 1, `style: 'cupertino'` renders flat borderless cards at
  1.12:1 — legible but not the mock. Do not publish shadowed renders before
  Phase 1 lands.
- HIG's own grays fail WCAG here; we ship gate-compliant approximations and
  say so. Dark stacks other than the blessed one are unsupported by design
  (edges route through `--line`, not `--fg` — a deliberate softness trade).
- Skill-§ citations were removed from code comments: bare `§N` in this repo
  resolves to `scripts/sketch-prototype/SPEC.md` (where §12 is "Risks"), so
  comments cite Apple token names and WWDC session titles instead.

## Mock

Rendered evidence (all fourteen families, before/after, dark stack, findings):
artifact "Cupertino — a built-in Style mock". Regeneration: render each family
with `{ style: 'cupertino', shadow: true, idPrefix: '<family>-' }` via
`renderMermaidSVG`; the flowchart example used throughout is the
Client/Cloud sign-in flow in the artifact.
