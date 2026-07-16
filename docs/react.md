# React integration

Agentic Mermaid renders synchronously to SVG strings, so React apps do not need iframe renderers, hidden browser sessions, or client-side Mermaid hydration.

## Basic component

```tsx
import { useMemo } from 'react'
import { renderMermaidSVG } from 'agentic-mermaid'

export function MermaidDiagram({ source }: { source: string }) {
  const svg = useMemo(
    () => renderMermaidSVG(source, { security: 'strict' }),
    [source],
  )

  return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
```

`security: 'strict'` removes external-fetch references and is the safest default for user- or agent-generated diagrams.

## Theme from CSS variables

```tsx
const svg = renderMermaidSVG(source, {
  bg: 'var(--diagram-bg)',
  fg: 'var(--diagram-fg)',
  accent: 'var(--diagram-accent)',
  surface: 'var(--diagram-surface)',
  border: 'var(--diagram-border)',
  embedFontImport: false,
})
```

```css
.diagram-surface {
  --diagram-bg: #ffffff;
  --diagram-fg: #18181b;
  --diagram-accent: #2563eb;
  --diagram-surface: #f8fafc;
  --diagram-border: #cbd5e1;
}

.dark .diagram-surface {
  --diagram-bg: #0f172a;
  --diagram-fg: #f8fafc;
  --diagram-accent: #38bdf8;
  --diagram-surface: #1e293b;
  --diagram-border: #334155;
}
```

Because the SVG keeps CSS variables in place, toggling `.dark` updates existing diagrams without re-rendering.

## PNG export button

PNG rendering returns bytes. In browser-oriented React apps, call the PNG helper from a server action/API route or other Node-capable boundary where `@resvg/resvg-js` is available.

```ts
import { renderMermaidPNG } from 'agentic-mermaid/agent'

export function renderDiagramPng(source: string) {
  return renderMermaidPNG(source, { fitTo: { width: 1200 }, background: '#fff' })
}
```

For client-only exports, use the live editor/browser's existing download path or post the source to a server endpoint.

## Error handling

For untrusted source, parse or verify before rendering:

```tsx
import { parseRegisteredMermaid, verifyMermaid, renderMermaidSVG } from 'agentic-mermaid/agent'

export function SafeDiagram({ source }: { source: string }) {
  const result = useMemo(() => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) return { ok: false, message: parsed.error.map(e => e.message).join('\n') }

    const verify = verifyMermaid(parsed.value)
    if (!verify.ok) return { ok: false, message: verify.warnings.map(w => w.code).join(', ') }

    return { ok: true, svg: renderMermaidSVG(parsed.value, { security: 'strict' }) }
  }, [source])

  if (!result.ok) return <pre>{result.message}</pre>
  return <div dangerouslySetInnerHTML={{ __html: result.svg }} />
}
```

## See also

- [`api.md`](./api.md) for render options.
- [`theming.md`](./theming.md) for palette and CSS-variable details.
- [`config.md`](./config.md) for Mermaid frontmatter/init support.
