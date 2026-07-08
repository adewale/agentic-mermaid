# Styles: the composable look system — naming, model, and rollout plan

Status: v2, largely executed on PR #60 — the engine, the consolidated
`style` primitive, and the product surfaces (CLI `--style`/`--seed` +
`am styles`, MCP style args + typed SDK declaration, editor style picker
with seed re-roll, agent docs) have landed; steps below are annotated.
Nothing has shipped to npm yet, so remaining decisions stay free.

The engine work is done: every diagram family lowers to a SceneGraph of
semantic marks, and pluggable backends serialize those marks — crisp (the
unchanged default), rough.js sketch, and hybrid (pressure ribbons, washes).

**The headline is what users and their agents can construct, not what we
ship.** The built-in looks are proof and raw material: the original sketch
set (hand-drawn, excalidraw, pen-and-ink, freehand, watercolor, blueprint,
tufte) plus coverage expanders for accessibility, print, operations,
physical media, architecture, and editorial/report figures. The product is
a small set of primitives with one combination rule, from which looks we
never anticipated can emerge.

---

## 1. One concept: style. A theme is a kind of style.

The repo used to have three overlapping vocabularies: *themes* (the
`THEMES` palette record + `themeVariables` + color options), *role style
options* (the old `RenderOptions.style: DiagramStyleOptions`), and the
pre-consolidation *aesthetics*. Three words, three shapes, three precedence
stories — for what is one question: **how should this diagram look?**

We collapse them into one primitive:

> A **style** is a partial description of how diagrams look. Every field is
> optional. A style that only sets colors is what people call a *theme*. A
> style that only sets `node.cornerRadius` is a tweak. A style that sets
> stroke character, fills, typography, and a palette is a full look.

```ts
interface StyleSpec {
  // identity (optional — anonymous inline styles are fine)
  name?: string
  blurb?: string

  // palette — the seven tokens every mark references
  colors?: { bg?; fg?; line?; accent?; muted?; surface?; border? }

  // typography
  font?: string

  // mark treatment (what the sketch backends read)
  stroke?: 'crisp' | 'jittered' | 'freehand'
  fill?: 'none' | 'hachure' | 'solid' | 'wash'
  roughness?; bowing?; passes?; strokeWidth?; hachureAngle?; hachureGap?;
  fillWeight?; washOpacity?; washEdge?
  backdrop?: 'plain' | 'paper-ruled' | 'grid'

  // per-role overrides (the old DiagramStyleOptions, subsumed)
  text?; node?; edge?; group?

  // advisory metadata (documented, never read by the engine)
  intent?: 'premium' | 'draft' | 'lofi'
  mono?: boolean
}
```

So the answer to "what is the right relationship between styles and themes"
is: **subsumption, not orthogonality**. A theme is a palette-only style.
The existing `THEMES` entries register into the style registry at startup
(their names keep working everywhere a style name is accepted), and
`themeVariables`/color options remain as the *last* override layer for
Mermaid compatibility. One registry, one lookup (`getStyle`), one list
(`knownStyles`) — and the docs answer the theme question in a sentence
instead of a precedence table.

## 2. One combination rule: the stack

The public option takes a name, a spec, or a **stack** of them:

```ts
interface RenderOptions {
  style?: StyleInput | StyleInput[]   // StyleInput = string | StyleSpec
  seed?: number                        // re-rolls ink wobble, never layout
}

// a full look
renderMermaidSVG(src, { style: 'hand-drawn' })

// hand-drawn geometry × dracula palette — "any style × any theme" is just stacking
renderMermaidSVG(src, { style: ['hand-drawn', 'dracula'] })

// stack a shared brand fragment and a local tweak on top
renderMermaidSVG(src, { style: ['hand-drawn', acmeBrand, { node: { cornerRadius: 0 } }] })
```

Merging is left→right, per field, shallow within each role — the CSS
intuition everyone already has. The full precedence story becomes one line:

```
defaults  <  style stack (left → right)  <  themeVariables  <  explicit color options
```

This one rule replaces: a theme option, a style option, a role-override
option, and any future "variant"/"overrides" parameters. It is also the
agent-native shape: an agent composes a look by concatenating fragments it
was given, retrieved, or wrote itself.

## 3. Simplifications this unlocks (missed in plan v1)

1. **No `backend` field for authors.** Which backend a style needs is
   derivable from what it asks for: `stroke: 'freehand'` or `fill: 'wash'`
   ⇒ hybrid; any rough parameter or `stroke: 'jittered'` ⇒ rough; otherwise
   ⇒ default. Authors describe the *look*; the engine picks the machinery.
   (An explicit `backend` override remains for code-backed extensions, but
   it disappears from the tutorial path.)
2. **No aesthetic/style/theme triage.** One word in the API, the CLI, the
   MCP schema, the docs. `THEMES` stays exported for compatibility of
   in-repo code but is defined *as* registered palette-only styles.
3. **No compatibility shims anywhere** — pre-release, the in-repo callers
   of the old option just update.
4. **`intent`/`mono` demote to advisory metadata.** The engine never
   branches on them; they exist for pickers, galleries, and the authoring
   rubric. (The mono *contract* stays a test on built-ins, not an engine
   switch.)
5. **One registry, one gallery.** `knownStyles()` drives the CLI list, the
   editor picker, and the poster harness — registering a style is the only
   step to appear in all three.
