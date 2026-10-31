# Library API

Render artifacts, read painted geometry, or edit Mermaid source with typed operations.

```ts
import { renderMermaidSVG } from 'agentic-mermaid'

const source = 'flowchart LR\n  Idea --> Ship'
const svg = renderMermaidSVG(source, { style: ['hand-drawn', 'nord'] })
console.log(svg)
```

Choose the task, then use the matching surface:

| Task | Start here | Result |
|---|---|---|
| Render an artifact | [Rendering](#rendering) | SVG, PNG bytes, or terminal text |
| Draw or animate the artwork yourself | [Resolved paths and text](#resolved-paths-and-text) | JSON with painted paths, text, transforms and semantic parts |
| Change existing source | [Editing](#editing) | A typed edit, verification findings and serialized Mermaid |

Agents with a shell can use `am capabilities --json` and `am styles --json` to
discover installed support. In MCP, use `describe_sdk` for mutation fields and
`execute` for the documented Code Mode functions. Resolved scenes are available
from the library and Code Mode; use `describe_sdk` with
`{ "capability": "resolved-scene" }` for their types and runtime limits.

## Vocabulary

<!-- BEGIN GENERATED: diagram-terminology -->
A **family** is a Mermaid diagram type, such as Flowchart or Sequence. A **part** is an identified element of a Scene, such as a shape, connector, text or group. A **resolved primitive** is one painted path or text run; a part can contain many primitives. A **Scene primitive** is a unit of the pre-paint drawing contract, including document structure, shapes, text and markers. Source nodes, edges and other family-specific objects are distinct from drawing parts.
<!-- END GENERATED: diagram-terminology -->

<!-- BEGIN GENERATED: family-narrowing -->
Narrowing selects a structured, typed family with an as* helper. It does not select one element or freeze layout coordinates.
<!-- END GENERATED: family-narrowing -->

The API names stay specific to their layer:

| API name | Meaning |
|---|---|
| `ParsedDiagram.kind`, `DiagramKind` | The source family discriminator. Other `kind` fields discriminate operations, Scene parts or resolved primitives. |
| `SceneNode`, `ShapeMark`, `ConnectorMark`, `TextMark`, `GroupMark` | Existing type names for Scene parts. A Scene node is not necessarily a source node; **mark** in these names means part. |
| `ResolvedPart.node` | The semantic Scene part paired with its backend-painted `primitives`. |
| `ResolvedPrimitive` | `ResolvedPath` or `ResolvedText`, after backend painting. |
| `ScenePrimitive`, `Geometry` | Scene primitive capability names and geometry, before backend painting. These are not `ResolvedPrimitive`. |

A **marker** decorates a path or connector at its start, end or interior
vertices, such as an arrowhead; it is distinct from the older word *mark*.
Use source-facing IDs for source objects and Scene IDs for parts. One source
object can produce several parts, and one part can produce several painted
primitives. Resolved primitives have no independent stable IDs. Entries in
`part.primitives` are associated through that part and its source-facing
identity where available. Entries in `scene.frame` have no containing part
or independent stable IDs.
The resolved-scene API's separate `marker-mid` limitation still applies.

## Versions

<!-- BEGIN GENERATED: api-versions -->
This reference describes source version **0.5.5**. The latest release recorded in the [changelog](../CHANGELOG.md) is **0.5.5** (2026-10-31). [Read that version's reference](https://github.com/adewale/agentic-mermaid/blob/v0.5.5/docs/api.md). Changes under **Unreleased**, including new exports, are not part of that recorded release.
<!-- END GENERATED: api-versions -->

```bash
npm ls agentic-mermaid
npm view agentic-mermaid version
```

The first command shows the installed version; the second asks npm for its
current release. For released APIs, read documentation at the release's Git tag.
A source checkout and successful build do not establish publication.

## Imports and runtimes

| Import | Use it for | Runtime |
|---|---|---|
| `agentic-mermaid` | SVG, ASCII/Unicode, resolved scenes and styles | Node, Bun, browsers and Workers; no native PNG addon imported |
| `agentic-mermaid/agent/core` | Parsing, typed editing, verification, layout, SVG and terminal rendering | Node, Bun, browsers and Workers |
| `agentic-mermaid/agent` | The agent/core operations plus native PNG | Node or Bun |
| `agentic-mermaid/browser/lazy` | `renderMermaidSVGAsync` with families loaded on demand | Browser ESM |

Use `/agent/core` for runtime-neutral editing and `/agent` when you also need
native PNG. The synchronous browser bundle is `agentic-mermaid/browser`.
Host-injected browser PNG is covered in the [advanced reference](./api-advanced.md#trusted-host-selected-graphical-backends).

## Rendering

These functions accept source text or a `ParsedDiagram` returned by
`parseRegisteredMermaid`. Parsing first is optional for artifact-only tasks.
Rendering is synchronous except for explicit async and browser PNG helpers.

```typescript
renderMermaidSVG(input: ParsedDiagram | string, options?: RenderOptions): string
renderMermaidASCII(input: ParsedDiagram | string, options?: AsciiRenderOptions): string
renderMermaidPNG(input: ParsedDiagram | string, options?: PngOptions): Uint8Array
```

| Function | Return value | Notes |
|---|---|---|
| `renderMermaidSVG` | One SVG document string | `idPrefix` separates resource IDs when embedding several diagrams. |
| `renderMermaidASCII` | Terminal text | Unicode by default; `{ useAscii: true }` selects seven-bit ASCII. |
| `renderMermaidPNG` | PNG bytes | Import from `/agent`. Use `scale` or `fitTo` for size. |
| `renderMermaidSVGWithReceipt` | `{ svg, receipt }` | Adds request identity and diagnostics. |
| `renderMermaidASCIIWithMeta` | `{ ascii, regions, actions, warnings, routeParity }` | Import from `/agent/core` or `/agent` for element/cell mapping. |
| `renderMermaidWithActions` | Artifact and inert action regions | Import from `/agent` for SVG, PNG, ASCII or Unicode interaction metadata. |

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidPNG } from 'agentic-mermaid/agent'

const png = renderMermaidPNG('flowchart LR\n  Idea --> Ship', {
  fitTo: { width: 1200 }, background: '#ffffff',
})
writeFileSync('diagram.png', png)
```

Use the same render options for verification and rendering. A style can affect
layout and typography as well as paint. Changing `seed` rerolls styled ink
without changing the semantic layout.

### Graph layout selection

Omitting `graphLayout` retains the existing automatic policy, including the
guarded forest optimization. Force ELK with `graphLayout: { backend: 'elk' }`,
or opt into the owned producer:

```ts
import { renderMermaidSVGWithReceipt } from 'agentic-mermaid'

const source = 'flowchart LR; Idea --> Ship'
const { svg, receipt } = renderMermaidSVGWithReceipt(source, {
  graphLayout: { backend: 'agentic', fallback: 'elk' },
})
console.log(receipt.layoutDecisions)
```

Agentic currently supports measured Flowchart and State graphs, including directed
cycles, self-loops, shapes and edge labels, fan-in, parallel edges, disconnected
components and long links. Independent nested scopes retain frame endpoints,
headers and local directions, including State composites and concurrent regions. State pseudostates, configured fork/join dimensions and notes
use the shared family sizing and projection rules.
The shared geometry pipeline clips ports to each actual shape outline.
Bounded cross-hierarchy leaf and frame routes retain authored endpoints, and
empty frames retain measured headers. Class cards/namespaces, ER frames and
relations, Requirement cards, and Architecture compounds use the owned kernel
with their specialized family geometry. Architecture applies final authored
side constraints and routing after placement. Unsupported hints and constraints, overlapping
node/frame identities, and exhausted bounded searches still decline explicitly. ELK support remains available for every existing
ELK family. Omitting fallback makes an unsupported Agentic request throw
`GraphLayoutUnsupportedError`; requesting `fallback: 'elk'` records the actual
selection in `layoutDecisions` and emits a fallback diagnostic. An ELK fallback
is not an Agentic completion. Unexpected engine defects and global work limits
are not hidden by fallback.

<!-- BEGIN GENERATED: graph-layout-limits -->
| Scope | Limit |
| --- | --- |
| Host nodes, including group frames | 5,000 |
| Host edges | 5,000 |
| Agentic measured nodes, including group frames | 4,096 |
| Agentic internal edges | 16,384 |
| Agentic internal ranks | 4,096 |
| Agentic expanded workspace vertices | 32,768 |
<!-- END GENERATED: graph-layout-limits -->

Groups and self-loop helpers consume Agentic capacity. Separate expansion,
routing and certification allowances can refuse smaller diagrams. Exceeding
the Agentic ceiling raises `GraphLayoutUnsupportedError`; explicit ELK fallback
retains the host limits above. These limits cannot be raised by source config.

The async `agentic-mermaid/browser/lazy` entry downloads ELK only when the
selected layout actually needs it. A successful strict Agentic render does not
fetch ELK; requested fallback still loads it when native placement declines.
ELK selection likewise leaves the native solver unfetched. Backend payload
reports include the selected solver's dynamic dependencies.
The synchronous `agentic-mermaid/browser` entry remains an all-in-one bundle.

The CLI accepts `am render diagram.mmd --graph-layout agentic
--graph-layout-fallback elk`. Mermaid source configuration is preserved and is
not an alias for these options. Terminal-cell placement retains its family
rules; optional graphical companions and Architecture's pixel placement honor
the selector. See the [backend design](https://github.com/adewale/agentic-mermaid/blob/main/docs/design/system/layout-backends.md) for
qualification and comparative measurement.

## Resolved paths and text

Use this API when another renderer needs the artwork AM actually drew,
including sketch strokes, expanded markers and multiline text runs.

```typescript
renderResolvedScene(input: ParsedDiagram | string, options?: RenderOptions): ResolvedScene
```

```ts
import { renderResolvedScene } from 'agentic-mermaid'

const scene = renderResolvedScene('flowchart LR\n  Idea --> Ship', { style: 'hand-drawn' })
for (const part of scene.parts) {
  console.log(part.id, part.node.identity, part.primitives)
}
```

| `ResolvedScene` field | Meaning |
|---|---|
| `version` | `RESOLVED_SCENE_VERSION`, currently `2`. |
| `family` | Registered family ID of the input diagram: both `stateDiagram` and `stateDiagram-v2` report `state`, even though State shares Flowchart's internal Scene lowering. Extension IDs retain their `family:` namespace. |
| `width`, `height` | Final viewport dimensions in root SVG user units. |
| `svg` | Byte-identical to `renderMermaidSVG(input, options)` for the same request. |
| `colors` | Resolved diagram colors. |
| `parts` | Top-level non-document Scene parts in Scene order, each with `id`, `role`, `kind`, semantic `node` and painted resolved `primitives`. |
| `frame` | Painted leaves outside those parts, including style backdrops. |

Resolved primitives describe what the selected backend actually drew, including sketch
strokes. Shapes become local SVG path data; `matrix: [a,b,c,d,e,f]` maps local
coordinates to root user space. Paint, stroke widths, dashes and text sizes
are resolved in local units. Paint colors are lowercase six-digit hex or
`none`; color alpha is folded into fill/stroke opacity, while `opacity`
includes group opacity. Markers follow their decorated path with
`marker: true`. Multiline labels become separate text runs, retaining font,
anchor, baseline and text-length fitting.

Hidden artwork is omitted. Filters, clip paths, masks, marker-mid, paint
servers, unsupported elements and unresolved live palettes throw an error
naming the owning part (or `frame`). This API requires a family with Scene
lowering. It does not execute interactive/hover rules or fetch fonts.
`RESOLVED_SCENE_VERSION` changes for removals or semantic changes; additive
fields keep the version. See the changelog for contract changes.

`part.id` is a Scene part ID. `part.node.identity?.id` is source-facing identity
where provided; they can differ (`node:A` and `A`). Use typed endpoints and
ownership where available rather than parsing identifier spelling. Ownership
is not yet populated for every companion part.

The result is detached JSON. This function does not accept host text-measurement
profiles. Its [types](https://github.com/adewale/agentic-mermaid/blob/main/src/scene/resolved-types.ts) describe every primitive
field; the [changelog](../CHANGELOG.md) records availability. Default Sankey
gradients require a solid-color configuration under this version's paint-server
limitation.

### Agent discovery and failures

The discovery additions and Code Mode method in this section are included in
**0.5.5**. Check the installed `am capabilities --json`
`resolvedScene` field, then call `describe_sdk` with
`{ "capability": "resolved-scene" }` for painted primitive fields, error fields
and limits. The existing family mutation discovery remains unchanged.

Code Mode exposes the same synchronous `mermaid.renderResolvedScene` API.
Library calls are runtime-neutral and do not fetch resources. Code Mode's
default serialized result limit is 2 MiB; hosts may lower it. Return only needed
parts rather than the complete SVG and Scene. Filtering the return value does
not reduce the work of rendering the scene; existing host admission and CPU
limits still apply.

Unsupported artwork throws `ResolvedSceneError` with
`code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK'`, `partId`, `feature` and the existing
readable `message`. `feature` distinguishes cases such as `filter` and
`paint-server`. Missing Scene lowering or ownership uses
`RESOLVED_SCENE_UNAVAILABLE`. A failure returns no partial scene and does not
modify a previously returned artifact.

Pass this JavaScript body to Code Mode's `execute` tool to return selected
fields or a typed refusal:

```js
const source = 'flowchart LR; A-->B'
try {
  const scene = mermaid.renderResolvedScene(source)
  return { version: scene.version, parts: scene.parts.map(p => ({ id: p.id, primitives: p.primitives })) }
} catch (error) {
  return { ok: false, code: error.code, partId: error.partId, feature: error.feature, message: error.message }
}
```

Uncaught Code Mode failures retain the existing text error envelope. The on-demand
declarations augment the compact SDK declaration with typed parts and primitives. Discovery
keeps `part.node` opaque to bound its declaration size; library users can import
the complete `ResolvedScene` type. A Scene part ID such as `node:A` is distinct
from the authored node ID `A`.

### Checking diagrams in Markdown

```bash
am verify README.md --markdown --json
```

This opt-in mode runs the existing verifier on top-level Mermaid code fences and
returns `{ok,file,blocks}`. It checks all blocks even when one fails and uses
the normal verification exit status. Backtick and tilde fences of three or more
characters are supported, including longer fences around Markdown examples.
Non-Mermaid fenced examples and HTML blocks/comments are skipped as whole blocks.
Fences nested in lists or blockquotes require extraction by the host; this CLI
mode does not provide a full Markdown AST or whole-document coverage of them.

Each block reports its first physical source line. Warning lines are mapped to
the Markdown file; `lineIsBlockStart: true` explicitly marks the fallback when
no precise diagnostic location is available. CRLF files retain their physical
line numbering. An unclosed fence extends to EOF in static Markdown; streaming
hosts should decide when input is complete before invoking verification.
`render-markdown` still continues past invalid diagrams; verification is the
mode that fails for invalid blocks. No Markdown plugin is required.

## Editing

For new diagrams, author source, parse, verify, then render or return it. For
existing structured diagrams, parse, select the typed family, mutate, verify,
then serialize.

```ts
import {
  parseRegisteredMermaid, asFlowchart, mutate,
  verifyMermaid, serializeMermaid,
} from 'agentic-mermaid/agent/core'

const parsed = parseRegisteredMermaid('flowchart LR\n  API --> DB')
if (!parsed.ok) throw new Error(parsed.error.map(error => error.message).join('\n'))
const flow = asFlowchart(parsed.value)
if (!flow) throw new Error('Expected a structured flowchart')
const changed = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!changed.ok) throw new Error(changed.error.message)
const verified = verifyMermaid(changed.value)
if (!verified.ok) throw new Error(JSON.stringify(verified.warnings))
console.log(serializeMermaid(changed.value))
```

The family narrower `asFlowchart` returns the structured flowchart or `null`.
As defined in the [vocabulary](#vocabulary), narrowing selects the typed family;
a structural edit can recompute layout.

```typescript
parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>
mutate(diagram: ParsedDiagram, operation: AnyMutationOp): Result<ParsedDiagram, MutationError>
verifyMermaid(input: ParsedDiagram | string, options?: VerifyOptions): VerifyResult
serializeMermaid(diagram: ParsedDiagram, options?: SerializeOptions): string
```

| Function | Result and use |
|---|---|
| `parseRegisteredMermaid` | `{ ok: true, value }` or `{ ok: false, error: ParseError[] }`. Preserving unsupported source does not grant typed edit support. |
| Family narrower, such as `asFlowchart` | The typed family value or `null`. Discover names with `am capabilities --json`. |
| `describeOps(family)`, `opSignatures(family)` | Exact mutation fields or a compact menu. Look up unfamiliar operations instead of guessing. |
| `mutate` | A changed diagram or structured mutation error. The operation's `kind` selects its fields. |
| `verifyMermaid` | `ok`, `warnings`, layout and check evidence. Inspect severity and verification scope. |
| `serializeMermaid` | Mermaid source. **Does not run verification.** The caller must inspect verification before saving, sending or showing an edit. |
| `describeMermaidFacts`, `checkMermaid` | Semantic read-back and required/forbidden-fact checks for task-critical meaning. |
| `analyzeMermaid` | Non-rendering feedback-edge, action and available Gantt scheduling analysis. |
| `layoutMermaid`, `layoutMermaidWithReceipt` | Positioned boxes, routes, labels and optional regions. The latter accepts source too and includes a receipt. This is layout geometry, not backend-painted artwork. |
| `buildMermaid`, `createMermaid` | Programmatic authoring from typed operations; ordinary new diagrams can start directly as source. |

Opaque bodies preserve source but have no structured mutation. Report the
unsupported operation, or deliberately edit source and re-parse when requested.
See the [agent cookbook](./agent-api-cookbook.md) for batch edits and rollback.

## Render options

SVG, PNG, terminal text, layout and resolved scenes share `RenderOptions`;
applicability depends on output and family. See [style authoring](./style-authoring.md)
for precedence and custom looks. This table is generated from runtime descriptors:

<!-- BEGIN GENERATED: render-options -->
| Option | Type | Default | Meaning and applicability |
|---|---|---|---|
| `layoutHints` | `{ ranks?: Record<string, number>; adjacent?: string[][]; shortEdges?: string[] }` | unset | Relative ranks, sibling adjacency and short-edge preferences. Built-in families: flowchart, state. Not consumed by terminal output. |
| `graphLayout` | `{ backend: 'elk' \| 'agentic'; fallback?: 'none' \| 'elk' }` | `elk`, no fallback | Graph geometry producer and explicit Agentic fallback policy. Built-in families: flowchart, state, architecture, class, er, requirement. |
| `layoutSafety` | `'report' \| 'strict'` | `report` | Report bounded layout evidence, or require a passed final certificate. Strict mode rejects missing or unverified evidence. |
| `bg` | `string` | `#FFFFFF` | Background color or CSS variable. |
| `fg` | `string` | `#27272A` | Primary foreground and text color. |
| `line` | `string` | derived | Connector and secondary-line color. |
| `accent` | `string` | derived | Arrowhead, highlight, and data accent color. |
| `muted` | `string` | derived | Secondary text and label color. |
| `surface` | `string` | derived | Node and group surface color. |
| `border` | `string` | derived | Node and group border color. |
| `font` | `string` | `Inter` | CSS font family or stack. |
| `style` | `StyleInput \| StyleInput[]` | `crisp` | Registered Style/Palette name, inline StyleSpec, or left-to-right stack. |
| `padding` | `number` | `40` | Canvas padding in SVG user units. Built-in families: flowchart, state, architecture, c4. Not consumed by terminal output. |
| `nodeSpacing` | `number` | `24` | Horizontal spacing between sibling nodes. Built-in families: flowchart, state, class, er, architecture, c4. Not consumed by terminal output. |
| `layerSpacing` | `number` | `40` | Vertical spacing between graph layers. Built-in families: flowchart, state, class, er, architecture, c4. Not consumed by terminal output. |
| `wrappingWidth` | `number` | unset | Flowchart measured-label wrapping budget in pixels. Built-in families: flowchart. Not consumed by terminal output. |
| `componentSpacing` | `number` | extension-defined | Spacing between disconnected graph components for compatible extension families; no built-in family currently consumes it. Built-in families: none; extension-defined. Not consumed by terminal output. |
| `transparent` | `boolean` | `false` | Omit the painted SVG canvas background. |
| `interactive` | `boolean` | `false` | Enable hover tooltips for supported chart data points. Built-in families: xychart, pie, quadrant. |
| `shadow` | `boolean` | `false` | Paint explicit drop shadows on node shapes. Built-in families: flowchart, state, sequence, timeline, class, er, journey, xychart, pie, quadrant, gantt, mindmap, gitgraph, sankey. |
| `class` | `{ hierarchicalNamespaces?: boolean }` | `hierarchicalNamespaces: true` | Class-diagram rendering controls. Built-in families: class. Not consumed by terminal output. |
| `kanban` | `{ maxWidth?: number }` | `maxWidth`: unset | Opt-in Kanban column wrapping with readable column widths. Built-in families: kanban. Not consumed by terminal output. |
| `pie` | `{ maxWidth?: number }` | `maxWidth`: unset | Opt-in Pie title and legend fitting without shrinking typography. Built-in families: pie. Not consumed by terminal output. |
| `radar` | `{ maxWidth?: number }` | `maxWidth`: unset | Opt-in Radar plot and legend fitting without shrinking typography. Built-in families: radar. Not consumed by terminal output. |
| `architecture` | `{ visual?: ArchitectureVisualOverrides }` | built-in metrics | Sparse architecture renderer visual metric and paint overrides. Built-in families: architecture. Not consumed by terminal output. |
| `timeline` | `{ maxWidth?: number }` | `maxWidth`: unset | Timeline layout controls. Built-in families: timeline. Not consumed by terminal output. |
| `journey` | `{ experienceCurve?: boolean }` | `experienceCurve: true` | User-journey graphical controls. Built-in families: journey. Not consumed by terminal output. |
| `gantt` | `{ dependencyArrows?: boolean; criticalPath?: boolean }` | both `false` | Gantt dependency and critical-path overlays. Built-in families: gantt. Not consumed by terminal output. |
| `mermaidConfig` | `MermaidRuntimeConfig` | source config | Mermaid-style recursive runtime configuration. |
| `embedFontImport` | `boolean` | `false` | Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization. Not consumed by terminal output. |
| `compact` | `boolean` | `false` | Compact SVG serialization while preserving agent hooks. Not consumed by terminal output. |
| `idPrefix` | `string` | unset | Non-empty namespace for generated SVG definition IDs and local references. Not consumed by terminal output. |
| `security` | `'default' \| 'strict'` | `default` | Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes. Not consumed by terminal output. |
| `ganttToday` | `string` | unset | Explicit deterministic date for the Gantt today marker. Built-in families: gantt. |
| `seed` | `number` | `0` | Deterministic re-roll seed for stochastic Styles. Not consumed by terminal output. |
<!-- END GENERATED: render-options -->

Inapplicable family-scoped fields produce `RENDER_OPTION_NOT_APPLICABLE` in a
receipt. `onConfigDiagnostic` is a library callback outside serializable options.
For untrusted JSON, use `validateSerializableRenderOptions` or the
[render-options JSON Schema](https://agentic-mermaid.dev/schemas/render-options.schema.json).
Terminal-only controls are in the [ASCII reference](./ascii.md).

### PNG options

| Option | Type | Default | Availability and meaning |
|---|---|---:|---|
| `scale` | `number` | `2` | Portable: native/browser library, CLI, and local/hosted MCP. Zoom multiplier when `fitTo` is not set. |
| `background` | `string` | artifact background, then white | Portable on the same surfaces. Safe explicit PNG background color. |
| `fitTo` | `{ width?: number; height?: number }` | — | Portable on the same surfaces. Constrain output to exactly one positive width or height. |
| `minLabelPx` | `number` | `9` | Portable on the same surfaces. Warn with `BELOW_READABLE_SIZE` when rasterization puts the smallest measurable label below this effective-pixel floor; `0` disables the gate. The default is provisional product policy for general-purpose screen diagrams, not a universal readability or accessibility threshold. |
| `fontDirs` | `string[]` | — | Trusted native-host input: Node/Bun library, CLI, and local MCP only. Extra font directories for unbundled families and scripts the bundled fonts do not cover. CLI: `--font-dirs <dirs>` (comma-separated). |
| `loadSystemFonts` | `boolean` | `false` | Trusted native-host input on the same native surfaces. Trades cross-machine determinism for glyph coverage. CLI: `--system-fonts`. |
| `onWarning` | `(w: PngRasterWarning) => void` | stderr | Native library callback only. Receives `PNG_FONT_COVERAGE` and `BELOW_READABLE_SIZE` warnings; callbacks never enter serializable requests or receipts. |

SVG font declarations do not load fonts. See [custom fonts](./custom-fonts.md)
and [rasterization details](./api-advanced.md#png-fonts-portability-and-rasterization).

## Errors and recovery

| Operation | Failure shape | Recovery |
|---|---|---|
| Parse | `{ ok: false, error: ParseError[] }` | Inspect every error's message and available source position. |
| Mutate | `{ ok: false, error }` | Use the code/message and operation schema; preserve the previous value. |
| Verify | `ok: false` with structured warnings | Inspect code, severity, origin and available evidence. |
| Render | Throws | Catch at the artifact boundary. Family/capability failures have exported error types; other failures can be ordinary `Error`. |
| Resolve artwork | Throws, naming the part and unsupported feature | Report the unsupported artwork or choose a supported representation. These errors currently have no dedicated stable code. |

```ts
import { parseRegisteredMermaid } from 'agentic-mermaid/agent/core'

const result = parseRegisteredMermaid('flowchart LR\n  Idea --> Ship')
if (result.ok) {
  console.log(result.value.kind)
} else {
  console.error(result.error.map(error => error.message).join('\n'))
}
```

`verify.ok` means no unsuppressed error was detected by the checks performed.
It does not establish visual perfection, complete semantic correctness or
portable, lossless canonical export. Check task-specific facts and review the
artifact when appearance matters. See [verification scope](./agent-mutation-policy.md).

## Advanced use

Use the [advanced reference](./api-advanced.md) for receipts, host-selected
backends, custom text metrics, parser observation, detailed source-preservation
examples and extension contracts. Use the [CLI](https://agentic-mermaid.dev/docs/cli/),
[MCP](./mcp-http-transport.md) or [agent cookbook](./agent-api-cookbook.md) for those
channels. You do not need those protocols to render or edit with the library.
