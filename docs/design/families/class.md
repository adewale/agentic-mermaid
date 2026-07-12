# Class Diagram — Design Notes

## Overview

The class family follows the standard parse → layout → render pipeline:
`src/class/parser.ts` → `src/class/layout.ts` (ELK layered) →
`src/class/renderer.ts` (SceneGraph lowering + DefaultBackend). The agent
surface owns a separate structured body (`src/agent/class-body.ts`) with the
structured-or-opaque contract: any line the body parser does not model makes
the whole body a lossless opaque round-trip.

Supported today:

- classes with the 3-compartment box (header / attributes / methods),
  annotations (`<<interface>>`), display labels (`class X["Label"]`,
  `class X as "Label"`), separate-decl members (`X : +member`)
- the six UML relation kinds plus plain solid/dashed links, cardinalities,
  and relation labels
- **namespaces** (repo #118; upstream #7618) — rendered and structured, see
  below
- **`direction TB|BT|LR|RL`** — wired to layout (plan §Class 4)
- accessibility directives (`accTitle` / `accDescr`)
- SVG, PNG, and spatial ASCII/Unicode output, including nested namespace frames

## `:::` class shorthand evidence (2026-07)

**Why:** `Account:::highlight` decorates `Account`; the suffix is not an
inline class member. The fixture is
[`class-style-shorthand-demo.mmd`](./class-style-shorthand-demo.mmd).

| Before (`7f5102a9`) | After |
|---|---|
| ![A phantom style-suffix member](./class-style-shorthand-before.png) | ![Stable class identity without a phantom member](./class-style-shorthand-after.png) |

**What to inspect:** the before box contains a spurious `::highlight` member;
the after box preserves one `Account` identity and an empty member compartment.
The renderer and structured agent surface now share parser-owned style
properties: `classDef`, `class`/`cssClass`, `:::`, and inline `style` resolve to
one identity-safe paint model. Typed `define_class`, `set_css_class`, and
`set_class_style` operations round-trip that model.

## Namespaces (2026-07 elevation)

Upstream contract (verified against mermaid.js.org/syntax/classDiagram.html
and the upstream parser suite): `namespace X { class A }`, syntactic nesting
(`namespace A { namespace B { … } }`), dot notation (`namespace A.B.C`
auto-creates `A` and `A.B` as parents; blocks with a shared prefix share the
parent chain), and display labels `namespace X["Label"]` (v11.15+).

One grammar, two consumers (C1): `parseNamespaceHeader` in
`src/class/parser.ts` is the single namespace-opener grammar; the render
parser and the agent body parser both consume it, so membership cannot drift
between surfaces. Membership is single-claim: a class belongs to the first
namespace block that declares it.

### Layout

Namespaces lay out as ELK compound nodes — the flowchart-subgraph pattern:

- member classes are children of their namespace compound; nested namespaces
  are child compounds; `elk.hierarchyHandling: INCLUDE_CHILDREN` is enabled
  only when namespaces exist, so namespace-free diagrams keep byte-identical
  output;
- each compound reserves a header band via top padding, so members clear the
  label by construction;
- relationships are hosted on the lowest-common-ancestor compound and
  extraction adds the host's absolute offset back (the exact
  `extractEdgesRecursively` convention from `src/layout-engine.ts`);
- the direction→ELK mapping is `directionToElk`, imported from
  `src/layout-engine.ts` — no parallel copy.

`PositionedClassDiagram.namespaces` is a flattened parent-first list with
absolute coordinates; the renderer draws each as rect + header band + label
(`<g class="namespace" data-id data-label data-parent-id>`), behind
relationship lines and class boxes.

### Verification

`family-layouts.ts` projects namespaces as `RenderedLayout.groups` with their
member class ids, which arms:

- verify's `GROUP_BREACH` (groupContainment now on for class), and
- the family rubric's group-containment and group-tiling axes.

Invariant gates live in `src/__tests__/class-namespace.test.ts` (every class
box inside its namespace box; nested boxes inside parents; members clear the
header band) and judge any golden regeneration.