6. **Fragments are the sharing unit.** A JSON file with three fields is a
   complete, valid, shareable style. Packs are just arrays of named
   fragments — no schemaVersion ceremony until a real need appears.

## 4. Designed for emergence

Following the "design for emergence" argument (UX Mag): when user needs are
heterogeneous and unpredictable — and custom looks are exactly that — ship
simple elements and combination rules, not finished solutions; keep the
floor low, the ceiling high, and the walls wide.

- **Low floor**: `style: 'hand-drawn'` — one string.
- **Wide walls**: fragments compose across axes we don't enumerate. A
  palette fragment × a line-character fragment × a typography fragment × a
  role tweak — we ship fifteen full looks, but the space users can reach is
  the product of every fragment anyone writes. Nobody designs "corporate
  memo hand-drawn dark"; it emerges from a stack.
- **High ceiling**: `registerBackend` + the SceneGraph types for the rare
  code-backed capability (a new fill algorithm, a layout-aware dialect).
  Styles stay data; code is the escape hatch, not the path.
- **Safety rails that make wild combinations viable**: the prototype WCAG
  contrast audit and text-halo policy showed the right contract. Production
  now has deterministic stacking and built-in looks that route structural
  ink through the active theme foreground; a full arbitrary-stack WCAG gate
  remains the missing guardrail.
- **Reproducible sharing**: determinism means `(source, stack, seed)` is a
  complete, portable description of an image. A gist with a JSON fragment
  IS the artifact. This is the hashtag/spreadsheet property: the unit of
  user invention is trivially copyable.
- **Agents as the emergence engine**: `docs/style-authoring.md` (spec
  template + quality rubric + worked good/bad examples) is linked from
  `llms.txt` and the agent instructions, so an agent can author a fragment
  from a sentence ("make it look like our brand deck"), render it, check
  contrast, and iterate — the loop that produced the 31-style prototype,
  now available to every user's agent.
- **Deliberately not built** (over-specification kills emergence): no
  inheritance/`extends` graphs (stacking covers it), no per-diagram-family
  style hooks in v1, no marketplace/registry service — a JSON fragment in
  a repo is the distribution mechanism until the community proves a need.

## 5. npm package changes

First release ships as `agentic-mermaid` **0.x minor** (crisp default
byte-identical, corpus-gated):

- **API**: `RenderOptions.style` (name | spec | stack), `RenderOptions.seed`,
  `registerStyle`, `getStyle`, `knownStyles`, `validateStyleSpec` (JSON
  schema included in the package), and for extensions `registerBackend`,
  `StyleBackend`, plus SceneGraph types (`SceneDoc`, `SceneNode`,
  `SemanticChannels`, `SceneRole`). `THEMES` remains, redefined as
  palette-only styles.
- **Runtime dependencies**: `roughjs@4.6.6` and `perfect-freehand@1.2.3`,
  pinned exactly — seeded geometry must not shift under a bump; a bump is a
  golden-fixture change (`[approve-goldens]`). They are `dependencies`
  because the `bun` export condition resolves raw `src/*.ts`; the Node dist
  bundles them (~80 KB minified). A `agentic-mermaid/styles` subpath split
  is the escape hatch if crisp-only weight ever matters.
- **Docs in the box**: README leads with the matrix image, a one-string
  quick start, and a *custom fragment stack* example; `docs/api.md` gets the
  option + precedence line; CHANGELOG states the model in three sentences.
- **Deferred**: styled PNG parity (blocked on bundling the OFL faces as
  reviewed production assets — notices already exist); CLI/MCP surfaces
  land in the rollout below.

## 6. Rollout, emergence-first

1. **Collapse the primitives**: rename `aesthetic` → `style`; make all
   `StyleSpec` fields optional with role keys on the spec; implement the
   stack merge; register `THEMES` as styles; infer backends. (Everything
   else builds on the final shape.) *Status: DONE — resolveStyleStack /
   styleRolesOf / inferBackend / validateStyleSpec in
   src/scene/style-registry.ts; RenderOptions.style is the union; proven a
   pure refactor by the styled-output baseline passing unregenerated.*
2. **Agent surface**: MCP render tool + SDK declaration accept `style`
   (name | spec | stack) and `seed`; authoring guide linked for agents.
3. **CLI**: `am render --style <name|file.json>` (repeatable = stack),
   `--seed`, `am styles [--json]`; PNG threading with an explicit
   font-fallback warning.
4. **Editor**: style picker and palette picker for built-in looks; `seed` stays
   an API/CLI/share-link field rather than a persistent topbar control.
5. **README + gallery** generated from the registry.
6. **Fonts for PNG parity** (OFL faces as reviewed assets).

## 7. How we explain it

- One sentence: *"A style is a small data record describing how diagrams
  look; stack styles to combine them — a color-only style is a theme."*
- Crisp stays the default, stated with receipts (corpus-verified byte
  identity), and styling covers **all 12 diagram types uniformly**.
- Three promises for the supported path: **readable** built-in stacks
  (halos, theme-friendly structural ink, and generated evidence),
  **deterministic** (`seed` shuffles ink, never layout — cacheable,
  diffable, golden-testable), **portable** (a JSON fragment + seed
  reproduces the image anywhere). A full WCAG gate for arbitrary user
  fragments is still a follow-up.
- The README example is a custom fragment stack, not a built-in name —
  the message *is* the primary value.
