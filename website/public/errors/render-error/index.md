# Render error

> Rendering failed after parse. Return the error and source; do not fabricate an artifact.

## How to recover

The diagram parsed but rendering to SVG/PNG/text threw before an artifact existed. Return the error and the source — never a fabricated image; simplify or split the diagram, or retry a lighter format (SVG or ASCII before PNG).

## Related

Surfaces as the [RENDER_FAILED](/warnings/RENDER_FAILED/) verify code.

```
am verify diagram.mmd --json
```

Full page: https://agentic-mermaid.dev/errors/render-error/