### Agent body

`ClassNode.namespace` is a dot-joined path; `ClassBody.namespaces` is the
declared-path registry (first-seen order, optional labels). Serialization
canonicalizes to dot-path blocks (`namespace A.B { … }`) — the exact
production the render parser accepts; parents implied by descendants are
skipped unless they carry a label or are childless declarations. The
serializer→render-parser conformance suite
(`src/__tests__/class-serializer-conformance.test.ts`, P3) proves membership
survives serialize → render-parse after every succeeding op.

Ops: `add_class` gained an optional `namespace` field;
`set_class_namespace {class, namespace|null}` moves a class between
namespaces (declared on demand; null = top level). `describe` and `facts`
expose membership (`class X in namespace P.A`).

## Direction and spacing

`direction TB|BT|LR|RL` (shared grammar in
`src/shared/direction-statement.ts`) is parsed into `ClassDiagram.direction`
and mapped through `directionToElk`. Default stays TB. RenderOptions
`nodeSpacing`/`layerSpacing` thread into `elk.spacing.nodeNode` /
`elk.layered.spacing.nodeNodeBetweenLayers` (defaults 40/60 unchanged).

The agent body does NOT model `direction` (a `direction` line keeps the body
opaque); rendering honors it regardless because layout reads the render
parser's model.

## Config (wire-or-warn, P4)

The typed `class` frontmatter section (`ClassRuntimeConfig` in
`src/mermaid-source.ts`):

- **Wired**: `nodeSpacing`, `rankSpacing` → RenderOptions
  `nodeSpacing`/`layerSpacing` (explicit RenderOptions win), plus
  `hierarchicalNamespaces` → nested compounds (`true`) or compact sibling
  frames (`false`), via
  `resolveClassRenderOptions` in `src/class/layout.ts`, applied on both the
  render path (`render-family-hooks.ts`) and the verify layout path
  (`family-layouts.ts`).
- **Lint** (`INEFFECTIVE_CONFIG`, Tier-3): `titleTopMargin`,
  `arrowMarkerAbsolute`, `dividerMargin`, `padding`, `textHeight`,
  `defaultRenderer`, `diagramPadding`, `htmlLabels`, `hideEmptyMembersBox` —
  the table (`CLASS_NOOP_CONFIG_FIELDS`) lives
  beside the wiring in `src/class/layout.ts` so wire and warn cannot drift.

## Generic classes (repo #118)

`class Box~T~`, generic-bearing relationship endpoints, namespace-contained
variants, notes, and separate member declarations normalize to one stable bare
identity (`Box`) plus `ClassNode.generic` (`T`). The renderer displays
`Box<T>`; canonical serialization emits the upstream `~T~` declaration and
bare relationship endpoints. `add_class.generic` and `set_class_generic`
provide typed authoring/editing without forcing an opaque fallback.

## Styling, compact namespaces, and cardinalities

`ClassName:::style` is consumed before inline-member parsing, including `$` and
backtick identities, so decoration cannot mint a phantom class. The shared
`src/shared/style-props.ts` grammar models `classDef`, `class`/`cssClass`,
shorthand, and inline paint on both parser surfaces; classDef paint resolves
before Scene/SVG/terminal rendering and inline properties win.

Single-line namespace forms (`namespace X { class A; class B }`) expand through
one parser-owned statement grammar. `hierarchicalNamespaces: false` is wired:
nested compounds become compact sibling frames rather than merely producing a
warning. Terminal output draws grapheme-aware nested namespace frames with
explicit containment gates.

Cardinality labels are allocated in `src/class/layout.ts`, not offset ad hoc in
the renderer. The dense `c5-stress` property rejects cardinality/cardinality
and cardinality/node overlap before SVG lowering. These residual contracts are
pinned by `class-residual-elevation.test.ts`, `class-ascii-namespaces.test.ts`,
and `class-er-edge-quality.test.ts`.
