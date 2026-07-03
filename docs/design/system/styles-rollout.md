# Styles: naming, model, and rollout plan

Status: plan (PR #60 ships the engine; this document plans the product surface).

The engine work is done: every diagram family lowers to a SceneGraph of
semantic marks, and pluggable backends serialize those marks — crisp (the
unchanged default), rough.js sketch, and hybrid (pressure ribbons, washes).
This plan covers what we call the feature, how it relates to themes, how it
reaches users through every surface of the package, and how we explain it.

**The headline is custom styles.** The built-in styles (hand-drawn,
excalidraw, pen-and-ink, freehand, watercolor, blueprint, tufte) are proof
and starting points — the product is that users *and their agents* construct
their own styles as data records instead of being restricted to the default
look plus a theme list.

---

## 1. One word: "style"

The current (unreleased) API calls the feature `aesthetic`. Before anything
ships we rename every public surface to **style** — the word users already
reach for, and the word the docs, CLI, and MCP schema should share. Nothing
has been published to npm from this branch, so the rename costs nothing.

The naming collision with the existing `RenderOptions.style`
(`DiagramStyleOptions` role overrides) dissolves once we note that nothing
has ever been published — the npm name has no releases, there are no git
tags, and the only callers of the current option are in this repo. There is
no legacy to preserve, so instead of a compatibility union we **subsume**
role overrides into `StyleSpec`: every field is optional (backend defaults
to `'default'`), and the role keys (`text`/`node`/`edge`/`group`) live on
the spec directly.

```ts
// after the rename
interface RenderOptions {
  style?: string | StyleSpec   // one type, no discrimination needed
  seed?: number
}
```

- `style: 'hand-drawn'` — a registered style by name.
- `style: { name: 'brand', backend: 'rough', colors: {…}, … }` — an inline
  custom style (see §3).
- `style: { node: { cornerRadius: 8 } }` — still valid, and not a special
  case: it is simply an anonymous style that only sets role overrides on
  the default backend. The old `DiagramStyleOptions` shape is a subset of
  `StyleSpec` by construction.

In-repo callers of the current option (poster/characterization scripts,
mocks, tests) are updated in the same change; anyone installing from git
gets the new shape with the rename, before any release exists.

Rename checklist: `AestheticStyle` → `StyleSpec`; `registerAesthetic/
getAesthetic/knownAesthetics` → `registerStyle/getStyle/knownStyles`;
`RenderOptions.aesthetic` → folded into `style`; error messages, tests,
styled-output baseline keys (regenerate under `[approve-goldens]`),
`docs/style-authoring.md`, SPEC references, and the PR description. The
internal `src/styles.ts` (`resolveRenderStyle`) keeps its name — it becomes
the resolver for the role-override layer of a style.

## 2. Styles vs themes — the user-facing model

One table carries the whole explanation:

|  | **Theme** | **Style** |
|---|---|---|
| Answers | *What colors?* | *How is it drawn?* |
| Controls | palette tokens: `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border` | stroke character (crisp / jittered / freehand ribbon), fills (none / hachure / solid / wash), typography, line weights, corner radii, page furniture (ruled paper, drafting grid), label treatment |
| Today | `THEMES`, `themeVariables`, color options — unchanged | new: built-in names or your own `StyleSpec` |
| Default | light palette | `crisp` — byte-identical to every previous release |

**How they interact:** orthogonally, mediated by the same tokens. A style
carries a *default* palette (hand-drawn's warm paper and black ink) so it
looks right with zero configuration — but any channel the user sets through
a theme, `themeVariables`, or a color option **wins over the style's
default**, channel by channel. That yields *any style × any theme*:
`{ style: 'hand-drawn', bg: '#0f172a', fg: '#e2e8f0' }` is hand-drawn on
your dark palette. (Enforced by tests: user colors and `themeVariables`
beat the style palette.)

Three guarantees hold for every style, built-in or custom:

1. **Readable by construction** — text is never perturbed, gets a
   page-colored halo, and sits above all marks; axes/grids/chrome stay
   crisp; WCAG contrast is CI-gated.
2. **Deterministic** — same source + options + `seed` ⇒ identical bytes.
   `seed` is a *shuffle*: it re-rolls the ink wobble, never the layout.
   Styled output is cacheable, diffable, and golden-testable.
3. **Semantics survive** — markers, `class`/`data-*` attributes, hit
   geometry, ARIA, and strict-security guarantees pass through every
   backend.

## 3. Custom styles — the primary value

A style is a data record, so constructing one requires no engine knowledge:

```ts
import { renderMermaidSVG } from 'agentic-mermaid'

// Inline, no registration — the one-shot path for agents:
const svg = renderMermaidSVG(source, {
  style: {
    name: 'acme-brand',
    backend: 'rough',
    intent: 'draft',
    colors: { bg: '#fffdf7', fg: '#1c1917', accent: '#e11d48' },
    font: 'Caveat',
    roughness: 0.8,
    fill: 'hachure',
    backdrop: 'grid',
  },
})

// Or register once, use by name everywhere:
registerStyle(acmeBrand)
renderMermaidSVG(source, { style: 'acme-brand' })
```

Work items that make this the headline rather than a footnote:

- **Inline `StyleSpec` in `RenderOptions.style`** (engine already supports
  the object; the option today only takes names).
- **JSON style packs**: `validateStyleSpec(json)` + a documented JSON schema
  so styles can live in files, repos, and prompts. Packs are declarative and
  safe — no arbitrary defs/XML/URLs; strict-security compatible.
- **Agent authoring loop**: `docs/style-authoring.md` (already written: the
  spec template, the parameter reference, and the quality rubric with worked
  good/bad examples) gets linked from `llms.txt` and
  `Instructions_for_agents.md`, so an agent can construct a style from docs
  alone, render it, and self-check contrast — the same loop that produced
  the 31-style prototype poster.

## 4. npm package changes

Ship as a **minor** release of `agentic-mermaid` (additive; crisp default
byte-identical, corpus-gated):

- **New API**: `RenderOptions.style` (name | `StyleSpec`, where a role-only
  object is itself a valid spec),
  `RenderOptions.seed`, `registerStyle`, `getStyle`, `knownStyles`,
  `validateStyleSpec`, and — for the rare code-backed extension —
  `registerBackend`/`StyleBackend` plus the SceneGraph types
  (`SceneDoc`, `SceneNode`, `SemanticChannels`, `SceneRole`).
- **New runtime dependencies**: `roughjs@4.6.6` (pinned exactly — seeded
  geometry must not shift under a bump) and `perfect-freehand@1.2.3`. They
  must be `dependencies`, not devDependencies, because the package's `bun`
  export condition resolves raw `src/*.ts`; the Node dist bundles them
  (~80 KB minified). If crisp-only consumers ever object to the weight, a
  `agentic-mermaid/styles` subpath split is the escape hatch — not needed
  at current size.
- **Docs shipped with the package**: README gains the style matrix image, a
  five-line quick start, and a custom-style example; `docs/api.md` documents
  the option; CHANGELOG explains the style/theme model in three sentences.
- **Versioned determinism note**: styled bytes are stable *per pinned
  dependency versions*; a roughjs bump is treated as a golden-fixture change
  (`[approve-goldens]`).
- **Not in this release**: styled PNG (needs the font decision below);
  removal of anything — there are no deprecations because `aesthetic` never
  shipped.

## 5. Surface rollout, custom-first

1. **Rename + inline specs + JSON validation** (§1, §3) — everything else
   builds on the final vocabulary.
2. **Agent surface**: the MCP render tool and the agent SDK accept `style`
   (a name **or an inline `StyleSpec` object**) and `seed`; the SDK
   declaration explains the model in two sentences and points at the
   authoring guide. Agents are the most prolific custom-style constructors —
   this surface is where "construct your own" becomes real.
3. **CLI**: `am render --style <name|path/to/style.json> --seed <n>`, plus
   `am styles [--json]` to list what's registered (blurbs + intent labels).
   PNG threading lands here, with an explicit font-fallback warning until §6.
4. **Live editor**: a style picker, a 🎲 shuffle button (bumps `seed`), and a
   style-JSON pane — paste or edit a `StyleSpec`, watch it apply live. This
   is both the demo and the custom-style playground.
5. **README + gallery**: matrix image up top; each built-in style gets a
   thumbnail, its intent label, and one sentence on when to use it.
6. **Production fonts for PNG**: bundle the OFL faces a style references
   (Caveat, EB Garamond, Share Tech Mono, Architects Daughter) as reviewed
   assets with license files (the OFL notices already exist), or document
   the DejaVu fallback. This is the last blocker for styled PNG parity.

## 6. How we explain it

- **Lead with the picture and the sentence**: the 8×12 matrix image, then —
  *"Pick a style, or write your own: a style is a small data record that
  controls how every diagram type is drawn; your theme still controls the
  colors."*
- **Crisp stays the default** — say it explicitly, with the receipts
  (corpus-verified byte identity). Styles are opt-in; nothing changes for
  existing users. Uniform coverage across all 12 diagram types is the
  differentiator to state plainly (partial coverage is what eroded trust in
  ecosystem precedents).
- **Intent labels as guidance**: `draft` styles (hand-drawn, excalidraw,
  freehand) say *"critique the structure, not the pixels"*; `premium`
  (tufte, pen-and-ink, blueprint, watercolor) are for publishing; `lofi`
  inverts polish on purpose. Users pick by intent, not by scrolling a menu.
- **`seed` is "shuffle the ink, not the layout"** — one sentence that
  pre-empts the determinism worry.
- **Custom styles get the second headline, not an appendix**: the README
  example is a *custom* style, and the authoring guide (with its quality
  rubric) is linked wherever styles are mentioned.
