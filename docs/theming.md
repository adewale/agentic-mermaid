# Theming

Agentic Mermaid themes start from a two-color contract (`bg`, `fg`) and can be enriched with optional semantic slots. This keeps diagrams usable in live editors, documentation pages, and agent-generated artifacts without requiring a large design-token object.

> **Themes are styles.** Every built-in theme also registers as a
> palette-only *style*, so its name works anywhere a style is accepted and
> composes with full looks by stacking: `{ style: ['hand-drawn', 'dracula'] }`
> renders hand-drawn geometry with the Dracula palette. See
> [docs/style-authoring.md](./style-authoring.md) for the full model.

## Two-color foundation

```ts
import { renderMermaidSVG } from 'agentic-mermaid'

const svg = renderMermaidSVG(source, {
  bg: '#0B1020',
  fg: '#E5E7EB',
})
```

From those colors the renderer derives contrast-aware node fills, labels, edges, and accents. This is the safest default for agents: pick readable foreground/background colors and let the renderer complete the palette.

## Enriched mode

Use extra slots when your product already has semantic tokens:

```ts
const svg = renderMermaidSVG(source, {
  bg: 'var(--canvas)',
  fg: 'var(--text)',
  line: 'var(--line)',
  accent: 'var(--accent)',
  muted: 'var(--muted)',
  surface: 'var(--surface)',
  border: 'var(--border)',
})
```

Slots:

| Slot | Meaning |
|---|---|
| `bg` | SVG canvas/background. |
| `fg` | Primary text. |
| `line` | Connectors and strokes. |
| `accent` | Arrowheads and emphasis. |
| `muted` | Secondary labels. |
| `surface` | Node/card fill. |
| `border` | Node/card border. |

## CSS custom properties

CSS variables are first-class values:

```ts
const svg = renderMermaidSVG(source, {
  bg: 'var(--diagram-bg)',
  fg: 'var(--diagram-fg)',
  accent: 'var(--diagram-accent)',
  embedFontImport: false,
})
```

Because the generated SVG references variables directly, host pages can switch light/dark themes without re-rendering the diagram.

## Built-in themes

Agentic Mermaid ships **21 built-in themes**:

- `paper`
- `dusk`
- `zinc-light`
- `zinc-dark`
- `tokyo-night`
- `tokyo-night-storm`
- `tokyo-night-light`
- `catppuccin-mocha`
- `catppuccin-latte`
- `nord`
- `nord-light`
- `dracula`
- `github-light`
- `github-dark`
- `solarized-light`
- `solarized-dark`
- `one-dark`
- `salmon`
- `salmon-dark`
- `tufte`
- `tufte-dark`

```ts
import { THEMES, renderMermaidSVG } from 'agentic-mermaid'

const svg = renderMermaidSVG(source, THEMES['tokyo-night'])
```

## Custom themes

```ts
import type { DiagramColors } from 'agentic-mermaid'

export const myTheme: DiagramColors = {
  bg: '#111827',
  fg: '#F9FAFB',
  line: '#64748B',
  accent: '#38BDF8',
  muted: '#94A3B8',
  surface: '#1F2937',
  border: '#334155',
}
```

Then pass it to any renderer:

```ts
renderMermaidSVG(source, myTheme)
```

## Shiki compatibility

Turn a Shiki or VS Code theme into a diagram palette:

```ts
import { fromShikiTheme, renderMermaidSVG } from 'agentic-mermaid'
import githubDark from 'shiki/themes/github-dark.mjs'

const colors = fromShikiTheme(githubDark)
const svg = renderMermaidSVG(source, colors)
```

`fromShikiTheme(theme)` reads the editor background/foreground and token colors, then maps them to Agentic Mermaid's semantic slots.

## Style + Palette stacks

Use `style` for renderer treatment and palettes, not Mermaid source edits:

```ts
const svg = renderMermaidSVG(source, {
  style: ['publication-figure', 'zinc-light'],
  seed: 2,
})
```

For per-element emphasis, keep using Mermaid-native directives such as `classDef`, `class`, `style`, and `linkStyle`. See [`api.md`](./api.md) for the full `RenderOptions` table.

## Security and fonts

Default SVG output includes a Google Fonts `@import` for convenience. For offline, strict, or agent-generated artifacts, use either:

```ts
renderMermaidSVG(source, { embedFontImport: false })
```

or strict mode:

```ts
renderMermaidSVG(source, { security: 'strict' })
```

`security: 'strict'` disables external-fetch references and is the recommended default for untrusted diagrams.
