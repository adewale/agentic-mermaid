# UNKNOWN_SHAPE

> UNKNOWN_SHAPE is a structural warning: a node carries a shape outside the renderer’s known vocabulary and falls back to a plain rectangle.

- **Tier:** structural
- **Severity:** warning

## What triggers it

Shape syntax the parser modeled but the renderer does not draw — typically newer Mermaid shape names reaching a structured flowchart or state graph.

## How to fix it

Switch the node to a supported shape (rectangle, rounded, diamond, stadium, circle, hexagon, cylinder, …) with a source edit; the diagram still renders meanwhile, so this is a warning rather than an error.

Run `am verify diagram.mmd --json`, inspect this code, and apply the smallest source or typed mutation that clears it. If it persists after two mechanical attempts, return the warning and ask for human review.

Full page: https://agentic-mermaid.dev/warnings/UNKNOWN_SHAPE/
