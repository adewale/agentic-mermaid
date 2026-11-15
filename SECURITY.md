# Security posture

Agentic Mermaid renders diagrams that may be **agent-generated from
untrusted input** (e.g. an LLM following a prompt that itself contains
injected instructions). This document states what the renderer guarantees,
what it does not, and how to render safely in an untrusted context.

## The threat model

The relevant threats for agent-generated diagrams (mapped to upstream
Mermaid issues #7645 external-image exfiltration and #7695 CSP/Trusted
Types):

1. **External-fetch exfiltration.** A rendered SVG that references an
   external URL (font `@import`, `<image href>`, `url(http…)`) causes the
   *viewer's* browser to make a network request when the SVG is displayed.
   With prompt-injected content, that request can carry data out, or simply
   beacon that a diagram was viewed. This is the #7645 vector.
2. **Active content.** `<script>` / `<foreignObject>` inside an SVG can run
   in some rendering contexts.
3. **CSP / Trusted Types incompatibility (#7695).** Output that requires
   inline event handlers or `eval`-like constructs can't run under a strict
   Content-Security-Policy.
4. **Compute exhaustion.** Layout cost depends on a diagram's shape, not its
   byte size. Small, valid, densely connected source can hold a renderer for
   minutes (see [time bounds](#time-bounds)).

## What we guarantee

### Strict mode — `renderMermaidSVG(src, { security: 'strict' })` / `am render --security strict`

In strict mode the SVG output contains **zero external-fetch references**:

- No Google Fonts `@import` is emitted, even if the caller passes
  `embedFontImport: true` (that opt-in import is the only external-fetch
  vector our output otherwise emits). The font family is still declared via
  the `--font` CSS variable, so a host that *does* have the font shows it;
  otherwise the browser falls back to `system-ui, sans-serif`.
- We emit no `<image>`, no `<script>`, no `<foreignObject>`, no external
  `href`/`src`/`url(http…)`/`url(//…)`.

Assert the guarantee with `verifyNoExternalRefs(svg)`, which returns
`{ ok, refs[] }`. It excludes the `xmlns="http://www.w3.org/2000/svg"`
namespace declaration (that is a declaration, not a fetch). Use it as a CI
gate or an agent self-check after rendering.

### Always-on (every mode)

- **No click/href injection.** Mermaid `click A "https://…"` interaction
  directives do not emit clickable external links into our SVG.
- **No arbitrary `<image>`.** We do not render image-shaped nodes that load
  external bitmaps.
- **Deterministic renderer, no ambient network or code execution.** SVG/ASCII
  rendering is pure-functional TypeScript with no DOM, no `eval`, no network,
  and no user-controlled filesystem access. PNG rendering may read bundled
  font assets from the package before offline rasterization. Local Code Mode
  snippets run in a `node:vm` context where `process`, `require`,
  `fetch`, `eval`, `Function`, and host-constructor escape paths are tested
  absent and dynamic code generation is disabled. Hosted `execute` at
  `agentic-mermaid.dev/mcp` does not use `node:vm`: each snippet runs in a
  Cloudflare Dynamic Worker isolate with no network (`globalOutbound: null`),
  an empty env, and a CPU budget.
- **HTTP/SSE MCP defaults are local-first.** `agentic-mermaid-mcp --transport
  http` binds to `127.0.0.1` by default. Non-loopback binding requires
  `--auth-token`; `/rpc` and `/message` require `content-type:
  application/json`; cross-origin browser posts are rejected; request bodies,
  artifact bytes, and sandbox timeouts are capped.

### Graph work budgets

Graph parsing bounds expanded edges and nodes at 5,000 each. Cartesian edge
statements such as `A & B --> C & D` are checked before allocating their
expanded edges. Graph layout also counts container nodes and rejects nesting
deeper than 64 levels before recursive conversion or ELK execution. These host
budgets apply in every security mode; diagram configuration cannot raise them.
Exceeding a budget throws `DIAGRAM_WORK_LIMIT` without drawing a partial graph.
ASCII and Unicode drawing also stops at its own cell-composition ceilings with
`TERMINAL_WORK_LIMIT` ([terminal output](./docs/ascii.md)).

These budgets bound a diagram's **size, not its running time**. Layout runs
synchronously and its cost follows the graph's shape. Measured on the 0.6.0
development branch (one x86-64 core), all well inside the budgets:

| Source | Bytes | In-process render |
|---|---:|---:|
| `a0 & … & a29 --> b0 & … & b29` | 352 | ~7 s |
| the same with 50 × 50 nodes | 592 | ~74 s |
| complete DAG on 30 nodes (435 edges) | 4,942 | ~72 s |
| 150-node chain plus 150 long links | 3,761 | ~24 s |
| `stateDiagram` 30 × 30 transitions | 10,215 | ~43 s |

### Time bounds

A synchronous render cannot be interrupted in its own thread. Each surface
that accepts source from someone else therefore runs layout where it can stop
it, and a deadline only aborts: it never changes the geometry of a render that
finishes.

| Surface | Bound | On expiry |
|---|---|---|
| Library `renderMermaid*`, `verifyMermaid`, `layoutMermaid*` | none in-process | Run them in a worker you terminate ([Node and Bun](./docs/api.md#untrusted-input-and-deadlines), [browser](./docs/browser.md#untrusted-input-in-a-worker)). |
| `am render`, `verify`, `mutate`, `describe`, `preview`, `render-markdown` | 120 s wall clock by default (`--timeout <s>`; `0` = none) in a child process | Exit 124, `RENDER_TIMEOUT`. `--watch` and `batch` take no deadline. |
| Local MCP tools that lay out (`render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, `build`) | 15 s wall clock per call, including queue and start-up, in a supervised subprocess; 32 queued calls; sampled 512 MiB RSS | `RENDER_TIMEOUT`; the subprocess is terminated. |
| Local MCP `execute` | 5 s default, capped by `--max-sandbox-timeout-ms` (30 s) | `EXECUTE_TIMEOUT` |
| Hosted MCP tools that lay out | Heavy diagrams (by pre-layout cost estimate): 10 s CPU per call in a Dynamic Worker. Others: inline, within the Worker's 30 s per-request CPU limit. One request's calls share 30 s | `RENDER_TIMEOUT` |
| Hosted MCP `execute` | `timeoutMs` CPU in a Dynamic Worker (default 5 s, max 30 s) | `EXECUTE_TIMEOUT` |
| Browser editor on agentic-mermaid.dev | 30 s, Worker terminated | render error |

## What we do NOT guarantee

- **Library calls do not bound time.** `security: 'strict'` constrains what
  the output may reference, not how long producing it takes, and the work
  budgets bound size only. A service rendering untrusted source in-process can
  be held for minutes by one request; use a terminable worker or child process
  with a deadline, as below.
- **`node:vm` is not an OS/container security boundary.** Code Mode containment
  is for local MCP use and accidental/agentic misuse reduction. Do not expose
  `execute(code)` to arbitrary hostile users without process/container
  isolation and normal resource controls. HTTP/SSE transport improves
  reachability for trusted clients; it is not a hosted multi-tenant sandbox.
- **Default mode does not enforce the no-external-refs guarantee.** It omits
  the Google Fonts `@import` unless the caller opts in with
  `embedFontImport: true` (back-compat for pages that expect the Inter
  webfont), and it does not reject a render that carries an external
  reference. **For agent/untrusted SVG contexts, use strict mode.** MCP
  `render_png` is already offline (the PNG rasterizer has no network). SVG via
  local Code Mode `execute()` lets the agent pass `security: 'strict'`; hosted
  `render_svg` and hosted `execute` force it. ASCII output has no
  external-reference surface.
- **We do not sanitize arbitrary third-party SVG.** `verifyNoExternalRefs`
  is a scanner for *our* output shape, not a general SVG sanitizer. Don't
  feed it untrusted SVG and treat a pass as safe.
- **Trusted Types (#7695):** strict-mode output is exercised in Chromium under
  a CSP with `require-trusted-types-for 'script'`. A raw `innerHTML` string
  assignment is blocked, then the same SVG is inserted through a named
  TrustedHTML policy with no external requests and no active SVG tags.

## Recommended posture for agent runtimes

```ts
import { renderMermaidSVG, verifyNoExternalRefs } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(untrustedSource, { security: 'strict' })
const check = verifyNoExternalRefs(svg)
if (!check.ok) throw new Error(`external refs leaked: ${check.refs.join(', ')}`)
// safe to display
```

That call still runs for as long as layout takes. When the source is untrusted
and a slow render would hold a request, an agent turn or a server, run it in a
worker thread (or child process) and terminate that at a deadline:

```js
const worker = new Worker(new URL('./render-worker.mjs', import.meta.url), { workerData: { source } })
const timer = setTimeout(() => worker.terminate(), 10_000) // stops layout mid-run
worker.once('message', result => { clearTimeout(timer); worker.terminate(); /* use result.svg */ })
```

[Untrusted input and deadlines](./docs/api.md#untrusted-input-and-deadlines)
gives the complete worker and error handling. From an agent, prefer the CLI or
an MCP server, which apply deadlines already.

For raster output, `renderMermaidPNG` is offline by construction (no network
during rasterization, bundled fonts).

For MCP HTTP/SSE, prefer loopback. If you must bind a non-loopback host, set a
high-entropy `--auth-token`, keep `--artifact-dir` private, choose conservative
`--max-artifact-bytes`, `--max-rpc-body-bytes`, `--artifact-ttl-ms`, and
`--max-sandbox-timeout-ms`, and put the process behind your normal network and
process isolation controls.
