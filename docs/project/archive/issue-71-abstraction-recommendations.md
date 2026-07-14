# Issue #71 abstraction recommendations — historical literature review

Status: historical recommendations and closure record from the academic-
literature review. Drafted 2026-06-20; reappraised and updated 2026-06-21 after
the issue #71 implementation. It is not an active roadmap; live work belongs
only in root `TODO.md`.
Companion to [`issue-71-abstraction-audit.md`](./issue-71-abstraction-audit.md) (the historical pre-implementation
snapshot and the source of issue numbers **I1–I9**, referenced throughout). Reconciled with the pre-existing
design docs it overlaps — [`AGENT_NATIVE.md`](../../../AGENT_NATIVE.md) (agent stack),
[`contributing/diagram-family-citizenship.md`](../../contributing/diagram-family-citizenship.md)
(family×surface CI ratchet), and [`source-preservation-ladder.md`](../../design/system/source-preservation-ladder.md)
(structured\|opaque levels); see the audit's §5 for the agreement and the I1/I3/I7 refinements.

## 2026-06-21 reappraisal

The original issue spec was rechecked against the implemented code, the
`adewale/testing-best-practices` testing research, current competitor behavior, and fresh source
checks on the literature. The core direction still holds, but two details were improved:

1. `FamilyPlugin.layout` should be a **source-context hook**, not a `body` hook. The stronger
   wording in the original roadmap ("layout the structured body directly") overfits L3/L4 bodies and
   is wrong for L1 opaque bodies, accessibility directives, frontmatter, and `%%init%%` preservation.
   The implemented contract uses `FamilyLayoutContext { source, options, renderOptions, colors }`.
   That still removes the duplicated public SVG/ASCII switches while keeping source-preservation
   semantics explicit.
2. `knownFamilies()` should not expose mutable `Map` insertion order. The reappraisal keeps the
   keyed registry but requires deterministic iteration: built-ins follow `BUILTIN_FAMILY_METADATA`;
   any external registrations sort lexically after the built-ins.

### Evidence Update

- **Academic architecture:** Wadler's expression-problem framing still supports a registry of
  operations by family; TypeScript's discriminated-union/`never` exhaustiveness model supports the
  certificate split and exhaustive proof switches. MLIR's "dialects and lowering" lesson and
  Graphviz's attributed-graph/layout/output separation support multiple family-specific layout
  dialects, not one universal geometry IR.
- **Competitive analysis:** Mermaid now documents many diagram families, frontmatter/config, and
  evolving layout/look support; it explicitly limits layout/look support to some diagram types today
  while expanding it. Graphviz exposes DOT, layout engines, output formats, and attributes as
  separate concerns. PlantUML supports several layout engines and output formats, but ASCII is only
  broadly documented for sequence diagrams. D2 documents layout-engine tradeoffs and engine-specific
  feature gaps. The pattern across competitors is **separated surfaces and explicit layout engines**,
  not a single geometry model for every diagram and output.
- **Theming practice:** Mermaid's `themeVariables` remain a compatibility requirement. The 2026
  Design Tokens Community Group draft reinforces a named-token/alias direction, but it is explicitly
  a preview and not a W3C standard. The best current move is therefore the implemented
  `DiagramColors`/CSS-variable waist with semantic role slots, not importing a full design-token JSON
  object into the public API.
- **Testing practice:** The testing-best-practices guidance maps directly to this refactor:
  characterization/snapshot tests for byte-stable rendering, property tests for parser/config/layout
  invariants, doc-sync tests for registry/docs drift, visual/pixel contracts where SVG appearance is
  the output, and mutation lanes as adequacy checks. The implementation added direct registry dispatch
  coverage (`render-family-hooks.test.ts`) and rides the existing 4k+ suite, property tests, visual
  contracts, and mutation configuration.

### Updated Closure Matrix

| Issue | Original claim | Reappraisal | Implemented/spec outcome |
|---|---|---|---|
| I1 | Three dispatch mechanisms should converge on `FamilyPlugin`. | Still best. Registry iteration also needs deterministic order. | SVG and ASCII route through `layout`/`renderSvg`/`renderAscii` hooks; `knownFamilies()` is metadata-ordered. |
| I2 | Renderer signatures should collapse to `RenderContext`. | Still best; keep context thin. | All SVG renderers consume `{ positioned, colors, options }`. |
| I3 | Add a shared `PositionedDiagram` marker but do not invent a universal IR. | Still best; competitors and MLIR/Graphviz reinforce dialect-style geometry. | `PositionedDiagram` exists; family positioned types remain specialized. |
| I4 | Push parse/layout/render leaks down. | Mostly best; architecture legitimately needs layout metrics, not whole visual config. | Pie colors are render-time, xychart frontmatter is post-parse middleware, Gantt has a named pipeline, architecture passes layout metrics and render visual separately. |
| I5 | Consolidate color models onto one internal waist. | Still best; do not adopt full design-token spec yet. | `resolveDiagramColors` normalizes options/themes/themeVariables; inline style resolvers and role color slots feed families. |
| I6 | Split fake certificate union by what each certificate proves. | Still best. | `EdgeRouteCertificate`, `FamilyEdgeRouteCertificate`, and `RegionContainmentCertificate` are explicit; `layoutCertificateProof` exhaustively classifies them. |
| I7 | Prefer structured-body layout over reparsing `canonicalSource`. | Revised. Prefer registered **layout hooks over duplicated public dispatch**, but keep source context as the hook input. Body-only layout is future work only for families that can prove it is lossless. | `FamilyPlugin.layout(ctx)` owns source-to-positioned layout; structured render paths avoid stale `canonicalSource` where supported without breaking opaque bodies. |
| I8 | Keep ASCII geometry isolated; share only family-set/dispatch. | Still best; PlantUML/D2 reinforce output-specific geometry. | ASCII uses `renderAscii` hooks but retains grid layout/A* internals. |
| I9 | Delete vestigial re-export and dead parameters; normalize names opportunistically. | Still best, but broad rename churn is lower priority than behavior-preserving closure. | `src/layout.ts` is gone and unused renderer `_options` are folded into `RenderContext`; broad naming normalization remains optional churn, not issue-blocking. |

