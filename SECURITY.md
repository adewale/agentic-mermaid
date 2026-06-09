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

## What we guarantee

### Strict mode — `renderMermaidSVG(src, { security: 'strict' })` / `am render --security strict`

In strict mode the SVG output contains **zero external-fetch references**:

- The Google Fonts `@import` is removed (the only external-fetch vector our
  output otherwise emits). The font family is still declared via the `--font`
  CSS variable, so a host that *does* have the font shows it; otherwise the
  browser falls back to `system-ui, sans-serif`.
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
  font assets from the package before offline rasterization. Code Mode snippets
  run in a `node:vm` context where `process`, `require`,
  `fetch`, `eval`, `Function`, and host-constructor escape paths are tested
  absent and dynamic code generation is disabled.

## What we do NOT guarantee

- **`node:vm` is not an OS/container security boundary.** Code Mode containment
  is for local MCP use and accidental/agentic misuse reduction. Do not expose
  `execute(code)` to arbitrary hostile users without process/container
  isolation and normal resource controls.
- **Default mode emits the Google Fonts `@import`.** This is back-compat
  behavior for existing consumers who render SVGs into pages that expect the
  Inter webfont. **For agent/untrusted SVG contexts, use strict mode.** MCP
  `render_png` is already offline (the PNG rasterizer has no network). SVG via
  Code Mode `execute()` lets the agent pass `security: 'strict'`; ASCII output
  has no external-reference surface.
- **We do not sanitize arbitrary third-party SVG.** `verifyNoExternalRefs`
  is a scanner for *our* output shape, not a general SVG sanitizer. Don't
  feed it untrusted SVG and treat a pass as safe.
- **Trusted Types (#7695):** strict-mode output is exercised in Chromium under
  a CSP with `require-trusted-types-for 'script'`. A raw `innerHTML` string
  assignment is blocked, then the same SVG is inserted through a named
  TrustedHTML policy with no external requests and no active SVG tags.

## Recommended posture for agent runtimes

```ts
import { renderMermaidSVG, verifyNoExternalRefs } from 'beautiful-mermaid/agent'

const svg = renderMermaidSVG(untrustedSource, { security: 'strict' })
const check = verifyNoExternalRefs(svg)
if (!check.ok) throw new Error(`external refs leaked: ${check.refs.join(', ')}`)
// safe to display
```

For raster output, `renderMermaidPNG` is offline by construction (no network
during rasterization, bundled fonts).
