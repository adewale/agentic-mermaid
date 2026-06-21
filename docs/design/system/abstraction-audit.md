# Abstraction audit — historical baseline and issue list

Status: historical audit snapshot. Captured 2026-06-20, before the issue #71
implementation. Scope: the abstraction surfaces across
`src/` (core pipeline, per-family modules, `agent/`, `ascii/`, styling/theming).

This document captures **what the code looked like on 2026-06-20** and the **list of issues**. It is
kept as the historical baseline for issue #71, not as the current architecture reference.
Literature-grounded
recommendations are tracked separately in
[`abstraction-recommendations.md`](./abstraction-recommendations.md).

> 2026-06-21 note: this is now the **pre-implementation baseline**, not the
> current architecture. The current closure spec and reappraisal are in
> [`abstraction-recommendations.md`](./abstraction-recommendations.md#2026-06-21-reappraisal).
> Line references and type names below are audit-time references.

---

## 1. Mental model: three stacks over one source

Every diagram nominally flowed `source → normalize → parse → layout → render`. At audit time, that
pipeline was implemented **three independent times**, once per output surface, over the same set of 12
diagram families:

| Stack | Entry | Dispatch | Layout model | Output |
|---|---|---|---|---|
| **SVG** | `renderMermaidSVG` (`src/index.ts:297`) | `switch(diagramType)` — 11 arms (`index.ts:342`) | `PositionedGraph` + 10 sibling `Positioned*` types | SVG string |
| **ASCII** | `renderMermaidASCII` (`src/ascii/index.ts`) | `switch(diagramType)` — 11 arms | `AsciiGraph`/`Canvas` (own A* layout, no ELK) | text |
| **Agent** | `parseMermaid`/`mutate`/`verify`/… (`src/agent/`) | `FamilyPlugin` **registry** (`src/agent/families.ts`) | `ValidDiagram`/`DiagramBody` + `RenderedLayout` | typed IR |

This triplication was the root cause of most issues below: the same concept ("a sequence
diagram," "a node," "an edge route") has up to three representations, and the three stacks
dispatch over families three different ways.

The only **core** types genuinely shared across stacks live in `src/types.ts`: `NodeShape`,
`EdgeStyle`, `EdgeMarker`, `Direction`, `MermaidGraph` (+`MermaidNode`/`Edge`/`Subgraph`), and
the `RouteClass`/port vocabulary. Everything larger forks per stack.

---

## 2. Inventory of abstraction layers

The 12 built-in families this inventory spans — the canonical roster, **generated from
`BUILTIN_FAMILY_METADATA` (`src/agent/families.ts`)** and pinned by
[`audit-family-table.test.ts`](../../../src/__tests__/audit-family-table.test.ts) so it cannot drift
from the registry (regenerate with `UPDATE_GOLDEN=1 bun test src/__tests__/audit-family-table.test.ts`):

<!-- FAMILY-TABLE:start -->
| Family | `kind` | Mermaid header(s) | SDK narrower |
|---|---|---|---|
| Flowchart | `flowchart` | `flowchart`, `graph` | `asFlowchart` |
| State | `state` | `stateDiagram`, `stateDiagram-v2` | `asState` |
| Sequence | `sequence` | `sequenceDiagram` | `asSequence` |
| Timeline | `timeline` | `timeline` | `asTimeline` |
| Class | `class` | `classDiagram` | `asClass` |
| ER | `er` | `erDiagram` | `asEr` |
| Journey | `journey` | `journey` | `asJourney` |
| Architecture | `architecture` | `architecture-beta` | `asArchitecture` |
| XY chart | `xychart` | `xychart`, `xychart-beta` | `asXyChart` |
| Pie | `pie` | `pie` | `asPie` |
| Quadrant | `quadrant` | `quadrantChart` | `asQuadrant` |
| Gantt | `gantt` | `gantt` | `asGantt` |
<!-- FAMILY-TABLE:end -->

- **Domain IR (input):** `MermaidGraph` (flowchart, `types.ts:7`) + 10 family input types
  (`SequenceDiagram`, `ClassDiagram`, `ErDiagram`, `TimelineDiagram`, `JourneyDiagram`,
  `XYChart`, `PieChart`, `QuadrantChart`, `GanttModel`, `ArchitectureDiagram`) + agent
  `ValidDiagram`/`DiagramBody` (`agent/types.ts`).
- **Layout output (positioned):** `PositionedGraph` (`types.ts:91`) + 10 unrelated `Positioned*`/
  `*LayoutResult` siblings + agent `RenderedLayout` (a second normalized model).
- **Routing / quality:** `route-contracts.ts` (`classifyRoutes`, `allocateRoutePorts`,
  `applyRouteContracts`, `auditRouteContracts`) producing `RouteCertificate`;
  audit-time `FamilyRouteCertificate` (produced only in `agent/family-layouts.ts`);
  `layout-rubric.ts` (`assessLayout` → `RubricResult`);
  agent `verify` (3-tier `LayoutWarning`).
- **Styling / color:** five color models — `RenderOptions`, `DiagramColors` (`theme.ts`),
  `ResolvedColors` (`theme.ts`), `MermaidThemeVariables` (`mermaid-source.ts`),
  `classDefs`/`nodeStyles`/`linkStyles` (`MermaidGraph`) — plus role styles `DiagramStyleOptions`
  (`types.ts:364`) and the CSS-custom-property layer (`--bg`/`--fg` + `color-mix`).
- **Rendering surfaces:** SVG renderers (`renderer.ts:37` `renderSvg` + 10 family `render*Svg`);
  ASCII (`AsciiGraph`/`Canvas`/`RoleCanvas` + pluggable `ShapeRenderer` registry); PNG (`agent/png.ts`).
- **Dispatch:** SVG `switch` (`index.ts`) vs ASCII `switch` (`ascii/index.ts`) vs agent
  `FamilyPlugin` registry (`agent/families.ts`).
- **Delivery:** `cli/`, `mcp/` (JSON-RPC server, sandbox, artifact store) — thin surfaces over the above.

---

## 3. Issue list (ranked by structural weight)

### I1 — Three dispatch mechanisms for one family set; the best one is least used
The agent layer has a clean plugin registry (`FamilyPlugin { id, detect, parse?, serialize?,
mutate?, verify? }` in a `Map<DiagramKind, FamilyPlugin>`, self-registered at import). The SVG
and ASCII stacks each hand-maintain a parallel `switch(diagramType)`. Adding a family means
touching three dispatch sites that cannot drift-check each other. **Highest-leverage target.**

### I2 — Renderer signature drift + redundant `(colors, font, transparent, options)` threading
Canonical shape: `renderSvg(positioned, colors: DiagramColors, font='Inter', transparent=false,
options={})` (`renderer.ts:37`). Drift across families:
- `renderGanttSvg(positioned, colors, font, transparent)` — **no `options`**
- `renderTimelineSvg(positioned, colors, font, transparent, timelineConfig, themeVariables, options)` — **7 params**
- `renderXYChartSvg(positioned, colors, font, transparent, interactive, options)` — `interactive` wedged in
- `renderArchitectureSvg(positioned, colors, font, transparent, visual)` — `visual` *replaces* `options`
- `renderPieSvg` / `renderQuadrantSvg(…, _options)` — `options` accepted but unused

Three positional args are redundant: `font` is also folded into `colors`
(audit-time `buildColors(opts, config, font)` sets `DiagramColors.font`, `index.ts:106`), and `transparent`
is a lone boolean that could live in `colors`/`options`. A single
`RenderContext { positioned, colors, options }` collapses the row and kills the drift.

### I3 — No shared `Positioned*` contract; two parallel layout-output models
The 11 `Positioned*`/`*LayoutResult` types are structurally unrelated — each re-declares
`width`/`height` independently, no base interface. On top of that the agent stack has a second
normalized model, `RenderedLayout`, which the SVG stack never uses; `agent/layout-to-rendered.ts`
and `agent/family-layouts.ts` translate into it. "A laid-out diagram" has no canonical type.

### I4 — Layering leaks: render/config concerns pushed up into parse and layout
Clean for ~7 families, broken for 4:
- Audit-time `layoutPieChart(chart, options, colors)` — layout consumes `DiagramColors` to assign slice colors.
- `layoutArchitectureDiagram(diagram, options, visual)` + `resolveArchitectureVisualConfig` —
  visual config threaded through layout *and* render, bypassing `options`.
- Audit-time `parseXYChart(lines, frontmatter)` — frontmatter/theme baked in during *parsing*.
- Gantt is a **4-stage** pipeline (`parseGanttModel → applyGanttFrontmatterConfig →
  resolveGanttSchedule → layoutGantt → render`), hand-wired in `index.ts:404`.

### I5 — Styling: five parallel color models; N ways to set one property
`RenderOptions → DiagramColors → ResolvedColors` (hex, for non-browser via `inlineResolvedColors`),
plus `MermaidThemeVariables` (frontmatter aliases) and `classDefs`/`nodeStyles`/`linkStyles`
(inline directives). **Node fill** is reachable 5 ways (`surface`; themeVariables
`primaryColor`/`nodeBkg`/`mainBkg`; classDef `fill:`); **group border** 3 ways
(`RenderOptions.border`; `style.group.borderColor`; themeVariables `clusterBorder`). Role styles
(`DiagramStyleOptions`, consumed via `resolveRenderStyle`) are a *good* abstraction but cover
typography/spacing only, and do not reach pie/quadrant/gantt/architecture.

### I6 — "Route contracts" is two abstractions sharing one type union
`RouteCertificate` (flowchart) is produced in the **core** (`route-contracts.ts:1169`
`applyRouteContracts`, attached to `PositionedEdge.routeCertificate`). Audit-time `FamilyRouteCertificate`
(class/er/architecture/sequence/timeline/…) is produced **only** in `agent/family-layouts.ts`
(`:139`, `:196`, `:292`, `:406`); the core SVG render path for families attaches no certificates.
Audit-time `LayoutRouteCertificate = RouteCertificate | FamilyRouteCertificate` looks unified but the two
arms share neither producer, consumer, nor lifecycle.

### I7 — The agent layer is the reference design — with two seams
`ValidDiagram { kind, meta, body, source, canonicalSource }` + `DiagramBody` (12 structured
bodies | opaque fallback) + `Result<T,E>` + the `FamilyPlugin` registry is the most coherent
abstraction in the repo, and it reuses core `MermaidGraph` rather than re-declaring it. Seams:
(a) mutation ops are **duck-typed** — `mutate(body, op: AnyMutationOp)` with each family narrowing
via `if (body.kind !== 'class') return err(...)`; (b) for layout the agent **re-parses
`canonicalSource`** through the core per-family parser instead of laying out the structured body
it already holds — a text round-trip coupling agent layout to serializer fidelity.

### I8 — ASCII is a parallel universe — mostly justified, internally clean
`ascii/` (~9.6k lines) shares nothing large with SVG: own `AsciiGraph`/`Canvas`/`RoleCanvas`,
own A* pathfinder, own per-family layouts. It reuses only `NodeShape`, `EdgeStyle`, `RouteClass`
(via `classifyRoutes`), and `shared/unicode-ranges.ts`. The isolation is defensible (grid vs.
float geometry); ASCII is *internally* well-abstracted (it has the pluggable `ShapeRenderer`
registry the SVG side lacks). Cost: "shape," "edge routing," and "fan-in/out bundling" each
exist twice, so a parity change must be made in two places.

### I9 — Vestigial / cosmetic
- Audit-time `src/layout.ts` is a one-line re-export of `layoutGraphSync` — pure indirection.
- Naming inconsistency: `parseXDiagram` vs `parseXChart` vs `parseGanttModel`; `Sync` suffix on
  only 3 of 11 layout fns (all are sync).
- `_options` unused params (pie/quadrant) advertise a contract the function does not honor.

---

## 4. Preliminary convergence targets

These are first-cut directions; the literature review refines and prioritizes them in
[`abstraction-recommendations.md`](./abstraction-recommendations.md). The binding constraint is
**determinism** (CLAUDE.md: identical input must produce identical geometry), which makes any
retrofit careful, family-by-family work behind snapshot tests rather than a sweeping rename.

1. Unify family dispatch on the agent's registry; give `FamilyPlugin` optional
   `renderSvg`/`renderAscii` hooks and delete the two `switch` statements. (Addresses I1.)
2. Collapse renderer signatures to `render(ctx: RenderContext)` with `font`/`transparent` inside.
   (Addresses I2.)
3. Introduce a marker `PositionedDiagram` base and make `RenderedLayout` a documented projection.
   (Addresses I3.)
4. Pick one color funnel (`DiagramColors` + CSS vars as the internal contract; normalize
   themeVariables/classDefs into it at the boundary; extend role styles to carry color slots).
   (Addresses I5.)
5. Push layering leaks back down (pie/architecture resolve colors/visual at render; xychart applies
   frontmatter as post-parse middleware like gantt). (Addresses I4.)
6. Split the certificate type to reflect reality, or produce family certs in the core layout path.
   (Addresses I6.)

---

## 5. Reconciliation with existing design docs

This audit was derived from source, but several existing docs already describe parts of this
architecture. Cross-checked against them, the findings **agree**; three earn an honest refinement.

| Existing doc | Relates to | Verdict |
|---|---|---|
| [`AGENT_NATIVE.md`](../../../AGENT_NATIVE.md) | I3, I6, I7 | Agrees; refines I3 and I7 (below). The agent-stack design rationale. |
| [`contributing/diagram-family-citizenship.md`](../../contributing/diagram-family-citizenship.md) | I1, I8 | Agrees; the family×surface drift is **already CI-guarded** (below). |
| [`design/source-preservation-ladder.md`](./source-preservation-ladder.md) | I7 | Agrees; formalizes the structured\|opaque model as levels L0–L4. |

**I1 refinement — the drift was already test-guarded.** `diagram-family-citizenship.md` (issue #41)
defines a family×surface matrix whose `detectionParse` row requires that "shared detector, agent parse,
SVG render, ASCII render, CLI, and MCP paths route consistently" (state's flowchart-renderer split is the
one documented exception), enforced by `diagram-family-citizenship.test.ts`. So the risk I1 names — three
dispatch sites that "cannot drift-check each other" — was already mitigated by an external CI ratchet.
The issue #71 implementation made that drift-check structural by routing SVG and ASCII through
`FamilyPlugin` hooks.

**I3 refinement — `RenderedLayout` is the deliberate canonical artifact.** `AGENT_NATIVE.md` §1 establishes
that the **layout JSON (`RenderedLayout`) is THE canonical artifact, not the SVG** ("two render results are
equal iff their layout JSON is structurally equal") — it is the determinism/equality oracle pinned by the
cross-process and drift-sentinel tests. It is therefore not redundant debt: `PositionedGraph` is the
SVG-specific geometry, `RenderedLayout` is the surface-neutral equality contract. The fix is to make the
`PositionedGraph → RenderedLayout` lowering explicit (one derives from the other), **not** to pick a winner.

**I7 refinement — the re-parse seam is documented and round-trip-tested.** `AGENT_NATIVE.md` §3 makes
`canonicalSource` "the round-trip pillar" and states "structured renderers use this as input" — so the
agent-layout re-parse I flagged is a *documented* design choice, guarded by the round-trip identity
properties (`serializeMermaid(parseMermaid(s)) ≡ normalize(s)` and `parseMermaid(serializeMermaid(d)) ≡ d`,
property-tested). The coupling is **tested, not hidden**; laying out the structured body directly is a
decoupling/perf option (lower-urgency than first stated) that applies only to **L3/L4** structured bodies
(per the source-preservation ladder) — for **L1** opaque bodies, text *is* the representation and
re-parsing is correct by design. Likewise I7 seam (a): the **public** mutation surface is strongly typed
(per-family `mutate` overloads + branded `as*` narrowers with compile-time rejection of opaque bodies,
`AGENT_NATIVE.md` §3); the duck-typed narrowing is an internal implementation detail, not the public contract.
