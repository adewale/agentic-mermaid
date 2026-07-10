# Brand primitives — discovery plan

## Goal

Discover the right primitives for corporate brands to express themselves across
the **full family of diagrams** — all twelve families, one registration, SVG and
PNG alike. Not "add an Apple-looking style": use real brands as probes, measure
what the Style + Palette APIs can and cannot express, and derive the smallest
set of composable primitives that closes the gap.

Three probes, three positions on the declarative–programmatic spectrum:

| Probe | Source | How it renders today |
|---|---|---|
| `cupertino` | emilkowalski's apple-design skill (Apple WWDC talks) | Registered built-in — the fully **declarative** path (plus the `shadow` render option it shouldn't need) |
| `vercel` | vercel-labs/beautiful-mermaid fork defaults + Geist language | **Internal-only**: the `@internal RenderStyleOptions.styleFace` hook (`src/styles.ts:113`) — inexpressible as public style JSON |
| `cf-workers` | CF Workers design-system `tokens.json` (cream/tan ramp, orange intent, mono meta) | Internal-only, same hook |

That asymmetry is the finding. One brand ships; two brands with equally
legitimate token systems cannot be written down by a user at all. The
execution phases live in [`cupertino-style-plan.md`](./cupertino-style-plan.md)
(this document is the umbrella that says *why those phases and which
primitives*).

Mocks: the full 3-brands × 12-families matrix is rendered live in the
"Brand primitives — three brands, twelve families" artifact; the committed
composite `docs/pr-assets/brand-primitives-three-brands.png` shows one source
under all three brands. Everything regenerates from
`bun run scripts/pr-assets/brand-primitives-probe.ts <out-dir>` — the probe
faces are data in that script, single source of truth.

## What the example brands say they need

**Cupertino (Apple HIG).** Surface-defined shapes — borderless cards where
separation comes from fill + **elevation**, so shadow must be a style token,
not a render flag. A per-role type ramp (13/600 node, 11/500 edge with SF's
small-size tracking bump, 12/600 header) — hierarchy from weight, never
uppercase. Radius discipline (concentric corners: outer = inner + gap). Alpha
group fills that survive palette stacking. A **designed** dark companion
(Apple dark inverts elevation: cards lighten, hairlines replace shadows).
A semantic landing spot for the accent (state dots; today it never fires in
structural families).

**Vercel.** Their fork's implicit requirements: **brand-as-default** (they
hardcoded Vercel dark + Geist as the zero-config default — branding by
pipeline ownership because the API couldn't say it), a **brand font with
deterministic PNG** (Geist is SIL OFL 1.1, so bundling is possible — unlike SF
Pro), hairline-border dark language (radius 6, 1px `#2e2e2e` borders, no
shadows), live retheme via CSS variables (already a strength), and motion as
a signature (see the punt section).

