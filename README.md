<div align="center">

# Agentic Mermaid

Agentic Mermaid is an open-source Mermaid rendering and editing toolkit, forked from [`lukilabs/beautiful-mermaid`](https://github.com/lukilabs/beautiful-mermaid), for producing deterministic **SVG, PNG, ASCII, Unicode, and JSON layout** outputs plus agent-verifiable structured edits.

Published as `agentic-mermaid`; the GitHub repository and Pages path currently remain `adewale/beautiful-mermaid` / `https://adewale.github.io/beautiful-mermaid/`.

![Agentic Mermaid: Mermaid source plus typed edit ops on the left, the verified SVG render in the middle, and the same diagram as ASCII on the right](assets/hero.png)

[Live Demo & Samples](https://adewale.github.io/beautiful-mermaid/) · [Live Editor](https://adewale.github.io/beautiful-mermaid/editor)

Docs: [docs index](./docs/) · [getting started](./docs/getting-started.md) · [agent guide](./Instructions_for_agents.md) · [agent API cookbook](./docs/agent-api-cookbook.md) · [skills](./skills/) · [fork differences](./docs/fork-differences.md) · [vs Mermaid & Beautiful Mermaid](./docs/comparison.md) · [changelog](./CHANGELOG.md)

</div>

## Why Agentic Mermaid

Most Mermaid tools render strings. Agentic Mermaid gives coding agents a safer workflow:

| Task | Safe path |
|---|---|
| Create a new diagram | Write Mermaid source → `parseMermaid` → `verifyMermaid` → render/preview |
| Edit an existing supported diagram | `parseMermaid` → family narrower → `mutate` → `verifyMermaid` → `serializeMermaid` |
| Handle opaque fallback bodies | Preserve source, edit deliberately, then parse/verify/render |
| Multi-step agent edits | Prefer MCP Code Mode or library imports so the loop happens in one structured execution |
| Shell-only checks | Use `am verify`, `am mutate --op/--ops`, `am preview`, or `am batch --jsonl` |

Agents should not guess from pixels, concatenate strings, or regenerate whole diagrams when a structured edit is available.

## Highlights

- **12 diagram families** — flowchart, state, architecture, sequence, class, ER, timeline, journey, XY chart, pie, quadrant, and Gantt.
- **SVG, PNG, ASCII, Unicode, JSON** — one deterministic layout foundation for page, terminal, and agent workflows.
- **Synchronous, zero-DOM SVG renderer** — no Puppeteer, no browser flash.
- **21 built-in themes + Shiki compatibility** — theme from two colors or a VS Code theme.
- **Agent-native editing** — typed mutation for all twelve renderable families (flowchart/state, sequence, timeline, class, ER, journey, architecture, XY chart, pie, quadrant, Gantt); source-level round-trip only for opaque fallbacks (unmodeled syntax).
- **CLI + MCP + library** — `am`, `agentic-mermaid-mcp`, `agentic-mermaid`, and `agentic-mermaid/agent`.

## Installation

```bash
npm install agentic-mermaid
# or
bun add agentic-mermaid
# or
pnpm add agentic-mermaid
```

CLI/MCP binaries installed from the package:

```bash
am --help
agentic-mermaid --help
agentic-mermaid-mcp
```

Published package bins are Node-runnable; `bin/*.ts` remains available for local Bun development.

## Output quick starts

Use `agentic-mermaid/agent` when you want all output formats and the structured edit API in one import path.

### SVG

```ts
import { renderMermaidSVG } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(`flowchart TD
  Start --> Done`, { security: 'strict' })
```

### PNG

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidPNG } from 'agentic-mermaid/agent'

const png = renderMermaidPNG(`flowchart TD
  Start --> Done`, {
  fitTo: { width: 1200 },
  background: '#fff',
})

writeFileSync('diagram.png', png)
```

CLI equivalent:

```bash
am render diagram.mmd --format png --output diagram.png
```

### ASCII / Unicode

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII(`flowchart LR
  A --> B`)
const ascii = renderMermaidASCII(`flowchart LR
  A --> B`, { useAscii: true })
```

## Agent quick start

If your coding agent can read repo files, point it at:

- [`skills/agentic-mermaid-diagram-workflow/SKILL.md`](./skills/agentic-mermaid-diagram-workflow/SKILL.md) for diagram authoring/editing.
- [`skills/agentic-mermaid-live-editor/SKILL.md`](./skills/agentic-mermaid-live-editor/SKILL.md) for editor changes.

If it only has shell access:

```bash
am --agent-instructions
am capabilities --json
am preview diagram.mmd --security strict --open
am mutate diagram.mmd --op '{"kind":"add_node","id":"Cache","label":"Cache"}' --json
```

Zero-install prompt for a coding agent: read `https://adewale.github.io/beautiful-mermaid/llms.txt` and follow the parse → narrow → mutate → verify → serialize workflow. To wire Agentic Mermaid into another repo, run `npx agentic-mermaid init-agent`; it writes a non-clobbering `AGENTS.md` section, root `skills/` bundle, and `.mcp.json` sample.

Use strict `preview` for human inspection and `mutate --op/--ops` for verified one-shot or batched edits.

For multi-step MCP edits, connect `agentic-mermaid-mcp` and use Code Mode `execute(code)` with the same `mermaid.*` SDK names. Stdio is the default transport; `agentic-mermaid-mcp --transport http` starts HTTP/SSE and managed PNG file/URL artifacts. See the [agent API cookbook](./docs/agent-api-cookbook.md) for copy-pasteable library, CLI, and MCP recipes.

## Structured edit example

```ts
import { parseMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid/agent'

const parsed = parseMermaid('flowchart TD\n  API --> DB')
if (!parsed.ok) throw new Error('parse failed')

const flow = asFlowchart(parsed.value)
if (!flow) throw new Error(`not a structured flowchart: ${parsed.value.kind}`)

const next = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!next.ok) throw new Error(next.error.message)

const verify = verifyMermaid(next.value)
if (!verify.ok) throw new Error(JSON.stringify(verify.warnings, null, 2))

const source = serializeMermaid(next.value)
```

Rules:

- Use `asFlowchart` / `asState` / `asSequence` / `asTimeline` / `asClass` / `asEr` / `asJourney` / `asArchitecture` / `asXyChart` / `asPie` / `asQuadrant` / `asGantt` before mutating existing diagrams.
- Mutation ops use `kind`, not `type`.
- Run `verifyMermaid` before every commit point.
- Do not call `mutate` on opaque fallback bodies; the narrower returns `null` for unmodeled syntax.

## Supported diagram families

| Family | Parse | Verify | Render | Structured mutate |
|---|---:|---:|---:|---:|
| Flowchart / state | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| Sequence | ✓ | ✓ | SVG/PNG/ASCII | simple messages/participants |
| Timeline | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| Class | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| ER | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| Journey | ✓ | ✓ | SVG/PNG/ASCII | modeled subset (BUILD-15) |
| XY chart | ✓ | ✓ | SVG/PNG/ASCII | modeled subset (BUILD-16) |
| Pie | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| Quadrant | ✓ | ✓ | SVG/PNG/ASCII | ✓ |
| Architecture | ✓ | ✓ | SVG/PNG/ASCII | modeled subset (BUILD-17) |
| Gantt | ✓ | ✓ | SVG/PNG/ASCII | sections/tasks; calendar directives ride along verbatim |

See [diagram families](./docs/diagram-families.md) for examples and compatibility notes.

## More documentation

- [API reference](./docs/api.md) — renderers, agent API, options, CLI/MCP pointers.
- [Agent API cookbook](./docs/agent-api-cookbook.md) — practical recipes for agents.
- [Theming](./docs/theming.md) — two-color themes, built-ins, Shiki compatibility.
- [React integration](./docs/react.md) — zero-flash `useMemo` rendering.
- [ASCII output](./docs/ascii.md) — terminal output, color modes, XY charts.
- [Mermaid config](./docs/config.md) — frontmatter, init directives, runtime config.
- [Features](./docs/features.md), [quality](./docs/quality.md), [security](./SECURITY.md), [fork differences](./docs/fork-differences.md).
- [Adding diagram types](./docs/contributing/adding-diagram-types.md) for contributors.

## Live editor and examples

- [Sample gallery](https://adewale.github.io/beautiful-mermaid/) — supported families and role-style presets.
- [Live editor](https://adewale.github.io/beautiful-mermaid/editor) — SVG/PNG exports and URL sharing.
- [`examples/agent-loop.ts`](./examples/agent-loop.ts)
- [`examples/mcp-vs-cli-complex-diagrams.ts`](./examples/mcp-vs-cli-complex-diagrams.ts)
- [`examples/agent-improve-auth-flow.ts`](./examples/agent-improve-auth-flow.ts)

## Attribution

Agentic Mermaid is a fork of Beautiful Mermaid by [Luki Labs](https://github.com/lukilabs/beautiful-mermaid). The ASCII rendering engine is based on [`mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii) by Alexander Grooff and extended for Agentic Mermaid.

## License

MIT
