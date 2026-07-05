# RENDER_FAILED

> RENDER_FAILED is a structural error: the diagram parsed, but rendering to the requested format threw before producing an artifact.

- **Tier:** structural
- **Severity:** error

## What triggers it

A construct that parses but the renderer cannot lay out or rasterize — an unsupported combination reaching the SVG/PNG path, or a size/raster budget hit on a very large diagram. Not reachable from small well-formed source in normal operation.

## How to fix it

Return the structured error and the source rather than a fabricated artifact; simplify or split the diagram, drop the construct named in the message, or fall back to a lighter format (SVG or ASCII before PNG). A reproducible failure on stable source is a renderer bug worth reporting.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/RENDER_FAILED/