**CF Workers.** The richest token file, and the best test of vocabulary
coverage: a **4-level surface ramp** (`bgPage`, `bg100/200/300`) where the
current palette has two levels; a **3-tier text hierarchy**
(`text/textMuted/textSubtle`); **semantic status colors**
(success/warning/error/info) that gantt/journey/state semantics want; a
**categorical palette in strong+soft pairs** (compute/storage/AI/media) for
charts and service categories; a **sans + mono font pair** with per-role
assignment ("mono for technical labels" — class members already render mono in
a font no style can choose); a named **radius scale up to pill**; a
**brand-tinted two-layer shadow** (`rgba(82,16,0,…)`, not neutral black);
**signature textures** — dot-pattern backgrounds, dashed dividers, corner
brackets; and prose **brand constraints** ("orange is an accent, not a
flood-fill", "no pure white backgrounds").

Union, grouped (details and file:line evidence in the missing-features
analysis that produced this plan):

- **A. Token vocabulary**: surface ramp, third text tier, status colors,
  categorical strong+soft pairs, `fontMono`.
- **B. Role-level system** (the keystone): per-role size/weight/tracking,
  radius, padding, fill/border — exactly the internal `face`, needed by all
  three brands, reachable by none of their users.
- **C. Treatment vocabulary**: shadow as a token (tint/layers), border dash
  styles, parameterized backdrops (dot pitch/color), ornaments, micro-chrome
  hooks (edge chips, state dots, titles).
- **D. Packaging & pipeline**: light/dark variants in one record,
  design-tokens ingestion (`tokens.json` → StyleSpec), brand-as-default
  configuration, machine-checkable brand contracts (the `mono` flag is the
  existing precedent), registry-derived discovery surfaces, and the
  correctness fixes brands trip over (undefined-channel stack merge,
  color-mix-over-rgba in resvg).

## The declarative–programmatic balance (Design for Emergence)

Kasey Klimes's ["When to Design for Emergence"](https://www.kaseyklimes.com/notes/2022/6/9/when-to-design-for-emergence)
distinguishes user-centered design — study the modal user, own the solution —
from **design for emergence**: give users a small alphabet of composable
primitives so they can build things the designer never anticipated. His tests:
the designer can be *meaningfully surprised* by what users make; the tool
*leverages local knowledge* the designer doesn't have; composition requires no
technical expertise ("low floors, wide walls, high ceilings"). And Ashby's law
of requisite variety: the tool must support at least as many states as the
brand systems it needs to express — achieved by **few primitives ×
composition**, never by enumerating features.

Brand styling is a textbook long-tail problem. The modal need ("recolor to my
palette") is served today. The tail — CF's corner brackets, Apple's concentric
corners, whatever the next brand's signature is — is individually rare,
collectively unbounded. A schema that chases it field-by-field
(`cornerBrackets: true`) is user-centered design losing to the tail one
feature at a time; Vercel's fork is what users do when the tail isn't served.

The repo is already half-emergent, which is worth saying out loud: **styles
compose by stacking** (a shared protocol — "hand-drawn × dracula" is LEGO,
not a feature), themes are just palette-only styles, seeds re-roll
deterministically, and `registerBackend` is a public programmatic ceiling.
The probes exposed the missing middle: between the 7-token palette (public,
composable) and code-backed backends (public, expert) sits the **role face —
internal**. Both non-cupertino probes rendered only via the internal hook.

The balance rule this plan adopts:

1. **Declarative = the alphabet.** Promote *general* primitives that compose:
   the role × property face subset (B), the token-vocabulary gaps (A), and
   scalar treatments (shadow token, dash pattern, backdrop parameters from C).
   Each must be brand-agnostic, JSON-safe (the declarative-only security
   stance — no markup, no URLs, no code — is non-negotiable and is itself a
   floor-lowering feature: agents and files can carry styles safely), and
   meaningful under stacking. Test for admission: *can two unrelated brands
   both want it, and does it compose with everything that exists?*
2. **Programmatic = the surprise.** Signature one-brand details (corner
   brackets, dot-grid materials, novel node treatments) stay in code:
   `registerBackend` today, and a documented, supported `styleFace` story for
   code-registered styles tomorrow — the probe script shows the shape. The
   escape hatch keeps the schema honest: pressure to add a weird field is
   redirected to code until the *rule of three* (a third unrelated brand
   wants it) promotes a generalized primitive into the alphabet.
3. **Protocol > both.** Fixes to composition itself (undefined-channel merge,
   color-mix inlining for PNG, light/dark variants in one record,
   tokens.json ingestion) multiply every primitive, declarative or not, and
   sequence first.

What we explicitly do **not** build: per-diagram-element styling (that was
role styling, deliberately removed — the alphabet is per-*role*, not
per-node), CSS/JS injection, or brand-specific spec fields.

## Punted: animation and motion

Animation and motion are **deliberately deferred, not forgotten**. Two of the
three probe brands treat motion as identity: Vercel's fork made rank-by-rank
SVG animation (CSS + SMIL, velocity-free, `prefers-reduced-motion`-aware) its
signature, and the CF tokens ship easings and durations
(`easeStandard cubic-bezier(0,0,0.2,1)`, 150/200/500ms). The apple-design
skill is ~70% motion. We are consciously ceding that third of brand identity
for this cycle because the static system serves this fork's actual territory —
docs, print, deterministic PNG — and because motion tokens layered on later
(declarative easing/duration/entrance tokens compiled to CSS/SMIL inside the
standalone SVG) compose *on top of* every static primitive above without
reworking any of them. Nothing in A–D forecloses it; a future
`motion` token group is the obvious shape, with Vercel's fork as the
existence proof that it fits a no-runtime-JS SVG.

## Evidence & honesty

- Probe values approximate each brand from public sources and are **not**
  WCAG-gate-audited — the legibility gates bind shipping styles (cupertino is
  gate-adjusted and documents its HIG deviations), not probes.
- Fonts are stand-ins in all mocks: Geist and FT Kunst Grotesk render as
  bundled Inter; Apercu Mono Pro as Share Tech Mono. Geist could be bundled
  (SIL OFL 1.1); FT Kunst Grotesk is commercial and cannot be.
- The vercel and cf-workers probes are not registered styles and add nothing
  to the registry, golden matrix, or website counts; they exist only as data
  in `scripts/pr-assets/brand-primitives-probe.ts`.
- `styleFace` is `@internal` and this plan does not promise it as public API —
  the public shape of B is the open decision (cupertino plan, Phase 5 / R5),
  now framed by the emergence rule above.

## Sources

- emilkowalski, apple-design skill — <https://www.skills.sh/emilkowalski/skill/apple-design>
- vercel-labs/beautiful-mermaid — <https://github.com/vercel-labs/beautiful-mermaid>
- CF Workers design system — <https://cf-workers-design-system.adewale-883.workers.dev/> (`/tokens.json`, `/design-system.md`)
- Kasey Klimes, "When to Design for Emergence" (2022) — <https://www.kaseyklimes.com/notes/2022/6/9/when-to-design-for-emergence>