> Web access note: WebSearch/WebFetch **were available** in this environment. Every citation
> below was bibliographically verified against authoritative records (dblp, arXiv, official
> project pages, publisher catalogs). A handful of canonical landing pages return HTTP 403/402
> to automated fetches (ACM DL, IEEE Xplore, Wiley) — those are flagged inline and an open mirror
> is given where one exists. No URLs or page numbers were fabricated. See **References** for the
> full list with verification status.

---

## 0. The shape of the problem, in the literature's terms

The audit's baseline finding — the same ~12 diagram **families** were processed by ~5 **operations**
(parse, layout, render-SVG, render-ASCII, mutate, verify) across **three** stacks (SVG, ASCII,
agent IR) with **three** dispatch mechanisms — is, almost exactly, two classic problems stacked
on top of each other:

1. **The Expression Problem** (Wadler 1998) along the *families × operations* plane. We want to
   add new families *and* new operations without editing everything. The agent stack's
   `FamilyPlugin` registry is a partial solution on this plane; the SVG and ASCII `switch`
   statements are the textbook *failing* decomposition Wadler describes.
2. **Two-dimensional variability** (GoF **Bridge**) along the *families × surfaces* plane. We have
   M families that must each be expressed over N surfaces (SVG / PNG / ASCII / agent IR). A single
   inheritance/dispatch hierarchy forces an M×N explosion; Bridge's whole motivation is collapsing
   that product into a sum (M + N).

Two framing facts constrain every recommendation:

- **Determinism is a hard constraint** (CLAUDE.md: identical input → identical geometry). This is
  the single biggest reason several theoretically attractive solutions (multimethods, import-order
  registries) are *wrong here*: a mutable global registry populated at import time introduces
  registration-order sensitivity, which is exactly the kind of hidden nondeterminism the repo
  forbids. Any registry we lean on must have a **fixed, explicit** registration order.
- **The status quo is not naïve.** A discriminated union + `switch` is the **ADT pole** of Cook's
  duality (OOPSLA 2009): operations are cheap, *variants* are costly. TypeScript's `never`-based
  exhaustiveness check makes "I added a family" a compile error at every unhandled
  site — a real, free safety net we should *preserve*, not trade away for runtime polymorphism.

The literature does **not** say "unify everything." Metz ("The Wrong Abstraction") and Moseley &
Marks ("Out of the Tar Pit") jointly warn that collapsing parallel stacks is a win only when the
removed duplication is *accidental*, not *essential*. The ASCII stack (I8) is the clearest case
where the duplication is essential and isolation is **correct as-is** (see §I8).

### Which pattern opens which axis (the cheat sheet)

