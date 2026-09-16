# React integration

Browser-rendered React components should use the browser ESM entry. It loads the
selected diagram family on demand and does not pull the Node/native package
entry into a client bundle.

## Basic component

```tsx
'use client'

import { useEffect, useState } from 'react'
import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'

export function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setSvg('')
    setError('')
    renderMermaidSVGAsync(source, { security: 'strict' }).then(
      result => {
        if (!current) return
        setSvg(result)
        setError('')
      },
      cause => {
        if (!current) return
        setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { current = false }
  }, [source])

  if (error) return <pre role="alert">{error}</pre>
  if (!svg) return <div className="diagram diagram-surface" aria-busy="true" />
  return <div className="diagram diagram-surface" dangerouslySetInnerHTML={{ __html: svg }} />
}
```

`security: 'strict'` removes external-fetch references and is the safest default
for user- or agent-generated diagrams. The cancellation guard prevents an older
render from replacing a newer source after it resolves.

## Theme from CSS variables

```tsx
const svg = await renderMermaidSVGAsync(source, {
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

The component above reports parse and render failures through its `role="alert"`
fallback. If a client workflow also needs structured parse/verify results, use
the runtime-neutral agent entry; do not import the Node/native
`agentic-mermaid/agent` entry into the browser bundle:

```ts
import { parseRegisteredMermaid, verifyMermaid } from 'agentic-mermaid/agent/core'
```

For server components, build steps, and API routes, the synchronous
`renderMermaidSVG` export from `agentic-mermaid` remains appropriate.

## See also

- [`api.md`](./api.md) for render options.
- [`theming.md`](./theming.md) for palette and CSS-variable details.
- [`config.md`](./config.md) for Mermaid frontmatter/init support.