| Approach | New operation | New family | Fit for this repo (deterministic, union + switch, TS) |
|---|---|---|---|
| Discriminated union + `switch` (status quo) | easy | **hard** (edit every switch) | native, deterministic, exhaustiveness-checked |
| Visitor (GoF) | easy | **hard** (GoF's own listed liability) | inverts our easy axis; adds ceremony — wrong direction |
| Object Algebras (Oliveira & Cook) | easy | easy | symmetric but boilerplate-heavy; loses inspectable data |
| Tagless-final (Carette/Kiselyov/Shan) | easy | easy | fights TS structural typing + breaks JSON serialization |
| Multimethods (Clojure/Julia) | easy | easy | non-idiomatic; global registry → **order nondeterminism** |
| **Plugin registry + record-of-functions** (the agent stack) | easy | easy | **best fit** — keeps unions internally, opens both axes at the seam |

The recommendation that runs through everything below: **generalize the pattern the agent stack
already proved** (`FamilyPlugin` as a record of per-family functions in an explicitly-ordered
registry), rather than importing GoF class hierarchies or FP encodings that TypeScript renders
awkward. This is the Microkernel/plug-in architecture (POSA1) realized in the idiom the codebase
already uses, and it is the concrete form of "make the waist thin" (the hourglass principle).

---

## I1 — Three dispatch mechanisms; the best one is least used

**(a) Lens.** This is the **Expression Problem** (Wadler 1998) plus the **Microkernel/plug-in**
architectural pattern (POSA1, Buschmann et al. 1996). The agent stack's
`FamilyPlugin` in `Map<DiagramKind, FamilyPlugin>` (`src/agent/families.ts`) *is* a microkernel: a
minimal core that owns only registration + dispatch, with each family a plug-in. At audit time, the
SVG and ASCII public entrypoints also had hand-written `switch(diagramType)` statements; that was the
decomposition Wadler shows fails — adding a family meant editing three sites that could not
drift-check each other.

**(b) Prescription.** Keep one core that knows only the registration/dispatch contract; deliver all
per-family behavior as registered plug-ins (Parnas 1972: hide the decision "which family is this?"
behind one module). Add the missing operations to the existing plug-in interface.

**(c) Recommendation.** Extend `FamilyPlugin` with the two operations it lacks:

```
renderSvg?:   (ctx: RenderContext) => string          // see I2 for RenderContext
renderAscii?: (ctx: AsciiContext)  => string
layout?:      (ctx: FamilyLayoutContext) => FamilyLayoutResult | PositionedDiagram
```

The now-implemented end state routes public SVG and ASCII rendering through keyed registry lookup
(`getFamily(kind)`) and the hooks above. If this pattern is repeated in another surface, keep the same
incremental migration rule used here: move one family at a time behind snapshot tests, then delete the
fallback dispatch only after every family has a hook.

**(d) Tradeoffs / determinism risk.** The registry is a `Map` populated at import in
`families-builtin.ts`. **Risk:** if dispatch ever iterates the registry (e.g. `knownFamilies()`
feeding a render order), `Map` insertion order makes output import-order-sensitive. **Mitigation:**
dispatch is always *keyed* (`getFamily(kind)`), never *iterated* for geometry; keep it that way, and
sort any iteration by the fixed `BUILTIN_FAMILY_METADATA` array order (`families.ts:77`), which is
source-defined and stable. With keyed lookup, determinism is unaffected — the `Map` is a lookup
table, not an ordering.

**(e) Where theory doesn't transfer.** Wadler's full bar (separate *compilation*, open to
*third-party* extension) is stronger than we need: families are in-tree and finite. The microkernel
"earns its keep" argument assumes numerous or third-party plug-ins; here the registry's value is not
extensibility-for-strangers but **drift elimination** (one dispatch site instead of three). That is
still decisive — I1 is the audit's "highest-leverage target" and this is **mechanical, low-risk,
high-value** — but justify it as *de-duplication of dispatch*, not as open extensibility we won't use.

---

## I2 — Renderer signature drift + redundant `(colors, font, transparent, options)` threading

**(a) Lens.** **Lampson's "do one thing well" / simple predictable interfaces** (Hints, 1983) and
**Parameter Object** discipline. The canonical `renderSvg(positioned, colors, font='Inter',
transparent=false, options={})` (`src/renderer.ts:37`) has drifted into 4-, 6-, and 7-arg variants
(`renderTimelineSvg` has 7; `renderArchitectureSvg`'s `visual` *replaces* `options`;
`renderPie/QuadrantSvg` accept `_options` they ignore). Three positional args are already
redundant: `font` is folded into `colors` (`resolveDiagramColors(options, config, font)` sets
`DiagramColors.font`), and `transparent` is a lone boolean.

**(b) Prescription.** Collapse the positional tail into one **capability/context object** — a single
predictable interface every renderer accepts (Lampson; Strategy's "one interface, many
implementations"). An unused `_options` parameter advertises a contract the function does not honor;
remove it (this also closes part of I9).

**(c) Recommendation.** Introduce

```
interface RenderContext { positioned: PositionedDiagram; colors: DiagramColors; options: RenderOptions }
```

with `font` read from `colors.font` and `transparent` moved into `options` (or `colors`). Family-specific
extras become *typed fields on a per-family options slice*, not positional args:
`options.timeline`, `options.xychart.interactive`, `options.architecture.visual`. Every `render*Svg`
becomes `(ctx: RenderContext) => string`. This is a no-op on geometry, so it is pure refactor.

**(d) Tradeoffs / determinism risk.** Essentially none for geometry — same inputs, same outputs;
verify with snapshot tests. Minor risk: defaulting (`font='Inter'`, `transparent=false`) must be
applied at the *boundary* (`resolveDiagramColors` plus the public render entrypoint's context
construction) so no call site silently changes a default. Make the defaults explicit in one
constructor, not scattered.

**(e) Where theory doesn't transfer.** A Parameter Object can become a god-bag if every family dumps
unrelated config into it. Keep `RenderContext` thin (3 fields) and push family-specifics into a typed,
optional, **per-family** sub-slice so the shared type stays a narrow waist rather than a union of
everything. This dovetails with I1: `FamilyPlugin.renderSvg(ctx)` is the natural consumer.

---

## I3 — No shared `Positioned*` contract; two parallel layout-output models

**(a) Lens.** This is the **single-IR vs. many-dialects** question (LLVM, CGO 2004; MLIR, arXiv
2002.11054) crossed with the **graph-drawing layout/render boundary** (Graphviz GN99; ELK). The 11
`Positioned*`/`*LayoutResult` types each re-declare `width`/`height` with no base interface
(`src/types.ts:91,303,…`), and the agent stack carries a *second* normalized model, `RenderedLayout`
(`agent/types.ts:908`), that the SVG stack never consumes. "A laid-out diagram" has no canonical type.

**(b) Prescription.** Graphviz and ELK both prescribe a clean layout→render boundary communicating
through *one* annotated-geometry structure: layout emits positions, renderers consume them. LLVM
prescribes a single shared IR at the waist. **But** MLIR's caution is the more honest fit: when the
levels genuinely differ, model them as distinct dialects and *lower progressively* rather than forcing
one universal type.

**(c) Recommendation — the calibrated version.** Do **not** attempt to merge all 11 `Positioned*`
types into one universal geometry IR (see (e)). Instead, two cheap, high-value moves:

1. **Introduce a marker base interface** the 11 types extend:
   `interface PositionedDiagram { width: number; height: number }`. This is the *thin waist* — it
   gives `RenderContext`, `FamilyPlugin.layout`, and PNG/SVG entrypoints **one** type to name without
   forcing structural unification of the bodies. Minimal, mechanical, and it makes I2's `RenderContext`
   well-typed.
2. **Make the `PositionedGraph → RenderedLayout` lowering explicit.** Per `AGENT_NATIVE.md` §1,
   `RenderedLayout` (the layout JSON) is the *canonical determinism/equality artifact* — "two render
   results are equal iff their layout JSON is structurally equal," pinned by the cross-process and
   drift-sentinel tests — so it is **not** a debug view to demote. The two models sit at genuinely
   different levels (MLIR-style dialects): `PositionedDiagram` is SVG-facing geometry, `RenderedLayout`
   is the surface-neutral equality oracle. The fix is to make one *derive from* the other through an
   explicit lowering (`agent/layout-to-rendered.ts`), never built in parallel, so the two cannot diverge.

**(d) Tradeoffs / determinism risk.** Adding a marker base is zero-runtime and deterministic. The real
risk is over-reach: a too-rich shared base (ports, edges, groups) would force every family to satisfy
fields it doesn't have, re-creating the I2 god-bag at the type level. Keep the base to
`{ width, height }` and let families add their own fields — this is structurally what they already do.

**(e) Where theory doesn't transfer (important).** LLVM's single-IR success depended on the IR being
**genuinely universal** across real languages and targets. Diagram `Positioned*` models may be too
family-specific to unify (a Gantt timeline's bars, a sequence diagram's lifelines, and a pie's wedges
share little beyond a bounding box). Forcing one IR here risks Metz's "wrong abstraction": a union type
that accretes conditionals. The marker-base + progressive-projection design captures the *real* shared
contract (a bounding box and a render target) without paying for unification we'd immediately special-case.

---

## I4 — Layering leaks: render/config concerns pushed up into parse and layout

**(a) Lens.** Direct hit for **Parnas (1972/1979)** information hiding and the **Graphviz/ELK
layout-vs-render boundary**. The leaks are decisions placed in the wrong module:
- Audit-time `layoutPieChart(chart, options, colors)` — layout consumed `DiagramColors` to assign slice colors.
- `layoutArchitectureDiagram(diagram, options, visual)` + `resolveArchitectureVisualConfig` — visual
  config threaded through *both* layout and render, bypassing `options`.
- Audit-time `parseXYChart(lines, frontmatter)` — theme/frontmatter was baked in during *parsing*.
- Gantt is a hand-wired **4-stage** pipeline in `index.ts:404`.

ELK's prescription is unambiguous: layout is a *pure geometry service*; color and visual styling are
rendering concerns downstream of coordinates.

**(b) Prescription.** Push each decision down to the layer that owns it (Parnas: hide the decision in
one module behind a stable interface). Color/visual resolution belongs at **render**; frontmatter
application belongs in a **post-parse middleware** stage, not inside the parser.

**(c) Recommendation.**
- **Pie:** move slice-color assignment out of `layoutPieChart` into the pie renderer. Layout emits
  *uncolored* wedge geometry (angles, radii); the renderer colors them from `ctx.colors`. Determinism
  is preserved because color assignment is a pure function of slice index/order.
- **Architecture:** resolve `visual` at render (`renderArchitectureSvg` reads `ctx.options.architecture.visual`);
  if layout genuinely needs a *metric* (e.g. icon size affects box size), pass that **one number**
  explicitly, not the whole visual config. This is the legitimate exception — note it honestly.
- **XY chart:** model frontmatter as **post-parse middleware**, exactly as Gantt already does
  (`applyGanttFrontmatterConfig`). `parseXYChart` returns the structural model; a separate
  `applyXYChartFrontmatter` stage folds theme in. This makes the two pipelines *consistent* (I9 too).
- **Gantt:** the 4-stage pipeline is **not a leak — it is correct** (see (e)); formalize it as a named
  pipeline rather than inline wiring in `index.ts:404`.

**(d) Tradeoffs / determinism risk.** Moving color assignment from layout to render must keep the
*same deterministic ordering* (slice order, palette index). This is the highest-determinism-risk item
in I4: a snapshot diff is mandatory and the palette-index function must be lifted verbatim, not
re-derived. Architecture's icon-size-affects-layout coupling means you cannot fully purify its layout;
document the residual.

**(e) Where theory doesn't transfer.** "Parsing must be pure" is too strong. Gantt's multi-stage shape
(`parse → applyFrontmatter → resolveSchedule → layout`) is the **textbook Sugiyama-style staged
pipeline** (Sugiyama/Tagawa/Toda 1981) and a Parnas "uses"-hierarchy done right — each stage consumes
the prior stage's output. The fix for Gantt is to *name and document* the pipeline, not flatten it.
Likewise, architecture's metric coupling (icon size → box size) is *essential* layout input, not a leak.

---

## I5 — Styling: five parallel color models; N ways to set one property

**(a) Lens.** **Parnas information hiding** + the **narrow-waist / hourglass** principle (Beck, CACM
2019) + **"Parse, don't validate"** (Alexis King 2019). Five color models
(`RenderOptions → DiagramColors → ResolvedColors`, plus `MermaidThemeVariables` and
`classDefs/nodeStyles/linkStyles`) mean **node fill is reachable 5 ways** and **group border 3 ways**
(audit §I5). That is five representations of one decision — the opposite of a narrow waist.

**(b) Prescription.** Pick **one internal color contract** (the waist) and *normalize every external
spelling into it at the boundary* (King: parse the many input dialects into one precise internal type,
once, so downstream code never re-resolves). Everything below the waist sees only the canonical model.

**(c) Recommendation.** Make **`DiagramColors` (+ the CSS-custom-property layer) the single internal
contract.** Treat `MermaidThemeVariables`, `classDefs/nodeStyles/linkStyles`, and `RenderOptions` as
**input dialects** that a boundary function (`resolveDiagramColors`) *parses* into `DiagramColors`
— after which no renderer consults the raw dialects. Concretely: the precedence rule "classDef beats
themeVariables beats RenderOptions" lives in **one** resolver, not scattered across families. Keep the
public custom-style surface to Style + Palette, and let built-in looks map into the internal style face
so pie/quadrant/gantt/architecture reach typography, spacing, and color through the same waist.

**(d) Tradeoffs / determinism risk.** Color resolution is already deterministic; the risk is *changing
precedence* during consolidation. Lock current precedence with tests *before* refactoring (golden
renders per input dialect), then prove the consolidated resolver reproduces them. This is **structural,
medium-risk** — touch one resolver, verify byte-identical output.

**(e) Where theory doesn't transfer.** Five models did not appear by accident — `MermaidThemeVariables`
exists for **Mermaid compatibility**, `classDefs` for **inline-directive fidelity**. The waist must
*absorb* these dialects at the boundary, not abolish them; users still author them. "One color model"
is the *internal* invariant, not a user-facing reduction. Over-collapsing (dropping classDef support to
simplify) would be a correctness regression, not a cleanup.

---

## I6 — "Route contracts" is two abstractions sharing one type union

**(a) Lens.** **"Making illegal states unrepresentable"** (Minsky) and **ADTs + exhaustiveness checking**.
At audit time, `LayoutRouteCertificate = RouteCertificate | FamilyRouteCertificate` looked unified
but the arms shared neither producer, consumer, nor lifecycle:
- `RouteCertificate` (flowchart) was keyed by `edgeIndex`, carried `invariant: 'straight' | …`, and
  was produced in **core** (`route-contracts.ts`, attached to `PositionedEdge.routeCertificate`).
- The old `FamilyRouteCertificate` shape mixed edge proofs (class/ER, architecture, sequence) with
  element/region proofs (timeline/xychart/pie/quadrant/gantt), so some members were keyed by
  `edgeIndex` while others were keyed by `elementId`.

A union whose arms have different *keys* (`edgeIndex` vs `elementId`) and different lifecycles is a
*structural* union, not a *semantic* one — it permits illegal states (a "certificate" with no producer
on a given path).

**(b) Prescription.** Minsky: the type should make the real distinctions visible. Either (i) **split the
type** to reflect that there are genuinely two-or-three different certificate concepts, or (ii) **unify
the lifecycle** by producing family certs in the core layout path so the union becomes real.

**(c) Recommendation — split, don't fake-unify.** Rename to expose reality:
The implemented split names what each certificate proves:
`EdgeRouteCertificate = RouteCertificate | FamilyEdgeRouteCertificate` for edge-indexed route proofs,
and `RegionContainmentCertificate` for element/region containment proofs. The umbrella
`LayoutRouteCertificate` remains only as a debug-sidecar sum whose members are **named by what they
prove**. `layoutCertificateProof` switches exhaustively over those names so a new certificate kind is
a compile error, not a silent gap.

**(d) Tradeoffs / determinism risk.** This is a **type-level rename + redocument** with no geometry
change — low determinism risk. The discipline risk is that the agent verify path and core route path
must agree on which certs exist where; an exhaustive `switch` with a `never` default enforces it.

**(e) Where theory doesn't transfer.** Option (ii) — "produce family certs in core layout so the union
is real" — is the *theoretically cleaner* unification but likely the **wrong call**: family layouts live
in `agent/family-layouts.ts` precisely because the core SVG render path for families doesn't need
certificates to draw. Forcing the core to mint containment certs it never reads is work for symmetry's
sake (Metz). **Prefer the split (i).** Honesty over false unification.

---

## I7 — The agent layer is the reference design — with two seams

**(a) Lens.** **"Parse, don't validate"** (King 2019) and **"illegal states unrepresentable"** (Minsky).
`ValidDiagram { kind, meta, body, source, canonicalSource }` + `DiagramBody` (12 structured bodies | the
`{ kind: 'opaque'; family; source }` fallback, `agent/types.ts:501,521`) + `Result<T,E>`
(`agent/types.ts:14`) is exactly King's "parse the input into a precisely-typed value at the boundary."
`ValidDiagram` *is* the parsed type; the opaque arm is the honest "we recognized the family but not the
syntax" state — a model worth celebrating, not fixing. The two seams are real, though:

- **(seam a) Mutation ops are duck-typed:** `mutate(body, op: AnyMutationOp)` with each family
  narrowing via `if (body.kind !== 'class') return err(...)`.
- **(seam b) Layout re-parses `canonicalSource`** through the core per-family parser instead of using
  the family registry as the owner of layout dispatch — a text round-trip that can couple agent layout
  to *serializer fidelity* for L3/L4 structured bodies.

**(b) Prescription.** Minsky: push the narrowing into the *type* so an op can only reach a body it
applies to. King: don't round-trip through text you already parsed — operate on the structured value.

**(c) Recommendation.**
- **(seam a):** keep duck-typed narrowing for now — it is *cheap and safe* (the `err(...)` is correct,
  just verbose). If desired, route mutation through `FamilyPlugin.mutate` (already in the interface,
  `families.ts:55`) so each family owns its narrowing in one place rather than re-checking at every op.
  This is the I1 registry paying off again. **Low priority** — it is verbosity, not a bug.
- **(seam b) is the structural one — but reconciled, lower-urgency.** Give `FamilyPlugin` a
  source-context `layout?(ctx)` hook (I1/I3) and prefer it over public-entrypoint switch statements.
  This lets each family own the exact parse/config/layout pipeline it needs while preserving
  frontmatter, accessibility directives, and opaque-source semantics. Per `AGENT_NATIVE.md` §3,
  however, `canonicalSource` is the *documented* "round-trip pillar" ("structured renderers use this
  as input") and the coupling is already guarded by round-trip identity property tests — so direct
  **structured-body** layout is a future decoupling/perf option, not the closure requirement, and it
  applies only to **L3/L4** structured bodies. For **L1** opaque bodies, text is the representation and
  re-parsing is correct.

**(d) Tradeoffs / determinism risk.** The source-context hook is lower-risk than the original body-only
wording because it moves dispatch without changing which source dialects a family can faithfully
understand. A later body-direct layout path is higher-risk: it must produce *byte-identical* geometry
to the source-context path, or it is a behavior change. Gate any such migration per family with
snapshot tests; migrate only families whose body is a faithful superset of what the parser
reconstructs. Some families may *not* round-trip losslessly today — for those, keeping source-context
layout is the honest call.

**(e) Where theory doesn't transfer.** "Never round-trip through text" is too absolute. For the **opaque**
body, text *is* the only representation — source-context layout is correct and unavoidable. The
body-direct optimization applies strictly to **structured** bodies. And duck-typed narrowing (seam a)
is a non-issue the theory would over-engineer; resist the urge to build a typed op-dispatch matrix for
it.

---

## I8 — ASCII is a parallel universe — mostly justified

**(a) Lens.** **Metz, "The Wrong Abstraction"** ("duplication is far cheaper than the wrong
abstraction") and **Moseley & Marks, essential vs. accidental complexity**. The `ascii/` stack (~9.6k
lines) shares nothing large with SVG: own `AsciiGraph`/`Canvas`/`RoleCanvas`, own A* pathfinder, own
per-family layouts; it reuses only `NodeShape`, `EdgeStyle`, `RouteClass`, and `shared/unicode-ranges.ts`.

**(b) Prescription.** Metz: do **not** force a shared abstraction when the back-ends differ
*essentially*. The differences here are essential: **character-cell grid geometry** (integer snapping,
monospace metrics, no sub-cell positioning) versus **float vector geometry**. A unified geometry model
would accrete per-call special-casing — the exact tangle Metz warns about, which *raises* accidental
complexity while looking DRY.

**(c) Recommendation. Leave ASCII isolated.** This is the explicit "academic ideal is the wrong call
here" case: the theoretically-tidy move (one geometry IR for both surfaces) is **wrong**. ASCII is
*internally* well-abstracted (it already has the pluggable `ShapeRenderer` registry the SVG side lacks —
note the irony: ASCII is ahead of SVG on intra-stack abstraction). The only defensible sharing is at the
*topology* level, never the *geometry* level: families/`RouteClass` classification and "which families
exist" could flow from the I1 registry (an ASCII renderer is just another `FamilyPlugin.renderAscii`
hook), so the **family-set** stops being declared twice even though the **layout** stays separate.

**(d) Tradeoffs / determinism risk.** Routing ASCII through the I1 registry's `renderAscii` hook is the
*only* I8 change worth making, and it is low-risk (dispatch only, not geometry). The cost the audit
names — "shape / edge-routing / fan-in-out exist twice, so parity changes need two edits" — is **real
and worth accepting**: it is the price of two genuinely different geometries. Track parity with a
shared *test corpus*, not shared *code*.

**(e) Where theory doesn't transfer.** None needed — this is the case where the theory (Metz) *correctly*
says "stop." The one nuance: "essential" is a judgment that can change. If ASCII and SVG ever converge on
a shared *intermediate topology* (post-ELK, pre-geometry), revisit — but only when a forced change proves
they've actually converged, never preemptively.

---

## I9 — Vestigial / cosmetic

**(a) Lens.** **Lampson** ("do one thing well"; remove needless indirection) and **TypeScript exhaustiveness checking**.
At audit time, `src/layout.ts` was a one-line re-export of `layoutGraphSync`
(pure indirection); naming was inconsistent (`parseXDiagram` vs `parseXChart`
vs `parseGanttModel`; `Sync` suffix on only 3 of 11 sync layout fns);
`_options` params (pie/quadrant) advertised a contract not honored.

**(b/c) Prescription / recommendation.** Pure hygiene, **mechanical, lowest-risk**, do alongside the
structural work it touches:
- Issue #71 inlined `src/layout.ts`'s re-export at call sites and deleted the file (Lampson: needless indirection).
- Normalize naming to one convention (`parse<Family>` / `layout<Family>`); drop the `Sync` suffix
  (all are sync — the distinction is meaningless). Do this as a **single rename commit** so blame stays
  legible.
- Delete unused `_options` params — folded into the I2 `RenderContext` migration (an unused param is a
  lie about the interface; King/Lampson both say the type should tell the truth).

**(d) Determinism risk.** Zero — renames and dead-param removal don't touch geometry. The only risk is
*merge churn*; sequence I9's renames **after** the structural refactors (I1–I3) so you rename the final
names once, not twice.

**(e) Where theory doesn't transfer.** Nothing deep here; resist gold-plating (don't invent a naming DSL).

---

## Historical closure record

This table supersedes the original issue roadmap. It records the implementation closure criteria after
the 2026-06-21 reappraisal. Every behavior-affecting row is gated by the repo's snapshot,
property-based, visual-contract, and determinism tests.

| # | Closure criterion | Issues | Status |
|---|---|---|---|
| 1 | `RenderContext` + marker `PositionedDiagram`; all SVG renderers use the context object. | I2, I3 | Done. |
| 2 | Split certificate concepts by proof type; exhaustively classify every certificate variant. | I6 | Done via `EdgeRouteCertificate`, `FamilyEdgeRouteCertificate`, `RegionContainmentCertificate`, and `layoutCertificateProof`. |
| 3 | Add `layout`/`renderSvg`/`renderAscii` hooks to `FamilyPlugin`; remove public SVG/ASCII switch dispatch; make registry iteration deterministic. | I1, I8 | Done; `knownFamilies()` follows metadata order. |
| 4 | Move I4 leaks to their owning stages: pie colors at render, xychart config post-parse, named Gantt pipeline, architecture metrics-only layout input. | I4 | Done. |
| 5 | Consolidate color resolution onto `DiagramColors` + CSS vars and semantic role color slots. | I5 | Done; Mermaid dialects remain accepted at the boundary. |
| 6 | Prefer registered source-context layout hooks over duplicated public dispatch; reserve body-direct layout for future per-family optimizations that can prove lossless parity. | I7 (seam b) | Done for closure; body-direct layout is not required for issue #71. |
| 7 | Delete vestigial `src/layout.ts`; remove dead renderer params; avoid broad naming churn unless it falls out naturally. | I9 | Done for blocking hygiene; global rename normalization remains optional. |

Seam (a) of I7 (duck-typed mutation) remains deliberately omitted — the registry route would not make a
typed op-dispatch matrix simpler, and the current public mutation surface is already narrowed by family.

---

## Where the academic ideal is the *wrong* call here

A deliberate list, so reviewers can see the adversarial check was done and not skipped:

1. **Do not unify the three stacks into one geometry IR (against a naïve reading of LLVM/MLIR).**
   The `Positioned*` models are too family-specific; a universal IR becomes Metz's "wrong abstraction."
   Use a **marker base** (`{width,height}`) + progressive projection, not unification (I3).
2. **Keep ASCII isolated (against "DRY the renderers").** Grid vs. float geometry is *essential*
   complexity (Moseley & Marks); a shared model would accrete conditionals. Share only the *family-set*
   via the registry, never the layout (I8).
3. **Split the certificate union; don't force the core to mint family certs (against symmetry).**
   Producing containment certs the core never reads is work for tidiness' sake; split the type instead (I6).
4. **Don't build multimethods or a typed op-dispatch matrix in TypeScript (against Clojure/Julia).**
   Non-idiomatic; a global multimethod registry risks **import-order nondeterminism** that violates the
   repo's hard determinism guarantee. The keyed plug-in registry is the right amount of dynamism (I1, I7a).
5. **Don't purify Gantt's pipeline or parsing dogmatically (against "parse must be pure").**
   Gantt's 4-stage shape is a correct Sugiyama-style staged pipeline (Sugiyama/Tagawa/Toda 1981);
   *name* it, don't flatten it. The opaque body legitimately *is* text and must re-parse (I4, I7e).
6. **Don't tagless-final / object-algebra the families (against the Expression-Problem "solutions").**
   Both fight TypeScript's structural typing and break the JSON-serializable, inspectable data model the
   agent stack depends on. The registry-of-records is the pragmatic two-axis solution that survives
   serialization and determinism (§0).

---

## References

Verification legend: **[V]** citation + URL content directly confirmed this session; **[D]** citation/DOI
confirmed via authoritative index (dblp/arXiv/publisher) but the canonical landing page returned 403/402
to automated fetch (open mirror given where available); **[C]** cited by author/edition/ISBN, page-level
URL not independently fetched. No URLs or page numbers were fabricated.

**Expression Problem & solution patterns**
- Philip Wadler, "The Expression Problem," email to the Java Genericity list, 12 Nov 1998. **[V]**
  <https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt>
- William R. Cook, "On Understanding Data Abstraction, Revisited," OOPSLA 2009, pp. 557–572.
  DOI 10.1145/1640089.1640133. **[D]** author PDF <https://www.cs.utexas.edu/~wcook/Drafts/2009/essay.pdf>
  (ACM DOI page paywalled).
- Mads Torgersen, "The Expression Problem Revisited — Four New Solutions Using Generics," ECOOP 2004,
  LNCS 3086, pp. 123–143. DOI 10.1007/978-3-540-24851-4_6. **[D]**
  <https://link.springer.com/chapter/10.1007/978-3-540-24851-4_6>
- Bruno C. d. S. Oliveira & William R. Cook, "Extensibility for the Masses: Practical Extensibility with
  Object Algebras," ECOOP 2012, LNCS 7313, pp. 2–27. DOI 10.1007/978-3-642-31057-7_2. **[D]**
  author PDF <https://www.cs.utexas.edu/~wcook/Drafts/2012/ecoop2012.pdf>
- Jacques Carette, Oleg Kiselyov, Chung-chieh Shan, "Finally Tagless, Partially Evaluated," APLAS 2007
  (LNCS 4807, pp. 222–238, DOI 10.1007/978-3-540-76637-7_15); journal version JFP 19(5):509–543, 2009,
  DOI 10.1017/S0956796809007205. **[V]** <https://okmij.org/ftp/tagless-final/> · PDF
  <https://okmij.org/ftp/tagless-final/JFP.pdf>
- Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides, *Design Patterns: Elements of Reusable
  Object-Oriented Software*, Addison-Wesley, 1994. ISBN 0-201-63361-2. **[C]** (Visitor pp. 331–344;
  Bridge pp. 151–161; Strategy pp. 315–323; Abstract Factory pp. 87–95.) Bridge/Strategy/Abstract Factory
  reference pages: <https://refactoring.guru/design-patterns/bridge> · `/strategy` · `/abstract-factory`. **[V]**
- Rich Hickey / Clojure, "Multimethods and Hierarchies," clojure.org reference. **[V]**
  <https://clojure.org/reference/multimethods>
- Jeff Bezanson, Alan Edelman, Stefan Karpinski, Viral B. Shah, "Julia: A Fresh Approach to Numerical
  Computing," *SIAM Review* 59(1):65–98, 2017, DOI 10.1137/141000671. **[D]** docs **[V]**
  <https://docs.julialang.org/en/v1/manual/methods/> · paper PDF
  <https://julialang.org/assets/research/julia-fresh-approach-BEKS.pdf>

**Compiler / IR / multi-backend architecture**
- Andrew W. Keep & R. Kent Dybvig, "A Nanopass Framework for Commercial Compiler Development," ICFP 2013,
  pp. 343–350. DOI 10.1145/2500365.2500618. **[D]** author PDF <https://andykeep.com/pubs/np-preprint.pdf>
- Dipanwita Sarkar, Oscar Waddell, R. Kent Dybvig, "A Nanopass Infrastructure for Compiler Education,"
  ICFP 2004, pp. 201–212. DOI 10.1145/1016850.1016878. **[D]**
  <https://www.cs.tufts.edu/comp/150FP/archive/kent-dybvig/nanopass.pdf>
- Chris Lattner & Vikram Adve, "LLVM: A Compilation Framework for Lifelong Program Analysis &
  Transformation," CGO 2004, pp. 75–88. DOI 10.1109/CGO.2004.1281665. **[V]**
  <https://llvm.org/pubs/2004-01-30-CGO-LLVM.html>
- Chris Lattner, Mehdi Amini, Uday Bondhugula, Albert Cohen, Andy Davis, Jacques Pienaar, River Riddle,
  Tatiana Shpeisman, Nicolas Vasilache, Oleksandr Zinenko, "MLIR: A Compiler Infrastructure for the End
  of Moore's Law," arXiv:2002.11054, 2020 (CGO 2021 as "MLIR: Scaling Compiler Infrastructure for Domain
  Specific Computation," DOI 10.1109/CGO51591.2021.9370308). **[V]** <https://arxiv.org/abs/2002.11054>
- Micah D. Beck, "On the Hourglass Model," *Communications of the ACM* 62(7):48–57, 2019.
  DOI 10.1145/3274770. **[D]** open fulltext
  <https://m-cacm.acm.org/magazines/2019/7/237714-on-the-hourglass-model/fulltext>
  (Deering's 1998 "Watching the Waist of the Protocol Hourglass" keynote is the metaphor's origin but has
  no stable peer-reviewed URL — **URL not verified**; Beck is the citable source.)

**Modularity & information hiding**
- David L. Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules," *CACM* 15(12):1053–1058,
  1972. DOI 10.1145/361598.361623. **[D]** author copy <http://sunnyday.mit.edu/16.355/parnas-criteria.html> **[V]**
- David L. Parnas, "Designing Software for Ease of Extension and Contraction," *IEEE TSE* SE-5(2):128–138,
  1979. DOI 10.1109/TSE.1979.234169. **[D]** <https://ieeexplore.ieee.org/document/1702607/>

**Two-dimensional variability / plugin architecture / DIP**
- (Bridge / Strategy / Abstract Factory: GoF 1994, above.)
- Frank Buschmann, Regine Meunier, Hans Rohnert, Peter Sommerlad, Michael Stal, *Pattern-Oriented Software
  Architecture, Volume 1: A System of Patterns* (POSA1), Wiley, 1996. ISBN 0-471-95869-7. Microkernel
  pp. 171–192. **[C]** publisher
  <https://www.wiley.com/en-us/Pattern+Oriented+Software+Architecture,+Volume+1,+A+System+of+Patterns-p-9780471958697> **[V]**
- Robert C. Martin, "The Dependency Inversion Principle," *C++ Report*, 1996; "Design Principles and
  Design Patterns," Object Mentor, 2000. **[C]** original host defunct; cited by
  <https://en.wikipedia.org/wiki/Dependency_inversion_principle> **[V]** and
  <https://martinfowler.com/articles/dipInTheWild.html> **[V]**; archived PDF
  <https://web.archive.org/web/20110714224327/http://www.objectmentor.com/resources/articles/dip.pdf>
  (**not independently fetched**).

**Type-driven design**
- Yaron Minsky, "Effective ML Revisited" (incl. "Make illegal states unrepresentable"), Jane Street Tech
  Blog (Effective ML talk, CUFP 2010). **[V]** <https://blog.janestreet.com/effective-ml-revisited/>
- Alexis King, "Parse, don't validate," lexi-lambda.github.io, 5 Nov 2019. **[V]**
  <https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/>
- "Narrowing — Discriminated Unions and Exhaustiveness Checking," *The TypeScript Handbook*, Microsoft. **[V]**
  <https://www.typescriptlang.org/docs/handbook/2/narrowing.html> · theory backing: Robert Harper,
  *Practical Foundations for Programming Languages*, 2nd ed., Cambridge Univ. Press, 2016 (Sum Types). **[C]**

**Graph drawing / layout-vs-render**
- Kozo Sugiyama, Shojiro Tagawa, Mitsuhiko Toda, "Methods for Visual Understanding of Hierarchical System
  Structures," *IEEE Trans. SMC* SMC-11(2):109–125, 1981. DOI 10.1109/TSMC.1981.4308636. **[D]**
- Emden R. Gansner & Stephen C. North, "An open graph visualization system and its applications to
  software engineering," *Software: Practice and Experience* 30(11):1203–1233, 2000.
  DOI 10.1002/1097-024X(200009)30:11<1203::AID-SPE338>3.0.CO;2-N. **[D]** open author PDF ("GN99")
  <https://www.graphviz.org/documentation/GN99.pdf>
- Christoph Daniel Schulze, Miro Spönemann, Reinhard von Hanxleden, "Drawing layered graphs with port
  constraints," *J. Visual Languages & Computing* 25(2):89–106, 2014. DOI 10.1016/j.jvlc.2013.11.005. **[D]**
- Sören Domrös, Reinhard von Hanxleden, Miro Spönemann, Ulf Rüegg, Christoph Daniel Schulze, "The Eclipse
  Layout Kernel," arXiv:2311.00533, 2023. **[V]** <https://arxiv.org/abs/2311.00533>

**2026-06-21 competitive / industry reappraisal sources**
- Mermaid documentation, "Diagram Syntax" and layout/look configuration (site version 11.15.0). **[V]**
  <https://mermaid.js.org/intro/syntax-reference.html>
- Mermaid documentation, "Theme Configuration" (`themeVariables`, derived colors, per-family variables).
  **[V]** <https://mermaid.js.org/config/theming.html>
- Graphviz documentation, "Documentation" overview (DOT language, layout engines, output formats,
  attributes). **[V]** <https://graphviz.org/documentation/>
- PlantUML home page (supported diagram families, layout engines, output formats) and ASCII-art page
  (ASCII/Unicode documented for sequence diagrams). **[V]** <https://plantuml.com/> ·
  <https://plantuml.com/ascii-art>
- D2 documentation, "Introduction", "Layouts", and "Themes" (declarative diagramming, engine tradeoffs,
  theme overrides). **[V]** <https://d2lang.com/tour/intro/> ·
  <https://d2lang.com/tour/layouts/> · <https://d2lang.com/tour/themes/>
- Design Tokens Community Group, "Design Tokens Format Module 2025.10," Draft Community Group Report,
  13 June 2026. **[V]** Preview draft; explicitly not a W3C standard.
  <https://www.designtokens.org/tr/drafts/format/>

**Testing practice sources used for reappraisal**
- `adewale/testing-best-practices` skill and references (TypeScript, golden/snapshot tests, correctness by
  construction, mutation/testing-type decision guide). **[V]**
  <https://github.com/adewale/testing-best-practices>
- Koen Claessen & John Hughes, "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs,"
  ICFP 2000. DOI 10.1145/351240.351266. **[D]**
- Yue Jia & Mark Harman, "An Analysis and Survey of the Development of Mutation Testing," *IEEE TSE*
  37(5):649-678, 2011. DOI 10.1109/TSE.2010.62. **[D]**
- James Somers, "What if writing tests was a joyful experience?", Jane Street Blog, 9 Jan 2023
  (expect/snapshot tests and readable output discipline). **[V]**
  <https://blog.janestreet.com/the-joy-of-expect-tests/>

**Complexity & cost of duplication**
- Ben Moseley & Peter Marks, "Out of the Tar Pit," 2006. **[V]**
  <https://curtclifton.net/papers/MoseleyMarks06a.pdf>
- Butler W. Lampson, "Hints for Computer System Design," *ACM SIGOPS OSR* 17(5):33–48, SOSP 1983.
  DOI 10.1145/773379.806614. **[D]** open author PDF
  <https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/acrobat-17.pdf>
- Sandi Metz, "The Wrong Abstraction," sandimetz.com, 20 Jan 2016. **[V]**
  <https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction>
